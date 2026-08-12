import type { Provider } from 'ethers';
import { AbiCoder } from 'ethers';
import { FLARE_CONTRACT_REGISTRY } from '../../../flare/ftso/constants';
import {
  resolvePersonalAccount,
  getNonce,
} from './FlareSmartAccountService';
import {
  computeBorrowUsdt0,
  computeTriggerPrice,
  type BorrowResult,
} from './KineticIsoMath';
import { KineticAdapter } from '../adapters/KineticAdapter';
import type { EncodedAction } from '../IProtocolAdapter';
import { withSourceTag } from '../../../config/xrplSourceTag';

/**
 * E1 — FXRP entry via the `0xFE` custom instruction over FAssets DIRECT MINTING.
 *
 * Flow (verified against source + mainnet, 2026-06-24):
 *   user pays XRP → Core Vault → AssetManagerFXRP direct-mints FXRP into the
 *   Personal Account → MasterAccountController dispatches the committed userOp
 *   → PersonalAccount.executeUserOp([approve, mint(supply), enterMarket,
 *   borrow USDT0]) runs atomically. The executor/operator pays Flare gas.
 *
 * Astryum is PREPARE-ONLY: it resolves the PA + nonce, reads fees live, builds
 * the PackedUserOperation + the 42-byte memo, and assembles the UNSIGNED XRPL
 * Payment. It never signs, never pays gas, never runs the executor.
 *
 * The contract validates `keccak256(_data) == userOpHash` (memo commitment) +
 * `sender == PA` + `nonce` → the operator is zero-discretion (invariant #7).
 * `_data` decodes as OpenZeppelin `draft-IERC4337.PackedUserOperation` (canonical
 * EIP-4337 v0.7, 9 fields) — confirmed in flare-smart-accounts MemoInstructions.sol.
 */

const REGISTRY_ABI = [
  'function getContractAddressByName(string _name) view returns (address)',
];

// AssetManagerFXRP — direct-minting settings (all read live; invariant #9: a
// protocol datum, never hardcoded). UBA == XRP drops for FXRP.
const ASSET_MANAGER_ABI = [
  'function fAsset() view returns (address)',
  'function directMintingPaymentAddress() view returns (string)',
  'function getDirectMintingMinimumFeeUBA() view returns (uint256)',
  'function getDirectMintingFeeBIPS() view returns (uint256)',
  'function getDirectMintingExecutorFeeUBA() view returns (uint256)',
  'function assetMintingGranularityUBA() view returns (uint256)',
];

// IPersonalAccount.executeUserOp(Call[]) — Call { address target; uint256 value; bytes data; }
const PERSONAL_ACCOUNT_ABI = [
  'function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable',
];

// OpenZeppelin draft-IERC4337 PackedUserOperation (EIP-4337 v0.7) — the exact
// tuple the controller abi.decodes `_data` into.
export const PACKED_USER_OP_TUPLE =
  'tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)';

/**
 * El asiento de nonce ya tiene un handoff pendiente: dos userOps vivos con el
 * mismo PA+nonce son gemelos excluyentes — solo uno podrá ejecutar JAMÁS
 * (incidente 2026-07-14/16: dos rotaciones preparadas con el nonce 2; la
 * segunda murió InvalidNonce y el executor quemó fees reintentándola).
 */
export class NonceSeatTakenError extends Error {}

/**
 * Filtra los handoffs pendientes que chocan con el asiento (mismo nonce,
 * userOp distinto). Puro: decodifica el nonce de los bytes persistidos.
 * Un hash idéntico NO es conflicto (re-prepare idempotente del mismo op).
 */
export function findNonceSeatConflicts<T extends { userOpData: string; userOpHash: string }>(
  rows: T[],
  nonce: bigint,
  newUserOpHash: string,
): T[] {
  const abi = AbiCoder.defaultAbiCoder();
  return rows.filter((r) => {
    if (r.userOpHash.toLowerCase() === newUserOpHash.toLowerCase()) return false;
    try {
      const op = abi.decode([PACKED_USER_OP_TUPLE], r.userOpData)[0];
      return BigInt(op.nonce) === nonce;
    } catch {
      return false; // fila corrupta — no puede reclamar el asiento
    }
  });
}

/**
 * Un handoff preparado y NUNCA firmado es un asiento abandonado — no debe
 * tapiar al usuario para siempre (2026-07: el fundador lo golpeó preparando y
 * no firmando durante una prueba). Parte los conflictos por edad: los más
 * viejos que el TTL se invalidan SOLOS (el usuario cerró/no firmó a tiempo);
 * solo uno FRESCO — que podría estar firmado y en vuelo — hace esperar. Puro.
 * Sin `createdAt` → tratado como fresco (defecto seguro: preserva el guard).
 */
export function classifySeatConflicts<T extends { createdAt?: Date }>(
  conflicts: T[],
  ttlMs: number,
  nowMs: number,
): { stale: T[]; fresh: T[] } {
  const stale: T[] = [];
  const fresh: T[] = [];
  for (const c of conflicts) {
    const age = c.createdAt ? nowMs - c.createdAt.getTime() : 0;
    (age >= ttlMs ? stale : fresh).push(c);
  }
  return { stale, fresh };
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Default safety buffer (bips) shaved off the net mint so a fee/round drift of a
 *  few drops between read and execution can't make supply exceed the FXRP that
 *  actually landed (which would revert the whole batch). */
const DEFAULT_SUPPLY_BUFFER_BIPS = 10n; // 0.10%

let cachedAssetManager: string | null = null;
let cachedFxrpToken: string | null = null;
let cachedMinRedeemUBA: bigint | null = null;

export function _resetAssetManagerCache(): void {
  cachedAssetManager = null;
  cachedFxrpToken = null;
  cachedMinRedeemUBA = null;
}

/**
 * FAssets redemption minimum (UBA), best-effort + cached. The mint disclosures
 * (E1/E3/vault, PA rail) say at ENTRY time that the road back to native XRP has
 * a protocol minimum — read live, never hardcoded (invariant #9; 5 XRP on
 * mainnet, 2026-07-24). Returns null if unreadable: the copy degrades to the
 * qualitative warning and the prepare NEVER fails because of this read.
 */
export async function readMinimumRedeemAmountUBA(provider: Provider): Promise<bigint | null> {
  if (cachedMinRedeemUBA != null) return cachedMinRedeemUBA;
  try {
    const { ethers } = await import('ethers');
    const am = new ethers.Contract(
      await resolveAssetManagerFxrp(provider),
      ['function minimumRedeemAmountUBA() view returns (uint256)'],
      provider,
    );
    cachedMinRedeemUBA = BigInt(await am.minimumRedeemAmountUBA());
    return cachedMinRedeemUBA;
  } catch {
    return null;
  }
}

export async function resolveAssetManagerFxrp(provider: Provider): Promise<string> {
  if (cachedAssetManager) return cachedAssetManager;
  const { ethers } = await import('ethers');
  const registry = new ethers.Contract(FLARE_CONTRACT_REGISTRY, REGISTRY_ABI, provider);
  const addr: string = await registry.getContractAddressByName('AssetManagerFXRP');
  if (!addr || addr === ZERO_ADDR || !ADDRESS_RE.test(addr)) {
    throw new Error('FXRP_ASSET_MANAGER_UNRESOLVED: registry returned no AssetManagerFXRP');
  }
  cachedAssetManager = ethers.getAddress(addr);
  return cachedAssetManager;
}

/**
 * Camino de VUELTA (unmint): AssetManagerFXRP.redeemAmount — sub-lote (no exige
 * lotes enteros; mínimo on-chain = minimumRedeemAmountUBA). El burn del FXRP es
 * inmediato al ejecutar; el XRP lo paga un agente FAssets DESPUÉS, menos la fee
 * de redención del protocolo. Fulfilment parcial emite RedemptionAmountIncomplete.
 */
const ASSET_MANAGER_REDEEM_ABI = [
  'function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address _executor) returns (uint256)',
];

/**
 * Executor de la REDENCIÓN: la dirección del executor 0xFE de Astryum cuando
 * hay clave configurada. FAssets deja ejecutar `redemptionPaymentDefault` al
 * redeemer O al executor registrado — y en el carril PA el redeemer es el
 * propio Personal Account (msg.sender del batch): sin executor, reclamar un
 * default exigiría OTRA firma del usuario con proof FDC de impago. La fee del
 * executor de redención viaja en msg.value y va a 0 a propósito (el PA no
 * lleva FLR); nuestro executor rescata por deber, no por incentivo. Sin clave
 * → address(0), exactamente como el camino EVM (allí el redeemer es la wallet
 * del usuario y puede reclamar el default por sí misma).
 */
export async function resolveRedemptionExecutor(): Promise<string> {
  const pk = process.env.FLARE_EXECUTOR_PK;
  if (!pk) return ZERO_ADDR;
  try {
    const { ethers } = await import('ethers');
    return new ethers.Wallet(pk).address;
  } catch {
    return ZERO_ADDR;
  }
}

/**
 * Call de redención para un batch 0xFE: quema `amountUBA` de FXRP del PA
 * (msg.sender del executeUserOp) y pide el pago en XRP nativo a
 * `xrplDestination`. Astryum solo CONSTRUYE la call — la autoriza la firma
 * del Payment en Xaman, como todo lo demás del dispatch (invariantes #1/#8).
 */
export async function buildRedeemToXrplCall(
  provider: Provider,
  input: { amountUBA: bigint; xrplDestination: string },
): Promise<EncodedAction> {
  if (input.amountUBA <= 0n) throw new Error('REDEEM_BAD_AMOUNT: amountUBA must be > 0');
  const { ethers } = await import('ethers');
  const assetManager = await resolveAssetManagerFxrp(provider);
  const iface = new ethers.Interface(ASSET_MANAGER_REDEEM_ABI);
  const executor = await resolveRedemptionExecutor();
  return {
    to: assetManager,
    value: '0',
    calldata: iface.encodeFunctionData('redeemAmount', [input.amountUBA, input.xrplDestination, executor]),
  };
}

/** Saldo FXRP LIBRE de una cuenta (UBA) — lo redimible sin tocar posiciones. */
export async function readFxrpBalance(provider: Provider, holder: string): Promise<bigint> {
  const { ethers } = await import('ethers');
  const erc20 = new ethers.Contract(
    await resolveFxrpToken(provider),
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return BigInt(await erc20.balanceOf(holder));
}

/** FXRP ERC-20 address, resolved live via AssetManagerFXRP.fAsset() (invariant #9). */
export async function resolveFxrpToken(provider: Provider): Promise<string> {
  if (cachedFxrpToken) return cachedFxrpToken;
  const { ethers } = await import('ethers');
  const am = new ethers.Contract(await resolveAssetManagerFxrp(provider), ASSET_MANAGER_ABI, provider);
  const addr: string = await am.fAsset();
  if (!addr || addr === ZERO_ADDR || !ADDRESS_RE.test(addr)) {
    throw new Error('FXRP_TOKEN_UNRESOLVED: AssetManagerFXRP returned no fAsset');
  }
  cachedFxrpToken = ethers.getAddress(addr);
  return cachedFxrpToken;
}

export interface DirectMintParams {
  fxrpToken: string;
  /** Core Vault XRPL address — the Payment Destination. */
  paymentAddress: string;
  minFeeUBA: bigint;
  feeBIPS: bigint;
  executorFeeUBA: bigint;
  granularityUBA: bigint;
}

/** Read all direct-minting settings live from AssetManagerFXRP. */
export async function readDirectMintParams(provider: Provider): Promise<DirectMintParams> {
  const { ethers } = await import('ethers');
  const am = new ethers.Contract(await resolveAssetManagerFxrp(provider), ASSET_MANAGER_ABI, provider);
  const [fxrpToken, paymentAddress, minFeeUBA, feeBIPS, executorFeeUBA, granularityUBA] =
    await Promise.all([
      am.fAsset(),
      am.directMintingPaymentAddress(),
      am.getDirectMintingMinimumFeeUBA(),
      am.getDirectMintingFeeBIPS(),
      am.getDirectMintingExecutorFeeUBA(),
      am.assetMintingGranularityUBA(),
    ]);
  return {
    fxrpToken: ethers.getAddress(fxrpToken),
    paymentAddress,
    minFeeUBA: BigInt(minFeeUBA),
    feeBIPS: BigInt(feeBIPS),
    executorFeeUBA: BigInt(executorFeeUBA),
    granularityUBA: BigInt(granularityUBA) || 1n,
  };
}

export interface NetMintBreakdown {
  grossUBA: bigint;
  mintingFeeUBA: bigint;
  executorFeeUBA: bigint;
  /** FXRP that actually lands in the Personal Account (gross − fees). */
  netToPersonalAccountUBA: bigint;
  bufferUBA: bigint;
  /** Amount the batch should supply as collateral: net − buffer, floored to granularity. */
  supplyUBA: bigint;
}

/**
 * Post-fee accounting (decision #4). The batch must supply the FXRP that REALLY
 * minted (gross − minting fee − executor fee), minus a small buffer, floored to
 * minting granularity. Supplying the gross would revert the batch on insufficient
 * FXRP. Throws if nothing is left after fees.
 */
export function computeNetMint(
  grossUBA: bigint,
  p: Pick<DirectMintParams, 'minFeeUBA' | 'feeBIPS' | 'executorFeeUBA' | 'granularityUBA'>,
  bufferBips: bigint = DEFAULT_SUPPLY_BUFFER_BIPS,
): NetMintBreakdown {
  if (grossUBA <= 0n) throw new Error('DIRECT_MINT_BAD_AMOUNT: grossUBA must be > 0');
  const pctFee = (grossUBA * p.feeBIPS) / 10_000n;
  const mintingFeeUBA = pctFee > p.minFeeUBA ? pctFee : p.minFeeUBA;
  const netToPersonalAccountUBA = grossUBA - mintingFeeUBA - p.executorFeeUBA;
  if (netToPersonalAccountUBA <= 0n) {
    throw new Error(
      `DIRECT_MINT_INSUFFICIENT: gross ${grossUBA} ≤ fees (mint ${mintingFeeUBA} + exec ${p.executorFeeUBA})`,
    );
  }
  const bufferUBA = (netToPersonalAccountUBA * bufferBips) / 10_000n;
  const beforeFloor = netToPersonalAccountUBA - bufferUBA;
  const gran = p.granularityUBA > 0n ? p.granularityUBA : 1n;
  const supplyUBA = (beforeFloor / gran) * gran; // floor to granularity
  if (supplyUBA <= 0n) {
    throw new Error('DIRECT_MINT_INSUFFICIENT: nothing left to supply after buffer/granularity');
  }
  return {
    grossUBA,
    mintingFeeUBA,
    executorFeeUBA: p.executorFeeUBA,
    netToPersonalAccountUBA,
    bufferUBA,
    supplyUBA,
  };
}

/**
 * Invariant #6 — the fees a mint-coupled 0xFE dispatch charges out of the XRP
 * paid, serialized for the prepare disclosure. EVERY XRPL-rail response built
 * from a direct-mint handoff must spread this in: the executor's fee is real
 * money and the user sees it before signing, on every surface.
 */
export function mintFeeDisclosure(
  net: Pick<NetMintBreakdown, 'mintingFeeUBA' | 'executorFeeUBA'>,
): { mintingFeeXrp: number; executorFeeXrp: number } {
  const DROPS = 1_000_000;
  return {
    mintingFeeXrp: Number(net.mintingFeeUBA) / DROPS,
    executorFeeXrp: Number(net.executorFeeUBA) / DROPS,
  };
}

/** Encode IPersonalAccount.executeUserOp(Call[]) calldata from the inner batch. */
export async function buildExecuteUserOpCallData(actions: EncodedAction[]): Promise<string> {
  if (!actions.length) throw new Error('DIRECT_MINT_EMPTY_BATCH');
  const { ethers } = await import('ethers');
  const calls = actions.map((a) => {
    if (!ADDRESS_RE.test(a.to)) throw new Error(`DIRECT_MINT_BAD_TARGET: ${a.to}`);
    return { target: a.to, value: BigInt(a.value || '0'), data: a.calldata };
  });
  const iface = new ethers.Interface(PERSONAL_ACCOUNT_ABI);
  return iface.encodeFunctionData('executeUserOp', [calls]);
}

export interface PackedUserOp {
  /** ABI-encoded PackedUserOperation = the `_data` delivered off-chain to the executor. */
  dataHex: string;
  /** keccak256(dataHex) — committed in the 42-byte memo. */
  userOpHash: string;
}

/**
 * Build `_data = abi.encode(PackedUserOperation)` + its hash. Only sender, nonce,
 * callData are meaningful on-chain; the rest are empty (not validated).
 */
export async function buildPackedUserOp(input: {
  sender: string;
  nonce: bigint;
  callData: string;
}): Promise<PackedUserOp> {
  const { ethers } = await import('ethers');
  const userOp = {
    sender: ethers.getAddress(input.sender),
    nonce: input.nonce,
    initCode: '0x',
    callData: input.callData,
    accountGasLimits: ZERO_BYTES32,
    preVerificationGas: 0n,
    gasFees: ZERO_BYTES32,
    paymasterAndData: '0x',
    signature: '0x',
  };
  const dataHex = ethers.AbiCoder.defaultAbiCoder().encode(
    [PACKED_USER_OP_TUPLE],
    [userOp],
  );
  return { dataHex, userOpHash: ethers.keccak256(dataHex) };
}

/** Build the 42-byte `0xFE` memo via the official encoder (uppercase hex, no 0x). */
export async function build0xFEMemo(input: {
  walletId: number;
  executorFeeUBA: bigint;
  userOpHash: string;
}): Promise<string> {
  const { UserOpCustomInstruction } = await import('@flarenetwork/smart-accounts-encoder');
  const encoded = new UserOpCustomInstruction({
    walletId: input.walletId,
    executorFeeUBA: input.executorFeeUBA,
    userOperationHash: input.userOpHash as `0x${string}`,
  }).encode();
  return encoded.replace(/^0x/i, '').toUpperCase();
}

export interface DirectMintHandoff {
  personalAccount: string;
  fxrpToken: string;
  net: NetMintBreakdown;
  /** Off-chain payload delivered to the executor (ABI-encoded PackedUserOperation). */
  userOpData: string;
  userOpHash: string;
  /** XRPL memo (hex, uppercase, no 0x) — goes in Payment.Memos[0].Memo.MemoData. */
  memoHex: string;
  /** UNSIGNED XRPL Payment for Xaman. No DestinationTag (would misroute the mint). */
  xrplPayment: {
    TransactionType: 'Payment';
    /** Pinned signer (incidente 2026-07-14: sin Account, Xaman firma con la
     *  cuenta ACTIVA — dos Payments salieron de la cuenta equivocada y sus
     *  bytes quedaron inejecutables). Con Account, Xaman exige firmar con
     *  EXACTAMENTE la cuenta para la que se construyó el userOp. */
    Account: string;
    Destination: string;
    Amount: string;
    Memos: Array<{ Memo: { MemoData: string } }>;
    /** Make Waves project tag (XRPL_SOURCE_TAG). Unlike a DestinationTag it does
     *  not affect FAssets routing — it labels the sender side on-ledger. */
    SourceTag?: number;
  };
}

export interface BuildDirectMintInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops (== FXRP UBA). */
  grossXrpDrops: bigint;
  /** Inner batch to run after the mint (e.g. approve+mint+enterMarket+borrow). */
  innerCalls: EncodedAction[];
  /** Operator-assigned wallet id; 0 if unassigned. */
  walletId?: number;
  bufferBips?: bigint;
  /**
   * true = invalida (supersede) los handoffs pendientes que ocupan el mismo
   * PA+nonce en vez de abortar con NonceSeatTakenError. Úsalo SOLO si aquel
   * Payment no llegó a firmarse — si se firmó, espera a que ejecute.
   */
  supersedePendingNonce?: boolean;
  /**
   * Which prepare route is building this dispatch ('e1', 'pa-repay',
   * 'vault-withdraw:firelight'…). Persisted on the handoff row as a LABEL only
   * — the admin unstick modal tags entrante/saliente with it. Never read by
   * the execution path.
   */
  action?: string;
}

/**
 * Assemble the complete UNSIGNED `0xFE` direct-mint hand-off. Reads PA + nonce +
 * fees + Core Vault live, computes post-fee net, wraps the batch in a userOp, and
 * returns the XRPL Payment (for Xaman) plus the off-chain userOp bytes for the
 * executor. Astryum signs nothing.
 *
 * NOTE: `innerCalls` (the Kinetic ISO approve+mint+enterMarket+borrow batch) are
 * produced by the F3 wiring and passed in here; the supply amount must use
 * `net.supplyUBA`. This builder is the `0xFE` machinery; F3 fills the batch.
 */
export async function buildDirectMintHandoff(
  provider: Provider,
  input: BuildDirectMintInput,
  opts?: { params?: DirectMintParams },
): Promise<DirectMintHandoff> {
  const params = opts?.params ?? (await readDirectMintParams(provider));
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);
  const nonce = await getNonce(provider, personalAccount);

  const callData = await buildExecuteUserOpCallData(input.innerCalls);
  const { dataHex, userOpHash } = await buildPackedUserOp({
    sender: personalAccount,
    nonce,
    callData,
  });
  // Executor fee committed in the memo = the live direct-minting executor fee (decision #3).
  const memoHex = await build0xFEMemo({
    walletId: input.walletId ?? 0,
    executorFeeUBA: params.executorFeeUBA,
    userOpHash,
  });

  // Asiento de nonce único (incidente 2026-07-14/16): si ya hay un handoff
  // pendiente con este PA+nonce y OTRO userOp, son excluyentes — abortar (o
  // invalidar el viejo con supersedePendingNonce). Best-effort: sin DB
  // (scripts CLI) no hay filas que consultar y el guard no aplica.
  try {
    const { findQueuedHandoffsByPersonalAccount, markHandoffsSuperseded } = await import(
      '../../../services/flare/DirectMintHandoffStore'
    );
    const queued = await findQueuedHandoffsByPersonalAccount(personalAccount);
    const conflicts = findNonceSeatConflicts(queued, nonce, userOpHash);
    if (conflicts.length > 0) {
      // El asiento se libera SOLO: los conflictos abandonados (más viejos que el
      // TTL, nunca firmados a tiempo) se invalidan sin error; solo uno FRESCO —
      // que podría estar firmado y en vuelo — hace esperar, y aún ese se libera
      // al instante vía /handoff/release cuando el usuario cancela.
      const ttlMs = Math.max(Number(process.env.HANDOFF_SEAT_TTL_MIN || 5), 1) * 60_000;
      const { stale, fresh } = classifySeatConflicts(conflicts, ttlMs, Date.now());
      if (stale.length > 0) {
        await markHandoffsSuperseded(stale.map((c) => c.userOpHash));
      }
      if (fresh.length > 0) {
        if (!input.supersedePendingNonce) {
          throw new NonceSeatTakenError(
            `NONCE_SEAT_TAKEN: el PA ${personalAccount} tiene una orden 0xFE reciente sin ejecutar en el nonce ${nonce} ` +
              `(${fresh.map((c) => c.userOpHash.slice(0, 10)).join(', ')}). Si la firmaste, espera unos segundos a que ejecute; ` +
              `si la cancelaste, vuelve a intentarlo — el asiento se libera al cancelar o solo en ${Math.round(ttlMs / 60_000)} min.`,
          );
        }
        await markHandoffsSuperseded(fresh.map((c) => c.userOpHash));
      }
    }
  } catch (e) {
    if (e instanceof NonceSeatTakenError) throw e;
    /* sin DB (scripts CLI) — el guard no aplica; el log de abajo sigue siendo la traza */
  }

  // Registro de recuperación (lección de la tx 7BFCF65F…, 2026-07-12): el memo
  // solo publica el hash; si estos bytes se pierden, ningún executor puede
  // ejecutar el mint y el XRP queda aparcado en el Core Vault. Este log es la
  // copia server-side mínima que hace todo handoff 0xFE re-ejecutable
  // (rescate: scripts/execute-direct-mint.ts).
  const handoffRecord = {
    xrplAddress: input.xrplAddress,
    personalAccount,
    userOpHash,
    memoHex,
    grossXrpDrops: input.grossXrpDrops.toString(),
    supplyUBA: net.supplyUBA.toString(),
    executorFeeUBA: net.executorFeeUBA.toString(),
    walletId: input.walletId ?? 0,
    userOpData: dataHex,
    action: input.action ?? null,
  };
  console.log(`[0xFE-handoff] ${JSON.stringify(handoffRecord)}`);
  // Persistencia para el executor automático (DirectMintExecutorService): la
  // fila por userOpHash es lo que hace el mint ejecutable sin reconstrucción.
  // Import perezoso + best-effort: este builder también corre en scripts CLI
  // sin DATABASE_URL, y un fallo de DB nunca debe romper el prepare (el store
  // ya deja traza ruidosa del fallo).
  try {
    const { saveHandoffRecord } = await import('../../../services/flare/DirectMintHandoffStore');
    await saveHandoffRecord(handoffRecord);
  } catch {
    /* sin DB (scripts CLI) — el log de arriba sigue siendo la copia mínima */
  }

  return {
    personalAccount,
    fxrpToken: params.fxrpToken,
    net,
    userOpData: dataHex,
    userOpHash,
    memoHex,
    xrplPayment: withSourceTag({
      TransactionType: 'Payment' as const,
      Account: input.xrplAddress, // pin del firmante — Xaman rechaza otra cuenta
      Destination: params.paymentAddress, // Core Vault — NOT the operator wallet
      Amount: input.grossXrpDrops.toString(), // drops
      Memos: [{ Memo: { MemoData: memoHex } }],
      // No DestinationTag by design (a tag misroutes FAssets direct minting).
      // SourceTag (when configured) is safe: it never affects routing.
    }),
  };
}

export interface E1HandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  /** User-chosen borrow ratio (fraction of max capacity, 0..1). NOT hardcoded. */
  borrowRatio: number;
  /** HF level A1 will defend at — used to precompute the trigger price now. */
  targetHF: number;
  /** Live FTSO XRP/USD (read by the caller, disclosed to the user — invariant #6/#9). */
  fxrpPriceUSD: number;
  /** Live collateral factor of kFXRP ISO from markets() (read by the caller). */
  collateralFactor: number;
  usdt0PriceUSD?: number;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
}

export interface E1Handoff {
  handoff: DirectMintHandoff;
  borrow: BorrowResult;
  /** Precomputed A1 inputs — F4 must reuse these EXACT values, not recompute. */
  a1: {
    triggerPriceUSD: number;
    targetHF: number;
    borrowRatio: number;
    collateralFactor: number;
    fxrpPriceUSD: number;
    supplyUBA: string;
    borrowUsdt0Base: string;
  };
}

/**
 * Close E1 end-to-end (UNSIGNED): FXRP direct-mint → supply → borrow USDT0, plus
 * the precomputed A1 trigger price from the SAME (net FXRP, CF, ratio) so the
 * stop-loss defends exactly the position that was opened. Astryum signs nothing.
 *
 * Live oracle/CF values are inputs (the caller reads FTSO XRP/USD + markets()
 * and discloses them before the user signs); this keeps the composition
 * deterministic and testable. The supply uses post-fee net FXRP; the borrow uses
 * net·CF·ratio (KineticIsoMath, shared with A1).
 */
export async function buildE1Handoff(
  provider: Provider,
  input: E1HandoffInput,
): Promise<E1Handoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const borrow = computeBorrowUsdt0({
    supplyUBA: net.supplyUBA,
    fxrpPriceUSD: input.fxrpPriceUSD,
    collateralFactor: input.collateralFactor,
    borrowRatio: input.borrowRatio,
    usdt0PriceUSD: input.usdt0PriceUSD,
  });

  const innerCalls = await new KineticAdapter().buildIsoSupplyBorrowBatch({
    supplyUBA: net.supplyUBA,
    borrowUsdt0: borrow.borrowUsdt0Base,
  });

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      action: 'e1',
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  const trigger = computeTriggerPrice({
    supplyUBA: net.supplyUBA,
    borrowUsdt0Base: borrow.borrowUsdt0Base,
    collateralFactor: input.collateralFactor,
    targetHF: input.targetHF,
    usdt0PriceUSD: input.usdt0PriceUSD,
  });

  return {
    handoff,
    borrow,
    a1: {
      triggerPriceUSD: trigger.triggerPriceUSD,
      targetHF: input.targetHF,
      borrowRatio: input.borrowRatio,
      collateralFactor: input.collateralFactor,
      fxrpPriceUSD: input.fxrpPriceUSD,
      supplyUBA: net.supplyUBA.toString(),
      borrowUsdt0Base: borrow.borrowUsdt0Base.toString(),
    },
  };
}

export interface E3HandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
}

export interface E3Handoff {
  handoff: DirectMintHandoff;
}

/**
 * Close the lend-only entry (E3) end-to-end (UNSIGNED): FXRP direct-mint → supply,
 * NO borrow, NO stop-loss. The safest entry in the set — zero debt, zero
 * liquidation, nothing to defend. Reuses the EXACT `0xFE` machinery as E1
 * (buildDirectMintHandoff); the only difference is the inner batch, which is
 * `buildIsoSupplyFxrpBatch` ([approve, mint]) instead of the supply+borrow batch.
 * The supply uses the post-fee net FXRP. Astryum signs nothing.
 */
export async function buildE3Handoff(
  provider: Provider,
  input: E3HandoffInput,
): Promise<E3Handoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  const innerCalls = await new KineticAdapter().buildIsoSupplyFxrpBatch({
    supplyUBA: net.supplyUBA,
  });

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      action: 'e3',
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff };
}

export type VaultEntryKind = 'firelight' | 'earnxrp' | 'monarq';

export interface VaultEntryHandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays, in drops. */
  grossXrpDrops: bigint;
  /** Which partner vault receives the minted FXRP. */
  vault: VaultEntryKind;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
}

export interface VaultEntryHandoff {
  handoff: DirectMintHandoff;
}

/**
 * Close a partner-vault entry end-to-end (UNSIGNED): FXRP direct-mint →
 * deposit into the chosen vault. Zero debt, zero liquidation — the same `0xFE`
 * machinery as E3 (buildDirectMintHandoff); the only difference is the inner
 * batch:
 *   firelight → FirelightAdapter.buildStakeBatch  ([approve, 4626 deposit])
 *   earnxrp / monarq → UpshiftVaultAdapter.buildDepositBatch
 *                      ([approve, deposit(FXRP, amount, PA)])
 *
 * The deposit receiver is the resolved Personal Account (the userOp sender),
 * so the vault shares land on the user's smart account. The deposit uses the
 * post-fee net FXRP. Astryum signs nothing.
 */
export async function buildVaultEntryHandoff(
  provider: Provider,
  input: VaultEntryHandoffInput,
): Promise<VaultEntryHandoff> {
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);

  // The 4626/Upshift deposit needs an explicit receiver — resolve the PA first
  // (buildDirectMintHandoff re-resolves internally; reads are cheap + cached).
  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);

  let innerCalls: EncodedAction[];
  if (input.vault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    innerCalls = await new FirelightAdapter().buildStakeBatch({
      supplyUBA: net.supplyUBA,
      receiver: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    innerCalls = await new UpshiftVaultAdapter().buildDepositBatch({
      vaultKey: input.vault,
      supplyUBA: net.supplyUBA,
      receiver: personalAccount,
    });
  }

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls,
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      action: `vault:${input.vault}`,
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff };
}

export interface VaultRotateHandoffInput {
  xrplAddress: string;
  /** Gross XRP the user pays for the ONE mint-coupled dispatch, in drops. */
  grossXrpDrops: bigint;
  /** Vault being exited (its shares burn from the Personal Account). */
  fromVault: VaultEntryKind;
  /** Vault being entered (its shares land on the Personal Account). */
  toVault: VaultEntryKind;
  /** LP shares of `fromVault` to redeem (6-dec base units). */
  sharesUBA: bigint;
  /** FXRP expected out of the redeem AFTER the exit fee and the rotation
   *  buffer (computed + disclosed by the route). The deposit into `toVault`
   *  is this plus the dispatch's own net mint — see below. */
  redeemDepositUBA: bigint;
  walletId?: number;
  bufferBips?: bigint;
  /** Ver BuildDirectMintInput.supersedePendingNonce (guard de asiento de nonce). */
  supersedePendingNonce?: boolean;
}

export interface VaultRotateHandoff {
  handoff: DirectMintHandoff;
  /** FXRP the batch deposits into `toVault` = redeemDepositUBA + net.supplyUBA. */
  depositUBA: bigint;
}

/**
 * Close a vault ROTATION end-to-end (UNSIGNED): exit `fromVault` and enter
 * `toVault` inside ONE `0xFE` dispatch instead of two. The XRPL rail is
 * mint-coupled — every Personal Account dispatch rides a Payment that mints a
 * small FXRP — so a naive rotation (withdraw, then deposit) pays that toll
 * twice. Fusing both legs into a single userOp batch pays it once:
 *
 *   [ redeem(shares, PA)              — fromVault shares → FXRP into the PA
 *     approve(FXRP → toVault)         — for redeemDeposit + this mint's net
 *     deposit(FXRP, amount, PA) ]     — toVault shares → the PA
 *
 * The deposit amount adds the dispatch's own net mint (net.supplyUBA) to the
 * redeem output, so the mint-coupled FXRP joins the new position instead of
 * sitting loose in the PA. Vault rotations never touch FAssets redemption:
 * the FXRP stays on Flare throughout. Astryum signs nothing.
 */
export async function buildVaultRotateHandoff(
  provider: Provider,
  input: VaultRotateHandoffInput,
): Promise<VaultRotateHandoff> {
  if (input.fromVault === input.toVault) {
    throw new Error('VAULT_ROTATE_SAME_VAULT: fromVault and toVault must differ');
  }
  if (input.sharesUBA <= 0n) throw new Error('VAULT_ROTATE_BAD_SHARES: must be > 0');
  if (input.redeemDepositUBA < 0n) throw new Error('VAULT_ROTATE_BAD_DEPOSIT: must be ≥ 0');

  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.grossXrpDrops, params, input.bufferBips);
  const personalAccount = await resolvePersonalAccount(provider, input.xrplAddress);
  const depositUBA = input.redeemDepositUBA + net.supplyUBA;

  let redeemCalls: EncodedAction[];
  if (input.fromVault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    redeemCalls = await new FirelightAdapter().buildRedeemBatch({
      sharesUBA: input.sharesUBA,
      receiver: personalAccount,
      owner: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    redeemCalls = await new UpshiftVaultAdapter().buildInstantRedeemBatch({
      vaultKey: input.fromVault,
      sharesUBA: input.sharesUBA,
      receiver: personalAccount,
    });
  }

  let depositCalls: EncodedAction[];
  if (input.toVault === 'firelight') {
    const { FirelightAdapter } = await import('../adapters/FirelightAdapter');
    depositCalls = await new FirelightAdapter().buildStakeBatch({
      supplyUBA: depositUBA,
      receiver: personalAccount,
    });
  } else {
    const { UpshiftVaultAdapter } = await import('../adapters/UpshiftVaultAdapter');
    depositCalls = await new UpshiftVaultAdapter().buildDepositBatch({
      vaultKey: input.toVault,
      supplyUBA: depositUBA,
      receiver: personalAccount,
    });
  }

  const handoff = await buildDirectMintHandoff(
    provider,
    {
      xrplAddress: input.xrplAddress,
      grossXrpDrops: input.grossXrpDrops,
      innerCalls: [...redeemCalls, ...depositCalls],
      walletId: input.walletId,
      bufferBips: input.bufferBips,
      supersedePendingNonce: input.supersedePendingNonce,
      action: `vault-rotate:${input.fromVault}->${input.toVault}`,
    },
    { params }, // reuse the already-read params → one RPC read, consistent net
  );

  return { handoff, depositUBA };
}

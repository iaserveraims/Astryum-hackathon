/**
 * DirectMintExecutorService — el executor del carril `0xFE`, automatizado.
 *
 * El flujo 0xFE es de dos actores: el usuario firma en Xaman un Payment al Core
 * Vault cuyo memo compromete `keccak256(userOpData)`, y un EXECUTOR entrega los
 * bytes completos a `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`
 * con un proof FDC `XRPPayment`. Hoy no existe canal publicado hacia el operator
 * de Flare, así que Astryum corre su propio executor (decisión fundador
 * 2026-07-12: "hay que automatizar este script") para TODOS los flujos 0xFE —
 * e1, e3, vaults (Firelight/earnXRP/Monarq), supply-usdt0, pa-withdraw.
 *
 * Línea de custodia (invariantes #1/#8): el executor NO toca fondos de usuario
 * ni decide nada — el contrato solo acepta los bytes EXACTOS que la firma de
 * Xaman comprometió (keccak256(_data) == hash del memo + sender + nonce). Quien
 * ejecuta tiene CERO discreción: o ejecuta lo firmado, o revierte. La clave del
 * executor (FLARE_EXECUTOR_PK, solo env — invariante #2) firma únicamente
 * (1) la solicitud de attestation al FDC Hub y (2) la llamada de ejecución —
 * gas propio de Astryum, jamás claves de usuario. El watcher vive tras doble
 * flag (FLARE_EXECUTOR_ENABLED + la propia PK) — invariante #10 — y simula
 * SIEMPRE antes de firmar (#11); la verificación post-settlement queda en el
 * proof on-chain + la fila de auditoría del handoff.
 *
 * Los bytes a ejecutar salen del DirectMintHandoffStore (persistidos en el
 * prepare, casados por userOpHash). Fallback si no hay fila: reconstrucción
 * determinista probando cada shape conocido (vaults + lend-only) contra el
 * hash del memo — e1 y demás batches con parámetros libres solo son
 * ejecutables desde el store o con override manual (scripts/execute-direct-mint.ts).
 */

import { ethers } from 'ethers';
import {
  resolveAssetManagerFxrp,
  resolveFxrpToken,
  readDirectMintParams,
  computeNetMint,
  buildExecuteUserOpCallData,
  buildPackedUserOp,
} from '../../connectors/protocols/flare/FlareDirectMintService';
import {
  resolveMasterAccountController,
  resolvePersonalAccount,
  getNonce,
} from '../../connectors/protocols/flare/FlareSmartAccountService';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';
import {
  findHandoffByUserOpHash,
  markHandoffExecuted,
  save0xFeAttestation,
  find0xFeAttestation,
  delete0xFeAttestation,
  saveParked0xFe,
  deleteParked0xFe,
  listParked0xFe,
} from './DirectMintHandoffStore';
import {
  checkExecutorFuel,
  executorAlert,
  assertDailyFeeBudget,
  legacyFeeReserveWei,
  recordFeeSpend,
  feeBudgetStatus,
  remainingFeeBudgetWei,
  estimatedMintFeeWei,
  type FeeMarginGauge,
  type FuelGauges,
} from './ExecutorFuelService';

const DROPS = 1_000_000;

export type Log = (msg: string) => void;
const noopInline: Log = (m) => console.log(m);

/** Aborto controlado del carril (equivale al fail() del script CLI). */
export class ExecutorAbort extends Error {
  /**
   * true = los bytes firmados son estructuralmente inejecutables (sender que no
   * es el PA del pagador, nonce ya consumido…): NINGÚN executor podrá ejecutarlos
   * jamás. El watcher los aparca en vez de reintentar — y estos abortos saltan
   * ANTES de pagar la fee de attestation (lección 2026-07-18: 244 attestations
   * de 20 FLR quemadas reintentando 3 Payments imposibles).
   */
  readonly permanent: boolean;
  constructor(message: string, opts?: { permanent?: boolean }) {
    super(message);
    this.permanent = opts?.permanent ?? false;
  }
}

// ── FDC XRPPayment (attestation type 0x08; NO es el `Payment` genérico 0x01) ──
// Struct IXRPPayment.Response, extraído del ABI oficial de mainnet
// (@flarenetwork/flare-wagmi-periphery-package → flare.iDirectMintingAbi).
const XRP_PAYMENT_RESPONSE_TUPLE =
  'tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ' +
  'tuple(bytes32 transactionId, address proofOwner) requestBody, ' +
  'tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, ' +
  'bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, ' +
  'int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, ' +
  'bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)';

const ASSET_MANAGER_ABI = [
  `function executeDirectMintingWithData(tuple(bytes32[] merkleProof, ${XRP_PAYMENT_RESPONSE_TUPLE} data) _payment, bytes _data) payable`,
  'function directMintingPaymentAddress() view returns (string)',
  'function directMintingDelayState(bytes32 _transactionId) view returns (uint8 _delayState, uint256 _allowedAt, uint256 _startedAt)',
  'event DirectMintingDelayed(bytes32 transactionId, uint256 amount, uint256 executionAllowedAt)',
];

const MAC_ABI = [
  'function isTransactionIdUsed(bytes32 _transactionId) view returns (bool)',
  'function getExecutor(address _personalAccount) view returns (address)',
  'function getNonce(address _personalAccount) view returns (uint256)',
  'event UserOperationExecuted(address indexed personalAccount, uint256 nonce)',
];

// Errores conocidos del camino 0xFE, para descodificar reverts con nombre
// (firmas verificadas contra flare-smart-accounts + fassets).
const KNOWN_ERRORS_ABI = [
  'error CustomInstructionHashMismatch(bytes32 expected, bytes32 actual)',
  'error InvalidNonce(uint256 expected, uint256 actual)',
  'error InvalidSender(address sender, address personalAccount)',
  'error WrongExecutor(address expected, address actual)',
  'error CallFailed(bytes returnData)',
  'error InvalidMemoData()',
  'error InvalidInstructionId(uint8 instructionId)',
  'error TransactionAlreadyExecuted()',
  'error InvalidTransactionProof()',
  'error InvalidTransactionStatus()',
  'error InsufficientAmountForFee(uint256 amount, uint256 fee)',
  'error IsPaused()',
  'error DirectMintingStillDelayed(uint256 allowedAt)',
];

// FDC — contratos de infraestructura, resueltos por nombre del registry (#13).
const REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';
const REGISTRY_ABI = ['function getContractAddressByName(string) view returns (address)'];
const FDC_HUB_ABI = [
  'function requestAttestation(bytes _data) payable',
  'function fdcRequestFeeConfigurations() view returns (address)',
];
const FDC_FEE_ABI = ['function getRequestFee(bytes _data) view returns (uint256)'];
const FSM_ABI = [
  'function firstVotingRoundStartTs() view returns (uint64)',
  'function votingEpochDurationSeconds() view returns (uint64)',
];
const RELAY_ABI = ['function isFinalized(uint256 _protocolId, uint256 _votingRoundId) view returns (bool)'];
const FDC_VERIFICATION_ABI = ['function fdcProtocolId() view returns (uint8)'];

export const DEFAULTS = {
  rpcUrl: 'https://flare-api.flare.network/ext/C/rpc',
  // Endpoint XRPL preferido. El acceso real es JSON-RPC sobre HTTPS con rotación
  // (ver xrplJsonRpc): este valor se coacciona ws→https y encabeza la lista de
  // fallback. Se conserva el nombre `wssUrl` por compat con el CLI/watcher.
  // NO es xrplcluster: ese cluster responde 402 a IPs de datacenter (Railway) y
  // además rota nodos amendment-blocked. Se queda de último recurso.
  wssUrl: 'https://s1.ripple.com:51234',
  verifierBase: 'https://fdc-verifiers-mainnet.flare.network',
  verifierKey: '00000000-0000-0000-0000-000000000000',
  daLayerBase: 'https://flr-data-availability.flare.network',
  sourceTag: 2607090002,
};

/**
 * Attestations YA pagadas y aún no consumidas, por `txHash|executor`. La fee del
 * FDC se paga UNA vez: la ronda queda finalizada y su proof se recoge del DA
 * layer gratis las veces que haga falta — un reintento (fallo posterior, mint
 * diferido, backoff del watcher) reutiliza la ronda en vez de re-pagar 20 FLR.
 * En memoria: tras un restart se re-paga como mucho una vez por tx pendiente.
 */
const paidAttestations = new Map<string, { abiEncodedRequest: string; roundId: number; passesWithoutProof: number }>();

export interface ParsedMemo {
  opcode: number;
  walletId: number;
  executorFeeUBA: bigint;
  userOpHash: string;
  raw: string;
}

export function parseMemo0xFE(memoHex: string): ParsedMemo {
  const hex = memoHex.replace(/^0x/i, '').toUpperCase();
  if (hex.length !== 84) {
    throw new ExecutorAbort(`MEMO_BAD_LENGTH: esperados 42 bytes (84 hex), hay ${hex.length / 2}`);
  }
  const opcode = parseInt(hex.slice(0, 2), 16);
  if (opcode !== 0xfe) {
    throw new ExecutorAbort(`MEMO_NOT_0xFE: opcode 0x${hex.slice(0, 2)} — solo se ejecutan userOps 0xFE`);
  }
  return {
    opcode,
    walletId: parseInt(hex.slice(2, 4), 16),
    executorFeeUBA: BigInt('0x' + hex.slice(4, 20)),
    userOpHash: ('0x' + hex.slice(20)).toLowerCase(),
    raw: hex,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Descodifica un revert contra la lista de errores conocidos del carril 0xFE. */
export function describeRevert(err: unknown): string {
  const data: string | undefined =
    (err as { data?: string })?.data ??
    (err as { info?: { error?: { data?: string } } })?.info?.error?.data;
  if (typeof data === 'string' && data.length >= 10) {
    try {
      const desc = new ethers.Interface(KNOWN_ERRORS_ABI).parseError(data);
      if (desc) return `${desc.name}(${desc.args.map(String).join(', ')})`;
    } catch {
      /* selector desconocido → raw abajo */
    }
    return `revert data: ${data}`;
  }
  return (err as Error)?.message ?? String(err);
}

export interface XrplPaymentFacts {
  account: string;
  destination: string;
  grossDrops: bigint;
  memoHex: string;
  destinationTag?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Acceso XRPL — JSON-RPC sobre HTTPS con rotación de endpoints                */
/* ────────────────────────────────────────────────────────────────────────── */
//
// El executor corre en hosting (Railway). El cluster público de XRPL Labs
// responde 402 Payment Required a IPs de datacenter, y ese gate es por IP —
// aplica igual sobre WebSocket que sobre HTTPS. Por eso NO basta cambiar de
// transporte: lo que salva el barrido es ROTAR a los servidores JSON-RPC
// públicos de Ripple (s1/s2), que no filtran por IP. HTTP además evita mantener
// un socket vivo en un proceso que solo hace ráfagas de lecturas.
//
// Read-only por construcción: aquí solo se emiten `tx` y `account_tx`. Ninguna
// clave de usuario, ningún submit, ninguna firma (invariantes #1/#8).

function httpsify(url: string): string {
  return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
}

/** Endpoints JSON-RPC en orden de fallback: el que pasó el llamador (coaccionado
 *  ws→https), luego los overrides de entorno, luego los públicos de Ripple —
 *  ambos con historia completa, verificado 2026-07-12 (ledger 32570→105.5M).
 *  xrplcluster va el ÚLTIMO a propósito: 402 a IPs de datacenter y nodos
 *  amendment-blocked rotando en su pool. Sirve de red, no de primera opción. */
function xrplHttpEndpoints(preferred?: string): string[] {
  return [
    ...(preferred ? [httpsify(preferred)] : []),
    ...(process.env.XRPL_RPC_URL ? [httpsify(process.env.XRPL_RPC_URL)] : []),
    ...(process.env.XRPL_WSS_URL ? [httpsify(process.env.XRPL_WSS_URL)] : []),
    ...(process.env.XRPL_WS_URL ? [httpsify(process.env.XRPL_WS_URL)] : []),
    'https://s1.ripple.com:51234',
    'https://s2.ripple.com:51234',
    'https://xrplcluster.com',
  ].filter((v, i, a) => /^https?:\/\//.test(v) && a.indexOf(v) === i);
}

interface XrplRpcResult {
  status?: string;
  error?: string;
  error_message?: string;
  [k: string]: unknown;
}

/**
 * Una llamada JSON-RPC a XRPL con rotación. Pasa al siguiente endpoint tanto
 * ante fallo de transporte (el 402, timeouts, red) como ante un `status:'error'`
 * de rippled — un servidor sin historia completa puede no ver la tx que otro
 * full-history sí ve —, y solo lanza cuando se agotan todos (el último error
 * es el que sube, p.ej. `txnNotFound` real o `xrpl_http_402`).
 */
async function xrplJsonRpc(
  method: string,
  params: Record<string, unknown>,
  preferred?: string,
): Promise<XrplRpcResult> {
  let lastErr: unknown = new Error('xrpl_rpc_unreachable');
  for (const url of xrplHttpEndpoints(preferred)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        // 402 (gate a datacenter), 429, 5xx… — este servidor no nos habla.
        lastErr = new Error(`xrpl_http_${res.status}`);
        continue;
      }
      const body = (await res.json().catch(() => null)) as { result?: XrplRpcResult } | null;
      const result = body?.result;
      if (!result) {
        lastErr = new Error('xrpl_rpc_empty_result');
        continue;
      }
      if (result.status === 'error') {
        lastErr = new Error(result.error ?? result.error_message ?? 'xrpl_rpc_error');
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchXrplPayment(txHash: string, wssUrl: string): Promise<XrplPaymentFacts> {
  // api_version 1 devuelve los campos de la tx planos en `result`; la 2 los anida
  // en `tx_json` y deja meta/validated arriba. Se soportan ambas formas.
  const r = await xrplJsonRpc('tx', { transaction: txHash, binary: false }, wssUrl);
  const tx = (r.tx_json ?? r) as Record<string, unknown>;
  const meta = r.meta as { TransactionResult?: string } | undefined;
  if (!r.validated) throw new ExecutorAbort('la tx XRPL no está validada aún');
  if (meta?.TransactionResult !== 'tesSUCCESS') {
    throw new ExecutorAbort(`la tx XRPL no fue tesSUCCESS: ${meta?.TransactionResult}`);
  }
  const memos = (tx.Memos as Array<{ Memo: { MemoData?: string } }>) ?? [];
  if (memos.length !== 1 || !memos[0].Memo.MemoData) {
    throw new ExecutorAbort('la tx XRPL no lleva exactamente 1 memo');
  }
  const amount = tx.Amount ?? tx.DeliverMax;
  if (typeof amount !== 'string') throw new ExecutorAbort('Amount de la tx XRPL no es XRP en drops');
  return {
    account: tx.Account as string,
    destination: tx.Destination as string,
    grossDrops: BigInt(amount),
    memoHex: memos[0].Memo.MemoData as string,
    destinationTag: tx.DestinationTag as number | undefined,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reconstrucción determinista (fallback sin fila en el store)                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Shapes reconstruibles sin parámetros libres. e1 (borrow ratio contínuo),
 *  supply-usdt0 y pa-withdraw NO se pueden adivinar: esos exigen la fila del
 *  store o el override manual del CLI. */
const RECONSTRUCTIBLE_SHAPES = ['firelight', 'earnxrp', 'monarq', 'e3-kinetic'] as const;
type ReconstructibleShape = (typeof RECONSTRUCTIBLE_SHAPES)[number];

async function buildShapeInnerCalls(
  provider: ethers.Provider,
  shape: ReconstructibleShape,
  supplyUBA: bigint,
  personalAccount: string,
): Promise<EncodedAction[]> {
  // FXRP_TOKEN puede faltar en env de scripts — resolverlo en vivo para que
  // getProtocolAddresses() de los adapters lo encuentre. FIRELIGHT_STXRP idem
  // con la dirección mainnet conocida: si fuera incorrecta, el check
  // keccak256(userOpData) == hash del memo descarta el shape sin tocar nada.
  if (!process.env.FXRP_TOKEN) {
    process.env.FXRP_TOKEN = await resolveFxrpToken(provider);
  }
  if (shape === 'firelight') {
    if (!process.env.FIRELIGHT_STXRP) {
      process.env.FIRELIGHT_STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
    }
    const { FirelightAdapter } = await import('../../connectors/protocols/adapters/FirelightAdapter');
    return new FirelightAdapter().buildStakeBatch({ supplyUBA, receiver: personalAccount });
  }
  if (shape === 'e3-kinetic') {
    const { KineticAdapter } = await import('../../connectors/protocols/adapters/KineticAdapter');
    return new KineticAdapter().buildIsoSupplyFxrpBatch({ supplyUBA });
  }
  const { UpshiftVaultAdapter } = await import('../../connectors/protocols/adapters/UpshiftVaultAdapter');
  return new UpshiftVaultAdapter().buildDepositBatch({
    vaultKey: shape,
    supplyUBA,
    receiver: personalAccount,
  });
}

export interface ResolvedUserOp {
  userOpData: string;
  /** De dónde salieron los bytes: fila persistida, reconstrucción u override. */
  source: 'store' | `rebuilt:${string}` | 'override';
}

/**
 * Resuelve los bytes EXACTOS que el memo comprometió: primero el store
 * (cualquier flujo), después reconstrucción determinista shape a shape. Cada
 * candidato se valida contra keccak256 == hash del memo — es imposible
 * ejecutar otra cosa que lo firmado.
 */
export async function resolveUserOpData(
  provider: ethers.Provider,
  input: {
    memo: ParsedMemo;
    payment: XrplPaymentFacts;
    personalAccount: string;
    nonce: bigint;
    override?: string;
    supplyUbaOverride?: bigint;
    shapeHint?: string;
    log?: Log;
  },
): Promise<ResolvedUserOp> {
  const log = input.log ?? noopInline;
  if (input.override) {
    if (ethers.keccak256(input.override).toLowerCase() !== input.memo.userOpHash) {
      throw new ExecutorAbort('USER_OP_DATA (override) no coincide con el hash del memo');
    }
    return { userOpData: input.override, source: 'override' };
  }

  // 1. La fila persistida en el prepare — cubre TODOS los flujos.
  const stored = await findHandoffByUserOpHash(input.memo.userOpHash);
  if (stored?.userOpData) {
    if (ethers.keccak256(stored.userOpData).toLowerCase() === input.memo.userOpHash) {
      return { userOpData: stored.userOpData, source: 'store' };
    }
    log(`[0xFE-executor] fila del store corrupta para ${input.memo.userOpHash} — sigo con reconstrucción`);
  }

  // 2. Reconstrucción determinista. La fee de executor comprometida manda
  // (memo); minFee/feeBIPS se leen en vivo — si el protocolo los cambió desde
  // el prepare, ningún shape cuadrará y hace falta el override del CLI.
  const params = await readDirectMintParams(provider);
  const net = computeNetMint(input.payment.grossDrops, {
    minFeeUBA: params.minFeeUBA,
    feeBIPS: params.feeBIPS,
    executorFeeUBA: input.memo.executorFeeUBA,
    granularityUBA: params.granularityUBA,
  });
  const supplyUBA = input.supplyUbaOverride ?? net.supplyUBA;
  const shapes: ReconstructibleShape[] = input.shapeHint
    ? ([input.shapeHint as ReconstructibleShape, ...RECONSTRUCTIBLE_SHAPES.filter((s) => s !== input.shapeHint)] as ReconstructibleShape[])
    : [...RECONSTRUCTIBLE_SHAPES];
  for (const shape of shapes) {
    try {
      const innerCalls = await buildShapeInnerCalls(provider, shape, supplyUBA, input.personalAccount);
      const callData = await buildExecuteUserOpCallData(innerCalls);
      const rebuilt = await buildPackedUserOp({ sender: input.personalAccount, nonce: input.nonce, callData });
      if (rebuilt.userOpHash.toLowerCase() === input.memo.userOpHash) {
        return { userOpData: rebuilt.dataHex, source: `rebuilt:${shape}` };
      }
    } catch {
      /* shape sin configurar en este entorno — probar el siguiente */
    }
  }
  throw new ExecutorAbort(
    `ningún userOpData conocido casa con el memo ${input.memo.userOpHash} — ` +
      'sin fila en el store y la reconstrucción no cuadra (¿e1 antiguo, params cambiados, nonce avanzado?). ' +
      'Rescate manual: USER_OP_DATA=0x… npx ts-node src/scripts/execute-direct-mint.ts --live',
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Barrido del Core Vault (la fuente de verdad de qué está pendiente)         */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PendingRow {
  hash: string;
  opcode: string;
  account: string;
  drops: bigint;
  dateISO: string;
  tag?: number;
  used: boolean;
  /** Memo completo (hex) — permite casar el dispatch con su fila de handoff
   *  (userOpHash) y etiquetar la acción en el modal de desatasco. */
  memoHex: string;
}

/**
 * Barre los Payments entrantes al Core Vault con memo de instrucción Smart
 * Account y comprueba contra el MasterAccountController si cada uno se
 * ejecutó. Un 0xFE tesSUCCESS sin ejecutar = XRP de un usuario aparcado
 * esperando executor.
 */
export async function sweepInstructionPayments(opts: {
  provider: ethers.Provider;
  wssUrl?: string;
  onlyTag?: number | null;
  maxPages?: number;
}): Promise<{ coreVault: string; rows: PendingRow[] }> {
  const am = new ethers.Contract(await resolveAssetManagerFxrp(opts.provider), ASSET_MANAGER_ABI, opts.provider);
  const mac = new ethers.Contract(await resolveMasterAccountController(opts.provider), MAC_ABI, opts.provider);
  const coreVault: string = await am.directMintingPaymentAddress();

  const rows: PendingRow[] = [];
  let marker: unknown;
  const maxPages = opts.maxPages ?? 10;
  for (let page = 0; page < maxPages; page++) {
    // forward:false = de lo más reciente hacia atrás: los Payments que esperan
    // executor están en la primera página.
    const params: Record<string, unknown> = {
      account: coreVault,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
      forward: false,
    };
    if (marker !== undefined) params.marker = marker;
    const result = await xrplJsonRpc('account_tx', params, opts.wssUrl);
    const transactions =
      (result.transactions as Array<{
        hash?: string;
        meta?: { TransactionResult?: string };
        tx_json?: Record<string, unknown>;
        tx?: Record<string, unknown>;
      }>) ?? [];
    for (const entry of transactions) {
      const tx = entry.tx_json ?? entry.tx;
      if (!tx || tx.TransactionType !== 'Payment' || tx.Destination !== coreVault) continue;
      if (entry.meta?.TransactionResult !== 'tesSUCCESS') continue;
      const memoHex = (((tx.Memos as Array<{ Memo: { MemoData?: string } }>) ?? [])[0]?.Memo?.MemoData || '').toUpperCase();
      if (!memoHex) continue;
      const opcode = memoHex.slice(0, 2);
      // Instrucciones Smart Account que esperan ejecución vía executor
      if (!['FE', 'FF', 'E0', 'E1', 'E2', 'D0', 'D1'].includes(opcode)) continue;
      const tag = tx.SourceTag as number | undefined;
      if (opts.onlyTag != null && tag !== opts.onlyTag) continue;
      const amount = (tx.Amount ?? tx.DeliverMax) as string;
      rows.push({
        hash: (entry.hash ?? (tx.hash as string)) as string,
        opcode,
        account: tx.Account as string,
        drops: BigInt(typeof amount === 'string' ? amount : '0'),
        dateISO: new Date(((tx.date as number) + 946684800) * 1000).toISOString(),
        tag,
        used: false,
        memoHex,
      });
    }
    marker = result.marker;
    if (!marker) break;
  }
  for (const r of rows) {
    r.used = await mac.isTransactionIdUsed('0x' + r.hash.toLowerCase());
  }
  return { coreVault, rows };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ejecución de UN mint (attestation FDC → proof → simulación → ejecución)    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ExecuteOutcome {
  stage: 'dry-run-ok' | 'executed' | 'delayed';
  xrplTxHash: string;
  userOpHash: string;
  userOpSource: ResolvedUserOp['source'];
  personalAccount: string;
  executor: string;
  requestFeeFLR: string;
  flareTxHash?: string;
  /** unix s a partir del cual un mint diferido por el AssetManager es ejecutable. */
  executionAllowedAt?: number;
}

export interface ExecuteInput {
  provider: ethers.JsonRpcProvider;
  /** null = dry-run: verifica todo, no firma nada. */
  wallet: ethers.Wallet | null;
  /** Dirección a la que ligar el proof en dry-run (en live sale de la wallet). */
  executorAddr?: string;
  txHash: string;
  wssUrl?: string;
  verifierBase?: string;
  verifierKey?: string;
  daLayerBase?: string;
  userOpDataOverride?: string;
  supplyUbaOverride?: bigint;
  shapeHint?: string;
  log?: Log;
}

/**
 * Veredicto barato de ejecutabilidad: compara sender/nonce de los bytes firmados
 * con el estado on-chain. Lanza ExecutorAbort permanent si NUNCA podrán ejecutar
 * (el MAC revertiría InvalidSender / InvalidNonce con nonce consumido), y un
 * abort reintentable si el userOp está en cola detrás de otro nonce. Puro salvo
 * el log — unit-testeable.
 */
export function assertUserOpExecutable(
  op: { sender: string; nonce: bigint },
  personalAccount: string,
  currentNonce: bigint,
  log: Log = noopInline,
): void {
  if (op.sender.toLowerCase() !== personalAccount.toLowerCase()) {
    throw new ExecutorAbort(
      `los bytes firmados llevan sender ${op.sender} pero el PA del pagador es ${personalAccount} — ` +
        'el MAC revertiría InvalidSender SIEMPRE (bytes preparados para otra cuenta). ' +
        'Inejecutable: no se paga attestation. Revisar el prepare que generó estos bytes.',
      { permanent: true },
    );
  }
  if (op.nonce < currentNonce) {
    throw new ExecutorAbort(
      `los bytes firmados llevan nonce ${op.nonce} y el PA ya va por ${currentNonce} — ` +
        'el MAC revertiría InvalidNonce SIEMPRE (nonce consumido por otra operación). ' +
        'Inejecutable: no se paga attestation.',
      { permanent: true },
    );
  }
  if (op.nonce > currentNonce) {
    throw new ExecutorAbort(
      `los bytes firmados llevan nonce ${op.nonce} > nonce actual ${currentNonce} del PA — ` +
        'en cola detrás de otra operación pendiente; se reintentará sin pagar attestation.',
    );
  }
  log(`    ejecutabilidad ✓ (sender == PA, nonce ${op.nonce} == nonce on-chain)`);
}

export async function executeDirectMint(input: ExecuteInput): Promise<ExecuteOutcome> {
  const log = input.log ?? noopInline;
  const provider = input.provider;
  const txHash = input.txHash.toUpperCase();
  const wssUrl = input.wssUrl ?? DEFAULTS.wssUrl;
  const verifierBase = (input.verifierBase ?? DEFAULTS.verifierBase).replace(/\/$/, '');
  const verifierKey = input.verifierKey ?? DEFAULTS.verifierKey;
  const daLayerBase = (input.daLayerBase ?? DEFAULTS.daLayerBase).replace(/\/$/, '');
  const live = input.wallet != null;
  const executorAddr = ethers.getAddress(
    (input.wallet?.address ?? input.executorAddr ?? '').toLowerCase(),
  );

  // ── 1. XRPL: leer el Payment real ────────────────────────────────────────
  const payment = await fetchXrplPayment(txHash, wssUrl);
  const memo = parseMemo0xFE(payment.memoHex);
  log(`[1] XRPL Payment: ${Number(payment.grossDrops) / DROPS} XRP de ${payment.account}`);
  log(`    memo: walletId=${memo.walletId} executorFee=${Number(memo.executorFeeUBA) / DROPS} XRP`);
  log(`    userOpHash comprometido: ${memo.userOpHash}`);
  if (payment.destinationTag !== undefined) {
    throw new ExecutorAbort('el Payment lleva DestinationTag — no es un direct mint 0xFE válido');
  }

  const am = new ethers.Contract(await resolveAssetManagerFxrp(provider), ASSET_MANAGER_ABI, provider);
  const coreVault: string = await am.directMintingPaymentAddress();
  if (payment.destination !== coreVault) {
    throw new ExecutorAbort(`Destination ${payment.destination} ≠ Core Vault actual ${coreVault}`);
  }

  // ── 2. PA + nonce ─────────────────────────────────────────────────────────
  const personalAccount = await resolvePersonalAccount(provider, payment.account);
  const nonce = await getNonce(provider, personalAccount);
  log(`[2] Personal Account: ${personalAccount} (nonce ${nonce})`);

  // ── 3. userOpData: store → reconstrucción → override ─────────────────────
  const resolved = await resolveUserOpData(provider, {
    memo,
    payment,
    personalAccount,
    nonce,
    override: input.userOpDataOverride,
    supplyUbaOverride: input.supplyUbaOverride,
    shapeHint: input.shapeHint,
    log,
  });
  const userOpData = resolved.userOpData;
  log(`[3] userOpData resuelto (${resolved.source}) — keccak256 == hash del memo ✓`);

  // msg.value que el executor debe adjuntar = Σ call.value del batch (aquí 0).
  const decodedOp = ethers.AbiCoder.defaultAbiCoder().decode(
    ['tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)'],
    userOpData,
  )[0];
  const paIface = new ethers.Interface([
    'function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable',
  ]);
  const innerDecoded = paIface.decodeFunctionData('executeUserOp', decodedOp.callData)[0] as Array<{ value: bigint }>;
  const totalCallValue = innerDecoded.reduce((a: bigint, c) => a + BigInt(c.value), 0n);

  // ── 3b. Ejecutabilidad de los bytes ANTES de tocar el FDC ────────────────
  // sender y nonce viven DENTRO de los bytes comprometidos: si no casan con el
  // estado on-chain, la FIRMA 2 revertiría (InvalidSender/InvalidNonce) SIEMPRE
  // — se comprueba aquí, con lecturas gratis, no tras pagar 20 FLR por saberlo.
  assertUserOpExecutable({ sender: decodedOp.sender, nonce: BigInt(decodedOp.nonce) }, personalAccount, nonce, log);

  // ── 4. Preflight on-chain ─────────────────────────────────────────────────
  const mac = new ethers.Contract(await resolveMasterAccountController(provider), MAC_ABI, provider);
  const txId = '0x' + txHash.toLowerCase();
  const [used, pinnedExecutor] = await Promise.all([
    mac.isTransactionIdUsed(txId),
    mac.getExecutor(personalAccount).catch(() => ethers.ZeroAddress),
  ]);
  if (used) throw new ExecutorAbort('el MasterAccountController ya usó este transactionId — el mint ya se ejecutó');
  if (pinnedExecutor !== ethers.ZeroAddress && pinnedExecutor.toLowerCase() !== executorAddr.toLowerCase()) {
    throw new ExecutorAbort(`el PA tiene executor pineado ${pinnedExecutor} ≠ ${executorAddr} (revertiría WrongExecutor)`);
  }
  log(`[4] Preflight: txId sin usar ✓ · executor pineado: ${pinnedExecutor === ethers.ZeroAddress ? 'ninguno ✓' : pinnedExecutor}`);

  // ── 5. FDC: preparar la attestation XRPPayment (proof ligado al executor) ──
  const toHex32 = (s: string) => '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
  const prepResp = await fetch(`${verifierBase}/verifier/xrp/XRPPayment/prepareRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': verifierKey },
    body: JSON.stringify({
      attestationType: toHex32('XRPPayment'),
      sourceId: toHex32('XRP'),
      requestBody: { transactionId: txId, proofOwner: executorAddr },
    }),
  });
  const prep = (await prepResp.json()) as { status?: string; abiEncodedRequest?: string };
  if (prepResp.status !== 200 || !prep.abiEncodedRequest || (prep.status && prep.status !== 'VALID' && !prep.status.startsWith('OK'))) {
    throw new ExecutorAbort(`verifier prepareRequest falló (${prepResp.status}): ${JSON.stringify(prep)}`);
  }
  const abiEncodedRequest = prep.abiEncodedRequest;
  log(`[5] FDC prepareRequest ✓ (proofOwner=${executorAddr})`);

  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  const fdcHub = new ethers.Contract(await registry.getContractAddressByName('FdcHub'), FDC_HUB_ABI, provider);
  const feeConfig = new ethers.Contract(await fdcHub.fdcRequestFeeConfigurations(), FDC_FEE_ABI, provider);
  const requestFee: bigint = await feeConfig.getRequestFee(abiEncodedRequest);
  log(`    fee de attestation: ${ethers.formatEther(requestFee)} FLR`);

  // Attestation ya pagada en un intento anterior de ESTA tx: se reutiliza la
  // ronda (el proof del DA layer se recoge gratis) — jamás se re-paga la fee.
  const attKey = `${txHash}|${executorAddr.toLowerCase()}`;
  let prior = paidAttestations.get(attKey);
  if (!prior) {
    // Miss en RAM (p.ej. tras un redeploy) → mirar el store persistido: una
    // attestation ya pagada NUNCA se paga dos veces por el mismo carril.
    const persisted = await find0xFeAttestation(attKey);
    if (persisted) {
      prior = persisted;
      paidAttestations.set(attKey, persisted);
    }
  }
  const reusable = prior && prior.abiEncodedRequest === abiEncodedRequest ? prior : undefined;

  // ── 5b. Fondos del executor, contra la fee REAL ──────────────────────────
  // El coste dominante NO es el gas de las dos txs: es la fee de attestation
  // del FDC, que solo se conoce leyéndola (getRequestFee, arriba — hoy ~20 FLR).
  // Por eso se compara contra esa fee y no contra una constante a ojo, y se
  // aborta ANTES de firmar: un executor corto reventaría la FIRMA 1 por fondos
  // insuficientes, con un error críptico y la mitad del carril a medias.
  // Con attestation reutilizada solo hace falta el margen de gas.
  const gasMargin = ethers.parseEther(process.env.FLARE_EXECUTOR_GAS_MARGIN_FLR || '2');
  const balance = await provider.getBalance(executorAddr);
  const funded = balance >= (reusable ? gasMargin : requestFee + gasMargin);
  const shortfall =
    `saldo del executor ${executorAddr} = ${ethers.formatEther(balance)} FLR < ` +
    (reusable
      ? `margen de gas ${ethers.formatEther(gasMargin)} FLR (attestation ya pagada)`
      : `fee FDC ${ethers.formatEther(requestFee)} + margen de gas ${ethers.formatEther(gasMargin)} FLR`);

  const base: Omit<ExecuteOutcome, 'stage'> = {
    xrplTxHash: txHash,
    userOpHash: memo.userOpHash,
    userOpSource: resolved.source,
    personalAccount,
    executor: executorAddr,
    requestFeeFLR: reusable ? '0.0' : ethers.formatEther(requestFee),
  };
  if (!live) {
    log(
      funded
        ? `    saldo del executor: ${ethers.formatEther(balance)} FLR ✓ (cubre fee + gas)`
        : `⚠ ${shortfall} — en --live esto abortaría aquí, antes de firmar`,
    );
    return { ...base, stage: 'dry-run-ok' };
  }
  if (!funded) {
    throw new ExecutorAbort(`${shortfall}. Recarga el executor — no se ha firmado ni gastado nada.`);
  }

  // ── 6. LIVE — FIRMA 1: requestAttestation en el FDC Hub (una vez por tx) ──
  let roundId: number;
  if (reusable) {
    roundId = reusable.roundId;
    log(`[6] Attestation ya pagada en un intento anterior → ronda ${roundId} — se reutiliza SIN pagar fee`);
  } else {
    // Freno de mano global (incidente 2026-07-18): la fee solo se firma si cabe
    // en el presupuesto diario — lanza FeeBudgetExceeded sin firmar nada. Este
    // carril (0xFE) CEDE la reserva de Legacy: una fuga aquí no puede dejar al
    // consejo sin combustible para relayar sus órdenes (suelo intocable).
    assertDailyFeeBudget(requestFee, Date.now(), legacyFeeReserveWei());
    log('[6] Enviando requestAttestation (FIRMA 1)…');
    const hubTx = await (fdcHub.connect(input.wallet!) as ethers.Contract).requestAttestation(abiEncodedRequest, {
      value: requestFee,
    });
    const hubReceipt = await hubTx.wait();
    recordFeeSpend(requestFee);
    const block = await provider.getBlock(hubReceipt!.blockNumber);
    const fsm = new ethers.Contract(await registry.getContractAddressByName('FlareSystemsManager'), FSM_ABI, provider);
    const [firstTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
    roundId = Number((BigInt(block!.timestamp) - BigInt(firstTs)) / BigInt(epochSec));
    // La fee ya está pagada: recordarla ANTES de esperar la ronda, para que
    // cualquier fallo posterior (finalización lenta, DA, simulación) reutilice.
    paidAttestations.set(attKey, { abiEncodedRequest, roundId, passesWithoutProof: 0 });
    await save0xFeAttestation(attKey, { abiEncodedRequest, roundId, passesWithoutProof: 0 }); // persistir: sobrevive a un redeploy
    log(`    attestation enviada (tx ${hubTx.hash}) → voting round ${roundId}`);
  }

  // ── 7. Esperar finalización de la ronda y recoger el proof del DA layer ───
  const relay = new ethers.Contract(await registry.getContractAddressByName('Relay'), RELAY_ABI, provider);
  const fdcVerification = new ethers.Contract(
    await registry.getContractAddressByName('FdcVerification'),
    FDC_VERIFICATION_ABI,
    provider,
  );
  const protocolId: bigint = await fdcVerification.fdcProtocolId();
  log('[7] Esperando finalización de la ronda FDC (~2-5 min)…');
  let finalized = false;
  for (let i = 0; i < 60; i++) {
    if (await relay.isFinalized(protocolId, BigInt(roundId))) {
      finalized = true;
      break;
    }
    await sleep(15_000);
  }
  if (!finalized) throw new ExecutorAbort('la ronda FDC no finalizó en ~15 min — reintenta más tarde');
  log('    ronda finalizada ✓');

  let responseHex: string | null = null;
  let merkleProof: string[] = [];
  for (let i = 0; i < 20; i++) {
    const daResp = await fetch(`${daLayerBase}/api/v1/fdc/proof-by-request-round-raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
    });
    const da = (await daResp.json().catch(() => ({}))) as { response_hex?: string; proof?: string[] };
    if (da.response_hex) {
      responseHex = da.response_hex;
      merkleProof = da.proof ?? [];
      break;
    }
    await sleep(10_000);
  }
  if (!responseHex) {
    // Un proof del FDC, una vez CONSTRUIDO, el DA layer lo sirve PARA SIEMPRE
    // (los 14 días son el límite para PEDIRLO, no de retención). Una ronda
    // finalizada SIN proof no es un proof caducado: o es un parpadeo transitorio
    // del DA layer (reintentar — el proof está ahí), o el request NUNCA se
    // confirmó (fee corta / peso insuficiente → fee QUEMADA, no habrá proof).
    // `passesWithoutProof` tolera 2 pasadas para descartar el parpadeo; a la 2ª
    // se concluye "nunca confirmado" y — porque es dinero quemado, la versión
    // lenta del incidente 0xFE — se AVISA y se re-paga. El contador se PERSISTE
    // para que la tolerancia no se resetee a 0 en cada redeploy.
    if (reusable) {
      reusable.passesWithoutProof++;
      if (reusable.passesWithoutProof >= 2) {
        paidAttestations.delete(attKey);
        await delete0xFeAttestation(attKey);
        await executorAlert(
          'warn',
          `attestation de la tx ${txHash} sin proof en la ronda ${roundId} tras 2 pasadas: el request NUNCA se confirmó ` +
            `(fee corta / peso insuficiente) → la fee FDC se QUEMÓ. El próximo intento re-paga. Revisar el fee de attestation.`,
        );
        throw new ExecutorAbort(
          `el request de la ronda ${roundId} nunca se confirmó (fee quemada) — caché descartada, el próximo intento pagará attestation nueva`,
        );
      }
      await save0xFeAttestation(attKey, { abiEncodedRequest, roundId, passesWithoutProof: reusable.passesWithoutProof });
    }
    throw new ExecutorAbort('el DA layer no devolvió el proof tras 20 intentos');
  }
  log(`    proof obtenido (${merkleProof.length} nodos merkle)`);

  const resp = ethers.AbiCoder.defaultAbiCoder().decode([XRP_PAYMENT_RESPONSE_TUPLE], responseHex)[0];
  const rb = resp.responseBody;
  // Sanidad del proof antes de gastar gas: mismo pago, mismo memo, éxito.
  if (resp.requestBody.transactionId.toLowerCase() !== txId) throw new ExecutorAbort('el proof no es de esta tx');
  if (Number(rb.status) !== 0) throw new ExecutorAbort(`status del pago en el proof = ${rb.status} (≠ SUCCESS)`);
  if (!rb.hasMemoData || rb.firstMemoData.replace(/^0x/i, '').toUpperCase() !== memo.raw) {
    throw new ExecutorAbort('el memo del proof no coincide con el memo del Payment');
  }
  if (BigInt(rb.receivedAmount) !== payment.grossDrops) {
    throw new ExecutorAbort(`receivedAmount del proof ${rb.receivedAmount} ≠ ${payment.grossDrops} drops`);
  }
  log('    ✓ proof coherente (txId, memo, importe, status SUCCESS)');

  const proofStruct = {
    merkleProof,
    data: {
      attestationType: resp.attestationType,
      sourceId: resp.sourceId,
      votingRound: resp.votingRound,
      lowestUsedTimestamp: resp.lowestUsedTimestamp,
      requestBody: {
        transactionId: resp.requestBody.transactionId,
        proofOwner: resp.requestBody.proofOwner,
      },
      responseBody: {
        blockNumber: rb.blockNumber,
        blockTimestamp: rb.blockTimestamp,
        sourceAddress: rb.sourceAddress,
        sourceAddressHash: rb.sourceAddressHash,
        receivingAddressHash: rb.receivingAddressHash,
        intendedReceivingAddressHash: rb.intendedReceivingAddressHash,
        spentAmount: rb.spentAmount,
        intendedSpentAmount: rb.intendedSpentAmount,
        receivedAmount: rb.receivedAmount,
        intendedReceivedAmount: rb.intendedReceivedAmount,
        hasMemoData: rb.hasMemoData,
        firstMemoData: rb.firstMemoData,
        hasDestinationTag: rb.hasDestinationTag,
        destinationTag: rb.destinationTag,
        status: rb.status,
      },
    },
  };

  // ── 8. Simulación antes de firma (#11), luego FIRMA 2: ejecutar ──────────
  const amSigner = am.connect(input.wallet!) as ethers.Contract;
  const attemptExecute = async (depth: number): Promise<ethers.TransactionReceipt> => {
    try {
      await amSigner.executeDirectMintingWithData.staticCall(proofStruct, userOpData, { value: totalCallValue });
    } catch (err) {
      const reason = describeRevert(err);
      const delayed = reason.match(/DirectMintingStillDelayed\((\d+)\)/);
      if (delayed && depth < 10) {
        const allowedAt = Number(delayed[1]);
        const waitS = Math.max(allowedAt - Math.floor(Date.now() / 1000) + 5, 5);
        log(`    mint con delay hasta ${new Date(allowedAt * 1000).toISOString()} — esperando ${waitS}s…`);
        await sleep(waitS * 1000);
        return attemptExecute(depth + 1);
      }
      throw new ExecutorAbort(`la simulación revierte — NO se envía nada. Motivo: ${reason}`);
    }
    log('    simulación OK → enviando executeDirectMintingWithData (FIRMA 2)…');
    const tx = await amSigner.executeDirectMintingWithData(proofStruct, userOpData, { value: totalCallValue });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new ExecutorAbort(`la ejecución revirtió on-chain (tx ${tx.hash})`);
    return receipt;
  };
  log('[8] Simulando executeDirectMintingWithData…');
  const receipt = await attemptExecute(0);
  log(`    ✓ ejecutado — Flare tx ${receipt.hash} (gas ${receipt.gasUsed})`);

  // Si el AssetManager difirió el mint (rate limit), se reintenta con el MISMO
  // proof pasado executionAllowedAt (el watcher lo re-barre; el CLI avisa).
  const delayedEv = receipt.logs
    .map((l) => { try { return am.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'DirectMintingDelayed');
  if (delayedEv) {
    const allowedAt = Number(delayedEv.args.executionAllowedAt);
    log(`⚠ DirectMintingDelayed: ejecutable a partir de ${new Date(allowedAt * 1000).toISOString()}`);
    return { ...base, stage: 'delayed', flareTxHash: receipt.hash, executionAllowedAt: allowedAt };
  }

  const uoe = receipt.logs
    .map((l) => { try { return mac.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'UserOperationExecuted');
  log(`    UserOperationExecuted: ${uoe ? `PA ${uoe.args.personalAccount}, nonce ${uoe.args.nonce} ✓` : 'no encontrado en logs ⚠ — revisar receipt'}`);

  // Auditoría interna (el proof on-chain es el ExecutionReceipt real).
  await markHandoffExecuted(memo.userOpHash, {
    xrplTxHash: txHash,
    flareTxHash: receipt.hash,
    executor: executorAddr,
  });

  paidAttestations.delete(attKey); // consumida — un futuro pago idéntico es imposible (txId usado)
  await delete0xFeAttestation(attKey); // y el registro persistido: ya no hay nada que reutilizar
  return { ...base, stage: 'executed', flareTxHash: receipt.hash };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Watcher — el executor automático del backend                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Bucle del executor: barre el Core Vault, y por cada 0xFE tesSUCCESS sin
 * ejecutar resuelve sus bytes (store → reconstrucción) y lo ejecuta. Corre en
 * el proceso del backend tras DOBLE flag: FLARE_EXECUTOR_ENABLED=true y
 * FLARE_EXECUTOR_PK presente. Sin solape (una pasada a la vez), con backoff
 * por tx fallida para no quemar gas reintentando en caliente.
 */
export interface ExecutorHealth {
  enabled: boolean;
  hasKey: boolean;
  refuelEnabled: boolean;
  sweepArmed: boolean;
  alertWebhookConfigured: boolean;
  executor: string | null;
  flrBalance: string | null;
  fxrpBalance: string | null;
  lastTickAt: string | null;
  lastTickError: string | null;
  pendingCount: number;
  oldestPendingISO: string | null;
  failingTxCount: number;
  lastRefuel: { stage: string; detail: string; swapTxHash?: string } | null;
  lastSweep: { amountFXRP: string; txHash: string; to: string } | null;
  /** 0xFE aparcados: inejecutables (permanent), tope de fallos o skip-list. */
  parked: Array<{ hash: string; reason: string }>;
  /** Freno de mano global de fees FDC (ventana 24h compartida con el relayer del consejo). */
  dailyFeeBudget: { spentFLR: string; budgetFLR: number; windowStartedAt: string | null };
  /** Tramo 1 — defensas 0xFE que caben HOY: por presupuesto, por saldo, y el
   *  mínimo de ambos (el número real). El operador y un juez ven el techo. */
  defensesCoveredToday: { byBudget: number; byWallet: number | null; effective: number };
  /** Tramo 1 — guardián FTSO del margen de la fee (null si el tick aún no leyó). */
  feeMargin: FeeMarginGauge | null;
}

/** Dirección de un dispatch para el modal de desatasco: hacia dónde viaja el
 *  capital. 'entrante' = deposita en Flare DeFi; 'saliente' = retira/libera
 *  hacia el usuario; 'otra' = movimiento interno (repay de deuda, rotación). */
export type StuckDirection = 'entrante' | 'saliente' | 'otra' | 'desconocida';

export function directionForAction(action: string | null | undefined): StuckDirection {
  if (!action) return 'desconocida';
  const a = action.toLowerCase();
  if (a.startsWith('vault-withdraw') || a.startsWith('vault-claim') || a.startsWith('pa-withdraw-transfer')) {
    return 'saliente';
  }
  if (a === 'e1' || a === 'e3' || a.startsWith('vault:') || a === 'supply-usdt0' || a.startsWith('bridge')) {
    return 'entrante';
  }
  if (a === 'pa-repay' || a.startsWith('vault-rotate')) return 'otra';
  return 'desconocida';
}

export interface StuckTx {
  hash: string;
  account: string | null;
  xrp: number | null;
  dateISO: string | null;
  action: string | null;
  direction: StuckDirection;
  /** solo pendientes */
  failures?: number;
  nextAttemptISO?: string | null;
  /** solo aparcados */
  reason?: string;
  source?: string | null;
  parkedAt?: string | null;
}

export interface StuckSnapshot {
  pending: StuckTx[];
  parked: StuckTx[];
  watcher: { enabled: boolean; hasKey: boolean; running: boolean; lastTickAt: string | null };
}

export class DirectMintExecutorWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  /** backoff por tx: unix ms a partir del cual se reintenta. */
  private nextAttemptAt = new Map<string, number>();
  private failures = new Map<string, number>();
  /** 0xFE colgados ya alertados al operador (una alerta por tx, no spam). */
  private stuckAlerted = new Set<string>();
  /**
   * 0xFE aparcados (hash → motivo): bytes inejecutables (ExecutorAbort
   * permanent) o tope de fallos. No se reintentan ni pagan NADA más; salen en
   * /executor-health y en la alerta de aparcamiento. Rescate = manual (CLI con
   * override) o re-prepare + nueva firma del usuario.
   */
  private parked = new Map<string, string>();
  private lastGauges: FuelGauges | null = null;
  private lastTickAt: Date | null = null;
  private lastTickError: string | null = null;
  private lastPending: PendingRow[] = [];

  /** Snapshot para /flare-demo/executor-health — el operador nunca a oscuras. */
  health(): ExecutorHealth {
    const g = this.lastGauges;
    const oldest = this.lastPending.reduce<string | null>(
      (min, r) => (min == null || r.dateISO < min ? r.dateISO : min),
      null,
    );
    return {
      enabled: process.env.FLARE_EXECUTOR_ENABLED === 'true',
      hasKey: !!process.env.FLARE_EXECUTOR_PK,
      refuelEnabled: process.env.FLARE_EXECUTOR_REFUEL_ENABLED === 'true',
      sweepArmed: !!process.env.FLARE_EXECUTOR_SWEEP_TO,
      // Ambos nombres arman el webhook (OpsAlertService.ts:19 — OPS_ALERT_WEBHOOK_URL
      // primario, EXECUTOR_ALERT_WEBHOOK_URL alias); el gauge debe decir la verdad
      // con cualquiera de los dos.
      alertWebhookConfigured: !!(process.env.OPS_ALERT_WEBHOOK_URL || process.env.EXECUTOR_ALERT_WEBHOOK_URL),
      executor: g?.executor ?? null,
      flrBalance: g ? ethers.formatEther(g.flrWei) : null,
      fxrpBalance: g ? ethers.formatUnits(g.fxrpUBA, 6) : null,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      lastTickError: this.lastTickError,
      pendingCount: this.lastPending.length,
      oldestPendingISO: oldest,
      failingTxCount: this.failures.size,
      lastRefuel: g?.refuel
        ? { stage: g.refuel.stage, detail: g.refuel.detail, swapTxHash: g.refuel.swapTxHash }
        : null,
      lastSweep: g?.sweep
        ? { amountFXRP: ethers.formatUnits(g.sweep.amountUBA, 6), txHash: g.sweep.txHash, to: g.sweep.to }
        : null,
      parked: [...this.parked].map(([hash, reason]) => ({ hash, reason })),
      dailyFeeBudget: feeBudgetStatus(),
      defensesCoveredToday: (() => {
        const perDefenseWei = estimatedMintFeeWei();
        const byBudget = Number(remainingFeeBudgetWei() / perDefenseWei);
        const byWallet = g ? Number(g.flrWei / perDefenseWei) : null;
        return { byBudget, byWallet, effective: byWallet == null ? byBudget : Math.min(byBudget, byWallet) };
      })(),
      feeMargin: g?.feeMargin ?? null,
    };
  }

  /** Carga los aparcados persistidos ('0xfe-parked') en memoria — una vez.
   *  Sin esto un redeploy vaciaría la lista y los aparcados por tope de
   *  fallos volverían a reintentar desde cero (hueco #2 del recon 26-jul). */
  private parkedHydrated = false;
  private async hydrateParked(): Promise<void> {
    if (this.parkedHydrated) return;
    this.parkedHydrated = true;
    const rows = await listParked0xFe();
    for (const r of rows) {
      if (!this.parked.has(r.hash)) this.parked.set(r.hash, r.reason);
    }
    if (rows.length > 0) console.log(`[0xFE-executor] ${rows.length} aparcado(s) rehidratado(s) del store`);
  }

  /** Aparca CON persistencia — la memoria decide el tick, la fila cuenta la verdad tras un redeploy. */
  private async parkTx(
    hash: string,
    reason: string,
    source: 'permanent' | 'failures' | 'operator',
    row?: PendingRow,
  ): Promise<void> {
    this.parked.set(hash, reason);
    this.failures.delete(hash);
    this.nextAttemptAt.delete(hash);
    await saveParked0xFe({
      hash,
      reason,
      source,
      parkedAt: new Date().toISOString(),
      account: row?.account ?? null,
      drops: row?.drops != null ? row.drops.toString() : null,
      dateISO: row?.dateISO ?? null,
      memoHex: row?.memoHex ?? null,
    });
  }

  /**
   * Radiografía para el modal de desatasco de /app/admin: pendientes (con sus
   * contadores de reintento/backoff) + aparcados (con su motivo), etiquetados
   * con la acción del prepare que construyó cada dispatch (fila de handoff) y
   * su dirección entrante/saliente. Read-only y sin RPC: todo sale del último
   * barrido, de la memoria del watcher y del store.
   */
  async listStuck(): Promise<StuckSnapshot> {
    await this.hydrateParked();
    const persisted = new Map((await listParked0xFe()).map((r) => [r.hash.toUpperCase(), r]));
    const resolveAction = async (memoHex: string | null | undefined): Promise<string | null> => {
      if (!memoHex) return null;
      try {
        const memo = parseMemo0xFE(memoHex);
        return (await findHandoffByUserOpHash(memo.userOpHash))?.action ?? null;
      } catch {
        return null;
      }
    };
    const pending: StuckTx[] = await Promise.all(
      this.lastPending.map(async (r) => {
        const action = await resolveAction(r.memoHex);
        const next = this.nextAttemptAt.get(r.hash);
        return {
          hash: r.hash,
          account: r.account,
          xrp: Number(r.drops) / DROPS,
          dateISO: r.dateISO,
          action,
          direction: directionForAction(action),
          failures: this.failures.get(r.hash) ?? 0,
          nextAttemptISO: next != null && next > Date.now() ? new Date(next).toISOString() : null,
        };
      }),
    );
    const parked: StuckTx[] = await Promise.all(
      [...this.parked].map(async ([hash, reason]) => {
        const p = persisted.get(hash.toUpperCase());
        const action = await resolveAction(p?.memoHex);
        return {
          hash,
          account: p?.account ?? null,
          xrp: p?.drops != null ? Number(p.drops) / DROPS : null,
          dateISO: p?.dateISO ?? null,
          action,
          direction: directionForAction(action),
          reason,
          source: p?.source ?? (reason.includes('skip-list') ? 'skip-list' : null),
          parkedAt: p?.parkedAt ?? null,
        };
      }),
    );
    return {
      pending,
      parked,
      watcher: {
        enabled: process.env.FLARE_EXECUTOR_ENABLED === 'true',
        hasKey: !!process.env.FLARE_EXECUTOR_PK,
        running: this.running,
        lastTickAt: this.lastTickAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Desatasco desde /app/admin — la ÚNICA escritura del operador sobre el
   * watcher. 'retry' = des-aparca, borra contadores/backoff y, si el watcher
   * está libre, lanza un barrido inmediato. 'park' = aparca a mano (cero
   * reintentos, cero coste). Jamás firma nada: esto solo toca estado de
   * reintento — lo ejecutable sigue siendo exactamente el Payment que el
   * usuario firmó (invariantes #1/#8).
   */
  async unstick(
    hashRaw: string,
    op: 'retry' | 'park',
    reason?: string,
  ): Promise<{ ok: boolean; op: string; hash: string; detail: string; kicked: boolean; envSkipListed: boolean }> {
    await this.hydrateParked();
    const target = hashRaw.toUpperCase();
    const known = [...this.parked.keys(), ...this.lastPending.map((r) => r.hash)].find(
      (k) => k.toUpperCase() === target,
    );
    const hash = known ?? target;

    if (op === 'park') {
      const row = this.lastPending.find((r) => r.hash.toUpperCase() === target);
      await this.parkTx(hash, reason?.trim() || 'aparcado por el operador (/app/admin)', 'operator', row);
      return {
        ok: true,
        op,
        hash,
        detail: 'aparcado — sin reintentos ni coste hasta que se le dé a Reintentar',
        kicked: false,
        envSkipListed: false,
      };
    }

    this.parked.delete(hash);
    this.failures.delete(hash);
    this.nextAttemptAt.delete(hash);
    this.stuckAlerted.delete(hash);
    await deleteParked0xFe(hash);
    const envSkipListed = (process.env.FLARE_EXECUTOR_SKIP_TXS || '').toUpperCase().includes(target);
    const kicked = envSkipListed ? false : this.kickSweep();
    const detail = envSkipListed
      ? 'des-aparcado, PERO sigue en FLARE_EXECUTOR_SKIP_TXS (Railway) — el próximo barrido lo re-aparca; quítalo del env para reintentarlo de verdad'
      : kicked
        ? 'des-aparcado — barrido inmediato lanzado'
        : this.stopped || !process.env.FLARE_EXECUTOR_PK
          ? 'des-aparcado — el watcher está APAGADO; se reintentará cuando el executor arranque'
          : 'des-aparcado — hay un barrido en curso; se reintentará al terminar (un barrido puede durar minutos si espera una ronda FDC)';
    return { ok: true, op, hash, detail, kicked, envSkipListed };
  }

  /**
   * Barrido inmediato si el watcher está libre. false si ya hay un tick
   * corriendo (se solaparía — un barrido puede durar minutos esperando la
   * ronda FDC y dos a la vez podrían pagar gas dos veces), si está parado o
   * si no hay clave.
   */
  kickSweep(): boolean {
    if (this.running || this.stopped || !process.env.FLARE_EXECUTOR_PK) return false;
    this.running = true;
    void (async () => {
      try {
        await this.tick();
        this.lastTickError = null;
      } catch (e) {
        this.lastTickError = (e as Error).message;
        console.error(`[0xFE-executor] kick-sweep failed: ${(e as Error).message}`);
      } finally {
        this.lastTickAt = new Date();
        this.running = false;
      }
    })();
    return true;
  }

  start(): void {
    if (this.timer || this.running) return;
    this.stopped = false;
    void this.hydrateParked();
    const intervalMs = Math.max(Number(process.env.FLARE_EXECUTOR_INTERVAL_MS || 60_000), 15_000);
    const loop = async () => {
      if (this.stopped) return;
      // Un kick-sweep del modal de desatasco puede estar corriendo: no solapar
      // (dos ticks a la vez ejecutarían los mismos pendientes) — reprogramar.
      if (this.running) {
        this.timer = setTimeout(loop, intervalMs);
        return;
      }
      this.running = true;
      try {
        await this.tick();
        this.lastTickError = null;
      } catch (e) {
        this.lastTickError = (e as Error).message;
        console.error(`[0xFE-executor] tick failed: ${(e as Error).message}`);
      } finally {
        this.lastTickAt = new Date();
        this.running = false;
        if (!this.stopped) this.timer = setTimeout(loop, intervalMs);
      }
    };
    // primer barrido nada más arrancar — un usuario puede estar esperando ya
    this.timer = setTimeout(loop, 5_000);
    console.log('[0xFE-executor] watcher armado — barrido del Core Vault cada', intervalMs / 1000, 's');
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    const pk = process.env.FLARE_EXECUTOR_PK;
    if (!pk) {
      console.error('[0xFE-executor] FLARE_EXECUTOR_PK ausente — watcher sin clave, no puede ejecutar');
      return;
    }
    // Antes de decidir qué se ejecuta, la lista de aparcados debe estar
    // completa — incluye lo persistido de ANTES del último redeploy.
    await this.hydrateParked();
    const provider = new ethers.JsonRpcProvider(process.env.FLARE_RPC_URL || DEFAULTS.rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const onlyMine = process.env.FLARE_EXECUTOR_ALL !== 'true';
    const sourceTag = Number(process.env.XRPL_SOURCE_TAG || DEFAULTS.sourceTag);

    // Combustible ANTES de barrer: el refuel es proactivo (corre aunque no
    // haya mints — "swapea antes de necesitarlo") y el sweep anti-piñata igual.
    // Un fallo de fuel no aborta el tick: los mints pagables deben salir.
    try {
      this.lastGauges = await checkExecutorFuel(provider, wallet, (m) => console.log(`[0xFE-executor] ${m}`));
    } catch (e) {
      console.error(`[0xFE-executor] fuel-check falló (sigo con el barrido): ${(e as Error).message}`);
    }

    const { rows } = await sweepInstructionPayments({
      provider,
      wssUrl: process.env.XRPL_WSS_URL || DEFAULTS.wssUrl,
      onlyTag: onlyMine ? sourceTag : null,
      maxPages: Number(process.env.FLARE_EXECUTOR_SWEEP_PAGES || 3),
    });
    // Skip-list del operador (Railway): hashes a no tocar JAMÁS — sobrevive a
    // restarts, al contrario que el estado en memoria del watcher.
    const skipList = new Set(
      (process.env.FLARE_EXECUTOR_SKIP_TXS || '')
        .toUpperCase()
        .split(/[\s,;]+/)
        .filter(Boolean),
    );
    for (const hash of skipList) {
      if (!this.parked.has(hash)) this.parked.set(hash, 'skip-list del operador (FLARE_EXECUTOR_SKIP_TXS)');
    }

    const pendingAll = rows.filter((r) => !r.used && r.opcode === 'FE');
    const pending = pendingAll.filter((r) => !this.parked.has(r.hash));
    this.lastPending = pending;
    if (pendingAll.length > pending.length) {
      console.log(`[0xFE-executor] ${pendingAll.length - pending.length} Payment(s) 0xFE aparcados (sin reintento ni coste)`);
    }
    if (pending.length === 0) return;
    console.log(`[0xFE-executor] ${pending.length} Payment(s) 0xFE pendientes`);

    // Alarma de saldo para el operador. NO bloquea a propósito: el guard
    // autoritativo vive en executeDirectMint, que lee la fee FDC REAL y aborta
    // antes de firmar. Si este umbral cortara, una fee más barata que la
    // referencia impediría ejecutar mints perfectamente pagables — el umbral
    // avisa, la fee real decide.
    const minFlr = process.env.FLARE_EXECUTOR_MIN_FLR || '30';
    // Saldo FRESCO, no el del gauge: `lastGauges.flrWei` se leyó ANTES del
    // fuel-check, así que tras un refuel exitoso avisaría de "recarga" con un
    // número ya obsoleto — un falso positivo. Un canal de alertas que cría
    // lobos se ignora justo el día que grita de verdad. Una llamada RPC por
    // tick es irrelevante; la credibilidad del canal no.
    const balance = await provider.getBalance(wallet.address);
    if (balance < ethers.parseEther(minFlr)) {
      await executorAlert(
        'warn',
        `balance del executor ${wallet.address} = ${ethers.formatEther(balance)} FLR ` +
          `(< ${minFlr} FLR de referencia — la fee FDC ronda los 20 FLR por mint) — recargar para seguir ejecutando`,
      );
    }

    // Handoff colgado: un 0xFE firmado que lleva demasiado sin ejecutarse es
    // el XRP de un usuario aparcado (lección 7BFCF65F). Una alerta por tx.
    const stuckMin = Number(process.env.FLARE_EXECUTOR_STUCK_ALERT_MIN || 10);
    const stuckBefore = Date.now() - stuckMin * 60_000;
    for (const row of pending) {
      if (this.stuckAlerted.has(row.hash)) continue;
      if (new Date(row.dateISO).getTime() < stuckBefore) {
        this.stuckAlerted.add(row.hash);
        await executorAlert(
          'warn',
          `0xFE colgado >${stuckMin} min: ${row.hash} (${Number(row.drops) / DROPS} XRP de ${row.account}, ` +
            `firmado ${row.dateISO}) sigue sin ejecutar — el watcher reintenta, pero míralo`,
        );
      }
    }

    for (const row of pending) {
      if (this.stopped) return;
      const notBefore = this.nextAttemptAt.get(row.hash) ?? 0;
      if (Date.now() < notBefore) continue;
      try {
        console.log(`[0xFE-executor] ejecutando ${row.hash} (${Number(row.drops) / DROPS} XRP de ${row.account})…`);
        const outcome = await executeDirectMint({
          provider,
          wallet,
          txHash: row.hash,
          wssUrl: process.env.XRPL_WSS_URL || DEFAULTS.wssUrl,
          verifierBase: process.env.FDC_VERIFIER_URL,
          verifierKey: process.env.FDC_VERIFIER_API_KEY,
          daLayerBase: process.env.DA_LAYER_URL,
          log: (m) => console.log(`[0xFE-executor] ${m}`),
        });
        this.failures.delete(row.hash);
        this.stuckAlerted.delete(row.hash);
        if (outcome.stage === 'delayed' && outcome.executionAllowedAt) {
          this.nextAttemptAt.set(row.hash, outcome.executionAllowedAt * 1000);
          console.log(`[0xFE-executor] ${row.hash} diferido por el AssetManager — reintento tras allowedAt`);
        } else {
          this.nextAttemptAt.delete(row.hash);
          console.log(`[0xFE-executor] ✓ ${row.hash} ejecutado — Flare tx ${outcome.flareTxHash}`);
          // Cap diario (v2 reserva→confirmación): la EJECUCIÓN es la verdad del
          // gasto — confirma la reserva del prepare (o re-asserta si expiró).
          // Best-effort: jamás toca el resultado de la ejecución.
          const { confirmDailySpendXrp } = await import('../../config/demoCap');
          void confirmDailySpendXrp(row.account, Number(row.drops) / DROPS);
        }
      } catch (e) {
        // Bytes estructuralmente inejecutables (sender ajeno, nonce consumido):
        // aparcar YA — reintentarlos es quemar fees por un revert garantizado
        // (lección 2026-07-18: 244 attestations × 20 FLR por 3 txs imposibles).
        if (e instanceof ExecutorAbort && e.permanent) {
          await this.parkTx(row.hash, (e as Error).message, 'permanent', row);
          console.error(`[0xFE-executor] ⛔ ${row.hash} INEJECUTABLE — aparcado sin coste: ${(e as Error).message}`);
          await executorAlert(
            'critical',
            `0xFE ${row.hash} aparcado DEFINITIVAMENTE (bytes inejecutables, nada pagado): ${(e as Error).message} ` +
              'Rescate: revisar el prepare que generó estos bytes; el XRP del Payment queda en el Core Vault.',
          );
          continue;
        }
        const n = (this.failures.get(row.hash) ?? 0) + 1;
        this.failures.set(row.hash, n);
        // Tope duro de reintentos: un fallo repetible que no se cura solo no
        // debe correr para siempre con dinero real. Gracias a la caché de
        // attestation los reintentos ya no re-pagan la fee, pero el tope corta
        // también el ruido y señala intervención manual.
        const maxFailures = Math.max(Number(process.env.FLARE_EXECUTOR_MAX_FAILURES || 12), 1);
        if (n >= maxFailures) {
          await this.parkTx(row.hash, `tope de ${maxFailures} fallos alcanzado — último: ${(e as Error).message}`, 'failures', row);
          console.error(`[0xFE-executor] ⛔ ${row.hash} aparcado tras ${n} fallos: ${(e as Error).message}`);
          await executorAlert(
            'critical',
            `0xFE ${row.hash} aparcado tras ${n} fallos — requiere intervención manual (CLI execute-direct-mint). Último error: ${(e as Error).message}`,
          );
          continue;
        }
        // backoff exponencial 5 → 15 → 45 min (cap 60): errores persistentes
        // (p.ej. e1 sin fila en el store) necesitan intervención manual, no spam.
        const backoffMin = Math.min(5 * 3 ** (n - 1), 60);
        this.nextAttemptAt.set(row.hash, Date.now() + backoffMin * 60_000);
        console.error(
          `[0xFE-executor] ✗ ${row.hash} fallo #${n}/${maxFailures} (reintento en ${backoffMin} min): ${(e as Error).message}`,
        );
      }
    }
  }
}

export const directMintExecutorWatcher = new DirectMintExecutorWatcher();

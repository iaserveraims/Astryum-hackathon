/**
 * LegacyOrderRelayService — carry a quorum-signed council order across the FDC.
 *
 * The governance twin of the 0xFE executor (same pipeline, same trust line):
 *   XRPL txId → verifier XRPPayment/prepareRequest (proofOwner = the bridge) →
 *   getRequestFee → requestAttestation (SIGNATURE 1, executor gas) → wait round
 *   finalization → DA-layer proof → sanity checks → bridge.execute(proof,
 *   orderData) (SIGNATURE 2) — after simulating first (invariant #11).
 *
 * ZERO discretion (invariants #1/#8): the bridge only accepts the bytes whose
 * keccak256 the quorum committed in the memo. This relayer either delivers the
 * signed order or reverts — it cannot alter, reorder, or invent anything. Its
 * key (FLARE_EXECUTOR_PK, env-only) pays gas + the FDC attestation fee — never
 * a user key, never user funds. Gated by FLARE_EXECUTOR_ENABLED (#10).
 */

import { ethers } from 'ethers';
import { LEGACY_NETWORKS, legacyNetworkConfig, legacyStackConfig } from '../../connectors/protocols/xrpl/XrplCouncilOrderService';
import {
  findCouncilOrderByHash,
  markCouncilOrderExecuted,
  findPaidAttestation,
  savePaidAttestation,
  deletePaidAttestation,
} from './LegacyOrderStore';
import { assertDailyFeeBudget, recordFeeSpend, executorAlert } from './ExecutorFuelService';

export class RelayAbort extends Error {}

type Log = (msg: string) => void;

// Same struct the executor decodes (IXRPPayment.Response) — kept verbatim.
const XRP_PAYMENT_RESPONSE_TUPLE =
  'tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ' +
  'tuple(bytes32 transactionId, address proofOwner) requestBody, ' +
  'tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, ' +
  'bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, ' +
  'int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, ' +
  'bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)';

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

const BRIDGE_ABI = [
  `function execute(tuple(bytes32[] merkleProof, ${XRP_PAYMENT_RESPONSE_TUPLE} data) proof, bytes orderData)`,
  'function consumedTxId(bytes32) view returns (bool)',
  'function nextNonce() view returns (uint64)',
  // Immutable in the contract: the ONE authority on whose orders are worth
  // paying an FDC round for (see the sender guard in relayCouncilOrder).
  'function COUNCIL_ADDRESS_HASH() view returns (bytes32)',
];

/** FDC infra per network (verifier + DA layer; env overrides both). */
const FDC_INFRA: Record<'coston2' | 'flare', { verifierBase: string; daLayerBase: string }> = {
  coston2: {
    verifierBase: process.env.FDC_VERIFIER_URL_TESTNET || 'https://fdc-verifiers-testnet.flare.network',
    daLayerBase: process.env.FDC_DA_LAYER_URL_TESTNET || 'https://ctn2-data-availability.flare.network',
  },
  flare: {
    verifierBase: process.env.FDC_VERIFIER_URL || 'https://fdc-verifiers-mainnet.flare.network',
    daLayerBase: process.env.FDC_DA_LAYER_URL || 'https://flr-data-availability.flare.network',
  },
};

/** XRPL JSON-RPC nodes per FDC source (env override first). */
function xrplRpcCandidates(sourceId: 'testXRP' | 'XRP'): string[] {
  const fromEnv = process.env.LEGACY_XRPL_RPC;
  const defaults =
    sourceId === 'testXRP'
      ? ['https://s.altnet.rippletest.net:51234', 'https://testnet.xrpl-labs.com']
      : ['https://s1.ripple.com:51234', 'https://xrplcluster.com'];
  return fromEnv ? [fromEnv, ...defaults] : defaults;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** FDC_VERIFIER_API_KEY absent → the public zero key. It usually works — until
 *  a round fails LATE, with the fee already paid. Warn loudly ONCE per boot so
 *  the operator learns it from the logs, not from a burned attestation. */
let warnedZeroVerifierKey = false;
function resolveVerifierKey(): string {
  const key = process.env.FDC_VERIFIER_API_KEY;
  if (!key && !warnedZeroVerifierKey) {
    warnedZeroVerifierKey = true;
    console.warn('[legacy-relay] FDC_VERIFIER_API_KEY sin setear — usando la clave pública de ceros; las rondas pueden fallar TARDE (fee ya pagada). Setéala en el entorno.');
  }
  return key || '00000000-0000-0000-0000-000000000000';
}

/**
 * Attestations YA pagadas por txId (proofOwner = el bridge, fijo por config):
 * si un intento anterior pagó la fee y falló después (ronda lenta, DA, revert),
 * el reintento reutiliza la ronda y recoge el proof gratis — la fee del FDC se
 * paga UNA vez por orden, no una por intento (lección del executor 0xFE,
 * 2026-07-18).
 */
const paidAttestations = new Map<string, { abiEncodedRequest: string; roundId: number; passesWithoutProof: number }>();

/** Fetch a validated XRPL tx: its first MemoData (uppercase hex) and its SENDER
 *  — the sender decides whether this is worth paying an attestation for. */
async function fetchXrplMemo(
  txHash: string,
  sourceId: 'testXRP' | 'XRP',
  log: Log,
): Promise<{ memo: string; account: string }> {
  // Un rippled congelado o sin full-history responde `txnNotFound` para una tx
  // que OTRO nodo sí tiene (incidente 2026-07-31: s1 llevaba horas parado) —
  // eso es "prueba el siguiente nodo", jamás un veredicto. Solo un nodo que
  // DEVUELVE la tx decide; si todos dicen not-found, el consejo espera.
  let sawNotFound = false;
  for (const node of xrplRpcCandidates(sourceId)) {
    try {
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tx', params: [{ transaction: txHash, binary: false }] }),
      });
      const json = (await res.json()) as {
        result?: {
          status?: string;
          error?: string;
          validated?: boolean;
          Account?: string;
          meta?: { TransactionResult?: string };
          Memos?: Array<{ Memo?: { MemoData?: string } }>;
        };
      };
      const r = json.result;
      if (!r) continue;
      if (r.status === 'error' || r.error) {
        sawNotFound = true;
        continue;
      }
      if (!r.validated) throw new RelayAbort('the XRPL tx is not validated yet — wait a few seconds and retry');
      if (r.meta?.TransactionResult !== 'tesSUCCESS') {
        throw new RelayAbort(`the XRPL tx did not succeed (${r.meta?.TransactionResult}) — nothing to relay`);
      }
      const memo = r.Memos?.[0]?.Memo?.MemoData;
      if (!memo || !/^[0-9A-Fa-f]{64}$/.test(memo)) {
        throw new RelayAbort('the XRPL tx carries no 32-byte order memo — not a council order');
      }
      if (!r.Account) throw new RelayAbort('the XRPL tx has no sender — not a council order');
      log(`[1] XRPL tx validated ✓ (memo = 0x${memo.slice(0, 16)}…, from ${r.Account})`);
      return { memo: memo.toUpperCase(), account: r.Account };
    } catch (e) {
      if (e instanceof RelayAbort) throw e;
      /* node down — try the next */
    }
  }
  throw new RelayAbort(
    sawNotFound
      ? 'the XRPL tx is not validated yet — wait a few seconds and retry'
      : 'no XRPL node answered the tx lookup',
  );
}

export interface RelayOutcome {
  stage: 'already-executed' | 'executed';
  xrplTxHash: string;
  orderHash: string;
  flareTxHash?: string;
  requestFeeFLR?: string;
}

/**
 * Relay one council order end-to-end. `orderDataOverride` lets a client
 * re-supply the bytes if the store row was lost (the hash protects fidelity).
 */
export async function relayCouncilOrder(input: {
  xrplTxHash: string;
  orderDataOverride?: string;
  log?: Log;
}): Promise<RelayOutcome> {
  const log: Log = input.log ?? ((m) => console.log(`[legacy-relay] ${m}`));
  // Network first, stack later: WHICH bridge this order belongs to is decided
  // by its SENDER, not by configuration. Reading the env stack here was the
  // per-Legacy gap of 2026-08-05 — a second council's order would abort on the
  // founding bridge's WrongCouncil guard after the quorum had already signed.
  const net = legacyNetworkConfig();
  const infra = FDC_INFRA[net.chain];
  const txHash = input.xrplTxHash.replace(/^0x/i, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(txHash)) throw new RelayAbort('xrplTxHash must be 64 hex chars');
  const txId = ('0x' + txHash).toLowerCase();

  const pk = process.env.FLARE_EXECUTOR_PK;
  if (process.env.FLARE_EXECUTOR_ENABLED !== 'true' || !pk) {
    throw new RelayAbort('relayer disabled (FLARE_EXECUTOR_ENABLED/FLARE_EXECUTOR_PK) — the proof can be delivered by anyone with the public relay scripts');
  }

  const provider = new ethers.JsonRpcProvider(net.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  // ── 1. XRPL truth: validated council Payment + its memo (the commitment). ──
  const { memo: memoHex, account: sender } = await fetchXrplMemo(txHash, net.sourceId, log);
  const orderHash = ('0x' + memoHex).toLowerCase();

  // ── 1b. WHOSE cage — and is the sender a council at all? ──────────────────
  // The attestation costs ~20 FLR of real money and is paid BEFORE any bridge
  // looks at the proof. Without this check, anyone with a session could send
  // their own 1-drop Payment carrying any 32-byte memo and make the relayer
  // burn the daily FDC budget on a proof every bridge would reject with
  // WrongCouncil() — grief for the price of one drop. The resolver asks the
  // same authorities the contracts do: the factory registry (keyed by the
  // immutable council hash) and the bridge's own COUNCIL_ADDRESS_HASH.
  const { cageForCouncil } = await import('./LegacyCageResolver');
  const cage = await cageForCouncil(sender);
  if (!cage) {
    throw new RelayAbort(
      `the XRPL tx was sent by ${sender}, which is not a council with a cage — refusing to pay an attestation no bridge would accept (WrongCouncil)`,
    );
  }
  const bridge = new ethers.Contract(cage.bridge, BRIDGE_ABI, provider);
  log(`[1b] sender is a council ✓ → its own bridge ${cage.bridge} (nothing is paid for a stranger’s memo)`);

  // ── 2a. Idempotence: an executed order is DONE, never re-delivered. ────────
  if (await bridge.consumedTxId(txId)) {
    log('order already executed on the bridge — nothing to do');
    return { stage: 'already-executed', xrplTxHash: txHash, orderHash };
  }

  // ── 2. The committed bytes (store, or client-supplied — hash-checked). ─────
  let orderData = input.orderDataOverride;
  if (!orderData) {
    const row = await findCouncilOrderByHash(orderHash);
    orderData = row?.orderData;
  }
  if (!orderData) {
    throw new RelayAbort(
      `no orderData found for memo ${orderHash} — re-supply the bytes from the prepare step (orderDataOverride)`,
    );
  }
  if (ethers.keccak256(orderData).toLowerCase() !== orderHash) {
    throw new RelayAbort('orderData does not hash to the memo commitment — refusing to relay');
  }
  log(`[2] committed bytes matched ✓ (${(orderData.length - 2) / 2} bytes)`);

  // ── 3. FDC: prepare the XRPPayment attestation (proof bound to the bridge). ─
  const toHex32 = (s: string) => '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
  const verifierKey = resolveVerifierKey();
  const prepResp = await fetch(`${infra.verifierBase}/verifier/xrp/XRPPayment/prepareRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': verifierKey },
    body: JSON.stringify({
      attestationType: toHex32('XRPPayment'),
      sourceId: toHex32(net.sourceId),
      requestBody: { transactionId: txId, proofOwner: cage.bridge },
    }),
  });
  const prep = (await prepResp.json().catch(() => ({}))) as { status?: string; abiEncodedRequest?: string };
  if (prepResp.status !== 200 || !prep.abiEncodedRequest || (prep.status && prep.status !== 'VALID' && !prep.status.startsWith('OK'))) {
    throw new RelayAbort(`verifier prepareRequest failed (${prepResp.status}): ${JSON.stringify(prep)}`);
  }
  const abiEncodedRequest = prep.abiEncodedRequest;
  log(`[3] FDC prepareRequest ✓ (proofOwner = the bridge)`);

  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  const fdcHub = new ethers.Contract(await registry.getContractAddressByName('FdcHub'), FDC_HUB_ABI, provider);
  const feeConfig = new ethers.Contract(await fdcHub.fdcRequestFeeConfigurations(), FDC_FEE_ABI, provider);
  const requestFee: bigint = await feeConfig.getRequestFee(abiEncodedRequest);
  log(`    attestation fee: ${ethers.formatEther(requestFee)} FLR`);

  // In-memory first; on a miss (e.g. after a redeploy) fall back to the
  // persisted record so a paid attestation is NEVER paid twice for one order.
  let prior = paidAttestations.get(txId);
  if (!prior) {
    const persisted = await findPaidAttestation(txId);
    if (persisted) {
      prior = persisted;
      paidAttestations.set(txId, persisted);
      log('    attestation recuperada del store (sobrevive a un redeploy) — no se re-paga');
    }
  }
  const reusable = prior && prior.abiEncodedRequest === abiEncodedRequest ? prior : undefined;

  const gasMargin = ethers.parseEther(process.env.FLARE_EXECUTOR_GAS_MARGIN_FLR || '2');
  const balance = await provider.getBalance(wallet.address);
  if (balance < (reusable ? gasMargin : requestFee + gasMargin)) {
    throw new RelayAbort(
      `relayer ${wallet.address} holds ${ethers.formatEther(balance)} FLR < fee ${ethers.formatEther(requestFee)} + margin — refuel first; nothing signed`,
    );
  }

  // ── 4. SIGNATURE 1: request the attestation (once per order, ever). ────────
  let roundId: number;
  if (reusable) {
    roundId = reusable.roundId;
    log(`[4] attestation already paid on a previous attempt → round ${roundId} — reusing, no fee`);
  } else {
    // Global handbrake (2026-07-18 incident): the fee is only signed if it fits
    // the shared daily budget — throws FeeBudgetExceeded before signing.
    assertDailyFeeBudget(requestFee);
    log('[4] requestAttestation (SIGNATURE 1)…');
    const hubTx = await (fdcHub.connect(wallet) as ethers.Contract).requestAttestation(abiEncodedRequest, {
      value: requestFee,
    });
    const hubReceipt = await hubTx.wait();
    recordFeeSpend(requestFee);
    const block = await provider.getBlock(hubReceipt!.blockNumber);
    const fsm = new ethers.Contract(await registry.getContractAddressByName('FlareSystemsManager'), FSM_ABI, provider);
    const [firstTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
    roundId = Number((BigInt(block!.timestamp) - BigInt(firstTs)) / BigInt(epochSec));
    paidAttestations.set(txId, { abiEncodedRequest, roundId, passesWithoutProof: 0 });
    await savePaidAttestation(txId, { abiEncodedRequest, roundId, passesWithoutProof: 0 }); // persist: survive a redeploy
    log(`    round ${roundId} — waiting for finalization (~2-5 min)…`);
  }

  // ── 5. Wait for the round; fetch the Merkle proof from the DA layer. ───────
  const relay = new ethers.Contract(await registry.getContractAddressByName('Relay'), RELAY_ABI, provider);
  const fdcVerification = new ethers.Contract(
    await registry.getContractAddressByName('FdcVerification'),
    FDC_VERIFICATION_ABI,
    provider,
  );
  const protocolId: bigint = await fdcVerification.fdcProtocolId();
  let finalized = false;
  for (let i = 0; i < 60; i++) {
    if (await relay.isFinalized(protocolId, BigInt(roundId))) {
      finalized = true;
      break;
    }
    await sleep(15_000);
  }
  if (!finalized) throw new RelayAbort('FDC round did not finalize in ~15 min — retry later (the attestation stays valid)');
  log('    round finalized ✓');

  let responseHex: string | null = null;
  let merkleProof: string[] = [];
  for (let i = 0; i < 20; i++) {
    const daResp = await fetch(`${infra.daLayerBase}/api/v1/fdc/proof-by-request-round-raw`, {
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
    if (reusable) {
      // Un proof del FDC, una vez CONSTRUIDO, el DA layer lo sirve PARA SIEMPRE
      // (dev.flare.network/fdc/overview — los 14 días son el límite para PEDIRLO,
      // no de retención). Así que una ronda finalizada SIN proof no es un proof
      // caducado: o es un parpadeo transitorio del DA layer (reintentar — el
      // proof está ahí), o el request NUNCA se confirmó (fee corta / peso
      // insuficiente → la fee se QUEMÓ, no habrá proof jamás). `passesWithoutProof`
      // tolera 2 pasadas para descartar el parpadeo sin dejar la orden atascada
      // mucho rato; a la 2ª se concluye "nunca confirmado" y — porque eso es
      // dinero quemado, la versión lenta del incidente 0xFE — se AVISA y se re-paga.
      reusable.passesWithoutProof++;
      if (reusable.passesWithoutProof >= 2) {
        paidAttestations.delete(txId);
        await deletePaidAttestation(txId);
        await executorAlert(
          'warn',
          `attestation de la tx ${txHash} sin proof en la ronda ${roundId} tras 2 pasadas: el request NUNCA se confirmó ` +
            `(fee corta / peso insuficiente) → la fee FDC se QUEMÓ. El próximo intento re-paga. Revisar el fee de attestation.`,
        );
        throw new RelayAbort(
          `el request de la ronda ${roundId} nunca se confirmó (fee quemada) — registro invalidado; el reintento pagará una nueva`,
        );
      }
      await savePaidAttestation(txId, { abiEncodedRequest, roundId, passesWithoutProof: reusable.passesWithoutProof });
      throw new RelayAbort(
        `el DA layer aún no sirve el proof de la ronda ${roundId} (¿parpadeo transitorio? el proof no caduca) — reintenta`,
      );
    }
    throw new RelayAbort('DA layer returned no proof after 20 attempts');
  }
  log(`    proof fetched (${merkleProof.length} merkle nodes)`);

  // ── 6. Sanity before spending gas: same tx, same memo, success. ────────────
  const resp = ethers.AbiCoder.defaultAbiCoder().decode([XRP_PAYMENT_RESPONSE_TUPLE], responseHex)[0];
  const rb = resp.responseBody;
  if (String(resp.requestBody.transactionId).toLowerCase() !== txId) throw new RelayAbort('proof is not for this tx');
  if (Number(rb.status) !== 0) throw new RelayAbort(`payment status in proof = ${rb.status} (≠ SUCCESS)`);
  if (!rb.hasMemoData || String(rb.firstMemoData).replace(/^0x/i, '').toUpperCase() !== memoHex) {
    throw new RelayAbort('proof memo does not match the order commitment');
  }
  const proofStruct = {
    merkleProof,
    data: {
      attestationType: resp.attestationType,
      sourceId: resp.sourceId,
      votingRound: resp.votingRound,
      lowestUsedTimestamp: resp.lowestUsedTimestamp,
      requestBody: { transactionId: resp.requestBody.transactionId, proofOwner: resp.requestBody.proofOwner },
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

  // ── 7. Simulate, then SIGNATURE 2: deliver the order to the bridge. ───────
  const bridgeWrite = bridge.connect(wallet) as ethers.Contract;
  try {
    await bridgeWrite.execute.staticCall(proofStruct, orderData);
  } catch (e) {
    throw new RelayAbort(`bridge.execute would revert: ${(e as Error & { data?: string }).message}`);
  }
  log('[5] simulation ✓ — executing (SIGNATURE 2)…');
  const execTx = await bridgeWrite.execute(proofStruct, orderData);
  const execReceipt = await execTx.wait();
  log(`    executed ✓ (${execTx.hash}, block ${execReceipt!.blockNumber})`);

  paidAttestations.delete(txId); // consumed — the bridge marks the txId used
  await markCouncilOrderExecuted(orderHash, {
    xrplTxHash: txHash,
    flareTxHash: execTx.hash,
    relayer: wallet.address,
  });

  return {
    stage: 'executed',
    xrplTxHash: txHash,
    orderHash,
    flareTxHash: execTx.hash,
    requestFeeFLR: ethers.formatEther(requestFee),
  };
}

export interface RehearsalReport {
  xrplTxHash: string;
  hasMemo: boolean;
  requestFeeFLR: string;
  roundId: number;
  finalizeSeconds: number; // real FDC round latency — what the ceremony can't discover live
  daFetchSeconds: number; // how long the DA layer took to serve the proof
  totalSeconds: number;
  persistedRoundTrip: boolean; // savePaidAttestation → findPaidAttestation matched
  proofOk: boolean;
}

/**
 * Rehearse the attestation pipeline (steps 1-4 of the relay) against ANY validated
 * XRPL tx — NO council quorum, NO execute. Only the 5th step (execute) needs the
 * 3-of-4 signature; these four can be dry-run from any account. Measures exactly
 * what the ceremony cannot afford to discover live: real FDC round latency, the
 * per-stage status, and whether the paid-attestation PERSISTENCE survives a full
 * cycle (the thing we just touched). Reuses the SAME plumbing as the real relay,
 * so what it observes is what the ceremony will do — minus the quorum-gated step.
 * Costs one real FDC fee (~FLR). Leaves no trace (the test record is cleaned up).
 */
export async function rehearseAttestationPipeline(input: { xrplTxHash: string; log?: Log }): Promise<RehearsalReport> {
  const log: Log = input.log ?? ((m) => console.log(`[rehearsal] ${m}`));
  const cfg = legacyStackConfig();
  const infra = FDC_INFRA[cfg.chain];
  const txHash = input.xrplTxHash.replace(/^0x/i, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(txHash)) throw new RelayAbort('xrplTxHash must be 64 hex chars');
  const txId = ('0x' + txHash).toLowerCase();

  const pk = process.env.FLARE_EXECUTOR_PK;
  if (process.env.FLARE_EXECUTOR_ENABLED !== 'true' || !pk) {
    throw new RelayAbort('rehearsal needs FLARE_EXECUTOR_ENABLED=true + FLARE_EXECUTOR_PK (it pays one real FDC fee)');
  }
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const t0 = Date.now();

  // 1. XRPL truth — validated + success. Memo is optional here (execute checks it, not this).
  let hasMemo = false;
  let sawTx = false;
  for (const node of xrplRpcCandidates(cfg.sourceId)) {
    try {
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tx', params: [{ transaction: txHash, binary: false }] }),
      });
      const r = ((await res.json()) as { result?: { validated?: boolean; meta?: { TransactionResult?: string }; Memos?: Array<{ Memo?: { MemoData?: string } }> } }).result;
      if (!r) continue;
      if (!r.validated) throw new RelayAbort('the XRPL tx is not validated yet — wait a few seconds');
      if (r.meta?.TransactionResult !== 'tesSUCCESS') throw new RelayAbort(`XRPL tx not tesSUCCESS (${r.meta?.TransactionResult})`);
      hasMemo = /^[0-9A-Fa-f]{64}$/.test(r.Memos?.[0]?.Memo?.MemoData ?? '');
      sawTx = true;
      log(`[1] XRPL tx validada ✓ (memo de 32B: ${hasMemo ? 'sí' : 'no — irrelevante para la tubería, solo execute lo mira'})`);
      break;
    } catch (e) {
      if (e instanceof RelayAbort) throw e;
    }
  }
  if (!sawTx) throw new RelayAbort('no XRPL node answered the tx lookup');

  // 2. prepareRequest (proofOwner = the bridge — same binding as the real relay).
  const toHex32 = (s: string) => '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
  const verifierKey = resolveVerifierKey();
  const prepResp = await fetch(`${infra.verifierBase}/verifier/xrp/XRPPayment/prepareRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': verifierKey },
    body: JSON.stringify({ attestationType: toHex32('XRPPayment'), sourceId: toHex32(cfg.sourceId), requestBody: { transactionId: txId, proofOwner: cfg.bridge } }),
  });
  const prep = (await prepResp.json().catch(() => ({}))) as { abiEncodedRequest?: string };
  if (prepResp.status !== 200 || !prep.abiEncodedRequest) throw new RelayAbort(`prepareRequest failed (${prepResp.status})`);
  const abiEncodedRequest = prep.abiEncodedRequest;
  log('[2] prepareRequest ✓ (proofOwner = el bridge)');

  // 3. fee + 4. requestAttestation (una fee FDC real).
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  const fdcHub = new ethers.Contract(await registry.getContractAddressByName('FdcHub'), FDC_HUB_ABI, provider);
  const feeConfig = new ethers.Contract(await fdcHub.fdcRequestFeeConfigurations(), FDC_FEE_ABI, provider);
  const requestFee: bigint = await feeConfig.getRequestFee(abiEncodedRequest);
  log(`[3] fee de attestation = ${ethers.formatEther(requestFee)} FLR`);
  assertDailyFeeBudget(requestFee);
  const hubTx = await (fdcHub.connect(wallet) as ethers.Contract).requestAttestation(abiEncodedRequest, { value: requestFee });
  const hubReceipt = await hubTx.wait();
  recordFeeSpend(requestFee);
  const block = await provider.getBlock(hubReceipt!.blockNumber);
  const fsm = new ethers.Contract(await registry.getContractAddressByName('FlareSystemsManager'), FSM_ABI, provider);
  const [firstTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
  const roundId = Number((BigInt(block!.timestamp) - BigInt(firstTs)) / BigInt(epochSec));
  log(`[4] requestAttestation ✓ → ronda ${roundId} (fee pagada)`);

  // Persistencia: save → read-back (justo lo que tocamos hoy).
  await savePaidAttestation(txId, { abiEncodedRequest, roundId, passesWithoutProof: 0 });
  const back = await findPaidAttestation(txId);
  const persistedRoundTrip = !!back && back.roundId === roundId && back.abiEncodedRequest === abiEncodedRequest;
  log(`    persistencia save→find: ${persistedRoundTrip ? '✓ round-trip OK' : '✗ NO (¿DATABASE_URL?)'}`);

  // 5. finalización de la ronda (la latencia clave).
  const relay = new ethers.Contract(await registry.getContractAddressByName('Relay'), RELAY_ABI, provider);
  const fdcVerification = new ethers.Contract(await registry.getContractAddressByName('FdcVerification'), FDC_VERIFICATION_ABI, provider);
  const protocolId: bigint = await fdcVerification.fdcProtocolId();
  const tFin = Date.now();
  let finalized = false;
  for (let i = 0; i < 60; i++) {
    if (await relay.isFinalized(protocolId, BigInt(roundId))) {
      finalized = true;
      break;
    }
    await sleep(15_000);
  }
  const finalizeSeconds = Math.round((Date.now() - tFin) / 1000);
  if (!finalized) throw new RelayAbort(`la ronda no finalizó en ~15 min (llevaba ${finalizeSeconds}s)`);
  log(`[5] ronda finalizada ✓ en ${finalizeSeconds}s`);

  // 6. proof del DA layer.
  const tDa = Date.now();
  let responseHex: string | null = null;
  for (let i = 0; i < 20; i++) {
    const daResp = await fetch(`${infra.daLayerBase}/api/v1/fdc/proof-by-request-round-raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
    });
    const da = (await daResp.json().catch(() => ({}))) as { response_hex?: string };
    if (da.response_hex) {
      responseHex = da.response_hex;
      break;
    }
    await sleep(10_000);
  }
  const daFetchSeconds = Math.round((Date.now() - tDa) / 1000);
  const proofOk = !!responseHex;
  log(`[6] proof del DA layer: ${proofOk ? `✓ en ${daFetchSeconds}s` : `✗ NO llegó en ${daFetchSeconds}s`}`);

  await deletePaidAttestation(txId); // limpieza: el ensayo no deja rastro
  const totalSeconds = Math.round((Date.now() - t0) / 1000);
  const report: RehearsalReport = { xrplTxHash: txHash, hasMemo, requestFeeFLR: ethers.formatEther(requestFee), roundId, finalizeSeconds, daFetchSeconds, totalSeconds, persistedRoundTrip, proofOk };
  log('\n=== ENSAYO DE LA TUBERÍA (sin execute — cero firmas del consejo) ===');
  log(`fee FDC: ${report.requestFeeFLR} FLR · ronda ${roundId}`);
  log(`finalización: ${finalizeSeconds}s · proof DA: ${daFetchSeconds}s · TOTAL: ${totalSeconds}s`);
  log(`persistencia round-trip: ${persistedRoundTrip ? 'OK' : 'NO'} · proof recuperable: ${proofOk ? 'sí' : 'NO'}`);
  return report;
}

/** On-chain settlement truth for the UI tracker (no relayer state needed).
 *  `account` names the Legacy whose bridge holds the truth — without it the
 *  read falls back to the env stack, which is only right for the founding
 *  council (per-Legacy cages, 2026-08-05). */
export async function councilOrderStatus(
  xrplTxHash: string,
  account?: string,
): Promise<{ executed: boolean; nextNonce: number }> {
  let cfg: { rpcUrl: string; bridge: string };
  if (account) {
    const { requireCageForCouncil } = await import('./LegacyCageResolver');
    cfg = await requireCageForCouncil(account);
  } else {
    cfg = legacyStackConfig();
  }
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const bridge = new ethers.Contract(cfg.bridge, BRIDGE_ABI, provider);
  const txId = ('0x' + xrplTxHash.replace(/^0x/i, '')).toLowerCase();
  const [executed, nonce] = await Promise.all([
    bridge.consumedTxId(txId) as Promise<boolean>,
    bridge.nextNonce() as Promise<bigint>,
  ]);
  return { executed, nextNonce: Number(nonce) };
}

/** Also usable from the CLI: npx ts-node src/scripts/legacy-order-relay.ts <txHash> */
export const _internals = { fetchXrplMemo };

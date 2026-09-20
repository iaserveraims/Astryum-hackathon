/**
 * settlement — the ONE state machine for the mint/entry flows (R1).
 *
 * The three sites that used to paint a premature green (FlareDemoEarn.sign(), the EVM /
 * 5792 rail, CompleteBorrowModal) are the SAME bug in three places. They now consume this
 * machine; none of them can paint success on its own.
 */

/** The valid rails, as data — the single source for the type AND for pruning
 *  corrupted storage (a fabricated rail must never reach the tracker: it would
 *  index POLL_MS to undefined and hot-loop setTimeout(fn, undefined)). */
export const SETTLEMENT_RAILS = ['xrpl-mint', 'evm', 'evm-5792', 'xrpl-tx', 'council-order'] as const;
export type SettlementRail = (typeof SETTLEMENT_RAILS)[number];
export type SettlementStatus = 'pending' | 'settled' | 'failed' | 'stalled';

const BRAND: unique symbol = Symbol('settlement');

export interface SettlementState {
  readonly status: SettlementStatus;
  readonly rail: SettlementRail;
  /** on-chain reference — ALWAYS shown & copyable (§1.3): xrpl/evm tx hash or 5792 bundle id. */
  readonly ref: string;
  /** explorer link when derivable from ref+rail. */
  readonly explorerUrl?: string;
  /** honest failure/stall detail (which call reverted, or "can't auto-confirm"). */
  readonly reason?: string;
  /**
   * EVM chain the operation settles on (B5-UI paso 1.4). Undefined = legacy
   * handle → Flare behaviour. With chainId 1 (eth-morpho flow) the explorer
   * link, the wait ceiling and the receipt poll all anchor to Ethereum —
   * otherwise the poll would search the hash on whatever chain is ACTIVE.
   */
  readonly chainId?: number;
  /** private brand — components cannot fabricate a state (§2). */
  readonly [BRAND]: true;
}

function make(
  status: SettlementStatus,
  rail: SettlementRail,
  ref: string,
  extra?: { explorerUrl?: string; reason?: string; chainId?: number },
): SettlementState {
  return {
    status, rail, ref,
    explorerUrl: extra?.explorerUrl, reason: extra?.reason, chainId: extra?.chainId,
    [BRAND]: true,
  };
}

/** Start: after the wallet returns, the PRIMARY state is pending (never 'done'). */
export function startPending(
  rail: SettlementRail,
  ref: string,
  explorerUrl?: string,
  chainId?: number,
): SettlementState {
  return make('pending', rail, ref, {
    explorerUrl: explorerUrl ?? explorerUrlFor(rail, ref, chainId),
    chainId,
  });
}

/** Explorer link when the ref is a REAL tx hash. A 5792 bundle id is opaque —
 *  no explorer knows it — so that rail links only after the receipt upgrade. */
export function explorerUrlFor(rail: SettlementRail, ref: string, chainId?: number): string | undefined {
  if (rail === 'evm') {
    return chainId === 1 ? `https://etherscan.io/tx/${ref}` : `https://flarescan.com/tx/${ref}`;
  }
  if (rail === 'xrpl-mint' || rail === 'xrpl-tx' || rail === 'council-order') {
    return `https://livenet.xrpl.org/transactions/${ref}`;
  }
  return undefined;
}

export function toSettled(
  prev: SettlementState,
  upgrade?: { ref?: string; explorerUrl?: string },
): SettlementState {
  // §1.3 upgrade path: a 5792 bundle id is opaque, but once CONFIRMED the receipts
  // carry the REAL tx hash — settle with the linkable ref, never lose the old one
  // conceptually (the pending record was keyed by it and is cleared by the caller).
  return make('settled', prev.rail, upgrade?.ref ?? prev.ref, {
    explorerUrl:
      upgrade?.explorerUrl ??
      prev.explorerUrl ??
      explorerUrlFor(prev.rail, upgrade?.ref ?? prev.ref, prev.chainId),
    chainId: prev.chainId,
  });
}
export function toFailed(prev: SettlementState, reason: string): SettlementState {
  return make('failed', prev.rail, prev.ref, {
    explorerUrl: prev.explorerUrl, reason, chainId: prev.chainId,
  });
}
export function toStalled(prev: SettlementState, reason: string): SettlementState {
  return make('stalled', prev.rail, prev.ref, {
    explorerUrl: prev.explorerUrl, reason, chainId: prev.chainId,
  });
}

// ── §1.1 — EIP-5792 evaluation (pure) ────────────────────────────────────────
// A bundle CONFIRMED with a reverted call is NOT a success. Wallets report status and
// receipt.status heterogeneously (string 'CONFIRMED'/'success', numeric 200/1, hex '0x1');
// normalise all of them.

export function isCallsConfirmed(status: unknown): boolean {
  if (typeof status === 'string') return status.toUpperCase() === 'CONFIRMED';
  if (typeof status === 'number') return status === 200; // EIP-5792 numeric: 200 = confirmed
  return false;
}
export function isReceiptSuccess(status: unknown): boolean {
  return (
    status === 'success' ||
    status === 1 ||
    status === '0x1' ||
    status === true ||
    (typeof status === 'bigint' && status === BigInt(1))
  );
}

// ── MINED WITHOUT EFFECT: a Compound-v2 code is not a success ───────
// Kinetic (Compound v2) does not revert a refused redeem/borrow/repay: it
// RETURNS an error code and emits `Failure(uint256 error, uint256 info,
// uint256 detail)`. The transaction mines with status 1, gas is paid, nothing
// moves — and `isReceiptSuccess` alone read that receipt as settled (mainnet
// probe: `redeemUnderlying(1e12)` from an empty account → 0x…09,
// MATH_ERROR, status 1). A receipt is a success only when its status is 1 AND
// its logs carry no Compound `Failure`.

export interface ReceiptLogLike {
  topics?: readonly unknown[];
  data?: unknown;
  address?: unknown;
}
export interface ReceiptLike {
  status?: unknown;
  logs?: readonly ReceiptLogLike[] | undefined;
}

/** keccak256("Failure(uint256,uint256,uint256)") — Compound v2 ErrorReporter. */
export const COMPOUND_FAILURE_TOPIC = '0x45b96fe442630264581b197e84bbada861235052c5a1aadfff9ea4e40a969aa0';

/** Compound v2 ErrorReporter.Error — what a Kinetic kToken RETURNS instead of reverting. */
export const COMPOUND_ERROR_NAMES = [
  'NO_ERROR',
  'UNAUTHORIZED',
  'BAD_INPUT',
  'COMPTROLLER_REJECTION',
  'COMPTROLLER_CALCULATION_ERROR',
  'INTEREST_RATE_MODEL_ERROR',
  'INVALID_ACCOUNT_PAIR',
  'INVALID_CLOSE_AMOUNT_REQUESTED',
  'INVALID_COLLATERAL_FACTOR',
  'MATH_ERROR',
  'MARKET_NOT_FRESH',
  'MARKET_NOT_LISTED',
  'TOKEN_INSUFFICIENT_ALLOWANCE',
  'TOKEN_INSUFFICIENT_BALANCE',
  'TOKEN_INSUFFICIENT_CASH',
  'TOKEN_TRANSFER_IN_FAILED',
  'TOKEN_TRANSFER_OUT_FAILED',
] as const;

export function compoundErrorName(code: number): string {
  return COMPOUND_ERROR_NAMES[code] ?? `COMPOUND_ERROR_${code}`;
}

export interface CompoundFailure {
  error: number;
  info: number;
  detail: number;
}

function word(hex: string, i: number): number | null {
  const chunk = hex.slice(i * 64, (i + 1) * 64);
  if (chunk.length !== 64 || !/^[0-9a-f]+$/.test(chunk)) return null;
  const n = Number.parseInt(chunk, 16);
  return Number.isSafeInteger(n) ? n : null;
}

/** The first Compound `Failure(error, info, detail)` in a receipt's logs, decoded — or null. */
export function compoundFailureIn(logs: readonly ReceiptLogLike[] | null | undefined): CompoundFailure | null {
  for (const log of logs ?? []) {
    const topic0 = log?.topics?.[0];
    if (typeof topic0 !== 'string' || topic0.toLowerCase() !== COMPOUND_FAILURE_TOPIC) continue;
    const data = typeof log.data === 'string' ? log.data.toLowerCase().replace(/^0x/, '') : '';
    const error = word(data, 0);
    // A Failure with code 0 is not a failure (Compound never emits it, but a
    // decoder that cannot read the code must not invent one).
    if (error == null || error === 0) continue;
    return { error, info: word(data, 1) ?? 0, detail: word(data, 2) ?? 0 };
  }
  return null;
}

/** Reason CODE for a mined-without-effect receipt (the UI translates it). */
export function noEffectReason(f: CompoundFailure, step?: number): string {
  const base = `MINED_NO_EFFECT:COMPOUND:${f.error}:${f.info}:${f.detail}`;
  return step != null && step > 0 ? `${base}:STEP:${step}` : base;
}

/** Parse `noEffectReason` back: the Compound code and the batch step (null when single). */
export function parseNoEffect(reason: string | undefined): { failure: CompoundFailure; step: number | null } | null {
  const m = /^MINED_NO_EFFECT:COMPOUND:(\d+):(\d+):(\d+)(?::STEP:(\d+))?$/.exec(reason ?? '');
  if (!m) return null;
  return {
    failure: { error: Number(m[1]), info: Number(m[2]), detail: Number(m[3]) },
    step: m[4] != null ? Number(m[4]) : null,
  };
}

/** Status 1 AND no Compound `Failure` in the logs — the ONLY receipt that means «done». */
export function receiptHasEffect(receipt: ReceiptLike): boolean {
  return isReceiptSuccess(receipt.status) && compoundFailureIn(receipt.logs) === null;
}

export interface CallsStatusLike {
  status?: unknown;
  receipts?: Array<{ status?: unknown; transactionHash?: unknown; logs?: readonly ReceiptLogLike[] }> | undefined;
}

/** Pure verdict for a getCallsStatus poll. `done=false` ⇒ keep polling. */
export function evaluate5792(result: CallsStatusLike): { done: boolean; failed: boolean; reason?: string } {
  if (!isCallsConfirmed(result.status)) return { done: false, failed: false };
  const receipts = result.receipts ?? [];
  const revertedIdx = receipts.findIndex((r) => !isReceiptSuccess(r?.status));
  if (revertedIdx >= 0) {
    // Code, not prose — the UI translates (settlementReasonText).
    return { done: true, failed: true, reason: `BATCH_CALL_REVERTED:${revertedIdx + 1}` };
  }
  // Every receipt is status 1; a Compound `Failure` inside one of them
  // is a call that mined WITHOUT effect (EIP-5792 receipts carry `logs`).
  for (let i = 0; i < receipts.length; i++) {
    const f = compoundFailureIn(receipts[i]?.logs);
    if (f) return { done: true, failed: true, reason: noEffectReason(f, i + 1) };
  }
  return { done: true, failed: false };
}

/**
 * batch-evm — the step named by `BATCH_CALL_REVERTED:N`, or null.
 * The code is EMITTED here, so it is parsed here too: one regex, no second
 * grammar for the same string living in the UI layer.
 */
export function batchRevertedStep(reason: string | undefined): number | null {
  const m = /^BATCH_CALL_REVERTED:(\d+)$/.exec(reason ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * batch-evm — «the batch failed» is NOT «nothing was applied».
 *
 * §1.1 above states it plainly: a bundle can be CONFIRMED with an individual
 * call reverted. So when call N>1 is the one that reverted, calls 1..N-1 ALREADY
 * RAN — the approve went through, the supply went through, and only the last
 * leg died. Re-signing the array repeats every one of them with real money.
 */
export function isPartialBatchFailure(reason: string | undefined): boolean {
  const n = batchRevertedStep(reason) ?? parseNoEffect(reason)?.step ?? null;
  return n !== null && n > 1;
}

// ── §1.3 — wait ceiling, PER RAIL ────────────────────────────────────────────
// The normal confirm times differ by orders of magnitude, so ONE global ceiling would
// mark the flagship XRPL mint 'stalled' on its NORMAL path (pessimist "the screen lies").
// The ceiling only decides when to SHOW the honest "taking longer" state — the hook keeps
// polling past it (§3), so a late settlement is still caught.
export const EVM_SETTLE_CEILING_MS = 90_000; // 5792 / EVM confirm in seconds — 90s is generous ON FLARE.
// Ethereum L1 (eth-morpho flow): inclusion can take several blocks under gas
// pressure — 90s would paint honest-but-false "taking longer" on the NORMAL
// path. 180s before the honest slow state (the hook keeps polling past it).
export const ETHEREUM_SETTLE_CEILING_MS = 180_000;
// XRPL mint passes through an FDC attestation round + executor. CALIBRATED with our own
// on-chain measurement: n=166 mainnet direct-mint executions on
// AssetManagerFXRP (22–25 jul), t_executed − t_xrpl taken from each FDC proof's XRPL
// timestamp vs the Flare execution block — p50 129s · p90 166s · max 239s. 360s = 1.5× the
// observed max: zero false "taking longer" states in the whole sample, with guardband for a
// degraded FDC round. Consistent with the council card's "2–5 min".
export const XRPL_MINT_SETTLE_CEILING_MS = 6 * 60_000;

export function ceilingForRail(rail: SettlementRail, chainId?: number): number {
  // council-order rides the SAME FDC round as the mint (2–5 min normal path);
  // xrpl-tx is a plain ledger validation (~4–8 s) → the 90 s ceiling is ample.
  if (rail === 'xrpl-mint' || rail === 'council-order') return XRPL_MINT_SETTLE_CEILING_MS;
  if ((rail === 'evm' || rail === 'evm-5792') && chainId === 1) return ETHEREUM_SETTLE_CEILING_MS;
  return EVM_SETTLE_CEILING_MS;
}
export function isPastCeiling(
  rail: SettlementRail,
  startedAtMs: number,
  nowMs: number,
  chainId?: number,
): boolean {
  return nowMs - startedAtMs >= ceilingForRail(rail, chainId);
}

// ── §3/§2 — pending PERSISTENCE (survive reload), keyed PER ref, with expiry ──
// If the user signs then closes/reloads while pending, in-memory state would lose the
// operation and the UI would show "nothing" though Flare settled it → persist so the
// machine RESUMES polling on remount.
//   §2.1 keyed PER ref (not one global key): two ops (E1 then a borrow) must not overwrite
//        each other's tracking. Per-ref localStorage keys ALSO avoid the read-modify-write
//        map race across tabs (§2.3) — two tabs write different keys, no clobber; the same
//        ref resuming in two tabs is idempotent (the poll is a read; clear is idempotent).
//   §2.2 EXPIRY by age: a 3-day-old pending points to a dead artifact ("persisted record →
//        dead artifact", the attestation-cache lesson). Prune on load; window >> any ceiling.
const PENDING_PREFIX = 'astryum:settlement-pending:';
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h ≫ the 6-min XRPL ceiling.

export interface PendingRef {
  rail: SettlementRail;
  ref: string;
  explorerUrl?: string;
  /** EVM chain of the op (see SettlementState.chainId) — survives the reload. */
  chainId?: number;
  startedAt: number;
  /** La ventana de operación que firmó esto (operationStore id, p.ej.
   *  'vault:v-earnxrp'): al recargar, esa ventana rehidratada adopta el
   *  asiento y reabre en su fase «en proceso». */
  opKey?: string;
}

/** Fired on window every time a pending is saved — lets shell surfaces (the
 *  sidebar "In progress" card) pick up ops signed AFTER their own mount,
 *  without the modal and the shell having to know about each other. */
export const PENDING_CHANGED_EVENT = 'astryum:settlement-pending-changed';

export function savePending(p: PendingRef): void {
  try {
    window.localStorage.setItem(PENDING_PREFIX + p.ref, JSON.stringify(p));
    window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
  } catch {
    /* private mode — resume-on-reload unavailable, no green invented */
  }
}
export function clearPending(ref: string): void {
  try {
    window.localStorage.removeItem(PENDING_PREFIX + ref);
  } catch {
    /* ignore */
  }
}
/** Every FRESH pending; PRUNES (deletes) any past PENDING_MAX_AGE_MS or malformed. Used to
 *  resume polling on mount — never resurrects a dead ref. */
export function loadAllPending(nowMs: number = Date.now()): PendingRef[] {
  const out: PendingRef[] = [];
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (!k || !k.startsWith(PENDING_PREFIX)) continue;
      let p: PendingRef | null = null;
      try {
        p = JSON.parse(ls.getItem(k) ?? '') as PendingRef;
      } catch {
        p = null;
      }
      if (
        !p ||
        typeof p.ref !== 'string' ||
        typeof p.startedAt !== 'number' ||
        !(SETTLEMENT_RAILS as readonly string[]).includes(p.rail)
      ) {
        ls.removeItem(k); // rail corrupto incluido — jamás llega al tracker (bucle caliente)
        continue;
      }
      if (nowMs - p.startedAt >= PENDING_MAX_AGE_MS) {
        ls.removeItem(k); // §2.2 — expire the dead ref, don't try to resurrect it
        continue;
      }
      out.push(p);
    }
  } catch {
    /* ignore */
  }
  return out;
}

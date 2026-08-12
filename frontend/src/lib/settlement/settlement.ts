/**
 * settlement — the ONE state machine for the mint/entry flows (R1).
 *
 * The three sites that used to paint a premature green (FlareDemoEarn.sign(), the EVM /
 * 5792 rail, CompleteBorrowModal) are the SAME bug in three places. They now consume this
 * machine; none of them can paint success on its own.
 *
 * §2 — success is machine-only, enforced by TYPES: a `SettlementState` carries a private
 * brand symbol, so a component CANNOT construct a settled state literal. The only way to
 * obtain one is from this module's producers below.
 *
 * Per-rail "settled" (source of truth):
 *   - xrpl-mint : GET /flare-demo/mint-status/:hash → executed (MasterAccountController).
 *   - evm       : the real receipt (already awaited by useWalletPartner for single &
 *                 sequential rails, so those arrive already-confirmed).
 *   - evm-5792  : wallet_getCallsStatus → CONFIRMED **and every receipt a success**
 *                 (§1.1 — a bundle can be CONFIRMED with an individual call reverted).
 *
 * §1.2 unsupported getCallsStatus and §1.3 the wait ceiling end in HONEST states
 * ('stalled'), never a fake green and never an infinite spinner: the ref (tx hash / bundle
 * id) is always carried and shown, copyable.
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
  /** private brand — components cannot fabricate a state (§2). */
  readonly [BRAND]: true;
}

function make(
  status: SettlementStatus,
  rail: SettlementRail,
  ref: string,
  extra?: { explorerUrl?: string; reason?: string },
): SettlementState {
  return { status, rail, ref, explorerUrl: extra?.explorerUrl, reason: extra?.reason, [BRAND]: true };
}

/** Start: after the wallet returns, the PRIMARY state is pending (never 'done'). */
export function startPending(rail: SettlementRail, ref: string, explorerUrl?: string): SettlementState {
  return make('pending', rail, ref, { explorerUrl: explorerUrl ?? explorerUrlFor(rail, ref) });
}

/** Explorer link when the ref is a REAL tx hash. A 5792 bundle id is opaque —
 *  no explorer knows it — so that rail links only after the receipt upgrade. */
export function explorerUrlFor(rail: SettlementRail, ref: string): string | undefined {
  if (rail === 'evm') return `https://flarescan.com/tx/${ref}`;
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
    explorerUrl: upgrade?.explorerUrl ?? prev.explorerUrl,
  });
}
export function toFailed(prev: SettlementState, reason: string): SettlementState {
  return make('failed', prev.rail, prev.ref, { explorerUrl: prev.explorerUrl, reason });
}
export function toStalled(prev: SettlementState, reason: string): SettlementState {
  return make('stalled', prev.rail, prev.ref, { explorerUrl: prev.explorerUrl, reason });
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

export interface CallsStatusLike {
  status?: unknown;
  receipts?: Array<{ status?: unknown; transactionHash?: unknown }> | undefined;
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
  return { done: true, failed: false };
}

// ── §1.3 — wait ceiling, PER RAIL ────────────────────────────────────────────
// The normal confirm times differ by orders of magnitude, so ONE global ceiling would
// mark the flagship XRPL mint 'stalled' on its NORMAL path (pessimist "the screen lies").
// The ceiling only decides when to SHOW the honest "taking longer" state — the hook keeps
// polling past it (§3), so a late settlement is still caught.
export const EVM_SETTLE_CEILING_MS = 90_000; // 5792 / EVM confirm in seconds — 90s is generous.
// XRPL mint passes through an FDC attestation round + executor. CALIBRATED with our own
// on-chain measurement (2026-07-25): n=166 mainnet direct-mint executions on
// AssetManagerFXRP (22–25 jul), t_executed − t_xrpl taken from each FDC proof's XRPL
// timestamp vs the Flare execution block — p50 129s · p90 166s · max 239s. 360s = 1.5× the
// observed max: zero false "taking longer" states in the whole sample, with guardband for a
// degraded FDC round. Consistent with the council card's "2–5 min".
export const XRPL_MINT_SETTLE_CEILING_MS = 6 * 60_000;

export function ceilingForRail(rail: SettlementRail): number {
  // council-order rides the SAME FDC round as the mint (2–5 min normal path);
  // xrpl-tx is a plain ledger validation (~4–8 s) → the 90 s ceiling is ample.
  return rail === 'xrpl-mint' || rail === 'council-order'
    ? XRPL_MINT_SETTLE_CEILING_MS
    : EVM_SETTLE_CEILING_MS;
}
export function isPastCeiling(rail: SettlementRail, startedAtMs: number, nowMs: number): boolean {
  return nowMs - startedAtMs >= ceilingForRail(rail);
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
  startedAt: number;
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

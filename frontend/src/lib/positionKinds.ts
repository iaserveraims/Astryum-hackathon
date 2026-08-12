/**
 * What a position's capital is DOING — the one classifier every surface reads.
 *
 * The Summary ring and the Portfolio table used to each keep their own list of
 * "kinds that earn", and neither knew about CLAIM — the kind an adapter emits
 * for a queued vault exit (shares already redeemed, assets released later).
 * The result (founder, 2026-08-01): money on its way out of Firelight showed up
 * in the SAME slate slice as coins sitting idle in the wallet, and the ring read
 * "Working $0.00 (0%)" while a withdrawal was in flight.
 *
 * Four states, and money in flight is its own — never folded into idle:
 *   earning  — deployed and generating (supply, stake, LP, rewards)
 *   inflight — leaving a venue: redeemed/queued, arrives on a known date
 *   debt     — open borrow (neither held nor working; excluded from totals)
 *   idle     — sitting still (wallet balance, XRPL escrow)
 *
 * Whether a QUEUED exit still earns is protocol truth, not a guess, so it is
 * read from the adapter's own metadata (`stillEarning`) instead of assumed:
 *   · Firelight — `_requestWithdraw` fixes your FXRP at request time
 *     (`withdrawAssets[period] += previewRedeem(shares)`, verified on-chain
 *     2026-08-01) → it stops compounding the moment you sign.
 *   · Sceptre  — `_redeem` prices the request at `startedAt + cooldownPeriod`
 *     (same verification) → it KEEPS compounding through the 14.5-day cooldown.
 * Same shape, opposite answer: only the adapter can say which.
 */

export type CapitalState = 'earning' | 'inflight' | 'debt' | 'idle';

/** Kinds whose capital is deployed and generating for the holder. */
const EARNING_KINDS = new Set(['supply', 'collateral', 'stake', 'staking', 'lp', 'reward', 'rewards']);

/** Open debt: neither an asset held nor capital at work. */
const DEBT_KINDS = new Set(['debt', 'borrow']);

/** Money in flight: a queued vault exit (redeemed, awaiting release). */
const INFLIGHT_KINDS = new Set(['claim']);

/** The minimum shape any surface's position rows already satisfy. */
export interface KindedPosition {
  kind?: string | null;
  metadata?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

/** Metadata an adapter attaches to a queued exit (see `exitInfo`). */
export interface ExitInfo {
  /** true once the venue lets the user claim (the money stopped moving). */
  claimable: boolean;
  /** ISO time the exit becomes claimable; null when the venue can't say yet. */
  availableAt: string | null;
  /** ISO time the claim window shuts (Sceptre re-stakes overdue requests). */
  expiresAt: string | null;
  /** Protocol truth: does this queued exit still generate while it waits? */
  stillEarning: boolean;
}

function meta(p: KindedPosition): Record<string, unknown> {
  const m = p.metadata;
  return m && typeof m === 'object' ? m : {};
}

/** The queued-exit detail of a position, or null when it isn't one. */
export function exitInfo(p: KindedPosition): ExitInfo | null {
  if (!INFLIGHT_KINDS.has(String(p.kind ?? '').toLowerCase())) return null;
  const m = meta(p);
  const iso = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    claimable: m.claimable === true,
    availableAt: iso(m.availableAt),
    expiresAt: iso(m.expiresAt),
    stillEarning: m.stillEarning === true,
  };
}

/** What this position's capital is doing right now. */
export function positionState(p: KindedPosition): CapitalState {
  const kind = String(p.kind ?? '').toLowerCase();
  if (DEBT_KINDS.has(kind)) return 'debt';
  if (INFLIGHT_KINDS.has(kind)) {
    // A queued exit that keeps compounding (Sceptre's cooldown) is still work;
    // one whose value froze at signing (Firelight) is money in transit.
    return exitInfo(p)?.stillEarning ? 'earning' : 'inflight';
  }
  if (EARNING_KINDS.has(kind)) return 'earning';
  return 'idle';
}

/** Earliest arrival date across a set of in-flight positions (null if none). */
export function nextArrival(positions: KindedPosition[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const p of positions) {
    const at = exitInfo(p)?.availableAt;
    if (!at) continue;
    const t = new Date(at).getTime();
    if (!Number.isFinite(t)) continue;
    if (best == null || t < best) {
      best = t;
      bestIso = at;
    }
  }
  return bestIso;
}

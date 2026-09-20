/**
 * vaultClaimsTick — the one tick of the "money in flight" watcher
 * (hooks/useVaultClaimsWatcher), pulled out of React so it can be RUN.
 *
 * WHY THIS FILE EXISTS (it. 31). it. 29 taught `/vault-claims` to answer 502
 * VAULT_CLAIMS_UNREADABLE instead of 200 with an empty queue. The hook that
 * consumes it did `if (!res.ok) return null` and then `setEntries(next)`: a
 * refused read contributed no rows and the new list REPLACED the old one. The
 * queued exit — shares already burned, FXRP waiting — vanished from the tray
 * exactly as before, one floor up; the tray, seeing no rows and no notice,
 * went quiet: «nothing waiting for you».
 *
 * The rule, in code a test can hold:
 *   · a read that FAILED keeps the owner's LAST GOOD rows and is named in
 *     `unreadable` — «no pude leer» is not an empty queue;
 *   · a PARTIAL sweep (200, `queueRead: 'partial'`) takes the rows that
 *     answered and keeps the last good rows of the periods that did not;
 *   · only a LIVE read replaces an owner's rows outright.
 *
 * Read only. Nothing here signs, custodies or broadcasts.
 */

export interface VaultClaimEntry {
  /** 'firelight' — the only queued-exit vault today. */
  vault: 'firelight';
  vaultLabel: string;
  /** The 0x account that queued the exit (EVM wallet or Smart Account). */
  owner: string;
  period: number;
  /** FXRP queued for release (base units, 6 dec). The stXRP shares burned at
   *  redeem — `withdrawalsOf` reports the assets waiting, not shares. */
  queuedFxrpBase: string;
  /** Estimated FXRP the claim releases (base units); null if unreadable. */
  estFxrpBase: string | null;
  /** true once the period ended — claimWithdraw succeeds now. */
  claimable: boolean;
  /** ISO end of the still-running period (null once claimable). */
  claimableAt: string | null;
  /** it. 31 — this row is the LAST GOOD read of a period the latest tick could
   *  not re-read. It is kept, never invented: the server refused or skipped
   *  that period, so the money it describes is «still queued as far as we
   *  last saw», not «confirmed just now». */
  stale?: boolean;
}

/** One `pending[]` row exactly as GET /flare-demo/vault-claims/:owner serves it. */
export interface PendingRow {
  period: number;
  queuedFxrpBase: string;
  estFxrpBase: string | null;
  claimable: boolean;
  claimableAt: string | null;
}

/** What one owner's read came back as. */
export type OwnerQueueRead =
  | { kind: 'live'; owner: string; pending: PendingRow[] }
  | { kind: 'partial'; owner: string; pending: PendingRow[]; unreadablePeriods: number[]; detail: string | null }
  | { kind: 'unreadable'; owner: string; status: number | null; error: string | null; detail: string | null };

/** An owner whose queue the last tick could not (fully) read — what the tray must say. */
export interface VaultClaimsUnreadable {
  owner: string;
  /** 'all' = the read was refused/failed outright; 'partial' = some periods did not answer. */
  kind: 'all' | 'partial';
  /** The periods that did not answer (partial only). */
  periods?: number[];
  status: number | null;
  /** The server's code (e.g. VAULT_CLAIMS_UNREADABLE) — for the refusal reader, never for the screen raw. */
  error: string | null;
  detail: string | null;
}

/** Minimal fetch surface, so the tick can be run with a fake. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; credentials?: 'include' }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function isPendingRow(v: unknown): v is PendingRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.period === 'number' && typeof r.queuedFxrpBase === 'string' && typeof r.claimable === 'boolean';
}

/**
 * Read ONE owner's queue. Every failure — HTTP refusal, network, a body that
 * is not a queue — is an `unreadable` read, never an empty one. A 200 without
 * a `pending` array is not a read either (the it. 29 lesson: a 200 that
 * carries nothing is the shape every proxy and error envelope produces).
 */
export async function readOwnerQueue(
  owner: string,
  fetchImpl: FetchLike,
  apiBase: string,
  headers: Record<string, string>,
): Promise<OwnerQueueRead> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${apiBase}/flare-demo/vault-claims/${owner}`, { headers, credentials: 'include' });
  } catch (e) {
    return { kind: 'unreadable', owner, status: null, error: 'NETWORK', detail: (e as Error)?.message ?? null };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return { kind: 'unreadable', owner, status: res.status, error: str(body?.error), detail: str(body?.detail) };
  }
  const pendingRaw = body?.pending;
  if (!Array.isArray(pendingRaw)) {
    return { kind: 'unreadable', owner, status: res.status, error: 'QUEUE_BODY_UNREADABLE', detail: null };
  }
  const pending = pendingRaw.filter(isPendingRow);
  const unreadablePeriods = Array.isArray(body?.unreadablePeriods)
    ? (body!.unreadablePeriods as unknown[]).filter((p): p is number => typeof p === 'number')
    : [];
  if (body?.queueRead === 'partial' || unreadablePeriods.length > 0) {
    return { kind: 'partial', owner, pending, unreadablePeriods, detail: str(body?.detail) };
  }
  return { kind: 'live', owner, pending };
}

function rowOf(owner: string, p: PendingRow): VaultClaimEntry {
  return {
    vault: 'firelight',
    vaultLabel: 'stXRP',
    owner,
    period: p.period,
    queuedFxrpBase: p.queuedFxrpBase,
    estFxrpBase: p.estFxrpBase,
    claimable: p.claimable,
    claimableAt: p.claimableAt,
  };
}

function sortEntries(list: VaultClaimEntry[]): VaultClaimEntry[] {
  return [...list].sort((a, b) => Number(b.claimable) - Number(a.claimable) || b.period - a.period);
}

/**
 * Fold the owners' reads into the next list, over the PREVIOUS one.
 *
 * `prev` is the last list the watcher showed. An owner whose read failed keeps
 * every row it had (marked `stale`); a partial read keeps only the rows of the
 * periods that did not answer; a live read replaces the owner's rows. Owners
 * that are no longer watched (not in `reads`) drop out — that is a change of
 * authority, not a failed read.
 */
export function mergeClaimsTick(
  prev: VaultClaimEntry[],
  reads: OwnerQueueRead[],
): { entries: VaultClaimEntry[]; unreadable: VaultClaimsUnreadable[] } {
  const next: VaultClaimEntry[] = [];
  const unreadable: VaultClaimsUnreadable[] = [];
  for (const r of reads) {
    const owner = r.owner.toLowerCase();
    const mine = prev.filter((e) => e.owner.toLowerCase() === owner);
    if (r.kind === 'live') {
      next.push(...r.pending.map((p) => rowOf(r.owner, p)));
      continue;
    }
    if (r.kind === 'partial') {
      const unread = new Set(r.unreadablePeriods);
      next.push(...r.pending.map((p) => rowOf(r.owner, p)));
      // The periods nobody read this time keep what we last saw of them.
      next.push(...mine.filter((e) => unread.has(e.period)).map((e) => ({ ...e, stale: true })));
      unreadable.push({
        owner: r.owner,
        kind: 'partial',
        periods: r.unreadablePeriods,
        status: 200,
        error: null,
        detail: r.detail,
      });
      continue;
    }
    // unreadable: the whole owner keeps its last good rows.
    next.push(...mine.map((e) => ({ ...e, stale: true })));
    unreadable.push({ owner: r.owner, kind: 'all', status: r.status, error: r.error, detail: r.detail });
  }
  return { entries: sortEntries(next), unreadable };
}

/**
 * The tray's own decision, mirrored for the watcher's consumers: with ANY
 * owner unreadable, «nothing is waiting for you» may not be said — the rows
 * on screen may be the last good read, and the queue behind them is unknown.
 */
export function claimsQueueUnreadable(u: VaultClaimsUnreadable[] | null | undefined): boolean {
  return Array.isArray(u) && u.length > 0;
}

/**
 * portfolioUnreadable — what the Home and the Portfolio do with a snapshot
 * that could not be read in full (`snapshot.unreadable`, it. 31 / ola 0).
 *
 * THE FAILURE (ola 0, 15-sep, two reviewers). The backend has said since
 * it. 31 which adapters it could not read — and nobody on the client read
 * the sentence. `app/page.tsx` decided `NoPositionsCTA` on
 * `positions.length === 0` alone: the person signs a withdrawal, the forced
 * refresh lands on a 429, the snapshot comes back without Kinetic, and the
 * Home says «Your wallet is connected, but nothing is working yet — Open
 * your first strategy» over a live carry. This module is the reader.
 *
 * Pure: importable by vitest without the pages.
 */
import type { PortfolioSnapshot, PortfolioUnreadable } from '@/services/v1Api';

/** The unread entries of a snapshot, or [] — never undefined, never garbage. */
export function unreadableOf(snap: Pick<PortfolioSnapshot, 'unreadable'> | null | undefined): PortfolioUnreadable[] {
  const u = snap?.unreadable;
  if (!Array.isArray(u)) return [];
  return u.filter((e): e is PortfolioUnreadable => !!e && typeof e === 'object' && typeof (e as PortfolioUnreadable).protocolId === 'string');
}

export type HomePositionsVerdict =
  /** No snapshot yet. */
  | 'loading'
  /** Rows exist (some may still be unread — `unreadableOf` says which). */
  | 'positions'
  /** No rows AND something could not be read: «could not read», never «nothing». */
  | 'unreadable'
  /** No rows and every adapter answered: the honest empty state. */
  | 'empty';

/**
 * The Home's one decision about the «nothing is working yet» nudge. It is
 * only true when EVERY adapter answered; an unread adapter with zero rows
 * is «I don't know», which is never drawn as «nothing».
 */
export function homePositionsVerdict(
  snap: Pick<PortfolioSnapshot, 'positions' | 'unreadable'> | null | undefined,
): HomePositionsVerdict {
  if (!snap) return 'loading';
  const rows = Array.isArray(snap.positions) ? snap.positions.length : 0;
  if (rows > 0) return 'positions';
  return unreadableOf(snap).length > 0 ? 'unreadable' : 'empty';
}

/** Wallets named in the unread entries (a merged snapshot tags each with its wallet). */
export function unreadableWallets(entries: PortfolioUnreadable[], fallback?: string | null): string[] {
  const real = (w: string | null | undefined): string | null => (w && w !== 'all' ? w : null);
  const out = new Set<string>();
  for (const e of entries) {
    const w = real(e.wallet) ?? real(fallback);
    if (w) out.add(w);
  }
  return [...out];
}

/** English source for `t()`: one line per entry, the protocol first. */
export function unreadableLine(e: PortfolioUnreadable): string {
  const proto = e.protocolId;
  if (e.partial && e.reads && e.reads.length > 0) {
    return `${proto}: ${e.reads.length === 1 ? 'one read' : `${e.reads.length} reads`} did not answer (${e.reads.map((r) => r.what).join('; ')})`;
  }
  return `${proto}: ${e.reason}`;
}

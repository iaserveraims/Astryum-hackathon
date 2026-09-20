/**
 * positionRead — «could not read» is never «you are not in this vault».
 *
 * Why this exists: VaultDetailPanel turned every failed
 * `getPoteState` into `null`, and `null` rendered «You are not in this vault.»
 * while hiding «Leave this vault». A Personal Account that failed to resolve was
 * swallowed too, so shares held there simply vanished. A holder told they are
 * not in a vault may never try to leave — the exit is never gated, and neither
 * is the belief that there is something to exit.
 *
 * Pure: the component feeds it what it has read, and paints the verdict.
 */

import type { PoteState } from './api';

/** One holder's read (EVM wallet, or the Personal Account of the XRPL wallet). */
export type HolderRead = { status: 'pending' } | { status: 'ok'; state: PoteState } | { status: 'failed' };

/**
 * The Personal Account of the connected XRPL wallet:
 *  · 'none'      — no XRPL wallet connected, nothing to resolve
 *  · 'resolving' — asked, no answer yet
 *  · 'resolved'  — known, and included among the holders read
 *  · 'failed'    — asked and could not be resolved: shares held there are UNKNOWN
 */
export type PaResolution = 'none' | 'resolving' | 'resolved' | 'failed';

export type PositionView =
  | { kind: 'no-wallet' }
  | { kind: 'reading' }
  /** `state` is any holder read that did succeed (tickets are pot-wide), or null. */
  | { kind: 'failed'; reason: 'read' | 'personal-account'; state: PoteState | null }
  /** `incomplete` = another holder could not be read: this may not be the whole position. */
  | { kind: 'in'; state: PoteState; incomplete: boolean }
  | { kind: 'out'; state: PoteState };

export function hasShares(state: PoteState | null | undefined): boolean {
  const raw = state?.holder?.shares;
  if (!raw) return false;
  try {
    return BigInt(raw) > BigInt(0);
  } catch {
    return false;
  }
}

export function decidePosition(input: { pa: PaResolution; reads: HolderRead[] }): PositionView {
  const { pa, reads } = input;
  const okStates = reads.filter((r): r is { status: 'ok'; state: PoteState } => r.status === 'ok').map((r) => r.state);
  const anyFailed = reads.some((r) => r.status === 'failed');
  const anyPending = reads.some((r) => r.status === 'pending');

  // Shares found anywhere are a fact, whatever else failed.
  const withShares = okStates.find((s) => hasShares(s));
  if (withShares) {
    return { kind: 'in', state: withShares, incomplete: anyFailed || anyPending || pa === 'failed' || pa === 'resolving' };
  }

  if (anyPending || pa === 'resolving') return { kind: 'reading' };

  if (reads.length === 0) {
    return pa === 'failed' ? { kind: 'failed', reason: 'personal-account', state: null } : { kind: 'no-wallet' };
  }

  if (anyFailed) return { kind: 'failed', reason: 'read', state: okStates[0] ?? null };

  // Every holder we could see says zero — but the Personal Account is unknown, so
  // «not in this vault» would be a claim nobody can make.
  if (pa === 'failed') return { kind: 'failed', reason: 'personal-account', state: okStates[0] ?? null };

  return { kind: 'out', state: okStates[0] };
}

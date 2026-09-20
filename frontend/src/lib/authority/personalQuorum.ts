/**
 * personalQuorum — the E2 third state's marker.
 *
 * A SignerList on an account no longer implies a Legacy: the reinforced
 * personal account (E3 — phone + card + backup, quorum 2-of-3) is a PERSONAL
 * wallet whose keys are a quorum. The ledger cannot tell the two apart, so
 * the OWNER does, explicitly, with this marker:
 */

import { LEGACY_LOCAL_CHANGED_EVENT } from '../../components/legacy/legacyLocal';
import { addressKey, type Authority } from '../authority';

const MARKS_KEY = 'astryum-personal-quorum';

function emitChanged(): void {
  try {
    // The SAME event the legacy pointers fire: useAuthorities already
    // re-composes on it, so marking re-classifies without new wiring.
    window.dispatchEvent(new Event(LEGACY_LOCAL_CHANGED_EVENT));
  } catch {
    /* SSR — no listeners there */
  }
}

export function readPersonalQuorumMarks(): string[] {
  try {
    const raw = localStorage.getItem(MARKS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export function isPersonalQuorum(address: string): boolean {
  return readPersonalQuorumMarks().includes(address);
}

/** Mark an address as a personal quorum (idempotent). */
export function markPersonalQuorum(address: string): void {
  const list = readPersonalQuorumMarks();
  if (list.includes(address)) return;
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify([...list, address]));
  } catch {
    /* private mode — the mark simply won't persist */
  }
  emitChanged();
}

/** Remove the mark — the address falls back to the default. */
export function unmarkPersonalQuorum(address: string): void {
  const list = readPersonalQuorumMarks();
  if (!list.includes(address)) return;
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify(list.filter((a) => a !== address)));
  } catch {
    /* private mode */
  }
  emitChanged();
}

/**
 * The classification rule, pure and testable: does this account operate on
 * the PERSONAL side? A deliberate registry pointer (the user filed it under
 * "Mis Legacies") always wins over the mark — filing is the stronger intent.
 */
export function staysPersonal(input: { marked: boolean; registryId?: string }): boolean {
  return input.marked && !input.registryId;
}

/**
 * The addresses that are REINFORCED PERSONAL accounts: the ledger confirmed a
 * SignerList (`hardenedQuorum` is only ever set from a real read) AND their
 * owner keeps them on the personal side.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE COPIES. Two
 * surfaces need the same answer — Home paints the green shield with it, and
 * the Wallets screen uses it to decide who is NOT a council. The Wallets
 * screen got it wrong first: it treated *any* address with a SignerList as a
 * council and dropped it from the list, so finishing a reinforcement made the
 * wallet VANISH from the very screen the feature promises it stays on. The
 * rule has one home now; the consumers import it.
 */
export function reinforcedPersonalKeys(authorities: Authority[]): Set<string> {
  const keys = new Set<string>();
  for (const a of authorities) {
    if (a.kind === 'single' && a.hardenedQuorum?.hasCouncil === true) keys.add(addressKey(a.wallet.address));
  }
  return keys;
}

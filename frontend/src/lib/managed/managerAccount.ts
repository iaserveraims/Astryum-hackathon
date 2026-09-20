/**
 * managerAccount — WHICH XRPL account the manager desk and its setup ceremony
 * follow (pure; the hook `useManagerAccount` wires it to the stores).
 */

/** A Xaman session of this browser (walletStore). */
export interface ConnectedXaman {
  id: string;
  address: string;
  nickname?: string | null;
}

/** A wallet row linked to the Astryum account (useMyWallets). */
export interface LinkedWallet {
  id?: string;
  address: string;
  ecosystem?: string;
  walletType?: string;
  nickname?: string | null;
  label?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface ManagerCandidate {
  address: string;
  /** Connected in this browser: signs without a new QR hand-off. */
  live: boolean;
  /** The linked row, when the account has one (name, colour, glyph). */
  linked: LinkedWallet | null;
  /** The session row, when connected (to make it the active signer). */
  session: ConnectedXaman | null;
}

/** Synthetic rows the wallets list adds for governed accounts — never a manager. */
export const LEGACY_ROW_PREFIX = 'legacy:';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function isXrplLinkedWallet(w: LinkedWallet): boolean {
  if ((w.id ?? '').startsWith(LEGACY_ROW_PREFIX)) return false;
  if (w.ecosystem === 'xrpl') return true;
  return XRPL_ADDRESS_RE.test(w.address);
}

/** The XRPL wallets linked to the account that may act as manager. */
export function linkedManagerWallets<T extends LinkedWallet>(wallets: readonly T[]): T[] {
  return wallets.filter((w) => isXrplLinkedWallet(w));
}

/**
 * Connected first (they sign without a hand-off), then the linked-only ones;
 * one row per address, and a connected address keeps its linked row for its
 * name and colours.
 */
export function managerCandidates(
  connected: readonly ConnectedXaman[],
  linked: readonly LinkedWallet[],
): ManagerCandidate[] {
  const byAddress = new Map<string, LinkedWallet>();
  for (const w of linked) if (!byAddress.has(w.address)) byAddress.set(w.address, w);
  const out: ManagerCandidate[] = [];
  const seen = new Set<string>();
  for (const s of connected) {
    if (seen.has(s.address)) continue;
    seen.add(s.address);
    out.push({ address: s.address, live: true, linked: byAddress.get(s.address) ?? null, session: s });
  }
  for (const w of linked) {
    if (seen.has(w.address)) continue;
    seen.add(w.address);
    out.push({ address: w.address, live: false, linked: w, session: null });
  }
  return out;
}

/**
 * The account the desk follows: chosen by hand while it is still a candidate,
 * else the live session, else the first candidate (a linked wallet).
 */
export function resolveManagerAccount(
  candidates: readonly ManagerCandidate[],
  chosen: string | null,
  live: string | null,
): string | null {
  if (chosen && candidates.some((c) => c.address === chosen)) return chosen;
  if (live && candidates.some((c) => c.address === live)) return live;
  return candidates[0]?.address ?? null;
}

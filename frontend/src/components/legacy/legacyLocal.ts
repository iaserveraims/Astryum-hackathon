/**
 * legacyLocal — the client-side pointers of "Mis Legacies".
 *
 * XRPL has no reverse lookup ("which SignerLists contain X"), so the list of
 * Legacies a user governs is composed of pointers the user creates: addresses
 * they opened plus a nickname they chose. POINTERS ONLY (L1): the state
 * (council, health, constitution) is always read fresh from the ledger; if
 * this storage vanishes, nothing is lost but the pointers.
 *
 * Storage keys keep the original 'astryum-observed-legacies' for back-compat
 * with lists saved before the wizard existed.
 */

const OBSERVED_KEY = 'astryum-observed-legacies';
const NICKNAME_KEY = 'astryum-legacy-nicknames';

/** Fired after any pointer/nickname write so live composers (the authority
 *  switcher) re-read without coupling this module to a store. */
export const LEGACY_LOCAL_CHANGED_EVENT = 'astryum:legacy-local-changed';

function emitChanged(): void {
  try {
    window.dispatchEvent(new Event(LEGACY_LOCAL_CHANGED_EVENT));
  } catch {
    /* SSR / very old browsers — listeners simply don't exist there */
  }
}

export function readObservedLegacies(): string[] {
  try {
    const raw = localStorage.getItem(OBSERVED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

export function writeObservedLegacies(list: string[]): void {
  try {
    localStorage.setItem(OBSERVED_KEY, JSON.stringify(list));
  } catch {
    /* private mode — the pointers simply won't persist */
  }
  emitChanged();
}

/** Remember an address in "Mis Legacies" (idempotent). Called by the wizard on
 *  inspect, so every Legacy you open lands in your list — observing IS opening. */
export function rememberLegacy(address: string): void {
  const list = readObservedLegacies();
  if (!list.includes(address)) writeObservedLegacies([...list, address]);
}

export function forgetLegacy(address: string): void {
  writeObservedLegacies(readObservedLegacies().filter((a) => a !== address));
}

// ── constitution drafts — survive refresh/deploy, never leave the browser ───
// The builder form and the anchor editor are typed work (names, branches,
// conditions); losing them to a reload is unacceptable. Same privacy invariant
// as the rest of this module: LOCAL ONLY — only the SHA-256 is ever anchored.

const DRAFT_KEY = 'astryum-legacy-constitution-drafts';

export interface ConstitutionDraft {
  /** Builder: template picked + field values. */
  templateId?: string;
  values?: Record<string, string>;
  /** Anchor editor: the exact document text + optional URI. */
  docText?: string;
  docUri?: string;
  savedAt: string;
}

function readDrafts(): Record<string, ConstitutionDraft> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const map = raw ? (JSON.parse(raw) as unknown) : {};
    return map && typeof map === 'object' ? (map as Record<string, ConstitutionDraft>) : {};
  } catch {
    return {};
  }
}

export function getConstitutionDraft(account: string): ConstitutionDraft | undefined {
  return readDrafts()[account];
}

/** Merge-save: each surface persists only its own fields. */
export function saveConstitutionDraft(
  account: string,
  patch: Partial<Omit<ConstitutionDraft, 'savedAt'>>,
): void {
  try {
    const map = readDrafts();
    map[account] = { ...map[account], ...patch, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  } catch {
    /* private mode — the draft simply won't persist */
  }
}

export function clearConstitutionDraft(account: string): void {
  try {
    const map = readDrafts();
    delete map[account];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  } catch {
    /* private mode */
  }
}

// ── nicknames (apodos) — display-only, never leaves the browser ─────────────

function readNicknames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NICKNAME_KEY);
    const map = raw ? (JSON.parse(raw) as unknown) : {};
    return map && typeof map === 'object' ? (map as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getLegacyNickname(address: string): string | undefined {
  return readNicknames()[address];
}

export function setLegacyNickname(address: string, nickname: string): void {
  try {
    const map = readNicknames();
    const trimmed = nickname.trim();
    if (trimmed) map[address] = trimmed.slice(0, 40);
    else delete map[address];
    localStorage.setItem(NICKNAME_KEY, JSON.stringify(map));
  } catch {
    /* private mode */
  }
  emitChanged();
}

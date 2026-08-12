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
const OWNER_KEY = 'astryum-legacy-owner';

/**
 * Claim the legacy-local state for a signed-in user. If a DIFFERENT user owned
 * it, every trace is wiped first (pointers, nicknames, drafts, plans): the
 * write-buffer is browser-scoped, so without this an account switch inherited
 * the previous user's Legacies — and the registry drain then WROTE them into
 * the new user's registry (founder 2026-08-11: logging in with a second email
 * showed the main account's Legacy). Same philosophy as authStore's
 * disconnectWalletSession: account switches start clean.
 */
export function claimLegacyLocalOwner(userId: string): void {
  try {
    const prev = localStorage.getItem(OWNER_KEY);
    if (prev === userId) return;
    if (prev) {
      localStorage.removeItem(OBSERVED_KEY);
      localStorage.removeItem(NICKNAME_KEY);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(COUNCIL_PLAN_KEY);
      emitChanged();
    }
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    /* private mode — nothing persists, so nothing can leak either */
  }
}

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

/** Remove EVERY local trace of an address (founder 2026-08-11: removing a
 *  Legacy and re-adding it resurrected its nickname and half-written
 *  constitution draft — "quitar" must mean a clean slate). The ledger side is
 *  untouched by design: council, rehearsal and door are read fresh from chain
 *  and the wizard will honestly resume whatever the ledger says is done. */
export function forgetLegacy(address: string): void {
  writeObservedLegacies(readObservedLegacies().filter((a) => a !== address));
  setLegacyNickname(address, '');
  clearConstitutionDraft(address);
  clearCouncilPlan(address);
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

// ── council plans — the list the family decided, kept while it walks to Xaman ──
// The council itself is created in the Xaman Multisign xApp (Xaman refuses a
// SignerListSet composed by any app — error 1217), so the plan has to survive
// the trip to the phone and back: retyping five addresses from memory is how a
// typo gets in. POINTERS ONLY, same as the rest of this module — the authority
// is always the signer list read from the ledger. Cleared once the person
// confirms the council on-chain is the one they meant.

const COUNCIL_PLAN_KEY = 'astryum-legacy-council-plans';

export interface CouncilPlan {
  signers: Array<{ account: string; weight: string }>;
  quorum: string;
  /** Did the plan pass validation when it was saved? Half-typed work is kept
   *  (so switching slides never loses it) but is NEVER compared against the
   *  ledger — a plan with two of three addresses typed would "mismatch" a
   *  perfectly correct council and cry wolf at the worst possible moment. */
  complete: boolean;
  savedAt: string;
}

function readCouncilPlans(): Record<string, CouncilPlan> {
  try {
    const raw = localStorage.getItem(COUNCIL_PLAN_KEY);
    const map = raw ? (JSON.parse(raw) as unknown) : {};
    return map && typeof map === 'object' ? (map as Record<string, CouncilPlan>) : {};
  } catch {
    return {};
  }
}

export function getCouncilPlan(account: string): CouncilPlan | undefined {
  const plan = readCouncilPlans()[account];
  return Array.isArray(plan?.signers) ? plan : undefined;
}

export function saveCouncilPlan(
  account: string,
  plan: Omit<CouncilPlan, 'savedAt'>,
): void {
  try {
    const map = readCouncilPlans();
    map[account] = { ...plan, savedAt: new Date().toISOString() };
    localStorage.setItem(COUNCIL_PLAN_KEY, JSON.stringify(map));
  } catch {
    /* private mode — the plan simply won't persist */
  }
}

export function clearCouncilPlan(account: string): void {
  try {
    const map = readCouncilPlans();
    delete map[account];
    localStorage.setItem(COUNCIL_PLAN_KEY, JSON.stringify(map));
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

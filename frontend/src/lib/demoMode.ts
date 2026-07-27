'use client';

/**
 * demoMode — the public demo's client-side switch (founder 2026-07-18).
 *
 * Accounts created through the landing's "Launch demo" flag this device: the
 * dashboard then runs on FIXTURE data (previewData intercepts the reads) so
 * everything is usable with mock wallets and mock money, and the Legacy
 * product stays visibly present but gated behind an "under construction"
 * popup. The account itself is REAL (saved server-side for the full launch,
 * enrolled in the newsletter) — only the capital shown is fake.
 */

export const DEMO_FLAG_KEY = 'astryum:demo';
export const LEGACY_GATE_EVENT = 'astryum:legacy-coming-soon';
/** Set once the user connects/pastes a REAL wallet this session. R2 HARD CUT: a session
 *  with a real wallet must NEVER see the demo fixtures (mixing a real prepare/sign with a
 *  seeded dashboard is worse than pure fake). Flips isPreviewActive() to false. */
export const LIVE_FLAG_KEY = 'astryum:live';
export const LIVE_CHANGED_EVENT = 'astryum:live-changed';

export function isDemoMode(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(DEMO_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function enableDemoMode(): void {
  try {
    window.localStorage.setItem(DEMO_FLAG_KEY, '1');
    window.localStorage.removeItem(LIVE_FLAG_KEY); // demo = fixtures; reset any live session
  } catch {
    /* private mode — the demo simply reads real (empty) data */
  }
}

// §4 — PRECEDENCE (intentional, documented): enableDemoMode clears the live flag, but the
// next refreshMe() (authStore, runs on every mount) RE-MARKS it if the account has >=1
// linkedWallet. Net effect: an account that has EVER linked a real wallet cannot re-enter
// the fixture demo — refreshMe always wins on mount. This is FAIL-SAFE and deliberate: a
// real-wallet account must never see sample data. Do NOT "fix" this by weakening the
// re-mark; the one-way exit from demo is the guarantee.

export function hasLiveWalletSession(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(LIVE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Call when a real wallet is connected/pasted (walletLinkService.connectWallet). */
export function markLiveWalletSession(): void {
  try {
    window.localStorage.setItem(LIVE_FLAG_KEY, '1');
    window.dispatchEvent(new Event(LIVE_CHANGED_EVENT));
  } catch {
    /* private mode */
  }
}

/** Who is being gated — the popup adapts its copy to the audience. */
export type LegacyGateVariant =
  /** Public demo account: showcase copy ("ships with the full launch"). */
  | 'demo'
  /** Real beta account without Legacy access (LEGACY_ENABLED off and not on
   *  LEGACY_ACCESS_EMAILS): in-development copy, beta promise. */
  | 'beta';

/** Ask the globally-mounted LegacyComingSoonModal to open. */
export function openLegacyComingSoon(variant: LegacyGateVariant = 'demo'): void {
  try {
    window.dispatchEvent(new CustomEvent(LEGACY_GATE_EVENT, { detail: variant }));
  } catch {
    /* SSR — nothing to open */
  }
}

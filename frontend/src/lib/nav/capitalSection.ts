/**
 * CAPITAL SECTION — the nav destination for capital that is ALREADY committed.
 *
 * The counterpart to Earn: Earn is where you PUT assets to work, this is where
 * you watch and steer what is already working. Two gestures with two very
 * different frequencies — you visit Earn to decide something, you visit this
 * every week — so they are two rows, not one row with a door inside it
 * (founder, 2026-08-24, reversing the 2026-07-18 collapse).
 *
 * ── THE NAME ─────────────────────────────────────────────────────────────
 * `Running` / `En marcha` (founder 2026-08-29: «At Work confunde pensando
 * que desde allí pones tu dinero a trabajar» — the label read as a place to
 * START, which is Earn's job; this one says the motion already exists). It
 * also un-collides from the Portfolio's per-asset `Working/Trabajando`
 * status, which shared the old Spanish word. Still swappable in one edit.
 * Whatever wins must say
 * "your assets are working" WITHOUT asserting a gain: a label like `Earning`
 * (or `Yield`, `Growth`, `Returns`) claims a profit that a position in the red
 * does not have, and invariant #9 forbids stating yield as anything but
 * protocol data with its source. A menu row is the one string a user reads on
 * every screen — it must be true on the worst day, not just the good one.
 * `Earning` also sits one letter from `Earn` in the same sidebar, which is the
 * worst possible collision: nav rows are read out of the corner of the eye.
 *
 * ── WHY THE NAME LIVES HERE ──────────────────────────────────────────────
 * So the rename is ONE edit. Nothing hardcodes the label; every surface reads
 * it from this file.
 *
 * The two languages travel TOGETHER on purpose. Copy normally goes through
 * `t('literal')` against dict.ts, but `scripts/check-i18n.js` only sees LITERAL
 * arguments — a dynamic `t(LABEL)` is invisible to CI, so a missing Spanish
 * label would ship silently in a Spanish UI. Keeping the pair in one object
 * means a rename cannot leave one language behind, and there is no dict entry
 * to forget.
 *
 * ── WHY THE ROUTE DOES NOT CHANGE ────────────────────────────────────────
 * `/app/strategies` stays whatever the label becomes. It is the address every
 * existing deep-link already uses (ManualStrategyBuilder, ProtectRuleCard, the
 * Summary and Portfolio shortcuts), and this codebase already separates route
 * from label — `/app/asset-production` has been "Earn" for months. Renaming a
 * URL to match a label buys nothing and breaks links.
 */

import type { Lang } from '../../i18n/dict';

/** The route. Deliberately unchanged by any rename — see the header. */
export const CAPITAL_SECTION_HREF = '/app/strategies';

/**
 * THE NAME. Change these two strings and the whole app follows: the nav row,
 * the ⌘K entry and the page header all read from here.
 */
export const CAPITAL_SECTION_LABEL: Record<Lang, string> = {
  en: 'Running',
  es: 'En marcha',
};

export function capitalSectionLabel(lang: Lang): string {
  return CAPITAL_SECTION_LABEL[lang] ?? CAPITAL_SECTION_LABEL.en;
}

/**
 * The section's sub-tabs.
 *
 *  · `strategies` — everything YOU run: the live on-chain footprint, the
 *    MoneyFlows watching it, and the drafts you saved. This is the page that
 *    already existed; it keeps its own inner Running/Saved shelves.
 *  · `managed`    — the vaults where a THIRD-PARTY manager runs it inside the
 *    limits you signed (Product A). Founder-only until that flow exists.
 *
 * Note the sub-tab keeps the name `Strategies`, so every sentence in the app
 * that points at "Estrategias · Guardadas" stays true after the rename — the
 * umbrella name appears in exactly two places, both fed from this file.
 */
export type CapitalTab = 'strategies' | 'managed';

export const CAPITAL_TABS: readonly CapitalTab[] = ['strategies', 'managed'] as const;

export function isCapitalTab(v: unknown): v is CapitalTab {
  return v === 'strategies' || v === 'managed';
}

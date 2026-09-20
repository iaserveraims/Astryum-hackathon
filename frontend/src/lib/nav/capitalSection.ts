/**
 * CAPITAL SECTION — the nav destination for capital that is ALREADY committed.
 *
 * The counterpart to Earn: Earn is where you PUT assets to work, this is where
 * you watch and steer what is already working. Two gestures with two very
 * different frequencies — you visit Earn to decide something, you visit this
 * every week — so they are two rows, not one row with a door inside it.
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

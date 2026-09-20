/**
 * assetDisclosure — the regulatory notice a strategy card must carry when its
 * composition touches an asset that Astryum's own EU rule keeps OUT of its
 * EU-facing strategies.
 *
 * INVARIANTS.md #9: «EU-facing strategies: EMTs only (USDC, EURC, RLUSD).
 * USDT is read-only.» The Kinetic carry (e1) borrows USDT0 — the omnichain
 * form of Tether's USDT — which is precisely the asset that rule keeps out.
 *
 * The entry is NOT withdrawn: the borrow happens in Kinetic's own market,
 * Astryum only prepares an unsigned payload and the user signs it in their own
 * wallet (invariant #1). What was missing is the other half of that honesty —
 * saying WHAT is being borrowed, in regulatory terms, BEFORE the signature and
 * not after (founder 2026-08-18). A card that shows a live borrow APR and a
 * Start button, and stays silent about the asset's standing under MiCA, is
 * telling the EU reader half the story.
 *
 * Pure on purpose. Buried inside FlareDemoEarn.tsx this would be untestable by
 * NEIGHBOURHOOD, not by nature: that file drags AppKit and the whole wallet
 * stack into anything that imports it. Here the map and its accessor are
 * asserted for real — and every surface that shows the notice IMPORTS this one,
 * never keeps a copy of the sentence.
 */

import type { VaultKind } from './FlareDemoEarn';

export interface AssetNotice {
  /** The asset the notice is about — the notice's own tag. */
  asset: string;
  /**
   * The line the CARD FACE wears, before anyone opens the route (founder
   * 2026-09-17: «hay que poner un disclaimer en la card»). Until then the
   * notice lived only in the detail, the sheet and the review step — a reader
   * comparing cards saw a live rate and a title, and nothing about MiCA. Two
   * facts in one breath: it is a real product, and it does not comply.
   */
  face: string;
  /** One line, readable at a glance: the fact, never a verdict on the venue. */
  headline: string;
  /** The disclosure itself: what it is, what Astryum is not doing, the way out. */
  body: string;
}

/**
 * Keyed by pack. Only the packs whose composition touches a non-EMT appear —
 * a pack with no entry here has nothing to disclose on this axis, and the
 * surfaces render nothing at all (never an empty box).
 *
 * `em-carry` borrows RLUSD and `em-lend` lends it: RLUSD is an EMT under the
 * same invariant, so neither carries a notice here.
 */
export const ASSET_NOTICES: Partial<Record<VaultKind, AssetNotice>> = {
  e1: {
    asset: 'USDT0',
    face: 'Real product · not MiCA-compliant: it borrows USDT0',
    headline: 'USDT0 is not a MiCA-authorised e-money token',
    body:
      'This entry borrows USDT0 — the omnichain form of Tether’s USDT. It carries no e-money-token authorisation under the EU’s MiCA regulation, and it sits outside the EMTs-only rule Astryum applies to its own EU-facing strategies (USDC, EURC, RLUSD). Astryum does not issue, offer or trade it: the loan is taken in Kinetic’s market, prepared unsigned, and signed by you in your own wallet under your own responsibility. The lend-only entry puts the same FXRP to work with no borrow and no USDT0.',
  },
};

/** The notice this pack must disclose, or null when it has none. */
export function assetNoticeOf(kind: VaultKind): AssetNotice | null {
  return ASSET_NOTICES[kind] ?? null;
}

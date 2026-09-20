/**
 * assetDisclosure — the regulatory notice a strategy card must carry when its
 * composition touches an asset that Astryum's own EU rule keeps OUT of its
 * EU-facing strategies.
 */

import type { VaultKind } from './FlareDemoEarn';

export interface AssetNotice {
  /** The asset the notice is about — the notice's own tag. */
  asset: string;
  /**
   * The line the CARD FACE wears, before anyone opens the route. Until then the
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

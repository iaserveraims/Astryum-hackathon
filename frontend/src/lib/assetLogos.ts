/**
 * assetLogos — the single place that decides which mark an asset wears.
 *
 * Today it only owns the FXRP family, because FXRP is the one asset the UI kept
 * getting wrong: it was painted with XRP's mark. FXRP is not XRP. It is the
 * FAssets representation minted on Flare, over-collateralised by agents and
 * attested by the FDC, and it carries its own brand mark — the X on Flare
 * crimson. Showing XRP's navy mark for it hides the very thing that makes the
 * position a Flare position.
 *
 * Self-hosted (`/tokens/fxrp.png`) rather than hotlinked: the flagship asset of
 * the product should not go dark when a logo CDN does, and no third party needs
 * to learn that a user is looking at their FXRP.
 */

/** The FXRP mark. 248×248 PNG with a transparent backdrop, served from /public. */
export const FXRP_LOGO = '/tokens/fxrp.png';

/**
 * Symbols that wear the FXRP mark.
 *
 * FXRP itself, plus the Flare-side receipts whose UNDERLYING is FXRP — the
 * Kinetic iso receipt and the vault shares (Firelight stXRP, Upshift earnXRP,
 * Monarq MXRPY). Those receipts are FXRP-denominated positions on Flare, so the
 * FXRP mark is what they are backed by. Plain XRP on the XRPL keeps its own
 * mark: it is a different asset on a different ledger.
 */
export const FXRP_FAMILY: Record<string, string> = {
  FXRP: FXRP_LOGO,
  KFXRP: FXRP_LOGO,
  ISOFXRP: FXRP_LOGO,
  STXRP: FXRP_LOGO,
  EARNXRP: FXRP_LOGO,
  MXRPY: FXRP_LOGO,
};

/** True when `symbol` is FXRP or an FXRP-backed receipt on Flare. */
export function isFxrpFamily(symbol: string): boolean {
  return symbol.trim().toUpperCase() in FXRP_FAMILY;
}

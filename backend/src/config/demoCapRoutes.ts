/**
 * §4 — the mint prepare routes are ENUMERATED, not just body-sniffed.
 *
 * The middleware's body-sniff (demoCapFromBody) is fail-OPEN for a FUTURE mint route
 * with an unknown amount field: the absence of a cap looks identical to the cap passing.
 * So we list every POST route explicitly and a test (flareDemo.capRoutes.test.ts) walks
 * the router's registered POST routes and fails if any is UNCLASSIFIED. Adding a new
 * mint route without capping it becomes a red test, not a production discovery.
 */

/** POST prepare routes that mint XRP→FXRP to open/grow exposure and MUST be capped.
 *  `amountField` lists the request field(s) carrying the mint amount (pipe-separated,
 *  first is canonical). */
export const MINT_PREPARE_ROUTES: ReadonlyArray<{ path: string; amountField: string }> = [
  { path: '/e1/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/e3/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/vault/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/supply-usdt0/prepare', amountField: 'amountXrpForMint' },
  // Opens USDT0 debt against supplied collateral — grows exposure, stays an ENTRY.
  { path: '/e1-borrow/prepare', amountField: 'amountXrpForMint' },
  // NOT an exit: redeem A → approve B → deposit B in one batch. The capital never
  // returns to the holder; it ENTERS vault B (new exposure, Monarq keeps its switch).
  // A holder who wants OUT uses /vault-withdraw/prepare, which is never gated.
  { path: '/vault-rotate/prepare', amountField: 'amountXrpForMint' },
];

/**
 * POST routes that return capital to the holder. `carrierField` = the body field
 * carrying the 0xFE carrier XRP when the route (or one of its rails) mints one; null
 * when the route is EVM-direct only (the user signs their own tx, no executor).
 */
export const EXIT_PREPARE_ROUTES: ReadonlyArray<{ path: string; carrierField: string | null }> = [
  // E2 reverse: undelegate + unwrap WFLR→FLR in the same wallet. EVM-direct.
  { path: '/e2/exit/prepare', carrierField: null },
  // Withdraw an ISO asset and move it PA→EVM wallet / redeem to the owner's XRPL
  // wallet / keep it free in the PA (DERISK steps 1 and 3). 0xFE rail.
  { path: '/pa-withdraw-transfer/prepare', carrierField: 'amountXrpForMint' },
  // FXRP → native XRP to the PA owner's XRPL wallet (the road back). 0xFE rail.
  { path: '/pa-unmint/prepare', carrierField: 'amountXrpForMint' },
  // FREE FXRP / FLR out of the Smart Account to a Flare wallet. Opens no exposure,
  // and it is the ONLY way out for FXRP below the FAssets redemption minimum
  // (/pa-unmint cannot redeem it). Geofencing it would trap small balances. 0xFE rail.
  { path: '/pa-transfer/prepare', carrierField: 'amountXrpForMint' },
  // Withdraw an EVM-direct ISO supply position to the holder's wallet.
  { path: '/iso-withdraw/prepare', carrierField: null },
  // Redeem partner-vault shares (Firelight / earnXRP / Monarq). EVM rail or 0xFE rail.
  { path: '/vault-withdraw/prepare', carrierField: 'amountXrpForMint' },
  // Claim a finished Firelight withdrawal period (the second leg of an exit already
  // requested). EVM rail or 0xFE rail (optional carrier).
  { path: '/vault-claim/prepare', carrierField: 'amountXrpForMint' },
  // UNWIND — repay USDT0 debt from the user's EVM wallet. Not "capital out" by itself,
  // but it is load-bearing for the exit: withdrawing FXRP collateral while debt is open
  // REVERTS on-chain (DERISK order), so a geofenced repay traps the collateral. It is
  // also the liquidation defence. EVM-direct.
  { path: '/a1/prepare', carrierField: null },
  // UNWIND — the same repay inside the PA (walletless). Same reasoning as /a1. 0xFE rail.
  { path: '/pa-repay/prepare', carrierField: 'amountXrpForMint' },
];

/** POST routes that neither mint nor return capital (classified so the enumeration test
 *  can account for EVERY registered POST route). */
export const NON_MINT_POST_ROUTES: ReadonlyArray<string> = [
  '/e2/prepare', // FLR wrap + FTSO delegate (amountFlr; user signs their own EVM tx) — an ENTRY, geofenced in the handler
  '/handoff/release', // free a prepared-but-unsigned 0xFE nonce seat (DB status flip; no mint, no chain)
  '/handoff/signed', // mark a prepared 0xFE as signed (DB status flip; the mint it belongs to was already capped at its own prepare)
  // The party that CREATED the Xaman payload stamps its real
  // expiry on the queued row (moves the seat clock forward only). No mint, no
  // chain, no capital — it writes one timestamp on a row that already exists.
  '/handoff/payload-opened',
];

export const CAPPED_MINT_PATHS: ReadonlySet<string> = new Set(
  MINT_PREPARE_ROUTES.map((r) => r.path),
);

export const EXIT_PREPARE_PATHS: ReadonlySet<string> = new Set(
  EXIT_PREPARE_ROUTES.map((r) => r.path),
);

export const CLASSIFIED_POST_PATHS: ReadonlySet<string> = new Set<string>([
  ...MINT_PREPARE_ROUTES.map((r) => r.path),
  ...EXIT_PREPARE_ROUTES.map((r) => r.path),
  ...NON_MINT_POST_ROUTES,
]);

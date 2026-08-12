/**
 * §4 — the mint prepare routes are ENUMERATED, not just body-sniffed.
 *
 * The middleware's body-sniff (demoCapFromBody) is fail-OPEN for a FUTURE mint route
 * with an unknown amount field: the absence of a cap looks identical to the cap passing.
 * So we list every POST route explicitly and a test (flareDemo.capRoutes.test.ts) walks
 * the router's registered POST routes and fails if any is UNCLASSIFIED. Adding a new
 * mint route without capping it becomes a red test, not a production discovery.
 *
 * Classification (verified in flareDemo.ts, 2026-07-23):
 *   MINT = XRP → Core Vault → 0xFE executor mints FXRP (spends the FLR fee budget, can
 *          strand XRP on revert). MUST be capped + budget-pre-checked.
 *   NON-MINT = FLR wrap / EVM-direct repay / withdraw / claim — no executor budget, no
 *          stranding. Not budget-relevant.
 */

/** POST prepare routes that mint XRP→FXRP and MUST be capped. `amountField` lists the
 *  request field(s) carrying the mint amount (pipe-separated, first is canonical). */
export const MINT_PREPARE_ROUTES: ReadonlyArray<{ path: string; amountField: string }> = [
  { path: '/e1/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/e3/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/vault/prepare', amountField: 'amountXrp|amountFxrp' },
  { path: '/supply-usdt0/prepare', amountField: 'amountXrpForMint' },
  { path: '/pa-withdraw-transfer/prepare', amountField: 'amountXrpForMint' },
  { path: '/pa-unmint/prepare', amountField: 'amountXrpForMint' }, // unmint FXRP→XRP nativo (mint-coupled)
  { path: '/pa-repay/prepare', amountField: 'amountXrpForMint' },
  { path: '/e1-borrow/prepare', amountField: 'amountXrpForMint' },
  { path: '/vault-withdraw/prepare', amountField: 'amountXrpForMint' },
  { path: '/vault-rotate/prepare', amountField: 'amountXrpForMint' },
];

/** POST routes that do NOT mint (classified so the enumeration test can account for
 *  EVERY registered POST route). */
export const NON_MINT_POST_ROUTES: ReadonlyArray<string> = [
  '/e2/prepare', // FLR wrap + FTSO delegate (amountFlr; user signs their own EVM tx)
  '/e2/exit/prepare', // E2 reverse: undelegate + unwrap WFLR→FLR (no mint; user signs their own EVM tx)
  '/a1/prepare', // EVM-direct repay USDT0 to lift HF (no XRP mint; user signs)
  '/iso-withdraw/prepare', // withdraw an existing ISO position
  '/vault-claim/prepare', // claim vault shares
  '/handoff/release', // free a prepared-but-unsigned 0xFE nonce seat (DB status flip; no mint, no chain)
];

export const CAPPED_MINT_PATHS: ReadonlySet<string> = new Set(
  MINT_PREPARE_ROUTES.map((r) => r.path),
);

export const CLASSIFIED_POST_PATHS: ReadonlySet<string> = new Set<string>([
  ...MINT_PREPARE_ROUTES.map((r) => r.path),
  ...NON_MINT_POST_ROUTES,
]);

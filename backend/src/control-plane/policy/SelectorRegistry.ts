import type { ActionType } from '../../canonical/types/Action';

/**
 * Function selector ↔ canonical action map. Used by PolicyGuard P7 to verify
 * that the calldata in `txData.data` matches the declared action — preventing
 * a provider from mislabelling calldata.
 *
 * Selectors are the first 4 bytes (8 hex chars + `0x`) of keccak256 of the
 * function signature. Verified against:
 *   - Compound V2 / Kinetic CErc20: mint, redeem, redeemUnderlying, borrow, repayBorrow
 *   - WFLR (WNAT): deposit, withdraw
 *   - VPContract / FTSO Manager: delegate, undelegate, claimRewards
 *   - Sceptre sFLR (ERC-4626): deposit, redeem
 *
 * Multi-selector mapping when several signatures map to one canonical action
 * (e.g. `withdraw` may use `redeem(uint256)` or `redeemUnderlying(uint256)`).
 */
export type ProtocolActionKey = `${string}:${ActionType}`;

const ENTRIES: ReadonlyArray<readonly [ProtocolActionKey, ReadonlyArray<string>]> = [
  // Kinetic (Compound V2 fork)
  ['kinetic:supply', ['0xa0712d68']], // mint(uint256)
  ['kinetic:withdraw', ['0xdb006a75', '0x852a12e3']], // redeem(uint256), redeemUnderlying(uint256)
  ['kinetic:borrow', ['0xc5ebeaec']], // borrow(uint256)
  // repayBorrow(uint256) · repayBorrowBehalf(address,uint256) — the A1/PROTECT
  // protection repays the Personal Account's debt FROM the user's EVM wallet
  // (KineticAdapter.buildIsoRepayBehalfBatch), so the behalf variant is as
  // canonical a `repay` as the direct one.
  ['kinetic:repay', ['0x0e752702', '0x2608f818']],

  // WFLR (WNAT)
  ['wflr:wrap', ['0xd0e30db0']], // deposit()
  ['wflr:unwrap', ['0x2e1a7d4d']], // withdraw(uint256)

  // FTSO delegation (VPContract on WNAT)
  ['ftso:delegate', ['0x026e402b']], // delegate(address,uint256)
  ['ftso:undelegate', ['0x69f2bb18']], // undelegateAll()
  ['ftso:claimRewards', ['0x88c6df40']], // claim(address,address,uint256,bool)

  // Sceptre sFLR (ERC-4626)
  ['sceptre:stake', ['0x6e553f65']], // deposit(uint256,address)
  ['sceptre:unstake', ['0xba087652']], // redeem(uint256,address,address)

  // Firelight stXRP (ERC-4626 mirror)
  ['firelight:stake', ['0x6e553f65']],
  ['firelight:unstake', ['0xba087652']],

  // SparkDEX V3 NFPM (Uniswap V3 NonfungiblePositionManager)
  ['sparkdex:addLiquidity', ['0x88316456', '0x219f5d17']], // mint(...), increaseLiquidity(...)
  ['sparkdex:exitLP', ['0xfc6f7865', '0x0c49ccbe']], // collect(...), decreaseLiquidity(...)

  // Enosys (Uniswap V2 router)
  ['enosys:addLiquidity', ['0xe8e33700']], // addLiquidity(...)
  ['enosys:exitLP', ['0xbaa2abde']], // removeLiquidity(...)
];

const TABLE: ReadonlyMap<ProtocolActionKey, ReadonlyArray<string>> = new Map(ENTRIES);

export class SelectorRegistry {
  static expectedSelectors(protocol: string, action: ActionType): ReadonlyArray<string> {
    return TABLE.get(`${protocol.toLowerCase()}:${action}` as ProtocolActionKey) ?? [];
  }

  static matches(protocol: string, action: ActionType, calldata: string): boolean {
    const expected = SelectorRegistry.expectedSelectors(protocol, action);
    if (expected.length === 0) return false; // unknown mapping → fail-closed
    if (typeof calldata !== 'string' || calldata.length < 10) return false;
    const sel = calldata.slice(0, 10).toLowerCase();
    return expected.some((s) => s.toLowerCase() === sel);
  }

  /** For diagnostics/admin endpoints. Returns the immutable map shape. */
  static dump(): Record<ProtocolActionKey, ReadonlyArray<string>> {
    return Object.fromEntries(TABLE.entries()) as Record<ProtocolActionKey, ReadonlyArray<string>>;
  }
}

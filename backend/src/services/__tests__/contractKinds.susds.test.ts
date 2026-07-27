import { kindForSlug, detectCapabilities } from '../contractKinds';

describe('contractKinds — Sky/USDS savings (sUSDS) ERC-4626 classification (D3)', () => {
  test('sUSDS savings slugs map to erc4626_vault (not the spark lending market)', () => {
    expect(kindForSlug('susds')).toBe('erc4626_vault');
    expect(kindForSlug('sky-lending')).toBe('erc4626_vault');
    // The 'spark' lending market stays an Aave-fork pool — no collision.
    expect(kindForSlug('spark')).toBe('spark_pool');
  });

  test('an sUSDS vault resolves supply/withdraw via the erc4626 deposit/redeem path', () => {
    const caps = detectCapabilities({
      contractKind: kindForSlug('susds'),
      abiFunctionNames: new Set(['deposit', 'withdraw', 'redeem', 'mint']),
      pool: {
        apyBaseBorrow: null,
        underlyingTokens: ['0xUSDS'],
        rewardTokens: [],
        isLiquidStaking: false,
        symbol: 'sUSDS',
      },
    });
    expect(caps.supportsVaultDeposit).toBe(true);
    expect(caps.supportsVaultWithdraw).toBe(true);
    // It's a savings vault, not a borrow market.
    expect(caps.supportsBorrowCapability).toBe(false);
  });
});

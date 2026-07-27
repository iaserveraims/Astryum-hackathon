/**
 * contractKinds.ts tests — the kind dispatch table and capability detection.
 *
 * Block F (2026-06-01) — These tests lock in:
 *   1. Every protocol slug in PROTOCOL_KIND_MAP maps to a valid kind.
 *   2. kindForSlug('unknown-slug') → 'unknown' (no accidental defaults).
 *   3. detectCapabilities correctly reflects ABI shape per kind.
 */

import {
  PROTOCOL_KIND_MAP,
  kindForSlug,
  slugsForKind,
  detectCapabilities,
  type ContractKind,
} from '../contractKinds';

describe('contractKinds — kindForSlug', () => {
  test('Aave V3 slug → aave_v3_pool', () => {
    expect(kindForSlug('aave-v3')).toBe('aave_v3_pool');
  });

  test('Lido slug → lido_steth', () => {
    expect(kindForSlug('lido')).toBe('lido_steth');
  });

  test('Spark (Aave V3 fork) → spark_pool', () => {
    expect(kindForSlug('spark')).toBe('spark_pool');
  });

  test('Sceptre slug variants both map → sceptre_vault', () => {
    expect(kindForSlug('sceptre')).toBe('sceptre_vault');
    expect(kindForSlug('sceptre-staked-flr')).toBe('sceptre_vault');
  });

  test('Unknown slug → unknown (no silent default)', () => {
    expect(kindForSlug('definitely-not-a-real-protocol-xyz')).toBe('unknown');
  });

  test('Every value in PROTOCOL_KIND_MAP is a valid ContractKind', () => {
    const validKinds = new Set<ContractKind>([
      'aave_v3_pool', 'aave_v2_pool', 'comet_v3', 'lido_steth',
      'rocket_pool_deposit', 'sceptre_vault', 'erc4626_vault', 'morpho_blue',
      'spark_pool', 'uniswap_v3_nfpm', 'uniswap_v2_router', 'curve_pool',
      'balancer_v2_vault', 'unknown',
    ]);
    for (const kind of Object.values(PROTOCOL_KIND_MAP)) {
      expect(validKinds.has(kind)).toBe(true);
    }
  });
});

describe('contractKinds — slugsForKind (inverse lookup)', () => {
  test('aave_v3_pool only matches aave-v3', () => {
    expect(slugsForKind('aave_v3_pool')).toEqual(['aave-v3']);
  });

  test('erc4626_vault includes Yearn, Ether.fi, Frax-ether', () => {
    const slugs = slugsForKind('erc4626_vault');
    expect(slugs).toEqual(expect.arrayContaining(['yearn-finance', 'ether.fi', 'frax-ether']));
  });
});

describe('contractKinds — detectCapabilities', () => {
  function abi(...names: string[]): Set<string> {
    return new Set(names.map((n) => n.toLowerCase()));
  }

  const POOL_SHELL = {
    apyBaseBorrow: null,
    underlyingTokens: [],
    rewardTokens: [],
    isLiquidStaking: false,
    symbol: 'USDC',
  };

  test('aave_v3_pool with full ABI + borrow APY → supply, withdraw, borrow, repay', () => {
    const caps = detectCapabilities({
      contractKind: 'aave_v3_pool',
      abiFunctionNames: abi('supply', 'withdraw', 'borrow', 'repay'),
      pool: { ...POOL_SHELL, apyBaseBorrow: 4.5 },
    });
    expect(caps.supportsSupply).toBe(true);
    expect(caps.supportsWithdraw).toBe(true);
    expect(caps.supportsBorrowCapability).toBe(true);
    expect(caps.supportsRepay).toBe(true);
    expect(caps.supportsStake).toBe(false);
  });

  test('aave_v3_pool WITHOUT borrow APY → borrowCapability false even if abi has borrow', () => {
    const caps = detectCapabilities({
      contractKind: 'aave_v3_pool',
      abiFunctionNames: abi('supply', 'borrow'),
      pool: { ...POOL_SHELL, apyBaseBorrow: null },
    });
    expect(caps.supportsBorrowCapability).toBe(false);
  });

  test('lido_steth → stake (submit) + unstake (requestWithdrawals)', () => {
    const caps = detectCapabilities({
      contractKind: 'lido_steth',
      abiFunctionNames: abi('submit', 'requestWithdrawals'),
      pool: { ...POOL_SHELL, isLiquidStaking: true, symbol: 'STETH' },
    });
    expect(caps.supportsStake).toBe(true);
    expect(caps.supportsUnstake).toBe(true);
    expect(caps.supportsSupply).toBe(false);
  });

  test('erc4626_vault + isLiquidStaking → stake aliases (deposit/redeem)', () => {
    const caps = detectCapabilities({
      contractKind: 'erc4626_vault',
      abiFunctionNames: abi('deposit', 'withdraw'),
      pool: { ...POOL_SHELL, isLiquidStaking: true, symbol: 'sFLR' },
    });
    expect(caps.supportsVaultDeposit).toBe(true);
    expect(caps.supportsVaultWithdraw).toBe(true);
    expect(caps.supportsStake).toBe(true); // alias for LST vaults
    expect(caps.supportsUnstake).toBe(true);
  });

  test('unknown kind → no capabilities', () => {
    const caps = detectCapabilities({
      contractKind: 'unknown',
      abiFunctionNames: abi('supply', 'borrow', 'stake', 'deposit', 'mint'),
      pool: POOL_SHELL,
    });
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
  });
});

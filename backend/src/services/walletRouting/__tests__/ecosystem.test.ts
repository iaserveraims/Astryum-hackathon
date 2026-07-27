/**
 * ecosystem.ts tests — locks in the CAIP-2 prefix → ecosystem mapping.
 * Block G (2026-06-02).
 */

import {
  ecosystemForCaip2,
  ecosystemForChainId,
  ecosystemForPool,
  ecosystemFromNetworkLabel,
  isCrossEcosystem,
} from '../ecosystem';

describe('ecosystem — ecosystemForCaip2', () => {
  test.each([
    ['eip155:1', 'evm'],
    ['eip155:42161', 'evm'],
    ['solana:mainnet', 'solana'],
    ['xrpl:0', 'xrpl'],
    ['aptos:1', 'aptos'],
    ['cosmos:cosmoshub-4', 'cosmos'],
  ])('%s → %s', (caip2, expected) => {
    expect(ecosystemForCaip2(caip2)).toBe(expected);
  });

  test('case-insensitive prefix match', () => {
    expect(ecosystemForCaip2('EIP155:1')).toBe('evm');
    expect(ecosystemForCaip2('Solana:Mainnet')).toBe('solana');
  });

  test('null/empty/unknown → null', () => {
    expect(ecosystemForCaip2(null)).toBeNull();
    expect(ecosystemForCaip2('')).toBeNull();
    expect(ecosystemForCaip2('btc:0')).toBeNull(); // Bitcoin not supported in V1
  });
});

describe('ecosystem — ecosystemForPool (caip2 wins over chainId)', () => {
  test('EVM pool with caip2 → evm', () => {
    expect(ecosystemForPool({ chainId: 1, chain: 'eip155:1' })).toBe('evm');
  });

  test('Solana pool with caip2 → solana', () => {
    expect(ecosystemForPool({ chainId: 0, chain: 'solana:mainnet' })).toBe('solana');
  });

  test('Pool with chainId only → evm fallback', () => {
    expect(ecosystemForPool({ chainId: 42161, chain: 'unknown:scheme' })).toBe('evm');
  });
});

describe('ecosystem — legacy network label backfill', () => {
  test.each([
    ['ethereum', 'evm'],
    ['polygon',  'evm'],
    ['arbitrum', 'evm'],
    ['flare',    'evm'],
    ['xrpl',     'xrpl'],
    ['solana',   'solana'],
    ['aptos',    'aptos'],
    ['cosmos',   'cosmos'],
  ])('%s → %s', (network, expected) => {
    expect(ecosystemFromNetworkLabel(network)).toBe(expected);
  });

  test('unknown label → null', () => {
    expect(ecosystemFromNetworkLabel('mars-net')).toBeNull();
  });
});

describe('ecosystem — isCrossEcosystem', () => {
  test('same ecosystem → false', () => {
    expect(isCrossEcosystem('evm', 'evm')).toBe(false);
  });

  test('different ecosystem → true', () => {
    expect(isCrossEcosystem('evm', 'solana')).toBe(true);
    expect(isCrossEcosystem('xrpl', 'evm')).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * loadAggregatedPortfolio comparte UN vuelo por conjunto de wallets. Quien se
 * une a un vuelo ya en marcha tiene que ver la progresión igual que quien lo
 * arrancó: en Home el badge («aún leyendo 2/5») arranca la lectura y la cifra
 * de al lado se une; si solo el primero viera los parciales, la cifra
 * esperaría a la wallet más lenta mientras el badge ya cuenta.
 */

const { getSnap } = vi.hoisted(() => ({ getSnap: vi.fn() }));
vi.mock('@/services/v1Api', () => ({
  portfolioV1: {
    get: getSnap,
    history: () => Promise.resolve({ points: [] }),
  },
  risk: { portfolio: () => Promise.resolve(null) },
}));
vi.mock('@/services/walletLinkService', () => ({ listMyWallets: () => Promise.resolve([]) }));
vi.mock('@/lib/wallet/paOwnership', () => ({ resolvePersonalAccountOf: () => Promise.resolve(null) }));

import {
  loadAggregatedPortfolio,
  invalidatePortfolioCache,
  type AggregatedPortfolio,
} from '../portfolioMerge';

const W1 = '0x1000000000000000000000000000000000000001';
const W2 = '0x2000000000000000000000000000000000000002';

const snapOf = (address: string, totalUSD: number) => ({
  chainId: 14,
  address,
  totalUSD,
  collateralUSD: 0,
  debtUSD: 0,
  netWorthUSD: totalUSD,
  positions: [],
  breakdown: { byProtocol: {}, byAsset: {}, byKind: {} },
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadAggregatedPortfolio — el que se une a un vuelo también ve los parciales', () => {
  beforeEach(() => {
    invalidatePortfolioCache();
    getSnap.mockReset();
  });

  it('dos lectores del mismo conjunto: un solo barrido y ambos reciben el parcial de la primera wallet', async () => {
    let landW2!: () => void;
    getSnap.mockImplementation((a: string) =>
      a === W1
        ? Promise.resolve(snapOf(W1, 100))
        : new Promise((r) => {
            landW2 = () => r(snapOf(W2, 50));
          }),
    );

    const seenByStarter: AggregatedPortfolio[] = [];
    const seenByJoiner: AggregatedPortfolio[] = [];
    const first = loadAggregatedPortfolio([W1, W2], (p) => seenByStarter.push(p));
    const second = loadAggregatedPortfolio([W2, W1], (p) => seenByJoiner.push(p));

    await flush();
    // W1 ya contestó, W2 sigue en vuelo: los DOS lectores ven la wallet leída.
    expect(seenByStarter.some((p) => p.perWallet.length === 1)).toBe(true);
    expect(seenByJoiner.some((p) => p.perWallet.length === 1)).toBe(true);

    landW2();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.perWallet).toHaveLength(2);
    // Un barrido, no dos: una lectura de snapshot por wallet.
    expect(getSnap).toHaveBeenCalledTimes(2);
  });

  it('quien se une tarde recibe al instante el último parcial, sin esperar a la siguiente wallet', async () => {
    let landW2!: () => void;
    getSnap.mockImplementation((a: string) =>
      a === W1
        ? Promise.resolve(snapOf(W1, 100))
        : new Promise((r) => {
            landW2 = () => r(snapOf(W2, 50));
          }),
    );

    const first = loadAggregatedPortfolio([W1, W2]);
    await flush();

    const seenByLateJoiner: AggregatedPortfolio[] = [];
    const late = loadAggregatedPortfolio([W1, W2], (p) => seenByLateJoiner.push(p));
    expect(seenByLateJoiner.length).toBeGreaterThan(0);
    expect(seenByLateJoiner[0].perWallet.length).toBeGreaterThan(0);

    landW2();
    await Promise.all([first, late]);
  });
});

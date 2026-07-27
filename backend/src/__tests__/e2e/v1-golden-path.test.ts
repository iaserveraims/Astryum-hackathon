/**
 * V1 Golden Path E2E (mocked) — exercises the full chain:
 *   adapter → portfolio → risk → simulation → intent
 *
 * This test does NOT broadcast (which would require a signed tx + real wallet).
 * Steps 1-6 of the golden path are validated here; steps 7-10 are exercised by
 * the live `bash backend/scripts/golden-path.sh` against a real wallet.
 *
 * All on-chain reads are mocked. Prisma writes are mocked too.
 */

import { PortfolioEngine } from '../../engines/portfolio/PortfolioEngine';
import { RiskEngine } from '../../engines/risk/RiskEngine';
import { SimulationEngine } from '../../engines/simulation/SimulationEngine';
import { IntentEngine } from '../../engines/intent/IntentEngine';
import { ProtocolRegistry } from '../../connectors/protocols/ProtocolRegistry';

const TEST_WALLET = '0x000000000000000000000000000000000000abcd';
const TEST_SESSION = 'session-test';

// ---- mock FlareProvider so adapters don't try real RPC ----
jest.mock('../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

// ---- mock Prisma writes (sim persist, intent create, audit log) ----
jest.mock('../../database/prismaClient', () => {
  const TEST_WALLET_INNER = '0x000000000000000000000000000000000000abcd';
  const wallets = new Map([
    [TEST_WALLET_INNER, { id: 'wallet-1', userId: 'user-1', address: TEST_WALLET_INNER, chainId: 14 }],
  ]);
  const sims = new Map<string, any>();
  const intents = new Map<string, any>();
  let simSeq = 0;
  let intentSeq = 0;
  return {
    prisma: {
      wallet: {
        findFirst: jest.fn(async ({ where }: any) => wallets.get(where.address) ?? null),
        findMany: jest.fn(async () => Array.from(wallets.values())),
      },
      protocol: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.slug === 'kinetic'
            ? { id: 'protocol-kinetic', slug: 'kinetic', chainId: 14 }
            : null
        ),
      },
      portfolioSnapshot: {
        create: jest.fn(async () => ({})),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      simulationResult: {
        create: jest.fn(async ({ data }: any) => {
          const id = `sim-${++simSeq}`;
          const row = { id, ...data, createdAt: new Date() };
          sims.set(id, row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) => sims.get(where.id) ?? null),
      },
      transactionIntent: {
        create: jest.fn(async ({ data }: any) => {
          const id = `intent-${++intentSeq}`;
          const row = { id, status: 'proposed', ...data };
          intents.set(id, row);
          return row;
        }),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
    },
  };
});

// ---- mock the Kinetic adapter ABI calls ----
jest.mock('../../connectors/protocols/adapters/KineticAdapter', () => {
  const real = jest.requireActual('../../connectors/protocols/adapters/KineticAdapter');
  class FakeKineticAdapter extends real.KineticAdapter {
    get isActive(): boolean {
      return true;
    }
    async discoverPositions(_w: string) {
      return [
        {
          protocolId: 'kinetic',
          chainId: 14,
          wallet: '0x000000000000000000000000000000000000abcd',
          kind: 'SUPPLY',
          asset: '0xfxrp',
          amount: 1_000n * 10n ** 18n,
          raw: { symbol: 'FXRP', cToken: '0xcfxrp' },
          discoveredAt: new Date(),
        },
        {
          protocolId: 'kinetic',
          chainId: 14,
          wallet: '0x000000000000000000000000000000000000abcd',
          kind: 'BORROW',
          asset: '0xusdt0',
          amount: 500n * 10n ** 18n,
          // The REAL on-chain ERC-20 symbol uses ₮ (U+20AE) — the fixture
          // mirrors the chain so the ₮→T canonicalisation (incidente
          // 2026-07-25, deuda a $0 en todos los paneles) stays exercised
          // end-to-end.
          raw: { symbol: 'USD₮0', cToken: '0xcusdt0' },
          discoveredAt: new Date(),
        },
      ];
    }
    async getMetrics(position: any) {
      // Synthesised HF/LTV consistent with collateral 1000 USD, debt 500 USD, CF 0.7
      // HF = (1000*0.7)/500 = 1.4, LTV = 0.5
      return position.kind === 'BORROW'
        ? { hf: 1.4, ltv: 0.5, extras: { collateralFactor: 0.7 } }
        : { hf: 1.4, ltv: 0.5 };
    }
  }
  return { ...real, KineticAdapter: FakeKineticAdapter };
});

// ---- mock NormalisationEngine to skip FTSO ----
jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const real = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...real,
    createFTSOPriceProvider: async () => ({
      getPriceUSD: async (sym: string) => {
        if (sym === 'FXRP' || sym === 'XRP') return 1.0;
        // NormalisationEngine canonicalises USD₮0/USDT0 → USDT (FTSO only
        // lists USDT); the price feed answers the CANONICAL symbol, like the
        // real FTSO. The old 'USDT0' answer priced a symbol that never
        // arrives any more → debtUSD 0 (the very bug 6407f57 fixed on-chain).
        if (sym === 'USDT') return 1.0;
        return 0;
      },
    }),
  };
});

describe('V1 Golden Path (mocked)', () => {
  beforeEach(() => {
    // re-register the mocked KineticAdapter into the registry
    const reg = ProtocolRegistry.getInstance();
    const { KineticAdapter } = require('../../connectors/protocols/adapters/KineticAdapter');
    (reg as any).adapters?.clear?.();
    reg.registerAdapter(new KineticAdapter());
  });

  test('step 2-3: portfolio aggregates Kinetic positions', async () => {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(TEST_WALLET, 14, {
      forceRefresh: true,
      persist: false,
    });
    expect(snapshot.wallet).toBe(TEST_WALLET);
    expect(snapshot.chainId).toBe(14);
    expect(snapshot.positions.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.totalUSD).toBeGreaterThan(0);
    expect(snapshot.debtUSD).toBeGreaterThan(0);
  });

  test('step 4: risk engine produces score + level + drivers', async () => {
    const risk = await RiskEngine.getInstance().getPortfolioRisk(TEST_WALLET, 14);
    expect(risk.scope).toBe('PORTFOLIO');
    expect(typeof risk.riskScore).toBe('number');
    expect(['SAFE', 'WATCH', 'WARNING', 'DANGER', 'CRITICAL']).toContain(risk.riskLevel);
    expect(risk.drivers.length).toBeGreaterThan(0);
  });

  test('step 5: simulate repay returns persisted SimulationResult', async () => {
    const sim = await SimulationEngine.getInstance().simulateRepay({
      walletAddress: TEST_WALLET,
      protocolId: 'kinetic',
      params: {
        amount: 100n * 10n ** 18n,
        decimals: 18,
        priceUSD: 1,
        collateralUSD: 1000,
        debtUSD: 500,
        collateralFactor: 0.7,
        flrPriceUSD: 0.02,
      },
    });
    expect(sim.id).toMatch(/sim-/);
    expect(sim.success).toBe(true);
    expect(sim.newHF).toBeCloseTo(1.75, 1);
    expect(sim.newLTV).toBeCloseTo(0.4, 2);
  });

  test('step 6: intent created with simulationResultId reaches READY_TO_SIGN', async () => {
    // First simulate so the persisted sim id exists
    const sim = await SimulationEngine.getInstance().simulateRepay({
      walletAddress: TEST_WALLET,
      protocolId: 'kinetic',
      params: {
        amount: 100n * 10n ** 18n,
        decimals: 18,
        priceUSD: 1,
        collateralUSD: 1000,
        debtUSD: 500,
        collateralFactor: 0.7,
        flrPriceUSD: 0.02,
      },
    });
    const intent = await IntentEngine.getInstance().createIntent({
      walletAddress: TEST_WALLET,
      sessionId: TEST_SESSION,
      protocolId: 'kinetic',
      actionKind: 'repay',
      simulationResultId: sim.id,
      params: {
        amount: 100n * 10n ** 18n,
        decimals: 18,
        priceUSD: 1,
      },
      source: 'user',
    });
    expect(intent.id).toMatch(/intent-/);
    expect(intent.status).toBe('proposed'); // V1 lifecycle READY_TO_SIGN
    expect(intent.owner).toBe(TEST_WALLET);
  });
});

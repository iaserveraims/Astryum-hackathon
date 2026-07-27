/**
 * /vault/prepare — partner-vault entries (Firelight stXRP · earnXRP · Monarq).
 *
 * Hermetic by construction: the `0xFE` handoff builder is mocked (its own
 * machinery is exercised by the E1/E3 paths + CLI dry-runs), the FTSO price
 * provider and the KWYH scanner are stubbed, and vault state reads go through
 * a fake ethers.Contract keyed by address. What stays REAL is the route
 * logic under test: validation, gating (flag + geofence + Monarq switch),
 * cap enforcement, and the disclosure contract (invariants #6/#9). Astryum
 * signs nothing: every assertion is over UNSIGNED payloads + the disclosure.
 */
import express from 'express';
import request from 'supertest';

// Verified mainnet constants (see .env.example, on-chain 2026-07-10).
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';
const MONARQ_VAULT = '0x2439D4bb753A0f3777d4C9011AFacc475ba6B951';
const MONARQ_TOKEN = '0x36f236af59CB279bab884e464Ef1Bc23c7B1a115';
const PA = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const XRPL_ADDR = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

// Live-read fixture the FakeContract serves, keyed by lowercase address.
// earnXRP figures mirror the 2026-07-10 on-chain reads.
const VAULT_STATE: Record<string, Record<string, unknown>> = {
  [EARNXRP_VAULT.toLowerCase()]: {
    depositsPaused: false,
    depositCap: 35_000_000_000_000n,
    getTotalAssets: 33_203_252_050_050n,
    getSharePrice: 1_009_202n,
    instantRedemptionFee: 10n,
    lagDuration: 86_400n,
  },
  [STXRP.toLowerCase()]: {
    paused: false,
    depositLimit: 100_000_000_000_000n,
    totalAssets: 60_157_000_000_000n,
    convertToAssets: 1_000_071n,
  },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = VAULT_STATE[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        this[fn] = async () => value;
      }
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

// The `0xFE` machinery is covered by E1/E3 + dry-run scripts — stub it here so
// the test never touches the network. supplyUBA = net after fees + buffer.
const FAKE_NET = {
  grossUBA: 100_000_000n,
  mintingFeeUBA: 250_000n,
  executorFeeUBA: 100_000n,
  netToPersonalAccountUBA: 99_650_000n,
  supplyUBA: 99_550_000n,
};
const buildVaultEntryHandoffMock = jest.fn(async () => ({
  handoff: {
    personalAccount: PA,
    fxrpToken: FXRP,
    net: FAKE_NET,
    userOpData: '0xdead',
    userOpHash: '0xbeef',
    memoHex: 'FE00',
    xrplPayment: {
      TransactionType: 'Payment' as const,
      Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
      Amount: '100000000',
      Memos: [{ Memo: { MemoData: 'FE00' } }],
    },
  },
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return { ...actual, buildVaultEntryHandoff: (...args: unknown[]) => buildVaultEntryHandoffMock(...(args as [])) };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...actual,
    createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }),
  };
});

jest.mock('../../integrations/providers/security/GoPlusProvider', () => ({
  goPlusProvider: {
    call: async () => ({ data: { verdict: 'safe', flags: [] } }),
  },
}));

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const base = { xrplAddress: XRPL_ADDR, amountXrp: 100 };

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  // Neutralize BOTH demo-cap layers: these tests post amountXrp: 100 to exercise the
  // vault/route logic, not the cap (which has its own suite, config/__tests__/demoCap.test.ts).
  process.env.DEMO_MAX_XRP_PER_TX = '1000000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '1000000000';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.UPSHIFT_MONARQ_ENABLED;
  process.env.FXRP_TOKEN = FXRP;
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  process.env.UPSHIFT_EARNXRP_VAULT = EARNXRP_VAULT;
  process.env.UPSHIFT_EARNXRP_TOKEN = EARNXRP_TOKEN;
  process.env.UPSHIFT_MONARQ_VAULT = MONARQ_VAULT;
  process.env.UPSHIFT_MONARQ_TOKEN = MONARQ_TOKEN;
  resetAddressCache();
  // Upshift APY feed: best-effort — fail it so apy falls back to null+no source.
  global.fetch = jest.fn(async () => {
    throw new Error('offline test');
  }) as unknown as typeof fetch;
});

afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.FIRELIGHT_STXRP;
  delete process.env.FIRELIGHT_STAKING;
  delete process.env.UPSHIFT_EARNXRP_VAULT;
  delete process.env.UPSHIFT_EARNXRP_TOKEN;
  delete process.env.UPSHIFT_MONARQ_VAULT;
  delete process.env.UPSHIFT_MONARQ_TOKEN;
  resetAddressCache();
});

describe('POST /api/flare-demo/vault/prepare — gating + validation', () => {
  it('400 on invalid vault key', async () => {
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'wagmi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_VAULT');
  });

  it('400 on bad XRPL address', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault/prepare')
      .send({ ...base, xrplAddress: '0xNotAnXrplAddress', vault: 'earnxrp' });
    expect(res.status).toBe(400);
  });

  it('503 when FLARE_DEFI_ENABLED is off (invariant #8)', async () => {
    process.env.FLARE_DEFI_ENABLED = 'false';
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'earnxrp' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
    process.env.FLARE_DEFI_ENABLED = 'true';
  });

  it('503 for Monarq without its own switch (CeDeFi profile — invariant #10)', async () => {
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'monarq' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('MONARQ_DISABLED');
  });
});

describe('POST /api/flare-demo/vault/prepare — earnXRP happy path', () => {
  it('returns the unsigned Payment + full disclosure (fees, cap, exit terms, no fabricated APY)', async () => {
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'earnxrp' });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('xrpl');
    expect(res.body.personalAccount).toBe(PA);
    expect(res.body.xrplPayment.TransactionType).toBe('Payment');
    expect(res.body.scanner.FXRP).toBeDefined();
    expect(res.body.scanner.vault).toBeDefined();
    expect(res.body.scanner.receiptToken).toBeDefined();

    const d = res.body.disclosure;
    expect(d.vault).toBe('earnxrp');
    expect(d.riskProfile).toBe('onchain');
    expect(d.receiptToken).toBe(EARNXRP_TOKEN);
    expect(d.mintingFeeXrp).toBeCloseTo(0.25, 6);
    expect(d.executorFeeXrp).toBeCloseTo(0.1, 6);
    expect(d.fxrpDeposited).toBeCloseTo(99.55, 6);
    expect(d.sharePrice).toBeCloseTo(1.009202, 6);
    expect(d.sharePriceSource).toMatch(/getSharePrice/);
    // APY feed failed → null + null source: never a made-up number (invariant #9).
    expect(d.apyPct30d).toBeNull();
    expect(d.apySource).toBeNull();
    expect(d.capacity.depositCapFxrp).toBeCloseTo(35_000_000, 0);
    expect(d.capacity.remainingFxrp).toBeGreaterThan(0);
    expect(d.withdrawal.kind).toBe('instant-or-epoch');
    expect(d.withdrawal.instantRedemptionFeeBps).toBe(10);
    expect(d.withdrawal.epochLagSeconds).toBe(86_400);
    expect(d.noDebt).toBe(true);
    expect(d.disclosedToUser).toBe(true);
    expect(d.defibroSigns).toBe(false);
  });

  it('409 VAULT_CAP_EXCEEDED when the net deposit does not fit the live cap', async () => {
    const prev = VAULT_STATE[EARNXRP_VAULT.toLowerCase()].getTotalAssets;
    VAULT_STATE[EARNXRP_VAULT.toLowerCase()].getTotalAssets = 34_999_999_000_000n; // 1 FXRP left
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'earnxrp' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VAULT_CAP_EXCEEDED');
    expect(res.body.capRemainingFxrp).toBeCloseTo(1, 6);
    VAULT_STATE[EARNXRP_VAULT.toLowerCase()].getTotalAssets = prev;
  });
});

describe('POST /api/flare-demo/vault/prepare — Firelight happy path', () => {
  it('stXRP entry disclosure: 4626 share price, no APY claim (Phase 1 — rewards not live)', async () => {
    const res = await request(app).post('/api/flare-demo/vault/prepare').send({ ...base, vault: 'firelight' });

    expect(res.status).toBe(200);
    const d = res.body.disclosure;
    expect(d.vault).toBe('firelight');
    expect(d.riskProfile).toBe('onchain');
    expect(d.receiptToken).toBe(STXRP); // stXRP IS the vault token
    expect(d.sharePrice).toBeCloseTo(1.000071, 6);
    expect(d.sharePriceSource).toMatch(/convertToAssets/);
    expect(d.apyPct30d).toBeNull();
    expect(d.withdrawal.kind).toBe('erc4626-claim');
    expect(d.defibroSigns).toBe(false);
  });
});

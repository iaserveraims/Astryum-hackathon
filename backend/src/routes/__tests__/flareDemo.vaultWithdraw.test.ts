/**
 * /vault-withdraw/prepare — partner-vault EXITS (Firelight stXRP · earnXRP ·
 * Monarq). Same hermetic posture as flareDemo.vault.test.ts: the 0xFE handoff
 * builder and PA resolution are mocked, FTSO is stubbed, and vault reads go
 * through a fake ethers.Contract keyed by address. What stays REAL is the
 * route logic: validation, gating (flag + geofence — and deliberately NO
 * Monarq switch: exits are never gated), share-balance enforcement and the
 * disclosure contract (#6/#9). Every assertion is over UNSIGNED payloads.
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
const EVM_WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const XRPL_ADDR = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

// Live-read fixture — share price / fee for the vaults, LP balances for the
// receipt tokens (both the EVM wallet and the PA hold 100 shares).
const VAULT_STATE: Record<string, Record<string, unknown>> = {
  [EARNXRP_VAULT.toLowerCase()]: {
    getSharePrice: 1_009_202n,
    instantRedemptionFee: 10n,
  },
  [STXRP.toLowerCase()]: {
    convertToAssets: 1_000_071n,
    balanceOf: 100_000_000n, // stXRP is its own receipt token
    // Withdrawal-period queue (redeem burns now, claim releases later).
    currentPeriod: 224n,
    currentPeriodEnd: 1_784_122_969n, // 2026-07-15T13:42:49Z
    withdrawalsOf: 5_000_000n, // FakeContract ignores args → every period has this queued
    isWithdrawClaimed: false,
    withdrawAssets: 5_002_000n,
    withdrawShares: 5_000_000n,
  },
  [EARNXRP_TOKEN.toLowerCase()]: {
    balanceOf: 100_000_000n,
  },
  [MONARQ_VAULT.toLowerCase()]: {
    getSharePrice: 1_002_000n,
    instantRedemptionFee: 30n,
  },
  [MONARQ_TOKEN.toLowerCase()]: {
    balanceOf: 100_000_000n,
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

// The 0xFE machinery is covered by E1/E3 + dry-run scripts — stub it here.
const FAKE_NET = {
  grossUBA: 1_000_000n,
  mintingFeeUBA: 2_500n,
  executorFeeUBA: 1_000n,
  netToPersonalAccountUBA: 996_500n,
  supplyUBA: 995_500n,
};
const buildDirectMintHandoffMock = jest.fn(async () => ({
  personalAccount: PA,
  fxrpToken: FXRP,
  net: FAKE_NET,
  userOpData: '0xdead',
  userOpHash: '0xbeef',
  memoHex: 'FE00',
  xrplPayment: {
    TransactionType: 'Payment' as const,
    Destination: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '1000000',
    Memos: [{ Memo: { MemoData: 'FE00' } }],
  },
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return { ...actual, buildDirectMintHandoff: (...args: unknown[]) => buildDirectMintHandoffMock(...(args as [])) };
});

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService');
  return { ...actual, resolvePersonalAccount: async () => PA };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...actual,
    createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }),
  };
});

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
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
});

afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.FIRELIGHT_STXRP;
  delete process.env.FIRELIGHT_STAKING;
  delete process.env.UPSHIFT_EARNXRP_VAULT;
  delete process.env.UPSHIFT_EARNXRP_TOKEN;
  delete process.env.UPSHIFT_MONARQ_VAULT;
  delete process.env.UPSHIFT_MONARQ_TOKEN;
  resetAddressCache();
});

describe('POST /api/flare-demo/vault-withdraw/prepare — validation + gating', () => {
  it('400 on invalid vault key', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'wagmi', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_VAULT');
  });

  it('400 when neither evmAddress nor xrplAddress is given', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '1000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_XRPL_ADDRESS');
  });

  it('400 on non-integer shares', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '1.5', evmAddress: EVM_WALLET });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('503 when FLARE_DEFI_ENABLED is off (invariant #8)', async () => {
    process.env.FLARE_DEFI_ENABLED = 'false';
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
    process.env.FLARE_DEFI_ENABLED = 'true';
  });

  it('Monarq EXIT is NOT gated by UPSHIFT_MONARQ_ENABLED (exits always available)', async () => {
    delete process.env.UPSHIFT_MONARQ_ENABLED;
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'monarq', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
  });

  it('409 INSUFFICIENT_SHARES when the holder owns fewer shares than requested', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '100000001', evmAddress: EVM_WALLET }); // holds 100
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_SHARES');
    expect(res.body.balanceShares).toBeCloseTo(100, 6);
  });
});

describe('POST /api/flare-demo/vault-withdraw/prepare — EVM-direct rail', () => {
  it('earnXRP: one unsigned instantRedeem call + fee/share-price disclosure', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.account).toBe(EVM_WALLET);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(EARNXRP_VAULT);
    // instantRedeem(uint256,address) — selector verified on-chain 2026-07-13.
    expect(res.body.calls[0].data.startsWith('0x22928208')).toBe(true);

    const d = res.body.disclosure;
    expect(d.vault).toBe('earnxrp');
    expect(d.sharesRedeemed).toBeCloseTo(100, 6);
    expect(d.sharePrice).toBeCloseTo(1.009202, 6);
    expect(d.instantRedemptionFeeBps).toBe(10);
    // 100 shares × 1.009202 = 100.9202 gross; fee 10 bps.
    expect(d.instantFeeFxrp).toBeCloseTo(0.1009202, 6);
    expect(d.estimatedFxrpOut).toBeCloseTo(100.9202 - 0.1009202, 5);
    expect(d.estimatedValueUSD).toBeCloseTo((100.9202 - 0.1009202) * 2.0, 4);
    expect(d.disclosedToUser).toBe(true);
    expect(d.defibroSigns).toBe(false);
  });

  it('Firelight: one unsigned ERC-4626 redeem call, no instant fee, QUEUED-exit disclosure', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'firelight', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(STXRP);
    // redeem(uint256,address,address) — 0xba087652.
    expect(res.body.calls[0].data.startsWith('0xba087652')).toBe(true);
    expect(res.body.disclosure.instantRedemptionFeeBps).toBeNull();
    expect(res.body.disclosure.sharePrice).toBeCloseTo(1.000071, 6);
    // Firelight pays in TWO steps — the queue is disclosed BEFORE signing (#6).
    const q = res.body.disclosure.queuedExit;
    expect(q).not.toBeNull();
    expect(q.period).toBe(224);
    expect(q.claimableAt).toBe('2026-07-15T13:42:49.000Z');
    expect(String(res.body.disclosure.note)).toContain('TWO steps');
  });
});

describe('Firelight queued exits — /vault-claims + /vault-claim/prepare', () => {
  it('GET /vault-claims/:owner lists the unclaimed periods with estimates', async () => {
    const res = await request(app).get(`/api/flare-demo/vault-claims/${EVM_WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.currentPeriod).toBe(224);
    expect(res.body.pending.length).toBeGreaterThan(0);
    const cur = res.body.pending.find((p: { period: number }) => p.period === 224);
    // 5 shares × 5.002/5.000 pro-rata = 5.002 FXRP estimated.
    expect(cur.estFxrpBase).toBe('5002000');
    expect(cur.claimable).toBe(false); // period still running
    expect(cur.claimableAt).toBe('2026-07-15T13:42:49.000Z');
    const past = res.body.pending.find((p: { period: number }) => p.period === 223);
    expect(past.claimable).toBe(true);
  });

  it('prepare on a FINISHED period → one unsigned claimWithdraw call', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: 223 });
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(STXRP);
    // claimWithdraw(uint256) — 0xb13acedd (verified FirelightVault impl ABI).
    expect(res.body.calls[0].data.startsWith('0xb13acedd')).toBe(true);
    expect(res.body.disclosure.estimatedFxrpOut).toBeCloseTo(5.002, 6);
    expect(res.body.disclosure.defibroSigns).toBe(false);
  });

  it('XRPL (PA) rail claim → 0xFE Payment with the dispatch fees disclosed (invariant #6)', async () => {
    // Own address so this dispatch does not eat XRPL_ADDR's per-address demo cap.
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ xrplAddress: 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2', period: 223, amountXrpForMint: 1 });
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('xrpl');
    const d = res.body.disclosure;
    expect(d.mintCoupledXrp).toBe(1);
    expect(d.mintingFeeXrp).toBeCloseTo(0.0025, 6);
    expect(d.executorFeeXrp).toBeCloseTo(0.001, 6);
    // fee:null is EVM-rail-only (gas alone) — on the 0xFE rail fees ARE charged.
    expect(d.fee).toBeUndefined();
  });

  it('409 CLAIM_NOT_READY (with claimableAt) while the period still runs', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: 224 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLAIM_NOT_READY');
    expect(res.body.claimableAt).toBe('2026-07-15T13:42:49.000Z');
  });

  it('400 on a bad period', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PERIOD');
  });
});

describe('POST /api/flare-demo/vault-withdraw/prepare — XRPL (PA) rail', () => {
  it('returns the unsigned 0xFE Payment; FXRP destination defaults to the PA', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '50000000', xrplAddress: XRPL_ADDR, amountXrpForMint: 1 });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('xrpl');
    expect(res.body.personalAccount).toBe(PA);
    expect(res.body.xrplPayment.TransactionType).toBe('Payment');
    const d = res.body.disclosure;
    expect(d.fxrpDestination).toBe(PA);
    expect(d.mintCoupledXrp).toBe(1);
    // Invariante #6 — the dispatch's fees always ride the disclosure.
    expect(d.mintingFeeXrp).toBeCloseTo(0.0025, 6);
    expect(d.executorFeeXrp).toBeCloseTo(0.001, 6);
    expect(d.fxrpMintedSideEffect).toBeCloseTo(0.9965, 6);
  });

  it('routes the FXRP to evmDest when given, and requires the mint-coupled XRP', async () => {
    const ok = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '50000000', xrplAddress: XRPL_ADDR, amountXrpForMint: 1, evmDest: EVM_WALLET });
    expect(ok.status).toBe(200);
    expect(ok.body.disclosure.fxrpDestination).toBe(EVM_WALLET);

    const missingMint = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '50000000', xrplAddress: XRPL_ADDR });
    expect(missingMint.status).toBe(400);
    expect(missingMint.body.error).toBe('INVALID_MINT_AMOUNT');
  });
});

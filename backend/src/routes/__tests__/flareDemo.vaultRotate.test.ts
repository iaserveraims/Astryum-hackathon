/**
 * /vault-rotate/prepare — partner-vault ROTATIONS (exit vault A + enter vault
 * B in ONE dispatch). Same hermetic posture as flareDemo.vaultWithdraw.test.ts:
 * the 0xFE rotate handoff builder and PA resolution are mocked, FTSO and the
 * KWYH scanner are stubbed, and vault reads go through a fake ethers.Contract
 * keyed by address. What stays REAL is the route logic: validation, gating
 * (flag + geofence + Monarq switch on the ENTRY side only), share-balance and
 * cap enforcement, the fused three-call EVM batch, the bigint exit arithmetic
 * (share price → instant fee → rotation buffer) and the disclosure contract
 * (#6/#9). Every assertion is over UNSIGNED payloads.
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

// Live-read fixture — FULL vault state (the rotate route reads pause/cap on
// the destination and share price/fee on the origin), LP balances for the
// receipt tokens (both the EVM wallet and the PA hold 100 shares).
const VAULT_STATE: Record<string, Record<string, unknown>> = {
  [STXRP.toLowerCase()]: {
    paused: false,
    depositLimit: 1_000_000_000_000n,
    totalAssets: 500_000_000_000n,
    convertToAssets: 1_000_071n,
    balanceOf: 100_000_000n, // stXRP is its own receipt token
  },
  [EARNXRP_VAULT.toLowerCase()]: {
    depositsPaused: false,
    depositCap: 10_000_000_000_000n,
    getTotalAssets: 5_000_000_000_000n,
    getSharePrice: 1_009_202n,
    instantRedemptionFee: 10n,
    lagDuration: 259_200n,
  },
  [EARNXRP_TOKEN.toLowerCase()]: {
    balanceOf: 100_000_000n,
  },
  [MONARQ_VAULT.toLowerCase()]: {
    depositsPaused: false,
    depositCap: 10_000_000_000_000n,
    getTotalAssets: 5_000_000_000_000n,
    getSharePrice: 1_002_000n,
    instantRedemptionFee: 30n,
    lagDuration: 604_800n,
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
      for (const fn of Object.keys(state)) {
        this[fn] = async () => state[fn]; // read late → tests can mutate state
      }
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

// The 0xFE machinery is covered by E1/E3 + dry-run scripts — stub the rotate
// builder, echoing depositUBA = redeemDepositUBA + net.supplyUBA (its contract).
const FAKE_NET = {
  grossUBA: 1_000_000n,
  mintingFeeUBA: 2_500n,
  executorFeeUBA: 1_000n,
  netToPersonalAccountUBA: 996_500n,
  supplyUBA: 995_500n,
};
const buildVaultRotateHandoffMock = jest.fn(async (_provider: unknown, input: { redeemDepositUBA: bigint }) => ({
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
      Amount: '1000000',
      Memos: [{ Memo: { MemoData: 'FE00' } }],
    },
  },
  depositUBA: input.redeemDepositUBA + FAKE_NET.supplyUBA,
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return { ...actual, buildVaultRotateHandoff: (...args: unknown[]) => buildVaultRotateHandoffMock(...(args as [unknown, { redeemDepositUBA: bigint }])) };
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
  // Upshift APY feed: best-effort — fail it so apy falls back to null+no source.
  global.fetch = jest.fn(async () => {
    throw new Error('offline test');
  }) as unknown as typeof fetch;
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

describe('POST /api/flare-demo/vault-rotate/prepare — validation + gating', () => {
  it('400 on invalid vault keys', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'wagmi', toVault: 'earnxrp', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_VAULT');
  });

  it('400 when fromVault === toVault', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'earnxrp', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_VAULT');
  });

  it('400 when neither evmAddress nor xrplAddress is given', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '1000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_XRPL_ADDRESS');
  });

  it('503 when FLARE_DEFI_ENABLED is off (invariant #8)', async () => {
    process.env.FLARE_DEFI_ENABLED = 'false';
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
    process.env.FLARE_DEFI_ENABLED = 'true';
  });

  it('503 when ENTERING Monarq without its switch (CeDeFi — invariant #10)', async () => {
    delete process.env.UPSHIFT_MONARQ_ENABLED;
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'monarq', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('MONARQ_DISABLED');
  });

  it('EXITING Monarq is NOT gated by UPSHIFT_MONARQ_ENABLED (exits always available)', async () => {
    delete process.env.UPSHIFT_MONARQ_ENABLED;
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'monarq', toVault: 'earnxrp', sharesBase: '1000000', evmAddress: EVM_WALLET });
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
  });

  it('409 INSUFFICIENT_SHARES when the holder owns fewer shares than requested', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '100000001', evmAddress: EVM_WALLET }); // holds 100
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_SHARES');
    expect(res.body.balanceShares).toBeCloseTo(100, 6);
  });

  it('409 VAULT_DEPOSITS_PAUSED when the destination vault is paused', async () => {
    VAULT_STATE[STXRP.toLowerCase()].paused = true;
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '1000000', evmAddress: EVM_WALLET });
    VAULT_STATE[STXRP.toLowerCase()].paused = false;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VAULT_DEPOSITS_PAUSED');
  });

  it('409 VAULT_CAP_EXCEEDED when the deposit does not fit the destination cap', async () => {
    VAULT_STATE[STXRP.toLowerCase()].depositLimit = 500_000_001_000n; // 1000 UBA of room
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '100000000', evmAddress: EVM_WALLET });
    VAULT_STATE[STXRP.toLowerCase()].depositLimit = 1_000_000_000_000n;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('VAULT_CAP_EXCEEDED');
    expect(res.body.capRemainingFxrp).toBeCloseTo(0.001, 6);
  });
});

describe('POST /api/flare-demo/vault-rotate/prepare — EVM-direct rail', () => {
  it('earnXRP → Firelight: fused three-call batch [instantRedeem, approve, deposit] + exit arithmetic', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.account).toBe(EVM_WALLET);
    expect(res.body.calls).toHaveLength(3);
    // Leg 1 — exit: instantRedeem(uint256,address) on the origin vault (0x22928208).
    expect(res.body.calls[0].to).toBe(EARNXRP_VAULT);
    expect(res.body.calls[0].data.startsWith('0x22928208')).toBe(true);
    // Leg 2 — entry: approve FXRP → destination, then ERC-4626 deposit.
    expect(res.body.calls[1].to).toBe(FXRP);
    expect(res.body.calls[2].to).toBe(STXRP);

    const d = res.body.disclosure;
    expect(d.action).toBe('vault-rotate');
    expect(d.from.vault).toBe('earnxrp');
    expect(d.to.vault).toBe('firelight');
    expect(d.sharesRedeemed).toBeCloseTo(100, 6);
    expect(d.from.sharePrice).toBeCloseTo(1.009202, 6);
    // 100 shares × 1.009202 = 100.9202 gross → fee 10 bps = 0.100920 →
    // net 100.81928 → buffer 10 bps = 0.100819 → deposit 100.718461.
    expect(d.instantFeeFxrp).toBeCloseTo(0.10092, 6);
    expect(d.estimatedFxrpOut).toBeCloseTo(100.81928, 5);
    expect(d.rotateBufferBips).toBe(10);
    expect(d.rotateBufferFxrp).toBeCloseTo(0.100819, 6);
    expect(d.fxrpDeposited).toBeCloseTo(100.718461, 6);
    expect(d.depositedValueUSD).toBeCloseTo(100.718461 * 2.0, 4);
    expect(d.disclosedToUser).toBe(true);
    expect(d.defibroSigns).toBe(false);
  });

  it('Firelight → earnXRP: no exit fee (ERC-4626 redeem), buffer still applies', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'earnxrp', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(3);
    // redeem(uint256,address,address) — 0xba087652 — on the stXRP vault.
    expect(res.body.calls[0].to).toBe(STXRP);
    expect(res.body.calls[0].data.startsWith('0xba087652')).toBe(true);
    expect(res.body.calls[2].to).toBe(EARNXRP_VAULT);

    const d = res.body.disclosure;
    expect(d.instantFeeFxrp).toBeNull();
    expect(d.from.sharePrice).toBeCloseTo(1.000071, 6);
    // 100 × 1.000071 = 100.0071 net → buffer 0.100007 → deposit 99.907093.
    expect(d.fxrpDeposited).toBeCloseTo(99.907093, 6);
    // Destination terms disclosed (#6): instant fee bps + epoch lag.
    expect(d.to.withdrawal.instantRedemptionFeeBps).toBe(10);
    expect(d.to.withdrawal.epochLagSeconds).toBe(259200);
  });
});

describe('POST /api/flare-demo/vault-rotate/prepare — XRPL (PA) rail', () => {
  it('fuses both legs into ONE 0xFE dispatch; the mint-coupled FXRP joins the deposit', async () => {
    buildVaultRotateHandoffMock.mockClear();
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'earnxrp', sharesBase: '50000000', xrplAddress: XRPL_ADDR, amountXrpForMint: 1 });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('xrpl');
    expect(res.body.personalAccount).toBe(PA);
    expect(res.body.xrplPayment.TransactionType).toBe('Payment');

    // ONE dispatch → ONE handoff, carrying the exact haircutted redeem output:
    // 50 × 1.000071 = 50.00355 → buffer 10 bps (0.0050003) → 49.953547 FXRP.
    expect(buildVaultRotateHandoffMock).toHaveBeenCalledTimes(1);
    const input = buildVaultRotateHandoffMock.mock.calls[0][1] as {
      fromVault: string; toVault: string; sharesUBA: bigint; redeemDepositUBA: bigint;
    };
    expect(input.fromVault).toBe('firelight');
    expect(input.toVault).toBe('earnxrp');
    expect(input.sharesUBA).toBe(50_000_000n);
    expect(input.redeemDepositUBA).toBe(49_953_547n);

    const d = res.body.disclosure;
    expect(d.singleDispatch).toBe(true);
    expect(d.mintCoupledXrp).toBe(1);
    expect(d.fxrpMintedJoinsDeposit).toBeCloseTo(0.9955, 6);
    // deposit = redeem output + this dispatch's net mint (nothing sits loose).
    expect(d.fxrpDeposited).toBeCloseTo(49.953547 + 0.9955, 6);
    expect(d.executorFeeXrp).toBeCloseTo(0.001, 6);
    expect(d.mintingFeeXrp).toBeCloseTo(0.0025, 6);
  });

  it('requires the mint-coupled XRP amount (the 0xFE rail is mint-coupled)', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'earnxrp', sharesBase: '50000000', xrplAddress: XRPL_ADDR });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MINT_AMOUNT');
  });
});

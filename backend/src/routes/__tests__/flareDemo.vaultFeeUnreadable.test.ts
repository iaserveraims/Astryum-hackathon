/**
 * «NO PUDE LEER LA COMISIÓN» NO ES «NO HAY COMISIÓN».
 *
 * THE FAILURE THIS SUITE PINS. `instantRedemptionFee()` was read with
 * `.catch(() => null)` and every consumer downstream turned that null into a
 * ZERO: `/vault-withdraw/prepare` handed the GROSS over as `estimatedFxrpOut`
 * and stamped it `disclosedToUser: true` (invariant #6 says the fee is visible
 * BEFORE the signature — affirming the absence of a fee nobody could look at
 * is the opposite of disclosing it), and `/vault-rotate/prepare` derived
 * `redeemDepositUBA` — the amount the SECOND leg of the batch deposits — from
 * that zero, with only 10 bips of buffer. earnXRP charges 10 bps and Monarq
 * 30 bps on mainnet, so leg 2 would revert AFTER the person had signed.
 */
import express from 'express';
import request from 'supertest';

// Verified mainnet constants (see .env.example, on-chain).
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';
const MONARQ_VAULT = '0x2439D4bb753A0f3777d4C9011AFacc475ba6B951';
const MONARQ_TOKEN = '0x36f236af59CB279bab884e464Ef1Bc23c7B1a115';
const EVM_WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

/**
 * earnXRP: the instant fee does not answer (the finding).
 * Monarq: everything answers, and the fee is a GENUINE zero — the case
 *         `feeFxrp || null` used to paint with the same brush as «unknown».
 *         Its pause read is the one that fails, covering the other half.
 * stXRP:  Firelight, which has no instant fee to read at all, so its exit
 *         never depended on this read and must keep working.
 */
const VAULT_STATE: Record<string, Record<string, unknown>> = {
  [EARNXRP_VAULT.toLowerCase()]: {
    depositsPaused: false,
    depositCap: 35_000_000_000_000n,
    getTotalAssets: 33_203_252_050_050n,
    getSharePrice: 1_009_202n,
    instantRedemptionFee: '__rpc_down__', // a read that does NOT answer
    lagDuration: 86_400n,
  },
  [EARNXRP_TOKEN.toLowerCase()]: { balanceOf: 100_000_000n },
  [MONARQ_VAULT.toLowerCase()]: {
    depositsPaused: '__rpc_down__', // the OTHER half of the family
    depositCap: 10_000_000_000_000n,
    getTotalAssets: 5_000_000_000_000n,
    getSharePrice: 1_002_000n,
    instantRedemptionFee: 0n, // a real zero: read, and worth nothing
    lagDuration: 604_800n,
  },
  [MONARQ_TOKEN.toLowerCase()]: { balanceOf: 100_000_000n },
  [STXRP.toLowerCase()]: {
    paused: false,
    depositLimit: 100_000_000_000_000n,
    totalAssets: 60_157_000_000_000n,
    convertToAssets: 1_000_071n,
    balanceOf: 100_000_000n,
    currentPeriod: 224n,
    currentPeriodEnd: 1_784_122_969n,
  },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = VAULT_STATE[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        this[fn] = async () => {
          if (value === '__rpc_down__') throw new Error('could not coalesce error (eth_call: connection reset)');
          return value;
        };
      }
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return { ...actual, createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }) };
});

jest.mock('../../integrations/providers/security/GoPlusProvider', () => ({
  goPlusProvider: { call: async () => ({ data: { verdict: 'safe', flags: [] } }) },
}));

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.UPSHIFT_MONARQ_ENABLED = 'true';
  // Both demo-cap layers out of the way: this suite is about the READS, and
  // the cap has its own suite (config/__tests__/demoCap.test.ts).
  process.env.DEMO_MAX_XRP_PER_TX = '1000000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '1000000000';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
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
  delete process.env.UPSHIFT_MONARQ_ENABLED;
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

/** The one sentence a refusal of this family owes a person, in English. */
function assertHonestRefusal(body: Record<string, unknown>, code: string) {
  expect(body.error).toBe(code);
  expect(body.retryable).toBe(true);
  const detail = String(body.detail ?? '');
  expect(detail).toMatch(/could not read/i);
  expect(detail).toMatch(/Nothing was prepared and nothing was signed/i);
  expect(detail).toMatch(/try again/i);
  // A refusal composes NOTHING: no calls, no disclosure, no payload.
  expect(body.calls).toBeUndefined();
  expect(body.disclosure).toBeUndefined();
  expect(body.xrplPayment).toBeUndefined();
}

describe('The chain — an unreadable instant fee never becomes a zero', () => {
  /**
   * REVISED. In this exit was REFUSED. But on /vault-withdraw
   * the fee is not payload: `buildInstantRedeemBatch` needs only `sharesUBA`
   * + `receiver`, the fee is charged by the contract either way, and refusing
   * closed an EXIT over a number that does not change the transaction («la
   * salida jamás se gatea»). What must never happen is the finding —
   * the GROSS handed over as the net, or an empty fee row that reads as free.
   * So the exit COMPOSES, `instantFeeKnown: false` drives the modal's
   * «could not be read on-chain» row (vaultModalTruth: kind 'unreadable'),
   * and `estimatedFxrpOut` is null rather than the gross. /vault-rotate, where
   * the fee SIZES leg 2, keeps refusing — see (b).
   */
  it('(a) EXIT: composes with the fee UNKNOWN — no net asserted, no zero, no silence', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'earnxrp', sharesBase: '100000000', evmAddress: EVM_WALLET });

    // Before: 200 with `estimatedFxrpOut: 100.9202` (the GROSS, fee
    // silently zero).: 502. Now: 200, and the unknown is SAID.
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(EARNXRP_VAULT);
    expect(res.body.calls[0].label).toMatch(/could not be read on-chain/i);
    const d = res.body.disclosure;
    expect(d.instantRedemptionFeeBps).toBeNull();
    expect(d.instantFeeFxrp).toBeNull();
    expect(d.instantFeeKnown).toBe(false); // ← what makes the modal row say «unreadable»
    expect(d.instantFeeSource).toMatch(/did NOT answer/);
    expect(d.estimatedFxrpOut).toBeNull(); // never the gross
    expect(d.estimatedValueUSD).toBeNull();
    expect(d.sharePrice).toBeCloseTo(1.009202, 6); // what WAS read still travels
    expect(d.note).toMatch(/could not read this vault's instant redemption fee/i);
    expect(d.note).toMatch(/NOT telling you what you will receive/);
    expect(d.disclosedToUser).toBe(true);
    expect(d.astryumSigns).toBe(false);
  });

  it('(b) ROTATION: the batch whose second leg is sized by that fee is not composed', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'earnxrp', toVault: 'firelight', sharesBase: '100000000', evmAddress: EVM_WALLET });

    // Before: 200 with three calls, leg 2 depositing the GROSS minus 10 bips —
    // 0.10% of slack against a real 10 bps fee. Leg 2 reverts after signing.
    expect(res.status).toBe(502);
    assertHonestRefusal(res.body, 'VAULT_FEE_UNREADABLE');
    expect(res.body.vault).toBe('earnxrp');
  });

  it('(c) ENTRY: the exit terms of the vault being entered are refused, not blanked', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault/prepare')
      .send({ vault: 'earnxrp', evmAddress: EVM_WALLET, amountFxrp: 10 });

    // Before: 200 with `withdrawal.instantRedemptionFeeBps: null`, which every
    // surface renders as an empty fee row — and silence there reads as «free».
    expect(res.status).toBe(502);
    assertHonestRefusal(res.body, 'VAULT_FEE_UNREADABLE');
  });
});

describe('«I could not read paused()» is not «it takes deposits»', () => {
  it('ENTRY into a vault whose pause read failed is refused, not composed', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault/prepare')
      .send({ vault: 'monarq', evmAddress: EVM_WALLET, amountFxrp: 10 });

    expect(res.status).toBe(502);
    assertHonestRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(String(res.body.detail)).toMatch(/accepting deposits/i);
    expect(String(res.body.detail)).toMatch(/never «it is open»/);
  });

  it('ROTATION into that vault is refused too (the destination is an entry)', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'monarq', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(502);
    assertHonestRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(res.body.vault).toBe('monarq');
  });
});

describe('What the refusal must NOT take away', () => {
  it('THE EXIT THAT DOES NOT DEPEND ON THAT READ STILL WORKS: Firelight redeems', async () => {
    // «La salida jamás se gatea». Firelight has no instant fee to read, so a
    // dead `instantRedemptionFee()` on the Upshift vaults cannot touch it.
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'firelight', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(STXRP);
    const d = res.body.disclosure;
    // null here is a FACT (this vault charges no instant fee), not a gap.
    expect(d.instantRedemptionFeeBps).toBeNull();
    expect(d.instantFeeFxrp).toBeNull();
    expect(d.instantFeeKnown).toBe(true);
    expect(d.estimatedFxrpOut).toBeCloseTo(100.0071, 4);
    expect(d.disclosedToUser).toBe(true);
    expect(d.astryumSigns).toBe(false);
  });

  it('A GENUINE ZERO FEE travels as zero, not as «there is none»', async () => {
    // Monarq's fee here is 0n and it WAS read. `feeFxrp || null` used to send
    // that as null — the same word an unread fee got, and the same word a
    // fee-free vault gets. Three states, one symbol.
    const res = await request(app)
      .post('/api/flare-demo/vault-withdraw/prepare')
      .send({ vault: 'monarq', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(200); // an exit is never gated by the entry pause
    const d = res.body.disclosure;
    expect(d.instantRedemptionFeeBps).toBe(0);
    expect(d.instantFeeFxrp).toBe(0);
    expect(d.instantFeeKnown).toBe(true);
    expect(d.estimatedFxrpOut).toBeCloseTo(100.2, 4);
    expect(d.disclosedToUser).toBe(true);
  });
});

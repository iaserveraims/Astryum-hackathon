/**
 * «KINETIC REVIERTE» ERA FALSO, and the queued exit kept vanishing.
 *
 * (a) `/iso-withdraw/prepare`. Dropped OUR ceiling check when the live
 *     supply could not be read, on the premise that «Kinetic itself rejects a
 *     redeem larger than your position». A real `eth_call` against kFXRP_ISO
 *     (0xD1b7…9CB3) from an account with `balanceOf = 0` answers
 *     `redeemUnderlying(1e12)` → RETURNED `0x…09` (MATH_ERROR), and
 *     `redeem(1e12)` → the same. Compound v2 does not revert: it returns a
 *     code, `estimateGas` passes, MetaMask does not warn, the transaction
 *     MINES with status 1, the person pays gas, nothing moves — and the
 *     frontend tracker reads that receipt as success. `/iso-withdraw` was the
 *     ONLY route of the ISO family without a preflight, and the 502
 *     pushed people to it («Withdraw an exact amount instead»).
 */
import express from 'express';
import request from 'supertest';

const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const EVM_WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

/** A read that does NOT answer (the public RPC's 429 of these days). */
const DOWN = '__rpc_down__';

/** What the fake node returns to the preflight's eth_call, per selector. */
const RPC: { redeemCode: number; redeemUnderlyingCode: number } = { redeemCode: 0, redeemUnderlyingCode: 0 };
const SEL_REDEEM_UNDERLYING = '0x852a12e3';
const SEL_REDEEM = '0xdb006a75';
const SEL_CLAIM = '0xb13acedd';

/** The Firelight queue as the fake node serves it (period → FXRP, or DOWN). */
const QUEUE: { currentPeriod: bigint; slots: Record<number, bigint | typeof DOWN> } = { currentPeriod: 224n, slots: {} };

const STATE: Record<string, Record<string, unknown>> = {
  // kFXRP_ISO: the live supply CANNOT be read (the situation).
  [KFXRP_ISO.toLowerCase()]: { balanceOf: DOWN, balanceOfUnderlying: DOWN },
  // kUSDT0_ISO: readable — 3 USDT0 supplied, 2.95 shares.
  [KUSDT0_ISO.toLowerCase()]: { balanceOf: 2_950_000n, balanceOfUnderlying: 3_000_000n },
  [FXRP.toLowerCase()]: { balanceOf: 1_000_000_000n },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      if (address.toLowerCase() === STXRP.toLowerCase()) {
        this.currentPeriod = async () => QUEUE.currentPeriod;
        this.currentPeriodEnd = async () => 1_784_122_969n;
        this.nextPeriodEnd = async () => 1_784_209_369n;
        this.withdrawalsOf = async (period: bigint) => {
          const v = QUEUE.slots[Number(period)];
          if (v === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return v ?? 0n;
        };
        this.isWithdrawClaimed = async () => false;
        return;
      }
      const state = STATE[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        const impl = async () => {
          if (value === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return value;
        };
        (impl as unknown as { staticCall: unknown }).staticCall = impl;
        this[fn] = impl;
      }
    }
  }
  const coder = actual.ethers.AbiCoder.defaultAbiCoder();
  /** eth_call as a Compound-v2 kToken answers it: a RETURNED uint code, never a revert. */
  class FakeRpcProvider {
    async call(tx: { to?: string; data?: string }): Promise<string> {
      const sel = (tx.data ?? '').slice(0, 10).toLowerCase();
      if (sel === SEL_REDEEM_UNDERLYING) return coder.encode(['uint256'], [RPC.redeemUnderlyingCode]);
      if (sel === SEL_REDEEM) return coder.encode(['uint256'], [RPC.redeemCode]);
      if (sel === SEL_CLAIM) return coder.encode(['uint256'], [0]);
      return coder.encode(['uint256'], [0]);
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
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
  process.env.DEMO_MAX_XRP_PER_TX = '1000000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '1000000000';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.DATABASE_URL;
  process.env.FXRP_TOKEN = FXRP;
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});

afterAll(() => {
  for (const k of [
    'FLARE_DEFI_ENABLED',
    'DEMO_MAX_XRP_PER_TX',
    'DEMO_MAX_XRP_PER_ADDRESS_PER_DAY',
    'FIRELIGHT_STXRP',
    'FIRELIGHT_STAKING',
    'KINETIC_KFXRP_ISO',
    'KINETIC_KUSDT0_ISO',
  ]) {
    delete process.env[k];
  }
  resetAddressCache();
});

beforeEach(() => {
  RPC.redeemCode = 0;
  RPC.redeemUnderlyingCode = 0;
  QUEUE.currentPeriod = 224n;
  QUEUE.slots = {};
});

describe('/iso-withdraw with an unread supply and an exact amount: the dry-run is the ceiling now', () => {
  it('attaches a preflight that, with the kToken RETURNING code 9, says the redeem WILL FAIL — before anyone pays gas', async () => {
    // Exactly what mainnet answered from an account with balanceOf = 0:
    // redeemUnderlying → 0x…09 (MATH_ERROR). No revert.
    RPC.redeemUnderlyingCode = 9;

    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'fxrp', amountBase: '1000000000000' });

    // The exit still COMPOSES (la salida jamás se gatea) …
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(KFXRP_ISO);
    expect(res.body.calls[0].data.startsWith(SEL_REDEEM_UNDERLYING)).toBe(true);
    expect(res.body.disclosure.supplyRead).toBe('unreadable');
    // … and now it carries the verdict left out. `available: true` +
    // `willSucceed: false` is a PROVEN failure: PreflightNotice paints it red
    // and the button reads «Sign anyway — the dry-run says it will fail».
    expect(res.body.preflight).toBeDefined();
    expect(res.body.preflight.available).toBe(true);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(String(res.body.preflight.reason)).toMatch(/MATH_ERROR/);
    expect(res.body.preflight.steps).toEqual([
      expect.objectContaining({ verdict: 'fail', reason: expect.stringMatching(/Kinetic would refuse: MATH_ERROR/) }),
    ]);
  });

  it('the note tells the truth: a returned code — the tx mines, you pay gas, nothing moves — and never claims a revert', async () => {
    RPC.redeemUnderlyingCode = 9;
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'fxrp', amountBase: '2000000' });
    expect(res.status).toBe(200);
    const note = String(res.body.disclosure.note);
    // The sentence that was false.
    expect(note).not.toMatch(/Kinetic itself rejects/i);
    // The last sentence that was false too («reverts if …»): the
    // comptroller answers code 3, the transaction still mines.
    expect(note).not.toMatch(/\breverts\b/i);
    expect(note).toMatch(/returns a code/i);
    expect(note).toMatch(/transaction mines/i);
    expect(note).toMatch(/you pay gas/i);
    expect(note).toMatch(/nothing moves/i);
    expect(note).toMatch(/dry-run/i);
    // Still what owed: nothing here is a statement about what you hold.
    expect(note).toMatch(/Nothing here is a statement about what you hold/i);
    expect(res.body.disclosure.disclosedToUser).toBe(true);
    expect(res.body.disclosure.astryumSigns).toBe(false);
  });

  it('CONTROL — with the node answering code 0 the same prepare carries a GREEN verdict (the check is real, not a constant)', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'fxrp', amountBase: '2000000' });
    expect(res.status).toBe(200);
    expect(res.body.preflight.available).toBe(true);
    expect(res.body.preflight.willSucceed).toBe(true);
    expect(res.body.preflight.steps).toEqual([expect.objectContaining({ verdict: 'ok' })]);
  });

  it('the MAX branch (readable supply, redeem by shares) carries the preflight too — code 9 on redeem(shares) is caught', async () => {
    RPC.redeemCode = 9;
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'usdt0', all: true });
    expect(res.status).toBe(200);
    expect(res.body.calls[0].data.startsWith(SEL_REDEEM)).toBe(true);
    expect(res.body.disclosure.supplyRead).toBe('live');
    expect(res.body.preflight.available).toBe(true);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(String(res.body.preflight.reason)).toMatch(/MATH_ERROR/);
  });

  it('the comptroller refusal (code 3, collateral backing open debt) is a returned code too — the preflight names it', async () => {
    RPC.redeemUnderlyingCode = 3;
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'usdt0', amountBase: '1000000' });
    expect(res.status).toBe(200);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(String(res.body.preflight.reason)).toMatch(/COMPTROLLER_REJECTION/);
  });
});

describe('A claim of period N is not closed by a read of period N+1', () => {
  it('POST /vault-claim/prepare composes claimWithdraw(223) although 224, 225 and the rest of the sweep are down', async () => {
    QUEUE.slots[223] = 5_000_000n;
    for (let p = 164; p <= 225; p++) if (p !== 223) QUEUE.slots[p] = DOWN;

    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: 223 });

    // Answered 502 VAULT_CLAIMS_UNREADABLE here — «period 225 did not
    // answer» — over money already burned out of shares.
    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(STXRP);
    expect(res.body.calls[0].data.startsWith(SEL_CLAIM)).toBe(true);
    expect(res.body.disclosure.period).toBe(223);
    expect(res.body.disclosure.fxrpQueued).toBeCloseTo(5, 6);
    expect(res.body.disclosure.astryumSigns).toBe(false);
    expect(res.body.preflight.available).toBe(true);
  });

  it('and when ITS OWN period does not answer, the claim is refused as unread — never as «nothing queued»', async () => {
    QUEUE.slots[223] = DOWN;
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: 223 });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(String(res.body.detail)).toMatch(/withdrawalsOf\(223\)/);
    expect(String(res.body.detail)).toMatch(/still queued/i);
    expect(res.body.calls).toBeUndefined();
  });

  it('CONTROL — a GENUINE miss (the read answered zero) is still 409 NO_PENDING_CLAIM, with the sweep as orientation', async () => {
    QUEUE.slots[222] = 5_000_000n;
    QUEUE.slots[200] = DOWN;
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ evmAddress: EVM_WALLET, period: 223 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_PENDING_CLAIM');
    expect(res.body.pendingPeriods).toEqual([222]);
    expect(res.body.unreadablePeriods).toEqual([200]);
  });
});

describe('GET /vault-claims serves a PARTIAL sweep as partial — the rows that answered are not thrown away', () => {
  it('one slot down → 200, queueRead "partial", the pending rows AND the unread periods named', async () => {
    QUEUE.slots[223] = 5_000_000n;
    QUEUE.slots[209] = DOWN;
    const res = await request(app).get(`/api/flare-demo/vault-claims/${EVM_WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.queueRead).toBe('partial');
    expect(res.body.pending.map((p: { period: number }) => p.period)).toEqual([223]);
    expect(res.body.unreadablePeriods).toEqual([209]);
    expect(String(res.body.detail)).toMatch(/1 of 62 withdrawal periods did not answer/);
    expect(String(res.body.detail)).toMatch(/still queued/i);
  });

  it('every slot down → 502 VAULT_CLAIMS_UNREADABLE (we could not look), never 200 with an empty queue', async () => {
    for (let p = 164; p <= 225; p++) QUEUE.slots[p] = DOWN;
    const res = await request(app).get(`/api/flare-demo/vault-claims/${EVM_WALLET}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.pending).toBeUndefined();
    expect(String(res.body.detail)).toMatch(/never a statement that your queue is empty/i);
  });

  it('CONTROL — every slot answering → queueRead "live" and no unread list', async () => {
    QUEUE.slots[223] = 5_000_000n;
    const res = await request(app).get(`/api/flare-demo/vault-claims/${EVM_WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.queueRead).toBe('live');
    expect(res.body.unreadablePeriods).toEqual([]);
    expect(res.body.detail).toBeUndefined();
  });
});

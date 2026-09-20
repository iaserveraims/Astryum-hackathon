/**
 * it. 27 — UNA DEUDA QUE NO SE PUDO LEER NO ES UNA DEUDA DE CERO.
 *
 * THE FAILURE THIS SUITE PINS. `/e1-borrow/prepare` read the person's live
 * position with `.catch(() => 0n)` on both legs:
 *
 *   kFxrp.balanceOfUnderlying(...).catch(() => 0n)     // their collateral
 *   kUsdt0.borrowBalanceCurrent(...).catch(() => 0n)   // their current debt
 *
 * and then used those zeros as if they were facts. The damage is not cosmetic:
 *
 *   · `borrowUsdt0 = target - debtNow` with `debtNow = 0` asks for the WHOLE
 *     target, ignoring what that person already owes — they borrow more than
 *     the ratio they chose;
 *   · `totalDebtAfter = debtNow + borrowUsdt0` is what `computeTriggerPrice`
 *     turns into the LIQUIDATION PRICE shown before the signature, so the
 *     number is wrong in the dangerous direction: the warning they are given
 *     arrives later than it promises;
 *   · an unread collateral answered 409 NO_COLLATERAL — «this wallet has no
 *     FXRP supplied» — an assertion about THEIR position that nobody looked at.
 *
 * Same family as the unreadable instant fee one file over (invariants #6 and
 * #9: the number in front of a signature is protocol data with its source, or
 * it is not there), deciding this time how much debt to put on somebody.
 *
 * Hermetic: ethers.Contract is faked by address, and the reads under test
 * REJECT. Every assertion is over a refusal or an UNSIGNED payload.
 */
import express from 'express';
import request from 'supertest';

const ISO_COMPTROLLER = '0x1111111111111111111111111111111111111111';
const ISO_KFXRP = '0x2222222222222222222222222222222222222222';
const ISO_KUSDT0 = '0x3333333333333333333333333333333333333333';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const USDT0 = '0x4444444444444444444444444444444444444444';
const EVM_WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

/** Flipped per test: which of the two position reads refuses to answer. */
const DOWN = { supply: false, debt: false };

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const down = () => {
    throw new Error('could not coalesce error (eth_call: connection reset)');
  };
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const a = address.toLowerCase();
      if (a === ISO_COMPTROLLER.toLowerCase()) {
        // Listed, 70% collateral factor.
        this.markets = async () => [true, 700_000_000_000_000_000n];
        this.checkMembership = async () => true;
      }
      if (a === ISO_KFXRP.toLowerCase()) {
        this.balanceOfUnderlying = { staticCall: async () => (DOWN.supply ? down() : 1_000_000_000n) };
      }
      if (a === ISO_KUSDT0.toLowerCase()) {
        // 400 USDT0 already owed. A borrow sized against `0` instead of this
        // is the whole finding.
        this.borrowBalanceCurrent = { staticCall: async () => (DOWN.debt ? down() : 400_000_000n) };
      }
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return { ...actual, createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }) };
});

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
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = ISO_KFXRP;
  process.env.KINETIC_KUSDT0_ISO = ISO_KUSDT0;
  process.env.FXRP_TOKEN = FXRP;
  process.env.USDT0_TOKEN = USDT0;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.KINETIC_ISO_COMPTROLLER;
  delete process.env.KINETIC_KFXRP_ISO;
  delete process.env.KINETIC_KUSDT0_ISO;
  delete process.env.USDT0_TOKEN;
  resetAddressCache();
});

beforeEach(() => {
  DOWN.supply = false;
  DOWN.debt = false;
});

const borrow = () =>
  request(app).post('/api/flare-demo/e1-borrow/prepare').send({ evmAddress: EVM_WALLET, borrowRatio: 0.5 });

/** What a refusal of this family owes a person, in English — and it composes nothing. */
function assertHonestRefusal(body: Record<string, unknown>) {
  expect(body.error).toBe('BORROW_STATE_UNREADABLE');
  expect(body.retryable).toBe(true);
  const detail = String(body.detail ?? '');
  expect(detail).toMatch(/could not read/i);
  expect(detail).toMatch(/nothing was prepared and nothing was signed/i);
  expect(detail).toMatch(/try again/i);
  expect(body.calls).toBeUndefined();
  expect(body.disclosure).toBeUndefined();
}

describe('it. 27 · the chain — an unread position never becomes a zero', () => {
  it('a debt that did not answer refuses, instead of sizing the loan as if there were none', async () => {
    DOWN.debt = true;
    const res = await borrow();
    // Before: 200, with `borrowUsdt0` = the whole target (the 400 USDT0 owed
    // ignored) and a liquidation trigger computed from an understated debt.
    expect(res.status).toBe(502);
    assertHonestRefusal(res.body);
    expect(String(res.body.detail)).toMatch(/current USDT0 debt/i);
    expect(String(res.body.detail)).toMatch(/never a zero/i);
  });

  it('a collateral that did not answer refuses, instead of asserting the wallet has none', async () => {
    DOWN.supply = true;
    const res = await borrow();
    // Before: 409 NO_COLLATERAL — «This wallet has no FXRP supplied in the ISO
    // market», said about a position we never managed to look at.
    expect(res.status).toBe(502);
    expect(res.body.error).not.toBe('NO_COLLATERAL');
    assertHonestRefusal(res.body);
    expect(String(res.body.detail)).toMatch(/supplied FXRP/i);
  });

  it('and the guard does not over-correct: both reads answering still composes', async () => {
    const res = await borrow();
    expect(res.status).toBe(200);
    // The debt IS subtracted, which is the behaviour the zero was faking.
    expect(String(JSON.stringify(res.body))).toMatch(/borrow/i);
  });
});

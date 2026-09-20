/**
 * it. 29 — A READ THAT FAILED IS NOT A FACT ABOUT ANYBODY'S POSITION.
 *
 * THE FAILURES THIS SUITE PINS (all of them «`.catch(() => 0n)` reaching a
 * screen as a statement about someone's money»):
 *
 *  · Kinetic ISO: `balanceOf` / `balanceOfUnderlying` / `borrowBalanceCurrent`
 *    fell to `0n`; `readIsoLegs` turned the zero into `null`; `/iso-legs`
 *    served it with HTTP 200, and the guided unwind — which only learns of a
 *    failure through HTTP — told the person «No FXRP collateral left — the
 *    unwind is complete» over a carry with live debt. `/iso-withdraw/prepare`
 *    answered an exit with 409 «This wallet has no FXRP supplied».
 *  · The deposit cap was the last guard that trusted a swallowed read:
 *    `capRemainingUBA != null && …` simply SKIPPED the check when
 *    `depositCap()`/`totalAssets()` failed — beside the two (pause, fee) that
 *    refuse. Firelight is 87 % full and earnXRP 72 % on mainnet today.
 *  · Firelight `withdrawalsOf(period)` fell to `0n` inside a 62-period sweep:
 *    one 429 in the right slot and a queued exit — shares already burned —
 *    vanished from `/vault-claims` with its Claim button, and
 *    `/vault-claim/prepare` refused with «nothing queued for this account».
 *  · The it. 27 refusal sentence promised «redeemable from the protocol's own
 *    interface» to every rail; for shares held by a Personal Account that door
 *    does not exist.
 *
 * Hermetic like its siblings: ethers.Contract is a fake keyed by address whose
 * reads can be told NOT to answer. Every assertion is over refusals and
 * UNSIGNED payloads; Astryum signs nothing. Only the EVM-direct rail composes
 * here, so no 0xFE machinery is in the chain under test (the PA-rail case only
 * exercises a refusal that fires BEFORE the Personal Account is resolved).
 */
import express from 'express';
import request from 'supertest';

// Verified mainnet constants (see .env.example).
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';
const MONARQ_VAULT = '0x2439D4bb753A0f3777d4C9011AFacc475ba6B951';
const MONARQ_TOKEN = '0x36f236af59CB279bab884e464Ef1Bc23c7B1a115';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const EVM_WALLET = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const XRPL_WALLET = 'rDcohqb2qWkiVdqmKXqBY6kE7qsmaXHbB1';

/** A read that does NOT answer (the public RPC's 429 of these days). */
const DOWN = '__rpc_down__';

/**
 * kFXRP_ISO: the collateral leg cannot be read.
 * kUSDT0_ISO: reads fine — and carries LIVE DEBT (5 USDT0).
 * earnXRP: everything answers except the deposit cap.
 * Monarq: the pause read fails (fires before any account is resolved).
 * stXRP: healthy vault; its withdrawal queue does not answer.
 */
const STATE: Record<string, Record<string, unknown>> = {
  [KFXRP_ISO.toLowerCase()]: { balanceOf: DOWN, balanceOfUnderlying: DOWN },
  [KUSDT0_ISO.toLowerCase()]: { balanceOf: 0n, balanceOfUnderlying: 0n, borrowBalanceCurrent: 5_000_000n },
  [EARNXRP_VAULT.toLowerCase()]: {
    depositsPaused: false,
    depositCap: DOWN,
    getTotalAssets: 33_203_252_050_050n,
    getSharePrice: 1_009_202n,
    instantRedemptionFee: 10n,
    lagDuration: 86_400n,
  },
  [EARNXRP_TOKEN.toLowerCase()]: { balanceOf: 100_000_000n },
  [MONARQ_VAULT.toLowerCase()]: {
    depositsPaused: DOWN,
    depositCap: 10_000_000_000_000n,
    getTotalAssets: 5_000_000_000_000n,
    getSharePrice: 1_002_000n,
    instantRedemptionFee: 30n,
    lagDuration: 604_800n,
  },
  [MONARQ_TOKEN.toLowerCase()]: { balanceOf: 100_000_000n },
  [STXRP.toLowerCase()]: {
    paused: false,
    depositLimit: 100_000_000_000_000n,
    totalAssets: 87_000_000_000_000n,
    convertToAssets: 1_000_071n,
    balanceOf: 100_000_000n,
    currentPeriod: 224n,
    currentPeriodEnd: 1_784_122_969n,
    nextPeriodEnd: 1_784_727_769n,
    withdrawalsOf: DOWN,
    isWithdrawClaimed: false,
  },
  [FXRP.toLowerCase()]: { balanceOf: 1_000_000_000n },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = STATE[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        const impl = async () => {
          if (value === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return value;
        };
        // `.staticCall` is how the adapters read non-view accrual functions.
        (impl as unknown as { staticCall: unknown }).staticCall = impl;
        this[fn] = impl;
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

// The dry-run talks to a real RPC; not the chain under test here.
jest.mock('../../services/flare/preparePreflight', () => {
  const actual = jest.requireActual('../../services/flare/preparePreflight');
  return {
    ...actual,
    preflightEvmCalls: async () => ({ willSucceed: null, steps: [], simulatedAt: new Date().toISOString() }),
  };
});

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.UPSHIFT_MONARQ_ENABLED = 'true';
  process.env.DEMO_MAX_XRP_PER_TX = '1000000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '1000000000';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.DATABASE_URL;
  process.env.FXRP_TOKEN = FXRP;
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  process.env.UPSHIFT_EARNXRP_VAULT = EARNXRP_VAULT;
  process.env.UPSHIFT_EARNXRP_TOKEN = EARNXRP_TOKEN;
  process.env.UPSHIFT_MONARQ_VAULT = MONARQ_VAULT;
  process.env.UPSHIFT_MONARQ_TOKEN = MONARQ_TOKEN;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});

afterAll(() => {
  for (const k of [
    'FLARE_DEFI_ENABLED',
    'UPSHIFT_MONARQ_ENABLED',
    'DEMO_MAX_XRP_PER_TX',
    'DEMO_MAX_XRP_PER_ADDRESS_PER_DAY',
    'FIRELIGHT_STXRP',
    'FIRELIGHT_STAKING',
    'UPSHIFT_EARNXRP_VAULT',
    'UPSHIFT_EARNXRP_TOKEN',
    'UPSHIFT_MONARQ_VAULT',
    'UPSHIFT_MONARQ_TOKEN',
    'KINETIC_KFXRP_ISO',
    'KINETIC_KUSDT0_ISO',
  ]) {
    delete process.env[k];
  }
  resetAddressCache();
});

/** What every refusal of this family owes: retryable, names the read, composes NOTHING. */
function assertUnreadRefusal(body: Record<string, unknown>, code: string) {
  expect(body.error).toBe(code);
  expect(body.retryable).toBe(true);
  expect(String(body.detail)).toMatch(/could not read/i);
  expect(String(body.detail)).toMatch(/try again/i);
  expect(body.calls).toBeUndefined();
  expect(body.disclosure).toBeUndefined();
  expect(body.xrplPayment).toBeUndefined();
}

describe('it. 29 · (a) the guided unwind can no longer be told a position is empty', () => {
  it('GET /iso-legs answers a FAILED read as a failure — never 200 with nulls', async () => {
    const res = await request(app).get(`/api/flare-demo/iso-legs/${EVM_WALLET}`);

    // Before: 200 { supplyFxrpBase: null, suppliedUsdt0Base: null, debtUsdt0Base: '5000000' }
    // → the frontend guard (HTTP-only) never fired, step 3 read 0 FXRP and said
    // «the unwind is complete» over 5 USDT0 of live debt.
    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'ISO_LEGS_UNREADABLE');
    expect(String(res.body.detail)).toMatch(/never a statement about what you hold/i);
    // No leg key at all: `parseIsoLegs` on the frontend refuses to call this a reading.
    expect(res.body).not.toHaveProperty('supplyFxrpBase');
    expect(res.body).not.toHaveProperty('debtUsdt0Base');
    expect(res.body).not.toHaveProperty('legsRead');
  });
});

describe('it. 29 · (b) /iso-withdraw never says «you have nothing» over a read that failed', () => {
  it('MAX exit (needs the share balance): refused as UNREADABLE, not as NO_SUPPLY_TO_WITHDRAW', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'fxrp', all: true });

    // Before: 409 NO_SUPPLY_TO_WITHDRAW · «This wallet has no FXRP supplied».
    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'ISO_SUPPLY_UNREADABLE');
    expect(res.body.error).not.toBe('NO_SUPPLY_TO_WITHDRAW');
    expect(String(res.body.detail)).toMatch(/never a statement about what you hold/i);
    // …and it names the door that stays open.
    expect(String(res.body.detail)).toMatch(/exact amount/i);
  });

  it('EXACT amount: the exit COMPOSES without our ceiling check, and the disclosure says the supply was unread', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'fxrp', amountBase: '2000000' });

    // «La salida jamás se gatea»: the calldata needs only the amount; the
    // ceiling was OUR check, and Kinetic itself rejects an oversized redeem.
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(KFXRP_ISO);
    const d = res.body.disclosure;
    expect(d.supplyRead).toBe('unreadable');
    expect(d.availableBase).toBeNull();
    expect(d.available).toBeNull();
    expect(d.amount).toBe(2);
    expect(d.note).toMatch(/could not read your live supply/i);
    expect(d.note).toMatch(/Nothing here is a statement about what you hold/i);
    expect(d.disclosedToUser).toBe(true);
    expect(d.astryumSigns).toBe(false);
  });

  it('CONTROL — a GENUINE zero (the read answered) is still a fact: 409 NO_SUPPLY_TO_WITHDRAW', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: EVM_WALLET, asset: 'usdt0', all: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_SUPPLY_TO_WITHDRAW');
  });
});

describe('it. 29 · (c) the deposit cap is checked or refused — never skipped', () => {
  it('ENTRY into a vault whose cap could not be read is refused, beside pause and fee', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault/prepare')
      .send({ vault: 'earnxrp', evmAddress: EVM_WALLET, amountFxrp: 10 });

    // Before: 200 — `capRemainingUBA != null && …` skipped the check in silence,
    // and the deposit reverted AFTER the signature.
    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(String(res.body.detail)).toMatch(/deposit cap/i);
    expect(String(res.body.detail)).toMatch(/not a cap with room/i);
    // An entry: nothing of theirs is in the vault — and no promise of a door.
    expect(String(res.body.detail)).toMatch(/nothing of yours is in this vault/i);
    expect(String(res.body.detail)).not.toMatch(/protocol's own interface/i);
  });

  it('ROTATION into that vault is refused for the same reason (leg 2 is an entry)', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'earnxrp', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(res.body.vault).toBe('earnxrp');
    expect(String(res.body.detail)).toMatch(/deposit cap/i);
    expect(String(res.body.detail)).toMatch(/plain withdrawal .* not affected/i);
  });
});

describe('it. 29 · the refusal sentence tells each rail the truth about where its shares are', () => {
  it('EVM rail: the shares are in the wallet — the protocol\'s own interface IS a door', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'monarq', sharesBase: '100000000', evmAddress: EVM_WALLET });

    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(String(res.body.detail)).toMatch(/your shares stay in your own wallet/i);
    expect(String(res.body.detail)).toMatch(/protocol's own interface/i);
  });

  it('XRPL rail (Personal Account): NO promise of a door that does not exist', async () => {
    // This refusal fires before the Personal Account is resolved, so the PA
    // rail is reachable hermetically. Before it. 29 this rail got the EVM
    // sentence verbatim — «redeemable from the protocol's own interface» —
    // which is false for a PA (Upshift's app connects an EOA, not the PA).
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'monarq', sharesBase: '100000000', xrplAddress: XRPL_WALLET, amountXrpForMint: 1 });

    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_STATE_UNREADABLE');
    expect(String(res.body.detail)).toMatch(/your shares stay in your Personal Account/i);
    expect(String(res.body.detail)).toMatch(/reopens the moment the read answers/i);
    expect(String(res.body.detail)).not.toMatch(/protocol's own interface/i);
    expect(String(res.body.detail)).not.toMatch(/own wallet/i);
  });
});

describe('it. 29 · money in flight does not disappear when the queue read fails', () => {
  it('GET /vault-claims answers a failed sweep as UNREADABLE — never 200 with an empty queue', async () => {
    const res = await request(app).get(`/api/flare-demo/vault-claims/${EVM_WALLET}`);

    // Before: 200 { pending: [] } — the burned-shares exit and its Claim
    // button vanished from the panel (founder, 9-sep).
    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_CLAIMS_UNREADABLE');
    expect(res.body.pending).toBeUndefined();
    expect(String(res.body.detail)).toMatch(/still queued/i);
    expect(String(res.body.detail)).toMatch(/never a statement that your queue is empty/i);
  });

  it('POST /vault-claim/prepare does not turn the same failure into «nothing queued for this account»', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-claim/prepare')
      .send({ period: 220, evmAddress: EVM_WALLET });

    // Before: 409 NO_PENDING_CLAIM — a claim refused on an invented fact.
    expect(res.status).toBe(502);
    assertUnreadRefusal(res.body, 'VAULT_CLAIMS_UNREADABLE');
    expect(res.body.error).not.toBe('NO_PENDING_CLAIM');
    expect(String(res.body.detail)).toMatch(/still queued/i);
  });
});

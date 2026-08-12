/**
 * Invariant frontier of /api/xrpl-defi/* — flag (#10) + geofence (#5) gate every
 * PREPARE endpoint, and the handoffs that come back are UNSIGNED txjson +
 * disclosure (#6). Hermetic: builders are pure functions (no network); only
 * amm-info/ecosystem-watch touch the network and are not exercised here.
 */
import express from 'express';
import request from 'supertest';
import xrplDefiRouter from '../xrplDefi';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const GOOD_XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';

const PREPARES: Array<[string, Record<string, unknown>]> = [
  [
    '/api/xrpl-defi/escrow-create/prepare',
    {
      account: GOOD_XRPL,
      amountDrops: '5000000',
      finishAfterISO: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
  ],
  ['/api/xrpl-defi/escrow-finish/prepare', { account: GOOD_XRPL, owner: GOOD_XRPL, offerSequence: 7 }],
  [
    '/api/xrpl-defi/offer-create/prepare',
    {
      account: GOOD_XRPL,
      takerGets: '1000000',
      takerPays: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '2' },
      flags: { immediateOrCancel: true },
    },
  ],
  ['/api/xrpl-defi/offer-cancel/prepare', { account: GOOD_XRPL, offerSequence: 12 }],
  [
    '/api/xrpl-defi/amm-deposit/prepare',
    {
      account: GOOD_XRPL,
      asset: { currency: 'XRP' },
      asset2: { currency: 'RLUSD', issuer: RLUSD_ISSUER },
      deposit: { mode: 'single-asset', amount: '1000000' },
    },
  ],
  [
    '/api/xrpl-defi/amm-withdraw/prepare',
    {
      account: GOOD_XRPL,
      asset: { currency: 'XRP' },
      asset2: { currency: 'RLUSD', issuer: RLUSD_ISSUER },
      withdraw: { mode: 'all' },
    },
  ],
];

// §1.3: the council/cage prepares now enforce the Legacy gate server-side.
// This suite exercises the flag/geofence/handoff frontier, not the gate (it
// has its own suite) — the global switch opens it without a users table.
process.env.LEGACY_ENABLED = 'true';

const ORIGINAL_ENV = { ...process.env };
// escrow-create reads the live owner reserve from server_info — mock it so
// the suite stays hermetic (builders themselves remain pure).
beforeEach(() => {
  jest.spyOn(xrplProvider, 'getOwnerReserveXrp').mockResolvedValue(0.2);
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

describe('XRPL_DEFI_ENABLED flag (#10) — closed by default', () => {
  it.each(PREPARES)('%s → 503 when the flag is unset', async (url, body) => {
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });
});

describe('geofence (#5) — fail-closed under an allowlist', () => {
  it('451 when an allowlist is set and no region is sent', async () => {
    process.env.XRPL_DEFI_ENABLED = 'true';
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,FR';
    const [url, body] = PREPARES[0];
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(451);
    expect(res.body.error).toContain('GEOFENCE_BLOCKED');
  });

  it('passes with an allowlisted region in the body', async () => {
    process.env.XRPL_DEFI_ENABLED = 'true';
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,FR';
    const [url, body] = PREPARES[0];
    const res = await request(app).post(url).send({ ...body, region: 'ES' });
    expect(res.status).toBe(200);
  });
});

describe('prepare handoffs — unsigned txjson + disclosure (#6)', () => {
  beforeEach(() => {
    process.env.XRPL_DEFI_ENABLED = 'true';
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  });

  it.each(PREPARES)('%s returns an unsigned handoff with full disclosure', async (url, body) => {
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(200);
    const { xrplTx, disclosure } = res.body;
    expect(typeof xrplTx.TransactionType).toBe('string');
    expect(xrplTx.Account).toBe(GOOD_XRPL);
    // never signed
    expect(xrplTx.TxnSignature).toBeUndefined();
    expect(xrplTx.SigningPubKey).toBeUndefined();
    // invariant #6/#1
    expect(disclosure.disclosedToUser).toBe(true);
    expect(disclosure.defibroSigns).toBe(false);
    expect(typeof disclosure.note).toBe('string');
  });

  it('escrow-create discloses the LIVE owner reserve (read from the ledger, never hardcoded)', async () => {
    const [url, body] = PREPARES[0];
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.note).toContain('0.2 XRP right now');
    expect(res.body.disclosure.facts.ownerReserveXrp).toBe(0.2);
  });

  it('escrow-create still prepares when the reserve read fails — reserve disclosed without figure', async () => {
    (xrplProvider.getOwnerReserveXrp as jest.Mock).mockRejectedValue(new Error('offline'));
    const [url, body] = PREPARES[0];
    const res = await request(app).post(url).send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.note).toMatch(/owner reserve/);
    expect(res.body.disclosure.facts.ownerReserveXrp).toBeUndefined();
  });

  it('malformed body → 400 INVALID_BODY (never a 500)', async () => {
    const res = await request(app)
      .post('/api/xrpl-defi/escrow-create/prepare')
      .send({ account: 'not-xrpl', amountDrops: '-3', finishAfterISO: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('builder-level rejection → 400 BUILD_FAILED with a readable detail', async () => {
    const res = await request(app).post('/api/xrpl-defi/escrow-create/prepare').send({
      account: GOOD_XRPL,
      amountDrops: '1000000',
      finishAfterISO: new Date(Date.now() - 86_400_000).toISOString(), // past
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BUILD_FAILED');
    expect(res.body.detail).toMatch(/future/);
  });
});

describe('escrow release rail (B.1) — previousTxnID → OfferSequence resolution', () => {
  const TXID = 'A'.repeat(64);

  beforeEach(() => {
    process.env.XRPL_DEFI_ENABLED = 'true';
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  });
  afterEach(() => jest.restoreAllMocks());

  it('resolves the EscrowCreate sequence from previousTxnID (read-only tx lookup)', async () => {
    jest.spyOn(xrplProvider, 'getEscrowCreateSequence').mockResolvedValue(4242);
    const res = await request(app)
      .post('/api/xrpl-defi/escrow-finish/prepare')
      .send({ account: GOOD_XRPL, owner: GOOD_XRPL, previousTxnID: TXID });
    expect(res.status).toBe(200);
    expect(res.body.xrplTx.OfferSequence).toBe(4242);
    expect(res.body.xrplTx.TxnSignature).toBeUndefined();
  });

  it('unresolvable previousTxnID → 404 with guidance, never a guessed sequence', async () => {
    jest.spyOn(xrplProvider, 'getEscrowCreateSequence').mockResolvedValue(null);
    const res = await request(app)
      .post('/api/xrpl-defi/escrow-finish/prepare')
      .send({ account: GOOD_XRPL, owner: GOOD_XRPL, previousTxnID: TXID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ESCROW_SEQUENCE_NOT_FOUND');
  });

  it('neither offerSequence nor previousTxnID → 400', async () => {
    const res = await request(app)
      .post('/api/xrpl-defi/escrow-finish/prepare')
      .send({ account: GOOD_XRPL, owner: GOOD_XRPL });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/xrpl-defi/escrows — the Savings surface read (open, monitoring)', () => {
  const SPENDABLE = {
    balanceXrp: 100,
    spendableXrp: 98.6,
    reserveXrp: 1.4,
    ownerCount: 2,
    nextObjectReserveXrp: 0.2,
  };

  afterEach(() => jest.restoreAllMocks());

  it('lists escrows with ISO dates, releasableNow and the spendable balance', async () => {
    jest.spyOn(xrplProvider, 'getDeFiPositions').mockResolvedValue([
      {
        type: 'escrow',
        currency: 'XRP',
        balance: '5.000000',
        details: {
          owner: GOOD_XRPL,
          destination: GOOD_XRPL,
          isOutgoing: true,
          finishAfter: 100, // ripple epoch 2000-01-01T00:01:40Z → long past
          previousTxnID: 'B'.repeat(64),
          hasCondition: false,
        },
      },
    ]);
    jest.spyOn(xrplProvider, 'getSpendableBalance').mockResolvedValue(SPENDABLE);
    const res = await request(app).get('/api/xrpl-defi/escrows').query({ account: GOOD_XRPL });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.escrows[0].finishAfterISO).toBe('2000-01-01T00:01:40.000Z');
    expect(res.body.escrows[0].releasableNow).toBe(true);
    expect(res.body.account).toEqual(SPENDABLE);
  });

  it('balance read failure degrades to account:null — the list must still answer', async () => {
    jest.spyOn(xrplProvider, 'getDeFiPositions').mockResolvedValue([]);
    jest.spyOn(xrplProvider, 'getSpendableBalance').mockRejectedValue(new Error('ws down'));
    const res = await request(app).get('/api/xrpl-defi/escrows').query({ account: GOOD_XRPL });
    expect(res.status).toBe(200);
    expect(res.body.account).toBeNull();
  });

  it('rejects a non-XRPL account', async () => {
    const res = await request(app).get('/api/xrpl-defi/escrows').query({ account: '0x1234' });
    expect(res.status).toBe(400);
  });
});

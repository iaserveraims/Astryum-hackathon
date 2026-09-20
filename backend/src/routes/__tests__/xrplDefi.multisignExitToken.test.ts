/**
 * A Legacy recall/evacuate can be SIGNED from a blocked region.
 *
 * `/council-order/prepare` already treated recall|evacuate as exits, but the council
 * signs through `/multisign/prepare`, which pins any `xrplTx` and stayed geofenced:
 * the exit was composable and unsignable. The compose door now issues an
 * `exitToken` bound to {account, exact tx, action, 15 min}; the coordinator skips
 * the geofence only for a token that verifies against the same account and bytes.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => ({ vault: '0xv', bridge: '0xb', chain: 'flare' })),
  noCageResponse: () => null,
}));
jest.mock('../../services/CouncilProposalService', () => ({
  councilOrderPreflight: jest.fn(async () => ({ blocked: null, summaryCtx: null })),
}));
jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  buildCouncilOrderHandoff: jest.fn(async (input: { council: string; action: string }) => ({
    xrplTx: {
      TransactionType: 'Payment',
      Account: input.council,
      Destination: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY',
      Amount: '1',
      Memos: [{ Memo: { MemoData: input.action === 'recall' ? 'AA01' : 'BB02' } }],
    },
    order: { orderHash: '0x1', orderData: '0x', action: input.action, summary: 's', nonce: 0, chain: 'flare', bridge: '0xb', vault: '0xv' },
    disclosure: { disclosedToUser: true },
  })),
}));
jest.mock('../../services/flare/LegacyOrderStore', () => ({
  saveCouncilOrderRecord: jest.fn(async () => undefined),
}));
jest.mock('../councilProposals', () => ({
  findLiveProposal: jest.fn(async () => null),
  findUnresolvedSeat: jest.fn(async () => null),
  recordCeremonySeat: jest.fn(async () => undefined),
  sessionIsCouncilMember: jest.fn(async () => false),
}));
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({ xrplProvider: {} }));
const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

// The Prisma client loads backend/.env when first required (the MAC secret via
// SiweAuth). Load it before ENV is captured; beforeEach keeps the suite database-free.
import '../../database/prismaClient';
import xrplDefiRouter from '../xrplDefi';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const OTHER_COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const BLOCKED = 'US';
const COMPOSE = '/api/xrpl-defi/council-order/prepare';
const PIN = '/api/xrpl-defi/multisign/prepare';

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, JWT_SECRET: 'k'.repeat(40) };
  delete process.env.DATABASE_URL;
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  mockPrepare.mockImplementation(async (_r: unknown, input: { account: string; xrplTx: Record<string, unknown> }) => ({
    multisigTx: { ...input.xrplTx, Account: input.account, Sequence: 11, Fee: '36', SigningPubKey: '' },
    council: { quorum: 2, masterKeyDisabled: true, signers: [] },
    fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
    preflight: { available: true, willSucceed: true, balanceChanges: [] },
  }));
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
});
afterEach(() => {
  geoSpy.mockRestore();
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env = ENV;
});

async function compose(action: string, params: Record<string, unknown>) {
  const res = await request(app).post(COMPOSE).send({ account: COUNCIL, action, params, region: BLOCKED });
  expect(res.status).toBe(200);
  return res.body as { xrplTx: Record<string, unknown>; exitToken?: string; exitTokenExpiresAt?: string };
}

describe('council-order/prepare issues the exit token only for exits', () => {
  it('recall and evacuate carry exitToken + its expiry (15 min)', async () => {
    for (const [action, params] of [['recall', { venueId: 0, amount: '1000' }], ['evacuate', { venueId: 0 }]] as const) {
      const h = await compose(action, params);
      expect(typeof h.exitToken).toBe('string');
      const ttl = new Date(String(h.exitTokenExpiresAt)).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(14 * 60_000);
      expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    }
  });

  it('an entry (direct-to, allowed region) carries NO token', async () => {
    const res = await request(app).post(COMPOSE).send({ account: COUNCIL, action: 'direct-to', params: { venueId: 0, amount: '1' }, region: 'ES' });
    expect(res.status).toBe(200);
    expect(res.body.exitToken).toBeUndefined();
  });
});

describe('multisign/prepare — the token opens the exit for THOSE bytes only', () => {
  it('blocked region + the valid token → pinned (200), without asking the geofence', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    geoSpy.mockClear();
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: h.xrplTx, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('a re-pin of the tx with coordinator-pinned fields already on it still verifies', async () => {
    const h = await compose('evacuate', { venueId: 0 });
    const res = await request(app)
      .post(PIN)
      .send({ account: COUNCIL, xrplTx: { ...h.xrplTx, Sequence: 11, Fee: '36', SigningPubKey: '' }, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(200);
  });

  it('blocked region with NO token stays 451', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: h.xrplTx, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.exitTokenRejected).toBeUndefined();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('a token for a DIFFERENT tx → 451 (other-tx)', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    const entryTx = { ...h.xrplTx, Memos: [{ Memo: { MemoData: 'CC03' } }] };
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: entryTx, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.exitTokenRejected).toBe('other-tx');
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('a token presented for ANOTHER council → 451 (other-account)', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    const res = await request(app).post(PIN).send({ account: OTHER_COUNCIL, xrplTx: h.xrplTx, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.exitTokenRejected).toBe('other-account');
  });

  it('an EXPIRED token → 451', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    const later = Date.now() + 16 * 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: h.xrplTx, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.exitTokenRejected).toBe('expired');
  });

  it('a TAMPERED token → 451', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    const [payload, sig] = String(h.exitToken).split('.');
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    body.exp += 7 * 24 * 3600_000;
    const tampered = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`;
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: h.xrplTx, exitToken: tampered, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.exitTokenRejected).toBe('bad-signature');
  });

  it('the flag still applies: XRPL_DEFI_ENABLED off answers 503 even with a valid token', async () => {
    const h = await compose('recall', { venueId: 0, amount: '1000' });
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: h.xrplTx, exitToken: h.exitToken, region: BLOCKED });
    expect(res.status).toBe(503);
  });
});

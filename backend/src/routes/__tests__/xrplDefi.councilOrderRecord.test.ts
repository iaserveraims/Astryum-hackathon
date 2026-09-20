/**
 * productizer it. 13 (finding 3.5) — the Legacy door REMEMBERS what it composes.
 *
 * `/xrpl-defi/council-order/prepare` did not record the composed order, so a reload
 * between broadcast and `onSettled` left a quorum-signed order with no relay. It now
 * uses the SAME rule as the institutional doors: recorded → `serverDelivery`; an exit
 * that cannot be remembered still goes out with `recoveryWarning`; anything else is
 * refused (503, or 429 when the council's queue is full).
 */
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

const ORDER_DATA = '0xc0ffee';
const MEMO = ethers.keccak256(ORDER_DATA).slice(2).toUpperCase();
const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

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
      Memos: [{ Memo: { MemoData: 'D0'.repeat(32) } }],
    },
    order: { orderHash: '0x1', orderData: '0xc0ffee', action: input.action, summary: 's', nonce: 0, chain: 'flare', bridge: '0xb', vault: '0xv' },
    disclosure: { disclosedToUser: true },
  })),
}));
const mockSaveOrder = jest.fn(async () => undefined);
jest.mock('../../services/flare/LegacyOrderStore', () => ({
  saveCouncilOrderRecord: (...a: unknown[]) => mockSaveOrder(...(a as [])),
}));
const mockReadPin = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplOrderSequencePin', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplOrderSequencePin'),
  readOrderSequencePin: (...a: unknown[]) => mockReadPin(...a),
}));
const mockRecord = jest.fn();
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  recordComposedCouncilOrder: (...a: unknown[]) => mockRecord(...a),
}));
const mockRecent = jest.fn();
jest.mock('../../services/flare/CouncilOrderRelayLauncher', () => ({
  ...jest.requireActual('../../services/flare/CouncilOrderRelayLauncher'),
  recentSameCouncilOrder: (...a: unknown[]) => mockRecent(...a),
}));
/**
 * it. 17: this door now spends TWO cheap database reads before it composes — the
 * queue pre-check (the cap, decided before the chain reads) and the ledger half of
 * the duplicate guard (what the 5-minute sweep has not marked yet). Both are
 * best-effort, but an unmocked Prisma here would try to dial a real postgres and
 * time the suite out, so the table answers empty.
 */
const mockJobFindMany = jest.fn(async () => [] as unknown[]);
jest.mock('../../database/prismaClient', () => ({
  prisma: { backgroundJob: { findMany: (...a: unknown[]) => mockJobFindMany(...(a as [])) } },
}));

import xrplDefiRouter from '../xrplDefi';
import {
  ComposedOrderUnrecordedError,
  TooManyPendingOrdersError,
  councilOrderContentKey,
} from '../../services/flare/ComposedCouncilOrderStore';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);
const URL = '/api/xrpl-defi/council-order/prepare';
const RECALL = { account: COUNCIL, action: 'recall', params: { venueId: 0, amount: '1000' } };
const DIRECT = { account: COUNCIL, action: 'direct-to', params: { venueId: 0, amount: '1' }, region: 'ES' };

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, JWT_SECRET: 'k'.repeat(40), DATABASE_URL: 'postgres://test' };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.FLARE_EXECUTOR_ENABLED;
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  mockReadPin.mockResolvedValue({ account: COUNCIL, sequence: 77, validatedLedgerIndex: 5_000, lastLedgerSequence: null, multisigCouncil: true });
  mockRecord.mockResolvedValue({ recorded: true });
  mockRecent.mockResolvedValue(null);
  // `clearAllMocks` keeps implementations, so the queue is emptied explicitly: one
  // test fills it, and it must not spill into the next.
  mockJobFindMany.mockResolvedValue([]);
});
afterAll(() => {
  process.env = ENV;
});

describe('council-order/prepare records the composed order', () => {
  it('records route, account, bytes and the ledger to scan from — and says so (serverDelivery)', async () => {
    const res = await request(app).post(URL).send(RECALL);
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      route: 'legacy-council-order',
      action: 'recall',
      council: COUNCIL,
      order: { orderData: ORDER_DATA },
      pin: { sequence: 77, lastLedgerSequence: null, validatedLedgerIndex: 5_000 },
    });
    expect(res.body.serverDelivery).toEqual({ recorded: true, executorEnabled: false });
    expect(res.body).not.toHaveProperty('recoveryWarning');
    expect(typeof res.body.exitToken).toBe('string');
  });

  it('not recordable: an ENTRY is refused 503 with no order; an EXIT goes out with recoveryWarning', async () => {
    mockRecord.mockRejectedValue(new ComposedOrderUnrecordedError(MEMO, 'db down'));
    const entry = await request(app).post(URL).send(DIRECT);
    expect(entry.status).toBe(503);
    expect(entry.body.error).toBe('ORDER_RECOVERY_UNRECORDED');
    expect(entry.body).not.toHaveProperty('xrplTx');
    const exit = await request(app).post(URL).send(RECALL);
    expect(exit.status).toBe(200);
    expect(exit.body.xrplTx).toBeDefined();
    expect(String(exit.body.recoveryWarning)).toContain('ORDER_RECOVERY_UNRECORDED');
    expect(exit.body.serverDelivery).toEqual({ recorded: false, executorEnabled: false });
  });

  it('a full queue: an ENTRY is 429 TOO_MANY_PENDING_ORDERS; an EXIT still goes out', async () => {
    mockRecord.mockRejectedValue(new TooManyPendingOrdersError(COUNCIL, 50));
    const entry = await request(app).post(URL).send(DIRECT);
    expect(entry.status).toBe(429);
    expect(entry.body.error).toBe('TOO_MANY_PENDING_ORDERS');
    const exit = await request(app).post(URL).send(RECALL);
    expect(exit.status).toBe(200);
    expect(String(exit.body.recoveryWarning)).toContain('TOO_MANY_PENDING_ORDERS');
  });

  it('records WHO composed it and the content key (it. 15: the cap counts by preparer)', async () => {
    await request(app).post(URL).send(RECALL);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      preparedByUserId: null,
      preparedByProven: false,
      contentKey: councilOrderContentKey({ council: COUNCIL, action: 'recall', params: { venueId: 0, amount: '1000' } }),
      exit: true,
    });
  });

  it('the SAME order launched 5 min ago: a non-exit is 409 unless confirmed; an exit goes out with duplicateWarning', async () => {
    const RECENT = { memoHex: MEMO, xrplTxHash: 'C'.repeat(64), launchedAt: new Date(Date.now() - 5 * 60_000).toISOString(), state: 'executed' as const };
    mockRecent.mockResolvedValue(RECENT);
    const entry = await request(app).post(URL).send(DIRECT);
    expect(entry.status).toBe(409);
    expect(entry.body).toMatchObject({ error: 'SAME_ORDER_RECENTLY_LAUNCHED', xrplTxHash: RECENT.xrplTxHash });
    expect(mockRecord).not.toHaveBeenCalled();

    const confirmed = await request(app).post(URL).send({ ...DIRECT, confirmAnotherOrder: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).not.toHaveProperty('duplicateWarning');

    const exit = await request(app).post(URL).send(RECALL);
    expect(exit.status).toBe(200);
    expect(String(exit.body.duplicateWarning)).toContain(RECENT.xrplTxHash);
  });

  /**
   * it. 19 (finding 2.6) — THE CHEAP CHECK GOES FIRST, IN ALL THREE DOORS.
   *
   * The duplicate guard spends LEDGER reads (up to three memos through the fate
   * budget); the queue pre-check is one database read and no chain read. Asking the
   * duplicate guard first let a caller whose queue is already full pull node reads on
   * every attempt — the very amplification the pre-check exists to stop.
   */
  it('a queue already full refuses BEFORE the duplicate guard spends a single ledger read', async () => {
    mockJobFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        payload: {
          memoHex: (i + 16).toString(16).toUpperCase().padStart(64, '0'),
          orderHash: '0x' + (i + 16).toString(16).padStart(64, '0'),
          orderData: '0xc0ffee',
          council: COUNCIL,
          route: 'legacy-council-order',
          action: 'direct-to',
          sequence: 77,
          lastLedgerSequence: null,
          composedLedgerIndex: 5_000,
          composedAt: new Date().toISOString(),
        },
      })),
    );

    const res = await request(app).post(URL).send(DIRECT);

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('TOO_MANY_PENDING_ORDERS');
    expect(mockRecent).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('a DIFFERENT order in sequence is not a duplicate', async () => {
    mockRecent.mockImplementation(async (_c: string, key: string) =>
      key === councilOrderContentKey({ council: COUNCIL, action: 'direct-to', params: { venueId: 1, amount: '1' } })
        ? { memoHex: MEMO, xrplTxHash: 'C'.repeat(64), launchedAt: new Date().toISOString(), state: 'executed' }
        : null,
    );
    const res = await request(app).post(URL).send(DIRECT);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('duplicateWarning');
  });

  it('the ledger unreadable for the scan start: an ENTRY is 503, an EXIT goes out with the warning', async () => {
    mockReadPin.mockRejectedValue(new Error('xrpl_endpoint_stale'));
    const entry = await request(app).post(URL).send(DIRECT);
    expect(entry.status).toBe(503);
    expect(entry.body.error).toBe('ORDER_RECOVERY_UNRECORDED');
    const exit = await request(app).post(URL).send(RECALL);
    expect(exit.status).toBe(200);
    expect(String(exit.body.recoveryWarning)).toContain('ORDER_RECOVERY_UNRECORDED');
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

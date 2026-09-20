/**
 * productizer-it13 §1.1 — a client's «Xaman signed it» is REMEMBERED on the queued
 * row while the ledger has not validated the Payment, so the seat guard can look
 * the hash up before the TTL retires the seat. The report marks nothing and grants
 * nothing; its window starts at the FIRST report and a repeat cannot extend it.
 *
 * Also pinned: the ledger verifier tells «a node answered: not found / not yet»
 * apart from «could not read», which the seat guard never treats as permission.
 */
const mockRows: Array<{ id: number; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      findFirst: async ({
        where,
      }: {
        where: { jobType: string; status?: string; payload?: { path: string[]; equals: unknown } };
      }) =>
        mockRows.find(
          (r) =>
            r.jobType === where.jobType &&
            (where.status === undefined || r.status === where.status) &&
            (!where.payload || r.payload[where.payload.path[0]] === where.payload.equals),
        ) ?? null,
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = mockRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  },
}));

const mockRpc = jest.fn();
jest.mock('../DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockRpc(...a),
}));

import {
  MAX_REPORTED_TX_HASHES,
  recordHandoffSignatureReport,
  reportedTxHashesOf,
  verifyHandoffPaymentOnLedger,
} from '../DirectMintHandoffStore';

const MEMO = 'FE' + 'AB'.repeat(20);
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const update = () =>
  (jest.requireMock('../../../database/prismaClient') as { prisma: { backgroundJob: { update: jest.Mock } } }).prisma
    .backgroundJob.update;

const queuedRow = (payload: Record<string, unknown> = {}, status = 'queued') => {
  const row = {
    id: mockRows.length + 1,
    jobType: '0xfe-handoff',
    status,
    createdAt: new Date(),
    payload: { memoHex: MEMO, userOpHash: '0x' + '11'.repeat(32), xrplAddress: 'rOwner', ...payload },
  };
  mockRows.push(row);
  return row;
};

const SAVED = process.env.DATABASE_URL;
beforeEach(() => {
  mockRows.length = 0;
  jest.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://fake';
});
afterAll(() => {
  if (SAVED === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED;
});

describe('recordHandoffSignatureReport', () => {
  it('the first report stores the hash (uppercase) and the time of the report — and marks nothing signed', async () => {
    const row = queuedRow();
    expect(await recordHandoffSignatureReport(MEMO, H1)).toBe(true);
    expect(row.payload.reportedTxHash).toBe(H1.toUpperCase());
    expect(row.payload.reportedTxHashes).toEqual([H1.toUpperCase()]);
    expect(typeof row.payload.reportedAt).toBe('string');
    expect(Number.isFinite(Date.parse(row.payload.reportedAt as string))).toBe(true);
    expect(row.payload.signedAt).toBeUndefined();
    expect(row.status).toBe('queued');
  });

  it('a later report adds its hash but never moves the window', async () => {
    const first = '2026-09-14T10:00:00.000Z';
    const row = queuedRow({ reportedTxHash: H1.toUpperCase(), reportedTxHashes: [H1.toUpperCase()], reportedAt: first });
    expect(await recordHandoffSignatureReport(MEMO, H2)).toBe(true);
    expect(row.payload.reportedAt).toBe(first);
    expect(row.payload.reportedTxHashes).toEqual([H1.toUpperCase(), H2.toUpperCase()]);
    expect(row.payload.reportedTxHash).toBe(H2.toUpperCase());
  });

  it('the same hash again is idempotent (no write)', async () => {
    queuedRow({ reportedTxHash: H1.toUpperCase(), reportedTxHashes: [H1.toUpperCase()], reportedAt: '2026-09-14T10:00:00.000Z' });
    expect(await recordHandoffSignatureReport(MEMO, H1)).toBe(true);
    expect(update()).not.toHaveBeenCalled();
  });

  it('a row already signed, an unknown memo, a malformed hash or no DB → false, nothing written', async () => {
    const signed = queuedRow({ signedAt: '2026-09-14T10:00:00.000Z' });
    expect(await recordHandoffSignatureReport(MEMO, H1)).toBe(false);
    expect(signed.payload.reportedTxHash).toBeUndefined();
    expect(await recordHandoffSignatureReport('FE' + 'CD'.repeat(20), H1)).toBe(false);
    expect(await recordHandoffSignatureReport(MEMO, 'zz')).toBe(false);
    delete process.env.DATABASE_URL;
    expect(await recordHandoffSignatureReport(MEMO, H1)).toBe(false);
    expect(update()).not.toHaveBeenCalled();
  });

  // productizer-it15 §K1 — EL TOPE YA NO DESCARTA EL AVISO REAL. Con «primero que
  // llega», ocho informes llenaban la lista y el del dueño se perdía (it14 §1.2).
  it(`keeps at most ${MAX_REPORTED_TX_HASHES} hashes, and the NEWEST one always gets in`, async () => {
    const full = Array.from({ length: MAX_REPORTED_TX_HASHES }, (_, i) => i.toString(16).toUpperCase().repeat(64));
    const row = queuedRow({ reportedTxHashes: full, reportedTxHash: full[full.length - 1], reportedAt: '2026-09-14T10:00:00.000Z' });
    expect(await recordHandoffSignatureReport(MEMO, 'F'.repeat(64))).toBe(true);
    const stored = row.payload.reportedTxHashes as string[];
    expect(stored).toHaveLength(MAX_REPORTED_TX_HASHES);
    expect(stored[stored.length - 1]).toBe('F'.repeat(64));
    expect(stored).not.toContain(full[0]); // el más viejo cae, no el nuevo
  });

  it('a report from a session that PROVES the account replaces the unproven ones and restarts the window', async () => {
    const row = queuedRow({
      reportedTxHashes: [H1.toUpperCase()],
      reportedTxHash: H1.toUpperCase(),
      reportedAt: '2026-09-14T10:00:00.000Z',
      reportedByProven: false,
    });
    expect(await recordHandoffSignatureReport(MEMO, H2, { userId: 'owner', proven: true })).toBe(true);
    expect(row.payload.reportedTxHashes).toEqual([H2.toUpperCase()]);
    expect(row.payload.reportedByProven).toBe(true);
    expect(row.payload.reportedByUserId).toBe('owner');
    expect(row.payload.reportedAt).not.toBe('2026-09-14T10:00:00.000Z');
  });

  it('an unproven report after a proven one is kept, but never downgrades the row nor moves the window', async () => {
    const first = '2026-09-14T10:00:00.000Z';
    const row = queuedRow({
      reportedTxHashes: [H1.toUpperCase()],
      reportedTxHash: H1.toUpperCase(),
      reportedAt: first,
      reportedByProven: true,
      reportedByUserId: 'owner',
    });
    expect(await recordHandoffSignatureReport(MEMO, H2, { userId: 'preparer', proven: false })).toBe(true);
    expect(row.payload.reportedByProven).toBe(true);
    expect(row.payload.reportedByUserId).toBe('owner');
    expect(row.payload.reportedAt).toBe(first);
    expect(row.payload.reportedTxHashes).toEqual([H1.toUpperCase(), H2.toUpperCase()]);
  });
});

describe('reportedTxHashesOf (pure)', () => {
  it('distinct, well-formed, uppercase, in report order', () => {
    expect(
      reportedTxHashesOf({ reportedTxHashes: [H1, H1.toUpperCase(), 'nope', H2], reportedTxHash: H2.toUpperCase() }),
    ).toEqual([H1.toUpperCase(), H2.toUpperCase()]);
    expect(reportedTxHashesOf({})).toEqual([]);
  });
});

describe('verifyHandoffPaymentOnLedger — «not found» is an answer, «could not read» is not', () => {
  const rec = { xrplAddress: 'rOwner', memoHex: MEMO };

  it('txnNotFound → pending, readable', async () => {
    mockRpc.mockRejectedValue(new Error('txnNotFound'));
    const v = await verifyHandoffPaymentOnLedger(rec, H1);
    expect(v.state).toBe('pending');
    expect((v as { unreadable?: boolean }).unreadable).toBeUndefined();
  });

  it('no fresh node / transport error → pending, unreadable', async () => {
    mockRpc.mockRejectedValue(new Error('xrpl_endpoint_stale: https://x (validated ledger > 60s)'));
    expect(await verifyHandoffPaymentOnLedger(rec, H1)).toMatchObject({ state: 'pending', unreadable: true });
  });

  it('not validated yet → pending, readable', async () => {
    mockRpc.mockResolvedValue({ validated: false });
    const v = await verifyHandoffPaymentOnLedger(rec, H1);
    expect(v).toEqual({ state: 'pending', detail: 'transaction not validated yet' });
  });

  it('a validated answer with a result we do not understand → unreadable', async () => {
    mockRpc.mockResolvedValue({ validated: true, meta: { TransactionResult: '' } });
    expect(await verifyHandoffPaymentOnLedger(rec, H1)).toMatchObject({ state: 'pending', unreadable: true });
  });
});

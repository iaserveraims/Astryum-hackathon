/**
 * productizer it. 29 — LA PRUEBA QUE LA ASIMETRÍA NECESITA, LEÍDA DEL JOURNAL.
 *
 * `againstFor` construye el `Against` que `availableBalance` (pura) no puede
 * leer por sí misma: qué entradas pendientes del cliente declara el journal
 * NUNCA firmadas (`provenUnsigned`) y cuáles firmadas (`provenSigned`). Y falla
 * CERRADO: si el journal no se puede leer, lanza — y quien compone una salida no
 * exime a nadie, porque «no pude leer» no es «no está firmado».
 */
import type { DemoRun } from '../DemoExchangeStore';

const kv = new Map<string, Record<string, unknown>>();
let kvDown = false;
const mockKvGetStrict = jest.fn(async (jobType: string, _kf: string, key: string) => {
  if (kvDown) throw new Error('pooler down');
  return kv.get(`${jobType}:${key}`) ?? null;
});

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (jobType: string, _kf: string, key: string) => kv.get(`${jobType}:${key}`) ?? null),
  kvGetStrict: (...a: unknown[]) => mockKvGetStrict(...(a as [string, string, string])),
  kvUpsert: jest.fn(async (jobType: string, _kf: string, key: string, payload: Record<string, unknown>) => {
    kv.set(`${jobType}:${key}`, JSON.parse(JSON.stringify(payload)));
  }),
  kvList: jest.fn(async () => []),
  kvDelete: jest.fn(async () => undefined),
}));

import { _resetSubmissionJournal, againstFor, writeSubmission, type SubmissionEntry } from '../submissionJournal';

const T0 = new Date(0).toISOString();
const HASH = 'A'.repeat(64);

function run(requests: DemoRun['requests']): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'take',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrpOnExchangeDrops: '5000000', createdAt: T0 }],
    receipts: [],
    requests,
    appliedTxHashes: [],
  };
}

const rq = (id: string, kind: 'put-to-work' | 'withdraw', status: 'pending' | 'submitting' | 'refused', extra: Record<string, unknown> = {}) =>
  ({ id, kind, clientId: 'c1', drops: '1000000', status, createdAt: T0, updatedAt: T0, ...extra }) as NonNullable<DemoRun['requests']>[number];

const entry = (requestId: string, status: SubmissionEntry['status']): SubmissionEntry => ({
  requestId,
  runId: 'run1',
  kind: 'put-to-work',
  clientId: 'c1',
  drops: '1000000',
  txHash: HASH,
  lastLedgerSequence: 1100,
  submittedAtLedger: 1000,
  status,
  updatedAt: T0,
});

const SAVED_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://journal-test';
});
afterAll(() => {
  if (SAVED_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED_DB;
});
beforeEach(() => {
  kv.clear();
  kvDown = false;
  mockKvGetStrict.mockClear();
  _resetSubmissionJournal();
});

describe('againstFor', () => {
  it('clasifica cada entrada pendiente por lo que dice el journal: nada/expired = sin firma; el resto = firmada', async () => {
    const r = run([
      rq('none', 'put-to-work', 'pending'),
      rq('expired', 'put-to-work', 'pending'),
      rq('submitting', 'put-to-work', 'pending'),
      rq('settled', 'put-to-work', 'pending'),
      rq('failed', 'put-to-work', 'pending'),
    ]);
    await writeSubmission(entry('expired', 'expired'));
    await writeSubmission(entry('submitting', 'submitting'));
    await writeSubmission(entry('settled', 'settled'));
    await writeSubmission(entry('failed', 'failed'));

    const a = await againstFor(r, 'c1', 'withdraw');
    expect(a.kind).toBe('withdraw');
    // it. 31: `failed` es un resultado VALIDADO ≠ tes — los drops nunca salieron
    // y el blob consumió su Sequence: no retiene la salida de su dueño.
    expect([...a.provenUnsigned!].sort()).toEqual(['expired', 'failed', 'none']);
    expect([...a.provenSigned!].sort()).toEqual(['settled', 'submitting']);
  });

  it('solo mira entradas PENDIENTES sin hash del cliente: ni salidas, ni otros clientes, ni lo que ya lleva hash', async () => {
    const r = run([
      rq('exit', 'withdraw', 'pending'),
      rq('withHash', 'put-to-work', 'pending', { txHash: HASH }),
      rq('submitting', 'put-to-work', 'submitting', { txHash: HASH }),
      rq('refused', 'put-to-work', 'refused'),
      { ...rq('other', 'put-to-work', 'pending'), clientId: 'c2' },
      rq('mine', 'put-to-work', 'pending'),
    ]);
    const a = await againstFor(r, 'c1', 'withdraw');
    expect(mockKvGetStrict).toHaveBeenCalledTimes(1);
    expect([...a.provenUnsigned!]).toEqual(['mine']);
    expect(a.provenSigned!.size).toBe(0);
  });

  it('sin entradas pendientes no lee nada (el caso normal de una salida no puede fallar por el journal)', async () => {
    kvDown = true;
    const a = await againstFor(run([rq('exit', 'withdraw', 'pending')]), 'c1', 'withdraw');
    expect(mockKvGetStrict).not.toHaveBeenCalled();
    expect(a.provenUnsigned!.size).toBe(0);
  });

  it('para una ENTRADA no hay exención posible, así que no lee nada', async () => {
    kvDown = true;
    const a = await againstFor(run([rq('mine', 'put-to-work', 'pending')]), 'c1', 'put-to-work');
    expect(a).toEqual({ kind: 'put-to-work' });
    expect(mockKvGetStrict).not.toHaveBeenCalled();
  });

  it('FALLA CERRADO: con una entrada pendiente y el journal ilegible, lanza — nadie queda eximido', async () => {
    kvDown = true;
    await expect(againstFor(run([rq('mine', 'put-to-work', 'pending')]), 'c1', 'withdraw')).rejects.toThrow(/pooler down/);
  });
});

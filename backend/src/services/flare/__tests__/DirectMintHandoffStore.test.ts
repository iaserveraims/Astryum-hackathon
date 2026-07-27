/**
 * DirectMintHandoffStore — la attestation 0xFE persistida (sobrevive a un redeploy).
 *
 * Espejo del test del carril Legacy, portado con las dos condiciones del fundador:
 * jobType propio '0xfe-attestation' (invisible al poller '0xfe-handoff'+'queued')
 * y `passesWithoutProof` PERSISTIDO — sin él, un redeploy resetea la tolerancia a 0 y el guard
 * de expiración del DA layer nunca borraría un registro "pagado" sobre un proof
 * muerto (el mismo bug que el guard cierra en Legacy).
 */

const mockRows: Array<{ id: number; jobType: string; payload: Record<string, unknown>; createdAt: Date }> = [];
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      findFirst: async ({ where }: { where: { jobType: string; payload?: { equals?: string } } }) => {
        const m = mockRows.filter((r) => r.jobType === where.jobType && r.payload.attKey === where.payload?.equals);
        return m.length ? m[m.length - 1] : null;
      },
      create: async ({ data }: { data: { jobType: string; payload: Record<string, unknown> } }) => {
        const row = { id: mockRows.length + 1, createdAt: new Date(), ...data };
        mockRows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: { payload: Record<string, unknown> } }) => {
        const row = mockRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: { where: { jobType: string; payload?: { equals?: string } } }) => {
        let count = 0;
        for (let i = mockRows.length - 1; i >= 0; i--) {
          if (mockRows[i].jobType === where.jobType && mockRows[i].payload.attKey === where.payload?.equals) {
            mockRows.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
  },
}));

import { save0xFeAttestation, find0xFeAttestation, delete0xFeAttestation } from '../DirectMintHandoffStore';

describe('DirectMintHandoffStore — attestation 0xFE persistida', () => {
  const SAVED = process.env.DATABASE_URL;
  beforeEach(() => {
    mockRows.length = 0;
    process.env.DATABASE_URL = 'postgres://fake';
  });
  afterAll(() => {
    if (SAVED === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = SAVED;
  });

  const KEY = 'ABCDEF0123|0xExecutor'; // attKey = txHash|executor
  const REC = { abiEncodedRequest: '0xdead', roundId: 7, passesWithoutProof: 0 };

  it('round-trip por attKey (no se re-paga tras un restart)', async () => {
    await save0xFeAttestation(KEY, REC);
    expect(await find0xFeAttestation(KEY)).toEqual(REC);
  });

  it('UPSERT: re-guardar el mismo attKey ACTUALIZA passesWithoutProof (no duplica) — la tolerancia sobrevive al redeploy', async () => {
    await save0xFeAttestation(KEY, { ...REC, passesWithoutProof: 0 });
    await save0xFeAttestation(KEY, { ...REC, passesWithoutProof: 1 });
    expect(mockRows.filter((r) => r.jobType === '0xfe-attestation')).toHaveLength(1);
    expect((await find0xFeAttestation(KEY))?.passesWithoutProof).toBe(1);
  });

  it('delete invalida (proof expirado → el reintento re-paga)', async () => {
    await save0xFeAttestation(KEY, REC);
    await delete0xFeAttestation(KEY);
    expect(await find0xFeAttestation(KEY)).toBeNull();
  });

  it('un registro sin el campo → default 0 (compat)', async () => {
    mockRows.push({ id: 1, createdAt: new Date(), jobType: '0xfe-attestation', payload: { attKey: KEY.toLowerCase(), abiEncodedRequest: '0xdead', roundId: 7 } });
    expect((await find0xFeAttestation(KEY))?.passesWithoutProof).toBe(0);
  });

  it('compat con el nombre viejo `misses` (filas del mismo día) → se lee como passesWithoutProof', async () => {
    mockRows.push({ id: 1, createdAt: new Date(), jobType: '0xfe-attestation', payload: { attKey: KEY.toLowerCase(), abiEncodedRequest: '0xdead', roundId: 7, misses: 3 } });
    expect((await find0xFeAttestation(KEY))?.passesWithoutProof).toBe(3);
  });

  it('sin DATABASE_URL: no-op sin lanzar', async () => {
    delete process.env.DATABASE_URL;
    await expect(save0xFeAttestation(KEY, REC)).resolves.toBeUndefined();
    expect(await find0xFeAttestation(KEY)).toBeNull();
  });
});

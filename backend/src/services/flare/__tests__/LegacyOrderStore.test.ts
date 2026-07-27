/**
 * LegacyOrderStore — la attestation persistida que sobrevive a un redeploy.
 *
 * El caché en RAM (`paidAttestations`) se vacía si Railway redespliega a media
 * ceremonia → el reintento del mismo txId re-pagaría la fee FDC (la lección del
 * 0xFE, 244 re-pagos). Estos tests fijan que la persistencia round-trip por
 * txId, hace UPSERT de `passesWithoutProof` (para que la tolerancia sobreviva al
 * redeploy), se invalida con delete, y sin DATABASE_URL degrada a no-op.
 */

const mockRows: Array<{ id: number; jobType: string; payload: Record<string, unknown>; createdAt: Date }> = [];
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      findFirst: async ({ where }: { where: { jobType: string; payload?: { equals?: string } } }) => {
        const m = mockRows.filter((r) => r.jobType === where.jobType && r.payload.txId === where.payload?.equals);
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
          if (mockRows[i].jobType === where.jobType && mockRows[i].payload.txId === where.payload?.equals) {
            mockRows.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
  },
}));

import { savePaidAttestation, findPaidAttestation, deletePaidAttestation } from '../LegacyOrderStore';

describe('LegacyOrderStore — attestation persistida (sobrevive a un redeploy)', () => {
  const SAVED = process.env.DATABASE_URL;
  beforeEach(() => {
    mockRows.length = 0;
    process.env.DATABASE_URL = 'postgres://fake';
  });
  afterAll(() => {
    if (SAVED === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = SAVED;
  });

  const TX = '0x' + 'ab'.repeat(32);
  const REC = { abiEncodedRequest: '0xdeadbeef', roundId: 42, passesWithoutProof: 0 };

  it('round-trip: guardada y recuperada por txId (no se re-paga tras un restart)', async () => {
    await savePaidAttestation(TX, REC);
    expect(await findPaidAttestation(TX)).toEqual(REC);
  });

  it('UPSERT: re-guardar el mismo txId ACTUALIZA passesWithoutProof (no duplica) — la tolerancia sobrevive al redeploy', async () => {
    await savePaidAttestation(TX, REC);
    await savePaidAttestation(TX, { ...REC, passesWithoutProof: 1 });
    expect(mockRows.filter((r) => r.jobType === 'legacy-attestation')).toHaveLength(1);
    expect((await findPaidAttestation(TX))?.passesWithoutProof).toBe(1);
  });

  it('case-insensitive por txId (mismo pago aunque cambie el case)', async () => {
    await savePaidAttestation(TX.toUpperCase(), REC);
    expect(await findPaidAttestation(TX.toLowerCase())).toEqual(REC);
  });

  it('un registro viejo sin passesWithoutProof → default 0 (compat)', async () => {
    mockRows.push({ id: 1, createdAt: new Date(), jobType: 'legacy-attestation', payload: { txId: TX.toLowerCase(), abiEncodedRequest: '0xdeadbeef', roundId: 42 } });
    expect((await findPaidAttestation(TX))?.passesWithoutProof).toBe(0);
  });

  it('deletePaidAttestation invalida (nunca confirmado → el reintento re-paga)', async () => {
    await savePaidAttestation(TX, REC);
    await deletePaidAttestation(TX);
    expect(await findPaidAttestation(TX)).toBeNull();
  });

  it('txId desconocido → null', async () => {
    expect(await findPaidAttestation('0x' + '11'.repeat(32))).toBeNull();
  });

  it('sin DATABASE_URL: no-op (RAM-only), sin lanzar', async () => {
    delete process.env.DATABASE_URL;
    await expect(savePaidAttestation(TX, REC)).resolves.toBeUndefined();
    expect(await findPaidAttestation(TX)).toBeNull();
  });
});

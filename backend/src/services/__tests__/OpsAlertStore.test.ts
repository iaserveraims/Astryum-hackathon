/**
 * OpsAlertStore — la bandeja de alertas persistida del panel admin.
 *
 * opsAlert() antes solo dejaba las alertas en logs + un webhook OPCIONAL: sin
 * webhook, se evaporaban. Estos tests fijan que ahora se persisten SIEMPRE
 * (append), que se leen newest-first, que el buffer circular poda las viejas
 * cuando pasa de MAX_ROWS, y que sin DATABASE_URL degrada a no-op sin lanzar.
 */

let mockRows: Array<{ id: string; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
let seq = 0;
// createdAt monótono y determinista (nada de Date.now real para el orden).
let clock = 1_700_000_000_000;

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      create: async ({ data }: { data: { jobType: string; status: string; payload: Record<string, unknown> } }) => {
        const row = { id: `a${++seq}`, createdAt: new Date((clock += 1000)), ...data };
        mockRows.push(row);
        return row;
      },
      count: async ({ where }: { where: { jobType: string } }) =>
        mockRows.filter((r) => r.jobType === where.jobType).length,
      findMany: async ({
        where,
        orderBy,
        skip = 0,
        take,
      }: {
        where: { jobType: string };
        orderBy?: { createdAt?: 'asc' | 'desc' };
        skip?: number;
        take?: number;
      }) => {
        let rows = mockRows.filter((r) => r.jobType === where.jobType);
        rows = rows.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        rows = rows.slice(skip);
        return take != null ? rows.slice(0, take) : rows;
      },
      deleteMany: async ({ where }: { where: { jobType: string; createdAt?: { lte?: Date } } }) => {
        const before = mockRows.length;
        mockRows = mockRows.filter(
          (r) => !(r.jobType === where.jobType && (!where.createdAt?.lte || r.createdAt <= where.createdAt.lte)),
        );
        return { count: before - mockRows.length };
      },
    },
  },
}));

import { saveOpsAlert, listOpsAlerts } from '../OpsAlertStore';

const OLD_ENV = process.env.DATABASE_URL;
beforeEach(() => {
  mockRows = [];
  seq = 0;
  clock = 1_700_000_000_000;
  process.env.DATABASE_URL = 'postgresql://local/test';
});
afterAll(() => {
  process.env.DATABASE_URL = OLD_ENV;
});

describe('OpsAlertStore', () => {
  it('persiste una alerta y la lee de vuelta con todos sus campos', async () => {
    await saveOpsAlert({ source: '0xFE-executor', level: 'critical', message: 'saldo bajo', at: '2026-07-26T10:00:00.000Z' });
    const [a] = await listOpsAlerts();
    expect(a.source).toBe('0xFE-executor');
    expect(a.level).toBe('critical');
    expect(a.message).toBe('saldo bajo');
    expect(a.at).toBe('2026-07-26T10:00:00.000Z');
    expect(typeof a.id).toBe('string');
  });

  it('es append (no upsert): dos alertas de la misma fuente son dos filas', async () => {
    await saveOpsAlert({ source: '0xFE-executor', level: 'warn', message: 'una', at: '2026-07-26T10:00:00.000Z' });
    await saveOpsAlert({ source: '0xFE-executor', level: 'warn', message: 'dos', at: '2026-07-26T10:01:00.000Z' });
    const list = await listOpsAlerts();
    expect(list).toHaveLength(2);
  });

  it('devuelve las más recientes primero', async () => {
    await saveOpsAlert({ source: 's', level: 'info', message: 'vieja', at: '2026-07-26T10:00:00.000Z' });
    await saveOpsAlert({ source: 's', level: 'info', message: 'nueva', at: '2026-07-26T10:05:00.000Z' });
    const list = await listOpsAlerts();
    expect(list.map((a) => a.message)).toEqual(['nueva', 'vieja']);
  });

  it('normaliza un level desconocido a "info" (nunca inventa severidad)', async () => {
    await saveOpsAlert({ source: 's', level: 'garbage', message: 'x', at: '2026-07-26T10:00:00.000Z' });
    const [a] = await listOpsAlerts();
    expect(a.level).toBe('info');
  });

  it('buffer circular: al pasar de MAX_ROWS (500) se conservan las 500 más recientes', async () => {
    for (let i = 0; i < 505; i++) {
      await saveOpsAlert({ source: 's', level: 'info', message: `m${i}`, at: `t${i}` });
    }
    const list = await listOpsAlerts({ limit: 500 });
    expect(list).toHaveLength(500);
    // La más reciente es m504; las 5 más viejas (m0..m4) se podaron.
    expect(list[0].message).toBe('m504');
    expect(list.some((a) => a.message === 'm0')).toBe(false);
    expect(list.some((a) => a.message === 'm4')).toBe(false);
    expect(list.some((a) => a.message === 'm5')).toBe(true);
  });

  it('respeta el limit y lo acota a [1, 500]', async () => {
    for (let i = 0; i < 10; i++) {
      await saveOpsAlert({ source: 's', level: 'info', message: `m${i}`, at: `t${i}` });
    }
    expect(await listOpsAlerts({ limit: 3 })).toHaveLength(3);
    expect((await listOpsAlerts({ limit: 0 })).length).toBe(1); // acotado a >=1
  });

  it('sin DATABASE_URL: save es no-op y list devuelve [] (nunca lanza)', async () => {
    delete process.env.DATABASE_URL;
    await expect(saveOpsAlert({ source: 's', level: 'info', message: 'x', at: 't' })).resolves.toBeUndefined();
    await expect(listOpsAlerts()).resolves.toEqual([]);
  });
});

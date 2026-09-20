/**
 * productizer it. 21 (3.1) — EL LATIDO VERDE DE UN TICK QUE NO SIRVIÓ A NADIE.
 *
 * Esta es una regresión de la iteración 19: al pasar `listRuns` a lectura
 * ESTRICTA (`kvListStrict`), una base de datos caída dejó de contestar «no hay
 * runs» y pasó a LANZAR. El `tick()` tenía `try { … } finally { … }` sin
 * `catch`, así que:
 *
 *   · `errors` se quedaba vacío y `markAgentTick(..., ok: errors.length === 0)`
 *     marcaba el latido **verde** — el panel decía que el agente estaba sano
 *     mientras no servía a ningún cliente;
 *   · `lastError` conservaba el valor viejo, así que tampoco ahí se veía;
 *   · el rechazo moría como `unhandledRejection` (el intervalo llama con un
 *     `void` pelado).
 *
 * Lo que se fija aquí: el fallo se captura, se cuenta en `lastError`, el latido
 * va en ROJO con su detalle, y el tick lo NOMBRA (`failed`) para que la ruta a
 * demanda pueda contestar 503 en vez de «0 runs, todo bien».
 */
process.env.INSTITUTIONAL_POTES_ENABLED = 'true';

const ticks: Array<{ ok?: boolean; detail?: string }> = [];
let listRunsImpl: () => Promise<unknown[]> = async () => [];

jest.mock('../../ops/agentHeartbeats', () => ({
  markAgentTick: (_id: string, opts: { ok?: boolean; detail?: string }) => {
    ticks.push({ ok: opts.ok, detail: opts.detail });
  },
}));

jest.mock('../DemoExchangeStore', () => {
  const actual = jest.requireActual('../DemoExchangeStore');
  return {
    ...actual,
    listRuns: jest.fn(async () => listRunsImpl()),
  };
});

jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: null, seedPresent: false, attribution: 'operational', maxTxDrops: 0n, dailyCapDrops: 0n }),
  spentToday: async () => 0n,
  sweepStaleReservations: async () => [],
  assessPayment: jest.fn(),
  readOmnibusAppointment: jest.fn(),
  recordSpend: jest.fn(),
  // it. 23 (1.4): the spend is RESERVED before the blob leaves and given
  // back when the ledger proves the payment never entered.
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
}));
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => null }));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto (it. 25).
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { DemoRunStoreError } from '../DemoExchangeStore';

describe('el tick dice la verdad cuando no pudo ni leer su lista (it. 21, 3.1)', () => {
  beforeEach(() => {
    ticks.length = 0;
    listRunsImpl = async () => [];
  });

  it('una lectura que lanza → latido en ROJO con el detalle, lastError y `failed`; nunca una promesa sin dueño', async () => {
    const autopilot = new DemoExchangeAutopilot();
    listRunsImpl = async () => {
      throw new DemoRunStoreError('RUN_UNREADABLE', 'pooler down');
    };
    // Que RESUELVA es media prueba: antes esto rechazaba y moría como
    // unhandledRejection al llamarlo el intervalo con `void`.
    const r = await autopilot.tick();
    expect(r.runs).toBe(0);
    expect(r.actions).toBe(0);
    expect(r.failed).toMatch(/could not run/);
    expect(r.failed).toMatch(/pooler down/);

    expect(ticks).toHaveLength(1);
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toMatch(/pooler down/);

    const status = await autopilot.status();
    expect(status.lastError).toMatch(/pooler down/);
    // Y el reloj del latido sigue avanzando: el tick ocurrió, solo que en rojo.
    expect(status.lastTickAt).not.toBeNull();
  });

  it('una lectura buena vuelve a marcar verde y limpia el error anterior', async () => {
    const autopilot = new DemoExchangeAutopilot();
    listRunsImpl = async () => {
      throw new Error('boom');
    };
    await autopilot.tick();
    expect((await autopilot.status()).lastError).toMatch(/boom/);

    listRunsImpl = async () => [];
    const r = await autopilot.tick();
    expect(r.failed).toBeUndefined();
    expect(ticks[ticks.length - 1].ok).toBe(true);
    expect((await autopilot.status()).lastError).toBeNull();
  });
});

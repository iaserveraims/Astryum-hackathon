/**
 * productizer it. 29 — LA ALARMA DE ENVEJECIMIENTO NO PODÍA SONAR PARA LOS CASOS
 * QUE LA MOTIVARON.
 *
 * `noteStaleRequests` (it. 27) medía la antigüedad con `updatedAt`, y
 * `refuse()` pone `updatedAt = ahora` en su primera línea SIEMPRE, también con
 * `final === false`. Todos los estados que su docstring nombra como motivo de
 * existir (`NO_CLIENT_ACCOUNT`, `NO_POTE`, `ABOVE_DAILY_CAP`, `NONCE_SEAT_TAKEN`,
 * `INSUFFICIENT_LEDGER_BALANCE`…) pasan por `refuse(..., false)` en el MISMO tick
 * que la alarma: la edad volvía a cero cada veinte segundos. Y `tick()` saltaba
 * toda toma con `!autopilot`, así que una toma MANUAL —la que por definición
 * espera a una persona— no sonaba nunca, pese a que el comentario del paso 4
 * prometía «se mira SIEMPRE, tenga o no este backend la llave».
 *
 * Lo que se fija aquí (cadena c): una petición vieja SUENA en ops y apaga el
 * verde del latido, aunque el tick la acabe de rechazar sin cerrar; y una toma
 * manual suena igual, sin que nadie firme ni guarde nada en ella.
 */
process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
process.env.DEMO_EXCHANGE_STALE_REQUEST_MIN = '30';

import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';

let runsToServe: DemoRun[] = [];
const ticks: Array<{ ok?: boolean; detail?: string }> = [];
const alerts: Array<{ level: string; message: string; key?: string; facts?: Record<string, unknown> }> = [];
const mockSaveRun = jest.fn(async () => undefined);

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async () => null),
  kvGetStrict: jest.fn(async () => null),
  kvUpsert: jest.fn(async () => undefined),
  kvList: jest.fn(async () => []),
  kvDelete: jest.fn(async () => undefined),
}));

jest.mock('../DemoExchangeStore', () => {
  const actual = jest.requireActual('../DemoExchangeStore');
  return {
    ...actual,
    listRuns: jest.fn(async () => runsToServe),
    loadRun: jest.fn(async (id: string) => runsToServe.find((r) => r.runId === id) ?? null),
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});

jest.mock('../DemoExchangeSync', () => ({
  syncOmnibus: jest.fn(async () => ({ credited: [] })),
  makeReceipt: (_run: unknown, r: Record<string, unknown>) => ({ id: `rc_${Math.random().toString(36).slice(2)}`, ...r }),
}));

jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', seedPresent: true, maxTxDrops: '10000000', dailyCapDrops: '100000000', attribution: 'operational' }),
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: async () => BigInt(0),
  sweepStaleReservations: async () => [],
  recordSpend: async () => undefined,
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
  signForSubmission: jest.fn(),
  submitSignedBlob: jest.fn(),
  lookupSubmission: jest.fn(),
}));

jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({
  markAgentTick: (_id: string, opts: { ok?: boolean; detail?: string }) => {
    ticks.push({ ok: opts.ok, detail: opts.detail });
  },
}));
jest.mock('../../OpsAlertService', () => ({
  opsAlert: jest.fn(async (_source: string, level: string, message: string, opts: { key?: string; facts?: Record<string, unknown> } = {}) => {
    alerts.push({ level, message, key: opts.key, facts: opts.facts });
  }),
}));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

function makeRun(over: Partial<DemoRun> = {}): DemoRun {
  const T0 = ago(600);
  return {
    runId: 'run1',
    seq: 1,
    label: 'stale take',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    autopilot: true,
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '0', createdAt: T0 }],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
    ...over,
  };
}

/** Deja que las promesas `void this.alertOps(...)` del tick se asienten. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  runsToServe = [];
  ticks.length = 0;
  alerts.length = 0;
  mockSaveRun.mockClear();
  _resetSubmissionJournal();
});

describe('cadena (c): una petición vieja suena en ops y apaga el verde', () => {
  it('una ENTRADA de hace 45 min que el tick acaba de rechazar sin cerrar sigue siendo vieja: warn + latido rojo', async () => {
    // Saldo 0 → `fulfil` la rechaza con INSUFFICIENT_LEDGER_BALANCE, final=false,
    // y `refuse()` pone `updatedAt = ahora`. Antes de esta iteración eso ponía la
    // antigüedad a cero en el mismo tick y la alarma callaba para siempre.
    const run = makeRun({
      requests: [{ id: 'rqOld', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(45), updatedAt: ago(45) }],
    });
    runsToServe = [run];
    const autopilot = new DemoExchangeAutopilot();
    await autopilot.tick();
    await settle();

    // el tick sí la rechazó y sí tocó `updatedAt` — la trampa sigue ahí, la medida ya no cae en ella
    expect(run.requests![0].status).toBe('pending');
    expect(run.requests![0].reason).toMatch(/^INSUFFICIENT_LEDGER_BALANCE/);
    expect(Date.now() - Date.parse(run.requests![0].updatedAt)).toBeLessThan(5 * MIN);

    const stale = alerts.find((a) => a.key === 'request-stale:rqOld');
    expect(stale).toBeDefined();
    expect(stale!.level).toBe('warn');
    expect(stale!.facts).toMatchObject({ request: 'rqOld', kind: 'put-to-work', status: 'pending' });
    expect(Number(stale!.facts!.ageMinutes)).toBeGreaterThanOrEqual(44);

    expect(ticks).toHaveLength(1);
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toMatch(/put-to-work rqOld \(stale take\) waiting 4[45] min/);
  });

  it('una SALIDA vieja es `critical`; una petición fresca no suena y el latido queda verde', async () => {
    const run = makeRun({
      requests: [
        { id: 'rqExit', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(31), updatedAt: ago(31) },
        { id: 'rqFresh', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(1), updatedAt: ago(1) },
      ],
    });
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    await settle();

    expect(alerts.find((a) => a.key === 'request-stale:rqExit')?.level).toBe('critical');
    expect(alerts.find((a) => a.key === 'request-stale:rqFresh')).toBeUndefined();
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toContain('withdraw rqExit');
    expect(ticks[0].detail).not.toContain('rqFresh');

    // y sin nada viejo, verde
    alerts.length = 0;
    ticks.length = 0;
    runsToServe = [makeRun({ requests: [{ id: 'rqFresh', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(1), updatedAt: ago(1) }] })];
    await new DemoExchangeAutopilot().tick();
    await settle();
    expect(alerts.some((a) => a.key?.startsWith('request-stale:'))).toBe(false);
    expect(ticks[0].ok).toBe(true);
  });

  it('una toma MANUAL (autopilot=false) suena igual — y en ella no se firma ni se guarda nada', async () => {
    const manual = makeRun({
      runId: 'manual',
      label: 'manual take',
      autopilot: false,
      requests: [{ id: 'rqManual', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(90), updatedAt: ago(90) }],
    });
    runsToServe = [manual];
    const r = await new DemoExchangeAutopilot().tick();
    await settle();

    // la toma manual no cuenta como servida, y nada suyo se ha guardado
    expect(r.runs).toBe(0);
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect(manual.requests![0].status).toBe('pending');
    expect(manual.requests![0].reason).toBeUndefined();

    const stale = alerts.find((a) => a.key === 'request-stale:rqManual');
    expect(stale).toBeDefined();
    expect(stale!.level).toBe('critical');
    expect(stale!.facts).toMatchObject({ run: 'manual take', request: 'rqManual', kind: 'withdraw' });
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toMatch(/withdraw rqManual \(manual take\) waiting 90 min/);
  });

  /**
   * it. 31 — LA CUARTA MUDANZA DE LA CÁRCEL ERA UN INTERRUPTOR DE ADMINISTRADOR.
   * Este test afirmaba lo contrario («una toma cerrada no se mira»): una
   * retirada en una toma `closed` envejecía en silencio, con el latido verde.
   * Cerrar una mesa no gatea la salida de nadie: su cola suena igual.
   */
  it('una toma CERRADA con una salida en cola suena igual (crítico) y apaga el verde', async () => {
    runsToServe = [makeRun({ status: 'closed', autopilot: false, requests: [{ id: 'rqClosed', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'pending', createdAt: ago(900), updatedAt: ago(900) }] })];
    await new DemoExchangeAutopilot().tick();
    await settle();
    const stale = alerts.find((a) => a.key === 'request-stale:rqClosed');
    expect(stale).toBeDefined();
    expect(stale!.level).toBe('critical');
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toContain('withdraw rqClosed');
  });

  it('una toma cerrada SIN nada vivo no cuesta ni una lectura: ni alarma ni latido rojo', async () => {
    runsToServe = [makeRun({ status: 'closed', autopilot: true, requests: [{ id: 'rqDone', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'done', createdAt: ago(900), updatedAt: ago(900) }] })];
    const r = await new DemoExchangeAutopilot().tick();
    await settle();
    expect(r.runs).toBe(0);
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect(alerts.some((a) => a.key?.startsWith('request-stale:'))).toBe(false);
    expect(ticks[0].ok).toBe(true);
  });

  /**
   * it. 31 — la cota del crítico permanente: el latido lo lleva cada tick, el
   * canal de ops recibe la llamada UNA vez por ventana (30 min), no una por tick.
   */
  it('la misma petición vieja no vuelve a llamar a ops en el tick siguiente; el latido sí la sigue llevando', async () => {
    const run = makeRun({ requests: [{ id: 'rqLong', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: ago(600), updatedAt: ago(600) }] });
    runsToServe = [run];
    const autopilot = new DemoExchangeAutopilot();
    await autopilot.tick();
    await settle();
    const first = alerts.filter((a) => a.key === 'request-stale:rqLong').length;
    expect(first).toBe(1);
    await autopilot.tick();
    await settle();
    expect(alerts.filter((a) => a.key === 'request-stale:rqLong').length).toBe(1);
    expect(ticks).toHaveLength(2);
    expect(ticks[1].ok).toBe(false);
    expect(ticks[1].detail).toContain('put-to-work rqLong');
  });
});

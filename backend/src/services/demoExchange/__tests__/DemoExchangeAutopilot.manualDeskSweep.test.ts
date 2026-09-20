/**
 * productizer it. 33 (agente C, 3) — EL BARRIDO «SUELTA SOLO» CORRE TAMBIÉN EN
 * TOMAS SIN AUTOPILOT, que es donde existen las reservas de mesa.
 *
 * Lo que fallaba (R2/R4 de la it. 32): la reserva de mesa con memo la compone
 * la puerta del ESCRITORIO (`prepare-put-to-work`), o sea, una toma que sirve
 * una persona. Su 409 al dueño (`DESK_PAYMENT_NOT_RELEASABLE_HERE`) promete sin
 * condición «once that ledger is past, the exchange proves it absent and
 * releases it on its own» — consagrado por `closedRunOwnerDoor.test.ts` sobre
 * una toma SIN autopilot. Pero `tick()` hacía `continue` para `!listed.autopilot`
 * antes de `serveRun`, y el paso 0 (`sweepDeskPutToWorkPastLls`) no corría nunca
 * en manual: la promesa era falsa justo donde aplicaba, y el saldo del cliente
 * seguía retenido — también frente a su retirada — hasta que un fundador se
 * acordara del DELETE de admin.
 *
 * FASE: un tick entero sobre una toma `autopilot:false` con esa reserva, el
 * ledger validado pasado su LastLedgerSequence y la ventana leída vacía.
 * Y (7): un veredicto que no suelta ya no es un `console.error` por tick y
 * nadie avisado — llega a ops una vez por media hora.
 */
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

import type { DemoRun, DeskPayment } from '../DemoExchangeStore';
import type { OmnibusTx } from '../OmnibusWatcher';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMO = 'FE' + 'AB'.repeat(20);

let runsToServe: DemoRun[] = [];
let ledgerIndex: number | null = 1200;
let windowRows: OmnibusTx[] = [];
let windowReadFails = false;
const mockReleaseSeat = jest.fn(async () => true);
const mockSaveRun = jest.fn(async () => undefined);
const mockLedgerRead = jest.fn(async () => ledgerIndex);
const mockSync = jest.fn(async () => ({ credited: [] }));
const opsAlerts: Array<{ level: string; message: string; key?: string }> = [];

jest.mock('../DemoExchangeStore', () => {
  const actual = jest.requireActual('../DemoExchangeStore');
  return {
    ...actual,
    listRuns: jest.fn(async () => runsToServe),
    loadRun: jest.fn(async (id: string) => runsToServe.find((r) => r.runId === id) ?? null),
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});
jest.mock('../DemoExchangeSync', () => {
  const actual = jest.requireActual('../DemoExchangeSync');
  return { ...actual, syncOmnibus: (...a: unknown[]) => mockSync(...(a as [])) };
});
jest.mock('../OmnibusWatcher', () => {
  const actual = jest.requireActual('../OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: (...a: unknown[]) => mockLedgerRead(...(a as [])),
    scanOmnibusWindow: jest.fn(async () => windowRows),
    scanOmnibusWindowUntil: jest.fn(async (_o: string, opts: { stop?: (t: OmnibusTx) => boolean }) => {
      if (windowReadFails) throw new Error('xrpl node timeout');
      const rows: OmnibusTx[] = [];
      for (const t of windowRows) {
        rows.push(t);
        if (opts.stop?.(t)) return { rows, match: t };
      }
      return { rows };
    }),
  };
});
jest.mock('../deskPaymentReads', () => ({
  findHandoffByMemo: jest.fn(async () => null),
  readXrplTx: jest.fn(async () => ({ found: false })),
  readCoreVaultAddress: jest.fn(async () => 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm'),
  mintExecutedOnFlare: jest.fn(async () => true),
}));
jest.mock('../../flare/DirectMintHandoffStore', () => ({
  releaseQueuedHandoffByMemo: (...a: unknown[]) => mockReleaseSeat(...(a as [])),
  markHandoffSignedByMemo: async () => true,
  markHandoffParkedByUserOpHash: async () => true,
}));
// The key of this backend opens ANOTHER omnibus: this run is served by a person.
jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm', seedPresent: true, maxTxDrops: '10000000', dailyCapDrops: '100000000', attribution: 'operational' }),
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
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}), explorerUrl: () => undefined }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../OpsAlertService', () => ({
  opsAlert: jest.fn(async (_s: string, level: string, message: string, opts?: { key?: string }) => {
    opsAlerts.push({ level, message, key: opts?.key });
  }),
}));

import { DemoExchangeAutopilot, deskSweepDue } from '../DemoExchangeAutopilot';
import { availableDrops } from '../availableBalance';

const T0 = new Date(0).toISOString();
const AGAINST_EXIT = { kind: 'withdraw' as const, provenUnsigned: new Set<string>(), provenSigned: new Set<string>() };

function composedReservation(over: Partial<DeskPayment> = {}): DeskPayment {
  return { id: 'dp1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'prepared', memoHex: MEMO, userOpHash: '0x' + '1'.repeat(64), lastLedgerSequence: 1100, createdAtLedger: 1000, createdAt: T0, updatedAt: T0, ...over };
}

/** A take served by a PERSON: no autopilot. */
function manualRun(deskPayments: DeskPayment[]): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Manual desk',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: false,
    createdAt: T0,
    sinceLedgerIndex: 900,
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '2000000', createdAt: T0 }],
    receipts: [],
    requests: [],
    deskPayments,
    appliedTxHashes: [],
  };
}

beforeEach(() => {
  runsToServe = [];
  ledgerIndex = 1200;
  windowRows = [];
  windowReadFails = false;
  opsAlerts.length = 0;
  mockReleaseSeat.mockClear();
  mockSaveRun.mockClear();
  mockLedgerRead.mockClear();
  mockSync.mockClear();
});

describe('it. 33 (3): el barrido de mesa en una toma SIN autopilot', () => {
  it('CADENA: ventana pasada + omnibus leído en su ventana sin ese 0xFE → released, con recibo, asiento soltado, guardado, y el saldo del cliente de vuelta — sin escanear ni firmar nada', async () => {
    const run = manualRun([composedReservation()]);
    runsToServe = [run];
    expect(availableDrops(run, 'c1', undefined, {}, AGAINST_EXIT)).toBe(BigInt(0));

    const r = await new DemoExchangeAutopilot().tick();

    expect(r.failed).toBeUndefined();
    expect(r.actions).toBeGreaterThanOrEqual(1);
    const p = run.deskPayments![0];
    expect(p.status).toBe('released');
    expect(p.closedBy).toMatch(/absent: .* read in full/);
    expect(p.closedBy).toMatch(/swept by the exchange backend \(it signs nothing\)/);
    expect(run.receipts.some((x) => x.step === 'NOTE' && /released by the exchange backend, which signs nothing here/.test(x.note ?? '') && /LastLedgerSequence 1100 is past/.test(x.note ?? ''))).toBe(true);
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO);
    expect(mockSaveRun).toHaveBeenCalledTimes(1);
    // the manual sweep neither scans the omnibus (that is the desk's read) nor serves the queue
    expect(mockSync).not.toHaveBeenCalled();
    expect(availableDrops(run, 'c1', undefined, {}, AGAINST_EXIT)).toBe(BigInt(2_000_000));
  });

  it('ventana AÚN abierta (validado ≤ LLS) → no se toca ni se guarda: puede haber un 0xFE firmado en un teléfono', async () => {
    ledgerIndex = 1050;
    const run = manualRun([composedReservation()]);
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(mockReleaseSeat).not.toHaveBeenCalled();
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('el ledger no se lee → nada se suelta (no hay prueba), nada se guarda, y el tick no falla', async () => {
    ledgerIndex = null;
    const run = manualRun([composedReservation()]);
    runsToServe = [run];
    const r = await new DemoExchangeAutopilot().tick();
    expect(r.failed).toBeUndefined();
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('sin ninguna reserva que el ledger pueda cerrar (sin LLS, o nada prepared), la toma manual no cuesta ni una lectura del ledger', async () => {
    const run = manualRun([composedReservation({ id: 'noLls', lastLedgerSequence: undefined }), composedReservation({ id: 'done', status: 'released' })]);
    runsToServe = [run];
    expect(deskSweepDue(run)).toBe(false);
    await new DemoExchangeAutopilot().tick();
    expect(mockLedgerRead).not.toHaveBeenCalled();
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect(run.deskPayments!.map((p) => p.status)).toEqual(['prepared', 'released']);
  });

  it('(7) un veredicto que NO suelta (la ventana no se pudo leer) llega a ops UNA vez por media hora, no un console.error por tick', async () => {
    windowReadFails = true;
    const run = manualRun([composedReservation()]);
    runsToServe = [run];
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let logged = 0;
    try {
      const loop = new DemoExchangeAutopilot();
      await loop.tick();
      await loop.tick();
      await loop.tick();
      logged = errors.mock.calls.filter((c) => /desk put-to-work dp1/.test(String(c[0]))).length;
    } finally {
      errors.mockRestore();
    }
    expect(run.deskPayments![0].status).toBe('prepared');
    const stuck = opsAlerts.filter((a) => a.key === 'desk-reservation-stuck:dp1');
    expect(stuck).toHaveLength(1);
    expect(stuck[0].level).toBe('warn');
    expect(stuck[0].message).toMatch(/could not close it/);
    expect(logged).toBe(1);
  });
});

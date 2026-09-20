/**
 * LA RESERVA DE MESA CON MEMO RETENÍA LA SALIDA INDEFINIDAMENTE.
 *
 * `deskPaymentOpen` jamás cierra un put-to-work por ledger; su única prueba
 * (`provePutToWorkRelease`) solo la pedía el DELETE de admin. Desde que caducaba
 * su payload (~6 min) hasta que un fundador se acordara, el saldo del cliente
 * seguía «reservado por pagos en vuelo» — y el 409 del dueño decía, falsamente,
 * que no retenía su salida. El paso 0 de `serveRun` ya probaba y barría payouts
 * pasados de LLS; ahora hace lo mismo con los put-to-work de mesa compuestos.
 *
 * Esto ejerce la FASE: un tick entero sobre una toma con esa reserva, con el
 * ledger validado ya pasado su LastLedgerSequence y la ventana leída vacía.
 */
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

import type { DemoRun, DeskPayment } from '../DemoExchangeStore';
import type { OmnibusTx } from '../OmnibusWatcher';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const CORE_VAULT = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const MEMO = 'FE' + 'AB'.repeat(20);
const FE_HASH = 'D'.repeat(64);

let runsToServe: DemoRun[] = [];
let ledgerIndex: number | null = 1200;
let windowRows: OmnibusTx[] = [];
const mockReleaseSeat = jest.fn(async () => true);
const mockSaveRun = jest.fn(async () => undefined);

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
  return { ...actual, syncOmnibus: jest.fn(async () => ({ credited: [] })) };
});
jest.mock('../OmnibusWatcher', () => {
  const actual = jest.requireActual('../OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: jest.fn(async () => ledgerIndex),
    scanOmnibusWindow: jest.fn(async () => windowRows),
    scanOmnibusWindowUntil: jest.fn(async (_o: string, opts: { stop?: (t: OmnibusTx) => boolean }) => {
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
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}), explorerUrl: () => undefined }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { availableDrops } from '../availableBalance';

const T0 = new Date(0).toISOString();

function composedReservation(over: Partial<DeskPayment> = {}): DeskPayment {
  return { id: 'dp1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'prepared', memoHex: MEMO, userOpHash: '0x' + '1'.repeat(64), lastLedgerSequence: 1100, createdAtLedger: 1000, createdAt: T0, updatedAt: T0, ...over };
}

function makeRun(deskPayments: DeskPayment[]): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Desk sweep',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    sinceLedgerIndex: 900,
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '2000000', createdAt: T0 }],
    receipts: [],
    requests: [],
    deskPayments,
    appliedTxHashes: [],
  };
}

const feTx = (): OmnibusTx => ({ hash: FE_HASH, account: OMNIBUS, destination: CORE_VAULT, drops: '2000000', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'out', ledgerIndex: 1050, memoHex: MEMO });

beforeEach(() => {
  runsToServe = [];
  ledgerIndex = 1200;
  windowRows = [];
  mockReleaseSeat.mockClear();
  mockSaveRun.mockClear();
});

describe('El paso 0 barre put-to-work de mesa pasados de su LastLedgerSequence', () => {
  it('ventana pasada + omnibus leído en su ventana sin ese 0xFE → released, con recibo, asiento soltado y el saldo del cliente de vuelta', async () => {
    const run = makeRun([composedReservation()]);
    runsToServe = [run];
    // Antes del tick la reserva retiene TODO el saldo, también frente a la salida.
    expect(availableDrops(run, 'c1', undefined, {}, { kind: 'withdraw', provenUnsigned: new Set(), provenSigned: new Set() })).toBe(BigInt(0));

    const r = await new DemoExchangeAutopilot().tick();

    expect(r.failed).toBeUndefined();
    expect(r.actions).toBeGreaterThanOrEqual(1);
    const p = run.deskPayments![0];
    expect(p.status).toBe('released');
    expect(p.closedBy).toMatch(/absent: .* read in full/);
    expect(p.closedBy).toMatch(/swept by the exchange backend \(it signs nothing\)/);
    expect(run.receipts.some((x) => x.step === 'NOTE' && /released by the exchange backend, which signs nothing here/.test(x.note ?? '') && /LastLedgerSequence 1100 is past/.test(x.note ?? ''))).toBe(true);
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO);
    expect(mockSaveRun).toHaveBeenCalled();
    expect(availableDrops(run, 'c1', undefined, {}, { kind: 'withdraw', provenUnsigned: new Set(), provenSigned: new Set() })).toBe(BigInt(2_000_000));
  });

  it('ventana AÚN abierta (validado ≤ LLS) → no se toca: puede haber un 0xFE firmado en un teléfono', async () => {
    ledgerIndex = 1050;
    const run = makeRun([composedReservation()]);
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(mockReleaseSeat).not.toHaveBeenCalled();
  });

  it('el 0xFE SÍ está en la ventana → settled y el cliente debitado una vez, jamás released', async () => {
    windowRows = [feTx()];
    const run = makeRun([composedReservation()]);
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    const p = run.deskPayments![0];
    expect(p.status).toBe('settled');
    expect(p.txHash).toBe(FE_HASH);
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.receipts.some((x) => x.step === 'E5_PUT_TO_WORK' && x.txHash === FE_HASH)).toBe(true);
    expect(mockReleaseSeat).not.toHaveBeenCalled();
  });

  it('sin memo (nada compuesto) o sin LLS no entra en este barrido — esas siguen por sus propias puertas', async () => {
    const run = makeRun([composedReservation({ id: 'noMemo', memoHex: undefined, userOpHash: undefined, lastLedgerSequence: undefined }), composedReservation({ id: 'noLls', lastLedgerSequence: undefined })]);
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    expect(run.deskPayments!.map((p) => p.status)).toEqual(['prepared', 'prepared']);
  });

  it('el ledger no se lee → nada se suelta (no hay prueba)', async () => {
    ledgerIndex = null;
    const run = makeRun([composedReservation()]);
    runsToServe = [run];
    const r = await new DemoExchangeAutopilot().tick();
    expect(r.failed).toBeUndefined();
    expect(run.deskPayments![0].status).toBe('prepared');
  });
});

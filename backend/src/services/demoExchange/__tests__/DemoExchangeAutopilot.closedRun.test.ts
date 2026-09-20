/**
 * LA CUARTA MUDANZA DE LA CÁRCEL ERA UN INTERRUPTOR DE ADMINISTRADOR.
 *
 * `tick()` saltaba toda toma `closed` ANTES de servir y antes de mirar su cola:
 * `PATCH /runs/:id {status:'closed'}` dejaba una retirada aceptada con 201
 * («the autopilot will fulfil it on its next tick») pendiente para siempre, con
 * el latido verde y ops mudo. «La salida jamás se gatea» incluye un interruptor
 * nuestro: una toma cerrada se sirve SOLO PARA SALIR — paga retiradas, resuelve
 * lo ya firmado, no abre entradas nuevas ni operativa propia.
 *
 * Esto ejerce la FASE: un tick entero sobre una toma `closed`, con la POLÍTICA
 * de verdad (`assessPayment` real), y comprueba qué sale y qué no.
 */
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const HASH = '1'.repeat(64);

let runsToServe: DemoRun[] = [];
let credited: Array<{ kind: string; clientId: string; drops: string; txHash: string }> = [];
const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockLookup = jest.fn();
const mockSync = jest.fn(async () => ({ credited }));
const mockBuildHandoff = jest.fn();
const alerts: Array<{ level: string; message: string; key?: string }> = [];
const ticks: Array<{ ok?: boolean; detail?: string }> = [];

jest.mock('../DemoExchangeStore', () => {
  const actual = jest.requireActual('../DemoExchangeStore');
  return {
    ...actual,
    listRuns: jest.fn(async () => runsToServe),
    loadRun: jest.fn(async (id: string) => runsToServe.find((r) => r.runId === id) ?? null),
    saveRun: jest.fn(async () => undefined),
  };
});
jest.mock('../DemoExchangeSync', () => ({
  syncOmnibus: (...a: unknown[]) => mockSync(...(a as [])),
  makeReceipt: (_run: unknown, r: Record<string, unknown>) => ({ id: `rc_${Math.random().toString(36).slice(2)}`, ...r }),
}));
jest.mock('../submissionJournal', () => ({
  readSubmission: jest.fn(async () => null),
  writeSubmission: jest.fn(async () => undefined),
  againstFor: jest.fn(async (_run: unknown, _cid: string, kind: string) => ({ kind, provenUnsigned: new Set<string>(), provenSigned: new Set<string>() })),
  _resetSubmissionJournal: jest.fn(),
}));
// La POLÍTICA es la de verdad; solo se sustituyen la llave, la red y el libro de gasto.
jest.mock('../DemoExchangeSigner', () => {
  const actual = jest.requireActual('../DemoExchangeSigner');
  return {
    ...actual,
    readSignerConfig: () => ({ enabled: true, address: OMNIBUS, seedPresent: true, maxTxDrops: BigInt(100_000_000), dailyCapDrops: BigInt(1_000_000_000), attribution: 'operational', allowUngatedPote: true, requireAppointment: false }),
    readOmnibusAppointment: async () => ({ required: false, held: true }),
    spentToday: async () => BigInt(0),
    recordSpend: async () => undefined,
    reserveSpend: async () => undefined,
    releaseSpend: async () => undefined,
    sweepStaleReservations: async () => [],
    signAndSubmit: jest.fn(),
    signForSubmission: (...a: unknown[]) => mockSign(...a),
    submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
    lookupSubmission: (...a: unknown[]) => mockLookup(...a),
  };
});
jest.mock('../clientCredentialGate', () => ({
  clientCredentialGateEnabled: () => false,
  checkClientCredential: async () => ({ ok: true }),
  isCredentialRefusal: () => false,
  credentialSpecForClient: () => ({ credentialType: 'KYC-101' }),
  clearClientCredentialCache: () => undefined,
}));
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({
  markAgentTick: (_id: string, opts: { ok?: boolean; detail?: string }) => {
    ticks.push({ ok: opts.ok, detail: opts.detail });
  },
}));
jest.mock('../../flare/DirectMintHandoffStore', () => ({
  markHandoffSignedByMemo: async () => true,
  markHandoffParkedByUserOpHash: async () => true,
}));
jest.mock('../../flare/AstryumPoteStateService', () => ({
  readPoteState: async () => ({ asset: { address: '0x' + 'a'.repeat(40) } }),
}));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  NonceSeatTakenError: class NonceSeatTakenError extends Error {},
  readDirectMintParams: async () => ({ paymentAddress: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm' }),
  computeNetMint: (drops: bigint) => ({ supplyUBA: drops - BigInt(1000) }),
  buildDirectMintHandoff: (...a: unknown[]) => mockBuildHandoff(...(a as [])),
}));
jest.mock('../../OpsAlertService', () => ({
  opsAlert: jest.fn(async (_s: string, level: string, message: string, opts: { key?: string } = {}) => {
    alerts.push({ level, message, key: opts.key });
  }),
}));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';

const T0 = new Date(0).toISOString();
const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

function closedRun(over: Partial<DemoRun> = {}): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Closed desk',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'closed',
    autopilot: true,
    createdAt: T0,
    poteAddress: '0x' + 'b'.repeat(40),
    registryAddress: '0x' + '0'.repeat(40),
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, passkeyAccount: '0x4011015268644de37061D6C9b734b1738A8933C8', xrpOnExchangeDrops: '50000000', createdAt: T0 }],
    requests: [],
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
    ...over,
  } as unknown as DemoRun;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  runsToServe = [];
  credited = [];
  alerts.length = 0;
  ticks.length = 0;
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockLookup.mockReset();
  mockSync.mockClear();
  mockBuildHandoff.mockReset();
  mockSign.mockResolvedValue({ txBlob: 'BLOB', hash: HASH, lastLedgerSequence: 1000, submittedAtLedger: 980 });
  mockSubmit.mockResolvedValue({ txHash: HASH, result: 'tesSUCCESS', validated: true });
});

describe('Una toma cerrada sigue sirviendo SALIDAS', () => {
  it('una retirada pendiente en una toma `closed` se firma, se envía y queda `done` con su E8', async () => {
    const run = closedRun({ requests: [{ id: 'rqExit', kind: 'withdraw', clientId: 'c1', drops: '10000000', status: 'pending', createdAt: T0, updatedAt: T0 }] });
    runsToServe = [run];

    const r = await new DemoExchangeAutopilot().tick();

    expect(r.failed).toBeUndefined();
    expect(r.runs).toBe(1);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(run.requests![0].status).toBe('done');
    expect(run.requests![0].txHash).toBe(HASH);
    expect(run.receipts.some((x) => x.step === 'E8_WITHDRAW' && x.txHash === HASH)).toBe(true);
    expect(run.clients[0].xrpOnExchangeDrops).toBe('40000000');
  });

  it('una ENTRADA pendiente en una toma `closed` no se ejecuta: negativa final RUN_CLOSED, recibo, y nada compuesto', async () => {
    const run = closedRun({ requests: [{ id: 'rqEntry', kind: 'put-to-work', clientId: 'c1', drops: '10000000', status: 'pending', createdAt: T0, updatedAt: T0 }] });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockBuildHandoff).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(run.requests![0].status).toBe('refused');
    expect(run.requests![0].reason).toMatch(/^RUN_CLOSED: .*can be withdrawn/);
    expect(run.receipts.some((x) => x.step === 'NOTE' && /RUN_CLOSED/.test(x.note ?? ''))).toBe(true);
    // el saldo sigue intacto y disponible
    expect(run.clients[0].xrpOnExchangeDrops).toBe('50000000');
  });

  it('Una entrada `pending` cuyo JOURNAL dice firmada no se cierra con RUN_CLOSED: el ledger manda (sigue valiendo cerrada)', async () => {
    const journal = jest.requireMock('../submissionJournal') as { readSubmission: jest.Mock };
    journal.readSubmission.mockResolvedValueOnce({ requestId: 'rqEntry', runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '10000000', txHash: HASH, lastLedgerSequence: 1000, submittedAtLedger: 980, status: 'submitting', updatedAt: T0 });
    mockLookup.mockResolvedValue({ lookup: { kind: 'in-flight' }, validatedLedgerIndex: 990 });
    const run = closedRun({ requests: [{ id: 'rqEntry', kind: 'put-to-work', clientId: 'c1', drops: '10000000', status: 'pending', createdAt: T0, updatedAt: T0 }] });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(run.requests![0].status).toBe('submitting');
    expect(run.requests![0].txHash).toBe(HASH);
    expect(run.requests![0].reason).not.toMatch(/RUN_CLOSED/);
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('la instrucción permanente (auto-invest) no abre entradas en una toma cerrada — recibo, no petición', async () => {
    credited = [{ kind: 'deposit', clientId: 'c1', drops: '5000000', txHash: 'A'.repeat(64) }];
    const run = closedRun({
      clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, autoInvest: true, xrpOnExchangeDrops: '5000000', createdAt: T0 }],
      // algo vivo para que la toma cerrada se lea (una reserva de mesa firmada esperando al espejo)
      deskPayments: [{ id: 'dp1', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'signed', txHash: 'B'.repeat(64), createdAt: T0, updatedAt: T0 }],
    });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(run.requests ?? []).toHaveLength(0);
    expect(run.receipts.some((x) => /Auto-invest held: this exchange desk is closed/.test(x.note ?? ''))).toBe(true);
  });

  it('lo ya FIRMADO en una toma cerrada lo sigue decidiendo el ledger (resolveSubmitting corre)', async () => {
    mockLookup.mockResolvedValue({ lookup: { kind: 'validated', result: 'tesSUCCESS' }, validatedLedgerIndex: 1001 });
    const run = closedRun({ requests: [{ id: 'rqSub', kind: 'withdraw', clientId: 'c1', drops: '10000000', status: 'submitting', txHash: HASH, lastLedgerSequence: 1000, submittedAtLedger: 980, createdAt: T0, updatedAt: T0 }] });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockSign).not.toHaveBeenCalled();
    expect(run.requests![0].status).toBe('done');
  });

  it('una toma cerrada SIN nada vivo no se sirve ni se lee: cero llamadas al vigía', async () => {
    const run = closedRun({ requests: [{ id: 'rqDone', kind: 'withdraw', clientId: 'c1', drops: '1', status: 'done', createdAt: T0, updatedAt: T0 }] });
    runsToServe = [run];

    const r = await new DemoExchangeAutopilot().tick();

    expect(r.runs).toBe(0);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('y su cola envejece en voz alta: una salida vieja en una toma cerrada es `critical` y apaga el verde', async () => {
    mockSign.mockRejectedValue(new Error('node down'));
    const run = closedRun({ requests: [{ id: 'rqOld', kind: 'withdraw', clientId: 'c1', drops: '10000000', status: 'pending', createdAt: ago(45), updatedAt: ago(45) }] });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();
    await settle();

    expect(alerts.find((a) => a.key === 'request-stale:rqOld')?.level).toBe('critical');
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toContain('withdraw rqOld');
  });
});

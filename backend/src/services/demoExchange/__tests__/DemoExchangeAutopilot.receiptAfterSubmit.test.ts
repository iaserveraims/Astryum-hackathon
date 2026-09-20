/**
 * «AND WAS SUBMITTED ANYWAY» SE ESCRIBÍA ANTES DEL SUBMIT.
 *
 * `DemoExchangeAutopilot.fulfil` (rama payout) emitía el recibo NOTE y la alerta
 * crítica del `reserveSpend` fallido —«… and was submitted anyway»— ANTES de
 * `submitSignedBlob`. Si el nodo no conecta, el pago nunca sale, el siguiente
 * tick lo declara `expired` y firma otro hash; y el libro de recibos (`/proof`,
 * documento de due diligence) queda afirmando un envío que no existió, fijo,
 * porque `noteCapUnread` deduplica por texto exacto. El párrafo que lo prohíbe
 * estaba cuarenta líneas más arriba.
 */
import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const HASH = '1'.repeat(64);

let runsToServe: DemoRun[] = [];
const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockReserve = jest.fn();
const mockSpentToday = jest.fn();
const alerts: Array<{ level: string; message: string; key?: string }> = [];

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
  syncOmnibus: jest.fn(async () => ({ credited: [] })),
  makeReceipt: (_run: unknown, r: Record<string, unknown>) => ({ id: `rc_${Math.random().toString(36).slice(2)}`, ...r }),
}));
jest.mock('../submissionJournal', () => ({
  readSubmission: jest.fn(async () => null),
  writeSubmission: jest.fn(async () => undefined),
  againstFor: jest.fn(async (_run: unknown, _cid: string, kind: string) => ({ kind, provenUnsigned: new Set<string>(), provenSigned: new Set<string>() })),
  _resetSubmissionJournal: jest.fn(),
}));
jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', seedPresent: true, maxTxDrops: BigInt(10_000_000), dailyCapDrops: BigInt(100_000_000), attribution: 'operational' }),
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: (...a: unknown[]) => mockSpentToday(...(a as [])),
  sweepStaleReservations: async () => [],
  recordSpend: async () => undefined,
  reserveSpend: (...a: unknown[]) => mockReserve(...(a as [])),
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
  signForSubmission: (...a: unknown[]) => mockSign(...a),
  submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
  lookupSubmission: jest.fn(),
}));
jest.mock('../clientCredentialGate', () => ({
  clientCredentialGateEnabled: () => false,
  checkClientCredential: async () => ({ ok: true }),
  isCredentialRefusal: () => false,
  credentialSpecForClient: () => ({ credentialType: 'KYC-101' }),
  clearClientCredentialCache: () => undefined,
}));
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: async () => ({ paymentAddress: 'rCoreVault11111111111111111111' }),
  computeNetMint: () => ({ supplyUBA: BigInt(1) }),
  buildDirectMintHandoff: async () => {
    throw new Error('no Flare in this test');
  },
  NonceSeatTakenError: class extends Error {},
}));
jest.mock('../../OpsAlertService', () => ({
  opsAlert: jest.fn(async (_s: string, level: string, message: string, opts: { key?: string } = {}) => {
    alerts.push({ level, message, key: opts.key });
  }),
}));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';

function withdrawRun(): DemoRun {
  const T0 = new Date(0).toISOString();
  return {
    runId: 'run1',
    seq: 1,
    label: 'Receipt after submit',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '50000000', createdAt: T0 }],
    requests: [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '10000000', status: 'pending', createdAt: T0, updatedAt: T0 }],
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
  } as unknown as DemoRun;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockReserve.mockReset();
  mockSpentToday.mockReset();
  alerts.length = 0;
  mockSign.mockResolvedValue({ txBlob: 'BLOB', hash: HASH, lastLedgerSequence: 1000, submittedAtLedger: 980 });
  // El libro del día no se lee NI se escribe: los dos apuntes que el recibo nombra.
  mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
  mockReserve.mockRejectedValue(new Error('P1001 database unreachable'));
});

describe('El recibo se escribe cuando el pago sale, no antes', () => {
  it('submitSignedBlob LANZA → ningún recibo ni alerta dice «submitted»; la petición queda submitting con su hash y una frase honesta', async () => {
    mockSubmit.mockRejectedValue(new Error('connect ECONNREFUSED xrpl node'));
    const run = withdrawRun();
    runsToServe = [run];

    const { failed } = await new DemoExchangeAutopilot().tick();
    await settle();

    expect(failed).toBeUndefined();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    // La FASE: nada afirma un envío que no se pudo confirmar.
    const notes = run.receipts.filter((r) => r.step === 'NOTE').map((r) => r.note ?? '');
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).not.toMatch(/submitted anyway/);
    expect(notes.some((n) => /outcome is not read yet/.test(n))).toBe(true);
    for (const a of alerts) expect(a.message).not.toMatch(/submitted anyway/);
    // …y la petición sigue el camino de la: firmada, persistida, el ledger decide.
    const req = run.requests![0];
    expect(req.status).toBe('submitting');
    expect(req.txHash).toBe(HASH);
    expect(req.reason).toMatch(/whether it entered is not read yet/);
    expect(req.reason).not.toMatch(/^submitted;/);
  });

  it('submitSignedBlob CONTESTA → ahora sí: «submitted anyway», y con los dos apuntes que faltaron', async () => {
    mockSubmit.mockResolvedValue({ txHash: HASH, result: 'tesSUCCESS', validated: true });
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();
    await settle();

    expect(run.requests![0].status).toBe('done');
    const notes = run.receipts.filter((r) => r.step === 'NOTE').map((r) => r.note ?? '');
    expect(notes.filter((n) => /was submitted anyway/.test(n))).toHaveLength(2);
    expect(notes.some((n) => /left no audit entry/.test(n) && /submitted anyway/.test(n))).toBe(true);
    expect(alerts.some((a) => a.level === 'critical' && /submitted anyway/.test(a.message))).toBe(true);
  });

  it('el orden es el que el fichero promete: la nota de «submitted anyway» no existe hasta que submit ha vuelto', async () => {
    // El submit mira el libro de recibos en el instante en que se le llama.
    let notesAtSubmit: string[] = [];
    const run = withdrawRun();
    mockSubmit.mockImplementation(async () => {
      notesAtSubmit = run.receipts.map((r) => r.note ?? '');
      return { txHash: HASH, result: 'tesSUCCESS', validated: true };
    });
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(notesAtSubmit.some((n) => /submitted/.test(n))).toBe(false);
    expect(run.receipts.some((r) => /submitted anyway/.test(r.note ?? ''))).toBe(true);
  });
});

/**
 * EL TOPE DIARIO ACOTA NUESTRA LLAVE, NUNCA LA SALIDA DE UN
 * CLIENTE; Y EL GASTO SE ESCRIBE ANTES DE ENVIAR.
 */
import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const HASH = 'C'.repeat(64);

let runsToServe: DemoRun[] = [];

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockSpentToday = jest.fn(async () => BigInt(0));
const mockReserve = jest.fn(async () => undefined);
const mockRelease = jest.fn(async () => undefined);
const mockRecord = jest.fn(async () => undefined);
/** The order in which the signer's steps were called, to prove «reserve BEFORE submit». */
const calls: string[] = [];

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
  // El journal vacío no exime ni acusa a nadie (`againstFor`).
  againstFor: jest.fn(async (_run: unknown, _cid: string, kind: string) => ({ kind, provenUnsigned: new Set<string>(), provenSigned: new Set<string>() })),
  _resetSubmissionJournal: jest.fn(),
}));

jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: OMNIBUS, seedPresent: true, maxTxDrops: '10000000', dailyCapDrops: '100000000', attribution: 'operational' }),
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: (...a: unknown[]) => mockSpentToday(...(a as [])),
  sweepStaleReservations: async () => [],
  recordSpend: (...a: unknown[]) => {
    calls.push('record');
    return mockRecord(...(a as []));
  },
  reserveSpend: (...a: unknown[]) => {
    calls.push('reserve');
    return mockReserve(...(a as []));
  },
  releaseSpend: (...a: unknown[]) => {
    calls.push('release');
    return mockRelease(...(a as []));
  },
  signAndSubmit: jest.fn(),
  signForSubmission: (...a: unknown[]) => {
    calls.push('sign');
    return mockSign(...a);
  },
  submitSignedBlob: (...a: unknown[]) => {
    calls.push('submit');
    return mockSubmit(...a);
  },
  lookupSubmission: jest.fn(),
}));

// El KYC por casilla lee el ledger: fuera de esta prueba, que va del TOPE.
jest.mock('../clientCredentialGate', () => ({
  clientCredentialGateEnabled: () => false,
  checkClientCredential: async () => ({ ok: true }),
  isCredentialRefusal: () => false,
  credentialSpecForClient: () => ({ credentialType: 'KYC-101' }),
  clearClientCredentialCache: () => undefined,
}));

jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
/** El latido de cada tick, para poder mirarlo. */
const ticks: Array<{ ok?: boolean; detail?: string }> = [];
jest.mock('../../ops/agentHeartbeats', () => ({
  markAgentTick: (_id: string, opts: { ok?: boolean; detail?: string }) => {
    ticks.push({ ok: opts.ok, detail: opts.detail });
  },
}));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: async () => ({ paymentAddress: 'rCoreVault11111111111111111111' }),
  computeNetMint: () => ({ supplyUBA: BigInt(1) }),
  buildDirectMintHandoff: async () => {
    throw new Error('no Flare in this test');
  },
  NonceSeatTakenError: class extends Error {},
}));

// El canal de ops es un efecto lateral de casi todas estas pruebas -
// salvo en el bloque de la, donde es justamente lo que se prueba.
const mockOpsAlert = jest.fn(async () => undefined);
jest.mock('../../OpsAlertService', () => ({ opsAlert: (...a: unknown[]) => mockOpsAlert(...(a as [])) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';

function withdrawRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Spend cap test',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: new Date(0).toISOString(),
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '5000000', createdAt: new Date(0).toISOString() }],
    requests: [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
  } as unknown as DemoRun;
}

/** Same run, but the client asked to put capital to WORK (an entry). */
function putToWorkRun(): DemoRun {
  const run = withdrawRun();
  (run.requests as Array<Record<string, unknown>>)[0].kind = 'put-to-work';
  run.poteAddress = '0x' + '1'.repeat(40);
  run.clients[0].passkeyAccount = '0x' + '2'.repeat(40);
  return run;
}

const req0 = (run: DemoRun) => (run.requests as Array<{ status: string; reason?: string }>)[0];

beforeEach(() => {
  calls.length = 0;
  ticks.length = 0;
  mockOpsAlert.mockClear();
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockSpentToday.mockReset();
  mockReserve.mockReset();
  mockRelease.mockReset();
  mockRecord.mockReset();
  mockSpentToday.mockResolvedValue(BigInt(0));
  mockReserve.mockResolvedValue(undefined);
  mockRelease.mockResolvedValue(undefined);
  mockRecord.mockResolvedValue(undefined);
  mockSign.mockResolvedValue({ txBlob: 'BLOB', hash: HASH, lastLedgerSequence: 1000, submittedAtLedger: 980 });
  mockSubmit.mockResolvedValue({ txHash: HASH, result: 'tesSUCCESS', validated: true });
});

describe('1.7 — una lectura fallida NUESTRA no detiene el pago de un cliente', () => {
  it('payout: `spentToday` lanza → el pago SALE y el hecho queda escrito en un recibo', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    const run = withdrawRun();
    runsToServe = [run];

    const { actions, failed } = await new DemoExchangeAutopilot().tick();

    expect(failed).toBeUndefined();
    expect(actions).toBe(1);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const note = run.receipts.find((r) => r.step === 'NOTE' && /could not be read/.test(r.note ?? ''));
    expect(note).toBeTruthy();
    expect(note?.note).toMatch(/never gates a client's exit/);
  });

  it('put-to-work: la misma lectura fallida FALLA CERRADA, con su motivo visible y sin firmar nada', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    const run = putToWorkRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSign).not.toHaveBeenCalled();
    expect(req0(run).reason).toMatch(/^SPEND_LEDGER_UNREADABLE:/);
    // Nada de morir en el `errors.push` del tick: la petición sigue pendiente CON frase.
    expect(req0(run).status).toBe('pending');
  });
});

describe('1.4 — el gasto se reserva ANTES de enviar', () => {
  it('payout: el orden es firmar → reservar → enviar (nunca enviar y luego apuntar)', async () => {
    runsToServe = [withdrawRun()];
    await new DemoExchangeAutopilot().tick();
    expect(calls.indexOf('reserve')).toBeGreaterThan(calls.indexOf('sign'));
    expect(calls.indexOf('reserve')).toBeLessThan(calls.indexOf('submit'));
    expect(mockReserve).toHaveBeenCalledWith(BigInt(1_000_000), HASH, 'payout');
  });

  it('payout: una reserva que no se puede escribir NO para el pago — se dice y se envía', async () => {
    mockReserve.mockRejectedValue(new Error('write lost'));
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    // El recibo dice lo que pasó — faltó el APUNTE de auditoría; un
    // payout no engorda el tope desde la, así que ningún total está corto.
    const note = run.receipts.find((r) => r.step === 'NOTE' && /left no audit entry in today's spend ledger/.test(r.note ?? ''));
    expect(note).toBeDefined();
    expect(note!.note).toMatch(/a payout never counts against the cap, so no total is short/);
    expect(note!.note).not.toMatch(/not counted against today's cap/);
  });

  it('el ledger contesta con un fallo → la reserva se devuelve al tope', async () => {
    mockSubmit.mockResolvedValue({ txHash: HASH, result: 'tecUNFUNDED_PAYMENT', validated: true });
    runsToServe = [withdrawRun()];

    await new DemoExchangeAutopilot().tick();

    expect(mockRelease).toHaveBeenCalledWith(HASH);
  });

  it('el ledger lo valida → la reserva pasa a gasto asentado, una sola vez', async () => {
    runsToServe = [withdrawRun()];
    await new DemoExchangeAutopilot().tick();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith(BigInt(1_000_000), HASH, 'payout');
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

/**
 * EL RECIBO SE ESCRIBE CUANDO EL PAGO SALE, NO ANTES.
 *
 * `noteCapUnread(..., 'the payout went out anyway')` se escribía ENCIMA de la
 * firma. Si `signForSubmission` o `persistSubmission` fallaban un renglón más
 * abajo —y los dos tienen su propia rama de fallo— el libro de recibos, que es
 * el rastro que leen `/proof` y el verificador, quedaba afirmando un pago que
 * NUNCA salió. Y como el recibo se deduplica por texto exacto, ningún tick
 * posterior corrigía la mentira.
 */
describe('El recibo de un payout no se adelanta al pago', () => {
  const noteAbout = (run: DemoRun, re: RegExp) => run.receipts.find((r) => r.step === 'NOTE' && re.test(r.note ?? ''));

  it('la firma falla con el tope ilegible → NINGÚN recibo afirma que el pago salió', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    mockSign.mockRejectedValue(new Error('socket hang up'));
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(noteAbout(run, /went out|was submitted/)).toBeUndefined();
    // Ni un recibo de tope ilegible siquiera: no hubo pago del que hablar.
    expect(noteAbout(run, /could not be read/)).toBeUndefined();
    // La petición sigue viva, con su motivo, y nada se niega.
    expect(req0(run).status).toBe('pending');
    expect(req0(run).reason).toMatch(/^PAYOUT_NOT_SIGNED_YET:/);
  });

  it('el registro durable falla con el tope ilegible → tampoco hay recibo de pago', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    const journal = jest.requireMock('../submissionJournal') as { writeSubmission: jest.Mock };
    journal.writeSubmission.mockRejectedValueOnce(new Error('P2028 transaction timed out'));
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(noteAbout(run, /went out|was submitted/)).toBeUndefined();
    expect(req0(run).reason).toMatch(/^PAYOUT_NOT_RECORDED:/);
    journal.writeSubmission.mockResolvedValue(undefined);
  });

  it('el pago SALE → entonces sí, y el recibo nombra el hash', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const note = noteAbout(run, /was submitted anyway/);
    expect(note).toBeTruthy();
    expect(note?.note).toContain(HASH.slice(0, 12));
    expect(note?.note).toMatch(/never gates a client's exit/);
  });

  it('el envío lanza → el recibo dice que el resultado no se ha leído, jamás que el pago salió', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    mockSubmit.mockRejectedValue(new Error('socket hang up'));
    const run = withdrawRun();
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(noteAbout(run, /outcome is not read yet/)).toBeTruthy();
    expect(noteAbout(run, /was submitted anyway/)).toBeUndefined();
    expect(req0(run).status).toBe('submitting');
  });
});

/**
 * UNA PETICIÓN PUEDE ENVEJECER PARA SIEMPRE Y EL AGENTE SEGUÍA VERDE.
 *
 * `refuse(final=false)` deja la petición `pending` con su motivo y no toca nada
 * más: ni el canal de ops, ni el latido —que se declaraba `ok` mientras el tick
 * no lanzara—, ni ningún reloj. Nadie medía la antigüedad de la cola, así que un
 * cliente podía quedarse esperando días mientras el panel decía que todo iba bien.
 */
describe('Lo que envejece en la cola suena en ops y apaga el verde', () => {
  const HOUR_AGO = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const alertsAbout = (re: RegExp) => mockOpsAlert.mock.calls.filter((c) => re.test(String(c[2])));

  /** Una salida que lleva tres horas pendiente porque nadie pudo firmarla. */
  function agedRun(kind: 'withdraw' | 'put-to-work'): DemoRun {
    const run = kind === 'withdraw' ? withdrawRun() : putToWorkRun();
    Object.assign((run.requests as Array<Record<string, unknown>>)[0], {
      createdAt: HOUR_AGO,
      updatedAt: HOUR_AGO,
      reason: 'PAYOUT_NOT_SIGNED_YET: the payout could not be signed this tick',
    });
    // Sin llave para esta toma: nadie la sirve, solo envejece.
    run.omnibusAddress = 'rOtherOmnibus1111111111111111111';
    return run;
  }

  it('una salida vieja: alerta CRÍTICA con la palanca real, y el latido deja de ser verde', async () => {
    runsToServe = [agedRun('withdraw')];

    await new DemoExchangeAutopilot().tick();

    const alerts = alertsAbout(/withdraw request has been waiting/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toBe('critical');
    expect(String((alerts[0][3] as { runbook?: string }).runbook)).toMatch(/DELETE \/api\/demo-exchange\/runs\/:id\/clients\/:cid\/requests\/:rid/);
    expect((alerts[0][3] as { facts?: Record<string, unknown> }).facts).toMatchObject({ kind: 'withdraw', ageMinutes: 180 });

    expect(ticks).toHaveLength(1);
    expect(ticks[0].ok).toBe(false);
    expect(ticks[0].detail).toMatch(/withdraw rq1 .* waiting 180 min/);
  });

  it('una entrada vieja avisa en WARN — y dice que ya no retiene la salida de su dueño', async () => {
    runsToServe = [agedRun('put-to-work')];

    await new DemoExchangeAutopilot().tick();

    const alerts = alertsAbout(/put-to-work request has been waiting/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toBe('warn');
    expect(String((alerts[0][3] as { runbook?: string }).runbook)).toMatch(/ya NO retiene la salida/);
    expect(ticks[0].ok).toBe(false);
  });

  it('una petición recién pedida no suena, y el latido sigue verde', async () => {
    const run = agedRun('withdraw');
    const req = (run.requests as Array<Record<string, unknown>>)[0];
    req.createdAt = new Date().toISOString();
    req.updatedAt = req.createdAt;
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(alertsAbout(/has been waiting/)).toHaveLength(0);
    expect(ticks[0].ok).toBe(true);
  });
});

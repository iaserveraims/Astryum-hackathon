/**
 * LA SALIDA DE UN CLIENTE NO LA PARA NI NUESTRO TOPE NI
 * NUESTRA COLA.
 */
import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET_1 = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const WALLET_2 = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);

/** Tope deliberadamente diminuto: 2 XRP por pago, 3 XRP al día. */
const MAX_TX_DROPS = BigInt(2_000_000);
const DAILY_CAP_DROPS = BigInt(3_000_000);

let runsToServe: DemoRun[] = [];

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockSpentToday = jest.fn(async () => BigInt(0));
const mockOpsAlert = jest.fn(async () => undefined);

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

// La POLÍTICA es la de verdad; solo se sustituyen la llave, la red y el libro de gasto.
jest.mock('../DemoExchangeSigner', () => {
  const actual = jest.requireActual('../DemoExchangeSigner');
  return {
    ...actual,
    readSignerConfig: () => ({
      enabled: true,
      address: OMNIBUS,
      seedPresent: true,
      maxTxDrops: MAX_TX_DROPS,
      dailyCapDrops: DAILY_CAP_DROPS,
      attribution: 'operational',
      allowUngatedPote: false,
      requireAppointment: false,
    }),
    readOmnibusAppointment: async () => ({ required: false, held: true }),
    spentToday: (...a: unknown[]) => mockSpentToday(...(a as [])),
    recordSpend: async () => undefined,
    reserveSpend: async () => undefined,
    releaseSpend: async () => undefined,
    sweepStaleReservations: async () => [],
    signAndSubmit: jest.fn(),
    signForSubmission: (...a: unknown[]) => mockSign(...a),
    submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
    lookupSubmission: jest.fn(),
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
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: async () => ({ paymentAddress: 'rCoreVault11111111111111111111' }),
  computeNetMint: () => ({ supplyUBA: BigInt(1) }),
  buildDirectMintHandoff: async () => {
    throw new Error('no Flare in this test');
  },
  NonceSeatTakenError: class extends Error {},
}));
jest.mock('../../OpsAlertService', () => ({ opsAlert: (...a: unknown[]) => mockOpsAlert(...(a as [])) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';

/** Una toma con N clientes, cada uno con su retirada pendiente. */
function withdrawRun(withdrawals: Array<{ id: string; tag: number; wallet: string; drops: string }>): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Exit is never capped',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: new Date(0).toISOString(),
    clients: withdrawals.map((w) => ({ id: w.id, runId: 'run1', label: w.id, tag: w.tag, kyc: 'none', xrplAddress: w.wallet, xrpOnExchangeDrops: '50000000', createdAt: new Date(0).toISOString() })),
    requests: withdrawals.map((w, i) => ({ id: `rq${i + 1}`, kind: 'withdraw', clientId: w.id, drops: w.drops, status: 'pending', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() })),
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: Object.fromEntries(withdrawals.map((w) => [w.id, [w.wallet]])),
  } as unknown as DemoRun;
}

const reqs = (run: DemoRun) => (run.requests ?? []) as Array<{ id: string; status: string; reason?: string }>;

beforeEach(() => {
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockSpentToday.mockReset();
  mockOpsAlert.mockReset();
  mockSpentToday.mockResolvedValue(BigInt(0));
  mockSign.mockResolvedValue({ txBlob: 'BLOB', hash: HASH_1, lastLedgerSequence: 1000, submittedAtLedger: 980 });
  mockSubmit.mockResolvedValue({ txHash: HASH_1, result: 'tesSUCCESS', validated: true });
  mockOpsAlert.mockResolvedValue(undefined);
});

describe('B.1 — el tope acota NUESTRA llave; la salida del cliente sale', () => {
  it('un payout por encima del tope diario MEDIDO sale igual', async () => {
    mockSpentToday.mockResolvedValue(BigInt(2_900_000)); // 2,9 de 3 XRP ya gastados hoy
    const run = withdrawRun([{ id: 'c1', tag: 101, wallet: WALLET_1, drops: '10000000' }]); // 10 XRP
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(reqs(run)[0].status).toBe('done');
    expect(reqs(run)[0].reason).toBeUndefined();
  });

  it('un payout por encima del tope POR TRANSACCIÓN sale igual', async () => {
    const run = withdrawRun([{ id: 'c1', tag: 101, wallet: WALLET_1, drops: '5000000' }]); // 5 XRP > 2 XRP/tx
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(reqs(run)[0].status).toBe('done');
  });

  it('con la lectura del tope CAÍDA, el payout sale y el hecho queda dicho — en el recibo y en el canal de ops', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    const run = withdrawRun([{ id: 'c1', tag: 101, wallet: WALLET_1, drops: '10000000' }]);
    runsToServe = [run];

    const { failed } = await new DemoExchangeAutopilot().tick();

    expect(failed).toBeUndefined();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(reqs(run)[0].status).toBe('done');
    const note = run.receipts.find((r) => r.step === 'NOTE' && /could not be read/.test(r.note ?? ''));
    expect(note?.note).toMatch(/never gates a client's exit/);
    // El rastro no vive solo en la base de datos que no contesta.
    expect(mockOpsAlert).toHaveBeenCalled();
    expect(mockOpsAlert.mock.calls.some((c) => String(c[2]).includes('daily spend ledger'))).toBe(true);
  });

  it('la política dice lo mismo sin el autopilot: una SALIDA no mira el tope, una ENTRADA sí', () => {
    const { assessPayment, capApplies } = jest.requireActual('../DemoExchangeSigner') as typeof import('../DemoExchangeSigner');
    const run = { omnibusAddress: OMNIBUS, clients: [{ id: 'c1', xrplAddress: WALLET_1, passkeyAccount: '0x' + '2'.repeat(40) } as never] };
    const signer = { enabled: true, address: OMNIBUS, maxTxDrops: MAX_TX_DROPS, dailyCapDrops: DAILY_CAP_DROPS };
    const payout = { TransactionType: 'Payment', Account: OMNIBUS, Destination: WALLET_1, Amount: '10000000' };

    expect(capApplies('payout')).toBe(false);
    expect(capApplies('put-to-work')).toBe(true);
    // Sin número de gasto (no se pudo leer) y sin persistencia: la salida sale.
    expect(assessPayment({ tx: payout, purpose: 'payout', run, signer, coreVaultAddress: 'rCoreVault11111111111111111111', spendLedgerPersisted: false })).toEqual({ ok: true });
    // La entrada, con el mismo importe, no.
    const mint = { TransactionType: 'Payment', Account: OMNIBUS, Destination: 'rCoreVault11111111111111111111', Amount: '10000000' };
    expect(
      assessPayment({
        tx: mint,
        purpose: 'put-to-work',
        run,
        signer,
        coreVaultAddress: 'rCoreVault11111111111111111111',
        receiver: '0x' + '2'.repeat(40),
        onChainGate: { configured: true, approved: true },
        spentTodayDrops: BigInt(0),
      }).code,
    ).toBe('ABOVE_MAX_TX');
  });
});

describe('B.2 — un `throw` en una salida no para la cola', () => {
  it('el primer payout revienta al firmar: el segundo cliente cobra y el primero queda con motivo', async () => {
    mockSign.mockRejectedValueOnce(new Error('Unexpected server response: 402'));
    mockSign.mockResolvedValueOnce({ txBlob: 'BLOB2', hash: HASH_2, lastLedgerSequence: 1000, submittedAtLedger: 980 });
    mockSubmit.mockResolvedValue({ txHash: HASH_2, result: 'tesSUCCESS', validated: true });
    const run = withdrawRun([
      { id: 'c1', tag: 101, wallet: WALLET_1, drops: '1000000' },
      { id: 'c2', tag: 102, wallet: WALLET_2, drops: '1000000' },
    ]);
    runsToServe = [run];

    const { failed } = await new DemoExchangeAutopilot().tick();

    expect(failed).toBeUndefined();
    // El segundo cliente SÍ se sirvió — el tick no murió con el primero.
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(reqs(run)[1].status).toBe('done');
    // Y el primero no quedó mudo: sigue vivo, con su frase y sin negarse nada.
    expect(reqs(run)[0].status).toBe('pending');
    expect(reqs(run)[0].reason).toMatch(/^PAYOUT_NOT_SIGNED_YET:/);
    expect(reqs(run)[0].reason).toMatch(/nothing is refused/);
    expect(mockOpsAlert.mock.calls.some((c) => c[1] === 'critical' && /payout could not be SIGNED/.test(String(c[2])))).toBe(true);
  });

  it('un payout que revienta al REGISTRARSE no se envía a ciegas, y los demás siguen', async () => {
    const journal = jest.requireMock('../submissionJournal') as { writeSubmission: jest.Mock };
    journal.writeSubmission.mockRejectedValueOnce(new Error('P2028 transaction timed out'));
    mockSign.mockResolvedValueOnce({ txBlob: 'BLOB1', hash: HASH_1, lastLedgerSequence: 1000, submittedAtLedger: 980 });
    mockSign.mockResolvedValueOnce({ txBlob: 'BLOB2', hash: HASH_2, lastLedgerSequence: 1000, submittedAtLedger: 980 });
    mockSubmit.mockResolvedValue({ txHash: HASH_2, result: 'tesSUCCESS', validated: true });
    const run = withdrawRun([
      { id: 'c1', tag: 101, wallet: WALLET_1, drops: '1000000' },
      { id: 'c2', tag: 102, wallet: WALLET_2, drops: '1000000' },
    ]);
    runsToServe = [run];

    await new DemoExchangeAutopilot().tick();

    // El pago del primero NO salió (sin registro durable, el siguiente tick
    // firmaría un segundo pago y cobraría dos veces); el del segundo, sí.
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith('BLOB2');
    expect(reqs(run)[0].status).toBe('pending');
    expect(reqs(run)[0].reason).toMatch(/^PAYOUT_NOT_RECORDED:/);
    expect(reqs(run)[1].status).toBe('done');
  });
});

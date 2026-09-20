/**
 * productizer-it13 §1.1 / §2.1 — who decides the nonce seat of a 0xFE.
 *
 * §1.1 (regression of it11): `/handoff/signed` answers PENDING_LEDGER before the
 * Payment validates, and only the executor sweep marks it. With the executor
 * stopped past the TTL, the next prepare invalidated a SIGNED 0xFE and composed
 * its twin on the same nonce (the 2026-08-21 incident). A reported hash is now
 * looked up on the ledger before the TTL may retire the seat.
 *
 * §2.1: `supersede` came from the body, so any session displaced anybody's draft,
 * and any session could prepare against the demo exchange omnibus. Now supersede
 * displaces a fresh draft only for its preparer or a session that proved the
 * account, and an operational account only takes Astryum's own server flows.
 *
 * The chain is faked at ethers.Contract (PA + nonce 7), the store at its module.
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

const AM = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const MAC = '0x434936d47503353f06750db1a444dbdc5f0ad37c';
const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const CORE_VAULT = 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj';
const PA = '0x1111111111111111111111111111111111111111';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockContract {
    constructor(public address: string) {}
    async getContractAddressByName(name: string): Promise<string> {
      return name === 'AssetManagerFXRP' ? AM : MAC;
    }
    async fAsset() { return FXRP; }
    async directMintingPaymentAddress() { return CORE_VAULT; }
    async getDirectMintingMinimumFeeUBA() { return 100000n; }
    async getDirectMintingFeeBIPS() { return 10n; }
    async getDirectMintingExecutorFeeUBA() { return 200000n; }
    async assetMintingGranularityUBA() { return 1n; }
    async getPersonalAccount(_xrpl: string) { return PA; }
    async getNonce(_pa: string) { return 7n; }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

const mockQueued = jest.fn();
const mockSuperseded = jest.fn();
const mockSave = jest.fn();
const mockVerify = jest.fn();
const mockMarkSigned = jest.fn();
const mockLedger = jest.fn();
const mockWindow = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock('../../../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffsByPersonalAccount: (...a: unknown[]) => mockQueued(...a),
  markHandoffsSuperseded: (...a: unknown[]) => mockSuperseded(...a),
  listParked0xFe: async () => [],
  saveHandoffRecord: (...a: unknown[]) => mockSave(...a),
  verifyHandoffPaymentOnLedger: (...a: unknown[]) => mockVerify(...a),
  markHandoffSignedByMemo: (...a: unknown[]) => mockMarkSigned(...a),
  // it15 §K1: estas filas son las ANTIGUAS, sin ventana de ledger — el ledger
  // validado se lee como ilegible, así que rige la regla de it13 (TTL+informes).
  readValidatedLedgerIndex: (...a: unknown[]) => mockLedger(...a),
  readHandoffMemoWindow: (...a: unknown[]) => mockWindow(...a),
  markHandoffLedgerFailedByMemo: (...a: unknown[]) => mockMarkFailed(...a),
}));

import {
  buildDirectMintHandoff,
  buildExecuteUserOpCallData,
  buildPackedUserOp,
  classifySeatConflicts,
  resolveReportedSignature,
  NonceSeatTakenError,
  OperationalAccountHandoffError,
  _resetAssetManagerCache,
} from '../FlareDirectMintService';
import type { BuildDirectMintInput, SeatReportVerdict } from '../FlareDirectMintService';
import { _resetMacCache } from '../FlareSmartAccountService';

const USER = 'rUserXrplAddr';
const OMNIBUS = 'rOmnibusOperationalAccount11111';
const KFXRP = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3';
const H1 = 'A'.repeat(64);
const H2 = 'B'.repeat(64);
const MIN = 60_000;
const fakeProvider = {} as never;
const PARAMS = {
  fxrpToken: FXRP,
  paymentAddress: CORE_VAULT,
  minFeeUBA: 100000n,
  feeBIPS: 10n,
  executorFeeUBA: 200000n,
  granularityUBA: 1n,
};
const ago = (ms: number) => new Date(Date.now() - ms);

/** A queued handoff holding the same seat (PA + nonce 7) with ANOTHER userOp. */
async function conflictRow(over: Record<string, unknown> = {}) {
  const callData = await buildExecuteUserOpCallData([{ to: KFXRP, calldata: '0xdeadbeef', value: '0' }]);
  const op = await buildPackedUserOp({ sender: PA, nonce: 7n, callData });
  return {
    userOpHash: op.userOpHash,
    userOpData: op.dataHex,
    memoHex: 'FEAA',
    xrplAddress: USER,
    personalAccount: PA,
    grossXrpDrops: '20000000',
    supplyUBA: '0',
    executorFeeUBA: '200000',
    walletId: 0,
    createdAt: ago(1 * MIN),
    ...over,
  };
}

const build = (over: Partial<BuildDirectMintInput> = {}) =>
  buildDirectMintHandoff(
    fakeProvider,
    {
      xrplAddress: USER,
      grossXrpDrops: 20_000_000n,
      innerCalls: [{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }],
      action: 'pa-unmint',
      ...over,
    },
    { params: PARAMS },
  );

const ENV_KEYS = [
  'HANDOFF_SEAT_TTL_MIN',
  'HANDOFF_REPORTED_SIGNATURE_WINDOW_MIN',
  'ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS',
  'ASTRYUM_ORDER_ANCHOR',
  'LEGACY_ORDER_ANCHOR',
  'MANAGER_CREDENTIAL_ISSUERS',
  'DEMO_EXCHANGE_OMNIBUS_SEED',
] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  jest.clearAllMocks();
  _resetAssetManagerCache();
  _resetMacCache();
  for (const k of ENV_KEYS) delete process.env[k];
  mockQueued.mockResolvedValue([]);
  mockSuperseded.mockResolvedValue(undefined);
  mockSave.mockResolvedValue(true);
  mockMarkSigned.mockResolvedValue(true);
  mockMarkFailed.mockResolvedValue(true);
  mockLedger.mockResolvedValue(null); // filas de it13: sin ventana de ledger
  mockWindow.mockResolvedValue({ state: 'unreadable', detail: 'not asked in these tests' });
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe('buildDirectMintHandoff — a REPORTED signature is not a draft (§1.1)', () => {
  it('reported signed, executor stopped past the TTL, ledger not validated yet → NOT invalidated', async () => {
    const row = await conflictRow({ createdAt: ago(10 * MIN), reportedTxHash: H1, reportedTxHashes: [H1], reportedAt: ago(9 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'pending', detail: 'transaction not validated yet' });

    const err = await build().catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    expect(err.message).toMatch(/^NONCE_SEAT_TAKEN_REPORTED/);
    expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({ memoHex: 'FEAA', xrplAddress: USER }), H1);
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled(); // no twin composed
  });

  it('not even an authorized supersede by its own preparer displaces it', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice', reportedTxHash: H1, reportedAt: ago(1 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'pending', detail: 'transaction not validated yet' });
    await expect(
      build({ supersedePendingNonce: true, supersedeAuthorized: true, preparedByUserId: 'alice' }),
    ).rejects.toThrow(/NONCE_SEAT_TAKEN_REPORTED/);
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('the ledger VALIDATED the reported hash → marked signed now, NONCE_SEAT_TAKEN_SIGNED', async () => {
    const row = await conflictRow({ createdAt: ago(10 * MIN), reportedTxHash: H1, reportedAt: ago(9 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'validated', result: 'tesSUCCESS' });
    await expect(build({ supersedePendingNonce: true, supersedeAuthorized: true })).rejects.toThrow(/^NONCE_SEAT_TAKEN_SIGNED/);
    expect(mockMarkSigned).toHaveBeenCalledWith('FEAA', H1, 'tesSUCCESS');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('an unreadable ledger never retires the seat, however old the report', async () => {
    const row = await conflictRow({ createdAt: ago(61 * MIN), reportedTxHash: H1, reportedAt: ago(60 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'pending', detail: 'ledger read: xrpl_endpoint_stale', unreadable: true });
    await expect(build()).rejects.toThrow(/NONCE_SEAT_TAKEN_REPORTED/);
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a report the ledger still does not know after the window → the normal TTL retires the draft', async () => {
    const row = await conflictRow({ createdAt: ago(21 * MIN), reportedTxHash: H1, reportedAt: ago(20 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'pending', detail: 'ledger read: txnNotFound' });
    await expect(build()).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  it('the window is env-overridable (HANDOFF_REPORTED_SIGNATURE_WINDOW_MIN)', async () => {
    process.env.HANDOFF_REPORTED_SIGNATURE_WINDOW_MIN = '60';
    const row = await conflictRow({ createdAt: ago(21 * MIN), reportedTxHash: H1, reportedAt: ago(20 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'pending', detail: 'ledger read: txnNotFound' });
    await expect(build()).rejects.toThrow(/NONCE_SEAT_TAKEN_REPORTED/);
  });

  it("a reported hash that is somebody else's tx is ignored → the normal TTL", async () => {
    const row = await conflictRow({ createdAt: ago(10 * MIN), reportedTxHash: H1, reportedAt: ago(9 * MIN).toISOString() });
    mockQueued.mockResolvedValue([row]);
    mockVerify.mockResolvedValue({ state: 'mismatch', detail: 'transaction does not carry this handoff memo' });
    await expect(build()).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  it('a row without a report costs no ledger lookup', async () => {
    const row = await conflictRow({ createdAt: ago(10 * MIN) });
    mockQueued.mockResolvedValue([row]);
    await expect(build()).resolves.toBeDefined();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });
});

describe('buildDirectMintHandoff — supersede is not the body’s to decide (§2.1)', () => {
  it('another session, no proof of the account → NONCE_SEAT_TAKEN, the draft stands (ENTRADA)', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    const err = await build({ action: 'e1', supersedePendingNonce: true, preparedByUserId: 'mallory', supersedeAuthorized: false }).catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    expect(err.message).toMatch(/^NONCE_SEAT_TAKEN: /);
    expect(err.message).toContain('whoever prepared it'); // it23 §3.7 — en inglés, como la pantalla
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  // productizer-it21 §P1 1.1 — …Y UNA SALIDA DE UN EXTRAÑO TAMPOCO LA APARTA. La
  // it. 19 abrió esa puerta para que el borrador de quien no prueba nada no
  // tapiara la salida del dueño; pero la etiqueta la fija la RUTA y `xrplAddress`
  // viene del CUERPO, así que servía igual para lo contrario: Mallory pedía
  // `/pa-unmint/prepare` sobre la cuenta de Alice y le apartaba su borrador VIVO,
  // dejándole dos payloads firmables en el mismo nonce (it20 N1 1.1). Apartar algo
  // que todavía puede firmarse exige PROBAR la cuenta.
  it('…y una SALIDA de quien no prueba nada NO aparta la fila viva de otro (it21 §1.1)', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    const err = await build({ action: 'pa-unmint', preparedByUserId: 'mallory' }).catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('…y el dueño PROBADO sí la aparta, con el aviso de que solo se firma una', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    const handoff = await build({ action: 'pa-unmint', preparedByUserId: 'mallory', preparedByProven: true });
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
    expect(handoff.seatWarning).toMatch(/sign only ONE of the two/);
  });

  it('the user who prepared it may supersede it; the new row carries its preparer', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    await expect(build({ supersedePendingNonce: true, preparedByUserId: 'alice' })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ preparedByUserId: 'alice' }));
  });

  it('a session that proved the account (supersedeAuthorized) may supersede a draft by someone else', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    await expect(build({ supersedePendingNonce: true, preparedByUserId: 'bob', supersedeAuthorized: true })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  it('no preparer on either side is never «la misma preparadora» (ENTRADA)', async () => {
    const row = await conflictRow({ preparedByUserId: null });
    mockQueued.mockResolvedValue([row]);
    await expect(build({ action: 'e1', supersedePendingNonce: true, preparedByUserId: null })).rejects.toBeInstanceOf(
      NonceSeatTakenError,
    );
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('without supersede the seat waits, and the message no longer promises that any cancel frees it', async () => {
    const row = await conflictRow({ preparedByUserId: 'alice' });
    mockQueued.mockResolvedValue([row]);
    const err = await build({ action: 'e1', preparedByUserId: 'alice' }).catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    // it23 §Q1 §3.7 — la misma frase, en inglés: es lo que lee la pantalla.
    expect(err.message).toContain('whoever prepared it, or the owning account, cancels it');
    expect(err.message).toContain('it frees itself in 5 min');
    expect(err.message).not.toMatch(/frees itself when it is cancelled/);
  });
});

describe('buildDirectMintHandoff — an operational account only takes Astryum’s own flows (§2.1)', () => {
  beforeEach(() => {
    process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = OMNIBUS;
  });

  it.each([['e1'], ['vault:firelight'], [undefined]])('entry action %s against the omnibus → OperationalAccountHandoffError, before any seat read', async (action) => {
    const err = await build({ xrplAddress: OMNIBUS, action, supersedePendingNonce: true, supersedeAuthorized: true }).catch((e) => e);
    expect(err).toBeInstanceOf(OperationalAccountHandoffError);
    expect(err.message).toMatch(/^OPERATIONAL_ACCOUNT_HANDOFF_REFUSED/);
    expect(mockQueued).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  // it14 §3.4 / contrato C4: LA SALIDA JAMÁS SE GATEA. Un consejo operado por
  // Astryum que estuviera en la lista de entorno recibía 403 en su propia
  // salida. Ahora una etiqueta de salida pasa si la sesión prueba la cuenta.
  it.each([['pa-unmint'], ['astryum-pote-exit'], ['vault-withdraw:firelight']])(
    'EXIT action %s against the omnibus passes when the session proved the account',
    async (action) => {
      await expect(build({ xrplAddress: OMNIBUS, action, preparedByProven: true, attribution: 'operational' })).resolves.toBeDefined();
    },
  );

  it('an EXIT action against the omnibus from a session that proves NOTHING is still refused', async () => {
    const err = await build({ xrplAddress: OMNIBUS, action: 'pa-unmint' }).catch((e) => e);
    expect(err).toBeInstanceOf(OperationalAccountHandoffError);
    expect(mockQueued).not.toHaveBeenCalled();
  });

  it.each([['demo-exchange-desk'], ['demo-exchange-autopilot'], ['anchor-feed']])('%s builds for the operational account', async (action) => {
    const handoff = await build({ xrplAddress: OMNIBUS, action, attribution: 'operational' });
    expect(handoff.xrplPayment.Account).toBe(OMNIBUS);
  });

  it('a user account is unaffected', async () => {
    await expect(build({ action: 'pa-unmint' })).resolves.toBeDefined();
  });
});

describe('classifySeatConflicts — injected ledger verdicts (pure)', () => {
  const now = 1_700_000_000_000;
  const ttl = 5 * MIN;
  const windowMs = 15 * MIN;
  type Row = { id: string; createdAt?: Date; signedAt?: string | null; reportedAt?: string | null };
  const classify = (rows: Row[], verdicts: Record<string, SeatReportVerdict>) =>
    classifySeatConflicts(rows, ttl, now, { verdictOf: (c) => verdicts[c.id], windowMs });
  const at = (msAgo: number) => new Date(now - msAgo);

  it('validated → signed and validatedByLedger, however old', () => {
    const r = { id: 'a', createdAt: at(60 * MIN), reportedAt: at(59 * MIN).toISOString() };
    const out = classify([r], { a: 'validated' });
    expect(out.signed).toEqual([r]);
    expect(out.validatedByLedger).toEqual([r]);
    expect(out.stale).toEqual([]);
  });

  it.each(['pending', 'not-found'] as const)('%s with a young report → reportedInFlight even past the TTL', (verdict) => {
    const r = { id: 'a', createdAt: at(10 * MIN), reportedAt: at(9 * MIN).toISOString() };
    const out = classify([r], { a: verdict });
    expect(out.reportedInFlight).toEqual([r]);
    expect(out.fresh).toEqual([r]);
    expect(out.stale).toEqual([]);
  });

  it('pending with a report older than the window → the TTL decides', () => {
    const r = { id: 'a', createdAt: at(20 * MIN), reportedAt: at(16 * MIN).toISOString() };
    expect(classify([r], { a: 'pending' }).stale).toEqual([r]);
  });

  it('unreadable → reportedInFlight however old', () => {
    const r = { id: 'a', createdAt: at(600 * MIN), reportedAt: at(599 * MIN).toISOString() };
    expect(classify([r], { a: 'unreadable' }).reportedInFlight).toEqual([r]);
  });

  it('mismatch or no verdict → the TTL decides', () => {
    const a = { id: 'a', createdAt: at(10 * MIN), reportedAt: at(9 * MIN).toISOString() };
    const b = { id: 'b', createdAt: at(10 * MIN) };
    expect(classify([a, b], { a: 'mismatch' }).stale).toEqual([a, b]);
  });

  it('a report without a readable time counts from the row itself', () => {
    const young = { id: 'a', createdAt: at(10 * MIN), reportedAt: 'garbage' };
    const old = { id: 'b', createdAt: at(20 * MIN), reportedAt: 'garbage' };
    const out = classify([young, old], { a: 'pending', b: 'pending' });
    expect(out.reportedInFlight).toEqual([young]);
    expect(out.stale).toEqual([old]);
  });

  it('without reports it keeps the it11 buckets (signedAt → signed, never stale)', () => {
    const signed = { id: 's', createdAt: at(60 * MIN), signedAt: at(59 * MIN).toISOString() };
    const draft = { id: 'd', createdAt: at(60 * MIN) };
    const out = classifySeatConflicts([signed, draft], ttl, now);
    expect(out.signed).toEqual([signed]);
    expect(out.fresh).toEqual([signed]);
    expect(out.stale).toEqual([draft]);
  });
});

describe('resolveReportedSignature — folds the ledger answers', () => {
  const rec = { xrplAddress: USER, memoHex: 'FEAA' };

  it('the first validated SUCCESS wins; a mismatching one is skipped', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ state: 'mismatch', detail: 'other account' })
      .mockResolvedValueOnce({ state: 'validated', result: 'tesSUCCESS' });
    expect(await resolveReportedSignature(rec, [H1, H2], verify)).toEqual({
      verdict: 'validated',
      txHash: H2,
      ledgerResult: 'tesSUCCESS',
    });
  });

  // it15 §K1: un tec* validado NO ocupa el asiento — entró en el ledger y no
  // entregó XRP, y FAssets exige status == PAYMENT_SUCCESS para el direct
  // minting. Pero cualquier respuesta que aún pueda volverse firma viva manda.
  it('a validated tec* is «failed», not «validated»', async () => {
    const verify = jest.fn().mockResolvedValue({ state: 'validated', result: 'tecUNFUNDED_PAYMENT' });
    expect(await resolveReportedSignature(rec, [H1], verify)).toEqual({
      verdict: 'failed',
      txHash: H1,
      ledgerResult: 'tecUNFUNDED_PAYMENT',
    });
  });

  it('a tesSUCCESS on another reported hash beats the tec', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ state: 'validated', result: 'tecPATH_DRY' })
      .mockResolvedValueOnce({ state: 'validated', result: 'tesSUCCESS' });
    expect((await resolveReportedSignature(rec, [H1, H2], verify)).verdict).toBe('validated');
  });

  it('a hash still pending beats a tec: the twin could still be alive', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ state: 'validated', result: 'tecDST_TAG_NEEDED' })
      .mockResolvedValueOnce({ state: 'pending', detail: 'transaction not validated yet' });
    expect((await resolveReportedSignature(rec, [H1, H2], verify)).verdict).toBe('pending');
  });

  it('unreadable dominates pending; a verifier that throws is unreadable', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ state: 'pending', detail: 'transaction not validated yet' })
      .mockRejectedValueOnce(new Error('boom'));
    expect((await resolveReportedSignature(rec, [H1, H2], verify)).verdict).toBe('unreadable');
  });

  it('txnNotFound → not-found; not validated → pending; only mismatches (or none) → mismatch', async () => {
    expect((await resolveReportedSignature(rec, [H1], async () => ({ state: 'pending', detail: 'ledger read: txnNotFound' }))).verdict).toBe('not-found');
    expect((await resolveReportedSignature(rec, [H1], async () => ({ state: 'pending', detail: 'transaction not validated yet' }))).verdict).toBe('pending');
    expect((await resolveReportedSignature(rec, [H1], async () => ({ state: 'mismatch', detail: 'x' }))).verdict).toBe('mismatch');
    expect((await resolveReportedSignature(rec, [], async () => ({ state: 'validated', result: 'tesSUCCESS' }))).verdict).toBe('mismatch');
  });
});

describe('NonceSeatTakenError — routes that load the module lazily match on its name', () => {
  it('carries its class name', () => {
    const e = new NonceSeatTakenError('x');
    expect(e.name).toBe('NonceSeatTakenError');
    expect(e).toBeInstanceOf(Error);
  });
});

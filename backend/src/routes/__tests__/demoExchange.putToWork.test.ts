/**
 * The desk put-to-work, end to end on the routes:
 *  - prepare-put-to-work composes the 0xFE SERVER-SIDE (same composer, same
 *    inputs as the institutional prepare) and stores memo / userOpHash / LLS on
 *    the reservation atomically; a failed save frees the seat and answers 503;
 *  - put-to-work/record verifies the hash against the ledger (RECORD_HASH_MISMATCH);
 *  - external-0xfe unblocks a memo-less release without debiting anybody;
 *  - a run store that cannot prove a read answers 503.
 */
import express from 'express';
import request from 'supertest';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC del exchange
// se prueba en clientCredentialGate.test y demoExchange.credentialGate.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import { ethers } from 'ethers';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';
import type { OmnibusTx } from '../../services/demoExchange/OmnibusWatcher';
import type { OmnibusHandoff, ReportedTx } from '../../services/demoExchange/deskPaymentReads';

let mockLedger: number | null = 1000;
let mockWindowTxs: OmnibusTx[] = [];
let mockHandoffByMemo: Record<string, OmnibusHandoff> = {};
let mockTx: ReportedTx = { found: false };
const mockCoreVault = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const mockMemo = 'FE' + 'AB'.repeat(20);
const mockFxrp = '0x' + '1f'.repeat(20);
const mockPote = ethers.getAddress('0x' + '5a'.repeat(20));

jest.mock('../../services/demoExchange/OmnibusWatcher', () => {
  const actual = jest.requireActual('../../services/demoExchange/OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: jest.fn(async () => mockLedger),
    scanOmnibus: jest.fn(async () => []),
    scanOmnibusWindow: jest.fn(async () => mockWindowTxs),
    scanOmnibusWindowUntil: jest.fn(async (_o: string, opts: { stop?: (t: OmnibusTx) => boolean }) => {
      const rows: OmnibusTx[] = [];
      for (const t of mockWindowTxs) {
        rows.push(t);
        if (opts.stop?.(t)) return { rows, match: t };
      }
      return { rows };
    }),
  };
});
jest.mock('../../services/demoExchange/deskPaymentReads', () => ({
  findHandoffByMemo: jest.fn(async (memo: string) => mockHandoffByMemo[memo.toUpperCase()] ?? null),
  readXrplTx: jest.fn(async () => mockTx),
  readCoreVaultAddress: jest.fn(async () => mockCoreVault),
  mintExecutedOnFlare: jest.fn(async () => true),
}));
jest.mock('../../services/demoExchange/DemoRunVerifier', () => ({
  explorerUrl: () => undefined,
  flareProvider: () => ({}),
  readClientFacts: jest.fn(async () => []),
  verifyRun: jest.fn(async (run: DemoRun) => run),
}));
jest.mock('../../services/demoExchange/resolveRunPote', () => ({ resolveRunPote: async () => null }));
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: '' };
    next();
  },
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  class NonceSeatTakenError extends Error {}
  return {
    NonceSeatTakenError,
    readDirectMintParams: jest.fn(async () => ({ fxrpToken: mockFxrp, paymentAddress: mockCoreVault, minFeeUBA: BigInt(0), feeBIPS: BigInt(0), executorFeeUBA: BigInt(100000), granularityUBA: BigInt(1) })),
    computeNetMint: jest.fn((gross: bigint) => ({ grossUBA: gross, mintingFeeUBA: BigInt(20000), executorFeeUBA: BigInt(100000), netToPersonalAccountUBA: gross - BigInt(120000), bufferUBA: BigInt(0), supplyUBA: gross - BigInt(120000) })),
    mintFeeDisclosure: jest.fn(() => ({ mintingFeeXrp: 0.02, executorFeeXrp: 0.1 })),
    // The BUILDER stamps the LastLedgerSequence (validated ledger +
    // `lastLedgerWindow`) on the Payment and hands it back — the seat records the
    // same one. An unreadable ledger gives null and NO LastLedgerSequence.
    buildDirectMintHandoff: jest.fn(async (_p: unknown, input: { xrplAddress: string; grossXrpDrops: bigint; lastLedgerWindow?: number }) => {
      const lls = mockLedger !== null && typeof input.lastLedgerWindow === 'number' ? mockLedger + input.lastLedgerWindow : null;
      return {
        personalAccount: '0x' + '9c'.repeat(20),
        fxrpToken: mockFxrp,
        net: {},
        userOpData: '0xdata',
        userOpHash: '0x' + 'AB'.repeat(32),
        memoHex: mockMemo,
        lastLedgerSequence: lls,
        xrplPayment: {
          TransactionType: 'Payment',
          Account: input.xrplAddress,
          Destination: mockCoreVault,
          Amount: input.grossXrpDrops.toString(),
          Memos: [{ Memo: { MemoData: mockMemo } }],
          ...(lls === null ? {} : { LastLedgerSequence: lls }),
        },
      };
    }),
  };
});
jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  readPoteState: jest.fn(async () => ({ pote: mockPote, name: 'Exchange pote A', symbol: 'exA', shareDecimals: 6, asset: { address: mockFxrp, symbol: 'FXRP', decimals: 6 } })),
}));
jest.mock('../../services/flare/AstryumDepositCapService', () => {
  const actual = jest.requireActual('../../services/flare/AstryumDepositCapService');
  return { ...actual, readDepositHeadroom: jest.fn(async () => null) };
});
jest.mock('../../services/dryRun/DryRunExecutor', () => ({ dryRunRigActive: jest.fn(async () => false) }));
jest.mock('../../config/demoCap', () => ({ checkDemoCap: jest.fn(async () => null) }));
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({ releaseQueuedHandoffByMemo: jest.fn(async () => true) }));
// «¿esta r-address ya es de una persona?». Solo se consulta con
// DATABASE_URL — el resto de esta suite corre sin él, así que este mock duerme.
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: { findFirst: jest.fn(async () => null) },
    walletBinding: { findMany: jest.fn(async () => []) },
  },
}));

import router from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';
import * as Store from '../../services/demoExchange/DemoExchangeStore';
import { _resetDeclaredOmnibusForTests, isDeclaredRunOmnibus } from '../../services/demoExchange/operationalOmnibus';

const { __resetDemoExchangeMemoryForTests, loadRun, saveRun, DemoRunStoreError } = Store;

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const OTHER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const T0 = new Date(0).toISOString();
const HASH = 'C'.repeat(64);
const FE_HASH = 'D'.repeat(64);
const MEMO = mockMemo;

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);
const admin = { 'x-admin-key': 'founder-test-key' };

function seedRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Put to work',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    poteAddress: mockPote,
    createdAt: T0,
    status: 'open',
    clients: [
      { id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', ownerUserId: 'alice', passkeyAccount: PASSKEY, xrpOnExchangeDrops: '2000000', createdAt: T0 },
      { id: 'c2', runId: 'run1', label: 'Bo', tag: 102, kyc: 'none', xrpOnExchangeDrops: '2000000', createdAt: T0 },
    ],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  };
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, key: process.env.ADMIN_PANEL_KEY, emails: process.env.ADMIN_EMAILS };
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_EMAILS;
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.ADMIN_PANEL_KEY = 'founder-test-key';
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_PANEL_KEY', SAVED.key], ['ADMIN_EMAILS', SAVED.emails]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  __resetDemoExchangeMemoryForTests();
  jest.clearAllMocks();
  mockLedger = 1000;
  mockWindowTxs = [];
  mockHandoffByMemo = {};
  mockTx = { found: false };
  await saveRun(seedRun());
});
afterEach(() => {
  jest.restoreAllMocks();
  _resetKeyFailuresForTests();
});

const M = () => jest.requireMock('../../connectors/protocols/flare/FlareDirectMintService') as { buildDirectMintHandoff: jest.Mock; NonceSeatTakenError: new (m: string) => Error };
const S = () => jest.requireMock('../../services/flare/DirectMintHandoffStore') as { releaseQueuedHandoffByMemo: jest.Mock };
const R = () => jest.requireMock('../../services/demoExchange/deskPaymentReads') as { readXrplTx: jest.Mock };
const reserve = (clientId = 'c1', amountXrp = '2') => request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId, kind: 'put-to-work', amountXrp });
const prepare = (id: string, headers: Record<string, string> = admin) => request(app).post(`/api/demo-exchange/runs/run1/desk-payments/${id}/prepare-put-to-work`).set(headers).send({});
const release = (id: string) => request(app).delete(`/api/demo-exchange/runs/run1/desk-payments/${id}`).set(admin);
const record = (body: Record<string, unknown>) => request(app).post('/api/demo-exchange/runs/run1/put-to-work/record').set(admin).send({ clientId: 'c1', drops: '2000000', txHash: HASH, ...body });
const feTx = (memo: string, hash = FE_HASH): OmnibusTx => ({ hash, account: OMNIBUS, destination: mockCoreVault, drops: '2000000', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'out', memoHex: memo, ledgerIndex: 1010 });
const reported = (over: Partial<Extract<ReportedTx, { found: true }>> = {}): ReportedTx => ({ found: true, hash: HASH, validated: true, result: 'tesSUCCESS', type: 'Payment', account: OMNIBUS, destination: mockCoreVault, drops: '2000000', memoHex: MEMO, ledgerIndex: 1010, ...over });

describe('prepare-put-to-work: the 0xFE is composed server-side and its memo lives on the reservation', () => {
  it('stores memo, userOpHash and LastLedgerSequence atomically; the Payment carries the LLS; approve(asset → pote) + deposit(receiver = passkey)', async () => {
    const { body } = await reserve();
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(200);
    expect(res.body.deskPayment).toMatchObject({ memoHex: MEMO, userOpHash: '0x' + 'ab'.repeat(32), lastLedgerSequence: 1090, status: 'prepared' });
    expect(res.body.handoff.xrplPayment).toMatchObject({ Account: OMNIBUS, Destination: mockCoreVault, Amount: '2000000', LastLedgerSequence: 1090 });
    expect(res.body.handoff.disclosure.disclosedToUser).toBe(true);
    expect(res.body.handoff.receiver).toBe(PASSKEY);
    const persisted = (await loadRun('run1'))!.deskPayments![0];
    expect(persisted).toMatchObject({ memoHex: MEMO, lastLedgerSequence: 1090 });

    const call = M().buildDirectMintHandoff.mock.calls[0][1] as { xrplAddress: string; grossXrpDrops: bigint; action: string; innerCalls: Array<{ to: string; calldata: string }> };
    // The omnibus signs it — 'operational', like its payout, never the project tag.
    expect(call).toMatchObject({ xrplAddress: OMNIBUS, action: 'demo-exchange-desk', attribution: 'operational' });
    expect(call).toHaveProperty('preparedByUserId');
    expect(call).not.toHaveProperty('supersedeAuthorized');
    // Esta fila la compuso el SERVIDOR para una
    // cuenta operativa. Sin esta marca el autopilot la apartaba en silencio —
    // dos Payments firmables en el mismo nonce con el XRP ya en el Core Vault.
    expect((call as unknown as { serverComposed?: boolean }).serverComposed).toBe(true);
    expect(call.grossXrpDrops).toBe(BigInt(2000000));
    const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount)']);
    const vault = new ethers.Interface(['function deposit(uint256 assets, address receiver)']);
    expect(call.innerCalls[0].to).toBe(ethers.getAddress(mockFxrp));
    expect(erc20.decodeFunctionData('approve', call.innerCalls[0].calldata)[0]).toBe(mockPote);
    expect(call.innerCalls[1].to).toBe(mockPote);
    expect(vault.decodeFunctionData('deposit', call.innerCalls[1].calldata)[1]).toBe(PASSKEY);
  });

  it('a second prepare of the same reservation → 409 DESK_PAYMENT_ALREADY_PREPARED, never a second 0xFE', async () => {
    const { body } = await reserve();
    expect((await prepare(body.deskPayment.id)).status).toBe(200);
    const again = await prepare(body.deskPayment.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('DESK_PAYMENT_ALREADY_PREPARED');
    expect(M().buildDirectMintHandoff).toHaveBeenCalledTimes(1);
  });

  it('NONCE_SEAT_TAKEN → 409, the reservation stays memo-less', async () => {
    const { body } = await reserve();
    M().buildDirectMintHandoff.mockRejectedValueOnce(new (M().NonceSeatTakenError)('NONCE_SEAT_TAKEN: an earlier 0xFE'));
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NONCE_SEAT_TAKEN');
    expect((await loadRun('run1'))!.deskPayments![0].memoHex).toBeUndefined();
  });

  /**
   * Un ASIENTO QUE NO SE PUDO LEER no es un asiento ocupado.
   * `SeatStateUnreadableError extends NonceSeatTakenError`, así que el `catch`
   * cogía las dos y contestaba 409 «hay un 0xFE anterior en vuelo»: al operador
   * se le contaba un fallo de lectura NUESTRO como un hecho, y sin reintento.
   * Las seis puertas institucionales y `flareDemo` ya lo partían con
   * `seatRefusalStatus`; esta se quedó fuera del barrido.
   */
  it('el estado del asiento ILEGIBLE → 503 reintentable, con su código y sus segundos (nunca 409)', async () => {
    const { body } = await reserve();
    const unreadable = Object.assign(new (M().NonceSeatTakenError)('the seat state could not be read'), {
      unreadableSeatState: true,
      code: 'SEAT_STATE_UNREADABLE',
      retryable: true,
      secondsLeft: 42,
    });
    M().buildDirectMintHandoff.mockRejectedValueOnce(unreadable);
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('SEAT_STATE_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.secondsLeft).toBe(42);
    expect((await loadRun('run1'))!.deskPayments![0].memoHex).toBeUndefined();
  });

  it('el 409 del asiento realmente ocupado conserva su `retryable` y su `secondsLeft`', async () => {
    const { body } = await reserve();
    const taken = Object.assign(new (M().NonceSeatTakenError)('an earlier 0xFE is still in flight'), {
      code: 'NONCE_SEAT_TAKEN',
      retryable: false,
      secondsLeft: 180,
    });
    M().buildDirectMintHandoff.mockRejectedValueOnce(taken);
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NONCE_SEAT_TAKEN');
    expect(res.body.retryable).toBe(false);
    expect(res.body.secondsLeft).toBe(180);
  });

  it('the save cannot be proven → 503 RUN_NOT_PERSISTED, the seat the builder took is released, nothing stored', async () => {
    const { body } = await reserve();
    jest.spyOn(Store, 'saveRun').mockRejectedValueOnce(new DemoRunStoreError('RUN_NOT_PERSISTED', 'read-back mismatch'));
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('RUN_NOT_PERSISTED');
    expect(res.body.detail).toMatch(/nothing was recorded/);
    // The desk's dispatch never left the backend (Astryum's seed signs it),
// so freeing it cannot create a twin and must not wall the omnibus for minutes.
expect(S().releaseQueuedHandoffByMemo).toHaveBeenCalledWith(MEMO, { neverHandedOut: true });
    expect((await loadRun('run1'))!.deskPayments![0].memoHex).toBeUndefined();
  });

  it('founder-only; a client without a Flare account → 409 before anything is composed', async () => {
    const { body } = await reserve();
    const asClient = await prepare(body.deskPayment.id, { 'x-test-user': 'alice', Authorization: 'Bearer t' });
    expect([401, 404]).toContain(asClient.status);
    const bo = await reserve('c2', '1');
    const noAccount = await prepare(bo.body.deskPayment.id);
    expect(noAccount.status).toBe(409);
    expect(noAccount.body.error).toBe('CLIENT_HAS_NO_FLARE_ACCOUNT');
    expect(M().buildDirectMintHandoff).not.toHaveBeenCalled();
  });

  it('releasing a prepared reservation frees its unsigned seat — only once its LastLedgerSequence is past (before: 409 WAIT_FOR_LAST_LEDGER, seat kept)', async () => {
    const { body } = await reserve();
    await prepare(body.deskPayment.id);
    const early = await release(body.deskPayment.id);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('WAIT_FOR_LAST_LEDGER');
    expect(S().releaseQueuedHandoffByMemo).not.toHaveBeenCalled();
    mockLedger = 1101;
    expect((await release(body.deskPayment.id)).status).toBe(200);
    // This dispatch WAS handed to Xaman (the desk signs it there with
// the omnibus key), so it carries no shortcut — the store frees the seat on its own
// reading of the memo's window, the same proof every other door uses.
expect(S().releaseQueuedHandoffByMemo).toHaveBeenCalledWith(MEMO, undefined);
  });
});

describe('put-to-work/record: the hash must BE this movement (RECORD_HASH_MISMATCH)', () => {
  it('another destination, memo, sender, an unvalidated or unknown tx → 409 and nothing debited; the matching one settles once', async () => {
    const { body } = await reserve();
    await prepare(body.deskPayment.id);
    const id = body.deskPayment.id;
    for (const over of [{ destination: OTHER }, { memoHex: 'FE' + '77'.repeat(20) }, { account: OTHER }, { result: 'tecPATH_DRY' }, { drops: '1999999' }]) {
      mockTx = reported(over);
      const res = await record({ deskPaymentId: id });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('RECORD_HASH_MISMATCH');
    }
    // The backend node not showing it (yet) is «not yet visible» — 503, retryable — never «not this client's»
    for (const lagging of [{ found: false } as ReportedTx, reported({ validated: false })]) {
      mockTx = lagging;
      const res = await record({ deskPaymentId: id });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: 'RECORD_NOT_YET_VISIBLE', retryable: true });
      expect(res.body.detail).toMatch(/reservation is untouched/);
    }
    let run = (await loadRun('run1'))!;
    expect(run.clients[0].xrpOnExchangeDrops).toBe('2000000');
    expect(run.deskPayments![0].status).toBe('prepared');

    mockTx = reported();
    const ok = await record({ deskPaymentId: id });
    expect(ok.status).toBe(201);
    run = (await loadRun('run1'))!;
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.deskPayments![0]).toMatchObject({ status: 'settled', txHash: HASH });
    expect(run.deskPayments![0].closedBy).toMatch(/verified on the ledger/);
    const dup = await record({ deskPaymentId: id });
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);
  });

  it('without a reservation: only the memo of a hand-off for this omnibus, these drops and this client', async () => {
    const memo2 = 'FE' + '22'.repeat(20);
    mockTx = reported({ memoHex: memo2, drops: '1000000' });
    mockHandoffByMemo[memo2] = { memoHex: memo2, userOpHash: '0x' + '11'.repeat(32), grossXrpDrops: '1000000', userOpData: '0xbeef', xrplAddress: OMNIBUS, status: 'queued', createdAt: T0 };
    const wrong = await record({ drops: '1000000' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.reason).toMatch(/receiver/);
    mockHandoffByMemo[memo2] = { ...mockHandoffByMemo[memo2], userOpData: `0x00${PASSKEY.slice(2).toLowerCase()}00` };
    expect((await record({ drops: '1000000' })).status).toBe(201);
    expect((await loadRun('run1'))!.clients[0].xrpOnExchangeDrops).toBe('1000000');
  });

  it('the ledger cannot be read → 503 RECORD_UNVERIFIABLE, nothing debited', async () => {
    R().readXrplTx.mockRejectedValueOnce(new Error('xrpl_http_502'));
    const res = await record({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('RECORD_UNVERIFIABLE');
    expect((await loadRun('run1'))!.clients[0].xrpOnExchangeDrops).toBe('2000000');
  });
});

describe('external-0xfe: an omnibus 0xFE that is not a client movement stops blocking releases', () => {
  const mark = (txHash: string, note = 'treasury top-up signed by the exchange ops team') => request(app).post('/api/demo-exchange/runs/run1/desk-payments/external-0xfe').set(admin).send({ txHash, note });
  const OTHER_MEMO = 'FE' + '99'.repeat(20);

  it('blocked memo-less release → mark external (verified, NOTE receipt, nothing debited) → released', async () => {
    const { body } = await reserve();
    mockWindowTxs = [feTx(OTHER_MEMO)];
    const blocked = await release(body.deskPayment.id);
    expect(blocked.body.error).toBe('DESK_PAYMENT_UNACCOUNTED_ON_LEDGER');
    mockTx = reported({ hash: FE_HASH, memoHex: OTHER_MEMO });
    const marked = await mark(FE_HASH);
    expect(marked.status).toBe(201);
    let run = (await loadRun('run1'))!;
    expect(run.externalFe).toHaveLength(1);
    expect(run.receipts.some((r) => r.step === 'NOTE' && (r.note ?? '').includes(FE_HASH))).toBe(true);
    expect(run.clients.map((c) => c.xrpOnExchangeDrops)).toEqual(['2000000', '2000000']);
    expect((await release(body.deskPayment.id)).status).toBe(200);
    run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('released');
  });

  it('a reason is required; not an omnibus 0xFE → 409; a hash the run already accounts for → 409', async () => {
    expect((await mark(FE_HASH, '  ')).status).toBe(400);
    mockTx = reported({ hash: FE_HASH, memoHex: undefined });
    expect((await mark(FE_HASH)).body.error).toBe('NOT_AN_OMNIBUS_0XFE');
    mockTx = reported({ hash: FE_HASH, account: OTHER, memoHex: OTHER_MEMO });
    expect((await mark(FE_HASH)).body.error).toBe('NOT_AN_OMNIBUS_0XFE');
    const run = (await loadRun('run1'))!;
    run.appliedTxHashes.push(`out:${FE_HASH}`);
    await saveRun(run);
    mockTx = reported({ hash: FE_HASH, memoHex: OTHER_MEMO });
    expect((await mark(FE_HASH)).body.error).toBe('EXTERNAL_0XFE_IS_ACCOUNTED');
  });

  it('it. 12 (2.5): a 0xFE whose hand-off names ANY client\'s Flare account (or was composed by the exchange), or that another run on this omnibus records → 409, nothing marked', async () => {
    mockTx = reported({ hash: FE_HASH, memoHex: OTHER_MEMO });
    const base = { memoHex: OTHER_MEMO, userOpHash: '0x' + '99'.repeat(32), grossXrpDrops: '2000000', xrplAddress: OMNIBUS, status: 'executed', createdAt: T0 };
    // a legacy 0xFE naming Alice's account — no record of the run explains it
    mockHandoffByMemo[OTHER_MEMO] = { ...base, userOpData: `0xabcd${PASSKEY.slice(2).toLowerCase()}ef`, action: 'e1' };
    let res = await mark(FE_HASH);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EXTERNAL_0XFE_IS_A_CLIENT_MINT');
    expect(res.body.detail).toMatch(/Alice/);
    // composed by the exchange (the autopilot), whoever it names
    mockHandoffByMemo[OTHER_MEMO] = { ...base, userOpData: '0xbeef', action: 'demo-exchange-autopilot' };
    expect((await mark(FE_HASH)).body.error).toBe('EXTERNAL_0XFE_IS_A_CLIENT_MINT');
    // a hand-off for another account, naming nobody: not a client mint of this omnibus
    mockHandoffByMemo[OTHER_MEMO] = { ...base, userOpData: `0x${PASSKEY.slice(2).toLowerCase()}`, xrplAddress: OTHER, action: 'e1' };
    delete mockHandoffByMemo[OTHER_MEMO];
    // another run on the same omnibus holds a request with this memo
    await saveRun({ ...seedRun(), runId: 'run2', seq: 2, label: 'Other take', clients: [], requests: [{ id: 'rq9', kind: 'put-to-work', clientId: 'x', drops: '1', status: 'signed', memoHex: OTHER_MEMO, createdAt: T0, updatedAt: T0 }] });
    res = await mark(FE_HASH);
    expect(res.body.error).toBe('EXTERNAL_0XFE_IS_ACCOUNTED');
    expect(res.body.detail).toMatch(/Other take/);
    expect((await loadRun('run1'))!.externalFe ?? []).toHaveLength(0);
    // the hand-off store unreadable → 503, nothing marked
    R().readXrplTx.mockResolvedValueOnce(reported({ hash: FE_HASH, memoHex: 'FE' + '12'.repeat(20) }));
    const D = jest.requireMock('../../services/demoExchange/deskPaymentReads') as { findHandoffByMemo: jest.Mock };
    D.findHandoffByMemo.mockRejectedValueOnce(new Error('pooler down'));
    expect((await mark(FE_HASH)).status).toBe(503);
  });
});

describe('the window of the 0xFE is the BUILDER\'s, and the desk never re-stamps one (it. 14, R1 1.1)', () => {
  it('asks for the put-to-work window and keeps exactly the LastLedgerSequence the builder handed back', async () => {
    const { body } = await reserve();
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(200);
    const call = M().buildDirectMintHandoff.mock.calls[0][1] as { lastLedgerWindow?: number };
    // 90 ledgers ≈ 6 min — la vida del payload de Xaman (5 min)
    // más un minuto de margen; antes eran 100 y el asiento del omnibus se
    // congelaba ~1,7 min después de que ya nadie pudiera firmar.
    expect(call.lastLedgerWindow).toBe(90);
    // The seat, the reservation and the Payment the desk hands to Xaman: one window.
    expect(res.body.handoff.lastLedgerSequence).toBe(1090);
    expect(res.body.handoff.xrplPayment.LastLedgerSequence).toBe(1090);
    expect((await loadRun('run1'))!.deskPayments![0].lastLedgerSequence).toBe(1090);
  });

  /**
   * El 0xFE de la mesa dice si el servidor ENTREGA
   * su instrucción. Sin este campo, el aviso de firmas en curso tenía que
   * adivinar, y un «entrega parada» permanente que nadie puede desmentir es
   * ruido. El payout de la mesa NO lo lleva: es un Payment XRP nativo, que no
   * entrega ningún executor — decirlo allí sería un aviso falso nuevo.
   */
  it.each([
    ['true', true],
    ['false', false],
    ['', false],
  ])('el hand-off dice si el executor de este servidor está en marcha (FLARE_EXECUTOR_ENABLED=%s)', async (flag, expected) => {
    const saved = process.env.FLARE_EXECUTOR_ENABLED;
    try {
      if (flag === '') delete process.env.FLARE_EXECUTOR_ENABLED;
      else process.env.FLARE_EXECUTOR_ENABLED = flag;
      const res = await prepare((await reserve('c1', '1')).body.deskPayment.id);
      expect(res.status).toBe(200);
      expect(res.body.handoff.serverDelivery).toEqual({ executorEnabled: expected });
    } finally {
      if (saved === undefined) delete process.env.FLARE_EXECUTOR_ENABLED;
      else process.env.FLARE_EXECUTOR_ENABLED = saved;
    }
  });

  it('a 0xFE composed WITHOUT a window (the ledger could not be read) is never handed out: 503 and the seat is freed', async () => {
    const { body } = await reserve();
    M().buildDirectMintHandoff.mockResolvedValueOnce({
      personalAccount: '0x' + '9c'.repeat(20),
      fxrpToken: mockFxrp,
      net: {},
      userOpData: '0xdata',
      userOpHash: '0x' + 'AB'.repeat(32),
      memoHex: MEMO,
      lastLedgerSequence: null,
      xrplPayment: { TransactionType: 'Payment', Account: OMNIBUS, Destination: mockCoreVault, Amount: '2000000' },
    });
    const res = await prepare(body.deskPayment.id);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('LEDGER_UNREADABLE');
    // The desk's dispatch never left the backend (Astryum's seed signs it),
// so freeing it cannot create a twin and must not wall the omnibus for minutes.
expect(S().releaseQueuedHandoffByMemo).toHaveBeenCalledWith(MEMO, { neverHandedOut: true });
    expect((await loadRun('run1'))!.deskPayments![0].memoHex).toBeUndefined();
  });
});

describe('the 0xFE memo of what is in flight is the exchange\'s, not the public\'s (it. 14, R1 1.2)', () => {
  it('a non-operator read of the run (the client who owns the row) serves the reservation without its memo / userOpHash; the founder desk sees both', async () => {
    const { body } = await reserve();
    expect((await prepare(body.deskPayment.id)).status).toBe(200);

    const anon = await request(app).get('/api/demo-exchange/runs/run1').set({ 'x-test-user': 'alice', Authorization: 'Bearer t' });
    expect(anon.status).toBe(200);
    expect(anon.body.run.deskPayments[0].id).toBe(body.deskPayment.id);
    expect(anon.body.run.deskPayments[0].memoHex).toBeUndefined();
    expect(anon.body.run.deskPayments[0].userOpHash).toBeUndefined();
    // what it IS allowed to know: that the reservation exists and until when
    expect(anon.body.run.deskPayments[0].lastLedgerSequence).toBe(1090);

    const desk = await request(app).get('/api/demo-exchange/runs/run1').set(admin);
    expect(desk.body.run.deskPayments[0].memoHex).toBe(MEMO);
    expect(desk.body.run.deskPayments[0].userOpHash).toBe('0x' + 'ab'.repeat(32));
  });

  it('a client request in flight never serves its memo to a public read either', async () => {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rq1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'submitting', txHash: HASH, memoHex: MEMO, userOpHash: '0x' + 'ab'.repeat(32), createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    const anon = await request(app).get('/api/demo-exchange/runs/run1').set({ 'x-test-user': 'alice', Authorization: 'Bearer t' });
    expect(anon.body.run.requests[0].status).toBe('submitting');
    expect(anon.body.run.requests[0].memoHex).toBeUndefined();
    expect(anon.body.run.requests[0].userOpHash).toBeUndefined();
    expect((await request(app).get('/api/demo-exchange/runs/run1').set(admin)).body.run.requests[0].memoHex).toBe(MEMO);
  });
});

describe('The run DECLARES its omnibus, and the 0xFE seat guard is told (R5 5.1)', () => {
  /**
   * Demanded the omnibus already be in `ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS`
   * before a run could exist — a Railway variable nobody can edit from the setup
   * wizard, so the sign-up died at its last station (R5 5.1). The route
   * is admin-only: the declaration IS the authorization. What the env list used
   * to buy (the 0xFE nonce-seat guard covering the account) now comes from the
   * declaration itself, registered with the builder.
   */
  const ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
  const FRESH = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
  const create = (omnibusAddress: string, councilAddress = ROOT) =>
    request(app).post('/api/demo-exchange/runs').set(admin).send({ councilAddress, omnibusAddress });

  // Nothing declared by the environment: only the run's own declaration decides.
  const OPERATIONAL_ENV = ['ASTRYUM_ORDER_ANCHOR', 'LEGACY_ORDER_ANCHOR', 'MANAGER_CREDENTIAL_ISSUERS', 'ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS', 'DEMO_EXCHANGE_OMNIBUS_SEED'] as const;
  const savedEnv: Partial<Record<(typeof OPERATIONAL_ENV)[number], string | undefined>> = {};
  beforeAll(() => {
    for (const k of OPERATIONAL_ENV) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterAll(() => {
    for (const k of OPERATIONAL_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => _resetDeclaredOmnibusForTests());

  it('a fresh r-address this deployment never heard of is accepted — and the seat guard covers it from that instant', async () => {
    expect(await isDeclaredRunOmnibus(FRESH)).toBe(false);
    const res = await create(FRESH, 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm');
    expect(res.status).toBe(201);
    expect(res.body.run.omnibusAddress).toBe(FRESH);
    // The declaration is persisted on the run, so a restart rebuilds it…
    expect((await loadRun(res.body.run.runId))!.omnibusAddress).toBe(FRESH);
    // …and it is live NOW, without waiting for the next snapshot.
    expect(await isDeclaredRunOmnibus(FRESH)).toBe(true);
    // A stranger's account is still not covered — the guard is a list, not a door.
    expect(await isDeclaredRunOmnibus('rNoBodyKnowsThisOneAtAllxxxxxxxxx')).toBe(false);
  });

  it('the omnibus of the seeded run is read back from the store, with no env list at all', async () => {
    _resetDeclaredOmnibusForTests();
    expect(await isDeclaredRunOmnibus(OMNIBUS)).toBe(true);
  });

  it('the omnibus may not be the council root of this run, nor of another exchange', async () => {
    const same = await create(ROOT, ROOT);
    expect(same.status).toBe(409);
    expect(same.body.error).toBe('OMNIBUS_IS_THE_COUNCIL');

    // run1 (seeded) is governed by ROOT: declaring it as somebody else's omnibus
    // would put that root under the seat guard and lock it out of its own 0xFE.
    const stolen = await create(ROOT, OTHER);
    expect(stolen.status).toBe(409);
    expect(stolen.body.error).toBe('OMNIBUS_IS_ANOTHER_COUNCIL');
  });

  it("an address already on file as a client's own XRPL wallet is never taken as an omnibus", async () => {
    const run = (await loadRun('run1'))!;
    run.clients[0].xrplAddress = FRESH;
    await saveRun(run);
    const res = await create(FRESH, OTHER);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('OMNIBUS_IS_A_CLIENT_WALLET');
  });

  /**
   * …NI LA CUENTA DE UNA PERSONA REAL. Las negativas de arriba
   * miran las runs; esta mira a los usuarios. Declarar la r-address de un
   * tercero la pondría bajo la guarda del 0xFE de la mesa: sus hand-offs
   * pasarían a leerse como flujos nuestros y una salida suya sin prueba
   * recibiría 403 — una cuenta ajena neutralizada desde un formulario de alta.
   *
   * La comprobación solo existe donde hay usuarios (`DATABASE_URL`), así que
   * estos casos la encienden alrededor de la petición: la negativa ocurre ANTES
   * del candado de las runs, de modo que el almacén no llega a tocarse.
   */
  describe('Ni la cuenta de una persona real (3.5)', () => {
    const P = () => jest.requireMock('../../database/prismaClient') as { prisma: { user: { findFirst: jest.Mock }; walletBinding: { findMany: jest.Mock } } };
    const withDb = async <T>(fn: () => Promise<T>): Promise<T> => {
      process.env.DATABASE_URL = 'postgres://omnibus-ownership-test';
      try {
        return await fn();
      } finally {
        delete process.env.DATABASE_URL;
      }
    };
    beforeEach(() => {
      P().prisma.user.findFirst.mockReset().mockResolvedValue(null);
      P().prisma.walletBinding.findMany.mockReset().mockResolvedValue([]);
    });

    /**
     * «DE ALGUIEN» NO ES «DE OTRO». La comprobación compara contra
     * una sesión OPCIONAL, así que sin sesión cualquier fila coincidente contaba
     * como de un tercero: el propio fundador declarando SU ómnibus desde un script
     * (o con la cookie de admin a secas, que no acuña `req.siwe`) recibía un 409
     * que no se podía accionar. Se sigue negando — declarar la cuenta de otro es
     * irreversible — pero con el código que dice la verdad y pide lo que falta.
     */
    const createAs = (user: string, omnibusAddress: string, councilAddress = OTHER) =>
      request(app)
        .post('/api/demo-exchange/runs')
        .set(admin)
        .set('Authorization', 'Bearer test')
        .set('x-test-user', user)
        .send({ councilAddress, omnibusAddress });

    it('la wallet de login de otro usuario (User.xrplAddress), CON sesión de un tercero → 409, y nada se crea', async () => {
      P().prisma.user.findFirst.mockResolvedValue({ id: 'someone-else' });
      const res = await withDb(() => createAs('me', FRESH));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OMNIBUS_IS_A_USER_ACCOUNT');
      expect(res.body.detail).toMatch(/the XRPL account of an Astryum user/);
      expect(await isDeclaredRunOmnibus(FRESH)).toBe(false);
    });

    it('la misma dirección, SIN sesión → 409 que dice que no puede atribuirla, no que sea de otro', async () => {
      P().prisma.user.findFirst.mockResolvedValue({ id: 'someone-else' });
      const res = await withDb(() => create(FRESH, OTHER));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OMNIBUS_OWNER_UNKNOWN');
      expect(res.body.detail).toMatch(/no Astryum session/);
      // La negativa dice QUÉ falta y que esperar no arregla nada —
      // una sesión de admin prueba que operas el despliegue, no que la cuenta sea tuya.
      expect(res.body.needs).toBe('astryum-session');
      expect(res.body.sessionState).toBe('no-session-presented');
      expect(res.body.retryable).toBe(false);
      expect(await isDeclaredRunOmnibus(FRESH)).toBe(false);
    });

    it('y con la sesión de SU DUEÑO la misma dirección pasa la regla (el alta legítima deja de estar tapiada)', async () => {
      P().prisma.user.findFirst.mockResolvedValue({ id: 'me' });
      const res = await withDb(() => createAs('me', FRESH));
      // (con DATABASE_URL puesta el almacén real no contesta, así que lo que se
      // afirma es que ESTA puerta ya no es la que para: ninguno de sus códigos.)
      expect(res.body.error).not.toBe('OMNIBUS_IS_A_USER_ACCOUNT');
      expect(res.body.error).not.toBe('OMNIBUS_OWNER_UNKNOWN');
    });

    it('una binding activa y FIRMADA de otro usuario → 409 (probó que controla esa cuenta)', async () => {
      P().prisma.walletBinding.findMany.mockResolvedValue([{ userId: 'someone-else' }]);
      const res = await withDb(() => createAs('me', FRESH));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('OMNIBUS_IS_A_USER_ACCOUNT');
      expect(res.body.detail).toMatch(/bound by signature to an Astryum user/);
      // …y se pregunta por lo que prueba: activa, xrpl y con firma guardada.
      expect(P().prisma.walletBinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ address: FRESH, chainType: 'xrpl', isActive: true }) }),
      );
    });

    it('si la tabla no se puede leer, el alta NO pasa: 503, nunca «no es de nadie»', async () => {
      P().prisma.user.findFirst.mockRejectedValue(new Error('pooler down'));
      const res = await withDb(() => create(FRESH, OTHER));
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('OMNIBUS_OWNERSHIP_UNREADABLE');
      expect(await isDeclaredRunOmnibus(FRESH)).toBe(false);
    });

    it('una r-address que no es de nadie no la para esta regla', async () => {
      const res = await withDb(() => create(FRESH, OTHER));
      expect(res.body.error).not.toBe('OMNIBUS_IS_A_USER_ACCOUNT');
      expect(res.body.error).not.toBe('OMNIBUS_OWNERSHIP_UNREADABLE');
    });
  });
});

describe('the run store refuses to guess', () => {
  it('a run that cannot be read → 503 RUN_UNREADABLE (never a stale copy)', async () => {
    jest.spyOn(Store, 'loadRun').mockRejectedValueOnce(new DemoRunStoreError('RUN_UNREADABLE', 'pooler down'));
    const res = await request(app).get('/api/demo-exchange/runs/run1').set(admin);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('RUN_UNREADABLE');
  });

  /**
   * LA LISTA QUE NO SE PUEDE LEER TAMPOCO ES UN 500. Desde la
   * lectura estricta de la, `listRuns` lanzaba el error crudo de Prisma y
   * `guarded` (que solo mapea `DemoRunStoreError`) lo convertía en un 500: un muro
   * sin reintento en las cinco rutas que listan. Ahora es de la misma familia que
   * `loadRun` — 503, `retryable`, y una frase que no dice que se intentara escribir.
   */
  it('una lista que no se puede leer → 503 RUN_UNREADABLE reintentable, jamás 500', async () => {
    jest.spyOn(Store, 'listRuns').mockRejectedValueOnce(new DemoRunStoreError('RUN_UNREADABLE', 'pooler down'));
    const res = await request(app).get('/api/demo-exchange/runs').set(admin);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('RUN_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/nothing was changed; try again/);
  });

  it('y una escritura que no se pudo probar sigue diciendo que nada se registró', async () => {
    jest.spyOn(Store, 'loadRun').mockRejectedValueOnce(new DemoRunStoreError('RUN_NOT_PERSISTED', 'read-back mismatch'));
    const res = await request(app).get('/api/demo-exchange/runs/run1').set(admin);
    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/nothing was recorded; try again/);
  });
});

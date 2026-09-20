/**
 * deskPaymentProof — a reservation closes by chain facts.
 *  - proveDeskPayouts: a prepared payout past its LLS is read EXHAUSTIVELY over
 *    its window; >400 rows, found → settled + debited by the reservation's
 *    client; absent → proven; unreadable → kept;
 *  - judgePutToWork: matches ONLY the stored memo; memo-less → only unexplained 0xFE block;
 *  - putToWorkWindow: always bounded;
 *  - judgePutToWorkRecord: the recorded hash must be this movement;
 *  - attributeKnownPayouts: a payout whose hash a withdraw record carries is
 *    that record's client's, whoever holds the wallet today.
 */
jest.mock('../OmnibusWatcher', () => {
  const actual = jest.requireActual('../OmnibusWatcher');
  return { ...actual, scanOmnibusWindow: jest.fn(), scanOmnibusWindowUntil: jest.fn(), currentValidatedLedgerIndex: jest.fn(async () => 1300) };
});
jest.mock('../deskPaymentReads', () => ({ findHandoffByMemo: jest.fn(async () => null), mintExecutedOnFlare: jest.fn(async () => true) }));
jest.mock('../DemoRunVerifier', () => ({ explorerUrl: () => undefined, flareProvider: () => ({}) }));

import type { DemoRun, DeskPayment } from '../DemoExchangeStore';
import type { ClassifiedTx, OmnibusTx } from '../OmnibusWatcher';
import type { OmnibusHandoff, ReportedTx } from '../deskPaymentReads';
import { applyPayoutProofs, judgePutToWork, judgePutToWorkRecord, provePutToWorkRelease, proveDeskPayouts, putToWorkStop, putToWorkWindow, PUT_TO_WORK_SEARCH_WINDOW } from '../deskPaymentProof';
import { attributeKnownPayouts } from '../DemoExchangeSync';

const { scanOmnibusWindow, scanOmnibusWindowUntil } = jest.requireMock('../OmnibusWatcher') as { scanOmnibusWindow: jest.Mock; scanOmnibusWindowUntil: jest.Mock };
const { findHandoffByMemo } = jest.requireMock('../deskPaymentReads') as { findHandoffByMemo: jest.Mock };

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const OTHER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const CORE_VAULT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const T0 = new Date(0).toISOString();
const PAYOUT_HASH = 'A'.repeat(64);
const MEMO = 'FE' + '11'.repeat(20);

function run(over: Partial<DemoRun> = {}): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'proof',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [
      { id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', passkeyAccount: PASSKEY, xrplAddress: WALLET, xrpOnExchangeDrops: '3000000', createdAt: T0 },
      { id: 'c2', runId: 'run1', label: 'Bo', tag: 102, kyc: 'none', xrplAddress: OTHER, xrpOnExchangeDrops: '5000000', createdAt: T0 },
    ],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
    ...over,
  };
}

const rows = (n: number): OmnibusTx[] =>
  Array.from({ length: n }, (_, i) => ({ hash: i.toString(16).padStart(64, '0').toUpperCase(), account: OTHER, destination: OMNIBUS, drops: '1', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'in' as const, ledgerIndex: 1050 }));
const payout = (over: Partial<OmnibusTx> = {}): OmnibusTx => ({ hash: PAYOUT_HASH, account: OMNIBUS, destination: WALLET, drops: '2000000', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'out', ledgerIndex: 1080, lastLedgerSequence: 1100, ...over });
const prepared = (over: Partial<DeskPayment> = {}): DeskPayment => ({ id: 'dp1', kind: 'withdraw', clientId: 'c1', drops: '2000000', status: 'prepared', lastLedgerSequence: 1100, createdAtLedger: 1000, destination: WALLET, createdAt: T0, updatedAt: T0, ...over });

beforeEach(() => {
  scanOmnibusWindow.mockReset();
  scanOmnibusWindowUntil.mockReset();
  findHandoffByMemo.mockClear();
});

describe('proveDeskPayouts', () => {
  it('600 rows, the payout at row 450 → settled and debited ONCE to the reservation client', async () => {
    const r = run({ deskPayments: [prepared()] });
    const history = rows(600);
    history.splice(450, 0, payout());
    scanOmnibusWindow.mockResolvedValue(history);
    const proofs = await proveDeskPayouts(r, 1200);
    expect(scanOmnibusWindow).toHaveBeenCalledWith(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 });
    expect(proofs.settled).toEqual(['dp1']);
    expect(proofs.provenAbsent.size).toBe(0);
    expect(r.deskPayments![0]).toMatchObject({ status: 'settled', txHash: PAYOUT_HASH });
    expect(r.clients[0].xrpOnExchangeDrops).toBe('1000000');
    await proveDeskPayouts(r, 1200);
    expect(r.clients[0].xrpOnExchangeDrops).toBe('1000000');
  });

  it('600 rows without it (or only a failed attempt) → proven absent, nothing debited', async () => {
    const r = run({ deskPayments: [prepared()] });
    scanOmnibusWindow.mockResolvedValue([...rows(600), payout({ result: 'tecUNFUNDED_PAYMENT' })]);
    const proofs = await proveDeskPayouts(r, 1101);
    expect([...proofs.provenAbsent]).toEqual(['dp1']);
    expect(r.deskPayments![0].status).toBe('prepared');
    expect(r.deskPayments![0].closedBy).toMatch(/601 omnibus txs .*1 failed on the ledger/);
    expect(r.clients[0].xrpOnExchangeDrops).toBe('3000000');
  });

  it('the fingerprint is destination + drops + LastLedgerSequence: another LLS or another wallet is not it', async () => {
    const r = run({ deskPayments: [prepared()] });
    scanOmnibusWindow.mockResolvedValue([payout({ lastLedgerSequence: 1099 }), payout({ destination: OTHER, hash: 'B'.repeat(64) })]);
    expect([...(await proveDeskPayouts(r, 1101)).provenAbsent]).toEqual(['dp1']);
  });

  it('unreadable window → kept (no proof, no settle); not past its LLS → not even read', async () => {
    const r = run({ deskPayments: [prepared()] });
    scanOmnibusWindow.mockRejectedValueOnce(new Error('OMNIBUS_WINDOW_NOT_EXHAUSTED'));
    const proofs = await proveDeskPayouts(r, 1101);
    expect(proofs.unreadable).toHaveLength(1);
    expect(proofs.provenAbsent.size).toBe(0);
    scanOmnibusWindow.mockClear();
    await proveDeskPayouts(r, 1100);
    expect(scanOmnibusWindow).not.toHaveBeenCalled();
  });

  it('a legacy reservation without createdAtLedger reads [LLS-100, LLS]', async () => {
    const r = run({ deskPayments: [prepared({ createdAtLedger: undefined })] });
    scanOmnibusWindow.mockResolvedValue([]);
    await proveDeskPayouts(r, 1101);
    expect(scanOmnibusWindow).toHaveBeenCalledWith(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 });
  });
});

describe('ApplyPayoutProofs — proofs read on a snapshot, applied to a fresh copy (2.6b)', () => {
  it('landed → settled + debited once on the fresh copy; absent → proven with its closedBy', async () => {
    const snapshot = run({ deskPayments: [prepared(), prepared({ id: 'dp2', clientId: 'c2', destination: OTHER, lastLedgerSequence: 1090 })] });
    scanOmnibusWindow.mockImplementation(async (_o: string, opts: { ledgerIndexMax: number }) => (opts.ledgerIndexMax === 1100 ? [payout()] : []));
    const proofs = await proveDeskPayouts(snapshot, 1200);
    const fresh = run({ deskPayments: [prepared(), prepared({ id: 'dp2', clientId: 'c2', destination: OTHER, lastLedgerSequence: 1090 })] });
    const applied = applyPayoutProofs(fresh, proofs);
    expect(applied.settled).toEqual(['dp1']);
    expect([...applied.provenAbsent]).toEqual(['dp2']);
    expect(fresh.deskPayments![0]).toMatchObject({ status: 'settled', txHash: PAYOUT_HASH });
    expect(fresh.clients[0].xrpOnExchangeDrops).toBe('1000000');
    expect(fresh.deskPayments![1].closedBy).toMatch(/absent/);
  });

  it('a reservation that changed meanwhile (hash reported, released, another LLS) keeps its state', async () => {
    const snapshot = run({ deskPayments: [prepared(), prepared({ id: 'dp2', lastLedgerSequence: 1090 })] });
    scanOmnibusWindow.mockImplementation(async (_o: string, opts: { ledgerIndexMax: number }) => (opts.ledgerIndexMax === 1100 ? [payout()] : []));
    const proofs = await proveDeskPayouts(snapshot, 1200);
    const fresh = run({ deskPayments: [prepared({ status: 'released' }), prepared({ id: 'dp2', lastLedgerSequence: 1090, txHash: 'B'.repeat(64), status: 'signed' })] });
    const applied = applyPayoutProofs(fresh, proofs);
    expect(applied.settled).toEqual([]);
    expect(applied.provenAbsent.size).toBe(0);
    expect(fresh.clients[0].xrpOnExchangeDrops).toBe('3000000');
  });
});

const mint = (over: Partial<DeskPayment> = {}): DeskPayment => ({ id: 'dpm', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'prepared', createdAtLedger: 1000, createdAt: T0, updatedAt: T0, ...over });
const withMemo = (over: Partial<DeskPayment> = {}) => mint({ memoHex: MEMO, userOpHash: '0x' + '22'.repeat(32), lastLedgerSequence: 1100, ...over });
const fe = (memo: string, hash = 'E'.repeat(64), over: Partial<OmnibusTx> = {}): OmnibusTx => ({ hash, account: OMNIBUS, destination: CORE_VAULT, drops: '2000000', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'out', memoHex: memo, ledgerIndex: 1010, ...over });
const ho = (over: Partial<OmnibusHandoff> = {}): OmnibusHandoff => ({ memoHex: MEMO, userOpHash: '0x' + '22'.repeat(32), grossXrpDrops: '2000000', userOpData: '0xdead' + PASSKEY.slice(2).toLowerCase(), xrplAddress: OMNIBUS, action: 'demo-exchange-desk', status: 'queued', createdAt: T0, ...over });
const open = { min: 1000, max: 1050, closed: false, lastLedgerSequence: 1100 };
const closed = { min: 1000, max: 1100, closed: true, lastLedgerSequence: 1100 };
/** A memo-less / legacy window: no LastLedgerSequence to wait for. */
const openNoLls = { min: 1000, max: 1050, closed: false };

describe('putToWorkWindow — always bounded', () => {
  it('with memo + LLS: [createdAtLedger, min(validated, LLS)], closed once validated > LLS', () => {
    expect(putToWorkWindow(run(), withMemo(), 1050)).toEqual({ min: 1000, max: 1050, closed: false, lastLedgerSequence: 1100 });
    expect(putToWorkWindow(run(), withMemo(), 90_000)).toEqual({ min: 1000, max: 1100, closed: true, lastLedgerSequence: 1100 });
  });
  it('memo-less (or legacy memo without LLS): capped at createdAtLedger + PUT_TO_WORK_SEARCH_WINDOW, never closed', () => {
    expect(putToWorkWindow(run(), mint(), 90_000)).toMatchObject({ min: 1000, max: 1000 + PUT_TO_WORK_SEARCH_WINDOW, closed: false });
    expect(putToWorkWindow(run(), mint({ memoHex: MEMO }), 90_000)).toMatchObject({ max: 1000 + PUT_TO_WORK_SEARCH_WINDOW, closed: false });
  });
  it('no lower bound on file → null (unprovable, never unbounded)', () => {
    expect(putToWorkWindow(run(), mint({ createdAtLedger: undefined }), 1050)).toBeNull();
  });
});

describe('judgePutToWork (pure)', () => {
  it('with memo: only that memo lands it — an unrelated 0xFE (even one nobody explains) does not block once its LLS is past', () => {
    const v = judgePutToWork({ run: run(), p: withMemo(), rows: [fe('FE' + '33'.repeat(20))], handoff: ho(), window: closed });
    expect(v.kind).toBe('release');
  });

  it('With memo + LLS and the window OPEN, a hand-off NOT reported signed is never released — wait for the LLS (the phone may still sign it)', () => {
    const v = judgePutToWork({ run: run(), p: withMemo(), rows: [fe('FE' + '33'.repeat(20))], handoff: ho(), window: open });
    expect(v).toMatchObject({ kind: 'wait', lastLedgerSequence: 1100, ledgersLeft: 51, secondsLeft: 204 });
    expect((v as { detail: string }).detail).toMatch(/until XRPL ledger 1100 .*≈ 204 s/);
    // at the LLS itself: still one ledger to go
    expect(judgePutToWork({ run: run(), p: withMemo(), rows: [], handoff: null, window: { ...open, max: 1100 } })).toMatchObject({ kind: 'wait', ledgersLeft: 1 });
    // a legacy memo without LLS keeps today's behaviour (nothing to wait for)
    expect(judgePutToWork({ run: run(), p: withMemo({ lastLedgerSequence: undefined }), rows: [], handoff: ho(), window: openNoLls }).kind).toBe('release');
  });

  it('with memo: its 0xFE on the ledger → executed with its memo and userOpHash', () => {
    const v = judgePutToWork({ run: run(), p: withMemo(), rows: [fe(MEMO)], handoff: ho(), window: open });
    expect(v).toMatchObject({ kind: 'executed', memoHex: MEMO, userOpHash: '0x' + '22'.repeat(32) });
  });

  it('with memo: a hand-off reported signed and not on the ledger blocks before the LLS, not after', () => {
    const signed = ho({ signedAt: T0, signedTxHash: 'F'.repeat(64) });
    expect(judgePutToWork({ run: run(), p: withMemo(), rows: [], handoff: signed, window: open }).kind).toBe('signed-off-ledger');
    const past = judgePutToWork({ run: run(), p: withMemo(), rows: [], handoff: signed, window: { min: 1000, max: 1100, closed: true, lastLedgerSequence: 1100 } });
    expect(past).toMatchObject({ kind: 'release' });
    expect((past as { proof: string }).proof).toMatch(/can never land/);
  });

  it('memo-less: an unexplained 0xFE blocks; one marked external, a request memo or a non-0xFE payment does not', () => {
    const unknown = fe('FE' + '44'.repeat(20));
    expect(judgePutToWork({ run: run(), p: mint(), rows: [unknown], handoff: null, window: openNoLls })).toMatchObject({ kind: 'unaccounted', hashes: [unknown.hash] });
    const marked = run({ externalFe: [{ txHash: unknown.hash, note: 'ops', markedAt: T0 }] });
    expect(judgePutToWork({ run: marked, p: mint(), rows: [unknown], handoff: null, window: openNoLls }).kind).toBe('release');
    const byRequest = run({ requests: [{ id: 'rq', kind: 'put-to-work', clientId: 'c2', drops: '1', status: 'signed', memoHex: 'FE' + '44'.repeat(20), createdAt: T0, updatedAt: T0 }] });
    expect(judgePutToWork({ run: byRequest, p: mint(), rows: [unknown], handoff: null, window: openNoLls }).kind).toBe('release');
    expect(judgePutToWork({ run: run(), p: mint(), rows: [fe('0A0B')], handoff: null, window: openNoLls }).kind).toBe('release');
  });

  it('putToWorkStop stops only at the answer: the memo (with memo), an unexplained 0xFE (without)', () => {
    expect(putToWorkStop(run(), withMemo())(fe('FE' + '44'.repeat(20)))).toBe(false);
    expect(putToWorkStop(run(), withMemo())(fe(MEMO))).toBe(true);
    expect(putToWorkStop(run(), withMemo())(fe(MEMO, 'E'.repeat(64), { result: 'tecPATH_DRY' }))).toBe(false);
    expect(putToWorkStop(run(), mint())(fe('FE' + '44'.repeat(20)))).toBe(true);
  });
});

describe('provePutToWorkRelease (live wrapper)', () => {
  it('past the LLS the hand-off store is not read; the window is [createdAtLedger, LLS]', async () => {
    scanOmnibusWindowUntil.mockResolvedValue({ rows: [] });
    const v = await provePutToWorkRelease(run(), withMemo());
    expect(v.kind).toBe('release');
    expect(scanOmnibusWindowUntil).toHaveBeenCalledWith(OMNIBUS, expect.objectContaining({ ledgerIndexMin: 1000, ledgerIndexMax: 1100 }));
    expect(findHandoffByMemo).not.toHaveBeenCalled();
  });

  it('a window that cannot be read → unreadable, never release', async () => {
    scanOmnibusWindowUntil.mockRejectedValueOnce(new Error('OMNIBUS_WINDOW_NOT_EXHAUSTED'));
    expect((await provePutToWorkRelease(run(), mint())).kind).toBe('unreadable');
  });
});

describe('judgePutToWorkRecord (pure)', () => {
  const tx = (over: Partial<Extract<ReportedTx, { found: true }>> = {}): ReportedTx => ({ found: true, hash: 'C'.repeat(64), validated: true, result: 'tesSUCCESS', type: 'Payment', account: OMNIBUS, destination: CORE_VAULT, drops: '2000000', memoHex: MEMO, ledgerIndex: 1010, ...over });
  const judge = (over: Partial<Parameters<typeof judgePutToWorkRecord>[0]> = {}) =>
    judgePutToWorkRecord({ run: run(), clientId: 'c1', drops: '2000000', tx: tx(), coreVault: CORE_VAULT, reservation: withMemo(), handoff: null, ...over });

  it('the omnibus → Core Vault payment with the reservation memo is this movement', () => {
    expect(judge()).toEqual({ ok: true, memoHex: MEMO });
  });

  /**
   * The first 0xFE of Charles was never signed and its
   * reservation was RELEASED on the ledger's proof; the second one, same client
   * and amount, carried the SAME memo (the omnibus PA nonce never advanced) and
   * its record was refused as «another record's» — 13 XRP left the omnibus and
   * nobody was debited.
   */
  it('a RELEASED reservation with the same memo does not own it: the new, real 0xFE is recorded', () => {
    const released = withMemo({ id: 'dpOld', status: 'released', closedBy: 'absent: … can never land' });
    const r = run({ deskPayments: [released, withMemo({ id: 'dpNew' })] });
    expect(judge({ run: r, reservation: r.deskPayments![1] })).toEqual({ ok: true, memoHex: MEMO });
  });

  it('…but a reservation still OPEN with that memo keeps owning it (a real duplicate stays refused)', () => {
    const r = run({ deskPayments: [withMemo({ id: 'dpOther', status: 'signed', txHash: 'D'.repeat(64) }), withMemo({ id: 'dpNew' })] });
    const verdict = judge({ run: r, reservation: r.deskPayments![1] });
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/already belongs to another record/);
  });

  it.each([
    ['not validated', { tx: tx({ validated: false }) }],
    ['another sender', { tx: tx({ account: OTHER }) }],
    ['not to the Core Vault', { tx: tx({ destination: WALLET }) }],
    ['other drops', { tx: tx({ drops: '1' }) }],
    ['another memo', { tx: tx({ memoHex: 'FE' + '55'.repeat(20) }) }],
    ['not found', { tx: { found: false } as ReportedTx }],
  ])('%s → mismatch', (_label, over) => {
    expect(judge(over as Partial<Parameters<typeof judgePutToWorkRecord>[0]>).ok).toBe(false);
  });

  it('Not found / not validated on the backend node is RETRYABLE (a lagging node), a real mismatch is not', () => {
    expect(judge({ tx: { found: false } })).toMatchObject({ ok: false, retryable: true });
    expect(judge({ tx: tx({ validated: false }) })).toMatchObject({ ok: false, retryable: true });
    for (const over of [{ account: OTHER }, { destination: WALLET }, { drops: '1' }, { memoHex: 'FE' + '55'.repeat(20) }, { result: 'tecPATH_DRY' }]) {
      const v = judge({ tx: tx(over) });
      expect(v.ok).toBe(false);
      expect((v as { retryable?: boolean }).retryable).toBeUndefined();
    }
  });

  it('without a reservation memo: needs the hand-off for this omnibus, drops and receiver; a memo another record holds is never this client\'s', () => {
    expect(judge({ reservation: undefined, handoff: null }).ok).toBe(false);
    expect(judge({ reservation: undefined, handoff: ho({ userOpData: '0xbeef' }) }).ok).toBe(false);
    expect(judge({ reservation: undefined, handoff: ho({ grossXrpDrops: '1' }) }).ok).toBe(false);
    expect(judge({ reservation: undefined, handoff: ho() }).ok).toBe(true);
    const taken = run({ deskPayments: [withMemo({ id: 'other', clientId: 'c2' })] });
    expect(judge({ run: taken, reservation: undefined, handoff: ho() }).ok).toBe(false);
  });
});

describe('attributeKnownPayouts', () => {
  it('a payout whose hash a withdraw request carries is debited to that client even if the wallet now belongs to another', () => {
    const r = run({ requests: [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '2000000', status: 'submitting', txHash: PAYOUT_HASH, createdAt: T0, updatedAt: T0 }] });
    const classified: ClassifiedTx[] = [{ ...payout(), kind: 'withdraw', clientId: 'c2' }];
    attributeKnownPayouts(r, classified);
    expect(classified[0]).toMatchObject({ kind: 'withdraw', clientId: 'c1' });
  });

  it('never a failed or pre-frontier payment', () => {
    const r = run({ sinceLedgerIndex: 1500, deskPayments: [prepared({ status: 'signed', txHash: PAYOUT_HASH })] });
    const classified: ClassifiedTx[] = [{ ...payout(), kind: 'other' }];
    attributeKnownPayouts(r, classified);
    expect(classified[0].kind).toBe('other');
    const failed: ClassifiedTx[] = [{ ...payout({ ledgerIndex: 1600, result: 'tecNO_DST' }), kind: 'other' }];
    attributeKnownPayouts(r, failed);
    expect(failed[0].kind).toBe('other');
  });
});

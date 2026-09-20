/**
 * §1 — the executor's daily fee-spend ledger (the tope born from the 244-repay incident)
 * SURVIVES a redeploy. In RAM it reset on every deploy → the guard was "120 FLR per
 * process life", not per day. Here the shared bg-kv is mocked with an in-memory store to
 * prove: write-through on recordFeeSpend → wipe (simulated restart) → loadFeeLedger()
 * restores the accrued spend; and a >24h-stale window resets on load.
 */
const store = new Map<string, Record<string, unknown>>();
/** it. 29 — when set, the DB read THROWS (Postgres down), as `kvGetStrict` does. */
let dbDown = false;
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (jobType: string, _kf: string, key: string) => store.get(`${jobType}:${key}`) ?? null),
  kvGetStrict: jest.fn(async (jobType: string, _kf: string, key: string) => {
    if (dbDown) throw new Error("Can't reach database server");
    return store.get(`${jobType}:${key}`) ?? null;
  }),
  kvUpsert: jest.fn(async (jobType: string, _kf: string, key: string, payload: Record<string, unknown>) => {
    store.set(`${jobType}:${key}`, payload);
  }),
  kvDelete: jest.fn(async (jobType: string, _kf: string, key: string) => {
    store.delete(`${jobType}:${key}`);
  }),
}));

jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { ethers } from 'ethers';
import {
  recordFeeSpend,
  feeBudgetStatus,
  loadFeeLedger,
  assertDailyFeeBudget,
  FeeBudgetExceeded,
  FeeLedgerUnreadable,
  _resetFeeLedgerForTests,
} from '../ExecutorFuelService';

const FLR = (n: string) => ethers.parseEther(n);
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store.clear();
  dbDown = false;
  _resetFeeLedgerForTests();
});

it('accrued fee spend SURVIVES a simulated redeploy (persist → reset → load)', async () => {
  recordFeeSpend(FLR('40'), T0); // write-through persists the ledger
  expect(feeBudgetStatus(T0).spentFLR).toBe('40.0');

  _resetFeeLedgerForTests(); // simulate a redeploy — in-memory wiped
  expect(feeBudgetStatus(T0).spentFLR).toBe('0.0');

  await loadFeeLedger(T0); // boot restores from the DB
  expect(feeBudgetStatus(T0).spentFLR).toBe('40.0'); // survived the restart
});

it('a persisted window >24h stale resets to a fresh one on load', async () => {
  recordFeeSpend(FLR('40'), T0);
  _resetFeeLedgerForTests();
  await loadFeeLedger(T0 + DAY + 1); // load a full day later
  expect(feeBudgetStatus(T0 + DAY + 1).spentFLR).toBe('0.0'); // fresh window, not stale spend
});

it('loadFeeLedger is idempotent (a second call does not double-count)', async () => {
  recordFeeSpend(FLR('20'), T0);
  _resetFeeLedgerForTests();
  await loadFeeLedger(T0);
  await loadFeeLedger(T0);
  expect(feeBudgetStatus(T0).spentFLR).toBe('20.0');
});

/**
 * it. 29 — THE LEDGER IS NOT «LOADED» BEFORE IT IS READ.
 *
 * `loadFeeLedger` used to set `feeLedgerLoaded = true` BEFORE the `await`, and
 * read through `kvGet`, which answers `null` for «no row» and for «Postgres
 * failed» alike. One DB blink at boot = `spentWei` 0 and the whole 120 FLR/day
 * budget restored for the life of the process, with no retry and no log — the
 * 244-repay incident through another door. These pin the chain: a failed read
 * (d) does not mark the ledger loaded, (e) does not restore the budget — every
 * payment is DEFERRED with a retryable refusal — and (f) heals by itself the
 * moment the database answers, with the persisted spend intact.
 */
describe('it. 29 · a ledger we could not read is not a blank ledger', () => {
  it('(d) a DB failure at boot leaves the ledger UNLOADED and the next load retries', async () => {
    recordFeeSpend(FLR('100'), T0); // persisted: 100 of 120 already spent today
    _resetFeeLedgerForTests(); // redeploy

    dbDown = true;
    await loadFeeLedger(T0); // must not throw (boot continues) — and must not mark loaded
    dbDown = false;
    await loadFeeLedger(T0); // the retry actually reads
    expect(feeBudgetStatus(T0).spentFLR).toBe('100.0'); // «loaded» was not sealed by the failure
  });

  it('(e) while unread, NOTHING is paid: the budget is deferred, never restored to 120', async () => {
    recordFeeSpend(FLR('100'), T0);
    _resetFeeLedgerForTests();
    dbDown = true;
    await loadFeeLedger(T0);

    // Before: spentWei 0 → 20 FLR fits under a 120 FLR cap that was never real.
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).toThrow(FeeLedgerUnreadable);
    // Same family as «budget exhausted»: callers DEFER, they do not park or count.
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).toThrow(FeeBudgetExceeded);
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).toThrow(/no se pudo leer/);
  });

  it('(f) it heals alone: once the DB answers, the guard sees the REAL spend, not zero', async () => {
    recordFeeSpend(FLR('100'), T0);
    _resetFeeLedgerForTests();
    dbDown = true;
    await loadFeeLedger(T0);
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).toThrow(FeeLedgerUnreadable);

    dbDown = false;
    // The guard itself fires the retry (fire-and-forget); let it settle.
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).toThrow(FeeLedgerUnreadable);
    await new Promise((r) => setImmediate(r));

    expect(feeBudgetStatus(T0).spentFLR).toBe('100.0');
    // 100 + 20 = 120 fits exactly; 100 + 21 does not — the ledger is REAL again.
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).not.toThrow();
    expect(() => assertDailyFeeBudget(FLR('21'), T0)).toThrow(FeeBudgetExceeded);
    expect(() => assertDailyFeeBudget(FLR('21'), T0)).not.toThrow(FeeLedgerUnreadable);
  });

  it('without a database there is nothing to fail: a fresh window, as before', async () => {
    await loadFeeLedger(T0); // store empty, DB «answers» null
    expect(() => assertDailyFeeBudget(FLR('20'), T0)).not.toThrow();
  });
});

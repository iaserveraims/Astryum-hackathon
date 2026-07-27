/**
 * §1 — the executor's daily fee-spend ledger (the tope born from the 244-repay incident)
 * SURVIVES a redeploy. In RAM it reset on every deploy → the guard was "120 FLR per
 * process life", not per day. Here the shared bg-kv is mocked with an in-memory store to
 * prove: write-through on recordFeeSpend → wipe (simulated restart) → loadFeeLedger()
 * restores the accrued spend; and a >24h-stale window resets on load.
 */
const store = new Map<string, Record<string, unknown>>();
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (jobType: string, _kf: string, key: string) => store.get(`${jobType}:${key}`) ?? null),
  kvUpsert: jest.fn(async (jobType: string, _kf: string, key: string, payload: Record<string, unknown>) => {
    store.set(`${jobType}:${key}`, payload);
  }),
  kvDelete: jest.fn(async (jobType: string, _kf: string, key: string) => {
    store.delete(`${jobType}:${key}`);
  }),
}));

import { ethers } from 'ethers';
import {
  recordFeeSpend,
  feeBudgetStatus,
  loadFeeLedger,
  _resetFeeLedgerForTests,
} from '../ExecutorFuelService';

const FLR = (n: string) => ethers.parseEther(n);
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store.clear();
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

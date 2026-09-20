/**
 * FeeBudgetExceeded is NOT a failure (doctrine «LA SALIDA JAMÁS SE GATEA»).
 *
 * The daily FDC fee budget refuses BEFORE signing the attestation: nothing is spent and
 * the user's signed bytes are executable. Counting that as a failure parked the 0xFE
 * after FLARE_EXECUTOR_MAX_FAILURES (~9 h of backoff) while the budget window is 24 h —
 * a configured policy holding signed capital (exits included) until a founder unparks.
 *
 * Real class, no RPC, no DB (without DATABASE_URL the store helpers are no-ops — same
 * harness as DirectMintExecutorService.unstick.test.ts). The alert channel is stubbed
 * so the dedup can be counted.
 */
const mockAlert = jest.fn(async () => undefined);
jest.mock('../ExecutorFuelService', () => {
  const actual = jest.requireActual('../ExecutorFuelService');
  return { ...actual, executorAlert: (...a: unknown[]) => mockAlert(...(a as [])) };
});

import { DirectMintExecutorWatcher, ExecutorAbort, type PendingRow } from '../DirectMintExecutorService';
import { FeeBudgetExceeded } from '../ExecutorFuelService';

const ORIGINAL = { ...process.env };

function row(hash: string): PendingRow {
  return {
    hash,
    opcode: 'FE',
    account: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
    drops: 500_000n,
    dateISO: new Date().toISOString(),
    used: false,
    memoHex: 'FE'.padEnd(84, '0'),
  };
}

const budgetError = () =>
  new FeeBudgetExceeded('presupuesto diario de fees FDC agotado (120/80 FLR efectivos) — no se paga');

beforeEach(() => {
  process.env = { ...ORIGINAL };
  delete process.env.DATABASE_URL;
  delete process.env.FLARE_EXECUTOR_SKIP_TXS;
  delete process.env.FLARE_EXECUTOR_PK;
  delete process.env.FLARE_EXECUTOR_FEE_BUDGET_RETRY_MIN;
  process.env.FLARE_EXECUTOR_MAX_FAILURES = '3';
  mockAlert.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = ORIGINAL;
});

describe('FeeBudgetExceeded — deferred, never counted, never parked', () => {
  it('N budget refusals (N ≫ FLARE_EXECUTOR_MAX_FAILURES) leave the 0xFE pending, not parked', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('A'.repeat(64));
    for (let i = 0; i < 25; i++) {
      expect(await w.handleAttemptError(r, budgetError())).toBe('deferred');
    }
    expect((await w.listStuck()).parked).toHaveLength(0);
    expect(w.health().parked).toHaveLength(0);
    // The failure counter never moved.
    expect(w.health().failingTxCount).toBe(0);
  });

  it('defers the retry a few minutes out (default 5), not every tick', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('B'.repeat(64));
    const before = Date.now();
    await w.handleAttemptError(r, budgetError());
    const notBefore = (w as unknown as { nextAttemptAt: Map<string, number> }).nextAttemptAt.get(r.hash)!;
    expect(notBefore).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(notBefore).toBeLessThan(before + 6 * 60_000);

    process.env.FLARE_EXECUTOR_FEE_BUDGET_RETRY_MIN = '2';
    const before2 = Date.now();
    await w.handleAttemptError(r, budgetError());
    const notBefore2 = (w as unknown as { nextAttemptAt: Map<string, number> }).nextAttemptAt.get(r.hash)!;
    expect(notBefore2).toBeGreaterThanOrEqual(before2 + 2 * 60_000);
    expect(notBefore2).toBeLessThan(before2 + 3 * 60_000);
  });

  it('ONE deduplicated alert per episode, however many txs and refusals', async () => {
    const w = new DirectMintExecutorWatcher();
    for (let i = 0; i < 10; i++) {
      await w.handleAttemptError(row('C'.repeat(64)), budgetError());
      await w.handleAttemptError(row('D'.repeat(64)), budgetError());
    }
    const waitingAlerts = mockAlert.mock.calls.filter(
      (c) => (c as unknown[])[2] && ((c as unknown[])[2] as { key?: string }).key === 'fee-budget:signed-waiting',
    );
    expect(waitingAlerts).toHaveLength(1);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(String((waitingAlerts[0] as unknown[])[1])).toMatch(/FIRMADAS esperando al presupuesto/);
  });

  it('a budget refusal does not reset (nor add to) failures a tx already had', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('E'.repeat(64));
    expect(await w.handleAttemptError(r, new Error('rpc down'))).toBe('backoff'); // 1/3
    for (let i = 0; i < 10; i++) await w.handleAttemptError(r, budgetError());
    expect(w.health().failingTxCount).toBe(1);
    expect(await w.handleAttemptError(r, new Error('rpc down'))).toBe('backoff'); // 2/3
    expect((await w.listStuck()).parked).toHaveLength(0);
  });
});

describe('the other two paths are untouched', () => {
  it('a plain Error still counts and parks at FLARE_EXECUTOR_MAX_FAILURES', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('F'.repeat(64));
    expect(await w.handleAttemptError(r, new Error('boom'))).toBe('backoff');
    expect(await w.handleAttemptError(r, new Error('boom'))).toBe('backoff');
    expect(await w.handleAttemptError(r, new Error('boom'))).toBe('parked');
    const { parked } = await w.listStuck();
    expect(parked).toHaveLength(1);
    expect(parked[0].reason).toMatch(/tope de 3 fallos/);
  });

  it('ExecutorAbort permanent still parks at once', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('0'.repeat(64));
    const abort = new ExecutorAbort('nonce consumido', { permanent: true });
    expect(await w.handleAttemptError(r, abort)).toBe('parked');
    expect((await w.listStuck()).parked).toHaveLength(1);
  });

  it('a non-permanent ExecutorAbort is a counted failure, as before', async () => {
    const w = new DirectMintExecutorWatcher();
    const r = row('1'.repeat(64));
    expect(await w.handleAttemptError(r, new ExecutorAbort('la ronda FDC no finalizó'))).toBe('backoff');
    expect(w.health().failingTxCount).toBe(1);
  });
});

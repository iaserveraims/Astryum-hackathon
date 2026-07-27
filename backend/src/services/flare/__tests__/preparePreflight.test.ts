/**
 * preparePreflight — invariant #11's "simulation before signature" verdicts.
 * Proves the three postures: a PROVEN failure (revert / Compound code / XRPL
 * engine result) ⇒ willSucceed=false with the reason; a batch-dependent step
 * is 'unverified', NEVER a false negative; and any simulator problem degrades
 * to available=false without ever throwing (a preflight must not break prepare).
 */
import { ethers } from 'ethers';

const simulateTransaction = jest.fn();
jest.mock('../../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { simulateTransaction: (tx: unknown) => simulateTransaction(tx) },
}));

import {
  mergePreflights,
  preflightEvmCalls,
  preflightXrplPayment,
  type EvmPreflightCall,
} from '../preparePreflight';

const coder = ethers.AbiCoder.defaultAbiCoder();
const CALL = (over: Partial<EvmPreflightCall> = {}): EvmPreflightCall => ({
  to: '0x' + '11'.repeat(20),
  data: '0xc5ebeaec' + '00'.repeat(32),
  label: 'borrow USDT0',
  ...over,
});

function fakeProvider(impl: (tx: { to?: string; data?: string }) => Promise<string>) {
  return { call: impl } as unknown as ethers.JsonRpcProvider;
}

describe('preflightEvmCalls — proven verdicts only', () => {
  it('all calls simulate clean ⇒ available + willSucceed', async () => {
    const p = fakeProvider(async () => coder.encode(['uint256'], [0]));
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [CALL({ compoundErrorCode: true })]);
    expect(r).toMatchObject({ available: true, willSucceed: true });
    expect(r.steps).toEqual([{ label: 'borrow USDT0', verdict: 'ok' }]);
  });

  it('a REVERT (e.g. insufficient balance) ⇒ willSucceed=false with the decoded reason', async () => {
    const p = fakeProvider(async () => {
      throw Object.assign(new Error('call revert'), {
        code: 'CALL_EXCEPTION',
        reason: 'ERC20: transfer amount exceeds balance',
      });
    });
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [CALL({ label: 'supply FXRP' })]);
    expect(r.available).toBe(true);
    expect(r.willSucceed).toBe(false);
    expect(r.reason).toMatch(/supply FXRP — ERC20: transfer amount exceeds balance/);
  });

  it('a Kinetic RETURNED error code (no revert!) is still a failure — TOKEN_INSUFFICIENT_CASH', async () => {
    const p = fakeProvider(async () => coder.encode(['uint256'], [14]));
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [CALL({ compoundErrorCode: true })]);
    expect(r.willSucceed).toBe(false);
    expect(r.reason).toMatch(/TOKEN_INSUFFICIENT_CASH/);
  });

  it('enterMarkets returns uint[] — code 0 is clean', async () => {
    const p = fakeProvider(async () => coder.encode(['uint256[]'], [[0]]));
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [
      CALL({ label: 'enterMarkets', compoundErrorCode: true }),
    ]);
    expect(r).toMatchObject({ available: true, willSucceed: true });
  });

  it('a dependsOnPrior step is UNVERIFIED, never a false negative — even if it would revert today', async () => {
    const p = fakeProvider(async (tx) => {
      if (tx.data?.startsWith('0x095ea7b3')) return '0x' + '00'.repeat(31) + '01'; // approve ok
      throw Object.assign(new Error('would revert without the approve'), { code: 'CALL_EXCEPTION' });
    });
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [
      CALL({ label: 'approve FXRP', data: '0x095ea7b3' + '00'.repeat(64) }),
      CALL({ label: 'supply FXRP', dependsOnPrior: true }),
    ]);
    expect(r.willSucceed).toBe(true);
    expect(r.steps).toEqual([
      { label: 'approve FXRP', verdict: 'ok' },
      expect.objectContaining({ label: 'supply FXRP', verdict: 'unverified' }),
    ]);
  });

  it('NOTHING verifiable (every step depends on the batch) ⇒ available=false, honestly', async () => {
    const p = fakeProvider(async () => '0x');
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [
      CALL({ dependsOnPrior: true }),
      CALL({ dependsOnPrior: true }),
    ]);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/cannot|no step/i);
  });

  it('a TRANSPORT error (node down) ⇒ available=false, never a throw', async () => {
    const p = fakeProvider(async () => {
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'NETWORK_ERROR' });
    });
    const r = await preflightEvmCalls(p, '0x' + 'aa'.repeat(20), [CALL()]);
    expect(r.available).toBe(false);
    expect(r.willSucceed).toBe(false);
    expect(r.reason).toMatch(/dry-run unavailable/);
  });
});

describe('preflightXrplPayment — the council posture', () => {
  const PAYMENT = { TransactionType: 'Payment', Destination: 'rVault', Amount: '1000000' };

  it('tesSUCCESS ⇒ willSucceed=true and the Account is pinned into the simulation', async () => {
    simulateTransaction.mockResolvedValueOnce({ available: true, willSucceed: true, engineResult: 'tesSUCCESS', balanceChanges: [] });
    const r = await preflightXrplPayment(PAYMENT, 'rSigner');
    expect(r).toMatchObject({ available: true, willSucceed: true });
    expect(simulateTransaction).toHaveBeenCalledWith(expect.objectContaining({ Account: 'rSigner' }));
  });

  it('tecUNFUNDED_PAYMENT ⇒ willSucceed=false with the engine result as reason', async () => {
    simulateTransaction.mockResolvedValueOnce({
      available: true,
      willSucceed: false,
      engineResult: 'tecUNFUNDED_PAYMENT',
      engineResultMessage: 'Insufficient XRP balance to send.',
      balanceChanges: [],
    });
    const r = await preflightXrplPayment(PAYMENT, 'rSigner');
    expect(r.willSucceed).toBe(false);
    expect(r.reason).toMatch(/tecUNFUNDED_PAYMENT/);
  });

  it('a node without `simulate` ⇒ available=false (never blocks the prepare)', async () => {
    simulateTransaction.mockResolvedValueOnce({ available: false, willSucceed: false, engineResultMessage: 'unknownCmd', balanceChanges: [] });
    const r = await preflightXrplPayment(PAYMENT, 'rSigner');
    expect(r.available).toBe(false);
  });

  it('a thrown transport error ⇒ available=false (never a throw)', async () => {
    simulateTransaction.mockRejectedValueOnce(new Error('socket hang up'));
    const r = await preflightXrplPayment(PAYMENT, 'rSigner');
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/dry-run unavailable/);
  });
});

describe('mergePreflights — one verdict for a two-rail hand-off', () => {
  const ok = { available: true, willSucceed: true, steps: [{ label: 'a', verdict: 'ok' as const }] };
  const fail = { available: true, willSucceed: false, reason: 'boom', steps: [{ label: 'b', verdict: 'fail' as const }] };
  const down = { available: false, willSucceed: false, reason: 'node down' };

  it('any available failing part fails the whole', () => {
    expect(mergePreflights(ok, fail)).toMatchObject({ available: true, willSucceed: false, reason: 'boom' });
  });
  it('a blind leg NEVER hides behind the other leg’s green — the verdict is PARTIAL and names it (escaneo #4)', () => {
    const merged = mergePreflights(down, ok);
    expect(merged).toMatchObject({ available: true, willSucceed: true, partial: true });
    expect(merged.reason).toMatch(/parcial/);
    expect(merged.reason).toMatch(/node down/);
  });
  it('a blind leg plus a PROVEN failure keeps the failure as the reason, still partial', () => {
    expect(mergePreflights(down, fail)).toMatchObject({
      available: true,
      willSucceed: false,
      partial: true,
      reason: 'boom',
    });
  });
  it('a full merge with every leg simulated is NOT partial', () => {
    expect(mergePreflights(ok, ok).partial).toBeUndefined();
  });
  it('all parts unavailable ⇒ unavailable', () => {
    expect(mergePreflights(down, down)).toMatchObject({ available: false });
  });
  it('steps concatenate in order', () => {
    expect(mergePreflights(ok, fail).steps).toHaveLength(2);
  });
});

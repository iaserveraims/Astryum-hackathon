/**
 * batch-evm — the two money bugs left in `sendIntentCalls`, and
 * the wiring nobody had ever EXECUTED.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  account: { address: '0xowner', isConnected: true, connector: { name: 'MetaMask' } } as {
    address?: string;
    isConnected: boolean;
    connector?: { name?: string; icon?: string };
  },
  chainId: 14,
  sendTransactionAsync: vi.fn(),
  sendCallsAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  /** null = this chain has NO receipt reader (getPublicClient returned nothing). */
  publicClient: null as null | { waitForTransactionReceipt: (a: { hash: string }) => Promise<unknown> },
  connectOpened: 0,
}));

// The hook's only React dependency is useCallback; identity makes it callable
// outside a render without pulling in a DOM.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useCallback: (fn: unknown) => fn };
});
vi.mock('wagmi', () => ({
  useAccount: () => h.account,
  useChainId: () => h.chainId,
  useConfig: () => ({ mock: true }),
  useSendTransaction: () => ({ sendTransactionAsync: h.sendTransactionAsync }),
  useSwitchChain: () => ({ switchChainAsync: h.switchChainAsync }),
}));
vi.mock('wagmi/experimental', () => ({
  useSendCalls: () => ({ sendCallsAsync: h.sendCallsAsync }),
}));
vi.mock('@wagmi/core', () => ({ getPublicClient: () => h.publicClient }));
vi.mock('../appkit', () => ({
  getAppKitModal: () => ({
    open: () => {
      h.connectOpened += 1;
    },
  }),
}));

import { isBatchUnsupported, useWalletPartner } from '../useWalletPartner';
import { inFlightInfo, isPartialExecution, isReceiptUnread } from '../inFlightError';
import { signFailureAction, signOutcome } from '../signOutcome';

const HASH1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
const HASH2 = '0x2222222222222222222222222222222222222222222222222222222222222222';
const HASH3 = '0x3333333333333333333333333333333333333333333333333333333333333333';

const CALLS = [
  { to: '0xaaaa', data: '0xapprove', value: '0', chainId: 14 },
  { to: '0xbbbb', data: '0xsupply', value: '0', chainId: 14 },
];

const en = (s: string) => s;
// Calling the hook outside React IS the technique here: `useCallback` is mocked
// to identity above, so the shipping closures can be driven directly.
// eslint-disable-next-line react-hooks/rules-of-hooks
const partner = () => useWalletPartner();

/** A receipt reader that answers per hash: a status, or 'unreadable'. */
function reader(map: Record<string, 'success' | 'reverted' | 'unreadable'>) {
  return {
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
      const verdict = map[hash];
      if (!verdict || verdict === 'unreadable') throw new Error('timed out while waiting');
      return { status: verdict, transactionHash: hash };
    },
  };
}

/** The wallet hands back a hash per call, in order. */
function sendsHashes(...hashes: string[]) {
  let i = 0;
  h.sendTransactionAsync.mockImplementation(async () => hashes[i++]);
}

beforeEach(() => {
  h.account = { address: '0xowner', isConnected: true, connector: { name: 'MetaMask' } };
  h.chainId = 14;
  h.publicClient = null;
  h.connectOpened = 0;
  h.sendTransactionAsync.mockReset();
  h.sendCallsAsync.mockReset();
  h.switchChainAsync.mockReset();
});

/* ── 1 · the 5792 catch: the fallback is opt-IN, never a catch-all ─────────── */

describe('a batch that did not come back is NOT a wallet without EIP-5792', () => {
  /** The four ways `wallet_sendCalls` dies WITHOUT proving non-support. */
  const NOT_A_DOWNGRADE = {
    'a transport timeout': Object.assign(new Error('The request took too long to respond.'), {
      code: -32603,
    }),
    'a dropped socket': new Error('WebSocket connection closed abnormally'),
    'a -32002 already-pending popup': Object.assign(
      new Error('Request of type wallet_sendCalls already pending for origin. Please wait.'),
      { code: -32002 },
    ),
    'a user rejection': Object.assign(new Error('User rejected the request.'), { code: 4001 }),
  };

  for (const [label, err] of Object.entries(NOT_A_DOWNGRADE)) {
    it(`${label} re-throws instead of re-sending every call`, async () => {
      // THE BUG: with a bare `} catch {`, each of these silently downgraded the
      // rail and sent the WHOLE array through `eth_sendTransaction`. On a
      // bundle the wallet had already accepted that is the approve paid twice
      // and the supply paid twice; on a rejection it is N popups nobody asked
      // for.
      h.sendCallsAsync.mockRejectedValue(err);
      sendsHashes(HASH1, HASH2);

      await expect(partner().sendIntentCalls(CALLS)).rejects.toBe(err);
      expect(h.sendTransactionAsync).not.toHaveBeenCalled();
    });
  }

  it('the re-thrown timeout lands in the amber ending, never on a sign button', async () => {
    const err = NOT_A_DOWNGRADE['a transport timeout'];
    h.sendCallsAsync.mockRejectedValue(err);
    await partner()
      .sendIntentCalls(CALLS)
      .catch((e: unknown) => {
        expect(signOutcome(e, true)).toEqual({ kind: 'unconfirmed' });
        expect(signFailureAction(e, true, en).view).toBe('unconfirmed');
      });
    expect.assertions(2);
  });

  it('a rejected batch keeps its retry offer — nothing left, so retrying is right', async () => {
    const err = NOT_A_DOWNGRADE['a user rejection'];
    h.sendCallsAsync.mockRejectedValue(err);
    await partner()
      .sendIntentCalls(CALLS)
      .catch((e: unknown) => {
        // This frente only WITHDRAWS retry offers where money already moved;
        // here nothing did, so the sign button stays.
        expect(signFailureAction(e, true, en).view).toBe('review');
      });
    expect.assertions(1);
  });
});

describe('a wallet that genuinely does not implement wallet_sendCalls still falls back', () => {
  const A_REAL_DOWNGRADE = {
    'EIP-1193 4200': Object.assign(new Error('Unsupported Method'), { code: 4200 }),
    'JSON-RPC -32601': Object.assign(new Error('Method not found'), { code: -32601 }),
    "MetaMask's own prose": new Error(
      'The method "wallet_sendCalls" does not exist / is not available.',
    ),
    'WalletConnect': new Error('Unsupported methods requested: wallet_sendCalls'),
    'a viem-style nested cause': Object.assign(new Error('An unknown RPC error occurred.'), {
      cause: Object.assign(new Error('rpc failed'), { code: -32601 }),
    }),
  };

  for (const [label, err] of Object.entries(A_REAL_DOWNGRADE)) {
    it(`${label} → the sequential rail signs each call in order`, async () => {
      h.sendCallsAsync.mockRejectedValue(err);
      h.publicClient = reader({ [HASH1]: 'success', [HASH2]: 'success' });
      sendsHashes(HASH1, HASH2);

      const out = await partner().sendIntentCalls(CALLS);
      expect(h.sendTransactionAsync).toHaveBeenCalledTimes(2);
      expect(out.txHash).toBe(HASH2);
      expect(out.handle.status).toBe('settled');
    });
  }
});

describe('isBatchUnsupported — the predicate, on its own', () => {
  it('says yes only to a not-implemented answer', () => {
    expect(isBatchUnsupported({ code: 4200 })).toBe(true);
    expect(isBatchUnsupported({ code: '-32601' })).toBe(true);
    expect(isBatchUnsupported('Unsupported method')).toBe(true);
    expect(isBatchUnsupported({ name: 'MethodNotSupportedRpcError', message: 'x' })).toBe(true);
  });

  it('says no to everything that could mean the batch is already out there', () => {
    for (const e of [
      null,
      undefined,
      'boom',
      new Error('The request took too long to respond.'),
      Object.assign(new Error('User rejected the request.'), { code: 4001 }),
      Object.assign(new Error('Request of type wallet_sendCalls already pending'), { code: -32002 }),
      Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 }),
      new Error('execution reverted'),
    ]) {
      expect(isBatchUnsupported(e)).toBe(false);
    }
  });

  it('does not loop forever on a self-referencing cause chain', () => {
    const e: { message: string; cause?: unknown } = { message: 'boom' };
    e.cause = e;
    expect(isBatchUnsupported(e)).toBe(false);
  });
});

/* ── 2 · the emitter wiring: the four arguments, EXECUTED ─────────────────── */

const NO_5792 = Object.assign(new Error('Method not found'), { code: -32601 });

describe('sequentialStepError is wired with what the loop actually knows', () => {
  beforeEach(() => {
    h.sendCallsAsync.mockRejectedValue(NO_5792);
  });

  it('a revert on step 2 points at the step that LANDED, not at the one that failed', async () => {
    // THE BUG: `last` already held step 2's hash when its receipt came back
    // reverted, so the amber panel said «1 earlier step is already on the
    // chain» over a «Check it on the explorer →» link the explorer marks
    // FAILED. The check contradicted the warning, and "nothing went in, I'll
    // sign again" was one click away.
    h.publicClient = reader({ [HASH1]: 'success', [HASH2]: 'reverted' });
    sendsHashes(HASH1, HASH2);

    const e = await partner()
      .sendIntentCalls(CALLS)
      .then(() => null, (err: unknown) => err);

    expect(isPartialExecution(e)).toBe(true);
    expect(inFlightInfo(e)).toEqual({
      txHash: HASH1,
      stepIndex: 1,
      totalSteps: 2,
      kind: 'partial',
      completedSteps: 1,
      completedConfirmed: true,
    });
    // …and that is the hash the shared amber panel links to.
    expect(signOutcome(e, true)).toEqual({ kind: 'unconfirmed', txHash: HASH1 });
  });

  it('a receipt we could not read reports THIS step, and stops the loop', async () => {
    h.publicClient = reader({ [HASH1]: 'success', [HASH2]: 'unreadable' });
    sendsHashes(HASH1, HASH2, HASH3);

    const e = await partner()
      .sendIntentCalls([...CALLS, { to: '0xcccc', data: '0xborrow', value: '0', chainId: 14 }])
      .then(() => null, (err: unknown) => err);

    expect(isReceiptUnread(e)).toBe(true);
    // Here the in-flight step's OWN hash is the right one — it is the thing to
    // go and look at — and the dependent third call was never sent.
    expect(inFlightInfo(e)).toEqual({ txHash: HASH2, stepIndex: 1, totalSteps: 3 });
    expect(h.sendTransactionAsync).toHaveBeenCalledTimes(2);
  });

  it('with no receipt reader the earlier steps are SENT, never "on the chain"', async () => {
    h.publicClient = null;
    sendsHashes(HASH1, HASH2);
    h.sendTransactionAsync.mockImplementationOnce(async () => HASH1);
    h.sendTransactionAsync.mockImplementationOnce(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    });

    const e = await partner()
      .sendIntentCalls(CALLS)
      .then(() => null, (err: unknown) => err);

    expect(inFlightInfo(e)).toEqual({
      txHash: HASH1,
      stepIndex: 1,
      totalSteps: 2,
      kind: 'partial',
      completedSteps: 1,
      completedConfirmed: false,
    });
  });

  it('the FIRST step dying keeps the wallet error and the sign button', async () => {
    h.publicClient = reader({});
    h.sendTransactionAsync.mockRejectedValue(
      Object.assign(new Error('User rejected the request.'), { code: 4001 }),
    );

    const e = await partner()
      .sendIntentCalls(CALLS)
      .then(() => null, (err: unknown) => err);

    expect(isPartialExecution(e)).toBe(false);
    expect((e as Error).message).toBe('Step 1/2 failed: User rejected the request.');
    expect(signFailureAction(e, true, en).view).toBe('review');
  });

  it('every step confirmed ⇒ a settled handle on the LAST hash', async () => {
    h.publicClient = reader({ [HASH1]: 'success', [HASH2]: 'success' });
    sendsHashes(HASH1, HASH2);

    const out = await partner().sendIntentCalls(CALLS);
    expect(out.txHash).toBe(HASH2);
    expect(out.handle.status).toBe('settled');
    expect(out.handle.rail).toBe('evm');
  });

  it('no receipt reader ⇒ PENDING, never a silent green', async () => {
    h.publicClient = null;
    sendsHashes(HASH1, HASH2);

    const out = await partner().sendIntentCalls(CALLS);
    expect(out.handle.status).toBe('pending');
  });
});

/* ── 3 · the rails around it, unchanged ───────────────────────────────────── */

describe('the single-call and 5792 rails keep their honesty', () => {
  it('one call with a read receipt settles; without one it stays pending', async () => {
    h.publicClient = reader({ [HASH1]: 'success' });
    h.sendTransactionAsync.mockResolvedValue(HASH1);
    expect((await partner().sendIntentCalls([CALLS[0]])).handle.status).toBe('settled');

    h.publicClient = reader({ [HASH1]: 'unreadable' });
    expect((await partner().sendIntentCalls([CALLS[0]])).handle.status).toBe('pending');
  });

  it('an accepted bundle hands back PENDING on the 5792 rail', async () => {
    h.sendCallsAsync.mockResolvedValue({ id: '0xbundle' });
    const out = await partner().sendIntentCalls(CALLS);
    expect(out.handle.rail).toBe('evm-5792');
    expect(out.handle.status).toBe('pending');
    expect(h.sendTransactionAsync).not.toHaveBeenCalled();
  });

  it('the chain is switched before anything is sent', async () => {
    h.chainId = 1;
    h.sendCallsAsync.mockResolvedValue({ id: '0xbundle' });
    await partner().sendIntentCalls(CALLS);
    expect(h.switchChainAsync).toHaveBeenCalledWith({ chainId: 14 });
  });

  it('a disconnected wallet opens the modal and never sends', async () => {
    h.account = { isConnected: false };
    await expect(partner().sendIntentCalls(CALLS)).rejects.toThrow('WALLET_PARTNER_NOT_CONNECTED');
    expect(h.connectOpened).toBe(1);
    expect(h.sendCallsAsync).not.toHaveBeenCalled();
  });
});

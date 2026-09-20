import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECEIPT_UNREAD,
  PARTIAL_EXECUTION,
  isInFlight,
  isPartialExecution,
  isReceiptUnread,
  inFlightInfo,
  inFlightMessage,
  partialExecutionError,
  sequentialStepError,
  type InFlightInfo,
} from '../inFlightError';
import { signOutcome, signFailureAction, applySignFailure, unconfirmedTrace } from '../signOutcome';
import { describeStaleSignature } from '../../../components/wallet/SeatRefusalNotice';
import { translateError } from '../../errors/translateError';

/**
 * metamask-parcial — the last live door to the double spend.
 *
 * Sibling of `familia-no-pude-leer`, and NOT the same bug. There the failure
 * was "I could not read the receipt"; here it is "I read it, and it went out
 * HALF WAY": the sequential EVM rail — the one MetaMask uses when the wallet
 * does not speak EIP-5792 — signs N calls in order, and when call 2 dies with
 * call 1 already mined, the surface offered to sign THE WHOLE ARRAY again.
 */

// translateError writes the raw failure to console.error by design.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const en = (s: string) => s;
const HASH = '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
const HASH2 = '0xdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ac';

/** The four ways a step 2 actually dies in production. */
const REJECTED = Object.assign(new Error('User rejected the request.'), { code: 4001 });
const NO_GAS = new Error('Insufficient funds for gas * price + value');
const REVERTED = new Error(
  'The contract function "redeem" reverted with the following reason: ERC20: transfer amount exceeds the balance of the account',
);
const RPC_DEAD = new Error('HTTP request failed. Status: 429');

/** The shape the hook threw BEFORE this frente — kept to lock the rule. */
const oldWrap = (inner: Error, i = 1, n = 2) =>
  new Error(
    `Step ${i + 1}/${n} failed: ${inner.message}` +
      ` — the first ${i} step${i > 1 ? 's are' : ' is'} already on-chain.`,
  );

/* ── 1 · the bug, measured on the shipping classifier ─────────────────────── */

describe('the old wrapper handed the wallet the verdict of the whole array', () => {
  it('a rejection of step 2 read as "nothing moved, sign again"', () => {
    // This is the double spend: 'review' keeps `prepared` and the sign button,
    // and the button re-sends EVERY call, including the one already mined.
    const action = signFailureAction(oldWrap(REJECTED), true, en);
    expect(action.view).toBe('review');
    expect(action.view === 'review' && action.message).toMatch(/Nothing moved/i);
  });

  it('a gas refusal of step 2 read the same way', () => {
    expect(signOutcome(oldWrap(NO_GAS), true)).toEqual({ kind: 'not-sent' });
  });

  it('a revert of step 2 claimed the money had not moved', () => {
    const action = signFailureAction(oldWrap(REVERTED), true, en);
    expect(action.view).toBe('form');
    expect(action.view === 'form' && action.message).toMatch(/money did not move/i);
  });
});

/* ── 2 · the decision, now pure and executable ────────────────────────────── */

describe('sequentialStepError — the three truths of the sequential rail', () => {
  it('step 1 dying means nothing left: the wallet error is preserved verbatim', () => {
    // The retry offer is CORRECT here and this frente must not remove it: no
    // call was sent, so the prepared payload is still exactly right.
    const out = sequentialStepError(REJECTED, {
      index: 0,
      total: 2,
      lastTxHash: '0x',
      receiptsReadable: true,
    }) as Error;
    expect(isPartialExecution(out)).toBe(false);
    expect(out.message).toBe('Step 1/2 failed: User rejected the request.');
    expect(signOutcome(out, true)).toEqual({ kind: 'not-sent' });
    expect(signFailureAction(out, true, en).view).toBe('review');
  });

  it('a step dying AFTER one landed is a partial execution, not a failure', () => {
    const out = sequentialStepError(REJECTED, {
      index: 1,
      total: 2,
      lastTxHash: HASH,
      receiptsReadable: true,
    });
    expect(isPartialExecution(out)).toBe(true);
    expect(isInFlight(out)).toBe(true);
    expect(isReceiptUnread(out)).toBe(false);
    expect(inFlightInfo(out)).toEqual({
      txHash: HASH,
      stepIndex: 1,
      totalSteps: 2,
      kind: 'partial',
      completedSteps: 1,
      completedConfirmed: true,
    });
  });

  it('an already-honest "in flight" is passed through untouched, never relabelled', () => {
    const unread = Object.assign(new Error('Step 2/3 is IN FLIGHT — sent, but not confirmed yet.'), {
      code: RECEIPT_UNREAD,
      txHash: HASH,
      stepIndex: 1,
      totalSteps: 3,
    });
    expect(
      sequentialStepError(unread, {
        index: 1,
        total: 3,
        lastTxHash: HASH,
        receiptsReadable: true,
      }),
    ).toBe(unread);
  });

  it('without a receipt reader the earlier steps are SENT, never "on the chain"', () => {
    // Nunca pintar verde un estado no leído: with no public client for this
    // chain nobody read a single receipt, so the diagnostic may not claim any
    // step landed — only that it went out.
    const out = sequentialStepError(NO_GAS, {
      index: 2,
      total: 4,
      lastTxHash: HASH,
      receiptsReadable: false,
    }) as Error & { completedConfirmed: boolean };
    expect(out.completedConfirmed).toBe(false);
    expect(out.message).toContain('2 earlier steps were already sent to the network');
    expect(out.message).not.toMatch(/on the chain/);
  });

  it('a placeholder hash is not offered as something to look up', () => {
    const out = sequentialStepError(REJECTED, {
      index: 1,
      total: 2,
      lastTxHash: '0x',
      receiptsReadable: true,
    }) as Error & { txHash?: string };
    expect(out.txHash).toBeUndefined();
  });
});

/* ── 3 · the wallet's reason never travels where a classifier can read it ─── */

describe('a partial execution is classified as "do not sign again", whatever killed it', () => {
  for (const [label, inner] of Object.entries({ REJECTED, NO_GAS, REVERTED, RPC_DEAD })) {
    it(`${label} on step 2 of 2 → the amber ending, never the sign button`, () => {
      const out = sequentialStepError(inner as Error, {
        index: 1,
        total: 2,
        lastTxHash: HASH,
        receiptsReadable: true,
      });
      expect(signOutcome(out, true)).toEqual({ kind: 'unconfirmed', txHash: HASH });
      expect(signFailureAction(out, true, en).view).toBe('unconfirmed');
    });

    it(`${label}: with the code stripped, the TEXT alone still falls safe`, () => {
      // Belt and braces. If the code is ever lost crossing a boundary, the
      // message must not read as a verdict either — which is why the wallet's
      // words live in `cause` and never in `.message`.
      const out = sequentialStepError(inner as Error, {
        index: 1,
        total: 2,
        lastTxHash: HASH,
        receiptsReadable: true,
      }) as Error & { code?: string; cause?: unknown };
      expect(out.cause).toBe(inner);
      delete out.code;
      expect(signOutcome(out, true)).toEqual({ kind: 'unconfirmed' });
    });
  }

  it('the amber panel quotes the fact that a step already landed', () => {
    const out = sequentialStepError(REJECTED, {
      index: 1,
      total: 2,
      lastTxHash: HASH,
      receiptsReadable: true,
    });
    const trace = unconfirmedTrace(out);
    expect(trace).toContain('1 earlier step is already on the chain');
    // …and never the wallet's own "you rejected it", which under an amber
    // "do NOT sign again" headline is an invitation to sign again.
    expect(trace).not.toMatch(/rejected/i);
  });

  it('applySignFailure keeps the prepared payload and clears the red line', () => {
    const ui = { error: 'stale red text', unconfirmed: undefined as unknown, phase: '', cleared: 0 };
    const action = applySignFailure(
      sequentialStepError(REVERTED, {
        index: 1,
        total: 2,
        lastTxHash: HASH2,
        receiptsReadable: true,
      }),
      true,
      en,
      {
        setError: (m) => {
          ui.error = m;
        },
        setUnconfirmed: (u) => {
          ui.unconfirmed = u;
        },
        setPhase: (p) => {
          ui.phase = p;
        },
        clearPrepared: () => {
          ui.cleared += 1;
        },
      },
    );
    expect(action.view).toBe('unconfirmed');
    expect(ui.phase).toBe('unconfirmed');
    expect(ui.error).toBe('');
    expect(ui.cleared).toBe(0);
    expect(ui.unconfirmed).toMatchObject({ txHash: HASH2 });
  });
});

/* ── 4 · what the user is told ────────────────────────────────────────────── */

describe('inFlightMessage — the partial branch says the truth and offers nothing', () => {
  const info = (): InFlightInfo => inFlightInfo(
    sequentialStepError(REJECTED, {
      index: 1,
      total: 2,
      lastTxHash: HASH,
      receiptsReadable: true,
    }),
  )!;

  it('names the step and forbids the second signature', () => {
    const msg = inFlightMessage(info(), en);
    expect(msg).toContain('2/2');
    expect(msg).toMatch(/Do NOT sign it again/);
  });

  it('does not claim the dead step is in flight — that one WAS read', () => {
    expect(inFlightMessage(info(), en)).not.toMatch(/IN FLIGHT/);
  });

  it('offers no retry at all: this frente may only WITHDRAW retry offers', () => {
    // The receipt-unread twin ends with "only retry the steps that are left";
    // for a partial execution there is no safe step to name, so nothing is
    // offered — the honest answer is "go and look".
    const msg = inFlightMessage(info(), en);
    expect(msg).not.toMatch(/\bretry\b|try again/i);
    expect(msg).toMatch(/Check the explorer/);
  });

  it('still says it when the step numbers are missing', () => {
    const msg = inFlightMessage({ kind: 'partial' }, en);
    expect(msg).toMatch(/Part of this operation already went out/);
    expect(msg).toMatch(/Do NOT sign it again/);
  });

  it('the receipt-unread head is untouched', () => {
    const msg = inFlightMessage({ txHash: HASH, stepIndex: 0, totalSteps: 2 }, en);
    expect(msg).toContain('1/2');
    expect(msg).toMatch(/IN FLIGHT/);
  });
});

/* ── 4b · batch-evm: the two fields nobody read, and the offer
        that could not be taken up ─────────────────────────────────────────── */

describe('inFlightMessage — batch-evm', () => {
  it('the receipt-unread branch no longer offers to retry "the steps that are left"', () => {
    // NOBODY can. All eleven signing surfaces re-send the whole array; there is
    // no subset resend anywhere in the repo. The rule of this rail is that a
    // fix may only WITHDRAW retry offers, and this one was left standing next
    // to its twin.
    const msg = inFlightMessage({ txHash: HASH, stepIndex: 0, totalSteps: 2 }, en);
    expect(msg).not.toMatch(/only retry the steps that are left/i);
    expect(msg).not.toMatch(/\bretry\b|try again/i);
    expect(msg).toMatch(/Do NOT sign it again/);
    expect(msg).toMatch(/Check the explorer/);
  });

  it('without a receipt reader it never claims the earlier steps LANDED', () => {
    // `completedConfirmed: false` = nobody read a receipt. "The steps that
    // already landed" would be painting green over something unread.
    const sent = inFlightMessage(
      { kind: 'partial', stepIndex: 1, totalSteps: 2, completedSteps: 1, completedConfirmed: false },
      en,
    );
    expect(sent).toMatch(/already out of your hands/);
    expect(sent).not.toMatch(/already landed/);

    const read = inFlightMessage(
      { kind: 'partial', stepIndex: 1, totalSteps: 2, completedSteps: 1, completedConfirmed: true },
      en,
    );
    expect(read).toMatch(/already landed/);
    // Both say the only thing that matters, whatever we managed to read.
    for (const m of [sent, read]) expect(m).toMatch(/Do NOT sign it again/);
  });

  it('with zero completed steps it does not invent a "before it"', () => {
    // The Ethereum-rail modals rebuild `inFlightInfo(e) ?? {}`; a partial that
    // arrives naming step 1 has nothing before it, and the head used to say
    // "everything before it already went out" about steps that do not exist.
    const msg = inFlightMessage(
      { kind: 'partial', stepIndex: 0, totalSteps: 2, completedSteps: 0 },
      en,
    );
    expect(msg).not.toMatch(/everything before it/);
    expect(msg).toMatch(/Part of this operation already went out/);
  });
});

describe('the surfaces that only print translateError still get the truth', () => {
  it('the diagnostic passes through instead of becoming "you cancelled"', () => {
    // DefiPositionsBoard, WalletTransferModals and useIntentSigning keep their
    // sign button (reported, not mine), but the sentence beside it no longer
    // says "Nothing moved — try again whenever you like".
    const out = sequentialStepError(REJECTED, {
      index: 1,
      total: 2,
      lastTxHash: HASH,
      receiptsReadable: true,
    });
    const { message } = translateError(out, en);
    expect(message).not.toMatch(/Nothing moved/i);
    expect(message).toMatch(/do NOT sign this operation again/);
  });

  it('the diagnostic stays inside translateError’s passthrough budget', () => {
    // Over 160 chars (or carrying jargon) it collapses into the generic
    // "Something went wrong — try again in a minute", which is the very
    // sentence this frente exists to remove.
    const out = sequentialStepError(REVERTED, {
      index: 9,
      total: 10,
      lastTxHash: HASH,
      receiptsReadable: true,
    }) as Error;
    expect(out.message.length).toBeLessThanOrEqual(160);
    expect(translateError(out, en).message).toBe(out.message);
  });
});

/* ── 5 · the Ethereum-rail modals, running their own shipping catch ───────── */

const SRC = join(__dirname, '..', '..', '..', 'components');

/** The source of one brace-balanced block starting at `header`. */
function blockFrom(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, `"${header}" must exist in the shipping component`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`"${header}" is not brace-balanced`);
}

/**
 * EXECUTE the sign() catch these three modals ship. Not a substring search:
 * the shipping lines run, and anything they reference that is not injected
 * throws a ReferenceError, so a catch that stops asking `isInFlight` fails
 * loudly instead of passing in green.
 *
 * The only transform is dropping TypeScript's `as X` assertions, which
 * `new Function` cannot parse. Anything else that changes shape makes
 * `blockFrom` throw, which is the point.
 */
function runSignCatch(file: string, e: unknown, handedToPartner = true) {
  const fn = blockFrom(readFileSync(file, 'utf8'), 'async function sign()');
  const at = fn.lastIndexOf('catch (e) {');
  expect(at, `${file}: sign() must still end in a catch`).toBeGreaterThan(-1);
  const body = blockFrom(fn.slice(at), 'catch (e) {')
    .replace(/^catch \(e\) \{/, '{')
    .replace(/\s+as\s+[A-Za-z_$][\w$.]*/g, '');
  // unearned-success residues: the hand-off must be DECLARED in sign()
  // itself, before the wallet call — a catch that reads a flag nobody sets
  // would classify every failure 'not-sent', the bug wearing a new hat.
  expect(fn, `${file}: sign() must declare the hand-off`).toMatch(/handedToPartner = true;\s*(\/\/[^\n]*\n\s*)*const \{ handle \} = await evm\.sendIntentCalls/);

  const ui = { inFlight: undefined as unknown, error: '', phase: '' };
  const deps: Record<string, unknown> = {
    isInFlight,
    inFlightInfo,
    signOutcome,
    handedToPartner,
    setInFlight: (v: unknown) => {
      ui.inFlight = v;
    },
    setErrorMsg: (m: string) => {
      ui.error = m;
    },
    setPhase: (p: string) => {
      ui.phase = p;
    },
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  new Function('e', ...names, body)(e, ...names.map((n) => deps[n]));
  return ui;
}

const ETH_RAIL = [
  { label: 'EmExitModal', file: join(SRC, 'positions', 'EmExitModal.tsx') },
  { label: 'EmRepayModal', file: join(SRC, 'positions', 'EmRepayModal.tsx') },
  { label: 'EmBridgeModal', file: join(SRC, 'earn', 'EmBridgeModal.tsx') },
  { label: 'EmCloseModal', file: join(SRC, 'positions', 'EmCloseModal.tsx') },
];

describe.each(ETH_RAIL)('$label — the "Back to the form" offer is withdrawn', ({ file }) => {
  it('a partial execution now lands in the amber state, not the red one', () => {
    // These three render `inFlight ? Close : Back` and
    // `inFlight ? inFlightMessage(...) : errorMsg`. Before this frente the
    // catch stored null for a partial execution, so the user got a red
    // "User rejected the request." and a Back button on Ethereum mainnet —
    // and Back leads to signing the whole array again, repaying what was
    // already repaid.
    const ui = runSignCatch(
      file,
      sequentialStepError(REJECTED, {
        index: 1,
        total: 2,
        lastTxHash: HASH,
        receiptsReadable: true,
      }),
    );
    expect(ui.phase).toBe('error');
    expect(ui.inFlight).toMatchObject({ kind: 'partial', txHash: HASH, completedSteps: 1 });
    expect(inFlightMessage(ui.inFlight as InFlightInfo, en)).toMatch(/Do NOT sign it again/);
  });

  it('a receipt we could not read still lands amber (unchanged)', () => {
    const ui = runSignCatch(
      file,
      Object.assign(new Error('in flight'), {
        code: RECEIPT_UNREAD,
        txHash: HASH,
        stepIndex: 0,
        totalSteps: 2,
      }),
    );
    expect(ui.inFlight).toMatchObject({ txHash: HASH, stepIndex: 0 });
  });

  it('a first-step rejection keeps its red path — nothing went out, retrying is right', () => {
    const ui = runSignCatch(
      file,
      sequentialStepError(REJECTED, {
        index: 0,
        total: 2,
        lastTxHash: '0x',
        receiptsReadable: true,
      }),
    );
    expect(ui.inFlight).toBeNull();
    expect(ui.error).toBe('Step 1/2 failed: User rejected the request.');
  });

  it('a "Failed to fetch" AFTER the calls reached the wallet lands amber, not red', () => {
    // unearned-success residues: the catch only asked isInFlight, so a
    // dropped RPC or a timeout after the hand-off went red with a way back to
    // the form — a double repay / exit / bridge / close one click away.
    for (const err of [new TypeError('Failed to fetch'), new Error('Timed out while waiting for transaction receipt.')]) {
      const ui = runSignCatch(file, err, true);
      expect(ui.phase).toBe('error');
      expect(ui.inFlight).toEqual({});
      expect(inFlightMessage(ui.inFlight as InFlightInfo, en)).toMatch(/Do NOT sign it again/);
    }
  });

  it('the same error BEFORE the hand-off keeps the red path — no wallet ever opened', () => {
    const ui = runSignCatch(file, new TypeError('Failed to fetch'), false);
    expect(ui.inFlight).toBeNull();
    expect(ui.error).toBe('Failed to fetch');
  });

  it('a revert it READ keeps the red path (today’s behaviour)', () => {
    const ui = runSignCatch(file, new Error('transaction reverted (0xdead…)'), true);
    expect(ui.inFlight).toBeNull();
  });

  it('the error view with inFlight set offers Close, never the way back', () => {
    const src = readFileSync(file, 'utf8');
    const errorView = src.slice(src.lastIndexOf("phase === 'error'"));
    expect(errorView).toMatch(/onClick=\{\(\) => \(inFlight \? onClose\(\) :/);
    expect(errorView).toMatch(/\{inFlight \? t\('Close'\) :/);
  });
});

/* ── 6 · BorrowFlowRunner, running the catch it ships ────────────────────── */

describe('BorrowFlowRunner — an unknown ending after the hand-off never offers the step again', () => {
  const file = join(SRC, 'earn', 'BorrowFlowRunner.tsx');

  function runStepCatch(e: unknown, handedToPartner: boolean) {
    const src = readFileSync(file, 'utf8');
    const fn = blockFrom(src, 'const runStep = useCallback(async () => {');
    // Both rails declare the hand-off right before their wallet call.
    expect(fn).toMatch(/handedToPartner = true;\s*const \{ txHash \} = await xrpl\.sendIntent/);
    expect(fn).toMatch(/handedToPartner = true;\s*const \{ handle \} = await evm\.sendIntentCalls/);
    const at = fn.lastIndexOf('catch (e) {');
    const body = blockFrom(fn.slice(at), 'catch (e) {')
      .replace(/^catch \(e\) \{/, '{')
      .replace(/\s+as\s+[A-Za-z_$][\w$.]*/g, '');
    const ui: { status?: string; detail?: string } = {};
    const deps: Record<string, unknown> = {
      signOutcome,
      inFlightInfo,
      // El catch pregunta primero si el ledger ya dio veredicto
      // (tefMAX_LEDGER / tefPAST_SEQ). Se inyecta la función REAL, no un stub:
      // este arnés ejecuta el código que se despliega.
      describeStaleSignature,
      t: (x: string) => x,
      handedToPartner,
      setStatus: (_f: unknown, status: string, detail?: string) => ({ status, detail }),
      setFlow: (update: (f: unknown) => { status: string; detail?: string }) => {
        Object.assign(ui, update({}));
      },
    };
    const names = Object.keys(deps);
    // eslint-disable-next-line no-new-func
    new Function('e', ...names, body)(e, ...names.map((n) => deps[n]));
    return ui;
  }

  it('"Failed to fetch" after the hand-off → unconfirmed (no retry button, no advance)', () => {
    expect(runStepCatch(new TypeError('Failed to fetch'), true).status).toBe('unconfirmed');
  });

  it('Xaman\'s "could not retrieve the hash" after the hand-off → unconfirmed', () => {
    const ui = runStepCatch(
      new Error('Transaction submission failed: Failed to retrieve transaction hash from payload'),
      true,
    );
    expect(ui.status).toBe('unconfirmed');
  });

  it('a receipt we could not read still carries its hash', () => {
    const ui = runStepCatch(Object.assign(new Error('in flight'), { code: RECEIPT_UNREAD, txHash: HASH }), true);
    expect(ui).toEqual({ status: 'unconfirmed', detail: HASH });
  });

  it('a pre-flight throw, a rejection and a read revert stay "failed" (retry is honest)', () => {
    expect(runStepCatch(new Error('Connect your EVM wallet (Flare) to continue'), false).status).toBe('failed');
    expect(runStepCatch(new Error('User rejected the request.'), true).status).toBe('failed');
    expect(runStepCatch(new Error('transaction reverted (0xdead…)'), true).status).toBe('failed');
  });
});

describe('the codes stay distinguishable', () => {
  it('partial and receipt-unread are different facts with the same answer', () => {
    expect(PARTIAL_EXECUTION).not.toBe(RECEIPT_UNREAD);
    const partial = partialExecutionError({ index: 1, total: 2, confirmed: true });
    expect(isReceiptUnread(partial)).toBe(false);
    expect(isPartialExecution(partial)).toBe(true);
    expect(isInFlight(partial)).toBe(true);
  });

  it('an ordinary error is neither', () => {
    for (const e of [null, undefined, 'boom', new Error('transaction reverted (0xdead…)')]) {
      expect(isInFlight(e)).toBe(false);
      expect(isPartialExecution(e)).toBe(false);
      expect(inFlightInfo(e)).toBeNull();
    }
  });
});

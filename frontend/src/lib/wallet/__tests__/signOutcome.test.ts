import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  signOutcome,
  signFailureAction,
  unconfirmedTrace,
  applySignFailure,
  type SignFailureAction,
  type UnconfirmedSignature,
} from '../signOutcome';
import { UnconfirmedSignatureNotice } from '../../../components/settlement/UnconfirmedSignatureNotice';
import { describeStaleSignature } from '../../../components/wallet/SeatRefusalNotice';

/**
 * familia-no-pude-leer (2026-08-20) — the most expensive failure family in this
 * repo, closed outside the vault.
 *
 * «No pude leer» NO es «falló». A read failure AFTER a payload reached the
 * wallet must never lead back to the sign button: on the 0xFE rail a second
 * signature is a second dispatch — a second carrier fee in XRP, a second nonce
 * seat, a second movement of real money.
 *
 * The vault twins learned this in `settling-residuos` / `settling-final`; three
 * surfaces had not: `positions/PaActionsModal` (the 0xFE rail itself),
 * `positions/FtsoExitModal` and `earn/FlareDemoEarn`, all three ending their
 * sign() catch with "the prepared payload is still valid, retry the signature".
 * The decision moved out of `components/positions/vaultModalTruth.ts` and into
 * `lib/wallet/signOutcome.ts` — five surfaces, one implementation — and two
 * residues left by the vault's own sceptic were closed on the way:
 *
 *  A. `NEVER_REACHED_WALLET` was tested BEFORE `READ_AS_FAILED`, and two of its
 *     patterns ("insufficient funds", "exceeds the balance of the account") are
 *     ordinary revert reasons: a revert we actually read was answered "nothing
 *     left — sign it again", over calldata the chain had already refused.
 *
 *  B. `unconfirmedTrace` refused sentences that invite a retry but not
 *     sentences that pronounce a VERDICT — and this state's dominant arrival is
 *     Xaman's "Transaction submission failed: Failed to retrieve transaction
 *     hash from payload", quoted verbatim under "do NOT sign it again".
 *
 * Everything below RUNS the shipping code: the pure functions are imported, the
 * three catches are extracted from the shipping .tsx and executed, and the
 * panel is really rendered. No assertion here is a substring search over source.
 */

// translateError writes the raw failure to console.error by design.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** `t` as the app behaves when a key is untranslated. */
const en = (s: string) => s;
const HASH = '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
/** The two ways production actually reaches "I could not read it". */
const XAMAN_NO_HASH = new Error(
  'Transaction submission failed: Failed to retrieve transaction hash from payload',
);
const TIMEOUT = new Error('Timed out while waiting for transaction receipt. timeout: 180000ms');
/** Any sentence that says "nothing happened, go again" — in either language. */
const INVITES = /try again|nothing was signed|nothing moved|int[eé]ntalo|no se ha firmado/i;

/* ── residue A · a verdict we READ beats a guess about the payload ───────── */

describe('residue A — "reverted" outranks the pre-wallet inference it collides with', () => {
  it('a revert whose reason borrows the words of a gas refusal is still a revert', () => {
    // Shipped behaviour: `/exceeds the balance of the account/` matched first
    // and answered 'not-sent', i.e. "the wallet never had it — sign again",
    // for a transaction the chain had already run and refused.
    const erc20 = new Error(
      'execution reverted: ERC20: transfer amount exceeds the balance of the account',
    );
    expect(signOutcome(erc20, true)).toEqual({ kind: 'reverted' });

    // viem does not always say "execution reverted"; a contract revert arrives
    // in this shape, and its REASON used to decide the outcome.
    const viem = {
      name: 'ContractFunctionExecutionError',
      shortMessage:
        'The contract function "redeem" reverted with the following reason: insufficient funds',
    };
    expect(signOutcome(viem, true)).toEqual({ kind: 'reverted' });

    // …and the consequence, which is the point: a spent payload is never
    // offered back to the sign button.
    for (const e of [erc20, viem]) {
      const action = signFailureAction(e, true, en);
      expect(action.view).toBe('form');
      expect(action.view === 'form' ? action.message : '').toMatch(/Prepare it again/);
    }
  });

  it('the pre-wallet refusals that say nothing about a revert still come back retryable', () => {
    // The whole point of NEVER_REACHED_WALLET survives the reordering: what the
    // partner refuses before a wallet window exists is provably unsigned.
    const preWallet: unknown[] = [
      Object.assign(new Error('Chain "Flare Mainnet" not configured.'), {
        name: 'ChainNotConfiguredError',
      }),
      {
        name: 'SwitchChainNotSupportedError',
        shortMessage: 'The connector does not support programmatic chain switching.',
      },
      {
        name: 'TransactionExecutionError',
        shortMessage:
          'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
        details: 'insufficient funds for gas * price + value',
      },
    ];
    for (const e of preWallet) {
      expect(signOutcome(e, true)).toEqual({ kind: 'not-sent' });
      expect(signFailureAction(e, true, en).view).toBe('review');
    }
  });

  it('a deliberate "no" is still a proof, and still wins', () => {
    const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    expect(signOutcome(rejected, true)).toEqual({ kind: 'not-sent' });
    // And the unknown after the hand-off is still unconfirmed, never "failed".
    expect(signOutcome(XAMAN_NO_HASH, true)).toEqual({ kind: 'unconfirmed' });
    expect(signOutcome(TIMEOUT, true)).toEqual({ kind: 'unconfirmed' });
  });
});

/* ── residue B · the trace is a diagnostic, never a verdict ──────────────── */

describe('residue B — under "do NOT sign it again", nothing may say it failed', () => {
  it('the dominant error of this state is no longer quoted as a failure', () => {
    // It is a sentence about a failed READ that opens with the word "failed",
    // printed under a headline saying the dispatch may already be out there.
    // The reader believes the concrete line and signs a second time.
    expect(unconfirmedTrace(XAMAN_NO_HASH)).toBeNull();
    expect(unconfirmedTrace(new Error('Failed to fetch'))).toBeNull();
    expect(unconfirmedTrace(new Error('La operación ha fallado'))).toBeNull();
    expect(unconfirmedTrace({ name: 'XamanError', shortMessage: 'Submission unsuccessful' })).toBeNull();
  });

  it('dropping the sentence does not drop the state: it is still unconfirmed', () => {
    // The trace is the only thing suppressed. The operation stays unknown, the
    // panel stays amber, and there is still no way back to the sign button.
    const action = signFailureAction(XAMAN_NO_HASH, true, en);
    expect(action).toEqual({ view: 'unconfirmed', txHash: undefined, trace: null });
  });

  it('a trace that only describes the READ is still quoted, verbatim', () => {
    expect(unconfirmedTrace(TIMEOUT)).toBe(
      'Timed out while waiting for transaction receipt. timeout: 180000ms',
    );
    expect(
      unconfirmedTrace({
        name: 'TransactionExecutionError',
        shortMessage: 'The request took too long to respond.',
      }),
    ).toBe('TransactionExecutionError · The request took too long to respond.');
    expect(unconfirmedTrace(TIMEOUT)).not.toMatch(INVITES);
  });
});

/* ── the whole catch, once ───────────────────────────────────────────────── */

interface Ui {
  error: string | null;
  unconfirmed: UnconfirmedSignature | null | undefined;
  phase: string | null;
  preparedCleared: number;
}

function drive(e: unknown, handed: boolean): { ui: Ui; action: SignFailureAction } {
  const ui: Ui = { error: null, unconfirmed: undefined, phase: null, preparedCleared: 0 };
  const action = applySignFailure(e, handed, en, {
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
      ui.preparedCleared += 1;
    },
  });
  return { ui, action };
}

describe('applySignFailure — one catch for every signing surface', () => {
  it('a signature we could not follow: amber phase, no red line beside it', () => {
    const { ui } = drive(XAMAN_NO_HASH, true);
    expect(ui.phase).toBe('unconfirmed');
    // Two verdicts on one screen and the red one wins the reader: the error
    // line is cleared, not merely left behind.
    expect(ui.error).toBe('');
    expect(ui.unconfirmed).toEqual({ txHash: undefined, trace: null });
    // The prepared payload is NOT dropped: it may already be executing.
    expect(ui.preparedCleared).toBe(0);
  });

  it('the in-flight hash survives all the way to the panel', () => {
    const inFlight = Object.assign(
      new Error('Step 1/2 is IN FLIGHT — sent, but not confirmed yet. Do NOT sign it again.'),
      { code: 'RECEIPT_UNREAD', txHash: HASH, stepIndex: 0, totalSteps: 2 },
    );
    const { ui } = drive(inFlight, true);
    expect(ui.phase).toBe('unconfirmed');
    expect(ui.unconfirmed?.txHash).toBe(HASH);
  });

  it('provably nothing left: back to the sign button, and the amber panel cleared', () => {
    const { ui } = drive(Object.assign(new Error('User rejected the request.'), { code: 4001 }), true);
    expect(ui.phase).toBe('review');
    expect(ui.unconfirmed).toBeNull(); // a stale panel under a new error is its own lie
    expect(ui.error).toMatch(/You cancelled the signature/);
    expect(ui.preparedCleared).toBe(0);
  });

  it('nothing was ever handed over: retry, whatever the message says', () => {
    const { ui } = drive(new Error('Conecta tu wallet XRPL (Xaman) para continuar'), false);
    expect(ui.phase).toBe('review');
  });

  it('a revert we READ: the payload is spent, so the offer is a fresh prepare', () => {
    const { ui } = drive(new Error('transaction reverted (0xabc12345678…)'), true);
    expect(ui.phase).toBe('form');
    expect(ui.preparedCleared).toBe(1);
    expect(ui.error).toMatch(/Prepare it again with fresh numbers/);
  });

  /**
   * it. 31 (§4) — THE QUORUM CEREMONY'S OWN CLOSE, THROUGH THE SAME CATCH.
   *
   * `sendIntent` routes a quorum account to the ceremony bus, and closing the
   * dialog before anything was broadcast rejects with `QUORUM_CEREMONY_ABANDONED`
   * — the server has just handed the seat back. None of the bus's codes matched
   * `NEVER_LEFT`, so the 27 surfaces on `applySignFailure` painted the amber
   * «the transaction may already be out there — do NOT sign it again» over a
   * close in which nothing was ever signed. Driven through the real catch here,
   * with the real bus constants, not a copied string.
   */
  it('the ceremony closed before any broadcast: nothing left, back to the sign button — never amber', async () => {
    const { CEREMONY_ABANDONED } = await import('../../xrpl/quorumCeremonyBus');
    const { ui, action } = drive(new Error(CEREMONY_ABANDONED), true);
    expect(signOutcome(new Error(CEREMONY_ABANDONED), true)).toEqual({ kind: 'not-sent' });
    expect(action.view).not.toBe('unconfirmed');
    expect(ui.phase).toBe('review');
    expect(ui.unconfirmed).toBeNull();
    expect(ui.preparedCleared).toBe(0);
  });

  it('no ceremony surface mounted, or another sitting on the bus: nothing was shown, nothing left', () => {
    const noHost = new Error('QUORUM_CEREMONY_NO_HOST: this account signs by quorum and no ceremony surface is mounted');
    const busy = new Error('QUORUM_CEREMONY_BUSY: another ceremony is already collecting signatures');
    expect(signOutcome(noHost, true)).toEqual({ kind: 'not-sent' });
    expect(signOutcome(busy, true)).toEqual({ kind: 'not-sent' });
    expect(drive(noHost, true).ui.phase).toBe('review');
    expect(drive(busy, true).ui.phase).toBe('review');
  });

  /**
   * …and the OTHER close, the one the bus answers once the sitting has committed
   * to a broadcast: an in-flight error with the hash, which must stay amber — and
   * a node that refused with tefPAST_SEQ must read as stale, not as «out there».
   */
  it('the ceremony closed AFTER committing to a broadcast stays unconfirmed, with its hash', async () => {
    const bus = await import('../../xrpl/quorumCeremonyBus');
    const inFlight = Object.assign(
      new Error(`${bus.CEREMONY_CLOSED_IN_FLIGHT}: The signatures were being combined and broadcast when the ceremony was closed. Transaction ${HASH}. Do not sign it again: check the account on an explorer first.`),
      { code: 'RECEIPT_UNREAD', txHash: HASH },
    );
    const { ui } = drive(inFlight, true);
    expect(ui.phase).toBe('unconfirmed');
    expect(ui.unconfirmed?.txHash).toBe(HASH);

    const stale = Object.assign(
      new Error(`${bus.CEREMONY_CLOSED_IN_FLIGHT}: The node answered tefPAST_SEQ — Sequence already used. Do not sign it again: check the account on an explorer first.`),
      { code: 'RECEIPT_UNREAD' },
    );
    expect(signOutcome(stale, true)).toEqual({ kind: 'stale', code: 'tefPAST_SEQ' });
  });
});

/* ── the three surfaces, running their own shipping catch ────────────────── */

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

/** The body of the LAST `catch (e)` of sign() — the one this frente is about. */
function signCatchBody(file: string): string {
  const fn = blockFrom(readFileSync(file, 'utf8'), 'async function sign()');
  const at = fn.lastIndexOf('catch (e) {');
  expect(at, `${file}: sign() must still end in a catch`).toBeGreaterThan(-1);
  return blockFrom(fn.slice(at), 'catch (e) {').replace(/^catch \(e\) \{/, '{');
}

/**
 * EXECUTE that catch with stubbed setters. Not a substring search: the shipping
 * lines run, and anything they reference that is not injected here throws a
 * ReferenceError, so a catch that quietly goes back to calling `translateError`
 * (the shape this frente removed) fails loudly instead of passing in green.
 */
function runSignCatch(file: string, e: unknown, handedToPartner: boolean): Ui {
  const ui: Ui = { error: null, unconfirmed: undefined, phase: null, preparedCleared: 0 };
  const deps: Record<string, unknown> = {
    applySignFailure,
    // it.17 (R5 5.2): las superficies 0xFE preguntan PRIMERO si el ledger ya dio
    // veredicto (tefMAX_LEDGER / tefPAST_SEQ) — «prepáralo otra vez», no el
    // ámbar «no pude confirmarlo». Se inyecta la función REAL: este arnés
    // ejecuta el código que se despliega, nunca una copia.
    describeStaleSignature,
    t: en,
    setError: (m: string) => {
      ui.error = m;
    },
    // FlareDemoEarn names the same state setErrorMsg.
    setErrorMsg: (m: string) => {
      ui.error = m;
    },
    setUnconfirmed: (u: UnconfirmedSignature | null) => {
      ui.unconfirmed = u;
    },
    setPhase: (p: string) => {
      ui.phase = p;
    },
    setPrepared: (v: unknown) => {
      if (v === null) ui.preparedCleared += 1;
    },
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  new Function('e', 'handedToPartner', ...names, signCatchBody(file))(
    e,
    handedToPartner,
    ...names.map((n) => deps[n]),
  );
  return ui;
}

const SURFACES: Array<{ label: string; file: string; formPhase: string }> = [
  // The 0xFE rail — the most expensive catch in the repo.
  { label: 'PaActionsModal', file: join(SRC, 'positions', 'PaActionsModal.tsx'), formPhase: 'form' },
  { label: 'FtsoExitModal', file: join(SRC, 'positions', 'FtsoExitModal.tsx'), formPhase: 'form' },
  // Earn shows its form-level errors under the 'error' phase, which renders the form.
  { label: 'FlareDemoEarn', file: join(SRC, 'earn', 'FlareDemoEarn.tsx'), formPhase: 'error' },
];

describe('the shipping catches — a read we could not make never returns to the sign button', () => {
  for (const { label, file, formPhase } of SURFACES) {
    it(`${label}: an unread signature ends amber, with the payload kept`, () => {
      const ui = runSignCatch(file, XAMAN_NO_HASH, true);
      // Shipped behaviour: 'review' — the sign button, one tap from a second
      // dispatch over an operation that may already be executing.
      expect(ui.phase).toBe('unconfirmed');
      expect(ui.error).toBe('');
      expect(ui.unconfirmed).toEqual({ txHash: undefined, trace: null });
      expect(ui.preparedCleared).toBe(0);
    });

    it(`${label}: a timeout after the hand-off is not a failure either`, () => {
      const ui = runSignCatch(file, TIMEOUT, true);
      expect(ui.phase).toBe('unconfirmed');
      expect(ui.unconfirmed?.trace).toBe(
        'Timed out while waiting for transaction receipt. timeout: 180000ms',
      );
      expect(ui.unconfirmed?.trace).not.toMatch(INVITES);
    });

    it(`${label}: a cancelled signature keeps the sign button, calmly`, () => {
      const ui = runSignCatch(
        file,
        Object.assign(new Error('User rejected the request.'), { code: 4001 }),
        true,
      );
      expect(ui.phase).toBe('review');
      expect(ui.unconfirmed).toBeNull();
      expect(ui.error).toMatch(/You cancelled the signature/);
    });

    it(`${label}: a pre-flight throw never claims the wallet had it`, () => {
      const ui = runSignCatch(file, new Error('Connect your XRPL wallet (Xaman) to continue'), false);
      expect(ui.phase).toBe('review');
      expect(ui.unconfirmed).toBeNull();
    });

    it(`${label}: a revert it READ sends the user back for a fresh prepare`, () => {
      const ui = runSignCatch(file, new Error('transaction reverted (0xabc12345678…)'), true);
      expect(ui.phase).toBe(formPhase);
      expect(ui.preparedCleared).toBe(1);
      expect(ui.error).toMatch(/Prepare it again with fresh numbers/);
    });
  }
});

/* ── the panel those phases render ───────────────────────────────────────── */

function renderNotice(props: {
  rail: 'xrpl' | 'evm';
  chainId?: number;
  unconfirmed: UnconfirmedSignature;
}): string {
  return renderToStaticMarkup(
    createElement(UnconfirmedSignatureNotice, { ...props, onClose: () => {} }),
  );
}

describe('UnconfirmedSignatureNotice — the ending the three surfaces now share', () => {
  it('says do NOT sign again, and never invites a retry', () => {
    const xrpl = renderNotice({ rail: 'xrpl', unconfirmed: { trace: null } });
    expect(xrpl).toContain('Do NOT sign it again');
    // The 0xFE price of a second signature is named, because that is what the
    // user is deciding about.
    expect(xrpl).toMatch(/second carrier fee in XRP/);
    expect(xrpl).not.toMatch(INVITES);
    const evm = renderNotice({ rail: 'evm', unconfirmed: { trace: null } });
    expect(evm).toContain('Do NOT sign it again');
    expect(evm).not.toMatch(INVITES);
    // Amber, never the red failure treatment: nothing here says it failed.
    expect(xrpl).toMatch(/amber-500/);
    expect(xrpl).not.toMatch(/tone-danger/);
  });

  it('offers exactly one action, and it is not signing', () => {
    const html = renderNotice({ rail: 'xrpl', unconfirmed: { trace: null } });
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain('Close and refresh my positions');
  });

  it('links the hash when there is one, on the chain it was sent to', () => {
    const eth = renderNotice({ rail: 'evm', chainId: 1, unconfirmed: { txHash: HASH, trace: null } });
    expect(eth).toContain(`https://etherscan.io/tx/${HASH}`);
    const flare = renderNotice({ rail: 'evm', chainId: 14, unconfirmed: { txHash: HASH, trace: null } });
    expect(flare).toContain(`https://flarescan.com/tx/${HASH}`);
    // No hash, no link — never an explorer URL for a transaction we never saw.
    expect(renderNotice({ rail: 'xrpl', unconfirmed: { trace: null } })).not.toContain('<a ');
  });

  it('quotes the diagnostic only when there is something honest to quote', () => {
    // batch-evm (2026-08-20): the label no longer says «What the wallet
    // reported». On a partial execution the quoted line is OUR OWN sentence
    // (partialExecutionError), written precisely so no wallet wording survives
    // into it — attributing it to the wallet invited «well, the wallet is wrong,
    // let me sign again».
    const quoted = renderNotice({
      rail: 'evm',
      unconfirmed: { trace: unconfirmedTrace(TIMEOUT) },
    });
    expect(quoted).toContain('What we know so far:');
    expect(quoted).not.toContain('What the wallet reported:');
    expect(quoted).toContain('Timed out while waiting for transaction receipt');
    // …and the Xaman line this frente suppressed leaves no empty label behind.
    const silent = renderNotice({
      rail: 'xrpl',
      unconfirmed: { trace: unconfirmedTrace(XAMAN_NO_HASH) },
    });
    expect(silent).not.toContain('What we know so far:');
    expect(silent).not.toMatch(/fail/i);
  });
});

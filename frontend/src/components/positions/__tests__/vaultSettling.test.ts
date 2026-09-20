import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  signOutcome,
  signFailureAction,
  unconfirmedTrace,
  dispatchFeeQuote,
  feeXrpDigits,
  freshClaimableAt,
  releaseLine,
} from '../vaultModalTruth';
import { translateError } from '../../../lib/errors/translateError';

/**
 * UI-settling W2-F2 (R6.1 + R8.1) — the two vault modals that ended the story
 * at the SIGNATURE.
 *
 * What was wrong, in the code that shipped:
 *  1. `sign()` did `setPhase('done')` the instant the wallet handed back a
 *     hash. Nothing had been read from the ledger; the mould that already
 *     existed (CouncilOrderCard: 'settling' → 'done' only inside onSettled)
 *     was not applied here.
 *  2. VaultWithdrawModal promised, in the form, that the exact release time
 *     would be "shown before you sign" — and never showed it. The prepare
 *     carries it (`disclosure.queuedExit.claimableAt` = Firelight's on-chain
 *     `currentPeriodEnd()`), and the done-view invented "~24h" instead.
 *  3. VaultClaimModal said "the only cost is the network fee" on BOTH rails —
 *     false on the 0xFE dispatch, which pays a minting fee and an executor fee
 *     in XRP — and rendered those fee rows behind a bare `!= null` guard, so an
 *     unquoted fee became SILENCE. It also decided the success sentence from
 *     the destination toggle alone, never from the rail actually prepared.
 *
 * ROUND 2 — `settling-residuos` (2026-08-18). The residues a sceptical review
 * found on top of that work, all of them in the same family:
 *  4. the catch of `sign()` sent EVERY failure back to 'review' ("prepared
 *     payload still valid — retry the signature"). After a signature that may
 *     already be out, that is an invitation to pay twice: second dispatch,
 *     second carrier XRP, second nonce seat. → `signOutcome`.
 *  5. VaultWithdrawModal still rendered the dispatch's XRP fees behind bare
 *     `!= null` guards (the very asymmetry (3) fixed in its twin), and printed
 *     them with `fmt(x, 2)`, so 0.003 XRP read as "0 XRP" — free.
 *     → `dispatchFeeQuote` + `feeXrpDigits`.
 *  6. the done-view asserted the release date the PREPARE had read, minutes
 *     before the 0xFE executor runs and one period before the exit actually
 *     lands. → `freshClaimableAt` + `releaseLine`.
 *  7. "Fee charged by the vault: none — taken at redeem" was decided by the
 *     rail alone, and the claim's copy inherited "the exit fee was already
 *     taken when you requested the withdrawal" — a charge nobody reads (the
 *     Firelight queued path leaves `instantRedemptionFeeBps` null).
 *
 * ROUND 3 — `settling-final` (2026-08-19). Round 2 built the amber ending and
 * then undermined it in its own last line; a sceptical read named three ways
 * the screen still said more than it knew:
 *  8. the panel quoted `translateError(e, t).message`, and for the two errors
 *     that DOMINATE the unconfirmed state that sentence is «Nothing was signed
 *     and nothing moved — try again in a minute» / «Something went wrong — try
 *     again in a minute», printed under "Do NOT sign it again".
 *     → `unconfirmedTrace` + `signFailureAction`.
 *  9. the hand-off flag flipped when the modal CALLED the wallet partner, and
 *     that call switches chain and estimates gas before any wallet opens — so
 *     a chain-switch failure was announced as a possibly-sent transaction and
 *     left with no way back. → `NEVER_REACHED_WALLET` inside `signOutcome`.
 * 10. `(estimated)` was not an estimate: `currentPeriodEnd()` is the end of the
 *     period BEFORE the one the exit joins, so the modal printed a day with no
 *     Claim button waiting. → `ReleaseLine.floor`.
 * 11. `SignOutcome.'reverted'` had no reader. It has one now, and it is not
 *     decoration: a read revert sends the modal back to the FORM, because the
 *     prepared calldata is spent. → `signFailureAction` view 'form'.
 *
 * The round-2/3 logic lives in `../vaultModalTruth` (plain .ts) and is imported
 * FOR REAL here — these assertions run the shipping functions, not a copy and
 * not a substring. The two round-1 helpers still live inside the .tsx modals,
 * so they keep being pulled OUT of the shipping source and evaluated (the
 * frontend vitest bootstrap is `environment: 'node'`; importing those modules
 * would drag wagmi/AppKit into the test process).
 */

const WITHDRAW = join(__dirname, '..', 'VaultWithdrawModal.tsx');
const CLAIM = join(__dirname, '..', 'VaultClaimModal.tsx');
const withdrawSrc = readFileSync(WITHDRAW, 'utf8');
const claimSrc = readFileSync(CLAIM, 'utf8');

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
 * Extract one exported helper from a component and evaluate it. The body is
 * plain JS on purpose — only the signature carries TS, and it is replaced
 * LITERALLY, so a changed signature fails loudly here instead of silently
 * skipping the test. `deps` injects whatever the helper imports (the fee quote
 * now delegates to the shared module), so the extraction still runs the REAL
 * body instead of forcing a copy of it into the modal.
 */
function loadHelper<T>(
  src: string,
  name: string,
  signature: string,
  jsSignature: string,
  deps: Record<string, unknown> = {},
): T {
  const ts = blockFrom(src, `export function ${name}(`);
  expect(
    ts.startsWith(signature),
    `${name} signature changed — update this test. Got: ${ts.slice(0, 120)}`,
  ).toBe(true);
  const js = ts.replace(signature, jsSignature);
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${js}; return ${name};`)(...names.map((n) => deps[n])) as T;
}

type ExitTiming =
  | { kind: 'instant' }
  | { kind: 'queued'; claimableAt: string }
  | { kind: 'queued-unknown-date' };

const exitTiming = loadHelper<(vault: string, disclosure?: Record<string, unknown>) => ExitTiming>(
  withdrawSrc,
  'exitTiming',
  'export function exitTiming(vault: string, disclosure?: Record<string, unknown>): ExitTiming {',
  'function exitTiming(vault, disclosure) {',
);

type ClaimArrival = 'evm-wallet' | 'smart-account' | 'xrpl-pending';

const claimArrival = loadHelper<(rail: string, dest: string) => ClaimArrival>(
  claimSrc,
  'claimArrival',
  'export function claimArrival(rail: string, dest: string): ClaimArrival {',
  'function claimArrival(rail, dest) {',
);

type ClaimFeeQuote =
  | { kind: 'gas-only' }
  | { kind: 'gas-only-unstated' }
  | { kind: 'quoted'; mintingFeeXrp: number; executorFeeXrp: number }
  | { kind: 'unquoted' };

const claimFeeQuote = loadHelper<
  (rail: string, disclosure?: Record<string, unknown>) => ClaimFeeQuote
>(
  claimSrc,
  'claimFeeQuote',
  'export function claimFeeQuote(rail: string, disclosure?: Record<string, unknown>): ClaimFeeQuote {',
  'function claimFeeQuote(rail, disclosure) {',
  { dispatchFeeQuote },
);

/* ── R6.1 — 'done' belongs to the ledger, not to the signature ───────────── */

describe("R6.1 — the signature opens 'settling'; only onSettled reaches 'done'", () => {
  for (const [label, src] of [
    ['VaultWithdrawModal', withdrawSrc],
    ['VaultClaimModal', claimSrc],
  ] as const) {
    it(`${label} has a settling phase and never promotes itself at signature time`, () => {
      expect(src).toMatch(/type Phase =[^\n]*'settling'/);
      // The old shape — the settlement callback wired straight to the parent
      // refresh, with setPhase('done') sitting in sign()'s happy path.
      expect(src).not.toMatch(/onSettled: onChanged/);
      // 'done' is written in exactly ONE place: the onSettled closure.
      const doneWrites = src.match(/setPhase\('done'\)/g) ?? [];
      expect(doneWrites.length).toBe(1);
      const closure = src.slice(
        src.indexOf('const settled = () => {'),
        src.indexOf('const settled = () => {') + 120,
      );
      expect(closure).toContain("setPhase('done')");
      expect(closure).toContain('onChanged()');
      // Ordering guard: 'settling' is set BEFORE track(), because an EVM
      // handle can arrive already-settled and fire onSettled synchronously.
      const settlingAt = src.indexOf("setPhase('settling')");
      const trackAt = src.indexOf('settlement.track(');
      expect(settlingAt).toBeGreaterThan(-1);
      expect(settlingAt).toBeLessThan(trackAt);
      // The done-view must be reachable while still settling (otherwise the
      // modal goes blank between signature and confirmation).
      expect(src).toMatch(/phase === 'settling' \|\| phase === 'done'/);
    });
  }
});

/* ── R8.1 — Firelight freezes and releases on a DATE ─────────────────────── */

describe('R8.1 — exitTiming: the withdraw copy follows the real vault', () => {
  it('a non-queued vault settles instantly', () => {
    expect(exitTiming('earnxrp', { queuedExit: null })).toEqual({ kind: 'instant' });
    expect(exitTiming('monarq', undefined)).toEqual({ kind: 'instant' });
  });

  it('Firelight reports the date the prepare READ on-chain', () => {
    const at = '2026-08-19T09:30:00.000Z';
    expect(exitTiming('firelight', { queuedExit: { period: 7, claimableAt: at } })).toEqual({
      kind: 'queued',
      claimableAt: at,
    });
  });

  it('a date that could not be read is admitted, never approximated', () => {
    // The prepare answers claimableAt: null when currentPeriodEnd() fails.
    expect(exitTiming('firelight', { queuedExit: { period: 7, claimableAt: null } })).toEqual({
      kind: 'queued-unknown-date',
    });
    expect(exitTiming('firelight', { queuedExit: null })).toEqual({ kind: 'queued-unknown-date' });
    expect(exitTiming('firelight', undefined)).toEqual({ kind: 'queued-unknown-date' });
    // Garbage is not a date either.
    expect(exitTiming('firelight', { queuedExit: { claimableAt: 'soon' } })).toEqual({
      kind: 'queued-unknown-date',
    });
  });

  it('the withdraw modal shows the date it promised, and says so when it has none', () => {
    expect(withdrawSrc).toMatch(/Available to claim from/);
    expect(withdrawSrc).toMatch(/could not be read on-chain/);
    // The invented "~24h" verdict is gone from the settled line.
    expect(withdrawSrc).not.toMatch(
      /Request registered\. Your money enters the ~24h exit queue/,
    );
    expect(withdrawSrc).toMatch(/Request registered\. Your money will be available on/);
    // The form warning and the done-view now read the SAME holder.
    expect(withdrawSrc).not.toMatch(/position\.vault === 'firelight'/);
  });
});

/* ── R8.1 + R5 — the claim tells the truth about where and what it costs ─── */

describe('R8.1 — claimArrival: the success line follows the prepared rail', () => {
  it('an EVM claim lands in the signing wallet', () => {
    expect(claimArrival('evm', 'pa')).toBe('evm-wallet');
    // A stale destination toggle can no longer print the XRPL sentence over an
    // EVM claim (the old code read claimDest alone).
    expect(claimArrival('evm', 'xrpl')).toBe('evm-wallet');
  });

  it('a PA claim lands in the Smart Account, not in "your wallet"', () => {
    expect(claimArrival('xrpl', 'pa')).toBe('smart-account');
  });

  it('a claim redeemed to XRPL is still in flight when Flare confirms', () => {
    expect(claimArrival('xrpl', 'xrpl')).toBe('xrpl-pending');
  });

  it('the claim modal no longer promises the FXRP is in the wallet on every rail', () => {
    expect(claimSrc).toMatch(/Claim settled — the FXRP is in your Smart Account on Flare\./);
    expect(claimSrc).not.toMatch(/claimDest === 'xrpl'\s*\n?\s*\? t\('Claim confirmed/);
  });
});

describe('R5 — claimFeeQuote: a fee is shown or its absence is said', () => {
  it('the EVM rail pays no protocol fee ONLY when the prepare says so', () => {
    // The route answers `fee: null` on this rail — that is the statement.
    expect(claimFeeQuote('evm', { fee: null })).toEqual({ kind: 'gas-only' });
    // settling-residuos: without that field nobody has read anything, so the
    // screen may not reassure. "none — taken at redeem" used to be printed
    // from the RAIL alone.
    expect(claimFeeQuote('evm', {})).toEqual({ kind: 'gas-only-unstated' });
    expect(claimFeeQuote('evm', undefined)).toEqual({ kind: 'gas-only-unstated' });
  });

  it('the 0xFE dispatch shows the figures the prepare carried', () => {
    expect(claimFeeQuote('xrpl', { mintingFeeXrp: 0.02, executorFeeXrp: 0.1 })).toEqual({
      kind: 'quoted',
      mintingFeeXrp: 0.02,
      executorFeeXrp: 0.1,
    });
    // Zero is a READ figure, not a missing one.
    expect(claimFeeQuote('xrpl', { mintingFeeXrp: 0, executorFeeXrp: 0 })).toEqual({
      kind: 'quoted',
      mintingFeeXrp: 0,
      executorFeeXrp: 0,
    });
  });

  it('a fee that was not quoted is NOT silence', () => {
    expect(claimFeeQuote('xrpl', { mintingFeeXrp: 0.02 })).toEqual({ kind: 'unquoted' });
    expect(claimFeeQuote('xrpl', {})).toEqual({ kind: 'unquoted' });
    expect(claimFeeQuote('xrpl', undefined)).toEqual({ kind: 'unquoted' });
    // NaN is what a bad Number() gives back — it must not read as a quote.
    expect(claimFeeQuote('xrpl', { mintingFeeXrp: Number.NaN, executorFeeXrp: 0.1 })).toEqual({
      kind: 'unquoted',
    });
  });

  it('the modal renders the unquoted case instead of dropping the rows', () => {
    expect(claimSrc).toMatch(/feeQuote\?\.kind === 'unquoted'/);
    expect(claimSrc).toMatch(/We could not quote the minting and executor fees/);
    // "the only cost is the network fee" is no longer said on both rails.
    expect(claimSrc).toMatch(/ownerIsEvmWallet\s*\n?\s*\? t\('The withdrawal period ended/);
    expect(claimSrc).toMatch(/it pays a minting fee and an executor fee in XRP/);
  });

  it('settling-residuos: no copy claims a vault fee nobody read', () => {
    // The Firelight queued path never reads instantRedemptionFeeBps, so this
    // sentence asserted a charge that was never looked at.
    expect(claimSrc).not.toMatch(/The exit fee was already taken when you requested the withdrawal/);
    expect(claimSrc).not.toMatch(/none — taken at redeem/);
    expect(claimSrc).toMatch(/gas-only-unstated/);
    expect(claimSrc).toMatch(/not quoted in this prepare/);
  });
});

/* ── settling-residuos 1 — «no pude leer» NO es «falló» ──────────────────── */

const HASH = '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

describe('signOutcome — after a signature, retrying is an offer you only make when you KNOW', () => {
  it('anything thrown before the payload reaches the wallet never left', () => {
    // Our own pre-flight throws are translated prose no pattern could match —
    // that is exactly why the caller passes what it knows.
    expect(signOutcome(new Error('Conecta tu wallet XRPL (Xaman) para continuar'), false)).toEqual({
      kind: 'not-sent',
    });
    expect(signOutcome(new Error('anything at all'), false)).toEqual({ kind: 'not-sent' });
  });

  it('a Xaman payload that was cancelled or expired never left', () => {
    expect(
      signOutcome(
        new Error('Transaction submission failed: User cancelled transaction submission or payload expired'),
        true,
      ),
    ).toEqual({ kind: 'not-sent' });
    expect(
      signOutcome(
        new Error('Transaction submission failed: Failed to create transaction submission payload'),
        true,
      ),
    ).toEqual({ kind: 'not-sent' });
    // Kept in step with translateError: whatever it calls a user rejection must
    // never end under a panel that says "you may have signed".
    expect(signOutcome(new Error('Cancelled the signing request'), true)).toEqual({
      kind: 'not-sent',
    });
  });

  it('a wallet rejection never left (EIP-1193 4001 and the viem error object)', () => {
    expect(signOutcome(Object.assign(new Error('User rejected the request.'), { code: 4001 }), true)).toEqual({
      kind: 'not-sent',
    });
    expect(
      signOutcome(
        { name: 'UserRejectedRequestError', shortMessage: 'User rejected the request.' },
        true,
      ),
    ).toEqual({ kind: 'not-sent' });
  });

  it('THE regression: a signed Xaman payload whose hash we could not read is UNCONFIRMED', () => {
    // XamanWalletService submits with submit:true and then reads the txid; if
    // that read fails the transaction may be on the ledger already. The shipped
    // code sent this straight back to 'review' — the sign button, one tap away
    // from a second dispatch.
    expect(
      signOutcome(
        new Error('Transaction submission failed: Failed to retrieve transaction hash from payload'),
        true,
      ),
    ).toEqual({ kind: 'unconfirmed' });
  });

  it('the EVM in-flight error keeps its hash so the user can check it', () => {
    const inFlight = Object.assign(
      new Error('Step 1/2 is IN FLIGHT — sent, but not confirmed yet. Do NOT sign it again'),
      { code: 'RECEIPT_UNREAD', txHash: HASH, stepIndex: 0, totalSteps: 2 },
    );
    expect(signOutcome(inFlight, true)).toEqual({ kind: 'unconfirmed', txHash: HASH });
  });

  it('a read timeout after the hand-off is unknown, and unknown is unconfirmed', () => {
    expect(
      signOutcome(new Error('Timed out while waiting for transaction to be confirmed.'), true),
    ).toEqual({ kind: 'unconfirmed' });
    expect(signOutcome(new Error('Failed to fetch'), true)).toEqual({ kind: 'unconfirmed' });
    // The fail-safe direction: an error we cannot read at all is never treated
    // as "nothing happened".
    expect(signOutcome({}, true)).toEqual({ kind: 'unconfirmed' });
    expect(signOutcome(null, true)).toEqual({ kind: 'unconfirmed' });
  });

  it('a revert is a verdict we READ — money did not move, and it is not a cancel', () => {
    expect(signOutcome(new Error('transaction reverted (0xabc12345678…)'), true)).toEqual({
      kind: 'reverted',
    });
    expect(signOutcome({ shortMessage: 'execution reverted: ERC20: insufficient allowance' }, true)).toEqual({
      kind: 'reverted',
    });
  });
});

describe('settling-residuos — both modals stop offering a second signature', () => {
  for (const [label, src] of [
    ['VaultWithdrawModal', withdrawSrc],
    ['VaultClaimModal', claimSrc],
  ] as const) {
    it(`${label} classifies the failure instead of always returning to review`, () => {
      const sign = blockFrom(src, 'async function sign()');
      // The line that shipped, and the assumption behind it, are gone.
      expect(sign).not.toMatch(/prepared payload still valid — retry the signature/);
      expect(sign).toMatch(/signFailureAction\(e, handedToPartner, t\)/);
      // Both rails must declare the hand-off — a rail that forgets it would be
      // classified 'not-sent' forever, which is the bug wearing a new hat.
      const handed = sign.match(/handedToPartner = true/g) ?? [];
      expect(handed.length).toBe(2);
      // settling-final: the catch writes no sentence of its own any more. Every
      // word it puts on screen comes from the function tested below, so the
      // panel can no longer quote a verdict that contradicts its own headline.
      expect(sign).not.toMatch(/translateError\(/);
      expect(sign).toMatch(/setPhase\('unconfirmed'\)/);
      const reviewWrites = sign.match(/setPhase\('review'\)/g) ?? [];
      expect(reviewWrites.length).toBe(1);
    });

    it(`${label} renders the unconfirmed ending, with no path back to the sign button`, () => {
      expect(src).toMatch(/type Phase =[^\n]*'unconfirmed'/);
      expect(src).toMatch(/phase === 'unconfirmed'/);
      expect(src).toMatch(/We could not confirm your signature/);
      expect(src).toMatch(/Do NOT sign it again/);
      // A producer with a consumer: the hash captured by signOutcome is what
      // the explorer link uses.
      expect(src).toMatch(/unconfirmed\.txHash/);
      expect(src).toMatch(/explorerTxUrl\(/);
      // settling-final: the quoted line is the trace, and it is conditional —
      // no trace, no line (the old code always printed a translated verdict).
      expect(src).toMatch(/\{unconfirmed\.trace && \(/);
      expect(src).not.toMatch(/unconfirmed\.detail/);
      // Amber, never the red failure treatment.
      const panel = src.slice(src.indexOf("phase === 'unconfirmed'"));
      expect(panel).toMatch(/amber-500/);
      expect(panel.slice(0, 400)).not.toMatch(/red-500/);
    });
  }
});

/* ── settling-residuos 2+3 — the XRP fees of the withdraw dispatch ───────── */

describe('dispatchFeeQuote — the withdraw twin gets the same R5 rule', () => {
  it('quotes what the prepare carried, zero included', () => {
    expect(dispatchFeeQuote({ mintingFeeXrp: 0.003, executorFeeXrp: 0.4 })).toEqual({
      kind: 'quoted',
      mintingFeeXrp: 0.003,
      executorFeeXrp: 0.4,
    });
    expect(dispatchFeeQuote({ mintingFeeXrp: 0, executorFeeXrp: 0 })).toEqual({
      kind: 'quoted',
      mintingFeeXrp: 0,
      executorFeeXrp: 0,
    });
  });

  it('a half-read or unread quote is said, never silently dropped', () => {
    expect(dispatchFeeQuote({ executorFeeXrp: 0.4 })).toEqual({ kind: 'unquoted' });
    expect(dispatchFeeQuote({ mintingFeeXrp: Number.NaN, executorFeeXrp: 0.4 })).toEqual({
      kind: 'unquoted',
    });
    expect(dispatchFeeQuote({})).toEqual({ kind: 'unquoted' });
    expect(dispatchFeeQuote(undefined)).toEqual({ kind: 'unquoted' });
  });

  it('the withdraw modal renders the quote and the admission — the bare guards are gone', () => {
    expect(withdrawSrc).not.toMatch(/disclosure\?\.mintingFeeXrp != null/);
    expect(withdrawSrc).not.toMatch(/disclosure\?\.executorFeeXrp != null/);
    expect(withdrawSrc).toMatch(/feeQuote\?\.kind === 'quoted'/);
    expect(withdrawSrc).toMatch(/feeQuote\?\.kind === 'unquoted'/);
    expect(withdrawSrc).toMatch(/We could not quote the minting and executor fees/);
  });
});

describe('feeXrpDigits — showing a fee must not be the same as hiding it', () => {
  const shown = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: feeXrpDigits(n) });

  it('a small fee never prints as zero (fmt(0.003, 2) printed "0")', () => {
    expect((0.003).toLocaleString('en-US', { maximumFractionDigits: 2 })).toBe('0'); // the bug
    expect(shown(0.003)).toBe('0.003');
    expect(shown(0.000_25)).toBe('0.00025');
    expect(shown(0.02)).toBe('0.02');
  });

  it('a real zero stays a clean zero, and big fees stay readable', () => {
    expect(shown(0)).toBe('0');
    expect(shown(1.5)).toBe('1.5');
    expect(shown(20.456)).toBe('20.46');
  });

  it('both modals print the XRP fees with that precision', () => {
    for (const src of [withdrawSrc, claimSrc]) {
      expect(src).toMatch(/feeXrpDigits\(feeQuote\.mintingFeeXrp\)/);
      expect(src).toMatch(/feeXrpDigits\(feeQuote\.executorFeeXrp\)/);
      expect(src).not.toMatch(/fmt\(feeQuote\.mintingFeeXrp, 2\)/);
      expect(src).not.toMatch(/fmt\(Number\(disclosure\.mintingFeeXrp\), 2\)/);
    }
  });
});

/* ── settling-residuos 4 — the release date is re-read, or called an estimate */

describe('freshClaimableAt — the date of the exit THIS signature queued', () => {
  const AT_7 = '2026-08-19T09:30:00.000Z';
  const AT_8 = '2026-08-20T09:30:00.000Z';

  it('takes the newest period — the one the redeem just queued', () => {
    expect(
      freshClaimableAt([
        { period: 7, claimableAt: AT_7 },
        { period: 8, claimableAt: AT_8 },
      ]),
    ).toBe(AT_8);
  });

  it('never borrows an older exit\'s date when the new one has none', () => {
    // period 8 is ours and its date is unreadable: answering AT_7 would print
    // a date that belongs to another exit as if it were this money's.
    expect(
      freshClaimableAt([
        { period: 7, claimableAt: AT_7 },
        { period: 8, claimableAt: null },
      ]),
    ).toBeNull();
  });

  it('an empty, missing or malformed queue is null, not a guess', () => {
    expect(freshClaimableAt([])).toBeNull();
    expect(freshClaimableAt(undefined)).toBeNull();
    expect(freshClaimableAt('nope')).toBeNull();
    expect(freshClaimableAt([{ period: 8, claimableAt: 'soon' }])).toBeNull();
    expect(freshClaimableAt([null, { period: 'x', claimableAt: AT_8 }])).toBeNull();
  });
});

describe('releaseLine — only a re-read date may be stated as a fact', () => {
  const PREPARED = '2026-08-19T09:30:00.000Z';
  const REAL = '2026-08-20T09:30:00.000Z';
  const queued = { kind: 'queued', claimableAt: PREPARED } as const;

  it('an instant vault has no date to argue about', () => {
    expect(releaseLine({ kind: 'instant' }, { state: 'idle' })).toEqual({ kind: 'instant' });
  });

  it('the ledger re-read wins — including when it lands a whole period later', () => {
    expect(releaseLine(queued, { state: 'read', claimableAt: REAL })).toEqual({
      kind: 'confirmed',
      at: REAL,
    });
  });

  it('while the re-read is running the screen says so instead of asserting', () => {
    expect(releaseLine(queued, { state: 'reading' })).toEqual({ kind: 'reading' });
  });

  it("a failed re-read demotes the prepare's date to a FLOOR, never a promise", () => {
    // settling-final: not 'estimated'. What the prepare read is
    // `currentPeriodEnd()` and the exit queues into `currentPeriod() + 1`, so
    // that instant is strictly BELOW the release — an estimate would be a
    // known-wrong day with no Claim button waiting on it.
    expect(releaseLine(queued, { state: 'unread' })).toEqual({ kind: 'floor', at: PREPARED });
    expect(releaseLine(queued, { state: 'idle' })).toEqual({ kind: 'floor', at: PREPARED });
    // The confirmed re-read is a whole period later — the gap the old label hid.
    expect(new Date(REAL).getTime()).toBeGreaterThan(new Date(PREPARED).getTime());
  });

  it('no date anywhere stays unknown', () => {
    expect(releaseLine({ kind: 'queued-unknown-date' }, { state: 'unread' })).toEqual({
      kind: 'unknown',
    });
    expect(releaseLine({ kind: 'queued' }, { state: 'unread' })).toEqual({ kind: 'unknown' });
  });

  it('the withdraw modal re-reads the queue on settlement and labels the estimate', () => {
    // Emitter: the settled closure asks the vault-claims endpoint.
    const settled = withdrawSrc.slice(
      withdrawSrc.indexOf('const settled = () => {'),
      withdrawSrc.indexOf('const settled = () => {') + 400,
    );
    expect(settled).toMatch(/rereadReleaseDate\(selected\.owner\)/);
    expect(withdrawSrc).toMatch(/flare-demo\/vault-claims\//);
    expect(withdrawSrc).toMatch(/freshClaimableAt\(/);
    // Consumer: the done-view speaks from releaseLine, not from the prepare.
    expect(withdrawSrc).toMatch(/releaseLine\(timing, claimRead\)/);
    expect(withdrawSrc).toMatch(/release\.kind === 'confirmed'/);
    expect(withdrawSrc).toMatch(/release\.kind === 'floor'/);
    // settling-final: the label that made a known-wrong day printable is gone
    // from both surfaces — the review row and the done-view.
    expect(withdrawSrc).not.toMatch(/Available to claim from \(estimated\)/);
    expect(withdrawSrc).not.toMatch(/treat it as an estimate/);
    expect(withdrawSrc).not.toMatch(/you see the estimated date before signing/);
    expect(withdrawSrc).toMatch(/Current withdrawal period ends/);
    expect(withdrawSrc).toMatch(/Your exit joins the NEXT withdrawal period/);
  });
});

/* ── settling-final — the panel stops contradicting itself ───────────────── */

// translateError writes to console.error by design (it keeps the diagnostic
// out of the user's face); the suite does not need the noise.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** `t` as the app behaves: the English key when untranslated. */
const en = (s: string) => s;
/** …and the Spanish dict for the two lines that decided this bug. */
const ES: Record<string, string> = {
  "We couldn't reach the server. Nothing was signed and nothing moved — try again in a minute.":
    'No hemos podido conectar con el servidor. No se ha firmado ni movido nada — inténtalo en un minuto.',
  'Something went wrong — try again in a minute.': 'Algo ha ido mal — inténtalo en un minuto.',
};
const es = (s: string) => ES[s] ?? s;

const TIMEOUT = new Error('Timed out while waiting for transaction receipt. timeout: 180000ms');
const XAMAN_NO_HASH = new Error(
  'Transaction submission failed: Failed to retrieve transaction hash from payload',
);
/** Any sentence that says "nothing happened, go again" — in either language. */
const INVITES = /try again|nothing was signed|nothing moved|int[eé]ntalo|no se ha firmado/i;

describe('settling-final 1 — under "Do NOT sign it again", nothing may invite a retry', () => {
  it('the premise, asserted: translateError answers BOTH dominant errors with a retry', () => {
    // A Xaman payload timeout and "Failed to retrieve transaction hash from
    // payload" are the two ways this state is reached in production. The panel
    // printed these sentences verbatim under its own warning.
    expect(translateError(TIMEOUT, en).message).toMatch(INVITES);
    expect(translateError(XAMAN_NO_HASH, en).message).toMatch(INVITES);
    // And in Spanish that translated line was the ONLY sentence of the whole
    // panel the reader could understand (the headline keys are not in dict.ts).
    expect(translateError(TIMEOUT, es).message).toMatch(INVITES);
    expect(translateError(XAMAN_NO_HASH, es).message).toMatch(INVITES);
  });

  it('the trace quotes the wallet instead — and never those sentences', () => {
    expect(unconfirmedTrace(TIMEOUT)).toBe(
      'Timed out while waiting for transaction receipt. timeout: 180000ms',
    );
    expect(unconfirmedTrace(TIMEOUT)).not.toMatch(INVITES);
    // familia-no-pude-leer (2026-08-20) closed the residue this assertion used
    // to encode. Quoting Xaman verbatim was only half the fix: its sentence
    // here is a VERDICT about a failed READ ("Transaction submission failed:
    // Failed to retrieve transaction hash from payload"), printed under a
    // headline that says the dispatch may already be out there. The reader
    // believes the concrete-sounding line and signs again. The panel now says
    // nothing at all rather than say it failed.
    expect(unconfirmedTrace(XAMAN_NO_HASH)).toBeNull();
  });

  it('a raw error that invites a retry by itself is dropped, not quoted', () => {
    // Belt and braces: whatever the source, that sentence never appears here.
    expect(unconfirmedTrace(new Error('Service unavailable — try again in a minute.'))).toBeNull();
    expect(unconfirmedTrace(new Error('No se ha firmado ni movido nada'))).toBeNull();
  });

  it('no words at all is no line at all — never an invented one', () => {
    expect(unconfirmedTrace({})).toBeNull();
    expect(unconfirmedTrace(null)).toBeNull();
    expect(unconfirmedTrace('   ')).toBeNull();
    // A viem error keeps the class name, which is the useful half for support.
    expect(
      unconfirmedTrace({
        name: 'TransactionExecutionError',
        shortMessage: 'The request took too long to respond.',
      }),
    ).toBe('TransactionExecutionError · The request took too long to respond.');
    // A plain throw does not get an "Error ·" prefix, and a bare code is kept.
    expect(unconfirmedTrace(new Error('boom'))).toBe('boom');
    expect(unconfirmedTrace({ code: -32603 })).toBe('code -32603');
    // Long wallet dumps are clipped, never allowed to bury the warning.
    const long = unconfirmedTrace(new Error('x'.repeat(400)));
    expect(long).not.toBeNull();
    expect((long as string).length).toBe(180);
    expect((long as string).endsWith('…')).toBe(true);
  });
});

describe('settling-final 2 — the partner refuses before any wallet opens', () => {
  // useWalletPartner.sendIntentCalls guards its input, switches chain and
  // estimates gas BEFORE a wallet ever sees the payload. The caller's flag
  // flips when it calls that function, so these must not read as "sent".
  const PRE_WALLET: Array<[string, unknown]> = [
    [
      'chain not configured in wagmi',
      Object.assign(new Error('Chain "Flare Mainnet" not configured.'), {
        name: 'ChainNotConfiguredError',
      }),
    ],
    [
      'connector cannot switch chains',
      {
        name: 'SwitchChainNotSupportedError',
        shortMessage: 'The connector does not support programmatic chain switching.',
      },
    ],
    [
      'MetaMask -32002: a switch request is already open',
      {
        name: 'SwitchChainError',
        shortMessage: 'An error occurred when attempting to switch chain.',
        details:
          "Request of type 'wallet_switchEthereumChain' already pending for origin https://astryum.xyz.",
      },
    ],
    [
      'the node refuses at estimation: no gas money',
      {
        name: 'TransactionExecutionError',
        shortMessage:
          'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.',
        details: 'insufficient funds for gas * price + value',
      },
    ],
  ];

  for (const [label, e] of PRE_WALLET) {
    it(`${label}: provably unsigned → the sign button comes back`, () => {
      expect(signOutcome(e, true)).toEqual({ kind: 'not-sent' });
      const action = signFailureAction(e, true, en);
      expect(action.view).toBe('review');
      // …and the user is never told a transaction was sent to their wallet.
      expect(action.view === 'review' ? action.message : '').not.toMatch(/sent to your wallet/i);
    });
  }

  it('a popup already holding OUR payload is still unknown, and unknown is unconfirmed', () => {
    // Same -32002, different method: this one IS our transaction request.
    const pending = {
      name: 'TransactionExecutionError',
      shortMessage: 'An internal error was received.',
      details:
        "Request of type 'eth_sendTransaction' already pending for origin https://astryum.xyz.",
    };
    expect(signOutcome(pending, true)).toEqual({ kind: 'unconfirmed' });
    expect(signFailureAction(pending, true, en).view).toBe('unconfirmed');
  });
});

describe('settling-final 3+4 — one decision for the whole catch', () => {
  it('a signature we could not follow: amber ending, hash when there is one', () => {
    const blind = signFailureAction(XAMAN_NO_HASH, true, es);
    // `trace: null` since familia-no-pude-leer: the state is still unconfirmed
    // and the panel still amber — only the wallet's failure verdict is gone.
    expect(blind).toEqual({ view: 'unconfirmed', txHash: undefined, trace: null });

    const inFlight = Object.assign(
      new Error('Step 1/2 is IN FLIGHT — sent, but not confirmed yet. Do NOT sign it again.'),
      { code: 'RECEIPT_UNREAD', txHash: HASH, stepIndex: 0, totalSteps: 2 },
    );
    const followed = signFailureAction(inFlight, true, en);
    expect(followed.view).toBe('unconfirmed');
    expect(followed.view === 'unconfirmed' ? followed.txHash : null).toBe(HASH);
  });

  it('a revert we READ has a reader at last: back to the FORM, because the payload is spent', () => {
    const reverted = new Error('transaction reverted (0xabc12345678…)');
    expect(signOutcome(reverted, true)).toEqual({ kind: 'reverted' });
    const action = signFailureAction(reverted, true, en);
    expect(action.view).toBe('form');
    const message = action.view === 'form' ? action.message : '';
    // It says what happened AND what the honest next step is — signing the very
    // same calldata again would be refused the very same way.
    expect(message).toMatch(/Your money did not move/);
    expect(message).toMatch(/Prepare it again with fresh numbers/);
  });

  it('a deliberate "no" keeps the sign button and stays calm', () => {
    const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    const action = signFailureAction(rejected, true, en);
    expect(action.view).toBe('review');
    expect(action.view === 'review' ? action.message : '').toMatch(/You cancelled the signature/);
  });

  it('nothing was ever handed over: the way back is the sign button, whatever it says', () => {
    // Our own pre-flight throw, already translated — no pattern could classify
    // it, which is why the caller passes what it knows.
    const action = signFailureAction(
      new Error('Conecta tu wallet XRPL (Xaman) para continuar'),
      false,
      es,
    );
    expect(action.view).toBe('review');
  });
});

describe('settling-final — both modals wire that single decision', () => {
  for (const [label, src] of [
    ['VaultWithdrawModal', withdrawSrc],
    ['VaultClaimModal', claimSrc],
  ] as const) {
    it(`${label} routes a read revert to the form instead of the sign button`, () => {
      const sign = blockFrom(src, 'async function sign()');
      expect(sign).toMatch(/action\.view === 'form'/);
      expect(sign).toMatch(/setPrepared\(null\)/);
      expect(sign).toMatch(/setPhase\('form'\)/);
    });
  }
});

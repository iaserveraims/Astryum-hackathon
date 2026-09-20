/**
 * signOutcome — what happened to a signature we could not follow, and what a
 * screen is allowed to do about it. Frente `familia-no-pude-leer`.
 */

import { isUserRejection } from './flareChain';
import { isInFlight, inFlightInfo } from './inFlightError';
import { translateError } from '../errors/translateError';

/* ── what happened to a signature we could not follow ────────────────────── */

export type SignOutcome =
  /** Provably nothing left: never handed to the wallet, rejected, cancelled,
   *  expired. Retrying is the correct offer. */
  | { kind: 'not-sent' }
  /** Mined and reverted — we READ that verdict. Money did not move (gas did),
   *  so going back is safe, but it is not "you cancelled" either. */
  | { kind: 'reverted' }
  /**
   * THE PREPARED TRANSACTION IS DEAD.
   *
   * The XRPL node answered `tefMAX_LEDGER` (its LastLedgerSequence passed) or
   * `tefPAST_SEQ` (its Sequence was already consumed). Nothing moved and nothing
   * was charged, but THIS payload can never validate: signing it again can only
   * get the same answer forever. The way forward is the parent's prepare.
   *
   * It used to arrive here as plain 'unconfirmed' — «we could not confirm it,
   * reload» — on every 0xFE surface except `XamanSingleSign`, which no 0xFE
   * uses: the dead end of the flagship rail.
   */
  | { kind: 'stale'; code: string }
  /** Signed, or possibly signed, with no confirmation. NEVER offer to sign
   *  again from this state. */
  | { kind: 'unconfirmed'; txHash?: string };

/**
 * Messages that PROVE the operation never reached a ledger. Everything else,
 * once the payload was handed to the wallet, is unknown — and unknown resolves
 * to 'unconfirmed' on purpose. Being wrong here in the safe direction costs a
 * closed modal; being wrong in the other direction costs a double exit.
 *
 * Sources of these strings: XamanWalletService.submitTransaction (cancelled /
 * expired / no account / payload not created), useWalletPartner (the
 * *_NOT_CONNECTED and NO_CALLS guards) and EIP-1193 / viem rejections.
 */
const NEVER_LEFT: RegExp[] = [
  /UserRejectedRequestError/i,
  /user (rejected|denied|cancelled|canceled)/i,
  /rejected the request/i,
  /cancelled by (the )?user/i,
  /cancelled transaction submission/i,
  // Kept in step with translateError's own rejection test, so the panel can
  // never say "you may have signed" under a sentence that says "you cancelled".
  /cancell?ed .*(signature|signing|submission)/i,
  /(payload|request|session) expired/i,
  /declined/i,
  /WALLET_PARTNER_NOT_CONNECTED/,
  /NO_CALLS/,
  /no account connected/i,
  /failed to create transaction submission payload/i,
  /**
   * THE QUORUM CEREMONY'S OWN «NOTHING LEFT».
   *
   * `sendIntent` routes a quorum account to the ceremony bus, and the bus
   * rejects with its own codes: ABANDONED (the dialog was closed while the
   * signatures were still being collected — the bus only says this BEFORE the
   * flow committed to a broadcast; after that it answers with the hash or an
   * in-flight error, see `quorumCeremonyBus`), NO_HOST (no ceremony surface is
   * mounted: nothing was ever shown) and BUSY (another sitting holds the bus:
   * this one never started). None of them matched here, so every one of the 27
   * surfaces that read through `applySignFailure` painted the amber «the
   * transaction may already be out there — do NOT sign it again» over a close
   * the server had just answered by handing the seat back. Three claims, all
   * false, and the opposite of what the server holds.
   */
  /QUORUM_CEREMONY_(ABANDONED|NO_HOST|BUSY)/,
];

/**
 * settling-final · blocker 2 — the pre-signature stage of the wallet partner.
 *
 * `handedToPartner` is the honest name of what the caller knows: it called
 * `useWalletPartner.sendIntentCalls`. That function is not a hand-off, it is a
 * sequence — connection guard, `NO_CALLS`, `switchChainAsync`, and only THEN
 * `sendTransactionAsync`, which itself estimates gas before a wallet window
 * exists. Everything the partner can refuse before that window is enumerated
 * here (the first two guards already live in NEVER_LEFT):
 */
const NEVER_REACHED_WALLET: RegExp[] = [
  /SwitchChain(NotSupported)?Error/i,
  /ChainNotConfiguredError/i,
  /chain not configured/i,
  /wallet_(switch|add)EthereumChain/i,
  /unrecognized chain/i,
  /InsufficientFundsError/i,
  /insufficient funds/i,
  /exceeds the balance of the account/i,
];

/**
 * Verdicts we READ from the chain: it ran and it failed.
 *
 * familia-no-pude-leer · residue A: the word alone is the evidence. viem does
 * not always say "execution reverted" — a contract revert arrives as `The
 * contract function "redeem" reverted with the following reason: …`, and the
 * old pair of literals did not recognise it, so the reason string decided the
 * outcome instead. (Same test `translateError` already applies, one word wider.)
 */
const READ_AS_FAILED = /\breverted\b/i;

/**
 * THE ENGINE RESULTS THAT KILL A PREPARED PAYLOAD.
 *
 * The two codes travel three ways and all three are read here, because the one
 * that actually reaches the 0xFE surfaces is the THIRD:
 */
const STALE_ENGINE_RESULT = /\b(tefMAX_LEDGER|tefPAST_SEQ)\b/;

/** The stale engine result this failure carries, or null. Reads the field first. */
export function staleEngineResult(e: unknown): string | null {
  const tagged = (e as { xrplResult?: unknown } | null)?.xrplResult;
  if (typeof tagged === 'string' && STALE_ENGINE_RESULT.test(tagged)) {
    return STALE_ENGINE_RESULT.exec(tagged)?.[1] ?? null;
  }
  const found = STALE_ENGINE_RESULT.exec(errText(e));
  return found ? found[1] : null;
}

/**
 * `describeStaleHandoff` — THE ONE SENTENCE EVERY 0xFE SURFACE SHOWS when the
 * prepared payment came back `tefMAX_LEDGER` / `tefPAST_SEQ`.
 *
 * Exported for the exit surfaces (PoteExitCard, VaultClaimModal, PaActionsModal,
 * LegacyYieldPanel, the wallet transfer modals): they all used to print «we
 * could not confirm it — reload», which is the one thing that is NOT true here.
 * Nothing moved, nothing was charged, and the nonce seat is not lost either: it
 * frees itself when its own ledger window passes.
 *
 * Returns null when the failure is not a stale one, so a caller can write
 * `describeStaleHandoff(e, t) ?? <its usual reading>`.
 */
export function describeStaleHandoff(
  e: unknown,
  t: (s: string) => string,
): { code: string; message: string } | null {
  const code = staleEngineResult(e);
  if (!code) return null;
  const why =
    code === 'tefPAST_SEQ'
      ? t('its account already used that sequence number')
      : t('its ledger window passed before it was signed');
  return {
    code,
    message: `${t('This prepared transaction can no longer be used —')} ${why}. ${t('Nothing moved and nothing was charged. Prepare it again: signing this one would be answered the same way. Its seat frees itself when its ledger window passes.')}`,
  };
}

function errText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e == null) return '';
  const x = e as { name?: string; shortMessage?: string; details?: string; message?: string };
  const parts = [x.name, x.shortMessage, x.details, x.message].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : String(e);
}

/**
 * Classify a failure of the signature step.
 *
 * `handedToPartner` is knowledge the caller HAS and a message never carries:
 * false until the payload is actually passed to the wallet partner (Xaman /
 * the EVM hook). Our own pre-flight throws ("connect your wallet…") are
 * translated prose that no pattern could match, and telling someone "you may
 * have signed" when no wallet ever opened would be its own lie. What the
 * partner refuses BEFORE opening a wallet is subtracted by NEVER_REACHED_WALLET
 * — the caller cannot see that boundary from outside the call.
 */
export function signOutcome(e: unknown, handedToPartner: boolean): SignOutcome {
  // A verdict the NETWORK pronounced outranks everything else,
  // including whether we think the payload reached the wallet — a tef* answer
  // only exists because it did. Checked first so no inference can bury it.
  const stale = staleEngineResult(e);
  if (stale) return { kind: 'stale', code: stale };
  if (!handedToPartner) return { kind: 'not-sent' };
  // The sequential EVM rail already speaks this language (RECEIPT_UNREAD):
  // sent, receipt unread, do not sign again — and it carries the hash to check.
  if (isInFlight(e)) {
    const hash = inFlightInfo(e)?.txHash;
    return hash ? { kind: 'unconfirmed', txHash: hash } : { kind: 'unconfirmed' };
  }
  const raw = errText(e);
  // A deliberate "no" and the payload that was never created are proofs, not
  // guesses: they stay first.
  if (isUserRejection(e) || NEVER_LEFT.some((re) => re.test(raw))) {
    return { kind: 'not-sent' };
  }
  // familia-no-pude-leer · residue A: what the chain ANSWERED outranks what we
  // infer about where the payload stopped. "insufficient funds" is both a
  // gas-estimation refusal and a perfectly common revert reason; when the same
  // text also says "reverted", the code ran, and offering the very same
  // calldata back to the sign button would be refused the very same way.
  if (READ_AS_FAILED.test(raw)) return { kind: 'reverted' };
  if (NEVER_REACHED_WALLET.some((re) => re.test(raw))) return { kind: 'not-sent' };
  // Timeouts, dropped RPCs, "Failed to retrieve transaction hash from payload"
  // (Xaman already submitted with submit:true) — all of them mean we do not
  // know, and not knowing is not failing.
  return { kind: 'unconfirmed' };
}

/**
 * Sentences that offer a retry or deny that anything moved. Under an
 * 'unconfirmed' headline they are the single most expensive thing this product
 * can print, so no text carrying them is ever shown there — not even as a
 * quoted diagnostic. (English is what the wallet layer speaks; the Spanish
 * forms are the ones our own translated throws would carry.)
 */
const RETRY_INVITATION: RegExp[] = [
  /try again/i,
  /int[eé]ntal[oa]|vuelve a intentar|prueba otra vez/i,
  /nothing (was |has )?(signed|moved|happened)/i,
  /no se (ha )?(firmado|movido)|nada se ha movido/i,
];

/**
 * familia-no-pude-leer · residue B — words that pronounce the verdict the
 * headline just refused to pronounce.
 */
const READS_AS_A_VERDICT: RegExp[] = [
  /\bfail(ed|ure|s|ing)?\b/i,
  /\bunsuccessful\b/i,
  /\bdid ?n[o']?t go through\b/i,
  /fall[oó]|ha fallado|no se pudo|no ha podido/i,
];

/** Raw wallet/library text, without the "Error ·" noise of a plain throw. */
function traceText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e == null) return '';
  const x = e as {
    name?: string;
    shortMessage?: string;
    details?: string;
    message?: string;
    code?: unknown;
  };
  const parts: string[] = [];
  if (typeof x.name === 'string' && x.name && x.name !== 'Error') parts.push(x.name);
  const body = x.shortMessage ?? x.details ?? x.message;
  if (typeof body === 'string' && body) parts.push(body);
  if (parts.length === 0 && (typeof x.code === 'string' || typeof x.code === 'number')) {
    parts.push(`code ${x.code}`);
  }
  return parts.join(' · ');
}

/**
 * settling-final · blocker 1 — what the 'unconfirmed' panel may quote.
 *
 * VERBATIM, never a verdict. `translateError` exists to turn a failure into a
 * sentence a person can act on, and its likeliest sentences here are written
 * for a state we KNOW: "nothing moved", "try again in a minute". Quoted under
 * a headline that says the transaction may already be out there and must not
 * be signed again, those sentences do not inform — they contradict, and the
 * user believes the last thing they read. So the panel gets the wallet's own
 * words, clipped, and nothing at all when there are none, when they would read
 * as an invitation to retry, or when they read as a verdict.
 */
export function unconfirmedTrace(e: unknown): string | null {
  const raw = traceText(e).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (RETRY_INVITATION.some((re) => re.test(raw))) return null;
  if (READS_AS_A_VERDICT.some((re) => re.test(raw))) return null;
  return raw.length > 180 ? `${raw.slice(0, 179)}…` : raw;
}

/**
 * What the modal must DO after a failed signature — one decision, shared by
 * every surface that signs, and testable without React.
 *
 *  - 'unconfirmed' → the amber ending: no way back to the sign button, the
 *    hash to check when there is one, and a verbatim trace (or none).
 *  - 'form'        → the chain READ it and refused. Nothing moved but the gas,
 *    and the prepared payload is spent: offering the very same calldata to be
 *    signed again would be refused the same way, so the honest offer is a
 *    fresh prepare. (settling-final · blocker 4: 'reverted' was produced and
 *    read by nobody — both twins folded it into the plain way back.)
 *  - 'review'      → provably nothing left; the prepared payload is still good
 *    and the sign button is the right offer.
 */
export type SignFailureAction =
  | { view: 'unconfirmed'; txHash?: string; trace: string | null }
  | { view: 'form'; message: string }
  | { view: 'review'; message: string };

export function signFailureAction(
  e: unknown,
  handedToPartner: boolean,
  t: (s: string) => string,
): SignFailureAction {
  const outcome = signOutcome(e, handedToPartner);
  if (outcome.kind === 'unconfirmed') {
    return { view: 'unconfirmed', txHash: outcome.txHash, trace: unconfirmedTrace(e) };
  }
  // The prepared payload is dead, so the honest offer is the
  // same one 'reverted' gets — back to the form, prepared payload dropped — with
  // the sentence that says the seat is not lost either.
  if (outcome.kind === 'stale') {
    const stale = describeStaleHandoff(e, t);
    return { view: 'form', message: stale ? stale.message : translateError(e, t).message };
  }
  if (outcome.kind === 'reverted') {
    return {
      view: 'form',
      message: `${translateError(e, t).message} ${t('Prepare it again with fresh numbers — signing the same payload would be rejected the same way.')}`,
    };
  }
  return { view: 'review', message: translateError(e, t).message };
}

/** The state a surface owns after a signature it could not follow. */
export interface UnconfirmedSignature {
  txHash?: string;
  trace: string | null;
}

/**
 * The setters a sign() catch drives. `setPhase` receives the VIEW, so a surface
 * whose phase names differ (FlareDemoEarn shows its form errors under an
 * 'error' phase) maps it once, at the call site, in plain sight.
 */
export interface SignFailureHandlers {
  setError: (message: string) => void;
  setUnconfirmed: (u: UnconfirmedSignature | null) => void;
  setPhase: (view: SignFailureAction['view']) => void;
  /** Only called for 'form': the prepared payload is spent, drop it. */
  clearPrepared?: () => void;
}

/**
 * The whole catch of a sign(), once.
 *
 * Every surface that signs was ending its catch the same way —
 * `setError(translateError(e, t).message); setPhase('review')`, i.e. "retry the
 * signature" — and each one had to be fixed separately, which is precisely how
 * three of them were still saying it a month after the vault stopped. The
 * decision (`signFailureAction`) and its APPLICATION now travel together, so a
 * new signing surface cannot get the ordering wrong: no error text under the
 * amber ending, no stale amber panel under a plain error, and the prepared
 * payload dropped only where it is genuinely spent.
 */
export function applySignFailure(
  e: unknown,
  handedToPartner: boolean,
  t: (s: string) => string,
  ui: SignFailureHandlers,
): SignFailureAction {
  return applySignAction(signFailureAction(e, handedToPartner, t), ui);
}

/**
 * The APPLICATION half of `applySignFailure`, for a rail that already holds the
 * decided action — the XRPL `sendIntent` rail reads the ledger after Xaman says
 * «signed» (`lib/xrpl/ledgerSignOutcome`), and a verdict it READ is not a
 * message to classify. Same ordering rules, kept in one place.
 */
export function applySignAction(action: SignFailureAction, ui: SignFailureHandlers): SignFailureAction {
  if (action.view === 'unconfirmed') {
    // No red error line beside the amber panel: two verdicts, one screen, and
    // the red one is always the one that reads as "it failed, go again".
    ui.setError('');
    ui.setUnconfirmed({ txHash: action.txHash, trace: action.trace });
    ui.setPhase('unconfirmed');
    return action;
  }
  ui.setUnconfirmed(null);
  ui.setError(action.message);
  if (action.view === 'form') ui.clearPrepared?.();
  ui.setPhase(action.view);
  return action;
}

/**
 * singleSignVerdict — what `XamanSingleSign` may do once Xaman says «signed».
 *
 * Xaman's `meta.signed` is the WALLET's word, not the ledger's. The payload is
 * created with `submit: true`, so by the time it reads «signed» Xaman has
 * already broadcast the transaction — and every caller of the component acts on
 * `onSettled` as if it were done (relaying an FDC proof, marking a step
 * complete). Calling it on «signed» alone was the unearned-success family: a
 * tx the network refused, or one that validated as `tec*`, was relayed and
 * painted as done.
 */

import { classifyXrplResult } from './txResult';
import type { XamanCancelAction } from '../xaman/payloadBus';

export type SingleSignVerdict =
  /** Xaman returned a hash and nothing proves a refusal: ask the ledger. */
  | { kind: 'await-validation'; txid: string }
  /** Validated with tesSUCCESS — the only verdict that settles. */
  | { kind: 'settled'; txid: string }
  /** tem/tef/tel: refused before entering any ledger. Nothing moved. */
  | { kind: 'refused'; code: string }
  /**
   * tefPAST_SEQ / tefMAX_LEDGER on a PINNED order: this exact transaction can
   * never validate (its Sequence was consumed, or its LastLedgerSequence passed).
   * Nothing moved through THIS tx, but signing the same payload again can only
   * answer the same — the way forward is the parent's prepare. Not retryable.
   */
  | { kind: 'stale'; code: string; txid?: string }
  /** Validated with a non-success result: applied, fee and sequence spent. */
  | { kind: 'failed-onchain'; code: string; txid: string }
  /** Signed, outcome unknown. Never settles, never offers a second signature. */
  | { kind: 'unconfirmed'; reason: 'no-hash' | 'not-validated'; txid?: string };

/**
 * The dispatched results that mean a PINNED transaction can never validate:
 * its Sequence was already consumed (another tx took the seat — possibly the
 * sibling payload of the same order) or its LastLedgerSequence passed.
 */
const STALE_CODES: ReadonlySet<string> = new Set(['tefPAST_SEQ', 'tefMAX_LEDGER']);

/** The sentence a stale verdict shows — one wording for the component and the banner. */
export const STALE_TX_MESSAGE =
  'This prepared transaction can no longer be used (its ledger window or sequence passed) — prepare it again';

/* ── A stale COUNCIL ORDER: ask what happened to the order first ──── */

/**
 * The 32-byte commitment memo of a council order (uppercase hex, no 0x), or
 * null when the transaction is not one: a Payment whose first memo is exactly
 * 64 hex characters. Accepts the tx object or its serialized form (the
 * registry's `txKey`). A 0xFE instruction (memo `FE…`, longer) is NOT one.
 */
export function councilOrderMemoOf(tx: unknown): string | null {
  let obj: unknown = tx;
  if (typeof tx === 'string') {
    try {
      obj = JSON.parse(tx);
    } catch {
      return null;
    }
  }
  const t = obj as { TransactionType?: unknown; Memos?: Array<{ Memo?: { MemoData?: unknown } }> } | null;
  if (!t || typeof t !== 'object' || t.TransactionType !== 'Payment' || !Array.isArray(t.Memos)) return null;
  const memo = t.Memos[0]?.Memo?.MemoData;
  return typeof memo === 'string' && /^[0-9A-Fa-f]{64}$/.test(memo) ? memo.toUpperCase() : null;
}

/**
 * What a 'stale' council order may offer, once the server said what became of
 * the ORDER (not of this one payload).
 */
export type StaleOrderFate =
  | { kind: 'checking' }
  | { kind: 'already-out'; txHash?: string }
  | { kind: 'prepare-again' }
  | { kind: 'out-failed'; txHash?: string; detail?: string }
  | { kind: 'unchecked' };

/** The fate read, structurally (lib/institutional/api `readCouncilOrderFate`). */
export type CouncilOrderFateReadLike =
  | { ok: true; fate: { state: string; xrplTxHash?: string; detail?: string } }
  | { ok: false };

export function staleOrderFate(read: CouncilOrderFateReadLike): StaleOrderFate {
  if (!read.ok) return { kind: 'unchecked' };
  const { state, xrplTxHash, detail } = read.fate;
  switch (state) {
    case 'validated':
    case 'relaying':
    case 'executed':
      return { kind: 'already-out', ...(xrplTxHash ? { txHash: xrplTxHash } : {}) };
    case 'composed':
    case 'unknown':
      return { kind: 'prepare-again' };
    case 'failed':
      return { kind: 'out-failed', ...(xrplTxHash ? { txHash: xrplTxHash } : {}), ...(detail ? { detail } : {}) };
    default:
      return { kind: 'unchecked' };
  }
}

export const STALE_CHECKING_MESSAGE =
  'This prepared transaction can no longer be used — checking whether another request of this same order already went out…';
export const STALE_ALREADY_OUT_MESSAGE =
  'Another request of this same order was already signed and is being delivered — do not prepare it again';
export const STALE_OUT_FAILED_MESSAGE =
  'Another request of this same order already went out and did not complete — check it before preparing anything again';
export const STALE_UNCHECKED_MESSAGE =
  'Could not check whether this order already went out — check before preparing again';

/**
 * The English sentence (to pass through `t`) a stale verdict shows. No fate =
 * not a council order: the plain «prepare it again».
 */
export function staleSentence(fate: StaleOrderFate | undefined): string {
  switch (fate?.kind) {
    case 'checking':
      return STALE_CHECKING_MESSAGE;
    case 'already-out':
      return STALE_ALREADY_OUT_MESSAGE;
    case 'out-failed':
      return STALE_OUT_FAILED_MESSAGE;
    case 'unchecked':
      return STALE_UNCHECKED_MESSAGE;
    default:
      return STALE_TX_MESSAGE;
  }
}

/** Only a council order whose fate says nothing of it went out may be prepared again. */
export function staleOffersPrepareAgain(fate: StaleOrderFate | undefined): boolean {
  return fate === undefined || fate.kind === 'prepare-again';
}

/**
 * Is this dispatched / engine result one that says a PINNED transaction can
 * never validate? The ceremony reads the same two codes the single-sign rail
 * does (its broadcast answers `engine_result`), so the rule lives once.
 */
export function isStaleDispatch(code: string | null | undefined): boolean {
  return STALE_CODES.has((code ?? '').trim());
}

/**
 * 'STALE' MUST REACH THE PARENT.
 *
 * `staleOffersPrepareAgain` existed and nothing in production read it: the
 * signing component said «another request of this same order already went out»
 * and its PARENT stayed free to compose the order again — the second movement
 * of the same capital, one level up, exactly the hole the sentence describes.
 */
export function nextStaleOrderLock(
  current: StaleOrderFate | null,
  reported: StaleOrderFate | undefined,
): StaleOrderFate | null {
  if (reported === undefined) return current;
  if (staleOffersPrepareAgain(reported)) {
    // 'prepare-again' after a 'checking' of the same order: nothing went out.
    return current === null || current.kind === 'checking' ? null : current;
  }
  if (reported.kind === 'checking' && current !== null && current.kind !== 'checking') return current;
  return reported;
}

/* ── WHAT IS BEING COMPOSED — an exit is warned, never stopped ─ */

/**
 * OUR OWN REGRESSION: THE LOCK WAS GATING EXITS.
 *
 * The lock paused EVERYTHING a console composes. That contradicts the
 * rule the same commit wrote into the backend and into INVARIANTS: **an exit is
 * warned, never stopped** — not by a record, not by a database, not by a region,
 * not by a stranger and not by a screen of ours. A council whose stale order may
 * have a sibling in flight still has to be able to pull its capital out.
 */
export type ComposeKind = 'exit' | 'other';

/**
 * The council-order / console actions that take capital OUT. Kept as one list so
 * six consoles cannot disagree about what an exit is. Anything unknown is
 * 'other' on purpose: a new action is not silently exempted from the lock.
 */
const EXIT_COMPOSE_ACTIONS: ReadonlySet<string> = new Set([
  'recall',
  'evacuate',
  'creator-exit',
  'pote-exit',
  'exit',
  'redeem',
  'withdraw',
  'pull-out',
  'pullout',
  'unmint',
  'claim',
  'out',
]);

export function isExitComposeAction(action: string | null | undefined): boolean {
  return EXIT_COMPOSE_ACTIONS.has((action ?? '').trim().toLowerCase());
}

/** What a console is about to compose, from the action it is composing. */
export function composeKindOf(action: string | null | undefined): ComposeKind {
  return isExitComposeAction(action) ? 'exit' : 'other';
}

/**
 * Does a held lock STOP this compose? The whole rule, in one pure function:
 *
 *   · no lock                      → no.
 *   · an EXIT                      → no, ever. It is warned (the note renders).
 *   · 'unchecked'                  → no. We could not check; we do not ask the
 *                                     person to assert it for us.
 *   · an explicit confirmation     → no. «Compose it again anyway» is the
 *                                     person's own decision, taken in front of
 *                                     the warning — it used to be a dead button
 *                                     because every compose returned early.
 *   · anything else, non-exit      → yes.
 */
export function staleLockBlocks(
  lock: StaleOrderFate | null,
  kind: ComposeKind,
  opts?: { confirmed?: boolean },
): boolean {
  if (lock === null) return false;
  if (opts?.confirmed === true) return false;
  if (kind === 'exit') return false;
  if (lock.kind === 'unchecked') return false;
  return true;
}

/** The line the paused parent shows under the sentence, per fate. */
export const STALE_LOCK_HEADLINE = 'Composing this order again is paused';
/**
 * The same note when it does NOT pause anything: a verdict we could not check,
 * or a console whose only live doors are exits. It warns and says so — «paused»
 * over a door that works is its own lie.
 */
export const STALE_LOCK_WARNING_HEADLINE = 'Check this before composing another order';
/** Said under either headline: a withdrawal is never held back by this note. */
export const STALE_LOCK_EXIT_NOTE =
  'Taking capital out is never paused by this — an exit is warned, never stopped.';

/** Which headline the note carries: it depends on whether it is actually pausing. */
export function staleLockHeadline(pausing: boolean): string {
  return pausing ? STALE_LOCK_HEADLINE : STALE_LOCK_WARNING_HEADLINE;
}

/* ── The lock survives F5 ─────────────────────────────────── */

/**
 * A RELOAD USED TO DROP THE LOCK IN SILENCE.
 *
 * The lock lived in React state only, so F5 (or opening the console in a second
 * tab of the same session) forgot that a sibling of this order may be on its way
 * — and the console composed it again with no warning at all. It is now written
 * to `sessionStorage`, KEYED BY THE ORDER'S MEMO so two different orders never
 * overwrite each other's verdict, and restored on mount.
 *
 * Pure and injectable: the store is a parameter, so the rule is tested without a
 * browser. A store that throws (private window, storage disabled) is treated as
 * absent — the lock then behaves exactly as it did before, never worse.
 */
export const STALE_LOCK_STORAGE_KEY = 'astryum.staleOrderLock.v1';
/** How many memos are remembered; the oldest is forgotten first. */
const STALE_LOCK_MEMORY = 10;

export interface StaleLockStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredStaleLock {
  /** The 32-byte council-order memo, when the surface knew it. */
  memo: string | null;
  fate: StaleOrderFate;
}

const LOCKABLE_KINDS: ReadonlySet<string> = new Set(['already-out', 'out-failed', 'unchecked', 'checking']);

function sanitizeStored(raw: unknown): StoredStaleLock[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredStaleLock[] = [];
  for (const item of raw) {
    const e = item as { memo?: unknown; fate?: { kind?: unknown; txHash?: unknown; detail?: unknown } };
    const kind = e?.fate?.kind;
    if (typeof kind !== 'string' || !LOCKABLE_KINDS.has(kind)) continue;
    const fate = { kind } as StaleOrderFate;
    if (typeof e.fate?.txHash === 'string' && (kind === 'already-out' || kind === 'out-failed')) {
      (fate as { txHash?: string }).txHash = e.fate.txHash;
    }
    if (typeof e.fate?.detail === 'string' && kind === 'out-failed') {
      (fate as { detail?: string }).detail = e.fate.detail;
    }
    out.push({ memo: typeof e.memo === 'string' && e.memo ? e.memo : null, fate });
  }
  return out.slice(-STALE_LOCK_MEMORY);
}

/** Every remembered lock of this session, oldest first. Never throws. */
export function readStoredStaleLocks(store: StaleLockStoreLike | null | undefined): StoredStaleLock[] {
  if (!store) return [];
  try {
    const raw = store.getItem(STALE_LOCK_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeStored(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** The lock a console restores on mount: the newest one remembered, or null. */
export function restoredStaleLock(store: StaleLockStoreLike | null | undefined): StaleOrderFate | null {
  const all = readStoredStaleLocks(store);
  // 'checking' is never restored: nothing is reading the fate any more, so the
  // spinner would be a permanent lie — and it blocks nothing on its own.
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (all[i].fate.kind !== 'checking') return all[i].fate;
  }
  return null;
}

/**
 * Remember (or forget) the lock of one memo. `fate === null` forgets it. A memo
 * we do not know is stored under the null key — one slot, overwritten — because
 * a lock we cannot attribute is still a lock.
 */
export function writeStoredStaleLock(
  store: StaleLockStoreLike | null | undefined,
  memo: string | null | undefined,
  fate: StaleOrderFate | null,
): void {
  if (!store) return;
  const key = typeof memo === 'string' && memo ? memo.toUpperCase() : null;
  const kept = readStoredStaleLocks(store).filter((e) => e.memo !== key);
  if (fate !== null && fate.kind !== 'checking') kept.push({ memo: key, fate });
  try {
    if (kept.length === 0) store.removeItem(STALE_LOCK_STORAGE_KEY);
    else store.setItem(STALE_LOCK_STORAGE_KEY, JSON.stringify(kept.slice(-STALE_LOCK_MEMORY)));
  } catch {
    /* storage refused: the in-memory lock still stands */
  }
}

/** The person said they checked: nothing of this session stays paused. */
export function clearStoredStaleLocks(store: StaleLockStoreLike | null | undefined): void {
  if (!store) return;
  try {
    store.removeItem(STALE_LOCK_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** `sessionStorage`, or null where there is none (SSR, private window, blocked). */
export function defaultStaleLockStore(): StaleLockStoreLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function decideAfterSigned(input: {
  txid?: string | null;
  dispatched?: string | null;
}): SingleSignVerdict {
  const txid = (input.txid ?? '').trim();
  // Checked FIRST, on purpose: without a hash there is nothing to watch, and a
  // «refused» reading we cannot tie to a transaction is not proof enough to
  // hand the signature back. Wrong in this direction costs a closed panel.
  if (!txid) return { kind: 'unconfirmed', reason: 'no-hash' };
  const dispatched = (input.dispatched ?? '').trim();
  // The orders are PINNED (Sequence + LastLedgerSequence): these two say
  // THIS transaction can never validate. «Try again» would recreate the same
  // payload and get the same answer forever — the parent prepares a new one.
  if (STALE_CODES.has(dispatched)) return { kind: 'stale', code: dispatched, txid };
  // The identical transaction was already applied: its hash is the one to watch.
  if (dispatched === 'tefALREADY') return { kind: 'await-validation', txid };
  if (classifyXrplResult(dispatched) === 'failed-never') {
    return { kind: 'refused', code: dispatched };
  }
  return { kind: 'await-validation', txid };
}

export function decideAfterValidation(input: {
  txid: string;
  validated: boolean;
  finalResult?: string | null;
  timedOut?: boolean;
}): SingleSignVerdict {
  const code = (input.finalResult ?? '').trim();
  if (input.validated && code === 'tesSUCCESS') {
    return { kind: 'settled', txid: input.txid };
  }
  // Validated with a result we READ that is not success: a verdict, terminal.
  if (input.validated && code) {
    return { kind: 'failed-onchain', code, txid: input.txid };
  }
  // Timed out, or «validated» without a readable result: we do not know.
  return { kind: 'unconfirmed', reason: 'not-validated', txid: input.txid };
}

/** Only a validated tesSUCCESS lets the caller act on the signature. */
export function settles(v: SingleSignVerdict): boolean {
  return v.kind === 'settled';
}

/** Only a refusal that provably never entered a ledger may be signed again. */
export function offersRetry(v: SingleSignVerdict): boolean {
  return v.kind === 'refused';
}

/**
 * What `XamanSingleSign` is showing. 'cancelled' = the request was killed in
 * Xaman by its own «Cancel this request» and Xaman CONFIRMED nothing was
 * signed (see `retreatDecision`).
 */
export type SingleSignPhase =
  | 'creating'
  | 'waiting'
  | 'confirming'
  | 'settled'
  | 'error'
  | 'unconfirmed'
  | 'cancelled'
  /** tefPAST_SEQ / tefMAX_LEDGER: this prepared tx can never validate; the parent prepares again. */
  | 'stale';

/**
 * May the PARENT still drop this signature (its «Cancel»)?
 *
 * The component refuses a second signature, but its parents kept a «Cancel»
 * that threw the prepared order away — and preparing it again gave a fresh
 * payload to sign: the double order the component had just closed, one level
 * up. So the parent is told when retreating is no longer honest:
 */
export function blocksRetreat(phase: SingleSignPhase, retryable: boolean): boolean {
  if (phase === 'waiting' || phase === 'confirming' || phase === 'unconfirmed') return true;
  if (phase === 'error') return !retryable;
  // 'settled', 'creating', 'cancelled'
  return false;
}

/**
 * What `XamanSingleSign` does with Xaman's answer to its own «Cancel this
 * request» — the ONLY honest way out of a live request.
 */
export type RetreatDecision =
  | { kind: 'closed' }
  | { kind: 'follow' }
  | { kind: 'stay'; warn: 'alive' | 'unknown' }
  | { kind: 'ignore' };

export function retreatDecision(action: XamanCancelAction): RetreatDecision {
  switch (action) {
    case 'close':
      return { kind: 'closed' };
    case 'warn-resolved':
      return { kind: 'follow' };
    case 'warn-alive':
      return { kind: 'stay', warn: 'alive' };
    case 'warn-unknown':
      return { kind: 'stay', warn: 'unknown' };
    default:
      return { kind: 'ignore' };
  }
}

/**
 * Must the component ask Xaman to kill its payload when it goes away (unmount,
 * a new attempt, a new active tx)? Only a payload that EXISTS and that no poll
 * has decided yet — i.e. one still signable on the phone. A decided one is
 * signed, cancelled or expired, and its watch belongs to its verdict.
 */
export function cancelsOnLeave(input: { uuid?: string | null; decided: boolean }): boolean {
  return !!input.uuid && !input.decided;
}

/**
 * Which transaction `XamanSingleSign` is working on when its parent hands it a
 * DIFFERENT `txjson` while mounted.
 */
export function nextActiveTxKey(input: {
  activeKey: string;
  incomingKey: string;
  blocked: boolean;
}): string {
  if (input.incomingKey === input.activeKey) return input.activeKey;
  return input.blocked ? input.activeKey : input.incomingKey;
}

"use client";

/**
 * payloadBus — tiny module-level event bus that carries the Xaman signing
 * payload (QR image + deeplink + what is being signed) from XamanWalletService
 * to the UI.
 *
 * WHY: XamanWalletService creates the payload and then blocks on
 * waitForPayloadCompletion() for up to 5 minutes. The QR/deeplink live inside
 * that payload but were never surfaced, so the user had nothing to scan and the
 * connection always timed out. The bus lets a globally-mounted modal render the
 * QR the instant the payload exists, without forcing the service singleton (and
 * its XRPL WebSocket) to be constructed at app load.
 *
 * The prompt carries CONTEXT, not just a QR: what the user is about to sign
 * (purpose + a human summary derived from the real txjson) and when the payload
 * expires. A signing surface that shows only a bare QR asks the user to approve
 * something they cannot see — the modal renders these fields so the review
 * happens on-screen, next to the code they are about to scan.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0): this only DISPLAYS the unsigned payload.
 * The user signs in the Xaman mobile app. Astryum never holds keys nor signs.
 */

import { xrplTxTypeLabel } from '../xrpl/txTypeLabels';

/** What the user is being asked to approve — drives the modal's copy. */
export type XamanPayloadPurpose = 'signin' | 'transaction' | 'message';

/** Live state of the payload while the user is in Xaman. 'rejected' (the user
 *  said no — a choice, not an error) and 'expired' (the 5-minute window closed)
 *  are terminal states the modal shows calmly instead of vanishing. */
export type XamanPayloadStatus = 'pending' | 'opened' | 'signed' | 'rejected' | 'expired';

export interface XamanPayloadPrompt {
  /** Xaman payload UUID — used to dedupe / debug. */
  uuid: string;
  /** Official Xaman QR image URL (or data URL) from payload.refs.qr_png. */
  qrPng: string;
  /** Universal/deeplink URL from payload.next.always (opens the Xaman app). */
  deeplink: string;
  /** Why Xaman is being opened. Defaults to 'signin' when omitted. */
  purpose?: XamanPayloadPurpose;
  /**
   * One-line human summary of the operation, derived from the REAL unsigned
   * payload (e.g. "Payment · 5 XRP"). Never a placeholder: omitted when the
   * shape is unknown, so the modal can stay silent rather than invent one.
   */
  summary?: string;
  /** Epoch ms at which the Xaman payload expires (drives the countdown). */
  expiresAt?: number;
  /**
   * Xaman's own answer to "did this request reach the user's phone as a push
   * notification?" (payload create response, `pushed`). true → tell the user to
   * check their phone; false → the QR is the only way in this time. Omitted when
   * unknown (e.g. mock payloads).
   */
  pushed?: boolean;
  /*
   * NO `onRetry` HERE — deliberately (QR-cierre).
   *
   * An earlier DRAFT of this work (working tree only — it never landed as its
   * own commit) added an `onRetry` field and a "Generate a new code" button, and
   * NO emitter ever passed it: dead UI. Wiring one from XamanWalletService
   * would have been worse than dead. Every ceremony (connect / signMessage /
   * signTransaction / signOwnershipProof / submitTransaction) returns its
   * result through the CALLER's await, and by the time the expired panel is on
   * screen that await has already settled — the ceremony threw the instant the
   * code died. A retry fired from here would therefore start a SECOND,
   * detached ceremony whose signature nobody reads:
   *   · connect  → walletService.connectWallet() is what calls addWallet /
   *     setActiveWallet / walletApiService.connectWallet, and it registers
   *     onAccountChange only AFTER the first connect resolves
   *     (services/walletService.ts:~52). A retried sign-in would succeed
   *     inside the service and never reach the store or the backend.
   *   · submitTransaction → options.submit = true, so Xaman BROADCASTS. A
   *     detached retry would put a real transaction on the ledger whose txid
   *     the app never learns. That is the "dinero invisible" family again.
   * Making it real needs the retry loop to live INSIDE the ceremony (keeping
   * one await for the caller), which also means treating the PAYLOAD_TIMEOUT
   * rejection as an expiry. That is a restructure, not a callback — see the
   * QR-cierre report. Until then the expired panel points the user back at the
   * surface that started the operation, which retries it correctly.
   */
}

/**
 * `clearedUuid` names WHICH payload a clear (`prompt === null`) is about
 * (xaman-cancelar 1). It is absent only for a clear that belongs to nobody in
 * particular — the panel closing itself.
 */
type PromptListener = (prompt: XamanPayloadPrompt | null, clearedUuid?: string | null) => void;
/**
 * `statusUuid` names WHICH payload a status update describes (uuid-status).
 * Without it a status was simply "the status", and the panel wrote it over
 * whatever it happened to be showing.
 */
type StatusListener = (status: XamanPayloadStatus, statusUuid: string) => void;

const promptListeners = new Set<PromptListener>();
const statusListeners = new Set<StatusListener>();

/** Subscribe to payload prompts. Returns an unsubscribe function. */
export function onXamanPayload(cb: PromptListener): () => void {
  promptListeners.add(cb);
  return () => {
    promptListeners.delete(cb);
  };
}

/**
 * Emit a payload prompt, or clear the UI (`prompt === null`).
 *
 * WHY THE SECOND ARGUMENT (xaman-cancelar 1): a bare `null` means "close
 * whatever is open", and EVERY ceremony emits one the moment its own payload
 * resolves. So cancelling payload A reached in and wiped payload B's prompt off
 * the screen — B still alive and signable on the phone, no DELETE asked for,
 * nothing said. Confirming the kill now resolves A's ceremony in seconds
 * instead of at the 5-minute timeout, which turned that collision from rare
 * into routine: the fix for one half of the bug made the other half likelier.
 * A clear names its payload, and the listener drops the ones that are not about
 * what it is showing (resolveClearAction).
 */
export function emitXamanPayload(prompt: XamanPayloadPrompt): void;
/**
 * The clear form REQUIRES the uuid — `tsc` is what keeps this fixed. A bare
 * `emitXamanPayload(null)` is now a compile error, so no future emitter can
 * quietly re-open xaman-cancelar 1 by forgetting to say which payload it means.
 * Pass an explicit `null` for the one clear that belongs to nobody: the panel
 * closing itself.
 */
export function emitXamanPayload(prompt: null, clearedUuid: string | null): void;
export function emitXamanPayload(
  prompt: XamanPayloadPrompt | null,
  clearedUuid?: string | null,
): void {
  promptListeners.forEach((cb) => {
    try {
      cb(prompt, clearedUuid);
    } catch (err) {
      console.error('xaman payloadBus listener error:', err);
    }
  });
}

/** Subscribe to live status updates for the open payload. */
export function onXamanStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

/**
 * Emit a live status update for ONE payload ('opened' when the user has the
 * request on screen in Xaman, 'signed' once approved). Purely informational —
 * the signing flow itself is driven by the service's own WS/poll loop.
 *
 * THE UUID IS REQUIRED, and `tsc` is what keeps it that way (uuid-status).
 * The PAYLOAD channel was disciplined by uuid (emitXamanPayload) and this one
 * was not, so the same failure simply moved next door. Every ceremony shares
 * this bus: payload A resolving painted ITS terminal state over payload B, and
 * B then looked 'signed' / 'rejected' / 'expired' to decideCloseStep — which
 * answers 'close', so the panel left WITHOUT asking Xaman to kill anything. B
 * stayed alive and signable on the phone, in silence. That is the founding bug
 * of this surface, reopened through the last door the uuid discipline had not
 * reached.
 *
 * The reverse order was just as bad: a stray NON-terminal status ('pending' /
 * 'opened' from another ceremony) overwrote a terminal one nobody had read yet,
 * and resolveClearAction — which keeps the panel up precisely for 'rejected' /
 * 'expired' — then let the next clear erase it.
 */
export function emitXamanStatus(status: XamanPayloadStatus, statusUuid: string): void {
  statusListeners.forEach((cb) => {
    try {
      cb(status, statusUuid);
    } catch (err) {
      console.error('xaman payloadBus status listener error:', err);
    }
  });
}

type CancelListener = (uuid: string) => void;
const cancelListeners = new Set<CancelListener>();

/**
 * Subscribe to "this payload was cancelled from the UI" (UI-qr-xaman, R6.4).
 *
 * The bus was one-way (service → UI), so pressing Cancel killed the payload in
 * Xaman but told the WAITING service nothing: resolving the origin screen's
 * await depended entirely on Xaman pushing a resolution down its websocket
 * (the poll fallback only starts when that socket errors or closes). This
 * channel makes the resolution deterministic for whoever is waiting.
 *
 * SUBSCRIBER (QR-cierre): XamanWalletService.waitForPayloadCompletion listens
 * and resolves its wait with null. Before that, Cancel left the origin await
 * hanging for the rest of PAYLOAD_TIMEOUT (5 min) and then REJECTED — the user
 * got a red error minutes later for something they had deliberately cancelled.
 *
 * It only fires when the payload is CONFIRMED dead by our own DELETE, never on
 * a failed one and never on 'already-gone': an ALREADY_RESOLVED payload may
 * have been SIGNED, and resolving the wait with null there would throw away a
 * real signature (and, for submit:true, a broadcast transaction).
 */
export function onXamanCancelled(cb: CancelListener): () => void {
  cancelListeners.add(cb);
  return () => {
    cancelListeners.delete(cb);
  };
}

/**
 * What we learned about the payload after asking Xaman to kill it.
 *
 * The distinction is the whole point (QR-cierre): "we could not read the
 * answer" is NOT "the payload is alive", and neither is "it was already gone".
 * An earlier draft collapsed all three into `false`, so a payload that had ALREADY
 * expired or resolved upstream made the modal shout "it stays signable on your
 * phone until the code expires" — a false statement, and an alarming one.
 */
export type XamanCancelOutcome =
  /** Xaman confirmed the kill: nothing signable is left on the phone. */
  | 'cancelled'
  /** It was already dead/answered before we asked (ALREADY_EXPIRED /
   *  ALREADY_CANCELLED / ALREADY_RESOLVED — never ALREADY_OPENED, which is
   *  still signable: see cancelRefusalOutcome). */
  | 'already-gone'
  /** Xaman answered and refused: the request IS still signable. */
  | 'still-live'
  /** No usable answer (timeout, abort, unreachable proxy, upstream error): we
   *  do not know its state, and we must not pretend either way. */
  | 'unknown';

export interface XamanCancelResult {
  outcome: XamanCancelOutcome;
  /** Xaman's own `reason`, or our marker (TIMEOUT / ABORTED / HTTP_500…). */
  reason?: string;
}

/**
 * What a `cancelled: false` answer means, by Xaman's `reason`
 * (xumm-sdk `XummCancelReason`).
 *
 * ALREADY_* is NOT one family (productizer-it6). ALREADY_OPENED is Xaman saying
 * "the user has this request OPEN on the phone, it can no longer be cancelled"
 * — and it is STILL SIGNABLE. Folding it into 'already-gone' closed the panel
 * with «Request cancelled in Xaman. Nothing was signed.», the parent dropped
 * the order and offered «Review and sign» again: a second payload beside a
 * live one, sign both = two orders.
 *
 *   · ALREADY_EXPIRED / ALREADY_CANCELLED → 'already-gone' (nothing left).
 *   · ALREADY_RESOLVED → 'already-gone'; resolveCancelAction turns it into
 *     'warn-resolved' (answered on the phone — maybe signed).
 *   · ALREADY_OPENED → 'still-live' (open on the phone, signable).
 *   · any OTHER ALREADY_* → 'unknown': a reason we have never read is never a
 *     licence to close.
 *   · a refusal that is not ALREADY_* → 'still-live' (Xaman refused the kill).
 */
export function cancelRefusalOutcome(reason: string | undefined): XamanCancelOutcome {
  const r = (reason ?? '').toUpperCase();
  if (r === 'ALREADY_EXPIRED' || r === 'ALREADY_CANCELLED' || r === 'ALREADY_RESOLVED') return 'already-gone';
  if (r === 'ALREADY_OPENED') return 'still-live';
  if (r.startsWith('ALREADY_')) return 'unknown';
  return 'still-live';
}

/**
 * A cancel round trip that hangs is a MODAL TRAP: while it is in flight the
 * signing panel refuses Escape, the backdrop and the X, and the page scroll
 * stays locked — with an upstream that never answers the only way out was to
 * sign. Bound it (QR-cierre).
 */
const CANCEL_TIMEOUT_MS = 8000;

/**
 * Cancel a live payload so "Cancel" truly cancels: the QR dies in Xaman and
 * nothing signable is left on the phone for the rest of the 5-minute window.
 *
 * Reports what Xaman actually said. `fetch` does not throw on 4xx/5xx, so the
 * original fire-and-forget version let the modal close claiming "cancelled"
 * while the request stayed perfectly signable — and a boolean still
 * could not tell "refused" from "never answered". Callers get the outcome and
 * the surface says exactly that much.
 *
 * `opts.signal` is the caller's escape hatch: aborting yields 'unknown', which
 * is the truth (we stopped listening before Xaman answered), and releases the
 * panel instead of holding the user hostage.
 */
export async function cancelXamanPayload(
  uuid: string,
  opts?: { signal?: AbortSignal },
): Promise<XamanCancelResult> {
  // Mock payloads (FALLBACK_MODE) never existed upstream: DELETE would 404 and
  // we would frighten the user about a QR that was never real. The five
  // emitters filter mock uuids before they ever reach the modal, so this guards
  // the DIRECT callers of this function (XamanWalletService.cancelPayload takes
  // an arbitrary payload id from the pool) — not the modal, which never needed
  // it. NOTE (QR-cierre final): that direct caller has ZERO callers of its own
  // today, so this guard is a contract for a door nobody walks through yet. It
  // stays because the door is public API.
  if (uuid.startsWith('mock-')) {
    notifyCancelled(uuid);
    return { outcome: 'cancelled', reason: 'MOCK' };
  }

  // AbortController rather than AbortSignal.timeout(): it has to compose with
  // the caller's own signal, and AbortSignal.any() is not available across all
  // the browsers this ships to.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CANCEL_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await fetch(`/api/xaman/status/${uuid}`, {
      method: 'DELETE',
      signal: controller.signal,
    });
    // The proxy answers 400 without XAMAN_API_* keys and mirrors upstream
    // errors otherwise. Either way the DELETE may or may not have reached
    // Xaman: unknown, not "still alive".
    if (!res.ok) return { outcome: 'unknown', reason: `HTTP_${res.status}` };

    // Xaman answers { result: { cancelled: boolean, reason } }. A body without
    // the field (proxy shapes, empty 200) is treated as done, since the request
    // did reach Xaman and returned ok.
    const body = (await res.json().catch(() => null)) as
      | { result?: { cancelled?: boolean; reason?: unknown } }
      | null;
    // A body we never got to read because the timeout/escape hatch fired mid
    // stream is NOT an empty 200: it is no answer at all. Without this the
    // catch-to-null above would have turned an aborted read into a confirmed
    // kill — a green light nobody read (QR-cierre).
    if (body === null && controller.signal.aborted) {
      return { outcome: 'unknown', reason: timedOut ? 'TIMEOUT' : 'ABORTED' };
    }
    const reason = typeof body?.result?.reason === 'string' ? body.result.reason : undefined;

    if (body?.result?.cancelled === false) {
      // No notifyCancelled on ANY refusal: ALREADY_RESOLVED can mean the user
      // SIGNED it, and telling the waiting ceremony "cancelled" would discard a
      // real signature.
      return { outcome: cancelRefusalOutcome(reason), reason };
    }

    notifyCancelled(uuid);
    return { outcome: 'cancelled', reason };
  } catch {
    return {
      outcome: 'unknown',
      reason: timedOut ? 'TIMEOUT' : opts?.signal?.aborted ? 'ABORTED' : 'UNREACHABLE',
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Panel states the signing modal can be in after asking Xaman to cancel.
 *
 * 'resolved' is NOT a flavour of 'already gone' (QR-cierre final): Xaman
 * answering ALREADY_RESOLVED means the request had already been ANSWERED on
 * the phone — very possibly SIGNED, and for a submit:true payload BROADCAST.
 * Folding it into a silent close made the panel vanish over a transaction that
 * may be on the ledger. It gets its own terminal panel.
 */
export type XamanCancelUi = 'idle' | 'cancelling' | 'alive' | 'unknown' | 'resolved';

/**
 * What the panel must DO with a cancel answer (QR-cierre B + C). Pure, and
 * exported, because the vitest env is `node` with no jsdom: kept inside the
 * component this decision was untestable, and it is exactly the decision that
 * reopened the bug.
 *
 * B — THE ANSWER MUST STILL DESCRIBE WHAT IS ON SCREEN. An earlier draft awaited the
 * DELETE and wrote the result into the shared cancel state without remembering
 * WHICH payload it had asked about. Cancel payload A over a slow network, let
 * prompt B arrive, and A's late `false` marked B as "failed" — so the next
 * Cancel took the already-failed branch and closed the panel with NO DELETE at
 * all, leaving B signable on the phone in silence. That is the very bug this
 * work exists to kill, reopened by its own fix.
 */
export type XamanCancelAction = 'ignore' | 'close' | 'warn-alive' | 'warn-unknown' | 'warn-resolved';

export function resolveCancelAction(args: {
  /** uuid of the payload the panel is showing RIGHT NOW (null = none). */
  onScreenUuid: string | null | undefined;
  /** uuid this answer is about. */
  answeredUuid: string;
  result: XamanCancelResult;
}): XamanCancelAction {
  // Only a DIFFERENT payload holding the screen makes this answer other
  // people's business. An empty panel does not (QR-cierre final): on the happy
  // path the confirmed kill resolves the waiting ceremony, which clears the
  // prompt, and whether that lands before or after this await was pure
  // microtask luck — losing the race left the panel's cancel state stuck at
  // 'cancelling'. Answering 'close' for our own payload is idempotent and
  // makes the reset deterministic instead.
  if (args.onScreenUuid && args.onScreenUuid !== args.answeredUuid) return 'ignore';
  switch (args.result.outcome) {
    case 'cancelled':
      return 'close';
    case 'already-gone':
      // ALREADY_EXPIRED / ALREADY_CANCELLED: nothing happened and nothing is
      // left — close in silence. ALREADY_RESOLVED is the opposite: Xaman had
      // an ANSWER for this request before we asked, i.e. the user may have
      // SIGNED it seconds ago, and submitTransaction sets options.submit so
      // Xaman BROADCASTS. Closing mute there is the "dinero invisible" family
      // again — the user presses Cancel, the window disappears, and the
      // transaction is on the ledger with nothing on screen to say so.
      return /^ALREADY_RESOLVED$/i.test(args.result.reason ?? '') ? 'warn-resolved' : 'close';
    case 'still-live':
      return 'warn-alive';
    default:
      return 'warn-unknown';
  }
}

/**
 * What must a surface DO with a clear (`emitXamanPayload(null, uuid)`)?
 *
 * xaman-cancelar 1 — THE OTHER HALF OF THE UUID DISCIPLINE. The cancel ANSWER
 * already remembered which payload it was about (resolveCancelAction); the
 * CLEAR did not. Real sequence: the user cancels A, the DELETE comes back
 * confirmed, A's ceremony resolves and its caller emits a bare `null` — and the
 * panel dropped payload B, which was live, on the phone, and one tap from being
 * signed. No DELETE, no message, nothing.
 *
 * xaman-cancelar 5 — AND A WARNING MUST NOT ERASE ITSELF. After 'alive',
 * 'unknown' or 'resolved' the panel is the only place that knows something may
 * still be signable (or may already be on the ledger). The ceremony that raised
 * the prompt eventually rejects with PAYLOAD_TIMEOUT and its catch emits a
 * clear: five minutes later the warning vanished on its own, unread and
 * unacknowledged. It stays until the person closes it.
 */
export type XamanClearAction =
  /** The clear is about a DIFFERENT payload: not our business. */
  | 'ignore'
  /** The panel is saying something nobody has read yet: it stays. */
  | 'keep-panel'
  /** Nothing left to say: drop the prompt. */
  | 'clear';

export function resolveClearAction(args: {
  /** uuid of the payload on screen RIGHT NOW (null/undefined = none). */
  onScreenUuid: string | null | undefined;
  /** uuid the clear is about; absent = "close whatever is open". */
  clearedUuid?: string | null;
  status: XamanPayloadStatus;
  cancelUi: XamanCancelUi;
}): XamanClearAction {
  // Nothing on screen: clearing is a no-op, and answering 'clear' keeps the
  // listener idempotent (the panel emits one of these when it closes itself).
  if (!args.onScreenUuid) return 'clear';
  if (args.clearedUuid && args.clearedUuid !== args.onScreenUuid) return 'ignore';
  // A terminal state arrived an instant before the clear: the person reads what
  // happened, and Close is what dismisses it.
  if (args.status === 'rejected' || args.status === 'expired') return 'keep-panel';
  if (args.cancelUi === 'alive' || args.cancelUi === 'unknown' || args.cancelUi === 'resolved') {
    return 'keep-panel';
  }
  return 'clear';
}

/**
 * What must a surface DO with a status update (`emitXamanStatus(s, uuid)`)?
 *
 * uuid-status — THE LAST DOOR. The clear channel learned to name its payload
 * (resolveClearAction) and the cancel answer learned it too
 * (resolveCancelAction); the STATUS channel never did, and every ceremony
 * shares it. Real sequence: two payloads exist, A resolves, and A's 'signed' /
 * 'rejected' / 'expired' landed on the panel showing B. Everything downstream
 * then believed B was over — decideCloseStep answers 'close' for a terminal
 * status, so the next press left WITHOUT a DELETE and B stayed signable on the
 * phone with nothing said. Same bug, fifth door.
 *
 * Pure and exported for the usual reason: the frontend vitest env is `node`
 * with no jsdom, so the listener that consumes this is not itself coverable,
 * and the five times this bug came back it lived in the WIRING.
 */
export type XamanStatusAction =
  /** Not about what this surface is showing: drop it. */
  | 'ignore'
  /** It describes the payload on screen: adopt it. */
  | 'apply';

export function resolveStatusAction(args: {
  /** uuid of the payload on screen RIGHT NOW (null/undefined = none). */
  onScreenUuid: string | null | undefined;
  /** uuid this status update is about. */
  statusUuid: string;
}): XamanStatusAction {
  // Deliberately NOT symmetric with resolveClearAction, which answers 'clear'
  // over an empty panel to stay idempotent: a status is a CLAIM about a
  // specific request, and with nothing on screen there is nothing for it to
  // describe. Storing it would only arm the next payload's state with another
  // payload's fate.
  if (!args.onScreenUuid) return 'ignore';
  return args.onScreenUuid === args.statusUuid ? 'apply' : 'ignore';
}

/**
 * The panel state a cancel ANSWER becomes. One mapping, three surfaces (the
 * signing modal, the Legacy close-door hand-off, the council inbox) — the
 * action vocabulary and the panel vocabulary are deliberately different words,
 * and a copy of this switch per surface is a copy that can drift.
 */
export function cancelUiForAction(action: XamanCancelAction): XamanCancelUi {
  switch (action) {
    case 'warn-alive':
      return 'alive';
    case 'warn-resolved':
      return 'resolved';
    case 'warn-unknown':
      return 'unknown';
    default:
      return 'idle';
  }
}

/** A cancel we could not confirm killed the payload — what the surface says. */
export type XamanStrayState = Extract<XamanCancelUi, 'alive' | 'unknown' | 'resolved'>;

/** Is this panel state one that leaves something UNCONFIRMED on the phone? One
 *  narrowing, shared by every surface that has to render the warning. */
export function strayStateOf(cancelUi: XamanCancelUi): XamanStrayState | null {
  return cancelUi === 'alive' || cancelUi === 'unknown' || cancelUi === 'resolved' ? cancelUi : null;
}

/**
 * The sentence for a payload we could NOT confirm dead.
 *
 * ONE source for every surface that offers a Cancel over a live Xaman request
 * (xaman-cancelar 3 + 4). All three strings already exist in the dictionary;
 * three inline copies would be three chances for one of them to drift into a
 * claim we did not read.
 */
export function payloadStrayNotice(state: XamanStrayState, t: (s: string) => string): string {
  if (state === 'alive') {
    return t(
      'We could not cancel this request in Xaman. It stays signable on your phone until the code expires — open Xaman and decline it there.',
    );
  }
  if (state === 'resolved') {
    return t(
      'Xaman had already answered this request before we could cancel it — it may have been signed on your phone. Open Xaman to see what happened.',
    );
  }
  return t(
    'We did not get an answer from Xaman, so we cannot confirm this request is dead. It may still be signable on your phone — open Xaman and decline it there.',
  );
}

/**
 * Kill a payload and turn Xaman's answer into the state the surface must show.
 *
 * THE WHOLE ROUND IN ONE FUNCTION (xaman-cancelar 3 + 4): "Cancel" existed on
 * three surfaces and only ONE of them asked Xaman to kill anything. The Legacy
 * close-door hand-off just called `onCancel()` over an AccountSet that disables
 * the master key — options `{ submit: true, expire: 1440 }`, so Xaman
 * BROADCASTS it and keeps it signable for 24 HOURS — and the council inbox did
 * `setSign(null)`, while "New QR" minted a second signable payload without
 * killing the first.
 *
 * `onScreenUuid` is read AFTER the round trip on purpose: by then the surface
 * may have moved on, and an answer that no longer describes what is on screen
 * must be dropped rather than written into someone else's state.
 */
export async function cancelPayloadAndDecide(
  uuid: string,
  onScreenUuid: () => string | null | undefined,
  opts?: { signal?: AbortSignal },
): Promise<{ action: XamanCancelAction; cancelUi: XamanCancelUi; result: XamanCancelResult }> {
  const result = await cancelXamanPayload(uuid, opts);
  const action = resolveCancelAction({ onScreenUuid: onScreenUuid(), answeredUuid: uuid, result });
  return { action, cancelUi: cancelUiForAction(action), result };
}

/**
 * Where a terminal `status` CAME FROM.
 *
 * xaman-cancelar 2 — THE GUARD COVERED ONE ORDER ONLY. Both panels below yield
 * to a terminal status, and 'expired' can be two entirely different facts: one
 * Xaman (or the ledger) told us, and one the modal's own `setInterval` inferred
 * from a deadline IT computed. Let the local timer run out while the DELETE is
 * still in flight and the ALREADY_RESOLVED answer arrived to a `status` that
 * was already 'expired': the panels stood down and the screen read "The code
 * expired. Nothing was signed." over a request Xaman had just said was
 * ANSWERED — and, for a submit:true payload, possibly broadcast.
 *
 * A guess never outranks a reading — and this guess is not even a tight one.
 * `expiresAt` is computed CLIENT-SIDE as `Date.now() + 300_000`, and only after
 * the create round trip has already come back, while Xaman's own 300 s window
 * started when IT created the payload: the countdown therefore runs LATE, on a
 * clock that is not Xaman's, and can still be ticking over a request that is
 * already dead upstream.
 *
 * CORRECTED IN uuid-status 3: an earlier version of this note justified the
 * flag with a 300 s ↔ `expire: 1440` (24 h) misalignment. That misalignment is
 * real in CloseDoorSign and lib/xrpl/councilSigning, but NEITHER of them emits
 * on this bus — every emitter here is XamanWalletService, and all of them use
 * `expire: 5`. A false claim about expiry, in the file that decides what
 * expiry is allowed to mean, is exactly the kind of claim that gets believed.
 * (productizer-it6: Xaman's `options.expire` is in MINUTES. Those emitters were
 * `expire: 300` — five HOURS of a signable orphan, not five minutes.)
 */
export interface XamanStatusOrigin {
  /** `status === 'expired'` was inferred by the surface's own countdown, not
   *  read from Xaman nor from the ledger. */
  expiryIsLocalGuess?: boolean;
}

/** A resolution we READ. A locally-guessed expiry is not one. */
function isReadResolution(status: XamanPayloadStatus, origin?: XamanStatusOrigin): boolean {
  if (status === 'signed' || status === 'rejected') return true;
  return status === 'expired' && !origin?.expiryIsLocalGuess;
}

/**
 * Should the amber "this is still signable on your phone" warning be painted?
 *
 * QR-cierre C: an earlier draft guarded it with `!terminal && cancelState === 'failed'`,
 * and `terminal` covers only 'rejected' | 'expired' — so a cancel that failed
 * moments before the user approved in Xaman kept the alarm on screen UNDER the
 * signature ceremony. Nothing about a signed payload is still pending.
 */
export function shouldWarnPayloadAlive(
  status: XamanPayloadStatus,
  cancelUi: XamanCancelUi,
  origin?: XamanStatusOrigin,
): boolean {
  if (isReadResolution(status, origin)) return false;
  return cancelUi === 'alive' || cancelUi === 'unknown';
}

/**
 * Should the "Xaman had already answered this" terminal panel be painted?
 *
 * Sibling of shouldWarnPayloadAlive and deliberately NOT the same sentence: an
 * ALREADY_RESOLVED payload is not "still signable on your phone" — it is
 * already answered, possibly signed. It also yields the moment the real
 * resolution arrives (signed / rejected / expired), because those surfaces say
 * it better and with proof; this panel only exists for the gap where our
 * cancel is the only thing that ever learned anything (QR-cierre final).
 */
export function shouldReportPayloadResolved(
  status: XamanPayloadStatus,
  cancelUi: XamanCancelUi,
  origin?: XamanStatusOrigin,
): boolean {
  if (isReadResolution(status, origin)) return false;
  return cancelUi === 'resolved';
}

/**
 * WHICH of the four things this panel can be saying is it saying? Exactly one.
 *
 * uuid-status 2 — THE PANEL CONTRADICTING ITSELF. The modal derived `terminal`
 * inline as `(rejected || expired) && !answeredElsewhere && !warnAlive`, and
 * then gated the QR, the countdown and "Waiting for your signature in Xaman…"
 * on `terminal` and `answeredElsewhere` ALONE — never on the amber warning. So
 * a cancel we could NOT confirm ("It stays signable on your phone until the
 * code expires — open Xaman and decline it there") was rendered next to a
 * scannable code and a spinner claiming we were waiting for that very
 * signature. One panel, asking the person to kill the request and to sign it,
 * in the same breath. On a submit:true payload the invitation it accidentally
 * extends is a broadcast.
 *
 * Composes the two predicates above rather than restating them, so the
 * precedence lives in one place: what Xaman told us about the CANCEL outranks a
 * terminal state, because a terminal state that contradicts a reading is a
 * false all-clear (xaman-cancelar 2). Pure and exported because the frontend
 * vitest env is `node` with no jsdom — inline in the component, this precedence
 * was untestable.
 */
export type XamanPanelVoice =
  /** A live request and nothing else to report: code, countdown, "waiting…". */
  | 'invite'
  /** A resolution we READ: declined, or an expiry Xaman/the ledger reported. */
  | 'terminal'
  /** We asked Xaman to kill it and could not confirm it dead. */
  | 'stray'
  /** Xaman had already ANSWERED it before we asked. */
  | 'answered';

export function resolvePanelVoice(
  status: XamanPayloadStatus,
  cancelUi: XamanCancelUi,
  origin?: XamanStatusOrigin,
): XamanPanelVoice {
  if (shouldReportPayloadResolved(status, cancelUi, origin)) return 'answered';
  if (shouldWarnPayloadAlive(status, cancelUi, origin)) return 'stray';
  if (status === 'rejected' || status === 'expired') return 'terminal';
  return 'invite';
}

/** A cancel round trip the panel is waiting on, plus the handle to stop it. */
export interface XamanInFlightCancel {
  uuid: string;
  controller: AbortController;
}

/** Why the panel is letting go of an in-flight cancel. */
export type XamanCancelRelease =
  /** The user pressed again to get out of the wait — their explicit choice. */
  | 'stop-waiting'
  /** A NEW payload took over the panel. */
  | 'superseded'
  /** The panel itself went away. */
  | 'closed';

/**
 * Let go of an in-flight cancel, and decide whether the REQUEST dies with it.
 *
 * THE WHOLE POINT (QR-cierre final): only 'stop-waiting' aborts. Aborting on
 * 'superseded' — which is what the prompt listener used to do — killed the
 * DELETE for payload A mid-flight the moment payload B arrived, so A stayed
 * perfectly signable on the phone for the rest of its five minutes, nobody was
 * told, and A's ceremony never received onXamanCancelled either: it hung to
 * PAYLOAD_TIMEOUT and then rejected. That is this surface's founding bug,
 * reopened through a new door. The late ANSWER is what must be dropped (by
 * uuid, in resolveCancelAction), never the request.
 *
 * Single choke point on purpose: this is the only place in the signing surface
 * allowed to call .abort() on a cancel, so "who may kill a DELETE" is one
 * readable rule instead of three call sites that must each stay correct.
 */
export function releaseInFlightCancel(
  inFlight: XamanInFlightCancel | null,
  reason: XamanCancelRelease,
): null {
  if (reason === 'stop-waiting') inFlight?.controller.abort();
  return null;
}

/** What pressing Close / Escape / the backdrop must do right now. */
export type XamanCloseStep =
  /** A round trip is in flight: stop waiting on it (the panel is never a cage). */
  | 'stop-waiting'
  /** Nothing live to kill, or the user already read what we could not confirm. */
  | 'close'
  /** A live payload: ask Xaman to kill it and wait for the answer. */
  | 'cancel';

/**
 * The close decision, pulled out of the component so it can be executed by a
 * test: the frontend vitest bootstrap is `environment: 'node'` with no jsdom,
 * so nothing that renders is coverable, and this is exactly the decision that
 * reopened the bug twice.
 *
 * The rule it encodes: a payload that is still LIVE never leaves the screen
 * without a DELETE having been asked for. Every other branch is a way OUT, so
 * that a hung upstream can never turn the only working button into "sign".
 */
export function decideCloseStep(args: {
  hasPrompt: boolean;
  status: XamanPayloadStatus;
  cancelUi: XamanCancelUi;
}): XamanCloseStep {
  if (args.cancelUi === 'cancelling') return 'stop-waiting';
  if (!args.hasPrompt) return 'close';
  if (args.status === 'signed' || args.status === 'rejected' || args.status === 'expired') {
    return 'close';
  }
  // Second press after an answer we could not act on: the user chose to leave
  // knowing what the panel just told them. No second DELETE.
  if (args.cancelUi === 'alive' || args.cancelUi === 'unknown' || args.cancelUi === 'resolved') {
    return 'close';
  }
  return 'cancel';
}

function notifyCancelled(uuid: string): void {
  cancelListeners.forEach((cb) => {
    try {
      cb(uuid);
    } catch (err) {
      console.error('xaman payloadBus cancel listener error:', err);
    }
  });
}

/**
 * XRPL_TYPE_LABEL — what the user is about to sign, in words (UI-qr-xaman,
 * R6.5). COMPLETES the shared `xrplTxTypeLabel` map (lib/xrpl/txTypeLabels.ts,
 * shared with ProposalInbox/LegacyPanel) instead of duplicating it: only the
 * types that map is missing, plus one correction.
 *
 * `Payment` is the correction: the shared label reads "Payment — sends XRP",
 * and this rail also signs IOU payments (RLUSD). Printing "sends XRP" over a
 * "100 RLUSD" payment is a false statement on the very surface where the user
 * decides. The currency lives in the detail line, so the headline stays
 * currency-neutral.
 *
 * QR-cierre F asked to unify on the shared map instead. NOT DONE, on purpose:
 * unifying downwards would import the falsehood, because the emitter really
 * does produce IOU summaries — describeXrplTx (XamanWalletService) formats
 * `${value} ${currency}` for any object Amount, i.e. "Payment · 100 RLUSD".
 * The single source must be corrected at its own file instead
 * (lib/xrpl/txTypeLabels.ts → MAP.Payment, which is not ours this round; the
 * same falsehood is shown today by ProposalInbox and LegacyPanel). Once it
 * reads currency-neutral, DELETE the Payment entry below and the two surfaces
 * agree with one string. See the report.
 */
const XRPL_TYPE_LABEL: Record<string, string> = {
  Payment: 'Sends money out of your account',
  SignIn: 'Sign-in proof — moves no funds',
  AMMDeposit: 'Adds liquidity to a pool',
  AMMWithdraw: 'Takes liquidity out of a pool',
};

/** A summary split into the sentence and the figure that came with it. */
export interface XamanSummaryLines {
  /** The operation as a person reads it. */
  headline: string;
  /** The concrete figure ("5 XRP"), or null when the summary carried none. */
  detail: string | null;
}

/**
 * Turn the bus `summary` into human lines (UI-qr-xaman, R6.5).
 *
 * WHAT FAILED IN SILENCE: the emitter builds "Payment · 5 XRP" whenever the tx
 * carries an Amount, and the modal only humanised summaries that were a BARE
 * TransactionType — so exactly the money-moving payloads (Payment,
 * EscrowCreate) were the ones shown as a ledger opcode, and the humanising step
 * was dead code for them.
 *
 * Lives here, not in the modal, so it is testable: the vitest env is `node`
 * with no jsdom, so nothing that renders can be covered by a test.
 *
 * Invents nothing: an unfamiliar type is returned exactly as it arrived.
 */
export function humanizeXamanSummary(
  summary: string | null | undefined,
  t: (s: string) => string,
): XamanSummaryLines | null {
  const raw = (summary ?? '').trim();
  if (!raw) return null;

  const parts = raw.split('·').map((s) => s.trim());
  const head = parts[0] ?? '';
  const detail = parts.length > 1 ? parts.slice(1).join(' · ') : null;

  // Only a plausible XRPL TransactionType gets translated; anything else is
  // prose the emitter already wrote and we must not take apart.
  if (!/^[A-Z][A-Za-z]{2,}$/.test(head)) return { headline: raw, detail: null };

  const local = XRPL_TYPE_LABEL[head];
  if (local) return { headline: t(local), detail };

  const shared = xrplTxTypeLabel(head, t);
  if (shared && shared !== head) return { headline: shared, detail };

  // Unknown type: show it as it came rather than guess what it does.
  return { headline: raw, detail: null };
}

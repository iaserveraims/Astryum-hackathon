'use client';

/**
 * CouncilMultisigFlow — the multisig coordinator, in the app (ADR-008).
 *
 * Replaces the "copy the txjson and go to an external tool" hand-off for council
 * accounts. Given an unsigned txjson (composed by a builder, SourceTag stamped):
 *   1. pin it for the council via /multisign/prepare (Sequence/Fee/SigningPubKey)
 *      + read the simulate preflight (will it succeed + exact balance deltas),
 *   2. open ONE Xaman sign request per member (options.multisign) — a QR each,
 *   3. poll each until it is signed, collecting the blob,
 *   4. once the quorum weight is met, combine with xrpl.multisign() (client-side),
 *   5. broadcast the combined blob from THIS browser to a public XRPL node.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { multisign } from 'xrpl';
import { AlertTriangle, Check, ExternalLink, Inbox, Loader2, RefreshCw, Send, Users, X } from 'lucide-react';
import { Card, GhostButton, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { xrplLegacy, type MultisigPrepare } from '../../services/v1Api';
import { verifySignerBlob, BlobVerificationError } from '../../lib/xrpl/verifySignerBlob';
import { describeServerRefusal, type ReadableRefusal } from '../../lib/errors/serverRefusal';
import {
  councilOrderMemoOf,
  isStaleDispatch,
  staleOrderFate,
  staleSentence,
  type StaleOrderFate,
} from '../../lib/xrpl/singleSignVerdict';
import { readCouncilOrderFate } from '../../lib/institutional/api';
import ProposeToCouncil from './ProposeToCouncil';
import {
  cancelPayloadAndDecide,
  payloadStrayNotice,
  strayStateOf,
  type XamanStrayState,
} from '../../lib/xaman/payloadBus';
import {
  XRPSCAN_ACCOUNT,
  XRPSCAN_TX,
  type CeremonyDispatchEvent,
  type ConfirmedSubmit,
  awaitValidation,
  broadcast,
  broadcastMayLand,
  createMemberPayload,
  paymentMemoHex,
  pollStatus,
  shortAddr,
} from '../../lib/xrpl/councilSigning';
import { serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { flareInstructionMemoOf } from '../../lib/xaman/liveRequests';
import { notifyHandoffSigned, releaseCeremonySeat } from '../../lib/wallet/handoffRelease';

type Phase = 'idle' | 'preparing' | 'signing' | 'submitting' | 'done' | 'error';

/**
 * consejo-superficies 2 — IS THIS CEREMONY HOLDING THE ACCOUNT'S NEXT SEAT?
 *
 * `multisignPrepare` pins ONE Sequence and every member payload signs exactly
 * those bytes. While that is true, the async door beside this surface
 * (ProposeToCouncil) must not compose the same transaction again: the server's
 * "one live proposal per account" rule cannot see a ceremony, because a
 * ceremony is not a proposal, so both would live on the same seat.
 */
export function ceremonyHoldsSeat(phase: Phase, seatPinned: boolean): boolean {
  if (phase === 'idle') return false;
  if (phase === 'error') return seatPinned;
  return true;
}

/**
 * DOES UNMOUNTING THIS SCREEN HAND THE SEAT BACK?
 *
 * The one rule for all seventeen hosts of this flow (the bus's modal and the
 * sixteen inline mounts): the seat this SITTING pinned goes back when the screen
 * goes away — unless the sitting has COMMITTED to a broadcast. `committed` is
 * stamped the instant `submit()` starts combining and never cleared by a later
 * error: bytes that were handed to a node may be on the ledger whatever the node
 * said back, and only the ledger's own window (server-side) may free that seat.
 * Before `start()` nothing of this sitting's is pinned, so there is nothing of
 * its to hand back (the prepared dispatch's seat is the caller's, see the bus).
 */
export function unmountReleasesSeat(phase: Phase, seatPinned: boolean, committed: boolean): boolean {
  if (committed) return false;
  return ceremonyHoldsSeat(phase, seatPinned);
}

/**
 * THE SITTING'S NAME, READ OFF THE PREPARE ANSWER. Pure.
 *
 * `/multisign/prepare` generates one id per sitting and returns it as
 * `sittingId`; every release of this sitting sends it back, so a release landing
 * after a NEWER sitting re-pinned the same bytes is a no-op server-side. A
 * server from before the field answers without it → `null`, and the release
 * then says «this sitting has no name» (which that server ignores, as before).
 * Read defensively: the field is not part of `MultisigPrepare`'s typed contract
 * in `services/v1Api` (another frontier), and a non-string is no name.
 */
export function prepareSittingId(prepare: unknown): string | null {
  const id = (prepare as { sittingId?: unknown } | null | undefined)?.sittingId;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

/**
 * CAN A SUBMIT WITH THIS PRELIMINARY RESULT STILL REACH A LEDGER?
 * the rule moved to the engine (`lib/xrpl/councilSigning`) because
 * the async coordinator asks it too; re-exported from here, where the house has
 * looked for it. Nothing deleted, no caller changes.
 */
export { broadcastMayLand };

/**
 * consejo-superficies 1 — CAN THE COUNCIL WALK AWAY, AND WHAT DIES WITH IT?
 *
 * Every member payload is created with `expire: 1440`, so what is on the
 * members' phones outlives this screen by 24 hours. 'cancel' is the only state
 * where leaving is both possible and safe to offer: a round trip in flight
 * ('preparing' / 'submitting') has no answer yet, and after 'done' this browser
 * has already broadcast — nothing here may suggest starting again over bytes
 * that may be on the ledger.
 */
export function ceremonyExit(phase: Phase, committed = false): 'none' | 'cancel' | 'check-ledger' {
  if (phase === 'signing') return 'cancel';
  if (phase === 'error') return committed ? 'check-ledger' : 'cancel';
  return 'none';
}

/** What the post-commit `error` says instead of offering «Cancel». English, one place. */
export const CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE =
  'This submission may have gone out: a node can apply the transaction and lose its answer, and a Payment that entered ' +
  'cannot be cancelled from here. Nothing is being handed back — the seat this sitting pinned stays held until the ' +
  'ledger either shows the transaction or closes its window without it. Check the account on the explorer before ' +
  'composing anything again.';

/**
 * arriendo-ceremonia — THE DOOR BESIDE THIS ONE, AND WHAT IT IS TOLD.
 *
 * `ceremonyHoldsSeat` answered a yes/no, and the closed door said ONE sentence:
 * "cancel the ceremony there, and this door opens again". That sentence names an
 * exit that is NOT on screen in three of the five phases it covers — the
 * component's own test froze the dead end (`trapped === ['preparing',
 * 'submitting', 'done']`) — so a broadcast the node refused, which lands on
 * `done` like every other outcome, left the family reading "cancel it there" in
 * front of a card with no Cancel at all.
 */
export type SeatHold =
  /** No ceremony, and no lease we know of: the async door is the way in. */
  | 'none'
  /** A sitting is holding the seat AND «Cancel this ceremony» is on screen. */
  | 'exitable'
  /** Holding it with no exit here: a round trip in flight, or already broadcast. */
  | 'committed'
  /** The sitting ended and the seat's release could not be confirmed. */
  | 'unreleased';

/**
 * `committed` travels — an `error` after a broadcast that no node
 * confirmed is 'committed' (the async door reads «already sent a transaction»),
 * never 'exitable', which would promise a Cancel this screen no longer renders.
 */
export function seatHoldOf(phase: Phase, seatPinned: boolean, seatUnreleased: boolean, committed = false): SeatHold {
  if (ceremonyHoldsSeat(phase, seatPinned)) {
    return ceremonyExit(phase, committed) === 'cancel' ? 'exitable' : 'committed';
  }
  return seatUnreleased ? 'unreleased' : 'none';
}

/**
 * What the closed async door SAYS, per hold. One function so the promise on
 * screen can never again outrun the button that is actually rendered — the copy
 * is chosen by the same predicate that decides whether the exit exists.
 */
export function seatDoorNotice(
  hold: Exclude<SeatHold, 'none'>,
  t: (s: string) => string,
): { headline: string; body: string } {
  if (hold === 'unreleased') {
    return {
      headline: t('We could not confirm this council’s seat was handed back'),
      body: t(
        'The sign requests on the members’ phones were dealt with, but the record of that sitting could not be reached, so we cannot tell you the Sequence it pinned is free again. Filing a proposal here may still be refused until it is — which happens as soon as the transaction reaches the ledger, and in any case within 30 minutes of the sitting being opened.',
      ),
    };
  }
  if (hold === 'committed') {
    return {
      headline: t('This council’s seat is committed to the sitting above'),
      body: t(
        'That sitting is either waiting for an answer or has already sent a transaction from this browser, so the Sequence it pinned is spoken for and there is nothing left here to cancel: a proposal filed now would pin the same one, and only one of the two can ever reach the ledger. The seat is freed as soon as that transaction reaches the ledger, and in any case within 30 minutes of being pinned.',
      ),
    };
  }
  return {
    headline: t('The council is signing this transaction right now'),
    body: t(
      'While this ceremony is open it holds the Sequence it pinned on this account, so the same transaction cannot also be filed as a proposal: two live copies of one seat means one of them executes and the other becomes a row nobody can settle — which is how a council ends up paying twice. Finish the signatures above, or cancel the ceremony there, and this door opens again.',
    ),
  };
}

/**
 * LA PUERTA SE MUDA AL MÓDULO DEL ASIENTO, Y SIGUE SALIENDO DE AQUÍ.
 *
 * `releaseCeremonySeat` vivía en este componente y tenía UN solo llamador en
 * producción: el botón «Cancel this ceremony» de abajo. Cerrar el diálogo por
 * cualquiera de sus otras tres puertas (Escape, el fondo, la X) desmonta esto sin
 * llamar a nada, así que el asiento de nonce de ese 0xFE quedaba ocupado 24 h y
 * el único rescate estaba DENTRO de la ceremonia que ya no se puede abrir.
 */
export { releaseCeremonySeat };

/**
 * SOLTAR EL ASIENTO CUANDO XAMAN SE NEGÓ A MATAR LA PETICIÓN.
 *
 * `abandon()` collects every cancel it could not confirm into `strayPayload` and
 * then hands the seat back UNCONDITIONALLY. The question this answers is whether
 * that is right, and the answer is YES — with the reason said out loud instead of
 * assumed, which is what was missing.
 */
export function ceremonyOrphanWarned(
  stray: XamanStrayState | null,
  seatOutcome: 'released' | 'not-held' | 'unconfirmed' | null,
): boolean {
  return stray !== null && seatOutcome === 'released';
}

/** The sentence for that state. English, like the whole surface; one place. */
export const CEREMONY_ORPHAN_SENTENCE =
  'The seat this sitting held has been handed back, but one of the sign requests could not be confirmed dead. ' +
  'It cannot produce a second payment on this account — those bytes carry a pinned Sequence, so only one of any ' +
  'two can ever reach the ledger — but if that request is signed and lands anyway, its payment arrives carrying ' +
  'an instruction this app has already filed as abandoned. Check the account on an explorer before composing the ' +
  'same move again, and tell us if you find it: that one needs settling by hand.';

/**
 * The Xaman 1217 dead-end guard, matched on RAW failure text (detail-ceremonia).
 *
 * The route answers error 1217 with a sentence containing "does not allow this
 * app"; that sentence is the ONLY signal that the live ceremony cannot proceed
 * at all and the council must go out to the Multisign xApp. It used to be
 * matched against the strings on screen — which is fine only while those are
 * the raw ones. The moment refusals are humanised (and translated), a guard
 * matching the visible copy silently stops guarding, and the family is left
 * staring at a failed QR with no way out. So it matches `errorRaw`, never the
 * rendered sentence.
 */
export function xamanTypeRefused(raws: (string | undefined)[]): boolean {
  return raws.some((r) => typeof r === 'string' && r.includes('does not allow this app'));
}

/**
 * WHAT /multisign/prepare SAID WHEN IT WOULD
 * NOT PIN AN EXIT, WITHOUT BLAMING THE REGION FOR IT.
 */
export function multisignPrepareRefusal(err: unknown, t: (s: string) => string): ReadableRefusal | null {
  const r = describeServerRefusal(err, t);
  const body = (err as { body?: Record<string, unknown> } | null)?.body ?? {};
  const classification = typeof body.exitClassification === 'string' ? body.exitClassification : '';
  const tokenRejected = typeof body.exitTokenRejected === 'string' ? body.exitTokenRejected : '';
  const say = (text: string): ReadableRefusal => ({ ...r, text: r.detail && /\s/.test(r.detail) ? `${text} (${r.detail})` : text });

  if (r.code === 'EXIT_CLASSIFICATION_UNREADABLE' || classification === 'unreadable') {
    return say(
      t('The server could not read what this transaction is right now, so it could not confirm it is the exit it composed. Nothing was pinned and nothing was signed — try again in a moment; an exit is never closed, only unread.'),
    );
  }
  if (classification.startsWith('handoff-') || r.code === 'HANDOFF_NOT_SIGNABLE' || r.code.endsWith('_NOT_SIGNABLE')) {
    return say(
      t('The 0xFE payment behind this exit is no longer waiting to be signed — it was signed, executed or replaced. Check its state before composing anything, and prepare the exit again from its own screen if it is really gone.'),
    );
  }
  if (tokenRejected === 'expired') {
    return say(t('The exit pass of this transaction expired (it lasts 15 minutes). Prepare the exit again from its own screen and sign it with the quorum; nothing was signed.'));
  }
  if (tokenRejected === 'other-tx' || tokenRejected === 'other-account' || tokenRejected === 'bad-signature' || tokenRejected === 'malformed') {
    return say(t('The exit pass that came with this transaction is not for these exact bytes and this account, so the server did not take it. Prepare the exit again from its own screen — nothing was signed.'));
  }
  if (classification && classification !== 'not-an-exit') {
    return say(
      t('The server could not match this transaction to an exit it composed for this account, so it took the general door instead. If this is an exit, prepare it again from its own screen: exits are never closed.'),
    );
  }
  return null;
}

/**
 * THE CONTESTED SEAT, SAID WHERE THE COUNCIL SIGNS.
 *
 * WHAT FAILED IN SILENCE (§2.1). Replaced a hard 422 over an EXIT
 * with `seatContestWarning`, because a withdrawal must never be held behind
 * somebody else's payload. The warning was emitted and read by NOBODY: zero
 * references in `frontend/src`. So the family gathered a quorum over an exit
 * while another proposal of the same account held the same Sequence, learnt
 * nothing, and the chain the guard used to cut — a council paying twice — came
 * back through the door the fix had just opened. A warning with no reader is
 * worse than the refusal it replaced: it looks like a decision was taken.
 */
export type SeatNoticeKind =
  | 'rival-seat'
  | 'seat-already-spent'
  | 'seat-not-pinned'
  | 'unclassified-exit'
  | 'inbox-unreadable';

export interface SeatContestNotice {
  /** WHICH of the three things the server is warning about. */
  kind: SeatNoticeKind;
  headline: string;
  /** What happens to each of the two payloads — or what we could not read. */
  body: string;
  /** The rival proposal's id, when the server named it. Rendered as an id, never as prose. */
  proposalId?: string;
  /** The Sequence both are pinned to, when the server sent it. */
  pinnedSequence?: number;
}

/**
 * A KIND THIS LIST DOES NOT KNOW IS A WARNING THROWN AWAY.
 * The server stopped calling everything `rival-seat`: when the seat was already
 * spent, or when this payload was NOT pinned to the contested one, it says so
 * with its own kind. Anything missing here is silently dropped, so the two new
 * ones are here — and the renderer below prints the server's own `detail` for
 * them, which is where the sentence that must not be invented lives.
 */
const SEAT_NOTICE_KINDS: ReadonlySet<string> = new Set<SeatNoticeKind>([
  'rival-seat',
  'seat-already-spent',
  'seat-not-pinned',
  'unclassified-exit',
  'inbox-unreadable',
]);

/** The ids of a typed notice, validated. A title never travels (2.7). */
function seatNoticeIds(raw: { proposalId?: unknown; txType?: unknown; pinnedSequence?: unknown } | null): {
  proposalId?: string;
  txType?: string;
  pinnedSequence?: number;
} {
  const proposalId = typeof raw?.proposalId === 'string' && raw.proposalId.trim() ? raw.proposalId.trim() : undefined;
  const txType =
    typeof raw?.txType === 'string' && /^[A-Za-z]{2,40}$/.test(raw.txType.trim()) ? raw.txType.trim() : undefined;
  const pinnedSequence =
    typeof raw?.pinnedSequence === 'number' && Number.isFinite(raw.pinnedSequence) && raw.pinnedSequence > 0
      ? Math.trunc(raw.pinnedSequence)
      : undefined;
  return {
    ...(proposalId ? { proposalId } : {}),
    ...(txType ? { txType } : {}),
    ...(pinnedSequence !== undefined ? { pinnedSequence } : {}),
  };
}

/**
 * WHICH NOTICE WINS WHEN TWO ARRIVE.
 *
 * The route can emit a rival AND an «I could not classify this as an exit» for
 * the same prepare, and the screen painted both: one saying another payload
 * holds this account's Sequence, the other saying nobody said any such thing.
 * Two boxes, opposite claims, no order — and a family reading them decides from
 * whichever they read last.
 *
 * Lower number = said first and, where they contradict, the only one said. The
 * server may override it with its own `priority` (a deploy that knows better
 * than this table); anything else falls back here. Evidence beats absence: a
 * named rival outranks a read that failed.
 */
const SEAT_NOTICE_PRIORITY: Record<SeatNoticeKind, number> = {
  'rival-seat': 0,
  'seat-already-spent': 1,
  'seat-not-pinned': 2,
  'unclassified-exit': 3,
  'inbox-unreadable': 4,
};

/** The priority the server asked for, when it sent a sane one. */
function noticePriority(raw: Record<string, unknown>, kind: SeatNoticeKind): number {
  const p = raw?.priority;
  return typeof p === 'number' && Number.isFinite(p) ? p : SEAT_NOTICE_PRIORITY[kind];
}

/**
 * The server's own sentence for this notice — the one place the TRUE physics
 * lives («it was pinned to that seat» / «it was NOT pinned»). Dropped when it is
 * not prose, or when it is in Spanish: this is an English screen, and a Spanish
 * paragraph with hashes in it reads as a crash (`serverDetailIfEnglish`).
 */
function noticeDetail(raw: Record<string, unknown>): string | undefined {
  const said = typeof raw?.detail === 'string' ? raw.detail.trim() : '';
  if (!said || !/\s/.test(said)) return undefined;
  return serverDetailIfEnglish(said) ?? undefined;
}

/** The rival-seat notice: the only one where another payload really exists. */
function rivalSeatNotice(
  ids: { proposalId?: string; txType?: string; pinnedSequence?: number },
  t: (s: string) => string,
): SeatContestNotice {
  return {
    kind: 'rival-seat',
    // Without a Sequence the server never said the two
    // share one — saying «holding the SAME Sequence» there is asserting the
    // very thing the server declined to assert, and it is what sends a family
    // to re-liquidate a payment that may already have landed.
    headline:
      ids.pinnedSequence === undefined
        ? ids.txType
          ? `${t('Another payload of this account is collecting signatures')} (${ids.txType})`
          : t('Another payload of this account is collecting signatures')
        : ids.txType
      ? `${t('Another payload of this account is holding the same Sequence')} (${ids.txType})`
      : t('Another payload of this account is holding the same Sequence'),
    body: [
      t(
        'XRPL burns a Sequence exactly once. Signing and broadcasting this one means the other payload can no longer apply — nothing of it is lost, but its signatures stop being usable and it has to be composed again.',
      ),
      t(
        'This transaction is being composed anyway: capital coming back out is never held behind somebody else’s payload. Settle that other one in the proposal inbox — finish collecting its signatures and broadcast it, or register its transaction hash if it already went out — and check the account on an explorer before gathering the quorum here.',
      ),
    ].join(' '),
    ...(ids.proposalId ? { proposalId: ids.proposalId } : {}),
    ...(ids.pinnedSequence !== undefined ? { pinnedSequence: ids.pinnedSequence } : {}),
  };
}

/**
 * THE SCREEN WAS INVENTING A RIVAL.
 *
 * The server packs THREE different warnings into the seat channel:
 *   · a real rival payload holding this account's only Sequence;
 *   · a transaction it could not CLASSIFY as an exit (so it treated it as one,
 *     which is right, but nothing verified it);
 *   · an inbox it could not READ at all.
 * The screen printed the rival sentence for all three, so a council whose only
 * problem was a database blip was sent to settle a proposal that does not exist
 * — and the two true warnings had no reader. «No pude leer» rendered as a fact
 * is the same failure as a raw code, one level up.
 */
export function seatContestNotices(
  prep: { seatContestWarning?: unknown; seatContest?: unknown; seatNotices?: unknown } | null | undefined,
  t: (s: string) => string,
): SeatContestNotice[] {
  if (!prep) return [];
  const typed = Array.isArray(prep.seatNotices) ? (prep.seatNotices as Array<Record<string, unknown>>) : [];
  const ranked: Array<{ at: number; priority: number; notice: SeatContestNotice }> = [];
  typed.forEach((n, at) => {
    const kind = typeof n?.kind === 'string' && SEAT_NOTICE_KINDS.has(n.kind) ? (n.kind as SeatNoticeKind) : null;
    if (!kind) return;
    const ids = seatNoticeIds(n as { proposalId?: unknown; txType?: unknown; pinnedSequence?: unknown });
    // The server's own sentence is the body when it sent
    // one — it is the only text that says whether this payload was pinned to the
    // rival's seat or given the next free Sequence, and it was being dropped.
    const detail = noticeDetail(n);
    const push = (notice: SeatContestNotice) =>
      ranked.push({ at, priority: noticePriority(n, kind), notice: detail ? { ...notice, body: detail } : notice });
    if (kind === 'rival-seat') {
      push(rivalSeatNotice(ids, t));
      return;
    }
    if (kind === 'seat-already-spent') {
      push({
        kind,
        headline: t('That Sequence has already been used'),
        body: t(
          'Something consumed the Sequence this order was going to take — and it may well be this very payment landing. We are NOT telling you to settle anything: look the account up on an explorer first, because re-broadcasting or filing something that already applied is how a council pays twice.',
        ),
      });
      return;
    }
    if (kind === 'seat-not-pinned') {
      push({
        kind,
        headline: t('This transaction was not pinned to that seat'),
        /**
         * EL CUERPO DE RESERVA AFIRMABA UNA FÍSICA QUE EL
         * SERVIDOR NUNCA DIJO.
         *
         * Decía «Both can reach the ledger, in either order — nothing here has to be
         * settled before signing». No pinar NO significa llevar un número distinto:
         * las dos mitades salen del mismo `account_info`, así que lo normal es que
         * el asiento libre que nos dieron SEA el que esa fila retiene, y entonces
         * solo una de las dos puede aplicar. Esta frase se pinta justo cuando el
         * `detail` del servidor no llegó (o lo tumbó `serverDetailIfEnglish`), o sea
         * cuando esta pantalla es lo único que hay — y era el peor momento para
         * tranquilizar a nadie. Solo se dice lo que se sabe: no se pinó, y desde
         * aquí no se sabe si chocan.
         */
        body: t(
          'Another payload of this account holds a Sequence, and this one was NOT given that number. This screen was not told whether the two ended up carrying the same one: if they did, only one of them can ever apply — whichever reaches the ledger first — and the other costs only its fee. Look the account up on an explorer, and open its proposal inbox, before you gather the quorum.',
        ),
      });
      return;
    }
    if (kind === 'unclassified-exit') {
      push({
        kind,
        headline: t('We could not confirm this transaction is an exit'),
        body: t(
          'We could not read what it was composed from, so nothing here verified that it takes capital OUT — we are treating it as one anyway, because a failed read of ours must never hold capital in. Nobody said another payload is holding this account’s Sequence: open this account’s proposal inbox and check what is collecting signatures before you gather the quorum.',
        ),
        ...(ids.pinnedSequence !== undefined ? { pinnedSequence: ids.pinnedSequence } : {}),
      });
      return;
    }
    push({
      kind,
      headline: t('We could not read this account’s proposal inbox'),
      body: t(
        'So we cannot tell you whether another payload is already holding this account’s only Sequence — and we will not tell you there is one, because we did not see one. That is a failure of ours, not a verdict: this transaction is being composed anyway, because capital coming back out is never held behind a read of ours that failed. If a signature ceremony is open elsewhere on this account, only one of the two can reach the ledger — check the account on an explorer before gathering the quorum.',
      ),
      ...(ids.pinnedSequence !== undefined ? { pinnedSequence: ids.pinnedSequence } : {}),
    });
  });
  if (ranked.length > 0) {
    ranked.sort((a, b) => a.priority - b.priority || a.at - b.at);
    /**
     * ONE SITUATION, ONE NOTICE.
     *
     * A rival that the server NAMED is evidence; «we could not classify this»
     * and «we could not read the inbox» are absences of evidence, and their
     * sentences deny out loud what the rival notice asserts. Printing both at
     * once left the contradiction for the family to resolve, beside a QR.
     *
     * So once a rival is on screen the two «we could not read» notices are not
     * shown: nothing they say is lost that the rival notice does not already say
     * better, and neither of them may contradict a payload the server saw.
     * Several rivals are NOT a contradiction — each one is a different payload
     * to settle — so they all stay.
     */
    const hasRival = ranked.some((r) => r.notice.kind === 'rival-seat');
    return ranked.filter((r) => !hasRival || r.notice.kind === 'rival-seat').map((r) => r.notice);
  }
  // ── Older backend: one free-text field and, the rival's ids ──
  const warning = typeof prep.seatContestWarning === 'string' ? prep.seatContestWarning.trim() : '';
  const ids = seatNoticeIds(
    (prep.seatContest ?? null) as { proposalId?: unknown; txType?: unknown; pinnedSequence?: unknown } | null,
  );
  if (!warning && !ids.proposalId && !ids.txType && ids.pinnedSequence === undefined) return [];
  // `seatContest` is only ever filled for a REAL rival, so its presence is the
  // one piece of evidence that separates the three on an older deploy. Without
  // it, the warning is said WITHOUT asserting a rival that may not exist.
  if (ids.proposalId || ids.txType || ids.pinnedSequence !== undefined) return [rivalSeatNotice(ids, t)];
  return [
    {
      kind: 'inbox-unreadable',
      headline: t('The server warned about this account’s Sequence'),
      body: t(
        'It did not say whether another payload is really holding it, or whether it simply could not read — so this screen will not claim either. This transaction is being composed anyway: capital coming back out is never held behind somebody else’s payload. Open this account’s proposal inbox and check the account on an explorer before gathering the quorum.',
      ),
    },
  ];
}

/** The first notice, for callers that render one. Kept so older call sites work. */
export function seatContestNotice(
  prep: { seatContestWarning?: unknown; seatContest?: unknown; seatNotices?: unknown } | null | undefined,
  t: (s: string) => string,
): SeatContestNotice | null {
  return seatContestNotices(prep, t)[0] ?? null;
}

/**
 * THE TRUTH HAS TO REACH WHOEVER SIGNS.
 *
 * Put this warning «before the QR», and it was true — in the DOM. The
 * composer sees it above their own button; the COSIGNATORIES get a push on their
 * phone and sign a payload they were never shown this screen for. So the one
 * person who read the warning is the one who already knew, and the quorum — the
 * signatures that actually move the capital — is gathered blind.
 *
 * The same block is therefore rendered TWICE: once above the composer's button,
 * and once INSIDE each member's panel, right against their QR and their «Open in
 * Xaman to sign» link, so the sentence is physically between a member and their
 * signature. Nothing here is a gate: an exit is never held back.
 */
function SeatNoticeList({
  notices,
  compact = false,
}: {
  notices: SeatContestNotice[];
  compact?: boolean;
}) {
  const { t } = useT();
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n, i) => (
        <div
          key={`${n.kind}-${n.proposalId ?? i}`}
          className={`space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] ${compact ? 'p-2' : 'p-2.5'}`}
          role="alert"
        >
          <p className={`flex items-start gap-1.5 font-medium text-tone-warning ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {n.headline}
          </p>
          <p className={`leading-relaxed text-ink/55 ${compact ? 'text-[10.5px]' : 'text-[11px]'}`}>{n.body}</p>
          {n.proposalId || n.pinnedSequence !== undefined ? (
            <p className="font-mono text-[10.5px] text-ink/45">
              {n.pinnedSequence !== undefined ? `${t('Sequence')} ${n.pinnedSequence}` : null}
              {n.proposalId && n.pinnedSequence !== undefined ? ' · ' : null}
              {n.proposalId ? `${t('proposal')} ${n.proposalId}` : null}
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}

interface MemberSign {
  account: string;
  weight: number;
  uuid?: string;
  qrPng?: string;
  deeplink?: string;
  /** Xaman rang this member's phone (it had their push token). */
  pushed?: boolean;
  status: 'creating' | 'waiting' | 'signed' | 'rejected' | 'error';
  blob?: string;
  /** What this member's pill SAYS — humanised (detail-ceremonia). */
  error?: string;
  /** The same failure VERBATIM. The Xaman 1217 dead-end guard below matches on
   *  this, never on `error`: once the copy is humanised (or translated) a
   *  substring match on the visible sentence is a guard that silently stops
   *  guarding. */
  errorRaw?: string;
}

/**
 * consejo-superficies 1 — WHICH member requests are still LIVE in Xaman.
 *
 * The two doors that kill payloads (a fresh QR for one member, and cancelling
 * the whole ceremony) ask the same question, so they ask it in one place. Only
 * 'waiting' counts:
 *   · 'signed'  — Xaman ANSWERED that request. A DELETE returns ALREADY_RESOLVED,
 *                 which this rail renders as "it may have been signed on your
 *                 phone" — an alarm about a signature that arrived perfectly.
 *   · 'rejected' — the poll already read cancelled/expired: nothing to kill.
 *   · 'error' / 'creating' — either no payload was ever minted, or it was
 *                 answered and we refused the blob. Nothing signable is left.
 */
export function livePayloadUuids(
  members: Array<{ account: string; uuid?: string; status: MemberSign['status'] }>,
  onlyAccount?: string,
): string[] {
  return members
    .filter((m) => (onlyAccount === undefined || m.account === onlyAccount) && m.status === 'waiting')
    .map((m) => m.uuid)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
}

/**
 * arriendo-ceremonia — WHAT «Cancel this ceremony» ASKS XAMAN TO KILL.
 *
 * The rows' answer (`livePayloadUuids`) UNION the register of requests Xaman has
 * already answered a create for and React has not rendered yet. That second half
 * is the whole finding: a payload minted milliseconds ago is live on a member's
 * phone for 24 hours and invisible to `members`, so a cancel that only consults
 * the rows walks straight past it — five previous rounds closed one path each
 * and the sixth opened through the door the fifth had just built.
 *
 * A Set, so a uuid that is in both is asked about once: a second DELETE would
 * come back ALREADY_RESOLVED and raise an alarm about a request we killed
 * ourselves.
 */
export function ceremonyKillSet(
  members: Array<{ account: string; uuid?: string; status: MemberSign['status'] }>,
  minted: Iterable<string>,
): string[] {
  return [...new Set([...livePayloadUuids(members), ...minted])];
}

/**
 * Has Xaman ANSWERED this request? Then it can no longer be killed, and it must
 * leave the register: asking to cancel an answered payload returns
 * ALREADY_RESOLVED, which this rail renders as "it may have been signed on your
 * phone" — an alarm over a signature that arrived perfectly well.
 */
export function payloadAnswered(st: {
  signed?: boolean;
  cancelled?: boolean;
  expired?: boolean;
}): boolean {
  return st.signed === true || st.cancelled === true || st.expired === true;
}

export default function CouncilMultisigFlow({
  xrplTx,
  account,
  onSettled,
  onSeatHeld,
  onStaleFate,
  onDispatch,
  exitToken,
}: {
  xrplTx: Record<string, unknown>;
  account: string;
  /** The council-order prepare's token for an EXIT (recall / evacuate): sent
   *  with /multisign/prepare so the server skips the geofence for that exact tx.
   *  Forwarded verbatim; absent for every other transaction. */
  exitToken?: string | null;
  onSettled?: (hash: string) => void;
  /**
   * What this sitting has DONE with the bytes, as it happens:
   * started (the coordinator pins the seat), committed to a broadcast, the hash
   * the node handed back, the ledger's verdict. A host that must decide what a
   * CLOSE means — the quorum ceremony bus, whose caller is waiting on a promise —
   * reads it; the sixteen inline hosts need not pass it. Never a decision, only
   * a report.
   */
  onDispatch?: (event: CeremonyDispatchEvent) => void;
  /** Told whenever this ceremony starts or stops holding the account's pinned
   *  seat, so the surface around it can close the async door (consejo-
   *  superficies 2). Read by CouncilSigningDoors below — the only mount.
   *  arriendo-ceremonia: a `SeatHold`, not a boolean — the door has to
   *  say WHY it is closed, and "cancel it there" is a lie in two of the four. */
  onSeatHeld?: (hold: SeatHold) => void;
  /**
   * The broadcast came back tefPAST_SEQ / tefMAX_LEDGER over a
   * COUNCIL ORDER — the pinned Sequence was spent, possibly by a sibling of this
   * same order that is on its way to Flare. What became of the ORDER travels to
   * the surface around, which pauses composing until the person says they
   * checked (`useStaleOrderLock`). A ceremony over anything else says nothing.
   */
  onStaleFate?: (fate: StaleOrderFate, memoHex?: string | null) => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [prep, setPrep] = useState<MultisigPrepare | null>(null);
  const [members, setMembers] = useState<MemberSign[]>([]);
  // detail-ceremonia: the ceremony's own refusals are kept READ, not just
  // rendered — `.text` is what the council sees, `.raw` is what the Xaman
  // dead-end guard matches on.
  const [error, setError] = useState<ReadableRefusal | null>(null);
  const [result, setResult] = useState<ConfirmedSubmit | null>(null);
  /**
   * consejo-superficies 1 — a payload we asked Xaman to kill and could NOT
   * confirm dead. "We could not read the answer" is not "it is gone": these
   * requests live for 24 hours on a member's phone, so it is named here until
   * somebody reads it. Same state vocabulary and the same sentence as every
   * other surface with a Cancel over a live payload (payloadBus).
   */
  const [strayPayload, setStrayPayload] = useState<XamanStrayState | null>(null);
  /** A cancel round trip for the whole ceremony is in flight. */
  const [abandoning, setAbandoning] = useState(false);
  /**
   * arriendo-ceremonia: the last sitting ended and the server could
   * not confirm the seat was handed back. Keeps the async door CLOSED with the
   * reason instead of opening it onto a 422 the family cannot obey.
   */
  const [seatUnreleased, setSeatUnreleased] = useState(false);
  /**
   * The last sitting handed its seat back WHILE a sign request it
   * could not confirm dead may still be live. Not a gate and not an alarm about
   * the seat — see `ceremonyOrphanWarned` for why releasing is still right.
   */
  const [orphanRisk, setOrphanRisk] = useState(false);
  /**
   * What became of the ORDER after a broadcast the ledger can
   * never apply (tefPAST_SEQ / tefMAX_LEDGER). Shown here and reported out.
   */
  const [staleFate, setStaleFate] = useState<StaleOrderFate | null>(null);
  const onStaleFateRef = useRef(onStaleFate);
  onStaleFateRef.current = onStaleFate;
  const onDispatchRef = useRef(onDispatch);
  onDispatchRef.current = onDispatch;
  /**
   * HAS THIS SITTING COMMITTED TO A BROADCAST? Cleared only by a
   * NEW sitting (`start()`). It is what the unmount cleanup reads to refuse
   * handing back the seat of a Payment that may already be on the ledger — the
   * phase alone cannot say it, because a broadcast that threw lands on `error`,
   * the same phase as a failed mint.
   */
  const committedRef = useRef(false);
  const [committed, setCommitted] = useState(false);
  const commitToNode = () => {
    committedRef.current = true;
    setCommitted(true);
  };
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  // The unmount cleanup below has empty deps on purpose; the props it needs are
  // read through refs so it hands back the seat of the bytes on screen NOW.
  const accountRef = useRef(account);
  accountRef.current = account;
  const xrplTxRef = useRef(xrplTx);
  xrplTxRef.current = xrplTx;
  /**
   * arriendo-ceremonia — WHERE A MINTED PAYLOAD IS CERTAIN TO BE.
   *
   * This is the SIXTH time this family reopened its own 24-hour orphan by a new
   * door, so the register is the class fix rather than another patched path.
   * `members` cannot be that register: a payload is minted by an await, and
   * between Xaman answering the create and React re-rendering with the uuid
   * there is a window in which the request is live on a member's phone and
   * invisible to `livePayloadUuids`. Press «New QR» in that window (it stayed
   * enabled all through the DELETE fan-out of an abandon, up to 8s × N) and
   * `abandon()`'s `setMembers([])` landed first: the uuid was written into an
   * empty array, never stored, never cancelled, never named in any warning.
   * `resetMember` had the mirror case, and `start()` a third by index.
   */
  const openPayloadsRef = useRef<Set<string>>(new Set());
  /**
   * Which sitting a mint belongs to. Bumped when a ceremony starts or is
   * abandoned: a payload Xaman is still minting when that happens can no longer
   * land in the state, so it is killed where it lands instead of surviving as
   * an orphan for 24 hours.
   */
  const mintEpochRef = useRef(0);
  const membersRef = useRef<MemberSign[]>([]);
  membersRef.current = members;
  const prepRef = useRef<MultisigPrepare | null>(null);
  prepRef.current = prep;
  /**
   * THE NAME OF THIS SITTING, as `/multisign/prepare` handed it back.
   * Every release this sitting makes (the unmount cleanup, «Cancel this
   * ceremony», the late prepare) sends it, so a release that lands
   * AFTER a newer sitting re-pinned these bytes is a no-op server-side instead of
   * freeing that sitting's seat. `null` until the prepare returns — and the
   * cleanup says `null` then, which the server reads as «a sitting with no name,
   * that can reach nothing named». A ref, not state: the cleanup reads it in the
   * tick the screen is destroyed, and a late prepare reads its OWN answer.
   */
  const sittingIdRef = useRef<string | null>(null);
  // The provider hands a NEW `t` identity every render; the poll effect below
  // must not restart its 3 s interval for that, so it reads `t` through a ref.
  const tRef = useRef(t);
  tRef.current = t;

  // consejo-superficies 2 — the seat this ceremony holds, reported OUT. Through
  // a ref so an inline callback at a call site cannot restart the effect.
  // arriendo-ceremonia: what travels is the hold STATE, so the door
  // beside it can only ever promise an exit that is really on screen.
  const seatHold = seatHoldOf(phase, prep !== null, seatUnreleased, committed);
  const onSeatHeldRef = useRef(onSeatHeld);
  onSeatHeldRef.current = onSeatHeld;
  useEffect(() => {
    onSeatHeldRef.current?.(seatHold);
  }, [seatHold]);

  // Typed, one sentence per kind — and rendered in BOTH
  // places, because the composer is not the only person who signs.
  const seatNotices = seatContestNotices(prep, t);
  const collectedWeight = members.filter((m) => m.status === 'signed').reduce((s, m) => s + m.weight, 0);
  const quorum = prep?.council.quorum ?? 0;
  const quorumMet = quorum > 0 && collectedWeight >= quorum;

  /**
   * arriendo-ceremonia — THE ONLY PLACE THIS SCREEN MINTS A PAYLOAD.
   *
   * Both minting paths (`start` and «New QR») go through here, so the register
   * above cannot be forgotten by one of them — which is precisely how this bug
   * came back a sixth time, through the door the previous fix had just built.
   *
   * A mint that finishes after its sitting ended is killed HERE and returns
   * null: no state write will ever carry that uuid, so this is its only chance
   * to die instead of staying signable on a member's phone for 24 hours over a
   * Sequence the council has committed to.
   */
  // POR QUÉ AQUÍ NO SE RE-ESTAMPA LA CADUCIDAD DEL ASIENTO.
  //
  // `XamanSingleSign` avisa al servidor del instante real en que nace su payload
  // (`payload-opened`), porque su `expire` son 5 minutos y el desfase contra el
  // compose creaba el gemelo. Las peticiones de una ceremonia nacen con la
  // ventana que el servidor compuso para ESTA fila — hasta 24 h
  // (`ceremonyPayloadExpiryMin`) — y estamparlo sin más dejaría el
  // asiento de ese 0xFE ocupado un día entero. Sobre una SALIDA eso es tapiarla,
  // que es exactamente lo que el invariante prohíbe. La escapatoria es la puerta
  // del release, que esta pantalla SÍ llama ahora con el memo:
  // omisión leída, no olvido.
  const mintPayload = useCallback(
    async (memberAccount: string, tx: Record<string, unknown>, epoch: number) => {
      const pl = await createMemberPayload(tx, memberAccount);
      // Registered BEFORE anything else can be awaited or fail.
      openPayloadsRef.current.add(pl.uuid);
      if (mintEpochRef.current !== epoch) {
        const { cancelUi } = await cancelPayloadAndDecide(pl.uuid, () => pl.uuid);
        const stray = strayStateOf(cancelUi);
        // Only ever SET — and a kill we could not confirm is still named.
        if (stray) setStrayPayload(stray);
        openPayloadsRef.current.delete(pl.uuid);
        return null;
      }
      return pl;
    },
    [],
  );

  const start = useCallback(async () => {
    // A new sitting: anything the previous one is still minting is stale.
    const epoch = (mintEpochRef.current += 1);
    // A new sitting has committed to nothing yet, and the host is
    // told the coordinator is about to pin — from here the seat is this sitting's.
    committedRef.current = false;
    setCommitted(false);
    onDispatchRef.current?.({ stage: 'started' });
    setPhase('preparing');
    setError(null);
    // The previous sitting's unreleased seat is not this one's story: this
    // ceremony pins its own (and the server's upsert replaces the lease).
    setSeatUnreleased(false);
    // …and neither is the previous sitting's orphan warning: it belongs to bytes
    // this one is about to pin again.
    setOrphanRisk(false);
    // A new sitting has no name until the coordinator answers.
    sittingIdRef.current = null;
    try {
      const p = await xrplLegacy.multisignPrepare(account, xrplTx, exitToken ? { exitToken } : undefined);
      // The id of THIS prepare, read off THIS answer — never off the
      // ref, which a newer sitting of a remounted flow could not share anyway.
      const sittingId = prepareSittingId(p);
      // The screen went away while the coordinator was pinning (the
      // unmount cleanup bumps the epoch). The sitting is over and the seat it has
      // JUST taken goes straight back — the cleanup ran before there was a pin to
      // hand back, so this is its only chance.
      // …with its own name. «Back» in `preparing` + «Sign now» again
      // before this answer arrived means a NEWER sitting has pinned these bytes
      // by now; a release naming this dead one is a no-op there, as it must be.
      if (mintEpochRef.current !== epoch) {
        void releaseCeremonySeat(account, paymentMemoHex(xrplTx), sittingId).catch(() => {
          /* a screen that no longer exists has nowhere to report this */
        });
        return;
      }
      sittingIdRef.current = sittingId;
      setPrep(p);
      // Open one sign request per member (in parallel).
      const initial: MemberSign[] = p.council.signers.map((s) => ({ account: s.account, weight: s.weight, status: 'creating' }));
      setMembers(initial);
      setPhase('signing');
      await Promise.all(
        p.council.signers.map(async (s, i) => {
          try {
            const pl = await mintPayload(s.account, p.multisigTx, epoch);
            // Abandoned while Xaman was minting: it was killed in there, and
            // writing it by index would resurrect a row of a dead sitting.
            if (!pl) return;
            setMembers((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], uuid: pl.uuid, qrPng: pl.qrPng, deeplink: pl.deeplink, pushed: pl.pushed, status: 'waiting' };
              return next;
            });
          } catch (e) {
            if (mintEpochRef.current !== epoch) return;
            const r = describeServerRefusal(e, t);
            setMembers((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], status: 'error', error: r.text, errorRaw: r.raw };
              return next;
            });
          }
        }),
      );
    } catch (e) {
      // detail-ceremonia — THE 422 THAT STOPS A DOUBLE PAYMENT.
      //
      // WHAT FAILED IN SILENCE: this line was `setError((e as Error).message)`,
      // and `jpost` puts `body.error` in `.message`. The seat guard (d533b67)
      // answers 422 PRIOR_SEAT_UNRESOLVED with the prose that says a previous
      // proposal on this account is not settled and that composing another one
      // now is exactly how a council pays twice — and the ceremony printed the
      // slug. A dead end at the one moment the family MUST understand why.
      // an exit that could not take its own door is NOT a region refusal.
      setError(multisignPrepareRefusal(e, t) ?? describeServerRefusal(e, t));
      setPhase('error');
    }
  }, [account, xrplTx, exitToken, t, mintPayload]);

  // Poll waiting members until each is signed / rejected / expired.
  useEffect(() => {
    if (phase !== 'signing') return;
    const id = setInterval(() => {
      const waiting = membersRef.current.filter((m) => m.status === 'waiting' && m.uuid);
      if (waiting.length === 0) return;
      waiting.forEach(async (m) => {
        const st = await pollStatus(m.uuid!);
        // arriendo-ceremonia: Xaman ANSWERED this request, so it is
        // no longer killable — retiring it from the register is what keeps
        // «Cancel this ceremony» from raising ALREADY_RESOLVED over a signature
        // that arrived perfectly well. The verification verdict below does not
        // change that: a blob we refuse was still answered.
        if (payloadAnswered(st)) openPayloadsRef.current.delete(m.uuid!);
        if (st.signed && st.hex) {
          // Guard the IDENTITY + FIDELITY hole BEFORE the blob can count or combine:
          // a blob signed by the wrong member (Xaman `signers` rejected → any member
          // can answer any QR) is refused here, not silently combined.
          const expectedTx = prepRef.current?.multisigTx;
          try {
            if (expectedTx) verifySignerBlob(st.hex, m.account, expectedTx);
            setMembers((prev) => prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'signed', blob: st.hex } : x)));
          } catch (e) {
            // A BlobVerificationError already speaks plainly; anything else is
            // read through the one server-refusal reader (detail-ceremonia).
            const r = describeServerRefusal(e, tRef.current);
            const msg = e instanceof BlobVerificationError ? e.message : r.text;
            setMembers((prev) =>
              prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'error', error: msg, errorRaw: r.raw } : x)),
            );
          }
        } else if (st.cancelled || st.expired) {
          setMembers((prev) => prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'rejected' } : x)));
        }
      });
    }, 3000);
    return () => clearInterval(id);
  }, [phase]);

  /**
   * LO QUE SE QUEDA VIVO CUANDO ESTA PANTALLA DESAPARECE.
   *
   * The QRs are not the seat. Each member request is minted with the ceremony's
   * own window (up to 24 h), so closing the dialog with Escape, the backdrop or
   * the X used to leave one signable multisign request per member alive on their
   * phones with NOBODY left to cancel them: `abandon()` is a button, and a button
   * that is no longer rendered cannot press itself.
   */
  useEffect(() => {
    return () => {
      const live = [...openPayloadsRef.current];
      openPayloadsRef.current.clear();
      // From this line on, anything Xaman is still minting belongs to no sitting:
      // `mintPayload` kills whatever lands late instead of orphaning it — and a
      // prepare still in flight hands its own pin back when it lands (`start()`).
      mintEpochRef.current += 1;
      for (const uuid of live) {
        void cancelPayloadAndDecide(uuid, () => uuid).catch(() => {
          /* a screen that no longer exists has nowhere to report this */
        });
      }
      if (unmountReleasesSeat(phaseRef.current, prepRef.current !== null, committedRef.current)) {
        // `keepalive` inside: this runs in the tick the screen is destroyed.
        // named after THIS sitting (`null` in `preparing`, before the
        // coordinator answered — the late prepare then releases with the real
        // name). A `keepalive` request that lands after the person signed again
        // must not free the seat of the sitting that replaced this one.
        void releaseCeremonySeat(accountRef.current, paymentMemoHex(xrplTxRef.current), sittingIdRef.current).catch(() => {
          /* the banner already carries a refusal; nothing here can show one */
        });
      }
    };
  }, []);

  /**
   * Re-open ONE member's sign request. Xaman locks a payload to the first
   * client that opens it ("payload handled by another client"); the cure is a
   * FRESH payload for the SAME pinned tx — same Sequence/Fee/signer, so any
   * signature already collected from other members keeps counting.
   */
  const resetMember = useCallback(async (memberAccount: string) => {
    const tx = prepRef.current?.multisigTx;
    if (!tx) return;
    const epoch = mintEpochRef.current;
    const [prevUuid] = livePayloadUuids(membersRef.current, memberAccount);
    setMembers((prev) =>
      prev.map((x) =>
        x.account === memberAccount
          ? {
              ...x,
              status: 'creating',
              uuid: undefined,
              qrPng: undefined,
              deeplink: undefined,
              pushed: undefined,
              blob: undefined,
              error: undefined,
              // detail-ceremonia: the RAW failure feeds the Xaman 1217 dead-end
              // guard. Leaving it on a member who is being retried kept the
              // "go to the Multisign xApp" notice on screen over a fresh QR
              // that works — a dead end that had already been cured.
              errorRaw: undefined,
            }
          : x,
      ),
    );
    if (prevUuid) {
      const { cancelUi } = await cancelPayloadAndDecide(prevUuid, () => prevUuid);
      const stray = strayStateOf(cancelUi);
      // Only ever SET: minting a new request does not make the old one dead.
      if (stray) setStrayPayload(stray);
      // arriendo-ceremonia: retired from the register ONLY when Xaman
      // confirmed the kill. A DELETE we could not confirm leaves a request that
      // may still be signable, so «Cancel this ceremony» must still find it.
      if (!stray) openPayloadsRef.current.delete(prevUuid);
    }
    try {
      const pl = await mintPayload(memberAccount, tx, epoch);
      if (!pl) return; // the sitting ended while Xaman was minting this one
      setMembers((prev) =>
        prev.map((x) =>
          x.account === memberAccount
            ? { ...x, uuid: pl.uuid, qrPng: pl.qrPng, deeplink: pl.deeplink, pushed: pl.pushed, status: 'waiting' }
            : x,
        ),
      );
    } catch (e) {
      if (mintEpochRef.current !== epoch) return;
      const r = describeServerRefusal(e, t);
      setMembers((prev) =>
        prev.map((x) => (x.account === memberAccount ? { ...x, status: 'error', error: r.text, errorRaw: r.raw } : x)),
      );
    }
  }, [t, mintPayload]);

  /**
   * consejo-superficies 1 + 2 — THE EXIT THIS SURFACE NEVER HAD.
   *
   * There was no Cancel here at all. Leaving (the «Back» every call site
   * offers, or simply closing the tab) left one signable multisign request per
   * member alive in Xaman for the rest of its 24 hours, over a Sequence this
   * account had pinned — and nothing on any screen said so. It is also what
   * makes closing the async door beside this one honest rather than a trap:
   * the council can put the seat down, and then propose.
   */
  const abandon = useCallback(async () => {
    if (committedRef.current) return;
    setAbandoning(true);
    // arriendo-ceremonia: from this line on, nothing Xaman is still
    // minting belongs to this sitting — `mintPayload` kills whatever lands late
    // instead of letting it become a 24-hour orphan nobody recorded.
    mintEpochRef.current += 1;
    // The register is the SUPERSET of what the rows can see: a payload minted
    // milliseconds ago is not in `members` yet, and that window is exactly where
    // this bug kept coming back.
    const live = ceremonyKillSet(membersRef.current, openPayloadsRef.current);
    const answers = await Promise.all(live.map((uuid) => cancelPayloadAndDecide(uuid, () => uuid)));
    for (const a of answers) {
      const stray = strayStateOf(a.cancelUi);
      if (stray) setStrayPayload(stray);
    }
    openPayloadsRef.current.clear();
    // THE SEAT, AND IT IS SERVER-SIDE. This comment used to say the ceremony
    // "gives the seat back" while no HTTP call was made at all: the prepare had
    // leased this council's Sequence for 30 minutes, so one click later
    // «Propose to the council» answered 422 CEREMONY_IN_FLIGHT — "finish or
    // abandon that sitting" — to a family that had just abandoned it, with no
    // way to obey, and the council's MoneyFlow rule burned its cooldown on the
    // same refusal. The QRs are killed FIRST on purpose: handing the seat back
    // while requests are still signable would reopen the async door over bytes
    // a member can still sign.
    // el memo del 0xFE viaja con la cancelación. Sin él el servidor
    // devolvía la Sequence y dejaba el asiento de nonce ocupado 24 h — la mitad
    // de la puerta que nadie llamaba.
    // «Cancel» hands back THIS sitting's seat, by name. Another tab of
    // the same session that pinned these bytes after us keeps its seat.
    const outcome = await releaseCeremonySeat(account, paymentMemoHex(xrplTx), sittingIdRef.current);
    // Only a READ answer closes this: 'unconfirmed' keeps the async door shut
    // WITH the reason rather than opening it onto a refusal we already know of.
    setSeatUnreleased(outcome === 'unconfirmed');
    // The seat went back while a request may still be signable. The
    // reasoning for doing it anyway is on `ceremonyOrphanWarned`; what was missing
    // was saying so. `strayStateOf` only ever SETS above, so the answers collected
    // in this very call are what decides — never a stale flag from a past sitting.
    setOrphanRisk(ceremonyOrphanWarned(answers.map((a) => strayStateOf(a.cancelUi)).find((x) => x) ?? null, outcome));
    // Nothing collected here is stored — the idle copy says so.
    setMembers([]);
    setPrep(null);
    setError(null);
    setResult(null);
    setPhase('idle');
    setAbandoning(false);
    // The host learns the sitting is over — a close from here on is
    // a close over nothing of this sitting's.
    onDispatchRef.current?.({ stage: 'abandoned' });
  }, [account, xrplTx]);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError(null);
    setStaleFate(null);
    // Did a node ANSWER the submit? Decides what a throw below means
    // — before an answer, the bytes may have entered a node whose reply was
    // lost; after one, the hash already travelled and the bus already knows.
    let nodeAnswered = false;
    try {
      const blobs = membersRef.current.filter((m) => m.status === 'signed' && m.blob).map((m) => m.blob!);
      // Local arithmetic over the collected signatures. If it throws, nothing has
      // left this browser — which is why the commitment is stamped AFTER it.
      const combined = multisign(blobs);
      // /: from this line the bytes are committed to a
      // node. The unmount cleanup will not hand the seat back, «Cancel» is no
      // longer offered, and the host is told.
      commitToNode();
      onDispatchRef.current?.({ stage: 'submitting' });
      // Submit AND wait for the validated ledger: the preliminary tesSUCCESS
      // can still land as tec* (the family's proven case was exactly this
      // ceremony, 6 validated-but-failed txns). onSettled only fires on the
      // ledger's verdict, never on the submit's.
      const sub = await broadcast(combined);
      nodeAnswered = true;
      if (sub.hash && broadcastMayLand(sub.engine)) notifyHandoffSigned(flareInstructionMemoOf(xrplTx), sub.hash);
      onDispatchRef.current?.({ stage: 'broadcast', hash: sub.hash, engine: sub.engine, message: sub.message });
      let res: ConfirmedSubmit;
      if (sub.engine !== 'tesSUCCESS' || !sub.hash) {
        res = { ...sub, validated: false };
      } else {
        const v = await awaitValidation(sub.hash);
        res = { ...sub, ...v };
        onDispatchRef.current?.({
          stage: 'validation',
          hash: sub.hash,
          validated: v.validated,
          finalResult: v.finalResult,
          timedOut: v.timedOut,
        });
      }
      setResult(res);
      setPhase('done');
      if (res.validated && res.finalResult === 'tesSUCCESS' && res.hash) onSettled?.(res.hash);
      // THE SEAT WAS SPENT BY SOMEBODY ELSE'S COPY.
      // The node answered tefPAST_SEQ / tefMAX_LEDGER: THIS transaction can
      // never validate, and over a council order the copy that spent the
      // Sequence may be a sibling of the SAME order already on its way. «Back»
      // then led straight to composing it again — the capital moved twice. Ask
      // what became of the order and hand the verdict to the surface around.
      if (!res.validated && isStaleDispatch(res.engine)) {
        const memo = councilOrderMemoOf(xrplTx);
        if (memo) {
          setStaleFate({ kind: 'checking' });
          onStaleFateRef.current?.({ kind: 'checking' }, memo);
          const read = await readCouncilOrderFate(memo).catch(() => ({ ok: false as const, status: 0 }));
          const fate = staleOrderFate(read);
          setStaleFate(fate);
          // The memo travels so the surface can remember the lock per order and
          // not lose it to an F5 (R5 5.5).
          onStaleFateRef.current?.(fate, memo);
        }
      }
    } catch (e) {
      // Same reader as the prepare door: a combine/broadcast refusal is prose
      // here too, never a bare code (detail-ceremonia).
      setError(describeServerRefusal(e, t));
      setPhase('error');
      // Committed, and no node answered — the host learns that the
      // broadcast went UNCONFIRMED (not «never started», not `abandoned`): a close
      // from here on is a close over a Payment that may be on the ledger. A throw
      // after the node answered changes nothing the bus does not already hold.
      if (committedRef.current && !nodeAnswered) {
        onDispatchRef.current?.({ stage: 'broadcast-failed', message: (e as Error)?.message });
      }
    }
  }, [onSettled, t, xrplTx]);

  // The SYNCHRONOUS tempo, named as such. It sits next to ProposeToCouncil (the
  // async one) at every call site, so each has to say what it costs the family:
  // everyone now, or everyone eventually. Without the second line the two
  // buttons read as the same act twice.
  if (phase === 'idle') {
    return (
      <div className="space-y-1">
        <PrimaryButton onClick={() => void start()}>
          <Users size={14} /> {t('Sign now, all together')}
        </PrimaryButton>
        <p className="text-[11px] text-ink/40">
          {t(
            'Everyone signs in this sitting: one QR per member on this screen, and a notification to the Xaman of anyone who has signed here before. Nothing is stored — if this screen closes, the signatures are lost.',
          )}
        </p>
        {/* consejo-superficies 1 — a cancel we could not confirm outlives the
            ceremony it belonged to: abandon() ends HERE, and a warning that
            disappeared with the card would be the same silence again. */}
        {strayPayload && (
          <InlineNotice tone="warning">
            <div className="space-y-2">
              <p>{payloadStrayNotice(strayPayload, t)}</p>
              <GhostButton onClick={() => setStrayPayload(null)}>{t('Close')}</GhostButton>
            </div>
          </InlineNotice>
        )}
        {/* EL HUÉRFANO, DICHO. The seat really went back and a
            request could not be confirmed dead: the twin is impossible (pinned
            Sequence) but a late landing would arrive over a row already filed as
            abandoned. Said next to the stray warning, never instead of it. */}
        {orphanRisk && (
          <InlineNotice tone="warning">{t(CEREMONY_ORPHAN_SENTENCE)}</InlineNotice>
        )}
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-ink/50" />
        <SectionTitle>{t('Council signatures')}</SectionTitle>
        {prep && (
          <Pill tone={quorumMet ? 'success' : 'warning'}>
            {collectedWeight}/{quorum} {t('quorum')}
          </Pill>
        )}
      </div>

      {phase === 'preparing' && (
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={14} className="animate-spin" /> {t('Reading the council and pinning the transaction…')}
        </p>
      )}

      {/* BEFORE THE QRs, NOT AFTER. The council reads what the
          seat costs the other payload while there is still nothing to undo:
          once a member scans, a signature exists. Rendered from the IDs the
          server sent, never from the prose (it names another council's title). */}
      <SeatNoticeList notices={seatNotices} />

      {/* The simulate preflight (#11): ledger truth before anyone signs. */}
      {prep && (
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5 text-[12px]">
          {prep.preflight.available ? (
            prep.preflight.willSucceed ? (
              <InlineNotice tone="success">
                {t('Ledger dry-run: this transaction would succeed')} ({prep.preflight.engineResult}).
              </InlineNotice>
            ) : (
              <InlineNotice tone="warning">
                {t('Ledger dry-run says it would FAIL:')} {prep.preflight.engineResult} — {prep.preflight.engineResultMessage}
              </InlineNotice>
            )
          ) : (
            <p className="text-ink/45">{t('Ledger dry-run unavailable on this node — proceed with care.')}</p>
          )}
          <p className="mt-1 text-ink/45">
            {t('Fee')}: {prep.fee.drops} drops ({t('base')} {prep.fee.baseFeeDrops} × (1 + {prep.fee.signerCount})).
          </p>
        </div>
      )}

      {/* One card per member: QR + status. Each signs on their own device. */}
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.account} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 p-2.5">
            <span className="font-mono text-sm text-ink/80">{shortAddr(m.account)}</span>
            <span className="text-[11px] text-ink/40">{t('weight')} {m.weight}</span>
            {m.status === 'creating' && <Loader2 size={14} className="animate-spin text-ink/40" />}
            {m.status === 'waiting' && (
              <>
                {/* Same fix as the inbox (E7 QA móvil): a 96px QR is hard to
                    scan, and on the phone the family signs from you cannot
                    scan your own screen at all — the deeplink IS the action
                    there, so it wears a button. */}
                {m.qrPng && (
                  <img
                    src={m.qrPng}
                    alt={t('Xaman QR')}
                    className="h-32 w-32 shrink-0 rounded bg-white p-1 sm:h-36 sm:w-36"
                  />
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Pill tone="warning">{t('waiting for signature')}</Pill>
                  {m.deeplink && (
                    <a
                      href={m.deeplink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-volt/40 bg-volt/10 px-3 py-2 text-[12px] font-medium text-volt transition-colors hover:bg-volt/20"
                    >
                      <ExternalLink size={13} /> {t('Open in Xaman to sign')}
                    </a>
                  )}
                  {/* Say WHICH way the request travelled — the same honesty the
                      inbox already had. A member whose phone rang can sign from
                      wherever they are; one who was not pushed needs the QR in
                      front of them, and the ceremony has to know the difference. */}
                  <span className="text-[11px] text-ink/45">
                    {m.pushed
                      ? t('Sent to their Xaman as a notification — the QR still works.')
                      : t('No notification yet for this member: they sign the QR once, and from then on Xaman can notify them.')}
                  </span>
                </div>
              </>
            )}
            {m.status === 'signed' && (
              <Pill tone="success">
                <Check size={12} /> {t('signed')}
              </Pill>
            )}
            {m.status === 'rejected' && <Pill tone="danger">{t('rejected / expired')}</Pill>}
            {m.status === 'error' && <Pill tone="danger">{m.error ?? t('error')}</Pill>}
            {phase === 'signing' && m.status !== 'signed' && m.status !== 'creating' && (
              // arriendo-ceremonia: `abandoning` used to switch off
              // the Cancel button alone, leaving this one live through the whole
              // DELETE fan-out (up to 8s × N) — one press there minted a
              // 24-hour request that `setMembers([])` then threw away. The
              // register above is what actually makes that safe; this is the
              // honest half, so the door is not offered while it is closing.
              <GhostButton onClick={() => void resetMember(m.account)} disabled={abandoning}>
                <RefreshCw size={12} /> {t('New QR')}
              </GhostButton>
            )}
            {/* IT WAS INSIDE THE «waiting» BRANCH.
                Put this beside each member's QR so a cosignatory reads
                what they are signing over. But it lived inside `status ===
                'waiting'`, so the moment anyone pressed «New QR» — status
                'creating', then 'waiting' again with a new payload — the
                warning blinked out exactly for the person who had just asked
                for a fresh request, and it never existed at all for a member
                whose payload errored and who is about to ask for another. It
                now sits beside the row for as long as that member still has a
                signature to give. Never a gate: an exit is never held back. */}
            {m.status !== 'signed' && (
              <div className="w-full space-y-1">
                <SeatNoticeList notices={seatNotices} compact />
              </div>
            )}
          </li>
        ))}
      </ul>

      {phase === 'signing' && (
        <PrimaryButton onClick={() => void submit()} disabled={!quorumMet}>
          <Send size={14} /> {quorumMet ? t('Combine & broadcast') : t('Waiting for the quorum…')}
        </PrimaryButton>
      )}

      {/* consejo-superficies 1 — the way out. Without it, the only ways to
          leave a ceremony were the call site's «Back» and closing the tab, both
          of which leave one signable 24-hour request per member behind. */}
      {ceremonyExit(phase, committed) === 'cancel' && (
        <div className="space-y-1">
          <GhostButton onClick={() => void abandon()} disabled={abandoning}>
            {abandoning ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
            {t('Cancel this ceremony')}
          </GhostButton>
          <p className="text-[11px] text-ink/40">
            {t(
              'Cancelling asks Xaman to kill the requests still open on the members’ phones. Signatures collected in this sitting are not stored, so they are lost.',
            )}
          </p>
        </div>
      )}

      {/* The `error` AFTER a commit: no node confirmed the submit,
          and the first may have applied it. No «Cancel» here — a Cancel over
          bytes that may be on the ledger is how the twin was built — but the
          ledger itself, which is the only thing that can answer. The seat is
          freed by the server's own window read, never from this screen. */}
      {ceremonyExit(phase, committed) === 'check-ledger' && (
        <InlineNotice tone="warning">
          <div className="space-y-2">
            <p>{t(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE)}</p>
            <a
              href={`${XRPSCAN_ACCOUNT}${account}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] underline underline-offset-2"
            >
              <ExternalLink size={12} /> {t('Check the ledger')}
            </a>
          </div>
        </InlineNotice>
      )}

      {/* consejo-superficies 1 — a request we could NOT confirm dead. It may
          still be signable on that member's phone for the rest of its 24
          hours, so it stays named until somebody reads it. One sentence,
          shared with every other surface that cancels a payload. */}
      {strayPayload && (
        <InlineNotice tone="warning">
          <div className="space-y-2">
            <p>{payloadStrayNotice(strayPayload, t)}</p>
            <GhostButton onClick={() => setStrayPayload(null)}>{t('Close')}</GhostButton>
          </div>
        </InlineNotice>
      )}
      {/* The same sentence, on the card: a sitting that ends in
          'error' stays here, and the orphan must not depend on which branch
          the phase happened to land in. */}
      {orphanRisk && <InlineNotice tone="warning">{t(CEREMONY_ORPHAN_SENTENCE)}</InlineNotice>}

      {phase === 'submitting' && (
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={14} className="animate-spin" /> {t('Combining the signatures and broadcasting from your browser…')}
        </p>
      )}

      {result && (
        <div className="space-y-1">
          {result.validated && result.finalResult === 'tesSUCCESS' ? (
            <InlineNotice tone="success">{t('Validated — the ledger applied it.')}</InlineNotice>
          ) : result.validated ? (
            <InlineNotice tone="warning">
              {t('The ledger validated it but it FAILED:')} {result.finalResult}
            </InlineNotice>
          ) : result.engine === 'tesSUCCESS' ? (
            <InlineNotice tone="warning">
              {t('Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; do not assume it applied.')}
            </InlineNotice>
          ) : staleFate ? (
            // The Sequence this ceremony pinned was already spent. Say
            // what became of the ORDER before anything suggests composing again.
            <InlineNotice tone="warning">
              {staleFate.kind === 'checking' ? <Loader2 size={12} className="mr-1 inline animate-spin" /> : null}
              {t(staleSentence(staleFate))} ({result.engine})
            </InlineNotice>
          ) : (
            <InlineNotice tone="warning">
              {result.engine} — {result.message}
            </InlineNotice>
          )}
          {staleFate && (staleFate.kind === 'already-out' || staleFate.kind === 'out-failed') && staleFate.txHash ? (
            <a href={`${XRPSCAN_TX}${staleFate.txHash}`} target="_blank" rel="noreferrer" className="block break-all font-mono text-[11px] text-ink/50 underline">
              {t('The request that went out')}: {staleFate.txHash}
            </a>
          ) : null}
          {result.hash && (
            <a href={`${XRPSCAN_TX}${result.hash}`} target="_blank" rel="noreferrer" className="text-sm text-ink/60 underline">
              {t('View on XRPScan')}
            </a>
          )}
        </div>
      )}

      {error && <InlineNotice tone="warning">{error.text}</InlineNotice>}

      {/* Dead-end guard: when Xaman refuses to create the sign
          request for this transaction TYPE (error 1217 — account-security
          types are granted per app), the live ceremony cannot proceed at all.
          Say where the way out is instead of leaving the council staring at a
          failed QR: the proposal inbox takes a signature produced by any
          multisign tool. */}
      {xamanTypeRefused([error?.raw, ...members.map((m) => m.errorRaw)]) && (
        <InlineNotice tone="warning">
          {t(
            'Xaman will not create QRs for this transaction type from this app. The proven route is the Xaman Multisign xApp — the same one this council was constituted with: open “Prefer your own multisign tool?” below, copy the transaction and sign it there with the quorum.',
          )}
        </InlineNotice>
      )}
    </Card>
  );
}

/**
 * consejo-superficies 2 — THE TWO TEMPOS, AND WHY BOTH CANNOT BE OPEN AT ONCE.
 *
 * WHAT FAILED IN SILENCE: `ProposeToCouncil` was rendered directly under
 * `CouncilMultisigFlow` at all FOUR call sites (LegacyPanel, CouncilOrderCard,
 * CouncilVaultEntry, CageBirthCard) with no condition on the ceremony's phase.
 * With a ceremony in flight — Sequence pinned, one 24-hour signable QR per
 * member already on their phones — the button beside it ("Nobody has to be
 * here") composed the SAME transaction again on the SAME seat. The server's
 * one-live-proposal rule never catches it, because a ceremony is not a
 * proposal. Whichever copy executes first spends the Sequence, and the other
 * becomes a row the ledger says is spent: the family's next move is to compose
 * the payment again, with a fresh Sequence — and the council pays twice.
 */
export function CouncilSigningDoors({
  xrplTx,
  account,
  defaultTitle,
  onSettled,
  onProposed,
  onBlockedChange,
  onStaleFate,
  exitToken,
}: {
  xrplTx: Record<string, unknown>;
  account: string;
  /**
   * council-order/prepare's exit token (recall / evacuate, pote exits, the
   * creator exit) — handed to the live ceremony's /multisign/prepare so the exit
   * takes its own door instead of the general one. EVERY console that signs an
   * exit through these doors forwards it: two of them did not, and their exits
   * came back 451 whenever the order could not be classified (R3 3.1).
   */
  exitToken?: string | null;
  /** Prefill for the short human summary shown in the inbox. */
  defaultTitle?: string;
  onSettled?: (hash: string) => void;
  onProposed?: (proposalId: string) => void;
  /** Told true while a ceremony holds the seat (any hold but 'none'): the surface around hides its way back. */
  onBlockedChange?: (blocked: boolean) => void;
  /** This order's seat was spent — what became of the ORDER (see CouncilMultisigFlow). */
  onStaleFate?: (fate: StaleOrderFate, memoHex?: string | null) => void;
}) {
  const { t } = useT();
  const [seatHold, setSeatHold] = useState<SeatHold>('none');
  const onBlockedRef = useRef(onBlockedChange);
  onBlockedRef.current = onBlockedChange;
  const blocked = seatHold !== 'none';
  // A FRESH mount never reports «not blocked». The flow starts
  // at 'none' before it knows anything, and reporting that on a remount reopened
  // a Back / rail / tab the previous mount had closed over a hand-off that
  // already happened (the OmnibusSignDoor rule). Only a real transition speaks.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (!blocked && !reportedRef.current) return;
    reportedRef.current = true;
    onBlockedRef.current?.(blocked);
  }, [blocked]);
  // arriendo-ceremonia: the sentence is CHOSEN by the same predicate
  // that decides whether the exit exists, so the closed door can no longer send
  // the family to a «Cancel» that three of its five phases never render — and
  // it can now also say the fourth thing, that the seat's release went unread.
  const notice = seatHold === 'none' ? null : seatDoorNotice(seatHold, t);
  return (
    <>
      <CouncilMultisigFlow
        xrplTx={xrplTx}
        account={account}
        onSettled={onSettled}
        onSeatHeld={setSeatHold}
        onStaleFate={onStaleFate}
        exitToken={exitToken}
      />
      {notice ? (
        <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-tone-warning">
            <Inbox size={13} /> {notice.headline}
          </p>
          <p className="text-[11px] leading-relaxed text-ink/50">{notice.body}</p>
        </div>
      ) : (
        <ProposeToCouncil xrplTx={xrplTx} account={account} defaultTitle={defaultTitle} onProposed={onProposed} />
      )}
    </>
  );
}

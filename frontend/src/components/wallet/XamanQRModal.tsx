"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { Loader2, ShieldCheck, ArrowUpRight, X, Clock, Smartphone, AlertTriangle, Check } from 'lucide-react';
import {
  onXamanPayload,
  onXamanStatus,
  emitXamanPayload,
  cancelPayloadAndDecide,
  decideCloseStep,
  humanizeXamanSummary,
  payloadStrayNotice,
  releaseInFlightCancel,
  resolveClearAction,
  resolvePanelVoice,
  resolveStatusAction,
  type XamanCancelUi,
  type XamanInFlightCancel,
  type XamanPayloadPrompt,
  type XamanPayloadStatus,
} from '../../lib/xaman/payloadBus';
import { useModalRegistration } from '../ui/ModalPortal';
import { useCountdown } from '../../lib/useCountdown';
import { useT } from '../../i18n/LanguageProvider';

/**
 * XamanQRModal — the signing surface for every Xaman payload (sign-in and
 * transactions). Globally mounted; listens on the payload bus.
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// useCountdown moved to lib/useCountdown so the institutional
// exit clock could share it — this consumer IMPORTS, it keeps no copy.

export function XamanQRModal() {
  const { t } = useT();
  const [prompt, setPrompt] = useState<XamanPayloadPrompt | null>(null);
  const [status, setStatus] = useState<XamanPayloadStatus>('pending');
  // Latest values for callbacks that outlive a render (bus listeners, close).
  const promptRef = useRef<XamanPayloadPrompt | null>(null);
  const statusRef = useRef<XamanPayloadStatus>('pending');
  // xaman-cancelar 2: is `status === 'expired'` something we READ, or something
  // the countdown below INFERRED from a deadline this component computed? The
  // two terminal panels stand down for a real resolution and must not stand
  // down for a guess — see XamanStatusOrigin in the bus.
  const localExpiryRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Cancelling is a round trip to Xaman that can FAIL (UI-qr-xaman): 'alive'
  // (Xaman refused — the request really is still signable) and 'unknown' (we
  // never got an answer) keep the panel up telling the truth instead of closing
  // on a promise we could not keep. The ref mirrors it for the async handler.
  const [cancelState, setCancelState] = useState<XamanCancelUi>('idle');
  const cancelStateRef = useRef<XamanCancelUi>('idle');
  // QR-cierre A: the escape hatch out of 'cancelling'. While the round trip is
  // in flight the panel refuses Escape / backdrop / X, so an upstream that
  // never answers used to leave the user locked in with the page scroll held
  // and only one way out — signing. Aborting is honest ('unknown') and instant.
  //
  // It is released through releaseInFlightCancel and NOWHERE ELSE (QR-cierre
  // final): that helper is the single place allowed to abort a DELETE, and it
  // only does so for the user's own "stop waiting".
  const inFlightCancelRef = useRef<XamanInFlightCancel | null>(null);
  const reduce = useReducedMotion();
  const mobile = isMobileDevice();
  const { label: countdown, expired: countdownExpired } = useCountdown(prompt?.expiresAt);

  const statusOrigin = { expiryIsLocalGuess: localExpiryRef.current };
  // ONE precedence for the four things this panel can be saying, resolved in the
  // bus so a test can execute it (uuid-status 2; the vitest env is `node`, no
  // jsdom). It keeps the rule that a terminal panel must never CONTRADICT what
  // Xaman just told us — "The code expired. Nothing was signed." over a request
  // Xaman says was answered, or refused to cancel, is a false all-clear
  // (xaman-cancelar 2) — and adds the one the inline version was missing:
  // 'invite' is the ONLY voice allowed to show a code, a countdown and
  // "waiting for your signature". The amber warning used to be painted next to
  // all three, so the panel begged the person to kill the request and to sign
  // it at the same time.
  const voice = resolvePanelVoice(status, cancelState, statusOrigin);
  // Xaman told us the request was ALREADY ANSWERED when we tried to cancel it
  // (QR-cierre final). We do not know the answer — only that this QR is spent —
  // so the code, the countdown and "waiting for your signature" all stop being
  // true and come off the screen, and the panel says exactly that much.
  const answeredElsewhere = voice === 'answered';
  const warnAlive = voice === 'stray';
  const terminal = voice === 'terminal';
  const inviting = voice === 'invite';

  useEffect(() => {
    // Subscribe to the bus. We intentionally do NOT touch the wallet service
    // here so its XRPL WebSocket isn't constructed at app load.
    const offPrompt = onXamanPayload((p, clearedUuid) => {
      if (p) {
        // A fresh payload supersedes whatever we were still asking about. We
        // let go of the HANDLE and let the DELETE finish (QR-cierre final):
        // aborting it here killed the request for the OLD payload mid-flight,
        // so that payload stayed signable on the phone, its ceremony never got
        // onXamanCancelled, and the user was told nothing — the founding bug of
        // this surface, through a new door. Its late ANSWER is what gets
        // dropped, by uuid, in resolveCancelAction below.
        inFlightCancelRef.current = releaseInFlightCancel(
          inFlightCancelRef.current,
          'superseded',
        );
        promptRef.current = p;
        statusRef.current = 'pending';
        cancelStateRef.current = 'idle';
        localExpiryRef.current = false;
        setPrompt(p);
        setStatus('pending'); // fresh payload → fresh state
        setCancelState('idle');
        return;
      }
      // A CLEAR. Whose? (xaman-cancelar 1 + 5.) Every ceremony emits one when
      // its own payload resolves, so an untagged `null` from the cancelled
      // payload A used to wipe payload B off the screen — alive, signable, no
      // DELETE, no word to the user. And a clear must not erase a warning
      // nobody has read: the ceremony behind an 'alive' / 'unknown' /
      // 'resolved' panel rejects at PAYLOAD_TIMEOUT and clears, which made the
      // alarm disappear by itself five minutes later. The branch table lives in
      // the bus so a test can execute it (vitest env is `node`, no jsdom).
      const action = resolveClearAction({
        onScreenUuid: promptRef.current?.uuid ?? null,
        clearedUuid,
        status: statusRef.current,
        cancelUi: cancelStateRef.current,
      });
      if (action !== 'clear') return;
      promptRef.current = null;
      localExpiryRef.current = false;
      setPrompt(null);
    });
    const offStatus = onXamanStatus((s, statusUuid) => {
      // WHOSE status is this? (uuid-status.) The payload channel above was
      // disciplined by uuid and this one was not, so the bug walked through the
      // one door left open: every ceremony shares this bus, so payload A
      // resolving wrote ITS terminal state onto the panel showing payload B. B
      // then read as 'signed' / 'rejected' / 'expired' to decideCloseStep,
      // which answers 'close' — the panel left with NO DELETE and B stayed
      // alive and signable on the phone, in silence. The reverse order silenced
      // a terminal panel nobody had read yet, by overwriting it with a stray
      // 'pending'. The branch lives in the bus so a test can execute it (vitest
      // env is `node`, no jsdom) — this wiring is where the bug lived all five
      // times.
      const action = resolveStatusAction({
        onScreenUuid: promptRef.current?.uuid ?? null,
        statusUuid,
      });
      if (action !== 'apply') return;
      // Anything arriving on this channel was READ from Xaman's websocket or
      // poll: it outranks whatever the local countdown guessed.
      statusRef.current = s;
      localExpiryRef.current = false;
      setStatus(s);
    });
    return () => {
      offPrompt();
      offStatus();
    };
  }, []);

  // A dead QR must say so: when the local countdown runs out and nothing was
  // signed, flip to the expired terminal state (the service's own resolution
  // emits the same moments later — idempotent).
  useEffect(() => {
    if (!countdownExpired) return;
    // ...unless Xaman already told us this request was ANSWERED (QR-cierre
    // final). "The code expired. Nothing was signed." would then flatly
    // contradict the panel above it — and hand a false all-clear over a payload
    // that may already be on the ledger.
    if (cancelStateRef.current === 'resolved') return;
    if (statusRef.current === 'pending' || statusRef.current === 'opened') {
      statusRef.current = 'expired';
      // ...and MARK IT AS A GUESS (xaman-cancelar 2). Nobody told us this
      // expired: a local `setInterval` reached a deadline this component
      // computed as now+5min, on this machine's clock, and only after the
      // create round trip had already spent part of Xaman's own 300 s window.
      // An answer that arrives after this tick must still be able to speak over
      // it. (uuid-status 3: this note used to justify itself with a 24-hour
      // `expire: 1440` hand-off — real elsewhere, but nothing with that expiry
      // has ever reached this bus. The flag stands on what it actually is: an
      // inference, not a reading.)
      localExpiryRef.current = true;
      setStatus('expired');
    }
  }, [countdownExpired]);

  /** Drop the panel. No promises made about Xaman — the caller decides that. */
  const forceClose = useCallback(() => {
    // Same rule as the supersede path: the panel leaving is not a reason to
    // kill a DELETE that is still travelling. Let it land (QR-cierre final).
    inFlightCancelRef.current = releaseInFlightCancel(inFlightCancelRef.current, 'closed');
    const closingUuid = promptRef.current?.uuid ?? null;
    promptRef.current = null;
    statusRef.current = 'pending';
    cancelStateRef.current = 'idle';
    localExpiryRef.current = false;
    setPrompt(null);
    setStatus('pending');
    setCancelState('idle');
    // Idempotent, and NAMED (xaman-cancelar 1): a clear says which payload it
    // is about, so no listener mistakes it for permission to drop another one.
    emitXamanPayload(null, closingUuid);
  }, []);

  const handleClose = useCallback(async () => {
    const p = promptRef.current;
    // The branch table lives in the bus so a test can execute it: the vitest
    // env is `node` with no jsdom, and this decision is the one that reopened
    // the bug twice (QR-cierre final).
    const step = decideCloseStep({
      hasPrompt: !!p,
      status: statusRef.current,
      cancelUi: cancelStateRef.current,
    });
    if (step === 'stop-waiting') {
      // QR-cierre A: NOT a dead end any more. Asking again while a round trip
      // is in flight means "get me out" — this is the ONE release reason that
      // aborts. The awaited call below then resolves 'unknown', which is the
      // truth (we stopped listening before Xaman answered), and the panel says
      // so instead of holding the user hostage.
      inFlightCancelRef.current = releaseInFlightCancel(
        inFlightCancelRef.current,
        'stop-waiting',
      );
      return;
    }
    if (step === 'close' || !p) {
      forceClose();
      return;
    }
    // Cancel for real while the request is still live: the payload dies in
    // Xaman too, so the phone cannot sign "a cancelled" request minutes later.
    // UI-qr-xaman: this used to be fire-and-forget — the panel closed claiming
    // cancellation even when the DELETE never landed (fetch does not throw on
    // 4xx/5xx), leaving a signable request on the phone for up to five minutes.
    // Now we wait for the answer and only close when nothing signable is left.
    const uuid = p.uuid; // QR-cierre B: the answer belongs to THIS payload.
    const controller = new AbortController();
    inFlightCancelRef.current = { uuid, controller };
    cancelStateRef.current = 'cancelling';
    setCancelState('cancelling');
    // A slow DELETE for payload A could land after the bus handed us payload B.
    // An earlier draft wrote it into the shared state anyway, which marked B as
    // failed — and the next Cancel then took the failed branch and closed with
    // NO DELETE, leaving B signable on the phone in silence. Any answer that no
    // longer describes what is on screen is dropped (QR-cierre B). The round
    // trip + that judgement are ONE function in the bus (xaman-cancelar), so
    // the Legacy close-door hand-off and the council inbox run the same rule
    // instead of three copies of it.
    const { action, cancelUi } = await cancelPayloadAndDecide(
      uuid,
      () => promptRef.current?.uuid ?? null,
      { signal: controller.signal },
    );
    if (inFlightCancelRef.current?.controller === controller) inFlightCancelRef.current = null;
    if (action === 'ignore') return;
    if (action === 'close') {
      // 'cancelled' (we killed it) or an ALREADY_EXPIRED / ALREADY_CANCELLED
      // payload: nothing is left signable, so the panel goes without a warning
      // it cannot justify (QR-cierre C).
      forceClose();
      return;
    }
    // 'warn-resolved' does NOT close: Xaman had already answered this request,
    // which can mean the user signed it — and a submit:true payload is then on
    // its way to the ledger. Closing mute over that is the failure this panel
    // exists to prevent (QR-cierre final).
    cancelStateRef.current = cancelUi;
    setCancelState(cancelUi);
  }, [forceClose]);

  // On mobile there is no QR to scan on the same device — jump into the app.
  useEffect(() => {
    if (prompt?.deeplink && mobile) window.location.href = prompt.deeplink;
  }, [prompt?.deeplink, mobile]);

  // The page scroll lock is REFCOUNTED (useModalRegistration) and no longer
  // captured here: a signing prompt opens OVER a transaction modal that had
  // already set overflow:hidden, so the old capture-and-restore put 'hidden'
  // back on close and left the page unscrollable for the rest of the session.
  // Registering also tells background pollers to hold still mid-signature.
  useModalRegistration({ active: !!prompt });

  // Escape closes; focus moves into the dialog and back out on close.
  useEffect(() => {
    if (!prompt) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [prompt, handleClose]);

  // Cheap enough to derive on render; keeping it out of state means it can
  // never go stale against the prompt it describes.
  const summaryLines = humanizeXamanSummary(prompt?.summary, t);
  const purpose = prompt?.purpose ?? 'signin';
  const copy =
    purpose === 'transaction'
      ? {
          title: t('Sign in Xaman'),
          lead: t('Review the operation in the app and approve it. It reaches the network only with your signature.'),
        }
      : purpose === 'message'
        ? {
            title: t('Sign the message'),
            lead: t('Approve the signature in the app. It is an ownership proof: it moves no funds.'),
          }
        : {
            title: t('Connect Xaman'),
            lead: t('Scan the code and approve the sign-in. No funds move.'),
          };
  // "Sending to the network" is only true for transactions — a sign-in or an
  // ownership proof never touches the ledger, and saying otherwise promises a
  // hash that will never exist.
  const signedText =
    purpose === 'transaction'
      ? t('Signed — sending to the network…')
      : purpose === 'signin'
        ? t('Signed in.')
        : t('Signature received. Nothing is sent to the network.');

  const openInXaman = () => {
    if (!prompt?.deeplink) return;
    if (mobile) window.location.href = prompt.deeplink;
    else window.open(prompt.deeplink, '_blank', 'noopener,noreferrer');
  };

  return (
    <AnimatePresence>
      {prompt && (
        <motion.div
          // Sits one layer above the app's modal layer (z-50) so a signing
          // request is never stacked under the modal that triggered it.
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
          initial={reduce ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) void handleClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="xaman-title"
            aria-describedby="xaman-lead"
            tabIndex={-1}
            className="w-full max-w-[380px] my-auto rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/60 outline-none"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Header — what this is, and a way out */}
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div>
                <h2 id="xaman-title" className="text-[15px] font-medium text-ink">
                  {copy.title}
                </h2>
                <p id="xaman-lead" className="mt-1 text-[12px] leading-relaxed text-ink/55">
                  {copy.lead}
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label={t('Close')}
                className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* What is being signed — real data or nothing at all. The summary
                arrives as "Payment · 5 XRP": the operation becomes a sentence
                and the figure keeps its own line. UI-qr-xaman: the old check
                only humanised a BARE TransactionType, so precisely the
                money-moving payloads (they carry an Amount) were the ones left
                reading as a ledger opcode. */}
            {summaryLines && !terminal && (
              <div className="mx-5 mt-4 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                {summaryLines.detail ? (
                  // QR-cierre E: the FIGURE is the thing that has to be checked
                  // before a signature, so it carries the weight and the
                  // operation reads as its label. An earlier draft had it upside down —
                  // the amount came out smaller (12px) and paler (ink/60) than
                  // the sentence above it, which is the opposite of R6.5.
                  <>
                    <p className="text-[12px] leading-tight text-ink/55">{summaryLines.headline}</p>
                    <p className="mt-1 font-mono text-[17px] font-medium leading-tight tabular-nums text-ink">
                      {summaryLines.detail}
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink/90">{summaryLines.headline}</p>
                )}
              </div>
            )}

            {/* Did the request reach the phone? `pushed` is Xaman's own answer
                at payload creation. Saying nothing here left the user staring
                at a QR wondering why no notification arrived — now the surface
                states which of the two ways in is live. Sign-in is exempt: the
                first contact has no push token yet, QR IS the flow. */}
            {!mobile && inviting && status === 'pending' && prompt.pushed != null && purpose !== 'signin' && (
              <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5">
                <Smartphone className={`mt-0.5 h-4 w-4 shrink-0 ${prompt.pushed ? 'text-volt' : 'text-ink/40'}`} />
                <p className="text-[12px] leading-relaxed text-ink/70">
                  {prompt.pushed
                    ? t('Request sent to your Xaman — open it from the notification on your phone. The QR works too.')
                    : t('No push this time — scan the QR with Xaman. Push notifications activate after you sign once from this browser.')}
                </p>
              </div>
            )}

            {/* Terminal states — calm, in place. Declining is a choice. */}
            {terminal && (
              <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
                <p className="text-[13px] leading-relaxed text-ink/75">
                  {/* No "generate a new code" branch: only the surface that
                      started the operation can retry it end to end, and it
                      still can (QR-cierre — see payloadBus for why a retry
                      fired from here would orphan the signature). */}
                  {status === 'rejected'
                    ? t('You declined the signature in Xaman. Nothing happened and nothing moved.')
                    : t('The code expired. Nothing was signed. Close this window and try again whenever you like.')}
                </p>
              </div>
            )}

            {/* The cancel that could not cancel. Saying "cancelled" here would
                be the same lie the old fire-and-forget close told (UI-qr-xaman):
                the request is alive on the phone until the code expires, and
                the only person who can stop it is the one holding it. */}
            {/* QR-cierre C: 'signed' is NOT in `terminal`, so an earlier guard
                let this alarm sit under the signature ceremony. And the two
                cases are not the same sentence: Xaman refusing the cancel means
                the request IS alive, while no answer at all means we do not
                know — claiming expiry timing we never read would be inventing
                a fact ("no pude leer" ≠ "sigue vivo"). */}
            {warnAlive && (
              <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-[13px] leading-relaxed text-ink/75">
                  {/* One source for these three sentences (xaman-cancelar):
                      the Legacy close-door hand-off and the council inbox now
                      show the same warning, and three inline copies are three
                      chances for one to drift into a claim we never read. */}
                  {cancelState === 'alive'
                    ? countdown
                      ? `${payloadStrayNotice('alive', t)} (${countdown})`
                      : payloadStrayNotice('alive', t)
                    : payloadStrayNotice('unknown', t)}
                </p>
              </div>
            )}

            {/* Xaman had already ANSWERED this request when we asked it to die.
                QR-cierre final: an earlier version folded this into the silent
                close used for ALREADY_EXPIRED — the user pressed Cancel, the
                window vanished, and for a submitTransaction payload (options.
                submit = true, so Xaman BROADCASTS) the transaction could
                already be on the ledger with nothing on screen to say so. We do
                NOT claim it was signed: we did not read that. We say what we
                read — it was answered — and point at the app that knows. */}
            {answeredElsewhere && (
              <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-3">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
                <div className="space-y-1">
                  <p className="text-[13px] leading-relaxed text-ink/75">
                    {payloadStrayNotice('resolved', t)}
                  </p>
                  {purpose === 'transaction' && (
                    <p className="text-[12px] leading-relaxed text-ink/55">
                      {t('If it was signed, it is already on its way to the network — check your activity before signing again.')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* The code. White plate is functional: QRs need a light field to scan. */}
            {/* uuid-status 2: gated on `inviting`, not merely on "no terminal
                panel". A cancel we could NOT confirm dead left this code on
                screen under an amber notice telling the person the request is
                still signable and to go decline it in Xaman — a panel offering
                the scan and the refusal of the same request at once. */}
            {!mobile && inviting && (
              <div className="mt-4 flex justify-center px-5">
                <div className="relative rounded-xl bg-white p-3">
                  {prompt.qrPng ? (
                    // Xaman-hosted, single-use, expires in minutes: next/image
                    // optimisation buys nothing and would need a remote-domain
                    // allowlist for a URL that is never reused.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={prompt.qrPng}
                      alt={t('QR code to sign in Xaman')}
                      width={192}
                      height={192}
                      className="h-48 w-48 object-contain"
                    />
                  ) : (
                    <div className="grid h-48 w-48 place-items-center px-4 text-center text-[12px] text-black/60">
                      {t('QR unavailable — use “Open in Xaman”.')}
                    </div>
                  )}
                  {status === 'signed' && (
                    // La ceremonia YA NO juega aquí. Firmar dispara DOS superficies
                    // seguidas y la ceremonia sonaba dos veces; ahora suena una
                    // sola, en el bloque de settlement, que es donde el proceso
                    // continúa. Este panel solo tacha el código gastado: un
                    // check quieto sobre el QR — que nadie lo re-escanee — y la
                    // línea verde de debajo pone las palabras.
                    <motion.div
                      className="absolute inset-0 grid place-items-center rounded-xl bg-white"
                      initial={reduce ? { opacity: 1 } : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <motion.div
                        initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 24, delay: 0.05 }}
                        className="grid h-14 w-14 place-items-center rounded-full border-2 border-emerald-500/80 text-emerald-600"
                      >
                        <Check className="h-7 w-7" strokeWidth={2.2} />
                      </motion.div>
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* Live state of the request. `inviting` only (uuid-status 2):
                "Waiting for your signature in Xaman…" under the amber "open
                Xaman and decline it there" was the panel contradicting
                itself. */}
            {inviting && (
              <div className="mt-4 flex items-center justify-between gap-2 px-5">
                <div className="flex min-w-0 items-center gap-2 text-[12px]">
                  {status === 'signed' ? (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      <span className="truncate text-emerald-300">{signedText}</span>
                    </>
                  ) : status === 'opened' ? (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-volt" />
                      <span className="truncate text-volt">{t('Open in Xaman — review and approve')}</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink/40" />
                      <span className="truncate text-ink/55">
                        {mobile ? t('Opening Xaman…') : t('Waiting for your signature in Xaman…')}
                      </span>
                    </>
                  )}
                </div>
                {countdown && status !== 'signed' && (
                  <span
                    className="shrink-0 font-mono text-[11px] tabular-nums text-ink/35"
                    title={t('Time left before this code expires')}
                  >
                    {countdown}
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2 px-5">
              {/* xaman-cancelar 5: the answered-elsewhere panel says "Open
                  Xaman to see what happened" and this button used to be
                  withdrawn in the same render — an instruction with no way to
                  follow it. It is exactly the state where opening Xaman is the
                  only thing left to do. */}
              {prompt.deeplink && status !== 'signed' && !terminal && (
                <button
                  onClick={openInXaman}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-volt py-2.5 text-[13px] font-medium text-volt-ink transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
                >
                  {t('Open in Xaman')}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              {/* QR-cierre A: never disabled. While the round trip is in
                  flight this is the way OUT of it — pressing it aborts the wait
                  and the panel says what we could and could not confirm. A
                  cancel that hangs must not turn the only exit into "sign". */}
              <button
                onClick={handleClose}
                className={`rounded-xl border border-ink/10 px-4 py-2.5 text-[13px] text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt ${terminal || answeredElsewhere ? 'flex-1' : ''}`}
              >
                {cancelState === 'cancelling'
                  ? t('Cancelling… (press again to stop waiting)')
                  : cancelState === 'alive' || cancelState === 'unknown'
                    ? t('Close anyway')
                    : terminal || status === 'signed' || answeredElsewhere
                      ? t('Close')
                      : t('Cancel')}
              </button>
            </div>

            {/* The custody line — the whole point of this surface */}
            <div className="mt-4 flex items-center gap-2 rounded-b-2xl border-t border-ink/5 px-5 py-3">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink/30" />
              <p className="text-[11px] leading-relaxed text-ink/40">
                {t('Astryum never signs and never holds custody. The key is yours and the signature happens in Xaman.')}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default XamanQRModal;

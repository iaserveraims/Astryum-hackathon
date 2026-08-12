"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Loader2, ShieldCheck, ArrowUpRight, X, Clock, Smartphone } from 'lucide-react';
import {
  onXamanPayload,
  onXamanStatus,
  emitXamanPayload,
  cancelXamanPayload,
  type XamanPayloadPrompt,
  type XamanPayloadStatus,
} from '../../lib/xaman/payloadBus';
import { useModalRegistration } from '../ui/ModalPortal';
import { SignedMark } from '../settlement/SignedMark';
import { useT } from '../../i18n/LanguageProvider';
import { xrplTxTypeLabel } from '../../lib/xrpl/txTypeLabels';

/**
 * XamanQRModal — the signing surface for every Xaman payload (sign-in and
 * transactions). Globally mounted; listens on the payload bus.
 *
 * Built on explicit dark classes rather than the shared shadcn `Dialog`: that
 * component paints `bg-background` at `max-w-4xl`, and with no `dark` class on
 * <html> those tokens resolve to white — which rendered this as a large blank
 * panel with a small QR inside it. This modal owns its surface, so it is
 * correct regardless of how the semantic tokens are configured.
 *
 * It shows WHAT is being signed (summary derived from the real unsigned
 * payload), the live state of the request, and when it expires. Declining and
 * timing out are TERMINAL states rendered calmly in place (F6) — a "no" is a
 * choice, not an error — and Cancel truly cancels the payload in Xaman, so
 * nothing signable is left behind on the phone.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0): display-only. The user scans and signs in
 * the Xaman mobile app; Astryum never holds keys nor signs.
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/** m:ss remaining; `expired` once a known deadline has passed. */
function useCountdown(expiresAt?: number): { label: string | null; expired: boolean } {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (left == null) return { label: null, expired: false };
  if (left <= 0) return { label: null, expired: true };
  const total = Math.round(left / 1000);
  return { label: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, expired: false };
}

export function XamanQRModal() {
  const { t } = useT();
  const [prompt, setPrompt] = useState<XamanPayloadPrompt | null>(null);
  const [status, setStatus] = useState<XamanPayloadStatus>('pending');
  // Latest values for callbacks that outlive a render (bus listeners, close).
  const promptRef = useRef<XamanPayloadPrompt | null>(null);
  const statusRef = useRef<XamanPayloadStatus>('pending');
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mobile = isMobileDevice();
  const { label: countdown, expired: countdownExpired } = useCountdown(prompt?.expiresAt);

  const terminal = status === 'rejected' || status === 'expired';

  useEffect(() => {
    // Subscribe to the bus. We intentionally do NOT touch the wallet service
    // here so its XRPL WebSocket isn't constructed at app load.
    const offPrompt = onXamanPayload((p) => {
      if (p) {
        promptRef.current = p;
        statusRef.current = 'pending';
        setPrompt(p);
        setStatus('pending'); // fresh payload → fresh state
        return;
      }
      // The service clears the prompt right after resolving. On a decline or
      // expiry the terminal status arrived an instant earlier — keep the panel
      // up so the person reads what happened; Close clears it.
      if (statusRef.current === 'rejected' || statusRef.current === 'expired') return;
      promptRef.current = null;
      setPrompt(null);
    });
    const offStatus = onXamanStatus((s) => {
      statusRef.current = s;
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
    if (statusRef.current === 'pending' || statusRef.current === 'opened') {
      statusRef.current = 'expired';
      setStatus('expired');
    }
  }, [countdownExpired]);

  const handleClose = useCallback(() => {
    const p = promptRef.current;
    const s = statusRef.current;
    // Cancel for real while the request is still live: the payload dies in
    // Xaman too, so the phone cannot sign "a cancelled" request minutes later.
    if (p && s !== 'signed' && s !== 'rejected' && s !== 'expired') {
      void cancelXamanPayload(p.uuid);
    }
    promptRef.current = null;
    statusRef.current = 'pending';
    setPrompt(null);
    setStatus('pending');
    emitXamanPayload(null); // idempotent — keeps every listener in sync
  }, []);

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
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [prompt, handleClose]);

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
            if (e.target === e.currentTarget) handleClose();
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

            {/* What is being signed — real data or nothing at all. A bare
                TransactionType (the service's fallback) reads as a sentence,
                not as a ledger opcode ("EscrowCreate"). */}
            {prompt.summary && !terminal && (
              <div className="mx-5 mt-4 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <p className="text-[13px] text-ink/90">
                  {/^[A-Z][A-Za-z]{2,}$/.test(prompt.summary)
                    ? xrplTxTypeLabel(prompt.summary, t)
                    : prompt.summary}
                </p>
              </div>
            )}

            {/* Did the request reach the phone? `pushed` is Xaman's own answer
                at payload creation. Saying nothing here left the user staring
                at a QR wondering why no notification arrived — now the surface
                states which of the two ways in is live. Sign-in is exempt: the
                first contact has no push token yet, QR IS the flow. */}
            {!mobile && !terminal && status === 'pending' && prompt.pushed != null && purpose !== 'signin' && (
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
                  {status === 'rejected'
                    ? t('You declined the signature in Xaman. Nothing happened and nothing moved.')
                    : t('The code expired. Nothing was signed. Close this window and try again whenever you like.')}
                </p>
              </div>
            )}

            {/* The code. White plate is functional: QRs need a light field to scan. */}
            {!mobile && !terminal && (
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
                    // The signature ceremony covers the spent QR (founder
                    // 2026-08-08: the ceremony plays INSIDE each operation's
                    // own view — the full-screen overlay is retired). White
                    // pane, not emerald: the mark's product colour carries
                    // the celebration; the status line below stays green.
                    <motion.div
                      className="absolute inset-0 grid place-items-center rounded-xl bg-white"
                      initial={reduce ? { opacity: 1 } : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <SignedMark compact />
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* Live state of the request */}
            {!terminal && (
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
              {prompt.deeplink && status !== 'signed' && !terminal && (
                <button
                  onClick={openInXaman}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-volt py-2.5 text-[13px] font-medium text-volt-ink transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
                >
                  {t('Open in Xaman')}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={handleClose}
                className={`rounded-xl border border-ink/10 px-4 py-2.5 text-[13px] text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt ${terminal ? 'flex-1' : ''}`}
              >
                {terminal || status === 'signed' ? t('Close') : t('Cancel')}
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

"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Loader2, ShieldCheck, ArrowUpRight, X, Check } from 'lucide-react';
import {
  onXamanPayload,
  onXamanStatus,
  emitXamanPayload,
  type XamanPayloadPrompt,
  type XamanPayloadStatus,
} from '../../lib/xaman/payloadBus';

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
 * payload), the live state of the request, and when it expires — a signing
 * surface that only shows a QR asks the user to approve something they cannot
 * see.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0): display-only. The user scans and signs in
 * the Xaman mobile app; Astryum never holds keys nor signs.
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

const COPY: Record<string, { title: string; lead: string }> = {
  transaction: {
    title: 'Firma en Xaman',
    lead: 'Revisa la operación en la app y apruébala. Se envía a la red solo con tu firma.',
  },
  signin: {
    title: 'Conectar Xaman',
    lead: 'Escanea el código y aprueba el inicio de sesión. No se mueve ningún fondo.',
  },
  message: {
    title: 'Firma el mensaje',
    lead: 'Aprueba la firma en la app. Es una prueba de titularidad: no mueve fondos.',
  },
};

/** m:ss remaining, or null once elapsed/unknown. */
function useCountdown(expiresAt?: number): string | null {
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
  if (left == null || left <= 0) return null;
  const total = Math.round(left / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function XamanQRModal() {
  const [prompt, setPrompt] = useState<XamanPayloadPrompt | null>(null);
  const [status, setStatus] = useState<XamanPayloadStatus>('pending');
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mobile = isMobileDevice();
  const countdown = useCountdown(prompt?.expiresAt);

  useEffect(() => {
    // Subscribe to the bus. We intentionally do NOT touch the wallet service
    // here so its XRPL WebSocket isn't constructed at app load.
    const offPrompt = onXamanPayload((p) => {
      setPrompt(p);
      if (p) setStatus('pending'); // fresh payload → fresh state
    });
    const offStatus = onXamanStatus(setStatus);
    return () => {
      offPrompt();
      offStatus();
    };
  }, []);

  const handleClose = useCallback(() => {
    // Hide the modal. The underlying promise still resolves or times out in the
    // background and emits null again (idempotent).
    emitXamanPayload(null);
  }, []);

  // On mobile there is no QR to scan on the same device — jump into the app.
  useEffect(() => {
    if (prompt?.deeplink && mobile) window.location.href = prompt.deeplink;
  }, [prompt?.deeplink, mobile]);

  // Escape closes; focus moves into the dialog; page behind stays put.
  useEffect(() => {
    if (!prompt) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [prompt, handleClose]);

  const copy = COPY[prompt?.purpose ?? 'signin'] ?? COPY.signin;
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
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
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
            className="w-full max-w-[380px] rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/60 outline-none"
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
                aria-label="Cerrar"
                className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* What is being signed — real data or nothing at all */}
            {prompt.summary && (
              <div className="mx-5 mt-4 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <p className="font-mono text-[13px] text-ink/90">{prompt.summary}</p>
              </div>
            )}

            {/* The code. White plate is functional: QRs need a light field to scan. */}
            {!mobile && (
              <div className="mt-4 flex justify-center px-5">
                <div className="relative rounded-xl bg-white p-3">
                  {prompt.qrPng ? (
                    // Xaman-hosted, single-use, expires in minutes: next/image
                    // optimisation buys nothing and would need a remote-domain
                    // allowlist for a URL that is never reused.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={prompt.qrPng}
                      alt="Código QR para firmar en Xaman"
                      width={192}
                      height={192}
                      className="h-48 w-48 object-contain"
                    />
                  ) : (
                    <div className="grid h-48 w-48 place-items-center px-4 text-center text-[12px] text-black/60">
                      QR no disponible — usa «Abrir en Xaman».
                    </div>
                  )}
                  {status === 'signed' && (
                    <motion.div
                      className="absolute inset-0 grid place-items-center rounded-xl bg-emerald-500/95"
                      initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <Check className="h-10 w-10 text-black" strokeWidth={2.5} />
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* Live state of the request */}
            <div className="mt-4 flex items-center justify-between gap-2 px-5">
              <div className="flex min-w-0 items-center gap-2 text-[12px]">
                {status === 'signed' ? (
                  <>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate text-emerald-300">Firmado — enviando a la red…</span>
                  </>
                ) : status === 'opened' ? (
                  <>
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-volt" />
                    <span className="truncate text-volt">Abierto en Xaman — revisa y aprueba</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink/40" />
                    <span className="truncate text-ink/55">
                      {mobile ? 'Abriendo Xaman…' : 'Esperando firma en Xaman…'}
                    </span>
                  </>
                )}
              </div>
              {countdown && status !== 'signed' && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/35">
                  {countdown}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="mt-4 flex gap-2 px-5">
              {prompt.deeplink && status !== 'signed' && (
                <button
                  onClick={openInXaman}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-volt py-2.5 text-[13px] font-medium text-volt-ink transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
                >
                  Abrir en Xaman
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={handleClose}
                className="rounded-xl border border-ink/10 px-4 py-2.5 text-[13px] text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt"
              >
                Cancelar
              </button>
            </div>

            {/* The custody line — the whole point of this surface */}
            <div className="mt-4 flex items-center gap-2 rounded-b-2xl border-t border-ink/5 px-5 py-3">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ink/30" />
              <p className="text-[11px] leading-relaxed text-ink/40">
                Astryum no firma ni custodia. La clave es tuya y la firma ocurre en Xaman.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default XamanQRModal;

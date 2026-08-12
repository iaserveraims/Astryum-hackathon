'use client';

/**
 * LegalAcceptGate — the blocking acceptance modal for the published legal
 * pages (founder 2026-07-30: "los dos docs deben aceptarlos los users cuando
 * inician sesión por primera vez y se debe guardar que han aceptado").
 *
 * Shows once per account whenever the recorded versions are stale: first
 * dashboard entry of wallet-first (SIWE) accounts that never passed the
 * register click-wrap, and every account after a material version bump (e.g.
 * the €50 liability cap added 2026-07-30). Deliberately NOT dismissable — no
 * X, no backdrop click, no Escape: the dashboard stays blurred behind it
 * until the user accepts. Wording is legally precise: the demo terms are
 * ACCEPTED (contract); the privacy notice is READ (GDPR informs, it does not
 * ask consent to a notice). The server records both with version + timestamp
 * (POST /auth/legal-accept → User.preferences.legal).
 *
 * Mounted once in the /app layout. Renders nothing until GET /auth/me answers
 * with `legal.required: true` — no flash, and the public demo (which never
 * reaches /auth/me) never sees it.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, ScrollText, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';

export default function LegalAcceptGate() {
  const { t } = useT();
  const legalGate = useAuthStore((s) => s.legalGate);
  const acceptLegal = useAuthStore((s) => s.acceptLegal);
  const [terms, setTerms] = useState(false);
  const [privacyRead, setPrivacyRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const open = legalGate?.required === true;

  // A modal that paints over the app is not the same as a modal that BLOCKS it.
  // Audit 2026-08-01: the gate shipped at z-[97] while four app layers sit
  // above it — the command palette and the step-up modal (z-100), the intents
  // drawer (z-110) and the product tour (z-120, which auto-starts for exactly
  // the first-time user this gate exists for). The overlay now sits above all
  // of them, and the palette's window shortcut is swallowed in the capture
  // phase (AppShell listens on the bubble) — it is the one route in that could
  // not be closed by z-index alone, being keyboard-triggered.
  useEffect(() => {
    if (!open) return;
    const swallowPalette = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', swallowPalette, true);
    return () => window.removeEventListener('keydown', swallowPalette, true);
  }, [open]);

  const submit = async () => {
    if (!terms || !privacyRead || busy) return;
    setBusy(true);
    setError(false);
    const ok = await acceptLegal();
    setBusy(false);
    if (!ok) setError(true); // the gate stays up — no unearned success
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-start justify-center bg-[#06070c]/70 backdrop-blur-md p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label={t('Before you continue')}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22 }}
            className="w-full max-w-md my-auto rounded-2xl border border-white/10 bg-[#0d0f16] p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10">
                <ShieldCheck className="h-5 w-5 text-amber-300" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-white">{t('Before you continue')}</h2>
                <p className="text-xs text-white/45">
                  {t('One minute, once — so you know exactly what you are using.')}
                </p>
              </div>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-white/60">
              {t(
                'Astryum is an open demo with real XRP under deliberate caps. Its conditions and its privacy notice are published as living pages; your acceptance is recorded with the text version and date.',
              )}
            </p>

            <div className="mt-4 space-y-2.5">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-400"
                />
                <span className="text-[13px] leading-snug text-white/70">
                  {t('I accept the')}{' '}
                  <a
                    href="/demo-terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-amber-300 underline underline-offset-2"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                    {t('demo terms')}
                  </a>{' '}
                  {t('— experimental software, caps by design, liability limited to €50 with the legal carve-outs.')}{' '}
                  {/* Age self-declaration (2026-08-01): the demo had NO minimum
                      age anywhere — a minor could sign with real money. A
                      declaration is the proportionate check for a demo that by
                      design has no KYC; it rides the same versioned record. */}
                  {t('I declare that I am 18 or older.')}
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={privacyRead}
                  onChange={(e) => setPrivacyRead(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-400"
                />
                <span className="text-[13px] leading-snug text-white/70">
                  {t('I have read the')}{' '}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-amber-300 underline underline-offset-2"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t('privacy notice')}
                  </a>{' '}
                  {t('— what is processed, who receives it, and what public chains make permanent.')}
                </span>
              </label>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-400">
                {t('Could not record your acceptance — check your connection and try again.')}
              </p>
            )}

            <button
              onClick={submit}
              disabled={!terms || !privacyRead || busy}
              className="mt-5 w-full rounded-xl bg-amber-400 py-2.5 text-sm font-semibold text-black transition-all enabled:hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t('Recording…') : t('Accept and continue')}
            </button>

            <p className="mt-3 text-center font-mono text-[10px] text-white/30">
              {t('Version')} {legalGate?.termsVersion || '—'} ·{' '}
              {t('Recorded with date on your account')}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';

/**
 * LegacyComingSoonModal — the Legacy gate popup (founder 2026-07-18; beta
 * variant 2026-07-26).
 *
 * The Legacy toggle stays VISIBLE (the product must be seen) but switching is
 * gated: any attempt to activate a governed account opens this
 * blurred-backdrop popup — what Legacy IS, in its own indigo palette, and the
 * honest state: not available yet, under construction. Two audiences, same
 * shell, different copy (LegacyGateVariant carried on the event):
 *
 *   'demo' — public demo account: showcase copy, "ships with the full launch".
 *   'beta' — real beta account without access (LEGACY_ENABLED off and not on
 *            LEGACY_ACCESS_EMAILS): in-development copy + the beta promise
 *            (it will light up on this same switch, nothing to do).
 *
 * Mounted once in the /app layout; opened via the LEGACY_GATE_EVENT fired by
 * setProductMode / the governed-selection interception in useAuthorities.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Hammer, Landmark, Sparkles, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { LEGACY_GATE_EVENT, type LegacyGateVariant } from '../../lib/demoMode';

export default function LegacyComingSoonModal() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<LegacyGateVariant>('demo');

  useEffect(() => {
    const onOpen = (e: Event) => {
      setVariant((e as CustomEvent).detail === 'beta' ? 'beta' : 'demo');
      setOpen(true);
    };
    window.addEventListener(LEGACY_GATE_EVENT, onOpen);
    return () => window.removeEventListener(LEGACY_GATE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[96] flex items-start justify-center bg-[#06070c]/60 backdrop-blur-md p-4 overflow-y-auto"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
          aria-label={t('Legacy — under construction')}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md my-auto overflow-hidden rounded-2xl border shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
            style={{
              borderColor: 'rgba(157, 180, 232, 0.3)',
              background: 'linear-gradient(180deg, #0b0d15 0%, #07080d 100%)',
            }}
          >
            {/* Legacy's own palette: deep indigo vault, steel accents. */}
            <div className="relative px-6 pt-6 pb-5">
              <button
                onClick={() => setOpen(false)}
                className="absolute right-4 top-4 text-white/35 hover:text-white/80"
                aria-label={t('Close')}
              >
                <X size={16} />
              </button>
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ background: 'rgba(157, 180, 232, 0.12)', color: '#9db4e8' }}
              >
                <Landmark size={22} strokeWidth={1.6} />
              </div>
              <h2 className="text-lg font-semibold text-white">Astryum Legacy</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                {t(
                  'Legacy turns an account into a GOVERNED one: its authority is a council — a quorum of keys — instead of a single key. Capital under rules a quorum signs: lose a key and you keep operating; one stolen key moves nothing.',
                )}
              </p>
              <div
                className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5"
                style={{ borderColor: 'rgba(157, 180, 232, 0.25)', background: 'rgba(157, 180, 232, 0.07)' }}
              >
                <Hammer size={14} className="shrink-0" style={{ color: '#9db4e8' }} />
                <p className="text-[12px] text-white/70">
                  {variant === 'beta'
                    ? t('In development — we are building it right now. It will switch itself on in your account with one of the next beta updates.')
                    : t('Not available in the demo yet — we are building it. It ships with the full launch.')}
                </p>
              </div>
              {variant === 'beta' && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <Sparkles size={14} className="shrink-0 text-white/45" />
                  <p className="text-[12px] text-white/60">
                    {t('You are in the early-access beta: the day Legacy opens, it will show up right here, on this same switch.')}
                  </p>
                </div>
              )}
              <button
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-xl py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110"
                style={{ background: '#9db4e8' }}
              >
                {variant === 'beta' ? t('Stay in Personal') : t('Back to the demo')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

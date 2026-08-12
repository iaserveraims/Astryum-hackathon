'use client';

/**
 * CageDisclosureModal — "How a cage works", read once, accepted once, and
 * re-readable for ever after.
 *
 * WHERE IT FIRES (founder, 2026-08-06). NOT on entering Legacy: entering locks
 * up nothing — the council, the constitution and the governed movements are the
 * product and they hold no capital. A blocking dialog at the door shows the wall
 * before the house, and it spends the acknowledgement at the moment of zero
 * risk: whoever ticks a box to see what is inside has already stopped reading by
 * the time it matters. So the door gets a banner (LegacyBetaBanner) and THIS
 * fires at the one-way step — the birth of a cage, or funding one.
 *
 * WHY FOUR BOXES AND NOT ONE. A single "I have read the terms" is the pattern
 * nobody believes, least of all the person ticking it. The server ships four
 * specific first-person statements and requires all four ids back; the button
 * stays disabled until each is ticked, and it says what it does rather than
 * "Accept".
 *
 * WHY THE TEXT COMES FROM THE SERVER. So the audit record can prove WHICH text
 * was on screen (see backend/src/config/cageDisclosure.ts). This component
 * renders and translates it — the English strings are the i18n keys, as
 * everywhere else — and posts back only "all four, version N".
 *
 * The live numbers (the beta cap, what already fits) are read separately and
 * rendered BESIDE the document: a hashed text must not carry a number that can
 * change under it, and prose fees go stale (the PaActionsModal lesson).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { modalPop } from '../ui/motion';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { GhostButton, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { xrplLegacy, type CageDisclosureState, type LegacyVaultFundQuote } from '../../services/v1Api';

/** Icons per section id — the document's order is the server's, not ours. */
const SECTION_ICON: Record<string, typeof Lock> = {
  why: Lock,
  code: ShieldCheck,
  authority: ShieldCheck,
  architecture: ShieldCheck,
  fees: AlertTriangle,
  beta: AlertTriangle,
};

export default function CageDisclosureModal({
  account,
  mode = 'accept',
  confirmLabel,
  onAccepted,
  onClose,
}: {
  /** The council being looked at — recorded as context, and used for live numbers. */
  account?: string;
  /** 'accept' asks for the boxes; 'read' is the permanent re-read from the banner. */
  mode?: 'accept' | 'read';
  /** What the confirm button promises to do next. */
  confirmLabel?: string;
  onAccepted?: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CageDisclosureState | null>(null);
  const [quote, setQuote] = useState<LegacyVaultFundQuote | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    xrplLegacy
      .cageDisclosure()
      .then((s) => {
        if (alive) setState(s);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Live numbers, best-effort: a cage that does not exist yet has no quote, and
  // that must not stop anyone from reading the text.
  useEffect(() => {
    if (!account) return;
    let alive = true;
    xrplLegacy
      .vaultFundQuote(account)
      .then((q) => {
        if (alive) setQuote(q);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);

  const doc = state?.document;
  const alreadyAccepted = Boolean(state?.acceptedAt);
  // Bound to the loaded document on purpose: while the text is still coming (or
  // failed to come) there is nothing to have understood, and a confirm button
  // under a spinner invites a click at exactly the wrong moment.
  const asksForBoxes = Boolean(doc) && mode === 'accept' && !alreadyAccepted;
  const allTicked = useMemo(
    () => Boolean(doc) && doc!.acknowledgements.every((a) => ticked.has(a.id)),
    [doc, ticked],
  );

  const toggle = useCallback((id: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const accept = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      await xrplLegacy.cageDisclosureAck({
        account,
        version: doc.version,
        acknowledgements: doc.acknowledgements.map((a) => a.id),
      });
      onAccepted?.();
      onClose();
    } catch (e) {
      const body = (e as { body?: { detail?: string } })?.body;
      setError(body?.detail || (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [account, doc, onAccepted, onClose]);

  const capXrp = state?.betaCapXrp ?? null;

  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onEscape={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cage-disclosure-title"
        tabIndex={-1}
        variants={modalPop}
        initial="hidden"
        animate="shown"
        className="my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-surface-1 shadow-2xl shadow-black/60 outline-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const root = dialogRef.current;
          if (!root) return;
          const focusables = root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 text-volt/80" strokeWidth={1.6} />
            <h2 id="cage-disclosure-title" className="text-[15px] font-semibold tracking-tight text-ink">
              {t(doc?.title ?? 'How a cage works')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {!doc && !error && (
            <p className="flex items-center gap-2 text-sm text-ink/60">
              <Loader2 size={14} className="animate-spin" /> {t('Loading…')}
            </p>
          )}
          {!doc && error && <InlineNotice tone="warning">{error}</InlineNotice>}

          {doc && (
            <>
              <p className="text-[13px] leading-relaxed text-ink/70">{t(doc.lede)}</p>

              {doc.sections.map((s) => {
                const Icon = SECTION_ICON[s.id] ?? ShieldCheck;
                return (
                  <section key={s.id} className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3.5">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <Icon size={13} className="text-ink/35" strokeWidth={1.8} /> {t(s.title)}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {s.lines.map((line, i) => (
                        <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink/60">
                          <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/25" />
                          {t(line)}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}

              {/* The live numbers — outside the hashed text, on purpose. */}
              {(capXrp !== null || quote) && (
                <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5">
                  <p className="text-[13px] font-semibold text-tone-warning">{t('The limits right now')}</p>
                  <dl className="mt-2 space-y-1 text-[12px] text-ink/65">
                    {capXrp !== null && (
                      <div className="flex justify-between gap-4">
                        <dt>{t('Most a cage may hold through Astryum')}</dt>
                        <dd className="font-mono text-ink/85">{capXrp} XRP</dd>
                      </div>
                    )}
                    {quote?.cage?.currentPrincipalXrp !== undefined && (
                      <div className="flex justify-between gap-4">
                        <dt>{t('This cage holds today')}</dt>
                        <dd className="font-mono text-ink/85">{quote.cage.currentPrincipalXrp} XRP</dd>
                      </div>
                    )}
                    {quote?.cage?.remainingXrp != null && (
                      <div className="flex justify-between gap-4">
                        <dt>{t('Still fits')}</dt>
                        <dd className="font-mono text-ink/85">{quote.cage.remainingXrp} XRP</dd>
                      </div>
                    )}
                    {quote?.minGrossXrp && (
                      <div className="flex justify-between gap-4">
                        <dt>{t('Below this the fees eat the whole payment')}</dt>
                        <dd className="font-mono text-ink/85">{quote.minGrossXrp} XRP</dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                    {t(
                      'The exact minting and executor fees for your amount are shown on the hand-off, before anyone signs.',
                    )}
                  </p>
                </section>
              )}

              <a
                href="/proof"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-ink/55 underline hover:text-ink/80"
              >
                <ExternalLink size={12} />
                {t('See the live contract addresses on the proof page')}
              </a>

              {/* ── The acknowledgement ─────────────────────────────────────── */}
              {asksForBoxes && (
                <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.03] p-3.5">
                  <p className="text-[13px] font-semibold text-ink">{t('Confirm you understand')}</p>
                  {doc.acknowledgements.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg p-1.5 text-[12px] leading-relaxed text-ink/70 transition hover:bg-ink/[0.04]"
                    >
                      <input
                        type="checkbox"
                        checked={ticked.has(a.id)}
                        onChange={() => toggle(a.id)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-volt"
                      />
                      <span>{t(a.text)}</span>
                    </label>
                  ))}
                </div>
              )}

              {alreadyAccepted && state?.acceptedAt && (
                <InlineNotice tone="success">
                  {t('You confirmed you understood this on')}{' '}
                  {new Date(state.acceptedAt).toLocaleString()}.
                </InlineNotice>
              )}

              {error && <InlineNotice tone="warning">{error}</InlineNotice>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 px-5 py-4">
          <GhostButton onClick={onClose}>{asksForBoxes ? t('Not now') : t('Close')}</GhostButton>
          {asksForBoxes && (
            <PrimaryButton onClick={() => void accept()} disabled={!allTicked || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{' '}
              {confirmLabel ?? t('I understand — continue')}
            </PrimaryButton>
          )}
        </div>
      </motion.div>
    </ModalOverlay>
  );
}

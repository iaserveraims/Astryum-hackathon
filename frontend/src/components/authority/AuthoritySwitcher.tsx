'use client';

/**
 * AuthoritySwitcher — the app's context selector (ADR-009): WHICH account of
 * authority everything below operates as. Google/GitHub account-switcher
 * pattern, contextualised: overview (every simple wallet aggregated), one row
 * per simple wallet (🔑 single key), one row per governed account (⬥ quorum),
 * plus the door to constitute a new governed account.
 *
 * The colour of the governed theme is NEVER the only signal: this trigger and
 * the persistent context bar carry the state in text (quorum, health).
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronsUpDown, Diamond, KeyRound, Loader2, Orbit, Plus } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorities } from '../../hooks/useAuthorities';
import {
  authorityDisplayName,
  shortAddress,
  type Authority,
  type GovernedAuthority,
} from '../../lib/authority';

function healthLabel(a: GovernedAuthority, t: (s: string) => string): { text: string; cls: string } {
  if (a.loading) return { text: t('reading ledger…'), cls: 'text-ink/40' };
  if (a.error) return { text: t('could not read'), cls: 'text-amber-400/90' };
  if (a.hasCouncil !== true) return { text: t('not a council yet'), cls: 'text-ink/40' };
  switch (a.health?.level) {
    case 'red':
      return { text: t('health: at risk'), cls: 'text-red-400' };
    case 'amber':
      return { text: t('health: attention'), cls: 'text-amber-400' };
    case 'green':
      return { text: t('health: sound'), cls: 'text-emerald-400' };
    default:
      return { text: t('health: unknown'), cls: 'text-ink/40' };
  }
}

function quorumBadge(a: GovernedAuthority): string | null {
  if (typeof a.quorum === 'number' && typeof a.memberCount === 'number') {
    return `${a.quorum}/${a.memberCount}`;
  }
  return null;
}

function AuthorityIcon({ a, className }: { a: Authority; className?: string }) {
  if (a.kind === 'overview') return <Orbit className={className} strokeWidth={1.6} />;
  if (a.kind === 'single') return <KeyRound className={className} strokeWidth={1.6} />;
  return <Diamond className={className} strokeWidth={1.6} />;
}

export default function AuthoritySwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const { authorities, active, setActive, loading } = useAuthorities();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const singles = authorities.filter((a) => a.kind === 'single');
  const governed = authorities.filter((a): a is GovernedAuthority => a.kind === 'governed');

  const activeName =
    active.kind === 'overview' ? t('Overview') : authorityDisplayName(active);
  const activeSub =
    active.kind === 'overview'
      ? t('All simple wallets, aggregated')
      : active.kind === 'single'
        ? shortAddress(active.wallet.address)
        : `⬥ ${quorumBadge(active) ?? '…'} · ${shortAddress(active.address)}`;

  const pick = (id: string) => {
    setActive(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('Switch authority account')}
        className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
          active.kind === 'governed'
            ? 'border-[var(--authority-border)] bg-[var(--authority-soft)]'
            : 'border-ink/[0.07] bg-ink/[0.03] hover:border-ink/15'
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            active.kind === 'governed' ? 'bg-[var(--authority-soft)] text-[var(--authority-solid)]' : 'bg-ink/[0.05] text-volt'
          }`}
        >
          <AuthorityIcon a={active} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink/90">{activeName}</span>
          <span className="block truncate text-[11px] text-ink/45">{activeSub}</span>
        </span>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink/30" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink/35" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="listbox"
            aria-label={t('Authority accounts')}
            className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-ink/10 bg-surface-2 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
          >
            <div className="max-h-[46vh] overflow-y-auto p-1.5 scrollbar-thin">
              <Row
                selected={active.kind === 'overview'}
                onClick={() => pick('all')}
                icon={<Orbit className="h-4 w-4" strokeWidth={1.6} />}
                title={t('Overview')}
                sub={t('All simple wallets, aggregated')}
              />

              {singles.length > 0 && <GroupLabel>{t('Simple accounts')}</GroupLabel>}
              {singles.map((a) =>
                a.kind === 'single' ? (
                  <Row
                    key={a.id}
                    selected={active.id === a.id}
                    onClick={() => pick(a.id)}
                    icon={<KeyRound className="h-4 w-4" strokeWidth={1.6} />}
                    title={authorityDisplayName(a)}
                    sub={`🔑 ${t('single key')} · ${shortAddress(a.wallet.address)}`}
                  />
                ) : null,
              )}

              {governed.length > 0 && <GroupLabel>{t('Governed accounts')}</GroupLabel>}
              {governed.map((a) => {
                const h = healthLabel(a, t);
                const q = quorumBadge(a);
                return (
                  <Row
                    key={a.id}
                    selected={active.id === a.id}
                    onClick={() => pick(a.id)}
                    icon={<Diamond className="h-4 w-4" strokeWidth={1.6} />}
                    title={authorityDisplayName(a)}
                    sub={
                      <>
                        {q ? `⬥ ${t('quorum')} ${q} · ` : ''}
                        <span className={h.cls}>{h.text}</span>
                      </>
                    }
                    badge={
                      typeof a.pendingSignatures === 'number' && a.pendingSignatures > 0 ? (
                        <span
                          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
                          title={t('Waiting for your signature')}
                        >
                          {a.pendingSignatures > 9 ? '9+' : a.pendingSignatures}
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>

            <div className="border-t border-ink/[0.06] p-1.5">
              <Link
                href="/app/legacy?constitute=1"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink/70 transition-colors hover:bg-ink/[0.05] hover:text-ink"
              >
                <Plus className="h-4 w-4 text-volt" strokeWidth={1.8} />
                {t('Constitute a governed account')}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-widest text-ink/30">
      {children}
    </div>
  );
}

function Row({
  selected,
  onClick,
  icon,
  title,
  sub,
  badge,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        selected ? 'bg-volt/[0.10]' : 'hover:bg-ink/[0.05]'
      }`}
    >
      <span className={`shrink-0 ${selected ? 'text-volt' : 'text-ink/45'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink/85">{title}</span>
        <span className="block truncate text-[11px] text-ink/45">{sub}</span>
      </span>
      {badge}
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-volt" strokeWidth={2} />}
    </button>
  );
}

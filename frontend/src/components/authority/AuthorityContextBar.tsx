'use client';

/**
 * AuthorityContextBar — "estás operando como X" (review 2026-07-17 §1).
 *
 * One app, N authority accounts, two ways to operate. This bar lives in the
 * AppShell (visible on EVERY route) and answers, at a glance:
 *   - which account the app is operating AS (nickname + address),
 *   - with which authority (you sign directly · the council signs),
 *   - and, for governed Legacies, their health — read from the ledger.
 *
 * The switcher reuses the Mis Legacies card language in miniature (nickname +
 * badge + health) — never a second representation of the same account. The
 * color accompanies (data-authority theme on the shell); the bar commands.
 * `aria-live="polite"` announces context changes to assistive tech.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Landmark, Loader2, Users, Wallet } from 'lucide-react';
import { Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorityAccount } from '../../lib/authority/useAuthorityAccount';
import type { AuthorityAccount } from '../../lib/authority/authorityAccounts';
import { headlineLabel, healthTone } from '../legacy/MyLegaciesList';

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

function displayName(a: AuthorityAccount, t: (s: string) => string): string {
  if (a.nickname) return a.nickname;
  if (a.kind === 'governed') return t('Unnamed Legacy');
  return shortAddr(a.address);
}

export default function AuthorityContextBar() {
  const { t } = useT();
  const { accounts, active, setActive, authorityMode, refreshGoverned } = useAuthorityAccount();
  const [open, setOpen] = useState(false);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click-away / Escape — a switcher, not a page.
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

  // Opening the switcher refreshes governed ledger reads (health, council
  // shape) — lazily, so routine navigation costs nothing.
  useEffect(() => {
    if (!open) return;
    setLoadingLedger(true);
    void refreshGoverned().finally(() => setLoadingLedger(false));
  }, [open, refreshGoverned]);

  // Nothing connected and nothing observed: no context to declare, no bar.
  if (accounts.length === 0 || !active) return null;

  const governed = active.kind === 'governed';
  const simples = accounts.filter((a) => a.kind === 'simple');
  const governedAccounts = accounts.filter((a) => a.kind === 'governed');

  const modeLabel =
    authorityMode === 'quorum'
      ? t('You propose — the council signs')
      : t('You execute — you sign directly');

  return (
    <div ref={rootRef} className="relative z-30 mb-4">
      {/* Screen-reader announcement of the operating context. */}
      <span className="sr-only" aria-live="polite">
        {t('Operating as')} {displayName(active, t)} — {modeLabel}
      </span>

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 backdrop-blur-xl"
        style={{
          /* --volt is the HSL-triplet product accent (globals.css); the old
             --authority-accent is a hex var and cannot sit inside hsl(). */
          borderColor: 'hsl(var(--volt) / 0.28)',
          background:
            'linear-gradient(to right, hsl(var(--volt) / 0.10), hsl(var(--volt) / 0.03))',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="group flex min-w-0 items-center gap-2.5 text-left"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'hsl(var(--volt) / 0.18)', color: 'hsl(var(--volt))' }}
            aria-hidden
          >
            {governed ? <Landmark size={14} /> : <Wallet size={14} />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-ink">{displayName(active, t)}</span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-ink/45 transition-transform group-hover:text-ink/80 ${open ? 'rotate-180' : ''}`}
              />
            </span>
            <span className="block truncate font-mono text-[10px] text-ink/40">{shortAddr(active.address)}</span>
          </span>
        </button>

        <span className="hidden h-6 w-px bg-ink/10 sm:block" aria-hidden />

        <span className="text-[11px]" style={{ color: 'hsl(var(--volt))' }}>
          {modeLabel}
        </span>

        {governed && active.authority.total ? (
          <span className="text-[11px] text-ink/45">
            <Users size={11} className="mr-1 inline" />
            {active.authority.total} {t('signers')}
          </span>
        ) : null}
        {governed && active.health ? (
          <Pill tone={healthTone(active.health.level)}>{headlineLabel(active.health.headline, t)}</Pill>
        ) : null}

        {governed ? (
          <Link
            href="/app/legacy"
            className="ml-auto text-[11px] text-ink/50 underline-offset-2 hover:text-ink hover:underline"
          >
            {t('Open in Legacy')} →
          </Link>
        ) : null}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="listbox"
            aria-label={t('Switch account')}
            className="absolute left-0 right-0 top-full mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-ink/10 bg-surface-1 p-2 scrollbar-thin sm:right-auto sm:w-[380px]"
            style={{ boxShadow: '0 24px 70px rgba(0,0,0,0.55)' }}
          >
            <Group label={t('Your accounts')} loading={false}>
              {simples.length === 0 ? (
                <EmptyRow text={t('No wallet connected')} />
              ) : (
                simples.map((a) => (
                  <AccountRow key={a.id} account={a} activeId={active.id} onPick={(acc) => { setActive(acc); setOpen(false); }} />
                ))
              )}
            </Group>
            {governedAccounts.length > 0 && (
              <Group label={t('Governed Legacies')} loading={loadingLedger}>
                {governedAccounts.map((a) => (
                  <AccountRow key={a.id} account={a} activeId={active.id} onPick={(acc) => { setActive(acc); setOpen(false); }} />
                ))}
              </Group>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Group({ label, loading, children }: { label: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="p-1">
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink/35">
        {label}
        {loading && <Loader2 size={10} className="animate-spin" />}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <li className="px-2 py-2 text-[12px] text-ink/35">{text}</li>;
}

/** The Mis Legacies card, in miniature: name + address + badge + health. */
function AccountRow({
  account,
  activeId,
  onPick,
}: {
  account: AuthorityAccount;
  activeId: string;
  onPick: (a: AuthorityAccount) => void;
}) {
  const { t } = useT();
  const selected = account.id === activeId;
  const governed = account.kind === 'governed';
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => onPick(account)}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
          selected
            ? 'border-ink/20 bg-ink/[0.06]'
            : 'border-transparent hover:border-ink/10 hover:bg-ink/[0.04]'
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            governed ? 'bg-indigo-500/15 text-indigo-300' : 'bg-volt/15 text-volt'
          }`}
          aria-hidden
        >
          {governed ? <Landmark size={13} /> : <Wallet size={13} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink/90">{displayName(account, t)}</span>
          <span className="block truncate font-mono text-[10px] text-ink/40">{shortAddr(account.address)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {governed ? (
            account.health ? (
              <Pill tone={healthTone(account.health.level)} className="!px-2 !py-0.5 text-[10px]">
                {headlineLabel(account.health.headline, t)}
              </Pill>
            ) : (
              <Pill tone="neutral" className="!px-2 !py-0.5 text-[10px]">{t('council')}</Pill>
            )
          ) : (
            <Pill tone="info" className="!px-2 !py-0.5 text-[10px]">{t('connected')}</Pill>
          )}
          {selected && <Check size={14} className="text-ink/70" />}
        </span>
      </button>
    </li>
  );
}

'use client';

/**
 * ProductModeCard — the product toggle (founder direction 2026-07-17).
 *
 * One dashboard, two products: Astryum (your normal wallets) and Legacy (the
 * council-governed product). This card sits in the Summary header next to the
 * network telemetry and is THE place you change product — a deliberate act
 * with its own ceremony, not a floating button.
 *
 * What flipping it does: loads the predefined Legacy wallet (last used, else
 * the first of Mis Legacies), swaps the Wallets tab for Legacy in the nav,
 * and re-tints the whole dashboard (data-authority → --volt in globals.css).
 * Everything else stays identical — same skeleton, two suits.
 *
 * Designed for its function (not a clone of the gas card): the two product
 * identities as a segmented control, and one status line saying what is
 * loaded. The active segment carries `volt`, which itself flips gold→indigo
 * with the mode, so the card always shows the product's own color.
 */

import Link from 'next/link';
import { useEffect } from 'react';
import { Landmark, Wallet } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorityAccount } from '../../lib/authority/useAuthorityAccount';
import { healthTone } from '../legacy/MyLegaciesList';

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

const HEALTH_DOT: Record<'danger' | 'warning' | 'success' | 'neutral', string> = {
  success: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  neutral: 'bg-ink/25',
};

export default function ProductModeCard() {
  const { t } = useT();
  const { productMode, setProductMode, accounts, active, refreshGoverned } = useAuthorityAccount();

  const legacy = productMode === 'legacy';
  const governedCount = accounts.filter((a) => a.kind === 'governed').length;
  const simpleCount = accounts.filter((a) => a.kind === 'simple').length;

  // Keep the loaded Legacy's health honest while the card is in Legacy mode
  // (stale reads refresh; nothing observed → no-op).
  useEffect(() => {
    if (legacy) void refreshGoverned();
  }, [legacy, refreshGoverned]);

  const loadedLegacy = legacy && active?.kind === 'governed' ? active : null;

  return (
    <div
      className="shrink-0 rounded-2xl border border-ink/[0.05] bg-surface-1 px-4 py-3.5"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)' }}
    >
      {/* Announce the product change for assistive tech. */}
      <span className="sr-only" aria-live="polite">
        {legacy ? t('Legacy product active') : t('Astryum product active')}
      </span>

      <div className="flex items-center rounded-xl border border-ink/10 bg-ink/[0.03] p-0.5" role="group" aria-label={t('Product')}>
        <ModeButton
          on={!legacy}
          onClick={() => setProductMode('astryum')}
          icon={<Wallet size={13} />}
          label={t('Personal')}
        />
        <ModeButton
          on={legacy}
          onClick={() => setProductMode('legacy')}
          icon={<Landmark size={13} />}
          label="Legacy"
        />
      </div>

      {/* One honest status line: what operating in this product means NOW. */}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink/40">
        {legacy ? (
          loadedLegacy ? (
            <>
              <span
                className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[loadedLegacy.health ? healthTone(loadedLegacy.health.level) : 'neutral']}`}
                aria-hidden
              />
              <span className="truncate">
                {loadedLegacy.nickname ?? shortAddr(loadedLegacy.address)}
                {governedCount > 1 ? ` · ${governedCount} ${t('Legacies')}` : ''}
              </span>
            </>
          ) : (
            <Link href="/app/legacy" className="truncate underline-offset-2 hover:text-ink/75 hover:underline">
              {t('No Legacy yet — constitute it in its tab')}
            </Link>
          )
        ) : (
          <span className="truncate">
            {simpleCount > 0
              ? `${simpleCount} ${simpleCount === 1 ? t('wallet connected') : t('wallets connected')}`
              : t('No wallet connected')}
          </span>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors ${
        on ? 'bg-volt text-volt-ink' : 'text-ink/45 hover:text-ink/80'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

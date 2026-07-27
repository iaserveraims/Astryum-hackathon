'use client';

/**
 * ProductToggle — the product switch, and NOTHING else (founder 2026-07-18):
 * two segments, Astryum ↔ Legacy, living in the sidebar slot the old
 * "Overview" switcher occupied. No status line, no card chrome — the
 * dashboard's color already says which product you are in, and the loaded
 * Legacy's identity lives in the Summary's Net worth card.
 *
 * Flipping to Legacy loads the predefined governed account (last used, else
 * the first of Mis Legacies) via the ONE source of truth (useAuthorities
 * through the useAuthorityAccount adapter); flipping back restores the
 * aggregated overview of simple wallets.
 */

import { useEffect } from 'react';
import { Landmark, Wallet } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorityAccount } from '../../lib/authority/useAuthorityAccount';
import { useAuthStore } from '../../stores/authStore';
import { isDemoMode } from '../../lib/demoMode';

/** Which product a segment paints as: its colour is FIXED to the product, not
 *  to the active mode, so the active pill never flashes gold→indigo during a
 *  crossing (founder 2026-07-20). Reads the product-fixed CSS vars. */
type Product = 'personal' | 'legacy';

export default function ProductToggle() {
  const { t } = useT();
  const { productMode, setProductMode, accounts } = useAuthorityAccount();
  const router = useRouter();
  const pathname = usePathname();
  const legacy = productMode === 'legacy';
  // Legacy gate (founder 2026-07-26, revised: visible but gated): the toggle
  // renders for EVERYONE in the beta; without access (LEGACY_ENABLED off and
  // not on LEGACY_ACCESS_EMAILS) flipping to Legacy opens the in-development
  // popup instead of switching (gated inside setProductMode). Hydrated from
  // /auth/me; FAIL-CLOSED (only an explicit server `true` really switches).
  const legacyAccess = useAuthStore((s) => s.legacyAccess);
  const legacyAccessKnown = useAuthStore((s) => s.legacyAccessKnown);

  // A session already parked in Legacy (persisted active authority) whose
  // account is NOT on the list gets walked back to Personal — the gated popup
  // covers new entries, this covers sessions restored into the indigo product.
  // Waits for legacyAccessKnown: legacyAccess starts false while /auth/me is
  // in flight, and walking back on that default would kick an allowlisted
  // founder out of Legacy on every reload.
  useEffect(() => {
    if (!legacyAccessKnown || legacyAccess || !legacy) return;
    setProductMode('astryum');
    if (pathname === '/app/legacy') router.push('/app/wallets');
  }, [legacyAccessKnown, legacyAccess, legacy, pathname, setProductMode, router]);

  // Flipping the product also carries the user to the destination that only
  // exists in that product (founder 2026-07-20): the Wallets↔Legacy nav rows
  // swap with the mode, so staying on the hidden one leaves you on a page the
  // menu no longer lists. Only redirect FROM the pair's other side — every
  // shared page (Summary, Earn, Portfolio…) stays put.
  const select = (mode: 'astryum' | 'legacy') => {
    setProductMode(mode);
    if (mode === 'astryum') {
      // Leaving Legacy always lands on Wallets (Personal always has it).
      if (pathname === '/app/legacy') router.push('/app/wallets');
      return;
    }
    // Entering Legacy only actually switches when the account HAS access and
    // a council exists, outside the gated public demo (setProductMode is a
    // no-op / opens the coming-soon popup otherwise) — never navigate to a
    // page whose mode flip was intercepted, or the user lands stranded on a
    // hidden page in Personal.
    const canEnterLegacy = !isDemoMode() && legacyAccess && accounts.some((a) => a.kind === 'governed');
    if (canEnterLegacy && pathname === '/app/wallets') router.push('/app/legacy');
  };

  return (
    <div
      className="flex items-center rounded-xl border border-ink/10 bg-ink/[0.03] p-0.5"
      role="group"
      aria-label={t('Product')}
    >
      {/* Announce the product change for assistive tech. */}
      <span className="sr-only" aria-live="polite">
        {legacy ? t('Legacy product active') : t('Personal product active')}
      </span>
      {/* The mode key stays 'astryum' (persisted store value); only the label
          reads "Personal" (founder 2026-07-18). */}
      <Segment on={!legacy} product="personal" onClick={() => select('astryum')} icon={<Wallet size={13} />} label={t('Personal')} />
      <Segment on={legacy} product="legacy" onClick={() => select('legacy')} icon={<Landmark size={13} />} label="Legacy" />
    </div>
  );
}

function Segment({
  on,
  product,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  product: Product;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={
        on
          ? {
              backgroundColor: `hsl(var(--product-${product}))`,
              color: `hsl(var(--product-${product}-ink))`,
            }
          : undefined
      }
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold transition-colors ${
        on ? '' : 'text-ink/45 hover:text-ink/80'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

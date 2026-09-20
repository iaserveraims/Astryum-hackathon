'use client';

/**
 * ⚠️ RETIRADO Y SIN SENTIDO YA (fundador 2026-08-22, cuarta pasada: «no que sea
 * seleccionable como producto distinto, porque no lo es»). Llevaba desmontado
 * desde el 2026-08-16, pero ahora además su premisa es falsa: el producto no
 * se elige, lo pone la PANTALLA (AppShell sincroniza 'legacy' mientras la ruta
 * es /app/legacy). Si se remontara, su interruptor lo revertiría el
 * sincronizador en el mismo render. No revivir: para llegar a la gobernanza
 * está el destino Legacy del menú, que ahora sale siempre.
 *
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

import { useCallback, useEffect, useState } from 'react';
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
  const { productMode, setProductMode, accounts, loading: accountsLoading } = useAuthorityAccount();
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
    if (pathname === '/app/legacy') router.push('/app/home');
  }, [legacyAccessKnown, legacyAccess, legacy, pathname, setProductMode, router]);

  // Entering Legacy (founder 2026-08-04, "vía libre a todos"): the flip is
  // now UNCONDITIONAL for accounts with access — setProductMode activates the
  // governed account when one exists, or flips into the LOBBY (indigo shell,
  // Legacy nav, no account claimed) when nothing is constituted yet. The
  // popups (demo / no access) stay inside setProductMode. This layer only
  // navigates and upgrades:
  //
  //  1. /app/wallets only exists in Personal → carry the user over NOW (the
  //     mode already flipped, lobby or account — founder 2026-07-20).
  //  2. Accounts still LOADING → park the intent; when the registry answers
  //     with a governed account, re-entering ACTIVATES it in place (the
  //     crossing plays once — loading transitions are tracked silently).
  //  3. Resolved and truly nothing governed → the panel (Constituir door).
  const [pendingLegacy, setPendingLegacy] = useState(false);
  const enterLegacy = useCallback(() => {
    setProductMode('legacy');
    // Popup branches (demo / no access) were handled inside setProductMode —
    // never navigate on an intercepted flip. getState(): click-time read.
    if (isDemoMode() || !useAuthStore.getState().legacyAccess) return;
    // (The old /app/wallets carry-over died with the page: the Home hub
    // exists in BOTH products, so entering Legacy from it needs no move.)
    const hasGoverned = accounts.some((a) => a.kind === 'governed');
    if (hasGoverned) return;
    if (accountsLoading) {
      setPendingLegacy(true);
      return;
    }
    if (pathname !== '/app/legacy') router.push('/app/legacy');
  }, [accounts, accountsLoading, pathname, router, setProductMode]);

  useEffect(() => {
    if (!pendingLegacy || accountsLoading) return;
    setPendingLegacy(false);
    enterLegacy();
  }, [pendingLegacy, accountsLoading, enterLegacy]);

  const select = (mode: 'astryum' | 'legacy') => {
    if (mode === 'astryum') {
      setPendingLegacy(false);
      setProductMode('astryum');
      // Leaving Legacy always lands on the Home hub (exists in both products).
      if (pathname === '/app/legacy') router.push('/app/home');
      return;
    }
    enterLegacy();
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

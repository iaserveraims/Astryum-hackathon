'use client';

/**
 * useAuthorityAccount — ADAPTER over useAuthorities (union).
 *
 * This hook was the product-toggle line's state model (walletStore +
 * legacyLocal). After the merge with the switcher line (ADR-011) there is ONE
 * source of truth — useAuthorities (wallets from /api/wallets/mine, councils
 * from /api/governed-accounts, ledger reads cached in memory) — and this hook
 * keeps its ORIGINAL public API as an adapter so its consumers
 * (ProductModeCard, LegacySummaryPanel, AuthorityContextBar) work unchanged:
 */

import { useCallback, useMemo } from 'react';
import { useAuthorities, invalidateAuthorityCache } from '../../hooks/useAuthorities';
import { useAuthorityStore } from '../../stores/authorityStore';
import { useAuthStore } from '../../stores/authStore';
import { isDemoMode, openLegacyComingSoon } from '../demoMode';
import { OVERVIEW_AUTHORITY_ID } from '../authority';
import { toAuthorityAccount } from './toAuthorityAccount';
import type { AuthorityAccount } from './authorityAccounts';

export interface UseAuthorityAccountResult {
  /** Which PRODUCT the dashboard is: 'astryum' (normal wallets) or 'legacy'. */
  productMode: 'astryum' | 'legacy';
  /** Flip the product. Entering 'legacy' loads the last governed account used
   *  (else the first of Mis Legacies); leaving it restores the overview. */
  setProductMode: (mode: 'astryum' | 'legacy') => void;
  /** Every authority the user can operate as (simples + governed). */
  accounts: AuthorityAccount[];
  /** The account the app is operating AS right now (null = nothing connected/observed). */
  active: AuthorityAccount | null;
  setActive: (account: AuthorityAccount) => void;
  /** 'single' = you sign directly · 'quorum' = you propose, the council signs. */
  authorityMode: 'single' | 'quorum';
  /** True while wallets/registry are still resolving — judge "no governed
   *  accounts" only once this settles (ProductToggle's pending-flip). */
  loading: boolean;
  /** Refresh governed ledger reads (health, council shape). Call on switcher open. */
  refreshGoverned: () => Promise<void>;
}

// The mapping moved to lib/authority/toAuthorityAccount.ts (E2):
// pure and testable, and the single place the third state (simple+quorum)
// is spoken. This module stays the ADAPTER (product mode + active account).

export function useAuthorityAccount(): UseAuthorityAccountResult {
  const { authorities, active: myActive, activeGoverned, setActive: setActiveId, reload, loading } = useAuthorities();
  const lastGovernedId = useAuthorityStore((s) => s.lastGovernedId);
  // First-class product: the store value, NOT derived
  // from activeGoverned — 'legacy' with nothing constituted is the lobby.
  const productMode = useAuthorityStore((s) => s.productMode);

  const accounts = useMemo<AuthorityAccount[]>(
    () => authorities.map(toAuthorityAccount).filter((a): a is AuthorityAccount => a !== null),
    [authorities],
  );

  const active = useMemo<AuthorityAccount | null>(() => {
    if (myActive.kind !== 'overview') {
      return accounts.find((a) => a.id === myActive.id) ?? null;
    }
    // Overview: the toggle line's 'astryum' default was "the active/first
    // connected wallet" — surface the first simple so the card has a face.
    return accounts.find((a) => a.kind === 'simple') ?? null;
  }, [myActive, accounts]);

  const setLobbyMode = useAuthorityStore((s) => s.setProductMode);
  const setProductMode = useCallback(
    (mode: 'astryum' | 'legacy') => {
      if (mode === 'astryum') {
        // setActiveAuthority syncs productMode back to 'astryum'.
        setActiveId(OVERVIEW_AUTHORITY_ID);
        return;
      }
      // Public demo: Legacy is visible but gated. The setActive interception
      // can't fire here when the demo has no governed fixtures (no target id
      // ever reaches it), so the toggle itself opens the coming-soon popup.
      if (isDemoMode()) {
        openLegacyComingSoon();
        return;
      }
      // Beta gate: without
      // Legacy access the flip never switches — it opens the in-development
      // popup, beta copy. getState(): read at click time, not subscribed —
      // /auth/me has long answered by the time a human flips the toggle.
      if (!useAuthStore.getState().legacyAccess) {
        openLegacyComingSoon('beta');
        return;
      }
      const target =
        (lastGovernedId && accounts.find((a) => a.id === lastGovernedId && a.kind === 'governed')) ||
        accounts.find((a) => a.kind === 'governed');
      if (target) {
        // Activating the governed account syncs productMode to 'legacy'.
        setActiveId(target.id);
        return;
      }
      // Nothing governed yet → the LOBBY: the product still flips — indigo shell, crossing, Legacy nav
      // — and the panel invites to constitute. The old branch just died here,
      // which read as a broken toggle to anyone whose registry was empty.
      // Data: the shared pages do NOT fall back to personal capital — the
      // shell gates them behind the lobby state while nothing is governed
      // (same-day fix: overview-as-scope painted Personal data under the
      // Legacy shell).
      setLobbyMode('legacy');
    },
    [accounts, lastGovernedId, setActiveId, setLobbyMode],
  );

  const setActive = useCallback(
    (account: AuthorityAccount) => setActiveId(account.id),
    [setActiveId],
  );

  const refreshGoverned = useCallback(async () => {
    invalidateAuthorityCache();
    reload();
  }, [reload]);

  return {
    productMode,
    setProductMode,
    accounts,
    active,
    setActive,
    authorityMode: activeGoverned ? 'quorum' : 'single',
    loading,
    refreshGoverned,
  };
}

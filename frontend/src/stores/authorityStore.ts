'use client';

/**
 * The active authority — WHICH account the whole app operates as (ADR-009/011).
 *
 * Only the selection persists here; the authority list itself is derived live
 * (wallets from /api/wallets/mine, councils from /api/governed-accounts + the
 * ledger) in useAuthorities. Persisting just the id means a stale selection
 * degrades safely: if the authority disappears, consumers fall back to the
 * overview instead of operating a ghost account.
 *
 * `lastGovernedId` (2026-07-18 union with the product-toggle line): the last
 * governed account operated — the "predefined Legacy" the Summary toggle
 * re-enters. The toggle and the sidebar switcher write THIS same state, so
 * they can never disagree.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OVERVIEW_AUTHORITY_ID } from '../lib/authority';

interface AuthorityState {
  activeAuthorityId: string;
  /** The last governed authority id operated as — the toggle's re-entry door. */
  lastGovernedId: string | null;
  setActiveAuthority: (id: string) => void;
  resetAuthority: () => void;
}

export const useAuthorityStore = create<AuthorityState>()(
  persist(
    (set) => ({
      activeAuthorityId: OVERVIEW_AUTHORITY_ID,
      lastGovernedId: null,
      setActiveAuthority: (id) =>
        set((s) => ({
          activeAuthorityId: id,
          lastGovernedId: id.startsWith('governed:') ? id : s.lastGovernedId,
        })),
      resetAuthority: () => set({ activeAuthorityId: OVERVIEW_AUTHORITY_ID, lastGovernedId: null }),
    }),
    { name: 'astryum:active-authority' },
  ),
);

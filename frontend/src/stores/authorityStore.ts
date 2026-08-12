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
  /**
   * The PRODUCT the shell wears — first-class, not derived (founder
   * 2026-08-04: "vía libre a todos los usuarios para que configuren sus
   * Legacys"). 'legacy' can be active WITHOUT a governed account: the LOBBY —
   * indigo shell, Legacy nav, the panel inviting to constitute/observe.
   * Activating a governed account implies 'legacy' (setActiveAuthority keeps
   * them in sync); selecting the overview or a personal wallet implies
   * 'astryum'. Data scope keeps keying off the ACTIVE authority — the lobby
   * claims no account, it only wears the product.
   */
  productMode: 'astryum' | 'legacy';
  setActiveAuthority: (id: string) => void;
  /** Direct product flip — only for the lobby (no account to activate). */
  setProductMode: (mode: 'astryum' | 'legacy') => void;
  resetAuthority: () => void;
}

export const useAuthorityStore = create<AuthorityState>()(
  persist(
    (set) => ({
      activeAuthorityId: OVERVIEW_AUTHORITY_ID,
      lastGovernedId: null,
      productMode: 'astryum',
      setActiveAuthority: (id) =>
        set((s) => ({
          activeAuthorityId: id,
          lastGovernedId: id.startsWith('governed:') ? id : s.lastGovernedId,
          productMode: id.startsWith('governed:') ? 'legacy' : 'astryum',
        })),
      setProductMode: (mode) => set({ productMode: mode }),
      resetAuthority: () =>
        set({ activeAuthorityId: OVERVIEW_AUTHORITY_ID, lastGovernedId: null, productMode: 'astryum' }),
    }),
    {
      name: 'astryum:active-authority',
      // Old persisted snapshots predate productMode — derive it from the
      // active id so a session restored into a governed account wakes up
      // wearing legacy, never gold-with-a-council.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthorityState>;
        return {
          ...current,
          ...p,
          productMode:
            p.productMode ??
            ((p.activeAuthorityId ?? '').startsWith('governed:') ? 'legacy' : 'astryum'),
        };
      },
    },
  ),
);

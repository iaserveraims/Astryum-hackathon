'use client';

/**
 * Global "hide balances" switch — ONE state for the whole app.
 *
 * Every money figure (net worth, wallet balances, donut totals, chart
 * tooltips, token quantities) masks together: hiding balances on one page
 * hides them everywhere, and the choice survives navigation and reloads.
 * Pure display concern — it never changes what is fetched, only what is
 * painted. Percentages and health readings stay visible: they describe
 * shape, not amounts.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BalanceVisibilityState {
  hidden: boolean;
  toggle: () => void;
}

export const useBalanceVisibility = create<BalanceVisibilityState>()(
  persist(
    (set) => ({
      hidden: false,
      toggle: () => set((s) => ({ hidden: !s.hidden })),
    }),
    { name: 'astryum:balances-hidden' },
  ),
);

/** The house mask for a hidden money figure. */
export const MASK = '••••';

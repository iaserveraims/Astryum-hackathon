'use client';

/**
 * themeStore — the dashboard's light/dark preference (founder 2026-07-19).
 *
 * ONE bit, persisted. ThemeApplier (mounted in the /app layout) stamps it as
 * `data-theme` on <html>, where BOTH the shell tree and body-level portals
 * (ProductTour, modals) can read it; leaving the dashboard removes the stamp,
 * so the landing/login keep their own fixed look. All actual colors live in
 * CSS: globals.css flips the same token families the authority theme flips
 * (--surface-0..3, --shell-*, --volt*, --ink) under [data-theme='light'].
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppTheme = 'dark' | 'light';

interface ThemeState {
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'astryum-theme' },
  ),
);

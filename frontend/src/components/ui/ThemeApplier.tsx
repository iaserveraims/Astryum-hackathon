'use client';

/**
 * ThemeApplier — stamps the persisted theme as `data-theme` AND the product's
 * authority palette as `data-authority` on <html> while the dashboard is
 * mounted. On <html> (not the shell div) so everything OUTSIDE the shell's
 * subtree — body portals (ProductTour, gate modals, Xaman QR) and the layout
 * siblings (ProductAssistant, LegacyComingSoonModal) — inherits both. The
 * copilot wore gold inside Legacy precisely because the authority stamp lived
 * only on the shell div and the copilot is a sibling (founder 2026-08-04).
 * Both stamps read the same store, so they can never disagree. Unmount
 * removes both html stamps: the landing/login keep their own fixed design
 * (the landing manages data-authority on its own root).
 */

import { useEffect } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthorityStore } from '../../stores/authorityStore';

export default function ThemeApplier() {
  const theme = useThemeStore((s) => s.theme);
  const productMode = useAuthorityStore((s) => s.productMode);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    return () => {
      root.removeAttribute('data-theme');
    };
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-authority', productMode === 'legacy' ? 'governed' : 'single');
    return () => {
      root.removeAttribute('data-authority');
    };
  }, [productMode]);

  return null;
}

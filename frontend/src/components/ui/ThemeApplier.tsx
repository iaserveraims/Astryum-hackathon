'use client';

/**
 * ThemeApplier — stamps the persisted theme as `data-theme` on <html> while
 * the dashboard is mounted. On <html> (not the shell div) so portals rendered
 * to document.body (ProductTour, gate modals) inherit the theme too. Unmount
 * removes the stamp: the landing/login keep their own fixed dark design.
 */

import { useEffect } from 'react';
import { useThemeStore } from '../../stores/themeStore';

export default function ThemeApplier() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    return () => {
      root.removeAttribute('data-theme');
    };
  }, [theme]);

  return null;
}

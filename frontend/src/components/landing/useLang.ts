'use client';

/**
 * Persistent landing language — extracted from LandingPage 2026-07-25 so the
 * standalone marketing pages (/about, /what-we-offer) share the exact same
 * choice the landing persists: saved pick first, browser language as the
 * first-visit default. ONE storage key, one behaviour, three surfaces.
 */

import { useCallback, useEffect, useState } from 'react';

export type Lang = 'es' | 'en';
export const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    try {
      const s = localStorage.getItem('astryum:lang');
      if (s === 'en' || s === 'es') {
        setLang(s);
        return;
      }
      // No saved choice → follow the browser's configured language.
      const nav = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
      if (nav.startsWith('es')) setLang('es');
    } catch {
      /* ignore */
    }
  }, []);
  const set = useCallback((l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem('astryum:lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  return [lang, set];
}

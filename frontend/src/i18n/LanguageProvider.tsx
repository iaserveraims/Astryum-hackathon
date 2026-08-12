'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translate, type Lang } from './dict';
import { localeOf, setActiveLocale } from '../lib/format';

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** t('English string') → Spanish when lang is 'es' and a translation exists, else the input. */
  t: (s: string) => string;
};

const LangContext = createContext<Ctx | null>(null);
const STORAGE_KEY = 'defibro:lang';

/**
 * Same language resolution as the provider, usable OUTSIDE the provider tree
 * (e.g. the root-level NetworkSwitcher banner, mounted above /app's provider).
 * Safe on the server: falls back to 'en'.
 */
export function getStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') return stored;
    if (navigator.language?.toLowerCase().startsWith('es')) return 'es';
  } catch {}
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const stored = getStoredLang();
    setLangState(stored);
    // Numbers follow the language: the module-level locale feeds the plain
    // formatters (formatMoney and the local fmt() helpers) without churn.
    setActiveLocale(localeOf(stored));
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    setActiveLocale(localeOf(l));
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
      document.documentElement.lang = l;
    } catch {}
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t: (s) => translate(lang, s) }}>
      {children}
    </LangContext.Provider>
  );
}

/** Safe outside a provider: returns identity translation so nothing crashes. */
export function useT(): Ctx {
  const ctx = useContext(LangContext);
  if (!ctx) return { lang: 'en', setLang: () => {}, t: (s) => s };
  return ctx;
}

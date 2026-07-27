'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translate, type Lang } from './dict';

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** t('English string') → Spanish when lang is 'es' and a translation exists, else the input. */
  t: (s: string) => string;
};

const LangContext = createContext<Ctx | null>(null);
const STORAGE_KEY = 'defibro:lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'es' || stored === 'en') setLangState(stored);
      else if (navigator.language?.toLowerCase().startsWith('es')) setLangState('es');
    } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
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

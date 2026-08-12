'use client';

/**
 * useFormat — the entry point for EVERY number a component renders (Fase 1).
 * The active app language picks the locale; components stop calling toFixed /
 * toLocaleString directly so the language switch finally moves the digits too.
 */

import { useMemo } from 'react';
import { useT } from '../i18n/LanguageProvider';
import { localeOf, makeFormatters, type Formatters } from '../lib/format';

export function useFormat(): Formatters {
  const { lang } = useT();
  return useMemo(() => makeFormatters(localeOf(lang)), [lang]);
}

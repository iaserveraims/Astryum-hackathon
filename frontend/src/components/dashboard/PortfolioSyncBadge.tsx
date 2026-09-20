'use client';

/**
 * PortfolioSyncBadge — «hay wallets aún leyéndose» dicho DONDE está el dinero.
 *
 * El agujero era de señal, no de datos: en la carga fría el agregado pinta
 * PROGRESIVAMENTE (portfolioStore — `data` crece wallet a wallet mientras
 * `loading` sigue en true), pero ninguna superficie miraba `loading` una vez
 * había cifra que enseñar: el total parcial se presentaba como total final.
 *
 * Este badge es esa mirada, UNA vez y compartida: se enciende solo mientras
 * quedan wallets por leer (leídas < conectadas durante `loading`), dice
 * cuántas van, y se apaga solo. En revalidaciones de fondo (`refreshing`) no
 * aparece: ahí la cifra en pantalla es la completa anterior, no un parcial.
 * Montarlo junto a CUALQUIER cifra de dinero es una línea.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { useAuthorityWallets } from '@/hooks/useAuthorityWallets';
import { useT } from '@/i18n/LanguageProvider';

export function PortfolioSyncBadge({ className = '' }: { className?: string }) {
  const { t } = useT();
  const { wallets } = useAuthorityWallets();
  const { data, loading } = useAggregatedPortfolio();
  // perWallet solo contiene lecturas completadas; en el pintado progresivo
  // crece hasta el total. El clamp cubre las filas extra del plegado de PAs.
  const read = Math.min(data?.perWallet.length ?? 0, wallets.length);
  const total = wallets.length;
  const show = loading && total > 0 && read < total;
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          transition={{ duration: 0.25 }}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-volt/25 bg-volt/[0.07] px-2.5 py-1 text-[10.5px] leading-none text-ink/70 ${className}`}
          role="status"
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-volt" aria-hidden />
          <span className="truncate">{t('Still reading your wallets — the figure keeps growing')}</span>
          <span className="shrink-0 font-mono tabular-nums text-ink/45">
            {read}/{total}
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

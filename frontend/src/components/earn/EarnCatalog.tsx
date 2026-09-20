'use client';

/**
 * EarnCatalog — el selector de activos y las dos tipologías, en el sitio que
 * antes ocupaban el camino interactivo y su menú de orden (fundador, 24-ago).
 *
 * QUÉ SUSTITUYE Y POR QUÉ. El recuadro de «What do you want to happen? / With
 * what?» ocupaba un tercio de la pantalla para hacer de filtro, y las cards —lo
 * único que el usuario ha venido a mirar— empezaban por debajo del pliegue. Aquí
 * el filtro cabe en una línea: los activos que el usuario TIENE, y un botón de
 * filtros para reordenar. Todo lo que se ahorra arriba se lo quedan las cards.
 *
 * SOLO LOS ACTIVOS DE SU WALLET. Ofrecer los tres del catálogo cuando alguien
 * solo tiene XRP es ofrecer dos filtros que llevan a pantallas vacías. Se leen
 * del agregado que el shell ya tiene cargado —ni una petición nueva— y si no se
 * pudo leer ninguno, se ofrecen todos: sin saldo leído, esconder es peor que
 * mostrar de más.
 *
 * DOS TIPOLOGÍAS, EL MISMO FORMATO. «Make it earn» y «Get cash without selling»
 * se dibujan igual: misma cabecera, misma rejilla, mismas cards. La delegación
 * al FTSO vive dentro de la primera (fundador: «al final es lo mismo»).
 *
 * LAS CARDS NO CAMBIAN: cada tipología monta un StrategyFan COMPLETO, con su
 * mano solapada, su tilt, su lift y su rejilla de repuesto en móvil. Aquí no se
 * dibuja ni una card a mano: lo único que decide este fichero es QUÉ cards van
 * en cada mano y en qué orden.
 *
 * ORDENAR ES UN GESTO, NO UN RANKING (invariante #9): el orden por defecto es el
 * del catálogo, así que la pantalla nunca abre con «la mejor» arriba.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { HandCoins, SlidersHorizontal, Sprout } from 'lucide-react';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { walletHoldings } from '@/lib/portfolioMerge';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import { fmtQtyActive } from '@/lib/format';
import { TYPOLOGIES, actionOfKind, riskBand, type TypologyId } from '@/lib/earn/protocols';
// La mano de siempre, COMPLETA: su solapamiento, su tilt, su lift y su rejilla
// de repuesto en móvil. Antes se usaba aquí GridCard —la variante plana que
// StrategyFan reserva para pantallas estrechas y para reduced-motion— y eso se
// llevaba por delante justo lo que hace que la mano sea la mano (fundador,
// 25-ago: «formato, símbolo, movimiento, estructuración entre cards, igual»).
import { StrategyFan, type FanCard } from './StrategyFan';
import type { VaultKind } from './FlareDemoEarn';

/** Cómo se ordenan las cards dentro de su tipología. */
export type CatalogSort = 'catalogue' | 'rate' | 'risk';

const SECTION_ICON: Record<string, typeof Sprout> = { earn: Sprout, cash: HandCoins };

/** Las franjas, de menor a mayor exposición — un orden factual, no una nota. */
const BAND_ORDER: Record<string, number> = { safe: 0, delegated: 1, liquidatable: 2 };

export interface EarnCatalogProps {
  /** Las cards ya construidas por el padre — las mismas de siempre. */
  cards: FanCard[];
  selected: VaultKind | null;
  onSelect: (kind: VaultKind) => void;
  /** La tasa viva con su fuente, ya construida (invariante #9). */
  chip: (kind: VaultKind) => React.ReactNode;
  /** El número para poder ORDENAR por tasa. null = el protocolo no publica una,
   *  y entonces la ruta se va al final en vez de fingir un cero. */
  rateOf: (kind: VaultKind) => number | null;
  t: (s: string) => string;
  /** Hay una ficha abierta a la derecha: la mano aprieta su solapamiento para
   *  caber entera en la columna izquierda (fundador, 26-ago). */
  compressed?: boolean;
  /** El MENÚ abierto (fundador 2026-08-28: dos menús, earn y cash): acota las
   *  secciones a una tipología. null/undefined = el catálogo entero, como
   *  siempre (retro-compatible con el deep-link ?view=pick). */
  only?: TypologyId | null;
}

export function EarnCatalog({ cards, selected, onSelect, chip, rateOf, compressed = false, only = null, t }: EarnCatalogProps) {
  const hidden = useBalanceVisibility((s) => s.hidden);
  const [asset, setAsset] = useState<string | null>(null);
  const [sort, setSort] = useState<CatalogSort>('catalogue');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  // Cerrar el menú al pulsar fuera: un popover que se queda abierto tapando
  // cards es peor que no tenerlo.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filtersRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filtersOpen]);

  // Lo que el usuario tiene, del agregado ya cargado.
  const { data } = useAggregatedPortfolio();
  const held = useMemo(() => {
    const map: Record<string, number> = {};
    if (!data?.snap) return map;
    for (const h of walletHoldings(data.snap)) if (h.qty != null) map[h.symbol] = h.qty;
    return map;
  }, [data]);

  /** El saldo disponible para una ruta: las de FXRP aceptan XRP y lo acuñan 1:1
   *  por el camino, así que contar solo el FXRP de Flare escondería dinero que
   *  sí puede entrar. */
  const balanceOf = (sym: string): number | null => {
    if (sym === 'FXRP') {
      const total = (held.FXRP ?? 0) + (held.XRP ?? 0);
      return total > 0 ? total : null;
    }
    return held[sym] ?? null;
  };

  /** Los activos del catálogo, en su orden. */
  const allAssets = useMemo(() => {
    const seen: string[] = [];
    for (const c of cards) if (c.asset && !seen.includes(c.asset)) seen.push(c.asset);
    return seen;
  }, [cards]);

  /** Los que el usuario TIENE. Si no se pudo leer ninguno, se ofrecen todos. */
  const walletAssets = useMemo(() => {
    const mine = allAssets.filter((a) => (balanceOf(a) ?? 0) > 0);
    return mine.length > 0 ? mine : allAssets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAssets, held]);

  const shown = useMemo(() => {
    const base = asset ? cards.filter((c) => c.asset === asset) : cards;
    if (sort === 'catalogue') return base;
    const arr = [...base];
    if (sort === 'rate') {
      // Sin tasa publicada se va al final: mejor el último puesto que un cero
      // que se lee como «paga nada».
      arr.sort((a, b) => (rateOf(b.kind) ?? -1) - (rateOf(a.kind) ?? -1));
    } else {
      arr.sort((a, b) => {
        const ba = actionOfKind(a.kind);
        const bb = actionOfKind(b.kind);
        const va = ba ? BAND_ORDER[riskBand(ba)] : 9;
        const vb = bb ? BAND_ORDER[riskBand(bb)] : 9;
        return va - vb;
      });
    }
    return arr;
  }, [cards, asset, sort, rateOf]);

  const sections: Array<{ id: TypologyId; title: string; sub: string; rows: FanCard[] }> = TYPOLOGIES
    .filter((ty) => ty.live && (!only || ty.id === only))
    .map((ty) => ({
      id: ty.id,
      title: ty.title,
      sub: ty.sub,
      rows: shown.filter((c) => actionOfKind(c.kind)?.typology === ty.id),
    }));

  const SORTS: Array<{ id: CatalogSort; label: string }> = [
    { id: 'catalogue', label: t('Default order') },
    { id: 'rate', label: t('Current rate') },
    { id: 'risk', label: t('Without debt first') },
  ];

  return (
    <div className="space-y-4">
      {/* ── El seleccionador: tus activos y los filtros, en una línea ────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAsset(null)}
          aria-pressed={asset === null}
          className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
            asset === null
              ? 'border-volt/45 bg-volt/[0.08] text-ink'
              : 'border-ink/10 bg-ink/[0.03] text-ink/55 hover:border-ink/20'
          }`}
        >
          {t('All')}
        </button>

        {walletAssets.map((sym) => {
          const bal = balanceOf(sym);
          const active = asset === sym;
          return (
            <button
              key={sym}
              type="button"
              onClick={() => setAsset(active ? null : sym)}
              aria-pressed={active}
              title={sym === 'FXRP' ? t('Your XRP counts here: it is minted into FXRP on the way in.') : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                active ? 'border-volt/45 bg-volt/[0.08]' : 'border-ink/10 bg-ink/[0.03] hover:border-ink/20'
              }`}
            >
              <TokenLogo symbol={sym} size="xs" />
              <span className="text-[12px] text-ink/85">{sym}</span>
              {/* Sin saldo leído no se pinta un cero: se deja el hueco. */}
              <span className="font-mono text-[11px] tabular-nums text-ink/40">
                {hidden ? MASK : bal != null ? fmtQtyActive(bal, 2) : '—'}
              </span>
            </button>
          );
        })}

        <div className="relative ml-auto" ref={filtersRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
              sort !== 'catalogue'
                ? 'border-volt/45 bg-volt/[0.08] text-volt'
                : 'border-ink/10 bg-ink/[0.03] text-ink/55 hover:border-ink/20'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('Filters')}
          </button>

          {filtersOpen && (
            <div className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-ink/10 bg-surface-1 p-1 shadow-xl">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSort(s.id);
                    setFiltersOpen(false);
                  }}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-[12.5px] transition-colors ${
                    sort === s.id ? 'bg-volt/10 text-volt' : 'text-ink/70 hover:bg-ink/[0.04]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <p className="px-3 pb-1.5 pt-1 text-[10.5px] leading-snug text-ink/35">
                {t('Ordering is yours — the default keeps the catalogue order, and nothing here is a recommendation.')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Las dos tipologías, con el mismo formato ─────────────────────── */}
      {sections.map((sec) => {
        const Icon = SECTION_ICON[sec.id] ?? Sprout;
        return (
          <section key={sec.id} aria-label={t(sec.title)}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Icon className="h-3.5 w-3.5 shrink-0 self-center text-ink/35" strokeWidth={1.75} />
              {/* Acotado a UN menú, el título de sección repetiría el cabecero
                  de la página — queda la línea factual, que es la que informa. */}
              {!only && <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">{t(sec.title)}</h3>}
              <span className="font-mono text-[10.5px] tabular-nums text-ink/30">{sec.rows.length}</span>
              <p className="text-[11.5px] leading-snug text-ink/40">{t(sec.sub)}</p>
            </div>

            {sec.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink/12 px-3 py-2.5 text-[12px] text-ink/45">
                {t('Nothing here with')} {asset}.
              </p>
            ) : (
              <StrategyFan
                cards={sec.rows}
                selected={selected}
                onSelect={onSelect}
                chip={chip}
                compressed={compressed}
                t={t}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

export default EarnCatalog;

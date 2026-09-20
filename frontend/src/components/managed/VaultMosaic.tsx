'use client';

/**
 * VaultMosaic — CONSTRUIDO, DESMONTADO EL MISMO DÍA (2026-09-13).
 *
 * Fue el catálogo durante unas horas; se retiró en la segunda pasada del
 * fundador («se ven achatados y pequeñitos, deberían verse como todas las
 * estrategias del Earn»): las filas de 10,5 rem y las columnas de 12 rem
 * dejaban un «cuadrado» a 192×168 px frente a los 224×288 de una carta de
 * Earn, y el flujo denso ponía los cuadrados en horizontal de todos modos.
 * El catálogo vuelve a StrategyFan (ManagerDirectory) y lo que vale de aquí
 * —el dinero delante, «tuyo» sumado por bóveda— vive en vaultMoney.tsx y va
 * dentro de la carta. Se conserva sin montar por si la forma vuelve.
 *
 * ── Lo que era ──────────────────────────────────────────────────────────────
 * VaultMosaic — el catálogo de bóvedas con gestor como MOSAICO (fundador
 * 2026-09-13: «que esté mejor repartido el tema de los vaults, el dinero que
 * tiene cada usuario, y lo de la imagen del vault que es secundario… que no
 * estén todos en horizontal: que haya más de uno en un recuadro vertical»).
 *
 * Sustituye a la mano solapada (StrategyFan) SOLO aquí: Earn conserva su
 * mano; el catálogo de bóvedas pasa a una rejilla de recuadros de tres formas
 * —ALTO (una columna, dos filas), CUADRADO y ANCHO (dos columnas)— que el
 * navegador empaqueta denso. Con tres bóvedas: un recuadro alto y dos
 * cuadrados apilados a su lado; con más, la forma rota y aparecen más altos.
 *
 * LO QUE MANDA EN CADA RECUADRO ES EL DINERO: cuánto hay en la bóveda y
 * cuánto de eso es TUYO (sumado en todas tus wallets y sus Smart Accounts),
 * en el activo de la bóveda — participaciones convertidas a activo con la
 * proporción del pote, nunca en euros inventados. La imagen del gestor queda
 * pequeña en la esquina: identifica, no preside.
 *
 * LA FORMA NO ES UN RANKING (invariante #9): se asigna por POSICIÓN en el
 * orden que el usuario eligió (ciclo alto·cuadrado·cuadrado·ancho), nunca
 * por rentabilidad ni por tamaño. La única excepción es un hecho tuyo: la
 * bóveda donde YA tienes capital se pinta alta, porque tu cifra necesita sitio.
 *
 * Tres artefactos por nivel de movimiento (stores/motionStore.ts): en
 * Completo el recuadro sube al pasar y se posa al llegar; en Sereno solo se
 * funde; en Mínimo el mosaico es una LISTA de filas.
 *
 * «NO PUDE LEER» ≠ «NO HAY»: una bóveda ilegible no pinta cifras — lo dice
 * en ámbar; y mientras tus posiciones se leen, «tuyo» es una espera, no un
 * cero.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { useMotionLevel } from '../../stores/motionStore';
import { EASE_OUT } from '../ui/motion';
import { TokenLogo } from '../ui/TokenLogo';
import { frameClass } from '../earn/StrategyFan';
import { VaultTile } from './VaultTile';
import { managerOf, type ManagerIdentity } from './managerIdentity';
import type { PoteCatalogEntry } from '../../lib/institutional/api';
import type { ManagedPosition } from '../../lib/institutional/useMyManagedPositions';
import { fmtAmount, mineByPote, Money, type MineInVault } from './vaultMoney';
import { fmtExitWindow, shortAddr } from '../../lib/institutional/format';
import { venueIdentity } from '../../lib/institutional/venueIdentity';

export type MosaicShape = 'tall' | 'square' | 'wide';

/** El ciclo de formas por posición: alto, dos cuadrados (que se apilan a su
 *  lado), ancho. Con cuatro o más bóvedas hay más de un recuadro vertical. */
const CYCLE: MosaicShape[] = ['tall', 'square', 'square', 'wide'];

function venueNamesOf(entry: PoteCatalogEntry): string[] {
  const names = entry.venues
    .filter((v) => !v.retired)
    .map((v) => { const id = venueIdentity(v.target); return id.known && id.name ? id.name : shortAddr(v.target); });
  return [...new Set(names)];
}

/* ── Las piezas de un recuadro ─────────────────────────────────────────── */

function VaultBox({
  entry,
  manager,
  shape,
  mine,
  mineLoading,
  selected,
  dimmed,
  index,
  onSelect,
  chip,
  t,
}: {
  entry: PoteCatalogEntry;
  manager: ManagerIdentity;
  shape: MosaicShape;
  mine: MineInVault | null;
  mineLoading: boolean;
  selected: boolean;
  dimmed: boolean;
  index: number;
  onSelect: () => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  const level = useMotionLevel();
  const full = level === 'full';
  const symbol = entry.asset?.symbol ?? '';
  const decimals = entry.asset?.decimals ?? 18;
  const tall = shape === 'tall';
  const wide = shape === 'wide';
  const title = entry.name ?? shortAddr(entry.pote);
  const venues = venueNamesOf(entry);
  const yoursValue = mineLoading ? '…' : mine ? `${mine.approx ? '≈' : ''}${fmtAmount(mine.assetsBase, mine.decimals)}` : '—';

  // La forma en la rejilla: alto = dos filas; ancho = dos columnas (solo desde
  // sm: en una sola columna un ancho se saldría del marco y pasa a cuadrado).
  const span = tall ? 'row-span-2' : wide ? 'sm:col-span-2' : '';

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      aria-label={`${title}${mine ? ` — ${t('Yours')}: ${yoursValue} ${mine.symbol}` : ''}`}
      initial={{ opacity: 0, y: full ? 10 : 0 }}
      animate={{ opacity: dimmed ? 0.72 : 1, y: 0, scale: selected ? 1.01 : 1 }}
      whileHover={full ? { y: -4 } : undefined}
      whileTap={full ? { scale: 0.985 } : undefined}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: Math.min(index * 0.05, 0.4) }}
      className={`${span} h-full min-h-0 ${frameClass(selected, false)}`}
    >
      {/* Cabecera: el nombre manda; la imagen del gestor, pequeña, a la derecha. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`font-semibold leading-snug text-ink ${tall ? 'text-[15px] line-clamp-3' : 'text-[13px] line-clamp-2'}`}>{title}</h3>
          {symbol ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] py-0.5 pl-0.5 pr-1.5">
              <TokenLogo symbol={symbol} size="xs" />
              <span className="font-mono text-[10px] font-medium text-ink/70">{symbol}</span>
            </span>
          ) : null}
        </div>
        <div className="shrink-0 overflow-hidden rounded-lg border border-ink/10">
          <VaultTile entry={entry} manager={manager} size={tall ? 32 : 26} shape="square" />
        </div>
      </div>

      {entry.unreadable ? (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-tone-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {t('Its state could not be read right now — that is not the same as empty.')}
        </p>
      ) : (
        <div className={`mt-3 ${wide ? 'grid grid-cols-2 gap-3' : tall ? 'space-y-3' : 'space-y-1.5'}`}>
          <Money label={t('In the vault')} value={fmtAmount(entry.totalAssets, decimals)} symbol={symbol} tone="ink" big={tall} />
          <Money
            label={t('Yours')}
            value={yoursValue}
            symbol={mine ? mine.symbol : ''}
            tone={mine ? 'volt' : 'muted'}
            big={tall}
            pending={mineLoading}
          />
        </div>
      )}

      {/* Los hechos del contrato, solo donde caben: salida y destinos. */}
      {!entry.unreadable && (tall || wide) ? (
        <dl className={`mt-3 text-[11px] leading-snug text-ink/50 ${wide ? 'grid grid-cols-2 gap-x-3' : 'space-y-1'}`}>
          <div className="flex min-w-0 gap-1">
            <dt className="shrink-0 text-ink/35">{t('exit')}</dt>
            <dd className="truncate text-ink/70">{fmtExitWindow(entry.cooldownSeconds, t)}</dd>
          </div>
          <div className="flex min-w-0 gap-1">
            <dt className="shrink-0 text-ink/35">{t('to')}</dt>
            <dd className={`text-ink/70 ${tall ? 'line-clamp-2' : 'truncate'}`}>
              {venues.length > 0 ? venues.join(' · ') : t('no destination yet — capital would sit idle')}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-auto pt-3">{chip}</div>
      <ArrowUpRight
        aria-hidden
        className={`pointer-events-none absolute bottom-3 right-3 h-3.5 w-3.5 transition-colors ${selected ? 'text-volt' : 'text-ink/20'}`}
        strokeWidth={2}
      />
    </motion.button>
  );
}

/** La fila del nivel Mínimo: nombre, token, en la bóveda, tuyo, gestor, radio. */
function VaultRow({
  entry,
  mine,
  mineLoading,
  selected,
  onSelect,
  chip,
  t,
}: {
  entry: PoteCatalogEntry;
  mine: MineInVault | null;
  mineLoading: boolean;
  selected: boolean;
  onSelect: () => void;
  chip: React.ReactNode;
  t: (s: string) => string;
}) {
  const symbol = entry.asset?.symbol ?? '';
  const decimals = entry.asset?.decimals ?? 18;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-2.5 text-left first:rounded-t-lg last:rounded-b-lg ${
        selected ? 'bg-volt/[0.06]' : 'hover:bg-ink/[0.03]'
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{entry.name ?? shortAddr(entry.pote)}</span>
        <span className="block truncate text-[11px] text-ink/50">
          {entry.unreadable
            ? t('Could not read')
            : `${t('In the vault')} ${fmtAmount(entry.totalAssets, decimals)} ${symbol} · ${t('Yours')} ${mineLoading ? '…' : mine ? `${fmtAmount(mine.assetsBase, mine.decimals)} ${mine.symbol}` : '—'}`}
        </span>
      </span>
      <span className="shrink-0">{chip}</span>
      <TokenLogo symbol={symbol} size="xs" />
      <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-volt' : 'border-ink/25'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-volt" />}
      </span>
    </button>
  );
}

/* ── El mosaico ─────────────────────────────────────────────────────────── */

export function VaultMosaic({
  entries,
  managers,
  positions,
  positionsLoading,
  selected,
  onSelect,
  chip,
  t,
}: {
  entries: PoteCatalogEntry[];
  managers: Map<string, ManagerIdentity>;
  /** Tus posiciones (todas tus wallets); se suman por bóveda. */
  positions: ManagedPosition[];
  positionsLoading: boolean;
  selected: string | null;
  onSelect: (pote: string) => void;
  chip: (pote: string) => React.ReactNode;
  t: (s: string) => string;
}) {
  const level = useMotionLevel();
  const mine = useMemo(() => mineByPote(positions), [positions]);

  if (level === 'minimal') {
    return (
      <div role="radiogroup" className="divide-y divide-ink/[0.07] rounded-lg border border-ink/10 bg-surface-1">
        {entries.map((e) => (
          <VaultRow
            key={e.pote}
            entry={e}
            mine={mine.get(e.pote) ?? null}
            mineLoading={positionsLoading}
            selected={selected === e.pote}
            onSelect={() => onSelect(e.pote)}
            chip={chip(e.pote)}
            t={t}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      // Columnas de al menos 12rem, filas de 10.5rem, flujo DENSO: los huecos
      // que deja un recuadro alto los rellenan los cuadrados que vienen detrás.
      className="grid grid-flow-dense auto-rows-[10.5rem] grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3"
    >
      {entries.map((e, i) => {
        const has = (mine.get(e.pote)?.assetsBase ?? BigInt(0)) > BigInt(0);
        const shape: MosaicShape = has ? 'tall' : CYCLE[i % CYCLE.length];
        return (
          <VaultBox
            key={e.pote}
            entry={e}
            manager={managers.get(e.pote) ?? managerOf(e)}
            shape={shape}
            mine={mine.get(e.pote) ?? null}
            mineLoading={positionsLoading}
            selected={selected === e.pote}
            dimmed={selected != null && selected !== e.pote}
            index={i}
            onSelect={() => onSelect(e.pote)}
            chip={chip(e.pote)}
            t={t}
          />
        );
      })}
    </div>
  );
}

export default VaultMosaic;

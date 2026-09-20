'use client';

/**
 * vaultMoney — EL DINERO de una bóveda con gestor, como pieza compartida.
 *
 * Nació dentro del mosaico (13-sep, fundador: «el dinero que tiene cada
 * usuario, delante») y vive aparte desde la segunda pasada del mismo día
 * (fundador: «deberían verse como todas las estrategias del Earn»): el
 * catálogo vuelve a la mano de StrategyFan y estas cifras van en la propia
 * carta. Lo que se conserva del mosaico es justo esto — qué hay en la bóveda
 * y cuánto es TUYO — porque era la petición de fondo; lo que se retira es la
 * rejilla de recuadros de tres formas, que dejaba las cartas achatadas.
 *
 * «Tuyo» es la suma de tus posiciones (una por wallet y Smart Account) ya
 * convertidas a activo con la proporción del pote — jamás euros inventados.
 * Sin supply legible en alguna, la cifra lleva «≈»: «no sé» no es cero.
 */

import type { PoteCatalogEntry } from '../../lib/institutional/api';
import type { ManagedPosition } from '../../lib/institutional/useMyManagedPositions';
import { fmtBase } from '../../lib/institutional/policyCatalog';

/** Lo TUYO en una bóveda: la suma de tus posiciones (una por wallet) en activo. */
export interface MineInVault {
  assetsBase: bigint;
  decimals: number;
  symbol: string;
  /** Alguna posición no pudo convertirse a activo (pote sin supply legible). */
  approx: boolean;
}

export function mineByPote(positions: ManagedPosition[]): Map<string, MineInVault> {
  const m = new Map<string, MineInVault>();
  for (const p of positions) {
    const cur = m.get(p.entry.pote) ?? {
      assetsBase: BigInt(0),
      decimals: p.assetDecimals,
      symbol: p.assetSymbol,
      approx: false,
    };
    if (p.assetsBase == null) cur.approx = true;
    else {
      try { cur.assetsBase += BigInt(p.assetsBase); } catch { cur.approx = true; }
    }
    m.set(p.entry.pote, cur);
  }
  return m;
}

export function fmtAmount(base: string | bigint | null | undefined, decimals: number): string {
  if (base == null) return '—';
  try {
    const s = fmtBase(base, decimals, 2);
    // Miles con separador fino: 12 345.67 se lee; 12345.67 se cuenta.
    const [w, f] = s.split('.');
    const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return f ? `${grouped}.${f}` : grouped;
  } catch {
    return '—';
  }
}

export function Money({
  label,
  value,
  symbol,
  tone,
  big,
  pending,
}: {
  label: string;
  value: string;
  symbol: string;
  tone: 'ink' | 'volt' | 'muted';
  big: boolean;
  pending?: boolean;
}) {
  const color = tone === 'volt' ? 'text-volt' : tone === 'muted' ? 'text-ink/35' : 'text-ink';
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-[0.12em] text-ink/40">{label}</span>
      <span className={`block truncate font-mono tabular-nums leading-tight ${big ? 'text-[22px]' : 'text-[15px]'} ${color} ${pending ? 'animate-pulse' : ''}`}>
        {value}
        {symbol && value !== '—' ? <span className="ml-1 text-[0.6em] font-sans text-ink/45">{symbol}</span> : null}
      </span>
    </div>
  );
}

/** Las dos cifras de una carta de la mano, en una fila: en la bóveda | tuyo.
 *  Va en el hueco `chip` de la carta (StrategyFan), encima del chip del gestor. */
export function VaultMoney({
  entry,
  mine,
  loading,
  t,
}: {
  entry: PoteCatalogEntry;
  mine: MineInVault | null;
  loading: boolean;
  t: (s: string) => string;
}) {
  const symbol = entry.asset?.symbol ?? '';
  const decimals = entry.asset?.decimals ?? 18;
  const yours = loading ? '…' : mine ? `${mine.approx ? '≈' : ''}${fmtAmount(mine.assetsBase, mine.decimals)}` : '—';
  return (
    <div className="grid grid-cols-2 gap-x-3">
      <Money label={t('In the vault')} value={fmtAmount(entry.totalAssets, decimals)} symbol={symbol} tone="ink" big={false} />
      <Money label={t('Yours')} value={yours} symbol={mine ? mine.symbol : ''} tone={mine ? 'volt' : 'muted'} big={false} pending={loading} />
    </div>
  );
}

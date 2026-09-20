'use client';

/**
 * FleetBand — las cuentas del Home, una línea cada una.
 *
 * Fundador (quinta pasada): «el summary siempre muestra el whole
 * fleet, no pongas botón, hay que simplificar más las cosas… mostramos solo
 * las wallets (la legacy también) y no son seleccionables, pero sí clicables
 * para ir a wallets… ocupa mucho espacio lo de las wallets, a ver qué tal
 * limpiándolo poniéndolo igual que antes».
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { ArrowRight, Landmark } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import { CountUp } from '@/components/ui/motion';
import { TokenLogo } from '@/components/ui/TokenLogo';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import XamanAvatar from '@/components/wallet/XamanAvatar';
import { useXamanHues } from '@/lib/wallet/xamanHues';
import { useT } from '@/i18n/LanguageProvider';
import { walletHoldings } from '@/lib/portfolioMerge';
import { positionState } from '@/lib/positionKinds';
import { healthScoreFromHF, healthWords, healthTone as scoreTone } from '@/lib/healthScore';
import { brandOf, usesXamanAvatar, walletColor, walletIcon } from '@/lib/walletIdentity';
// EL nombre de una cuenta, con su dueña incluida: una Smart
// Account se llama «Smart Account · <apodo>», nunca por su walletType crudo.
import { useWalletLabeler } from '@/lib/wallet/useWalletLabeler';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import type { EthMorphoHealth } from '@/lib/earn/useEthMorphoHealth';
import type { PortfolioSnapshot } from '@/services/v1Api';
import type { FleetView, FleetRow } from '@/hooks/useFleet';
import { useMemo } from 'react';

// ── Qué está HACIENDO el capital de una cuenta ───────────────────────────────
// Los números del medidor, leídos por el clasificador COMPARTIDO
// (lib/positionKinds) para que esta fila y el anillo de al lado no puedan
// discrepar sobre qué es «trabajando» — incluida la clase CLAIM, dinero que ya
// sale de un sitio y no es ni una cosa ni la otra. El denominador son los
// ACTIVOS de la cuenta: la deuda abierta queda fuera, como prescribe
// positionKinds.
function capitalMix(snap: PortfolioSnapshot): { assetsUSD: number; earningPct: number; inflightPct: number } {
  let earning = 0;
  let inflight = 0;
  let assets = 0;
  for (const p of snap.positions) {
    const state = positionState(p);
    if (state === 'debt') continue;
    const usd = Math.abs(typeof p.amountUSD === 'number' ? p.amountUSD : 0);
    if (usd <= 0.01) continue;
    assets += usd;
    if (state === 'earning') earning += usd;
    else if (state === 'inflight') inflight += usd;
  }
  if (assets <= 0) return { assetsUSD: 0, earningPct: 0, inflightPct: 0 };
  return { assetsUSD: assets, earningPct: (earning / assets) * 100, inflightPct: (inflight / assets) * 100 };
}

// ── El medidor de capital ────────────────────────────────────────────────────
// Dos rellenos sobre una vía recesiva: trabajando, en camino, y lo que queda es
// dinero quieto. Fino, extremos redondeados, un HUECO de 2px entre tramos
// (nunca un borde) y el valor SIEMPRE acompañado de su etiqueta directa al
// lado, jamás solo por color (spec de dataviz).
//
// El tramo «trabajando» lleva encima un brillo que lo recorre despacio
// (.meter-flow): el dinero que trabaja fluye, el que está quieto no. Es
// decoración que refleja un hecho, y solo aparece cuando ese hecho existe.
function CapitalMeter({ earningPct, inflightPct }: { earningPct: number; inflightPct: number }) {
  const e = Math.max(0, Math.min(100, earningPct));
  const f = Math.max(0, Math.min(100 - e, inflightPct));
  return (
    <span className="relative block h-1.5 w-full rounded-full bg-ink/[0.07]" aria-hidden>
      {e > 0.5 && (
        <motion.span
          className="meter-flow absolute inset-y-0 left-0 overflow-hidden rounded-full bg-tone-success/85"
          initial={{ width: 0 }}
          animate={{ width: `${e}%` }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      {f > 0.5 && (
        <motion.span
          className="absolute inset-y-0 rounded-full bg-volt/85"
          initial={{ width: 0 }}
          animate={{ width: `max(2px, calc(${f}% - 2px))` }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
          style={{ left: `calc(${e}% + 2px)` }}
        />
      )}
    </span>
  );
}

// ── Cómo está una cuenta, en palabras ────────────────────────────────────────
function healthLine(
  snap: PortfolioSnapshot,
  hf: number | null,
  hasDebt: boolean,
  es: boolean,
): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; detail: string | null } {
  const empty = (snap.netWorthUSD ?? 0) < 0.01 && snap.positions.length === 0;
  if (empty) return { text: es ? 'Sin actividad' : 'No activity', tone: 'neutral', detail: null };
  if (!hasDebt) {
    return {
      text: es ? 'Sana' : 'Healthy',
      tone: 'success',
      detail: es ? 'Sin deuda abierta — nada puede liquidarse' : 'No open debt — nothing can be liquidated',
    };
  }
  const score = healthScoreFromHF(hf, true);
  const word = healthWords(score, es);
  return {
    text: score != null ? `${word} · ${score}/100` : word,
    tone: scoreTone(score),
    detail: hf != null ? `HF ${hf.toFixed(2)} — 1.00 = ${es ? 'liquidación' : 'liquidation'}` : null,
  };
}

const TONE_DOT: Record<string, string> = {
  success: 'bg-tone-success',
  warning: 'bg-tone-warning',
  danger: 'bg-tone-danger',
  neutral: 'bg-ink/25',
};

/**
 * El TOPE de filas. Sin él, ocho cuentas aplastan los anillos de
 * abajo — que es exactamente lo que los rompía. Las de más valor se ven; el
 * resto está a un clic, en Wallets, que es donde se gestionan.
 */
const CAP = 5;

export default function FleetBand({ view }: { view: FleetView }) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const { t, lang } = useT();
  const es = lang === 'es';
  const hidden = useBalanceVisibility((s) => s.hidden);
  const reduced = useReducedMotion();
  const { rows } = view;
  const labelable = useMemo(
    () => rows.map((r) => r.wallet).filter((w): w is NonNullable<typeof w> => w != null),
    [rows],
  );
  const { labelOf } = useWalletLabeler(labelable, t);
  const visible = rows.slice(0, CAP);
  const anyAssets = rows.some((r) => r.snap && capitalMix(r.snap).assetsUSD > 0);

  return (
    <Card spotlight padded={false} className="overflow-hidden">
      {/* Cabecera: el título, la leyenda del medidor centrada y la puerta de
          gestión. La leyenda se aparta por debajo de sm (ahí la fila también
          suelta su palabra y el tooltip carga la lectura). */}
      <div className="flex items-center gap-3 px-5 pt-3.5 pb-2">
        <h3 className="shrink-0 text-[15px] font-semibold tracking-tight text-ink">
          {t('Wallets')}
          <span className="ml-2 text-xs font-normal text-ink/35">{rows.length}</span>
        </h3>
        {anyAssets && (
          <div className="hidden flex-1 items-center justify-center gap-4 text-[10px] text-ink/35 sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-2.5 rounded-full bg-tone-success/85" aria-hidden /> {es ? 'trabajando' : 'working'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-2.5 rounded-full bg-volt/85" aria-hidden /> {es ? 'en camino' : 'in flight'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-2.5 rounded-full bg-ink/[0.12]" aria-hidden /> {es ? 'quieto' : 'sitting still'}
            </span>
          </div>
        )}
        <Link
          href="/app/wallets"
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-volt sm:ml-0"
        >
          {es ? 'Gestionar' : 'Manage'} <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
        </Link>
      </div>

      <div className="border-t border-ink/[0.05] px-5 py-1.5" data-tour="fleet-band">
        {visible.map((row, i) => (
          <AccountRow
            key={row.key}
            row={row}
            index={i}
            reduced={!!reduced}
            emHealth={view.emHealth}
            hidden={hidden}
            // El nombre JAMÁS es la dirección: un
            // Legacy sin bautizar se llama 'Legacy' — el índigo y el Landmark
            // ya dicen qué es; la dirección vive en su gestión.
            name={row.wallet ? labelOf(row.wallet) : row.legacy?.label || t('Legacy')}
            es={es}
            t={t}
          />
        ))}

        {rows.length === 0 && (
          <p className="py-3 text-[12px] leading-relaxed text-ink/45">
            {t('No wallets yet. Connect one you already own, watch an address, or create one here.')}
          </p>
        )}

        {/* Lo que no cabe no se esconde: se dice cuánto queda y dónde está. */}
        {rows.length > CAP && (
          <Link
            href="/app/wallets"
            className="block w-full rounded-lg py-1.5 text-center text-[11px] text-ink/45 transition-colors hover:bg-ink/[0.03] hover:text-ink/80"
          >
            {es
              ? `Ver las ${rows.length} cuentas en Wallets`
              : `See all ${rows.length} accounts in Wallets`}
          </Link>
        )}
      </div>
    </Card>
  );
}

// ── Una cuenta, en una línea — personal o gobernada, la misma anatomía ───────
function AccountRow({
  row,
  index,
  reduced,
  emHealth,
  hidden,
  name,
  es,
  t,
}: {
  row: FleetRow;
  index: number;
  reduced: boolean;
  emHealth: EthMorphoHealth;
  hidden: boolean;
  /** Ya resuelto por useWalletLabeler — la fila nunca inventa un nombre. */
  name: string;
  es: boolean;
  t: (s: string) => string;
}) {
  const w = row.wallet;
  const legacy = row.legacy;
  const glyph = w ? walletIcon(w) : null;
  const color = w ? walletColor(w) : 'hsl(var(--product-legacy))';
  const mix = row.snap ? capitalMix(row.snap) : null;
  const holdings = row.snap ? walletHoldings(row.snap) : [];
  const snapHf = typeof row.risk?.healthFactor === 'number' ? row.risk.healthFactor : null;
  // Manda el PEOR de los dos mundos, nunca el más bonito.
  const emHf = emHealth.byWallet[String(row.address).toLowerCase()] ?? null;
  const hf = snapHf != null && emHf != null ? Math.min(snapHf, emHf) : (snapHf ?? emHf);
  // Una deuda que el snapshot no sabe leer sigue siendo deuda: sin esto la
  // fila decía «Sana — sin deuda abierta» sobre un carry vivo.
  const hasDebt = (row.snap?.debtUSD ?? 0) > 0.01 || emHf != null;
  const health = row.snap ? healthLine(row.snap, hf, hasDebt, es) : null;
  const working = mix ? Math.round(mix.earningPct + mix.inflightPct) : null;

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: Math.min(index * 0.04, 0.24) }}
    >
      <Link
        // La fila lleva a Wallets, que es donde se gestiona una cuenta — y de
        // donde cuelga la gobernanza si es un Legacy. Ya no selecciona nada.
        href="/app/wallets"
        title={
          health
            ? `${name} — ${health.text}${health.detail ? ` (${health.detail})` : ''}${
                holdings.length > 0 ? ` · ${holdings.map((h) => h.symbol).join(' · ')}` : ''
              }. ${t('Manage your accounts')}`
            : t('Manage your accounts')
        }
        // SIN lavado de color aquí — el band es lectura densa y seis franjas tintadas lo
        // volvían ruido. La identidad la lleva el CHIP (color + marca), como
        // siempre; el lavado de recuadro entero vive en Wallets y Portfolio,
        // donde cada cuenta tiene su propia caja grande.
        // El calor al pasar por encima es DORADO, no gris: el gris se lee como
        // «deshabilitado» y el oro es el acento de la casa — la fila responde
        // al puntero en el color del producto.
        className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-volt/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/40"
      >
        <span
          // El glifo crece un punto al pasar por encima: la fila entera es un
          // enlace, y esto le da el acuse de que algo va a pasar sin mover ni
          // un píxel del resto de la línea.
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full transition-transform duration-200 group-hover:scale-110"
          style={
            legacy
              ? { background: 'hsl(var(--product-legacy) / 0.16)', color: 'hsl(var(--product-legacy))' }
              : {
                  background: `color-mix(in srgb, ${color} 20%, transparent)`,
                  boxShadow: `inset 0 0 0 1.5px ${color}66`,
                }
          }
        >
          {legacy ? (
            <Landmark className="h-3 w-3" strokeWidth={1.8} />
          ) : glyph ? (
            <WalletGlyphIcon icon={glyph} size={11} color={color} />
          ) : (
            w && usesXamanAvatar(w) ? (
            <XamanAvatar address={w.address} size={11} brand={brandOf(w.walletType, w.ecosystem)} />
          ) : (
            <WalletBrandIcon brand={brandOf(w?.walletType, w?.ecosystem)} size={11} tint={color} />
          )
          )}
        </span>
        <span className="w-24 shrink-0 truncate text-[13px] text-ink/80 md:w-32">{name}</span>
        {/* QUÉ TIENE DENTRO, con su cara. Ancho FIJO aunque no haya ninguna:
            si la tira encogiera con las cuentas vacías, el medidor de cada
            fila arrancaría en una x distinta y la banda dejaría de leerse como
            una tabla. Se aparta por debajo de sm, donde la fila ya va justa.
            Los símbolos salen del lector COMPARTIDO (walletHoldings), el mismo
            que pintan Wallets y Portfolio: dos lectores serían dos verdades
            sobre lo que hay en una cuenta. No es un saldo, así que el ojo de
            ocultar cifras no lo tapa. */}
        <span className="hidden w-9 shrink-0 items-center sm:flex" aria-hidden>
          {holdings.slice(0, 3).map((h, i) => (
            <span key={h.symbol} className="relative" style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 3 - i }}>
              <TokenLogo symbol={h.symbol} size="xs" className="ring-1 ring-surface-1" />
            </span>
          ))}
        </span>
        <span className="min-w-[2rem] flex-1">
          {mix && <CapitalMeter earningPct={mix.earningPct} inflightPct={mix.inflightPct} />}
        </span>
        {/* En pantallas estrechas se queda la cifra y se cae la palabra — la
            leyenda de la cabecera sigue nombrando los colores. */}
        <span className="w-9 shrink-0 text-[11px] text-ink/55 sm:w-[6.5rem]">
          <span className="font-mono tabular-nums text-ink/80">
            {mix && mix.assetsUSD > 0 ? `${working}%` : '—'}
          </span>{' '}
          <span className="hidden text-ink/40 sm:inline">
            {!mix
              ? ''
              : mix.assetsUSD <= 0
                ? es ? 'sin activos' : 'no assets'
                : (working ?? 0) >= 1
                  ? es ? 'trabajando' : 'working'
                  : es ? 'quieto' : 'sitting still'}
          </span>
        </span>
        {/* Cómo está: el punto lleva el color, la palabra lo hace legible. Solo
            aviso y peligro tiñen el texto; una cuenta sana se queda callada
            para que las ruidosas sean las que notas. */}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[health?.tone ?? 'neutral']}`} aria-hidden />
        <span
          className={`hidden w-[7.5rem] shrink-0 truncate text-[11px] md:block ${
            health?.tone === 'danger'
              ? 'text-tone-danger/90'
              : health?.tone === 'warning'
                ? 'text-tone-warning/90'
                : 'text-ink/45'
          }`}
        >
          {health?.text ?? ''}
        </span>
        <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-ink md:w-24">
          {row.netWorthUSD == null ? (
            <span className="text-ink/30">…</span>
          ) : hidden ? (
            MASK
          ) : (
            <CountUp value={row.netWorthUSD} format={(v) => formatMoneyCompact(v)} />
          )}
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-ink/25 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </Link>
    </motion.div>
  );
}

'use client';

/**
 * DonutCard — the allocation donuts (My Assets / Assets Earning), EXTRACTED
 * from the Summary (fusión): the Summary gave this row up so the
 * fleet band could grow, and the detail charts now live in the Portfolio's
 * Overview — the page whose job is detail. Lifted verbatim (component,
 * DonutFrame, assetQuantities and the earning-ring computation) so the
 * Portfolio renders the exact organisms the Summary used to.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import { Arrive } from '@/components/ui/motion';
import { AllocationDonut, AllocationLegend } from '@/components/ui/charts';
import { useEngraved } from '@/stores/themeStore';
import { useT } from '@/i18n/LanguageProvider';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { positionState, nextArrival } from '@/lib/positionKinds';
import type { PortfolioSnapshot } from '@/services/v1Api';

/** Real token quantities per asset, derived from the snapshot's positions
 *  (qty = amountUSD / priceUSD when the position carries a live price). Assets
 *  without a price stay undefined and render as no quantity — never invented. */
export function assetQuantities(positions: PortfolioSnapshot['positions']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const usd = typeof p.amountUSD === 'number' ? p.amountUSD : 0;
    const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
    const asset = typeof p.asset === 'string' ? p.asset : '';
    if (!asset || usd === 0 || price <= 0) continue;
    out[asset] = (out[asset] ?? 0) + Math.abs(usd) / price;
  }
  return out;
}

export interface EarningRing {
  /** BY-ASSET working capital + the amber in-flight slice, ready to chart. */
  donut: Record<string, number>;
  workingQty: Record<string, number>;
  workingUSD: number;
  idleUSD: number;
  inflightUSD: number;
  inflightArrival: string | null;
}

/**
 * The "Assets Earning" ring computation. In-flight stays in the ring: money leaving a venue is still AT the venue, with an exit
 * date — its own slice, never mistaken for idle coins. Debt never enters.
 */
export function earningRing(snap: PortfolioSnapshot | null, inflightLabel: string): EarningRing {
  const workingByAsset: Record<string, number> = {};
  const workingQty: Record<string, number> = {};
  let idleUSD = 0;
  let inflightUSD = 0;
  const inflightPositions: PortfolioSnapshot['positions'] = [];
  for (const p of snap?.positions ?? []) {
    const state = positionState(p);
    if (state === 'debt') continue;
    const usd = typeof p.amountUSD === 'number' ? Math.abs(p.amountUSD) : 0;
    if (usd === 0) continue;
    if (state === 'earning') {
      const asset = typeof p.asset === 'string' && p.asset ? p.asset : '—';
      workingByAsset[asset] = (workingByAsset[asset] ?? 0) + usd;
      const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
      if (price > 0) workingQty[asset] = (workingQty[asset] ?? 0) + usd / price;
    } else if (state === 'inflight') {
      inflightUSD += usd;
      inflightPositions.push(p);
    } else {
      idleUSD += usd;
    }
  }
  const workingUSD = Object.values(workingByAsset).reduce((s, v) => s + v, 0);
  // Partial snapshots can carry totals without position rows — still show the
  // honest all-idle ring rather than an empty box next to a filled My Assets.
  if (workingUSD + idleUSD + inflightUSD <= 0.01 && (snap?.totalUSD ?? 0) > 0.01) {
    idleUSD = snap!.totalUSD;
  }
  return {
    donut: { ...workingByAsset, ...(inflightUSD > 0.01 ? { [inflightLabel]: inflightUSD } : {}) },
    workingQty,
    workingUSD,
    idleUSD,
    inflightUSD,
    inflightArrival: nextArrival(inflightPositions),
  };
}

// The donut's orbital frame — the sized box plus the dashed orbit and its
// moonlet (the landing's solar hero, miniaturised). Shared by the charted ring
// and the at-rest ring so both land in exactly the same place on the card: when
// the first position starts working, the ring fills without the card reflowing.
function DonutFrame({ children }: { children: React.ReactNode }) {
  // LA ORLA GRABADA (tema Institucional): la órbita punteada con
  // su lunita brillante es un artefacto de ESPACIO — la miniatura del sistema
  // solar de la landing. En la lámina el anillo lleva la orla de un
  // instrumento grabado: dos filetes y una corona de graduación que da la
  // vuelta muy despacio (el mismo pulso que las demás placas) y que SE TRAZA
  // al llegar (plate-draw): es la mitad de «que los gráficos se carguen».
  const engraved = useEngraved();
  return (
    // El tamaño lo decide el CONTENEDOR (donut-scale, globals.css): las
    // clases de viewport de antes agrandaban la dona a 200px+ dentro de una
    // tarjeta de 320px y la leyenda moría fuera del recuadro.
    <div className="donut-scale relative shrink-0 m-3">
      {engraved ? (
        <EngravedOrla />
      ) : (
        <div className="donut-orbit absolute -inset-2.5 rounded-full border border-dashed border-volt/20" aria-hidden>
          <span
            className="absolute w-[5px] h-[5px] rounded-full bg-volt-soft"
            style={{ top: '3%', left: '50%', boxShadow: '0 0 8px hsl(var(--volt-soft) / 0.9), 0 0 20px hsl(var(--volt) / 0.5)' }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

/** La orla del anillo en la lámina: filete exterior, corona de 36 marcas
 *  (larga cada seis) que gira con emblem-turn, y filete interior. Los dos
 *  filetes se trazan al montar; la corona llega ya puesta, que un instrumento
 *  no dibuja su graduación cada vez que se mira. */
function EngravedOrla() {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i * Math.PI) / 18;
    const long = i % 6 === 0;
    const r1 = long ? 45.5 : 47;
    return { x1: 50 + Math.cos(a) * r1, y1: 50 + Math.sin(a) * r1, x2: 50 + Math.cos(a) * 49, y2: 50 + Math.sin(a) * 49, long };
  });
  return (
    <svg className="absolute -inset-2.5 h-[calc(100%+1.25rem)] w-[calc(100%+1.25rem)] text-volt" viewBox="0 0 100 100" aria-hidden>
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle className="plate-draw" cx="50" cy="50" r="49.4" pathLength={100} strokeWidth="0.7" strokeOpacity="0.5" style={{ ['--draw-delay' as never]: '0.2s' }} />
        <circle className="plate-draw" cx="50" cy="50" r="44" pathLength={100} strokeWidth="0.45" strokeOpacity="0.22" style={{ ['--draw-delay' as never]: '0.45s' }} />
        <g className="emblem-turn" style={{ transformOrigin: '50px 50px' }} strokeWidth="0.6">
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeOpacity={t.long ? 0.55 : 0.3} />
          ))}
        </g>
      </g>
    </svg>
  );
}

// ── Allocation donuts — clickable, distinct colours, no caption noise ─────────
export function DonutCard({
  title,
  data,
  qty,
  split,
  href,
  loading = false,
}: {
  title: string;
  data: Record<string, number>;
  qty?: Record<string, number>;
  /** Working vs in-flight vs idle aggregate figures (Assets Earning) — the
      one-line split whose working side the ring then breaks down by asset.
      `inflight` is money leaving a venue; `arrivesAt` is the date it lands
      (protocol data — absent when the venue can't say yet). */
  split?: { working: number; idle: number; inflight?: number; arrivesAt?: string | null };
  href: string;
  /** Snapshot still on its way: hold the donut's footprint with a quiet pulse
      instead of flashing "Nothing to chart yet" and reflowing when it lands. */
  loading?: boolean;
}) {
  const { t, lang } = useT();
  // Same eye as everywhere: the split's dollar figures mask, percentages stay.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const empty = Object.keys(data).length === 0;
  const inflight = split?.inflight ?? 0;
  const splitTotal = split ? split.working + split.idle + inflight : 0;
  // Short, locale-obeying arrival date ("2 ago" / "2 Aug") — same rule as every
  // other number on the dashboard: it follows the language in use.
  const arrival = split?.arrivesAt
    ? new Date(split.arrivesAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        day: 'numeric',
        month: 'short',
      })
    : null;
  return (
    <Link href={href} className="group block h-full min-h-0">
      {/* overflow-hidden: red de seguridad para que un apretón de layout no
          pueda volver a sacar el aro por encima del título de la tarjeta. El
          margen del marco (m-3) deja sitio a la órbita punteada dentro. */}
      <Card hover spotlight padded={false} className="donut-flow h-full p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          <ArrowRight className="w-4 h-4 shrink-0 text-ink/30 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
        </div>
        {/* The split line survives an empty ring: with every coin
            parked the ring has nothing to draw, and this line IS the reading —
            hiding it would leave the card mute about capital it can see.
        { *
            ALTO RESERVADO SIEMPRE.
            Solo Assets Earning lleva esta línea, y en la tira de cuatro anillos
            del Portfolio empujaba SU anillo dos líneas más abajo que los de las
            tarjetas vecinas. La franja existe en TODAS las tarjetas — vacía
            cuando no hay reparto que contar — así que los anillos arrancan
            todos a la misma y. El coste es una franja de aire en las tarjetas
            sin línea, y es exactamente lo que las alinea. */}
        <div className="shrink-0 -mt-2 mb-3 min-h-[2.1rem] text-[11px] font-mono tabular-nums leading-snug text-ink/45">
        {split && splitTotal > 0 && (
          <div>
            {t('Working')}{' '}
            <span className="text-ink/85">{hidden ? MASK : formatMoneyCompact(split.working)}</span>
            <span className="text-ink/35"> ({Math.round((split.working / splitTotal) * 100)}%)</span>
            {inflight > 0.01 && (
              <>
                <span className="mx-1.5 text-ink/25">·</span>
                {t('On the way')}{' '}
                <span className="text-ink/85">{hidden ? MASK : formatMoneyCompact(inflight)}</span>
                <span className="text-ink/35"> ({Math.round((inflight / splitTotal) * 100)}%)</span>
                {/* The date the venue releases it — protocol data, never a
                    promise: no date read, no date shown. */}
                {arrival && <span className="text-ink/35"> · {t('lands')} {arrival}</span>}
              </>
            )}
            <span className="mx-1.5 text-ink/25">·</span>
            {t('Not earning')}{' '}
            <span className="text-ink/85">{hidden ? MASK : formatMoneyCompact(split.idle)}</span>
            <span className="text-ink/35"> ({Math.round((split.idle / splitTotal) * 100)}%)</span>
          </div>
        )}
        </div>
        {empty && loading ? (
          <div className="donut-row flex-1 py-4" aria-hidden>
            <div className="donut-scale m-2 shrink-0 animate-pulse rounded-full border-[22px] border-ink/[0.05]" />
            <div className="flex-1 w-full space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-3.5 animate-pulse rounded bg-ink/[0.05]" style={{ width: `${78 - i * 18}%` }} />
              ))}
            </div>
          </div>
        ) : empty && split && splitTotal > 0 ? (
          /* Capital seen, none of it placed: the ring has nothing to draw and
             draws nothing — an empty band, never a full grey circle standing in
             for idle money (that is what the split line above is for). Same
             frame as the charted ring so the card holds its shape. */
          <div className="donut-row flex-1 min-h-0">
            <DonutFrame>
              {/* Same band as the charted ring — a radial gradient, not a
                  border, so the 62%/92% radii hold at every size. */}
              <div
                className="absolute inset-[4%] rounded-full"
                style={{ background: 'radial-gradient(closest-side, transparent 67%, hsl(var(--ink) / 0.05) 67.5%)' }}
                aria-hidden
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-xs text-ink/40">{t('total')}</div>
                <div className="text-base font-mono text-ink/50">{hidden ? MASK : formatMoneyCompact(0)}</div>
              </div>
            </DonutFrame>
            <div className="flex-1 w-full min-w-0 sm:pr-2">
              <p className="text-sm text-ink/70">{t('Nothing at work yet')}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/40">
                {t('This ring charts only capital placed in a vault. Pick a strategy and it shows up here.')}
              </p>
            </div>
          </div>
        ) : empty ? (
          <div className="flex-1 grid place-items-center py-10 text-ink/40 text-sm">{t('Nothing to chart yet')}</div>
        ) : (
          /* Donut big on the left, legend breathing on the right — one organic
             read: shape first, detail beside it. Stacks on small screens.
             ARRIVE: esta rama sustituye al esqueleto cuando el
             dato contesta, y lo hacía de golpe — el anillo y la leyenda
             enchufándose en una página ya visible. Ahora llega. */
          <Arrive className="donut-row flex-1 min-h-0">
            <DonutFrame>
              <AllocationDonut data={data} fill />
            </DonutFrame>
            <div className="flex-1 w-full min-w-0 sm:pr-2">
              <AllocationLegend data={data} qty={qty} showUSD />
            </div>
          </Arrive>
        )}
      </Card>
    </Link>
  );
}

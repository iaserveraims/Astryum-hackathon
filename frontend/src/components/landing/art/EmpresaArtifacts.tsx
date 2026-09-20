'use client';

/**
 * LAS LÁMINAS DEL MUNDO EMPRESA — en el idioma de quien las lee.
 *
 * Fundador, 2026-09-19: «adaptamos también los artifacts al público, ya que
 * un institucional entenderá referencias de liquidez, transacción y más». Así
 * que estas cuatro láminas no hablan de «patrimonio» ni de «órbita»: hablan de
 * liquidez por plazo, de matriz de firmas, de exposición contra un tope y de
 * un registro de transacciones con su estado y su hash.
 *
 * Material impreso (Plate tone="print", radio 3): una entidad lee una plancha,
 * no una tarjeta que flota. Y las cuatro se LEEN CON EL SCROLL, atadas a los
 * mismos tiempos que la carta estelar (CHART_BEATS): la escalera se llena
 * mientras la constelación se traza, la matriz se marca mientras se marcan los
 * asientos, la exposición se cierra con los arcos y el registro se escribe con
 * la eclíptica.
 *
 * Cifras de MAQUETA, rotuladas como tal. Ni una de rendimiento.
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Figure, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import { CHART_BEATS } from './StarChartScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface BizArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  progress?: MotionValue<number>;
}

const NOTE = { es: 'Datos de ejemplo', en: 'Example data' };

/* ═══════════════════════════════════════════════════════════════════════
   LA ESCALERA DE LIQUIDEZ — cuánto puede moverse, y cuándo
   ══════════════════════════════════════════════════════════════════════ */

const RUNGS = [
  { es: 'Disponible ahora', en: 'Available now', amount: '1,108,600', pct: 23, term: { es: 'T+0 · reserva', en: 'T+0 · reserve' }, ink: 0.95 },
  { es: 'En 24 h', en: 'In 24 h', amount: '1,494,200', pct: 31, term: { es: 'T+1 · sin cola', en: 'T+1 · no queue' }, ink: 0.7 },
  { es: 'Con cola de salida', en: 'With an exit queue', amount: '2,217,200', pct: 46, term: { es: 'Según el venue', en: 'Per venue' }, ink: 0.42 },
];

export function LadderArtifact({ lang, active, compact, progress }: BizArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = CHART_BEATS.position;
  const span = b - a;
  const figure = useCue(progress, a, a + span * 0.2, live, 0);
  const foot = useCue(progress, a + span * 0.8, a + span * 0.95, live, RUNGS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Escalera de liquidez', 'Liquidity ladder', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        <Cue t={figure}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Posición total', 'Total position', lang)}
            </span>
            <Figure currency="XRP" value="4,820,000" />
          </span>
        </Cue>
        <div className="mt-4">
          {RUNGS.map((r, i) => (
            <Rung key={r.en} rung={r} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
          ))}
        </div>
        <Cue t={foot} className="mt-3">
          <span className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Reserva mínima por contrato · 20 %', 'Minimum reserve by contract · 20 %', lang)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: TONE.success }}>
              <Mark ok t={foot} />
              {T('Cumplida · 23 %', 'Met · 23 %', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function Rung({
  rung,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  rung: (typeof RUNGS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.25 + i * 0.18), a + span * (0.5 + i * 0.18), live, i + 1);
  const w = useTransform(t, [0.2, 1], ['0%', `${rung.pct}%`], { clamp: true });
  return (
    <Cue t={t} className="py-[7px]" >
      <span className="block" style={{ borderBottom: i < RUNGS.length - 1 ? `1px solid ${PLATE.ruleSoft}` : undefined, paddingBottom: i < RUNGS.length - 1 ? 7 : 0 }}>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-white/75">{T(rung.es, rung.en, lang)}</span>
          <span className="text-[12px] text-white/80" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {rung.amount}
            <span className="ml-1.5 text-[10.5px] text-white/35">{rung.pct}%</span>
          </span>
        </span>
        <span className="relative block mt-[6px] h-[10px]" style={{ background: 'hsl(var(--ink) / 0.06)' }}>
          <motion.span className="absolute inset-y-0 left-0" style={{ width: w, background: `hsl(var(--volt) / ${rung.ink})` }} />
        </span>
        <span className="block mt-[4px] text-[9.5px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--ink) / 0.4)' }}>
          {T(rung.term.es, rung.term.en, lang)}
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA MATRIZ DE FIRMAS — cada cuenta con su quórum, y una propuesta en curso
   ══════════════════════════════════════════════════════════════════════ */

const ROWS = [
  { es: 'Tesorería', en: 'Treasury', q: { es: '2 de 4', en: '2 of 4' }, seats: [true, true, false, false] },
  { es: 'Operativa', en: 'Operating', q: { es: '1 de 2', en: '1 of 2' }, seats: [true, false] },
  { es: 'Reserva', en: 'Reserve', q: { es: '3 de 4', en: '3 of 4' }, seats: [true, true, true, false] },
];

export function MatrixArtifact({ lang, active, compact, progress }: BizArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = CHART_BEATS.organ;
  const span = b - a;
  const head = useCue(progress, a, a + span * 0.15, live, 0);
  const proposal = useCue(progress, a + span * 0.62, a + span * 0.9, live, ROWS.length + 1);
  const bar = useTransform(proposal, [0.4, 1], ['0%', '50%'], { clamp: true });
  return (
    <div ref={ref}>
      <Plate title={T('Matriz de firmas', 'Signature matrix', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        <Cue t={head}>
          <span className="grid grid-cols-[1fr_64px_92px] gap-2 text-[9.5px] font-mono uppercase tracking-[0.14em] pb-2" style={{ color: 'hsl(var(--ink) / 0.42)', borderBottom: `1px solid ${PLATE.rule}` }}>
            <span>{T('Cuenta', 'Account', lang)}</span>
            <span>{T('Quórum', 'Quorum', lang)}</span>
            <span className="text-right">{T('Firmantes', 'Signers', lang)}</span>
          </span>
        </Cue>
        {ROWS.map((r, i) => (
          <MatrixRow key={r.en} row={r} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={proposal} className="mt-3">
          <span className="block p-3" style={{ border: '1px solid hsl(var(--volt) / 0.4)', background: 'hsl(var(--volt) / 0.06)' }}>
            <span className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--volt-soft))' }}>
              <span>{T('Propuesta 0147 · simulada', 'Proposal 0147 · simulated', lang)}</span>
              <span className="text-white/80 normal-case tracking-normal" style={{ fontVariantNumeric: 'tabular-nums' }}>250,000 XRP</span>
            </span>
            <span className="block mt-1.5 text-[12px] text-white/80">{T('Tesorería → Operativa', 'Treasury → Operating', lang)}</span>
            <span className="mt-2 flex items-center gap-2.5">
              <span className="relative block flex-1 h-[4px]" style={{ background: 'hsl(var(--ink) / 0.08)' }}>
                <motion.span className="absolute inset-y-0 left-0" style={{ width: bar, background: 'hsl(var(--volt))' }} />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--volt-soft))' }}>
                {T('1 de 2 firmas', '1 of 2 signatures', lang)}
              </span>
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function MatrixRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof ROWS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.12 + i * 0.16), a + span * (0.4 + i * 0.16), live, i + 1);
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[1fr_64px_92px] gap-2 items-center py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
        <span className="text-[12.5px] text-white/85">{T(row.es, row.en, lang)}</span>
        <span className="text-[11px] font-mono" style={{ color: 'hsl(var(--volt-soft))' }}>
          {T(row.q.es, row.q.en, lang)}
        </span>
        <span className="flex justify-end gap-[5px]">
          {row.seats.map((on, k) => (
            <SeatDot key={k} on={on} t={t} k={k} />
          ))}
        </span>
      </span>
    </Cue>
  );
}

function SeatDot({ on, t, k }: { on: boolean; t: MotionValue<number>; k: number }) {
  const o = useTransform(t, [0.3 + k * 0.12, 0.6 + k * 0.12], [0, 1], { clamp: true });
  return (
    <motion.span
      className="block w-[11px] h-[11px]"
      style={{ opacity: o, background: on ? 'hsl(var(--volt-soft))' : 'transparent', border: on ? 'none' : '1.4px solid hsl(var(--ink) / 0.32)' }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA EXPOSICIÓN — cuánto hay en cada venue, contra el tope del contrato
   ══════════════════════════════════════════════════════════════════════ */

const VENUES = [
  { es: 'Venue A', en: 'Venue A', pct: 32, cap: 40, floor: false },
  { es: 'Venue B', en: 'Venue B', pct: 18, cap: 25, floor: false },
  { es: 'Reserva líquida', en: 'Liquid reserve', pct: 50, cap: 20, floor: true },
];

export function ExposureArtifact({ lang, active, compact, progress }: BizArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = CHART_BEATS.limits;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.82, a + span * 0.96, live, VENUES.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Exposición por venue', 'Exposure per venue', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        {VENUES.map((v, i) => (
          <VenueRow key={v.en} venue={v} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('2 venues permitidos · añadir uno exige espera', '2 venues allowed · adding one requires a delay', lang)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: TONE.success }}>
              <Mark ok t={foot} />
              {T('En límites', 'Within limits', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function VenueRow({
  venue,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  venue: (typeof VENUES)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.08 + i * 0.24), a + span * (0.4 + i * 0.24), live, i + 1);
  const w = useTransform(t, [0.25, 1], ['0%', `${venue.pct}%`], { clamp: true });
  const capO = useTransform(t, [0.7, 1], [0, 1], { clamp: true });
  return (
    <Cue t={t} className="py-[7px]">
      <span className="block" style={{ borderBottom: i < VENUES.length - 1 ? `1px solid ${PLATE.ruleSoft}` : undefined, paddingBottom: i < VENUES.length - 1 ? 7 : 0 }}>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-white/80">{T(venue.es, venue.en, lang)}</span>
          <span className="text-[11px] font-mono text-white/55" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span className="text-white/90">{venue.pct} %</span> · {T(venue.floor ? 'mínimo' : 'tope', venue.floor ? 'minimum' : 'cap', lang)} {venue.cap} %
          </span>
        </span>
        <span className="relative block mt-[6px] h-[10px]" style={{ background: 'hsl(var(--ink) / 0.06)' }}>
          <motion.span className="absolute inset-y-0 left-0" style={{ width: w, background: venue.floor ? 'hsl(var(--volt-soft) / 0.9)' : 'hsl(var(--volt) / 0.85)' }} />
          <motion.span
            className="absolute -top-[3px] -bottom-[3px] w-0"
            style={{ left: `${venue.cap}%`, borderLeft: `1.5px ${venue.floor ? 'dashed' : 'solid'} #ffffff`, opacity: capO }}
          />
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL REGISTRO DE TRANSACCIONES — hora, operación, importe, estado, hash
   ══════════════════════════════════════════════════════════════════════ */

const TXS = [
  { at: '09:14:02', es: 'Entrada', en: 'Inflow', amount: '250,000', st: { es: 'Liquidada', en: 'Settled' }, ok: true, h: 'a41f…9c2' },
  { at: '09:14:02', es: 'Política aplicada', en: 'Policy applied', amount: '—', st: { es: 'Autorizada', en: 'Authorized' }, ok: true, h: '7de0…14b' },
  { at: '11:02:47', es: 'Salida solicitada', en: 'Exit requested', amount: '80,000', st: { es: 'En cola', en: 'Queued' }, ok: false, h: 'c082…5fa' },
];

export function LedgerArtifact({ lang, active, compact, progress }: BizArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = CHART_BEATS.record;
  const span = b - a;
  const head = useCue(progress, a + span * 0.06, a + span * 0.78, live, 0);
  const headY = useTransform(head, [0, 1], ['-14%', '104%']);
  const headO = useTransform(head, [0, 0.06, 0.9, 1], [0, 1, 1, 0]);
  const foot = useCue(progress, a + span * 0.8, a + span * 0.94, live, TXS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Registro de transacciones', 'Transaction record', lang)} note="UTC" tone="print" enter={enter} live={live} compact={compact}>
        <div className="relative">
          {progress && (
            <motion.span
              aria-hidden
              className="absolute inset-x-0 h-[18px] pointer-events-none z-10"
              style={{ top: headY, opacity: headO, background: 'linear-gradient(180deg, transparent, hsl(var(--volt) / 0.18), transparent)' }}
            />
          )}
          <ul className="m-0 p-0 list-none relative">
            {TXS.map((tx, i) => (
              <li key={tx.h} style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
                <TxRow tx={tx} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
              </li>
            ))}
          </ul>
        </div>
        <Cue t={foot} className="mt-4">
          <span className="block text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'hsl(var(--volt-soft) / 0.8)' }}>
            {T('Conciliable contra el explorador', 'Reconcilable against the explorer', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function TxRow({
  tx,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  tx: (typeof TXS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const start = a + span * (0.1 + i * 0.22);
  const t = useCue(progress, start, start + span * 0.2, live, i);
  const clip = useTransform(t, [0.3, 0.85], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']);
  return (
    <Cue t={t} className="py-[8px]">
      <span className="grid grid-cols-[58px_1fr_auto] gap-x-3 items-center">
        <span className="font-mono text-[10px] text-white/45" style={{ fontVariantNumeric: 'tabular-nums' }}>{tx.at}</span>
        <span className="min-w-0">
          <span className="block text-[12px] text-white/85 truncate">{T(tx.es, tx.en, lang)}</span>
          <span className="flex items-center gap-1.5 mt-[2px] text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: tx.ok ? TONE.success : 'hsl(var(--tone-warning))' }}>
            <Mark ok={tx.ok} t={t} />
            {T(tx.st.es, tx.st.en, lang)}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[12px] text-white/80" style={{ fontVariantNumeric: 'tabular-nums' }}>{tx.amount}</span>
          <motion.span className="block font-mono text-[10px] text-white/35 tabular-nums" style={{ clipPath: clip }}>
            {tx.h}
          </motion.span>
        </span>
      </span>
    </Cue>
  );
}

'use client';

/**
 * LAS LÁMINAS DEL MUNDO EXCHANGE — en el idioma de un exchange.
 *
 * Ómnibus y casillas, acuñaciones en vuelo, reserva y salidas, conciliación
 * por casilla: lo que mira el equipo de operaciones de un exchange, dicho con
 * sus palabras. Material impreso y denso (Plate tone="print"), atado a los
 * tiempos de la estación (STATION_BEATS): las casillas se listan mientras los
 * muelles se ocupan, las acuñaciones cuentan mientras las motas cruzan el
 * tubo, la reserva se llena con el arco y la conciliación se marca con los
 * tics del anillo.
 *
 * Cifras de MAQUETA, rotuladas como tal. Ni una de rendimiento, ni una
 * promesa. La casilla sin credencial existe para enseñar que no entra.
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Figure, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import { STATION_BEATS } from './StationScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface ExchArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  progress?: MotionValue<number>;
}

const NOTE = { es: 'Datos de ejemplo', en: 'Example data' };
/** Flare, en su rosa fijo: nunca se re-tiñe con el producto. */
const FLR_SOFT = '#F4A8CE';

/* ═══════════════════════════════════════════════════════════════════════
   ÓMNIBUS Y CASILLAS — una por cliente, con su KYC
   ══════════════════════════════════════════════════════════════════════ */

const SLOTS = [
  { n: '1042', kyc: true, amount: '12,400 XRP' },
  { n: '1043', kyc: true, amount: '3,150 XRP' },
  { n: '1044', kyc: false, amount: '' },
];

export function SlotsArtifact({ lang, active, compact, progress }: ExchArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = STATION_BEATS.bays;
  const span = b - a;
  const omni = useCue(progress, a, a + span * 0.2, live, 0);
  const pot = useCue(progress, a + span * 0.78, a + span * 0.95, live, SLOTS.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Instancia · tu exchange', 'Instance · your exchange', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        <Cue t={omni}>
          <span className="flex items-center justify-between gap-3 p-2.5" style={{ border: '1px solid hsl(var(--volt) / 0.4)', background: 'hsl(var(--volt) / 0.06)' }}>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-white">{T('Ómnibus', 'Omnibus', lang)}</span>
              <span className="block text-[11px] text-white/55">{T('Cuenta XRPL del exchange', 'The exchange’s XRPL account', lang)}</span>
            </span>
            <span className="text-[9.5px] font-mono uppercase tracking-[0.12em] shrink-0" style={{ color: 'hsl(var(--volt-soft))' }}>
              {T('Llave del exchange', 'Exchange key', lang)}
            </span>
          </span>
        </Cue>
        <div className="ml-3 mt-2 pl-3" style={{ borderLeft: `1px solid ${PLATE.ruleStrong}` }}>
          {SLOTS.map((s, i) => (
            <SlotRow key={s.n} slot={s} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
          ))}
        </div>
        <Cue t={pot} className="mt-2">
          <span className="flex items-center justify-between gap-3 p-2.5" style={{ border: '1px solid rgba(236,72,153,0.35)', background: 'rgba(236,72,153,0.05)' }}>
            <span className="text-[12.5px] font-semibold text-white">{T('Pote de clientes · Flare', 'Client pot · Flare', lang)}</span>
            <span className="text-[9.5px] font-mono uppercase tracking-[0.12em]" style={{ color: FLR_SOFT }}>
              {T('Reglas en contrato', 'Rules in contract', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function SlotRow({
  slot,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  slot: (typeof SLOTS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.25 + i * 0.16), a + span * (0.5 + i * 0.16), live, i + 1);
  return (
    <Cue t={t} className="py-[4px]">
      <span
        className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-2.5 py-2"
        style={{ border: `1px ${slot.kyc ? 'solid' : 'dashed'} ${slot.kyc ? PLATE.rule : PLATE.ruleStrong}`, background: slot.kyc ? 'hsl(var(--ink) / 0.02)' : 'transparent' }}
      >
        <span className="text-[12px] text-white/85">{T('Casilla', 'Slot', lang)} {slot.n}</span>
        <span className="flex items-center gap-1.5 text-[9.5px] font-mono uppercase tracking-[0.12em]" style={{ color: slot.kyc ? TONE.success : 'hsl(var(--ink) / 0.5)' }}>
          <Mark ok={slot.kyc} t={t} />
          {slot.kyc ? T('KYC vigente', 'KYC valid', lang) : T('Sin credencial', 'No credential', lang)}
        </span>
        <span className="text-[11px] font-mono text-right" style={{ color: slot.kyc ? 'rgba(255,255,255,0.85)' : 'hsl(var(--ink) / 0.5)', fontVariantNumeric: 'tabular-nums' }}>
          {slot.kyc ? slot.amount : T('No entra', 'Not admitted', lang)}
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL FLUJO — cada depósito, una acuñación trazable
   ══════════════════════════════════════════════════════════════════════ */

const COUNTERS = [
  { n: '3', es: 'Preparadas', en: 'Prepared', tone: 'rgba(255,255,255,0.9)' },
  { n: '3', es: 'Firmadas', en: 'Signed', tone: 'rgba(255,255,255,0.9)' },
  { n: '2', es: 'En vuelo', en: 'In flight', tone: 'hsl(var(--tone-warning))' },
  { n: '39', es: 'Liquidadas', en: 'Settled', tone: 'hsl(var(--tone-success))' },
];
const FLIGHTS = [
  { slot: '1042', amount: '12,400', clock: '01:12' },
  { slot: '1051', amount: '3,000', clock: '00:34' },
];

export function FlowArtifact({ lang, active, compact, progress }: ExchArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = STATION_BEATS.flow;
  const span = b - a;
  const foot = useCue(progress, a + span * 0.82, a + span * 0.96, live, 6);
  return (
    <div ref={ref}>
      <Plate title={T('Acuñaciones de hoy', 'Today’s mints', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        <div className="grid grid-cols-4 gap-1.5">
          {COUNTERS.map((c, i) => (
            <Counter key={c.en} counter={c} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
          ))}
        </div>
        <div className="mt-3">
          {FLIGHTS.map((f, i) => (
            <FlightRow key={f.slot} flight={f} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
          ))}
        </div>
        <Cue t={foot} className="mt-3">
          <span className="block pt-3 text-[10px] font-mono uppercase tracking-[0.16em]" style={{ borderTop: `1px solid ${PLATE.ruleSoft}`, color: 'hsl(var(--ink) / 0.45)' }}>
            {T('Una operación por depósito · coste visible antes de firmar', 'One operation per deposit · cost shown before signing', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function Counter({
  counter,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  counter: (typeof COUNTERS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.05 + i * 0.1), a + span * (0.3 + i * 0.1), live, i);
  return (
    <Cue t={t}>
      <span className="block px-2 py-2" style={{ border: `1px solid ${PLATE.rule}` }}>
        <span className="block text-[20px] leading-none font-semibold" style={{ color: counter.tone, fontVariantNumeric: 'tabular-nums' }}>
          {counter.n}
        </span>
        <span className="block mt-1.5 text-[9px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
          {T(counter.es, counter.en, lang)}
        </span>
      </span>
    </Cue>
  );
}

function FlightRow({
  flight,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  flight: (typeof FLIGHTS)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.45 + i * 0.16), a + span * (0.7 + i * 0.16), live, i + 4);
  const pulse = useTransform(t, [0.6, 0.8, 1], [0.3, 1, 0.7], { clamp: true });
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[72px_1fr_auto] gap-x-3 items-center py-[8px]" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
        <span className="text-[12px] text-white/85">{T('Casilla', 'Slot', lang)} {flight.slot}</span>
        <span className="text-[11px] font-mono text-white/70" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {flight.amount} XRP → FXRP
        </span>
        <span className="flex items-center gap-1.5 text-[9.5px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--tone-warning))' }}>
          <motion.span className="block w-[6px] h-[6px] rounded-full" style={{ background: 'hsl(var(--tone-warning))', opacity: pulse }} />
          {T('En vuelo', 'In flight', lang)} · {flight.clock}
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RESERVA Y SALIDAS — la reserva que el contrato obliga a mantener
   ══════════════════════════════════════════════════════════════════════ */

export function ReserveArtifact({ lang, active, compact, progress }: ExchArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = STATION_BEATS.reserve;
  const span = b - a;
  const figure = useCue(progress, a, a + span * 0.2, live, 0);
  const gauge = useCue(progress, a + span * 0.15, a + span * 0.75, live, 1);
  const w = useTransform(gauge, [0, 1], ['0%', '22%'], { clamp: true });
  const floorO = useTransform(gauge, [0.7, 1], [0, 1], { clamp: true });
  const verdict = useCue(progress, a + span * 0.72, a + span * 0.88, live, 2);
  const exits = useCue(progress, a + span * 0.8, a + span * 0.96, live, 3);
  const cells = [
    { n: '4', es: 'Salidas hoy', en: 'Exits today' },
    { n: '18,200', es: 'XRP pedidos', en: 'XRP requested' },
    { n: '4 de 4', es: 'Desde la reserva', en: 'From the reserve' },
  ];
  return (
    <div ref={ref}>
      <Plate title={T('Reserva y salidas', 'Reserve and exits', lang)} note={T(NOTE.es, NOTE.en, lang)} tone="print" enter={enter} live={live} compact={compact}>
        <Cue t={figure}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Reserva líquida del pote', 'The pot’s liquid reserve', lang)}
            </span>
            <Figure currency="" value="22 %" />
          </span>
        </Cue>
        <span className="relative block mt-3 h-[12px]" style={{ background: 'hsl(var(--ink) / 0.06)' }}>
          <motion.span className="absolute inset-y-0 left-0" style={{ width: w, background: 'hsl(var(--volt) / 0.9)' }} />
          <motion.span className="absolute -top-[4px] -bottom-[4px] w-0" style={{ left: '20%', borderLeft: '1.5px dashed #ffffff', opacity: floorO }} />
        </span>
        <Cue t={verdict} className="mt-2">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Mínimo por contrato · 20 %', 'Contract minimum · 20 %', lang)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: TONE.success }}>
              <Mark ok t={verdict} />
              {T('Cumplida', 'Met', lang)}
            </span>
          </span>
        </Cue>
        <Cue t={exits} className="mt-4">
          <span className="grid grid-cols-3 gap-2 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            {cells.map((c, i) => (
              <span key={c.en} className="block">
                <span className="block text-[17px] leading-none font-semibold" style={{ color: i === 2 ? TONE.success : 'rgba(255,255,255,0.9)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.n}
                </span>
                <span className="block mt-1.5 text-[9px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
                  {T(c.es, c.en, lang)}
                </span>
              </span>
            ))}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA CONCILIACIÓN — tres libros que tienen que cuadrar, casilla a casilla
   ══════════════════════════════════════════════════════════════════════ */

const RECON = [
  { slot: '1042', book: '12,400', xrpl: '12,400', flare: '12,400', ok: true },
  { slot: '1043', book: '3,150', xrpl: '3,150', flare: '3,150', ok: true },
  { slot: '1051', book: '3,000', xrpl: '3,000', flare: '—', ok: false },
];

export function ReconArtifact({ lang, active, compact, progress }: ExchArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [a, b] = STATION_BEATS.reconcile;
  const span = b - a;
  const head = useCue(progress, a, a + span * 0.12, live, 0);
  const foot = useCue(progress, a + span * 0.78, a + span * 0.92, live, RECON.length + 1);
  return (
    <div ref={ref}>
      <Plate title={T('Conciliación por casilla', 'Reconciliation per slot', lang)} note={T('09:15 UTC', '09:15 UTC', lang)} tone="print" enter={enter} live={live} compact={compact}>
        <Cue t={head}>
          <span className="grid grid-cols-[46px_1fr_1fr_1fr_66px] gap-x-2 text-[9px] font-mono uppercase tracking-[0.12em] pb-2" style={{ color: 'hsl(var(--ink) / 0.42)', borderBottom: `1px solid ${PLATE.rule}` }}>
            <span>{T('Casilla', 'Slot', lang)}</span>
            <span className="text-right">{T('Tu libro', 'Your book', lang)}</span>
            <span className="text-right">XRPL</span>
            <span className="text-right">Flare</span>
            <span className="text-right">{T('Estado', 'Status', lang)}</span>
          </span>
        </Cue>
        {RECON.map((r, i) => (
          <ReconRow key={r.slot} row={r} i={i} lang={lang} progress={progress} live={live} a={a} span={span} />
        ))}
        <Cue t={foot} className="mt-3">
          <span className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.45)' }}>
              {T('Tres libros, una pasada', 'Three books, one pass', lang)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: TONE.success }}>
              <Mark ok t={foot} />
              {T('0 descuadres', '0 mismatches', lang)}
            </span>
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function ReconRow({
  row,
  i,
  lang,
  progress,
  live,
  a,
  span,
}: {
  row: (typeof RECON)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  a: number;
  span: number;
}) {
  const t = useCue(progress, a + span * (0.15 + i * 0.18), a + span * (0.45 + i * 0.18), live, i + 1);
  return (
    <Cue t={t}>
      <span className="grid grid-cols-[46px_1fr_1fr_1fr_66px] gap-x-2 items-center py-[8px]" style={{ borderBottom: `1px solid ${PLATE.ruleSoft}`, fontVariantNumeric: 'tabular-nums' }}>
        <span className="text-[12px] text-white/85">{row.slot}</span>
        <span className="text-right text-[11px] font-mono text-white/75">{row.book}</span>
        <span className="text-right text-[11px] font-mono text-white/75">{row.xrpl}</span>
        <span className="text-right text-[11px] font-mono text-white/75">{row.flare}</span>
        <span className="flex items-center justify-end gap-1.5 text-[9.5px] font-mono uppercase tracking-[0.1em]" style={{ color: row.ok ? TONE.success : 'hsl(var(--tone-warning))' }}>
          <Mark ok={row.ok} t={t} />
          {row.ok ? T('Cuadra', 'Match', lang) : T('En vuelo', 'In flight', lang)}
        </span>
      </span>
    </Cue>
  );
}

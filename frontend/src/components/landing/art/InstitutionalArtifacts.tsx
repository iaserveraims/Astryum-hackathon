'use client';

/**
 * LOS ARTEFACTOS DEL MUNDO INSTITUCIONAL: la lámina, el tamiz y el registro.
 *
 * ── LO QUE CAMBIA EN ESTA PASADA ──────────────────
 * «Quiero que hagas otra pasada para dejar el comportamiento de los artefactos
 * flawless, no quiero que el tour siga pareciendo trabajo hecho con una tarde.»
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Figure, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import { BEATS, CLAUSES, clauseTiming } from './ValleyScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface InstArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  /** El progreso del recorrido. Con él, la lámina se lee en el MISMO tiempo que
   *  la escena; sin él (versión apilada), con un temporizador escalonado. */
  progress?: MotionValue<number>;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA LÁMINA — varias cuentas, una sola superficie
   ══════════════════════════════════════════════════════════════════════ */

const SEATS = [
  { es: 'Tesorería', en: 'Treasury', pct: 46, amount: '2,217,200', drop: 6 },
  { es: 'Operativa', en: 'Operating', pct: 31, amount: '1,494,200', drop: -5 },
  { es: 'Reserva', en: 'Reserve', pct: 23, amount: '1,108,600', drop: 7.5 },
];
const BAR_H = 44;
/** El hueco entre cuentas cuando todavía son tres cosas sueltas. */
const SPLIT = 7;

export function PoolArtifact({ lang, active, compact, progress }: InstArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [bStart, bEnd] = BEATS.basin;
  const span = bEnd - bStart;
  /** La convergencia ocupa los primeros dos tercios del tiempo de la cuenca: la
   *  lámina del panel se junta mientras el agua de la escena se junta. */
  const join = useCue(progress, bStart + span * 0.08, bStart + span * 0.72, live, 0);
  const grid = useTransform(join, [0.5, 0.82], [0, 1], { clamp: true });
  const weld = useTransform(join, [0.84, 0.95, 1], [0, 1, 0.3], { clamp: true });
  const surface = useTransform(join, [0.9, 1], [0, 1], { clamp: true });
  const figure = useCue(progress, bStart, bStart + span * 0.2, live, 0);

  let acc = 0;
  const segs = SEATS.map((s, i) => {
    const before = acc;
    acc += s.pct;
    return { ...s, before, i, ink: 0.85 - i * 0.22 };
  });

  return (
    <div ref={ref}>
      <Plate
        title={T('Capital de la entidad', 'Entity capital', lang)}
        note={T('3 cuentas', '3 accounts', lang)}
        tone="print"
        enter={enter}
        live={live}
        compact={compact}
      >
        <Cue t={figure}>
          <Figure currency="$" value="4,820,000" />
        </Cue>

        {/* LA CONVERGENCIA. `preserveAspectRatio="none"` para que los
            porcentajes sean aritmética directa, y `crispEdges` para que un
            filete siga midiendo un píxel de dispositivo. */}
        <svg viewBox={`0 0 100 ${BAR_H}`} preserveAspectRatio="none" className="mt-4 block w-full" style={{ height: BAR_H }} shapeRendering="crispEdges">
          {segs.map((s) => (
            <Seat key={s.en} seat={s} join={join} />
          ))}
          {/* la retícula, POR ENCIMA: detrás no se ve ni una, porque la barra
              está llena de lado a lado */}
          {[25, 50, 75].map((g) => (
            <motion.line
              key={g}
              x1={g}
              y1="0"
              x2={g}
              y2={BAR_H}
              stroke="hsl(var(--ink) / 0.14)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="2 3"
              style={{ opacity: grid }}
            />
          ))}
          {/* las juntas, que DESTELLAN al cerrarse: es el instante en que tres
              cosas pasan a ser una */}
          {segs.slice(1).map((s) => (
            <Weld key={`w${s.before}`} seat={s} join={join} flash={weld} />
          ))}
          {/* y el filete especular que recorre la barra ENTERA: la prueba de
              que ahora es una sola superficie */}
          <motion.line x1="0" y1="0.5" x2="100" y2="0.5" stroke="hsl(var(--volt-hi) / 0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ opacity: surface }} />
          <motion.line x1="0" y1={BAR_H - 0.5} x2="100" y2={BAR_H - 0.5} stroke="hsl(var(--ink) / 0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ opacity: grid }} />
        </svg>

        <div className="mt-4">
          {segs.map((s, i) => (
            <div key={s.en} className="py-[7px]" style={{ borderBottom: i < segs.length - 1 ? `1px solid ${PLATE.ruleSoft}` : undefined }}>
              <SeatRow seat={s} lang={lang} progress={progress} live={live} bStart={bStart} span={span} />
            </div>
          ))}
        </div>
      </Plate>
    </div>
  );
}

type Seg = (typeof SEATS)[number] & { before: number; i: number; ink: number };

/** Una cuenta. Empieza suelta —con su hueco y a su altura— y acaba encajada. */
function Seat({ seat, join }: { seat: Seg; join: MotionValue<number> }) {
  const x = useTransform(join, (t) => {
    const g = SPLIT * (1 - t);
    const avail = 100 - 2 * g;
    return (seat.before / 100) * avail + seat.i * g;
  });
  const w = useTransform(join, (t) => {
    const g = SPLIT * (1 - t);
    return (seat.pct / 100) * (100 - 2 * g);
  });
  const y = useTransform(join, (t) => seat.drop * (1 - t));
  const h = useTransform(join, (t) => BAR_H - 10 * (1 - t));
  return <motion.rect x={x} y={y} width={w} height={h} fill={`hsl(var(--volt) / ${seat.ink})`} />;
}

function Weld({ seat, join, flash }: { seat: Seg; join: MotionValue<number>; flash: MotionValue<number> }) {
  const x = useTransform(join, (t) => {
    const g = SPLIT * (1 - t);
    const avail = 100 - 2 * g;
    return (seat.before / 100) * avail + seat.i * g;
  });
  return (
    <>
      <motion.line x1={x} y1="0" x2={x} y2={BAR_H} stroke="hsl(var(--ink) / 0.22)" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ opacity: join }} />
      <motion.line x1={x} y1="0" x2={x} y2={BAR_H} stroke="hsl(var(--volt-hi))" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ opacity: flash }} />
    </>
  );
}

function SeatRow({
  seat,
  lang,
  progress,
  live,
  bStart,
  span,
}: {
  seat: Seg;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  bStart: number;
  span: number;
}) {
  // LA MISMA REGLA DE FASE QUE LA ESCENA. Antes la tercera fila resolvía en
  // 0,383 y el texto de la parada empieza a irse en 0,378: medido en captura,
  // «Reserve» se veía a medio subir dentro de su ranura y parecía una lámina
  // cortada. No estaba cortada — estaba todavía llegando, con el lector ya
  // mirando otra cosa. Las tres filas terminan ahora en el 66 % del tramo.
  const t = useCue(progress, bStart + span * (0.30 + seat.i * 0.1), bStart + span * (0.46 + seat.i * 0.1), live, seat.i + 1);
  return (
    <Cue t={t}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-[8px] h-[8px] shrink-0" style={{ background: `hsl(var(--volt) / ${seat.ink})` }} />
          <span className="text-[12px] text-white/70 truncate">{T(seat.es, seat.en, lang)}</span>
        </span>
        <span className="flex items-baseline gap-2.5 shrink-0">
          <span className="text-[12px] text-white/75" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ opacity: 0.5 }}>$</span>
            {seat.amount}
          </span>
          <span className="text-[10.5px] text-white/35" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {seat.pct}%
          </span>
        </span>
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL TAMIZ — cada fila resuelve con su gota
   ══════════════════════════════════════════════════════════════════════ */

export function FilterArtifact({ lang, active, compact, progress }: InstArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const last = clauseTiming(CLAUSES.length - 1);
  const foot = useCue(progress, last.land + last.step * 0.2, last.land + last.step * 0.6, live, CLAUSES.length);
  return (
    <div ref={ref}>
      <Plate
        title={T('Política', 'Policy', lang)}
        note={<Pips progress={progress} live={live} />}
        tone="print"
        enter={enter}
        live={live}
        compact={compact}
      >
        <ul className="m-0 p-0 list-none">
          {/* LAS MISMAS SEIS que caen como gotas en la escena, con el MISMO
              calendario. Si el lector cuenta seis gotas y lee cinco reglas, uno
              de los dos miente; y si la sexta se marca dos segundos después de
              caer su gota, las dos cosas dejan de ser el mismo suceso. */}
          {CLAUSES.map((c, i) => (
            <li key={c.id} className="py-[7px]" style={{ borderBottom: i < CLAUSES.length - 1 ? `1px solid ${PLATE.ruleSoft}` : undefined }}>
              <ClauseRow clause={c} i={i} lang={lang} progress={progress} live={live} />
            </li>
          ))}
        </ul>
        <Cue t={foot} className="mt-4">
          <span
            className="block pt-3 text-[10px] font-mono uppercase tracking-[0.18em]"
            style={{ borderTop: `1px solid ${PLATE.ruleSoft}`, color: 'hsl(var(--ink) / 0.45)' }}
          >
            {T('Lo que no pasa, no entra', 'What fails does not enter', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

/** El recuento de la cabecera, sin una sola cifra: seis puntos que se van
 *  marcando. Una escala con números en una página pública es un dato, y un dato
 *  sin fuente no se pinta. */
function Pips({ progress, live }: { progress?: MotionValue<number>; live: boolean }) {
  return (
    <span className="flex items-center gap-[5px]">
      {CLAUSES.map((c, i) => (
        <Pip key={c.id} i={i} pass={c.pass} progress={progress} live={live} />
      ))}
    </span>
  );
}

function Pip({ i, pass, progress, live }: { i: number; pass: boolean; progress?: MotionValue<number>; live: boolean }) {
  const { land, step } = clauseTiming(i);
  const t = useCue(progress, land, land + step * 0.3, live, i);
  const o = useTransform(t, [0, 1], [0.16, 1]);
  const sc = useTransform(t, [0, 0.6, 1], [0.7, 1.25, 1]);
  return (
    <motion.span
      className="block w-[6px] h-[6px]"
      style={{
        opacity: o,
        scale: sc,
        borderRadius: 1,
        background: pass ? 'hsl(var(--volt))' : 'transparent',
        border: pass ? 'none' : `1px solid ${TONE.danger}`,
      }}
    />
  );
}

function ClauseRow({
  clause,
  i,
  lang,
  progress,
  live,
}: {
  clause: (typeof CLAUSES)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
}) {
  const { at, land, step } = clauseTiming(i);
  /** La fila LLEGA cuando sale la gota. */
  const arrive = useCue(progress, at, at + step * 0.3, live, i);
  /** Y RESUELVE cuando la gota toca el agua. */
  const settle = useCue(progress, land, land + step * 0.34, live, i);
  /** El destello del veredicto: un parpadeo, no un estado. */
  const flash = useTransform(settle, [0, 0.25, 0.75], [0, 1, 0], { clamp: true });
  const rule = useTransform(settle, [0.1, 0.55], [0, 1], { clamp: true });
  const why = useTransform(settle, [0.45, 0.8], [0, 1], { clamp: true });
  const whyScale = useTransform(settle, [0.45, 0.72, 0.85], [0.8, 1.06, 1], { clamp: true });
  const dim = useTransform(settle, [0, 1], [1, clause.pass ? 1 : 0.68], { clamp: true });

  return (
    <Cue t={arrive}>
      <span className="relative flex items-start gap-3">
        {/* el destello del veredicto, detrás de la fila */}
        <motion.span
          aria-hidden
          className="absolute -inset-x-2 -inset-y-[3px] pointer-events-none"
          style={{ opacity: flash, background: 'hsl(var(--volt) / 0.1)', borderRadius: 2 }}
        />
        <span className="relative mt-[1px]">
          <Mark ok={clause.pass} t={settle} />
        </span>
        <motion.span className="relative min-w-0 flex-1" style={{ opacity: dim }}>
          <span className="relative block">
            {/* el filete de la denegada se PINTA de arriba abajo */}
            {!clause.pass && (
              <motion.span
                className="absolute left-0 top-0 bottom-0 w-[2px] origin-top"
                style={{ background: TONE.danger, scaleY: rule }}
              />
            )}
            <span
              className="block text-[12.5px] leading-tight"
              style={clause.pass ? { color: 'rgba(255,255,255,0.88)' } : { color: 'hsl(var(--ink) / 0.6)', paddingLeft: 9 }}
            >
              {T(clause.es, clause.en, lang)}
            </span>
            <span className="block text-[11px] leading-tight mt-[3px]" style={{ color: 'hsl(var(--ink) / 0.42)', paddingLeft: clause.pass ? 0 : 9 }}>
              {T(clause.esNote, clause.enNote, lang)}
            </span>
          </span>
        </motion.span>
        {clause.esWhy && (
          <motion.span
            className="relative shrink-0 mt-[2px] text-[9.5px] font-mono uppercase tracking-[0.14em] px-1.5 py-[2px]"
            style={{ color: TONE.danger, border: `1px solid ${TONE.danger}`, borderRadius: 2, opacity: why, scale: whyScale }}
          >
            {T(clause.esWhy, clause.enWhy ?? clause.esWhy, lang)}
          </motion.span>
        )}
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL REGISTRO — el barrido es el cabezal de escritura
   ══════════════════════════════════════════════════════════════════════ */

const ENTRIES = [
  { es: 'Entrada firmada', en: 'Entry signed', h: 'a41f…9c2' },
  { es: 'Política aplicada', en: 'Policy applied', h: '7de0…14b' },
  { es: 'Salida solicitada', en: 'Exit requested', h: 'c082…5fa' },
];

export function RecordArtifact({ lang, active, compact, progress }: InstArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const [vStart, vEnd] = BEATS.valley;
  const span = vEnd - vStart;
  /** EL CABEZAL. Baja UNA vez y escribe lo que cruza. Antes era un brillo en
   *  bucle que además recorría setenta píxeles de una lista de noventa y tres y
   *  se moría a la vista antes de la última fila. */
  // El cabezal de escritura acaba en el 62 % del tramo y no en el 78 %: lo que
  // se lee después es el asiento COMPLETO con su frase delante, que es de lo
  // que va la parada. Terminar en el 78 % dejaba una centésima de holgura antes
  // de que el texto empezara a irse.
  const head = useCue(progress, vStart + span * 0.05, vStart + span * 0.62, live, 0);
  const headY = useTransform(head, [0, 1], ['-14%', '104%']);
  const headO = useTransform(head, [0, 0.06, 0.9, 1], [0, 1, 1, 0]);
  const foot = useCue(progress, vStart + span * 0.62, vStart + span * 0.74, live, 3);

  return (
    <div ref={ref}>
      <Plate title={T('Registro', 'Record', lang)} tone="print" enter={enter} live={live} compact={compact}>
        <div className="relative">
          {progress && (
            <motion.span
              aria-hidden
              className="absolute inset-x-0 h-[18px] pointer-events-none z-10"
              style={{
                top: headY,
                opacity: headO,
                background: 'linear-gradient(180deg, transparent, hsl(var(--volt) / 0.18), transparent)',
              }}
            />
          )}
          <ul className="space-y-0 m-0 p-0 list-none relative">
            {ENTRIES.map((e, i) => (
              <li key={e.h} style={{ borderBottom: `1px solid ${PLATE.ruleSoft}` }}>
                <EntryRow entry={e} i={i} lang={lang} progress={progress} live={live} vStart={vStart} span={span} />
              </li>
            ))}
          </ul>
        </div>
        <Cue t={foot} className="mt-4">
          <span className="block text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: 'hsl(var(--volt-soft) / 0.8)' }}>
            {T('Comprobable, no prometido', 'Verifiable, not promised', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function EntryRow({
  entry,
  i,
  lang,
  progress,
  live,
  vStart,
  span,
}: {
  entry: (typeof ENTRIES)[number];
  i: number;
  lang: Lang;
  progress?: MotionValue<number>;
  live: boolean;
  vStart: number;
  span: number;
}) {
  // el cabezal cruza esta fila aquí: la fila se escribe en ESE instante
  const a = vStart + span * (0.1 + i * 0.22);
  const t = useCue(progress, a, a + span * 0.2, live, i);
  const clip = useTransform(t, [0.3, 0.85], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']);
  const sealO = useTransform(t, [0.7, 0.92], [0, 1], { clamp: true });
  const sealS = useTransform(t, [0.7, 0.86, 1], [0.4, 1.35, 1], { clamp: true });
  return (
    <Cue t={t} className="py-[9px]">
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 min-w-0">
          <motion.span
            className="w-[6px] h-[6px] shrink-0"
            style={{ background: i === 0 ? 'hsl(var(--volt))' : 'hsl(var(--ink) / 0.24)', opacity: sealO, scale: sealS }}
          />
          <span className="text-[12px] text-white/72 truncate">{T(entry.es, entry.en, lang)}</span>
        </span>
        {/* el sello se ESCRIBE de izquierda a derecha, como sale de la máquina */}
        <motion.span className="font-mono text-[10.5px] text-white/35 tabular-nums shrink-0" style={{ clipPath: clip }}>
          {entry.h}
        </motion.span>
      </span>
    </Cue>
  );
}

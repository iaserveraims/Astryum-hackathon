'use client';

/**
 * LOS ARTEFACTOS DEL MUNDO LEGACY: el consejo, la constitución, el quórum y el
 * relevo.
 *
 * ── LO QUE CAMBIA EN ESTA PASADA ─────────────────────────────────────────
 * Eran CAPTURAS CON CORTINILLA. Se montaban con una animación de entrada de una
 * sola pasada y se quedaban quietas: medido en captura, a 0,42 y a 0,90 las
 * láminas del consejo y del relevo ya estaban resueltas ANTES de que el lector
 * llegase a su parada. Un panel así no forma parte del recorrido; está pegado
 * encima de él. Las tres del institucional ya recibían `progress` y estas
 * cuatro no.
 *
 * Ahora las cuatro SE LEEN CON EL SCROLL, y cada fila resuelve en el MISMO
 * fotograma en que la escena hace lo que esa fila dice, porque las dos leen la
 * misma tabla (`councilTiming`, `constitutionTiming`, `quorumTiming`,
 * `STRIKE_MOMENT`, `handoverTiming`, en ThresholdScene):
 *
 *   · EL CONSEJO: cada asiento se marca cuando se COLOCA su dovela, y el
 *     recuento de la cabecera va detrás. Los que no firman no se apagan: laten.
 *   · LA CONSTITUCIÓN: las cuatro cláusulas se escriben mientras entra la clave
 *     —que es literalmente lo que la clave significa— y la firma se traza al
 *     final, con la clave ya asentada.
 *   · EL QUÓRUM: las celdas se llenan mientras se descimbra, y el UMBRAL se
 *     clava en el instante exacto en que la cimbra deja de estar. La lámina
 *     dice «ninguna firma sola» en el fotograma en que el arco se queda solo.
 *   · EL RELEVO: la columna «cambia» ENTRA moviéndose y la columna «no cambia»
 *     no se mueve ni un píxel, mientras la vasija cruza el tablero.
 *
 * Y al subir con la rueda todo se deshace igual de bien, porque el estado sale
 * del progreso y no de un temporizador disfrazado de `delay`.
 *
 * ── EL MATERIAL, A MEDIO CAMINO ──────────────────────────────────────────
 * Personal redondea a 14 px y flota; Institucional va a 3 y se imprime. Legacy
 * vive entre los dos mundos y su lámina lo dice: 8 px. Es el único sitio de la
 * portada donde el material TIENE que leerse como intermedio, porque eso es
 * literalmente lo que cuenta el producto.
 *
 * Reglas: nada crece, ninguna cifra de rendimiento, y el quórum, los pesos y la
 * clave maestra deshabilitada son MECANISMO de la jaula, no resultado.
 */

import { motion, useTransform, type MotionValue } from 'framer-motion';
import { Cue, Mark, Plate, TONE, useCue, useSelfActive } from './plateStyle';
import { PLATE } from './craft';
import {
  COUNCIL_SEATS,
  QUORUM,
  STRIKE_MOMENT,
  constitutionTiming,
  councilTiming,
  handoverTiming,
  quorumTiming,
} from './ThresholdScene';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

export interface LegacyArtifactProps {
  lang: Lang;
  active?: boolean;
  compact?: boolean;
  /** El progreso del recorrido. Con él, la lámina se lee en el MISMO tiempo que
   *  la escena; sin él (versión apilada), con un temporizador escalonado. */
  progress?: MotionValue<number>;
}

/** Quiénes firman en el ejemplo. La lista vive en la ESCENA, que es donde las
 *  cinco péndolas del puente la leen para colgarse: si el dibujo dice cinco y la
 *  lámina dice tres, el lector se queda con que uno de los dos miente. */
const SEATS = COUNCIL_SEATS;

/* ═══════════════════════════════════════════════════════════════════════
   EL CONSEJO — cinco asientos, tres firmas
   ══════════════════════════════════════════════════════════════════════ */

/**
 * JourneyArtifacts trae una viñeta del consejo y el viaje solar la monta en su
 * cuarta parada, pero dice «2 / 3» y este mundo cuenta «tres de cinco» en la
 * escena, en el pie, en el quórum y en la constitución. Un número que no cuadra
 * con el dibujo que el lector tiene delante cuesta más que una viñeta repetida.
 * Los pesos y la clave maestra NO se repiten aquí: viven en la constitución,
 * que es donde se escriben. El consejo dice QUIÉN.
 */
export function CouncilArtifact({ lang, active, compact, progress }: LegacyArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const signed = SEATS.filter(Boolean).length;
  return (
    <div ref={ref}>
      <Plate
        title={T('El consejo', 'The council', lang)}
        note={`${signed} / ${SEATS.length} · ${T('quórum', 'quorum', lang)}`}
        tone="between"
        enter={enter}
        live={live}
        compact={compact}
      >
        <span className="flex items-center gap-2">
          {SEATS.map((ok, i) => (
            <Seat key={i} ok={ok} i={i} live={live} progress={progress} />
          ))}
          <span className="flex-1 h-px" style={{ background: PLATE.ruleSoft }} />
        </span>
        <CouncilNote lang={lang} live={live} progress={progress} />
      </Plate>
    </div>
  );
}

/** UN ASIENTO. El anillo se abre, y si esa persona firma su tic se DIBUJA —no
 *  aparece— justo cuando su dovela toca el lecho. Un veredicto que se enciende
 *  de golpe no se ha tomado: estaba ahí. */
function Seat({ ok, i, live, progress }: { ok: boolean; i: number; live: boolean; progress?: MotionValue<number> }) {
  const [a, b] = councilTiming(i);
  const t = useCue(progress, a, b, live, i);
  const ring = useTransform(t, [0, 0.3], [0.28, 1], { clamp: true });
  const pop = useTransform(t, [0, 0.3, 0.55], [0.84, 1.1, 1], { clamp: true });
  const draw = useTransform(t, [0.25, 0.75], [1, 0], { clamp: true });
  return (
    <motion.span
      className="w-[26px] h-[26px] rounded-full shrink-0 grid place-items-center"
      style={{
        border: `1px solid ${ok ? 'hsl(var(--volt) / 0.8)' : 'hsl(var(--ink) / 0.18)'}`,
        background: ok ? 'hsl(var(--volt) / 0.15)' : 'hsl(var(--ink) / 0.03)',
        opacity: ring,
        scale: pop,
      }}
    >
      {ok ? (
        <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
          <motion.path
            d="M3 6.7l2 2L10 4.4"
            stroke="hsl(var(--volt-hi))"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: draw }}
          />
        </svg>
      ) : (
        <span className="lg-anim lg-breathe w-1.5 h-1.5 rounded-full" style={{ background: 'hsl(var(--ink) / 0.3)' }} />
      )}
    </motion.span>
  );
}

function CouncilNote({ lang, live, progress }: { lang: Lang; live: boolean; progress?: MotionValue<number> }) {
  const [, b] = councilTiming(SEATS.length - 1);
  const t = useCue(progress, b - 0.012, b + 0.03, live, SEATS.length);
  return (
    <Cue t={t} className="mt-3.5">
      <span
        className="block text-[11px] leading-snug"
        style={{ color: 'hsl(var(--ink) / 0.5)', borderTop: `1px solid ${PLATE.ruleSoft}`, paddingTop: 12 }}
      >
        {T('Tú propones. El consejo firma. Nadie firma por ti.', 'You propose. The council signs. Nobody signs for you.', lang)}
      </span>
    </Cue>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA CONSTITUCIÓN — lo que el consejo puede hacer, escrito ANTES
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Es el equivalente del tamiz institucional, pero aquí la regla no filtra
 * dinero: acota poder. Por eso la última fila va sola y lleva su firma
 * dibujándose, y por eso la cláusula de la clave maestra lleva marca: es la
 * única de las cuatro que dice que algo NO puede pasar.
 */
export function ConstitutionArtifact({ lang, active, compact, progress }: LegacyArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const rules = [
    { k: T('Quién firma', 'Who signs', lang), v: T('El consejo', 'The council', lang), mark: false },
    { k: T('Cuántos', 'How many', lang), v: `${QUORUM} ${T('de', 'of', lang)} ${SEATS.length}`, mark: false },
    { k: T('Pesos', 'Weights', lang), v: SEATS.map(() => '1').join(' · '), mark: false },
    { k: T('Clave maestra', 'Master key', lang), v: T('Deshabilitada', 'Disabled', lang), mark: true },
  ];
  return (
    <div ref={ref}>
      <Plate title={T('La constitución', 'The constitution', lang)} tone="between" enter={enter} live={live} compact={compact}>
        <ul className="m-0 p-0 list-none space-y-[9px]">
          {rules.map((r, i) => (
            <li key={r.k}>
              <Clause i={i} n={rules.length} live={live} progress={progress} rule={r} />
            </li>
          ))}
        </ul>
        <Signature lang={lang} live={live} progress={progress} n={rules.length} />
      </Plate>
    </div>
  );
}

function Clause({
  i,
  n,
  live,
  progress,
  rule,
}: {
  i: number;
  n: number;
  live: boolean;
  progress?: MotionValue<number>;
  rule: { k: string; v: string; mark: boolean };
}) {
  const [a, b] = constitutionTiming(i, n);
  const t = useCue(progress, a, b, live, i);
  // el destello de resolverse: un pelo de luz que pasa y se va
  const flash = useTransform(t, [0.42, 0.56, 0.86], [0, 0.5, 0], { clamp: true });
  const markT = useTransform(t, [0.4, 1], [0, 1], { clamp: true });
  return (
    <Cue t={t} className="relative">
      <span className="flex items-baseline justify-between gap-3">
        <motion.span
          aria-hidden
          className="absolute inset-x-0 -inset-y-[3px] pointer-events-none"
          style={{ background: 'hsl(var(--volt) / 0.16)', opacity: flash }}
        />
        <span className="relative text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--ink) / 0.35)' }}>
          {rule.k}
        </span>
        <span className="relative flex items-center gap-1.5 shrink-0">
          {rule.mark && <Mark ok t={markT} />}
          <span
            className="text-[11.5px]"
            style={{ fontVariantNumeric: 'tabular-nums', color: rule.mark ? TONE.success : 'rgba(255,255,255,0.74)' }}
          >
            {rule.v}
          </span>
        </span>
      </span>
    </Cue>
  );
}

/** La constitución se FIRMA, no se declara: el trazo se dibuja con el desfase
 *  del guion, nunca animando su longitud — `strokeDasharray: "0 x"` no es
 *  «línea continua», es «ninguna raya». */
function Signature({ lang, live, progress, n }: { lang: Lang; live: boolean; progress?: MotionValue<number>; n: number }) {
  const [, b] = constitutionTiming(n - 1, n);
  const t = useCue(progress, b - 0.02, b + 0.035, live, n);
  const draw = useTransform(t, [0.1, 0.95], [1, 0], { clamp: true });
  return (
    <div className="mt-3.5 pt-3" style={{ borderTop: `1px solid ${PLATE.ruleSoft}` }}>
      <Cue t={t}>
        <span className="flex items-center gap-2.5">
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none" className="shrink-0">
            <motion.path
              d="M1 9 C4 1 6 11 9 6 C11 2.5 14 4 17 3"
              stroke="hsl(var(--volt))"
              strokeWidth="1.3"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1 1"
              style={{ strokeDashoffset: draw }}
            />
          </svg>
          <span className="text-[11px] leading-snug" style={{ color: 'hsl(var(--ink) / 0.5)' }}>
            {T('Fuera de lo escrito, nadie puede.', 'Outside what is written, nobody can.', lang)}
          </span>
        </span>
      </Cue>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL QUÓRUM — tres firmas de cinco asientos
   ══════════════════════════════════════════════════════════════════════ */

/**
 * El umbral se dibuja como una MARCA sobre la barra y no como una meta que se
 * alcanza: no es progreso hacia un premio, es la línea por debajo de la cual no
 * se puede actuar. Y su abscisa sale de los DATOS —del número de asientos y del
 * quórum—, no de un `left: 50%` escrito a mano que mentiría en cuanto alguien
 * cambiara la lista.
 *
 * El umbral se clava en `STRIKE_MOMENT`: el fotograma en que la cimbra deja de
 * estar y el arco se queda solo. Esa coincidencia ES el argumento.
 */
export function QuorumArtifact({ lang, active, compact, progress }: LegacyArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const n = SEATS.length;
  const signed = SEATS.filter(Boolean).length;
  // El centro de la celda que hace de umbral, en porcentaje del ancho.
  const thresholdPct = ((QUORUM - 0.5) / n) * 100;
  const mark = useCue(progress, STRIKE_MOMENT[0], STRIKE_MOMENT[1], live, n);
  const tick = useTransform(mark, [0, 0.55], [0, 1], { clamp: true });
  const label = useTransform(mark, [0.35, 1], [0, 1], { clamp: true });
  const note = useCue(progress, STRIKE_MOMENT[1] - 0.005, STRIKE_MOMENT[1] + 0.035, live, n + 1);
  return (
    <div ref={ref}>
      <Plate title={T('El quórum', 'The quorum', lang)} note={`${signed} / ${n}`} tone="between" enter={enter} live={live} compact={compact}>
        <span className="flex items-center gap-2">
          {SEATS.map((s, i) => (
            <Cell key={i} on={s} i={i} n={n} live={live} progress={progress} />
          ))}
        </span>
        <div className="relative mt-2 h-[16px]">
          <motion.span
            className="absolute top-0 h-[7px] w-px origin-top"
            style={{ left: `${thresholdPct}%`, background: 'hsl(var(--volt-hi) / 0.8)', scaleY: tick }}
          />
          <motion.span
            className="absolute top-[7px] -translate-x-1/2 text-[9px] font-mono uppercase tracking-[0.16em] whitespace-nowrap"
            style={{ left: `${thresholdPct}%`, color: 'hsl(var(--volt-soft) / 0.8)', opacity: label }}
          >
            {T('umbral', 'threshold', lang)}
          </motion.span>
        </div>
        <Cue t={note} className="mt-4">
          <span className="block text-[11px] leading-snug" style={{ color: 'hsl(var(--ink) / 0.5)' }}>
            {T(
              'Por debajo del umbral no se puede actuar. Ninguna firma sola, tampoco la tuya.',
              'Below the threshold nothing can act. No signature alone, not even yours.',
              lang,
            )}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function Cell({ on, i, n, live, progress }: { on: boolean; i: number; n: number; live: boolean; progress?: MotionValue<number> }) {
  const [a, b] = quorumTiming(i, n);
  const t = useCue(progress, a, b, live, i);
  const fill = useTransform(t, [0.15, 0.7], [0, 1], { clamp: true });
  const bar = useTransform(t, [0.3, 0.85], [0, 1], { clamp: true });
  return (
    <span
      className="relative flex-1 h-[26px] grid place-items-center overflow-hidden"
      style={{ border: `1px solid ${on ? 'hsl(var(--volt) / 0.75)' : 'hsl(var(--ink) / 0.14)'}`, borderRadius: 4 }}
    >
      {on ? (
        <>
          <motion.span className="absolute inset-0 origin-bottom" style={{ background: 'hsl(var(--volt) / 0.14)', scaleY: fill }} />
          <motion.span className="relative block w-[11px] h-px origin-left" style={{ background: 'hsl(var(--volt-hi))', scaleX: bar }} />
        </>
      ) : (
        <span className="lg-anim lg-breathe block w-[3px] h-[3px] rounded-full" style={{ background: 'hsl(var(--ink) / 0.3)' }} />
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL RELEVO — la tabla que resume el producto entero en dos columnas
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Es la viñeta más importante de este mundo porque contesta la única pregunta
 * que un lector se hace de verdad: qué me cambia cuando esto se active. Y la
 * entrada lo dice físicamente — la columna «cambia» ENTRA desplazándose y la
 * columna «no cambia» no se mueve ni un píxel.
 */
export function HandoverArtifact({ lang, active, compact, progress }: LegacyArtifactProps) {
  const { ref, live, enter } = useSelfActive(active);
  const pairs = [
    { moves: T('Quién firma', 'Who signs', lang), anchored: T('El contenido', 'The contents', lang) },
    { moves: T('Quién puede pedir la salida', 'Who can request the exit', lang), anchored: T('Las reglas escritas', 'The written rules', lang) },
    { moves: '', anchored: T('La salida, que nadie puede cerrar', 'The exit, which nobody can close', lang) },
  ];
  const foot = useCue(progress, handoverTiming(pairs.length - 1)[1] - 0.01, handoverTiming(pairs.length - 1)[1] + 0.03, live, pairs.length);
  return (
    <div ref={ref}>
      <Plate title={T('El relevo', 'The handover', lang)} tone="between" enter={enter} live={live} compact={compact}>
        <div className="grid grid-cols-2 gap-x-4 pb-2" style={{ borderBottom: `1px solid ${PLATE.rule}` }}>
          <span className="text-[9.5px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--volt-soft) / 0.8)' }}>
            {T('Cambia', 'Changes', lang)}
          </span>
          <span className="text-[9.5px] font-mono uppercase tracking-[0.16em]" style={{ color: 'hsl(var(--ink) / 0.3)' }}>
            {T('No cambia', 'Stays', lang)}
          </span>
        </div>
        {pairs.map((p, i) => (
          <HandoverRow key={p.anchored} pair={p} i={i} n={pairs.length} last={i === pairs.length - 1} live={live} progress={progress} />
        ))}
        <Cue t={foot} className="mt-3.5">
          <span
            className="block pt-3 text-[9.5px] font-mono uppercase tracking-[0.18em]"
            style={{ borderTop: `1px solid ${PLATE.rule}`, color: 'hsl(var(--volt-soft) / 0.75)' }}
          >
            {T('Lo que cruza, cruza entero', 'What crosses, crosses whole', lang)}
          </span>
        </Cue>
      </Plate>
    </div>
  );
}

function HandoverRow({
  pair,
  i,
  n,
  last,
  live,
  progress,
}: {
  pair: { moves: string; anchored: string };
  i: number;
  n: number;
  last: boolean;
  live: boolean;
  progress?: MotionValue<number>;
}) {
  const [a, b] = handoverTiming(i, n);
  const t = useCue(progress, a, b, live, i);
  // lo que se mueve, entra MOVIÉNDOSE; lo anclado solo aparece. La diferencia
  // entre las dos columnas es el argumento de la lámina, así que se ejecuta.
  const x = useTransform(t, [0, 0.55], [-8, 0], { clamp: true });
  const o = useTransform(t, [0, 0.45], [0, 1], { clamp: true });
  const oStill = useTransform(t, [0.1, 0.7], [0, 1], { clamp: true });
  return (
    <div className="grid grid-cols-2 gap-x-4 py-[7px]" style={{ borderBottom: last ? undefined : `1px solid ${PLATE.ruleSoft}` }}>
      <motion.span className="flex items-start gap-1.5 text-[11px] leading-snug text-white/72" style={{ x, opacity: o }}>
        {pair.moves && (
          <>
            <svg width="6" height="8" viewBox="0 0 6 8" className="mt-[4px] shrink-0">
              <path d="M1 1l3.5 3L1 7" fill="none" stroke="hsl(var(--volt))" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {pair.moves}
          </>
        )}
      </motion.span>
      <motion.span className="flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: 'hsl(var(--ink) / 0.5)', opacity: oStill }}>
        <span className="mt-[5px] w-[5px] h-[5px] shrink-0" style={{ background: 'hsl(var(--ink) / 0.35)' }} />
        {pair.anchored}
      </motion.span>
    </div>
  );
}

/** Se mantiene exportado para que nadie tenga que adivinar de dónde sale el
 *  semáforo si añade una lámina nueva. */
export { Mark };

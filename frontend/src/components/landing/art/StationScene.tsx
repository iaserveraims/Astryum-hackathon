'use client';

/**
 * LA ESTACIÓN — la escena del mundo Exchange.
 *
 * Un anillo de atraque visto desde arriba: el ómnibus en el centro con su
 * llave, un muelle por cliente en el anillo —lleno si su casilla tiene KYC,
 * hueco si no lo tiene—, y el pote en Flare acoplado por un tubo por el que
 * cruzan las acuñaciones. Platino frío, denso, sin brillo: la sobriedad de un
 * panel de operaciones, que es lo que un exchange mira.
 *
 * Se lee con el scroll y sus láminas (ExchangeArtifacts) se atan a los MISMOS
 * tiempos: los muelles se ocupan mientras se leen las casillas, las motas
 * cruzan el tubo mientras se lee el flujo, el arco de la reserva se cierra
 * mientras se lee la reserva y las marcas de conciliación se dibujan mientras
 * se lee la conciliación.
 *
 * Decorativa (`aria-hidden`). Las cantidades son maqueta y se rotulan así en
 * las láminas; aquí no hay ni una cifra de rendimiento.
 */

import { memo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import { SCENE_MONO, arc, polar, slot, useBeat, useSource } from './sceneKit';

type Lang = 'es' | 'en';

/* ── El reparto del scroll: UNA tabla, la lee también ExchangeJourney ──── */
export const STATION_BEATS = {
  hub: [0.0, 0.1],
  bays: [0.1, 0.3],
  flow: [0.3, 0.48],
  reserve: [0.48, 0.64],
  reconcile: [0.64, 0.86],
  close: [0.86, 1.0],
} as const;

const W = 1200;
const H = 700;
const CX = 700;
const CY = 350;
const RING = 200;
const HUB = 58;
const BAY_R = 226;
const BAYS = 24;
/** El entidad Flare, en su rosa fijo: nunca se re-tiñe con el producto. */
const FLR = '#EC4899';
const FLR_SOFT = '#F4A8CE';
const POD_X = 1058;
const POD_R = 56;

/** Qué muelle es qué. Maqueta: diecinueve con credencial, tres a la espera, dos sin ella. */
function bayKind(i: number): 'kyc' | 'pending' | 'none' {
  if (i === 8 || i === 20) return 'none';
  if (i % 6 === 4) return 'pending';
  return 'kyc';
}

/** Los tres muelles que la conciliación comprueba: dos cuadran, uno está en vuelo. */
const CHECKS = [
  { bay: 21, ok: true },
  { bay: 22, ok: true },
  { bay: 2, ok: false },
] as const;

export interface StationSceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  level: MotionLevel;
  still?: boolean;
}

function StationSceneImpl({ progress, lang, level, still = false }: StationSceneProps) {
  const src = useSource(progress, still);
  const hub = useBeat(src, STATION_BEATS.hub);
  const bays = useBeat(src, STATION_BEATS.bays);
  const flow = useBeat(src, STATION_BEATS.flow);
  const reserve = useBeat(src, STATION_BEATS.reserve);
  const reconcile = useBeat(src, STATION_BEATS.reconcile);
  const close = useBeat(src, STATION_BEATS.close);

  // EN REPOSO LA ESTACIÓN ESTÁ ENTERA (fundador 2026-09-20): hub, anillo,
  // muelles, tubo y pote se ven al abrir; cada parada añade su capa.
  const hubO = useTransform(hub, [0.1, 0.8], [0.6, 1], { clamp: true });
  const hubLbl = useTransform(hub, [0.6, 1], [0.7, 1], { clamp: true });
  const spokesO = useTransform(hub, [0.5, 1], [0.2, 0.45], { clamp: true });
  const ringO = useTransform(bays, [0, 0.45], [0.55, 1], { clamp: true });
  const innerO = useTransform(bays, [0.2, 0.5], [0.15, 0.4], { clamp: true });
  const tubeO = useTransform(flow, [0, 0.25], [0.35, 1], { clamp: true });
  const podO = useTransform(flow, [0.1, 0.45], [0.45, 1], { clamp: true });
  const podLbl = useTransform(flow, [0.4, 0.6], [0.5, 1], { clamp: true });
  const flowLbl = useTransform(flow, [0.7, 0.95], [0, 1], { clamp: true });
  // la reserva: el 22 % del anillo interior, con su mínimo marcado al 20 %
  const reserveLen = useTransform(reserve, [0.1, 0.8], [0, 1], { clamp: true });
  const reserveLbl = useTransform(reserve, [0.5, 0.9], [0, 1], { clamp: true });
  const floorO = useTransform(reserve, [0.75, 0.95], [0, 1], { clamp: true });
  const reconLbl = useTransform(reconcile, [0.75, 0.95], [0, 1], { clamp: true });
  const scale = useTransform(close, [0, 1], [1, still ? 1 : 0.8]);
  const fade = useTransform(close, [0, 1], [1, still ? 1 : 0.5]);

  const spin = level === 'full' && !still;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden fill="none">
      <motion.g style={{ scale, opacity: fade, transformOrigin: `${CX}px ${CY}px` }}>
        {/* los radios, del núcleo al anillo */}
        <motion.g style={{ opacity: spokesO }}>
          {Array.from({ length: 6 }, (_, i) => {
            const [x0, y0] = polar(CX, CY, HUB, i * 60);
            const [x1, y1] = polar(CX, CY, RING - 12, i * 60);
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="hsl(var(--volt))" strokeWidth="1" />;
          })}
        </motion.g>

        {/* el anillo doble y el anillo interior de la reserva */}
        <motion.circle cx={CX} cy={CY} r={RING} stroke="hsl(var(--volt) / 0.9)" strokeWidth="1.2" style={{ opacity: ringO }} />
        <motion.circle cx={CX} cy={CY} r={RING - 12} stroke="hsl(var(--volt) / 0.45)" strokeWidth="1" style={{ opacity: ringO }} />
        <motion.circle cx={CX} cy={CY} r={RING - 46} stroke="hsl(var(--volt))" strokeWidth="1" strokeDasharray="2 5" style={{ opacity: innerO }} />

        {/* LOS MUELLES, uno por cliente. Giran lentísimo cuando la página está
            viva: una estación orbita, no cuelga quieta. Las marcas de la
            conciliación viajan con su muelle. */}
        <motion.g
          style={{ transformOrigin: `${CX}px ${CY}px` }}
          animate={spin ? { rotate: 360 } : undefined}
          transition={spin ? { duration: 220, repeat: Infinity, ease: 'linear' } : undefined}
        >
          {Array.from({ length: BAYS }, (_, i) => (i === 0 ? null : <Bay key={i} i={i} beat={bays} />))}
          {CHECKS.map((c, i) => (
            <Check key={c.bay} bay={c.bay} ok={c.ok} i={i} beat={reconcile} />
          ))}
        </motion.g>

        {/* el ómnibus: el núcleo, con su llave */}
        <motion.circle cx={CX} cy={CY} r={HUB} fill="hsl(var(--volt) / 0.08)" stroke="hsl(var(--volt))" strokeWidth="1.4" style={{ opacity: hubO }} />
        <motion.g style={{ opacity: hubLbl }}>
          <text x={CX} y={CY - 2} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="11" fontWeight="600" letterSpacing="1.8" fill="#ffffff">
            {lang === 'es' ? 'ÓMNIBUS' : 'OMNIBUS'}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.6" fill="hsl(var(--volt-soft))">
            {lang === 'es' ? 'TU LLAVE' : 'YOUR KEY'}
          </text>
        </motion.g>

        {/* LA RESERVA: un arco del anillo interior que se cierra hasta el 22 %,
            y el mínimo del contrato marcado al 20 % — la reserva está por
            encima, y se ve por cuánto */}
        <motion.path d={arc(CX, CY, RING - 46, -90, -90 + 79)} stroke="hsl(var(--volt-soft))" strokeWidth="5" strokeLinecap="butt" style={{ pathLength: reserveLen }} />
        <FloorMark o={floorO} />
        <motion.g style={{ opacity: reserveLbl }}>
          <text x={CX + 8} y={CY - RING + 26} fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="rgba(255,255,255,0.85)">
            {lang === 'es' ? 'RESERVA 22 % · MÍNIMO 20 %' : 'RESERVE 22 % · MINIMUM 20 %'}
          </text>
        </motion.g>

        {/* EL TUBO al pote en Flare, y las acuñaciones que lo cruzan */}
        <motion.path d={`M${CX + RING + 4} ${CY - 7} H${POD_X - POD_R - 2}`} stroke={`${FLR}B3`} strokeWidth="1.1" style={{ opacity: tubeO }} />
        <motion.path d={`M${CX + RING + 4} ${CY + 7} H${POD_X - POD_R - 2}`} stroke={`${FLR}B3`} strokeWidth="1.1" style={{ opacity: tubeO }} />
        {[0, 1, 2].map((i) => (
          <Mote key={i} i={i} beat={flow} />
        ))}
        <motion.circle cx={POD_X} cy={CY} r={POD_R} fill={`${FLR}12`} stroke={`${FLR}BF`} strokeWidth="1.3" style={{ opacity: podO }} />
        <motion.g style={{ opacity: podLbl }}>
          <text x={POD_X} y={CY - 3} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="11" fontWeight="600" letterSpacing="1.8" fill="#ffffff">
            {lang === 'es' ? 'POTE' : 'POT'}
          </text>
          <text x={POD_X} y={CY + 12} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="8.5" letterSpacing="1.6" fill={FLR_SOFT}>
            FLARE
          </text>
          <text x={POD_X} y={CY + POD_R + 22} textAnchor="middle" fontFamily={SCENE_MONO} fontSize="9" letterSpacing="1.4" fill={FLR_SOFT}>
            {lang === 'es' ? 'REGLAS EN CONTRATO' : 'RULES IN CONTRACT'}
          </text>
        </motion.g>
        <motion.text
          x={CX + RING + 48}
          y={CY - 22}
          fontFamily={SCENE_MONO}
          fontSize="9.5"
          letterSpacing="1.4"
          fill="rgba(255,255,255,0.85)"
          style={{ opacity: flowLbl }}
        >
          {lang === 'es' ? '39 LIQUIDADAS · 2 EN VUELO' : '39 SETTLED · 2 IN FLIGHT'}
        </motion.text>

        {/* la conciliación, dicha una vez: tres libros que cuadran */}
        <motion.text
          x={CX}
          y={CY + BAY_R + 46}
          textAnchor="middle"
          fontFamily={SCENE_MONO}
          fontSize="9.5"
          letterSpacing="1.6"
          fill="hsl(var(--tone-success))"
          style={{ opacity: reconLbl }}
        >
          {lang === 'es' ? 'TU LIBRO · XRPL · FLARE — 0 DESCUADRES' : 'YOUR BOOK · XRPL · FLARE — 0 MISMATCHES'}
        </motion.text>
      </motion.g>
    </svg>
  );
}

function Bay({ i, beat }: { i: number; beat: MotionValue<number> }) {
  // every bay is on the ring at rest, dim; its beat brings it to full
  const [a, b] = slot([0.3, 0.95], i - 1, BAYS - 1, 0.22);
  const o = useTransform(beat, [a, b], [0.45, 1], { clamp: true });
  const sc = useTransform(beat, [a, b], [0.85, 1], { clamp: true });
  const kind = bayKind(i);
  const ang = i * (360 / BAYS);
  const [x, y] = polar(CX, CY, BAY_R, ang);
  const style =
    kind === 'kyc'
      ? { fill: 'hsl(var(--volt) / 0.85)', stroke: 'none', dash: undefined }
      : kind === 'pending'
        ? { fill: 'none', stroke: 'hsl(var(--volt) / 0.8)', dash: undefined }
        : { fill: 'none', stroke: 'rgba(255,255,255,0.45)', dash: '3 2' };
  return (
    <motion.g style={{ opacity: o, scale: sc, transformOrigin: `${x.toFixed(1)}px ${y.toFixed(1)}px` }}>
      <rect
        x="-12"
        y="-6"
        width="24"
        height="12"
        rx="2"
        transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang + 90})`}
        fill={style.fill}
        stroke={style.stroke}
        strokeDasharray={style.dash}
        strokeWidth="1"
      />
    </motion.g>
  );
}

/** La marca de conciliación de un muelle: un tic verde que se dibuja, o un
 *  «en vuelo» hueco que espera. */
function Check({ bay, ok, i, beat }: { bay: number; ok: boolean; i: number; beat: MotionValue<number> }) {
  const [a, b] = slot([0.1, 0.7], i, CHECKS.length, 0.45);
  const o = useTransform(beat, [a, a + (b - a) * 0.3], [0, 1], { clamp: true });
  const len = useTransform(beat, [a + (b - a) * 0.2, b], [0, 1], { clamp: true });
  const ang = bay * (360 / BAYS);
  const [x, y] = polar(CX, CY, BAY_R + 24, ang);
  return (
    <motion.g style={{ opacity: o }}>
      <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="8" fill="#0b0d10" stroke={ok ? 'hsl(var(--tone-success))' : 'hsl(45 75% 62%)'} strokeWidth="1.2" strokeDasharray={ok ? undefined : '2 2'} />
      {ok ? (
        <motion.path
          d={`M${(x - 3.5).toFixed(1)} ${y.toFixed(1)} l2.5 2.5 l4.5 -5`}
          stroke="hsl(var(--tone-success))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pathLength: len }}
        />
      ) : (
        <motion.circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.2" fill="hsl(45 75% 62%)" style={{ opacity: len }} />
      )}
    </motion.g>
  );
}

function Mote({ i, beat }: { i: number; beat: MotionValue<number> }) {
  const t = useTransform(beat, [0.2 + i * 0.16, 0.7 + i * 0.16], [0, 1], { clamp: true });
  // Se mueve por `x` (una traslación en unidades del dibujo), no por `cx`:
  // framer no tipa `cx` como estilo, y la traslación la resuelve el compositor.
  const x = useTransform(t, [0, 1], [CX + RING + 10, POD_X - POD_R - 8]);
  const o = useTransform(t, [0, 0.08, 0.92, 1], [0, 1, 1, 0]);
  return <motion.circle cx="0" cy={CY} r="2.6" fill={FLR_SOFT} style={{ x, opacity: o }} />;
}

function FloorMark({ o }: { o: MotionValue<number> }) {
  const [x0, y0] = polar(CX, CY, RING - 54, -90 + 72);
  const [x1, y1] = polar(CX, CY, RING - 38, -90 + 72);
  return <motion.line x1={x0.toFixed(1)} y1={y0.toFixed(1)} x2={x1.toFixed(1)} y2={y1.toFixed(1)} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="2 2" style={{ opacity: o }} />;
}

export const StationScene = memo(StationSceneImpl);
export default StationScene;

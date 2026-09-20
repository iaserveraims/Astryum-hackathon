'use client';

/**
 * LA CARTA ESTELAR — la escena del mundo Empresa.
 *
 * El mismo cielo que el sistema solar de Autocustodia, pero MEDIDO: un
 * planisferio con su retícula, sus horas y su eclíptica, donde la entidad es el
 * centro y sus tres cuentas —tesorería, operativa, reserva— se trazan como una
 * constelación. Sin brillo, a línea fina, en el bronce del tema institucional:
 * esa es la sobriedad que el fundador pidió que cambiase por producto, y esto
 * es «el algo más»: el instrumento con el que se mira.
 *
 * Se lee con el scroll, tiempo a tiempo, y sus láminas (EmpresaArtifacts) se
 * atan a los MISMOS tiempos: la carta se dibuja mientras se lee la posición,
 * los asientos se marcan mientras se lee el órgano, los arcos de exposición
 * se cierran mientras se leen los límites y la eclíptica escribe sus asientos
 * mientras se lee el registro.
 *
 * Decorativa (`aria-hidden`): el significado lo lleva el texto de la parada.
 * Ni una cifra de rendimiento: las cantidades de los arcos son maqueta y se
 * rotulan como exposición contra un tope, nunca como resultado.
 */

import { memo, useMemo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import { mulberry32 } from './craft';
import { SCENE_MONO, arc, polar, slot, useBeat, useSource, type Range } from './sceneKit';

type Lang = 'es' | 'en';

/* ── El reparto del scroll: UNA tabla, la lee también EmpresaJourney ──── */
export const CHART_BEATS = {
  sky: [0.0, 0.1],
  chart: [0.1, 0.26],
  position: [0.26, 0.42],
  organ: [0.42, 0.58],
  limits: [0.58, 0.74],
  record: [0.74, 0.88],
  close: [0.88, 1.0],
} as const;

const W = 1200;
const H = 700;
const CX = 760;
const CY = 350;
const R = 300;

const NODES = [
  { id: 'treasury', es: 'TESORERÍA', en: 'TREASURY', q: { es: '2 DE 4', en: '2 OF 4' }, x: CX - 190, y: CY - 120, r: 8, seats: 4, signed: 2 },
  { id: 'operating', es: 'OPERATIVA', en: 'OPERATING', q: { es: '1 DE 2', en: '1 OF 2' }, x: CX + 175, y: CY - 95, r: 6, seats: 2, signed: 1 },
  { id: 'reserve', es: 'RESERVA', en: 'RESERVE', q: { es: '3 DE 4', en: '3 OF 4' }, x: CX + 60, y: CY + 180, r: 5, seats: 4, signed: 3 },
] as const;

/** Los tres sectores de exposición en el anillo exterior: cada uno con su tope
 *  (el sector entero, tenue) y su exposición (el arco lleno). Maqueta. */
const SECTORS = [
  { es: 'VENUE A · 32 / 40', en: 'VENUE A · 32 / 40', from: -160, sweep: 96, fill: 0.8, floor: false },
  { es: 'VENUE B · 18 / 25', en: 'VENUE B · 18 / 25', from: -52, sweep: 96, fill: 0.72, floor: false },
  { es: 'RESERVA · 50 ≥ 20', en: 'RESERVE · 50 ≥ 20', from: 56, sweep: 96, fill: 1, floor: true },
] as const;

/** Los asientos que la eclíptica escribe en el tiempo del registro. */
const ENTRIES = [
  { t: 0.18, h: 'a41f…9c2' },
  { t: 0.5, h: '7de0…14b' },
  { t: 0.82, h: 'c082…5fa' },
] as const;

export interface StarChartSceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  level: MotionLevel;
  /** El fotograma de reposo: móvil y movimiento mínimo. */
  still?: boolean;
}

function StarChartSceneImpl({ progress, lang, level, still = false }: StarChartSceneProps) {
  const src = useSource(progress, still);
  const chart = useBeat(src, CHART_BEATS.chart);
  const position = useBeat(src, CHART_BEATS.position);
  const organ = useBeat(src, CHART_BEATS.organ);
  const limits = useBeat(src, CHART_BEATS.limits);
  const record = useBeat(src, CHART_BEATS.record);
  const close = useBeat(src, CHART_BEATS.close);

  // El cielo ya está antes de la carta: tenue, y sube a pleno cuando la
  // retícula empieza a dibujarse encima.
  // EN REPOSO LA CARTA ESTÁ ENTERA (fundador 2026-09-20: «el artefacto no
  // empieza en el sitio correcto»): como el sistema solar de la portada, el
  // dibujo base se ve al abrir y cada parada le AÑADE su capa. Nada arranca
  // desde cero; lo que arranca es el énfasis.
  const skyO = useTransform(src, [0, CHART_BEATS.chart[0]], [0.7, 1], { clamp: true });
  const ticksO = useTransform(chart, [0.35, 0.8], [0.55, 1], { clamp: true });
  const spokesO = useTransform(chart, [0.5, 0.9], [0.08, 0.18], { clamp: true });
  const eclipticO = useTransform(record, [0, 0.15], [0.18, 0.55], { clamp: true });
  // EL CIERRE encoge la carta y la apaga a medias mientras entra la frase que
  // firma el recorrido. Quieta, la carta se queda entera.
  const scale = useTransform(close, [0, 1], [1, still ? 1 : 0.78]);
  const fade = useTransform(close, [0, 1], [1, still ? 1 : 0.5]);

  const stars = useMemo(() => {
    const rnd = mulberry32(0x5e11);
    const out: Array<{ x: number; y: number; r: number; a: number }> = [];
    for (let i = 0; i < 90; i++) {
      const ang = rnd() * Math.PI * 2;
      const rr = 30 + rnd() * (R - 16);
      out.push({ x: CX + rr * Math.cos(ang), y: CY + rr * Math.sin(ang), r: 0.6 + rnd() * 1.1, a: 0.25 + rnd() * 0.6 });
    }
    return out;
  }, []);

  const spin = level === 'full' && !still;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden fill="none">
      <motion.g style={{ scale, opacity: fade, transformOrigin: `${CX}px ${CY}px` }}>
        {/* el cielo plano: estrellas trazadas, no brillando */}
        <motion.g style={{ opacity: skyO }}>
          {stars.map((s, i) => (
            <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(1)} fill={`hsl(var(--volt-soft) / ${s.a.toFixed(2)})`} />
          ))}
        </motion.g>

        {/* la retícula: cuatro círculos que se dibujan, del centro hacia fuera */}
        {[75, 150, 225, 300].map((rr, i) => (
          <Ring key={rr} r={rr} beat={chart} i={i} outer={i === 3} />
        ))}

        {/* las horas: setenta y dos marcas, y un giro lentísimo cuando la
            página está viva — un planisferio se gira, no se mira quieto */}
        <motion.g
          style={{ opacity: ticksO, transformOrigin: `${CX}px ${CY}px` }}
          animate={spin ? { rotate: 360 } : undefined}
          transition={spin ? { duration: 260, repeat: Infinity, ease: 'linear' } : undefined}
        >
          {Array.from({ length: 72 }, (_, i) => {
            const major = i % 6 === 0;
            const [x0, y0] = polar(CX, CY, R, i * 5);
            const [x1, y1] = polar(CX, CY, major ? R - 11 : R - 5, i * 5);
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={`hsl(var(--volt) / ${major ? 0.8 : 0.4})`} strokeWidth="1" />;
          })}
        </motion.g>
        <motion.g style={{ opacity: spokesO }}>
          {Array.from({ length: 12 }, (_, i) => {
            const [x0, y0] = polar(CX, CY, 75, i * 30);
            const [x1, y1] = polar(CX, CY, R - 12, i * 30);
            return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="hsl(var(--volt))" strokeWidth="1" />;
          })}
        </motion.g>

        {/* la eclíptica: el registro. Se escribe en su tiempo, y cada asiento
            cae sobre ella con su sello */}
        <motion.ellipse
          cx={CX}
          cy={CY}
          rx={R - 40}
          ry={(R - 40) * 0.56}
          transform={`rotate(-22 ${CX} ${CY})`}
          stroke="hsl(var(--volt-soft))"
          strokeWidth="1"
          strokeDasharray="3 5"
          style={{ opacity: eclipticO }}
        />
        {ENTRIES.map((e, i) => (
          <Entry key={e.h} entry={e} i={i} beat={record} lang={lang} />
        ))}

        {/* la entidad, en el centro, y sus tres cuentas trazadas */}
        <Root beat={position} lang={lang} />
        {NODES.map((n, i) => (
          <Node key={n.id} node={n} i={i} position={position} organ={organ} lang={lang} />
        ))}

        {/* los límites: el arco exterior, sector a sector */}
        {SECTORS.map((s, i) => (
          <Sector key={s.en} sector={s} i={i} beat={limits} lang={lang} />
        ))}

        {/* la procedencia: dónde se mira el cielo */}
        <text
          x={CX}
          y={H - 24}
          textAnchor="middle"
          fontFamily={SCENE_MONO}
          fontSize="10"
          letterSpacing="1.8"
          fill="hsl(var(--volt-soft) / 0.85)"
        >
          {lang === 'es' ? '42.5° N · 1.5° E — SE OPERA DESDE ANDORRA' : '42.5° N · 1.5° E — OPERATED FROM ANDORRA'}
        </text>
      </motion.g>
    </svg>
  );
}

function Ring({ r, beat, i, outer }: { r: number; beat: MotionValue<number>; i: number; outer: boolean }) {
  // drawn at rest; the chart beat brings it to full presence, inside out
  const o = useTransform(beat, [i * 0.12, 0.55 + i * 0.12], [0.5, 1], { clamp: true });
  return (
    <motion.circle
      cx={CX}
      cy={CY}
      r={r}
      stroke={`hsl(var(--volt) / ${outer ? 0.9 : 0.3})`}
      strokeWidth={outer ? 1.2 : 0.8}
      style={{ opacity: o }}
    />
  );
}

function Root({ beat, lang }: { beat: MotionValue<number>; lang: Lang }) {
  const o = useTransform(beat, [0, 0.18], [0.75, 1], { clamp: true });
  const sc = useTransform(beat, [0, 0.18, 0.3], [1, 1.15, 1], { clamp: true });
  const lbl = useTransform(beat, [0.2, 0.4], [0.6, 1], { clamp: true });
  return (
    <>
      <motion.g style={{ opacity: o, scale: sc, transformOrigin: `${CX}px ${CY}px` }}>
        <circle cx={CX} cy={CY} r="5" fill="hsl(var(--volt-soft))" />
        <circle cx={CX} cy={CY} r="11" stroke="hsl(var(--volt))" strokeWidth="1" />
      </motion.g>
      <motion.text
        x={CX + 18}
        y={CY + 26}
        fontFamily={SCENE_MONO}
        fontSize="10"
        letterSpacing="1.6"
        fill="rgba(255,255,255,0.8)"
        style={{ opacity: lbl }}
      >
        {lang === 'es' ? 'LA ENTIDAD · RAÍZ XRPL' : 'THE ENTITY · XRPL ROOT'}
      </motion.text>
    </>
  );
}

function Node({
  node,
  i,
  position,
  organ,
  lang,
}: {
  node: (typeof NODES)[number];
  i: number;
  position: MotionValue<number>;
  organ: MotionValue<number>;
  lang: Lang;
}) {
  // ranges end before 1 on purpose: a [1, 1] range is degenerate and framer
  // resolved it to its END value at rest (measured: «RESERVE 3 OF 4» was the
  // only thing on screen before scrolling)
  const [a, b] = slot([0.1, 0.8], i, NODES.length, 0.5);
  const line = useTransform(position, [a, b], [0.35, 1], { clamp: true });
  const o = useTransform(position, [a + (b - a) * 0.6, b], [0.75, 1], { clamp: true });
  const sc = useTransform(position, [a + (b - a) * 0.6, b, b + 0.08], [1, 1.25, 1], { clamp: true });
  const lbl = useTransform(position, [a + (b - a) * 0.7, b + 0.1], [0.6, 1], { clamp: true });
  return (
    <>
      <motion.line x1={CX} y1={CY} x2={node.x} y2={node.y} stroke="hsl(var(--volt-soft) / 0.75)" strokeWidth="1" style={{ opacity: line }} />
      <motion.g style={{ opacity: o, scale: sc, transformOrigin: `${node.x}px ${node.y}px` }}>
        <circle cx={node.x} cy={node.y} r={node.r} fill="hsl(var(--volt-soft))" />
        <path
          d={`M${node.x - node.r - 4} ${node.y} h-8 M${node.x + node.r + 4} ${node.y} h8 M${node.x} ${node.y - node.r - 4} v-8 M${node.x} ${node.y + node.r + 4} v8`}
          stroke="hsl(var(--volt))"
          strokeWidth="1"
        />
      </motion.g>
      <motion.g style={{ opacity: lbl }}>
        <text x={node.x + node.r + 16} y={node.y - 4} fontFamily={SCENE_MONO} fontSize="10.5" fontWeight="600" letterSpacing="1.6" fill="#ffffff">
          {lang === 'es' ? node.es : node.en}
        </text>
        <text x={node.x + node.r + 16} y={node.y + 10} fontFamily={SCENE_MONO} fontSize="9.5" letterSpacing="1.4" fill="hsl(var(--volt-soft))">
          {node.q[lang]}
        </text>
      </motion.g>
      {/* los asientos del órgano: alrededor de cada cuenta, los firmantes que
          hacen falta y los que ya han firmado, uno a uno en su tiempo */}
      {Array.from({ length: node.seats }, (_, k) => (
        <Seat key={k} node={node} k={k} organ={organ} nodeIndex={i} />
      ))}
    </>
  );
}

function Seat({ node, k, organ, nodeIndex }: { node: (typeof NODES)[number]; k: number; organ: MotionValue<number>; nodeIndex: number }) {
  const [a, b] = slot([0.05, 0.95], nodeIndex * 4 + k, 12, 0.3);
  const o = useTransform(organ, [a, b], [0, 1], { clamp: true });
  const signed = k < node.signed;
  const [x, y] = polar(node.x, node.y, node.r + 16, -90 + (360 / node.seats) * k);
  return (
    <motion.circle
      cx={x.toFixed(1)}
      cy={y.toFixed(1)}
      r="3.2"
      fill={signed ? 'hsl(var(--volt))' : 'transparent'}
      stroke={signed ? 'hsl(var(--volt))' : 'rgba(255,255,255,0.4)'}
      strokeWidth="1"
      style={{ opacity: o }}
    />
  );
}

function Sector({ sector, i, beat, lang }: { sector: (typeof SECTORS)[number]; i: number; beat: MotionValue<number>; lang: Lang }) {
  const [a, b] = slot([0.05, 0.95], i, SECTORS.length, 0.5);
  const capO = useTransform(beat, [a, a + (b - a) * 0.3], [0, 0.3], { clamp: true });
  const fill = useTransform(beat, [a + (b - a) * 0.25, b], [0, sector.fill], { clamp: true });
  const lbl = useTransform(beat, [b - (b - a) * 0.2, b], [0, 1], { clamp: true });
  const rr = R + 14;
  const end = sector.from + sector.sweep;
  const [tx, ty] = polar(CX, CY, rr + 22, sector.from + sector.sweep / 2);
  const [mx0, my0] = polar(CX, CY, rr - 6, sector.floor ? sector.from + sector.sweep * 0.4 : end);
  const [mx1, my1] = polar(CX, CY, rr + 6, sector.floor ? sector.from + sector.sweep * 0.4 : end);
  return (
    <>
      <motion.path d={arc(CX, CY, rr, sector.from, end)} stroke="hsl(var(--volt))" strokeWidth="6" strokeLinecap="butt" style={{ opacity: capO }} />
      <motion.path d={arc(CX, CY, rr, sector.from, end)} stroke="hsl(var(--volt-soft))" strokeWidth="6" strokeLinecap="butt" style={{ pathLength: fill }} />
      {/* el tope (o el mínimo): una marca cruzando el arco */}
      <motion.line x1={mx0} y1={my0} x2={mx1} y2={my1} stroke="#ffffff" strokeWidth="1.5" strokeDasharray={sector.floor ? '2 2' : undefined} style={{ opacity: lbl }} />
      <motion.text
        x={tx.toFixed(1)}
        y={ty.toFixed(1)}
        textAnchor="middle"
        fontFamily={SCENE_MONO}
        fontSize="9.5"
        letterSpacing="1.4"
        fill="rgba(255,255,255,0.85)"
        style={{ opacity: lbl }}
      >
        {lang === 'es' ? sector.es : sector.en}
      </motion.text>
    </>
  );
}

function Entry({ entry, i, beat, lang }: { entry: (typeof ENTRIES)[number]; i: number; beat: MotionValue<number>; lang: Lang }) {
  const [a, b] = slot([0.2, 0.95], i, ENTRIES.length, 0.4);
  const o = useTransform(beat, [a, b], [0, 1], { clamp: true });
  const sc = useTransform(beat, [a, a + (b - a) * 0.5, b], [0.4, 1.3, 1], { clamp: true });
  // sobre la eclíptica girada: el ángulo del asiento y su posición
  const ang = -200 + entry.t * 300;
  const rad = (ang * Math.PI) / 180;
  const ex = (R - 40) * Math.cos(rad);
  const ey = (R - 40) * 0.56 * Math.sin(rad);
  const rot = (-22 * Math.PI) / 180;
  const x = CX + ex * Math.cos(rot) - ey * Math.sin(rot);
  const y = CY + ex * Math.sin(rot) + ey * Math.cos(rot);
  return (
    <motion.g style={{ opacity: o, scale: sc, transformOrigin: `${x.toFixed(1)}px ${y.toFixed(1)}px` }}>
      <rect x={(x - 3).toFixed(1)} y={(y - 3).toFixed(1)} width="6" height="6" fill="hsl(var(--volt-soft))" />
      <text x={(x + 9).toFixed(1)} y={(y - 6).toFixed(1)} fontFamily={SCENE_MONO} fontSize="9" letterSpacing="1" fill="rgba(255,255,255,0.7)">
        {lang === 'es' ? 'ASIENTO' : 'ENTRY'} · {entry.h}
      </text>
    </motion.g>
  );
}

export const StarChartScene = memo(StarChartSceneImpl);
export default StarChartScene;

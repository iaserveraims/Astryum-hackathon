'use client';

/**
 * EL KIT DE LAS ESCENAS NUEVAS — lo que las tres comparten y ninguna repite.
 *
 * La carta estelar, la estación y la sonda leen el mismo progreso de scroll
 * que sus viajes (journeyShell) y lo trocean en tiempos. Aquí viven los tres
 * gestos que hacían falta en las tres: un tiempo como valor 0→1, un tramo
 * para el elemento i de n dentro de un tiempo, y la curva de Bézier que
 * recorre la sonda. Nada de copy, nada de itinerario: eso es de cada escena.
 */

import { useMotionValue, useTransform, type MotionValue } from 'framer-motion';

export type Range = readonly [number, number] | readonly number[];

/** Un tiempo del itinerario, como 0→1 recortado. */
export function useBeat(src: MotionValue<number>, range: Range, out: [number, number] = [0, 1]): MotionValue<number> {
  const [a, b] = range as [number, number];
  return useTransform(src, [a, b], out, { clamp: true });
}

/**
 * EL FOTOGRAMA DE REPOSO. La versión apilada (móvil, movimiento mínimo) no
 * tiene scroll: la escena se pinta TERMINADA, no en su primer fotograma. Un
 * valor fijo a 1 lleva cada tiempo a su final; cada escena decide qué deja
 * fuera de ese final (el cierre, que encoge y apaga, no se aplica quieto).
 */
export function useSource(progress: MotionValue<number>, still: boolean): MotionValue<number> {
  const one = useMotionValue(1);
  return still ? one : progress;
}

/** El tramo del elemento i de n dentro de un tiempo: entra escalonado y cada
 *  uno tarda `width` del tiempo en resolverse. */
export function slot(range: Range, i: number, n: number, width = 0.35): [number, number] {
  const [a, b] = range as [number, number];
  const span = b - a;
  const start = a + span * (n > 1 ? (i / (n - 1)) * (1 - width) : 0);
  return [start, start + span * width];
}

export type Pt = readonly [number, number];

/** Un punto de la cúbica de Bézier. */
export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
  const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
  return [x, y];
}

/** La tangente, en grados: hacia dónde mira lo que recorre la curva. */
export function bezierAngle(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): string {
  return `M${p0[0]} ${p0[1]} C${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
}

/** Un arco de circunferencia, en grados, de `a0` a `a1` (sentido horario). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const s = (a0 * Math.PI) / 180;
  const e = (a1 * Math.PI) / 180;
  const x0 = cx + r * Math.cos(s);
  const y0 = cy + r * Math.sin(s);
  const x1 = cx + r * Math.cos(e);
  const y1 = cy + r * Math.sin(e);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** La tipografía de los rótulos dentro de las escenas: la misma mono que el
 *  resto de la landing, sin depender de una clase que un SVG no herede. */
export const SCENE_MONO = 'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace';

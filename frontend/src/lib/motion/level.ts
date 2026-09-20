/**
 * El nivel de movimiento — la parte PURA (sin React, sin zustand, sin
 * 'use client'), para que la puedan importar tanto el store del cliente
 * (stores/motionStore.ts) como el script pre-pintado que inyecta el layout
 * de servidor (lib/motion/prepaint.ts). Importar una constante desde un
 * módulo 'use client' en un componente de servidor devuelve una referencia,
 * no el valor — por eso esto vive aparte.
 *
 * TRES NIVELES Y NADA MÁS (fundador 2026-09-10, segunda pasada: «no quiero
 * que el selector tenga Sistema»). La opción «que decida el dispositivo»
 * murió el mismo día que nació: el usuario elige un nivel y ese es el que
 * hay. La única concesión al SO es el ARRANQUE: si nunca se ha elegido nada
 * y el dispositivo pide movimiento reducido, la primera elección se graba
 * como Mínimo — y el selector la enseña como tal, sin un «Sistema» opaco por
 * medio. La explicación de los tres niveles está en stores/motionStore.ts.
 */

export type MotionLevel = 'full' | 'calm' | 'minimal';

export const MOTION_LEVELS: readonly MotionLevel[] = ['full', 'calm', 'minimal'];

/** La clave de localStorage (zustand/persist) — la comparten store y script. */
export const MOTION_STORAGE_KEY = 'astryum-motion';
/** El atributo que se estampa en <html> y que lee globals.css. */
export const MOTION_ATTRIBUTE = 'data-motion';

export function isMotionLevel(v: unknown): v is MotionLevel {
  return typeof v === 'string' && (MOTION_LEVELS as readonly string[]).includes(v);
}

/** El nivel del PRIMER arranque, cuando aún no hay nada elegido: lo de
 *  siempre, salvo que el dispositivo pida movimiento reducido. */
export function defaultMotionLevel(osReducedMotion: boolean): MotionLevel {
  return osReducedMotion ? 'minimal' : 'full';
}

/** Lo que se le dice a framer: en minimal todo `motion.*` corta al final;
 *  en los otros dos niveles framer anima aunque el SO pida lo contrario —
 *  el usuario eligió explícitamente y su elección manda. */
export function framerReducedMotion(level: MotionLevel): 'always' | 'never' {
  return level === 'minimal' ? 'always' : 'never';
}

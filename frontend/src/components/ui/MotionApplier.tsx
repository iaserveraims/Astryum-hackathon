'use client';

/**
 * MotionApplier — el nivel de movimiento del usuario (stores/motionStore.ts)
 * aplicado a TODA la web, desde ClientRoot: landing, login y dashboard
 * comparten el mismo ajuste (fundador 2026-09-10: «que se compartan por toda
 * la web»).
 *
 * Tres trabajos, y los tres leen el mismo nivel:
 *   1. Hidratar el store desde localStorage (persist va con skipHydration
 *      para que el primer render del cliente coincida con el del servidor).
 *      PRIMER ARRANQUE: si no había nada guardado y el dispositivo pide
 *      movimiento reducido, la primera elección se graba como Mínimo — así
 *      el selector de Settings enseña lo que de verdad se aplica, sin un
 *      «Sistema» opaco por medio (fundador: «no quiero que el selector tenga
 *      Sistema»). Es la MISMA regla que el script pre-pintado.
 *   2. Estampar `data-motion` en <html> y mantenerlo al día — el script
 *      pre-pintado de app/layout.tsx lo puso antes del primer frame; aquí se
 *      re-estampa cuando cambia el nivel. A diferencia de data-theme, NO se
 *      retira al desmontar: el ajuste es de toda la web, no del dashboard.
 *   3. `<MotionConfig reducedMotion>`: en minimal, cada `motion.*` de framer
 *      corta a su estado final sin animar; en full y calm framer anima aunque
 *      el SO pida lo contrario, porque el usuario eligió explícitamente.
 */

import { useEffect, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import {
  MOTION_ATTRIBUTE,
  MOTION_STORAGE_KEY,
  defaultMotionLevel,
  framerReducedMotion,
  useMotionLevel,
  useMotionStore,
} from '../../stores/motionStore';

export default function MotionApplier({ children }: { children: ReactNode }) {
  const level = useMotionLevel();

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    } catch {
      // modo privado / storage bloqueado: se arranca con el valor por defecto
    }
    void useMotionStore.persist.rehydrate();
    if (!stored) {
      const os = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      useMotionStore.getState().setLevel(defaultMotionLevel(os));
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(MOTION_ATTRIBUTE, level);
  }, [level]);

  return <MotionConfig reducedMotion={framerReducedMotion(level)}>{children}</MotionConfig>;
}

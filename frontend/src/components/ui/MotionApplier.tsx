'use client';

/**
 * MotionApplier — el nivel de movimiento del usuario (stores/motionStore.ts)
 * aplicado a TODA la web, desde ClientRoot: landing, login y dashboard
 * comparten el mismo ajuste.
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

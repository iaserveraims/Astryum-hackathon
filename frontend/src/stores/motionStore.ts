'use client';

/**
 * motionStore — CUÁNTO se mueve la interfaz y CON QUÉ CARA, decidido por el
 * usuario (segunda
 * pasada el mismo día: «no quiero solo que se desactiven las animaciones,
 * quiero estilos nuevos y distintos» y «no quiero que el selector tenga
 * Sistema»).
 *
 * UN AJUSTE, TRES LENGUAJES VISUALES, TODA LA WEB. No son tres velocidades
 * del mismo dibujo: cada nivel tiene sus propios artefactos.
 *
 *   · full    — la coreografía entera. Escenas vivas en las puertas del Earn,
 *               las rutas como una mano de cartas que se inclina y se abre
 *               bajo el cursor, puntos que respiran, reflejos que siguen al
 *               ratón, botones con halo.
 *   · calm    — el GRABADO CON PULSO (tercera pasada: «el modo calm lo has
 *               dejado sin animaciones, quiero que lo animes… el modo por
 *               defecto es demasiado»). Las puertas llevan un emblema
 *               monolínea que gira cada dos minutos y respira en seis
 *               segundos; las rutas van en una estantería plana que se posa al
 *               llegar y sube tres píxeles bajo el cursor, en tweens lentos sin
 *               muelle; los puntos tienen un halo que respira sin crecer; los
 *               botones son planos, sin halo; el selector de pestañas se
 *               desliza despacio y sin rebote; las escenas del resto de la web
 *               giran a un tercio de velocidad y los bucles rápidos (barridos,
 *               pulsos que viajan, motas) se apagan. LENTO Y PEQUEÑO — esa
 *               es la regla; lo que sigue al cursor (la luz de las tarjetas,
 *               la inclinación de las wallets) lo sigue CON RETARDO, no en
 *               tiempo real.
 *               Es el nivel para leer y comparar sin ruido.
 *   · minimal — el TEXTO PRIMERO. Las puertas y las rutas se convierten en
 *               listas (una fila por puerta, una fila por ruta con su radio);
 *               las tarjetas pierden sombra y redondean menos; el botón
 *               principal es un contorno; el selector de pestañas subraya;
 *               los puntos son un punto. Sin transiciones, todo instantáneo.
 *
 * NO HAY «SISTEMA». La única concesión al dispositivo es el primer arranque:
 * sin nada elegido, si el SO pide movimiento reducido la elección se graba
 * como Mínimo y el selector la enseña como tal (MotionApplier).
 *
 * CÓMO LLEGA A TODA LA WEB. Tres canales, y los tres leen este store:
 *   1. `data-motion="<nivel>"` en <html> (MotionApplier + el script
 *      pre-pintado de app/layout.tsx): globals.css apaga por selector de
 *      atributo las animaciones CSS y las motas SMIL.
 *   2. `<MotionConfig reducedMotion>` de framer alrededor de toda la app: en
 *      minimal, cada `motion.*` corta a su estado final sin animar.
 *   3. `useMotionLevel()` en los componentes que cambian de ARTEFACTO por
 *      nivel (puertas, mano, Card, botones, selector, PulseDot), y
 *      `useReducedMotion()` —sustituto del de framer, que eslint prohíbe—
 *      para los que solo distinguen «anima / no anima».
 *
 * El store se hidrata a mano (skipHydration) desde MotionApplier: el primer
 * pintado del cliente coincide así con el del servidor y la elección real
 * entra un frame después — el atributo pre-pintado ya tiene la CSS quieta,
 * así que ese frame no se ve.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MOTION_STORAGE_KEY, isMotionLevel, type MotionLevel } from '../lib/motion/level';

// La parte pura (tipos, constantes, la regla del arranque) vive en
// lib/motion/level.ts para que el layout de servidor la pueda importar; se
// re-exporta desde aquí para que los consumidores tengan un solo import.
export {
  MOTION_ATTRIBUTE,
  MOTION_LEVELS,
  MOTION_STORAGE_KEY,
  defaultMotionLevel,
  framerReducedMotion,
  isMotionLevel,
} from '../lib/motion/level';
export type { MotionLevel } from '../lib/motion/level';

interface MotionState {
  level: MotionLevel;
  setLevel: (l: MotionLevel) => void;
}

export const useMotionStore = create<MotionState>()(
  persist(
    (set) => ({
      level: 'full',
      setLevel: (level) => set({ level }),
    }),
    {
      name: MOTION_STORAGE_KEY,
      // Hidratación manual desde MotionApplier (ver cabecera): el primer
      // render del cliente debe coincidir con el del servidor.
      skipHydration: true,
      // Un valor corrupto en localStorage no puede colar un nivel inventado.
      merge: (persisted, current) => {
        const l = (persisted as Partial<MotionState> | undefined)?.level;
        return { ...current, level: isMotionLevel(l) ? l : current.level };
      },
    },
  ),
);

/* ── El SO, como store externo (solo para el primer arranque) ─────────── */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeOs(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function readOs(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCE_QUERY).matches;
}
const serverOs = () => false;

/** `prefers-reduced-motion` del dispositivo, sin desajuste de hidratación
 *  (el servidor siempre responde false). Solo decide el PRIMER arranque. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribeOs, readOs, serverOs);
}

/** El nivel elegido — para quien cambia de artefacto por nivel. */
export function useMotionLevel(): MotionLevel {
  return useMotionStore((s) => s.level);
}

/**
 * Sustituto del `useReducedMotion` de framer-motion — misma firma, mismo
 * uso, pero obedece al usuario y no al SO. `true` = nivel minimal.
 * Devuelve boolean (no null): framer devolvía null antes de leer el SO y
 * todos los consumidores hacían `?? false`.
 */
export function useReducedMotion(): boolean {
  return useMotionLevel() === 'minimal';
}

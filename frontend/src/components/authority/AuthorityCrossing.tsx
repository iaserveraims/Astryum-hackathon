'use client';

/**
 * AuthorityCrossing v5.
 *
 * The crossing no longer draws a mark of its own. The ONE mark is the page
 * loader (app/loading.tsx, AstryumLoader tone='auto'), which takes the colour
 * of the authority you are entering — indigo for Legacy, gold coming home.
 * What is left here is the crossing itself: a soft, centred colour wash in
 * the destination's hue that breathes in and lets go in well under a second,
 * so that stepping between products is still felt even when the page is
 * already cached and no loader shows. Low alpha, radial: it tints, it never
 * darkens (transitions-no-curtain rule). Pointer-events none —
 * the crossing never blocks a click.
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';

export type AuthorityCrossingDirection = 'to-legacy' | 'to-personal';

interface AuthorityCrossingProps {
  direction: AuthorityCrossingDirection;
  /** Kept for API compatibility (earlier versions drew a caption). */
  label?: string;
  quorum?: string;
  quorumMet?: number;
  members?: number;
  onDone: () => void;
}

const DURATION_MS = 700;
const REDUCED_MS = 200;
const GOLD = 'hsl(var(--product-personal))';
const INDIGO = 'hsl(var(--product-legacy))';

export default function AuthorityCrossing({ direction, onDone }: AuthorityCrossingProps) {
  const reduced = useReducedMotion();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Duration locked at mount — a parent re-render (fresh inline onDone each
  // AppShell render) must never re-trigger this branch.
  const durationRef = useRef<number | null>(null);
  if (durationRef.current === null) durationRef.current = reduced ? REDUCED_MS : DURATION_MS;

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), durationRef.current ?? DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mínimo: ni lavado — el re-tinte de los tokens (ThemeApplier) ya cuenta el
  // cambio; el temporizador solo cierra el cruce.
  if (reduced) return null;

  const toColor = direction === 'to-legacy' ? INDIGO : GOLD;
  return (
    // SE FUNDE SOLA, sin depender de <AnimatePresence>. El
    // padre la montaba como hijo directo de una frontera de presencia, y un
    // componente que no es motion.* nunca avisa de que su salida terminó: el
    // nodo se quedaba para siempre. Aquí no congelaba nada (pointer-events
    // none), pero se acumulaba uno por cada cruce. Ahora el fundido de salida
    // vive DENTRO de la propia animación —los últimos 280 ms del segundo que
    // dura— y el padre solo la desmonta cuando `onDone` dice que terminó.
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: DURATION_MS / 1000, times: [0, 0.18, 0.72, 1], ease: 'easeOut' }}
      className="pointer-events-none fixed inset-0 z-[90]"
      style={{
        background: `radial-gradient(ellipse at 50% 42%, color-mix(in srgb, ${toColor} 14%, transparent) 0%, color-mix(in srgb, ${toColor} 5%, transparent) 38%, transparent 68%)`,
      }}
    />
  );
}

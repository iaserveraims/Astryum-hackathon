'use client';

/**
 * SignedMark — LA ceremonia de firma. Una sola, y donde el proceso continúa.
 *
 * Historia en dos actos, para que nadie la duplique otra vez:
 *  · 2026-08-08 — la SignedCelebration a pantalla completa se retira («aparece
 *    de golpe y se pone todo el fondo borroso») y la ceremonia pasa a vivir
 *    dentro de la vista de cada operación.
 *  · 2026-08-26 — el fundador caza que sonaba DOS VECES por firma: una tapando
 *    el QR gastado y otra en el bloque de settlement al cerrarse aquél («quiero
 *    que haya una, solo la segunda»). El QR ahora solo tacha su código con un
 *    check quieto; la ceremonia suena UNA vez, aquí, montada por
 *    SettlementIndicator — la vista que se queda en pantalla mientras la
 *    operación llega a la cadena.
 *
 * La versión profesional (mismo encargo): el trazo se firma SOBRE SU LÍNEA —la
 * gramática de un documento: primero se dibuja la línea de firma, después el
 * autógrafo encima— y el sello cae una vez, con un único pulso de tinta que se
 * disipa. Las cuatro estrellas de la versión anterior se retiran: eran confeti,
 * y una firma no celebra — certifica.
 *
 * Suena UNA vez al montarse y luego DESCANSA como emblema — sin exit, sin
 * remount: mantenerla en un slot ESTABLE para que los re-renders de estado no
 * la relancen. Colores por currentColor desde un envoltorio `text-volt`: oro en
 * Personal, índigo bajo Legacy. Reduced motion pinta el emblema terminado.
 */

import { motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';

const EASE = [0.16, 1, 0.3, 1] as const;
const DURATION_S = 1.5;

// The user's quick stroke — the same autograph the login manifest countersigns.
const SIGN_STROKE =
  'M 6 27 C 13 10, 21 7, 23.5 13.5 C 25.5 19, 18.5 26, 25 26 C 33 26, 36.5 13.5, 44 14.5 C 50 15.3, 47.5 24, 55 22.5 C 64 20.7, 68 13, 77 12 C 85 11.2, 92 12.5, 98 10.5';

function Seal({ animated, size }: { animated: boolean; size: number }) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="0.1 5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M38 51l8 8 16-17" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!animated) return <div className="-rotate-[8deg]">{svg}</div>;
  return (
    <div className="relative">
      {/* El pulso de tinta: UN anillo que nace bajo el sello al aterrizar y se
          disipa — la presión del tampón, no unos fuegos artificiales. */}
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-full border-2 border-current"
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0, 0.45, 0], scale: [0.7, 0.7, 1, 1.45] }}
        transition={{ duration: DURATION_S, times: [0, 0.62, 0.7, 1], ease: 'easeOut' }}
        aria-hidden
      />
      <motion.div
        // El tampón: llega grande y en el aire, CAE sobre el trazo cuando éste
        // termina de dibujarse, y asienta con un mínimo rebote de presión.
        animate={{
          scale: [1.45, 1.45, 0.96, 1.02, 1],
          rotate: [-15, -15, -8, -8, -8],
          opacity: [0, 0, 1, 1, 1],
        }}
        transition={{ duration: DURATION_S, times: [0, 0.5, 0.66, 0.78, 1], ease: EASE }}
      >
        {svg}
      </motion.div>
    </div>
  );
}

/**
 * The inline ceremony. It never unmounts itself — keep it mounted in a STABLE
 * slot so status re-renders don't replay it. One consumer by design
 * (SettlementIndicator): a second mount is a second ceremony, and that bug is
 * already paid for.
 */
export function SignedMark({ className = '' }: { className?: string }) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className={`relative inline-flex items-center justify-center text-volt ${className}`} aria-hidden>
      <div className="relative px-2 pb-1.5 pt-2">
        <svg width={148} height={54} viewBox="0 0 104 38" fill="none" aria-hidden>
          {/* La línea de firma — el documento espera la rúbrica. Se dibuja
              primero, rápida y recta, y el autógrafo cae sobre ella. */}
          {reduced ? (
            <line x1="4" y1="33" x2="100" y2="33" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
          ) : (
            <motion.line
              x1="4"
              y1="33"
              x2="100"
              y2="33"
              stroke="currentColor"
              strokeOpacity="0.3"
              strokeWidth="1"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: [0, 1, 1] }}
              transition={{ duration: DURATION_S, times: [0, 0.14, 1], ease: 'easeOut' }}
            />
          )}
          {/* resting hint under the live stroke — SignatureScene grammar */}
          <path d={SIGN_STROKE} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.7" strokeLinecap="round" />
          {reduced ? (
            <path d={SIGN_STROKE} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          ) : (
            <motion.path
              d={SIGN_STROKE}
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: [0, 0, 1, 1] }}
              transition={{ duration: DURATION_S, times: [0, 0.12, 0.56, 1], ease: 'easeInOut' }}
            />
          )}
        </svg>
        <div className="absolute -right-7 -top-4">
          <Seal animated={!reduced} size={52} />
        </div>
      </div>
    </div>
  );
}

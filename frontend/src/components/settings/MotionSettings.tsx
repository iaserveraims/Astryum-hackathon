'use client';

/**
 * MotionSettings — la fila «Movimiento» de Preferencias (fundador 2026-09-10:
 * «se me generan problemas de concentración con las animaciones de los
 * botones del Earn… que se pueda cambiar la configuración de complejidad de
 * las animaciones en Settings»; segunda pasada: «no quiero que el selector
 * tenga Sistema… quiero estilos nuevos y distintos»).
 *
 * Tres botones —Completo · Sereno · Mínimo— con el mismo formato que el
 * selector de Tema que tiene encima, una línea que dice CÓMO SE VE el nivel
 * elegido, y TRES PROBETAS debajo que lo enseñan en vivo: la puerta del Earn
 * (escena viva / emblema grabado / fila de lista), la ruta (carta que se
 * inclina / carta de estantería con su barra / fila con radio) y el punto de
 * estado (respira / halo / liso). Sin las probetas el ajuste es una palabra;
 * con ellas el usuario ve el estilo antes de salir de Settings.
 *
 * Las probetas no imitan nada: usan las MISMAS piezas y las mismas recetas
 * que la web —HarvestSunScene y SunSealEmblem de icons.tsx, la cara de la
 * mano y de la estantería, PulseDot— así que lo que se ve aquí es exactamente
 * lo que se verá allí. El nivel se lee del store (stores/motionStore.ts) como
 * en cualquier otra pantalla.
 */

import { useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { EASE_OUT } from '../ui/motion';
import { ArrowRight, Sparkles, Sprout } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { MOTION_LEVELS, useMotionLevel, useMotionStore, type MotionLevel } from '../../stores/motionStore';
import { HarvestSunScene, SunSealEmblem } from '../earn/icons';
import { PulseDot } from '../ui/motion';

const LABEL: Record<MotionLevel, string> = { full: 'Full', calm: 'Calm', minimal: 'Minimal' };

/** Cómo se ve cada nivel, en una frase factual — sin adjetivos de venta. */
const DESCRIPTION: Record<MotionLevel, string> = {
  full: 'Living scenes on the doors, the routes as a hand of cards that tilts and opens under the cursor, breathing dots and cursor sheens.',
  calm: 'Engraved emblems that turn and breathe slowly, the routes on a flat shelf that lifts a touch under the cursor, dots with a soft halo. Slow and small — the light follows the cursor with a lag.',
  minimal: 'Text first: doors and routes become lists, buttons go flat and square, no shadows, no transitions.',
};

const DOOR_LABEL: Record<MotionLevel, string> = {
  full: 'Doors: living scene',
  calm: 'Doors: slow emblem',
  minimal: 'Doors: list rows',
};
const ROUTE_LABEL: Record<MotionLevel, string> = {
  full: 'Routes: hand of cards',
  calm: 'Routes: flat shelf',
  minimal: 'Routes: list',
};
const DOT_LABEL: Record<MotionLevel, string> = {
  full: 'Dots: breathing',
  calm: 'Dots: soft halo',
  minimal: 'Dots: plain',
};

export default function MotionSettings() {
  const { t } = useT();
  const level = useMotionLevel();
  const setLevel = useMotionStore((s) => s.setLevel);

  return (
    <div className="py-2 border-b border-ink/5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-ink/90">{t('Motion')}</div>
          <div className="text-xs text-ink/40 mt-0.5">
            {t('How much the interface moves, and with which face. One setting, every screen.')}
          </div>
        </div>
        <div
          className="flex items-center rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 text-[11px] font-medium shrink-0"
          role="radiogroup"
          aria-label={t('Motion')}
        >
          {MOTION_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              onClick={() => setLevel(l)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                level === l ? 'bg-volt text-volt-ink' : 'text-ink/50 hover:text-ink'
              }`}
            >
              {t(LABEL[l])}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink/50">{t(DESCRIPTION[level])}</p>

      {/* ── Las probetas: el estilo, a la vista ── */}
      <div className="mt-3 grid grid-cols-3 gap-2" aria-live="polite">
        <Specimen label={t(DOOR_LABEL[level])}>
          <DoorSpecimen level={level} open={t('Open')} />
        </Specimen>
        <Specimen label={t(ROUTE_LABEL[level])}>
          <RouteSpecimen level={level} label={t('A route')} other={t('Another route')} />
        </Specimen>
        <Specimen label={t(DOT_LABEL[level])}>
          <div className="grid h-[72px] place-items-center">
            <PulseDot size={10} />
          </div>
        </Specimen>
      </div>
      <p className="mt-1.5 text-[10.5px] text-ink/35">{t('Hover or tap to try it.')}</p>
    </div>
  );
}

function Specimen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="m-0 rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-2">
      <div className="grid h-[76px] place-items-center overflow-hidden">{children}</div>
      <figcaption className="mt-1 text-center text-[10.5px] leading-snug text-ink/45">{label}</figcaption>
    </figure>
  );
}

/** La puerta del Earn, en miniatura: la escena viva (`group` la enciende bajo
 *  atención, como en la puerta), el emblema grabado, o la fila de lista. */
function DoorSpecimen({ level, open }: { level: MotionLevel; open: string }) {
  if (level === 'full') {
    return (
      <div className="group grid place-items-center">
        <HarvestSunScene size={72} />
      </div>
    );
  }
  if (level === 'calm') return <SunSealEmblem size={64} />;
  return (
    <div className="flex w-full max-w-[9.5rem] items-center gap-2 rounded-md border border-ink/10 bg-surface-1 px-2 py-1.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-volt/25 bg-volt/[0.06] text-volt">
        <Sprout className="h-3 w-3" strokeWidth={1.75} />
      </span>
      <span className="h-1.5 flex-1 rounded-sm bg-ink/15" aria-hidden />
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-volt">
        {open}
        <ArrowRight className="h-3 w-3" />
      </span>
    </div>
  );
}

/** La ruta, en miniatura: la carta de la mano (tilt + elevación), la carta de
 *  la estantería (barra lateral, elegida) o dos filas con su radio. */
function RouteSpecimen({ level, label, other }: { level: MotionLevel; label: string; other: string }) {
  if (level === 'full') return <HandSpecimenCard label={label} />;
  if (level === 'calm') {
    // La receta de ShelfCard: tween lento, tres píxeles, sin muelle ni tilt.
    return (
      <motion.button
        type="button"
        aria-label={label}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.99 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        className="relative flex h-16 w-24 flex-col justify-between rounded-lg border border-volt/50 bg-volt/[0.04] p-2 pl-3 text-left transition-colors duration-300"
      >
        <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-volt" />
        <span className="grid h-5 w-5 place-items-center rounded-md border border-volt/25 bg-volt/10 text-volt">
          <Sparkles className="h-3 w-3" strokeWidth={1.75} />
        </span>
        <span className="text-[10px] leading-tight text-ink/80">{label}</span>
      </motion.button>
    );
  }
  return (
    <div className="w-full max-w-[9.5rem] divide-y divide-ink/[0.07] overflow-hidden rounded-md border border-ink/10 bg-surface-1 text-[10px]">
      {[label, other].map((name, i) => (
        <div key={name} className={`flex items-center gap-2 px-2 py-1.5 ${i === 0 ? 'bg-volt/[0.06]' : ''}`}>
          <span className="min-w-0 flex-1 truncate text-ink/80">{name}</span>
          <span aria-hidden className={`grid h-3 w-3 place-items-center rounded-full border ${i === 0 ? 'border-volt' : 'border-ink/25'}`}>
            {i === 0 && <span className="h-1.5 w-1.5 rounded-full bg-volt" />}
          </span>
        </div>
      ))}
    </div>
  );
}

/** La misma receta que GridCard (StrategyFan): tilt con muelle bajo el
 *  cursor, elevación en hover y hundimiento al pulsar. */
function HandSpecimenCard({ label }: { label: string }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const tiltX = useSpring(rx, { stiffness: 260, damping: 24 });
  const tiltY = useSpring(ry, { stiffness: 260, damping: 24 });

  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    ry.set(px * 6);
    rx.set(-py * 6);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 600 }}
      className="flex h-16 w-24 flex-col justify-between rounded-xl border border-ink/10 bg-surface-1 p-2 text-left shadow-[0_10px_28px_-16px_rgba(0,0,0,0.6)] transition-[border-color] duration-200 hover:border-ink/20"
    >
      <span className="grid h-5 w-5 place-items-center rounded-md border border-volt/25 bg-volt/10 text-volt">
        <Sparkles className="h-3 w-3" strokeWidth={1.75} />
      </span>
      <span className="text-[10px] leading-tight text-ink/80">{label}</span>
    </motion.button>
  );
}

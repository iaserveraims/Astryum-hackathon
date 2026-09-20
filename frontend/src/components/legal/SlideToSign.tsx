'use client';

/**
 * SlideToSign — LA FIRMA ES UN GESTO, no un clic (fundador 2026-09-13: «quiero
 * que la firma sea como en Xaman, que sea deslizar una flecha hacia la
 * derecha»).
 *
 * Un clic se da sin mirar; un deslizamiento hay que quererlo. Es exactamente
 * el gesto que Xaman pone delante de cada firma XRPL, así que el usuario que
 * llega aquí ya lo conoce: el mismo gesto para lo mismo — comprometerse.
 *
 * TRES REGLAS QUE ESTE CONTROL NO NEGOCIA:
 *
 * · NO SE FIRMA LO QUE NO SE PUEDE FIRMAR. Con `disabled` el carril queda
 *   inerte y DICE POR QUÉ (`hint`) en lugar de quedarse gris y mudo. Una
 *   firma bloqueada sin motivo se lee como una pantalla rota.
 * · SE COMPLETA AL SOLTAR EN EL FINAL, no al rozarlo: si sueltas antes, el
 *   tirador vuelve solo. Arrastrar sin querer no firma nada.
 * · SE PUEDE FIRMAR SIN RATÓN. El tirador es un `slider` real: flechas para
 *   avanzar, Fin para llegar al final. Un gesto de arrastre que solo existe
 *   para el ratón dejaría fuera a quien navega con teclado — y esto es la
 *   única puerta a la cuenta.
 *
 * Sin red y sin estado propio más allá del gesto: quién firma y qué se
 * registra lo decide quien lo monta (LegalSignCeremony).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { useMotionLevel } from '../../stores/motionStore';
import { T, type Lang } from '../landing/useLang';

const GOLD = '#C9A227';
const GOLD_SOFT = '#E8C25A';
/** Diámetro del tirador y aire del carril — el carril mide KNOB + PAD·2. */
const KNOB = 48;
const PAD = 5;
/** Cuánto falta para considerar que llegaste al final (px). */
const SNAP = 8;

export function SlideToSign({
  lang,
  label,
  hint,
  disabled = false,
  busy = false,
  done = false,
  doneLabel,
  onSign,
}: {
  lang: Lang;
  /** Qué se firma, en el propio carril. */
  label: string;
  /** Por qué no se puede firmar todavía (solo con `disabled`). */
  hint?: string;
  disabled?: boolean;
  /** La firma está registrándose: el carril se queda al final, ocupado. */
  busy?: boolean;
  /** Ya firmado: el carril se cierra con su marca. */
  done?: boolean;
  doneLabel?: string;
  onSign: () => void;
}) {
  const level = useMotionLevel();
  const still = level !== 'full';
  const trackRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const [max, setMax] = useState(0);
  const [dragging, setDragging] = useState(false);
  const locked = disabled || busy || done;

  // El recorrido REAL se mide (el carril es fluido): sin esto el tope sería
  // un número inventado y en móvil el tirador acabaría fuera del carril.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setMax(Math.max(0, el.clientWidth - KNOB - PAD * 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bloqueado o ya firmado, el tirador no se queda a medias: vuelve al
  // principio, o se planta en el final cuando la firma ya está dada.
  useEffect(() => {
    if (done || busy) {
      void animate(x, max, { type: 'spring', stiffness: 320, damping: 30 });
    } else if (disabled) {
      void animate(x, 0, { duration: still ? 0 : 0.25 });
    }
  }, [done, busy, disabled, max, x, still]);

  const settle = useCallback(
    (to: number, sign: boolean) => {
      void animate(x, to, still ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 32 });
      if (sign) onSign();
    },
    [onSign, still, x],
  );

  const release = useCallback(() => {
    setDragging(false);
    if (locked) return;
    // Al FINAL se firma; antes del final, vuelve. Rozar el borde no basta.
    if (x.get() >= max - SNAP) settle(max, true);
    else settle(0, false);
  }, [locked, max, settle, x]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (locked) return;
    const step = Math.max(24, max / 4);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(max, x.get() + step);
      if (next >= max - SNAP) settle(max, true);
      else settle(next, false);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      settle(Math.max(0, x.get() - step), false);
    } else if (e.key === 'End') {
      e.preventDefault();
      settle(max, true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      settle(0, false);
    }
  };

  // La estela: el carril se tiñe por detrás del tirador, así se ve cuánto
  // llevas. width en px (no %) porque el tirador se mide en px.
  const fillW = useTransform(x, (v) => v + KNOB + PAD * 2);
  const labelOpacity = useTransform(x, [0, Math.max(1, max * 0.45)], [1, 0]);
  const progress = useTransform(x, [0, Math.max(1, max)], [0, 100]);
  const [pct, setPct] = useState(0);
  useEffect(() => progress.on('change', (v) => setPct(Math.round(v))), [progress]);

  return (
    <div>
      <div
        ref={trackRef}
        className="relative select-none overflow-hidden rounded-full"
        style={{
          height: KNOB + PAD * 2,
          border: `1px solid ${locked && !done && !busy ? 'rgba(255,255,255,0.10)' : 'rgba(201,162,39,0.45)'}`,
          background: locked && !done && !busy ? 'rgba(255,255,255,0.03)' : 'rgba(201,162,39,0.06)',
        }}
      >
        {/* Lo recorrido, por detrás del tirador. */}
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: fillW, background: 'rgba(201,162,39,0.16)' }}
        />

        {/* Lo que se firma, escrito en el propio carril. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-16 text-center text-[12.5px] font-medium"
          style={{ opacity: locked && !done && !busy ? 1 : labelOpacity, color: locked && !done && !busy ? 'rgba(255,255,255,0.40)' : GOLD_SOFT }}
        >
          {done ? (doneLabel ?? T('Firmado', 'Signed', lang)) : busy ? T('Registrando la firma…', 'Recording your signature…', lang) : label}
        </motion.span>

        {/* El tirador. Arrastrar hacia la derecha ES la firma. */}
        <motion.div
          role="slider"
          tabIndex={locked ? -1 : 0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={done || busy ? 100 : pct}
          aria-valuetext={
            done
              ? T('Firmado', 'Signed', lang)
              : `${pct}% — ${T('desliza hasta el final para firmar', 'slide to the end to sign', lang)}`
          }
          aria-disabled={locked || undefined}
          onKeyDown={onKeyDown}
          drag={locked ? false : 'x'}
          dragConstraints={{ left: 0, right: max }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={() => setDragging(true)}
          onDragEnd={release}
          style={{ x, top: PAD, left: PAD, width: KNOB, height: KNOB, background: locked && !done && !busy ? 'rgba(255,255,255,0.07)' : GOLD }}
          whileTap={locked ? undefined : { scale: 0.96 }}
          className={`absolute grid place-items-center rounded-full shadow-[0_6px_20px_rgba(201,162,39,0.28)] outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
            locked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-black" strokeWidth={2.2} />
          ) : done ? (
            <Check className="h-5 w-5 text-black" strokeWidth={2.6} />
          ) : disabled ? (
            <Lock className="h-4 w-4 text-white/45" strokeWidth={2} />
          ) : (
            <motion.span
              animate={still ? undefined : { x: [0, 4, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="h-5 w-5 text-black" strokeWidth={2.4} />
            </motion.span>
          )}
        </motion.div>
      </div>

      {/* El motivo de que no se pueda firmar todavía — nunca un carril mudo. */}
      {disabled && hint ? (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-white/40">{hint}</p>
      ) : !locked ? (
        <p className="mt-2 text-center text-[11px] text-white/30">
          {T('Arrastra la flecha hasta el final — o usa las flechas del teclado.', 'Drag the arrow to the end — or use the arrow keys.', lang)}
        </p>
      ) : null}
    </div>
  );
}

export default SlideToSign;

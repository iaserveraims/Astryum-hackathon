'use client';

/**
 * EL CONMUTADOR DE MUNDOS — tres segmentos.
 *
 * Vivía dentro de SolarJourney.tsx con dos opciones, el oro clavado a hueso
 * ('#C9A227' y '#000') y el aviso de Legacy incrustado en el cuerpo. Sale de
 * ahí por tres razones, y las tres importaban antes de poder añadir el
 * tercero:
 */

import { useId, useRef } from 'react';
import { motion } from 'framer-motion';
import { visibleProducts, type LandingProduct } from './products';
import { BORDER, EASE } from './interactions';
import { useReducedMotion } from '../../stores/motionStore';

type Lang = 'es' | 'en';

export function ProductSwitch({
  product,
  setProduct,
  lang,
}: {
  product: LandingProduct;
  setProduct: (p: LandingProduct) => void;
  lang: Lang;
}) {
  const opts = visibleProducts();
  const active = opts.find((o) => o.id === product);
  const activeIndex = Math.max(0, opts.findIndex((o) => o.id === product));
  const thumbId = useId();
  const reduce = useReducedMotion();
  const btns = useRef<Array<HTMLButtonElement | null>>([]);

  /** Recorrido por flechas: el patrón de un grupo de una sola elección. Mueve
   *  la elección Y el foco, porque en un radiogroup son la misma cosa. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (activeIndex + d + opts.length) % opts.length;
    setProduct(opts[next].id);
    btns.current[next]?.focus();
  };

  return (
    <div className="flex flex-col items-center">
      <div
        role="radiogroup"
        aria-label={lang === 'es' ? 'Producto' : 'Product'}
        onKeyDown={onKeyDown}
        className="relative inline-flex items-center p-1 rounded-full"
        style={{
          border: `1px solid ${BORDER}`,
          background: 'rgba(8,8,10,0.86)',
          // El raíl es una CANAL: filete oscuro arriba y claro abajo. Sin esto
          // el pomo no se apoya en nada y flota.
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.045)',
        }}
      >
        {opts.map((o, i) => {
          const on = product === o.id;
          return (
            <button
              key={o.id}
              ref={(el) => {
                btns.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              // Recorrido: solo el elegido entra en el orden de tabulación, y
              // desde él se mueve uno con las flechas.
              tabIndex={on ? 0 : -1}
              onClick={() => setProduct(o.id)}
              // py-2.5: en móvil este es el único control del viaje además de
              // los CTA, y 32 px se quedaba por debajo del mínimo táctil.
              className="relative px-4 py-2.5 rounded-full text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-0"
              style={{ color: on ? o.ink : 'rgba(255,255,255,0.45)', transition: 'color 260ms ease', ...(on ? {} : {}) }}
            >
              {on && (
                <motion.span
                  layoutId={`ps-thumb-${thumbId}`}
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: o.accent,
                    // El pomo tiene cuerpo: brillo arriba, su propia sombra
                    // debajo y un halo corto de su color. Tres sombras, ninguna
                    // difusa — un mando serio no lleva neón.
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.5), 0 0 18px -6px ${o.accent}`,
                  }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : // Muelle, no curva: el pomo tiene masa y se pasa un pelo
                        // al llegar. Es lo que hace que se lea como un objeto.
                        { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 }
                  }
                />
              )}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>

      {/* EL AVISO. Su hueco existe SIEMPRE —esté vacío o lleno— para que
          cambiar de mundo no mueva el titular que hay debajo. Entra por
          cortinilla desde arriba, que es como aparece una línea impresa, y no
          por fundido, que es como aparece un error. */}
      <div className="relative mt-2 h-[22px] flex items-start justify-center overflow-hidden pointer-events-none">
        {active?.notice && (
          <motion.span
            key={active.id}
            initial={reduce ? false : { y: -22, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.42, ease: EASE }}
            className="text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 rounded-full text-center max-w-[90vw] whitespace-nowrap"
            style={{ color: active.accent, background: 'rgba(8,8,10,0.6)', border: `1px solid ${BORDER}` }}
          >
            {lang === 'es' ? active.notice.es : active.notice.en}
          </motion.span>
        )}
      </div>
    </div>
  );
}

export default ProductSwitch;

'use client';

/**
 * LOS DOS GANCHOS QUE COMPARTEN LAS ESCENAS: un reloj y una cámara.
 *
 * ── POR QUÉ UN SOLO RELOJ ────────────────────────────────────────────────
 * La escena del valle tenía su bucle del agua y su coalescedor del puntero;
 * la del umbral, treinta y ocho animaciones CSS independientes. Ninguno de los
 * dos se apagaba al salir de pantalla: el bucle del agua se gobernaba con un
 * `useTransform` con `clamp`, y un valor con tope se queda en 1 PARA SIEMPRE
 * después de su tiempo — así que el lago seguía agitándose el resto de la
 * sesión, con la pestaña de fondo incluida.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';

export type ClockWriter = (t: number, dt: number) => void;
export type Subscribe = (fn: ClockWriter) => () => void;

/**
 * EL RELOJ DE LA ESCENA. Devuelve un `subscribe` con el que cada pieza
 * registra su escritor de fotograma. Nada de estado de React por fotograma:
 * los escritores tocan atributos del DOM directamente.
 *
 * En «Sereno» invoca a los escritores UN fotograma de cada dos: el ajuste de
 * movimiento de la casa dice que sereno es más lento, no congelado, y un
 * interruptor de encendido/apagado no satisface ese ajuste.
 * En «Mínimo» no arranca nunca.
 */
export function useSceneClock({ awake, level }: { awake: boolean; level: MotionLevel }): Subscribe {
  const writers = useRef<Set<ClockWriter>>(new Set());
  const raf = useRef(0);
  const elapsed = useRef(0);

  const subscribe = useCallback<Subscribe>((fn) => {
    writers.current.add(fn);
    return () => {
      writers.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!awake || level === 'minimal' || typeof window === 'undefined') return;
    let last = performance.now();
    let frame = 0;
    let stopped = false;

    const tick = (now: number) => {
      if (stopped) return;
      raf.current = requestAnimationFrame(tick);
      frame += 1;
      // 50 ms de tope: al volver de una pestaña de fondo el primer delta puede
      // ser de segundos y el agua daría un salto.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (level === 'calm' && frame % 2 === 1) return;
      elapsed.current += dt;
      // El tiempo propio corre a un tercio en sereno: la cadencia de la casa.
      writers.current.forEach((w) => w(level === 'calm' ? elapsed.current / 3 : elapsed.current, dt));
    };

    const start = () => {
      if (raf.current) return;
      last = performance.now();
      raf.current = requestAnimationFrame(tick);
    };
    const halt = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    const onVisibility = () => (document.hidden ? halt() : start());

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      halt();
    };
  }, [awake, level]);

  return subscribe;
}

export interface CameraBox {
  /** El ancho del lienzo autorado. */
  vbW: number;
  /**
   * EL ANCHO DE DISEÑO, en píxeles: cuántos tiene que medir `vbW` unidades del
   * lienzo cuando la cámara está a escala 1.
   *
   * Es lo que permite que la escena SANGRE a todo el ancho de la ventana sin
   * que el dibujo crezca con ella. Sin esto el elemento medía lo que mide la
   * columna de texto, y cualquier cosa que cruce la ventana visible terminaba
   * en el canto del elemento: medido en captura, la escena se leía como un
   * panel rectangular pegado encima de la página en vez de como un paisaje.
   */
  targetPx: number;
}

export function useAspectViewBox(
  svgRef: RefObject<SVGSVGElement | null>,
  /** El centro de la cámara, en unidades del lienzo. Son valores de movimiento
   *  y no dos extremos interpolados por un tercer valor: una escena con más de
   *  dos posiciones de cámara —el valle sube a las cumbres antes de retirarse—
   *  no cabe en un solo parámetro de mezcla. */
  cx: MotionValue<number>,
  cy: MotionValue<number>,
  scale: MotionValue<number>,
  box: CameraBox,
): void {
  const aspect = useRef(1000 / 150);
  const widthPx = useRef(0);
  const last = useRef('');
  const moving = useRef(false);
  const idle = useRef(0);

  const write = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const s = Math.max(0.001, scale.get());
    const A = aspect.current || 1000 / 150;
    const px = cx.get();
    const py = cy.get();
    const base = Math.max(box.vbW, (box.vbW * widthPx.current) / box.targetPx);
    const w = base / s;
    const h = w / A;
    const str = `${(px - w / 2).toFixed(1)} ${(py - h / 2).toFixed(1)} ${Number(w.toPrecision(4))} ${Number(h.toPrecision(4))}`;
    if (str === last.current) return; // fotograma quieto = cero escrituras
    last.current = str;
    svg.setAttribute('viewBox', str);
    if (!moving.current) {
      moving.current = true;
      svg.style.willChange = 'transform';
    }
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      moving.current = false;
      if (svgRef.current) svgRef.current.style.willChange = 'auto';
    }, 220);
  }, [svgRef, cx, cy, scale, box.vbW, box.targetPx]);

  useMotionValueEvent(cx, 'change', write);
  useMotionValueEvent(cy, 'change', write);
  useMotionValueEvent(scale, 'change', write);
  useEffect(() => () => window.clearTimeout(idle.current), []);

  // La primera escritura va en el layout: quien llega con la posición de
  // scroll restaurada en mitad de la pista no dispara ningún evento de cambio y
  // se quedaría viendo el fotograma sin acercar hasta tocar la rueda.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        aspect.current = r.width / r.height;
        widthPx.current = r.width;
      }
      write();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [svgRef, write]);
}

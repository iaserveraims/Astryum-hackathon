'use client';

/**
 * ASTRYUM, LETRA A LETRA — el cimiento de la narrativa Institucional.
 *
 * El nombre que cierra la landing es UN solo `<text>ASTRYUM</text>` (Inter 800,
 * `textLength=1000` sobre un lienzo `0 0 1000 150`). Cada letra tiene que poder moverse
 * sola.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { LIGHT } from './craft';
import type { Subscribe } from './craftHooks';

/** El lienzo del wordmark. Coordenadas propias: nada de píxeles de pantalla. */
export const WORDMARK_BOX = { w: 1000, h: 150 } as const;
export const WORDMARK_WORD = 'ASTRYUM';
export const WORDMARK_FONT = 'var(--font-inter), Inter, system-ui, sans-serif';

/** La banda de caja alta: de la línea superior a la base. Todo degradado del
 *  nombre se resuelve contra ESTO en `userSpaceOnUse`, nunca en caja de objeto
 *  — la caja de objeto de un `<text>` la define cada motor a su manera, y eso
 *  es una moneda al aire, no una dirección de arte. */
export const WORDMARK_CAP = { top: 0, baseline: 142 } as const;

/** Los atributos EXACTOS con los que la landing dibuja el nombre desde 2026.
 *  Cambiar uno cambia la medida: van juntos en un sitio para que no se
 *  desparejen (el `<text>` de medida y el de pintado tienen que ser gemelos o
 *  las cajas mienten).
 *
 *  `textRendering: geometricPrecision` va AQUÍ y no en cada sitio: el hinting
 *  encaja los astiles en la rejilla del dispositivo y vuelve a encajarlos
 *  mientras la cámara barre de ×1 a ×4,6 y vuelve, lo que se ve como un
 *  parpadeo de peso durante todo el recorrido. */
export const WORDMARK_TEXT = {
  x: 0,
  y: 142,
  fontSize: 196,
  fontWeight: 800,
  textLength: 1000,
  lengthAdjust: 'spacing',
  textRendering: 'geometricPrecision',
} as const;

/** Dónde está cada letra dentro del lienzo. `cx` es su centro — el punto al
 *  que la cámara se acerca. `pen` es dónde se APOYA para pintarla sola. */
export interface LetterBox {
  ch: string;
  /** Índice en la palabra: la Y es 4. */
  i: number;
  x: number;
  w: number;
  cx: number;
  pen: number;
}

/** El índice de la Y. Se nombra porque la narrativa entera cuelga de ella y
 *  `letters[4]` en medio de una escena no dice nada. */
export const Y_INDEX = 4;

const box = (ch: string, i: number, x: number, w: number, pen = x): LetterBox => ({ ch, i, x, w, cx: x + w / 2, pen });

/** Las cajas medidas en el navegador real (ver la cabecera). Son el respaldo
 *  cuando no se puede medir, y también el valor del PRIMER render — así el
 *  servidor y el cliente pintan lo mismo y no hay desajuste de hidratación.
 *  Con `lengthAdjust="spacing"` las cajas de avance SON las posiciones de
 *  pluma para esta composición, así que `pen` cae en `x`. */
export const FALLBACK_LETTERS: readonly LetterBox[] = [
  box('A', 0, 0, 146.7),
  box('S', 1, 145.7, 127.7),
  box('T', 2, 272.5, 132.6),
  box('R', 3, 404.3, 123.6),
  box('Y', 4, 527.0, 147.4),
  box('U', 5, 673.5, 142.5),
  box('M', 6, 815.1, 184.9),
];

/**
 * LAS COSTURAS — dónde parte la palabra.
 *
 * Ya NO son ventanas de recorte (la ventana entera se ha ido, ver la cabecera).
 * Sobreviven porque son las abscisas de las MARCAS DE REGISTRO: en una plancha
 * de imprenta la respuesta profesional a un corte no es esconderlo, es enseñar
 * por dónde cortó el instrumento. Con las cajas medidas de Inter 800 caen en
 * 146,20 · 272,95 · 404,70 · 527,45 · 673,95 · 815,55 — siempre ENTRE dos
 * letras, donde ninguna de las dos tiene tinta.
 */
export function letterSeams(letters: readonly LetterBox[]): number[] {
  const seams: number[] = [];
  for (let i = 1; i < letters.length; i++) {
    const prev = letters[i - 1];
    seams.push((prev.x + prev.w + letters[i].x) / 2);
  }
  return seams;
}

/**
 * Las cajas REALES de esta máquina y esta fuente. Arranca con las constantes
 * (idénticas en servidor y cliente) y se afina tras cargar la tipografía.
 * `measured` dice si se puede confiar en ellas para partir el nombre: si no, se
 * pinta de una pieza y no pasa nada.
 */
/**
 * `settled` — CUÁNDO SE PUEDE ENSEÑAR EL NOMBRE.
 *
 * Esto mide DESPUÉS de `document.fonts.ready`, que es lo correcto (medir antes
 * da las cajas de la fuente de sistema y las letras quedan desalineadas justo
 * cuando entra la buena), pero deja un hueco: entre el montaje y esa promesa el
 * componente pinta la palabra de una pieza, y al medir la sustituye por siete
 * letras — que con la entrada puesta arrancan en opacidad CERO. El fundador lo
 * describió exacto: «la carga de la palabra Astryum está rota». Lo estaba: la
 * palabra aparecía, desaparecía y volvía letra a letra.
 */
export function useLetterBoxes(): { letters: readonly LetterBox[]; measured: boolean; settled: boolean } {
  const [state, setState] = useState<{ letters: readonly LetterBox[]; measured: boolean; settled: boolean }>({
    letters: FALLBACK_LETTERS,
    measured: false,
    settled: false,
  });

  useEffect(() => {
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      // Un `<text>` GEMELO del de pintado, fuera de la vista pero CON layout:
      // `display:none` no tiene cajas que medir y `getExtentOfChar` lanzaría.
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`);
      svg.setAttribute('width', String(WORDMARK_BOX.w));
      svg.setAttribute('height', String(WORDMARK_BOX.h));
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;left:-99999px;top:0;opacity:0;pointer-events:none';
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', String(WORDMARK_TEXT.x));
      text.setAttribute('y', String(WORDMARK_TEXT.y));
      text.setAttribute('textLength', String(WORDMARK_TEXT.textLength));
      text.setAttribute('lengthAdjust', WORDMARK_TEXT.lengthAdjust);
      text.setAttribute('font-size', String(WORDMARK_TEXT.fontSize));
      text.setAttribute('font-weight', String(WORDMARK_TEXT.fontWeight));
      text.setAttribute('text-rendering', WORDMARK_TEXT.textRendering);
      text.style.fontFamily = WORDMARK_FONT;
      text.textContent = WORDMARK_WORD;
      svg.appendChild(text);
      document.body.appendChild(svg);

      try {
        const out: LetterBox[] = [];
        for (let i = 0; i < WORDMARK_WORD.length; i++) {
          const e = text.getExtentOfChar(i);
          const p = text.getStartPositionOfChar(i);
          // Una medida de cero es una medida que no ocurrió (fuente sin
          // cargar, svg sin layout): se abandona entera y se queda el
          // respaldo. Media palabra medida sería peor que ninguna.
          if (!e || !e.width || !p) {
            setState((prev) => ({ ...prev, settled: true }));
            return;
          }
          out.push(box(WORDMARK_WORD[i], i, e.x, e.width, p.x));
        }
        if (!cancelled) setState({ letters: out, measured: true, settled: true });
      } catch {
        /* navegador sin la API de medida: se queda el respaldo de una pieza */
        if (!cancelled) setState((p) => ({ ...p, settled: true }));
      } finally {
        svg.remove();
      }
    };

    // La fuente primero: medir antes de que Inter esté cargada da las cajas de
    // la fuente de sistema, y las letras quedarían desalineadas justo cuando
    // la tipografía buena entra.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(measure).catch(measure);
    } else {
      measure();
    }
    // LA RED. Una fuente que no llega nunca no puede dejar el nombre invisible:
    // pasado un segundo y medio se da la medición por terminada y se pinta lo
    // que haya, aunque sea el respaldo de una pieza.
    const net = window.setTimeout(() => {
      if (!cancelled) setState((prev) => (prev.settled ? prev : { ...prev, settled: true }));
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(net);
    };
  }, []);

  return state;
}

/**
 * El nombre de una pieza — exactamente el `<text>` que la landing dibuja desde
 * siempre. Es el estado de reposo de la narrativa (el principio y el final) y
 * el respaldo de todo lo demás.
 */
export function WordmarkWhole({ fill, className = '' }: { fill: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`}
      className={`block w-full h-auto ${className}`}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <text
        x={WORDMARK_TEXT.x}
        y={WORDMARK_TEXT.y}
        textLength={WORDMARK_TEXT.textLength}
        lengthAdjust={WORDMARK_TEXT.lengthAdjust}
        fontSize={WORDMARK_TEXT.fontSize}
        fontWeight={WORDMARK_TEXT.fontWeight}
        textRendering={WORDMARK_TEXT.textRendering}
        fill={fill}
        style={{ fontFamily: WORDMARK_FONT }}
      >
        {WORDMARK_WORD}
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EL MATERIAL — cinco capas, cero filtros
   ══════════════════════════════════════════════════════════════════════ */

/**
 * LOS DEGRADADOS Y LA MÁSCARA DE TINTA.
 *
 * Todo en `userSpaceOnUse` contra la banda de caja alta. Todas las paradas de
 * la rampa del cuerpo son OPACAS: la pintura translúcida es exactamente lo que
 * hizo que el doble pintado del recorte fuese invisible al razonar y visible al
 * mirar. La recesión va en la OPACIDAD DEL GRUPO, jamás en el relleno.
 *
 * Cero primitivas de filtro. Ni una. Dentro de un SVG cuyo `viewBox` se
 * reescribe en cada fotograma, un filtro vuelve a rasterizar su región entera
 * cada vez y esa región crece con el acercamiento.
 */
export function WordmarkMaterialDefs({
  uid,
  glyphs,
}: {
  uid: string;
  glyphs: ReactNode;
}) {
  const B = WORDMARK_CAP.baseline;
  return (
    <defs>
      {/* 1 · EL CUERPO, PLANO. Y es una corrección, no una simplificación.
          La rampa de antes iba de `--volt-hi` arriba a
          `--volt-deep` abajo a lo largo de toda la caja, que es EXACTAMENTE el
          degradado del oro de WordArt: un cuerpo que se aclara arriba y se
          oscurece abajo se lee como una letra EXTRUIDA, no como una letra.
      { *
          Una lámina de oro estampada no tiene ese degradado: es un tono plano
          con una sola banda de luz donde la pilla. Así que el cuerpo es casi un
          solo tono —`--volt-soft` hasta el 58 %— y solo el pie se hunde un
          punto hacia `--volt`. Toda la casa titula en plano; el nombre también. */}
      <linearGradient id={`${uid}-word`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={B}>
        <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
        <stop offset="58%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
        <stop offset="86%" style={{ stopColor: 'hsl(var(--volt))' }} />
        <stop offset="100%" style={{ stopColor: 'hsl(var(--volt))' }} />
      </linearGradient>

      {/* 1·bis · EL DESTELLO DE LÁMINA. Una sola banda horizontal estrecha en el
          tercio alto, que es lo que hace una lámina de oro estampada cuando le
          da una luz: no un degradado de arriba abajo, UNA línea. Es la única
          «vida» que tiene el cuerpo, y por eso se puede permitir ser sutil. */}
      <linearGradient id={`${uid}-foil`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={B}>
        <stop offset="36%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0 }} />
        <stop offset="44%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.26 }} />
        <stop offset="52%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0 }} />
      </linearGradient>

      {/* 3 · LA MÁSCARA DE TINTA. El blanco de aquí es el CANAL ALFA de una
          máscara, no un color de marca — es la única excepción permitida a la
          regla de «solo tokens». */}
      <mask id={`${uid}-ink`} maskUnits="userSpaceOnUse" x="-40" y="-60" width="1080" height="260">
        {glyphs}
      </mask>

      {/* LOS DOS LABIOS DEL BISEL vivían aquí y se retiran enteros, junto con
          la rampa rasante de arriba. Se deja escrito porque costó dos pasadas
          entenderlo: el bisel se pintaba como dos copias COMPLETAS del glifo
          recortadas contra la máscara del propio glifo, y el comentario decía
          «solo sobrevive el labio» — falso, la copia iba desplazada dos unidades
          y sobrevivía en el noventa y ocho por ciento de la letra, así que la
          inundaba. Al rehacerlo como una diferencia de verdad (glifo menos glifo
          desplazado) apareció el segundo fallo: en SVG un atributo de
          presentación del HIJO gana al del padre, y los glifos de la máscara
          llevan `fill="#fff"` clavado, así que la copia que debía perforar salía
          blanca. Con eso, la pieza correcta no era arreglar
          el labio — era no tenerlo. */}
    </defs>
  );
}

function Glyph({
  l,
  fill,
  edge = false,
  opacity,
}: {
  l: LetterBox;
  fill: string;
  /** El filete del borde: trazo POR DEBAJO del relleno, así solo asoma medio. */
  edge?: boolean;
  opacity?: number;
}) {
  return (
    <text
      x={l.pen}
      y={WORDMARK_TEXT.y}
      fontSize={WORDMARK_TEXT.fontSize}
      fontWeight={WORDMARK_TEXT.fontWeight}
      textAnchor="start"
      textRendering={WORDMARK_TEXT.textRendering}
      fill={fill}
      fillOpacity={opacity}
      paintOrder={edge ? 'stroke' : undefined}
      stroke={edge ? 'hsl(var(--volt-hi) / 0.35)' : undefined}
      strokeWidth={edge ? 1.2 : undefined}
      vectorEffect={edge ? 'non-scaling-stroke' : undefined}
      style={{ fontFamily: WORDMARK_FONT }}
    >
      {l.ch}
    </text>
  );
}

/** La palabra entera como UN `<text>`, para el respaldo y para la máscara. */
function WholeText({ fill, edge = false }: { fill: string; edge?: boolean }) {
  return (
    <text
      x={WORDMARK_TEXT.x}
      y={WORDMARK_TEXT.y}
      textLength={WORDMARK_TEXT.textLength}
      lengthAdjust={WORDMARK_TEXT.lengthAdjust}
      fontSize={WORDMARK_TEXT.fontSize}
      fontWeight={WORDMARK_TEXT.fontWeight}
      textAnchor="start"
      textRendering={WORDMARK_TEXT.textRendering}
      fill={fill}
      paintOrder={edge ? 'stroke' : undefined}
      stroke={edge ? 'hsl(var(--volt-hi) / 0.35)' : undefined}
      strokeWidth={edge ? 1.2 : undefined}
      vectorEffect={edge ? 'non-scaling-stroke' : undefined}
      style={{ fontFamily: WORDMARK_FONT }}
    >
      {WORDMARK_WORD}
    </text>
  );
}

export interface WordmarkSplitProps {
  letters: readonly LetterBox[];
  measured: boolean;
  /** Único por instancia de escena: la portada monta DOS copias de la escena
   *  (la viva y la apilada, que solo está oculta por CSS) y `url(#…)` resuelve
   *  en todo el documento contra la primera coincidencia. Con ids constantes de
   *  módulo las dos copias se cruzan los degradados. */
  uid: string;
  /** 1 cuando el nombre está entero y quieto; 0 en cuanto empieza a partirse.
   *  Las capas caras (bisel, rasante, barrido) solo existen ahí: nadie lee un
   *  bisel a ×4,6, y una máscara bajo un `viewBox` vivo se vuelve a rasterizar
   *  en cada fotograma con la región creciendo con el acercamiento. */
  rest: MotionValue<number>;
  /** El barrido solo corre en «Completo». */
  sweepOn: boolean;
  subscribe?: Subscribe;
  /** La escena envuelve cada letra en su propio grupo para moverla. */
  renderLetter?: (i: number, node: ReactNode) => ReactNode;
}

/**
 * EL NOMBRE PARTIDO — geometría, material e ids en un solo sitio.
 *
 * La escena que lo monta se queda SOLO con la coreografía. Esa frontera es a
 * propósito: había dos implementaciones del corte (una en la escena con las
 * cajas de respaldo y otra aquí con las medidas), y dos implementaciones de una
 * cosa es exactamente cómo vuelve un fallo que ya se arregló.
 */
export function WordmarkSplit({ letters, measured, uid, rest, sweepOn, subscribe, renderLetter }: WordmarkSplitProps) {
  const swRef = useRef<SVGLinearGradientElement>(null);

  // El barrido: una sola escritura de atributo por fotograma, desde el reloj de
  // la escena. Sin estado de React y sin filtro.
  useEffect(() => {
    if (!subscribe || !sweepOn) return;
    return subscribe((t) => {
      const T = 500 - 800 * Math.cos((2 * Math.PI * t) / 6.5);
      swRef.current?.setAttribute('gradientTransform', `translate(${T.toFixed(1)} 0)`);
    });
  }, [subscribe, sweepOn]);

  const body = `url(#${uid}-word)`;

  const glyphsWhite = measured ? (
    <g fill="#fff">
      {letters.map((l) => (
        <Glyph key={l.ch + l.i} l={l} fill="#fff" />
      ))}
    </g>
  ) : (
    <WholeText fill="#fff" />
  );

  const sweepAlpha = useTransform(rest, (r) => (sweepOn ? r * 0.5 : 0));

  return (
    <>
      <WordmarkMaterialDefs uid={uid} glyphs={glyphsWhite} />
      {/* 5 · EL BARRIDO ESPECULAR, aparte porque necesita una `ref`: una
          máscara de luminancia que viaja, de la que se anima SOLO su
          `gradientTransform` —un atributo, no una reconstrucción del
          degradado—. Mismo ángulo y mismo periodo que el barrido dorado de los
          titulares de la casa, para que el nombre y los titulares se lean como
          la misma aleación. */}
      <defs>
        <linearGradient
          ref={swRef}
          id={`${uid}-swx`}
          gradientUnits="userSpaceOnUse"
          x1="-260"
          y1="150"
          x2="40"
          y2="-30"
        >
          <stop offset="0%" stopColor="#000" />
          <stop offset="38%" stopColor="#000" />
          <stop offset="50%" stopColor="#fff" />
          <stop offset="62%" stopColor="#000" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
        <mask id={`${uid}-sweepx`} maskUnits="userSpaceOnUse" x="-400" y="-100" width="1800" height="400">
          <rect x="-400" y="-100" width="1800" height="400" fill={`url(#${uid}-swx)`} />
        </mask>
      </defs>

      {/* EL CUERPO. Una letra, un `<text>`, su pluma. */}
      {measured ? (
        letters.map((l, i) => {
          const node = <Glyph key={l.ch + l.i} l={l} fill={body} edge />;
          return renderLetter ? renderLetter(i, node) : node;
        })
      ) : (
        <WholeText fill={body} edge />
      )}

      {/* EL DESTELLO DE LÁMINA, solo en reposo.

          Aquí vivían dos LABIOS —uno claro en el canto que mira a la luz y uno
          oscuro en el opuesto— que dibujaban un bisel. Eran la otra mitad del
          «rollo 3D»: un labio claro arriba y otro oscuro abajo es literalmente
          cómo se finge un relieve, y a tamaño de portada eso no se lee como
          material, se lee como efecto. Fuera los dos, y fuera también la rampa
          rasante, que sumaba un tercer lavado sobre el cuerpo.

          Queda una sola banda. Lo que hace que el nombre se vea caro no es
          tener más capas: es que las pocas que hay estén bien puestas. */}
      <motion.g mask={`url(#${uid}-ink)`} style={{ opacity: rest }}>
        <rect x="-40" y="-60" width="1080" height="260" fill={`url(#${uid}-foil)`} />
      </motion.g>

      {/* EL BARRIDO ESPECULAR. */}
      {sweepOn && (
        <motion.g mask={`url(#${uid}-ink)`} style={{ opacity: sweepAlpha }}>
          <g mask={`url(#${uid}-sweepx)`}>
            <rect x="-40" y="-60" width="1080" height="260" fill="hsl(var(--volt-hi))" />
          </g>
        </motion.g>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LAS MARCAS DE REGISTRO — publicar el corte
   ══════════════════════════════════════════════════════════════════════ */

/**
 * En una plancha de imprenta la respuesta profesional a un corte no es
 * esconderlo: es enseñar por dónde cortó el instrumento. Seis filetes finísimos
 * en las costuras, arriba y abajo de la banda de caja alta, y dos cruces de
 * registro en los márgenes.
 */
export function RegisterMarks({ letters, away }: { letters: readonly LetterBox[]; away: MotionValue<number> }) {
  const seams = letterSeams(letters);
  return (
    <g fill="none" stroke="hsl(var(--volt-soft) / 0.28)" strokeWidth="0.4" vectorEffect="non-scaling-stroke">
      {seams.map((x, i) => (
        <SeamTick key={x} x={x} rank={Math.abs(i - 2.5) - 0.5} away={away} />
      ))}
      {[-24, 1024].map((x) => (
        <RegisterCross key={x} x={x} away={away} />
      ))}
    </g>
  );
}

function SeamTick({ x, rank, away }: { x: number; rank: number; away: MotionValue<number> }) {
  // Se DIBUJA sola con el desfase del trazo discontinuo, nunca animando la
  // longitud del guion: `strokeDasharray: "0 x"` no es «línea continua», es
  // «ninguna raya», y esta escena ya pagó ese fallo una vez.
  const at = 0.034 * rank;
  const draw = useTransform(away, [at, at + 0.12], [1, 0], { clamp: true });
  const fade = useTransform(away, [0.55, 0.78], [1, 0], { clamp: true });
  return (
    <motion.g style={{ opacity: fade }}>
      <motion.line x1={x} y1={-18} x2={x} y2={-6} pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: draw }} />
      <motion.line x1={x} y1={148} x2={x} y2={160} pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: draw }} />
    </motion.g>
  );
}

function RegisterCross({ x, away }: { x: number; away: MotionValue<number> }) {
  const o = useTransform(away, [0, 0.08, 0.55, 0.78], [0, 1, 1, 0], { clamp: true });
  return (
    <motion.g style={{ opacity: o }}>
      <line x1={x - 6} y1={71} x2={x + 6} y2={71} strokeWidth="0.5" />
      <line x1={x} y1={65} x2={x} y2={77} strokeWidth="0.5" />
      <circle cx={x} cy={71} r={2.4} />
    </motion.g>
  );
}

/** Un valor de movimiento congelado, para los fotogramas quietos. */
export const STILL_MV = { get: () => 0, on: () => () => {} } as unknown as MotionValue<number>;

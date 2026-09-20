'use client';

/**
 * marks.tsx — LOS DIBUJOS DEL TEMA INSTITUCIONAL.
 *
 * El fundador no pidió otra paleta: pidió que cambien «los colores, dibujos y
 * layouts» (2026-09-13). Esta es la parte de los DIBUJOS, y es la que hace que
 * el tema no sea un filtro de color sobre el de siempre.
 *
 * ── DE QUÉ MUNDO SALEN ───────────────────────────────────────────────────
 * Astryum dibuja ESPACIO: soles, órbitas, asteroides, estelas, estrellas que
 * respiran (components/ui/scenes.tsx y components/earn/icons.tsx). Es un mundo
 * que promete viaje. Una institución no promete viaje: promete REGISTRO. Así
 * que estos dibujos salen del otro sitio donde el dinero lleva siglos
 * dibujándose — el grabado de los títulos valor, los billetes y las escrituras:
 *
 *   · GuillocheRosette — la roseta de guilloché, el hipotrocoide que imprime
 *                        una máquina de torno geométrico. Es LA marca de un
 *                        documento que no se puede falsificar a mano, y por eso
 *                        es la pieza central del tema.
 *   · BalanceMark      — la balanza: lo pignorado y lo obtenido, en fiel.
 *   · ColonnadeMark    — el pórtico: la institución que custodia y gestiona.
 *   · RegisterMark     — el registro reglado con su sello: lo que quedó escrito.
 *   · GuillocheField   — el fondo de la aplicación entera (BackgroundFx), el
 *                        rayado de seguridad que sustituye al campo de estrellas.
 *
 * ── CÓMO ESTÁN HECHOS ────────────────────────────────────────────────────
 * MONOLÍNEA y a `currentColor`: una sola anchura de trazo, sin rellenos, sin
 * degradados y sin halo — un grabado es tinta, no luz. El svg raíz lleva
 * `text-volt`, así que los cuatro se re-tintan solos con el bronce del tema, el
 * acero de Legacy y las versiones oscurecidas de la lámina clara, sin una
 * línea de color escrita a mano.
 *
 * Las curvas se calculan UNA VEZ a nivel de módulo (no por render): son
 * deterministas y no dependen de props, así que pagarlas en cada pintado sería
 * regalar CPU en pantallas que ya montan decenas de tarjetas.
 *
 * ── MOVIMIENTO ───────────────────────────────────────────────────────────
 * El nivel de movimiento manda sobre el tema, siempre (stores/motionStore.ts).
 * Estos grabados heredan el PULSO lento del nivel sereno —`emblem-turn` y
 * `emblem-breathe`, las mismas clases que ya usan los emblemas del Earn— y se
 * quedan quietos en Mínimo por las reglas de globals.css. Nunca persiguen al
 * cursor: un sello no reacciona, está impreso.
 */

import { useId } from 'react';

/* ── La geometría del guilloché ─────────────────────────────────────────────
   Un hipotrocoide: el trazo que deja un punto de una rueda que gira DENTRO de
   otra. Es literalmente cómo funciona el torno geométrico que grababa los
   billetes, y por eso el dibujo sale «a moneda» y no «a decoración».

     x = (R−r)·cos t + d·cos((R−r)/r · t)
     y = (R−r)·sin t − d·sin((R−r)/r · t)

   TRES REGLAS PARA ELEGIR UN TRIPLE (R, r, d). Las tres están fijadas en
   __tests__/skinMarks.test.ts, porque un comentario no impide que el próximo
   triple vuelva a ser una raya — y aquí ya pasó:

   1. **R NUNCA puede ser 2r.** Es la trampa, y es silenciosa. Con R = 2r sale
      (R−r)/r = 1 y la fórmula COLAPSA a x = (r+d)·cos t, y = (r−d)·sin t, que
      es la ecuación de una elipse: el par de Tusi. La primera versión de este
      fichero (commit 9712f43d) llevaba 46/23 y 38/19 — las dos son R = 2r —,
      así que el sello del tema se pintó dos días como una roseta de cuatro
      lóbulos atravesada por dos RAYAS planas de 80x12 y 60x16. Lo cazó la
      sesión paralela astryum-27 ejecutando la fórmula, no mirando el dibujo.
      Pide (R−r)/r ≥ 2.

   2. **El radio máximo es (R−r)+d**, y tiene que caber en el viewBox contando
      desde el centro. 52/13/22 daba 61 sobre un centro en 60: se salía.

   3. **El número de lóbulos es R/gcd(R,r)** — es lo que decide si la roseta se
      lee como filigrana (muchos) o como flor (pocos).

   Y el PERIODO se calcula, no se supone. Con (R−r)/r entero la curva cierra en
   2π·r/gcd(R,r), no en 2π·r: recorrer de más repinta la misma vuelta varias
   veces y reparte los pasos entre todas. Con 49/7 eran siete vueltas idénticas
   y segmentos de 6,9 px — las facetas se veían en las cúspides. Calculándolo,
   el segmento más largo baja a 0,99 px. */
/**
 * Una vuelta de guilloché, con TODO lo que hace falta para comprobarla.
 * `cx`/`cy`/`box` viajan en el dato —idea de astryum-27— para que la prueba
 * compruebe el recorte sin tener que adivinar el viewBox desde el JSX.
 */
export interface RosetteSpec {
  R: number;
  r: number;
  d: number;
  cx: number;
  cy: number;
  /** El lado del viewBox donde se dibuja. */
  box: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Los lóbulos: lo que decide si la vuelta se lee como filigrana o como flor. */
export function lobeCount({ R, r }: RosetteSpec): number {
  return R / gcd(R, r);
}

/** Lo que la vuelta ocupa desde su centro. Tiene que caber en el viewBox. */
export function maxRadius({ R, r, d }: RosetteSpec): number {
  return R - r + d;
}

/** Dónde CIERRA la curva. Ver la regla del periodo, arriba. */
export function closingPeriod({ R, r }: RosetteSpec): number {
  return (Math.PI * 2 * r) / gcd(R, r);
}

/** Un punto de la curva, para quien quiera comprobarla sin parsear el path. */
export function rosettePoint(spec: RosetteSpec, t: number): [number, number] {
  const k = spec.R - spec.r;
  return [
    spec.cx + k * Math.cos(t) + spec.d * Math.cos((k / spec.r) * t),
    spec.cy + k * Math.sin(t) - spec.d * Math.sin((k / spec.r) * t),
  ];
}

export function hypotrochoid(spec: RosetteSpec, steps = 720): string {
  const period = closingPeriod(spec);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const [x, y] = rosettePoint(spec, (i / steps) * period);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** EL SELLO: tres vueltas de fuera adentro, 7 · 5 · 4 lóbulos. Los tres son
 *  primos entre sí a propósito — es lo que hace que las vueltas se ENTRELACEN
 *  al girar en vez de superponer sus cúspides. Los radios (54, 47, 34) anidan
 *  con aire y dejan 2px libres antes de la orla de r=56, así que ningún trazo
 *  se monta sobre otro. */
export const ROSETTE_SPECS: RosetteSpec[] = [
  { R: 49, r: 7, d: 12, cx: 60, cy: 60, box: 120 },
  { R: 45, r: 9, d: 11, cx: 60, cy: 60, box: 120 },
  { R: 32, r: 8, d: 10, cx: 60, cy: 60, box: 120 },
];

/** LA MARCA DE AGUA del fondo: más grande y más abierta (viewBox 240). */
export const FIELD_SPECS: RosetteSpec[] = [
  { R: 105, r: 15, d: 22, cx: 120, cy: 120, box: 240 },
  { R: 90, r: 18, d: 20, cx: 120, cy: 120, box: 240 },
];

const ROSETTE = ROSETTE_SPECS.map((p) => hypotrochoid(p));
const FIELD_ROSETTE = FIELD_SPECS.map((p) => hypotrochoid(p));

/* ── EL TRAZO SE MIDE EN PÍXELES, NO EN UNIDADES DEL viewBox ────────────────
   Un grabado monolínea se apoya en un trazo fino, y un trazo fino tiene un
   suelo: por debajo de medio píxel de CSS el antialias lo reparte entre dos
   columnas de píxeles y lo que llega al ojo es una neblina, no una línea.

   El grosor REAL en pantalla es `base · size / 120`. Con el 0.6 del sello eso
   da 0.62 px a size=124 (la puerta del Earn: correcto, es lo que se afinó) y
   0.23 px a size=46 — la probeta con la que se ELIGE el tema en Ajustes y en
   el alta, donde el sello se veía como una mancha oscura. Verificado
   rasterizando el SVG a sus dos tamaños de montaje reales, no a ojo.

   Así que el grosor y la tinta compensan el tamaño de pintado. La regla NO
   toca los montajes grandes (a partir de ~100px devuelve el valor tal cual),
   así que el dibujo afinado para la puerta del Earn no se mueve ni un pelo:
   solo deja de disolverse cuando alguien lo monta pequeño. El tope de 2.2×
   evita que un mark diminuto acabe dibujado con morcillas.

   DÓNDE ESTÁ EL LÍMITE, Y QUÉ SIGNIFICA. Por debajo de ~28px el tope muerde
   antes de llegar al suelo, así que el trazo vuelve a quedar por debajo del
   píxel: con base 0.6 a 26px se queda en 0.29 px. Eso NO es un fallo de esta
   función — es la señal de que el dibujo está montado más pequeño de lo que
   admite. La balanza tiene fuste, brazo, tirantes, dos platillos y una base;
   a 26px no hay grosor que la haga legible, así que la respuesta correcta es
   no montarla ahí, y por eso la probeta dejó de hacerlo. Engordar el trazo de
   un dibujo demasiado denso no lo salva: lo convierte en una mancha. */
export const MIN_CSS_PX = 0.5;
const BOX = 120;

export function inkStroke(size: number, base: number): number {
  const rendered = (base * size) / BOX;
  if (rendered >= MIN_CSS_PX) return base;
  return Math.min((MIN_CSS_PX * BOX) / size, base * 2.2);
}

/** Y la TINTA: un trazo fino y además al 26% desaparece dos veces. Cuando el
 *  mark va pequeño, las opacidades suben con el mismo factor que el grosor,
 *  sin pasar nunca de 1. */
export function inkOpacity(size: number, base: number, stroke: number, baseStroke: number): number {
  const boost = stroke / baseStroke;
  return Math.min(1, base * (boost > 1 ? Math.min(boost, 1.7) : 1));
}

/**
 * La roseta de guilloché — el sello del tema. Tres vueltas concéntricas
 * girando muy despacio dentro de su orla, y el núcleo que respira.
 */
export function GuillocheRosette({ size = 120 }: { size?: number }) {
  const w = inkStroke(size, 0.6);
  const ink = (o: number) => inkOpacity(size, o, w, 0.6);
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth={w} strokeLinejoin="round">
        <g className="emblem-turn" style={{ transformOrigin: '60px 60px' }}>
          <path d={ROSETTE[0]} strokeOpacity={ink(0.5)} />
          <path d={ROSETTE[2]} strokeOpacity={ink(0.34)} />
        </g>
        {/* La vuelta del medio gira al REVÉS: el cruce de las dos direcciones
            es lo que da el moaré del grabado de verdad. */}
        <g className="emblem-turn-rev" style={{ transformOrigin: '60px 60px' }}>
          <path d={ROSETTE[1]} strokeOpacity={ink(0.42)} />
        </g>
        {/* La orla: dos filetes y el aire entre ellos — el marco de la lámina. */}
        <circle cx="60" cy="60" r="56" strokeOpacity={ink(0.5)} strokeWidth={inkStroke(size, 1)} />
        <circle cx="60" cy="60" r="53" strokeOpacity={ink(0.26)} />
      </g>
      <g className="emblem-breathe">
        <circle cx="60" cy="60" r="9" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.8" />
        <circle cx="60" cy="60" r="3" fill="currentColor" fillOpacity="0.8" />
      </g>
    </svg>
  );
}

/**
 * La balanza — lo pignorado y lo obtenido, en fiel. El grabado del «consigue
 * efectivo sin vender»: nada se ha ido, está en el otro platillo.
 */
export function BalanceMark({ size = 120 }: { size?: number }) {
  // Mismo suelo de píxel que el sello: la probeta de Ajustes monta esta
  // balanza a 26px, donde el trazo de 1 unidad llega a la pantalla como 0.22
  // px y el dibujo se deshace. A partir de ~60px devuelve el valor tal cual.
  const w = inkStroke(size, 1);
  const ink = (o: number) => inkOpacity(size, o, w, 1);
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth={w} strokeLinecap="round" strokeOpacity={ink(0.55)}>
        {/* el fuste y la base */}
        <path d="M60 30 V86" />
        <path d="M44 88 H76" />
        <path d="M52 88 q8 -10 16 0" strokeOpacity={ink(0.35)} />
        {/* el brazo y los tirantes */}
        <path d="M24 38 H96" />
        <path d="M24 38 L34 56 M24 38 L14 56" strokeOpacity={ink(0.4)} />
        <path d="M96 38 L106 56 M96 38 L86 56" strokeOpacity={ink(0.4)} />
        {/* los dos platillos */}
        <path d="M12 56 q12 14 24 0" />
        <path d="M84 56 q12 14 24 0" />
        <circle cx="60" cy="30" r="4" strokeOpacity={ink(0.6)} />
      </g>
      {/* el fiel: el único punto con peso de tinta, y respira */}
      <circle className="emblem-breathe" cx="60" cy="30" r="1.8" fill="currentColor" fillOpacity="0.85" />
      <g stroke="currentColor" fill="none" strokeWidth={inkStroke(size, 0.6)} strokeOpacity={ink(0.2)}>
        <circle cx="24" cy="47" r="3" />
        <circle cx="96" cy="47" r="3" />
      </g>
    </svg>
  );
}

/**
 * El pórtico — la casa que custodia. Seis columnas acanaladas, su arquitrabe
 * y el frontón; debajo, las gradas. El grabado de las bóvedas gestionadas.
 */
export function ColonnadeMark({ size = 120 }: { size?: number }) {
  const columns = [30, 42, 54, 66, 78, 90];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.55">
        {/* frontón */}
        <path d="M18 40 L60 18 L102 40 Z" />
        <path d="M28 38 L60 25 L92 38" strokeOpacity="0.28" />
        {/* arquitrabe */}
        <path d="M20 44 H100" />
        <path d="M22 50 H98" strokeOpacity="0.35" />
        {/* gradas */}
        <path d="M20 88 H100 M16 94 H104 M12 100 H108" />
      </g>
      <g stroke="currentColor" fill="none" strokeWidth="0.9" strokeOpacity="0.45">
        {columns.map((x) => (
          <g key={x}>
            <path d={`M${x} 52 V86`} />
            {/* la acanaladura: el pelo interior que hace que sea una columna
                y no un palo */}
            <path d={`M${x + 3} 54 V84`} strokeWidth="0.5" strokeOpacity="0.5" />
            <path d={`M${x - 2} 52 h7 M${x - 2} 86 h7`} strokeWidth="0.7" />
          </g>
        ))}
      </g>
      <circle className="emblem-breathe" cx="60" cy="33" r="2" fill="currentColor" fillOpacity="0.75" />
    </svg>
  );
}

/**
 * El registro — la página reglada con sus asientos y el sello al pie. El
 * grabado de «lo que ya está escrito»: el histórico, las posiciones, el acta.
 */
export function RegisterMark({ size = 120 }: { size?: number }) {
  const rules = [44, 52, 60, 68, 76];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.5">
        <path d="M26 16 H94 V104 H26 Z" />
        <path d="M30 20 H90 V100 H30 Z" strokeWidth="0.5" strokeOpacity="0.4" />
        <path d="M38 16 V104" strokeWidth="0.5" strokeOpacity="0.35" />
        <path d="M38 30 H86" strokeWidth="0.9" />
      </g>
      <g stroke="currentColor" fill="none" strokeWidth="0.6" strokeOpacity="0.3">
        {rules.map((y) => (
          <path key={y} d={`M42 ${y} H${y % 16 === 0 ? 78 : 86}`} />
        ))}
      </g>
      {/* el sello al pie, con su orla de guilloché en pequeño */}
      <g className="emblem-turn" style={{ transformOrigin: '72px 88px' }}>
        <circle cx="72" cy="88" r="10" stroke="currentColor" fill="none" strokeWidth="0.7" strokeOpacity="0.5" strokeDasharray="0.1 3" strokeLinecap="round" />
      </g>
      <circle cx="72" cy="88" r="7" stroke="currentColor" fill="none" strokeWidth="0.8" strokeOpacity="0.45" />
      <circle className="emblem-breathe" cx="72" cy="88" r="2.4" fill="currentColor" fillOpacity="0.8" />
    </svg>
  );
}

/* ── LOS GRABADOS DE LAS PÁGINAS (2026-09-14) ───────────────────────────────
   Fundador: «el tema me gusta mucho, pero quiero que se infiltre todavía
   más». Hasta hoy solo las tres puertas del Earn cambiaban de dibujo; el
   resto del panel —Portfolio, Home, Wallets, Ajustes, Estrategias, Legacy—
   seguía montando las escenas de ESPACIO (ui/scenes.tsx: el faro de satélites,
   el campo de planetas, los diales de la consola) con el bronce encima. Un
   filtro de color, que es justo lo que este tema no debía ser.

   Dos grabados nuevos cubren las dos escenas que más se repiten:

     · MeridianMark — el GLOBO de meridianos y paralelos, el mapa de capital
                      de un atlas grabado. Sustituye a CapitalField (los
                      planetas del Portfolio).
     · SignetMark   — el SELLO con sus firmas: los signatarios como anillos
                      alrededor del sello, cada uno con su rúbrica hacia el
                      centro. Sustituye a SignalBeacon (los satélites de
                      Wallets, Home y Posiciones) y a CouncilScene (los
                      firmantes del consejo): las dos cosas son lo mismo
                      visto desde un registro — cuentas que firman.

   El pórtico ya cubría al templo de Legacy y el registro a la consola de
   Ajustes y al libro del Legacy; la firma que se escribe sola (SignatureScene)
   se queda: en bronce y sin halo es exactamente la rúbrica de un documento.

   Geometría calculada, no dibujada a mano: las elipses del globo salen de la
   proyección real de una esfera (rx = R·sin λ para un meridiano a longitud λ,
   rx = R·cos φ para un paralelo a latitud φ) y los anillos del sello de un
   reparto regular. Sus parámetros se exportan para que skinMarks.test.ts los
   compruebe como al hipotrocoide: que quepan y que no colapsen. */

/** El globo: radio del disco y las longitudes de sus meridianos (grados).
 *  ±90° NO está: sería el propio contorno y pintaría el filete dos veces. */
export const MERIDIAN_R = 42;
export const MERIDIAN_LONGITUDES: readonly number[] = [22.5, 45, 67.5];
/** Latitudes de los paralelos (grados). 0 es el ecuador. */
export const MERIDIAN_LATITUDES: readonly number[] = [0, 30, 60];
/** Inclinación aparente del eje: cuánto se «abre» un paralelo. */
export const MERIDIAN_TILT = 0.22;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Un meridiano a longitud λ, visto de frente: elipse vertical de rx = R·sin λ. */
export function meridianRx(lambdaDeg: number, R = MERIDIAN_R): number {
  return R * Math.sin(toRad(lambdaDeg));
}
/** Un paralelo a latitud φ: elipse horizontal de rx = R·cos φ a altura R·sin φ,
 *  abierta por la inclinación del eje (ry = rx · tilt). */
export function parallelGeom(phiDeg: number, R = MERIDIAN_R, tilt = MERIDIAN_TILT): { rx: number; ry: number; dy: number } {
  const rx = R * Math.cos(toRad(phiDeg));
  return { rx, ry: rx * tilt, dy: R * Math.sin(toRad(phiDeg)) };
}

/**
 * El globo de meridianos — el mapa de capital de un atlas grabado. Nada gira:
 * un globo que gira sobre su eje visto de frente barre como un radar, y eso
 * es la escena que este grabado sustituye. Respira el polo, y basta.
 */
export function MeridianMark({ size = 120 }: { size?: number }) {
  const w = inkStroke(size, 0.8);
  const ink = (o: number) => inkOpacity(size, o, w, 0.8);
  const c = 60;
  const R = MERIDIAN_R;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth={w} strokeLinecap="round">
        {/* el disco y su orla */}
        <circle cx={c} cy={c} r={R} strokeOpacity={ink(0.55)} strokeWidth={inkStroke(size, 1)} />
        <circle cx={c} cy={c} r={R + 5} strokeOpacity={ink(0.22)} strokeWidth={inkStroke(size, 0.6)} />
        {/* los meridianos: a cada lado del central */}
        <path d={`M${c} ${c - R} V${c + R}`} strokeOpacity={ink(0.4)} />
        {MERIDIAN_LONGITUDES.map((lam) => {
          const rx = meridianRx(lam, R);
          return (
            <g key={lam} strokeOpacity={ink(0.32)}>
              <ellipse cx={c} cy={c} rx={rx} ry={R} />
            </g>
          );
        })}
        {/* los paralelos: el ecuador y dos a cada hemisferio, abiertos por la
            inclinación del eje para que el disco se lea como esfera */}
        {MERIDIAN_LATITUDES.map((phi) => {
          const { rx, ry, dy } = parallelGeom(phi, R);
          const rows = phi === 0 ? [0] : [dy, -dy];
          return rows.map((d) => (
            <ellipse key={`${phi}:${d}`} cx={c} cy={c + d} rx={rx} ry={Math.max(ry, 0.8)} strokeOpacity={ink(phi === 0 ? 0.42 : 0.26)} />
          ));
        })}
      </g>
      {/* el polo: el único punto con peso de tinta, y respira */}
      <circle className="emblem-breathe" cx={c} cy={c - R} r="2.2" fill="currentColor" fillOpacity="0.8" />
      {/* la peana: dos filetes cortos bajo el globo */}
      <g stroke="currentColor" fill="none" strokeWidth={inkStroke(size, 0.9)} strokeLinecap="round" strokeOpacity={ink(0.4)}>
        <path d={`M${c - 14} ${c + R + 11} H${c + 14}`} />
        <path d={`M${c - 9} ${c + R + 15} H${c + 9}`} strokeOpacity={ink(0.24)} />
      </g>
    </svg>
  );
}

/** El sello: cuántos signatarios lo rodean y a qué radio. */
export const SIGNET_SIGNERS = 6;
export const SIGNET_ORBIT = 40;
export const SIGNET_RING = 4.5;
export const SIGNET_SEAL = 12;

/** Los signatarios, en reparto regular empezando arriba. */
export function signetPositions(n = SIGNET_SIGNERS, orbit = SIGNET_ORBIT, c = 60): { x: number; y: number; a: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: c + Math.cos(a) * orbit, y: c + Math.sin(a) * orbit, a };
  });
}

/**
 * El sello con sus firmas — las cuentas que firman ante el registro. El
 * grabado de las wallets, de los signatarios de un consejo y de las
 * posiciones. Los signatarios dan la vuelta al sello muy despacio (el mismo
 * pulso que las demás placas); el sello respira.
 */
export function SignetMark({ size = 120 }: { size?: number }) {
  const w = inkStroke(size, 0.9);
  const ink = (o: number) => inkOpacity(size, o, w, 0.9);
  const c = 60;
  const signers = signetPositions();
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g stroke="currentColor" fill="none" strokeWidth={w} strokeLinecap="round">
        {/* la orla del registro */}
        <circle cx={c} cy={c} r="56" strokeOpacity={ink(0.4)} strokeWidth={inkStroke(size, 1)} />
        <circle cx={c} cy={c} r="53" strokeOpacity={ink(0.2)} strokeWidth={inkStroke(size, 0.6)} />
        {/* los signatarios y sus rúbricas, dando la vuelta */}
        <g className="emblem-turn" style={{ transformOrigin: `${c}px ${c}px` }}>
          {signers.map(({ x, y, a }, i) => {
            // la rúbrica: del anillo hacia el sello, parando antes de tocarlo
            const x1 = c + Math.cos(a) * (SIGNET_ORBIT - SIGNET_RING - 1.5);
            const y1 = c + Math.sin(a) * (SIGNET_ORBIT - SIGNET_RING - 1.5);
            const x2 = c + Math.cos(a) * (SIGNET_SEAL + 5);
            const y2 = c + Math.sin(a) * (SIGNET_SEAL + 5);
            // el trazo de la firma: un pequeño gancho al final, como una rúbrica
            const hx = c + Math.cos(a + 0.35) * (SIGNET_SEAL + 8);
            const hy = c + Math.sin(a + 0.35) * (SIGNET_SEAL + 8);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={SIGNET_RING} strokeOpacity={ink(0.5)} />
                <path d={`M${x1} ${y1} L${x2} ${y2} Q${(x2 + hx) / 2} ${(y2 + hy) / 2} ${hx} ${hy}`} strokeOpacity={ink(0.3)} />
              </g>
            );
          })}
        </g>
        {/* el sello: doble aro y su cruz de registro */}
        <circle cx={c} cy={c} r={SIGNET_SEAL} strokeOpacity={ink(0.6)} strokeWidth={inkStroke(size, 1)} />
        <circle cx={c} cy={c} r={SIGNET_SEAL - 3} strokeOpacity={ink(0.3)} strokeWidth={inkStroke(size, 0.6)} />
      </g>
      <g className="emblem-breathe">
        <circle cx={c} cy={c} r="3" fill="currentColor" fillOpacity="0.8" />
      </g>
    </svg>
  );
}

/**
 * EL FONDO DEL TEMA — el rayado de seguridad.
 *
 * Sustituye al campo de estrellas, las dos auras y el grano de BackgroundFx:
 * una trama de ondas finísimas, dos rosetas enormes muy apagadas y una
 * viñeta. No brilla, no se difumina y no se mueve más que el latido lento de
 * la casa — es papel, no cielo.
 */
export function GuillocheField() {
  const id = useId().replace(/:/g, '');
  const wave = `g-wave-${id}`;
  const fade = `g-fade-${id}`;
  return (
    <svg className="absolute inset-0 h-full w-full text-volt" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        {/* La trama: una onda que se repite. 3px de alto la hace leerse como
            una TEXTURA a tamaño de pantalla, no como un patrón de rayas. */}
        <pattern id={wave} width="24" height="6" patternUnits="userSpaceOnUse">
          <path
            d="M0 3 q6 -3 12 0 t12 0"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="0.4"
          />
        </pattern>
        {/* La viñeta: la trama se apaga hacia los bordes para que el contenido
            del panel siempre gane. */}
        <radialGradient id={fade} cx="50%" cy="34%" r="78%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="58%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`m-${id}`}>
          <rect width="100%" height="100%" fill={`url(#${fade})`} />
        </mask>
      </defs>
      <g mask={`url(#m-${id})`}>
        <rect width="100%" height="100%" fill={`url(#${wave})`} opacity="0.22" />
        {/* Las dos rosetas de marca de agua, en las esquinas donde el
            contenido no vive. */}
        <g
          className="plate-breathe"
          stroke="currentColor"
          fill="none"
          strokeWidth="0.5"
          strokeOpacity="0.3"
          transform="translate(-40 -70) scale(1.6)"
        >
          {FIELD_ROSETTE.map((d) => (
            <path key={d.slice(0, 24)} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}

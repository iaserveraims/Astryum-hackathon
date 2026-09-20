import { describe, expect, it } from 'vitest';

/**
 * LA ENTRADA DE LA LÁMINA (2026-09-14) — las reglas que sostienen «la lámina
 * se imprime» y que ningún test vigilaba:
 *
 *   1. EL MOVIMIENTO MANDA SOBRE EL TEMA. Quien pidió Mínimo pidió que nada se
 *      mueva, y un tema no puede devolverle una impresión: en minimal se funde
 *      sea cual sea el tema. Y en Sereno y Completo, el tema institucional
 *      imprime SIEMPRE — no hay versión posada de la lámina.
 *   2. LA PALETA GRABADA CONSERVA EL TONO. Atenuar un color de gráfico no
 *      puede cambiar de qué color es: el azul de XRP sigue siendo azul, que es
 *      lo que hace reconocible al activo en todos los anillos y lo único que
 *      sobrevive al daltonismo. Solo bajan saturación y contraste de luz.
 *   3. LA TINTA SE LEE SOBRE SU PAPEL. Cada porción de un anillo es contenido,
 *      y WCAG 1.4.11 pide 3:1 contra el fondo para los gráficos. Una sola luz
 *      para las dos caras fallaba en claro (astryum-73 midió 2,5–3,3:1); por
 *      eso la luz objetivo es por cara, y se comprueba aquí contra las
 *      superficies REALES del tema (globals.css), no contra un negro y un
 *      blanco de mentira.
 *   4. EL VELO. Las entradas esperan a que caiga el velo del arranque; la
 *      señal falla hacia «levantado»: nada puede quedarse recortado esperando
 *      a un velo que no existe.
 */

import { resolveRevealStyle } from '../motion';
import { ENGRAVED_L_DARK, ENGRAVED_L_LIGHT, chartColorsFor, engravedTone } from '../charts';
import { isVeilLifted, setVeilLifted, subscribeVeil } from '../../../lib/motion/veil';

describe('resolveRevealStyle — el movimiento manda sobre el tema', () => {
  it('en Mínimo se funde, con o sin lámina, sea primera visita o no', () => {
    for (const engraved of [false, true]) {
      for (const first of [true, false]) {
        expect(resolveRevealStyle('minimal', engraved, first)).toBe('fade');
      }
    }
  });

  it('la lámina imprime en Completo y en Sereno; la revisita imprime más corto', () => {
    for (const level of ['full', 'calm'] as const) {
      expect(resolveRevealStyle(level, true, true)).toBe('print');
      expect(resolveRevealStyle(level, true, false)).toBe('print-settle');
    }
  });

  it('Astryum no cambia: se posa la primera vez, funde en la revisita, y en Sereno se posa despacio', () => {
    expect(resolveRevealStyle('full', false, true)).toBe('rise');
    expect(resolveRevealStyle('full', false, false)).toBe('fade');
    expect(resolveRevealStyle('calm', false, true)).toBe('calm');
    expect(resolveRevealStyle('calm', false, false)).toBe('calm');
  });
});

/* ── Color: de hsl a luminancia, para medir y no suponer ─────────────────── */

/** hsl(...) de vuelta a números, para comprobar la regla y no el texto. */
function parseHsl(s: string): { h: number; s: number; l: number } {
  const m = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(s);
  if (!m) throw new Error(`no es un hsl plano: ${s}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Luminancia relativa WCAG a partir de sRGB 0..1. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Las superficies REALES de la lámina — copiadas de globals.css
 *  ([data-skin='institutional'] --surface-1 y su cara clara). Si cambian
 *  allí, este test es el que avisa de que la tinta ya no se lee. */
const SURFACE_DARK = hslToRgb(210, 9, 10);
const SURFACE_LIGHT = hslToRgb(45, 25, 97);

/** Toda la tinta que puede caer en un anillo: la paleta, los activos fijos
 *  y los estados. Un hex nuevo en charts.tsx tiene que entrar aquí. */
const INKS: [string, string][] = [
  ['cobalto (XRP)', '#5B8DEF'],
  ['azul claro (FXRP)', '#93C5FD'],
  ['rosa (Flare)', '#EC4899'],
  ['menta', '#3ECFA3'],
  ['ámbar', '#B45309'],
  ['violeta', '#8B5CF6'],
  ['pizarra (sin generar)', '#94A3B8'],
  ['ámbar (en camino)', '#D97706'],
];

describe('engravedTone — tinta, no luz', () => {
  it('deja los tokens en paz: el bronce ya es bronce', () => {
    expect(engravedTone('hsl(var(--volt))')).toBe('hsl(var(--volt))');
    expect(engravedTone('hsl(var(--volt) / 0.75)')).toBe('hsl(var(--volt) / 0.75)');
  });

  it('conserva el tono de cada activo (±2°) y baja la saturación a menos de la mitad', () => {
    const cases: [string, number][] = [
      ['#5B8DEF', 220],
      ['#EC4899', 330],
      ['#3ECFA3', 162],
      ['#8B5CF6', 258],
    ];
    for (const targetL of [ENGRAVED_L_DARK, ENGRAVED_L_LIGHT]) {
      for (const [hex, hue] of cases) {
        const out = parseHsl(engravedTone(hex, targetL));
        expect(Math.abs(out.h - hue)).toBeLessThanOrEqual(2);
        expect(out.s).toBeLessThan(50);
        expect(out.s).toBeGreaterThan(10); // atenuado, no gris: seguiría siendo distinguible
      }
    }
  });

  it('cada tinta pasa el 3:1 de WCAG 1.4.11 contra la superficie de SU cara', () => {
    for (const [name, hex] of INKS) {
      const dark = parseHsl(engravedTone(hex, ENGRAVED_L_DARK));
      const light = parseHsl(engravedTone(hex, ENGRAVED_L_LIGHT));
      const cDark = contrast(hslToRgb(dark.h, dark.s, dark.l), SURFACE_DARK);
      const cLight = contrast(hslToRgb(light.h, light.s, light.l), SURFACE_LIGHT);
      expect(cDark, `${name} sobre grafito: ${cDark.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      expect(cLight, `${name} sobre papel: ${cLight.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('dos activos del mismo azul siguen separables por luz después de atenuar, en las dos caras', () => {
    for (const targetL of [ENGRAVED_L_DARK, ENGRAVED_L_LIGHT]) {
      const a = parseHsl(engravedTone('#5B8DEF', targetL));
      const b = parseHsl(engravedTone('#93C5FD', targetL)); // FXRP: el mismo azul un paso más claro
      expect(Math.abs(a.h - b.h)).toBeLessThan(15); // misma familia
      expect(b.l - a.l).toBeGreaterThanOrEqual(5); // y aun así separables por luz
    }
  });

  it('anillo y leyenda salen iguales por construcción: chartColorsFor es determinista por nombres y cara', () => {
    const names = ['Kinetic', 'XRP', 'FXRP', 'FLR'];
    const a = chartColorsFor(names, { engraved: true, light: true });
    const b = chartColorsFor(names, { engraved: true, light: true });
    expect(a).toEqual(b);
    // y sin lámina no se toca nada: el primer nombre sin color fijo recibe el
    // token de la casa, y los activos fijos (XRP/FXRP/FLR) su hex de siempre
    expect(chartColorsFor(names)).toEqual(chartColorsFor(names, { engraved: false }));
    expect(chartColorsFor(names)[0]).toBe('hsl(var(--volt))');
    expect(chartColorsFor(names)[1]).toBe('#5B8DEF');
    // con lámina, el token sigue siendo el token y el hex se atenúa
    expect(a[0]).toBe('hsl(var(--volt))');
    expect(a[1]).not.toBe('#5B8DEF');
  });

  it('un valor que no es hex se devuelve tal cual, nunca roto', () => {
    expect(engravedTone('rebeccapurple')).toBe('rebeccapurple');
    expect(engravedTone('#fff')).toBe('#fff');
  });
});

describe('el velo del arranque — la señal que espera la entrada', () => {
  it('por defecto está levantado: fuera de la puerta nada se queda recortado', () => {
    expect(isVeilLifted()).toBe(true);
  });

  it('avisa a quien escucha solo cuando cambia, y vuelve a levantarse', () => {
    let calls = 0;
    const off = subscribeVeil(() => {
      calls += 1;
    });
    setVeilLifted(false);
    expect(isVeilLifted()).toBe(false);
    expect(calls).toBe(1);
    setVeilLifted(false); // sin cambio, sin aviso
    expect(calls).toBe(1);
    setVeilLifted(true);
    expect(isVeilLifted()).toBe(true);
    expect(calls).toBe(2);
    off();
    setVeilLifted(false);
    expect(calls).toBe(2); // ya no escucha
    setVeilLifted(true); // se deja como estaba
  });
});

/* ── El cambio de tema (2026-09-14): la regla que produjo «la página en gris» ─ */
import { REVEAL_VARIANTS } from '../motion';
import { bumpSkinEpoch, getSkinEpoch, subscribeSkinEpoch } from '../../../lib/theme/sweep';

describe('las variantes de entrada — mismas propiedades en todos los estados', () => {
  const animatable = (v: unknown): string[] =>
    Object.keys(v as Record<string, unknown>)
      .filter((k) => k !== 'transition' && k !== 'transitionEnd')
      .sort();

  it('cada estilo declara EXACTAMENTE opacity, y y clipPath en oculto y en visto', () => {
    // Cuando un componente montado cambia de juego de variantes (cambio de
    // tema), framer restaura a su valor inicial cualquier propiedad que
    // desaparezca del objetivo. Con las tres en todos los estados, nada
    // desaparece: medido en el DOM el 14-sep (opacity 0.35 residual).
    for (const [name, v] of Object.entries(REVEAL_VARIANTS)) {
      const hidden = animatable(v.hidden);
      const shown = animatable(typeof v.shown === 'function' ? (v.shown as (d: number) => unknown)(0) : v.shown);
      expect(hidden, `${name}.hidden`).toEqual(['clipPath', 'opacity', 'y']);
      expect(shown, `${name}.shown`).toEqual(['clipPath', 'opacity', 'y']);
    }
  });

  it('todo «oculto» es instantáneo: el salto al volver a jugar la entrada no se ve', () => {
    for (const [name, v] of Object.entries(REVEAL_VARIANTS)) {
      const t = (v.hidden as { transition?: { duration?: number } }).transition;
      expect(t?.duration, `${name}.hidden`).toBe(0);
    }
  });

  it('los estilos de la lámina abren el recorte y lo retiran al terminar; los de Astryum nunca recortan', () => {
    for (const name of ['print', 'print-settle'] as const) {
      const shown = (REVEAL_VARIANTS[name].shown as (d: number) => { clipPath: string; transitionEnd?: { clipPath?: string } })(0);
      expect(shown.clipPath).toBe('inset(0 0% 0 0)');
      expect(shown.transitionEnd?.clipPath).toBe('none');
    }
    for (const name of ['rise', 'fade', 'calm'] as const) {
      const shown = (REVEAL_VARIANTS[name].shown as (d: number) => { clipPath: string })(0);
      expect(shown.clipPath).toBe('none');
      expect((REVEAL_VARIANTS[name].hidden as { clipPath: string }).clipPath).toBe('none');
    }
  });
});

describe('la época del tema — la señal del barrido', () => {
  it('arranca en cero, sube de uno en uno y avisa a quien escucha', () => {
    const start = getSkinEpoch();
    let calls = 0;
    const off = subscribeSkinEpoch(() => {
      calls += 1;
    });
    bumpSkinEpoch();
    expect(getSkinEpoch()).toBe(start + 1);
    expect(calls).toBe(1);
    off();
    bumpSkinEpoch();
    expect(calls).toBe(1);
    expect(getSkinEpoch()).toBe(start + 2);
  });
});

import { describe, expect, it } from 'vitest';
import vm from 'node:vm';

/**
 * LA APARIENCIA (2026-09-13) — las reglas que sostienen el ajuste y que nadie
 * más vigila:
 *
 *   1. Son DOS EJES. El TEMA dice de qué material está hecho el panel y solo
 *      tiene dos valores; la LUZ conserva sus tres, «system» incluida. El
 *      dispositivo opina sobre la luz y NO opina sobre si eres una institución.
 *   2. El script pre-pintado resuelve EXACTAMENTE igual que el store, respeta
 *      la frontera del panel (fuera de /app no estampa nada) y sobrevive a un
 *      localStorage roto o ausente. Es JS dentro de una cadena — el compilador
 *      no lo mira, así que se ejecuta aquí tal cual se inyecta.
 */

import {
  APPEARANCE_STORAGE_KEY,
  APP_THEMES,
  DEFAULT_APPEARANCE,
  SKINS,
  SKIN_ATTRIBUTE,
  THEME_ATTRIBUTE,
  isAppTheme,
  isSkin,
  pathWearsAppearance,
  readAppearance,
  resolveTheme,
} from '../../lib/theme/appearance';
import { appearancePrepaintScript } from '../../lib/theme/prepaint';

describe('los dos ejes', () => {
  it('son dos temas y el de la casa es Astryum', () => {
    expect(SKINS).toEqual(['astryum', 'institutional']);
    expect(DEFAULT_APPEARANCE).toEqual({ skin: 'astryum', theme: 'dark' });
  });

  it('«system» es de la LUZ, nunca del TEMA', () => {
    expect(APP_THEMES).toContain('system');
    expect(isAppTheme('system')).toBe(true);
    expect(isSkin('system')).toBe(false);
  });

  it('un valor inventado no es ni tema ni luz', () => {
    for (const s of SKINS) expect(isSkin(s)).toBe(true);
    for (const t of APP_THEMES) expect(isAppTheme(t)).toBe(true);
    expect(isSkin('bank')).toBe(false);
    expect(isSkin(undefined)).toBe(false);
    expect(isAppTheme(3)).toBe(false);
  });

  it('«system» se resuelve contra el dispositivo; los otros dos mandan siempre', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('readAppearance nunca devuelve un tema a medio vestir', () => {
    expect(readAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ skin: 'bank', theme: 'sepia' })).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ skin: 'institutional' })).toEqual({ skin: 'institutional', theme: 'dark' });
    expect(readAppearance(['institutional'])).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('la frontera del panel — la web pública no lleva la apariencia de nadie', () => {
  it('el panel sí', () => {
    expect(pathWearsAppearance('/app')).toBe(true);
    expect(pathWearsAppearance('/app/settings')).toBe(true);
    expect(pathWearsAppearance('/app/earn/x')).toBe(true);
  });

  it('la portada, el login y las páginas legales no', () => {
    expect(pathWearsAppearance('/')).toBe(false);
    expect(pathWearsAppearance('/login')).toBe(false);
    expect(pathWearsAppearance('/privacy')).toBe(false);
    expect(pathWearsAppearance('/demo-terms')).toBe(false);
  });

  it('y una ruta que solo EMPIEZA como /app tampoco (el prefijo no es una palabra)', () => {
    expect(pathWearsAppearance('/apple')).toBe(false);
    expect(pathWearsAppearance('/appearance')).toBe(false);
  });
});

/** Ejecuta el script inyectado contra un navegador de mentira. */
function runPrepaint(opts: {
  path?: string;
  stored?: string | null;
  osLight?: boolean;
  brokenStorage?: boolean;
}) {
  const attrs: Record<string, string> = {};
  const sandbox = {
    window: {
      location: { pathname: opts.path ?? '/app' },
      localStorage: opts.brokenStorage
        ? {
            getItem() {
              throw new Error('SecurityError');
            },
          }
        : { getItem: (k: string) => (k === APPEARANCE_STORAGE_KEY ? (opts.stored ?? null) : null) },
      matchMedia: (q: string) => ({ matches: q.includes('light') ? !!opts.osLight : false }),
    },
    document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
  };
  vm.runInNewContext(appearancePrepaintScript(), sandbox);
  return { skin: attrs[SKIN_ATTRIBUTE], theme: attrs[THEME_ATTRIBUTE] };
}

/** Lo que zustand/persist deja en localStorage. */
const persisted = (state: Record<string, unknown>) => JSON.stringify({ state, version: 0 });

describe('appearancePrepaintScript', () => {
  it('sin nada guardado estampa el tema de la casa', () => {
    expect(runPrepaint({ stored: null })).toEqual({ skin: 'astryum', theme: 'dark' });
  });

  it('con una elección guardada la estampa tal cual', () => {
    for (const skin of SKINS) {
      for (const theme of ['dark', 'light'] as const) {
        expect(runPrepaint({ stored: persisted({ skin, theme }) })).toEqual({ skin, theme });
      }
    }
  });

  it('«system» se resuelve ANTES del primer frame, no después', () => {
    expect(runPrepaint({ stored: persisted({ skin: 'institutional', theme: 'system' }), osLight: true })).toEqual({
      skin: 'institutional',
      theme: 'light',
    });
    expect(runPrepaint({ stored: persisted({ skin: 'institutional', theme: 'system' }), osLight: false })).toEqual({
      skin: 'institutional',
      theme: 'dark',
    });
  });

  it('FUERA DEL PANEL no estampa nada: la portada conserva su cara fija', () => {
    const stored = persisted({ skin: 'institutional', theme: 'light' });
    for (const path of ['/', '/login', '/privacy', '/apple', '/appearance']) {
      expect(runPrepaint({ path, stored })).toEqual({ skin: undefined, theme: undefined });
    }
  });

  it('un valor corrupto o inventado cae al tema de la casa, nunca a medio vestir', () => {
    expect(runPrepaint({ stored: persisted({ skin: 'bank', theme: 'sepia' }) })).toEqual({
      skin: 'astryum',
      theme: 'dark',
    });
    expect(runPrepaint({ stored: '{not json' })).toEqual({ skin: 'astryum', theme: 'dark' });
    // Un eje roto no puede arrastrar al otro.
    expect(runPrepaint({ stored: persisted({ skin: 'institutional', theme: 'sepia' }) })).toEqual({
      skin: 'institutional',
      theme: 'dark',
    });
  });

  it('un localStorage que lanza no rompe la carga — y el panel sale vestido igual', () => {
    expect(() => runPrepaint({ brokenStorage: true })).not.toThrow();
    expect(runPrepaint({ brokenStorage: true })).toEqual({ skin: 'astryum', theme: 'dark' });
  });
});

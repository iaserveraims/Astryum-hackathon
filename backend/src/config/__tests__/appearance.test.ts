/**
 * La apariencia de la cuenta — la lógica pura detrás de GET /me `appearance`
 * y POST /auth/appearance (fundador 2026-09-13: el tema tiene que seguir a la
 * cuenta, no al navegador).
 *
 * Dos cosas que nadie más vigila:
 *   1. Un valor desconocido o una columna medio escrita NUNCA dejan el panel a
 *      medio vestir: caen al tema de la casa, que es lo que la CSS ya pinta.
 *   2. Guardar el tema no puede borrar las claves hermanas de `preferences`.
 *      Esa columna la comparten la aceptación legal y el modo gestor: una
 *      escritura que la reemplace entera borra el consentimiento de alguien, y
 *      eso convierte un cambio de color en un incidente legal.
 */
import {
  DEFAULT_APPEARANCE,
  APP_THEMES,
  SKINS,
  isAppTheme,
  isSkin,
  readAppearance,
  withAppearance,
} from '../appearance';

describe('los dos ejes', () => {
  it('hay dos temas y el de la casa es Astryum', () => {
    expect(SKINS).toEqual(['astryum', 'institutional']);
    expect(DEFAULT_APPEARANCE.skin).toBe('astryum');
  });

  it('la luz conserva sus tres opciones, «system» incluida', () => {
    expect(APP_THEMES).toEqual(['dark', 'light', 'system']);
    expect(DEFAULT_APPEARANCE.theme).toBe('dark');
  });

  it('un valor inventado no es ni tema ni luz', () => {
    for (const s of SKINS) expect(isSkin(s)).toBe(true);
    for (const t of APP_THEMES) expect(isAppTheme(t)).toBe(true);
    expect(isSkin('bank')).toBe(false);
    expect(isSkin(undefined)).toBe(false);
    expect(isSkin(3)).toBe(false);
    expect(isAppTheme('sepia')).toBe(false);
    // El eje de la LUZ tiene «system»; el del TEMA no: el dispositivo no
    // tiene opinión sobre si eres una institución.
    expect(isSkin('system')).toBe(false);
  });
});

describe('readAppearance — leer una columna que puede venir de cualquier forma', () => {
  it('una cuenta sin nada elegido es el tema de la casa', () => {
    expect(readAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({})).toEqual(DEFAULT_APPEARANCE);
  });

  it('lee lo que la cuenta eligió de verdad', () => {
    const prefs = { appearance: { skin: 'institutional', theme: 'light' } };
    expect(readAppearance(prefs)).toEqual({ skin: 'institutional', theme: 'light' });
  });

  it('un registro a medias completa solo lo que falta', () => {
    expect(readAppearance({ appearance: { skin: 'institutional' } })).toEqual({
      skin: 'institutional',
      theme: 'dark',
    });
    expect(readAppearance({ appearance: { theme: 'light' } })).toEqual({
      skin: 'astryum',
      theme: 'light',
    });
  });

  it('basura en la columna no deja el panel a medio vestir', () => {
    expect(readAppearance({ appearance: { skin: 'bank', theme: 'sepia' } })).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ appearance: 'institutional' })).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ appearance: ['institutional'] })).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance('nope')).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance([])).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('withAppearance — escribir sin romper a los vecinos', () => {
  it('PRESERVA las claves hermanas: cambiar de tema no borra la firma legal ni el modo gestor', () => {
    const prefs = {
      legal: { termsVersion: '2026-08-01.1', privacyVersion: '2026-09-13', acceptedAt: 'x' },
      managerMode: true,
      demoTerms: { version: '2026-07-30', acceptedAt: 'y' },
    };
    const next = withAppearance(prefs, { skin: 'institutional' });
    expect(next.legal).toEqual(prefs.legal);
    expect(next.managerMode).toBe(true);
    expect(next.demoTerms).toEqual(prefs.demoTerms);
    expect(next.appearance).toEqual({ skin: 'institutional', theme: 'dark' });
  });

  it('es un parche PARCIAL: tocar el tema no mueve la luz, y al revés', () => {
    const withSkin = withAppearance({ appearance: { skin: 'institutional', theme: 'light' } }, { theme: 'dark' });
    expect(withSkin.appearance).toEqual({ skin: 'institutional', theme: 'dark' });

    const withTheme = withAppearance({ appearance: { skin: 'institutional', theme: 'light' } }, { skin: 'astryum' });
    expect(withTheme.appearance).toEqual({ skin: 'astryum', theme: 'light' });
  });

  it('un parche vacío deja la apariencia como estaba', () => {
    const prefs = { appearance: { skin: 'institutional', theme: 'light' } };
    expect(withAppearance(prefs, {}).appearance).toEqual({ skin: 'institutional', theme: 'light' });
  });

  it('una columna nula o corrupta se convierte en un registro limpio sin lanzar', () => {
    expect(withAppearance(null, { skin: 'institutional' }).appearance).toEqual({
      skin: 'institutional',
      theme: 'dark',
    });
    expect(withAppearance('rota', { theme: 'light' }).appearance).toEqual({
      skin: 'astryum',
      theme: 'light',
    });
  });

  it('lo que se escribe se vuelve a leer igual (ida y vuelta)', () => {
    for (const skin of SKINS) {
      for (const theme of APP_THEMES) {
        expect(readAppearance(withAppearance({}, { skin, theme }))).toEqual({ skin, theme });
      }
    }
  });
});

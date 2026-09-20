import { EMPTY_ONBOARDING, readOnboarding, withOnboarding } from '../onboarding';

/**
 * El cuestionario de alta, EN LA CUENTA (fundador 2026-09-14: «inicio sesión
 * desde navegadores distintos y me vuelve a pedir una y otra vez lo mismo»).
 *
 * Lo que vigila este fichero es que contestar UNA VEZ baste: que el registro
 * sobreviva a un merge parcial (el cuestionario manda objetivo e idioma, el
 * selector de Ajustes solo el idioma, un tour solo su marca) y que una
 * columna JSON rara no lo dé por no contestado — que es exactamente como se
 * vuelve a preguntar lo mismo a alguien que ya respondió.
 */
const NOW = '2026-09-14T10:00:00.000Z';

describe('readOnboarding', () => {
  it('una cuenta sin nada guardado no ha contestado', () => {
    expect(readOnboarding(null)).toEqual(EMPTY_ONBOARDING);
    expect(readOnboarding({})).toEqual(EMPTY_ONBOARDING);
    expect(readOnboarding('basura')).toEqual(EMPTY_ONBOARDING);
    expect(readOnboarding({ onboarding: 7 })).toEqual(EMPTY_ONBOARDING);
  });

  it('no se cree un idioma ni un objetivo inventados', () => {
    const r = readOnboarding({ onboarding: { completed: true, lang: 'klingon', goal: 'x'.repeat(80) } });
    expect(r.completed).toBe(true);
    expect(r.lang).toBeNull();
    expect(r.goal).toBeNull();
  });

  it('de los tours solo se lee lo que es una marca de verdad', () => {
    const r = readOnboarding({ onboarding: { toursDone: { home: true, earn: false, 'ma!la': true, ok_1: true } } });
    expect(r.toursDone).toEqual({ home: true, ok_1: true });
  });
});

describe('withOnboarding: contestar una vez basta', () => {
  it('tras contestar, la cuenta lo sabe — y conserva las claves hermanas', () => {
    const base = { legal: { termsVersion: 'x' }, managerMode: true };
    const merged = withOnboarding(base, { completed: true, goal: 'protect', lang: 'es' }, NOW);
    expect(merged.legal).toEqual({ termsVersion: 'x' });
    expect(merged.managerMode).toBe(true);
    const rec = readOnboarding(merged);
    expect(rec).toEqual({ completed: true, goal: 'protect', lang: 'es', toursDone: {}, at: NOW });
  });

  it('un parche parcial NO borra lo ya contestado — el bug de volver a preguntar', () => {
    const first = withOnboarding({}, { completed: true, goal: 'generate', lang: 'es' }, NOW);
    // Ajustes cambia solo el idioma
    const second = withOnboarding(first, { lang: 'en' }, '2026-09-14T11:00:00.000Z');
    const rec = readOnboarding(second);
    expect(rec.completed).toBe(true);
    expect(rec.goal).toBe('generate');
    expect(rec.lang).toBe('en');
    // y la fecha de la respuesta es la ORIGINAL, no la del último toque
    expect(rec.at).toBe(NOW);
  });

  it('las marcas de tours se SUMAN, nunca se pisan', () => {
    const a = withOnboarding({}, { toursDone: { home: true } }, NOW);
    const b = withOnboarding(a, { toursDone: { earn: true } }, NOW);
    expect(readOnboarding(b).toursDone).toEqual({ home: true, earn: true });
  });

  it('saltar el cuestionario cuenta como contestado', () => {
    expect(readOnboarding(withOnboarding({}, { completed: true }, NOW)).completed).toBe(true);
  });

  it('marcar un tour sin haber contestado no da el cuestionario por hecho', () => {
    const rec = readOnboarding(withOnboarding({}, { toursDone: { home: true } }, NOW));
    expect(rec.completed).toBe(false);
    expect(rec.at).toBeNull();
  });
});

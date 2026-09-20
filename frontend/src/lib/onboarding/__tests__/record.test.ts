import { describe, expect, it } from 'vitest';
import { EMPTY_ONBOARDING, hasAnswer, readOnboarding } from '../record';

/**
 * El espejo de cliente del registro de alta. Lo que vigila:
 *
 *  1. Un backend VIEJO (sin el campo) no puede borrar lo que esta persona
 *     acaba de contestar en este navegador — `hasAnswer` es esa frontera, y
 *     sin ella el arreglo de «no me lo vuelvas a preguntar» se convertiría en
 *     «olvídalo en cada arranque», que es peor que el bug original.
 *  2. Ninguna preferencia corrupta puede colar un idioma inventado.
 */
describe('readOnboarding (cliente)', () => {
  it('lo que no es un registro da el registro vacío', () => {
    for (const raw of [null, undefined, 7, 'x', []]) {
      expect(readOnboarding(raw)).toEqual(EMPTY_ONBOARDING);
    }
  });

  it('lee lo bueno y descarta lo inventado', () => {
    const r = readOnboarding({ completed: true, goal: 'protect', lang: 'es', toursDone: { home: true, mal: 1 } });
    expect(r).toEqual({ completed: true, goal: 'protect', lang: 'es', toursDone: { home: true }, at: null });
    expect(readOnboarding({ lang: 'klingon' }).lang).toBeNull();
  });
});

describe('hasAnswer: la cuenta solo pisa a lo local cuando tiene algo que decir', () => {
  it('un registro vacío NO pisa lo local', () => {
    expect(hasAnswer(EMPTY_ONBOARDING)).toBe(false);
    expect(hasAnswer(readOnboarding({}))).toBe(false);
  });

  it('cualquier señal cuenta como respuesta', () => {
    expect(hasAnswer(readOnboarding({ completed: true }))).toBe(true);
    expect(hasAnswer(readOnboarding({ lang: 'en' }))).toBe(true);
    expect(hasAnswer(readOnboarding({ goal: 'manage' }))).toBe(true);
    expect(hasAnswer(readOnboarding({ toursDone: { earn: true } }))).toBe(true);
  });
});

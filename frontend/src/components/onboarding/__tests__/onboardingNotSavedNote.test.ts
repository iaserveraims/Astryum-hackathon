import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `persistRefusal` Y `ONBOARDING_NOT_SAVED_*` SIN
 * NINGÚN CONSUMIDOR.
 *
 * Hizo que el store del asistente anotara por qué la última escritura no
 * llegó a la cuenta (409 `PREFERENCES_UNREADABLE`, otro rechazo, sin red) y
 * escribió la frase en los dos idiomas. Tres iteraciones después, `grep` seguía
 * encontrando las dos cosas solo en el store y en su test: la persona a la que
 * el asistente le vuelve a saltar en cada navegador seguía sin una palabra.
 *
 * El consumidor es el propio asistente, con el modal CERRADO: una nota de
 * esquina (sin overlay, sin `inset-0`, con su cierre), nunca un modal — lo local
 * sostiene la sesión y no se pide nada. Sin DOM en esta suite: se fija por fuente.
 */
const SRC = readFileSync(join(__dirname, '..', 'OnboardingModal.tsx'), 'utf8');

describe('OnboardingModal pinta la razón de «no se guardó en tu cuenta»', () => {
  it('lee `persistRefusal` del store y las dos frases del store — no una copia', () => {
    expect(SRC).toMatch(/const persistRefusal = useOnboardingStore\(\(s\) => s\.persistRefusal\)/);
    expect(SRC).toMatch(/ONBOARDING_NOT_SAVED_EN,\s*ONBOARDING_NOT_SAVED_ES,/);
    expect(SRC).toMatch(/\{es \? ONBOARDING_NOT_SAVED_ES : ONBOARDING_NOT_SAVED_EN\}/);
  });

  it('solo con el asistente cerrado, como nota de esquina y con su propio cierre — jamás un modal', () => {
    const at = SRC.indexOf('if (!open) {');
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at, SRC.indexOf('const managerStep', at));
    expect(block).toMatch(/if \(!mounted \|\| !persistRefusal \|\| notSavedDismissedFor === persistRefusal\) return null;/);
    expect(block).toMatch(/fixed bottom-4 right-4/);
    // El JSX de la nota (no el comentario que explica lo que NO es).
    const jsx = block.slice(block.indexOf('return ('));
    expect(jsx).not.toMatch(/inset-0|backdrop-blur/);
    expect(block).toMatch(/role="status"/);
    expect(block).toMatch(/setNotSavedDismissedFor\(persistRefusal\)/);
  });

  it('la frase no acusa a quien lee y dice qué cuesta (nada) — igual que la nota legal', async () => {
    const { ONBOARDING_NOT_SAVED_EN } = await import('../../../stores/onboardingStore');
    expect(ONBOARDING_NOT_SAVED_EN).toMatch(/We could not save your answers to your account/);
    expect(ONBOARDING_NOT_SAVED_EN).toMatch(/nothing is being asked of you/);
    expect(ONBOARDING_NOT_SAVED_EN).not.toMatch(/you (did not|didn't|failed)/i);
  });
});

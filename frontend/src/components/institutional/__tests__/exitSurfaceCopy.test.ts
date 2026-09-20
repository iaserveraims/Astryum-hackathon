import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusalHeadline, serverDetailIfEnglish } from '@/lib/xaman/seatRefusal';
import { seatRefusalView } from '@/components/wallet/SeatRefusalNotice';

/**
 * LAS DOS SUPERFICIES DE SALIDA QUE LA SE DEJÓ.
 *
 * Aquella iteración dijo haber cerrado «el código crudo y el castellano» en las
 * diez superficies de salida y escribió la lista en
 * `components/wallet/__tests__/seatNoticePaths.test.ts`. Estas dos no estaban en
 * ella y seguían haciéndolo:
 */

const t = (s: string) => s;
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const SURFACES: Array<[string, string]> = [
  ['PoteExitModal', read('PoteExitModal.tsx')],
  ['UserVaultPanel', read('user', 'UserVaultPanel.tsx')],
];

/** Solo las líneas de CÓDIGO: un comentario que cite el patrón viejo no cuenta. */
const codeOf = (source: string): string =>
  source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('§1 — ni el código del servidor ni su castellano llegan a la pantalla', () => {
  for (const [name, source] of SURFACES) {
    const code = codeOf(source);

    it(`${name}: el slug jamás es el titular y el detalle jamás se pinta a pelo`, () => {
      // Lo que había, exactamente:
      expect(code, name).not.toMatch(/\{\s*[\w.]*refusal\.error\s*\}/);
      expect(code, name).not.toMatch(/\{\s*[\w.]*refusal\.detail\s*\}/);
      expect(code, name).not.toMatch(/\w+\.detail \?\? \w+\.error/);
      expect(code, name).not.toMatch(/\w+\.detail \|\| \w+\.error/);
      // Y lo que tiene que haber: el filtro compartido y una frase con nombre.
      expect(code, name).toMatch(/serverDetailIfEnglish/);
      expect(code, name).toMatch(/refusalHeadline/);
    });

    it(`${name}: todo lo que dice pasa el MISMO filtro que le aplica al servidor`, () => {
      // Si una frase nuestra no sobreviviera a `serverDetailIfEnglish`, es que
      // está en castellano — y entonces la pantalla le exige al servidor un
      // idioma que ella misma no habla.
      const said = [
        ...code.matchAll(/\bt\(\s*'([^']*)'/g),
        ...code.matchAll(/\bt\(\s*"([^"]*)"/g),
      ].map((m) => m[1]);
      expect(said.length, name).toBeGreaterThan(5);
      for (const phrase of said) {
        expect(serverDetailIfEnglish(phrase), `${name}: ${phrase}`).toBe(phrase);
      }
    });

    it(`${name}: sin frase usable del servidor queda una nuestra — nunca un hueco`, () => {
      expect(code, name).toMatch(/serverDetailIfEnglish\([^)]*\)\s*\?\?/);
    });
  }
});

describe('§1 — un rechazo de verdad, leído como frase', () => {
  const REAL = {
    status: 400,
    error: 'NOT_REDEEMABLE_NOW',
    detail: 'el pote está en cooldown: no se puede redimir hasta que venza el ticket',
  };

  it('el castellano del servidor se cae, y el slug no ocupa su sitio', () => {
    expect(serverDetailIfEnglish(REAL.detail)).toBeNull();
    const head = refusalHeadline(REAL, t);
    expect(head).not.toMatch(/NOT_REDEEMABLE_NOW/);
    expect(head).not.toBeNull();
    // Y dice las dos cosas que importan: nada se preparó, nada se firmó.
    expect(head).toMatch(/Nothing was prepared and nothing was signed/i);
  });

  it('un detalle en inglés SÍ sobrevive: perder un diagnóstico útil no es el arreglo', () => {
    expect(serverDetailIfEnglish('The ticket matures in 3 days.')).toBe('The ticket matures in 3 days.');
  });

  it('un rechazo cualquiera no inventa un aviso de asiento; los que sí, lo tienen', () => {
    // `seatRefusalView` es lo que decide si estas pantallas muestran el aviso
    // con botones. Un cooldown no es un asiento ni una lectura fallida nuestra.
    expect(seatRefusalView(REAL, t)).toBeNull();
    expect(seatRefusalView({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true }, t)?.mayTryAgain).toBe(true);
    expect(
      seatRefusalView({ status: 409, error: 'ACCOUNT_RECORD_MISSING', retryable: false }, t)?.maySignInWithWallet,
    ).toBe(true);
  });
});

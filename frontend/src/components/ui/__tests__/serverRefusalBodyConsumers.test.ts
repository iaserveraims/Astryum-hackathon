import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * productizer it. 34 (agente D) — LOS LECTORES QUE SEGUÍAN CON LA FRASE SOLA.
 *
 * `serverRefusalText` conserva la frase y tira `headline`, `ways[]` y la puerta
 * (it. 27 §3 las hizo viajar; `ServerRefusalBody` las pinta). Tres iteraciones
 * seguidas se anotaron los mismos residuales: `CmfReviewModal`, `SidebarIntents`
 * y `GovernedMoneyFlows` seguían poniendo la cadena en pantalla — sobre el 403
 * NOT_A_COUNCIL_MEMBER cuya única cura («register the wallet that holds your
 * seat») es una puerta que la cadena no puede abrir.
 *
 * Los tres pasan a `describeServerRefusal` + `<ServerRefusalBody>`. Se fija por
 * fuente que la migración es la de verdad (el cuerpo se pinta, no solo se
 * calcula) y que `serverRefusalText` no vuelve a esos catch.
 */
const COMPONENTS = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(COMPONENTS, rel), 'utf8');

const MIGRATED = ['earn/CmfReviewModal.tsx', 'intents/SidebarIntents.tsx', 'legacy/GovernedMoneyFlows.tsx'];

describe('los tres residuales pintan el rechazo entero', () => {
  for (const file of MIGRATED) {
    it(`${file}: describeServerRefusal en el catch y <ServerRefusalBody> en el render`, () => {
      const src = read(file);
      // La cadena ya no se llama (el nombre solo sobrevive en comentarios que explican el porqué).
      expect(src).not.toMatch(/serverRefusalText\(/);
      expect(src).toMatch(/describeServerRefusal\(e, t(Ref\.current)?\)/);
      expect(src).toMatch(/<ServerRefusalBody refusal=\{[^}]+\} t=\{t\} \/>/);
    });
  }

  it('SidebarIntents: la lectura ENTERA rechazada lleva el cuerpo; la parcial conserva su frase con su cuenta', () => {
    const src = read('intents/SidebarIntents.tsx');
    expect(src).toMatch(/setUnreadable\(\{ text: refusal\.text, partial: false, refusal \}\)/);
    // `councilTrayUnreadable` (la parcial, it. 25) no cambia de firma: otro test la extrae por ella.
    expect(src).toContain(
      'function councilTrayUnreadable(landed: { unreadable?: unknown } | null, t: (s: string) => string): CouncilUnreadableNotice | null {',
    );
    expect(src).toMatch(/councilUnreadable\.refusal \? \(\s*<ServerRefusalBody/);
  });

  it('CmfReviewModal y GovernedMoneyFlows: las validaciones locales siguen siendo frases; el rechazo se limpia al reintentar', () => {
    const cmf = read('earn/CmfReviewModal.tsx');
    expect(cmf).toMatch(/setErrors\(\[\]\);\s*setRefusal\(null\);/);
    expect(cmf).toMatch(/setErrors\(body\.errors\.map/);
    const gmf = read('legacy/GovernedMoneyFlows.tsx');
    expect(gmf).toMatch(/setError\(''\);\s*setRefusal\(null\);/);
    expect(gmf).toMatch(/return setError\(t\('Give the rule a name\.'\)\)/);
  });
});

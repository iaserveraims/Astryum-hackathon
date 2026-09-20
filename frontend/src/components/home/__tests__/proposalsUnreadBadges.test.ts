import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * productizer it. 34 (agente D) — `proposalsUnread` SOLO SE PINTABA EN StructuresBand.
 *
 * it. 27 (§6) hizo que `useAuthorities` MARCARA la cuenta cuya lectura de
 * propuestas se intentó y falló (`proposalsUnread: true`, recuentos en
 * `undefined`), porque una insignia que solo sale con un número positivo
 * convierte «no lo pude leer» en «no te toca firmar nada». La marca llegó a la
 * banda de estructuras y a NADIE MÁS: la estantería de Home (`HomeHub`,
 * `FleetDeck`) —donde se pregunta «¿tengo algo que firmar?»—, la barra de
 * gobierno (`GoverningBar`) y el selector de autoridad (`AuthoritySwitcher`)
 * seguían con `typeof x === 'number' && x > 0`, así que un Legacy con dos
 * firmas pendientes que nadie consiguió leer se veía EXACTAMENTE igual que uno
 * sin nada pendiente, justo en las cuatro superficies que un firmante mira.
 *
 * Sin DOM en esta suite (vitest en node): se fija POR FUENTE que cada consumidor
 * pinta la marca con la misma regla que la banda — solo cuando se INTENTÓ y
 * falló (`proposalsUnread`) y no hay número (`typeof … !== 'number'`) — y que la
 * palabra es «could not read», nunca un número inventado ni el silencio.
 */

const COMPONENTS = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(COMPONENTS, rel), 'utf8');

const CONSUMERS: Array<{ file: string; expr: RegExp }> = [
  { file: 'home/HomeHub.tsx', expr: /l\.proposalsUnread && typeof l\.pendingSignatures !== 'number'/ },
  { file: 'home/FleetDeck.tsx', expr: /l\.proposalsUnread && typeof l\.pendingSignatures !== 'number'/ },
  {
    file: 'authority/GoverningBar.tsx',
    expr: /activeGoverned\.proposalsUnread && typeof activeGoverned\.pendingSignatures !== 'number'/,
  },
  { file: 'authority/AuthoritySwitcher.tsx', expr: /a\.proposalsUnread && typeof a\.pendingSignatures !== 'number'/ },
];

describe('«¿tengo algo que firmar?» — la lectura fallida se ve en las cuatro superficies', () => {
  for (const { file, expr } of CONSUMERS) {
    it(`${file}: pinta «could not read» cuando se intentó leer y no se pudo, y solo entonces`, () => {
      const src = read(file);
      const at = src.search(expr);
      expect(at, `${file} no lee proposalsUnread`).toBeGreaterThan(-1);
      // La palabra, en el mismo bloque (las ~900 letras siguientes), no en otro sitio.
      const block = src.slice(at, at + 900);
      expect(block).toMatch(/could not read/);
      // Y la insignia con número sigue exigiendo un número LEÍDO y positivo.
      expect(src).toMatch(/typeof \w+(\.\w+)?\.pendingSignatures === 'number' && \w+(\.\w+)?\.pendingSignatures > 0/);
    });
  }

  it('la regla es la misma que la de StructuresBand (it. 27 §6): una sola gramática', () => {
    const band = read('legacy/StructuresBand.tsx');
    expect(band).toMatch(/structure\.proposalsUnread && typeof structure\.pendingSignatures !== 'number'/);
    expect(band).toMatch(/\{t\('To sign'\)\} · \{t\('could not read'\)\}/);
    // Home usa exactamente la misma píldora — misma palabra, misma forma.
    for (const file of ['home/HomeHub.tsx', 'home/FleetDeck.tsx']) {
      expect(read(file)).toMatch(/\{t\('To sign'\)\} · \{t\('could not read'\)\}/);
    }
  });

  it('el hook sigue poniendo la marca solo tras INTENTARLO (nunca durante la primera lectura)', () => {
    const hook = readFileSync(join(COMPONENTS, '..', 'hooks', 'useAuthorities.ts'), 'utf8');
    expect(hook).toMatch(/proposalsUnread: proposalsUnread\[c\.address\] === true/);
    // Se marca en el `catch` de la lectura, y una lectura que SÍ ocurrió la retira.
    expect(hook).toMatch(/setProposalsUnread\(\(prev\) => \(prev\[address\] \? prev : \{ \.\.\.prev, \[address\]: true \}\)\)/);
  });
});

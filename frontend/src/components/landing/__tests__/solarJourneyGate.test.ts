import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `LandingPageProduction` está congelada por hash, pero importa
 * `./SolarJourney` — y un hash no congela lo que un fichero importa. El 20-sep
 * el viaje ganó el núcleo y la quinta órbita y, sin esta puerta, habrían
 * salido a producción en la siguiente promoción sin que nadie lo decidiera.
 *
 * Se lee el fuente en vez de montar los componentes: son 2.000 líneas de
 * framer-motion cada uno y lo que importa aquí es la FORMA de la puerta.
 */
const dir = join(__dirname, '..');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('la puerta del viaje solar', () => {
  it('elige por MANDOS_LANDING_OPEN, y cerrada pinta el clásico', () => {
    const gate = read('SolarJourney.tsx');
    expect(gate).toMatch(/import \{ MANDOS_LANDING_OPEN \} from '\.\.\/\.\.\/lib\/nav\/mandosLanding'/);
    expect(gate).toMatch(/return open \? Mandos : \(Classic as unknown as typeof Mandos\)/);
    expect(gate).toMatch(/pickSolarJourney\(MANDOS_LANDING_OPEN\)/);
    // Ninguna variable de entorno abre esta puerta por su cuenta.
    expect(gate).not.toMatch(/process\.env/);
  });

  it('el clásico no lleva ni el núcleo ni la quinta órbita', () => {
    const classic = read('SolarJourneyClassic.tsx');
    expect(classic).not.toMatch(/CORE_STOP|OPERATE_STOP|CoreOverlay|OperateArtifact/);
    expect(classic).toMatch(/h-\[920svh\]/);
  });

  it('el nuevo sí, y las dos portadas entran por la puerta, no por un fichero concreto', () => {
    const mandos = read('SolarJourneyMandos.tsx');
    expect(mandos).toMatch(/CORE_STOP/);
    expect(mandos).toMatch(/OPERATE_STOP/);
    for (const page of ['LandingPage.tsx', 'LandingPageProduction.tsx']) {
      expect(read(page)).toMatch(/from '\.\/SolarJourney'/);
    }
  });
});

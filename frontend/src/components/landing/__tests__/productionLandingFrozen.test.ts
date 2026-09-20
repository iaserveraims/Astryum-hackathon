import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * La portada de PRODUCCIÓN está congelada · tripwire.
 *
 * `LandingPageProduction.tsx` es el `LandingPage.tsx` que `main` tenía, byte a byte. Existe para que los mundos Legacy e Institucional,
 * que se siguen iterando en `LandingPage.tsx`, no puedan llegar a astryum.xyz
 * hasta que alguien decida publicarlos (ver `app/page.tsx`).
 */

const LANDING_DIR = join(__dirname, '..');
const FROZEN = join(LANDING_DIR, 'LandingPageProduction.tsx');
const PAGE = join(LANDING_DIR, '..', '..', 'app', 'page.tsx');

/**
 * El blob de `main` (`7112ce00…`) MÁS UNA CLASE.
 *
 * Re-pineado a propósito, y es el único caso en que eso es lo
 * correcto: el bug estaba EN la portada congelada. El campo de luz de
 * `#light-beat` sobresale 60svh por encima de su sección y, a opacidad 0,
 * seguía capturando el puntero: en astryum.xyz, desde el 96 % del recorrido,
 * 0 de 9 puntos del botón final «Enter the beta» recibían el clic (medido con
 * chromium headless a 1440x900, 1536x730 y 1920x1080). El arreglo es
 * `pointer-events-none` en esa capa — una línea, ningún contenido:
 */
const MAIN_BLOB = '7f342d32df2d4d8e886abc35ab52ed46ad24c469';

/** Identificador de blob de git: sha1("blob <bytes>\0" + contenido). */
function gitBlobId(path: string): string {
  // `.gitattributes` fija `*.tsx eol=lf`; se normaliza igualmente para que un
  // checkout con CRLF no dé un falso rojo.
  const body = Buffer.from(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${body.length}\0`, 'utf8'), body]))
    .digest('hex');
}

describe('la portada de producción · congelada', () => {
  it('LandingPageProduction.tsx es el LandingPage.tsx de main más el arreglo del clic, byte a byte', () => {
    expect(
      gitBlobId(FROZEN),
      'alguien editó la portada congelada — los cambios van a LandingPage.tsx',
    ).toBe(MAIN_BLOB);
  });

  it('no conoce los mundos nuevos', () => {
    const src = readFileSync(FROZEN, 'utf8');
    for (const name of ['LegacyJourney', 'InstitutionalJourney', 'LegacyBreak', 'InstitutionalBreak', './products', './ProductSwitch']) {
      expect(src, `la portada de producción importa ${name}`).not.toContain(name);
    }
  });
});

describe('app/page.tsx · quién pinta cuál', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('decide con la regla única, no con una variable propia', () => {
    expect(src).toContain("import { isProductionDeploy } from '@/lib/nav/hackathonHub';");
    expect(src).toContain('isProductionDeploy() ? <LandingPageProduction /> : <LandingPage />');
    // Una variable de entorno leída aquí sería una segunda puerta, y las
    // variables se clonan entre entornos.
    expect(src).not.toMatch(/process\.env\./);
  });

  it('carga cada portada por separado', () => {
    expect(src).toContain("dynamic(() => import('@/components/landing/LandingPage'))");
    expect(src).toContain("dynamic(() => import('@/components/landing/LandingPageProduction'))");
    // Un import estático de cualquiera de las dos metería su código en el
    // bundle de la otra.
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+'@\/components\/landing\/LandingPage/m);
  });
});

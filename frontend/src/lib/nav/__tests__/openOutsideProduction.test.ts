/**
 * La duda NUNCA abre la puerta.
 *
 * La regla vieja era `!== 'false'`: cualquier despliegue que no definiera la
 * variable encendía el hub del hackathon y la mesa del gestor — y un
 * despliegue de producción normalmente no define nada. Así llegaron a
 * astryum.xyz, sin que nadie lo pidiera.
 *
 * Esto fija la regla nueva: se exige una prueba POSITIVA de no estar en
 * producción. El override manual sigue mandando en los dos sentidos, porque el
 * día que haya que enseñarlo en producción no se puede depender de un deploy
 * de código.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openOutsideProduction } from '../hackathonHub';

const VERCEL = 'NEXT_PUBLIC_VERCEL_ENV';
const NODE = 'NODE_ENV';
const original = { vercel: process.env[VERCEL], node: process.env[NODE] };

function env(vercelEnv: string | undefined, nodeEnv: string) {
  if (vercelEnv === undefined) delete process.env[VERCEL];
  else process.env[VERCEL] = vercelEnv;
  // NODE_ENV es de sólo lectura en los tipos de Node; el test lo fuerza.
  (process.env as Record<string, string>)[NODE] = nodeEnv;
}

afterEach(() => {
  if (original.vercel === undefined) delete process.env[VERCEL];
  else process.env[VERCEL] = original.vercel;
  (process.env as Record<string, string>)[NODE] = original.node ?? 'test';
});

describe('openOutsideProduction', () => {
  it('en producción, CERRADO — el caso que se publicó sin querer', () => {
    env('production', 'production');
    expect(openOutsideProduction(undefined)).toBe(false);
  });

  it('un build de producción SIN la variable de Vercel también cierra', () => {
    // Si Vercel dejara de exponer NEXT_PUBLIC_VERCEL_ENV, el fallo tiene que
    // caer del lado seguro. Este es el test que separa fail-closed de
    // fail-open, y la regla vieja lo habría suspendido.
    env(undefined, 'production');
    expect(openOutsideProduction(undefined)).toBe(false);
  });

  it('en preview, abierto — ahí es donde se prueba', () => {
    env('preview', 'production');
    expect(openOutsideProduction(undefined)).toBe(true);
  });

  it('en local (next dev), abierto', () => {
    env(undefined, 'development');
    expect(openOutsideProduction(undefined)).toBe(true);
  });

  it('«true» abre incluso en producción — el interruptor de emergencia', () => {
    env('production', 'production');
    expect(openOutsideProduction('true')).toBe(true);
  });

  it('«false» cierra incluso en preview', () => {
    env('preview', 'production');
    expect(openOutsideProduction('false')).toBe(false);
  });

  it('un valor que no es ni «true» ni «false» no cuenta como permiso', () => {
    env('production', 'production');
    expect(openOutsideProduction('1')).toBe(false);
    expect(openOutsideProduction('yes')).toBe(false);
    expect(openOutsideProduction('')).toBe(false);
  });
});

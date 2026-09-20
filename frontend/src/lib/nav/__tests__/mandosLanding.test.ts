import { afterEach, describe, expect, it, vi } from 'vitest';
import { MANDOS_LANDING_PUBLISHED, WORLD_ROUTES, mandosLandingOpen } from '../mandosLanding';

/**
 * La landing «a los mandos» se ve en preview y en local, y en producción SOLO
 * cuando un commit la publica. Es la regla del 14-sep escrita en código: una
 * variable de entorno clonada entre entornos jamás puede abrirla.
 */
describe('mandosLandingOpen', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllEnvs();
  });

  it('está cerrada en un build de producción mientras no se publique', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    expect(mandosLandingOpen(false)).toBe(false);
  });

  it('se abre en el preview de Vercel sin tocar nada', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    expect(mandosLandingOpen(false)).toBe(true);
  });

  it('publicarla es un cambio de código, y entonces abre también en producción', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    expect(mandosLandingOpen(true)).toBe(true);
  });

  it('todavía no está publicada', () => {
    expect(MANDOS_LANDING_PUBLISHED).toBe(false);
  });

  it('cada gobernador tiene su ruta —son cuatro— y la quinta es la de venues', () => {
    expect(Object.values(WORLD_ROUTES)).toEqual(['/self-custody', '/business', '/exchanges', '/agents', '/venues']);
  });
});

/**
 * La marca local no contradice al servidor.
 *
 * El fallo que fija esto: el mismo Legacy, activo en el registro,
 * se veía en el preview y no en producción, porque el navegador de producción
 * lo tenía marcado como «quitado» y el filtro del sábado escondía todo lo
 * marcado. Una cuenta que el servidor tiene activa se enseña; se quita
 * quitándola de verdad, no escondiéndola en un navegador.
 */
import { describe, it, expect } from 'vitest';
import { keepCandidate } from '../candidateVisibility';

const XRPL = 'rpM7wQNUmAPSSbbb6J3yFJGnS9eoZthu8v';
const marked = (a: string) => a === XRPL;
const clean = () => false;

describe('keepCandidate', () => {
  it('una cuenta del REGISTRO se enseña aunque el navegador la tenga marcada — el caso de producción', () => {
    expect(keepCandidate({ address: XRPL, registryId: 'reg-1' }, marked)).toBe(true);
  });

  it('una cuenta que solo está por estar conectada o enlazada sí obedece a la marca', () => {
    expect(keepCandidate({ address: XRPL }, marked)).toBe(false);
    expect(keepCandidate({ address: XRPL, registryId: null }, marked)).toBe(false);
  });

  it('sin marca, todo se enseña', () => {
    expect(keepCandidate({ address: XRPL }, clean)).toBe(true);
    expect(keepCandidate({ address: XRPL, registryId: 'reg-1' }, clean)).toBe(true);
  });

  it('un registryId vacío no cuenta como fila del servidor', () => {
    expect(keepCandidate({ address: XRPL, registryId: '' }, marked)).toBe(false);
  });
});

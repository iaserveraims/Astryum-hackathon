/**
 * Producción solo enseña lo que está en la lista — y la lista es código.
 *
 * El incidente que fija esto (2026-09-14): «Lend your RLUSD» apareció en
 * astryum.xyz porque una variable de entorno clonada se hizo efectiva con el
 * primer deploy que construyó. Con esta lista, una variable no puede publicar
 * un vault: hace falta un commit a main.
 */
import { describe, it, expect } from 'vitest';
import { PRODUCTION_VAULT_KINDS, catalogForDeploy } from '../productionVaults';

const ALL = [
  { kind: 'e1' }, { kind: 'e3' }, { kind: 'v-firelight' }, { kind: 'v-earnxrp' },
  { kind: 'v-monarq' }, { kind: 'e2' }, { kind: 'em-carry' }, { kind: 'em-lend' },
];

describe('PRODUCTION_VAULT_KINDS', () => {
  it('son los seis del main de antes de la fusión, y solo esos', () => {
    expect([...PRODUCTION_VAULT_KINDS].sort()).toEqual(
      ['e1', 'e2', 'e3', 'v-earnxrp', 'v-firelight', 'v-monarq'],
    );
  });

  it('el carril Ethereum NO está — es el que se coló', () => {
    expect(PRODUCTION_VAULT_KINDS).not.toContain('em-carry');
    expect(PRODUCTION_VAULT_KINDS).not.toContain('em-lend');
  });
});

describe('catalogForDeploy', () => {
  it('en producción, solo lo listado — aunque el kill-switch del carril estuviera abierto', () => {
    const kinds = catalogForDeploy(ALL, true).map((v) => v.kind);
    expect(kinds).toEqual(['e1', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'e2']);
  });

  it('fuera de producción, todo: ahí es donde se prueba lo que aún no está en la lista', () => {
    expect(catalogForDeploy(ALL, false)).toHaveLength(ALL.length);
  });

  it('un kind nuevo que nadie añadió a la lista no entra en producción', () => {
    const kinds = catalogForDeploy([...ALL, { kind: 'v-nuevo' }], true).map((v) => v.kind);
    expect(kinds).not.toContain('v-nuevo');
  });

  it('respeta el orden del catálogo y no muta la entrada', () => {
    const input = [{ kind: 'e2' }, { kind: 'e1' }];
    const out = catalogForDeploy(input, true);
    expect(out.map((v) => v.kind)).toEqual(['e2', 'e1']);
    expect(out).not.toBe(input);
  });
});

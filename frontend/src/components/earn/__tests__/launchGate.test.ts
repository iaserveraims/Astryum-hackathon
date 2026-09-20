import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PRODUCTION_VAULT_KINDS, catalogForDeploy } from '../../../lib/earn/productionVaults';

/**
 * La puerta de lanzamiento del Earn obedece a la lista blanca · tripwire.
 *
 * La lista blanca (lib/earn/productionVaults) ya filtraba el
 * catálogo que se pinta. Pero el Earn tiene UNA puerta más para abrir un vault
 * sin pasar por sus tarjetas —`launch`, la que usan `?launch=<kind>` desde
 * Estrategias, el agente y los borradores— y esa puerta validaba contra una
 * lista fija con `em-carry` y `em-lend` y abría desde DEMO_VAULTS entero. En
 * producción, `/app/asset-production?launch=em-lend` enseñaba el vault que la
 * portada no enseña.
 */

const SRC = readFileSync(join(__dirname, '..', 'FlareDemoEarn.tsx'), 'utf8');

describe('Earn · la puerta `launch` obedece a la lista blanca', () => {
  it('abre solo desde el catálogo del despliegue, nunca desde DEMO_VAULTS entero', () => {
    expect(SRC).toContain('const vault = deployable.find((v) => v.kind === kind);');
    expect(SRC).toContain('if (!vault) return;');
    expect(SRC).not.toContain('DEMO_VAULTS.find((v) => v.kind === kind)');
  });

  it('el deep link `?launch=` valida contra ese mismo catálogo, no contra una lista aparte', () => {
    expect(SRC).toContain('const known = deployable.map((v) => v.kind);');
    // La lista fija que se retiró llevaba los dos kinds del carril Ethereum.
    expect(SRC).not.toMatch(/const known: VaultKind\[\] = \[/);
  });

  it('en producción, el catálogo del despliegue no contiene los dos kinds de RLUSD', () => {
    const all = ['e1', 'e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq', 'em-carry', 'em-lend'].map((kind) => ({ kind }));
    const kinds = catalogForDeploy(all, true).map((v) => v.kind);
    expect(kinds).not.toContain('em-carry');
    expect(kinds).not.toContain('em-lend');
    expect([...kinds].sort()).toEqual([...PRODUCTION_VAULT_KINDS].sort());
  });
});

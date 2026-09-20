/**
 * PRODUCCIÓN SOLO LLEVA LO PROBADO — la lista blanca de vaults.
 *
 * Fundador, al ver «Lend your RLUSD» en astryum.xyz: «este no está
 * probado, así que no hay que meterlo en producción hasta que esté probado;
 * deja reglas al respecto bien escritas para que no vuelva a pasar».
 */

/**
 * Los vaults que han pasado la prueba y viven en producción. Eran los seis
 * del `main` de antes de la fusión (inventario verificado). Para
 * publicar uno nuevo: probarlo en el preview, añadir su `kind` aquí, y que el
 * commit diga qué se probó.
 */
export const PRODUCTION_VAULT_KINDS: readonly string[] = [
  'e1',          // Earn on your XRP and borrow dollars — FXRP → Kinetic (carry)
  'e3',          // Kinetic earning — FXRP → Kinetic (lend-only)
  'v-firelight', // Firelight staking — FXRP → Firelight (stXRP)
  'v-earnxrp',   // earnXRP Vault — FXRP → earnXRP (Clearstar)
  'v-monarq',    // Monarq XRP fund — FXRP → Monarq (MXRPY)
  'e2',          // Earn FLR — FLR → FTSO
];

/**
 * El catálogo que este despliegue puede enseñar. En producción, solo lo
 * listado; fuera, todo — el resto de puertas (el kill-switch del carril
 * Ethereum, los flags de módulo) se aplican DESPUÉS, no en lugar de esto.
 */
export function catalogForDeploy<T extends { kind: string }>(
  all: readonly T[],
  production: boolean,
): T[] {
  if (!production) return [...all];
  return all.filter((v) => PRODUCTION_VAULT_KINDS.includes(v.kind));
}

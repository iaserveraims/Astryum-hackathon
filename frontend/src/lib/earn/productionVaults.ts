/**
 * PRODUCCIÓN SOLO LLEVA LO PROBADO — la lista blanca de vaults.
 *
 * Fundador 2026-09-14, al ver «Lend your RLUSD» en astryum.xyz: «este no está
 * probado, así que no hay que meterlo en producción hasta que esté probado;
 * deja reglas al respecto bien escritas para que no vuelva a pasar».
 *
 * CÓMO LLEGÓ ALLÍ, porque el mecanismo es la lección. Nadie publicó ese vault.
 * La rama entera se fusionó a `main` el 13-sep con las dos tarjetas del carril
 * Ethereum dentro, tapadas por un interruptor de entorno del backend
 * (`ETH_RLUSD_FXRP_ENABLED`). El backend de producción llevaba días sin
 * construir —sus despliegues salían SKIPPED—, así que el interruptor
 * contestaba 404 y las tarjetas no se pintaban. En Railway producción esa
 * variable estaba a `true` (clonada de staging, o puesta para el hackathon).
 * El 14-sep a las 11:36 un arreglo del portfolio hizo el primer deploy que sí
 * construyó, la variable se hizo efectiva y dos vaults sin probar aparecieron
 * en producción. Sin que nadie decidiera nada ese día.
 *
 * LA REGLA: lo que decide si algo se VE en producción vive en CÓDIGO, nunca en
 * una variable de entorno. Las variables se clonan entre entornos y se activan
 * solas en el siguiente deploy; un `kind` en esta lista solo entra con un
 * commit a `main` que diga qué se probó y cuándo. Los interruptores del
 * backend siguen siendo el kill-switch de cada carril, no su puerta de
 * publicación.
 *
 * Fuera de producción (preview, local) esta lista no filtra nada: allí es
 * donde se prueba lo que todavía no está en ella.
 */

/**
 * Los vaults que han pasado la prueba y viven en producción. Eran los seis
 * del `main` de antes de la fusión del 13-sep (inventario verificado). Para
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

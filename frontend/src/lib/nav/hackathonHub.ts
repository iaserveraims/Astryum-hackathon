/**
 * EL HUB DEL HACKATHON (fundador 2026-09-12): «las funciones que sean
 * explícitas del hackathon de XRPL Commons quiero que tengan su apartado en
 * la barra lateral, a modo de hub intuitivo… que cuando un juez se conecte
 * no tenga que pelearse con la página para saber dónde encontrar las
 * funcionalidades especiales… separadas de las demás, a modo de nuevas
 * funcionalidades (hackathon exclusives)».
 *
 * Un grupo propio al final del menú —cabecera «Hackathon exclusives» con la
 * marca XRPL— con las tres puertas de la entrega: Legacy (las wallets con
 * consejo), la mesa del gestor (managed vaults) y el Exchange. Descubrimiento,
 * no permiso: cada página conserva sus propias puertas (LegacyAccessGuard, la
 * declaración de gestor, la puerta del exchange).
 *
 * ── FUERA DE PRODUCCIÓN (fundador 2026-09-13) ────────────────────────────
 *
 * «Del production tienes que quitar las funciones de hackathon exclusives»,
 * dicho al ver el grupo en vivo en astryum.xyz después de que la ventana
 * entera se fusionara a `main`. Antes, estas puertas se abrían SOLAS: la regla
 * era `!== 'false'`, así que cualquier despliegue sin la variable definida las
 * encendía — y un despliegue de producción normalmente no define nada.
 *
 * La regla se invierte: **en producción están cerradas salvo que alguien las
 * abra a mano**, y en preview y en local siguen abiertas sin que nadie tenga
 * que acordarse de nada. Eso importa porque el preview es donde se prueba y
 * producción es donde está la gente; la variable manual sigue mandando sobre
 * las dos, en los dos sentidos.
 *
 * Y es fail-closed a propósito: si `NEXT_PUBLIC_VERCEL_ENV` no llegara a
 * existir en un build de producción, el `NODE_ENV` de ese build ya basta para
 * dejarlo cerrado. La duda nunca abre la puerta.
 *
 * Para volver a enseñarlo en producción: `NEXT_PUBLIC_HACKATHON_HUB=true` en
 * Vercel (scope Production) y **redeploy** — `NEXT_PUBLIC_*` se hornea en el
 * build, guardar la variable no basta.
 */

/**
 * ¿Este bundle es el de un despliegue de PRODUCCIÓN?
 *
 * Vercel expone `NEXT_PUBLIC_VERCEL_ENV` sola en proyectos Next
 * ('production' | 'preview' | 'development'). No se confía sólo en ella: se
 * pide una prueba POSITIVA de no estar en producción, así que su ausencia
 * cierra en vez de abrir.
 */
export function openOutsideProduction(explicit: string | undefined): boolean {
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === 'preview' || vercelEnv === 'development') return true;
  // `next dev` y los tests: NODE_ENV no es 'production' y no hay nada que
  // proteger. Un build de producción sin la variable de Vercel cae aquí en
  // 'production' y queda cerrado, que es el lado correcto del error.
  return process.env.NODE_ENV !== 'production';
}

export const HACKATHON_HUB_OPEN = openOutsideProduction(process.env.NEXT_PUBLIC_HACKATHON_HUB);

/**
 * ¿Este bundle es el de PRODUCCIÓN? La misma regla de arriba, leída al revés y
 * SIN variable que la anule: quien pregunta esto quiere saber dónde está, no
 * pedir permiso. La usa la lista blanca de vaults (lib/earn/productionVaults):
 * en producción solo se enseña lo probado, y eso no lo abre ninguna variable.
 */
export function isProductionDeploy(): boolean {
  return !openOutsideProduction(undefined);
}

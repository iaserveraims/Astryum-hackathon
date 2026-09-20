/**
 * EL HUB DEL HACKATHON: «las funciones que sean
 * explícitas del hackathon de XRPL Commons quiero que tengan su apartado en
 * la barra lateral, a modo de hub intuitivo… que cuando un juez se conecte
 * no tenga que pelearse con la página para saber dónde encontrar las
 * funcionalidades especiales… separadas de las demás, a modo de nuevas
 * funcionalidades (hackathon exclusives)».
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

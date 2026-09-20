/**
 * LA LANDING «A LOS MANDOS»: una portada con el selector
 * de quién gobierna y cuatro páginas, una por gobernador — Autocustodia,
 * Empresa, Exchange, Agente — con los mismos efectos que la landing de siempre
 * (campo de estrellas, viaje por scroll, escena fija, paradas, láminas, cierre
 * con luz y pase).
 */

import { openOutsideProduction } from './hackathonHub';

/** Publicar = ponerlo a `true` en un commit que diga qué se probó. */
export const MANDOS_LANDING_PUBLISHED = false;

/** ¿Se pintan la portada nueva y las cuatro páginas en ESTE despliegue? */
export function mandosLandingOpen(published: boolean = MANDOS_LANDING_PUBLISHED): boolean {
  return published || openOutsideProduction(undefined);
}

export const MANDOS_LANDING_OPEN = mandosLandingOpen();

/**
 * Los mundos que la landing sabe pintar. `home` es la portada de siempre (la
 * que ve producción); `mandos` es la portada nueva; los otros cuatro son las
 * páginas de cada gobernador.
 */
export type LandingWorld = 'home' | 'mandos' | 'self' | 'business' | 'exchange' | 'agent' | 'venue';

/**
 * Las cuatro puertas de los gobernadores, y la quinta —`venue`— que no es un
 * gobernador: es la página para quien OPERA un protocolo, para que vea cómo se entra en el catálogo y pida la
 * verificación. Va en el header, no entre las tarjetas del puente.
 */
export const WORLD_ROUTES: Record<Exclude<LandingWorld, 'home' | 'mandos'>, string> = {
  self: '/self-custody',
  business: '/business',
  exchange: '/exchanges',
  agent: '/agents',
  venue: '/venues',
};

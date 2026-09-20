/**
 * LA LANDING «A LOS MANDOS» (fundador 2026-09-19): una portada con el selector
 * de quién gobierna y cuatro páginas, una por gobernador — Autocustodia,
 * Empresa, Exchange, Agente — con los mismos efectos que la landing de siempre
 * (campo de estrellas, viaje por scroll, escena fija, paradas, láminas, cierre
 * con luz y pase).
 *
 * ── LA MISMA REGLA QUE EL HUB DEL HACKATHON, LEÍDA AL REVÉS ──────────────
 * Lo que decide si algo se VE en producción vive en código, nunca en una
 * variable de entorno (CLAUDE.md, incidente del 14-sep). Aquí la puerta es
 * `MANDOS_LANDING_PUBLISHED`: en preview y en local las páginas están abiertas
 * sin que nadie tenga que acordarse de nada; en producción están cerradas hasta
 * que alguien ponga esta constante a `true` EN UN COMMIT que diga qué se probó
 * y cuándo. Ninguna variable la abre.
 *
 * Mientras está cerrada, producción sigue sirviendo la portada de siempre y las
 * cuatro rutas nuevas responden 404: no existen para quien no está en el
 * preview.
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
 * gobernador: es la página para quien OPERA un protocolo (fundador
 * 2026-09-20), para que vea cómo se entra en el catálogo y pida la
 * verificación. Va en el header, no entre las tarjetas del puente.
 */
export const WORLD_ROUTES: Record<Exclude<LandingWorld, 'home' | 'mandos'>, string> = {
  self: '/self-custody',
  business: '/business',
  exchange: '/exchanges',
  agent: '/agents',
  venue: '/venues',
};

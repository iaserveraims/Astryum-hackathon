'use client';

/**
 * EL VIAJE SOLAR — la puerta entre el de siempre y el nuevo.
 *
 * Este fichero lo importan DOS portadas: `LandingPage` (donde se trabaja) y
 * `LandingPageProduction` (congelada por hash). Cuando el viaje ganó el núcleo
 * —tus cuentas— y la quinta órbita —Operar— (20-sep), el cambio entró por
 * aquí… y por aquí habría llegado a producción en la siguiente promoción, sin
 * que nadie lo decidiera: el hash congela la portada, no lo que la portada
 * importa.
 *
 * La regla del 14-sep: lo que decide si algo se VE en producción vive en
 * código, nunca en una variable ni en un efecto colateral. Así que:
 *
 *   · `SolarJourneyClassic`  — el viaje tal y como estaba antes del núcleo
 *     (768af3ec^): cuatro paradas, 920svh. Es lo que pinta producción.
 *   · `SolarJourneyMandos`   — el viaje nuevo: núcleo, quinta órbita, la voz
 *     «aplicado a ti» de /self-custody.
 *
 * Y una sola puerta, la misma que cierra las páginas nuevas:
 * `MANDOS_LANDING_OPEN`. Preview y local ven el nuevo; producción, el de
 * siempre, hasta que un commit publique `MANDOS_LANDING_PUBLISHED`. Ese día
 * el clásico se puede retirar.
 */

import { MANDOS_LANDING_OPEN } from '../../lib/nav/mandosLanding';
import Classic from './SolarJourneyClassic';
import Mandos, { type JourneyProduct } from './SolarJourneyMandos';

export type { JourneyProduct };
/** Las paradas del viaje NUEVO, para el HUD de `LandingPage`. La portada
 *  congelada no las usa: lleva sus cuatro tiempos de siempre dentro. */
export { SOLAR_LEGS } from './SolarJourneyMandos';

/** Puro y exportado para que el test lo pueda leer sin montar nada. */
export function pickSolarJourney(open: boolean): typeof Mandos {
  // El clásico acepta un subconjunto de productos ('self' no existe en él);
  // cerrado, el mundo 'self' responde 404 y jamás llega hasta aquí.
  return open ? Mandos : (Classic as unknown as typeof Mandos);
}

const SolarJourney = pickSolarJourney(MANDOS_LANDING_OPEN);

export default SolarJourney;

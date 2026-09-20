/**
 * emRepayNudge — la PUERTA que abre el aviso de la protección de Ethereum.
 *
 * Una línea sola, en un módulo propio, por una razón concreta: el aviso del
 * tick tuvo durante un tiempo una url pelada (`/app/strategies`) que aterrizaba
 * en la página y **no abría nada** — le decía al dueño que actuara y le
 * escondía la puerta (H4). Con el deep-link enterrado dentro del tick, la única
 * forma de comprobar que la puerta es la buena era esperar a que saltara una
 * regla de verdad.
 *
 * Ahora el tick y el ensayo en seco (`scripts/dryrun-em-protection.ts`) enseñan
 * LA MISMA url, y un test la fija.
 */

/**
 * `paAction=repay` + protocolo + dueño: eso es lo que `DefiPositionsBoard`
 * entiende para expandir ESA posición y abrir su modal de repago. El modal
 * compone las patas FRESCAS al abrirse — la deuda crece con el interés y un
 * repay-full necesita las `borrowShares` VIVAS, así que calldata pre-horneada
 * en el momento del disparo llegaría rancia a la firma.
 */
export function emRepayPushUrl(owner: string): string {
  return `/app/strategies?paAction=repay&protocol=morpho-blue&owner=${owner}`;
}

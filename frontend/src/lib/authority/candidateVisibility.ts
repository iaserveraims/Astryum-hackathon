/**
 * ¿PUEDE UNA MARCA LOCAL ESCONDER ESTA CUENTA? Solo si el servidor no la tiene.
 *
 * Los dos sitios ya
 * leían la MISMA base de datos, así que la diferencia no podía ser de datos:
 * era del navegador. En producción, su navegador tenía ese Legacy marcado como
 * «quitado» (un intento de borrado del sábado, cuando el servidor volvió a
 * crear la fila); en el del preview no había marca. Y el filtro del sábado
 * escondía TODO lo marcado, también lo que el registro del servidor tenía
 * activo. Resultado: una cuenta viva en el servidor, invisible en un
 * navegador y visible en otro, sin ningún sitio desde el que recuperarla.
 */

export interface VisibilityCandidate {
  address: string;
  /** La fila del registro de cuentas gobernadas, si el servidor la tiene activa. */
  registryId?: string | null;
}

/**
 * `true` si la cuenta debe seguir en la lista de candidatas.
 * `isRemoved` es la marca local (lib/wallet/removedAddresses).
 */
export function keepCandidate(
  c: VisibilityCandidate,
  isRemoved: (address: string) => boolean,
): boolean {
  if (c.registryId) return true;
  return !isRemoved(c.address);
}

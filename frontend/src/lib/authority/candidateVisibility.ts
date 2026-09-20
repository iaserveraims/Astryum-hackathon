/**
 * ¿PUEDE UNA MARCA LOCAL ESCONDER ESTA CUENTA? Solo si el servidor no la tiene.
 *
 * Fundador 2026-09-14: «en el preview tengo una wallet legacy conectada,
 * rpM7wQ…, y en production no me aparece ninguna legacy». Los dos sitios ya
 * leían la MISMA base de datos, así que la diferencia no podía ser de datos:
 * era del navegador. En producción, su navegador tenía ese Legacy marcado como
 * «quitado» (un intento de borrado del sábado, cuando el servidor volvió a
 * crear la fila); en el del preview no había marca. Y el filtro del sábado
 * escondía TODO lo marcado, también lo que el registro del servidor tenía
 * activo. Resultado: una cuenta viva en el servidor, invisible en un
 * navegador y visible en otro, sin ningún sitio desde el que recuperarla.
 *
 * LA REGLA: la marca local existe para frenar los caminos AUTOMÁTICOS que
 * resucitan una dirección — el volcado de punteros locales al registro, el
 * auto-registro de la wallet que firmó el login, la sesión conectada. No
 * existe para contradecir al servidor. Si el registro de cuentas gobernadas
 * tiene la cuenta activa (`registryId`), se enseña: el usuario la quita desde
 * la pantalla, el servidor la marca retirada, y desaparece en TODOS los
 * navegadores a la vez — que es lo que «quitar» debe significar.
 *
 * Una cuenta que está solo por estar conectada o enlazada (sin fila en el
 * registro) sí obedece a la marca: ahí la marca es la única memoria de que el
 * usuario no la quiere ver.
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

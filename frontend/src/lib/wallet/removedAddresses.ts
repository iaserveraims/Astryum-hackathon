'use client';

/**
 * LAS DIRECCIONES QUE EL USUARIO QUITÓ — una sola lista, para toda la app.
 *
 * Vivía dentro de `useWalletLinking`, que arrastra wagmi y los servicios de
 * wallet detrás. Eso la dejaba fuera del alcance de quien más la necesitaba:
 * el registro de cuentas gobernadas (`useAuthorities`), donde está el camino
 * que resucitaba lo borrado. Extraída aquí sin ninguna dependencia, la misma
 * respuesta sirve a las dos superficies — que es la única forma de que no se
 * contradigan.
 *
 * POR QUÉ EXISTE (fundador 2026-09-13, segunda vuelta: «la firma y demás
 * funciona, pero no se borra la wallet, no desaparece de la account»).
 * Borrar la fila y el puntero del registro no bastaba, porque cada carga del
 * registro VUELCA los punteros locales del navegador y vuelve a dar de alta lo
 * que el volcado encuentre. El comentario de ese volcado lo decía sin darse
 * cuenta: «localStorage nunca se borra, así que las dos listas no pueden
 * divergir» — un diseño que asume que nadie quita nada. En cuanto el usuario
 * quita algo, ese mismo mecanismo se lo devuelve.
 *
 * La regla, en una frase: **una dirección que el usuario quitó no vuelve por
 * ningún camino automático**. Vuelve cuando él la añade otra vez, que es un
 * acto explícito y por eso limpia la marca.
 */

const REMOVED_ADDRESSES_KEY = 'astryum-removed-wallet-addresses';

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** EVM compara en minúsculas; XRPL es base58 y sensible a mayúsculas. */
export function removalKey(address: string): string {
  const a = address.trim();
  return EVM_RE.test(a) ? a.toLowerCase() : a;
}

export function removedAddresses(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(REMOVED_ADDRESSES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persist(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMOVED_ADDRESSES_KEY, JSON.stringify([...set]));
  } catch {
    /* almacenamiento bloqueado — la marca no sobrevive a la recarga */
  }
}

/**
 * El usuario quitó esta dirección. Ningún camino automático puede devolverla:
 * ni el auto-registro de la wallet que firmó el login, ni el volcado de
 * punteros locales al registro de cuentas gobernadas.
 */
export function markAddressRemoved(address: string): void {
  const set = removedAddresses();
  set.add(removalKey(address));
  persist(set);
}

/** El usuario la añade otra vez: intención fresca, la marca se levanta. */
export function unmarkAddressRemoved(address: string): void {
  const set = removedAddresses();
  if (set.delete(removalKey(address))) persist(set);
}

/**
 * ¿La quitó el usuario? Todo camino que re-registre o re-sincronice una
 * dirección por su cuenta TIENE que preguntar esto antes — si no, la papelera
 * es un botón que hay que pulsar una y otra vez.
 */
export function isAddressRemoved(address: string): boolean {
  return removedAddresses().has(removalKey(address));
}

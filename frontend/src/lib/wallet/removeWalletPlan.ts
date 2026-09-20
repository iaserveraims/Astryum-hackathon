/**
 * QUITAR UNA CUENTA DE LA LISTA — QUÉ HAY QUE BORRAR, EXACTAMENTE.
 *
 * Fundador 2026-09-13: «tengo una wallet legacy que no puedo eliminar de la
 * cuenta; en Manage no aparece el botón de remove, ni la papelera, ni cuando
 * entro en Govern aparece ninguna opción».
 *
 * Eran DOS fallos encadenados, y el segundo es el que importa:
 *
 *  1. El botón no se pintaba. El bloque de borrado entero vivía dentro de un
 *     `{!council && (…)}` en ManageWalletModal, así que en una cuenta con
 *     consejo no se enseñaba nunca — pese a que el texto de dentro ya tenía
 *     su variante para Legacy, escrita y muerta.
 *  2. Aunque se hubiera pintado, `onRemove(wallet.id)` habría fallado o no
 *     habría servido de nada. Una cuenta gobernada llega a esa lista por
 *     hasta TRES caminos a la vez, y borrar uno deja vivos los otros:
 *
 *       · una fila real de `/wallets/mine` (id de verdad);
 *       · un puntero del registro de cuentas gobernadas (`registryId`);
 *       · la wallet XRPL CONECTADA en esta sesión, que es candidata por el
 *         hecho de estar conectada;
 *       · y el puntero local del navegador (`legacyLocal`).
 *
 *     Una fila sintetizada lleva id `legacy:<address>`, que no existe en el
 *     servidor: pedir su borrado es un 404. Y una fila real borrada vuelve a
 *     aparecer en la siguiente lectura si su puntero del registro sigue ahí.
 *     Ese es el patrón que este repo ya pagó antes: «se re-creaba en cada
 *     carga después de borrarla».
 *
 * Este módulo contesta a una sola pregunta —qué hay que borrar para que la
 * cuenta no vuelva— y la contesta sin tocar nada, para poder probarla.
 *
 * REGLA QUE NO SE NEGOCIA: quitar de la lista **no toca el ledger**. No se
 * firma, no se disuelve un consejo, no se mueve capital. La cuenta y su
 * consejo siguen en XRPL exactamente igual. Lo único que se borra son los
 * punteros de Astryum.
 */

import { addressKey } from '../authority';

/** Prefijo de las filas SINTETIZADAS (el consejo vive en el registro, no en
 *  la tabla de wallets). Su id no existe en el servidor. */
export const SYNTHETIC_ROW_PREFIX = 'legacy:';

export interface GovernedPointer {
  address: string;
  registryId?: string | null;
}

export interface RemovalPlan {
  /** `DELETE /wallets/mine/:id` — sólo si la fila es real. */
  walletId: string | null;
  /** `DELETE /governed-accounts/:id` — el puntero deliberado del registro. */
  registryId: string | null;
  /** Siempre: olvidar el puntero local y marcar la dirección como quitada. */
  address: string;
  /**
   * La cuenta volvería sola porque es la wallet XRPL conectada AHORA: estar
   * conectada la hace candidata por sí solo. Hay que soltar esa sesión, y hay
   * que DECIRLO antes de que el usuario confirme — si no, el botón parecería
   * no hacer nada, que es el fallo del que venimos.
   */
  disconnectXrplSession: boolean;
}

export function isSyntheticRow(id: string): boolean {
  return id.startsWith(SYNTHETIC_ROW_PREFIX);
}

/**
 * Qué hay que borrar para que esta cuenta salga de la lista y no vuelva.
 */
export function planWalletRemoval(input: {
  wallet: { id: string; address: string };
  /** Los candidatos gobernados que conoce la pantalla (useAuthorities). */
  governed?: readonly GovernedPointer[];
  /** La wallet XRPL conectada en esta sesión, si hay alguna. */
  connectedXrplAddress?: string | null;
}): RemovalPlan {
  const address = input.wallet.address.trim();
  const key = addressKey(address);

  const pointer = (input.governed ?? []).find(
    (g) => !!g.address && addressKey(g.address.trim()) === key,
  );

  const connected = (input.connectedXrplAddress ?? '').trim();

  return {
    walletId: isSyntheticRow(input.wallet.id) ? null : input.wallet.id,
    registryId: pointer?.registryId ?? null,
    address,
    disconnectXrplSession: !!connected && addressKey(connected) === key,
  };
}

/** ¿Este plan borra algo en el servidor? Si no, el trabajo es todo local. */
export function touchesServer(plan: RemovalPlan): boolean {
  return !!plan.walletId || !!plan.registryId;
}

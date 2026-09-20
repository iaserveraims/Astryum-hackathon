/**
 * QUITAR UNA CUENTA DE LA LISTA — QUÉ HAY QUE BORRAR, EXACTAMENTE.
 *
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

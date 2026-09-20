/**
 * positionAutoAction — a qué FILA del tablero apunta un deep-link.
 *
 * Es la regla que decide qué modal se abre cuando llega un aviso de la
 * protección (`?paAction=repay&protocol=morpho-blue&owner=0x…`) o un enlace
 * desde el hub. Vivía dentro de `DefiPositionsBoard.tsx`, donde no se podía
 * testear: importar ese componente arrastra AppKit y medio grafo y el test ni
 * carga. Lógica sin red en el camino que abre puertas sobre dinero.
 */

/** Petición de deep-link: abre la acción de ESTA posición. */
export interface BoardAutoAction {
  action: 'withdraw' | 'harvest' | 'repay';
  protocolId: string;
  /** Nombre del vault/receipt (earnXRP, MXRPY, stXRP…) cuando la fila era un vault. */
  name?: string;
  /** Wallet que sostiene la posición, cuando el hub la conocía. */
  owner?: string;
}

/** Lo mínimo que la regla necesita de una fila — el tablero pasa la suya entera. */
export interface AutoActionRow {
  protocolId: string;
  owner: string;
  kindUpper: string;
  asset: string;
  raw?: unknown;
}

/**
 * Los nombres por los que una fila puede ser reconocida. El adapter guarda el
 * símbolo del subyacente en `raw`, y `asset` puede ser la dirección del receipt
 * token — por eso se comparan todos.
 */
export function rowNames(p: AutoActionRow): string[] {
  const raw = (p.raw ?? {}) as { token?: string; vaultName?: string; symbol?: string };
  return [raw.token, raw.vaultName, raw.symbol, p.asset]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
}

export function matchesAutoAction(a: BoardAutoAction, p: AutoActionRow): boolean {
  if (a.protocolId.toLowerCase() !== p.protocolId.toLowerCase()) return false;
  if (a.owner && a.owner.toLowerCase() !== p.owner.toLowerCase()) return false;
  /**
   * Un repago JAMÁS apunta a una posición de préstamo: prestar no tiene deuda.
   *
   * Esto empezó a poder pasar al añadir la fila LEND de la bóveda (`d9851fa`):
   * hasta entonces `morpho-blue` + dueño solo casaba con colateral o deuda, y
   * ahora casa también con el préstamo. El caso real: llega el aviso de la
   * protección, el usuario repaga desde otro sitio, y al pulsar el aviso la
   * única fila de morpho-blue que le queda es la de la bóveda — el modal de
   * repago se abriría sobre ella y el backend contestaría 400 NO_DEBT. Un aviso
   * que abre una puerta que da error es la misma familia que uno que no abre
   * nada, y esa ya se cerró una vez.
   */
  if (a.action === 'repay' && p.kindUpper === 'LEND') return false;
  if (a.name) {
    if (!rowNames(p).some((n) => n === a.name!.toLowerCase())) return false;
  }
  return true;
}

/**
 * Flare explorer API — la ÚNICA fuente de verdad del endpoint Etherscan-compatible
 * que lee el carril de actividad (timeline + export fiscal + descubrimiento de
 * interacciones en chain 14).
 *
 * 2026-08-03: `flare-explorer.flare.network/api` (Blockscout) devolvió 503
 * "no healthy upstream" en TODAS sus rutas /api durante varios minutos — la web
 * del explorador seguía en pie, su API no. Con una sola puerta, el carril entero
 * se quedó ciego y el panel marcó `flarescan` caído. Recuperó solo, pero la
 * fragilidad no era el corte: era no tener segunda puerta.
 *
 * Routescan sirve la misma API con sabor Etherscan para chain 14 y responde las
 * cuatro acciones que usamos (txlist, tokentx, txlistinternal, getsourcecode),
 * así que va primera; Blockscout se queda de reserva — no se borra nada, se
 * degrada el orden. Para invertirlo o apuntar a otro indexador basta
 * FLARESCAN_API_URL (admite lista separada por comas, en orden de preferencia).
 *
 * OJO al elegir el ping de salud: `module=block&action=eth_block_number` es una
 * acción propia de Blockscout y Routescan la rechaza con HTTP 200 + status "0",
 * así que un chequeo que solo mire el código HTTP canta "healthy" sobre un
 * error. El ping común a los dos es `account/balance`, y hay que leer el cuerpo.
 */

/** Routescan (el indexador que hay detrás de flarescan.com) para Flare = chain 14. */
export const ROUTESCAN_FLARE_API =
  'https://api.routescan.io/v2/network/mainnet/evm/14/etherscan/api';

/** Blockscout oficial de Flare — reserva. La web pública sigue siendo esta. */
export const BLOCKSCOUT_FLARE_API = 'https://flare-explorer.flare.network/api';

/** Dirección quemada, sin dueño: solo se usa para pedir un saldo y ver si contestan. */
const HEALTH_PROBE_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/** Query del ping de salud, soportada por Blockscout, Routescan y Etherscan. */
export const EXPLORER_HEALTH_QUERY = `module=account&action=balance&address=${HEALTH_PROBE_ADDRESS}&tag=latest`;

/**
 * Puertas del explorador de Flare, en orden de preferencia.
 * FLARESCAN_API_URL las sustituye por completo (una o varias, separadas por comas).
 */
export function flareExplorerBases(): string[] {
  const override = process.env.FLARESCAN_API_URL;
  if (override) {
    const bases = override
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (bases.length > 0) return bases;
  }
  return [ROUTESCAN_FLARE_API, BLOCKSCOUT_FLARE_API];
}

/** La primera puerta — para quien solo admite una URL (ChainExplorerProvider). */
export function flareExplorerPrimary(): string {
  return flareExplorerBases()[0];
}

/** Host legible para los mensajes de salud: nadie diagnostica con una URL de 90 chars. */
export function explorerHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

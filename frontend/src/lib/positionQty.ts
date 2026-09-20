/**
 * positionQty — la cantidad de una posición, en unidades HUMANAS.
 *
 * `amount` viaja en unidades BASE por todo el tablero (de ahí `sharesBase`,
 * `supplyFxrpBase`, `debtUsdt0Base`: alimentan calldata), y el subtítulo de la
 * tarjeta lo escupía crudo. Con la asimetría 6/18 del carril de Ethereum eso
 * significaba enseñar «10000000» por 10 FXRP y «1000000000000000000000» por
 * 1000 RLUSD — un número equivocado por un factor de 10⁶/10¹⁸ delante de
 * alguien a punto de firmar (hallazgo C de la auditoría del 17-ago).
 *
 * Vive aquí y no dentro de `DefiPositionsBoard.tsx` porque importar ese
 * componente arrastra AppKit, el SDK de Aptos y medio grafo de dependencias: la
 * lógica que decide QUÉ NÚMERO VE EL USUARIO era intesteable por vecindad.
 */
import { fmtQtyActive } from './format';

/**
 * Los decimales se LEEN de la fila (los adapters los traen del ledger). Si no
 * vienen, no se inventa un 18 por defecto: se enseña el valor tal cual.
 *
 * Ese «no inventar» es la mitad de la regla, y la que más protege. Un 18
 * asumido sobre un token de 6 decimales convierte 10 FXRP en 0,00000000001 —
 * una mentira mucho más creíble que el número crudo, y por eso más peligrosa.
 */
export function qtyDisplay(p: {
  amount: string | number;
  decimals?: unknown;
  raw?: unknown;
}): string {
  const decimals = Number(
    (p as { decimals?: unknown }).decimals ?? (p.raw as { decimals?: unknown } | undefined)?.decimals,
  );
  const amount = String(p.amount);
  if (!Number.isFinite(decimals) || decimals < 0 || !/^\d+$/.test(amount)) return amount;
  const human = Number(amount) / 10 ** decimals;
  return Number.isFinite(human) ? fmtQtyActive(human, Math.min(6, decimals)) : amount;
}

/**
 * snapshotQty — la cantidad de una fila del snapshot de portfolio, en unidades
 * humanas, o `null` si no se puede saber.
 *
 * Misma familia de bug que `qtyDisplay`, otra superficie (Token Inventory,
 * 14-sep-2026): la tabla enseñaba `position.amount` crudo, y ese campo del
 * snapshot es AMBIGUO por construcción —
 *
 *   · las lecturas on-chain (FLR, FXRP…) lo traen en unidades BASE → «400 548
 *     823 209 107 060 000 FLR» por 400,55 FLR, y «10 453 867» por 10,45 FXRP;
 *   · los proveedores externos (XRPL, potes) nunca tuvieron unidades base y lo
 *     dejaban en «0» → cada fila de XRP salía con un 0 al lado de su valor.
 *
 * El backend ahora resuelve la cantidad donde se conocen los decimales y la
 * manda en `qty`. Aquí solo se elige la mejor fuente disponible:
 *
 *   1. `qty` — exacta, del backend.
 *   2. valor ÷ precio — la derivación que ya usaba el resto del tablero. No es
 *      un invento: `amountUSD = cantidad × precio` aguas arriba, y para tokens
 *      de recibo (sFLR, earnXRP) NormalisationEngine calibra `priceUSD` por
 *      share justamente para que esta división devuelva el número de shares.
 *   3. nada (`null` → «—»). Sin precio y sin decimales no hay cantidad, y
 *      enseñar el entero crudo es peor que no enseñar nada.
 */
export function snapshotQty(p: {
  qty?: string | null;
  amountUSD?: number | null;
  priceUSD?: number | null;
}): number | null {
  const exact = p.qty != null && p.qty !== '' ? Number(p.qty) : NaN;
  if (Number.isFinite(exact) && exact !== 0) return exact;
  const usd = typeof p.amountUSD === 'number' ? p.amountUSD : 0;
  const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
  if (usd === 0 || price <= 0) return Number.isFinite(exact) ? exact : null;
  return Math.abs(usd) / price;
}

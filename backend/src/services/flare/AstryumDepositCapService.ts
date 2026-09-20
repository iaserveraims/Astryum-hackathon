/**
 * AstryumDepositCapService — el tope de posición por cuenta, dicho ANTES de firmar.
 *
 * Desde la V2 un pote puede nacer (o recibir por orden) un `maxDepositPerUser`:
 * lo aplica el propio ERC-4626 en `maxDeposit(receiver)` y `deposit` revierte con
 * `ERC4626ExceededMaxDeposit` si se pasa. Eso es correcto y suficiente on-chain,
 * pero llega DESPUÉS de firmar: en el carril EVM tras aprobar el token, y en el
 * carril XRP tras gastar el XRP y pagar la ronda FDC (~20 FLR). Aquí se lee el
 * hueco que le queda a la cuenta y se rechaza antes (lección del direct a
 * Kinetic: no dejar firmar una orden condenada).
 */

import { ethers } from 'ethers';

const MAX_DEPOSIT_ABI = ['function maxDeposit(address receiver) view returns (uint256)'];

/** Lo que ESTA cuenta puede meter aún, según el pote. null = no se pudo leer. */
export async function readDepositHeadroom(
  provider: ethers.Provider,
  pote: string,
  receiver: string,
): Promise<bigint | null> {
  try {
    const c = new ethers.Contract(pote, MAX_DEPOSIT_ABI, provider);
    return (await c.maxDeposit(receiver)) as bigint;
  } catch {
    return null;
  }
}

export type DepositCapCheck =
  | { ok: true; headroom: bigint | null }
  | { ok: false; code: 'DEPOSIT_CAP_PER_USER'; headroom: bigint; amount: bigint };

/**
 * Pura. `headroom === null` (no se pudo leer) NO bloquea: el contrato decide y
 * «no pude leer» nunca es «no puedes». Un hueco de 0 sí bloquea cualquier importe.
 */
export function checkDepositCap(headroom: bigint | null, amount: bigint): DepositCapCheck {
  if (headroom === null) return { ok: true, headroom: null };
  if (amount > headroom) return { ok: false, code: 'DEPOSIT_CAP_PER_USER', headroom, amount };
  return { ok: true, headroom };
}

/** El 409 que ve el usuario: cuánto cabe aún, en unidades humanas y en base. */
export function depositCapRefusal(
  check: Extract<DepositCapCheck, { ok: false }>,
  asset: { symbol: string; decimals: number },
): { error: 'DEPOSIT_CAP_PER_USER'; detail: string; headroomBase: string; headroom: string; amountBase: string } {
  const headroom = ethers.formatUnits(check.headroom, asset.decimals);
  const amount = ethers.formatUnits(check.amount, asset.decimals);
  return {
    error: 'DEPOSIT_CAP_PER_USER',
    detail:
      check.headroom === 0n
        ? `Esta cuenta ya está en el máximo que este pote admite por cuenta. No cabe más; salir siempre cabe.`
        : `Este pote admite un máximo por cuenta. A esta cuenta le caben ${headroom} ${asset.symbol} más, y el depósito pedía ${amount} ${asset.symbol}. Baja el importe.`,
    headroomBase: check.headroom.toString(),
    headroom,
    amountBase: check.amount.toString(),
  };
}

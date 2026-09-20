/**
 * ScheduledPaymentService — the personal twin of the governed «domiciliación»
 * (M1, plan del mes §3 · Última Milla §1.4/§2, built).
 */

import { isValidClassicAddress, validate } from 'xrpl';
import { withSourceTag } from '../config/xrplSourceTag';

export interface ComposedScheduledPayment {
  /** The wallet that owns the rule and MUST be the one signing. */
  owner: string;
  xrplTx: Record<string, unknown>;
  summary: string;
}

const MAX_MEMO_CHARS = 200;
const MAX_DESTINATION_TAG = 0xffffffff; // uint32 — the ledger's own bound

/**
 * Compose the UNSIGNED Payment a fired `scheduledPayment` rule describes.
 * params: { destination, amountDrops, memo?, destinationTag? }. Throws a
 * readable error on anything invalid — the tick surfaces it honestly as a
 * failed run instead of nudging the owner toward a broken signature.
 */
export function composeScheduledPaymentTx(
  owner: string,
  params: Record<string, unknown>,
): ComposedScheduledPayment {
  if (!isValidClassicAddress(owner)) {
    throw new Error(`scheduledPayment rules belong to an XRPL wallet — "${owner}" is not an r-address`);
  }
  const destination = String(params.destination ?? '');
  if (!isValidClassicAddress(destination)) {
    throw new Error('scheduledPayment needs params.destination (an XRPL r-address)');
  }
  if (destination === owner) {
    throw new Error('scheduledPayment destination must differ from the paying wallet');
  }
  const drops = BigInt(String(params.amountDrops ?? '0'));
  if (drops <= 0n) throw new Error('scheduledPayment needs params.amountDrops > 0 (XRP drops, integer)');
  const memo = typeof params.memo === 'string' && params.memo.trim() ? params.memo.trim().slice(0, MAX_MEMO_CHARS) : null;
  // Many custodial destinations (exchanges) demand a DestinationTag — a
  // payment without it can land in limbo. Optional, validated as uint32.
  let destinationTag: number | null = null;
  if (params.destinationTag !== undefined && params.destinationTag !== null && params.destinationTag !== '') {
    const tag = Number(params.destinationTag);
    if (!Number.isInteger(tag) || tag < 0 || tag > MAX_DESTINATION_TAG) {
      throw new Error('scheduledPayment destinationTag must be a whole number between 0 and 4294967295');
    }
    destinationTag = tag;
  }
  const tx = withSourceTag({
    TransactionType: 'Payment' as const,
    Account: owner,
    Destination: destination,
    Amount: drops.toString(),
    ...(destinationTag !== null ? { DestinationTag: destinationTag } : {}),
    ...(memo
      ? { Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }] }
      : {}),
  });
  validate(tx as never);
  return {
    owner,
    xrplTx: tx,
    summary: `Payment of ${Number(drops) / 1_000_000} XRP to ${destination}${destinationTag !== null ? ` (tag ${destinationTag})` : ''}`,
  };
}

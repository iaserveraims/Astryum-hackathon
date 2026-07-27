/**
 * XrplDexService — native DEX order builders (Fase 2.2, PRIORIDAD 2).
 *
 * OfferCreate/OfferCancel on the XRPL CLOB DEX (auto-bridging via XRP is a
 * ledger feature, not ours). These are the primitives DCA ("compra X cada
 * semana") and spot stop-loss ("si XRP toca $X vende a RLUSD") compose in
 * Fase 3 — each execution is one N1 signature in Xaman, never a stored
 * pre-signed blob.
 *
 * Flag semantics (verified against xrpl.js 4.5 OfferCreateFlags):
 *   - tfImmediateOrCancel → market-style swap: fill what crosses now, cancel
 *     the rest, never rests on the book.
 *   - tfFillOrKill        → all-or-nothing: full fill now or the tx does nothing.
 *   - tfPassive           → rests on the book without crossing equal-priced offers.
 *   - tfSell              → spend all of TakerGets even if it fills better than asked.
 *
 * Unsigned txjson → Xaman. Astryum signs nothing. SourceTag always.
 */

import { isValidClassicAddress, isoTimeToRippleTime, validate, OfferCreateFlags } from 'xrpl';
import type { Amount, OfferCreate, OfferCancel } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import { assertPositiveDrops, type XrplTxHandoff } from './XrplTxHandoff';

/** Validates an XRPL Amount: drops string (XRP) or {currency, issuer, value} (IOU). */
function assertAmount(amount: Amount, field: string): void {
  if (typeof amount === 'string') {
    assertPositiveDrops(amount, field);
    return;
  }
  if (typeof amount === 'object' && amount !== null) {
    const { currency, issuer, value } = amount as { currency?: string; issuer?: string; value?: string };
    if (!currency) throw new Error(`${field}.currency is required for IOU amounts`);
    if (!issuer || !isValidClassicAddress(issuer)) {
      throw new Error(`${field}.issuer must be a valid XRPL address for IOU amounts`);
    }
    if (!value || !(Number(value) > 0)) {
      throw new Error(`${field}.value must be a positive decimal string`);
    }
    return;
  }
  throw new Error(`${field} must be a drops string (XRP) or an IOU amount object`);
}

function describeAmount(amount: Amount): string {
  return typeof amount === 'string'
    ? `${amount} drops of XRP`
    : `${(amount as { value: string }).value} ${(amount as { currency: string }).currency}`;
}

export interface BuildOfferCreateInput {
  /** The XRPL account placing the order (the signer in Xaman). */
  account: string;
  /** What the taker receives = what YOU are selling. */
  takerGets: Amount;
  /** What the taker pays = what YOU are buying. */
  takerPays: Amount;
  flags?: {
    /** Market-style: fill immediately, cancel the remainder. */
    immediateOrCancel?: boolean;
    /** All-or-nothing fill. */
    fillOrKill?: boolean;
    /** Rest on the book without crossing equal-priced offers. */
    passive?: boolean;
    /** Sell-side semantics (spend all TakerGets). */
    sell?: boolean;
  };
  /** Optional ISO-8601 expiry for resting orders. */
  expirationISO?: string;
}

export function buildOfferCreate(
  input: BuildOfferCreateInput,
): XrplTxHandoff<OfferCreate & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  assertAmount(input.takerGets, 'takerGets');
  assertAmount(input.takerPays, 'takerPays');

  const f = input.flags ?? {};
  if (f.immediateOrCancel && f.fillOrKill) {
    throw new Error('immediateOrCancel and fillOrKill are mutually exclusive (temINVALID_FLAG)');
  }
  if (f.passive && (f.immediateOrCancel || f.fillOrKill)) {
    throw new Error('passive contradicts immediateOrCancel/fillOrKill (a passive order must rest)');
  }

  let flags = 0;
  if (f.immediateOrCancel) flags |= OfferCreateFlags.tfImmediateOrCancel;
  if (f.fillOrKill) flags |= OfferCreateFlags.tfFillOrKill;
  if (f.passive) flags |= OfferCreateFlags.tfPassive;
  if (f.sell) flags |= OfferCreateFlags.tfSell;

  let expiration: number | undefined;
  if (input.expirationISO !== undefined) {
    expiration = isoTimeToRippleTime(input.expirationISO);
    if (expiration <= isoTimeToRippleTime(new Date().toISOString())) {
      throw new Error(`expirationISO must be in the future, got ${input.expirationISO}`);
    }
  }

  const xrplTx = withSourceTag({
    TransactionType: 'OfferCreate' as const,
    Account: input.account,
    TakerGets: input.takerGets,
    TakerPays: input.takerPays,
    ...(flags !== 0 ? { Flags: flags } : {}),
    ...(expiration !== undefined ? { Expiration: expiration } : {}),
  }) as OfferCreate & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  const kind = f.immediateOrCancel
    ? 'market-style swap (fills now, remainder cancelled)'
    : f.fillOrKill
      ? 'fill-or-kill order (full fill or nothing)'
      : 'limit order (rests on the XRPL DEX book until filled/cancelled)';

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        `Astryum builds this unsigned OfferCreate; you sign it in Xaman. It places a ${kind}: ` +
        `sell ${describeAmount(input.takerGets)} for ${describeAmount(input.takerPays)} on the ` +
        'native XRPL DEX. Execution price comes from the open book (protocol data, not an Astryum quote).',
      facts: {
        selling: describeAmount(input.takerGets),
        buying: describeAmount(input.takerPays),
        orderKind: kind,
        ...(input.expirationISO !== undefined ? { expirationISO: input.expirationISO } : {}),
        network: 'XRPL mainnet',
      },
    },
  };
}

export interface BuildOfferCancelInput {
  /** The XRPL account that owns the offer (the signer in Xaman). */
  account: string;
  /** The Sequence of the OfferCreate to cancel (from account_objects). */
  offerSequence: number;
}

export function buildOfferCancel(
  input: BuildOfferCancelInput,
): XrplTxHandoff<OfferCancel & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  if (!Number.isInteger(input.offerSequence) || input.offerSequence <= 0) {
    throw new Error(`offerSequence must be a positive integer, got ${input.offerSequence}`);
  }

  const xrplTx = withSourceTag({
    TransactionType: 'OfferCancel' as const,
    Account: input.account,
    OfferSequence: input.offerSequence,
  }) as OfferCancel & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        'Astryum builds this unsigned OfferCancel; you sign it in Xaman. It removes your resting ' +
        'order from the XRPL DEX book. Cancelling a non-existent offer is a harmless no-op on-ledger.',
      facts: { offerSequence: input.offerSequence, network: 'XRPL mainnet' },
    },
  };
}

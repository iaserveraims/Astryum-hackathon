/**
 * XrplEscrowService — native XRP escrow builders (Fase 2.1, PRIORIDAD 1).
 *
 * The savings-escrow primitive: "aparta X XRP hasta la fecha Y". One user
 * signature locks the XRP (EscrowCreate with FinishAfter); after FinishAfter
 * ANY account can release it (EscrowFinish is permissionless for time-based
 * escrows) — a keeper needs no key over user funds, which is exactly the
 * trustless shape invariant #8 requires.
 *
 * ⚠ XRP ONLY. RLUSD (or any IOU) escrow needs the issuer's
 * `lsfAllowTrustLineLocking` flag (XLS-85), which the RLUSD issuer has OFF
 * (verified 2026-07-11 — the ecosystem watch re-checks it). The builder
 * rejects anything that is not XRP drops by construction.
 *
 * Unsigned txjson → Xaman. Astryum signs nothing. SourceTag always.
 */

import { isValidClassicAddress, isoTimeToRippleTime, validate, dropsToXrp } from 'xrpl';
import type { EscrowCancel, EscrowCreate, EscrowFinish } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import { assertPositiveDrops, type XrplTxHandoff } from './XrplTxHandoff';

export interface BuildEscrowCreateInput {
  /** The XRPL account that locks the XRP (the signer in Xaman). */
  account: string;
  /** Amount to lock, in drops (XRP only — see module note). */
  amountDrops: string;
  /** ISO-8601 date after which the escrow can be finished. Must be future. */
  finishAfterISO: string;
  /**
   * Optional ISO-8601 date after which the escrow can be CANCELLED (funds
   * return to the creator). Must be after finishAfterISO. Without it the XRP
   * stays claimable by the destination forever once finishable.
   */
  cancelAfterISO?: string;
  /** Defaults to `account` — the self-savings escrow ("aparta para mí"). */
  destination?: string;
  /**
   * Live per-object owner reserve in XRP (server_info `reserve_inc_xrp`) —
   * the EXTRA XRP the escrow immobilizes in the account while it exists,
   * on top of the escrowed amount. The route reads it from the ledger and
   * passes it in so the disclosure states the real current figure (#6);
   * never hardcode it here (it changed in 2024 and can change again).
   */
  ownerReserveXrp?: number;
}

export function buildEscrowCreate(
  input: BuildEscrowCreateInput,
): XrplTxHandoff<EscrowCreate & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  const destination = input.destination ?? input.account;
  if (!isValidClassicAddress(destination)) {
    throw new Error(`destination is not a valid XRPL address: ${destination}`);
  }
  assertPositiveDrops(input.amountDrops, 'amountDrops');

  const finishAfter = isoTimeToRippleTime(input.finishAfterISO);
  const nowRipple = isoTimeToRippleTime(new Date().toISOString());
  if (finishAfter <= nowRipple) {
    throw new Error(`finishAfterISO must be in the future, got ${input.finishAfterISO}`);
  }

  let cancelAfter: number | undefined;
  if (input.cancelAfterISO !== undefined) {
    cancelAfter = isoTimeToRippleTime(input.cancelAfterISO);
    if (cancelAfter <= finishAfter) {
      throw new Error('cancelAfterISO must be after finishAfterISO');
    }
  }

  const xrplTx = withSourceTag({
    TransactionType: 'EscrowCreate' as const,
    Account: input.account,
    Destination: destination,
    Amount: input.amountDrops,
    FinishAfter: finishAfter,
    ...(cancelAfter !== undefined ? { CancelAfter: cancelAfter } : {}),
  }) as EscrowCreate & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  const selfEscrow = destination === input.account;
  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        `Astryum builds this unsigned EscrowCreate; you sign it in Xaman. It locks ${dropsToXrp(
          input.amountDrops,
        )} XRP on the ledger until ${input.finishAfterISO}. ` +
        'The locked XRP EARNS NOTHING while locked — this is a savings lock, not a yield product. ' +
        `Creating it also sets aside the ledger's per-escrow owner reserve${
          input.ownerReserveXrp !== undefined ? ` (${input.ownerReserveXrp} XRP right now)` : ''
        } on top of the amount — that extra XRP is not spendable while the escrow exists and ` +
        'returns to your balance when it is released. ' +
        'After the unlock date anyone (you or a permissionless keeper) can release it with an ' +
        `EscrowFinish; the XRP always goes to ${selfEscrow ? 'YOUR OWN account' : 'the destination'} — ` +
        'no key over your funds is ever delegated. ' +
        (input.cancelAfterISO === undefined
          ? 'No expiry: the escrow waits until released, and only the release moves the funds. '
          : `If nobody releases it, after ${input.cancelAfterISO} you can cancel and recover the XRP. `) +
        'XRP only: RLUSD is not escrowable today (issuer flag off).',
      facts: {
        amountXrp: dropsToXrp(input.amountDrops),
        amountDrops: input.amountDrops,
        destination,
        selfEscrow,
        earnsYield: false,
        ...(input.ownerReserveXrp !== undefined ? { ownerReserveXrp: input.ownerReserveXrp } : {}),
        finishAfterISO: input.finishAfterISO,
        ...(input.cancelAfterISO !== undefined ? { cancelAfterISO: input.cancelAfterISO } : {}),
        network: 'XRPL mainnet',
      },
    },
  };
}

export interface BuildEscrowFinishInput {
  /**
   * The account SENDING the finish — after FinishAfter this can be anyone
   * (the owner, or a permissionless keeper signing with its OWN key).
   */
  account: string;
  /** The account that created the escrow. */
  owner: string;
  /** The Sequence of the EscrowCreate transaction (from the ledger object). */
  offerSequence: number;
}

export function buildEscrowFinish(
  input: BuildEscrowFinishInput,
): XrplTxHandoff<EscrowFinish & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  if (!isValidClassicAddress(input.owner)) {
    throw new Error(`owner is not a valid XRPL address: ${input.owner}`);
  }
  if (!Number.isInteger(input.offerSequence) || input.offerSequence < 0) {
    throw new Error(`offerSequence must be a non-negative integer, got ${input.offerSequence}`);
  }

  const xrplTx = withSourceTag({
    TransactionType: 'EscrowFinish' as const,
    Account: input.account,
    Owner: input.owner,
    OfferSequence: input.offerSequence,
  }) as EscrowFinish & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        'Astryum builds this unsigned EscrowFinish; whoever sends it signs with their own key. ' +
        'It releases a time-based escrow to its destination — possible for anyone once FinishAfter ' +
        'has passed. The escrowed XRP goes to the escrow destination, never to the sender.',
      facts: {
        owner: input.owner,
        offerSequence: input.offerSequence,
        permissionlessAfterFinishAfter: true,
        network: 'XRPL mainnet',
      },
    },
  };
}

export interface BuildEscrowCancelInput {
  /**
   * The account SENDING the cancel — after CancelAfter this can be anyone
   * (the owner, or a permissionless keeper signing with its OWN key).
   */
  account: string;
  /** The account that created the escrow (the XRP returns HERE, always). */
  owner: string;
  /** The Sequence of the EscrowCreate transaction (from the ledger object). */
  offerSequence: number;
}

/**
 * The recovery half of the promise buildEscrowCreate makes ("after CancelAfter
 * you can cancel and recover the XRP"). Mirror of buildEscrowFinish: EscrowCancel
 * is permissionless once CancelAfter has passed, and the escrowed XRP ALWAYS
 * returns to the escrow's creator (Owner) — never to whoever sends the cancel.
 * The ledger enforces both (tecNO_PERMISSION before CancelAfter).
 */
export function buildEscrowCancel(
  input: BuildEscrowCancelInput,
): XrplTxHandoff<EscrowCancel & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  if (!isValidClassicAddress(input.owner)) {
    throw new Error(`owner is not a valid XRPL address: ${input.owner}`);
  }
  if (!Number.isInteger(input.offerSequence) || input.offerSequence < 0) {
    throw new Error(`offerSequence must be a non-negative integer, got ${input.offerSequence}`);
  }

  const xrplTx = withSourceTag({
    TransactionType: 'EscrowCancel' as const,
    Account: input.account,
    Owner: input.owner,
    OfferSequence: input.offerSequence,
  }) as EscrowCancel & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        'Astryum builds this unsigned EscrowCancel; whoever sends it signs with their own key. ' +
        'It cancels an expired escrow — possible for anyone once CancelAfter has passed (the ' +
        'ledger rejects it before that). The escrowed XRP always returns to the account that ' +
        'created the escrow, never to the sender.',
      facts: {
        owner: input.owner,
        offerSequence: input.offerSequence,
        fundsReturnToOwner: true,
        permissionlessAfterCancelAfter: true,
        network: 'XRPL mainnet',
      },
    },
  };
}

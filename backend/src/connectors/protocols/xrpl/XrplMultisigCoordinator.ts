/**
 * XrplMultisigCoordinator — prepare ANY unsigned XRPL txjson for a council
 * (multisig) account so the quorum can sign it and the browser can broadcast it.
 */
import { withSourceTag } from '../../../config/xrplSourceTag';

/** The subset of XRPLProvider this coordinator reads — structural for testing. */
export interface MultisigLedgerReader {
  getSignerCouncil(address: string): Promise<{
    quorum: number;
    masterKeyDisabled: boolean;
    signers: Array<{ account: string; weight: number }>;
  } | null>;
  getAccountSequence(address: string): Promise<number>;
  getBaseFeeDrops(): Promise<number>;
  simulateTransaction(txjson: Record<string, unknown>): Promise<{
    available: boolean;
    willSucceed: boolean;
    engineResult?: string;
    engineResultMessage?: string;
    balanceChanges: Array<{ account: string; value: string; currency: string; issuer?: string }>;
  }>;
}

export interface MultisigPrepareResult {
  /** The txjson every council member signs, byte-for-byte identical. */
  multisigTx: Record<string, unknown>;
  council: {
    quorum: number;
    masterKeyDisabled: boolean;
    signers: Array<{ account: string; weight: number }>;
  };
  fee: { drops: string; baseFeeDrops: number; signerCount: number };
  /** Ledger dry-run (invariant #11) — feeds the disclosure with ledger truth. */
  preflight: Awaited<ReturnType<MultisigLedgerReader['simulateTransaction']>>;
  /**
   * WHICH SEAT THIS PAYLOAD TOOK, AND WHY.
   *
   * The caller used to have no way of knowing whether the Sequence it got was the
   * one another payload is already holding, so the seat-contest warning it wrote
   * was a guess. Now the pin says it: `ledger` (whatever `account_info` calls the
   * next unused Sequence) or `contested-seat` (the caller asked for a specific
   * one and it is still unused, so this payload was pinned to it deliberately).
   */
  sequence: {
    /** The Sequence stamped on the bytes. */
    pinned: number;
    /** What the ledger called the next unused Sequence at pin time. */
    ledgerNext: number;
    /** The Sequence the caller asked to be pinned to, when it asked for one. */
    requested?: number;
    source: 'ledger' | 'contested-seat';
    /**
     * The requested seat is already behind the ledger: something has consumed it
     * (the rival payload applied, or another transaction did). Nothing is
     * contested any more — this payload took the next free seat.
     */
    requestedSeatConsumed?: boolean;
  };
}

/** Raised when the target account has no SignerList (not a council account). */
export class NotACouncilError extends Error {
  constructor(account: string) {
    super(`${account} has no SignerList — it is not a council account`);
    this.name = 'NotACouncilError';
  }
}

/**
 * Fix an unsigned txjson for council multisig. `xrplTx` is whatever an existing
 * builder produced (EscrowCreate, DIDSet, SignerListSet, OfferCreate…), already
 * SourceTag-stamped; this pins Sequence/Fee/SigningPubKey and re-runs the tag
 * defensively. The result is ready to fan out to the council for signatures.
 */
/**
 * PINNING THE CONTESTED SEAT ON PURPOSE.
 *
 * WHAT THE WARNING PROMISED AND THIS FUNCTION DID NOT DO: an exit composed
 * against a council whose Sequence another payload already holds was told «the exit
 * takes the seat and the entry is the one that dies» — while this function pinned
 * whatever `account_info` happened to answer. That is the same number as the rival's
 * only by luck of timing, and XRPL settles the race by WHOEVER BROADCASTS FIRST, not
 * by who composed last. Nothing here can make an exit win that race.
 */
export async function prepareCouncilMultisig(
  reader: MultisigLedgerReader,
  input: { account: string; xrplTx: Record<string, unknown>; pinSequence?: number | null },
): Promise<MultisigPrepareResult> {
  const { account } = input;

  const council = await reader.getSignerCouncil(account);
  if (!council) throw new NotACouncilError(account);

  const [ledgerNext, baseFeeDrops] = await Promise.all([
    reader.getAccountSequence(account),
    reader.getBaseFeeDrops(),
  ]);

  const requested =
    typeof input.pinSequence === 'number' && Number.isInteger(input.pinSequence) && input.pinSequence > 0
      ? input.pinSequence
      : undefined;
  const takesContestedSeat = requested !== undefined && requested === ledgerNext;
  const sequence = takesContestedSeat ? requested : ledgerNext;
  const sequenceReport: MultisigPrepareResult['sequence'] = {
    pinned: sequence,
    ledgerNext,
    ...(requested !== undefined ? { requested } : {}),
    source: takesContestedSeat ? 'contested-seat' : 'ledger',
    ...(requested !== undefined && requested < ledgerNext ? { requestedSeatConsumed: true } : {}),
  };

  const signerCount = council.signers.length;
  const feeDrops = baseFeeDrops * (1 + signerCount);

  const multisigTx = withSourceTag({
    ...input.xrplTx,
    Account: account,
    Sequence: sequence,
    Fee: String(feeDrops),
    SigningPubKey: '', // the multisig marker: no single key owns this tx
  });

  // Simulate WITHOUT the empty SigningPubKey so `simulate` autofills signing
  // fields itself; the deltas are identical to the eventual multi-signed tx.
  const { SigningPubKey: _omit, ...preflightTx } = multisigTx;
  const preflight = await reader.simulateTransaction(preflightTx);

  return {
    multisigTx,
    council,
    fee: { drops: String(feeDrops), baseFeeDrops, signerCount },
    preflight,
    sequence: sequenceReport,
  };
}

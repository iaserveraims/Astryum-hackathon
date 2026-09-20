/**
 * XrplMultisigCoordinator — prepare ANY unsigned XRPL txjson for a council
 * (multisig) account so the quorum can sign it and the browser can broadcast it.
 *
 * This is the keystone of Astryum's authority layer (DECISIONS.md ADR-008). The
 * Xaman Multisign xApp cannot do this: it only builds a fixed set of tx types
 * from its own forms, it strips our SourceTag on rebuild, and it needs
 * reserve-consuming Tickets. XRPL multisig needs none of that — it is N
 * independent signatures over IDENTICAL bytes, combined. So we fix those bytes
 * here, once, before any member signs:
 *
 *   - Sequence  — read from the validated ledger (every member signs the same one)
 *   - Fee       — base x (1 + signerCount): a multisig pays one extra unit per signer
 *   - SigningPubKey: '' — the on-ledger marker that this tx is multi-signed
 *   - SourceTag — re-stamped defensively (the Make Waves attribution invariant)
 *
 * It NEVER signs, combines, or broadcasts. Combining (xrpl.multisign) and
 * broadcasting happen in the USER's browser (ADR-008 guardrail #3). This module
 * only reads the ledger and fixes the bytes — pure prepare-only.
 *
 * IT ALSO LEAVES NO TRACE — deliberately, and that had a consequence worth
 * naming here (g1-ceremonia, round 4). This function touches no database: it
 * reads the ledger and returns bytes, so it can be exercised with a structural
 * reader and reused by every door. The consequence is that PINNING A SEQUENCE
 * IS INVISIBLE unless the caller records it. The two asynchronous doors do
 * (they persist a CouncilProposal row); the SYNCHRONOUS ceremony
 * (`POST /api/xrpl-defi/multisign/prepare`) did not, so nothing server-side knew
 * that a council's only Sequence was already spoken for and the next compose
 * pinned the same one. The fix belongs to the caller, not here: that route now
 * writes a short-lived ceremony lease (`recordCeremonySeat` in
 * routes/councilProposals.ts, with its lifetime reasoned out there). This
 * module stays pure.
 *
 * The simulate preflight (invariant #11's XRPL half) runs here so the council
 * sees "this WILL succeed + these are the exact balance deltas" BEFORE anyone
 * pulls out a phone — the check that would have caught the reserve errors of the
 * 2026-07-14 rehearsal.
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
   * productizer it. 19 (finding 2.2) — WHICH SEAT THIS PAYLOAD TOOK, AND WHY.
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
 * productizer it. 19 (finding 2.2) — PINNING THE CONTESTED SEAT ON PURPOSE.
 *
 * WHAT THE it.17 WARNING PROMISED AND THIS FUNCTION DID NOT DO: an exit composed
 * against a council whose Sequence another payload already holds was told «the exit
 * takes the seat and the entry is the one that dies» — while this function pinned
 * whatever `account_info` happened to answer. That is the same number as the rival's
 * only by luck of timing, and XRPL settles the race by WHOEVER BROADCASTS FIRST, not
 * by who composed last. Nothing here can make an exit win that race.
 *
 * So the caller may now ask for the exact seat, and the truth is reported back:
 *   · `pinSequence` equal to the ledger's next unused Sequence → pinned DELIBERATELY
 *     to the contested seat (`source: 'contested-seat'`). Both payloads then carry the
 *     same Sequence and exactly one of them can ever apply; the other fails
 *     tefPAST_SEQ and costs its fee. Pinning the same number is ALL XRPL allows.
 *   · `pinSequence` BEHIND the ledger → the seat is already spent; honouring the
 *     request would compose a payload that is tefPAST_SEQ from birth, which is the
 *     one way to actually kill the exit. Ignored, the ledger's next seat is taken and
 *     `requestedSeatConsumed` says so.
 *   · `pinSequence` AHEAD of the ledger → a gap; the payload could not apply until
 *     the gap filled. Ignored too, with no gap ever composed on purpose.
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

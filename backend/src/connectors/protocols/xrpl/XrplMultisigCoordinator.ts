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
export async function prepareCouncilMultisig(
  reader: MultisigLedgerReader,
  input: { account: string; xrplTx: Record<string, unknown> },
): Promise<MultisigPrepareResult> {
  const { account } = input;

  const council = await reader.getSignerCouncil(account);
  if (!council) throw new NotACouncilError(account);

  const [sequence, baseFeeDrops] = await Promise.all([
    reader.getAccountSequence(account),
    reader.getBaseFeeDrops(),
  ]);

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
  };
}

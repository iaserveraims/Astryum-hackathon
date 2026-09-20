/**
 * XrplBlobVerifier — the post-sign, pre-submit guard for council multisig.
 *
 * Astryum's XRPL authority layer already has two safety checks; this is the one
 * that was missing IN BETWEEN them:
 */
import { decode, encode, encodeForMultisigning } from 'ripple-binary-codec';
import { verify } from 'ripple-keypairs';

/** Raised on ANY mismatch. The caller MUST NOT combine a blob that does not verify. */
export class BlobVerificationError extends Error {
  constructor(
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BlobVerificationError';
  }
}

export interface VerifiedSignerBlob {
  /** The council member whose signature this blob carries (verified === expected). */
  signer: string;
  signingPubKey: string;
  txnSignature: string;
  /** The decoded transaction WITHOUT the Signers array — the common bytes. */
  commonTx: Record<string, unknown>;
}

/**
 * Verify ONE returned Xaman multisign blob against the member we asked and the
 * transaction we built. Throws {@link BlobVerificationError} on any mismatch.
 *
 * @param signedBlob     hex the member's Xaman returned (`data.response.hex`)
 * @param expectedSigner the r-address we created THIS QR for
 * @param expectedTx     the byte-fixed txjson we fanned out (finalTx / multisigTx)
 */
export function verifySignerBlob(
  signedBlob: string,
  expectedSigner: string,
  expectedTx: Record<string, unknown>,
): VerifiedSignerBlob {
  // ── decode ──
  let decoded: Record<string, unknown>;
  try {
    decoded = decode(signedBlob) as unknown as Record<string, unknown>;
  } catch (err) {
    throw new BlobVerificationError(`blob does not decode as an XRPL transaction: ${(err as Error).message}`);
  }

  // ── structure: a per-member multisign blob, not a single-sig one ──
  if (decoded.SigningPubKey !== '') {
    throw new BlobVerificationError(
      'blob is single-signed (SigningPubKey is not empty) — a council signature must be a multisign blob',
      { signingPubKey: decoded.SigningPubKey },
    );
  }
  const signers = decoded.Signers as
    | Array<{ Signer?: { Account?: string; SigningPubKey?: string; TxnSignature?: string } }>
    | undefined;
  if (!Array.isArray(signers) || signers.length !== 1) {
    throw new BlobVerificationError(
      'blob does not carry exactly one Signers entry — a per-member sign request returns one signature',
      { signerCount: Array.isArray(signers) ? signers.length : 0 },
    );
  }
  const entry = signers[0].Signer;
  if (!entry?.Account || !entry.SigningPubKey || !entry.TxnSignature) {
    throw new BlobVerificationError('blob Signers entry is missing Account / SigningPubKey / TxnSignature');
  }

  // ── IDENTITY: the signature must be FROM the member we asked (closes the hole) ──
  if (entry.Account !== expectedSigner) {
    throw new BlobVerificationError(
      `blob was signed by ${entry.Account}, but this QR was created for ${expectedSigner} — wrong signer`,
      { signed: entry.Account, expected: expectedSigner },
    );
  }

  // ── FIDELITY: the signed tx must be the exact tx we built (minus Signers) ──
  const { Signers: _dropDecodedSigners, ...common } = decoded;
  const { Signers: _dropExpectedSigners, ...expectedCommon } = expectedTx;
  let encodedActual: string;
  let encodedExpected: string;
  try {
    encodedActual = encode(common as never);
    encodedExpected = encode(expectedCommon as never);
  } catch (err) {
    throw new BlobVerificationError(`transaction could not be re-encoded for comparison: ${(err as Error).message}`);
  }
  if (encodedActual !== encodedExpected) {
    throw new BlobVerificationError(
      'signed transaction does not match the transaction the council was asked to sign',
      { diff: fieldDiff(expectedCommon, common) },
    );
  }

  // ── SIGNATURE: the signature genuinely covers THIS tx, by the holder of this key ──
  // (Authorization of the key to the account — master vs regular key — is the
  // ledger's job at submit; checking it here would need another read and could
  // false-reject regular-key signers, so we verify signature-over-tx only.)
  let sigValid = false;
  try {
    sigValid = verify(
      encodeForMultisigning(common as never, entry.Account),
      entry.TxnSignature,
      entry.SigningPubKey,
    );
  } catch (err) {
    throw new BlobVerificationError(`signature could not be checked: ${(err as Error).message}`);
  }
  if (!sigValid) {
    throw new BlobVerificationError(`signature is not valid for ${entry.Account} over this transaction`);
  }

  return {
    signer: entry.Account,
    signingPubKey: entry.SigningPubKey,
    txnSignature: entry.TxnSignature,
    commonTx: common,
  };
}

/** List the fields that differ, so an operator can see WHAT drifted (not just THAT it did). */
function fieldDiff(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const diffs: string[] = [];
  for (const k of keys) {
    const e = JSON.stringify(expected[k]);
    const a = JSON.stringify(actual[k]);
    if (e !== a) diffs.push(`${k}: asked ${e ?? 'absent'} → signed ${a ?? 'absent'}`);
  }
  return diffs;
}

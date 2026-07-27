/**
 * verifySignerBlob (client-side) — the post-sign, pre-combine guard.
 *
 * Mirror of the backend XrplBlobVerifier. It has to live here because ADR-008 §3
 * forbids the server from ever touching a signed transaction: the blobs are
 * verified, combined, and broadcast entirely in the user's browser. So the guard
 * runs here, over the same three checks.
 *
 * Why it matters (the IDENTITY hole): each council QR is bound to one member with
 * Xaman's `signers` option, but some deployments reject it and we retry without —
 * on that path any member can answer any member's QR. One member could sign all N
 * QRs with their own key; the blobs would be byte-identical and xrpl.multisign()
 * would combine them happily, and the rehearsal verdict ("the ledger records WHO
 * signed") would LIE. This rejects a blob signed by the wrong member before it is
 * ever combined.
 */
import { decode, encode, encodeForMultisigning } from 'ripple-binary-codec';
import { verify } from 'ripple-keypairs';

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
  signer: string;
  signingPubKey: string;
  txnSignature: string;
}

/**
 * Verify ONE Xaman multisign blob against the member we asked and the tx we built.
 * Throws {@link BlobVerificationError} on any mismatch — the caller MUST NOT combine
 * a blob that does not verify.
 */
export function verifySignerBlob(
  signedBlob: string,
  expectedSigner: string,
  expectedTx: Record<string, unknown>,
): VerifiedSignerBlob {
  let decoded: Record<string, unknown>;
  try {
    decoded = decode(signedBlob) as unknown as Record<string, unknown>;
  } catch (err) {
    throw new BlobVerificationError(`blob does not decode as an XRPL transaction: ${(err as Error).message}`);
  }

  // Structure: a per-member multisign blob (empty SigningPubKey + exactly one Signer).
  if (decoded.SigningPubKey !== '') {
    throw new BlobVerificationError('blob is single-signed — a council signature must be a multisign blob');
  }
  const signers = decoded.Signers as
    | Array<{ Signer?: { Account?: string; SigningPubKey?: string; TxnSignature?: string } }>
    | undefined;
  if (!Array.isArray(signers) || signers.length !== 1) {
    throw new BlobVerificationError('blob does not carry exactly one Signers entry');
  }
  const entry = signers[0].Signer;
  if (!entry?.Account || !entry.SigningPubKey || !entry.TxnSignature) {
    throw new BlobVerificationError('blob Signers entry is missing Account / SigningPubKey / TxnSignature');
  }

  // IDENTITY: the signature must be FROM the member we asked.
  if (entry.Account !== expectedSigner) {
    throw new BlobVerificationError(
      `blob was signed by ${entry.Account}, but this QR was created for ${expectedSigner} — wrong signer`,
      { signed: entry.Account, expected: expectedSigner },
    );
  }

  // FIDELITY: the signed tx must be the exact tx we built (minus Signers).
  const { Signers: _a, ...common } = decoded;
  const { Signers: _b, ...expectedCommon } = expectedTx;
  let encodedActual: string;
  let encodedExpected: string;
  try {
    encodedActual = encode(common as never);
    encodedExpected = encode(expectedCommon as never);
  } catch (err) {
    throw new BlobVerificationError(`transaction could not be re-encoded for comparison: ${(err as Error).message}`);
  }
  if (encodedActual !== encodedExpected) {
    throw new BlobVerificationError('signed transaction does not match the transaction the council was asked to sign');
  }

  // SIGNATURE: genuinely covers THIS tx, by the holder of this key.
  let sigValid = false;
  try {
    sigValid = verify(encodeForMultisigning(common as never, entry.Account), entry.TxnSignature, entry.SigningPubKey);
  } catch (err) {
    throw new BlobVerificationError(`signature could not be checked: ${(err as Error).message}`);
  }
  if (!sigValid) {
    throw new BlobVerificationError(`signature is not valid for ${entry.Account} over this transaction`);
  }

  return { signer: entry.Account, signingPubKey: entry.SigningPubKey, txnSignature: entry.TxnSignature };
}

/**
 * XrplBlobVerifier — the post-sign, pre-submit guard (ADR-008). These tests pin
 * the two checks `xrpl.multisign()` does NOT do: that a blob came from the member
 * we asked (IDENTITY) and that it signs the tx we built (FIDELITY).
 *
 * The centrepiece is "the wrong-signer attack": it reproduces the silent hole in
 * legacy-multisign's retry path — one member answering another member's QR — and
 * proves the guard rejects it. That is the failure that would let a FALSE
 * rehearsal pass (verdict says "all signed"; ledger says one signed N times).
 */
import { Wallet, decode, encode } from 'xrpl';
import { verifySignerBlob, BlobVerificationError } from '../XrplBlobVerifier';

/** The byte-fixed tx a council would fan out — exactly what the coordinator builds. */
const EXPECTED_TX = {
  TransactionType: 'EscrowCreate',
  Account: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf',
  Destination: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf',
  Amount: '1000000',
  FinishAfter: 837462189,
  SourceTag: 2607090002,
  Sequence: 105597274,
  Fee: '40',
  SigningPubKey: '',
} as const;

/** A fresh copy per use — `Wallet.sign` mutates the tx it is handed. */
const tx = (overrides: Record<string, unknown> = {}) => ({ ...EXPECTED_TX, ...overrides });

/** One member's multisign blob over `t` (defaults to the expected tx). */
function signBlob(wallet: Wallet, t: Record<string, unknown> = tx()): string {
  return wallet.sign(t as never, true).tx_blob;
}

let memberA: Wallet;
let memberB: Wallet;

beforeAll(() => {
  memberA = Wallet.generate();
  memberB = Wallet.generate();
});

describe('verifySignerBlob', () => {
  it('accepts a genuine blob from the expected member over the expected tx', () => {
    const blob = signBlob(memberA);
    const result = verifySignerBlob(blob, memberA.classicAddress, tx());
    expect(result.signer).toBe(memberA.classicAddress);
    expect(result.signingPubKey).toBe(memberA.publicKey);
    expect(result.commonTx.TransactionType).toBe('EscrowCreate');
    expect(result.commonTx.Signers).toBeUndefined(); // Signers stripped from the common bytes
  });

  it('REJECTS the wrong-signer attack — a member answering another member’s QR', () => {
    // memberB signs, but the QR was created for memberA. multisign() would combine
    // this silently; the guard must not.
    const blob = signBlob(memberB);
    expect(() => verifySignerBlob(blob, memberA.classicAddress, tx())).toThrow(BlobVerificationError);
    try {
      verifySignerBlob(blob, memberA.classicAddress, tx());
    } catch (err) {
      expect((err as BlobVerificationError).message).toMatch(/wrong signer/i);
      expect((err as BlobVerificationError).detail).toEqual({
        signed: memberB.classicAddress,
        expected: memberA.classicAddress,
      });
    }
  });

  it('REJECTS a blob that signs a DIFFERENT transaction than the one we built', () => {
    // Right member, but a tampered Amount — fidelity must catch the drift.
    const blob = signBlob(memberA, tx({ Amount: '9999999' }));
    expect(() => verifySignerBlob(blob, memberA.classicAddress, tx())).toThrow(/does not match/i);
    try {
      verifySignerBlob(blob, memberA.classicAddress, tx());
    } catch (err) {
      const diff = (err as BlobVerificationError).detail?.diff as string[];
      expect(diff.some((d) => d.startsWith('Amount:'))).toBe(true);
    }
  });

  it('REJECTS a single-signed blob (SigningPubKey not empty)', () => {
    const single = memberA.sign(tx() as never).tx_blob; // no multisign flag
    expect(() => verifySignerBlob(single, memberA.classicAddress, tx())).toThrow(/single-signed/i);
  });

  it('REJECTS a blob with a corrupted signature (right member, right tx, bad sig)', () => {
    const good = decode(signBlob(memberA)) as Record<string, any>;
    const sig: string = good.Signers[0].Signer.TxnSignature;
    // Flip one hex nibble in the signature; identity + fidelity still pass, crypto must not.
    const flipped = sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
    good.Signers[0].Signer.TxnSignature = flipped;
    const badBlob = encode(good as never);
    expect(() => verifySignerBlob(badBlob, memberA.classicAddress, tx())).toThrow(/not valid/i);
  });

  it('REJECTS hex that is not a decodable XRPL transaction', () => {
    expect(() => verifySignerBlob('not-a-real-blob', memberA.classicAddress, tx())).toThrow(
      /does not decode/i,
    );
  });

  it('REJECTS a blob carrying more than one Signers entry', () => {
    // A pre-combined blob (two signers) is not a per-member response; reject it.
    const combined = decode(signBlob(memberA)) as Record<string, any>;
    const other = decode(signBlob(memberB)) as Record<string, any>;
    combined.Signers.push(other.Signers[0]);
    const twoSignerBlob = encode(combined as never);
    expect(() => verifySignerBlob(twoSignerBlob, memberA.classicAddress, tx())).toThrow(
      /exactly one Signers entry/i,
    );
  });
});

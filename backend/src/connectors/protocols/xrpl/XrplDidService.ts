/**
 * XrplDidService — the Legacy constitution anchor (vía (b), doc Legacy §5b).
 *
 * A Legacy's governance document ("la constitución") is anchored on the ledger
 * as a DID object (XLS-40, live on mainnet since 2024-10-30) owned by the
 * Legacy account: `Data` carries the document's SHA-256 hash, `URI` points at
 * where the document lives. The document itself NEVER goes on-chain (DID
 * fields are ≤256 bytes) — the ledger holds the fingerprint, not the text.
 *
 * Because the Legacy account is a multisig with the master key disabled, every
 * DIDSet is signed by the council's quorum → the account's DIDSet history IS
 * the council's consensus history, version by version.
 *
 * Copy rule (doc Legacy §0): this is a governance REGISTRY — "protegido por el
 * consejo". A DID compels nothing by itself; never present it as enforcement.
 *
 * Unsigned txjson → the council's wallet(s). Astryum signs nothing. SourceTag always.
 */

import { convertHexToString, convertStringToHex, isValidClassicAddress, validate } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import type { XrplTxHandoff } from './XrplTxHandoff';

/** XLS-40: every DID field is capped at 256 bytes (512 hex chars). */
const DID_FIELD_MAX_HEX = 512;
const SHA256_HEX_RE = /^[0-9A-Fa-f]{64}$/;

/** The DIDSet txjson shape (xrpl.js validates it; typed loosely on purpose). */
export interface DidSetTx extends Record<string, unknown> {
  TransactionType: 'DIDSet';
  Account: string;
  Data?: string;
  URI?: string;
  SourceTag?: number;
}

export interface BuildConstitutionAnchorInput {
  /** The Legacy account (multisig — the council signs; Astryum only composes). */
  account: string;
  /**
   * SHA-256 of the EXACT bytes of the governance document, 64 hex chars.
   * Computed client-side (or by the council) — the document never travels
   * through the backend, only its fingerprint.
   */
  documentSha256Hex: string;
  /** Where the document lives (IPFS/HTTPS…). Stored hex-encoded in URI. */
  documentUri?: string;
}

export function buildConstitutionAnchor(
  input: BuildConstitutionAnchorInput,
): XrplTxHandoff<DidSetTx> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  if (!SHA256_HEX_RE.test(input.documentSha256Hex)) {
    throw new Error('documentSha256Hex must be exactly 64 hex chars (a SHA-256 digest)');
  }
  let uriHex: string | undefined;
  if (input.documentUri !== undefined) {
    const trimmed = input.documentUri.trim();
    if (!trimmed) throw new Error('documentUri must not be blank when provided');
    uriHex = convertStringToHex(trimmed).toUpperCase();
    if (uriHex.length > DID_FIELD_MAX_HEX) {
      throw new Error(`documentUri exceeds the 256-byte DID field limit (XLS-40)`);
    }
  }

  const xrplTx = withSourceTag({
    TransactionType: 'DIDSet' as const,
    Account: input.account,
    Data: input.documentSha256Hex.toUpperCase(),
    ...(uriHex !== undefined ? { URI: uriHex } : {}),
  }) as DidSetTx;

  validate(xrplTx);

  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        'Astryum builds this unsigned DIDSet; the account\'s signers sign it in their own ' +
        'wallet (for a council account, the quorum). It anchors the SHA-256 fingerprint of ' +
        'your governance document on the XRPL ledger — the document itself stays off-chain. ' +
        'Anchoring registers the rules; it does not enforce them: the account is protected ' +
        'by its council (its signer quorum), and every future amendment is a new DIDSet the ' +
        'quorum must sign. Creating the DID object also sets aside one owner reserve while ' +
        'it exists.',
      facts: {
        documentSha256: input.documentSha256Hex.toUpperCase(),
        ...(input.documentUri !== undefined ? { documentUri: input.documentUri.trim() } : {}),
        enforcesByItself: false,
        amendableByQuorum: true,
        network: 'XRPL mainnet',
      },
    },
  };
}

// ── Reads (used by the Constitution page: current anchor + amendment history) ──

export interface ConstitutionAnchor {
  /** Raw hex of the DID object's Data field (the anchored SHA-256, if ours). */
  dataHex?: string;
  /** URI decoded to a string, when present and valid UTF-8. */
  uri?: string;
}

export interface ConstitutionAmendment {
  txHash: string;
  /** Validated close time, ISO-8601, when known. */
  dateISO?: string;
  dataHex?: string;
  uri?: string;
  /** True when the tx carried Signers (a multisig quorum signed it). */
  signedByQuorum: boolean;
}

/** Decode a hex URI defensively — a bad URI must never break the read. */
export function decodeUriHex(uriHex: unknown): string | undefined {
  if (typeof uriHex !== 'string' || !uriHex) return undefined;
  try {
    return convertHexToString(uriHex);
  } catch {
    return undefined;
  }
}

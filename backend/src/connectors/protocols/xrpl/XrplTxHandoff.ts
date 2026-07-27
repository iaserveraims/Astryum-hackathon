/**
 * XrplTxHandoff — the shared shape every XRPL builder returns.
 *
 * Mirrors the Flare `DirectMintHandoff` contract: the backend composes an
 * UNSIGNED txjson plus a full disclosure (invariant #6), the frontend passes
 * the txjson to Xaman (`XamanWalletService.signTransaction`, submit:false —
 * Xaman auto-fills Fee/Sequence/LastLedgerSequence), and the USER signs.
 * Astryum signs nothing, submits nothing, holds no seed.
 *
 * Every builder stamps the txjson with `withSourceTag()` before returning it —
 * no Astryum-composed XRPL tx leaves without the Make Waves project tag.
 */

export interface XrplTxDisclosure {
  /** Invariant #6 — fees/facts visible before signing. Always true. */
  disclosedToUser: true;
  /** Invariant #1 — Astryum never signs. Always false. */
  defibroSigns: false;
  /** Plain-language description of exactly what the user is about to sign. */
  note: string;
  /** The numbers behind the note (amounts, dates, fees as protocol data). */
  facts: Record<string, string | number | boolean>;
}

export interface XrplTxHandoff<Tx> {
  /** UNSIGNED txjson for Xaman. SourceTag stamped when configured. */
  xrplTx: Tx;
  disclosure: XrplTxDisclosure;
}

/** Integer-drops guard shared by builders (1 XRP = 1_000_000 drops). */
export function assertPositiveDrops(drops: string, field: string): void {
  if (!/^[0-9]+$/.test(drops) || BigInt(drops) <= 0n) {
    throw new Error(`${field} must be a positive integer amount of drops, got "${drops}"`);
  }
}

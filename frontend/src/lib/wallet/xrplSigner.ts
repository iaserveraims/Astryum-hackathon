/**
 * xrplSigner — who signs a prepared XRPL transaction.
 *
 * A payload that PINS its `Account` needs no Xaman session in this browser:
 * the server payload names the account and Xaman asks for exactly that one
 * when scanned — the path the manager console and the vault entry already use.
 * — it was LINKED to the account, not connected in that browser,
 * and ten surfaces gated on the session instead of on the signer. Pure, so the
 * gates can be tested without the wallet service graph.
 */

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** The XRPL account a prepared transaction is pinned to, or null. */
export function pinnedXrplSigner(tx: unknown): string | null {
  const acct = (tx as { Account?: unknown } | null | undefined)?.Account;
  return typeof acct === 'string' && XRPL_ADDRESS_RE.test(acct) ? acct : null;
}

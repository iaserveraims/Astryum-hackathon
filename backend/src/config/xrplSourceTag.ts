/**
 * XRPL SourceTag — the Make Waves project tag (B.0 carve-out).
 *
 * EVERY XRPL transaction Astryum composes must carry this tag so on-ledger
 * activity is attributable to the project (the buildathon leaderboard counts
 * tagged accounts). The tag value is ASSIGNED BY THE PLATFORM when the project
 * is created in the Make Waves panel — until the founder creates it, the env
 * var stays unset and payments go out untagged (valid either way: SourceTag is
 * an optional common field of every XRPL transaction; Xaman passes txjson
 * through unchanged).
 *
 * ⚠ SourceTag ≠ DestinationTag. A DestinationTag on the FAssets direct-mint
 * Payment would MISROUTE the mint and stays forbidden (see
 * FlareDirectMintService). SourceTag does not affect routing — it only labels
 * the sender's side.
 *
 * Every future XRPL builder (EscrowCreate, OfferCreate, AMMDeposit…) must
 * import {@link getXrplSourceTag} and stamp its txjson — that is the rule that
 * keeps "no Astryum-composed tx leaves without the tag" true.
 *
 * ── The one carve-out: transactions Astryum itself signs ────────────────────
 * The tag attributes activity to the project, and the Challenge rules define
 * the unit of that activity as the SIGNER: *"An Active User means an XRPL
 * address that has signed at least 1 transaction carrying your Source Tag"*
 * (Make Waves T&C v1.0 §6). The same rules prohibit *"self-dealing, scripted
 * transactions or other forms of metric manipulation"* (§7) on pain of
 * disqualification and forfeiture of any prize.
 *
 * An operational Astryum account (the escrow keeper's `XRPL_KEEPER_SEED`) is
 * OURS and its ticks are scripted. Stamping the project tag on those would
 * enrol our own address as an "active account" of the project — literally the
 * §7 pattern, for a gain of +1 address against a 300-address bar. So:
 *
 *   attribution 'user'        → the USER signs it   → stamp the tag (default)
 *   attribution 'operational' → ASTRYUM signs it    → NEVER stamp the tag
 *
 * The default is 'user' because that is the overwhelming case and an omitted
 * tag is silently lost attribution; the operational path has to say so.
 */

const UINT32_MAX = 0xffffffff;

let cached: number | undefined | null = null; // null = not read yet

/**
 * The project SourceTag from XRPL_SOURCE_TAG, or undefined when unset/invalid.
 * UInt32 per the XRPL common-fields spec.
 */
export function getXrplSourceTag(): number | undefined {
  if (cached !== null) return cached;
  const raw = process.env.XRPL_SOURCE_TAG;
  if (!raw || !raw.trim()) {
    // Loud, once per process: an untagged tx is a tx that does NOT count for
    // the Make Waves leaderboard. Composing still works (SourceTag is an
    // optional common field) — but nobody should discover this after the fact.
    // eslint-disable-next-line no-console
    console.warn(
      '[xrplSourceTag] XRPL_SOURCE_TAG is NOT set — XRPL txs will go out UNTAGGED and will not count toward the Make Waves leaderboard.',
    );
    cached = undefined;
    return cached;
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > UINT32_MAX) {
    // eslint-disable-next-line no-console
    console.warn(`[xrplSourceTag] XRPL_SOURCE_TAG=${raw} is not a UInt32 — ignoring (txs go untagged)`);
    cached = undefined;
    return cached;
  }
  cached = n;
  return cached;
}

/**
 * Who signs the transaction being composed — decides whether the project tag
 * belongs on it. See the carve-out in this file's header.
 */
export type XrplTxAttribution = 'user' | 'operational';

/**
 * Stamp an XRPL txjson object with the project SourceTag (no-op when unset,
 * and no-op for `operational` transactions Astryum signs with its own key).
 */
// `T extends object` (not Record<string, unknown>): the typed composers return
// interfaces (CredentialAcceptTx, PermissionedDomainSetTx…), which carry no
// index signature and would not fit a Record constraint.
export function withSourceTag<T extends object>(
  txjson: T,
  attribution: XrplTxAttribution = 'user',
): T & { SourceTag?: number } {
  if (attribution === 'operational') return txjson;
  const tag = getXrplSourceTag();
  return tag === undefined ? txjson : { ...txjson, SourceTag: tag };
}

/**
 * XRPL accounts Astryum itself operates in this deployment. Whatever they sign
 * is 'operational' and never carries the project tag. Read from config at call
 * time, never hardcoded:
 *   - ASTRYUM_ORDER_ANCHOR / LEGACY_ORDER_ANCHOR — the order anchors, whose
 *     seeds live on the server (anchor feeding).
 *   - MANAGER_CREDENTIAL_ISSUERS — the accepted credential issuers. Today that
 *     is Astryum's own notary issuer (MANAGER_ISSUER_SEED). A third-party issuer
 *     listed here later is a partner, not a product user: leaving its
 *     CredentialCreate untagged loses nothing and can never enrol a non-user.
 *   - ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS — any other operational account,
 *     comma-separated.
 *   - the demo exchange OMNIBUS, DERIVED from DEMO_EXCHANGE_OMNIBUS_SEED when
 *     the seed is present. The desk funds the pote from the omnibus through
 *     institutional.ts with `attributionForSigner(account)`: an env list that
 *     forgot it stamped the project tag on our own scripted account (T&C §7).
 *     A seed this backend holds is operational by definition — no list needed.
 */
export function astryumOperationalXrplAccounts(): Set<string> {
  const accounts = new Set<string>();
  const add = (raw: string | undefined) => {
    for (const part of (raw ?? '').split(',')) {
      const account = part.trim();
      if (account) accounts.add(account);
    }
  };
  add(process.env.ASTRYUM_ORDER_ANCHOR);
  add(process.env.LEGACY_ORDER_ANCHOR);
  add(process.env.MANAGER_CREDENTIAL_ISSUERS);
  add(process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS);
  add(demoExchangeOmnibusAddress() ?? undefined);
  return accounts;
}

// Cached by a HASH of the seed, never the seed itself: a Railway edit +
// restart re-derives, steady state costs one sha256.
let cachedOmnibus: { seedHash: string; address: string | null } | null = null;

/**
 * The classic address DEMO_EXCHANGE_OMNIBUS_SEED opens, or null (unset, or a
 * seed that derives nothing — that seed cannot sign either). Never throws and
 * never logs: the seed must not reach a log line or an error message. xrpl.js
 * is required lazily so importing this config stays light.
 */
function demoExchangeOmnibusAddress(): string | null {
  const seed = (process.env.DEMO_EXCHANGE_OMNIBUS_SEED ?? '').trim();
  if (!seed) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  const seedHash = createHash('sha256').update(seed).digest('hex');
  if (cachedOmnibus?.seedHash !== seedHash) {
    let address: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { diagnoseXrplSecret } = require('../utils/xrplSecret') as typeof import('../utils/xrplSecret');
      address = diagnoseXrplSecret(seed).address ?? null;
    } catch {
      address = null;
    }
    cachedOmnibus = { seedHash, address };
  }
  return cachedOmnibus.address;
}

/**
 * The attribution of a transaction whose signing account is known when it is
 * composed: 'operational' for an account Astryum operates, 'user' otherwise.
 * Use it wherever one composer serves both kinds of signer (a credential
 * issuer can be a user's root or Astryum's notary; an anchor owner can be us).
 */
export function attributionForSigner(account: string): XrplTxAttribution {
  return astryumOperationalXrplAccounts().has(account.trim()) ? 'operational' : 'user';
}

/** Test hook — clears the memoised env read. */
export function _resetXrplSourceTagCache(): void {
  cached = null;
}

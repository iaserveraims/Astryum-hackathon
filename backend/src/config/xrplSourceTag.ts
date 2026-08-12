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
export function withSourceTag<T extends Record<string, unknown>>(
  txjson: T,
  attribution: XrplTxAttribution = 'user',
): T & { SourceTag?: number } {
  if (attribution === 'operational') return txjson;
  const tag = getXrplSourceTag();
  return tag === undefined ? txjson : { ...txjson, SourceTag: tag };
}

/** Test hook — clears the memoised env read. */
export function _resetXrplSourceTagCache(): void {
  cached = null;
}

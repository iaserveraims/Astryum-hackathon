/**
 * The cage as portfolio positions — so Legacy reads like Personal everywhere.
 *
 * The council's principal lives in a CONTRACT (LegacyVault), not in a wallet,
 * so the wallet-sum aggregator never saw it: the Summary showed the council's
 * XRP and called the cage's capital invisible. This
 * service attributes the vault's capital to the XRPL account the vault OBEYS —
 * verified against the bridge's immutable COUNCIL_ADDRESS_HASH (keccak256 of
 * the r-address bytes), never assumed — and emits it as normal
 * CanonicalPositions: working principal per venue (kind 'collateral' → SUPPLY,
 * counts as earning), idle principal ('free'), yield owed to payees
 * ('reward'). Net worth, the earning ring and the strategies shelf then count
 * the cage with zero special cases, exactly like a personal position.
 */

import type { CanonicalPosition } from '../../canonical/types/Position';
import type { LegacyVaultState } from './LegacyVaultStateService';

const FLARE_CHAIN_ID = 14;

/** The vault state behind a short TTL: reading the cage is ~10 RPC calls, and
 *  the dashboard re-scans far more often than the vault changes (only an
 *  executed order / deposit / harvest moves it). 60s keeps repeat scans
 *  instant without letting the Summary drift meaningfully. */
const VAULT_STATE_TTL_MS = 60_000;
/** Keyed BY VAULT: one cache for "the" cage would serve one Legacy's numbers to
 *  the next one the moment a second stack exists. */
const vaultStateCache = new Map<
  string,
  { at: number; state: import('./LegacyVaultStateService').LegacyVaultState }
>();

/**
 * The abstraction layer for the person: a venue names the PROTOCOL it works in —
 * the same slug Personal positions use, so the strategy card reads "kinetic"
 * with the same logo and words — never a receipt-token symbol or a venue id.
 * The naming itself lives in LegacyVaultStateService (one answer, shared with
 * the council-order summary); here it is only lowercased into a protocol slug.
 */
function venueProtocolSlug(target: string, targetSymbol: string | null, venueId: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { venueProtocolName } = require('./LegacyVaultStateService') as {
    venueProtocolName: (v: { target: string }) => string | null;
  };
  const name = venueProtocolName({ target });
  if (name) return name.toLowerCase();
  return targetSymbol ?? `legacy-venue-${venueId}`;
}

/**
 * Is this XRPL account the council the configured bridge obeys?
 * False (never a throw) when the legacy stack is unset or unreadable — a
 * portfolio scan must not fail because the cage cannot be resolved.
 *
 * This was the ONE surface that asked the question at all; It
 * is asked everywhere, so the answer lives in LegacyCageResolver (the seam for
 * per-Legacy stacks) and this stays as its portfolio-facing name.
 */
export async function isCouncilAccount(account: string): Promise<boolean> {
  const { cageForCouncil } = await import('./LegacyCageResolver');
  return (await cageForCouncil(account)) !== null;
}

/**
 * Pure builder: the vault's live state → CanonicalPositions attributed to the
 * council account. Same $1 dust rule as the XRPL wallet reader; a retired,
 * emptied venue emits nothing.
 */
export function buildCagePositions(
  state: LegacyVaultState,
  account: string,
  xrpPrice: number,
  traceId: string,
): CanonicalPosition[] {
  if (!(xrpPrice > 0)) return [];
  const decimals = state.asset.decimals;
  const toQty = (baseUnits: string) => Number(baseUnits) / 10 ** decimals;
  const source = {
    providerId: 'legacy-cage',
    providerType: 'data' as const,
    trustLevel: 'onchain_verified' as const,
    fetchedAt: new Date().toISOString(),
    traceId,
  };
  const positions: CanonicalPosition[] = [];
  const push = (idSuffix: string, protocol: string, kind: CanonicalPosition['kind'], qty: number) => {
    const amountUSD = qty * xrpPrice;
    if (!Number.isFinite(amountUSD) || amountUSD < 1) return;
    positions.push({
      id: `legacy-cage:${state.vault}:${idSuffix}`,
      wallet: account,
      chainId: FLARE_CHAIN_ID,
      protocol,
      kind,
      assets: [
        {
          asset: {
            symbol: state.asset.symbol,
            address: state.asset.address,
            chainId: FLARE_CHAIN_ID,
            decimals,
            priceUSD: xrpPrice,
            source,
          },
          amount: qty.toString(),
          amountUSD,
        },
      ],
      source,
    });
  };

  for (const v of state.venues) {
    // What the VENUE is worth to the vault right now — the working principal,
    // named after the PROTOCOL it works in, exactly like a Personal position.
    push(
      `venue:${v.id}`,
      venueProtocolSlug(v.target, v.targetSymbol, v.id),
      'collateral',
      toQty(v.value),
    );
  }
  push('idle', 'legacy-cage', 'free', toQty(state.idlePrincipal));
  push('claimable', 'legacy-cage', 'reward', toQty(state.totalClaimable));
  return positions;
}

/**
 * The vault state for one scanned XRPL account — null for everyone who is not
 * the council, and null (never a throw) when anything cannot be read. Designed
 * to run IN PARALLEL with the rest of the account scan (it needs no price);
 * the caller builds positions afterwards with buildCagePositions.
 */
export async function cageStateFor(
  account: string,
): Promise<import('./LegacyVaultStateService').LegacyVaultState | null> {
  // The resolver answers "no cage" instead of throwing, by contract (its own
  // suite pins that for an unset stack and an unreadable bridge), so this read
  // needs no guard of its own — and a failure inside it can no longer be
  // mistaken here for "this council has nothing".
  const { cageForCouncil } = await import('./LegacyCageResolver');
  const cage = await cageForCouncil(account);
  // Not this account's cage to read — the ordinary answer for every wallet
  // that is not a council. Not an error, so nothing is said.
  if (!cage) return null;
  try {
    const cached = vaultStateCache.get(cage.vault.toLowerCase());
    if (cached && Date.now() - cached.at < VAULT_STATE_TTL_MS) return cached.state;
    const { readVaultState } = await import('./LegacyVaultStateService');
    // The account's OWN cage, never "the configured one".
    const state = await readVaultState(cage.vault);
    vaultStateCache.set(cage.vault.toLowerCase(), { at: Date.now(), state });
    return state;
  } catch (e) {
    // A cage we KNOW exists and could not read is not "no capital": returning
    // null here removes real principal from net worth, the earning ring and My
    // Assets, silently. The scan still survives it (a dashboard must not die
    // because one RPC blinked) — but it stops being invisible.
    warnUnreadableCage(account, cage.vault, (e as Error)?.message ?? String(e));
    return null;
  }
}

/** One line per cage that went unreadable, not one per portfolio scan. */
const warnedUnreadable = new Set<string>();

function warnUnreadableCage(account: string, vault: string, reason: string): void {
  if (warnedUnreadable.has(vault.toLowerCase())) return;
  warnedUnreadable.add(vault.toLowerCase());
  // eslint-disable-next-line no-console
  console.warn(
    `[LegacyCagePositions] cage ${vault} of council ${account} could not be read — its principal is MISSING ` +
      `from this account's portfolio (not zero: unknown). Reason: ${reason}`,
  );
}

/**
 * The cage's positions for one scanned XRPL account — [] for everyone who is
 * not the council, and [] (never a throw) when anything cannot be read.
 */
export async function cagePositionsFor(
  account: string,
  xrpPrice: number,
  traceId: string,
): Promise<CanonicalPosition[]> {
  if (!(xrpPrice > 0)) return [];
  const state = await cageStateFor(account);
  return state ? buildCagePositions(state, account, xrpPrice, traceId) : [];
}

/**
 * Which cage belongs to WHICH Legacy — the question the product never asked.
 *
 * The stack (XrplCouncilBridge + LegacyVault) was resolved from env alone
 * (LEGACY_BRIDGE_ADDRESS / LEGACY_VAULT_ADDRESS), so every Legacy in the
 * install saw the SAME cage: the first one deployed. Reading it was cosmetic
 * damage — one council's capital shown as another's. FUNDING it was not:
 * `/vault-fund/prepare` composed a mint that deposits FXRP into that vault,
 * and the vault has no function that pays principal to an address. A second
 * council would have signed its own XRP into the first council's cage, with no
 * way back, while the UI reported success (founder, 2026-08-05).
 *
 * The contract already states the rule: XrplCouncilBridge stores
 * COUNCIL_ADDRESS_HASH as `immutable`, so one bridge obeys one XRPL council
 * for ever, and the vault obeys one bridge. "One Legacy = one stack" is not a
 * preference — it is the only shape the deployed code admits.
 *
 * This module is the ONE place that answers "the cage of THIS council". It
 * asks, in order:
 *   1. the LegacyStackFactory registry on-chain (`vaultOf(councilHash)`) —
 *      every cage born from XRPL registers itself there, and the chain, not a
 *      database, is what the product trusts;
 *   2. the configured env stack, but ONLY if its bridge names this account —
 *      the founder's Legacy was deployed by hand before the factory existed,
 *      and it keeps its cage without a migration.
 * Anything else is "this Legacy has no cage".
 *
 * Callers must not read `legacyStackConfig()` directly for anything that
 * touches capital: the env stack is nobody's cage until an account claims it.
 */

import { ethers } from 'ethers';
import {
  legacyNetworkConfig,
  legacyStackConfig,
  type LegacyStackConfig,
} from '../../connectors/protocols/xrpl/XrplCouncilOrderService';

const BRIDGE_HASH_ABI = ['function COUNCIL_ADDRESS_HASH() view returns (bytes32)'];
const FACTORY_ABI = [
  'function vaultOf(bytes32) view returns (address)',
  'function bridgeOf(bytes32) view returns (address)',
];

/** XRPL classic address — the same shape the routes validate. */
const R_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** The bridge's council hash is `immutable`: one read per bridge, per process. */
let councilHashCache: { bridge: string; hash: string } | null = null;

/** A council's cage never changes once it exists (the factory refuses a second
 *  one), so a HIT is cacheable for ever. A miss is not: it becomes a hit the
 *  moment that Legacy creates its cage. */
const factoryCageCache = new Map<string, { bridge: string; vault: string }>();

let warnedBadFactory = false;

export function __resetCageResolverCacheForTests(): void {
  councilHashCache = null;
  factoryCageCache.clear();
  warnedBadFactory = false;
}

function warnBadFactoryOnce(value: string): void {
  if (warnedBadFactory) return;
  warnedBadFactory = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[LegacyCageResolver] LEGACY_FACTORY_ADDRESS is not a valid EVM address ("${value}") — the cage registry ` +
      'is NOT being consulted, so every Legacy will report having no cage. Note ethers checks the EIP-55 ' +
      'checksum: a mixed-case address with the wrong capitalisation is rejected. Use the address exactly as ' +
      'the explorer prints it, or all lowercase.',
  );
}

/** The FDC standard address hash of an XRPL account: keccak256 of the r-address
 *  BYTES, no lowercasing (FDC spec) — the same hash the bridge compares. */
export function councilAddressHash(account: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(account)).toLowerCase();
}

/**
 * The cage this council actually owns, or null when this Legacy has none.
 *
 * Never throws: an unset stack, an unreachable RPC or a malformed account all
 * mean the same thing to a caller — there is no cage we can prove belongs to
 * this Legacy, so nothing may be read from or paid into one.
 */
export async function cageForCouncil(account: string): Promise<LegacyStackConfig | null> {
  if (!R_ADDRESS.test(account)) return null;
  return (await cageFromFactory(account)) ?? (await cageFromEnv(account));
}

/**
 * The registry the factory keeps: every cage born from XRPL is written there
 * by the transaction that created it, so the product asks the chain rather
 * than a table it would have to keep in sync.
 */
async function cageFromFactory(account: string): Promise<LegacyStackConfig | null> {
  const factoryAddress = process.env.LEGACY_FACTORY_ADDRESS;
  if (!factoryAddress) return null;
  if (!ethers.isAddress(factoryAddress)) {
    // Silence here would mean every Legacy reporting "no cage" with a perfectly
    // healthy factory deployed — a config typo that looks like a product state.
    warnBadFactoryOnce(factoryAddress);
    return null;
  }
  try {
    const net = legacyNetworkConfig();
    const key = `${factoryAddress.toLowerCase()}:${account}`;
    const hit = factoryCageCache.get(key);
    if (hit) return { ...net, ...hit };

    const provider = new ethers.JsonRpcProvider(net.rpcUrl);
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
    const hash = councilAddressHash(account);
    const [vault, bridge] = await Promise.all([
      factory.vaultOf(hash) as Promise<string>,
      factory.bridgeOf(hash) as Promise<string>,
    ]);
    if (vault === ethers.ZeroAddress || bridge === ethers.ZeroAddress) return null;
    factoryCageCache.set(key, { bridge, vault });
    return { ...net, bridge, vault };
  } catch {
    return null;
  }
}

/**
 * The stack deployed by hand before the factory existed. It is a cage like any
 * other — it just has to PROVE whose it is, by naming the account in the
 * bridge's immutable COUNCIL_ADDRESS_HASH. Every Legacy that is not that one
 * gets null here, which is the whole point.
 */
async function cageFromEnv(account: string): Promise<LegacyStackConfig | null> {
  try {
    const cfg = legacyStackConfig();
    const bridgeKey = cfg.bridge.toLowerCase();
    if (!councilHashCache || councilHashCache.bridge !== bridgeKey) {
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const bridge = new ethers.Contract(cfg.bridge, BRIDGE_HASH_ABI, provider);
      const hash = String(await bridge.COUNCIL_ADDRESS_HASH()).toLowerCase();
      councilHashCache = { bridge: bridgeKey, hash };
    }
    return councilHashCache.hash === councilAddressHash(account) ? cfg : null;
  } catch {
    return null;
  }
}

/** Thrown when a surface that needs a cage is asked about a Legacy without one. */
export class NoCageForLegacy extends Error {
  readonly code = 'NO_CAGE_FOR_LEGACY';
  constructor(readonly account: string) {
    super(
      `This Legacy has no cage of its own on Flare, so there is nothing to read, order or fund. ` +
        `A cage is a contract deployed for ONE council (its address is written into the bridge at birth ` +
        `and can never change), and no cage has been deployed for ${account}. Nothing was composed and ` +
        `no capital has moved.`,
    );
    this.name = 'NoCageForLegacy';
  }
}

/** Same as {@link cageForCouncil}, but refuses instead of returning null. */
export async function requireCageForCouncil(account: string): Promise<LegacyStackConfig> {
  const cage = await cageForCouncil(account);
  if (!cage) throw new NoCageForLegacy(account);
  return cage;
}

/**
 * Express helper: `{ status, body }` for a NoCageForLegacy, or null for any
 * other error (which the route's own catch still owns).
 *
 * 409 rather than 404: the Legacy exists and the request is well-formed — it
 * is the pairing that does not hold.
 */
export function noCageResponse(
  e: unknown,
): { status: number; body: { error: string; detail: string } } | null {
  if (!(e instanceof NoCageForLegacy)) return null;
  return { status: 409, body: { error: 'NO_CAGE_FOR_LEGACY', detail: e.message } };
}

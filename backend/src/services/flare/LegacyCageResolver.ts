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
 * way back, while the UI reported success.
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
let warnedNoFactory = false;

/**
 * The cage registry on Flare MAINNET — LegacyStackFactory, deployed and
 * verified at block 66707923 (contracts/README.md). It is public,
 * immutable chain state, not a secret and not a choice: every cage born from
 * XRPL writes itself into THIS contract.
 *
 * It is a default rather than a required env var because of what its absence
 * did (staging): a council whose cage was born from the factory
 * resolved to "this Legacy has no cage", so the portfolio scan attributed
 * NOTHING to it and 3.69 FXRP of real principal simply stopped appearing on the
 * Home — no error, no zero, just capital missing from the totals. A read path
 * must never depend on remembering a variable to see money that is on-chain.
 * LEGACY_FACTORY_ADDRESS still overrides it (another deployment, another net).
 */
const MAINNET_CAGE_FACTORY = '0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a';

export function __resetCageResolverCacheForTests(): void {
  councilHashCache = null;
  factoryCageCache.clear();
  warnedBadFactory = false;
  warnedNoFactory = false;
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

function warnNoFactoryOnce(chain: string): void {
  if (warnedNoFactory) return;
  warnedNoFactory = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[LegacyCageResolver] no cage registry to consult on "${chain}" (LEGACY_FACTORY_ADDRESS unset and no ` +
      'built-in default for this network) — every Legacy born from the factory will report having no cage, ' +
      'and its principal will be missing from the portfolio.',
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
  // Two registries with the SAME interface (vaultOf/bridgeOf) and the SAME council
  // hash (keccak of the r-address): the Legacy factory AND the Astryum factory
  // (institutional potes). A council belongs to exactly one, so try both.
  const legacy = legacyFactoryAddress();
  const astryum = astryumFactoryAddress();
  // Tercer registro: la factory de JAULAS v2 (`AstryumCageFactory`).
  // Misma interfaz `vaultOf`/`bridgeOf` a propósito: para su bridge, la jaula ES
  // su «vault». Así el relay sirve las órdenes de una jaula sin tocar una línea —
  // resuelve por el remitente, encuentra su bridge, y el bridge ejecuta contra lo
  // que tenga atado. Un consejo pertenece a exactamente un registro.
  const cageV2 = astryumCageFactoryAddress();
  return (
    (legacy ? await cageFromFactory(account, legacy) : null) ??
    (astryum ? await cageFromFactory(account, astryum) : null) ??
    (cageV2 ? await cageFromFactory(account, cageV2) : null) ??
    (await cageFromEnv(account))
  );
}

/**
 * ¿Este consejo gobierna una JAULA de la generación v2?
 *
 * Importa porque `cageForCouncil` devuelve la jaula EN EL SITIO del vault (su
 * `vaultOf` es un alias de `cageOf`, a propósito, para que el relay sirva a las
 * dos generaciones sin tocar una línea). Un llamante que no distinga compondría
 * `directTo(uint256,uint256,bytes32)` contra la jaula — un selector que la jaula
 * NO tiene — y el consejo firmaría una orden condenada: quórum gastado, prueba
 * FDC pagada (~20 FLR), revert. Esa familia de fallos («éxito no ganado») ya
 * costó una sesión entera; la pregunta se contesta ANTES de componer.
 */
export async function isCageV2Council(account: string): Promise<boolean> {
  if (!R_ADDRESS.test(account)) return false;
  const factory = astryumCageFactoryAddress();
  if (!factory) return false;
  return (await cageFromFactory(account, factory)) !== null;
}

/** La factory de jaulas v2 (`ASTRYUM_CAGE_FACTORY_ADDRESS`). Null si no está o es inválida. */
export function astryumCageFactoryAddress(): string | null {
  const addr = process.env.ASTRYUM_CAGE_FACTORY_ADDRESS?.trim();
  if (!addr || !ethers.isAddress(addr)) return null;
  return addr;
}

/** The Legacy cage factory (env override, else the mainnet default). Null if unusable. */
function legacyFactoryAddress(): string | null {
  const chain = process.env.LEGACY_CHAIN || 'flare';
  const configured = process.env.LEGACY_FACTORY_ADDRESS?.trim();
  const factoryAddress = configured || (chain === 'flare' ? MAINNET_CAGE_FACTORY : '');
  if (!factoryAddress) {
    warnNoFactoryOnce(chain);
    return null;
  }
  if (!ethers.isAddress(factoryAddress)) {
    warnBadFactoryOnce(factoryAddress);
    return null;
  }
  return factoryAddress;
}

/** The Astryum institutional factory (potes). Null when unset/invalid. */
function astryumFactoryAddress(): string | null {
  const addr = process.env.ASTRYUM_FACTORY_ADDRESS?.trim();
  if (!addr || !ethers.isAddress(addr)) return null;
  return addr;
}

/**
 * The registry a factory keeps: every cage/pote born from XRPL is written there
 * by the transaction that created it, so the product asks the chain rather than
 * a table it would have to keep in sync. Same shape for Legacy and Astryum.
 */
async function cageFromFactory(account: string, factoryAddress: string): Promise<LegacyStackConfig | null> {
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

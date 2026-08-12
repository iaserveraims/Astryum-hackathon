/**
 * LegacyCageFleetService — the cage fleet, read for the operator.
 *
 * The self-service rail (2026-08-06: factory live on mainnet) made cages
 * something USERS create. From that moment "is the rail healthy?" stopped being
 * answerable by looking at one vault: the operator needs the factory's config
 * proven against the chain, the census of every cage born, the births still in
 * flight, and the refusals users are hitting — in /app/admin, never in a
 * console (founder rule).
 *
 * Everything here is READ-ONLY (invariants #1/#8): env, chain state, and rows
 * the prepare route already wrote. Nothing signs, nothing moves.
 */

import { ethers } from 'ethers';
import { kvGet, kvUpsert } from '../persistence/backgroundJobKv';

const FLEET_ABI = [
  'function SOURCE_ID() view returns (bytes32)',
  'function vaultCount() view returns (uint256)',
  'function allVaults(uint256) view returns (address)',
  'event StackCreated(bytes32 indexed councilAddressHash, string councilAddress, address indexed bridge, address indexed vault, address personalAccount)',
];
const VAULT_MINI_ABI = [
  'function council() view returns (address)',
  'function totalPrincipal() view returns (uint256)',
  'function totalValue() view returns (uint256)',
  'function migrated() view returns (bool)',
];
const BRIDGE_MINI_ABI = [
  'function nextNonce() view returns (uint64)',
  'function COUNCIL_ADDRESS_HASH() view returns (bytes32)',
];

/** kv jobType for the councilHash → r-address map mined from StackCreated logs
 *  (the hash is one-way; only the event carries the string). */
const CENSUS_JOB = 'legacy-cage-census';
/** Where the incremental log scan left off (kv key 'cursor'). */
const CURSOR_KEY = 'cursor';
/** Flare mainnet block the factory was born in (tx 0x65b3cc8e…, 2026-08-06).
 *  Scanning earlier blocks can never find a StackCreated. */
const DEFAULT_DEPLOY_BLOCK = 66_707_923;

// ── A4/B1 — the factory's config, proven against the chain ──────────────────

export interface CageFactoryStatus {
  configured: boolean;
  address: string | null;
  /** EIP-55 valid — false is the silent killer: every Legacy reads "no cage". */
  addressValid: boolean;
  hasCode: boolean | null; // null = chain unreadable right now
  sourceId: string | null; // decoded ("XRP" | "testXRP")
  expectedSourceId: string;
  sourceMatches: boolean | null;
  vaultCount: number | null;
  treasuryConfigured: boolean;
  treasuryValid: boolean;
  /** Birth venues the prepare would use right now ("Kinetic", "Firelight"). */
  birthVenues: string[];
  /** Beta cap on caged capital per cage, in XRP (null = disabled). */
  capXrp: number | null;
}

function rpcUrl(): string {
  const chain = process.env.LEGACY_CHAIN || 'coston2';
  return chain === 'flare'
    ? process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc'
    : process.env.COSTON2_RPC_URL || 'https://coston2-api.flare.network/ext/C/rpc';
}

export function expectedSourceId(): string {
  return (process.env.LEGACY_CHAIN || 'coston2') === 'flare' ? 'XRP' : 'testXRP';
}

export async function readCageFactoryStatus(): Promise<CageFactoryStatus> {
  const address = process.env.LEGACY_FACTORY_ADDRESS ?? null;
  const treasury = process.env.LEGACY_PROTOCOL_TREASURY ?? null;
  const expected = expectedSourceId();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { configuredBirthVenues, cageCapXrp } = require('./LegacyCageCreationService') as {
    configuredBirthVenues: () => Array<{ label: string }>;
    cageCapXrp: () => number | null;
  };
  let venues: string[] = [];
  try {
    venues = configuredBirthVenues().map((v) => v.label);
  } catch {
    venues = [];
  }
  const base: CageFactoryStatus = {
    configured: !!address,
    address,
    addressValid: !!address && ethers.isAddress(address),
    hasCode: null,
    sourceId: null,
    expectedSourceId: expected,
    sourceMatches: null,
    vaultCount: null,
    treasuryConfigured: !!treasury,
    treasuryValid: !!treasury && ethers.isAddress(treasury),
    birthVenues: venues,
    capXrp: cageCapXrp(),
  };
  if (!base.addressValid) return base;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl());
    const factory = new ethers.Contract(address!, FLEET_ABI, provider);
    const [code, srcRaw, countRaw] = await Promise.all([
      provider.getCode(address!),
      factory.SOURCE_ID() as Promise<string>,
      factory.vaultCount() as Promise<bigint>,
    ]);
    base.hasCode = code !== '0x';
    try {
      base.sourceId = ethers.decodeBytes32String(srcRaw);
    } catch {
      base.sourceId = srcRaw; // undecodable — show raw, still comparable
    }
    base.sourceMatches = base.sourceId === expected;
    base.vaultCount = Number(countRaw);
  } catch {
    /* chain unreadable — hasCode stays null and the caller says so */
  }
  return base;
}

// ── A2 — the census: every cage born, whose it is, what it holds ────────────

export interface CageCensusRow {
  vault: string;
  bridge: string;
  /** The council's r-address (from the StackCreated log; null until mined). */
  council: string | null;
  councilHash: string;
  totalPrincipalUBA: string | null;
  totalValueUBA: string | null;
  ordersExecuted: number | null;
  migrated: boolean | null;
}

/** Census snapshots are ~5 reads per cage; the admin panel and the sentinel
 *  both ask. 60s keeps repeat reads free without hiding a birth for long. */
const CENSUS_TTL_MS = 60_000;
let censusCache: { at: number; rows: CageCensusRow[] } | null = null;

export function __resetCageFleetCacheForTests(): void {
  censusCache = null;
}

/** Mined councilHash → r-address entries, persisted so logs are scanned once. */
async function knownCouncils(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { kvList } = await import('../persistence/backgroundJobKv');
    for (const row of await kvList(CENSUS_JOB, 500)) {
      const hash = String(row.councilHash ?? '');
      const council = String(row.council ?? '');
      if (hash && council) map.set(hash.toLowerCase(), council);
    }
  } catch {
    /* no DB — the census still works, councils just show as hashes */
  }
  return map;
}

/**
 * Scan StackCreated logs incrementally (kv cursor) to learn each cage's
 * council r-address — the hash in the contract is one-way, only the event
 * carries the string. Halving fallback: public RPCs cap getLogs ranges at
 * unknown sizes, so a failed query splits until it fits (bounded depth).
 */
async function mineCouncilAddresses(
  provider: ethers.Provider,
  factory: ethers.Contract,
  factoryAddress: string,
): Promise<void> {
  if (!process.env.DATABASE_URL) return; // nowhere to persist — skip quietly
  const latest = await provider.getBlockNumber();
  const deployBlock = Number(process.env.LEGACY_FACTORY_DEPLOY_BLOCK || DEFAULT_DEPLOY_BLOCK);
  const cursorRow = await kvGet(CENSUS_JOB, 'key', CURSOR_KEY).catch(() => null);
  let from = Number((cursorRow as { lastScannedBlock?: number } | null)?.lastScannedBlock ?? deployBlock);
  if (from >= latest) return;

  const iface = new ethers.Interface(FLEET_ABI);
  const topic = iface.getEvent('StackCreated')!.topicHash;
  let budget = 24; // max RPC calls per pass — the cursor carries the rest over

  const scan = async (a: number, b: number, depth: number): Promise<boolean> => {
    if (budget <= 0) return false;
    budget--;
    try {
      const logs = await provider.getLogs({ address: factoryAddress, topics: [topic], fromBlock: a, toBlock: b });
      for (const log of logs) {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed) continue;
        const hash = String(parsed.args[0]).toLowerCase();
        await kvUpsert(CENSUS_JOB, 'councilHash', hash, {
          councilHash: hash,
          council: String(parsed.args[1]),
          bridge: String(parsed.args[2]),
          vault: String(parsed.args[3]),
        });
      }
      return true;
    } catch {
      if (depth >= 8 || b - a < 1024) return false; // range too hostile — next pass retries
      const mid = Math.floor((a + b) / 2);
      const left = await scan(a, mid, depth + 1);
      if (!left) return false; // keep the cursor honest: never skip a hole
      return scan(mid + 1, b, depth + 1);
    }
  };

  const ok = await scan(from, latest, 0);
  const newCursor = ok ? latest : from; // partial progress only moves on success
  if (newCursor > from) {
    await kvUpsert(CENSUS_JOB, 'key', CURSOR_KEY, { key: CURSOR_KEY, lastScannedBlock: newCursor }).catch(() => {});
  }
}

export async function readCageCensus(): Promise<CageCensusRow[]> {
  if (censusCache && Date.now() - censusCache.at < CENSUS_TTL_MS) return censusCache.rows;
  const status = await readCageFactoryStatus();
  if (!status.addressValid || status.vaultCount === null) return censusCache?.rows ?? [];
  const provider = new ethers.JsonRpcProvider(rpcUrl());
  const factory = new ethers.Contract(status.address!, FLEET_ABI, provider);

  // Learn any new council strings first (cheap when the cursor is current).
  await mineCouncilAddresses(provider, factory, status.address!).catch(() => {});
  const councils = await knownCouncils();

  const rows: CageCensusRow[] = await Promise.all(
    Array.from({ length: status.vaultCount }, async (_, i): Promise<CageCensusRow> => {
      const vault = (await factory.allVaults(i)) as string;
      const v = new ethers.Contract(vault, VAULT_MINI_ABI, provider);
      const bridge = await (v.council() as Promise<string>).catch(() => '');
      const b = bridge ? new ethers.Contract(bridge, BRIDGE_MINI_ABI, provider) : null;
      const [principal, value, migrated, nonce, hash] = await Promise.all([
        (v.totalPrincipal() as Promise<bigint>).then(String).catch(() => null),
        (v.totalValue() as Promise<bigint>).then(String).catch(() => null),
        (v.migrated() as Promise<boolean>).catch(() => null),
        b ? (b.nextNonce() as Promise<bigint>).then(Number).catch(() => null) : Promise.resolve(null),
        b ? (b.COUNCIL_ADDRESS_HASH() as Promise<string>).catch(() => '') : Promise.resolve(''),
      ]);
      return {
        vault,
        bridge,
        council: councils.get(hash.toLowerCase()) ?? null,
        councilHash: hash,
        totalPrincipalUBA: principal,
        totalValueUBA: value,
        ordersExecuted: nonce,
        migrated,
      };
    }),
  );
  censusCache = { at: Date.now(), rows };
  return rows;
}

// ── A3 — births in flight, with what the executor actually paid ─────────────

export interface CageBirthRow {
  userOpHash: string;
  personalAccount: string;
  council: string; // xrplAddress of the handoff
  grossXrpDrops: string;
  /** What the executor CHARGED for this dispatch (committed in the memo). */
  executorFeeXrp: number | null;
  status: string; // queued | executed | superseded | …
  createdAt: string;
  ageMinutes: number;
  /** The dispatch tx on Flare (executed rows only). */
  flareTxHash: string | null;
  /** What the dispatch ACTUALLY cost in gas, read from the receipt. The FDC
   *  attestation (~20 FLR) is a separate executor tx and is NOT in here. */
  gasFLR: number | null;
  gasUsed: number | null;
}

/** Receipts are immutable — one read per dispatch tx, ever. */
const receiptCache = new Map<string, { gasFLR: number; gasUsed: number }>();

async function readDispatchGas(txHash: string): Promise<{ gasFLR: number; gasUsed: number } | null> {
  const hit = receiptCache.get(txHash);
  if (hit) return hit;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl());
    const rc = await provider.getTransactionReceipt(txHash);
    if (!rc) return null;
    const out = {
      gasFLR: Number(ethers.formatEther(rc.gasUsed * (rc.gasPrice ?? 0n))),
      gasUsed: Number(rc.gasUsed),
    };
    receiptCache.set(txHash, out);
    return out;
  } catch {
    return null;
  }
}

/** The last cage-birth handoffs, newest first. 'queued' can mean either "the
 *  quorum has not signed yet" (inert) or "signed and the executor has not swept
 *  it" — the row cannot tell them apart; the UI copy says so. */
export async function listCageBirths(limit = 20): Promise<CageBirthRow[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { prisma } = await import('../../database/prismaClient');
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType: '0xfe-handoff', payload: { path: ['action'], equals: 'legacy-cage-create' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const now = Date.now();
    return Promise.all(
      rows.map(async (r) => {
        const p = r.payload as {
          userOpHash?: string;
          personalAccount?: string;
          xrplAddress?: string;
          grossXrpDrops?: string;
          executorFeeUBA?: string;
        };
        const result = (r.result ?? null) as { flareTxHash?: string } | null;
        const flareTxHash = result?.flareTxHash ?? null;
        const gas = flareTxHash ? await readDispatchGas(flareTxHash) : null;
        return {
          userOpHash: String(p.userOpHash ?? ''),
          personalAccount: String(p.personalAccount ?? ''),
          council: String(p.xrplAddress ?? ''),
          grossXrpDrops: String(p.grossXrpDrops ?? '0'),
          executorFeeXrp: p.executorFeeUBA != null ? Number(p.executorFeeUBA) / 1e6 : null,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          ageMinutes: Math.round((now - r.createdAt.getTime()) / 60_000),
          flareTxHash,
          gasFLR: gas?.gasFLR ?? null,
          gasUsed: gas?.gasUsed ?? null,
        };
      }),
    );
  } catch {
    return [];
  }
}

// ── La economía del nacimiento — qué cobra el executor y qué le cuesta HOY ──

/**
 * The price sheet of ONE birth dispatch, read live. The split matters:
 *   · what the executor CHARGES (executorFeeUBA) is a FAssets AssetManager
 *     parameter — Flare's protocol sets it, we read it and commit it in the
 *     memo. It is NOT ours to tune.
 *   · what the executor PAYS is the FDC attestation (~20 FLR, its own tx) plus
 *     the dispatch gas — and a birth burns ~5M gas (factory.create + approve +
 *     deposit) where a plain mint burns ~1M, so gas price moves the margin.
 * A variable service fee of OUR own (gas + FDC + target margin via FTSO) is
 * the "cobro a coste" design already noted in the revenue model — future work;
 * this gauge is its instrumentation.
 */
export interface CageBirthEconomics {
  /** What the executor charges per dispatch right now (AssetManager, XRP). */
  chargedXrpNow: number | null;
  /** Current gas price (gwei) and the birth-gas estimate it implies. */
  gasPriceGwei: number | null;
  estBirthGas: number;
  estBirthGasFLR: number | null;
  /** The FDC attestation estimate the fuel budget uses (env-anchored). */
  fdcFeeFLR: number;
  /** estBirthGasFLR + fdcFeeFLR — the executor's estimated all-in cost. */
  estTotalCostFLR: number | null;
}

/** ~what a birth dispatch burns: create (~4.15M) + approve+deposit + mint
 *  machinery. Refined by real receipts as births happen (the rows above). */
const EST_BIRTH_GAS = 5_000_000;

export async function readBirthEconomics(): Promise<CageBirthEconomics> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { estimatedMintFeeWei } = require('./ExecutorFuelService') as {
    estimatedMintFeeWei: () => bigint;
  };
  const fdcFeeFLR = Number(ethers.formatEther(estimatedMintFeeWei()));
  const out: CageBirthEconomics = {
    chargedXrpNow: null,
    gasPriceGwei: null,
    estBirthGas: EST_BIRTH_GAS,
    estBirthGasFLR: null,
    fdcFeeFLR,
    estTotalCostFLR: null,
  };
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl());
    const { readDirectMintParams } = await import('../../connectors/protocols/flare/FlareDirectMintService');
    const [params, block] = await Promise.all([
      readDirectMintParams(provider).catch(() => null),
      provider.getBlock('latest').catch(() => null),
    ]);
    if (params) out.chargedXrpNow = Number(params.executorFeeUBA) / 1e6;
    const baseFee = block?.baseFeePerGas ?? null;
    if (baseFee !== null) {
      out.gasPriceGwei = Number(ethers.formatUnits(baseFee, 'gwei'));
      out.estBirthGasFLR = Number(ethers.formatEther(baseFee * BigInt(EST_BIRTH_GAS)));
      out.estTotalCostFLR = out.estBirthGasFLR + fdcFeeFLR;
    }
  } catch {
    /* unreadable chain — the panel shows the estimate anchors it has */
  }
  return out;
}

// ── A5 — refusal counter (in-memory, resets with the process — says so) ─────

const refusals = new Map<string, number>();
let refusalsSince = new Date().toISOString();
let lastRefusal: { code: string; at: string } | null = null;

export function recordCageCreateRefusal(code: string): void {
  refusals.set(code, (refusals.get(code) ?? 0) + 1);
  lastRefusal = { code, at: new Date().toISOString() };
}

export interface CageRefusalStats {
  since: string;
  total: number;
  byCode: Record<string, number>;
  last: { code: string; at: string } | null;
}

export function cageCreateRefusalStats(): CageRefusalStats {
  let total = 0;
  const byCode: Record<string, number> = {};
  for (const [code, n] of refusals) {
    byCode[code] = n;
    total += n;
  }
  return { since: refusalsSince, total, byCode, last: lastRefusal };
}

export function __resetCageRefusalsForTests(): void {
  refusals.clear();
  lastRefusal = null;
  refusalsSince = new Date().toISOString();
}

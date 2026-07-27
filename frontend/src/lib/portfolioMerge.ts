/**
 * Shared portfolio source — ONE wallet list, ONE balance pipeline.
 *
 * Every dashboard surface (Summary, Portfolio tabs, Capital Map, Positions,
 * Activity) must read the same source: the account's connected wallets from
 * GET /api/wallets/mine, fanned out through GET /api/portfolio per address and
 * merged client-side. The legacy watchlist pipeline (/api/capital/map) is not a
 * dashboard read path anymore — it produced the $0-vs-real contradiction.
 */

import {
  portfolioV1,
  risk as riskApi,
  type PortfolioSnapshot,
  type RiskSnapshot,
} from '@/services/v1Api';
import { listMyWallets } from '@/services/walletLinkService';

export interface WalletRecord {
  id?: string;
  address: string;
  label?: string;
  chainId?: number;
  ecosystem?: string;
  isActive?: boolean;
  isPrimary?: boolean;
  /** false ⇒ excluded from the dashboard's monetary totals (user toggle). */
  includeInPortfolio?: boolean;
  /** Personal colour tag (hex) — wallet identity across Summary/Portfolio. */
  color?: string | null;
  /** Personal glyph tag (slug, e.g. 'comet') — wallet identity, same idea as
   *  colour; null falls back to the provider's brand mark. */
  icon?: string | null;
  /** Provider hint ('metamask' | 'xaman' | …) for the brand icon. */
  walletType?: string;
}

export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** The signed-in account's own wallets (auth-scoped /api/wallets/mine). */
export async function fetchMyWallets(): Promise<WalletRecord[]> {
  try {
    const list = await listMyWallets();
    return list.map((w) => ({
      id: w.id,
      address: w.address,
      label: w.nickname ?? undefined,
      chainId: w.chainId ?? undefined,
      ecosystem: w.ecosystem,
      isActive: w.isConnected,
      isPrimary: w.isPrimary,
      includeInPortfolio: w.includeInPortfolio,
      color: w.color ?? null,
      icon: w.icon ?? null,
      walletType: w.walletType,
    }));
  } catch {
    return [];
  }
}

/**
 * Fold the SIWE login address into the /mine list so a wallet-login user never
 * sees an empty dashboard. Dedup is case-insensitive for EVM only (Solana/XRPL
 * addresses are case-sensitive and kept verbatim).
 *
 * The /mine rows take precedence: they carry the user's saved nickname, and the
 * old order (login-wallet first) shadowed that row with a hardcoded "Login
 * wallet" label — which read as "my wallet names get erased". The synthetic
 * login entry is only appended when the address isn't registered at all.
 */
export function dedupeWallets(userAddress: string | undefined, wallets: WalletRecord[]): WalletRecord[] {
  const map = new Map<string, WalletRecord>();
  const keyFor = (addr: string) => (EVM_ADDRESS_RE.test(addr) ? addr.toLowerCase() : addr);
  for (const w of wallets) {
    if (!w.address) continue;
    const key = keyFor(w.address);
    const existing = map.get(key);
    // Old builds could register the same address under a different `network`,
    // leaving duplicate rows. Keep the row that carries the user's nickname —
    // collapsing to the unnamed one made every surface show the raw address
    // even though the rename was saved.
    if (!existing || (!existing.label && w.label)) map.set(key, w);
  }
  if (userAddress && !map.has(keyFor(userAddress))) {
    map.set(keyFor(userAddress), { address: userAddress, label: 'Login wallet', chainId: 14 });
  }
  return [...map.values()];
}

/** The demo reads exactly two rails: Flare (14) and XRPL (pseudo 1440002). */
export const DEMO_CHAIN_IDS = new Set([14, 1440002]);

function groupPositions(
  positions: PortfolioSnapshot['positions'],
  key: 'asset' | 'protocolId' | 'kind',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const k = String((p as Record<string, unknown>)[key] ?? '—');
    out[k] = (out[k] ?? 0) + (p.amountUSD ?? 0);
  }
  return out;
}

export function normaliseSnap(raw: PortfolioSnapshot): PortfolioSnapshot {
  const all = Array.isArray(raw.positions) ? raw.positions : [];
  // Demo rails only — the external multichain reader also reports dust on
  // other chains (BNB, AVAX…) for EVM wallets; this surface is Flare + XRPL.
  const positions = all.filter((p) => DEMO_CHAIN_IDS.has(p.chainId ?? 14));
  if (positions.length === all.length) {
    return {
      ...raw,
      totalUSD: raw.totalUSD ?? 0,
      collateralUSD: raw.collateralUSD ?? 0,
      debtUSD: raw.debtUSD ?? 0,
      netWorthUSD: raw.netWorthUSD ?? 0,
      positions,
      breakdown: {
        byProtocol: raw.breakdown?.byProtocol ?? {},
        byAsset: raw.breakdown?.byAsset ?? {},
        byKind: (raw.breakdown?.byKind ?? {}) as Record<string, number>,
      },
    };
  }
  // Something was filtered out — recompute every aggregate from the kept
  // positions so totals and breakdowns can never disagree with the rows.
  const sumKinds = (kinds: string[]) =>
    positions
      .filter((p) => kinds.includes((p.kind ?? '').toLowerCase()))
      .reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  const totalUSD = positions.reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  const debtUSD = sumKinds(['debt', 'borrow']);
  return {
    ...raw,
    positions,
    totalUSD,
    collateralUSD: sumKinds(['collateral', 'supply']),
    debtUSD,
    netWorthUSD: totalUSD - debtUSD,
    breakdown: {
      byProtocol: groupPositions(positions, 'protocolId'),
      byAsset: groupPositions(positions, 'asset'),
      byKind: groupPositions(positions, 'kind'),
    },
  };
}

function addMaps(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + (v ?? 0);
}

/**
 * Merge per-wallet snapshots into one aggregated view ("All wallets").
 * Sums USD totals, concatenates positions and unions every breakdown map so
 * the dashboard reflects the whole account at once, not a single address.
 */
export function mergeSnaps(snaps: PortfolioSnapshot[]): PortfolioSnapshot | null {
  if (snaps.length === 0) return null;
  if (snaps.length === 1) return snaps[0];
  const acc: PortfolioSnapshot = {
    wallet: 'all',
    chainId: 14,
    totalUSD: 0,
    collateralUSD: 0,
    debtUSD: 0,
    netWorthUSD: 0,
    positions: [],
    breakdown: { byProtocol: {}, byAsset: {}, byKind: {} },
    takenAt: new Date(0).toISOString(),
  };
  for (const s of snaps) {
    acc.totalUSD += s.totalUSD;
    acc.collateralUSD += s.collateralUSD;
    acc.debtUSD += s.debtUSD;
    acc.netWorthUSD += s.netWorthUSD;
    // Tag each position with its owning wallet — the merged snapshot's own
    // `wallet` is 'all', so rows would otherwise lose their provenance.
    acc.positions.push(
      ...s.positions.map((p) => (p?.wallet ? p : { ...p, wallet: s.wallet })),
    );
    addMaps(acc.breakdown.byProtocol, s.breakdown.byProtocol);
    addMaps(acc.breakdown.byAsset, s.breakdown.byAsset);
    addMaps(acc.breakdown.byKind, s.breakdown.byKind as Record<string, number>);
    if (new Date(s.takenAt).getTime() > new Date(acc.takenAt).getTime()) acc.takenAt = s.takenAt;
  }
  return acc;
}

/**
 * Merge per-wallet history series into one. Each wallet's value is reduced to
 * the last point per bucket (calendar day normally, hour when the whole span
 * is under 48h so a young account still draws a curve), then summed across
 * wallets per bucket.
 *
 * Two rules keep the merged curve honest AND always drawable:
 *  1. Before a wallet's first snapshot it counts at its FIRST OBSERVED value
 *     (backfill). Counting it at 0 charted a fake hockey-stick "gain" the day
 *     it was added; the previous fix (cutting the window to the youngest
 *     wallet's start) made the whole chart VANISH every time a wallet joined.
 *     Backfilling assumes the capital already existed before we tracked it —
 *     no fake gain, no vanishing window.
 *  2. A wallet without a snapshot in a bucket carries its LAST KNOWN value
 *     forward, so different snapshot cadences don't sawtooth the total.
 */
export function mergeHistories(
  series: { takenAt: string; totalUSD: number }[][],
): { takenAt: string; totalUSD: number }[] {
  const present = series.filter((s) => s.length > 0);
  if (present.length === 0) return [];
  if (present.length === 1) return present[0];

  // Bucket by hour while the union spans < 48h — day buckets would collapse a
  // young account's whole history into a single, unchartable point.
  const stamps = present.flatMap((s) => s.map((p) => new Date(p.takenAt).getTime()));
  const hourly = Math.max(...stamps) - Math.min(...stamps) < 48 * 3_600_000;
  const bucketOf = (iso: string) => iso.slice(0, hourly ? 13 : 10);
  const bucketIso = (b: string) => (hourly ? `${b}:00:00.000Z` : `${b}T00:00:00.000Z`);

  // Per wallet: last value per bucket.
  const perWalletBuckets = present.map((points) => {
    const m = new Map<string, number>();
    for (const p of [...points].sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
      m.set(bucketOf(p.takenAt), p.totalUSD);
    }
    return m;
  });

  const allBuckets = [...new Set(perWalletBuckets.flatMap((m) => [...m.keys()]))].sort();

  // Carry-forward seeded with each wallet's FIRST value (the backfill of rule 1).
  const last = perWalletBuckets.map((m) => m.get([...m.keys()].sort()[0]!)!);

  const out: { takenAt: string; totalUSD: number }[] = [];
  for (const bucket of allBuckets) {
    perWalletBuckets.forEach((m, i) => {
      if (m.has(bucket)) last[i] = m.get(bucket)!;
    });
    out.push({ takenAt: bucketIso(bucket), totalUSD: last.reduce((s, v) => s + v, 0) });
  }
  // The final point keeps its REAL timestamp (not the bucket's floor) so the
  // curve reaches "now" and short windows (today / 24h) still catch it.
  if (out.length > 0) {
    out[out.length - 1] = {
      ...out[out.length - 1],
      takenAt: new Date(Math.max(...stamps)).toISOString(),
    };
  }
  return out;
}

/** Across wallets, surface the most-at-risk position (lowest health factor). */
export function mergeRisks(risks: RiskSnapshot[]): RiskSnapshot | null {
  if (risks.length === 0) return null;
  const withHF = risks.filter((r) => r.healthFactor != null);
  if (withHF.length === 0) return risks[0];
  return withHF.reduce((worst, r) =>
    (r.healthFactor as number) < (worst.healthFactor as number) ? r : worst,
  );
}

/** One wallet's live snapshot + history + risk, all failures soft. */
export async function loadWalletData(address: string, chainId = 14) {
  // The risk engine is EVM-only (its route validates ^0x…): an XRPL r-address
  // would just 400 — skip the guaranteed-failing request instead of paying it.
  const isEvm = /^0x[a-fA-F0-9]{40}$/.test(address);
  return Promise.all([
    portfolioV1.get(address, chainId).catch(() => null as PortfolioSnapshot | null),
    portfolioV1
      .history(address, chainId)
      .catch(() => null as { points: { takenAt: string; totalUSD: number }[] } | null),
    isEvm
      ? riskApi.portfolio(address, chainId).catch(() => null as RiskSnapshot | null)
      : Promise.resolve(null as RiskSnapshot | null),
  ] as const);
}

export interface AggregatedPortfolio {
  snap: PortfolioSnapshot | null;
  history: { takenAt: string; totalUSD: number }[];
  risk: RiskSnapshot | null;
  perWallet: {
    address: string;
    snap: PortfolioSnapshot;
    risk: RiskSnapshot | null;
    history: { takenAt: string; totalUSD: number }[];
  }[];
}

// ── Client-side stale-while-revalidate cache ──────────────────────────────────
// Every surface (Overview, Portfolio, Strategies, Capital Map…) calls
// loadAggregatedPortfolio on mount, and React state dies on navigation — so
// each page change re-paid the full multichain scan and the user stared at
// "Loading…" again. The last result is kept here (module scope survives
// navigation): returning visitors get painted INSTANTLY from cache, and the
// data is silently revalidated in the background when older than FRESH_MS.
const PORTFOLIO_FRESH_MS = 60_000;
let portfolioCache: { key: string; data: AggregatedPortfolio; fetchedAt: number } | null = null;
const portfolioInflight = new Map<string, Promise<AggregatedPortfolio>>();

// The reactive store registers here so invalidation (after an action that
// changes positions) both drops the module cache AND forces a store reload —
// done via a handler to avoid a store→portfolioMerge→store import cycle.
let onInvalidate: (() => void) | null = null;
export function setPortfolioInvalidateHandler(fn: () => void): void {
  onInvalidate = fn;
}

/** Drop the cached portfolio (call after an action that changes positions). */
export function invalidatePortfolioCache(): void {
  portfolioCache = null;
  onInvalidate?.();
}

/**
 * Fan out over a wallet set and merge — the canonical "whole account" read.
 * Per-wallet snapshots are also returned so surfaces can show the breakdown
 * by wallet (net worth per address) without a second fetch.
 *
 * Progressive: when `onPartial` is given it fires after EACH wallet resolves
 * with the merged-so-far view, so one slow chain scan (a first EVM read can
 * take tens of seconds) never blanks the wallets that already answered.
 *
 * Cached: if this wallet set was loaded before, `onPartial` fires immediately
 * with the previous result (instant paint) and a fresh load only runs when the
 * cache is older than PORTFOLIO_FRESH_MS or still in flight elsewhere.
 */
export async function loadAggregatedPortfolio(
  addresses: string[],
  onPartial?: (partial: AggregatedPortfolio) => void,
): Promise<AggregatedPortfolio> {
  const cacheKey = [...addresses]
    .map((a) => (EVM_ADDRESS_RE.test(a) ? a.toLowerCase() : a))
    .sort()
    .join(',');

  const cached = portfolioCache && portfolioCache.key === cacheKey ? portfolioCache : null;
  if (cached) {
    onPartial?.(cached.data);
    if (Date.now() - cached.fetchedAt < PORTFOLIO_FRESH_MS) return cached.data;
  }

  // One in-flight load per wallet set: five surfaces mounting at once must
  // not fan out five identical request storms.
  const pending = portfolioInflight.get(cacheKey);
  if (pending) return pending;

  const load = fetchAggregatedPortfolio(addresses, onPartial)
    .then((result) => {
      portfolioCache = { key: cacheKey, data: result, fetchedAt: Date.now() };
      return result;
    })
    .finally(() => portfolioInflight.delete(cacheKey));
  portfolioInflight.set(cacheKey, load);
  return load;
}

async function fetchAggregatedPortfolio(
  addresses: string[],
  onPartial?: (partial: AggregatedPortfolio) => void,
): Promise<AggregatedPortfolio> {
  const results: (Awaited<ReturnType<typeof loadWalletData>> | null)[] =
    addresses.map(() => null);

  const build = (): AggregatedPortfolio => {
    // Live "now" point per wallet: with it, ONE stored snapshot is enough to
    // draw a curve (snapshot → live total) instead of waiting days for a
    // second row — this is what kept young (e.g. XRPL) wallets chartless.
    // Uses the NORMALISED total so the curve ends exactly at the net-worth
    // figure the pages display.
    const nowIso = new Date().toISOString();
    const enriched = results.map((r, i) => {
      if (!r) return null;
      const snap = r[0] ? normaliseSnap(r[0]) : null;
      const stored = Array.isArray(r[1]?.points) ? r[1]!.points : [];
      const history =
        snap && Number.isFinite(snap.totalUSD)
          ? [...stored, { takenAt: nowIso, totalUSD: snap.totalUSD }]
          : stored;
      return { address: addresses[i], snap, risk: r[2], history };
    });
    const perWallet = enriched.filter(
      (w): w is AggregatedPortfolio['perWallet'][number] => w?.snap != null,
    );
    const histories = enriched.map((w) => w?.history ?? []);
    const risks = enriched.map((w) => w?.risk).filter((r): r is RiskSnapshot => r != null);
    return {
      snap: mergeSnaps(perWallet.map((w) => w.snap)),
      history: mergeHistories(histories),
      risk: mergeRisks(risks),
      perWallet,
    };
  };

  await Promise.all(
    addresses.map(async (a, i) => {
      results[i] = await loadWalletData(a);
      onPartial?.(build());
    }),
  );
  return build();
}

// ─── Capital view — the Capital Map groupings, derived from the ONE source ────

export interface CapitalView {
  walletCount: number;
  totalPositions: number;
  totalUSD: number;
  byChain: { chainId: number; positionCount: number; valueUSD: number }[];
  byAsset: { symbol: string; valueUSD: number; chains: number[]; protocols: string[] }[];
  byProtocol: { protocol: string; chainId: number; positionCount: number; valueUSD: number }[];
  byKind: { kind: string; positionCount: number; valueUSD: number }[];
  topPositions: {
    id: string;
    protocol: string;
    wallet: string;
    asset: string;
    kind: string;
    valueUSD: number;
    chainId: number;
  }[];
  takenAt: string;
}

/** Group the live snapshot's positions into the Capital Map's four lenses. */
export function buildCapitalView(snap: PortfolioSnapshot, walletCount: number): CapitalView {
  const positions = snap.positions ?? [];
  const chains = new Map<number, { positionCount: number; valueUSD: number }>();
  const assets = new Map<string, { valueUSD: number; chains: Set<number>; protocols: Set<string> }>();
  const protocols = new Map<string, { protocol: string; chainId: number; positionCount: number; valueUSD: number }>();
  const kinds = new Map<string, { positionCount: number; valueUSD: number }>();

  for (const p of positions) {
    const usd = Math.abs(p.amountUSD ?? 0);
    const chainId = p.chainId ?? 14;
    const symbol = String(p.asset ?? '—');
    const protocol = String(p.protocolId ?? 'unknown');
    const kind = String(p.kind ?? 'other').toLowerCase();

    const c = chains.get(chainId) ?? { positionCount: 0, valueUSD: 0 };
    c.positionCount += 1;
    c.valueUSD += usd;
    chains.set(chainId, c);

    const a = assets.get(symbol) ?? { valueUSD: 0, chains: new Set<number>(), protocols: new Set<string>() };
    a.valueUSD += usd;
    a.chains.add(chainId);
    if (!protocol.startsWith('wallet')) a.protocols.add(protocol);
    assets.set(symbol, a);

    const pk = `${protocol}:${chainId}`;
    const pr = protocols.get(pk) ?? { protocol, chainId, positionCount: 0, valueUSD: 0 };
    pr.positionCount += 1;
    pr.valueUSD += usd;
    protocols.set(pk, pr);

    const k = kinds.get(kind) ?? { positionCount: 0, valueUSD: 0 };
    k.positionCount += 1;
    k.valueUSD += usd;
    kinds.set(kind, k);
  }

  const topPositions = [...positions]
    .filter((p) => (p.amountUSD ?? 0) > 0)
    .sort((a, b) => (b.amountUSD ?? 0) - (a.amountUSD ?? 0))
    .slice(0, 8)
    .map((p, i) => ({
      id: `${p.protocolId}-${p.asset}-${i}`,
      protocol: String(p.protocolId ?? 'unknown'),
      wallet: String(p.wallet ?? snap.wallet ?? ''),
      asset: String(p.asset ?? '—'),
      kind: String(p.kind ?? 'other'),
      valueUSD: p.amountUSD ?? 0,
      chainId: p.chainId ?? 14,
    }));

  return {
    walletCount,
    totalPositions: positions.length,
    totalUSD: snap.totalUSD ?? 0,
    byChain: [...chains.entries()]
      .map(([chainId, v]) => ({ chainId, ...v }))
      .sort((a, b) => b.valueUSD - a.valueUSD),
    byAsset: [...assets.entries()]
      .map(([symbol, v]) => ({
        symbol,
        valueUSD: v.valueUSD,
        chains: [...v.chains],
        protocols: [...v.protocols],
      }))
      .sort((a, b) => b.valueUSD - a.valueUSD),
    byProtocol: [...protocols.values()].sort((a, b) => b.valueUSD - a.valueUSD),
    byKind: [...kinds.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => b.valueUSD - a.valueUSD),
    topPositions,
    takenAt: snap.takenAt,
  };
}

/**
 * Per-asset detail for the allocation legend: USD plus the real quantity when
 * the snapshot carries a price (qty = USD / price). No price → no quantity;
 * we never invent one.
 */
export function buildAssetDetail(
  snap: PortfolioSnapshot,
): Record<string, { usd: number; qty?: number }> {
  const out: Record<string, { usd: number; qty?: number }> = {};
  for (const p of snap.positions ?? []) {
    const symbol = String(p.asset ?? '—');
    const usd = p.amountUSD ?? 0;
    const entry = (out[symbol] ??= { usd: 0 });
    entry.usd += usd;
    const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
    if (price > 0) entry.qty = (entry.qty ?? 0) + usd / price;
  }
  return out;
}

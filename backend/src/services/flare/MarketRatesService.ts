/**
 * MarketRatesService — live supply APY of Kinetic markets, for the APY trigger.
 *
 * The governed MoneyFlow the fundador chose as THE Legacy test is "si el APY
 * cae de X, saca y pon en otro sitio": the trigger half needs a real evaluator
 * over real venue rates (invariant #9 — APYs are always protocol data with a
 * source, never an estimate). Kinetic is a Benqi-style fork: rates are per
 * SECOND via `supplyRatePerTimestamp()` (`supplyRatePerBlock()` does not exist
 * and reverts — verified on-chain 2026-07-14, same note as strategyAssistant).
 *
 * Read-only, no keys, no writes. A market that fails to answer is OMITTED from
 * the result — the evaluator treats missing data as "cannot fire" (fail-quiet,
 * never a false trigger on bad data).
 */

import { ethers } from 'ethers';
import { getProtocolAddresses } from '../../config/protocolAddresses';

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const CACHE_TTL_MS = 60_000; // one engine tick — rates move slowly
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

let cache: { at: number; rates: Record<string, number> } = { at: 0, rates: {} };

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: 14 },
    { staticNetwork: true },
  );
}

/** The curated markets the governed APY rule can watch (labels for the UI). */
export function knownApyMarkets(): Array<{ address: string; label: string }> {
  const k = getProtocolAddresses().kinetic;
  const out: Array<{ address: string; label: string }> = [];
  if (k.isoKFxrp) out.push({ address: k.isoKFxrp, label: 'FXRP · Kinetic ISO (supply APY)' });
  if (k.isoKUsdt0) out.push({ address: k.isoKUsdt0, label: 'USDT0 · Kinetic ISO (supply APY)' });
  return out;
}

/**
 * Annualised supply APR (%) for each market, keyed by LOWERCASED address.
 * Markets that fail the read are omitted. Cached ~1 tick.
 */
export async function readSupplyAprs(markets: string[]): Promise<Record<string, number>> {
  const wanted = [...new Set(markets.map((m) => m.toLowerCase()).filter((m) => ADDRESS_RE.test(m)))];
  if (wanted.length === 0) return {};
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS && wanted.every((m) => m in cache.rates)) {
    return Object.fromEntries(wanted.map((m) => [m, cache.rates[m]]).filter(([, v]) => v !== undefined));
  }
  const p = provider();
  const rates: Record<string, number> = {};
  await Promise.all(
    wanted.map(async (addr) => {
      try {
        const c = new ethers.Contract(addr, ['function supplyRatePerTimestamp() view returns (uint256)'], p);
        const r: bigint = await c.supplyRatePerTimestamp();
        const pct = (Number(r) / 1e18) * SECONDS_PER_YEAR * 100;
        if (Number.isFinite(pct) && pct >= 0) rates[addr] = pct;
      } catch {
        /* omitted — the evaluator will report "rate unavailable" */
      }
    }),
  );
  cache = { at: now, rates: { ...cache.rates, ...rates } };
  return rates;
}

let borrowCache: { at: number; rates: Record<string, number> } = { at: 0, rates: {} };

/**
 * Annualised BORROW APR (%) for each market — the rate a borrower PAYS — keyed
 * by LOWERCASED address. Same per-second convention as the supply side: Kinetic
 * (Benqi-style) exposes `borrowRatePerTimestamp()` (per-second rate). Markets
 * that fail the read are omitted (fail-quiet, invariant #9). Cached ~1 tick.
 */
export async function readBorrowAprs(markets: string[]): Promise<Record<string, number>> {
  const wanted = [...new Set(markets.map((m) => m.toLowerCase()).filter((m) => ADDRESS_RE.test(m)))];
  if (wanted.length === 0) return {};
  const now = Date.now();
  if (now - borrowCache.at < CACHE_TTL_MS && wanted.every((m) => m in borrowCache.rates)) {
    return Object.fromEntries(wanted.map((m) => [m, borrowCache.rates[m]]).filter(([, v]) => v !== undefined));
  }
  const p = provider();
  const rates: Record<string, number> = {};
  await Promise.all(
    wanted.map(async (addr) => {
      try {
        const c = new ethers.Contract(addr, ['function borrowRatePerTimestamp() view returns (uint256)'], p);
        const r: bigint = await c.borrowRatePerTimestamp();
        const pct = (Number(r) / 1e18) * SECONDS_PER_YEAR * 100;
        if (Number.isFinite(pct) && pct >= 0) rates[addr] = pct;
      } catch {
        /* omitted — the caller reports "rate unavailable" */
      }
    }),
  );
  borrowCache = { at: now, rates: { ...borrowCache.rates, ...rates } };
  return rates;
}

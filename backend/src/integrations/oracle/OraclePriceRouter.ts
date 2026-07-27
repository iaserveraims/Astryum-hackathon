import { randomUUID } from 'crypto';
import { FTSOClient } from '../../flare/ftso/FTSOClient';
import { isValidFTSOSymbol } from '../../flare/ftso/constants';
import { redstoneProvider, type RedstoneRawPrice } from '../providers/oracle/RedstoneProvider';

export type OracleSource = 'ftso' | 'redstone';

export interface ResolvedPrice {
  asset: string;
  usdPrice: number;
  source: OracleSource;
  trustLevel: 'oracle_verified';
  fetchedAt: string;
  isStale: boolean;
}

const FTSO_STALE_AFTER_S = 90;
const REDSTONE_STALE_AFTER_MS = 60_000;

let ftsoShared: FTSOClient | null = null;
function getFtso(): FTSOClient {
  if (!ftsoShared) {
    ftsoShared = new FTSOClient({
      network: 'flare',
      rpcUrl: process.env.FLARE_RPC_HTTP || 'https://flare-api.flare.network/ext/C/rpc',
      cacheTTL: 30,
      maxPriceAge: 180,
    });
  }
  return ftsoShared;
}

/**
 * OraclePriceRouter
 *
 * Central routing decision for price lookups:
 *   - Asset covered by FTSO (34 symbols) → FTSOClient (on-chain verified, 90s freshness)
 *   - Everything else → Redstone HTTP API (off-chain, 60s freshness)
 *
 * The chainId of the trigger does NOT determine the oracle — price is universal.
 * Operates independently of ProviderRouter for simplicity and testability.
 */
export class OraclePriceRouter {
  selectSource(asset: string): OracleSource {
    return isValidFTSOSymbol(asset) ? 'ftso' : 'redstone';
  }

  async getPrice(asset: string): Promise<ResolvedPrice> {
    const source = this.selectSource(asset);
    const fetchedAt = new Date().toISOString();

    if (source === 'ftso') {
      const p = await getFtso().getCurrentPrice(asset);
      return {
        asset,
        usdPrice: parseFloat(p.priceUSD ?? '0'),
        source: 'ftso',
        trustLevel: 'oracle_verified',
        fetchedAt,
        isStale: p.age > FTSO_STALE_AFTER_S,
      };
    }

    const result = await redstoneProvider.call<
      { symbol: string },
      { symbol: string; usdPrice: number; timestamp: number }
    >('oracle.getPrice', { symbol: asset }, { traceId: randomUUID() });

    return {
      asset,
      usdPrice: result.data.usdPrice,
      source: 'redstone',
      trustLevel: 'oracle_verified',
      fetchedAt,
      isStale: result.source.stale ?? false,
    };
  }

  async getPrices(assets: string[]): Promise<Record<string, ResolvedPrice>> {
    if (assets.length === 0) return {};

    const ftsoAssets = assets.filter(isValidFTSOSymbol);
    const redstoneAssets = assets.filter((a) => !isValidFTSOSymbol(a));

    const [ftsoResults, redstoneResults] = await Promise.all([
      ftsoAssets.length
        ? getFtso()
            .getCurrentPrices(ftsoAssets)
            .then((prices) =>
              Object.fromEntries(
                prices.map((p) => [
                  p.symbol,
                  {
                    asset: p.symbol,
                    usdPrice: parseFloat(p.priceUSD ?? '0'),
                    source: 'ftso' as OracleSource,
                    trustLevel: 'oracle_verified' as const,
                    fetchedAt: new Date().toISOString(),
                    isStale: p.age > FTSO_STALE_AFTER_S,
                  } satisfies ResolvedPrice,
                ]),
              ),
            )
            .catch(() => ({} as Record<string, ResolvedPrice>))
        : Promise.resolve({} as Record<string, ResolvedPrice>),

      redstoneAssets.length
        ? redstoneProvider
            .call<{ symbols: string[] }, Record<string, RedstoneRawPrice>>(
              'oracle.getPrices',
              { symbols: redstoneAssets },
              { traceId: randomUUID() },
            )
            .then(({ data, source: src }) => {
              const now = Date.now();
              return Object.fromEntries(
                Object.entries(data).map(([sym, p]) => [
                  sym,
                  {
                    asset: sym,
                    usdPrice: p.value,
                    source: 'redstone' as OracleSource,
                    trustLevel: 'oracle_verified' as const,
                    fetchedAt: src.fetchedAt,
                    isStale: now - p.timestamp > REDSTONE_STALE_AFTER_MS,
                  } satisfies ResolvedPrice,
                ]),
              );
            })
            .catch(() => ({} as Record<string, ResolvedPrice>))
        : Promise.resolve({} as Record<string, ResolvedPrice>),
    ]);

    return { ...ftsoResults, ...redstoneResults };
  }
}

export const oraclePriceRouter = new OraclePriceRouter();

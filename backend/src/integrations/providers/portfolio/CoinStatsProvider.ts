/**
 * CoinStatsProvider
 *
 * Read-only multichain portfolio balances from the CoinStats Open API
 * (openapiv1.coinstats.app — 120+ chains, EVM + Solana + Bitcoin in one schema).
 *
 * D2 (2026-06-15): the single broad portfolio API that REPLACES the now-disconnected
 * Zerion (see [[project_arquitectura_c_pivot]]). Non-EVM DeFi positions
 * (XRPL/Stellar/Flare) come from our own on-chain readers, not from here.
 * All balances are external indexer data → trustLevel 'indexer_verified',
 * intended confidence 'probable'.
 *
 * Key-gated (active only when COINSTATS_API_KEY is set), like every provider here.
 *
 * ⚠ VERIFY-WITH-KEY: endpoint shape from the docs
 * (https://coinstats.app/api-docs/openapi/get-wallet-balance/) — `connectionId`
 * iteration, the X-API-KEY header, and the response field mapping must be
 * confirmed against real responses once the key is configured. Marked TODO below.
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';

const COINSTATS_BASE_URL = process.env.COINSTATS_API_URL || 'https://openapiv1.coinstats.app';
const COINSTATS_API_KEY = process.env.COINSTATS_API_KEY ?? '';

// chainId → CoinStats `connectionId` (blockchain slug from /wallet/blockchains).
// EVM chains + (later) Solana/Bitcoin. Non-EVM DeFi (XRPL/Stellar/Flare) is served
// by our own on-chain readers, not CoinStats.
// TODO(verify-with-key): confirm slugs against GET /wallet/blockchains.
const COINSTATS_CONNECTIONS: ReadonlyArray<{ chainId: number; connectionId: string }> = [
  { chainId: 1, connectionId: 'ethereum' },
  { chainId: 56, connectionId: 'binance-smart-chain' },
  { chainId: 137, connectionId: 'polygon' },
  { chainId: 42161, connectionId: 'arbitrum' },
  { chainId: 10, connectionId: 'optimism' },
  { chainId: 8453, connectionId: 'base' },
  { chainId: 43114, connectionId: 'avalanche' },
];

interface CoinStatsBalanceItem {
  coinId?: string;
  amount?: number;
  name?: string;
  symbol?: string;
  price?: number;
  decimals?: number;
  chain?: string;
  contractAddress?: string;
}

const CAPS: ReadonlyArray<Capability> = [
  'portfolio.getPositions',
  'portfolio.getChains',
  'portfolio.getTokenBalances',
];

class CoinStatsProvider implements IProvider {
  readonly id = 'coinstats';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 76; // primary multichain portfolio source (Zerion was 75, now disconnected)

  private headers(): Record<string, string> {
    return { 'X-API-KEY': COINSTATS_API_KEY, Accept: 'application/json' };
  }

  async health(): Promise<ProviderHealth> {
    if (!COINSTATS_API_KEY) {
      return { status: 'disabled', lastCheckAt: new Date().toISOString(), reason: 'COINSTATS_API_KEY not set' };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${COINSTATS_BASE_URL}/wallet/blockchains`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.ok ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - start, lastCheckAt: new Date().toISOString(), reason: (err as Error).message };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (!COINSTATS_API_KEY) throw new Error('CoinStatsProvider: COINSTATS_API_KEY not set');

    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'portfolio.getPositions':
      case 'portfolio.getTokenBalances': {
        const wallet = inp.walletAddress as string;
        if (!wallet) throw new Error('walletAddress required');
        const positions = await this._fetchBalances(wallet, ctx.traceId);
        return { data: positions as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getChains': {
        const wallet = inp.walletAddress as string;
        const positions = wallet ? await this._fetchBalances(wallet, ctx.traceId) : [];
        const chainIds = [...new Set(positions.map((p) => p.chainId))];
        return { data: chainIds as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`CoinStatsProvider: unsupported capability '${capability}'`);
    }
  }

  private async _fetchBalances(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    // One call per chain connection; tolerate per-chain failures (allSettled).
    const results = await Promise.allSettled(
      COINSTATS_CONNECTIONS.map(({ chainId, connectionId }) =>
        this._fetchConnection(wallet, chainId, connectionId, traceId),
      ),
    );
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  private async _fetchConnection(
    wallet: string,
    chainId: number,
    connectionId: string,
    traceId: string,
  ): Promise<CanonicalPosition[]> {
    const url = `${COINSTATS_BASE_URL}/wallet/balance?address=${encodeURIComponent(wallet)}&connectionId=${connectionId}`;
    const resp = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`CoinStats API error: HTTP ${resp.status} (${connectionId})`);
    // TODO(verify-with-key): real responses may be a bare array or wrapped ({ result: [...] }).
    const json = (await resp.json()) as CoinStatsBalanceItem[] | { result?: CoinStatsBalanceItem[] };
    const items = Array.isArray(json) ? json : (json.result ?? []);
    return items
      .filter((it) => (it.amount ?? 0) > 0 && !!it.symbol)
      .map((it) => this._toCanonical(it, wallet, chainId, traceId));
  }

  private _toCanonical(
    it: CoinStatsBalanceItem,
    wallet: string,
    chainId: number,
    traceId: string,
  ): CanonicalPosition {
    const amount = it.amount ?? 0;
    const priceUSD = it.price ?? 0;
    const assetSource = {
      providerId: 'coinstats',
      providerType: 'data' as const,
      trustLevel: 'indexer_verified' as const,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    return {
      id: `coinstats:${chainId}:${it.contractAddress ?? it.symbol}`,
      wallet,
      chainId,
      protocol: 'wallet',
      kind: 'free',
      assets: [
        {
          asset: {
            symbol: it.symbol ?? 'UNKNOWN',
            address: it.contractAddress ?? '',
            chainId,
            decimals: it.decimals ?? 18,
            priceUSD,
            source: assetSource,
          },
          amount: amount.toString(),
          amountUSD: amount * priceUSD,
        },
      ],
      source: {
        providerId: 'coinstats',
        providerType: 'data' as const,
        trustLevel: 'indexer_verified' as const,
        fetchedAt: new Date().toISOString(),
        traceId,
      },
    };
  }
}

export const coinStatsProvider = new CoinStatsProvider();

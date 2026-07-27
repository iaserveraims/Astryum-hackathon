/**
 * KryptosConnectProvider (V2)
 *
 * Enterprise portfolio aggregator. Normalizes positions from CEX exchanges
 * (Binance, Coinbase, Kraken, etc.), self-custody wallets, and DeFi protocols
 * into CanonicalPosition[]. Alternative/complement to Zerion for users with
 * significant off-chain holdings.
 *
 * Requires: KRYPTOS_API_KEY (from kryptos.io dashboard)
 * Optional: KRYPTOS_API_URL (default: https://api.kryptos.io)
 *
 * Capabilities:
 *   portfolio.getPositions        — all positions (wallet + DeFi + exchange combined)
 *   portfolio.getExchangeBalances — CEX balances only
 *   portfolio.getChains           — active chains found for a wallet address
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { CanonicalPosition, PositionKind } from '../../../canonical/types/Position';

const BASE_URL = process.env.KRYPTOS_API_URL ?? 'https://api.kryptos.io';
const API_KEY = process.env.KRYPTOS_API_KEY ?? '';

interface KryptosAsset {
  id: string;
  symbol: string;
  name: string;
  address?: string;
  chainId?: number;
  decimals?: number;
  priceUsd?: number;
  amount: number;
  valueUsd?: number;
}

type KryptosPositionType =
  | 'wallet'
  | 'exchange'
  | 'defi_supply'
  | 'defi_borrow'
  | 'defi_lp'
  | 'staking';

interface KryptosPosition {
  id: string;
  walletAddress?: string;
  exchangeId?: string;
  chainId?: number;
  protocol?: string;
  type: KryptosPositionType;
  assets: KryptosAsset[];
}

const KIND_MAP: Record<KryptosPositionType, PositionKind> = {
  wallet: 'free',
  exchange: 'free',
  defi_supply: 'collateral',
  defi_borrow: 'debt',
  defi_lp: 'lp',
  staking: 'staking',
};

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'portfolio.getPositions',
  'portfolio.getExchangeBalances',
  'portfolio.getChains',
]);

class KryptosConnectProvider implements IProvider {
  readonly id = 'kryptos';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 62;

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!API_KEY) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'KRYPTOS_API_KEY not set',
      };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/v1/health`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (!API_KEY) throw new Error('KryptosConnectProvider: KRYPTOS_API_KEY not set');

    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'portfolio.getPositions': {
        const wallet = inp.walletAddress as string | undefined;
        const params = new URLSearchParams();
        if (wallet) params.set('wallet', wallet);
        const resp = await fetch(`${BASE_URL}/v1/positions?${params}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) throw new Error(`KryptosConnect API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { positions?: KryptosPosition[] };
        const canonical = (body.positions ?? []).flatMap((p) =>
          this._toCanonical(p, ctx.traceId),
        );
        return { data: canonical as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getExchangeBalances': {
        const resp = await fetch(`${BASE_URL}/v1/exchange-balances`, {
          headers: this.headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) throw new Error(`KryptosConnect API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { positions?: KryptosPosition[] };
        const canonical = (body.positions ?? [])
          .filter((p) => p.type === 'exchange')
          .flatMap((p) => this._toCanonical(p, ctx.traceId));
        return { data: canonical as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getChains': {
        const wallet = inp.walletAddress as string;
        if (!wallet) throw new Error('KryptosConnectProvider: walletAddress required');
        const params = new URLSearchParams({ wallet });
        const resp = await fetch(`${BASE_URL}/v1/chains?${params}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`KryptosConnect API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { chainIds?: number[] };
        return { data: (body.chainIds ?? []) as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`KryptosConnectProvider: unsupported capability '${capability}'`);
    }
  }

  private _toCanonical(position: KryptosPosition, traceId: string): CanonicalPosition[] {
    const chainId = position.chainId ?? 0;
    const baseSource = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    } as const;

    return [
      {
        id: `kryptos:${position.id}`,
        wallet: position.walletAddress ?? position.exchangeId ?? 'unknown',
        chainId,
        protocol: position.protocol ?? position.exchangeId ?? 'wallet',
        kind: KIND_MAP[position.type] ?? 'free',
        assets: position.assets.map((a) => ({
          asset: {
            symbol: a.symbol,
            address: a.address ?? '',
            chainId,
            decimals: a.decimals ?? 18,
            priceUSD: a.priceUsd ?? null,
            source: baseSource,
          },
          amount: a.amount.toString(),
          amountUSD: a.valueUsd ?? a.amount * (a.priceUsd ?? 0),
        })),
        source: baseSource,
      },
    ];
  }
}

export const kryptosConnectProvider = new KryptosConnectProvider();

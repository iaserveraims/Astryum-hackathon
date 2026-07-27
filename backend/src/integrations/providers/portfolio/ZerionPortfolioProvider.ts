/**
 * ZerionPortfolioProvider
 *
 * Read-only portfolio data from Zerion API v1 (38+ chains).
 * Maps positions to CanonicalPosition[] with confidenceLevel='probable'.
 *
 * All positions from Zerion are external indexer data — not on-chain verified.
 * On-chain positions (Flare, chainId=14) are always sourced from FlareRpcProvider.
 * Zerion fills the gap for external chains (ETH, Base, Polygon, Arbitrum, etc.).
 */
import type { IProvider, ProviderHealth, ProviderCallContext, ProviderCallResult, Capability } from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';

const ZERION_BASE_URL = 'https://api.zerion.io/v1';
const ZERION_API_KEY = process.env.ZERION_API_KEY ?? '';

// Map Zerion chain slugs → chainId numbers
const ZERION_CHAIN_MAP: Record<string, number> = {
  ethereum: 1,
  'binance-smart-chain': 56,
  polygon: 137,
  arbitrum: 42161,
  'optimism': 10,
  'base': 8453,
  avalanche: 43114,
  'gnosis': 100,
  'fantom': 250,
  'celo': 42220,
};

interface ZerionPosition {
  id: string;
  type: string;
  attributes: {
    parent?: string;
    protocol?: string;
    name?: string;
    position_type?: string;
    quantity?: { int?: string; decimals?: number; float?: number; numeric?: string };
    value?: number | null;
    price?: number | null;
    changes?: unknown;
    fungible_info?: {
      name?: string;
      symbol?: string;
      implementations?: Array<{ chain_id?: string; address?: string }>;
    };
    flags?: { displayable?: boolean };
  };
  relationships?: {
    chain?: { data?: { id?: string } };
    fungible?: { data?: { id?: string } };
  };
}

interface ZerionPositionsResponse {
  data?: ZerionPosition[];
  links?: { next?: string };
}

const CAPS: ReadonlyArray<Capability> = [
  'portfolio.getPositions',
  'portfolio.getChains',
  'portfolio.getTokenBalances',
];

class ZerionPortfolioProvider implements IProvider {
  readonly id = 'zerion';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 75;

  private authHeader(): string {
    const encoded = Buffer.from(`${ZERION_API_KEY}:`).toString('base64');
    return `Basic ${encoded}`;
  }

  async health(): Promise<ProviderHealth> {
    if (!ZERION_API_KEY) {
      return { status: 'disabled', lastCheckAt: new Date().toISOString(), reason: 'ZERION_API_KEY not set' };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${ZERION_BASE_URL}/fungibles/?filter[search_query]=ETH&page[size]=1`, {
        headers: { Authorization: this.authHeader(), Accept: 'application/json' },
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
    if (!ZERION_API_KEY) throw new Error('ZerionPortfolioProvider: ZERION_API_KEY not set');

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
        const wallet = inp.walletAddress as string;
        if (!wallet) throw new Error('walletAddress required');
        const positions = await this._fetchPositions(wallet, ctx.traceId);
        return { data: positions as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getTokenBalances': {
        const wallet = inp.walletAddress as string;
        if (!wallet) throw new Error('walletAddress required');
        const positions = await this._fetchPositions(wallet, ctx.traceId);
        const balances = positions.filter((p) => p.kind === 'free');
        return { data: balances as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getChains': {
        const wallet = inp.walletAddress as string;
        const positions = wallet ? await this._fetchPositions(wallet, ctx.traceId) : [];
        const chainIds = [...new Set(positions.map((p) => p.chainId))];
        return { data: chainIds as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`ZerionPortfolioProvider: unsupported capability '${capability}'`);
    }
  }

  private async _fetchPositions(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    const url = `${ZERION_BASE_URL}/wallets/${wallet}/positions/?filter[position_types]=wallet,deposit,loan,staked,locked&currency=usd&page[size]=100`;
    const resp = await fetch(url, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Zerion API error: HTTP ${resp.status}`);
    const json = (await resp.json()) as ZerionPositionsResponse;
    return (json.data ?? []).flatMap((pos) => this._toCanonical(pos, wallet, traceId));
  }

  private _toCanonical(pos: ZerionPosition, wallet: string, traceId: string): CanonicalPosition[] {
    const chainSlug = pos.relationships?.chain?.data?.id ?? '';
    const chainId = ZERION_CHAIN_MAP[chainSlug];
    if (!chainId) return []; // skip unknown chains

    const attr = pos.attributes;
    const symbol = attr.fungible_info?.symbol ?? attr.name ?? 'UNKNOWN';
    const valueUSD = attr.value ?? 0;
    const quantity = attr.quantity?.float ?? 0;
    const priceUSD = attr.price ?? 0;

    const posType = attr.position_type ?? 'wallet';
    const kind =
      posType === 'deposit' ? 'collateral' as const :
      posType === 'loan' ? 'debt' as const :
      posType === 'staked' || posType === 'locked' ? 'staking' as const :
      'free' as const;

    const assetSource = {
      providerId: 'zerion',
      providerType: 'data' as const,
      trustLevel: 'indexer_verified' as const,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    return [{
      id: `zerion:${pos.id}`,
      wallet,
      chainId,
      protocol: attr.protocol ?? 'wallet',
      kind,
      assets: [{
        asset: {
          symbol,
          address: pos.attributes.fungible_info?.implementations?.[0]?.address ?? '',
          chainId,
          decimals: 18,
          priceUSD,
          source: assetSource,
        },
        amount: quantity.toString(),
        amountUSD: valueUSD,
      }],
      source: {
        providerId: 'zerion',
        providerType: 'data' as const,
        trustLevel: 'indexer_verified' as const,
        fetchedAt: new Date().toISOString(),
        traceId,
      },
    }];
  }
}

export const zerionPortfolioProvider = new ZerionPortfolioProvider();

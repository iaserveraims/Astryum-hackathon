/**
 * DeBankPortfolioProvider
 *
 * Read-only portfolio data from DeBank Pro OpenAPI.
 * Maps positions to CanonicalPosition[] with confidenceLevel='detected'.
 *
 * Lower priority than Zerion (65 vs 75). Used as fallback or for chains
 * Zerion does not cover. All data is external indexer data ('detected').
 */
import type { IProvider, ProviderHealth, ProviderCallContext, ProviderCallResult, Capability } from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';

const DEBANK_BASE_URL = 'https://pro-openapi.debank.com/v1';
const DEBANK_API_KEY = process.env.DEBANK_API_KEY ?? '';

interface DeBankTokenBalance {
  id: string;
  chain: string;
  name: string;
  symbol: string;
  decimals: number;
  price: number;
  amount: number;
  raw_amount: number;
  raw_amount_hex_str: string;
  logo_url?: string;
  is_verified?: boolean;
  is_core?: boolean;
  is_wallet?: boolean;
  usd_value?: number;
  protocol_id?: string;
}

interface DeBankProtocolItem {
  id: string;
  chain: string;
  name?: string;
  detail?: {
    supply_token_list?: Array<{
      id?: string; symbol?: string; amount?: number; price?: number;
    }>;
    borrow_token_list?: Array<{
      id?: string; symbol?: string; amount?: number; price?: number;
    }>;
    reward_token_list?: Array<{
      id?: string; symbol?: string; amount?: number; price?: number;
    }>;
    staked_token_list?: Array<{
      id?: string; symbol?: string; amount?: number; price?: number;
    }>;
  };
}

// DeBank uses chain id strings → numeric mapping
const DEBANK_CHAIN_MAP: Record<string, number> = {
  eth: 1,
  bsc: 56,
  matic: 137,
  arb: 42161,
  op: 10,
  base: 8453,
  avax: 43114,
  xdai: 100,
  ftm: 250,
  celo: 42220,
};

const CAPS: ReadonlyArray<Capability> = [
  'portfolio.getPositions',
  'portfolio.getChains',
  'portfolio.getTokenBalances',
];

class DeBankPortfolioProvider implements IProvider {
  readonly id = 'debank';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 65;

  async health(): Promise<ProviderHealth> {
    if (!DEBANK_API_KEY) {
      return { status: 'disabled', lastCheckAt: new Date().toISOString(), reason: 'DEBANK_API_KEY not set' };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${DEBANK_BASE_URL}/user/chain_balance?id=0x0000000000000000000000000000000000000000&chain_id=eth`, {
        headers: { AccessKey: DEBANK_API_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
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
    if (!DEBANK_API_KEY) throw new Error('DeBankPortfolioProvider: DEBANK_API_KEY not set');

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
        const positions = await this._fetchAllPositions(wallet, ctx.traceId);
        return { data: positions as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getTokenBalances': {
        const wallet = inp.walletAddress as string;
        if (!wallet) throw new Error('walletAddress required');
        const tokens = await this._fetchTokenBalances(wallet, ctx.traceId);
        return { data: tokens as unknown as TOut, source, cached: false };
      }

      case 'portfolio.getChains': {
        const wallet = inp.walletAddress as string;
        const positions = wallet ? await this._fetchAllPositions(wallet, ctx.traceId) : [];
        const chainIds = [...new Set(positions.map((p) => p.chainId))];
        return { data: chainIds as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`DeBankPortfolioProvider: unsupported capability '${capability}'`);
    }
  }

  private async _fetchTokenBalances(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    const url = `${DEBANK_BASE_URL}/user/all_token_list?id=${wallet}&is_all=false`;
    const resp = await fetch(url, {
      headers: { AccessKey: DEBANK_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`DeBank API error: HTTP ${resp.status}`);
    const tokens = (await resp.json()) as DeBankTokenBalance[];
    return tokens.flatMap((t) => this._tokenToCanonical(t, wallet, traceId));
  }

  private async _fetchProtocolPositions(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    const url = `${DEBANK_BASE_URL}/user/all_complex_protocol_list?id=${wallet}`;
    const resp = await fetch(url, {
      headers: { AccessKey: DEBANK_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const protocols = (await resp.json()) as DeBankProtocolItem[];
    return protocols.flatMap((p) => this._protocolToCanonical(p, wallet, traceId));
  }

  private async _fetchAllPositions(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    const [tokens, protocol] = await Promise.allSettled([
      this._fetchTokenBalances(wallet, traceId),
      this._fetchProtocolPositions(wallet, traceId),
    ]);
    return [
      ...(tokens.status === 'fulfilled' ? tokens.value : []),
      ...(protocol.status === 'fulfilled' ? protocol.value : []),
    ];
  }

  private _tokenToCanonical(token: DeBankTokenBalance, wallet: string, traceId: string): CanonicalPosition[] {
    const chainId = DEBANK_CHAIN_MAP[token.chain];
    if (!chainId) return [];
    const assetSource = {
      providerId: 'debank', providerType: 'data' as const,
      trustLevel: 'indexer_verified' as const,
      fetchedAt: new Date().toISOString(), traceId,
    };
    return [{
      id: `debank:token:${token.chain}:${token.id}`,
      wallet, chainId,
      protocol: token.protocol_id ?? 'wallet',
      kind: 'free',
      assets: [{
        asset: { symbol: token.symbol, address: token.id, chainId, decimals: token.decimals, priceUSD: token.price, source: assetSource },
        amount: token.amount.toString(),
        amountUSD: token.usd_value ?? token.amount * token.price,
      }],
      source: assetSource,
    }];
  }

  private _protocolToCanonical(item: DeBankProtocolItem, wallet: string, traceId: string): CanonicalPosition[] {
    const chainId = DEBANK_CHAIN_MAP[item.chain];
    if (!chainId) return [];
    const result: CanonicalPosition[] = [];
    const baseSource = {
      providerId: 'debank', providerType: 'data' as const,
      trustLevel: 'indexer_verified' as const,
      fetchedAt: new Date().toISOString(), traceId,
    };
    const detail = item.detail ?? {};
    const mapAssets = (tokens: Array<{ id?: string; symbol?: string; amount?: number; price?: number }>) =>
      tokens.map((t) => ({
        asset: {
          symbol: t.symbol ?? '', address: t.id ?? '', chainId,
          decimals: 18, priceUSD: t.price ?? 0, source: baseSource,
        },
        amount: (t.amount ?? 0).toString(),
        amountUSD: (t.amount ?? 0) * (t.price ?? 0),
      }));

    if (detail.supply_token_list?.length) {
      result.push({ id: `debank:supply:${item.id}`, wallet, chainId, protocol: item.id, kind: 'collateral', assets: mapAssets(detail.supply_token_list), source: baseSource });
    }
    if (detail.borrow_token_list?.length) {
      result.push({ id: `debank:borrow:${item.id}`, wallet, chainId, protocol: item.id, kind: 'debt', assets: mapAssets(detail.borrow_token_list), source: baseSource });
    }
    if (detail.staked_token_list?.length) {
      result.push({ id: `debank:staked:${item.id}`, wallet, chainId, protocol: item.id, kind: 'staking', assets: mapAssets(detail.staked_token_list), source: baseSource });
    }
    return result;
  }
}

export const deBankPortfolioProvider = new DeBankPortfolioProvider();

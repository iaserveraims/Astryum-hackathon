/**
 * StellarBalanceProvider
 *
 * Reads native XLM + issued-asset balances for a Stellar account via Horizon and
 * returns them as CanonicalPosition[]. XLM priced via DeFiLlama (coingecko:stellar);
 * USD-pegged issued assets (USDC) valued ~$1.
 *
 * Read-only. Astryum never signs or broadcasts (CLAUDE.md §0).
 */

import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';

export const STELLAR_PSEUDO_CHAIN_ID = 1500001;

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';
const STABLE_CODES = new Set(['USDC', 'USDT', 'USD']);

interface HorizonBalance {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

async function fetchPrice(key: string): Promise<number> {
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${key}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { coins?: Record<string, { price?: number }> };
    return data.coins?.[key]?.price ?? 0;
  } catch {
    return 0;
  }
}

const CAPS: ReadonlyArray<Capability> = ['portfolio.getPositions', 'portfolio.getTokenBalances'];

class StellarBalanceProvider implements IProvider {
  readonly id = 'stellar-balance';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'onchain_verified' as const;
  readonly priority = 88;

  async health(): Promise<ProviderHealth> {
    return { status: 'healthy', lastCheckAt: new Date().toISOString() };
  }

  async call<TIn, TOut>(
    _capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const wallet = (input as Record<string, unknown>).walletAddress as string;
    if (!wallet) throw new Error('walletAddress required');
    const positions = await this._fetch(wallet, ctx.traceId);
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;
    return { data: positions as unknown as TOut, source, cached: false };
  }

  private async _fetch(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    let balances: HorizonBalance[] = [];
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${wallet}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { balances?: HorizonBalance[] };
        balances = data.balances ?? [];
      }
    } catch {
      return [];
    }

    const xlmPrice = await fetchPrice('coingecko:stellar');
    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    const positions: CanonicalPosition[] = [];
    for (const b of balances) {
      const amount = Number(b.balance);
      if (!isFinite(amount) || amount <= 0) continue;
      const isNative = b.asset_type === 'native';
      const symbol = isNative ? 'XLM' : (b.asset_code ?? 'ASSET');
      const priceUSD = isNative ? xlmPrice : (STABLE_CODES.has(symbol.toUpperCase()) ? 1 : 0);
      const amountUSD = amount * priceUSD;
      if (amountUSD < 1) continue;
      positions.push({
        id: isNative ? `stellar:native:${wallet}` : `stellar:${b.asset_code}:${b.asset_issuer}:${wallet}`,
        wallet,
        chainId: STELLAR_PSEUDO_CHAIN_ID,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: {
            symbol,
            address: isNative ? 'native' : (b.asset_issuer ?? ''),
            chainId: STELLAR_PSEUDO_CHAIN_ID,
            decimals: 7,
            priceUSD,
            source: assetSource,
          },
          amount: amount.toString(),
          amountUSD,
        }],
        source: assetSource,
      });
    }
    return positions;
  }
}

export const stellarBalanceProvider = new StellarBalanceProvider();

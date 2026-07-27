/**
 * AlgorandBalanceProvider
 *
 * Reads native ALGO for an Algorand account via the public Algonode REST API and
 * returns it as CanonicalPosition[]. ALGO priced via DeFiLlama (coingecko:algorand).
 * ASA (issued asset) valuation is left for a later pass.
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

export const ALGORAND_PSEUDO_CHAIN_ID = 1500002;

const ALGOD_URL = process.env.ALGORAND_API_URL ?? 'https://mainnet-api.algonode.cloud';

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

class AlgorandBalanceProvider implements IProvider {
  readonly id = 'algorand-balance';
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
    let microAlgos = 0;
    try {
      const res = await fetch(`${ALGOD_URL}/v2/accounts/${wallet}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { amount?: number };
        microAlgos = data.amount ?? 0;
      }
    } catch {
      return [];
    }

    const algoAmount = microAlgos / 1e6;
    if (algoAmount <= 0) return [];

    const price = await fetchPrice('coingecko:algorand');
    const amountUSD = algoAmount * price;
    if (amountUSD < 1) return [];

    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    return [{
      id: `algorand:native:${wallet}`,
      wallet,
      chainId: ALGORAND_PSEUDO_CHAIN_ID,
      protocol: 'wallet',
      kind: 'free',
      assets: [{
        asset: { symbol: 'ALGO', address: 'native', chainId: ALGORAND_PSEUDO_CHAIN_ID, decimals: 6, priceUSD: price, source: assetSource },
        amount: algoAmount.toString(),
        amountUSD,
      }],
      source: assetSource,
    }];
  }
}

export const algorandBalanceProvider = new AlgorandBalanceProvider();

/**
 * BitcoinBalanceProvider
 *
 * Reads the native BTC balance for a Bitcoin address via the public Blockstream
 * (Esplora) REST API and returns it as CanonicalPosition[]. BTC priced via
 * DeFiLlama (coingecko:bitcoin).
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

export const BITCOIN_PSEUDO_CHAIN_ID = 1500000;

const ESPLORA_URL = process.env.BITCOIN_API_URL ?? 'https://blockstream.info/api';

interface EsploraAddress {
  chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
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

class BitcoinBalanceProvider implements IProvider {
  readonly id = 'bitcoin-balance';
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
    let sats = 0;
    try {
      const res = await fetch(`${ESPLORA_URL}/address/${wallet}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as EsploraAddress;
        const funded = data.chain_stats?.funded_txo_sum ?? 0;
        const spent = data.chain_stats?.spent_txo_sum ?? 0;
        sats = funded - spent;
      }
    } catch {
      return [];
    }

    const btcAmount = sats / 1e8;
    if (btcAmount <= 0) return [];

    const price = await fetchPrice('coingecko:bitcoin');
    const amountUSD = btcAmount * price;
    if (amountUSD < 1) return [];

    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    return [{
      id: `bitcoin:native:${wallet}`,
      wallet,
      chainId: BITCOIN_PSEUDO_CHAIN_ID,
      protocol: 'wallet',
      kind: 'free',
      assets: [{
        asset: { symbol: 'BTC', address: 'native', chainId: BITCOIN_PSEUDO_CHAIN_ID, decimals: 8, priceUSD: price, source: assetSource },
        amount: btcAmount.toString(),
        amountUSD,
      }],
      source: assetSource,
    }];
  }
}

export const bitcoinBalanceProvider = new BitcoinBalanceProvider();

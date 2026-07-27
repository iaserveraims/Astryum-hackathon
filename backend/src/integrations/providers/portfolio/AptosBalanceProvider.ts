/**
 * AptosBalanceProvider
 *
 * Reads native APT (and CoinStore balances) for an Aptos account via the public
 * fullnode REST API and returns them as CanonicalPosition[] so they flow through
 * the same SnapshotBuilder pipeline as EVM/Solana balances. APT priced via
 * DeFiLlama (coingecko:aptos).
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

export const APTOS_PSEUDO_CHAIN_ID = 1500003;

const APTOS_FULLNODE =
  process.env.APTOS_FULLNODE_URL ?? 'https://fullnode.mainnet.aptoslabs.com/v1';

interface AptosResource {
  type: string;
  data: Record<string, unknown>;
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

class AptosBalanceProvider implements IProvider {
  readonly id = 'aptos-balance';
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
    let resources: AptosResource[] = [];
    try {
      const res = await fetch(`${APTOS_FULLNODE}/accounts/${wallet}/resources`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) resources = (await res.json()) as AptosResource[];
    } catch {
      return [];
    }

    // Native APT lives in CoinStore<0x1::aptos_coin::AptosCoin>; value is in octas (1e8).
    const aptStore = resources.find((r) =>
      r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>',
    );
    const octas = aptStore ? Number((aptStore.data as { coin?: { value?: string } }).coin?.value ?? 0) : 0;
    const aptAmount = octas / 1e8;
    if (aptAmount <= 0) return [];

    const price = await fetchPrice('coingecko:aptos');
    const amountUSD = aptAmount * price;
    if (amountUSD < 1) return [];

    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    return [{
      id: `aptos:native:${wallet}`,
      wallet,
      chainId: APTOS_PSEUDO_CHAIN_ID,
      protocol: 'wallet',
      kind: 'free',
      assets: [{
        asset: { symbol: 'APT', address: 'native', chainId: APTOS_PSEUDO_CHAIN_ID, decimals: 8, priceUSD: price, source: assetSource },
        amount: aptAmount.toString(),
        amountUSD,
      }],
      source: assetSource,
    }];
  }
}

export const aptosBalanceProvider = new AptosBalanceProvider();

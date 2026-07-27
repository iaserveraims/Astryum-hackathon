/**
 * SolanaBalanceProvider
 *
 * Reads native SOL + SPL token balances for a Solana wallet and returns them as
 * CanonicalPosition[] so they flow through the same SnapshotBuilder pipeline as
 * EVM balances. Prices via DeFiLlama Coins API (free, no key).
 *
 * RPC: uses Helius when HELIUS_API_KEY is set (higher rate limits), otherwise
 * falls back to the public Solana mainnet RPC so the feature works key-less.
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

/** Pseudo chainId for Solana (CLAUDE.md ChainRegistry convention). */
export const SOLANA_PSEUDO_CHAIN_ID = 900;

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const LAMPORTS_PER_SOL = 1_000_000_000;

function solanaRpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(solanaRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Solana RPC error: ${body.error.message}`);
  return body.result as T;
}

interface LlamaPriceResponse {
  coins: Record<string, { price: number; decimals?: number; symbol?: string }>;
}

async function fetchPrices(keys: string[]): Promise<Record<string, { price: number; symbol?: string }>> {
  if (keys.length === 0) return {};
  const out: Record<string, { price: number; symbol?: string }> = {};
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    try {
      const url = `https://coins.llama.fi/prices/current/${chunk.join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const data = (await res.json()) as LlamaPriceResponse;
      for (const [k, v] of Object.entries(data.coins ?? {})) {
        out[k] = { price: v.price, symbol: v.symbol };
      }
    } catch {
      /* silent — unpriced assets fall back to 0 and get dust-filtered */
    }
  }
  return out;
}

interface RawSplBalance {
  mint: string;
  amount: number; // human (uiAmount)
  decimals: number;
}

interface SplAccountsResponse {
  value: Array<{
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            tokenAmount: { uiAmount: number | null; decimals: number };
          };
        };
      };
    };
  }>;
}

const CAPS: ReadonlyArray<Capability> = ['portfolio.getPositions', 'portfolio.getTokenBalances'];

class SolanaBalanceProvider implements IProvider {
  readonly id = 'solana-balance';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'onchain_verified' as const;
  readonly priority = 88;

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await rpc('getSlot', []);
      return { status: 'healthy', latencyMs: Date.now() - start, lastCheckAt: new Date().toISOString() };
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
    const [lamports, spl] = await Promise.all([
      rpc<number>('getBalance', [wallet]).catch(() => 0),
      this._readSplBalances(wallet),
    ]);

    const solAmount = (typeof lamports === 'number' ? lamports : 0) / LAMPORTS_PER_SOL;

    // Build price-lookup keys: native SOL + every SPL mint held.
    const priceKeys = ['coingecko:solana', ...spl.map((s) => `solana:${s.mint}`)];
    const prices = await fetchPrices([...new Set(priceKeys)]);

    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    const positions: CanonicalPosition[] = [];

    // Native SOL
    const solPrice = prices['coingecko:solana']?.price ?? 0;
    const solUSD = solAmount * solPrice;
    if (solUSD >= 1) {
      positions.push({
        id: `solana:native:${wallet}`,
        wallet,
        chainId: SOLANA_PSEUDO_CHAIN_ID,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: { symbol: 'SOL', address: 'native', chainId: SOLANA_PSEUDO_CHAIN_ID, decimals: 9, priceUSD: solPrice, source: assetSource },
          amount: solAmount.toString(),
          amountUSD: solUSD,
        }],
        source: assetSource,
      });
    }

    // SPL tokens
    for (const t of spl) {
      const key = `solana:${t.mint}`;
      const price = prices[key]?.price ?? 0;
      const amountUSD = t.amount * price;
      if (amountUSD < 1) continue; // dust / unpriced
      positions.push({
        id: `solana:${t.mint}:${wallet}`,
        wallet,
        chainId: SOLANA_PSEUDO_CHAIN_ID,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: {
            symbol: prices[key]?.symbol ?? t.mint.slice(0, 4),
            address: t.mint,
            chainId: SOLANA_PSEUDO_CHAIN_ID,
            decimals: t.decimals,
            priceUSD: price,
            source: assetSource,
          },
          amount: t.amount.toString(),
          amountUSD,
        }],
        source: assetSource,
      });
    }

    return positions;
  }

  private async _readSplBalances(wallet: string): Promise<RawSplBalance[]> {
    const programs = [SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM];
    const results = await Promise.allSettled(
      programs.map((programId) =>
        rpc<SplAccountsResponse>('getTokenAccountsByOwner', [
          wallet,
          { programId },
          { encoding: 'jsonParsed' },
        ]),
      ),
    );

    const balances: RawSplBalance[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const entry of r.value?.value ?? []) {
        const info = entry.account?.data?.parsed?.info;
        const ui = info?.tokenAmount?.uiAmount;
        if (!info || !ui || ui <= 0) continue;
        balances.push({ mint: info.mint, amount: ui, decimals: info.tokenAmount.decimals });
      }
    }
    return balances;
  }
}

export const solanaBalanceProvider = new SolanaBalanceProvider();

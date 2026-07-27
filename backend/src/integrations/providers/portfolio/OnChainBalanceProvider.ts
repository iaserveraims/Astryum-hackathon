/**
 * OnChainBalanceProvider
 *
 * Reads native + ERC-20 token balances directly from public RPC endpoints.
 * Prices via DeFiLlama Coins API (free, no key, up to 500 coins/request).
 *
 * No Zerion, no DeBank, no API key required. Works for:
 * Ethereum (1), Arbitrum (42161), Base (8453), Polygon (137),
 * Optimism (10), BSC (56), Avalanche (43114), Flare (14).
 *
 * Positions returned as kind='free' (wallet token balances).
 * DeFi positions (lending, LP, staking) are still handled by protocol adapters.
 */

import { ethers } from 'ethers';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';

// ── ERC-20 minimal ABI ────────────────────────────────────────────────────────

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

// ── Chain configuration ───────────────────────────────────────────────────────

interface ChainConfig {
  /** Override via env var ONCHAIN_RPC_<CHAINID> for Alchemy/QuickNode */
  rpc: string;
  nativeSymbol: string;
  /** DeFiLlama chain prefix for token price lookups */
  llamaChain: string;
  /** CoinGecko ID for native token price (via DeFiLlama coingecko: prefix) */
  nativeCoinGeckoId: string;
}

const CHAIN_CONFIG: Record<number, ChainConfig> = {
  1:     { rpc: 'https://eth.llamarpc.com',                  nativeSymbol: 'ETH',  llamaChain: 'ethereum', nativeCoinGeckoId: 'ethereum' },
  42161: { rpc: 'https://arb1.arbitrum.io/rpc',              nativeSymbol: 'ETH',  llamaChain: 'arbitrum', nativeCoinGeckoId: 'ethereum' },
  8453:  { rpc: 'https://mainnet.base.org',                  nativeSymbol: 'ETH',  llamaChain: 'base',     nativeCoinGeckoId: 'ethereum' },
  137:   { rpc: 'https://polygon-rpc.com',                   nativeSymbol: 'POL',  llamaChain: 'polygon',  nativeCoinGeckoId: 'matic-network' },
  10:    { rpc: 'https://mainnet.optimism.io',               nativeSymbol: 'ETH',  llamaChain: 'optimism', nativeCoinGeckoId: 'ethereum' },
  56:    { rpc: 'https://bsc-dataseed.binance.org',          nativeSymbol: 'BNB',  llamaChain: 'bsc',      nativeCoinGeckoId: 'binancecoin' },
  43114: { rpc: 'https://api.avax.network/ext/bc/C/rpc',    nativeSymbol: 'AVAX', llamaChain: 'avax',     nativeCoinGeckoId: 'avalanche-2' },
  14:    { rpc: 'https://flare-api.flare.network/ext/C/rpc', nativeSymbol: 'FLR',  llamaChain: 'flare',    nativeCoinGeckoId: 'flare-networks' },
};

// ── Known ERC-20 tokens per chain ─────────────────────────────────────────────
// Verified contract addresses. Dust threshold filters <$1 positions.

interface TokenEntry { address: string; symbol: string; decimals: number }

const CHAIN_TOKENS: Record<number, TokenEntry[]> = {
  1: [ // Ethereum Mainnet
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC',    decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT',    decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',     decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC',    decimals: 8 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH',    decimals: 18 },
    { address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH',   decimals: 18 },
    { address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', symbol: 'wstETH',  decimals: 18 },
    { address: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', symbol: 'cbETH',   decimals: 18 },
    { address: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', symbol: 'weETH',   decimals: 18 },
    { address: '0xac3E018457B222d93114458476f3E3416Abbe38F', symbol: 'sfrxETH', decimals: 18 },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK',    decimals: 18 },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI',     decimals: 18 },
    { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE',    decimals: 18 },
    { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', symbol: 'CRV',     decimals: 18 },
    { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', symbol: 'LDO',     decimals: 18 },
    { address: '0xec53bF9167f50cDEB3Ae105f56099aaaB9061F83', symbol: 'EIGEN',   decimals: 18 },
    { address: '0x83F20F44975D03b1b09e64809B757c47f942BEeA', symbol: 'sDAI',    decimals: 18 },
    { address: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', symbol: 'sUSDe',   decimals: 18 },
    { address: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', symbol: 'USDe',    decimals: 18 },
  ],
  42161: [ // Arbitrum One
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC',    decimals: 6 },
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC.e',  decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT',    decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI',     decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC',    decimals: 8 },
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH',    decimals: 18 },
    { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB',     decimals: 18 },
    { address: '0x5979D7b546E38E414F7E9822514be443A4800529', symbol: 'wstETH',  decimals: 18 },
    { address: '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe', symbol: 'weETH',   decimals: 18 },
  ],
  8453: [ // Base
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',    decimals: 6 },
    { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC',   decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',    decimals: 18 },
    { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH',   decimals: 18 },
    { address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', symbol: 'wstETH',  decimals: 18 },
    { address: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A', symbol: 'weETH',   decimals: 18 },
    { address: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794', symbol: 'tBTC',    decimals: 18 },
  ],
  137: [ // Polygon
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC',    decimals: 6 },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e',  decimals: 6 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT',    decimals: 6 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI',     decimals: 18 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC',    decimals: 8 },
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH',    decimals: 18 },
    { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC',  decimals: 18 },
    { address: '0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD', symbol: 'wstETH',  decimals: 18 },
  ],
  10: [ // Optimism
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC',    decimals: 6 },
    { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC.e',  decimals: 6 },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT',    decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI',     decimals: 18 },
    { address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', symbol: 'WBTC',    decimals: 8 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',    decimals: 18 },
    { address: '0x4200000000000000000000000000000000000042', symbol: 'OP',      decimals: 18 },
    { address: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', symbol: 'wstETH',  decimals: 18 },
  ],
  56: [ // BSC
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT',    decimals: 18 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC',    decimals: 18 },
    { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI',     decimals: 18 },
    { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB',    decimals: 18 },
    { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH',     decimals: 18 },
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB',    decimals: 18 },
  ],
  43114: [ // Avalanche
    { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC',    decimals: 6 },
    { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT',    decimals: 6 },
    { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH.e',  decimals: 18 },
    { address: '0x50b7545627a5162F82A992c33b87aDc75187B218', symbol: 'WBTC.e',  decimals: 8 },
    { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX',   decimals: 18 },
  ],
  14: [ // Flare Mainnet — FXRP/FAssets + Sceptre liquid staking (watch-only, D3)
    { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', symbol: 'WFLR', decimals: 18 },
    // sFLR — Sceptre staked FLR (verified: mainnet.flarescan.com/address/0x12e605bc…c2bb)
    { address: '0x12e605bc104e93b45e1ad99f9e555f659051c2bb', symbol: 'sFLR', decimals: 18 },
    // FXRP — FAssets representation of XRP (verified: flare-explorer.flare.network/token/0xad552a…c5be).
    // Mirrors XRP's 6 decimals. TODO(verify-on-chain): confirm decimals() if balances look off.
    { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', symbol: 'FXRP', decimals: 6 },
  ],
};

// ── Price fetching ────────────────────────────────────────────────────────────

interface LlamaPriceResponse {
  coins: Record<string, { price: number; decimals?: number; symbol?: string }>;
}

async function fetchPricesFromLlama(coinKeys: string[]): Promise<Record<string, number>> {
  if (coinKeys.length === 0) return {};
  // DeFiLlama allows up to 500 coins per request
  const chunks: string[][] = [];
  for (let i = 0; i < coinKeys.length; i += 500) chunks.push(coinKeys.slice(i, i + 500));
  const prices: Record<string, number> = {};
  await Promise.allSettled(
    chunks.map(async (chunk) => {
      try {
        const url = `https://coins.llama.fi/prices/current/${chunk.join(',')}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const data = (await res.json()) as LlamaPriceResponse;
        for (const [key, val] of Object.entries(data.coins ?? {})) {
          prices[key] = val.price;
        }
      } catch { /* silent — prices fallback to 0 */ }
    }),
  );
  return prices;
}

// ── Per-chain balance reading ─────────────────────────────────────────────────

interface RawBalance {
  symbol: string;
  address: string; // '0x0' for native
  decimals: number;
  raw: bigint;
  chainId: number;
  llamaKey: string; // price lookup key
}

async function readChainBalances(
  wallet: string,
  chainId: number,
  cfg: ChainConfig,
  tokens: TokenEntry[],
): Promise<RawBalance[]> {
  // Allow per-chain RPC override via env: ONCHAIN_RPC_1, ONCHAIN_RPC_42161, etc.
  const rpcUrl = process.env[`ONCHAIN_RPC_${chainId}`] ?? cfg.rpc;

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, {
    staticNetwork: true,
    batchMaxCount: 50, // ethers v6 auto-batches eth_call
  });

  const results: RawBalance[] = [];

  // Native balance
  const nativeResult = await Promise.allSettled([provider.getBalance(wallet)]);
  if (nativeResult[0].status === 'fulfilled') {
    results.push({
      symbol: cfg.nativeSymbol,
      address: '0x0',
      decimals: 18,
      raw: nativeResult[0].value,
      chainId,
      llamaKey: `coingecko:${cfg.nativeCoinGeckoId}`,
    });
  }

  // ERC-20 balances (batched via ethers v6 JsonRpcProvider internal batching)
  const tokenResults = await Promise.allSettled(
    tokens.map((t) => {
      const contract = new ethers.Contract(t.address, ERC20_ABI, provider);
      return (contract.balanceOf(wallet) as Promise<bigint>);
    }),
  );

  for (let i = 0; i < tokens.length; i++) {
    const r = tokenResults[i];
    if (r.status === 'fulfilled' && r.value > 0n) {
      const t = tokens[i];
      results.push({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        raw: r.value,
        chainId,
        llamaKey: `${cfg.llamaChain}:${t.address.toLowerCase()}`,
      });
    }
  }

  return results;
}

// ── Main provider class ───────────────────────────────────────────────────────

const CAPS: ReadonlyArray<Capability> = [
  'portfolio.getPositions',
  'portfolio.getTokenBalances',
];

class OnChainBalanceProvider implements IProvider {
  readonly id = 'onchain-balance';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'onchain_verified' as const;
  readonly priority = 90; // higher than Zerion (75) — on-chain data wins

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const provider = new ethers.JsonRpcProvider(
        CHAIN_CONFIG[1].rpc, 1, { staticNetwork: true },
      );
      await provider.getBlockNumber();
      return { status: 'healthy', latencyMs: Date.now() - start, lastCheckAt: new Date().toISOString() };
    } catch (err) {
      return {
        status: 'degraded',
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
    const inp = input as Record<string, unknown>;
    const wallet = inp.walletAddress as string;
    if (!wallet) throw new Error('walletAddress required');

    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const positions = await this._fetchAllBalances(wallet, ctx.traceId);

    return { data: positions as unknown as TOut, source, cached: false };
  }

  private async _fetchAllBalances(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    // Read all chains in parallel
    const chainEntries = Object.entries(CHAIN_CONFIG).map(([id, cfg]) => ({
      chainId: parseInt(id, 10),
      cfg,
      tokens: CHAIN_TOKENS[parseInt(id, 10)] ?? [],
    }));

    // Hard per-chain deadline: these are free public RPCs (llamarpc,
    // polygon-rpc…) that can hang or rate-limit — without a timeout the
    // slowest chain gates the whole portfolio response.
    const CHAIN_READ_TIMEOUT_MS = 12_000;
    const withTimeout = <T>(p: Promise<T>, chainId: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error(`chain ${chainId} read timed out after ${CHAIN_READ_TIMEOUT_MS}ms`)),
            CHAIN_READ_TIMEOUT_MS,
          );
          t.unref?.();
        }),
      ]);

    const perChainResults = await Promise.allSettled(
      chainEntries.map(({ chainId, cfg, tokens }) =>
        withTimeout(readChainBalances(wallet, chainId, cfg, tokens), chainId),
      ),
    );

    // Flatten successful reads
    const allBalances: RawBalance[] = [];
    for (let i = 0; i < perChainResults.length; i++) {
      const r = perChainResults[i];
      if (r.status === 'fulfilled') {
        allBalances.push(...r.value);
      } else {
        console.warn(
          `[OnChainBalance] chain ${chainEntries[i].chainId} read failed:`,
          (r.reason as Error).message,
        );
      }
    }

    if (allBalances.length === 0) return [];

    // Fetch prices from DeFiLlama in one request
    const uniqueKeys = [...new Set(allBalances.map((b) => b.llamaKey))];
    const prices = await fetchPricesFromLlama(uniqueKeys);

    // Convert to CanonicalPosition[], filter dust < $1
    const positions: CanonicalPosition[] = [];
    const assetSource = {
      providerId: 'onchain-balance',
      providerType: 'data' as const,
      trustLevel: 'onchain_verified' as const,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    for (const bal of allBalances) {
      const priceUSD = prices[bal.llamaKey] ?? 0;
      const amount = Number(bal.raw) / Math.pow(10, bal.decimals);
      const amountUSD = amount * priceUSD;

      if (amountUSD < 1) continue; // skip dust

      positions.push({
        id: `onchain:${bal.chainId}:${bal.address.toLowerCase()}:${wallet.toLowerCase()}`,
        wallet,
        chainId: bal.chainId,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: {
            symbol: bal.symbol,
            address: bal.address,
            chainId: bal.chainId,
            decimals: bal.decimals,
            priceUSD,
            source: assetSource,
          },
          amount: amount.toString(),
          amountUSD,
        }],
        source: {
          providerId: 'onchain-balance',
          providerType: 'data' as const,
          trustLevel: 'onchain_verified' as const,
          fetchedAt: new Date().toISOString(),
          traceId,
        },
      });
    }

    return positions;
  }
}

export const onChainBalanceProvider = new OnChainBalanceProvider();

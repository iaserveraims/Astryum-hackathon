import { randomUUID } from 'crypto';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
  HealthStatus,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'explorer.getTransactions',
  'explorer.getTokenTransfers',
  'explorer.discoverDeFiInteractions',
]);

const HEALTH_TIMEOUT_MS = 5000;
const FETCH_TIMEOUT_MS = 20000;

/** Etherscan-like response envelope */
interface EtherscanResponse<T> {
  status: string;   // '1' = OK, '0' = error/no results
  message: string;
  result: T;
}

export interface RawTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
  blockNumber: string;
  timeStamp: string;
  isError: string;
  txreceipt_status: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  contractAddress: string;
  functionName?: string;
  methodId?: string;
}

export interface NormalizedTransaction {
  txHash: string;
  from: string;
  to: string | null;
  value: string;
  inputData: string;
  blockNumber: number;
  timestamp: Date;
  isError: boolean;
  methodId: string | null;
  functionName: string | null;
  chainId: number;
}

export interface DiscoveredInteraction {
  txHash: string;
  contractAddress: string;
  interactionType: string;
  blockNumber: number;
  timestamp: Date;
  chainId: number;
  from: string;
}

// Known 4-byte function selectors for common DeFi actions
const METHOD_LABELS: Record<string, string> = {
  '0x095ea7b3': 'approve',
  '0xa9059cbb': 'transfer',
  '0x23b872dd': 'transferFrom',
  '0xe8eda9df': 'supply',       // Aave v2 deposit
  '0x617ba037': 'supply',       // Aave v3
  '0x69328dec': 'withdraw',
  '0x573ade81': 'repay',
  '0x1a4d01d2': 'repay',        // Aave v3
  '0xc04a8a10': 'borrow',
  '0xa415bcad': 'borrow',       // Aave v3
  '0x5b34b966': 'stake',
  '0x2e1a7d4d': 'unstake',
  '0x4e71d92d': 'claim',        // claimRewards
  '0x3d18b912': 'harvest',
  '0x38d07436': 'addLiquidity',
  '0xbaa2abde': 'removeLiquidity',
  '0x7ff36ab5': 'swap',         // swapExactETHForTokens
  '0x18cbafe5': 'swap',         // swapExactTokensForETH
  '0x38ed1739': 'swap',         // swapExactTokensForTokens
  '0x414bf389': 'swap',         // exactInputSingle (V3)
  '0xc2e3140a': 'exitLP',
  '0xf305d719': 'addLiquidityETH',
  '0x02751cec': 'removeLiquidityETH',
};

export interface ChainExplorerConfig {
  chainId: number;
  chainName: string;
  baseUrl: string;
  apiKey?: string;
}

/** Built-in chain configs — override via EXPLORER_CONFIGS env or pass directly */
const DEFAULT_CHAIN_CONFIGS: ChainExplorerConfig[] = [
  {
    chainId: 1,
    chainName: 'Ethereum',
    baseUrl: 'https://api.etherscan.io/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  {
    chainId: 137,
    chainName: 'Polygon',
    baseUrl: 'https://api.polygonscan.com/api',
    apiKey: process.env.POLYGONSCAN_API_KEY,
  },
  {
    chainId: 42161,
    chainName: 'Arbitrum',
    baseUrl: 'https://api.arbiscan.io/api',
    apiKey: process.env.ARBISCAN_API_KEY,
  },
  {
    chainId: 8453,
    chainName: 'Base',
    baseUrl: 'https://api.basescan.org/api',
    apiKey: process.env.BASESCAN_API_KEY,
  },
  {
    chainId: 14,
    chainName: 'Flare',
    baseUrl: process.env.FLARESCAN_API_URL || 'https://flare-explorer.flare.network/api',
    apiKey: undefined, // public
  },
];

/**
 * ChainExplorerProvider — generic multi-chain Etherscan-compatible explorer client.
 * Fetches normal transactions, discovers DeFi interactions.
 * Does NOT create positions — only interactions.
 */
export class ChainExplorerProvider implements IProvider {
  readonly id = 'chain-explorer';
  readonly type: ProviderType = 'explorer';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 75;
  readonly capabilities = CAPS;

  private readonly chainConfigs: Map<number, ChainExplorerConfig>;

  constructor(configs: ChainExplorerConfig[] = DEFAULT_CHAIN_CONFIGS) {
    this.chainConfigs = new Map(configs.map((c) => [c.chainId, c]));
  }

  async health(): Promise<ProviderHealth> {
    // Health check: ping Ethereum explorer (always present)
    const cfg = this.chainConfigs.get(1) ?? this.chainConfigs.values().next().value;
    if (!cfg) {
      return { status: 'down', lastCheckAt: new Date().toISOString(), reason: 'no chains configured' };
    }
    const startedAt = Date.now();
    try {
      const url = `${cfg.baseUrl}?module=block&action=eth_block_number${cfg.apiKey ? `&apikey=${cfg.apiKey}` : ''}`;
      const res = await fetchWithTimeout(url, HEALTH_TIMEOUT_MS);
      const latencyMs = Date.now() - startedAt;
      const status: HealthStatus = res.ok ? 'healthy' : 'degraded';
      return { status, latencyMs, lastCheckAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'down', lastCheckAt: new Date().toISOString(), reason: String(err) };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = this._source(ctx.traceId);
    const { wallet, chainId } = input as { wallet: string; chainId: number };

    switch (capability) {
      case 'explorer.getTransactions': {
        const txs = await this.getTransactions(wallet, chainId);
        return { data: txs as unknown as TOut, source, cached: false };
      }
      case 'explorer.getTokenTransfers': {
        const transfers = await this.getTokenTransfers(wallet, chainId);
        return { data: transfers as unknown as TOut, source, cached: false };
      }
      case 'explorer.discoverDeFiInteractions': {
        const { knownContracts } = input as { wallet: string; chainId: number; knownContracts?: string[] };
        const interactions = await this.discoverDeFiInteractions(wallet, chainId, knownContracts ?? []);
        return { data: interactions as unknown as TOut, source, cached: false };
      }
      default:
        throw new Error(`ChainExplorerProvider: unknown capability ${capability}`);
    }
  }

  /** Fetch normal transactions for a wallet on a given chain */
  async getTransactions(wallet: string, chainId: number): Promise<NormalizedTransaction[]> {
    const cfg = this._getConfig(chainId);
    const params = new URLSearchParams({
      module: 'account',
      action: 'txlist',
      address: wallet,
      startblock: '0',
      endblock: '99999999',
      sort: 'desc',
      offset: '100',
      page: '1',
    });
    if (cfg.apiKey) params.set('apikey', cfg.apiKey);

    const res = await fetchWithTimeout(`${cfg.baseUrl}?${params}`, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`ChainExplorer HTTP ${res.status} for chain ${chainId}`);

    const body = await res.json() as EtherscanResponse<RawTransaction[] | string>;
    if (body.status !== '1' || !Array.isArray(body.result)) return [];

    return (body.result as RawTransaction[]).map((tx) => this._normalize(tx, chainId));
  }

  /** Fetch ERC-20 token transfers for a wallet */
  async getTokenTransfers(wallet: string, chainId: number): Promise<NormalizedTransaction[]> {
    const cfg = this._getConfig(chainId);
    const params = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      address: wallet,
      startblock: '0',
      endblock: '99999999',
      sort: 'desc',
      offset: '100',
      page: '1',
    });
    if (cfg.apiKey) params.set('apikey', cfg.apiKey);

    const res = await fetchWithTimeout(`${cfg.baseUrl}?${params}`, FETCH_TIMEOUT_MS);
    if (!res.ok) return [];

    const body = await res.json() as EtherscanResponse<RawTransaction[] | string>;
    if (body.status !== '1' || !Array.isArray(body.result)) return [];

    return (body.result as RawTransaction[]).map((tx) => this._normalize(tx, chainId));
  }

  /**
   * Discover DeFi interactions by matching transactions against known contract addresses.
   * Returns DiscoveredInteraction[] — NOT positions.
   */
  async discoverDeFiInteractions(
    wallet: string,
    chainId: number,
    knownContracts: string[],
  ): Promise<DiscoveredInteraction[]> {
    const txs = await this.getTransactions(wallet, chainId);
    const knownSet = new Set(knownContracts.map((a) => a.toLowerCase()));

    const interactions: DiscoveredInteraction[] = [];
    for (const tx of txs) {
      if (tx.isError) continue;
      const toAddr = tx.to?.toLowerCase();
      if (!toAddr) continue;

      // Match if `to` is a known DeFi contract, or if contract was deployed in this tx
      const matchedAddress = knownSet.has(toAddr) ? tx.to! : null;
      if (!matchedAddress) continue;

      const interactionType = tx.methodId
        ? (METHOD_LABELS[tx.methodId.slice(0, 10)] ?? 'unknown')
        : 'unknown';

      interactions.push({
        txHash: tx.txHash,
        contractAddress: matchedAddress,
        interactionType,
        blockNumber: tx.blockNumber,
        timestamp: tx.timestamp,
        chainId,
        from: tx.from,
      });
    }

    return interactions;
  }

  /** Normalize a raw Etherscan transaction into our shape */
  _normalize(tx: RawTransaction, chainId: number): NormalizedTransaction {
    const methodId = tx.input && tx.input.length >= 10
      ? tx.input.slice(0, 10)
      : null;
    return {
      txHash: tx.hash,
      from: tx.from,
      to: tx.to || null,
      value: tx.value,
      inputData: tx.input,
      blockNumber: parseInt(tx.blockNumber, 10) || 0,
      timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000),
      isError: tx.isError === '1',
      methodId,
      functionName: tx.functionName ?? null,
      chainId,
    };
  }

  /** Check if a chain is supported */
  supportsChain(chainId: number): boolean {
    return this.chainConfigs.has(chainId);
  }

  private _getConfig(chainId: number): ChainExplorerConfig {
    const cfg = this.chainConfigs.get(chainId);
    if (!cfg) throw new Error(`ChainExplorerProvider: no config for chainId ${chainId}`);
    return cfg;
  }

  private _source(traceId: string): SourceRecord {
    return {
      providerId: this.id,
      providerType: 'explorer',
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const chainExplorerProvider = new ChainExplorerProvider();

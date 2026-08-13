/**
 * SquidRouterProvider — FASE 8 (P18, V2)
 *
 * Wraps the Squid Router v2 API for cross-chain swaps and bridges via Axelar.
 * Complementary to Li.Fi: use Squid for routes where Axelar-based bridging
 * provides better rates or is preferred by the user (esp. Cosmos ↔ EVM paths).
 *
 * Revenue model:
 *   - SQUID_FEE_BPS (default 15 = 0.15%) passed as `feeBps` in every request.
 *   - Squid routes the fee to ASTRYUM_FEE_WALLET via `integratorAddress`.
 *   - disclosedToUser: true — always disclosed before user signs.
 *
 * Regulatory invariants (never remove):
 *   authorization.astryumRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never calls sendTransaction / broadcastTransaction
 *
 * Supported chains: ETH (1), Polygon (137), Arbitrum (42161), Optimism (10),
 *   Avalanche (43114), Base (8453), BSC (56), Gnosis (100), Fantom (250),
 *   Celo (42220), Linea (59144), Scroll (534352), zkSync Era (324),
 *   Polygon zkEVM (1101), Mantle (5000), Blast (81457), Mode (34443).
 * NOT Flare (14) — use internal protocol adapters for Flare DeFi.
 * Requires: SQUID_INTEGRATOR_ID (register free at axelar.network/squid).
 */

import { randomUUID } from 'crypto';
import type {
  IProvider,
  ProviderHealth,
  Capability,
  ProviderCallContext,
  ProviderCallResult,
} from '../../interfaces/IProvider';
import type { IntentPayload } from '../../../types/IntentPayload';

const SQUID_API_BASE = 'https://v2.api.squidrouter.com';
const DEFAULT_FEE_BPS = 15;   // 0.15%
const DEFAULT_SLIPPAGE = 1.5; // 1.5%

const SQUID_SUPPORTED_CHAINS = new Set([
  1,       // Ethereum
  10,      // Optimism
  56,      // BSC
  100,     // Gnosis
  137,     // Polygon
  250,     // Fantom
  324,     // zkSync Era
  1101,    // Polygon zkEVM
  5000,    // Mantle
  8453,    // Base
  34443,   // Mode
  42161,   // Arbitrum
  42220,   // Celo
  43114,   // Avalanche
  59144,   // Linea
  81457,   // Blast
  534352,  // Scroll
]);

export interface SquidQuoteParams {
  fromAddress: string;      // user's wallet
  fromChain: number;        // source chain ID
  fromToken: string;        // source token address (0xEeee… for native)
  fromAmount: string;       // amount in smallest unit (wei)
  toChain: number;          // destination chain ID
  toToken: string;          // destination token address
  toAddress?: string;       // recipient (defaults to fromAddress)
  slippage?: number;        // percent e.g. 1.5 (default 1.5%)
  prefer?: string[];        // preferred bridges e.g. ['stargate', 'cctp']
  enableBoost?: boolean;    // optional speed boost for some routes
  quoteOnly?: boolean;      // if true, returns estimate without tx calldata
}

export interface SquidEstimate {
  sendAmount: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  exchangeRate: string;
  aggregatePriceImpact: string;
  aggregateSlippage: string;
  estimatedRouteDuration: number; // seconds
  feeCosts: Array<{
    name: string;
    amount: string;
    amountUSD: string;
    token: { symbol: string; decimals: number };
  }>;
  gasCosts: Array<{
    type: string;
    amount: string;
    amountUSD: string;
    token: { symbol: string; decimals: number };
  }>;
}

export interface SquidQuoteResult {
  id: string;
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  estimatedDuration: number;  // seconds
  priceImpact: string;
  fee: {
    bps: number;
    recipientWallet: string;
    disclosed: true;
  };
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  } | null;  // null when quoteOnly=true
  estimate: SquidEstimate;
  source: { providerId: string; fetchedAt: string };
}

export interface SquidStatusParams {
  txHash: string;
  fromChainId: number;
  toChainId: number;
}

export interface SquidStatusResult {
  id: string;
  status: string;           // 'ongoing' | 'success' | 'partial_success' | 'needs_gas' | 'not_found'
  toChainTxHash?: string;
  error?: string;
  source: { providerId: string; fetchedAt: string };
}

export class SquidRouterProvider implements IProvider {
  readonly id = 'squid';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 79;

  readonly capabilities: ReadonlyArray<Capability> = [
    'swap.getQuote',
    'swap.prepareSwap',
    'bridge.getRoute',
    'bridge.getDepositStatus',
  ];

  private get feeBps(): number {
    const raw = parseInt(process.env.SQUID_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }

  private get feeWallet(): string {
    return process.env.ASTRYUM_FEE_WALLET ?? '';
  }

  private get integratorId(): string {
    return process.env.SQUID_INTEGRATOR_ID ?? 'astryum';
  }

  private headers(): Record<string, string> {
    return {
      'x-integrator-id': this.integratorId,
      Accept: 'application/json',
    };
  }

  supportsChain(chainId: number): boolean {
    return SQUID_SUPPORTED_CHAINS.has(chainId);
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${SQUID_API_BASE}/v2/chains`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          status: 'degraded',
          latencyMs,
          lastCheckAt: new Date().toISOString(),
          reason: `HTTP ${res.status}`,
        };
      }
      return { status: 'healthy', latencyMs, lastCheckAt: new Date().toISOString() };
    } catch (err: any) {
      return {
        status: 'down',
        lastCheckAt: new Date().toISOString(),
        reason: err?.message ?? 'unreachable',
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const inp = input as Record<string, unknown>;
    let data: unknown;

    switch (capability) {
      case 'swap.getQuote':
      case 'swap.prepareSwap':
        data = await this.getQuote(inp as unknown as SquidQuoteParams);
        break;
      case 'bridge.getRoute':
        data = await this.getQuote({ ...(inp as unknown as SquidQuoteParams) });
        break;
      case 'bridge.getDepositStatus':
        data = await this.getStatus(inp as unknown as SquidStatusParams);
        break;
      default:
        throw new Error(`SquidRouterProvider: unsupported capability '${capability}'`);
    }

    return {
      data: data as TOut,
      cached: false,
      source: {
        providerId: this.id,
        providerType: this.type,
        trustLevel: this.trustLevel,
        fetchedAt: new Date().toISOString(),
        traceId: ctx.traceId,
      },
    };
  }

  /**
   * GET /v2/route — returns best route with unsigned EVM calldata.
   * Works for same-chain swaps (toChain === fromChain) and cross-chain bridges.
   * Astryum never signs — returns unsigned calldata only.
   */
  async getQuote(params: SquidQuoteParams): Promise<SquidQuoteResult> {
    if (!this.supportsChain(params.fromChain)) {
      throw new Error(
        `SquidRouterProvider: fromChain ${params.fromChain} not supported.` +
        (params.fromChain === 14 ? ' Use internal protocol adapters for Flare.' : ''),
      );
    }
    if (!this.supportsChain(params.toChain)) {
      throw new Error(
        `SquidRouterProvider: toChain ${params.toChain} not supported.` +
        (params.toChain === 14 ? ' Use internal protocol adapters for Flare.' : ''),
      );
    }

    const qs = new URLSearchParams({
      fromAddress: params.fromAddress,
      fromChain: String(params.fromChain),
      fromToken: params.fromToken,
      fromAmount: params.fromAmount,
      toChain: String(params.toChain),
      toToken: params.toToken,
      slippage: String(params.slippage ?? DEFAULT_SLIPPAGE),
      feeBps: String(this.feeBps),
      integratorAddress: this.feeWallet,
    });

    if (params.toAddress) qs.set('toAddress', params.toAddress);
    if (params.prefer?.length) qs.set('prefer', params.prefer.join(','));
    if (params.enableBoost) qs.set('enableBoost', 'true');
    if (params.quoteOnly) qs.set('quoteOnly', 'true');

    const res = await fetch(`${SQUID_API_BASE}/v2/route?${qs.toString()}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Squid /v2/route HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as any;
    const route = body.route ?? {};
    const estimate: SquidEstimate = route.estimate ?? {};
    const txReq = route.transactionRequest ?? null;

    return {
      id: randomUUID(),
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: estimate.fromAmount ?? params.fromAmount,
      toAmount: estimate.toAmount ?? '0',
      toAmountMin: estimate.toAmountMin ?? '0',
      estimatedDuration: estimate.estimatedRouteDuration ?? 0,
      priceImpact: estimate.aggregatePriceImpact ?? '0',
      fee: {
        bps: this.feeBps,
        recipientWallet: this.feeWallet,
        disclosed: true,
      },
      tx: txReq
        ? {
            from: params.fromAddress,
            to: txReq.targetAddress ?? '',
            data: txReq.data ?? '0x',
            value: txReq.value ?? '0',
            gasLimit: String(txReq.gasLimit ?? '500000'),
            chainId: params.fromChain,
          }
        : null,
      estimate,
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * GET /v2/status — check bridge transaction status.
   */
  async getStatus(params: SquidStatusParams): Promise<SquidStatusResult> {
    const qs = new URLSearchParams({
      txHash: params.txHash,
      fromChainId: String(params.fromChainId),
      toChainId: String(params.toChainId),
    });

    const res = await fetch(`${SQUID_API_BASE}/v2/status?${qs.toString()}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Squid /v2/status HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as any;
    return {
      id: params.txHash,
      status: body.status ?? 'not_found',
      toChainTxHash: body.toChainTxHash,
      error: body.error,
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Wraps a getQuote result into a full IntentPayload.
   * authorization.astryumRelays: false — always.
   */
  async prepareIntent(params: SquidQuoteParams): Promise<IntentPayload> {
    const quote = await this.getQuote(params);
    if (!quote.tx) {
      throw new Error('SquidRouterProvider: route returned no transaction data (quoteOnly mode)');
    }
    const expiresAt = new Date(Date.now() + 300_000); // 5 minutes
    const isBridge = params.fromChain !== params.toChain;

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        to: quote.tx.to,
        data: quote.tx.data,
        value: quote.tx.value,
        gasLimit: quote.tx.gasLimit,
        chainId: params.fromChain,
      },

      metadata: {
        action: isBridge ? 'bridge' : 'swap',
        protocol: 'squid:axelar',
        description:
          `Squid ${isBridge ? 'cross-chain bridge' : 'swap'} via Axelar. ` +
          `Fee: ${(this.feeBps / 100).toFixed(2)}%. Est. duration: ${quote.estimatedDuration}s.`,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },

      referralAttribution: {
        referralWallet: this.feeWallet,
        attributionBps: this.feeBps,
        disclosedToUser: true,
        disclosureText:
          `Astryum fee: ${(this.feeBps / 100).toFixed(2)}% → ` +
          `${this.feeWallet.slice(0, 10) || 'ASTRYUM_FEE_WALLET'}… ` +
          '(embedded via Squid integratorAddress)',
      },

      authorization: {
        mode: 'user_authorized_partner_relay',
        userMustAuthorize: true,
        astryumRelays: false,
        singleUseSession: true,
      },

      policy: {
        evaluatedAt: new Date().toISOString(),
        passed: true,
        warnings: [],
      },

      audit: {
        traceId: randomUUID(),
        sessionId: '',
        intentSource: 'user',
      },

      expiry: {
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: 300,
      },
    };
  }
}

export const squidRouterProvider = new SquidRouterProvider();

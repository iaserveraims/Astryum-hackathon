/**
 * LiFiProvider — P14
 *
 * Wraps the Li.Fi v1 API for cross-chain swaps and bridges across 60+ EVM chains.
 *
 * Revenue model:
 *   - LIFI_FEE_BPS (default 15 = 0.15%) passed as `fee` (decimal) in every request.
 *   - Li.Fi routes the fee to ASTRYUM_FEE_WALLET via the `integrator` mechanism.
 *   - disclosedToUser: true — always disclosed before user signs.
 *
 * Regulatory invariants (never remove):
 *   authorization.astryumRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never calls sendTransaction / broadcastTransaction
 *
 * Supported chains: Ethereum(1), BSC(56), Polygon(137), Optimism(10), Arbitrum(42161),
 *   Base(8453), Avalanche(43114), Fantom(250), Gnosis(100), Linea(59144), Scroll(534352).
 * NOT Flare (14) — use internal protocol adapters for Flare DeFi.
 * NOT Solana — use JupiterSwapProvider for Solana swaps.
 */

import { randomUUID } from 'crypto';
import type { IProvider, ProviderHealth, Capability, ProviderCallContext, ProviderCallResult } from '../../interfaces/IProvider';
import type { IntentPayload } from '../../../types/IntentPayload';

const LIFI_API_BASE = 'https://li.quest/v1';
const INTEGRATOR_ID = 'astryum';
const DEFAULT_FEE_BPS = 15;   // 0.15%
const DEFAULT_SLIPPAGE = 0.005; // 0.5%

// Chains supported by Li.Fi that Astryum exposes. Excludes Flare (14).
const LIFI_SUPPORTED_CHAINS = new Set([
  1,      // Ethereum
  56,     // BSC
  137,    // Polygon
  10,     // Optimism
  42161,  // Arbitrum
  8453,   // Base
  43114,  // Avalanche
  250,    // Fantom
  100,    // Gnosis
  59144,  // Linea
  534352, // Scroll
  81457,  // Blast
]);

export interface LiFiQuoteParams {
  fromChain: number;          // source chain ID
  toChain: number;            // destination chain ID (same as fromChain for single-chain swap)
  fromToken: string;          // token address (0xEeee… for native)
  toToken: string;            // token address
  fromAmount: string;         // amount in smallest unit (wei)
  fromAddress: string;        // user wallet address
  toAddress?: string;         // recipient (defaults to fromAddress)
  slippage?: number;          // decimal e.g. 0.005 = 0.5% (default 0.5%)
  allowBridges?: string[];    // optional filter (e.g. ['stargate', 'hop'])
  denyBridges?: string[];     // optional exclusion
}

export interface LiFiQuoteResult {
  id: string;
  type: string;               // 'lifi' | 'swap' | 'cross'
  tool: string;               // bridge/DEX used (e.g. 'stargate', 'uniswap')
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  estimatedGas: string;
  executionDuration: number;  // seconds
  priceImpact: string | null;
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
    gasPrice?: string;
    gasLimit: string;
    chainId: number;
  };
  source: { providerId: string; fetchedAt: string };
}

export interface LiFiRoutesParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
  maxPriceImpact?: number;    // default 0.4 (40%)
  allowBridges?: string[];
  denyBridges?: string[];
}

export interface LiFiRoute {
  id: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  gasCostUSD: string;
  steps: Array<{
    tool: string;
    type: string;
    fromChainId: number;
    toChainId: number;
  }>;
}

export interface LiFiRoutesResult {
  routes: LiFiRoute[];
  bestRoute: LiFiRoute | null;
  source: { providerId: string; fetchedAt: string };
}

export class LiFiProvider implements IProvider {
  readonly id = 'lifi';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 82;

  readonly capabilities: ReadonlyArray<Capability> = [
    'swap.getQuote',
    'swap.prepareSwap',
    'bridge.getRoute',
  ];

  private get feeBps(): number {
    const raw = parseInt(process.env.LIFI_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }

  private get feeWallet(): string {
    return process.env.ASTRYUM_FEE_WALLET ?? '';
  }

  private get apiKey(): string {
    return process.env.LIFI_API_KEY ?? '';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) h['x-lifi-api-key'] = this.apiKey;
    return h;
  }

  supportsChain(chainId: number): boolean {
    return LIFI_SUPPORTED_CHAINS.has(chainId);
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${LIFI_API_BASE}/chains`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { status: 'degraded', latencyMs, lastCheckAt: new Date().toISOString(), reason: `HTTP ${res.status}` };
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
        data = await this.getQuote(inp as unknown as LiFiQuoteParams);
        break;
      case 'swap.prepareSwap':
        data = await this.getQuote(inp as unknown as LiFiQuoteParams);
        break;
      case 'bridge.getRoute':
        data = await this.getRoutes(inp as unknown as LiFiRoutesParams);
        break;
      default:
        throw new Error(`LiFiProvider: unsupported capability '${capability}'`);
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
   * GET /quote — returns a single best route with unsigned tx calldata.
   * Works for both same-chain swaps (toChain === fromChain) and cross-chain bridges.
   * Astryum never signs. Returns unsigned EVM calldata.
   */
  async getQuote(params: LiFiQuoteParams): Promise<LiFiQuoteResult> {
    if (!this.supportsChain(params.fromChain)) {
      throw new Error(
        `LiFiProvider: fromChain ${params.fromChain} not supported. ` +
        (params.fromChain === 14 ? 'Use internal adapters for Flare.' : 'Chain not in supported set.'),
      );
    }
    if (!this.supportsChain(params.toChain)) {
      throw new Error(
        `LiFiProvider: toChain ${params.toChain} not supported. ` +
        (params.toChain === 14 ? 'Use internal adapters for Flare.' : 'Chain not in supported set.'),
      );
    }

    const feeDecimal = this.feeBps / 10000; // 15 bps → 0.0015

    const qs = new URLSearchParams({
      fromChain: String(params.fromChain),
      toChain: String(params.toChain),
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      fromAddress: params.fromAddress,
      integrator: INTEGRATOR_ID,
      fee: String(feeDecimal),
      slippage: String(params.slippage ?? DEFAULT_SLIPPAGE),
    });

    if (params.toAddress) qs.set('toAddress', params.toAddress);
    if (params.allowBridges?.length) qs.set('allowBridges', params.allowBridges.join(','));
    if (params.denyBridges?.length) qs.set('denyBridges', params.denyBridges.join(','));

    const res = await fetch(`${LIFI_API_BASE}/quote?${qs.toString()}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`LiFi /quote HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as any;
    const tx = body.transactionRequest ?? {};
    const estimate = body.estimate ?? {};

    return {
      id: body.id ?? randomUUID(),
      type: body.type ?? 'lifi',
      tool: body.tool ?? body.toolDetails?.name ?? 'unknown',
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: estimate.fromAmount ?? params.fromAmount,
      toAmount: estimate.toAmount ?? '0',
      toAmountMin: estimate.toAmountMin ?? '0',
      estimatedGas: String(
        estimate.gasCosts?.reduce((sum: number, c: any) => sum + Number(c.estimate ?? 0), 0) ?? 0,
      ),
      executionDuration: estimate.executionDuration ?? 0,
      priceImpact: estimate.priceImpact ?? null,
      fee: {
        bps: this.feeBps,
        recipientWallet: this.feeWallet,
        disclosed: true,
      },
      tx: {
        from: tx.from ?? params.fromAddress,
        to: tx.to ?? '',
        data: tx.data ?? '0x',
        value: tx.value ?? '0x0',
        gasPrice: tx.gasPrice,
        gasLimit: String(tx.gasLimit ?? tx.gas ?? '400000'),
        chainId: params.fromChain,
      },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * POST /advanced/routes — returns all available routes sorted by best output.
   * Useful when the caller wants to compare bridges before committing.
   */
  async getRoutes(params: LiFiRoutesParams): Promise<LiFiRoutesResult> {
    if (!this.supportsChain(params.fromChainId)) {
      throw new Error(`LiFiProvider: fromChainId ${params.fromChainId} not supported`);
    }
    if (!this.supportsChain(params.toChainId)) {
      throw new Error(`LiFiProvider: toChainId ${params.toChainId} not supported`);
    }

    const feeDecimal = this.feeBps / 10000;

    const body: Record<string, unknown> = {
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      fromAmount: params.fromAmount,
      fromAddress: params.fromAddress,
      integrator: INTEGRATOR_ID,
      fee: feeDecimal,
      options: {
        slippage: params.slippage ?? DEFAULT_SLIPPAGE,
        maxPriceImpact: params.maxPriceImpact ?? 0.4,
        integrator: INTEGRATOR_ID,
        fee: feeDecimal,
      },
    };

    if (params.toAddress) body['toAddress'] = params.toAddress;
    if (params.allowBridges?.length) (body['options'] as any).allowBridges = params.allowBridges;
    if (params.denyBridges?.length) (body['options'] as any).denyBridges = params.denyBridges;

    const res = await fetch(`${LIFI_API_BASE}/advanced/routes`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`LiFi /advanced/routes HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const routes: LiFiRoute[] = (data.routes ?? []).map((r: any) => ({
      id: r.id ?? randomUUID(),
      fromAmount: r.fromAmount ?? '0',
      toAmount: r.toAmount ?? '0',
      toAmountMin: r.toAmountMin ?? '0',
      gasCostUSD: r.gasCostUSD ?? '0',
      steps: (r.steps ?? []).map((s: any) => ({
        tool: s.tool ?? s.toolDetails?.name ?? 'unknown',
        type: s.type ?? 'unknown',
        fromChainId: s.action?.fromChainId ?? params.fromChainId,
        toChainId: s.action?.toChainId ?? params.toChainId,
      })),
    }));

    return {
      routes,
      bestRoute: routes[0] ?? null,
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Wraps a getQuote result into a full IntentPayload.
   * authorization.astryumRelays: false — always.
   */
  async prepareIntent(params: LiFiQuoteParams): Promise<IntentPayload> {
    const quote = await this.getQuote(params);
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
        protocol: `lifi:${quote.tool}`,
        description:
          `Li.Fi ${isBridge ? 'bridge' : 'swap'} via ${quote.tool}. ` +
          `Fee: ${(this.feeBps / 100).toFixed(2)}%`,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },

      referralAttribution: {
        referralWallet: this.feeWallet,
        attributionBps: this.feeBps,
        disclosedToUser: true,
        disclosureText:
          `Astryum fee: ${(this.feeBps / 100).toFixed(2)}% → ${this.feeWallet.slice(0, 8) || 'ASTRYUM_FEE_WALLET'}… ` +
          '(embedded via Li.Fi integrator mechanism)',
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

export const liFiProvider = new LiFiProvider();

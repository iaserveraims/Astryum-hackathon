/**
 * MoonPayTradeProvider — FASE 8 (P18, V1.5)
 *
 * Wraps MoonPay Trade API — B2B execution engine for DeFi protocol access.
 * DISTINCT from the MoonPay on-ramp (fiat → crypto) already in partners.ts.
 *
 * MoonPay Trade provides programmatic access to:
 *   - Aave v3 supply/borrow/repay across 10+ chains
 *   - Morpho vaults (Blue + Optimizers)
 *   - Uniswap v3 LP management
 *   - Stablecoin AMMs (Curve, Balancer stable pools)
 *   - Yield vaults and strategies
 * All via a unified quote + unsigned-calldata API on 200+ chains.
 *
 * Revenue model:
 *   - MOONPAY_TRADE_FEE_BPS (default 20 = 0.20%) embedded per B2B agreement.
 *   - Fee routed to ASTRYUM_FEE_WALLET per MoonPay Trade partner terms.
 *   - disclosedToUser: true — always shown before user signs.
 *
 * Requirements:
 *   - MOONPAY_TRADE_API_KEY: B2B partner key (request at moonpay.com/business)
 *   - MOONPAY_TRADE_ENABLED=true: explicit gate after B2B agreement is signed
 *   Both must be set — provider stays disabled (returns 503) otherwise.
 *
 * Regulatory invariants (never remove):
 *   authorization.astryumRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never holds funds — returns unsigned calldata only.
 *   MoonPay Trade executes on behalf of the user after their on-device signature.
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

const MOONPAY_TRADE_API_BASE = 'https://api.moonpay.com/v1/trade';
const DEFAULT_FEE_BPS = 20;   // 0.20%

export type MoonPayTradeProtocol = 'aave_v3' | 'morpho_blue' | 'morpho_optimizer' | 'uniswap_v3' | 'curve' | 'balancer';
export type MoonPayTradeAction = 'supply' | 'borrow' | 'repay' | 'withdraw' | 'stake' | 'unstake' | 'add_liquidity' | 'remove_liquidity';

export interface MoonPayTradeQuoteParams {
  protocol: MoonPayTradeProtocol;
  action: MoonPayTradeAction;
  chainId: number;
  fromToken: string;         // token address
  fromAmount: string;        // amount in smallest unit (wei)
  toToken?: string;          // for swaps/liquidity provision
  walletAddress: string;     // user's wallet
  slippageBps?: number;      // default 50 (0.5%)
  marketId?: string;         // Morpho market ID or Aave reserve address
}

export interface MoonPayTradeQuoteResult {
  quoteId: string;
  protocol: MoonPayTradeProtocol;
  action: MoonPayTradeAction;
  chainId: number;
  fromToken: string;
  fromAmount: string;
  toToken: string | null;
  toAmount: string | null;
  estimatedApy?: number;      // APY for supply/stake actions (decimal, e.g. 0.045 = 4.5%)
  gasCostUSD: string;
  priceImpactBps: number | null;
  validUntil: string;        // ISO timestamp
  fee: {
    bps: number;
    recipientWallet: string;
    disclosed: true;
  };
  tx: {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  };
  source: { providerId: string; fetchedAt: string };
}

export interface MoonPayTradePrepareParams extends MoonPayTradeQuoteParams {
  quoteId?: string;         // reuse an existing quote to avoid double API call
}

export class MoonPayTradeProvider implements IProvider {
  readonly id = 'moonpay-trade';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 74;

  readonly capabilities: ReadonlyArray<Capability> = [
    'defi.getQuote',
    'defi.prepareExecution',
  ];

  private get apiKey(): string {
    return process.env.MOONPAY_TRADE_API_KEY ?? '';
  }

  private get enabled(): boolean {
    return !!(this.apiKey && process.env.MOONPAY_TRADE_ENABLED === 'true');
  }

  private get feeBps(): number {
    const raw = parseInt(process.env.MOONPAY_TRADE_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }

  private get feeWallet(): string {
    return process.env.ASTRYUM_FEE_WALLET ?? '';
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error(
        'MoonPayTradeProvider: not enabled. ' +
        'Requires MOONPAY_TRADE_API_KEY and MOONPAY_TRADE_ENABLED=true. ' +
        'B2B agreement with MoonPay is required — contact moonpay.com/business.',
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Api-Key ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  supportsChain(_chainId: number): boolean {
    // MoonPay Trade supports 200+ chains; no hard exclusion list at provider level.
    // Chain support is validated by the MoonPay API per protocol.
    return this.enabled;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.enabled) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'MOONPAY_TRADE_API_KEY or MOONPAY_TRADE_ENABLED not set. B2B agreement required.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${MOONPAY_TRADE_API_BASE}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
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
      case 'defi.getQuote':
        data = await this.getQuote(inp as unknown as MoonPayTradeQuoteParams);
        break;
      case 'defi.prepareExecution':
        data = await this.prepareExecution(inp as unknown as MoonPayTradePrepareParams);
        break;
      default:
        throw new Error(`MoonPayTradeProvider: unsupported capability '${capability}'`);
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
   * POST /v1/trade/quote — returns a DeFi action quote with unsigned calldata.
   * Covers Aave, Morpho, Uniswap v3, Curve, Balancer across 200+ chains.
   * Astryum never signs — returns calldata for user review and signature.
   */
  async getQuote(params: MoonPayTradeQuoteParams): Promise<MoonPayTradeQuoteResult> {
    this.assertEnabled();

    const body = {
      protocol: params.protocol,
      action: params.action,
      chainId: params.chainId,
      fromToken: params.fromToken,
      fromAmount: params.fromAmount,
      toToken: params.toToken,
      walletAddress: params.walletAddress,
      slippageBps: params.slippageBps ?? 50,
      marketId: params.marketId,
      feeBps: this.feeBps,
      feeRecipient: this.feeWallet,
      integratorId: 'astryum',
    };

    const res = await fetch(`${MOONPAY_TRADE_API_BASE}/quote`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`MoonPay Trade /quote HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;

    return {
      quoteId: data.quoteId ?? randomUUID(),
      protocol: params.protocol,
      action: params.action,
      chainId: params.chainId,
      fromToken: params.fromToken,
      fromAmount: data.fromAmount ?? params.fromAmount,
      toToken: data.toToken ?? params.toToken ?? null,
      toAmount: data.toAmount ?? null,
      estimatedApy: data.estimatedApy,
      gasCostUSD: data.gasCostUSD ?? '0',
      priceImpactBps: data.priceImpactBps ?? null,
      validUntil: data.validUntil ?? new Date(Date.now() + 300_000).toISOString(),
      fee: {
        bps: this.feeBps,
        recipientWallet: this.feeWallet,
        disclosed: true,
      },
      tx: {
        to: data.tx?.to ?? '',
        data: data.tx?.data ?? '0x',
        value: data.tx?.value ?? '0',
        gasLimit: String(data.tx?.gasLimit ?? '400000'),
        chainId: params.chainId,
      },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * POST /v1/trade/prepare — identical to getQuote but signals "ready to sign".
   * Wraps the result into a full IntentPayload with all regulatory fields.
   */
  async prepareExecution(params: MoonPayTradePrepareParams): Promise<IntentPayload> {
    this.assertEnabled();

    const quote = params.quoteId
      ? await this.getQuoteById(params.quoteId, params.chainId)
      : await this.getQuote(params);

    const expiresAt = new Date(Date.now() + 300_000);

    const actionLabel: Record<MoonPayTradeAction, string> = {
      supply:           'supply',
      borrow:           'borrow',
      repay:            'repay',
      withdraw:         'withdraw',
      stake:            'stake',
      unstake:          'unstake',
      add_liquidity:    'add liquidity',
      remove_liquidity: 'remove liquidity',
    };

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        to: quote.tx.to,
        data: quote.tx.data,
        value: quote.tx.value,
        gasLimit: quote.tx.gasLimit,
        chainId: params.chainId,
      },

      metadata: {
        action: params.action,
        protocol: `moonpay-trade:${params.protocol}`,
        description:
          `MoonPay Trade ${actionLabel[params.action]} via ${params.protocol}. ` +
          (quote.estimatedApy != null ? `Est. APY: ${(quote.estimatedApy * 100).toFixed(2)}%. ` : '') +
          `Fee: ${(this.feeBps / 100).toFixed(2)}%.`,
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
          '(embedded via MoonPay Trade B2B partner agreement)',
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

  private async getQuoteById(quoteId: string, chainId: number): Promise<MoonPayTradeQuoteResult> {
    const res = await fetch(`${MOONPAY_TRADE_API_BASE}/quote/${quoteId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`MoonPay Trade /quote/${quoteId} HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as any;
    return {
      quoteId,
      protocol: data.protocol,
      action: data.action,
      chainId,
      fromToken: data.fromToken,
      fromAmount: data.fromAmount,
      toToken: data.toToken ?? null,
      toAmount: data.toAmount ?? null,
      estimatedApy: data.estimatedApy,
      gasCostUSD: data.gasCostUSD ?? '0',
      priceImpactBps: data.priceImpactBps ?? null,
      validUntil: data.validUntil ?? new Date(Date.now() + 300_000).toISOString(),
      fee: { bps: this.feeBps, recipientWallet: this.feeWallet, disclosed: true },
      tx: {
        to: data.tx?.to ?? '',
        data: data.tx?.data ?? '0x',
        value: data.tx?.value ?? '0',
        gasLimit: String(data.tx?.gasLimit ?? '400000'),
        chainId,
      },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }
}

export const moonPayTradeProvider = new MoonPayTradeProvider();

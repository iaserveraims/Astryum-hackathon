/**
 * EnsoProvider — P13 (Path A canónico)
 *
 * Wraps the Enso Finance API to build unsigned calldata for single DeFi actions
 * (route) and multi-step atomic bundles (supply + borrow + LP in one tx).
 *
 * Revenue model:
 *   - ENSO_FEE_BPS (default 15 = 0.15%) embedded in every route/bundle request.
 *   - Fee goes directly to ASTRYUM_FEE_WALLET on-chain — Astryum never holds funds.
 *   - disclosedToUser: true — always disclosed before user signs.
 *
 * Regulatory invariants (never remove):
 *   authorization.astryumRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never calls sendTransaction / broadcastTransaction
 *
 * Supported chains: 1 (Ethereum), 137 (Polygon), 42161 (Arbitrum), 10 (Optimism),
 *   8453 (Base), 56 (BSC), 43114 (Avalanche), 250 (Fantom).
 * NOT Flare (14) — Flare DeFi uses internal protocol adapters (kinetic, sparkdex, etc.).
 */

import { randomUUID } from 'crypto';
import type { IProvider, ProviderHealth, Capability, ProviderCallContext, ProviderCallResult } from '../../interfaces/IProvider';
import type { IntentPayload } from '../../../types/IntentPayload';

const ENSO_API_BASE = 'https://api.enso.finance/api/v1';

// Chains supported by Enso Finance (excludes Flare 14 — handled by internal adapters)
const ENSO_SUPPORTED_CHAINS = new Set([1, 137, 42161, 10, 8453, 56, 43114, 250]);

const DEFAULT_FEE_BPS = 15; // 0.15%
const PROTOCOLS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface EnsoAction {
  protocol: string;    // e.g. 'aave-v3', 'compound-v3', 'uniswap-v3'
  action: string;      // e.g. 'deposit', 'redeem', 'borrow', 'repay', 'swap'
  tokenIn?: string[];  // input token addresses (deposit/redeem style)
  tokenOut?: string[]; // output token addresses (deposit/redeem style)
  amountIn?: string[]; // amounts in wei (deposit/redeem style)
  // Lending actions (borrow/repay) carry their fields in `args` per Enso's
  // documented schema (docs.enso.build/pages/build/reference/actions):
  //   borrow → { collateral, tokenOut, amountOut, primaryAddress }
  //   repay  → { tokenIn, amountIn, primaryAddress, onBehalfOf }
  args?: Record<string, unknown>;
}

export interface EnsoRouteParams {
  chainId: number;
  fromAddress: string;   // user wallet
  tokenIn: string;       // input token address
  tokenOut: string;      // output token address (protocol position token or asset)
  amountIn: string;      // amount in wei
  slippageBps?: number;  // default 50 = 0.5%
  routingStrategy?: 'delegate' | 'router' | 'ensowallet';
}

export interface EnsoRouteResult {
  tx: { to: string; data: string; value: string; gas: string };
  amountOut: string;
  priceImpact: number | null;
  fee: { bps: number; recipientWallet: string };
  source: { providerId: string; fetchedAt: string };
}

export interface EnsoBundleParams {
  chainId: number;
  fromAddress: string;
  actions: EnsoAction[];
  routingStrategy?: 'delegate' | 'router';
}

export interface EnsoBundleResult {
  tx: { to: string; data: string; value: string; gas: string };
  fee: { bps: number; recipientWallet: string };
  bundleSize: number;
  source: { providerId: string; fetchedAt: string };
}

interface ProtocolsCache {
  protocols: Set<string>;
  fetchedAt: number;
}

export class EnsoProvider implements IProvider {
  readonly id = 'enso';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 80;

  readonly capabilities: ReadonlyArray<Capability> = [
    'defi.getRoute',
    'defi.getBundleCalldata',
    'defi.canHandle',
  ];

  private protocolsCache: ProtocolsCache | null = null;

  private get apiKey(): string { return process.env.ENSO_API_KEY ?? ''; }
  private get feeBps(): number {
    const raw = parseInt(process.env.ENSO_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }
  private get feeWallet(): string { return process.env.ASTRYUM_FEE_WALLET ?? ''; }
  private get referralCode(): string { return process.env.ASTRYUM_ENSO_REFERRAL_CODE ?? ''; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private buildFeeParam(): string {
    if (!this.feeWallet) return '';
    return JSON.stringify([{
      bps: this.feeBps,
      receiver: this.feeWallet,
    }]);
  }

  async health(): Promise<ProviderHealth> {
    if (!this.apiKey) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'ENSO_API_KEY not configured',
      };
    }
    const start = Date.now();
    try {
      const res = await fetch(`${ENSO_API_BASE}/metadata/protocols?chainId=1`, {
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
      case 'defi.getRoute':
        data = await this.getRoute(inp as unknown as EnsoRouteParams);
        break;
      case 'defi.getBundleCalldata':
        data = await this.getBundleCalldata(inp as unknown as EnsoBundleParams);
        break;
      case 'defi.canHandle':
        data = await this.canHandle(
          inp['protocol'] as string,
          inp['chainId'] as number,
          inp['action'] as string,
        );
        break;
      default:
        throw new Error(`EnsoProvider: unsupported capability '${capability}'`);
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
   * Returns true if Enso supports the given (protocol, chainId, action) combination.
   * Flare (14) always returns false — use internal adapters for Flare DeFi.
   */
  async canHandle(protocol: string, chainId: number, _action: string): Promise<boolean> {
    if (!this.apiKey) return false;
    if (!ENSO_SUPPORTED_CHAINS.has(chainId)) return false;
    try {
      const protocols = await this.getSupportedProtocols(chainId);
      return protocols.has(protocol.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * GET /shortcuts/route — single-action route (e.g. swap tokenIn → tokenOut).
   * Returns unsigned tx data. Astryum never signs.
   */
  async getRoute(params: EnsoRouteParams): Promise<EnsoRouteResult> {
    if (!this.apiKey) throw new Error('ENSO_API_KEY not configured');
    if (!ENSO_SUPPORTED_CHAINS.has(params.chainId)) {
      throw new Error(`EnsoProvider: chainId ${params.chainId} not supported (use internal adapters for Flare)`);
    }

    const qs = new URLSearchParams({
      chainId: String(params.chainId),
      fromAddress: params.fromAddress,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      slippage: String(params.slippageBps ?? 50),
      routingStrategy: params.routingStrategy ?? 'router',
    });

    const feeParam = this.buildFeeParam();
    if (feeParam) qs.set('fee', feeParam);
    if (this.referralCode) qs.set('referralCode', this.referralCode);

    const res = await fetch(`${ENSO_API_BASE}/shortcuts/route?${qs.toString()}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Enso /shortcuts/route HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as any;

    return {
      tx: {
        to: body.tx?.to ?? '',
        data: body.tx?.data ?? '0x',
        value: body.tx?.value ?? '0',
        gas: String(body.tx?.gas ?? body.gas ?? '300000'),
      },
      amountOut: String(body.amountOut ?? body.toAmount ?? '0'),
      priceImpact: body.priceImpact ?? null,
      fee: {
        bps: this.feeBps,
        recipientWallet: this.feeWallet,
      },
      source: {
        providerId: this.id,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * POST /shortcuts/bundle — atomic multi-step bundle (supply+borrow+LP in one tx).
   * Returns unsigned tx data. Astryum never signs.
   */
  async getBundleCalldata(params: EnsoBundleParams): Promise<EnsoBundleResult> {
    if (!this.apiKey) throw new Error('ENSO_API_KEY not configured');
    if (!ENSO_SUPPORTED_CHAINS.has(params.chainId)) {
      throw new Error(`EnsoProvider: chainId ${params.chainId} not supported`);
    }
    if (params.actions.length === 0) {
      throw new Error('EnsoProvider: bundle requires at least one action');
    }

    const body: Record<string, unknown> = {
      chainId: params.chainId,
      fromAddress: params.fromAddress,
      routingStrategy: params.routingStrategy ?? 'router',
      actions: params.actions,
    };

    const feeParam = this.buildFeeParam();
    if (feeParam) body['fee'] = JSON.parse(feeParam);
    if (this.referralCode) body['referralCode'] = this.referralCode;

    const res = await fetch(`${ENSO_API_BASE}/shortcuts/bundle`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Enso /shortcuts/bundle HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;

    return {
      tx: {
        to: data.tx?.to ?? '',
        data: data.tx?.data ?? '0x',
        value: data.tx?.value ?? '0',
        gas: String(data.tx?.gas ?? data.gas ?? '500000'),
      },
      fee: {
        bps: this.feeBps,
        recipientWallet: this.feeWallet,
      },
      bundleSize: params.actions.length,
      source: {
        providerId: this.id,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Helper: convert a DefiLlama pool descriptor + user intent into EnsoBundleParams.
   * Example use: resolveIntent({ protocol: 'aave-v3', tokenIn: 'USDC', ... }, userWallet, '1000000000')
   */
  resolveIntent(
    pool: { protocol: string; chainId: number; tokenIn: string; tokenOut: string; action: string },
    userWallet: string,
    amount: string,
  ): EnsoBundleParams {
    return {
      chainId: pool.chainId,
      fromAddress: userWallet,
      actions: [
        {
          protocol: pool.protocol,
          action: pool.action,
          tokenIn: [pool.tokenIn],
          tokenOut: [pool.tokenOut],
          amountIn: [amount],
        },
      ],
    };
  }

  /**
   * Build a borrow/repay bundle using Enso's documented `args` action shape
   * (docs.enso.build/pages/build/reference/actions):
   *   borrow → args:{ collateral, tokenOut, amountOut, primaryAddress }
   *   repay  → args:{ tokenIn, amountIn, primaryAddress, onBehalfOf }
   * `primaryAddress` is the lending pool's interaction contract.
   *
   * Per Enso's published schema. One live smoke-test with ENSO_API_KEY is
   * recommended before prod (the legacy resolveIntent path targets api/v1 with a
   * flatter shape; the safety model means a shape mismatch reverts, never loses
   * funds). Only reached for lending protocols of an UNKNOWN contractKind (the
   * 5 native lending kinds build borrow/repay directly).
   */
  resolveLendingAction(
    action: 'borrow' | 'repay',
    p: {
      protocol: string;
      chainId: number;
      asset: string;
      amount: string;
      primaryAddress: string;
      collateral?: string;
    },
    userWallet: string,
  ): EnsoBundleParams {
    const args: Record<string, unknown> =
      action === 'borrow'
        ? {
            collateral: p.collateral,
            tokenOut: p.asset,
            amountOut: p.amount,
            primaryAddress: p.primaryAddress,
          }
        : {
            tokenIn: p.asset,
            amountIn: p.amount,
            primaryAddress: p.primaryAddress,
            onBehalfOf: userWallet,
          };
    return {
      chainId: p.chainId,
      fromAddress: userWallet,
      actions: [{ protocol: p.protocol, action, args }],
    };
  }

  /**
   * Wraps getBundleCalldata result into a full IntentPayload.
   * authorization.astryumRelays is always false.
   */
  async prepareBundle(params: EnsoBundleParams): Promise<IntentPayload> {
    const bundle = await this.getBundleCalldata(params);
    const expiresAt = new Date(Date.now() + 300_000); // 5 minutes
    const actionSummary = params.actions.map((a) => `${a.action}:${a.protocol}`).join(' + ');

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        to: bundle.tx.to,
        data: bundle.tx.data,
        value: bundle.tx.value,
        gasLimit: bundle.tx.gas,
        chainId: params.chainId,
      },

      metadata: {
        action: params.actions.length === 1 ? params.actions[0].action : 'bundle',
        protocol: 'enso',
        description: `Enso atomic bundle [${actionSummary}]. Fee: ${(this.feeBps / 100).toFixed(2)}%`,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },

      referralAttribution: {
        referralCode: this.referralCode || undefined,
        referralWallet: this.feeWallet,
        attributionBps: this.feeBps,
        disclosedToUser: true,
        disclosureText:
          `Astryum fee: ${(this.feeBps / 100).toFixed(2)}% → ${this.feeWallet.slice(0, 8) || 'ASTRYUM_FEE_WALLET'}… ` +
          '(embedded in Enso calldata, goes directly to Astryum fee wallet)',
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

  /** GET /metadata/protocols — cached 30 minutes. Returns lowercase protocol slugs. */
  private async getSupportedProtocols(chainId: number): Promise<Set<string>> {
    const now = Date.now();
    if (this.protocolsCache && now - this.protocolsCache.fetchedAt < PROTOCOLS_CACHE_TTL_MS) {
      return this.protocolsCache.protocols;
    }

    const res = await fetch(`${ENSO_API_BASE}/metadata/protocols?chainId=${chainId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Enso /metadata/protocols HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    const items: any[] = Array.isArray(data) ? data : (data.protocols ?? data.data ?? []);
    const slugs = new Set(
      items
        .map((p: any) => (p.slug ?? p.id ?? p.name ?? '').toLowerCase())
        .filter(Boolean),
    );

    this.protocolsCache = { protocols: slugs, fetchedAt: now };
    return slugs;
  }
}

export const ensoProvider = new EnsoProvider();

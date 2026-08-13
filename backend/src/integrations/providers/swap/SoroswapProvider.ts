/**
 * SoroswapProvider — Stellar DEX aggregator (ISO 20022 basket, PROD-1c / #3)
 *
 * Wraps the Soroswap API (the first DEX aggregator on Stellar/Soroban) to get
 * swap quotes and build UNSIGNED XDR transactions across SDEX, Soroswap, Aqua
 * and Phoenix. The XDR is signed by the user's Stellar wallet (Freighter/Lobstr);
 * Astryum never signs.
 *
 * This mirrors JupiterSwapProvider (Solana) — same "aggregator returns an
 * unsigned tx, the native wallet signs" pattern that lets Astryum execute DeFi
 * on a non-EVM chain without ever holding keys or broadcasting.
 *
 * Contract (Soroswap SDK, github.com/soroswap/sdk):
 *   quote({ assetIn, assetOut, amount, tradeType, protocols, slippageBps, maxHops, feeBps })
 *   build({ quote, from, to, referralId }) → { xdr }
 *   base: https://api.soroswap.finance · apiKey starts with `sk_`
 *
 * ⚠️ The exact REST paths (`/quote`, `/build`) and auth header are inferred from
 * the SDK and should be confirmed against api.soroswap.finance/docs (Postman) on
 * first live smoke-test. Astryum never broadcasts and the user signs in their
 * wallet, so a contract mismatch fails the API call / reverts — never loses funds.
 *
 * Revenue model:
 *   - SOROSWAP_FEE_BPS (default 30 = 0.30%) sent as `feeBps` in every quote.
 *   - `referralId` = ASTRYUM_FEE_WALLET (Stellar address) on build.
 *   - disclosedToUser: true — always disclosed before the user signs.
 *
 * Regulatory invariants (never remove):
 *   astryumRelays: false · Astryum never calls sign / submit · fee disclosed.
 *
 * Chain: Stellar (pseudo chainId 1500001). NOT EVM.
 */

import type {
  IProvider,
  ProviderHealth,
  Capability,
  ProviderCallContext,
  ProviderCallResult,
} from '../../interfaces/IProvider';

const SOROSWAP_API_BASE = process.env.SOROSWAP_API_URL ?? 'https://api.soroswap.finance';
const DEFAULT_FEE_BPS = 30; // 0.30%
const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
const DEFAULT_PROTOCOLS = ['sdex', 'soroswap', 'aqua'] as const;

export interface SoroswapQuoteParams {
  assetIn: string;       // Stellar/Soroban asset contract id (C…)
  assetOut: string;
  amount: string;        // smallest unit (stroops for XLM) as decimal string
  tradeType?: 'EXACT_IN' | 'EXACT_OUT';
  protocols?: string[];  // default: SDEX + Soroswap + Aqua
  slippageBps?: number;  // default 50 = 0.5%
  maxHops?: number;
}

export interface SoroswapQuoteResult {
  assetIn: string;
  assetOut: string;
  amountIn: string;
  amountOut: string;
  tradeType: 'EXACT_IN' | 'EXACT_OUT';
  protocols: string[];
  priceImpactPct: string | null;
  fee: { bps: number; referralId: string };
  source: { providerId: string; fetchedAt: string };
  /** Raw quote — passed back verbatim to build(). */
  _rawQuote: unknown;
}

export interface SoroswapBuildParams {
  quote: SoroswapQuoteResult;
  /** Stellar wallet address of the signer (G…). */
  from: string;
  /** Recipient (defaults to `from`). */
  to?: string;
}

export interface SoroswapBuildResult {
  /** Unsigned Stellar transaction envelope (base64 XDR). User signs in wallet. */
  xdr: string;
  fee: { bps: number; referralId: string; disclosed: true };
  source: { providerId: string; fetchedAt: string };
}

export class SoroswapProvider implements IProvider {
  readonly id = 'soroswap';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 85;

  readonly capabilities: ReadonlyArray<Capability> = ['swap.getQuote', 'swap.prepareSwap'];

  private get apiKey(): string {
    return process.env.SOROSWAP_API_KEY ?? '';
  }
  private get feeBps(): number {
    const raw = parseInt(process.env.SOROSWAP_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }
  /** Stellar address that receives the integrator fee (referralId). */
  private get referralId(): string {
    return process.env.SOROSWAP_FEE_WALLET ?? process.env.ASTRYUM_FEE_WALLET ?? '';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    // SDK config field is `apiKey` (sk_…). Header inferred — confirm on smoke-test.
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async health(): Promise<ProviderHealth> {
    // Soroswap quote requires real assets + a key; we report presence-based
    // health (no keyless ping endpoint). Disabled until SOROSWAP_API_KEY is set.
    if (!this.apiKey) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'SOROSWAP_API_KEY not configured',
      };
    }
    return { status: 'healthy', lastCheckAt: new Date().toISOString() };
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
        data = await this.getQuote(inp as unknown as SoroswapQuoteParams);
        break;
      case 'swap.prepareSwap':
        data = await this.prepareSwap(inp as unknown as SoroswapBuildParams);
        break;
      default:
        throw new Error(`SoroswapProvider: unsupported capability '${capability}'`);
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
   * POST /quote — optimal route across SDEX/Soroswap/Aqua with fee embedded.
   */
  async getQuote(params: SoroswapQuoteParams): Promise<SoroswapQuoteResult> {
    if (!this.apiKey) throw new Error('SOROSWAP_API_KEY not configured');

    const tradeType = params.tradeType ?? 'EXACT_IN';
    const protocols = params.protocols ?? [...DEFAULT_PROTOCOLS];
    const body: Record<string, unknown> = {
      assetIn: params.assetIn,
      assetOut: params.assetOut,
      amount: params.amount,
      tradeType,
      protocols,
      slippageBps: String(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
      feeBps: this.feeBps,
    };
    if (params.maxHops) body['maxHops'] = params.maxHops;

    const res = await fetch(`${SOROSWAP_API_BASE}/quote`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Soroswap /quote HTTP ${res.status}: ${text}`);
    }

    const q = (await res.json()) as any;

    return {
      assetIn: q.assetIn ?? params.assetIn,
      assetOut: q.assetOut ?? params.assetOut,
      amountIn: String(q.amountIn ?? params.amount),
      amountOut: String(q.amountOut ?? '0'),
      tradeType,
      protocols,
      priceImpactPct: q.priceImpactPct ?? null,
      fee: { bps: this.feeBps, referralId: this.referralId },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
      _rawQuote: q,
    };
  }

  /**
   * POST /build — builds the UNSIGNED Stellar transaction (base64 XDR) from a
   * quote. The user signs the XDR in their Stellar wallet. Astryum never signs.
   */
  async prepareSwap(params: SoroswapBuildParams): Promise<SoroswapBuildResult> {
    if (!this.apiKey) throw new Error('SOROSWAP_API_KEY not configured');
    if (!params.quote?._rawQuote) {
      throw new Error('SoroswapProvider: prepareSwap requires a valid quote from getQuote()');
    }

    const body: Record<string, unknown> = {
      quote: params.quote._rawQuote,
      from: params.from,
      to: params.to ?? params.from,
    };
    if (this.referralId) body['referralId'] = this.referralId;

    const res = await fetch(`${SOROSWAP_API_BASE}/build`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Soroswap /build HTTP ${res.status}: ${text}`);
    }

    const b = (await res.json()) as any;
    const xdr = b.xdr ?? b.transaction ?? '';
    if (!xdr || typeof xdr !== 'string') {
      throw new Error('SOROSWAP_EMPTY_XDR');
    }

    return {
      xdr,
      fee: { bps: this.feeBps, referralId: this.referralId, disclosed: true },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }
}

export const soroswapProvider = new SoroswapProvider();

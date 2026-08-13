/**
 * JupiterSwapProvider — P14
 *
 * Wraps the Jupiter Aggregation API v6 to get Solana swap quotes and
 * build unsigned serialized transactions.
 *
 * Revenue model:
 *   - JUPITER_FEE_BPS (default 20 = 0.20%) passed as platformFeeBps in every quote.
 *   - Jupiter embeds the fee; at swap time it goes to JUPITER_FEE_ACCOUNT
 *     (Solana token account — set JUPITER_FEE_ACCOUNT env var, e.g. a Astryum-owned ATA).
 *   - disclosedToUser: true — always disclosed before user signs.
 *
 * Regulatory invariants (never remove):
 *   authorization.astryumRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never calls sendTransaction / signTransaction
 *
 * Chain: Solana mainnet only. NOT EVM. Use internal adapters for Flare (chainId 14),
 * 1inch/Enso for EVM swaps, Li.Fi for cross-chain bridges.
 */

import { randomUUID } from 'crypto';
import type { IProvider, ProviderHealth, Capability, ProviderCallContext, ProviderCallResult } from '../../interfaces/IProvider';

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const DEFAULT_FEE_BPS = 20; // 0.20%
const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%

export interface JupiterQuoteParams {
  inputMint: string;      // Solana token mint address (base58)
  outputMint: string;     // Solana token mint address (base58)
  amount: string;         // input amount in smallest unit (lamports or token units)
  slippageBps?: number;   // default 50 = 0.5%
  maxAccounts?: number;   // optional; Jupiter default is fine
}

export interface JupiterQuoteResult {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;  // minimum out after slippage
  slippageBps: number;
  priceImpactPct: string;
  platformFee: {
    amount: string;
    feeBps: number;
    recipientAccount: string;   // JUPITER_FEE_ACCOUNT
  };
  routePlan: unknown[];
  contextSlot: number;
  source: { providerId: string; fetchedAt: string };
  // Raw quote stored for use in prepareSwap
  _rawQuote: unknown;
}

export interface JupiterSwapParams {
  quote: JupiterQuoteResult;    // result of getQuote()
  userPublicKey: string;         // Solana wallet address (base58)
  wrapAndUnwrapSol?: boolean;   // default true
}

export interface JupiterSwapResult {
  swapTransaction: string;       // base64 serialized unsigned Solana transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  fee: {
    bps: number;
    recipientAccount: string;
    disclosed: true;
  };
  source: { providerId: string; fetchedAt: string };
}

export class JupiterSwapProvider implements IProvider {
  readonly id = 'jupiter';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 85;

  readonly capabilities: ReadonlyArray<Capability> = [
    'swap.getQuote',
    'swap.prepareSwap',
  ];

  private get feeBps(): number {
    const raw = parseInt(process.env.JUPITER_FEE_BPS ?? String(DEFAULT_FEE_BPS), 10);
    return isNaN(raw) ? DEFAULT_FEE_BPS : raw;
  }

  private get feeAccount(): string {
    return process.env.JUPITER_FEE_ACCOUNT ?? process.env.ASTRYUM_FEE_WALLET ?? '';
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Lightweight price check on SOL/USDC — always public, no key required
      const res = await fetch(
        `${JUPITER_API_BASE}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50`,
        { signal: AbortSignal.timeout(5000) },
      );
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
        data = await this.getQuote(inp as unknown as JupiterQuoteParams);
        break;
      case 'swap.prepareSwap':
        data = await this.prepareSwap(inp as unknown as JupiterSwapParams);
        break;
      default:
        throw new Error(`JupiterSwapProvider: unsupported capability '${capability}'`);
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
   * GET /quote — returns a swap quote with platform fee embedded.
   * No API key required. Jupiter is permissionless.
   */
  async getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
      platformFeeBps: String(this.feeBps),
    });
    if (params.maxAccounts) qs.set('maxAccounts', String(params.maxAccounts));

    const res = await fetch(`${JUPITER_API_BASE}/quote?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Jupiter /quote HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as any;

    return {
      inputMint: body.inputMint ?? params.inputMint,
      inAmount: body.inAmount ?? params.amount,
      outputMint: body.outputMint ?? params.outputMint,
      outAmount: body.outAmount ?? '0',
      otherAmountThreshold: body.otherAmountThreshold ?? '0',
      slippageBps: body.slippageBps ?? (params.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
      priceImpactPct: body.priceImpactPct ?? '0',
      platformFee: {
        amount: body.platformFee?.amount ?? '0',
        feeBps: this.feeBps,
        recipientAccount: this.feeAccount,
      },
      routePlan: body.routePlan ?? [],
      contextSlot: body.contextSlot ?? 0,
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
      _rawQuote: body,
    };
  }

  /**
   * POST /swap — serializes an unsigned Solana transaction from a quote.
   * The returned base64 transaction must be signed by the user's Solana wallet.
   * Astryum never signs.
   */
  async prepareSwap(params: JupiterSwapParams): Promise<JupiterSwapResult> {
    if (!params.quote._rawQuote) {
      throw new Error('JupiterSwapProvider: prepareSwap requires a valid quote from getQuote()');
    }

    const body: Record<string, unknown> = {
      quoteResponse: params.quote._rawQuote,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    };

    if (this.feeAccount) {
      body['feeAccount'] = this.feeAccount;
    }

    const res = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Jupiter /swap HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;

    return {
      swapTransaction: data.swapTransaction ?? '',
      lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
      prioritizationFeeLamports: data.prioritizationFeeLamports ?? 0,
      fee: {
        bps: this.feeBps,
        recipientAccount: this.feeAccount,
        disclosed: true,
      },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Wraps prepareSwap result into a minimal intent-compatible payload.
   * The swapTransaction (base64) is placed in tx.data for the Solana wallet to sign.
   * authorization.astryumRelays: false — always.
   */
  buildIntentPayload(
    swap: JupiterSwapResult,
    quote: JupiterQuoteResult,
    userPublicKey: string,
  ): {
    intentId: string;
    status: 'pending_user_review';
    tx: { data: string; chainKey: 'solana:mainnet'; lastValidBlockHeight: number };
    referralAttribution: { bps: number; account: string; disclosedToUser: true };
    authorization: { astryumRelays: false; userMustAuthorize: true };
    metadata: { inputMint: string; outputMint: string; inAmount: string; outAmount: string; preparedBy: 'astryum' };
    expiry: { expiresAt: string; ttlSeconds: number };
  } {
    return {
      intentId: randomUUID(),
      status: 'pending_user_review',
      tx: {
        data: swap.swapTransaction,
        chainKey: 'solana:mainnet',
        lastValidBlockHeight: swap.lastValidBlockHeight,
      },
      referralAttribution: {
        bps: this.feeBps,
        account: this.feeAccount,
        disclosedToUser: true,
      },
      authorization: {
        astryumRelays: false,
        userMustAuthorize: true,
      },
      metadata: {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        preparedBy: 'astryum',
      },
      expiry: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(), // 60s — Solana block validity window
        ttlSeconds: 60,
      },
    };
  }
}

export const jupiterSwapProvider = new JupiterSwapProvider();

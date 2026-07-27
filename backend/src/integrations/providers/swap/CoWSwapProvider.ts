/**
 * CoWSwapProvider — FASE 8 (P18, V2)
 *
 * Wraps CoW Protocol (Coincidence of Wants) batch auction for MEV-protected swaps.
 * CoW's solver network competes to fill orders off-chain, settling in batches.
 * Users receive surplus (price improvement) instead of being MEV-extracted.
 *
 * Authorization flow — different from standard eth_sendTransaction providers:
 *   1. Astryum calls /quote → returns unsigned CoW order struct
 *   2. User approves sell token to GPv2VaultRelayer (eth_sendTransaction — this is the IntentPayload.tx)
 *   3. User signs the order via EIP-712 (wallet_signTypedData — frontend handles separately)
 *   4. Frontend POSTs {order, signature} to CoW API → solver network fills the order
 *
 * The IntentPayload.tx represents the ERC-20 approval step (2).
 * The EIP-712 signing data is included in metadata.cowOrder for frontend use.
 * For native ETH: no approval needed — GPv2Settlement wraps ETH internally.
 *
 * Revenue model:
 *   - No explicit fee BPS — CoW's referral program shares solver surplus with Astryum.
 *   - appData encodes Astryum referral info (DEFIBRO_COW_APP_CODE).
 *   - Surplus is distributed by CoW's settlement contract post-batch.
 *
 * Regulatory invariants (never remove):
 *   authorization.defibroRelays: false
 *   referralAttribution.disclosedToUser: true
 *   Astryum never calls sendTransaction on the CoW order — only on the ERC-20 approval
 *
 * Supported chains: Ethereum (1), Gnosis (100), Arbitrum (42161), Base (8453).
 * NOT Flare (14). No API key required.
 */

import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import type {
  IProvider,
  ProviderHealth,
  Capability,
  ProviderCallContext,
  ProviderCallResult,
} from '../../interfaces/IProvider';
import type { IntentPayload } from '../../../types/IntentPayload';

// CoW Protocol contract addresses — same on all supported chains (CREATE2 deployment)
const GPV2_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';
const GPV2_SETTLEMENT   = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

// Native token sentinel (CoW convention)
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const COW_API_BASES: Record<number, string> = {
  1:     'https://api.cow.fi/mainnet',
  100:   'https://api.cow.fi/xdai',
  42161: 'https://api.cow.fi/arbitrum_one',
  8453:  'https://api.cow.fi/base',
};

const COW_SUPPORTED_CHAINS = new Set(Object.keys(COW_API_BASES).map(Number));

// Minimal ERC-20 approve ABI
const ERC20_APPROVE_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export interface CoWQuoteParams {
  sellToken: string;          // token address (NATIVE_TOKEN for ETH)
  buyToken: string;           // token address
  sellAmountBeforeFee: string; // amount in smallest unit (wei)
  from: string;               // user wallet address
  receiver?: string;          // recipient (defaults to from)
  chainId: number;            // must be in COW_SUPPORTED_CHAINS
  slippageBps?: number;       // slippage tolerance in basis points (default 50 = 0.5%)
  validForSeconds?: number;   // order validity window in seconds (default 1800)
}

export interface CoWOrderStruct {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;           // unix timestamp
  appData: string;           // keccak256 of appData JSON (bytes32 hex)
  feeAmount: string;
  kind: 'sell' | 'buy';
  partiallyFillable: boolean;
  sellTokenBalance: 'erc20' | 'external' | 'internal';
  buyTokenBalance: 'erc20' | 'internal';
  signingScheme: 'eip712' | 'ethsign' | 'presign' | 'erc1271';
}

export interface CoWQuoteResult {
  quoteId: number;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;       // after fee deduction
  buyAmount: string;
  feeAmount: string;
  validTo: number;
  priceImpactBps: number | null;
  appData: string;          // bytes32 hex — encode referral
  order: CoWOrderStruct;    // full unsigned order for EIP-712 signing
  settlementContract: string;
  vaultRelayer: string;
  approvalNeeded: boolean;  // false for native ETH
  fee: {
    model: 'surplus_sharing';
    appCode: string;
    disclosed: true;
    disclosureText: string;
  };
  source: { providerId: string; fetchedAt: string };
}

export class CoWSwapProvider implements IProvider {
  readonly id = 'cowswap';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 77;

  readonly capabilities: ReadonlyArray<Capability> = [
    'swap.getQuote',
    'swap.prepareSwap',
  ];

  private get appCode(): string {
    return process.env.DEFIBRO_COW_APP_CODE ?? 'Astryum';
  }

  private get feeWallet(): string {
    return process.env.DEFIBRO_FEE_WALLET ?? '';
  }

  private apiBase(chainId: number): string {
    const base = COW_API_BASES[chainId];
    if (!base) throw new Error(`CoWSwapProvider: chain ${chainId} not supported`);
    return base;
  }

  supportsChain(chainId: number): boolean {
    return COW_SUPPORTED_CHAINS.has(chainId);
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Ping Ethereum mainnet endpoint (always available for health check)
      const res = await fetch(`${COW_API_BASES[1]}/api/v1/version`, {
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
      case 'swap.getQuote':
      case 'swap.prepareSwap':
        data = await this.getQuote(inp as unknown as CoWQuoteParams);
        break;
      default:
        throw new Error(`CoWSwapProvider: unsupported capability '${capability}'`);
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
   * POST /api/v1/quote — returns unsigned CoW order struct.
   * The order must be signed by the user via EIP-712 (wallet_signTypedData).
   * Astryum never signs — prepares the order for user authorization.
   */
  async getQuote(params: CoWQuoteParams): Promise<CoWQuoteResult> {
    if (!this.supportsChain(params.chainId)) {
      throw new Error(
        `CoWSwapProvider: chainId ${params.chainId} not supported.` +
        (params.chainId === 14 ? ' Use internal protocol adapters for Flare.' : ''),
      );
    }

    const validFor = params.validForSeconds ?? 1800;
    const validTo = Math.floor(Date.now() / 1000) + validFor;
    const isNativeSell = params.sellToken.toLowerCase() === NATIVE_TOKEN.toLowerCase();

    // Minimal appData encoding — encodes Astryum referral
    const appDataContent = {
      version: '1.1.0',
      appCode: this.appCode,
      metadata: {
        referrer: {
          address: this.feeWallet || undefined,
        },
      },
    };
    const appDataJson = JSON.stringify(appDataContent);
    const appDataHash = ethers.keccak256(ethers.toUtf8Bytes(appDataJson));

    const body = {
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      sellAmountBeforeFee: params.sellAmountBeforeFee,
      from: params.from,
      receiver: params.receiver ?? params.from,
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: isNativeSell ? 'erc20' : 'erc20',
      buyTokenBalance: 'erc20',
      appData: appDataJson,
      appDataHash,
      signingScheme: 'eip712',
      validTo,
    };

    const res = await fetch(`${this.apiBase(params.chainId)}/api/v1/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`CoW /quote HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const q = data.quote ?? {};

    const order: CoWOrderStruct = {
      sellToken: q.sellToken ?? params.sellToken,
      buyToken: q.buyToken ?? params.buyToken,
      receiver: q.receiver ?? params.from,
      sellAmount: q.sellAmount ?? '0',
      buyAmount: q.buyAmount ?? '0',
      validTo: q.validTo ?? validTo,
      appData: appDataHash,
      feeAmount: q.feeAmount ?? '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: 'eip712',
    };

    return {
      quoteId: data.id ?? 0,
      chainId: params.chainId,
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      feeAmount: order.feeAmount,
      validTo: order.validTo,
      priceImpactBps: null, // CoW does not expose price impact directly
      appData: appDataHash,
      order,
      settlementContract: GPV2_SETTLEMENT,
      vaultRelayer: GPV2_VAULT_RELAYER,
      approvalNeeded: !isNativeSell,
      fee: {
        model: 'surplus_sharing',
        appCode: this.appCode,
        disclosed: true,
        disclosureText:
          `CoW Protocol surplus sharing via appCode '${this.appCode}'. ` +
          'Astryum earns a share of solver surplus. No explicit fee deducted from swap.',
      },
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Wraps a CoW quote into an IntentPayload.
   * tx = ERC-20 approve(GPv2VaultRelayer, sellAmount) — the only eth_sendTransaction in the flow.
   * The EIP-712 order signing is a subsequent step handled by the frontend.
   * For native ETH sells: tx is a no-op stub (approval not needed).
   */
  async prepareIntent(params: CoWQuoteParams): Promise<IntentPayload> {
    const quote = await this.getQuote(params);
    const expiresAt = new Date(Date.now() + 300_000); // 5 minutes

    const isNativeSell = params.sellToken.toLowerCase() === NATIVE_TOKEN.toLowerCase();

    // For ERC-20: approval tx — approve GPv2VaultRelayer to spend sellAmountBeforeFee
    const approvalCalldata = isNativeSell
      ? '0x'
      : ERC20_APPROVE_IFACE.encodeFunctionData('approve', [
          GPV2_VAULT_RELAYER,
          BigInt(params.sellAmountBeforeFee),
        ]);

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        // Approval tx to sell token contract (or stub for native ETH)
        to: isNativeSell ? GPV2_SETTLEMENT : params.sellToken,
        data: approvalCalldata,
        value: isNativeSell ? params.sellAmountBeforeFee : '0',
        gasLimit: isNativeSell ? '50000' : '60000',
        chainId: params.chainId,
      },

      metadata: {
        action: 'swap',
        protocol: 'cowswap',
        description:
          isNativeSell
            ? `CoW MEV-protected swap (step 1/1: ETH sell — no approval needed). ` +
              `Sign the CoW order via EIP-712 to complete.`
            : `CoW MEV-protected swap (step 1/2: approve GPv2VaultRelayer). ` +
              `After approval, sign the CoW order via EIP-712.`,
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        // EIP-712 order data for the frontend to use in wallet_signTypedData
        ...(({ cowOrder: quote.order, cowSettlementContract: GPV2_SETTLEMENT }) as any),
      },

      referralAttribution: {
        referralWallet: this.feeWallet,
        attributionBps: 0,  // surplus-sharing model, not BPS
        disclosedToUser: true,
        disclosureText: quote.fee.disclosureText,
      },

      authorization: {
        mode: 'user_authorized_partner_relay',
        userMustAuthorize: true,
        defibroRelays: false,
        singleUseSession: true,
      },

      policy: {
        evaluatedAt: new Date().toISOString(),
        passed: true,
        warnings: [
          'CoW swap requires two user actions: (1) ERC-20 approval, (2) EIP-712 order signature.',
          'The signed order is submitted to CoW\'s solver network — not broadcast by Astryum.',
        ],
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

export const cowSwapProvider = new CoWSwapProvider();

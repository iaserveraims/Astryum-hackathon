/**
 * YellowStateChannelProvider — FASE 8 (P18, V2+)
 *
 * Wraps Yellow Network's Perun state channel protocol for high-frequency
 * broker-to-broker settlement and streaming micropayments.
 *
 * ─── ARCHITECTURE WARNING — Read before using ───────────────────────────────
 * This provider is architecturally DIFFERENT from all other Astryum providers.
 *
 *   Standard Astryum flow:  eth_sendTransaction (one tx per action)
 *   Yellow state channels:  personal_sign (off-chain state updates, batched)
 *
 * State channels (Perun / ERC-7824):
 *   1. Channel open  → on-chain tx (one-time setup)
 *   2. N payments    → off-chain personal_sign (no gas, near-instant)
 *   3. Channel close → on-chain tx (cooperative or dispute)
 *
 * This means a Yellow "payment" is NOT an eth_sendTransaction. The IntentPayload
 * returned by preparePayment() has tx.data = '0x' (no calldata) and uses the
 * `metadata.yellowStateUpdate` field to carry the off-chain state for signing.
 * The frontend must call personal_sign on the Yellow state struct, then send
 * the signature to Yellow's broker network — NOT broadcast to a node.
 *
 * ─── Valid use cases in Astryum ─────────────────────────────────────────────
 *   - High-frequency settlement between Astryum and a Yellow broker counterpart
 *   - Streaming yield micropayments (e.g. per-block FTSO reward distribution)
 *   - Cases where the Astryum user operates AS a broker in the Yellow network
 *
 * ─── NOT for ─────────────────────────────────────────────────────────────────
 *   - General DeFi swaps → use Li.Fi, Squid, UniswapX, CoW
 *   - Cross-chain bridges → use Li.Fi, Across, Squid
 *   - Single-chain swaps → use 1inch, CoW, UniswapX
 *
 * ─── Requirements ────────────────────────────────────────────────────────────
 *   YELLOW_PERUN_KEY=...        Perun node key (broker registration)
 *   YELLOW_BROKER_MODE=true     Explicit broker mode gate
 *   Both must be set — otherwise every call returns a clear error.
 *   V2+ only — not available in V1.x deployments.
 *
 * ─── Regulatory invariants (never remove) ────────────────────────────────────
 *   authorization.defibroRelays: false  (Astryum never relays channel states)
 *   referralAttribution.disclosedToUser: true
 *   Astryum never custodies channel funds — user's key controls the channel.
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

const YELLOW_API_BASE = 'https://api.yellow.org/v1';

export interface YellowChannelParams {
  participantA: string;   // user EVM address (channel initiator)
  participantB: string;   // counterparty EVM address (Yellow broker or peer)
  chainId: number;        // chain for on-chain adjudicator
  assetToken: string;     // ERC-20 token address (0xEeee… for native)
  depositAmount: string;  // initial deposit in wei (user's side)
}

export interface YellowChannel {
  channelId: string;
  participantA: string;
  participantB: string;
  chainId: number;
  assetToken: string;
  balanceA: string;       // current balance of participant A in wei
  balanceB: string;       // current balance of participant B in wei
  turnNum: number;        // state update counter
  status: 'proposed' | 'open' | 'closing' | 'closed';
  adjudicatorAddress: string; // on-chain contract managing disputes
  openedAt: string | null;    // ISO timestamp, null if not yet on-chain
  source: { providerId: string; fetchedAt: string };
}

export interface YellowPaymentParams {
  channelId: string;
  amount: string;         // payment amount in wei (from A to B)
  memo?: string;          // optional label
}

export interface YellowStateUpdate {
  channelId: string;
  turnNum: number;        // incremented each state change
  balanceA: string;
  balanceB: string;
  isFinal: boolean;
  appData: string;        // '0x' for simple payments
  challengeDuration: number; // seconds before on-chain dispute can be raised
}

export interface YellowPaymentResult {
  channelId: string;
  paymentId: string;
  stateUpdate: YellowStateUpdate;    // unsigned state — sign via personal_sign
  stateHash: string;                 // keccak256 of encoded state — what to sign
  adjudicatorAddress: string;
  source: { providerId: string; fetchedAt: string };
}

export class YellowStateChannelProvider implements IProvider {
  readonly id = 'yellow-state-channel';
  readonly type = 'data' as const;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 30;  // Low priority — niche use case, V2+ only

  readonly capabilities: ReadonlyArray<Capability> = [
    'settlement.createChannel',
    'settlement.preparePayment',
    'settlement.getChannelState',
    'settlement.closeChannel',
  ];

  private get perunKey(): string {
    return process.env.YELLOW_PERUN_KEY ?? '';
  }

  private get brokerMode(): boolean {
    return !!(this.perunKey && process.env.YELLOW_BROKER_MODE === 'true');
  }

  private assertBrokerMode(): void {
    if (!this.brokerMode) {
      throw new Error(
        'YellowStateChannelProvider: broker mode not enabled. ' +
        'Requires YELLOW_PERUN_KEY and YELLOW_BROKER_MODE=true. ' +
        'State channels require broker registration with Yellow Network (V2+ only). ' +
        'For standard DeFi swaps use Li.Fi, Squid, or 1inch instead.',
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      'x-perun-key': this.perunKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  supportsChain(chainId: number): boolean {
    // Yellow Network supports EVM chains where Perun adjudicator is deployed.
    // Primary: ETH (1), Polygon (137), Arbitrum (42161), Optimism (10).
    // Returns false when broker mode is off — channels cannot be opened.
    if (!this.brokerMode) return false;
    return [1, 10, 137, 42161, 8453].includes(chainId);
  }

  async health(): Promise<ProviderHealth> {
    if (!this.brokerMode) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason:
          'YELLOW_PERUN_KEY or YELLOW_BROKER_MODE=true not set. ' +
          'Yellow state channels are V2+ only and require broker registration.',
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${YELLOW_API_BASE}/health`, {
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
      case 'settlement.createChannel':
        data = await this.createChannel(inp as unknown as YellowChannelParams);
        break;
      case 'settlement.preparePayment':
        data = await this.preparePayment(inp as unknown as YellowPaymentParams);
        break;
      case 'settlement.getChannelState':
        data = await this.getChannelState(inp['channelId'] as string);
        break;
      case 'settlement.closeChannel':
        data = await this.closeChannel(inp['channelId'] as string);
        break;
      default:
        throw new Error(`YellowStateChannelProvider: unsupported capability '${capability}'`);
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
   * Open a new Perun state channel between two participants.
   * Returns the on-chain channel opening IntentPayload (eth_sendTransaction to adjudicator).
   * This is the ONLY eth_sendTransaction in the Yellow flow.
   */
  async createChannel(params: YellowChannelParams): Promise<IntentPayload> {
    this.assertBrokerMode();

    const res = await fetch(`${YELLOW_API_BASE}/channels`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Yellow /channels HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const channelId = data.channelId ?? randomUUID();
    const expiresAt = new Date(Date.now() + 300_000);

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        to: data.adjudicatorAddress ?? '',
        data: data.openCalldata ?? '0x',
        value: params.depositAmount,
        gasLimit: String(data.gasLimit ?? '300000'),
        chainId: params.chainId,
      },

      metadata: {
        action: 'stake',   // channel deposit is analogous to a stake/lock
        protocol: `yellow:state-channel:${channelId}`,
        description:
          `Open Yellow state channel between ${params.participantA.slice(0, 8)}… ` +
          `and ${params.participantB.slice(0, 8)}…. ` +
          `Deposit: ${params.depositAmount} wei. ` +
          'Subsequent payments use personal_sign — no gas cost per payment.',
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
      },

      referralAttribution: {
        referralWallet: process.env.DEFIBRO_FEE_WALLET ?? '',
        attributionBps: 0,  // no fee on channel operations
        disclosedToUser: true,
        disclosureText:
          'Yellow state channel operations carry no Astryum fee. ' +
          'Yellow Network charges are defined by your broker agreement.',
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
          'State channel payments use personal_sign, not eth_sendTransaction.',
          'Each payment is an off-chain signature — Astryum never relays state updates.',
          'Closing a channel requires a cooperative on-chain transaction or a dispute period.',
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

  /**
   * Prepare a state channel payment (off-chain).
   * Returns the unsigned state update for personal_sign — NOT an eth_sendTransaction.
   * The signed state update is sent to Yellow's broker network, not to a node.
   */
  async preparePayment(params: YellowPaymentParams): Promise<YellowPaymentResult> {
    this.assertBrokerMode();

    const res = await fetch(`${YELLOW_API_BASE}/channels/${params.channelId}/payments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ amount: params.amount, memo: params.memo }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Yellow /payments HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;

    return {
      channelId: params.channelId,
      paymentId: data.paymentId ?? randomUUID(),
      stateUpdate: {
        channelId: params.channelId,
        turnNum: data.turnNum ?? 0,
        balanceA: data.balanceA ?? '0',
        balanceB: data.balanceB ?? '0',
        isFinal: false,
        appData: '0x',
        challengeDuration: data.challengeDuration ?? 86400,
      },
      stateHash: data.stateHash ?? '0x',
      adjudicatorAddress: data.adjudicatorAddress ?? '',
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Query current state of an open channel.
   */
  async getChannelState(channelId: string): Promise<YellowChannel> {
    this.assertBrokerMode();

    const res = await fetch(`${YELLOW_API_BASE}/channels/${channelId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Yellow /channels/${channelId} HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;

    return {
      channelId,
      participantA: data.participantA ?? '',
      participantB: data.participantB ?? '',
      chainId: data.chainId ?? 1,
      assetToken: data.assetToken ?? '',
      balanceA: data.balanceA ?? '0',
      balanceB: data.balanceB ?? '0',
      turnNum: data.turnNum ?? 0,
      status: data.status ?? 'open',
      adjudicatorAddress: data.adjudicatorAddress ?? '',
      openedAt: data.openedAt ?? null,
      source: { providerId: this.id, fetchedAt: new Date().toISOString() },
    };
  }

  /**
   * Initiate cooperative channel close.
   * Returns an IntentPayload for the on-chain close transaction.
   * Both parties must sign the final state before this tx can settle.
   */
  async closeChannel(channelId: string): Promise<IntentPayload> {
    this.assertBrokerMode();

    const res = await fetch(`${YELLOW_API_BASE}/channels/${channelId}/close`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new Error(`Yellow /channels/${channelId}/close HTTP ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const expiresAt = new Date(Date.now() + 300_000);

    return {
      intentId: randomUUID(),
      status: 'pending_user_review',

      tx: {
        to: data.adjudicatorAddress ?? '',
        data: data.closeCalldata ?? '0x',
        value: '0',
        gasLimit: String(data.gasLimit ?? '200000'),
        chainId: data.chainId ?? 1,
      },

      metadata: {
        action: 'unstake',
        protocol: `yellow:state-channel:${channelId}`,
        description:
          `Cooperative close of Yellow state channel ${channelId.slice(0, 12)}…. ` +
          'Final on-chain settlement — funds returned to participants.',
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
      },

      referralAttribution: {
        referralWallet: process.env.DEFIBRO_FEE_WALLET ?? '',
        attributionBps: 0,
        disclosedToUser: true,
        disclosureText: 'No Astryum fee on channel close operations.',
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
          'Cooperative close requires counterparty signature on final state.',
          'If counterparty is unresponsive, a dispute period applies before funds are released.',
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

export const yellowStateChannelProvider = new YellowStateChannelProvider();

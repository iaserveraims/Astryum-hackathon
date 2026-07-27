import type { ERC7683Extension } from './ERC7683Intent';

export interface IntentPayload {
  intentId: string;
  status: 'pending_user_review' | 'ready_to_authorize';

  tx: {
    to: string;       // contract address — always verified against allowlist before inclusion
    data: string;     // unsigned calldata — Astryum NEVER signs this
    value: string;    // wei as decimal string
    gasLimit: string;
    chainId: number;
    nonce?: number;
  };

  metadata: {
    action: string;
    protocol: string;
    description: string;
    preparedBy: 'defibro';
    preparedAt: string;
    /** Estimated unstake cooldown in days (set for LSTs: Lido ~7, EtherFi ~4, Sceptre ~0) */
    cooldownDays?: number;
    /**
     * Id of the regulated partner this intent routes through.
     * MANDATORY for all V2 intents (2026-06-01 audit Cat 2.1):
     *   "If there is no registered partner for an operation, that
     *    operation does not exist in Astryum."
     */
    partnerId?: string;
  };

  referralAttribution: {
    referralCode?: string | null;
    referralWallet: string | null;    // DEFIBRO_FEE_WALLET, or null when partner refuses referral fee
    attributionBps: number;            // 0 when partner does not permit referral fees
    disclosedToUser: true;             // literal true — always disclosed, never hidden
    disclosureText: string;            // visible to user before authorization
  };

  authorization: {
    mode: 'user_authorized_partner_relay'; // literal — user authorizes, partner relays
    userMustAuthorize: true;               // literal true
    defibroRelays: false;                  // literal false — Astryum NEVER relays
    singleUseSession: true;               // literal true — no session reuse
  };

  policy: {
    evaluatedAt: string;
    passed: boolean;
    blockReason?: string;
    warnings: string[];
  };

  audit: {
    traceId: string;
    sessionId: string;
    intentSource: 'user' | 'automation' | 'ai_copilot';
  };

  expiry: {
    expiresAt: string;  // ISO timestamp — now + 5 minutes
    ttlSeconds: number;
  };

  /**
   * ERC-7683 extension — present when the intent was produced by an ERC-7683
   * compliant solver (Across, UniswapX). Absent for standard single-chain intents.
   * Contains the full solver competition record and the originSettler contract.
   */
  erc7683?: ERC7683Extension;
}

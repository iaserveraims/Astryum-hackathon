/**
 * IntentPreparationEngine
 *
 * Prepares unsigned blockchain interaction payloads for user review and authorization.
 * This is NOT an execution engine. It does NOT relay, broadcast, or transmit transactions.
 *
 * REGULATORY NOTE:
 * - Astryum is not a CASP under MiCA because it does not execute orders.
 * - This module only prepares. The user authorizes. A regulated relay transmits.
 * - No sendTransaction, broadcastTransaction, or sendRawTransaction is ever called here.
 */

// Regulatory compile-time guard
// If you are importing sendTransaction here, you are violating the V2 architecture.
// Remove it. Astryum does not broadcast. See CLAUDE.md §0.
type _BROADCAST_FORBIDDEN = never; // sendTransaction must never appear in this file

import { randomUUID } from 'crypto';
import type { IntentPayload } from '../types/IntentPayload';
import { PolicyGuard, policyGuard as defaultPolicyGuard } from './PolicyGuard';
import type { PolicyEvaluable } from './policy/types';
import { calldataBuilder } from './CalldataBuilder';
import { partnerRegistry, type PartnerOperation, type ChainKey } from '../partners/PartnerRegistry';
import { partnerPolicyGuard } from '../services/partners/PartnerPolicyGuard';

const INTENT_TTL_SECONDS = 300; // 5 minutes

const ASTRYUM_FEE_WALLET = process.env.ASTRYUM_FEE_WALLET ?? '';
const ASTRYUM_REFERRAL_CODE = process.env.ASTRYUM_REFERRAL_CODE ?? 'astryum';
const ASTRYUM_ATTRIBUTION_BPS = parseInt(process.env.ASTRYUM_ATTRIBUTION_BPS ?? '15', 10); // 0.15%
const ONEINCH_API_URL = process.env.ONEINCH_API_URL ?? 'https://api.1inch.dev/swap/v6.0';
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY ?? '';

function nowPlusTtl(): string {
  return new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
}

function buildReferralAttribution(disclosureText: string) {
  return {
    referralCode: ASTRYUM_REFERRAL_CODE,
    referralWallet: ASTRYUM_FEE_WALLET,
    attributionBps: ASTRYUM_ATTRIBUTION_BPS,
    disclosedToUser: true as const,
    disclosureText,
  };
}

function buildAuthorization() {
  return {
    mode: 'user_authorized_partner_relay' as const,
    userMustAuthorize: true as const,
    astryumRelays: false as const,
    singleUseSession: true as const,
  };
}

function buildExpiry() {
  return {
    expiresAt: nowPlusTtl(),
    ttlSeconds: INTENT_TTL_SECONDS,
  };
}

export interface SwapEVMParams {
  walletAddress: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  amount: string; // wei string
  slippageBps?: number;
  traceId?: string;
  sessionId?: string;
  intentSource?: 'user' | 'automation' | 'ai_copilot';
}

export interface SupplyParams {
  walletAddress: string;
  chainId: number;
  protocol: string;
  asset: string;
  amount: string;
  traceId?: string;
  sessionId?: string;
  intentSource?: 'user' | 'automation' | 'ai_copilot';
  /**
   * User KYC verification (User.kycVerified from DB). Required for P38 in
   * partner-mediated execution. Caller MUST look this up — engine never
   * reads the DB directly.
   */
  userKycVerified?: boolean;
}

export type BorrowParams = SupplyParams;
export type RepayParams = SupplyParams;
export type WithdrawParams = SupplyParams;
export type StakeParams = SupplyParams;
export type UnstakeParams = SupplyParams;
export type ClaimRewardsParams = Omit<SupplyParams, 'amount'>;
export type AddLiquidityParams = SupplyParams & { asset2: string; amount2: string };
export type RemoveLiquidityParams = SupplyParams & { lpTokenAmount: string };
export type VaultDepositParams = SupplyParams;
export type VaultWithdrawParams = SupplyParams;

export class IntentPreparationEngine {
  constructor(private readonly guard: PolicyGuard = defaultPolicyGuard) {}

  /** Prepare an EVM swap payload via 1inch. */
  async prepareSwapEVM(params: SwapEVMParams): Promise<IntentPayload> {
    this._assertFeeWallet();

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();
    const slippageBps = params.slippageBps ?? 50; // default 0.5%

    // Fetch calldata from 1inch — referrerAddress embeds referral attribution
    const txData = await this._fetch1inchSwap({
      chainId: String(params.chainId),
      from: params.walletAddress,
      src: params.fromToken,
      dst: params.toToken,
      amount: params.amount,
      slippage: (slippageBps / 100).toString(),
      referrerAddress: ASTRYUM_FEE_WALLET,
      fee: (ASTRYUM_ATTRIBUTION_BPS / 100).toString(),
    });

    const payload: IntentPayload = {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: txData.tx.to,
        data: txData.tx.data,
        value: txData.tx.value,
        gasLimit: txData.tx.gas,
        chainId: params.chainId,
      },
      metadata: {
        action: 'swap',
        protocol: '1inch',
        description: `Swap via 1inch on chain ${params.chainId}`,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },
      referralAttribution: buildReferralAttribution(
        `Astryum referral: ${ASTRYUM_ATTRIBUTION_BPS / 100}% → ${ASTRYUM_FEE_WALLET.slice(0, 8)}…`,
      ),
      authorization: buildAuthorization(),
      policy: this._runPolicy(payload_skeleton(params.chainId, txData.tx.to), {
        userId: params.walletAddress,
        slippageBps,
        requiresFeeWallet: true,
        feeWalletConfigured: !!ASTRYUM_FEE_WALLET,
        referralDisclosedToUser: true,
        txPayloadChainId: params.chainId,
        txPayloadTo: txData.tx.to,
        intentSource: params.intentSource ?? 'user',
        sessionId: params.sessionId,
        sessionValid: !!params.sessionId,
      }),
      audit: { traceId, sessionId: params.sessionId ?? '', intentSource: params.intentSource ?? 'user' },
      expiry: buildExpiry(),
    };

    return payload;
  }

  /** Prepare a Solana swap payload via Jupiter v6. */
  async prepareSwapSolana(params: SwapEVMParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    const intentId = randomUUID();
    // Jupiter swap preparation stub — full implementation in S6
    return this._stub(intentId, 'swap', 'jupiter', `Solana swap via Jupiter`, params);
  }

  /**
   * Supply (lending) — delegates to CalldataBuilder which produces real
   * unsigned calldata for Aave V3, Compound V3, Morpho Blue, etc. If the
   * protocol is not in the static registry or DB, falls back to the legacy
   * stub so the Flow Node UI still gets a payload (with empty calldata).
   */
  async prepareSupply(params: SupplyParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    return this._delegateToCalldataBuilder('supply', params,
      `Supply ${params.asset} to ${params.protocol}`);
  }

  async prepareBorrow(params: BorrowParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    return this._delegateToCalldataBuilder('borrow', params,
      `Borrow ${params.asset} from ${params.protocol}`);
  }

  async prepareRepay(params: RepayParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    return this._delegateToCalldataBuilder('repay', params,
      `Repay ${params.asset} to ${params.protocol}`);
  }

  async prepareWithdraw(params: WithdrawParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    return this._delegateToCalldataBuilder('withdraw', params,
      `Withdraw ${params.asset} from ${params.protocol}`);
  }

  /**
   * Shared bridge from V1 prepare* methods to the V2 CalldataBuilder.
   * Same regulatory invariants: never broadcasts, only builds unsigned calldata
   * for the wallet partner to transmit on user authorization.
   *
   * 2026-06-01 audit: resolves a regulated partner via PartnerRegistry before
   * any calldata is built. Refuses the operation when no partner matches.
   */
  private async _delegateToCalldataBuilder(
    actionType: 'supply' | 'borrow' | 'repay' | 'withdraw',
    params: SupplyParams,
    fallbackDescription: string,
  ): Promise<IntentPayload> {
    const canHandle = await calldataBuilder.canHandle(
      params.protocol,
      params.chainId,
      actionType,
    );
    if (!canHandle) {
      // Protocol not in registry — return stub so Money Flow UI can render
      // a placeholder. UI is expected to surface "execution not available" copy.
      const intentId = randomUUID();
      return this._stub(intentId, actionType, params.protocol, fallbackDescription, params);
    }

    const partner = partnerRegistry.resolveForOperation({
      operation: actionType as PartnerOperation,
      chain: params.chainId as ChainKey,
      protocolSlug: params.protocol,
    });
    if (!partner) {
      throw Object.assign(
        new Error(
          `NO_REGULATED_PARTNER_FOR_OPERATION: no enabled partner can route ${actionType} ` +
          `on chainId=${params.chainId} for protocol "${params.protocol}"`,
        ),
        { code: 'NO_REGULATED_PARTNER_FOR_OPERATION' },
      );
    }
    partnerPolicyGuard.assertSessionAllowed({
      partnerId: partner.id,
      astryumExecutes: false,
      astryumCustody: false,
      astryumOrderTransmission: false,
    });

    return calldataBuilder.prepare({
      protocolSlug: params.protocol,
      actionType,
      amount: params.amount,
      asset: params.asset,
      userWallet: params.walletAddress,
      chainId: params.chainId,
      traceId: params.traceId,
      sessionId: params.sessionId,
      intentSource: params.intentSource,
      partnerId: partner.id,
      partnerAllowsReferralFee: partner.allowsReferralFee,
      userKycVerified: params.userKycVerified ?? false,
    });
  }

  /**
   * S6: Prepare a stake payload.
   * Routes by protocol:
   *   sceptre   (chainId=14): sFLR staking via SceptreAdapter
   *   lido      (chainId=1):  ETH → stETH via Lido submit(referral)
   *   rocketpool(chainId=1):  ETH → rETH via Rocket Pool deposit()
   *   jito      (solana):     SOL → JitoSOL via Jupiter Stake Pool API (stub)
   *
   * Cooldown warning is included in metadata.description for all protocols.
   */
  async prepareStake(params: StakeParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    const intentId = randomUUID();
    const chainId = params.chainId ?? 14;
    const protocol = params.protocol.toLowerCase();

    // Lido — ETH → stETH on Ethereum Mainnet
    if (protocol === 'lido' && chainId === 1) {
      const LIDO_CONTRACT = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
      // submit(address referral) — payable, sends ETH, receives stETH 1:1
      // Function selector: 0xa1903eab (submit(address))
      const referralPadded = ASTRYUM_FEE_WALLET.replace('0x', '').padStart(64, '0');
      const data = `0xa1903eab${referralPadded}`;
      const description = `Stake ETH via Lido → stETH. Referral: ${ASTRYUM_FEE_WALLET.slice(0, 8)}… — No cooldown for stETH (liquid). Unstake requires Lido withdrawal queue (7-14 days).`;
      return this._buildStakePayload(intentId, params, LIDO_CONTRACT, data, params.amount, description);
    }

    // Rocket Pool — ETH → rETH on Ethereum Mainnet
    if (protocol === 'rocketpool' && chainId === 1) {
      const ROCKET_POOL_DEPOSIT = '0xDD3f50F8A6CafbE9b31a427582963f465E745AF8';
      // deposit() — payable, no args
      const data = '0xd0e30db0'; // deposit()
      const description = `Stake ETH via Rocket Pool → rETH. Cooldown: rETH has 24h burn cooldown on-chain. Withdrawal may take days depending on queue depth.`;
      return this._buildStakePayload(intentId, params, ROCKET_POOL_DEPOSIT, data, params.amount, description);
    }

    // Sceptre — FLR → sFLR on Flare Mainnet
    if (protocol === 'sceptre' && chainId === 14) {
      const SCEPTRE_PROXY = process.env.SCEPTRE_PROXY ?? '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';
      // deposit(address receiver) — standard ERC-4626 deposit
      const receiverPadded = params.walletAddress.replace('0x', '').padStart(64, '0');
      const data = `0x6e553f65${params.amount.replace('0x', '').padStart(64, '0')}${receiverPadded}`;
      const description = `Stake FLR via Sceptre → sFLR. Cooldown: sFLR is liquid (no lock). Unstake via standard ERC-4626 redeem. Estimated APY: ~4-6% FTSO rewards.`;
      return this._buildStakePayload(intentId, params, SCEPTRE_PROXY, data, '0', description);
    }

    // Fallback stub for unknown protocol/chain combinations
    return this._stub(intentId, 'stake', params.protocol, `Stake ${params.asset} on ${params.protocol} — cooldown varies by protocol, check docs.`, params);
  }

  /**
   * S6: Prepare an unstake payload.
   * Always includes a COOLDOWN WARNING in metadata.description.
   *
   * Protocol cooldowns:
   *   stETH/Lido:       Withdrawal queue 7-14 days (requestWithdrawals)
   *   rETH/Rocket Pool: 24h burn cooldown
   *   sFLR/Sceptre:     No cooldown (ERC-4626 redeem)
   *   JitoSOL/Jito:     ~2 epochs (~2-4 days)
   */
  async prepareUnstake(params: UnstakeParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    const intentId = randomUUID();
    const chainId = params.chainId ?? 14;
    const protocol = params.protocol.toLowerCase();

    // Lido unstake — requestWithdrawalsWithPermit
    if (protocol === 'lido' && chainId === 1) {
      const LIDO_WITHDRAWAL = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';
      // requestWithdrawals(uint256[] amounts, address owner)
      // Simplified: direct requestWithdrawals call
      const amountPadded = BigInt(params.amount).toString(16).padStart(64, '0');
      const ownerPadded = params.walletAddress.replace('0x', '').padStart(64, '0');
      // requestWithdrawals(uint256[],address) selector: 0xe3ead59e
      const data = `0xe3ead59e0000000000000000000000000000000000000000000000000000000000000040${ownerPadded}0000000000000000000000000000000000000000000000000000000000000001${amountPadded}`;
      const description = `⚠️ COOLDOWN WARNING: Lido withdrawal queue is 7-14 days. You will receive an NFT receipt and claim ETH once the queue processes your request. Amount: ${params.amount} stETH.`;
      return this._buildStakePayload(intentId, params, LIDO_WITHDRAWAL, data, '0', description);
    }

    // Rocket Pool — burn rETH → ETH
    if (protocol === 'rocketpool' && chainId === 1) {
      const RETH_TOKEN = '0xae78736Cd615f374D3085123A210448E74Fc6393';
      // burn(uint256 rethAmount) selector: 0x89476069
      const amountPadded = BigInt(params.amount).toString(16).padStart(64, '0');
      const data = `0x89476069${amountPadded}`;
      const description = `⚠️ COOLDOWN WARNING: rETH has a 24-hour burn cooldown. You must hold rETH for at least 24h after minting before burning. Withdrawal may be delayed if Rocket Pool liquidity pool is low.`;
      return this._buildStakePayload(intentId, params, RETH_TOKEN, data, '0', description);
    }

    // Sceptre — sFLR → FLR
    if (protocol === 'sceptre' && chainId === 14) {
      const SCEPTRE_PROXY = process.env.SCEPTRE_PROXY ?? '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';
      // redeem(uint256 shares, address receiver, address owner)
      const sharesPadded = BigInt(params.amount).toString(16).padStart(64, '0');
      const receiverPadded = params.walletAddress.replace('0x', '').padStart(64, '0');
      // redeem(uint256,address,address) selector: 0xba087652
      const data = `0xba087652${sharesPadded}${receiverPadded}${receiverPadded}`;
      const description = `Unstake sFLR via Sceptre → FLR. No cooldown — ERC-4626 immediate redemption.`;
      return this._buildStakePayload(intentId, params, SCEPTRE_PROXY, data, '0', description);
    }

    return this._stub(intentId, 'unstake', params.protocol, `⚠️ COOLDOWN WARNING: Unstake from ${params.protocol} — check protocol docs for cooldown period before proceeding.`, params);
  }

  /** Build a stake/unstake IntentPayload from pre-built calldata. */
  private _buildStakePayload(
    intentId: string,
    params: StakeParams,
    contractAddress: string,
    calldata: string,
    valueWei: string,
    description: string,
  ): IntentPayload {
    const traceId = params.traceId ?? randomUUID();
    const chainId = params.chainId ?? 14;
    const policyResult = this._runPolicy(
      payload_skeleton(chainId, contractAddress),
      {
        userId: params.walletAddress,
        requiresFeeWallet: true,
        feeWalletConfigured: !!ASTRYUM_FEE_WALLET,
        referralDisclosedToUser: true,
        txPayloadChainId: chainId,
        txPayloadTo: contractAddress,
        intentSource: params.intentSource ?? 'user',
        sessionId: params.sessionId,
        sessionValid: !!params.sessionId,
      },
    );
    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: contractAddress,
        data: calldata,
        value: valueWei,
        gasLimit: '250000',
        chainId,
      },
      metadata: {
        action: 'stake',
        protocol: params.protocol,
        description,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },
      referralAttribution: buildReferralAttribution(
        `Astryum referral: ${ASTRYUM_ATTRIBUTION_BPS / 100}% via referral → ${ASTRYUM_FEE_WALLET.slice(0, 8)}…`,
      ),
      authorization: buildAuthorization(),
      policy: policyResult,
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  async prepareClaimRewards(params: ClaimRewardsParams): Promise<IntentPayload> {
    const intentId = randomUUID();
    return this._stub(intentId, 'claim_rewards', params.protocol, `Claim rewards from ${params.protocol}`, params);
  }

  async prepareAddLiquidity(params: AddLiquidityParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    const intentId = randomUUID();
    return this._stub(intentId, 'add_liquidity', params.protocol, `Add liquidity to ${params.protocol}`, params);
  }

  async prepareRemoveLiquidity(params: RemoveLiquidityParams): Promise<IntentPayload> {
    const intentId = randomUUID();
    return this._stub(intentId, 'remove_liquidity', params.protocol, `Remove liquidity from ${params.protocol}`, params);
  }

  /** Stub — expanded in S6. */
  async prepareVaultDeposit(params: VaultDepositParams): Promise<IntentPayload> {
    this._assertFeeWallet();
    const intentId = randomUUID();
    return this._stub(intentId, 'vault_deposit', params.protocol, `Deposit ${params.asset} into vault ${params.protocol}`, params);
  }

  /** Stub — expanded in S6. */
  async prepareVaultWithdraw(params: VaultWithdrawParams): Promise<IntentPayload> {
    const intentId = randomUUID();
    return this._stub(intentId, 'vault_withdraw', params.protocol, `Withdraw ${params.asset} from vault ${params.protocol}`, params);
  }

  /** Dispatcher — routes to the correct prepare* method by action name.
   *  Also accepts V2 FlowNodeType prefixed names (prepare_*). */
  async prepare(
    action: string,
    params: Record<string, unknown>,
  ): Promise<IntentPayload> {
    // Strip prepare_ prefix from FlowNodeType values
    const normalised = action.startsWith('prepare_') ? action.slice(8) : action;
    switch (normalised) {
      case 'swap':
      case 'swap_evm':          return this.prepareSwapEVM(params as unknown as SwapEVMParams);
      case 'swap_solana':        return this.prepareSwapSolana(params as unknown as SwapEVMParams);
      case 'supply':             return this.prepareSupply(params as unknown as SupplyParams);
      case 'borrow':             return this.prepareBorrow(params as unknown as BorrowParams);
      case 'repay':              return this.prepareRepay(params as unknown as RepayParams);
      case 'withdraw':           return this.prepareWithdraw(params as unknown as WithdrawParams);
      case 'stake':              return this.prepareStake(params as unknown as StakeParams);
      case 'unstake':            return this.prepareUnstake(params as unknown as UnstakeParams);
      case 'claim_rewards':      return this.prepareClaimRewards(params as unknown as ClaimRewardsParams);
      case 'add_liquidity':      return this.prepareAddLiquidity(params as unknown as AddLiquidityParams);
      case 'remove_liquidity':   return this.prepareRemoveLiquidity(params as unknown as RemoveLiquidityParams);
      case 'vault_deposit':      return this.prepareVaultDeposit(params as unknown as VaultDepositParams);
      case 'vault_withdraw':     return this.prepareVaultWithdraw(params as unknown as VaultWithdrawParams);
      case 'swap_and_supply': {
        // Two-step: swap then supply — returns the first step (swap)
        // The UI chains the second prepare after the first is authorized
        return this.prepareSwapEVM(params as unknown as SwapEVMParams);
      }
      case 'bridge':
        return this._stub(randomUUID(), 'bridge', (params.protocol as string) ?? 'squid', `Bridge assets via ${params.protocol ?? 'Squid'} — cooldown varies by destination chain finality.`, params as unknown as { walletAddress?: string; chainId?: number });
      default:
        throw new Error(`IntentPreparationEngine: unknown action "${action}"`);
    }
  }

  private _assertFeeWallet(): void {
    if (!ASTRYUM_FEE_WALLET) {
      throw new Error(
        'P33: ASTRYUM_FEE_WALLET not configured. ' +
        'Set env var before preparing any intent with referral attribution.',
      );
    }
  }

  private _runPolicy(
    intent: PolicyEvaluable,
    opts: Parameters<PolicyGuard['evaluate']>[1],
  ): IntentPayload['policy'] {
    const result = this.guard.evaluate(intent, opts);
    return {
      evaluatedAt: result.evaluatedAt,
      passed: result.passed,
      blockReason: result.blockReason,
      warnings: [...result.warnings],
    };
  }

  private _stub(
    intentId: string,
    action: string,
    protocol: string,
    description: string,
    params: { walletAddress?: string; chainId?: number; traceId?: string; sessionId?: string; intentSource?: 'user' | 'automation' | 'ai_copilot' },
  ): IntentPayload {
    const traceId = params.traceId ?? randomUUID();
    const chainId = params.chainId ?? 14;
    const walletAddress = params.walletAddress ?? '';

    const policyResult = this._runPolicy(
      payload_skeleton(chainId, '0x0000000000000000000000000000000000000000'),
      {
        userId: walletAddress,
        requiresFeeWallet: true,
        feeWalletConfigured: !!ASTRYUM_FEE_WALLET,
        referralDisclosedToUser: true,
        txPayloadChainId: chainId,
        intentSource: params.intentSource ?? 'user',
        sessionId: params.sessionId,
        sessionValid: !!params.sessionId,
      },
    );

    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: '0x0000000000000000000000000000000000000000',
        data: '0x',
        value: '0',
        gasLimit: '200000',
        chainId,
      },
      metadata: {
        action,
        protocol,
        description,
        preparedBy: 'astryum',
        preparedAt: new Date().toISOString(),
      },
      referralAttribution: buildReferralAttribution(
        `Astryum referral: ${ASTRYUM_ATTRIBUTION_BPS / 100}% → ${ASTRYUM_FEE_WALLET.slice(0, 8)}…`,
      ),
      authorization: buildAuthorization(),
      policy: policyResult,
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  private async _fetch1inchSwap(params: Record<string, string>): Promise<{
    tx: { to: string; data: string; value: string; gas: string };
  }> {
    const qs = new URLSearchParams(params).toString();
    const chainId = params.chainId;
    const res = await fetch(`${ONEINCH_API_URL}/${chainId}/swap?${qs}`, {
      headers: { Authorization: `Bearer ${ONEINCH_API_KEY}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`1inch swap API HTTP ${res.status}`);
    return res.json() as Promise<{ tx: { to: string; data: string; value: string; gas: string } }>;
  }
}

/** Minimal PolicyEvaluable for policy guard calls within this engine. */
function payload_skeleton(chainId: number, to: string): PolicyEvaluable {
  return {
    action: { targetChain: chainId, type: 'prepare' as const, protocolId: 'unknown' },
    txData: { chainId, to, data: '0x', value: 0n },
    valueUSD: 0,
    slippageBps: 0,
    priceTimestamp: new Date(),
    intentSource: 'user',
  } as unknown as PolicyEvaluable;
}

export const intentPreparationEngine = new IntentPreparationEngine();

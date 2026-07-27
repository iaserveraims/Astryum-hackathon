import type { ActionType } from '../../canonical/types/Action';

/**
 * V1.1 Mandate — declarative authorization envelope a user attaches to their
 * account. Every CanonicalIntent is checked against the active mandate before
 * being marked `ready_to_sign`.
 *
 * Spec: docs/POLICY_GUARD.md §3
 */
export interface Mandate {
  readonly schemaVersion: '1.0';
  readonly id: string;
  readonly userId: string;
  readonly active: boolean;

  readonly scope: {
    readonly allowedProtocols: ReadonlyArray<string>;
    readonly allowedChains: ReadonlyArray<number>;
    readonly allowedAssets: ReadonlyArray<string>;
    readonly allowedActions: ReadonlyArray<ActionType>;
    readonly forbiddenActions: ReadonlyArray<ActionType>;
  };

  readonly limits: {
    readonly maxTxValueUSD: number;
    readonly maxDailyValueUSD: number;
    readonly maxMonthlyValueUSD: number;
    readonly maxSlippageBps: number;
    readonly minHealthFactorAfter?: number;
    readonly maxRiskScoreAfter?: number;
    readonly cooldownMinutesPerRule?: number;
  };

  readonly approvals: {
    readonly requireManualApprovalAboveUSD: number;
    readonly requireManualApprovalForNewProtocol: boolean;
    readonly requireManualApprovalForNewAsset: boolean;
    readonly requireManualApprovalForBridge: boolean;
  };

  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly signature?: string;
}

/**
 * Output of `PolicyGuard.evaluate(intent)`. Carries per-rule booleans plus
 * structured errors so the UI can show an exact reason.
 */
export interface PolicyCheck {
  readonly passed: boolean;

  readonly chainAllowed: boolean;
  readonly walletAllowed: boolean;
  readonly contractAllowed: boolean;
  readonly actionAllowed: boolean;
  readonly assetAllowed: boolean;
  readonly valueWithinLimit: boolean;
  readonly slippageWithinLimit: boolean;
  readonly riskWithinLimit: boolean;
  readonly dataFresh: boolean;
  readonly providerHealthy: boolean;
  readonly trustLevelSufficient: boolean;
  readonly selectorMatchesAction: boolean;
  readonly approveBoundedOrOptIn: boolean;
  readonly intentNotExpired: boolean;
  readonly sessionValid: boolean;

  readonly warnings: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<{ readonly code: string; readonly message: string }>;

  readonly manualApprovalRequired: boolean;
  readonly kycRequired: boolean;
  readonly blocked: boolean;
  readonly blockReason?: string;

  readonly evaluatedAt: string;
  readonly mandateId?: string;
}

/**
 * Minimal shape PolicyGuard needs from the candidate intent. We do NOT couple
 * to the full CanonicalIntent type so the guard stays callable with partial
 * inputs (e.g. before the broadcast step, when only a sim+action exist).
 */
export interface PolicyEvaluable {
  readonly intentId?: string;
  readonly action: {
    readonly type: ActionType;
    readonly targetProtocol: string;
    readonly targetChain: number;
  };
  readonly txData?: {
    readonly to: string;
    readonly data: string;
    readonly chainId: number;
  };
  readonly valueUSD?: number;
  readonly slippageBps?: number;
  readonly assets?: ReadonlyArray<string>;
  readonly simulationId?: string;
  readonly simulatedAt?: string;
  readonly pricesFreshAt?: string;
  readonly expiresAt?: string;
  readonly riskAfter?: { readonly healthFactor?: number; readonly score?: number };
  /**
   * P38: true when this action targets a regulated partner that requires AML/KYC
   * (MoonPay Trade, Crossmint marketplace, any partner with AML obligations).
   * When true, the caller must also pass kycVerified=true via EvaluateOpts or the guard blocks.
   */
  readonly requiresKyc?: boolean;
}

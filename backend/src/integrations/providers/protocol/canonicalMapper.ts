/**
 * V1.1 alignment helpers — adapt V1 adapter outputs to canonical types.
 *
 * Pure functions. No side effects. Used by the protocol Provider wrappers
 * around `IProtocolAdapter` so that ControlPlane.call(...) returns
 * `CanonicalIntent` / `CanonicalPosition` / canonical `SimulationResult`.
 */
import type {
  TransactionIntent as AdapterTransactionIntent,
  SimulationResult as AdapterSimulationResult,
} from '../../../types/domain/Intent';
import type { NormalizedPosition } from '../../../types/domain/Position';
import type { CanonicalIntent, SimulationResult as CanonicalSimulationResult } from '../../../canonical/types/Intent';
import type { CanonicalPosition, PositionKind as CanonicalPositionKind } from '../../../canonical/types/Position';
import type { CanonicalAction, ActionType } from '../../../canonical/types/Action';
import type { SourceRecord } from '../../../canonical/types/Source';

/** Map V1 PositionKind (uppercase) → canonical PositionKind (lowercase). */
const POSITION_KIND_MAP: Record<string, CanonicalPositionKind> = {
  SUPPLY: 'collateral',
  BORROW: 'debt',
  LP: 'lp',
  STAKE: 'staking',
  REWARD: 'reward',
  FREE: 'free',
};

export function adapterIntentToCanonical(
  v1: AdapterTransactionIntent,
  source: SourceRecord,
): CanonicalIntent {
  const action: CanonicalAction = {
    type: v1.action as ActionType,
    targetProtocol: v1.protocolId,
    targetChain: v1.txData?.chainId ?? 14,
    params: serializeBigints(v1.inputs),
  };

  const sim: CanonicalSimulationResult = {
    success: v1.simulation.success,
    newHF: v1.simulation.newHF,
    newLTV: v1.simulation.newLTV,
    gasEstimate: v1.simulation.gasEstimate.toString(),
    gasEstimateUSD: v1.simulation.gasEstimateUSD,
    netUSDImpact: v1.simulation.netUSDImpact,
    riskDelta: v1.simulation.riskDelta,
    warnings: v1.simulation.warnings,
    simulatedAt: v1.simulation.simulatedAt.toISOString(),
    priceTimestamp: v1.simulation.priceTimestamp.toISOString(),
    isStale: v1.simulation.isStale,
  };

  return {
    id: v1.id,
    createdAt: v1.createdAt.toISOString(),
    expiresAt: v1.expiresAt.toISOString(),
    owner: v1.owner,
    sessionId: v1.sessionId,
    action,
    protocol: v1.protocolId,
    positionId: v1.positionId,
    simulation: sim,
    simulatedAt: v1.simulatedAt.toISOString(),
    pricesFreshAt: v1.pricesFreshAt.toISOString(),
    riskDelta: {
      hfBefore: v1.riskDelta.hfBefore,
      hfAfter: v1.riskDelta.hfAfter,
      hfChange: v1.riskDelta.hfChange,
      scoreBefore: v1.riskDelta.scoreBefore,
      scoreAfter: v1.riskDelta.scoreAfter,
      warnings: v1.riskDelta.warnings,
      isDefensive: v1.riskDelta.isDefensive,
    },
    explanation: v1.explanation,
    warnings: v1.warnings,
    txData: v1.txData
      ? {
          to: v1.txData.to,
          data: v1.txData.data,
          value: v1.txData.value.toString(),
          gasLimit: v1.txData.gasLimit.toString(),
          chainId: v1.txData.chainId,
        }
      : undefined,
    status: v1.status,
    txHash: v1.txHash,
    confirmedAt: v1.confirmedAt?.toISOString(),
    failureReason: v1.failureReason,
    blockNumber: v1.blockNumber,
    source,
  };
}

export function adapterSimulationToCanonical(
  v1: AdapterSimulationResult,
): CanonicalSimulationResult {
  return {
    success: v1.success,
    newHF: v1.newHF,
    newLTV: v1.newLTV,
    gasEstimate: v1.gasEstimate.toString(),
    gasEstimateUSD: v1.gasEstimateUSD,
    netUSDImpact: v1.netUSDImpact,
    riskDelta: v1.riskDelta,
    warnings: v1.warnings,
    simulatedAt: v1.simulatedAt.toISOString(),
    priceTimestamp: v1.priceTimestamp.toISOString(),
    isStale: v1.isStale,
  };
}

export function normalizedPositionToCanonical(
  np: NormalizedPosition,
  source: SourceRecord,
  id: string,
): CanonicalPosition {
  return {
    id,
    wallet: np.wallet,
    chainId: np.chainId,
    protocol: np.protocolId,
    kind: POSITION_KIND_MAP[np.kind] ?? 'free',
    assets: [
      {
        asset: {
          chainId: np.chainId,
          address: np.asset,
          symbol: (np.metadata?.token as string) ?? 'UNKNOWN',
          decimals: 18,
          priceUSD: np.priceUSD || null,
          source,
        },
        amount: np.amount.toString(),
        amountUSD: np.amountUSD,
      },
    ],
    source,
  };
}

function serializeBigints(o: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

import { randomUUID } from 'crypto';
import {
  IProtocolAdapter,
  ProtocolInactiveError,
} from '../IProtocolAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type {
  TransactionIntent,
  SimulationResult,
  IntentBuildContext,
  IntentAction,
} from '../../../types/domain/Intent';
import { FlareProvider } from '../../../services/FlareProvider';

const INTENT_TTL_MS = 5 * 60 * 1000;

const ACTION_KIND_TO_INTENT: Record<string, IntentAction> = {
  supply: 'supply',
  borrow: 'borrow',
  repay: 'repay',
  withdraw: 'withdraw',
  addCollateral: 'addCollateral',
  addLiquidity: 'addLiquidity',
  exitLP: 'exitLP',
  harvest: 'harvest',
  stake: 'stake',
  unstake: 'unstake',
  swap: 'swap',
  wrap: 'wrap',
  unwrap: 'unwrap',
  delegate: 'delegate',
  undelegate: 'undelegate',
  claimRewards: 'claimRewards',
};

export abstract class BaseAdapter implements IProtocolAdapter {
  abstract readonly protocolId: string;
  abstract readonly chainId: number;

  protected readonly provider: FlareProvider;

  constructor() {
    this.provider = FlareProvider.getInstance();
  }

  /** Adapter is active only when its required addresses are configured. */
  get isActive(): boolean {
    return false;
  }

  protected assertActive(): void {
    if (!this.isActive) throw new ProtocolInactiveError(this.protocolId);
  }

  abstract discoverPositions(wallet: string): Promise<RawPosition[]>;
  abstract normalizePosition(raw: RawPosition): NormalizedPosition;
  abstract getMetrics(position: NormalizedPosition): Promise<PositionMetrics>;
  abstract simulateAction(action: ProtocolAction): Promise<SimulationResult>;

  /**
   * Default intent assembly. Subclasses fill `txData` after computing calldata.
   */
  async buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext
  ): Promise<TransactionIntent> {
    this.assertActive();
    const simulation = await this.simulateAction(action);
    const now = new Date();
    const intentAction = ACTION_KIND_TO_INTENT[action.kind];
    if (!intentAction) {
      throw new Error(`Unsupported action kind: ${action.kind}`);
    }

    return {
      id: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
      owner: ctx.owner,
      sessionId: ctx.sessionId,
      action: intentAction,
      protocolId: this.protocolId,
      positionId: action.positionId,
      inputs: action.inputs,
      preState: {
        priceSnapshot: ctx.priceSnapshot,
      },
      simulation,
      simulatedAt: simulation.simulatedAt,
      pricesFreshAt: simulation.priceTimestamp,
      impact: {
        newHF: simulation.newHF,
        newLTV: simulation.newLTV,
        gasEstimateUSD: simulation.gasEstimateUSD,
        gasEstimateNative: simulation.gasEstimate,
      },
      riskDelta: {
        scoreBefore: 50,
        scoreAfter: Math.max(0, Math.min(100, 50 - simulation.riskDelta)),
        warnings: simulation.warnings,
        isDefensive: simulation.riskDelta < 0,
      },
      explanation: this.defaultExplanation(action, simulation),
      warnings: simulation.warnings,
      status: 'building',
    };
  }

  protected defaultExplanation(
    action: ProtocolAction,
    sim: SimulationResult
  ): string {
    const parts = [
      `${action.kind} on ${this.protocolId} (chain ${this.chainId})`,
      `gas ≈ $${sim.gasEstimateUSD.toFixed(2)}`,
    ];
    if (sim.newHF !== undefined) parts.push(`new HF ≈ ${sim.newHF.toFixed(2)}`);
    if (sim.netUSDImpact !== 0)
      parts.push(`net impact ≈ ${sim.netUSDImpact >= 0 ? '+' : ''}$${sim.netUSDImpact.toFixed(2)}`);
    return parts.join('; ');
  }
}

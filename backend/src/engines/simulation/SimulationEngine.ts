import { ProtocolRegistry } from '../../connectors/protocols/ProtocolRegistry';
import { registerFlareAdapters } from '../../connectors/protocols/adapters';
import { PortfolioEngine } from '../portfolio/PortfolioEngine';
import { RiskEngine } from '../risk/RiskEngine';
import { prisma } from '../../database/prismaClient';
import type { SimulationResult } from '../../types/domain/Intent';
import type {
  ProtocolAction,
  ProtocolActionKind,
} from '../../types/domain/Protocol';

const FLARE_CHAIN_ID = 14;
const SIM_TTL_MS = 5 * 60 * 1000;
const STALE_PRICES_MS = 90 * 1000;

let bootstrapped = false;
function ensureAdapters(): void {
  if (bootstrapped) return;
  registerFlareAdapters(ProtocolRegistry.getInstance());
  bootstrapped = true;
}

export interface SimulationInput {
  walletAddress: string;
  protocolId: string;
  positionId?: string;
  chainId?: number;
  /** Action-specific params, passed straight to adapter.simulateAction */
  params: Record<string, unknown>;
}

export interface PersistedSimulationResult extends SimulationResult {
  id: string;
  walletAddress: string;
  actionType: ProtocolActionKind;
  protocolId: string;
  expiresAt: Date;
}

export class SimulationEngine {
  private static instance: SimulationEngine | null = null;
  static getInstance(): SimulationEngine {
    if (!this.instance) this.instance = new SimulationEngine();
    return this.instance;
  }

  async simulate(
    actionKind: ProtocolActionKind,
    input: SimulationInput
  ): Promise<PersistedSimulationResult> {
    ensureAdapters();
    const chainId = input.chainId ?? FLARE_CHAIN_ID;
    const adapter = ProtocolRegistry.getInstance().getAdapter(
      input.protocolId,
      chainId
    );
    if (!adapter) {
      throw new Error(`unknown_protocol: ${input.protocolId}`);
    }
    if (!adapter.isActive) {
      throw Object.assign(new Error('protocol_inactive'), {
        code: 'protocol_inactive',
        protocolId: input.protocolId,
      });
    }

    const action: ProtocolAction = {
      kind: actionKind,
      protocolId: input.protocolId,
      chainId,
      wallet: input.walletAddress,
      positionId: input.positionId,
      inputs: input.params,
    };

    const result = await adapter.simulateAction(action);

    // Anti-stale guard (R8 + CLAUDE.md §6 Motor 6)
    const ageMs = Date.now() - result.priceTimestamp.getTime();
    if (ageMs > STALE_PRICES_MS) {
      result.isStale = true;
      result.warnings.push(`prices stale by ${Math.round(ageMs / 1000)}s`);
    }

    const persisted = await this.persist(actionKind, input, result);
    return persisted;
  }

  /** Convenience wrappers per CLAUDE.md / V1 prompt API surface. */
  simulateRepay(input: SimulationInput) {
    return this.simulate('repay', input);
  }
  simulateAddCollateral(input: SimulationInput) {
    return this.simulate('addCollateral', input);
  }
  simulateWithdraw(input: SimulationInput) {
    return this.simulate('withdraw', input);
  }
  simulateSupply(input: SimulationInput) {
    return this.simulate('supply', input);
  }
  simulateBorrow(input: SimulationInput) {
    return this.simulate('borrow', input);
  }
  simulateExitLP(input: SimulationInput) {
    return this.simulate('exitLP', input);
  }
  simulateHarvest(input: SimulationInput) {
    return this.simulate('harvest', input);
  }

  /**
   * Portfolio-level market drop. Delegates to RiskEngine.simulateMarketDrop
   * which already does deterministic recompute on a cloned snapshot.
   */
  async simulateMarketDrop(
    walletAddress: string,
    dropPct: number,
    chainId: number = FLARE_CHAIN_ID,
    asset?: string
  ) {
    return RiskEngine.getInstance().simulateMarketDrop(
      walletAddress,
      chainId,
      dropPct,
      asset
    );
  }

  async getById(id: string): Promise<PersistedSimulationResult | null> {
    try {
      const row = await prisma.simulationResult.findUnique({ where: { id } });
      if (!row) return null;
      return rowToResult(row);
    } catch {
      return null;
    }
  }

  private async persist(
    actionKind: ProtocolActionKind,
    input: SimulationInput,
    result: SimulationResult
  ): Promise<PersistedSimulationResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SIM_TTL_MS);

    let row;
    try {
      row = await prisma.simulationResult.create({
        data: {
          walletAddress: input.walletAddress,
          actionType: actionKind,
          protocolId: input.protocolId,
          positionId: input.positionId,
          input: input.params as object,
          before: {},
          after: {
            newHF: result.newHF,
            newLTV: result.newLTV,
          },
          delta: {
            netUSDImpact: result.netUSDImpact,
            riskDelta: result.riskDelta,
          },
          warnings: result.warnings,
          assumptions: [],
          gasEstimate: result.gasEstimate.toString(),
          gasEstimateUSD: result.gasEstimateUSD,
          confidence: 0.7,
          pricesFreshAt: result.priceTimestamp,
          isStale: result.isStale,
          expiresAt,
        },
      });
    } catch (err) {
      // DB unavailable — return ephemeral with synthetic id so the caller still gets a usable result
      console.warn(
        '[simulation] persist failed (continuing ephemeral):',
        (err as Error).message
      );
      return {
        ...result,
        id: `ephemeral-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        walletAddress: input.walletAddress,
        actionType: actionKind,
        protocolId: input.protocolId,
        expiresAt,
      };
    }

    return {
      ...result,
      id: row.id,
      walletAddress: input.walletAddress,
      actionType: actionKind,
      protocolId: input.protocolId,
      expiresAt: row.expiresAt,
    };
  }
}

function rowToResult(row: any): PersistedSimulationResult {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    actionType: row.actionType,
    protocolId: row.protocolId,
    success: true,
    newHF: row.after?.newHF,
    newLTV: row.after?.newLTV,
    gasEstimate: BigInt(row.gasEstimate),
    gasEstimateUSD: row.gasEstimateUSD,
    netUSDImpact: row.delta?.netUSDImpact ?? 0,
    riskDelta: row.delta?.riskDelta ?? 0,
    warnings: row.warnings,
    simulatedAt: row.createdAt,
    priceTimestamp: row.pricesFreshAt,
    isStale: row.isStale,
    expiresAt: row.expiresAt,
  };
}

// Imports retained for type checker even when paths look unused
void PortfolioEngine;

import { randomUUID } from 'crypto';
import type {
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { IEngineProvider } from '../../interfaces/IEngineProvider';
import type { TrustLevel, SourceRecord } from '../../../canonical/types/Source';
import type { CanonicalRisk, RiskLevel as CanonicalRiskLevel } from '../../../canonical/types/Risk';
import type { EngineProviderManifest } from './EngineProviderManifest';
import { engineAdapterFactory } from './EngineAdapterFactory';
import { RiskEngine } from '../../../engines/risk/RiskEngine';
import type { RiskSnapshot, RiskLevel as V1RiskLevel } from '../../../engines/risk/types';

const LEVEL_MAP: Readonly<Record<V1RiskLevel, CanonicalRiskLevel>> = Object.freeze({
  SAFE: 'safe',
  WATCH: 'safe',
  WARNING: 'moderate',
  DANGER: 'elevated',
  CRITICAL: 'critical',
});

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'engine.risk.getCanonicalRisk',
  'engine.risk.getPortfolioRisk',
]);

const MANIFEST: EngineProviderManifest = Object.freeze({
  engineKind: 'risk',
  engineVersion: '1.1.0',
  deterministic: true,
  supportedCapabilities: CAPS,
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  auditRequired: true as const,
  description: 'RiskEngine (V1) wrapped as a deterministic engine provider that emits CanonicalRisk.',
});

export interface GetCanonicalRiskInput {
  readonly wallet: string;
  readonly chainId?: number;
}

/**
 * Wraps the V1 RiskEngine. Computes deterministic risk metrics from a portfolio snapshot
 * and emits CanonicalRisk. PolicyGuard P13 reads this output to fail-close on actions
 * that would push HF below the mandate floor.
 */
export class RiskNormalizationProvider implements IEngineProvider {
  readonly id = 'engine-risk';
  readonly type = 'engine' as const;
  readonly trustLevel: TrustLevel = 'aggregator';
  readonly priority = 100;
  readonly capabilities = CAPS;
  readonly manifest = MANIFEST;

  constructor(private readonly engine: RiskEngine = RiskEngine.getInstance()) {
    engineAdapterFactory.validateManifest(MANIFEST);
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      lastCheckAt: new Date().toISOString(),
      reason: 'in-process deterministic engine',
    };
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (capability !== 'engine.risk.getCanonicalRisk' && capability !== 'engine.risk.getPortfolioRisk') {
      throw new Error(`unsupported_capability: ${capability}`);
    }
    const { wallet, chainId = 14 } = input as GetCanonicalRiskInput;
    if (!wallet) throw new Error('wallet required');

    const snapshot = await this.engine.getPortfolioRisk(wallet, chainId);
    const traceId = ctx.traceId ?? randomUUID();
    const source: SourceRecord = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
      stale: isStale(snapshot),
    };

    if (capability === 'engine.risk.getPortfolioRisk') {
      return { data: snapshot as TOut, source, cached: false };
    }

    const data = toCanonical(snapshot, wallet, source);
    return { data: data as TOut, source, cached: false };
  }
}

function toCanonical(s: RiskSnapshot, wallet: string, source: SourceRecord): CanonicalRisk {
  return {
    wallet,
    score: clamp(s.riskScore, 0, 100),
    level: LEVEL_MAP[s.riskLevel] ?? 'safe',
    drivers: (s.drivers ?? []).map((d) => ({
      code: d.name,
      message: d.name,
      severity: clamp(d.contribution, 0, 1),
    })),
    warnings: s.warnings ?? [],
    source,
  };
}

const RISK_FRESHNESS_MS = 90_000;
function isStale(s: RiskSnapshot): boolean {
  return Date.now() - new Date(s.computedAt).getTime() > RISK_FRESHNESS_MS;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

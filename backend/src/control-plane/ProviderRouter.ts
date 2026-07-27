import { randomUUID } from 'crypto';
import type {
  IProvider,
  Capability,
  ProviderCallContext,
  ProviderCallResult,
} from '../integrations/interfaces/IProvider';
import type { TrustLevel } from '../canonical/types/Source';
import type { CanonicalAuditEvent, AuditDecision } from '../canonical/types/AuditEvent';
import { TRUST_WEIGHT } from '../canonical/types/Source';
import { IntegrationRegistry, registry as defaultRegistry } from '../integrations/registry/IntegrationRegistry';
import { CircuitBreaker, circuitBreaker as defaultBreaker } from './CircuitBreaker';
import { RouterCache, routerCache as defaultCache } from './RouterCache';
import { auditEventRepository, AuditEventRepository } from './AuditEventRepository';

export interface CapabilityRequest<TIn> {
  capability: Capability;
  input: TIn;
  ctx?: Partial<ProviderCallContext>;
  options?: {
    minTrustLevel?: TrustLevel;
    fallback?: boolean;
    cacheTTL?: number; // seconds
    bypassCache?: boolean;
  };
}

export interface RouterStats {
  totalCalls: number;
  cacheHits: number;
  fallbacks: number;
  failures: number;
  totalLatencyMs: number;
}

export class ProviderRouter {
  private stats: RouterStats = {
    totalCalls: 0,
    cacheHits: 0,
    fallbacks: 0,
    failures: 0,
    totalLatencyMs: 0,
  };

  constructor(
    private readonly registry: IntegrationRegistry = defaultRegistry,
    private readonly cache: RouterCache = defaultCache,
    private readonly breaker: CircuitBreaker = defaultBreaker,
    private readonly auditRepo: AuditEventRepository = auditEventRepository,
  ) {}

  async call<TIn, TOut>(req: CapabilityRequest<TIn>): Promise<ProviderCallResult<TOut>> {
    const ctx: ProviderCallContext = {
      traceId: req.ctx?.traceId ?? randomUUID(),
      wallet: req.ctx?.wallet,
      sessionId: req.ctx?.sessionId,
      bypassCache: req.ctx?.bypassCache ?? req.options?.bypassCache ?? false,
    };
    // Extract chainId for chain-aware routing (S3 multichain support).
    // FlareRpcProvider owns chainId=14 (priority=100); others get filtered by supportsChain().
    const inputChainId = (req.input as Record<string, unknown>)?.chainId as number | undefined;
    const fallback = req.options?.fallback ?? true;
    const cacheTTL = req.options?.cacheTTL ?? 0;
    const minTrust = req.options?.minTrustLevel;

    this.stats.totalCalls += 1;
    const startedAt = Date.now();

    // Cache lookup
    let cacheKey: string | null = null;
    if (cacheTTL > 0 && !ctx.bypassCache) {
      cacheKey = this.cache.key(req.capability, req.input);
      const cached = await this.cache.get<TOut>(cacheKey);
      if (cached) {
        this.stats.cacheHits += 1;
        const latencyMs = Date.now() - startedAt;
        await this.emitAudit(
          {
            traceId: ctx.traceId,
            providerId: cached.source.providerId,
            capability: req.capability,
            decision: 'pass',
            policyChecks: [],
            latencyMs,
            cached: true,
            fellBack: false,
            timestamp: new Date().toISOString(),
          },
          req.input,
        );
        this.stats.totalLatencyMs += latencyMs;
        return { ...cached, cached: true };
      }
    }

    // Resolve providers (chain-aware: filter by supportsChain if chainId is in input)
    const candidates = this.resolveCandidates(req.capability, minTrust, inputChainId);
    if (candidates.length === 0) {
      this.stats.failures += 1;
      const err = new Error(`NO_PROVIDER_AVAILABLE for capability=${req.capability}`);
      (err as Error & { code?: string }).code = 'NO_PROVIDER_AVAILABLE';
      throw err;
    }

    // Try primary, then fallbacks
    let lastErr: unknown = null;
    let attempts = 0;
    for (const provider of candidates) {
      const breakerKey = `${provider.id}:${req.capability}`;
      if (!this.breaker.canCall(breakerKey)) {
        lastErr = new Error(`CIRCUIT_OPEN: ${provider.id}`);
        continue;
      }
      attempts += 1;
      const tStart = Date.now();
      try {
        const result = await provider.call<TIn, TOut>(req.capability, req.input, ctx);
        const latencyMs = Date.now() - tStart;
        this.breaker.recordSuccess(breakerKey);

        const fellBack = attempts > 1;
        if (fellBack) this.stats.fallbacks += 1;

        if (cacheKey && cacheTTL > 0) {
          await this.cache.set<TOut>(cacheKey, result, cacheTTL);
        }

        await this.emitAudit(
          {
            traceId: ctx.traceId,
            providerId: provider.id,
            capability: req.capability,
            decision: 'pass',
            policyChecks: [],
            latencyMs,
            cached: false,
            fellBack,
            timestamp: new Date().toISOString(),
          },
          req.input,
        );
        this.stats.totalLatencyMs += Date.now() - startedAt;
        return result;
      } catch (err) {
        lastErr = err;
        this.breaker.recordFailure(breakerKey);
        await this.emitAudit(
          {
            traceId: ctx.traceId,
            providerId: provider.id,
            capability: req.capability,
            decision: 'fail',
            policyChecks: [],
            latencyMs: Date.now() - tStart,
            cached: false,
            fellBack: attempts > 1,
            timestamp: new Date().toISOString(),
          },
          { input: req.input, error: (err as Error).message },
        );
        if (!fallback) break;
      }
    }

    this.stats.failures += 1;
    this.stats.totalLatencyMs += Date.now() - startedAt;
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const wrapped = new Error(
      `ROUTER_ALL_PROVIDERS_FAILED capability=${req.capability} attempts=${attempts} lastError=${errMsg}`,
    );
    (wrapped as Error & { code?: string }).code = 'ROUTER_ALL_PROVIDERS_FAILED';
    throw wrapped;
  }

  getStats(): RouterStats & { avgLatencyMs: number; cacheHitRate: number; fallbackRate: number } {
    const calls = Math.max(this.stats.totalCalls, 1);
    return {
      ...this.stats,
      avgLatencyMs: Math.round(this.stats.totalLatencyMs / calls),
      cacheHitRate: this.stats.cacheHits / calls,
      fallbackRate: this.stats.fallbacks / calls,
    };
  }

  resetStats(): void {
    this.stats = { totalCalls: 0, cacheHits: 0, fallbacks: 0, failures: 0, totalLatencyMs: 0 };
  }

  private resolveCandidates(cap: Capability, minTrust?: TrustLevel, chainId?: number): IProvider[] {
    const ranked = this.registry.byCapability(cap);
    return ranked.filter((p) => {
      if (minTrust && TRUST_WEIGHT[p.trustLevel] < TRUST_WEIGHT[minTrust]) return false;
      const h = this.registry.getHealth(p.id);
      if (!h) return false;
      if (h.status !== 'healthy' && h.status !== 'degraded') return false;
      // Chain-aware filter: if provider implements supportsChain() and chainId is given,
      // only include providers that explicitly support this chain.
      if (chainId !== undefined && typeof (p as unknown as Record<string, unknown>).supportsChain === 'function') {
        const supports = (p as unknown as { supportsChain: (id: number) => boolean }).supportsChain(chainId);
        if (!supports) return false;
      }
      return true;
    });
  }

  private async emitAudit(ev: CanonicalAuditEvent, payload?: unknown): Promise<void> {
    void this.auditRepo.record(ev, payload);
  }
}

export const providerRouter = new ProviderRouter();

export type { AuditDecision };

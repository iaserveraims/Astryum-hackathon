import type { IProvider, ProviderHealth, Capability, HealthStatus } from '../interfaces/IProvider';
import { TRUST_WEIGHT, type ProviderType, type TrustLevel } from '../../canonical/types/Source';

const HEALTH_SCORE: Readonly<Record<HealthStatus, number>> = Object.freeze({
  healthy: 1.0,
  degraded: 0.5,
  down: 0,
  disabled: 0,
});

export interface ProviderSummary {
  id: string;
  type: ProviderType;
  trustLevel: TrustLevel;
  priority: number;
  capabilities: ReadonlyArray<Capability>;
  health: ProviderHealth;
}

export class IntegrationRegistry {
  private readonly providers = new Map<string, IProvider>();
  private readonly healthCache = new Map<string, ProviderHealth>();

  register(p: IProvider): void {
    if (this.providers.has(p.id)) {
      throw new Error(`Provider already registered: ${p.id}`);
    }
    this.providers.set(p.id, p);
    this.healthCache.set(p.id, {
      status: 'disabled',
      lastCheckAt: new Date().toISOString(),
      reason: 'not yet probed',
    });
  }

  unregister(id: string): void {
    this.providers.delete(id);
    this.healthCache.delete(id);
  }

  get(id: string): IProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): IProvider[] {
    return Array.from(this.providers.values());
  }

  byType(type: ProviderType): IProvider[] {
    return this.list().filter((p) => p.type === type);
  }

  byCapability(cap: Capability): IProvider[] {
    return this.list()
      .filter((p) => p.capabilities.includes(cap))
      .sort((a, b) => this.score(b) - this.score(a));
  }

  updateHealth(id: string, h: ProviderHealth): void {
    if (!this.providers.has(id)) return;
    this.healthCache.set(id, h);
  }

  getHealth(id: string): ProviderHealth | null {
    return this.healthCache.get(id) ?? null;
  }

  summaries(): ProviderSummary[] {
    return this.list().map((p) => ({
      id: p.id,
      type: p.type,
      trustLevel: p.trustLevel,
      priority: p.priority,
      capabilities: p.capabilities,
      health: this.getHealth(p.id) ?? {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
      },
    }));
  }

  private score(p: IProvider): number {
    const h = this.getHealth(p.id);
    const healthScore = HEALTH_SCORE[h?.status ?? 'disabled'];
    const trustWeight = TRUST_WEIGHT[p.trustLevel];
    return p.priority * trustWeight * healthScore;
  }

  clear(): void {
    this.providers.clear();
    this.healthCache.clear();
  }
}

export const registry = new IntegrationRegistry();

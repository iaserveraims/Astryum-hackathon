import type { Capability, ProviderCallContext, ProviderCallResult, ProviderHealth } from '../integrations/interfaces/IProvider';
import type { ProviderSummary } from '../integrations/registry/IntegrationRegistry';
import { IntegrationRegistry, registry as defaultRegistry } from '../integrations/registry/IntegrationRegistry';
import { ProviderRouter, providerRouter as defaultRouter, type CapabilityRequest } from './ProviderRouter';
import { bootstrapRegistry } from '../integrations/registry/bootstrap';
import { bootstrapV11ProtocolProviders } from '../integrations/providers/protocol';

export class ControlPlane {
  constructor(
    private readonly router: ProviderRouter = defaultRouter,
    private readonly registry: IntegrationRegistry = defaultRegistry,
  ) {}

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx?: Partial<ProviderCallContext>,
    options?: CapabilityRequest<TIn>['options'],
  ): Promise<ProviderCallResult<TOut>> {
    return this.router.call<TIn, TOut>({ capability, input, ctx, options });
  }

  listIntegrations(): ProviderSummary[] {
    return this.registry.summaries();
  }

  getIntegration(id: string): ProviderSummary | null {
    const p = this.registry.get(id);
    if (!p) return null;
    return {
      id: p.id,
      type: p.type,
      trustLevel: p.trustLevel,
      priority: p.priority,
      capabilities: p.capabilities,
      health: this.registry.getHealth(p.id) ?? {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
      },
    };
  }

  byCapability(capability: string): ProviderSummary[] {
    return this.registry
      .byCapability(capability)
      .map((p) => this.getIntegration(p.id))
      .filter((s): s is ProviderSummary => s !== null);
  }

  async probe(id: string): Promise<ProviderHealth> {
    const provider = this.registry.get(id);
    if (!provider) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'unknown provider',
      };
    }
    const start = Date.now();
    try {
      const h = await provider.health();
      const enriched: ProviderHealth = { ...h, latencyMs: h.latencyMs ?? Date.now() - start };
      this.registry.updateHealth(id, enriched);
      return enriched;
    } catch (err) {
      const failed: ProviderHealth = {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
      this.registry.updateHealth(id, failed);
      return failed;
    }
  }

  stats() {
    return this.router.getStats();
  }
}

bootstrapRegistry();
bootstrapV11ProtocolProviders();

export const controlPlane = new ControlPlane();

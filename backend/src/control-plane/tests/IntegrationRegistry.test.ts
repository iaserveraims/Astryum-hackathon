import { IntegrationRegistry } from '../../integrations/registry/IntegrationRegistry';
import type { IProvider, ProviderHealth, ProviderCallContext, ProviderCallResult } from '../../integrations/interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../canonical/types/Source';

function makeProvider(opts: Partial<IProvider> & { id: string }): IProvider {
  return {
    id: opts.id,
    type: (opts.type ?? 'chain') as ProviderType,
    capabilities: opts.capabilities ?? ['cap.x'],
    trustLevel: (opts.trustLevel ?? 'onchain_verified') as TrustLevel,
    priority: opts.priority ?? 50,
    health: opts.health ?? (async () => ({ status: 'healthy', lastCheckAt: new Date().toISOString() })),
    call: opts.call ?? (async function call<TIn, TOut>(_c: string, _i: TIn, ctx: ProviderCallContext): Promise<ProviderCallResult<TOut>> {
      const source: SourceRecord = {
        providerId: opts.id,
        providerType: (opts.type ?? 'chain') as ProviderType,
        trustLevel: (opts.trustLevel ?? 'onchain_verified') as TrustLevel,
        fetchedAt: new Date().toISOString(),
        traceId: ctx.traceId,
      };
      return { data: null as unknown as TOut, source, cached: false };
    }),
  };
}

describe('IntegrationRegistry', () => {
  it('registers providers and rejects duplicates', () => {
    const reg = new IntegrationRegistry();
    reg.register(makeProvider({ id: 'a' }));
    expect(() => reg.register(makeProvider({ id: 'a' }))).toThrow(/already registered/);
    expect(reg.list()).toHaveLength(1);
  });

  it('byCapability orders by priority * trustWeight * healthScore', () => {
    const reg = new IntegrationRegistry();
    reg.register(makeProvider({ id: 'low', capabilities: ['c'], priority: 50, trustLevel: 'unverified' }));
    reg.register(makeProvider({ id: 'high', capabilities: ['c'], priority: 100, trustLevel: 'onchain_verified' }));
    reg.register(makeProvider({ id: 'mid', capabilities: ['c'], priority: 80, trustLevel: 'oracle_verified' }));
    const now = new Date().toISOString();
    reg.updateHealth('low', { status: 'healthy', lastCheckAt: now });
    reg.updateHealth('high', { status: 'healthy', lastCheckAt: now });
    reg.updateHealth('mid', { status: 'healthy', lastCheckAt: now });

    const ranked = reg.byCapability('c').map((p) => p.id);
    expect(ranked).toEqual(['high', 'mid', 'low']);
  });

  it('byCapability deprioritises down providers', () => {
    const reg = new IntegrationRegistry();
    reg.register(makeProvider({ id: 'primary', capabilities: ['c'], priority: 100 }));
    reg.register(makeProvider({ id: 'backup', capabilities: ['c'], priority: 30, trustLevel: 'unverified' }));
    const now = new Date().toISOString();
    reg.updateHealth('primary', { status: 'down', lastCheckAt: now });
    reg.updateHealth('backup', { status: 'healthy', lastCheckAt: now });

    expect(reg.byCapability('c')[0].id).toBe('backup');
  });

  it('updateHealth persists', () => {
    const reg = new IntegrationRegistry();
    reg.register(makeProvider({ id: 'p' }));
    const now = new Date().toISOString();
    reg.updateHealth('p', { status: 'degraded', lastCheckAt: now, reason: 'slow' });
    expect(reg.getHealth('p')?.status).toBe('degraded');
    expect(reg.getHealth('p')?.reason).toBe('slow');
  });
});

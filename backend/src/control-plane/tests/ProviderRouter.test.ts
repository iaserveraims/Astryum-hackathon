import { IntegrationRegistry } from '../../integrations/registry/IntegrationRegistry';
import { ProviderRouter } from '../ProviderRouter';
import { CircuitBreaker } from '../CircuitBreaker';
import { RouterCache } from '../RouterCache';
import type { IProvider, ProviderCallContext, ProviderCallResult } from '../../integrations/interfaces/IProvider';
import type { TrustLevel, ProviderType, SourceRecord } from '../../canonical/types/Source';

class FakeAuditRepo {
  events: any[] = [];
  async record(ev: any, payload?: unknown) {
    this.events.push({ ev, payload });
  }
}

function provider(opts: {
  id: string;
  capability: string;
  priority?: number;
  trust?: TrustLevel;
  type?: ProviderType;
  call?: (input: unknown, ctx: ProviderCallContext) => Promise<unknown>;
  fail?: boolean;
  failTimes?: number;
}): IProvider {
  let failCount = 0;
  return {
    id: opts.id,
    type: opts.type ?? 'chain',
    capabilities: [opts.capability],
    trustLevel: opts.trust ?? 'onchain_verified',
    priority: opts.priority ?? 50,
    async health() {
      return { status: 'healthy', lastCheckAt: new Date().toISOString() };
    },
    async call<TIn, TOut>(_cap: string, input: TIn, ctx: ProviderCallContext): Promise<ProviderCallResult<TOut>> {
      const shouldFail = opts.fail || (opts.failTimes != null && failCount < opts.failTimes);
      if (shouldFail) {
        failCount++;
        throw new Error(`fail-${opts.id}`);
      }
      const data = (opts.call ? await opts.call(input, ctx) : { ok: true, id: opts.id }) as TOut;
      const source: SourceRecord = {
        providerId: opts.id,
        providerType: opts.type ?? 'chain',
        trustLevel: opts.trust ?? 'onchain_verified',
        fetchedAt: new Date().toISOString(),
        traceId: ctx.traceId,
      };
      return { data, source, cached: false };
    },
  };
}

function setup(providers: IProvider[]) {
  const registry = new IntegrationRegistry();
  for (const p of providers) {
    registry.register(p);
    registry.updateHealth(p.id, { status: 'healthy', lastCheckAt: new Date().toISOString() });
  }
  const cache = new RouterCache();
  const breaker = new CircuitBreaker();
  const audit = new FakeAuditRepo();
  const router = new ProviderRouter(registry, cache, breaker, audit as any);
  return { router, registry, cache, breaker, audit };
}

describe('ProviderRouter', () => {
  it('selects highest-ranked provider', async () => {
    const { router } = setup([
      provider({ id: 'low', capability: 'c.x', priority: 30, trust: 'unverified' }),
      provider({ id: 'high', capability: 'c.x', priority: 100, trust: 'onchain_verified' }),
    ]);
    const r = await router.call({ capability: 'c.x', input: {} });
    expect(r.source.providerId).toBe('high');
  });

  it('falls back to next provider on primary failure', async () => {
    const { router, audit } = setup([
      provider({ id: 'primary', capability: 'c.x', priority: 100, fail: true }),
      provider({ id: 'backup', capability: 'c.x', priority: 50 }),
    ]);
    const r = await router.call({ capability: 'c.x', input: {} });
    expect(r.source.providerId).toBe('backup');
    const audited = audit.events.map((e) => e.ev.providerId + ':' + e.ev.decision);
    expect(audited).toContain('primary:fail');
    expect(audited).toContain('backup:pass');
  });

  it('returns cached result on second call within TTL', async () => {
    const calls: string[] = [];
    const p = provider({
      id: 'p1',
      capability: 'c.cached',
      call: async () => {
        calls.push('hit');
        return { v: 42 };
      },
    });
    const { router } = setup([p]);
    const a = await router.call({ capability: 'c.cached', input: { k: 1 }, options: { cacheTTL: 30 } });
    const b = await router.call({ capability: 'c.cached', input: { k: 1 }, options: { cacheTTL: 30 } });
    expect(calls).toHaveLength(1);
    expect(b.cached).toBe(true);
    expect(b.source.providerId).toBe('p1');
    expect(a.cached).toBe(false);
  });

  it('bypassCache forces a fresh call', async () => {
    const calls: string[] = [];
    const p = provider({
      id: 'p1',
      capability: 'c.bypass',
      call: async () => {
        calls.push('hit');
        return { v: 1 };
      },
    });
    const { router } = setup([p]);
    await router.call({ capability: 'c.bypass', input: {}, options: { cacheTTL: 30 } });
    await router.call({ capability: 'c.bypass', input: {}, options: { cacheTTL: 30, bypassCache: true } });
    expect(calls).toHaveLength(2);
  });

  it('minTrustLevel filters out lower-trust providers', async () => {
    const { router } = setup([
      provider({ id: 'oracle', capability: 'c.x', priority: 50, trust: 'oracle_verified' }),
      provider({ id: 'community', capability: 'c.x', priority: 100, trust: 'community' }),
    ]);
    const r = await router.call({
      capability: 'c.x',
      input: {},
      options: { minTrustLevel: 'oracle_verified' },
    });
    expect(r.source.providerId).toBe('oracle');
  });

  it('throws NO_PROVIDER_AVAILABLE when capability has no provider', async () => {
    const { router } = setup([provider({ id: 'p', capability: 'c.x' })]);
    await expect(router.call({ capability: 'c.unknown', input: {} })).rejects.toThrow(/NO_PROVIDER_AVAILABLE/);
  });

  it('emits AuditEvent on every call (pass and fail)', async () => {
    const { router, audit } = setup([
      provider({ id: 'p', capability: 'c.audit' }),
      provider({ id: 'q', capability: 'c.fail', fail: true }),
    ]);
    await router.call({ capability: 'c.audit', input: {} });
    await expect(router.call({ capability: 'c.fail', input: {} })).rejects.toThrow();
    expect(audit.events.length).toBeGreaterThanOrEqual(2);
    const decisions = audit.events.map((e) => e.ev.decision);
    expect(decisions).toContain('pass');
    expect(decisions).toContain('fail');
  });

  it('circuit opens after 3 consecutive failures', async () => {
    const { router, breaker } = setup([provider({ id: 'flaky', capability: 'c.x', fail: true })]);
    for (let i = 0; i < 3; i++) {
      await expect(router.call({ capability: 'c.x', input: {} })).rejects.toThrow();
    }
    expect(breaker.isOpen('flaky:c.x')).toBe(true);
  });
});

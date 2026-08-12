/**
 * ProviderHealthService — transition alerts.
 *
 * Pins the 2026-08-01 rule: a StubProvider (real provider not wired yet) is
 * 'down' BY CONSTRUCTION and can never recover — it must never page the ops
 * channel. Real providers keep the 3-consecutive-ticks alert and the recovery
 * notice. (The stubs' state stays visible in the admin panel either way.)
 */

const opsAlert = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../services/OpsAlertService', () => ({
  opsAlert: (...args: unknown[]) => opsAlert(...args),
}));

import { IntegrationRegistry } from '../IntegrationRegistry';
import { ProviderHealthService } from '../ProviderHealthService';
import { StubProvider } from '../StubProvider';
import type { IProvider, ProviderHealth } from '../../interfaces/IProvider';

function realProvider(id: string, healthRef: { status: ProviderHealth['status'] }): IProvider {
  return {
    id,
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: [],
    health: async () => ({ status: healthRef.status, lastCheckAt: new Date().toISOString() }),
    call: async () => {
      throw new Error('not under test');
    },
  } as unknown as IProvider;
}

describe('ProviderHealthService transition alerts', () => {
  beforeEach(() => opsAlert.mockClear());

  it('never alerts for a stub, alerts once for a real provider after 3 down ticks', async () => {
    const registry = new IntegrationRegistry();
    registry.register(
      new StubProvider({
        id: 'uniswapx',
        type: 'data',
        trustLevel: 'indexer_verified',
        priority: 50,
        capabilities: [],
        enabled: true, // enabled-but-unwired: health() answers 'down' forever
      }),
    );
    const health = { status: 'down' as ProviderHealth['status'] };
    registry.register(realProvider('xrpl-rpc', health));

    const svc = new ProviderHealthService(registry, 60_000);
    await svc.tick();
    await svc.tick();
    expect(opsAlert).not.toHaveBeenCalled(); // 2 ticks — under the threshold
    await svc.tick();

    expect(opsAlert).toHaveBeenCalledTimes(1);
    expect(String(opsAlert.mock.calls[0][2])).toContain('xrpl-rpc');
    expect(opsAlert.mock.calls.every((c) => !String(c[2]).includes('uniswapx'))).toBe(true);

    // Recovery: only the real provider announces it.
    health.status = 'healthy';
    await svc.tick();
    expect(opsAlert).toHaveBeenCalledTimes(2);
    expect(String(opsAlert.mock.calls[1][2])).toContain('xrpl-rpc');
    expect(String(opsAlert.mock.calls[1][2])).toContain('recuperado');
  });

  it('a disabled stub stays silent too', async () => {
    const registry = new IntegrationRegistry();
    registry.register(
      new StubProvider({
        id: 'sei-explorer',
        type: 'explorer',
        trustLevel: 'indexer_verified',
        priority: 50,
        capabilities: [],
        enabled: false,
      }),
    );
    const svc = new ProviderHealthService(registry, 60_000);
    await svc.tick();
    await svc.tick();
    await svc.tick();
    expect(opsAlert).not.toHaveBeenCalled();
  });
});

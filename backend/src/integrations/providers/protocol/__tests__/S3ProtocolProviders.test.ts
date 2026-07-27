jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

import { IntegrationRegistry } from '../../../registry/IntegrationRegistry';
import { bootstrapRegistry } from '../../../registry/bootstrap';
import {
  bootstrapV11ProtocolProviders,
  KineticProvider,
  SparkdexProvider,
  FirelightProvider,
  EnosysProvider,
} from '..';
import type { ProviderCallContext } from '../../../interfaces/IProvider';

const WALLET = '0x000000000000000000000000000000000000abcd';

function makeCtx(overrides: Partial<ProviderCallContext> = {}): ProviderCallContext {
  return { traceId: 'trace-s3', wallet: WALLET, sessionId: 'sess-s3', ...overrides };
}

describe('V1.1 S3 protocol providers (kinetic / sparkdex / firelight / enosys)', () => {
  test('bootstrap registers the 4 S3 protocol providers', () => {
    const reg = new IntegrationRegistry();
    bootstrapRegistry(reg);
    bootstrapV11ProtocolProviders(reg);
    expect(reg.get('kinetic')).toBeInstanceOf(KineticProvider);
    expect(reg.get('sparkdex')).toBeInstanceOf(SparkdexProvider);
    expect(reg.get('firelight')).toBeInstanceOf(FirelightProvider);
    expect(reg.get('enosys')).toBeInstanceOf(EnosysProvider);
  });

  test('each provider exposes the canonical protocol capabilities incl. getMetrics', () => {
    for (const p of [
      new KineticProvider(),
      new SparkdexProvider(),
      new FirelightProvider(),
      new EnosysProvider(),
    ]) {
      expect(p.type).toBe('protocol');
      expect(p.trustLevel).toBe('protocol_native');
      expect(p.capabilities).toEqual(
        expect.arrayContaining([
          'protocol.discoverPositions',
          'protocol.simulateAction',
          'protocol.prepareIntent',
          'protocol.getMetrics',
        ]),
      );
    }
  });

  test('health() reports disabled while adapter is inactive (env vars missing)', async () => {
    // None of the S3 protocol env vars (KINETIC_COMPTROLLER, SPARKDEX_NFPM,
    // FIRELIGHT_STAKING + STXRP, ENOSYS_ROUTER+FACTORY) are set in the test
    // env, so all four should report `disabled` rather than fail loudly.
    const providers = [
      new KineticProvider(),
      new SparkdexProvider(),
      new FirelightProvider(),
      new EnosysProvider(),
    ];
    const healths = await Promise.all(providers.map((p) => p.health()));
    for (const h of healths) {
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/inactive/i);
    }
  });

  test('discoverPositions returns [] for inactive adapters with SourceRecord stamped', async () => {
    const p = new KineticProvider();
    const r = await p.discoverPositions(WALLET, makeCtx());
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data).toHaveLength(0);
    expect(r.source.providerId).toBe('kinetic');
    expect(r.source.providerType).toBe('protocol');
    expect(r.source.trustLevel).toBe('protocol_native');
    expect(r.source.traceId).toBe('trace-s3');
    expect(r.cached).toBe(false);
  });

  test('getMetrics returns empty map for inactive adapters with SourceRecord stamped', async () => {
    const p = new SparkdexProvider();
    const r = await p.getMetrics(WALLET, makeCtx());
    expect(r.data).toEqual({});
    expect(r.source.providerId).toBe('sparkdex');
  });

  test('generic call() routes protocol.discoverPositions and protocol.getMetrics', async () => {
    const p = new EnosysProvider();
    const r1 = await p.call<{ wallet: string }, unknown>(
      'protocol.discoverPositions',
      { wallet: WALLET },
      makeCtx(),
    );
    expect(Array.isArray((r1.data as unknown[]) ?? null)).toBe(true);
    expect(r1.source.providerId).toBe('enosys');

    const r2 = await p.call<{ wallet: string }, unknown>(
      'protocol.getMetrics',
      { wallet: WALLET },
      makeCtx(),
    );
    expect(typeof r2.data).toBe('object');
    expect(r2.source.providerId).toBe('enosys');
  });
});

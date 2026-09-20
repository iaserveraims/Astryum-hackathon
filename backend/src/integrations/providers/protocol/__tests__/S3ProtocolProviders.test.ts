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
import { resetAddressCache } from '../../../../config/protocolAddresses';

const WALLET = '0x000000000000000000000000000000000000abcd';

function makeCtx(overrides: Partial<ProviderCallContext> = {}): ProviderCallContext {
  return { traceId: 'trace-s3', wallet: WALLET, sessionId: 'sess-s3', ...overrides };
}

// The env vars that switch each S3 adapter on (KineticAdapter / SparkDEXAdapter
// / FirelightAdapter / EnosysAdapter `isActive`). Prisma loads backend/.env when
// its client is constructed — imported transitively through the registry — so a
// developer's own .env made the adapters ACTIVE and broke the «inactive»
// assertions below, while CI (no .env) stayed green. Blank them per test: ''
// reads as unset, and dotenv never overwrites a key that already exists, so a
// later Prisma load cannot bring the values back. The address cache is dropped
// too, or a cached object keeps the adapters on.
const S3_ADAPTER_ENV = [
  'KINETIC_COMPTROLLER',
  'KINETIC_ISO_COMPTROLLER',
  'SPARKDEX_NFPM',
  'FIRELIGHT_STAKING',
  'FIRELIGHT_STXRP',
  'ENOSYS_ROUTER',
  'ENOSYS_FARMING',
] as const;
let savedAdapterEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedAdapterEnv = {};
  for (const key of S3_ADAPTER_ENV) {
    savedAdapterEnv[key] = process.env[key];
    process.env[key] = '';
  }
  resetAddressCache();
});

afterEach(() => {
  for (const key of S3_ADAPTER_ENV) {
    if (savedAdapterEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedAdapterEnv[key];
  }
  resetAddressCache();
});

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
    // beforeEach blanks every activation var (S3_ADAPTER_ENV), so all four
    // should report `disabled` rather than fail loudly.
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

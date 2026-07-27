import { FxrpMonitorProvider } from '../FxrpMonitorProvider';
import type { ControlPlane } from '../../../../control-plane/ControlPlane';

const WALLET = '0x000000000000000000000000000000000000abcd';
const FXRP = '0x000000000000000000000000000000000000fA55';

const ORIG_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

const mkCp = (returns: { call?: (cap: string, input: any) => any }): ControlPlane =>
  ({
    call: jest.fn(async (cap: string, input: any) => returns.call?.(cap, input)),
  }) as unknown as ControlPlane;

describe('FxrpMonitorProvider', () => {
  test('health = disabled when FXRP_TOKEN env missing', async () => {
    delete process.env.FXRP_TOKEN;
    const p = new FxrpMonitorProvider(mkCp({}));
    const h = await p.health();
    expect(h.status).toBe('disabled');
    expect(h.reason).toMatch(/FXRP_TOKEN/);
  });

  test('health = healthy when FXRP_TOKEN set', async () => {
    process.env.FXRP_TOKEN = FXRP;
    // Bypass the cached protocolAddresses singleton by requiring fresh
    jest.resetModules();
    const fresh = require('../FxrpMonitorProvider').FxrpMonitorProvider as typeof FxrpMonitorProvider;
    const p = new fresh(mkCp({}));
    const h = await p.health();
    expect(h.status).toBe('healthy');
  });

  test('getExposure returns [] when balance is zero', async () => {
    process.env.FXRP_TOKEN = FXRP;
    jest.resetModules();
    const fresh = require('../FxrpMonitorProvider').FxrpMonitorProvider as typeof FxrpMonitorProvider;
    const cp = mkCp({
      call: (cap) => {
        if (cap === 'chain.call') return { data: '0x00', source: {}, cached: false };
        if (cap === 'oracle.getPrice') return { data: { price: 0.5 }, source: {}, cached: false };
        return { data: null, source: {}, cached: false };
      },
    });
    const p = new fresh(cp);
    const r = await p.getExposure(WALLET, { traceId: 't', wallet: WALLET, sessionId: 's' });
    expect(r.data).toEqual([]);
    expect(r.source.providerId).toBe('fxrp-monitor');
    expect(r.source.trustLevel).toBe('onchain_verified');
  });

  test('getExposure emits CanonicalPosition kind=free with priceUSD when balance > 0', async () => {
    process.env.FXRP_TOKEN = FXRP;
    jest.resetModules();
    const fresh = require('../FxrpMonitorProvider').FxrpMonitorProvider as typeof FxrpMonitorProvider;
    const cp = mkCp({
      call: (cap) => {
        if (cap === 'chain.call')
          return {
            data: '0x' + (1_000_000n).toString(16).padStart(64, '0'),
            source: {},
            cached: false,
          };
        if (cap === 'oracle.getPrice') return { data: { price: 0.5 }, source: {}, cached: false };
        return { data: null, source: {}, cached: false };
      },
    });
    const p = new fresh(cp);
    const r = await p.getExposure(WALLET, { traceId: 't', wallet: WALLET, sessionId: 's' });
    expect(r.data).toHaveLength(1);
    const pos = r.data[0];
    expect(pos.kind).toBe('free');
    expect(pos.protocol).toBe('fxrp');
    expect(pos.assets[0].asset.symbol).toBe('FXRP');
    expect(pos.assets[0].asset.priceUSD).toBe(0.5);
    expect(pos.assets[0].amount).toBe('1000000');
  });

  test('protocol.discoverPositions capability dispatches to getExposure', async () => {
    process.env.FXRP_TOKEN = FXRP;
    jest.resetModules();
    const fresh = require('../FxrpMonitorProvider').FxrpMonitorProvider as typeof FxrpMonitorProvider;
    const cp = mkCp({
      call: (cap) => {
        if (cap === 'chain.call') return { data: '0x00', source: {}, cached: false };
        return { data: { price: 0.5 }, source: {}, cached: false };
      },
    });
    const p = new fresh(cp);
    const r = await p.call(
      'protocol.discoverPositions',
      { wallet: WALLET },
      { traceId: 't', wallet: WALLET, sessionId: 's' },
    );
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.source.providerId).toBe('fxrp-monitor');
  });
});

jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

import { FlareLpV3Adapter } from '../FlareLpV3Adapter';
import { FlareLpV2Adapter } from '../FlareLpV2Adapter';
import {
  FLARE_LP_V3_VENUES,
  FLARE_LP_V2_VENUES,
  FLARE_MULTICALL3,
} from '../../../../config/flareLpVenues';

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

describe('flareLpVenues registry', () => {
  test('every venue carries a well-formed address and a unique id', () => {
    const ids = new Set<string>();
    for (const v of FLARE_LP_V3_VENUES) {
      expect(ADDR_RE.test(v.npm)).toBe(true);
      expect(['univ3', 'algebra']).toContain(v.tupleStyle);
      expect(ids.has(v.id)).toBe(false);
      ids.add(v.id);
    }
    for (const v of FLARE_LP_V2_VENUES) {
      expect(ADDR_RE.test(v.factory)).toBe(true);
      expect(ids.has(v.id)).toBe(false);
      ids.add(v.id);
    }
    expect(ADDR_RE.test(FLARE_MULTICALL3)).toBe(true);
  });

  test('covers the DeFiLlama Flare LP ecosystem (2026-07-11 review)', () => {
    const ids = [
      ...FLARE_LP_V3_VENUES.map((v) => v.id),
      ...FLARE_LP_V2_VENUES.map((v) => v.id),
    ];
    // sparkdex-v3.1 deliberately absent — the existing SparkDEXAdapter owns it.
    expect(ids).toEqual(
      expect.arrayContaining(['sparkdex-v4', 'enosys-v3', 'blazeswap', 'sparkdex-v2', 'enosys-v2', 'pangolin']),
    );
    expect(ids).not.toContain('sparkdex'); // no protocolId collision with SparkDEXAdapter
  });

  test('SparkDEX V4 is the Algebra layout, Enosys V3 the UniV3 layout (on-chain verified)', () => {
    expect(FLARE_LP_V3_VENUES.find((v) => v.id === 'sparkdex-v4')?.tupleStyle).toBe('algebra');
    expect(FLARE_LP_V3_VENUES.find((v) => v.id === 'enosys-v3')?.tupleStyle).toBe('univ3');
  });
});

describe('FlareLp adapters', () => {
  test('one active adapter per venue, protocolId == venue id, chain 14', () => {
    for (const v of FLARE_LP_V3_VENUES) {
      const a = new FlareLpV3Adapter(v);
      expect(a.isActive).toBe(true);
      expect(a.protocolId).toBe(v.id);
      expect(a.chainId).toBe(14);
    }
    for (const v of FLARE_LP_V2_VENUES) {
      const a = new FlareLpV2Adapter(v);
      expect(a.isActive).toBe(true);
      expect(a.protocolId).toBe(v.id);
      expect(a.chainId).toBe(14);
    }
  });

  test('tracking-only: simulateAction refuses to model LP actions and says why', async () => {
    const a = new FlareLpV3Adapter(FLARE_LP_V3_VENUES[0]);
    const r = await a.simulateAction({
      kind: 'addLiquidity',
      protocolId: a.protocolId,
      chainId: 14,
      wallet: '0x000000000000000000000000000000000000abcd',
      inputs: {},
    });
    expect(r.success).toBe(false);
    expect(r.warnings.some((w) => /tracking-only/.test(w))).toBe(true);

    const b = new FlareLpV2Adapter(FLARE_LP_V2_VENUES[0]);
    const r2 = await b.simulateAction({
      kind: 'exitLP',
      protocolId: b.protocolId,
      chainId: 14,
      wallet: '0x000000000000000000000000000000000000abcd',
      inputs: {},
    });
    expect(r2.success).toBe(false);
    expect(r2.warnings.some((w) => /tracking-only/.test(w))).toBe(true);
  });

  test('normalizePosition keeps venue metadata for the board (raw.token label)', () => {
    const a = new FlareLpV2Adapter(FLARE_LP_V2_VENUES[0]);
    const n = a.normalizePosition({
      protocolId: a.protocolId,
      chainId: 14,
      wallet: '0x000000000000000000000000000000000000abcd',
      kind: 'LP',
      asset: 'WFLR/USDC',
      amount: 5n,
      raw: { token: 'WFLR/USDC LP', venue: 'BlazeSwap' },
      discoveredAt: new Date(),
    });
    expect(n.metadata.token).toBe('WFLR/USDC LP');
    expect(n.metadata.venue).toBe('BlazeSwap');
    expect(n.kind).toBe('LP');
  });
});

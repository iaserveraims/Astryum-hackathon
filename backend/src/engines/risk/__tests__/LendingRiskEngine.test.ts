import { LendingRiskEngine } from '../LendingRiskEngine';
import type { NormalizedPosition, PositionMetrics } from '../../../types/domain/Position';

function position(kind: 'BORROW' | 'SUPPLY', amountUSD: number): NormalizedPosition {
  return {
    protocolId: 'kinetic',
    chainId: 14,
    wallet: '0x000000000000000000000000000000000000abcd',
    kind,
    asset: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
    amount: 11_737_330n,
    amountUSD,
    priceUSD: 1,
    metadata: {},
    takenAt: new Date(),
  } as NormalizedPosition;
}

describe('LendingRiskEngine — exact liquidation price exposure (C2)', () => {
  test('passes the adapter-computed liquidationPrice through to liquidationPriceUSD', () => {
    const metrics: PositionMetrics = { hf: 1.8, ltv: 0.42, liquidationPrice: 1.73 };
    const snap = LendingRiskEngine.evaluate(position('BORROW', 11.73), metrics);
    expect(snap.liquidationPriceUSD).toBe(1.73);
    // existing fields still computed
    expect(snap.healthFactor).toBe(1.8);
    expect(snap.liquidationDistanceUSD).toBeGreaterThan(0);
  });

  test('leaves liquidationPriceUSD undefined when the adapter did not resolve one (no debt / no price)', () => {
    const snap = LendingRiskEngine.evaluate(position('SUPPLY', 0), { hf: undefined, ltv: 0 });
    expect(snap.liquidationPriceUSD).toBeUndefined();
  });
});

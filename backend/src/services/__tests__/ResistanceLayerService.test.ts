import { ResistanceLayerService } from '../ResistanceLayerService';

const svc = new ResistanceLayerService();

describe('ResistanceLayerService (D8 pre-sign disclosure)', () => {
  test('same-chain, self destination, small → low risk, no ack', () => {
    const a = svc.assess({ fromChainId: 1, toChainId: 1, asset: 'USDC', amountUSD: 100, destinationIsSelf: true });
    expect(a.isCrossChain).toBe(false);
    expect(a.level).toBe('low');
    expect(a.requiresAck).toBe(false);
  });

  test('cross-chain with a bridge → medium + discloses bridge risk + requires ack', () => {
    const a = svc.assess({ fromChainId: 1, toChainId: 14, asset: 'USDC', bridge: 'LayerZero' });
    expect(a.isCrossChain).toBe(true);
    expect(a.level).toBe('medium');
    expect(a.requiresAck).toBe(true);
    expect(a.disclosures.join(' ')).toMatch(/LayerZero/);
  });

  test('cross-chain WITHOUT a named bridge → high', () => {
    const a = svc.assess({ fromChainId: 1, toChainId: 14, asset: 'USDC' });
    expect(a.level).toBe('high');
    expect(a.warnings.join(' ')).toMatch(/No bridge/);
  });

  test('external destination → high + warning', () => {
    const a = svc.assess({ fromChainId: 1, toChainId: 1, asset: 'USDC', destinationIsSelf: false });
    expect(a.level).toBe('high');
    expect(a.warnings.join(' ')).toMatch(/leave your control/);
  });

  test('large movement bumps disclosure', () => {
    const a = svc.assess({ fromChainId: 1, toChainId: 1, asset: 'USDC', amountUSD: 50000, destinationIsSelf: true });
    expect(a.level).toBe('medium');
    expect(a.disclosures.join(' ')).toMatch(/Large movement/);
  });
});

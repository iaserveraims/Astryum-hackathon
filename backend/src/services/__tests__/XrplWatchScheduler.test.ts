/**
 * XrplWatchScheduler — tests del detector puro de desbloqueos. El scheduler
 * en sí (timer + alertas) es integración; aquí se fija QUÉ cuenta como "un
 * gate se desbloqueó" y que las claves de-duplican por hallazgo.
 */
import { detectUnlockEvents } from '../XrplWatchScheduler';
import type { XrplWatchResult } from '../../connectors/protocols/xrpl/XrplEcosystemWatch';

function baseResult(over: Partial<XrplWatchResult> = {}): XrplWatchResult {
  return {
    checkedAt: '2026-07-13T00:00:00.000Z',
    amendments: [],
    issuerEscrows: [],
    sidechain: { venues: [], hasRealVenue: false },
    errors: [],
    ...over,
  };
}

describe('detectUnlockEvents', () => {
  it('estado aparcado de hoy (todo gated) → cero eventos, cero ruido', () => {
    const res = baseResult({
      amendments: [
        { name: 'SmartEscrow', exists: false, enabled: false },
        { name: 'Batch', exists: true, enabled: false, count: 12, validations: 35, threshold: 28 },
      ],
      issuerEscrows: [
        { label: 'RLUSD', address: 'r…', trustLineLockingEnabled: false, rawFlags: 0x819a0000 },
      ],
    });
    expect(detectUnlockEvents(res)).toEqual([]);
  });

  it('amendment activado → evento con clave estable', () => {
    const res = baseResult({
      amendments: [{ name: 'SmartEscrow', exists: true, enabled: true }],
    });
    const evs = detectUnlockEvents(res);
    expect(evs).toHaveLength(1);
    expect(evs[0].key).toBe('amendment:SmartEscrow:enabled');
    expect(evs[0].message).toContain('SmartEscrow');
  });

  it('votación que alcanza el threshold (sin activar aún) → evento majority', () => {
    const res = baseResult({
      amendments: [
        { name: 'Batch', exists: true, enabled: false, count: 28, validations: 35, threshold: 28 },
      ],
    });
    expect(detectUnlockEvents(res)[0].key).toBe('amendment:Batch:majority');
  });

  it('emisor que enciende el flag + venue real del sidechain → un evento cada uno', () => {
    const res = baseResult({
      issuerEscrows: [
        { label: 'EURØP', address: 'r…', trustLineLockingEnabled: true, rawFlags: 0xc0900000 },
      ],
      sidechain: {
        venues: [{ name: 'NewMoneyMarket', category: 'Lending', tvlUSD: 3e6 }],
        hasRealVenue: true,
      },
    });
    const keys = detectUnlockEvents(res).map((e) => e.key);
    expect(keys).toEqual(['issuer:EURØP', 'sidechain-venue']);
  });

  it('asset manager FAssets ≠ FXRP (¿FBTC?) → evento; FXRP solo → nada', () => {
    const res = baseResult();
    expect(detectUnlockEvents(res, [{ manager: '0xA', symbol: 'FXRP' }])).toEqual([]);
    const evs = detectUnlockEvents(res, [
      { manager: '0xA', symbol: 'FXRP' },
      { manager: '0xB', symbol: 'FBTC' },
    ]);
    expect(evs).toHaveLength(1);
    expect(evs[0].key).toBe('fassets:FBTC:0xb');
    expect(evs[0].message).toContain('FBTC');
  });
});

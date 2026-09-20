/**
 * De la cadena a la tarjeta — la parte pura de useCatalogPolicies.
 */
import { describe, expect, it } from 'vitest';
import { policyCardsFromCatalog } from '../institutional/useCatalogPolicies';
import type { PoteCatalogEntry } from '../institutional/api';

const t = (s: string) => s;
const base: PoteCatalogEntry = {
  pote: '0xb0b0000000000000000000000000000000000011',
  name: 'Pote de jaula',
  symbol: 'pj-FXRP',
  asset: { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', symbol: 'FXRP', decimals: 6 },
  totalAssets: '1000000',
  cooldownSeconds: 0,
  bufferFloorBps: 1000,
  maxVenueBps: 10000,
  venues: [{ id: 0, target: '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3', kind: 1, readyInSeconds: 0, retired: false }],
  councilXrplAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
  gated: false,
  unreadable: false,
  generation: 'v2',
  cage: '0xca9e000000000000000000000000000000000001',
  maxDepositPerUser: '50000000',
};

describe('policyCardsFromCatalog', () => {
  it('el título es el nombre del pote y la clave su dirección; la frase dice quién, cuántos destinos y el tope', () => {
    const [c] = policyCardsFromCatalog([base], t);
    expect(c.key).toBe(base.pote);
    expect(c.poteAddress).toBe(base.pote);
    expect(c.title).toBe('Pote de jaula');
    expect(c.strategyLine).toBe('Run by r1ypgo…MuoG · 1 destination · max per account 50 FXRP');
    expect(c.exitLine).toBe('Exit: immediate');
    expect(c.exitSeconds).toBe(0);
    expect(c.generation).toBe('v2');
    expect(c.cage).toBe(base.cage);
  });

  it('sin tope (0 o null) la frase no lo menciona; con cooldown la salida lo dice', () => {
    const [a, b] = policyCardsFromCatalog(
      [
        { ...base, maxDepositPerUser: '0' },
        { ...base, maxDepositPerUser: null, cooldownSeconds: 72 * 3600, venues: [] },
      ],
      t,
    );
    expect(a.strategyLine).not.toMatch(/max per account/);
    expect(b.strategyLine).toBe('Run by r1ypgo…MuoG · 0 destinations');
    expect(b.exitLine).toBe('Exit: 3 day(s)');
    expect(b.exitSeconds).toBe(72 * 3600);
  });

  it('un pote ilegible sale con su dirección y una frase que no afirma nada', () => {
    const [c] = policyCardsFromCatalog([{ ...base, name: null, unreadable: true, councilXrplAddress: null }], t);
    expect(c.title).toBe('0xb0b0…0011');
    expect(c.strategyLine).toMatch(/Could not read/);
    expect(c.unreadable).toBe(true);
  });

  it('respeta el orden de entrada: no reordena', () => {
    const cards = policyCardsFromCatalog([{ ...base, pote: '0x' + '1'.repeat(40) }, { ...base, pote: '0x' + '2'.repeat(40) }], t);
    expect(cards.map((c) => c.key)).toEqual(['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)]);
  });
});

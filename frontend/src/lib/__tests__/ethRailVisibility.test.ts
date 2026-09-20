/**
 * H10 — el kill-switch caliente tiene que ser caliente TAMBIÉN en el dinero.
 *
 * `NEXT_PUBLIC_*` se incrusta en el BUILD. Con la flag construida en true,
 * apagar el carril en el backend escondía las cards de Earn… y dejaba la
 * posición de Ethereum VISIBLE en el portfolio: el producto decía «apagado»
 * mientras el dinero seguía en pantalla. Peor aún al revés — encenderlo en el
 * backend no mostraba nada hasta un redeploy.
 *
 * La regla: manda el estado leído del backend; el valor del build es solo el
 * defecto mientras no se haya leído.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { demoChainIds, setEthRailLive, _resetEthRailLive, normaliseSnap } from '../portfolioMerge';

const ETHEREUM = 1;

function snapWith(chainIds: number[]) {
  return {
    positions: chainIds.map((chainId, i) => ({
      chainId,
      asset: `A${i}`,
      kind: 'supply',
      amountUSD: 100,
      protocolId: `p${i}`,
    })),
  } as never;
}

describe('demoChainIds — la visibilidad sigue al interruptor vivo', () => {
  beforeEach(() => _resetEthRailLive());

  it('sin lectura del backend, manda el valor del build (defecto: sin Ethereum)', () => {
    // El .env.example lo trae en false, así que el defecto honesto es no
    // mostrar la chain hasta que alguien confirme que el carril está vivo.
    expect(demoChainIds().has(ETHEREUM)).toBe(false);
  });

  it('el backend ENCIENDE → Ethereum entra sin redeploy', () => {
    setEthRailLive(true);
    expect(demoChainIds().has(ETHEREUM)).toBe(true);
  });

  it('el backend APAGA → Ethereum sale, aunque el build dijera que sí', () => {
    setEthRailLive(true);
    expect(demoChainIds().has(ETHEREUM)).toBe(true);
    setEthRailLive(false); // el kill caliente
    expect(demoChainIds().has(ETHEREUM)).toBe(false);
  });

  it('las chains del producto (Flare y XRPL) NUNCA dependen de ese interruptor', () => {
    for (const state of [true, false]) {
      setEthRailLive(state);
      const s = demoChainIds();
      expect(s.has(14)).toBe(true);
      expect(s.has(1440002)).toBe(true);
    }
  });
});

describe('normaliseSnap — el filtro obedece al interruptor, y recalcula', () => {
  beforeEach(() => _resetEthRailLive());

  it('con el carril APAGADO, la posición de Ethereum no llega a la vista', () => {
    setEthRailLive(false);
    const out = normaliseSnap(snapWith([14, ETHEREUM]));
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].chainId).toBe(14);
  });

  it('con el carril ENCENDIDO, sí llega', () => {
    setEthRailLive(true);
    const out = normaliseSnap(snapWith([14, ETHEREUM]));
    expect(out.positions).toHaveLength(2);
  });

  it('el polvo de otras chains se tira siempre (BNB, AVAX…)', () => {
    setEthRailLive(true);
    const out = normaliseSnap(snapWith([14, ETHEREUM, 56, 43114]));
    expect(out.positions.map((p) => p.chainId).sort()).toEqual([1, 14]);
  });
});

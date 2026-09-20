/**
 * H1 — la posición de Ethereum convertida en FILAS del tablero.
 *
 * Sin filas no hay botón «Repagar ahora» ni plantilla PROTECT_EM: la puerta
 * de repago y su MoneyFlow estaban construidos y eran inalcanzables. Estas
 * reglas son las que deciden si el usuario VE su posición — y una fila a
 * cero se leería en el tablero como «tienes algo», que es peor que nada.
 */
import { describe, expect, it } from 'vitest';
import { toRows, type EthMorphoPositionRead } from '../earn/ethMorphoPosition';

const WALLET = '0x1111111111111111111111111111111111111111';

function read(over: Partial<EthMorphoPositionRead> = {}): EthMorphoPositionRead {
  return {
    wallet: WALLET,
    chainId: 1,
    hasPosition: true,
    collateralBase: '1000000', // 1 FXRP (6 dec)
    collateralSymbol: 'FXRP',
    collateralDecimals: 6,
    debtBase: '500000000000000000', // 0,5 RLUSD (18 dec)
    debtSymbol: 'RLUSD',
    debtDecimals: 18,
    healthFactor: 1.9,
    lltvPct: 77,
    readAt: '2026-08-16T12:00:00.000Z',
    ...over,
  };
}

describe('toRows — la posición de chain 1 entra al tablero', () => {
  it('un carry abierto da DOS filas: colateral FXRP y deuda RLUSD', () => {
    const rows = toRows(read());
    expect(rows).toHaveLength(2);
    const [coll, debt] = rows;
    expect(coll.kind).toBe('COLLATERAL');
    expect(coll.asset).toBe('FXRP');
    expect(coll.amount).toBe('1000000');
    expect(coll.decimals).toBe(6);
    expect(debt.kind).toBe('DEBT');
    expect(debt.asset).toBe('RLUSD');
    expect(debt.decimals).toBe(18); // la asimetría 6/18, cada fila con la suya
    // Lo que hace que el tablero le dé botón y plantilla:
    for (const r of rows) {
      expect(r.protocolId).toBe('morpho-blue');
      expect(r.chainId).toBe(1);
      expect(r.owner).toBe(WALLET);
    }
  });

  it('sin posición NO emite filas — un cero se leería como «tienes algo»', () => {
    expect(toRows(read({ hasPosition: false }))).toEqual([]);
    expect(toRows(null)).toEqual([]);
  });

  it('colateral sin deuda es legítimo (carry a medio abrir): una sola fila', () => {
    const rows = toRows(read({ debtBase: '0', healthFactor: null }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('COLLATERAL');
    expect(rows[0].healthFactor).toBeNull(); // sin deuda no hay riesgo que pintar
  });

  it('deuda sin colateral se DICE en vez de esconderse', () => {
    const rows = toRows(read({ collateralBase: '0' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('DEBT');
  });

  it('el HF y el LLTV viajan en cada fila, para pintarlos sin recalcular', () => {
    const rows = toRows(read());
    expect(rows.every((r) => r.healthFactor === 1.9 && r.lltvPct === 77)).toBe(true);
    expect(rows[0].raw.symbol).toBe('FXRP');
  });
});

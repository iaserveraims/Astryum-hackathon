/**
 * qtyDisplay — la cantidad que se enseña junto al botón de firmar.
 *
 * Hallazgo C de la auditoría: el subtítulo de la tarjeta escupía
 * `amount` crudo, y `amount` viaja en UNIDADES BASE por todo el tablero (de ahí
 * `sharesBase`, `supplyFxrpBase`, `debtUsdt0Base`: alimentan calldata). Con la
 * asimetría 6/18 de este carril eso significaba enseñar «10000000» por 10 FXRP
 * y «1000000000000000000000» por 1000 RLUSD — un número equivocado por un
 * factor de 10⁶/10¹⁸ delante de alguien a punto de firmar.
 */
import { describe, it, expect } from 'vitest';
import { qtyDisplay, snapshotQty } from '../positionQty';

describe('qtyDisplay — la asimetría 6/18, que es la que muerde', () => {
  it('10 FXRP (6 dec) se leen como 10, no como 10000000', () => {
    expect(qtyDisplay({ amount: '10000000', decimals: 6 })).toBe('10');
  });

  it('1000 RLUSD (18 dec) se leen como 1,000, no como 10^21', () => {
    expect(qtyDisplay({ amount: '1000000000000000000000', decimals: 18 })).toBe('1,000');
  });

  it('los decimales pueden venir en raw (los adapters de Flare los traen ahí)', () => {
    expect(qtyDisplay({ amount: '2500000', raw: { decimals: 6 } })).toBe('2.5');
  });

  it('la parte fraccionaria sobrevive', () => {
    expect(qtyDisplay({ amount: '1234567', decimals: 6 })).toBe('1.234567');
  });
});

describe('qtyDisplay — lo que NO hace, que es la mitad de la regla', () => {
  it('SIN decimales no inventa un 18: enseña el valor tal cual', () => {
    // Asumir 18 sobre un token de 6 daría «0.00000000001» por 10 FXRP: una
    // mentira más creíble que el número crudo, y por eso más peligrosa.
    expect(qtyDisplay({ amount: '10000000' })).toBe('10000000');
  });

  it('unos decimales absurdos no se usan', () => {
    expect(qtyDisplay({ amount: '10000000', decimals: -1 })).toBe('10000000');
    expect(qtyDisplay({ amount: '10000000', decimals: 'seis' })).toBe('10000000');
  });

  it('lo que no es un entero en base units se deja intacto', () => {
    // Un adapter que ya devuelva humano («12.5») no se re-escala.
    expect(qtyDisplay({ amount: '12.5', decimals: 6 })).toBe('12.5');
    expect(qtyDisplay({ amount: 'n/a', decimals: 18 })).toBe('n/a');
  });

  it('cero es cero, con decimales o sin ellos', () => {
    expect(qtyDisplay({ amount: '0', decimals: 6 })).toBe('0');
    expect(qtyDisplay({ amount: '0' })).toBe('0');
  });

  it('0 decimales es un dato legítimo, no una ausencia', () => {
    expect(qtyDisplay({ amount: '42', decimals: 0 })).toBe('42');
  });
});

/**
 * snapshotQty — la misma familia de bug, en el Token Inventory.
 *
 */
describe('snapshotQty — la cantidad de una fila del portfolio', () => {
  it('usa la cantidad exacta del backend (FLR, 18 decimales)', () => {
    const q = snapshotQty({ qty: '400.54882320910706', amountUSD: 2.59, priceUSD: 0.006466 });
    expect(q).toBeCloseTo(400.5488, 4);
  });

  it('FXRP (6 decimales) se lee como 10,45 y no como 10.453.867', () => {
    expect(snapshotQty({ qty: '10.453867', amountUSD: 14.47, priceUSD: 1.3843 })).toBeCloseTo(10.453867, 6);
  });

  it('sin `qty` cae a valor ÷ precio — así salen las filas de XRP', () => {
    // Los proveedores externos mandaban `amount: "0"`: el 0 de la captura.
    const q = snapshotQty({ qty: null, amountUSD: 1.72, priceUSD: 1.38 });
    expect(q).toBeCloseTo(1.2464, 4);
  });

  it('un pote (legacy-cage) sin cantidad propia también cuadra', () => {
    expect(snapshotQty({ amountUSD: 6.5, priceUSD: 1.38 })).toBeCloseTo(4.7101, 4);
  });

  it('sin precio y sin cantidad NO inventa nada', () => {
    expect(snapshotQty({ amountUSD: 10, priceUSD: 0 })).toBeNull();
    expect(snapshotQty({})).toBeNull();
  });

  it('un saldo realmente cero se enseña como cero, no como «—»', () => {
    expect(snapshotQty({ qty: '0', amountUSD: 0, priceUSD: 1.38 })).toBe(0);
  });

  it('una cantidad ilegible no se cuela: se deriva del valor', () => {
    expect(snapshotQty({ qty: 'n/a', amountUSD: 2.76, priceUSD: 1.38 })).toBeCloseTo(2, 6);
  });

  it('la deuda se lee en positivo (el signo lo pone la columna, no la cantidad)', () => {
    expect(snapshotQty({ amountUSD: -138, priceUSD: 1.38 })).toBeCloseTo(100, 6);
  });
});

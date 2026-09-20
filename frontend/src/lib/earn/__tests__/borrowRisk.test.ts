/**
 * La conversión HF ↔ LTV ↔ caída soportada es EXACTA, no una aproximación de UI.
 *
 * Importa que lo sea porque las tres cifras van a convivir en la misma pantalla:
 * el gráfico se pinta en LTV, la letra pequeña del mercado habla en HF y la
 * decisión del usuario («¿cuánto puede caer antes de que duela?») se toma en
 * caída de precio. Si cada superficie hiciera su propia cuenta, la pantalla
 * podría contradecirse a sí misma sobre el riesgo — que es la peor forma del
 * bug «éxito no ganado»: un error se reintenta, una falsa tranquilidad hace que
 * dejes de mirar.
 */
import { describe, it, expect } from 'vitest';
import {
  ltvOf, maxBorrowFor, hfFromLtv, ltvFromHf, priceDropToReach, priceDropFromHf,
  riskLevelOf, riskBands, borrowRisk, stopLossTriggerDrop,
  borrowRatioOf, ltvFromBorrowRatio, borrowRatioFromLtv, dropFromBorrowRatio,
} from '../borrowRisk';

const LLTV = 0.77;

describe('las tres unidades son la misma', () => {
  it('HF y LTV son inversos exactos alrededor del LLTV', () => {
    expect(hfFromLtv(0.30, LLTV)).toBeCloseTo(2.5667, 4);
    expect(ltvFromHf(2.5667, LLTV)).toBeCloseTo(0.30, 4);
  });

  it('HF = 1 ocurre EXACTAMENTE en el techo del mercado', () => {
    expect(hfFromLtv(LLTV, LLTV)).toBe(1);
    expect(ltvFromHf(1, LLTV)).toBe(LLTV);
  });

  it('sin deuda el HF es Infinity — no un número grande que parezca medido', () => {
    expect(hfFromLtv(0, LLTV)).toBe(Infinity);
    expect(ltvFromHf(Infinity, LLTV)).toBe(0);
  });

  it('la caída soportada sale igual desde el LTV que desde el HF', () => {
    const ltv = 0.30;
    const hf = hfFromLtv(ltv, LLTV);
    expect(priceDropToReach(ltv, LLTV)).toBeCloseTo(priceDropFromHf(hf), 10);
  });

  it('la caída soportada NO depende del tamaño de la posición', () => {
    // Misma proporción, cien veces más dinero: mismo riesgo.
    const chico = borrowRisk(300, 1_000, LLTV);
    const grande = borrowRisk(30_000, 100_000, LLTV);
    expect(chico.dropToLiquidation).toBeCloseTo(grande.dropToLiquidation, 10);
    expect(chico.healthFactor).toBeCloseTo(grande.healthFactor, 10);
  });
});

describe('la cifra que hace decidible el riesgo', () => {
  it('un HF de 2 aguanta una caída del 50 %', () => {
    expect(priceDropFromHf(2)).toBeCloseTo(0.5, 10);
  });

  it('entrar al 30 % de LTV aguanta un 61 % de caída hasta la liquidación', () => {
    expect(priceDropToReach(0.30, LLTV)).toBeCloseTo(0.6104, 4);
  });

  it('un stop-loss 2 puntos por encima del LTV de entrada salta con un 6,3 % de caída', () => {
    // El caso que el fundador planteó: entrar al 30 %, stop al 32 %.
    expect(stopLossTriggerDrop(0.30, 0.32)).toBeCloseTo(0.0625, 4);
  });

  it('alejar el stop ensancha el colchón muy deprisa', () => {
    expect(stopLossTriggerDrop(0.30, 0.35)).toBeCloseTo(0.1429, 4);
    expect(stopLossTriggerDrop(0.30, 0.40)).toBeCloseTo(0.25, 4);
    expect(stopLossTriggerDrop(0.30, 0.50)).toBeCloseTo(0.40, 4);
  });

  it('ya en el umbral, el colchón es 0 — nunca un negativo que parezca margen', () => {
    expect(priceDropToReach(0.80, LLTV)).toBe(0);
    expect(stopLossTriggerDrop(0.35, 0.30)).toBe(0);
  });

  it('sin deuda no hay caída que dispare nada', () => {
    expect(priceDropToReach(0, LLTV)).toBe(1);
  });
});

describe('los dos «porcentajes» NO son el mismo', () => {
  it('«30 %» significa dos riesgos distintos según de qué sea el 30 %', () => {
    // 30 % del colateral…
    expect(priceDropToReach(0.30, LLTV)).toBeCloseTo(0.6104, 4);
    // …vs 30 % de la capacidad del mercado, que es un LTV del 23,1 %.
    expect(ltvFromBorrowRatio(0.30, LLTV)).toBeCloseTo(0.231, 4);
    expect(dropFromBorrowRatio(0.30)).toBeCloseTo(0.70, 10);
    // Casi diez puntos de colchón entre una lectura y la otra.
  });

  it('el margen usado es exactamente 1/HF — la identidad que el copy ya insinúa', () => {
    const ratio = 0.30;
    expect(hfFromLtv(ltvFromBorrowRatio(ratio, LLTV), LLTV)).toBeCloseTo(1 / ratio, 10);
  });

  it('lo que pides y lo que aguantas suman 100 % — sin dividir y sin LLTV', () => {
    for (const ratio of [0.1, 0.25, 0.3, 0.5, 0.8]) {
      expect(ratio + dropFromBorrowRatio(ratio)).toBeCloseTo(1, 10);
    }
  });

  it('y coincide con la caída calculada por el camino del HF', () => {
    const ratio = 0.4;
    const hf = 1 / ratio;
    expect(dropFromBorrowRatio(ratio)).toBeCloseTo(priceDropFromHf(hf), 10);
  });

  it('las conversiones LTV ↔ margen son inversas exactas', () => {
    expect(borrowRatioFromLtv(ltvFromBorrowRatio(0.42, LLTV), LLTV)).toBeCloseTo(0.42, 10);
    expect(borrowRatioOf(231, 1_000, LLTV)).toBeCloseTo(0.30, 4);
  });

  it('el default de hoy (stop-loss HF 1,10) deja un colchón del 9 %', () => {
    // HF 1,10 espera a que caiga un 57 % desde un LTV del 30 %.
    expect(priceDropFromHf(1.10)).toBeCloseTo(0.0909, 4);
    expect(ltvFromHf(1.10, LLTV)).toBeCloseTo(0.70, 4);
    expect(stopLossTriggerDrop(0.30, ltvFromHf(1.10, LLTV))).toBeCloseTo(0.5714, 4);
  });
});

describe('bandas del gráfico', () => {
  it('siguen al mercado: los cortes son fracciones del LLTV, no números fijos', () => {
    const bands = riskBands(LLTV);
    expect(bands.map((b) => b.level)).toEqual(['comfortable', 'tight', 'exposed']);
    expect(bands[0].toLtv).toBeCloseTo(0.462, 3); // 0,60 · 0,77
    expect(bands[1].toLtv).toBeCloseTo(0.616, 3); // 0,80 · 0,77
    expect(bands[2].toLtv).toBeCloseTo(LLTV, 10);
  });

  it('cada banda declara el colchón de su extremo peor', () => {
    const [comfortable, tight] = riskBands(LLTV);
    expect(comfortable.dropAtEnd).toBeCloseTo(0.40, 10);
    expect(tight.dropAtEnd).toBeCloseTo(0.20, 10);
  });

  it('clasifica por colchón, no por gusto', () => {
    expect(riskLevelOf(0.30, LLTV)).toBe('comfortable');
    expect(riskLevelOf(0.50, LLTV)).toBe('tight');
    expect(riskLevelOf(0.70, LLTV)).toBe('exposed');
    expect(riskLevelOf(0.77, LLTV)).toBe('liquidatable');
    expect(riskLevelOf(0.90, LLTV)).toBe('liquidatable');
  });

  it('las bandas se recalculan con OTRO mercado — nada asume 0,77', () => {
    const bands = riskBands(0.86);
    expect(bands[0].toLtv).toBeCloseTo(0.516, 3);
    expect(riskLevelOf(0.50, 0.86)).toBe('comfortable'); // seguro aquí, «tight» a 0,77
  });
});

describe('techo de deuda y lectura completa', () => {
  it('el techo es el valor del colateral por el LLTV', () => {
    expect(maxBorrowFor(1_000, LLTV)).toBeCloseTo(770, 10);
  });

  it('ltvOf con colateral cero no inventa un 0 tranquilizador', () => {
    expect(ltvOf(100, 0)).toBe(Infinity);
    expect(ltvOf(0, 0)).toBe(0);
  });

  it('borrowRisk devuelve las cuatro lecturas coherentes entre sí', () => {
    const r = borrowRisk(300, 1_000, LLTV);
    expect(r.ltv).toBeCloseTo(0.30, 10);
    expect(r.healthFactor).toBeCloseTo(2.5667, 4);
    expect(r.dropToLiquidation).toBeCloseTo(0.6104, 4);
    expect(r.level).toBe('comfortable');
    expect(r.maxBorrow).toBeCloseTo(770, 10);
  });
});

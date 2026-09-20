import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetLiveRequests,
  deliversToFlareAutomatically,
  flareInstructionDeliveryWord,
  noteFlareInstructionDelivery,
} from '../liveRequests';

/**
 * LA FRASE PRUDENTE SALÍA EN **TODA** SALIDA.
 *
 * La hizo que el banner del 0xFE no prometiera entrega sin la palabra del
 * servidor. Correcto. Pero NINGUNA ruta 0xFE manda `executorEnabled` — solo lo
 * mandan los prepares de órdenes de consejo — así que la frase «nada confirmó
 * aquí que el executor esté en marcha» salía en cada salida institucional,
 * siempre, sin poder desmentirse. Un aviso permanente e infalsable sobre una
 * salida legítima no es prudencia: es ruido sobre el que nadie puede actuar, y
 * el servidor sí sabe la respuesta.
 */

const instruction = (memo = 'FE' + '01'.repeat(40)) => ({
  TransactionType: 'Payment',
  Memos: [{ Memo: { MemoData: memo } }],
});

describe('flareInstructionDeliveryWord — lo que de verdad sabemos del carrier', () => {
  beforeEach(() => {
    __resetLiveRequests();
  });

  it('sin ninguna palabra: «unknown» — no se acusa a nadie de no entregar', () => {
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('unknown');
    // …y no se promete nada tampoco: eso no cambia.
    expect(deliversToFlareAutomatically(JSON.stringify(instruction()))).toBe(false);
  });

  it('una ruta antigua sin el campo sigue siendo «unknown», no «parado»', () => {
    noteFlareInstructionDelivery(instruction(), undefined);
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('unknown');
    noteFlareInstructionDelivery(instruction(), {});
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('unknown');
  });

  it('el servidor dijo que NO está en marcha: «stopped» — ahí sí se dice', () => {
    noteFlareInstructionDelivery(instruction(), { executorEnabled: false });
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('stopped');
    expect(deliversToFlareAutomatically(JSON.stringify(instruction()))).toBe(false);
  });

  it('el servidor dijo que SÍ: «delivers», y el banner puede prometerlo', () => {
    noteFlareInstructionDelivery(instruction(), { executorEnabled: true });
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('delivers');
    expect(deliversToFlareAutomatically(JSON.stringify(instruction()))).toBe(true);
  });

  it('una palabra nueva sustituye a la anterior, en los dos sentidos', () => {
    noteFlareInstructionDelivery(instruction(), { executorEnabled: true });
    noteFlareInstructionDelivery(instruction(), undefined);
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('unknown');
    noteFlareInstructionDelivery(instruction(), { executorEnabled: false });
    expect(flareInstructionDeliveryWord(JSON.stringify(instruction()))).toBe('stopped');
  });

  it('lo que no es un 0xFE no tiene palabra', () => {
    expect(flareInstructionDeliveryWord(JSON.stringify({ TransactionType: 'TrustSet' }))).toBe('unknown');
    expect(flareInstructionDeliveryWord('not json')).toBe('unknown');
  });
});

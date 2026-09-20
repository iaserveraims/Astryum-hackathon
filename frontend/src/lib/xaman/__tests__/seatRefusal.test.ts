import { describe, expect, it } from 'vitest';
import { describeSeatRefusal, isSeatRefusal, mayRetryFreeingSeat, seatRefusalKind } from '../seatRefusal';

/**
 * «Retry, freeing the seat» EN BUCLE, Y SOBRE UNA
 * FIRMA QUE YA EXISTE.
 *
 * OperatorConsole ofrecía ese botón para CUALQUIER `NONCE_SEAT_TAKEN`.
 *   · sobre el borrador de otro miembro (o anterior al deploy) el servidor
 *     rechaza el desplazamiento siempre: un bucle.
 * Ahora cada caso tiene su frase y solo el desplazable ofrece el reintento.
 */

const t = (s: string) => s;

describe('seatRefusalKind — los cuatro asientos y el que no es un asiento', () => {
  it('un borrador que ESTA sesión puede desplazar: el único que ofrece el reintento', () => {
    const r = { error: 'NONCE_SEAT_TAKEN', retryable: true };
    expect(seatRefusalKind(r)).toBe('taken-retryable');
    expect(mayRetryFreeingSeat(r)).toBe(true);
    expect(describeSeatRefusal(r, t)?.mayRetryFreeingSeat).toBe(true);
  });

  it('un borrador que NO puede desplazar: su ventana sigue abierta, y se dice con los segundos', () => {
    const r = { error: 'NONCE_SEAT_TAKEN', retryable: false, secondsLeft: 217 };
    expect(seatRefusalKind(r)).toBe('taken-window-open');
    expect(mayRetryFreeingSeat(r)).toBe(false);
    expect(describeSeatRefusal(r, t)?.text).toContain('217 s');
  });

  it('SIN el campo `retryable` (backend viejo) el silencio NO es permiso', () => {
    // THE REGRESSION: absent used to read as «offer it anyway», which is the loop.
    expect(seatRefusalKind({ error: 'NONCE_SEAT_TAKEN' })).toBe('taken-window-open');
    expect(mayRetryFreeingSeat({ error: 'NONCE_SEAT_TAKEN' })).toBe(false);
  });

  it('firmado → esperar a que ejecute; jamás un reintento', () => {
    const r = { error: 'NONCE_SEAT_TAKEN_SIGNED' };
    expect(seatRefusalKind(r)).toBe('signed');
    expect(mayRetryFreeingSeat(r)).toBe(false);
    expect(describeSeatRefusal(r, t)?.text).toMatch(/already signed/i);
  });

  it('con firma reportada → esperar o comprobarla', () => {
    const r = { error: 'NONCE_SEAT_TAKEN_REPORTED' };
    expect(seatRefusalKind(r)).toBe('reported');
    expect(describeSeatRefusal(r, t)?.text).toMatch(/reported/i);
    expect(mayRetryFreeingSeat(r)).toBe(false);
  });

  it('ledger ilegible → «no pude leer» no es «libre»', () => {
    const r = { error: 'NONCE_SEAT_UNREADABLE' };
    expect(seatRefusalKind(r)).toBe('unreadable');
    expect(describeSeatRefusal(r, t)?.text).toMatch(/could not be read/i);
    expect(mayRetryFreeingSeat(r)).toBe(false);
  });

  it('cuenta operativa: no es un veredicto sobre el asiento, y tampoco ofrece reintento', () => {
    const r = { error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED' };
    expect(seatRefusalKind(r)).toBe('operational-account');
    expect(mayRetryFreeingSeat(r)).toBe(false);
  });

  it('una negativa de la JAULA no es un asiento: la consola sigue pintándola como DENIED', () => {
    for (const r of [{ error: 'BUFFER_FLOOR_CROSSED' }, { error: 'VENUE_NOT_ALLOWED' }, null, undefined, {}]) {
      expect(seatRefusalKind(r)).toBeNull();
      expect(isSeatRefusal(r)).toBe(false);
      expect(describeSeatRefusal(r, t)).toBeNull();
    }
  });
});

describe('el deploy que aún no separó los códigos: la razón viaja en `detail`', () => {
  it.each([
    ['NONCE_SEAT_TAKEN_SIGNED', 'signed'],
    ['NONCE_SEAT_TAKEN_REPORTED', 'reported'],
    ['NONCE_SEAT_UNREADABLE', 'unreadable'],
  ])('%s al frente del detail se lee como %s, y no ofrece el reintento', (prefix, kind) => {
    const r = { error: 'NONCE_SEAT_TAKEN', detail: `${prefix}: el PA 0xabc tiene una orden 0xFE…`, retryable: true };
    expect(seatRefusalKind(r)).toBe(kind);
    // `retryable: true` de una ruta que no sabía distinguirlos no resucita el botón.
    expect(mayRetryFreeingSeat(r)).toBe(false);
  });

  it('un detail que solo MENCIONA el caso (no lo encabeza) no cambia el veredicto', () => {
    const r = { error: 'NONCE_SEAT_TAKEN', detail: 'si la firmaste, NONCE_SEAT_TAKEN_SIGNED aparecerá luego', retryable: true };
    expect(seatRefusalKind(r)).toBe('taken-retryable');
  });
});

describe('cada caso dice algo distinto — una frase repetida es una frase que no informa', () => {
  it('las seis frases son distintas entre sí', () => {
    const texts = [
      { error: 'NONCE_SEAT_TAKEN', retryable: true },
      { error: 'NONCE_SEAT_TAKEN' },
      { error: 'NONCE_SEAT_TAKEN_SIGNED' },
      { error: 'NONCE_SEAT_TAKEN_REPORTED' },
      { error: 'NONCE_SEAT_UNREADABLE' },
      { error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED' },
    ].map((r) => describeSeatRefusal(r, t)!.text);
    expect(new Set(texts).size).toBe(6);
    // Ninguna culpa a la región ni promete que cancelar libere siempre.
    for (const text of texts) expect(text).not.toMatch(/region/i);
  });

  it('sin segundos legibles no se inventa un número', () => {
    for (const secondsLeft of [undefined, 0, -5, Number.NaN]) {
      const text = describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', secondsLeft }, t)!.text;
      expect(text).not.toMatch(/≈/);
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT,
  __resetPayloadExpiryMin,
  notePayloadExpiryMin,
  payloadExpiryMin,
} from '../handoffRelease';

/**
 * UN NÚMERO, Y LO POSEE EL SERVIDOR.
 *
 * `XAMAN_EXPIRE_MIN` estaba escrito a mano en el frontend y
 * `HANDOFF_PAYLOAD_EXPIRY_MIN` a mano en el backend, y el servidor lleva desde
 * la contestando el suyo (`payloadExpiryMin`) en cada prepare y en cada
 * `payload-opened` — que el frontend nunca leía. Dos copias a mano de un mismo
 * hecho divergen el día que alguien toca una, y las dos direcciones duelen en
 * silencio: un asiento que sobrevive a su payload tapia la cuenta; un asiento
 * soltado bajo un payload todavía firmable es el gemelo.
 *
 * La constante pasa a ser el SUELO. Nada absurdo se aprende: el `expire` de
 * Xaman tiene un tope de 24 h, y por debajo de un minuto no hay nada firmable.
 */

afterEach(() => {
  __resetPayloadExpiryMin();
});

describe('payloadExpiryMin', () => {
  it('sin noticia del servidor, la constante', () => {
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
  });

  it('lo que diga el servidor manda sobre la constante', () => {
    notePayloadExpiryMin(12);
    expect(payloadExpiryMin()).toBe(12);
  });

  it('un valor imposible no se aprende: la constante aguanta', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1441, '5', null, undefined, {}]) {
      notePayloadExpiryMin(bad);
      expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
    }
  });

  /**
   * AQUÍ ESTABA EL CONTAGIO, Y ERA ESTE TEST EL QUE LO BENDECÍA.
   *
   * Aprender 1440 «para la pestaña» tenía sentido mientras nada contestara 1440.
   * Desde la §2.1 la salida de un pote con consejo SÍ lo contesta, y con la regla
   * vieja abrir esa pantalla y firmar después cualquier 0xFE corriente acuñaba un
   * payload de 24 h: el asiento de nonce de esa cuenta, tapiado un día por leer
   * una pantalla. Una ventana más larga de lo que una firma simple puede ser es,
   * por construcción, de una CEREMONIA: se aprende para SU fila (su memo) y para
   * nadie más. El tope de Xaman se sigue respetando — lo que cambia es a quién se
   * le aplica.
   */
  it('el tope de Xaman (24 h) se aprende para SU fila, nunca para la pestaña entera', () => {
    const CEREMONY_MEMO = 'FE00' + 'AB'.repeat(20);
    notePayloadExpiryMin(1440, CEREMONY_MEMO);
    expect(payloadExpiryMin(undefined, CEREMONY_MEMO)).toBe(1440);
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
  });

  it('y sin memo al que pertenecer, una ventana de ceremonia no se aprende en absoluto', () => {
    notePayloadExpiryMin(1440);
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
  });

  it('un valor en la mano gana a lo aprendido y a la constante', () => {
    notePayloadExpiryMin(12);
    expect(payloadExpiryMin(7)).toBe(7);
    // …salvo que sea absurdo, y entonces se cae a lo aprendido.
    expect(payloadExpiryMin(0)).toBe(12);
  });
});

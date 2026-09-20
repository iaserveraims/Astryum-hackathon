/**
 * EL ALTA DE UN EXCHANGE NO ENSEÑA CÓDIGOS.
 *
 * Las negativas de la declaración del omnibus (`OMNIBUS_IS_*`) y los «no pude
 * leerlo» (`OWNERSHIP_UNREADABLE`, `OMNIBUS_OWNERSHIP_UNREADABLE`) se pintaban
 * con el `detail` del servidor tal cual — y, a falta de él, con el código
 * desnudo: la última estación del alta le enseñaba `OMNIBUS_IS_A_CLIENT_WALLET`
 * a un operador. La frase es NUESTRA y pasa por `t()`; el detalle del servidor
 * es el último recurso, nunca el primero.
 *
 * Y un 503 de lectura no es un callejón: nada se creó, así que la pantalla
 * ofrece repetir la misma llamada (`refusalIsRetryable`).
 */
import { describe, expect, it } from 'vitest';
import { describeRefusal, refusalIsRetryable } from '../api';

/** El `t` de la pantalla: aquí identidad, para leer la frase que se pinta. */
const t = (s: string) => s;
const SERVER_PROSE = 'rXXXX is already on file as the personal XRPL wallet of a client of "Take 3" — declaring it as an omnibus would take over that person\'s account.';

describe('las negativas del alta se dicen con nuestras palabras', () => {
  // `OWNERSHIP_UNREADABLE` ya no está en esta lista — su frase fija
  // es solo el fallback (ver el describe de abajo). El servidor manda ese código
  // por TRES causas y solo una es «could not be read just now».
  const CODES = [
    'OMNIBUS_IS_THE_COUNCIL',
    'OMNIBUS_IS_ANOTHER_COUNCIL',
    'OMNIBUS_IS_A_CLIENT_WALLET',
    'OMNIBUS_IS_A_USER_ACCOUNT',
    'OMNIBUS_OWNERSHIP_UNREADABLE',
  ];

  it.each(CODES)('%s tiene su frase, y no es ni el código ni la prosa del servidor', (error) => {
    const text = describeRefusal({ status: 409, error, detail: SERVER_PROSE }, t);
    expect(text).not.toBe(error);
    expect(text).not.toBe(SERVER_PROSE);
    expect(text.length).toBeGreaterThan(40);
    // Una frase, no un token: lleva espacios y acaba en punto.
    expect(text).toMatch(/\s/);
    expect(text.trim().endsWith('.')).toBe(true);
  });

  it('sin `detail` tampoco se cae al código', () => {
    for (const error of [...CODES, 'OWNERSHIP_UNREADABLE']) {
      expect(describeRefusal({ status: 409, error }, t)).not.toBe(error);
    }
  });

  it('la de la cuenta de un tercero explica lo que declararla haría, y la salida que tiene', () => {
    const text = describeRefusal({ status: 409, error: 'OMNIBUS_IS_A_USER_ACCOUNT' }, t);
    expect(text).toMatch(/already belongs to an Astryum user/);
    expect(text).toMatch(/not yours/);
    expect(text).toMatch(/sign in with that account/);
  });

  it('un código que no conocemos sigue cayendo al detalle del servidor (nunca se pierde información)', () => {
    expect(describeRefusal({ status: 409, error: 'SOMETHING_NEW', detail: SERVER_PROSE }, t)).toBe(SERVER_PROSE);
  });
});

describe('«no pude leerlo» lleva su reintento', () => {
  it('los 503 de lectura del alta son repetibles: nada se creó', () => {
    for (const error of ['OWNERSHIP_UNREADABLE', 'OMNIBUS_OWNERSHIP_UNREADABLE', 'SEQ_HIGH_WATER_UNREADABLE', 'TAG_RANGES_UNREADABLE', 'RUN_MARKS_NOT_PERSISTED']) {
      expect(refusalIsRetryable({ status: 503, error })).toBe(true);
      // …y su frase lo dice, para que el botón no sea una sorpresa.
      expect(describeRefusal({ status: 503, error }, t)).toMatch(/try again/i);
    }
  });

  it('una negativa de verdad NO ofrece reintentar: repetirla daría lo mismo', () => {
    for (const error of ['OMNIBUS_IS_THE_COUNCIL', 'OMNIBUS_IS_ANOTHER_COUNCIL', 'OMNIBUS_IS_A_CLIENT_WALLET', 'OMNIBUS_IS_A_USER_ACCOUNT', 'TAG_RANGE_OVERLAP']) {
      expect(refusalIsRetryable({ status: 409, error })).toBe(false);
    }
  });

  it('el `retryable` que manda el servidor manda igual', () => {
    expect(refusalIsRetryable({ status: 409, error: 'NONCE_SEAT_TAKEN', retryable: true })).toBe(true);
  });
});

/**
 * EL `detail` DE `OWNERSHIP_UNREADABLE` NO
 * SE PISA. La escribió «dated later than our clock» en el servidor para
 * la marca de toma de posesión adelantada (una fila que SE LEYÓ, que ningún
 * re-enlace arregla y que se cura sola en un instante conocido), y nuestra frase
 * fija («could not be read just now … try again») la tapaba en los ~30 sitios
 * que pintan con `describeRefusal`: la persona nunca leía la causa real. Para
 * este código el servidor sabe cuál de tres cosas pasó y nosotros no.
 */
describe('OWNERSHIP_UNREADABLE: la frase del servidor llega a la persona', () => {
  const AHEAD =
    "This sign-in's security record is dated later than our own clock, so the exchange cannot yet tell whether your account here was opened before or after it last changed hands. Nothing was changed and nothing is lost: this clears on its own once our clock passes that date — try again later.";

  it('con `detail` del servidor, se pinta ESE detail — no «could not be read just now»', () => {
    const text = describeRefusal({ status: 503, error: 'OWNERSHIP_UNREADABLE', detail: AHEAD, retryable: true }, t);
    expect(text).toBe(AHEAD);
    expect(text).toMatch(/dated later than our own clock/i);
    expect(text).not.toMatch(/could not be read just now/i);
  });

  it('sin `detail` (un servidor viejo), la frase fija sigue siendo el fallback y nunca el código', () => {
    const text = describeRefusal({ status: 503, error: 'OWNERSHIP_UNREADABLE' }, t);
    expect(text).not.toBe('OWNERSHIP_UNREADABLE');
    expect(text).toMatch(/could not be read just now/i);
    expect(describeRefusal({ status: 503, error: 'OWNERSHIP_UNREADABLE', detail: '   ' }, t)).toBe(text);
  });

  it('sigue siendo reintentable venga o no `retryable` del servidor', () => {
    expect(refusalIsRetryable({ status: 503, error: 'OWNERSHIP_UNREADABLE', detail: AHEAD })).toBe(true);
  });

  it('los demás códigos con frase propia NO cambian: la nuestra sigue ganando a la prosa del servidor', () => {
    expect(describeRefusal({ status: 503, error: 'OMNIBUS_OWNERSHIP_UNREADABLE', detail: AHEAD }, t)).not.toBe(AHEAD);
    expect(describeRefusal({ status: 503, error: 'RUN_UNREADABLE', detail: AHEAD }, t)).not.toBe(AHEAD);
  });
});

/**
 * LO QUE LA LECTURA ESTRICTA DEJÓ SIN FRASE.
 *
 * Desde la `listRuns` lee en estricto, así que cinco rutas pasaron a
 * contestar 500 donde antes degradaban a lista vacía. Ahora son 503 con
 * `retryable`, y el cliente tiene que leer «no se pudo leer, nada cambió», no
 * «tu exchange no existe».
 *
 * 3.6: «de alguien» no es «de otro». Sin sesión el servidor no puede atribuir la
 * dirección, y su negativa pide la sesión en vez de acusar a quien quizá sea su
 * dueño — así que tampoco es reintentable tal cual.
 */
describe('Los 503 de LECTURA de la lista de runs (3.2)', () => {
  it('RUN_UNREADABLE se dice, es repetible y NO insinúa que se escribiera nada', () => {
    const r = { status: 503, error: 'RUN_UNREADABLE' };
    expect(refusalIsRetryable(r)).toBe(true);
    const text = describeRefusal(r, t);
    expect(text).toMatch(/could not be read/i);
    expect(text).toMatch(/Nothing was changed/i);
    expect(text).toMatch(/try again/i);
    expect(text).not.toBe('RUN_UNREADABLE');
  });

  it('el tick del autopilot que no pudo correr también tiene frase y reintento', () => {
    const r = { status: 503, error: 'AUTOPILOT_TICK_FAILED' };
    expect(refusalIsRetryable(r)).toBe(true);
    expect(describeRefusal(r, t)).toMatch(/served nobody/i);
  });

  it('un conflicto de versión NO es repetible: hay que recargar', () => {
    expect(refusalIsRetryable({ status: 503, error: 'RUN_VERSION_CONFLICT' })).toBe(false);
    expect(describeRefusal({ status: 503, error: 'RUN_VERSION_CONFLICT' }, t)).toMatch(/Reload/i);
  });
});

describe('«tiene dueño y no puedo atribuirlo» (3.6)', () => {
  it('pide la sesión, no acusa a nadie, y no ofrece un reintento que daría lo mismo', () => {
    const r = { status: 409, error: 'OMNIBUS_OWNER_UNKNOWN' };
    const text = describeRefusal(r, t);
    expect(text).toMatch(/no session/i);
    expect(text).toMatch(/Sign in/i);
    expect(text).toMatch(/Nothing was created/i);
    // …y jamás la frase del tercero: eso es justo lo que no se sabe.
    expect(text).not.toMatch(/it is not yours/i);
    expect(refusalIsRetryable(r)).toBe(false);
  });
});

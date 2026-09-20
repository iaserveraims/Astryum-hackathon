/**
 * LA PUERTA LEGAL NO PUEDE SER UNA CÁRCEL.
 *
 * El decisor se prueba EJECUTÁNDOLO; el cable a la pantalla se prueba leyendo
 * el componente (mismo patrón que `deskDuplicateRetry`), porque este proyecto
 * ya aprendió que testear las piezas no prueba que la cadena exista — y aquí la
 * cadena era exactamente el fallo: tres decisiones correctas que, unidas,
 * dejaban a una persona fuera de su propia aplicación, con sus salidas detrás.
 *
 * El contrato del servidor que se replica abajo está probado en el backend:
 *   backend/src/config/__tests__/legalAcceptance.test.ts   (la lógica pura)
 *   backend/src/routes/__tests__/auth.legalUnreadable.test.ts  (los endpoints)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGAL_RECORD_UNREADABLE_EN,
  LEGAL_RECORD_UNREADABLE_TITLE_EN,
  legalGateBlocks,
  legalGateMode,
} from '../legalGateMode';

/**
 * Lo que GET /auth/me devuelve para una fila de preferencias ILEGIBLE, tal y
 * como lo construye `unreadableLegalStatus` en el backend. Si el backend
 * cambiara esta forma, su propio test («the shape the route sends on the 409 is
 * the same status /auth/me computes») lo caza allí.
 */
const SERVER_SAYS_UNREADABLE = {
  required: false,
  termsVersion: '2026-07-30',
  privacyVersion: '2026-09-13',
  reason: null,
  accepted: null,
  unreadable: true,
};

describe('legalGateMode — tres estados, y solo uno es una puerta', () => {
  it('la ficha ILEGIBLE deja entrar: no bloquea, y lo dice', () => {
    expect(legalGateMode(SERVER_SAYS_UNREADABLE)).toEqual({ kind: 'unreadable' });
    // EL ARREGLO, EN UNA LÍNEA: con la columna de preferencias corrupta, la
    // aplicación NO se cierra sobre la persona.
    expect(legalGateBlocks(SERVER_SAYS_UNREADABLE)).toBe(false);
  });

  it('quien no ha firmado sigue viendo la ceremonia (no se ha aflojado nada)', () => {
    const notSigned = { required: true, unreadable: false };
    expect(legalGateMode(notSigned)).toEqual({ kind: 'sign' });
    expect(legalGateBlocks(notSigned)).toBe(true);
  });

  it('quien ya firmó no ve nada', () => {
    expect(legalGateMode({ required: false, unreadable: false })).toEqual({ kind: 'closed' });
  });

  it('sin respuesta del servidor no se pinta nada — ni puerta ni nota', () => {
    expect(legalGateMode(null)).toEqual({ kind: 'closed' });
    expect(legalGateMode(undefined)).toEqual({ kind: 'closed' });
  });

  it('un backend viejo sin el campo se comporta igual que siempre', () => {
    expect(legalGateMode({ required: true })).toEqual({ kind: 'sign' });
    expect(legalGateMode({ required: false })).toEqual({ kind: 'closed' });
  });

  it('solo un true LITERAL declara «no pude leer»', () => {
    for (const junk of [1, 'true', {}, [], 'yes']) {
      expect(legalGateMode({ required: true, unreadable: junk as never })).toEqual({ kind: 'sign' });
    }
    expect(legalGateMode({ required: true, unreadable: null })).toEqual({ kind: 'sign' });
  });

  it('si alguna vez llegan los dos, gana el que NO encierra', () => {
    // Un `sign` equivocado le cuesta a una persona su aplicación; un
    // `unreadable` equivocado nos cuesta una presentación de un texto que
    // podemos volver a presentar en la siguiente carga.
    expect(legalGateMode({ required: true, unreadable: true })).toEqual({ kind: 'unreadable' });
  });
});

describe('la frase — honesta, y jamás una acusación', () => {
  it('dice qué pasó, de quién es el fallo, qué cuesta y qué viene después', () => {
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/could not read your acceptance record/i);
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/fault in what we stored/i);
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/nothing on your account changed/i);
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/nothing is being asked of you/i);
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/check again every time you open the app/i);
    expect(LEGAL_RECORD_UNREADABLE_EN).toMatch(/write to us/i);
  });

  it('NUNCA dice que la persona no haya firmado', () => {
    for (const text of [LEGAL_RECORD_UNREADABLE_EN, LEGAL_RECORD_UNREADABLE_TITLE_EN]) {
      expect(text).not.toMatch(/you have not (signed|accepted)/i);
      expect(text).not.toMatch(/not signed yet/i);
      expect(text).not.toMatch(/you must (sign|accept)/i);
      // Tampoco promete que esperar lo arregla: el propio 409 del backend dice
      // que esperar no lo arregla.
      expect(text).not.toMatch(/try again in a moment/i);
    }
  });
});

/**
 * CADENA — EL CLIENTE NO DESMIENTE AL SERVIDOR.
 *
 * `acceptLegal` hacía `legalGate: { ...fromServer, required: false }`, INCONDI-
 * CIONAL. El servidor contesta a POST /auth/legal-accept con el estado que él
 * mismo acaba de computar sobre la fila escrita; si ese veredicto decía
 * `required: true`, la pantalla lo tapaba y enseñaba «firmado». Familia «éxito
 * no ganado» — y, peor, DISFRAZ: la puerta volvía en el siguiente /auth/me y el
 * fallo de debajo (una marca de toma de posesión adelantada, backend
 * config/legalAcceptance) parecía intermitente.
 */
describe('la firma se da por registrada solo si el servidor no la contradice', () => {
  const STORE = readFileSync(join(__dirname, '..', '..', '..', 'stores', 'authStore.ts'), 'utf8');

  it('un servidor que dice «sigue haciendo falta» NO se convierte en «firmado»', () => {
    // Lo que /auth/legal-accept devuelve cuando la escritura aterrizó pero la
    // ficha, releída, sigue pidiendo firma.
    const stillRequired = { required: true, unreadable: false };
    expect(legalGateBlocks(stillRequired)).toBe(true);
    expect(legalGateMode(stillRequired)).toEqual({ kind: 'sign' });
  });

  it('«no pude leer» después de firmar NO es un fallo de la firma: la ceremonia se cierra', () => {
    expect(legalGateBlocks(SERVER_SAYS_UNREADABLE)).toBe(false);
    expect(legalGateMode(SERVER_SAYS_UNREADABLE)).toEqual({ kind: 'unreadable' });
  });

  it('el caso normal —el servidor confirma— sigue cerrando la puerta', () => {
    expect(legalGateBlocks({ required: false, unreadable: false })).toBe(false);
  });

  it('EL CABLE: el store adopta el veredicto y ya no fuerza `required: false`', () => {
    // La línea del bug, literal. Si vuelve, este test la caza.
    expect(STORE).not.toContain('{ ...fromServer, required: false }');
    // Y en su lugar, el veredicto del servidor tal cual + el mismo decisor.
    expect(STORE).toContain('set({ legalGate: fromServer })');
    expect(STORE).toContain('legalGateBlocks(fromServer)');
    expect(STORE).toContain("legalAcceptRefusal: 'not_recorded'");
  });

  it('EL CABLE: sin veredicto del servidor (backend viejo) se sigue cerrando en local', () => {
    // `ok: true` sin `legal` en la respuesta: nada contradice la firma.
    expect(STORE).toContain('{ ...prev, required: false }');
  });

  it('EL CABLE: la pantalla tiene una frase propia para ese rechazo', () => {
    const GATE = readFileSync(join(__dirname, '..', '..', '..', 'components', 'access', 'LegalAcceptGate.tsx'), 'utf8');
    expect(GATE).toContain("refusal === 'not_recorded'");
    // No acusa a la persona, y nombra la vía real si insiste.
    expect(GATE).toMatch(/still reports the signature as missing/);
    expect(GATE).toMatch(/write to us/);
  });
});

/**
 * EL CABLE. Que el decisor sea correcto no sirve de nada si la pantalla sigue
 * mirando `legalGate.required` a pelo — que es literalmente el bug.
 */
describe('LegalAcceptGate usa el decisor, y la nota no bloquea', () => {
  const GATE = readFileSync(join(__dirname, '..', '..', '..', 'components', 'access', 'LegalAcceptGate.tsx'), 'utf8');

  it('la ceremonia se abre por `legalGateMode`, no por `required` a pelo', () => {
    expect(GATE).toContain('legalGateMode(legalGate)');
    expect(GATE).toContain("const required = mode.kind === 'sign';");
    expect(GATE).not.toContain('const required = legalGate?.required === true;');
  });

  it('la nota del tercer estado se pinta, y se puede cerrar', () => {
    expect(GATE).toContain("mode.kind === 'unreadable'");
    expect(GATE).toContain('LEGAL_RECORD_UNREADABLE_EN');
    expect(GATE).toContain('setNoticeDismissed(true)');
    // No es un modal: sin overlay a pantalla completa en esa rama.
    const notice = GATE.slice(GATE.indexOf("mode.kind === 'unreadable'"));
    expect(notice).not.toContain('inset-0');
  });

  it('un rechazo re-lee /auth/me, para que el 409 sin salida se convierta en la nota', () => {
    expect(GATE).toContain('refreshMe()');
  });
});

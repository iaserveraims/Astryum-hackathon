import { describe, expect, it } from 'vitest';
import {
  describeSeatRelease,
  mayPrepareAgainAfterRelease,
  seatRefusalView,
  describeStaleSignature,
  isStaleSignature,
  normalizeSeatRefusal,
  seatReleaseOffer,
  seatReleaseSettled,
  seatRefusalSentence,
  seatSecondsLeft,
  staleSignatureCode,
} from '../SeatRefusalNotice';
import type { HandoffPostResult } from '@/lib/wallet/handoffRelease';

/**
 * R5 5.4 (el asiento tomado) y R5 5.2 (la firma tardía).
 *
 * Las dos cosas que ninguna pantalla puede enseñar: el código crudo del servidor
 * (`NONCE_SEAT_TAKEN`) y su párrafo en castellano con hashes. Y la que ninguna
 * podía decir: que un payload firmado fuera de su ventana no es «no lo pude
 * confirmar» sino «prepáralo otra vez».
 */

const t = (s: string) => s;

/* ── el rechazo, normalizado ──────────────────────────────────────────────── */

describe('normalizeSeatRefusal', () => {
  it('reconoce el código directo, el que viaja en `code` y el envuelto en `detail`', () => {
    expect(normalizeSeatRefusal({ error: 'NONCE_SEAT_TAKEN' })).not.toBeNull();
    // `code` en vez de `error`: lo entiende el lector compartido, así que el
    // cuerpo pasa tal cual — lo que importa es que NO se pierda por el camino.
    expect(seatRefusalSentence({ code: 'NONCE_SEAT_UNREADABLE' }, t)).toMatch(/could not be read/);
    expect(
      normalizeSeatRefusal({
        error: 'VAULT_YIELD_CLAIM_PREPARE_FAILED',
        detail: 'NONCE_SEAT_TAKEN_SIGNED: el PA 0xPA tiene una orden 0xFE YA FIRMADA en el nonce 7',
      })?.error,
    ).toBe('NONCE_SEAT_TAKEN_SIGNED');
  });

  it('no inventa asientos donde no los hay', () => {
    expect(normalizeSeatRefusal({ error: 'NOT_REDEEMABLE_NOW', detail: 'el pote está en cooldown' })).toBeNull();
    expect(normalizeSeatRefusal(null)).toBeNull();
    expect(normalizeSeatRefusal('NONCE_SEAT_TAKEN')).toBeNull();
  });
});

describe('seatRefusalSentence — ni el código ni el castellano del servidor', () => {
  it('devuelve UNA frase en inglés, sin el detalle del backend', () => {
    const said = seatRefusalSentence(
      {
        error: 'NONCE_SEAT_TAKEN',
        retryable: false,
        secondsLeft: 604,
        detail: 'el PA 0xPA tiene una orden 0xFE sin firmar en el nonce 7 — se libera en 604 s',
      },
      t,
    );
    expect(said).toBeTruthy();
    expect(said).not.toMatch(/NONCE_SEAT/);
    expect(said).not.toMatch(/el PA|se libera en/);
    // Lo que el servidor SÍ sabe y sirve para algo: los segundos que quedan.
    expect(said).toContain('604');
  });

  it('un rechazo que no es de asiento no dice nada: quien llama conserva su texto', () => {
    expect(seatRefusalSentence({ error: 'NO_SHARES' }, t)).toBeNull();
  });
});

/* ── quién puede liberar, y con qué memo ──────────────────────────────────── */

describe('seatReleaseOffer', () => {
  /**
   * LA PROMESA QUE MIENTE. Este test consagraba lo contrario:
   * con el memo del servidor se ofrecía «Free the seat» TAMBIÉN sobre un asiento
   * FIRMADO. El servidor contesta a esa liberación 200 `{released:false}` — no
   * libera nada, porque liberar un firmado es exactamente el gemelo — así que el
   * botón solo podía enseñar al usuario que su pago firmado «aún se cancela».
   * Quien decide es el ESTADO del asiento, no quién tiene el memo.
   */
  it('sobre un asiento FIRMADO no se ofrece liberar, lo mande quien lo mande', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN_SIGNED', memoHex: 'FE01' })).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN_REPORTED', memoHex: 'FE01' })).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_UNREADABLE', memoHex: 'FE01' })).toBeNull();
  });

  it('sobre un borrador SIN firmar que ESTA sesión puede desplazar: sí', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: true, memoHex: 'FE01' })).toEqual({ memoHex: 'FE01' });
  });

  /**
   * EL BOTÓN QUE SOLO PODÍA FALLAR. Este test consagraba lo
   * contrario: con el memo del servidor se ofrecía «Free the seat» también
   * sobre `taken-window-open`, que es el servidor diciendo «su ventana de firma
   * sigue abierta, no se puede desplazar desde aquí» — y `/handoff/release`
   * contesta exactamente eso, un 409. Un botón bajo un párrafo que lo niega.
   */
  it('sobre un borrador cuya VENTANA sigue abierta, no: el release contesta 409', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', memoHex: 'FE01' })).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: false, memoHex: 'FE01', secondsLeft: 120 })).toBeNull();
  });

  it('una espera declarada por el servidor no se «libera» desde un botón', () => {
    expect(seatReleaseOffer({ error: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 92 }, 'DEADBEEF')).toBeNull();
  });

  it('sin memo del servidor, vale el borrador que ESTA pantalla abandonó — solo si nadie lo firmó', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: true }, 'DEADBEEF')).toEqual({ memoHex: 'DEADBEEF' });
    // Sin `retryable`, el servidor dijo que su ventana sigue
    // abierta — el memo propio no cambia lo que el release va a contestar.
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN' }, 'DEADBEEF')).toBeNull();
    // Firmado, reportado o ilegible: se espera. «No pude leer» jamás es permiso.
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN_SIGNED' }, 'DEADBEEF')).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN_REPORTED' }, 'DEADBEEF')).toBeNull();
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_UNREADABLE' }, 'DEADBEEF')).toBeNull();
  });

  it('sin memo de ninguna de las dos partes no se ofrece nada', () => {
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: true })).toBeNull();
    expect(seatReleaseOffer({ error: 'NOT_REDEEMABLE_NOW' }, 'DEADBEEF')).toBeNull();
  });
});

/* ── lo que contestó el release ───────────────────────────────────────────── */

describe('describeSeatRelease — un 409 es la física del asiento, no un fallo', () => {
  it('liberado: se puede preparar otra vez', () => {
    const r: HandoffPostResult = { kind: 'ok', status: 200, body: { released: true } };
    expect(describeSeatRelease(r, t)?.kind).toBe('freed');
  });

  it('409 WAIT_FOR_PAYLOAD_EXPIRY: la espera, con sus segundos y sin el código', () => {
    const r = {
      kind: 'refused',
      status: 409,
      error: 'WAIT_FOR_PAYLOAD_EXPIRY',
      detail: 'el payload aún puede firmarse durante 92 s',
      secondsLeft: 92,
    } as unknown as HandoffPostResult;
    const said = describeSeatRelease(r, t);
    expect(said?.kind).toBe('wait');
    expect(said?.text).toContain('92');
    expect(said?.text).not.toMatch(/WAIT_FOR_PAYLOAD_EXPIRY|el payload/);
  });

  it('un 409 sin segundos cae en los que el prepare ya había dicho', () => {
    const r = { kind: 'refused', status: 409, error: 'WAIT_FOR_PAYLOAD_EXPIRY' } as HandoffPostResult;
    expect(describeSeatRelease(r, t, 30)?.text).toContain('30');
  });

  it('cualquier otro rechazo se cuenta sin las palabras del servidor', () => {
    const r: HandoffPostResult = {
      kind: 'refused',
      status: 403,
      error: 'NOT_THE_HANDOFF_OWNER',
      detail: 'esta sesión no preparó ese 0xFE',
    };
    const said = describeSeatRelease(r, t);
    expect(said?.kind).toBe('refused');
    expect(said?.text).not.toMatch(/NOT_THE_HANDOFF_OWNER|esta sesión/);
  });

  it('sin respuesta no se promete nada', () => {
    expect(describeSeatRelease({ kind: 'unreachable', detail: 'offline' }, t)?.kind).toBe('refused');
    expect(describeSeatRelease({ kind: 'skipped' }, t)).toBeNull();
  });

  /**
   * UN 200 `{released:false}` NO ES «AÚN SE PUEDE FIRMAR».
   *
   * `/handoff/release` contesta 200 con `released:false` en tres situaciones
   * distintas y las tres se traducían a la frase de la espera. Sobre un pago YA
   * FIRMADO eso es la mentira más cara del carril: le dice a quien firmó que su
   * pago sigue siendo cancelable, y le invita a preparar el gemelo.
   */
  it('firmado: se dice que está firmado, y jamás que aún puede firmarse', () => {
    const r: HandoffPostResult = {
      kind: 'ok',
      status: 200,
      body: { released: false, code: 'NONCE_SEAT_TAKEN_SIGNED', retryable: false, detail: 'el PA ya firmó' },
    };
    const said = describeSeatRelease(r, t);
    expect(said?.kind).toBe('signed');
    expect(said?.text).toMatch(/already signed/i);
    expect(said?.text).not.toMatch(/can still be signed/i);
    expect(said?.text).not.toMatch(/NONCE_SEAT|el PA/);
    expect(seatReleaseSettled(said)).toBe(true);
  });

  it('reportado: se espera al ledger, y tampoco es la frase de la espera del payload', () => {
    const r: HandoffPostResult = {
      kind: 'ok',
      status: 200,
      body: { released: false, code: 'NONCE_SEAT_TAKEN_REPORTED' },
    };
    const said = describeSeatRelease(r, t);
    expect(said?.kind).toBe('reported');
    expect(said?.text).not.toMatch(/can still be signed/i);
    expect(seatReleaseSettled(said)).toBe(true);
  });

  it('nada que liberar: se dice tal cual, no como una espera inventada', () => {
    const said = describeSeatRelease({ kind: 'ok', status: 200, body: { released: false } }, t);
    expect(said?.kind).toBe('nothing-to-free');
    expect(said?.text).toMatch(/nothing to free/i);
    expect(seatReleaseSettled(said)).toBe(true);
  });

  it('solo la espera de verdad (409) sigue siendo una espera, y no está «zanjada»', () => {
    const said = describeSeatRelease(
      { kind: 'refused', status: 409, error: 'WAIT_FOR_PAYLOAD_EXPIRY' } as HandoffPostResult,
      t,
      30,
    );
    expect(said?.kind).toBe('wait');
    expect(seatReleaseSettled(said)).toBe(false);
  });
});

/* ── la espera, cuando el lector compartido aún no conoce el código ───────── */

describe('WAIT_FOR_PAYLOAD_EXPIRY — ni el código crudo ni un callejón sin salida', () => {
  it('se cuenta como espera con sus segundos, venga como venga', () => {
    for (const body of [
      { error: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 92, detail: 'el payload aún puede firmarse' },
      { code: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 92 },
    ]) {
      const said = seatRefusalSentence(body, t);
      expect(said).toBeTruthy();
      expect(said).not.toMatch(/WAIT_FOR_PAYLOAD_EXPIRY/);
      expect(said).not.toMatch(/el payload/);
      expect(said).toContain('92');
    }
  });
});

describe('seatSecondsLeft', () => {
  it('lee el número esté donde esté, y solo si es un número de verdad', () => {
    expect(seatSecondsLeft({ secondsLeft: 12.4 })).toBe(12);
    expect(seatSecondsLeft({ body: { secondsLeft: 7 } })).toBe(7);
    expect(seatSecondsLeft({ secondsLeft: 0 })).toBeNull();
    expect(seatSecondsLeft({ secondsLeft: '30' })).toBeNull();
    expect(seatSecondsLeft(null)).toBeNull();
  });
});

/* ── la firma que llegó tarde ─────────────────────────────────────────────── */

describe('describeStaleSignature — «prepárala otra vez», nunca «no pude confirmarlo»', () => {
  // El texto EXACTO que produce XamanWalletService cuando el nodo contesta.
  const XAMAN_MAX_LEDGER = new Error(
    'Transaction submission failed: The network refused this transaction (tefMAX_LEDGER). It never entered the ledger and it cost nothing.',
  );

  it('reconoce los dos códigos que matan un payload fijado', () => {
    expect(staleSignatureCode(XAMAN_MAX_LEDGER)).toBe('tefMAX_LEDGER');
    expect(staleSignatureCode(new Error('… (tefPAST_SEQ) …'))).toBe('tefPAST_SEQ');
    expect(isStaleSignature(XAMAN_MAX_LEDGER)).toBe(true);
  });

  it('lo lee también de las propiedades que lleva un raíl más rico', () => {
    expect(staleSignatureCode(Object.assign(new Error('x'), { xrplResult: 'tefMAX_LEDGER' }))).toBe('tefMAX_LEDGER');
    expect(
      staleSignatureCode(Object.assign(new Error('x'), { verdict: { kind: 'stale', code: 'tefPAST_SEQ' } })),
    ).toBe('tefPAST_SEQ');
  });

  it('la frase dice que se prepare otra vez y NUNCA que no se pudo confirmar', () => {
    const said = describeStaleSignature(XAMAN_MAX_LEDGER, t);
    expect(said?.text).toMatch(/prepare it again/i);
    expect(said?.text).not.toMatch(/could not be confirmed|reload/i);
    // El código viaja aparte (diagnóstico), lo diga quien lo diga: este módulo
    // prefiere `describeStaleHandoff` de la capa wallet cuando existe.
    expect(said?.code).toBe('tefMAX_LEDGER');
  });

  it('ni un tec*, ni un tef* de otra familia, ni un fallo de lectura son esto', () => {
    expect(describeStaleSignature(new Error('… (tecUNFUNDED_PAYMENT) …'), t)).toBeNull();
    expect(describeStaleSignature(new Error('… (tefBAD_AUTH) …'), t)).toBeNull();
    expect(
      describeStaleSignature(new Error('Transaction submission failed: Failed to retrieve transaction hash from payload'), t),
    ).toBeNull();
    expect(describeStaleSignature(null, t)).toBeNull();
    expect(isStaleSignature(undefined)).toBe(false);
  });
});

/* ── · 1.2 (la mitad del dinero): el tercer veredicto ──────────────── */

/**
 * «NO PUDE COMPROBARLO» NO ES «NO HABÍA NADA».
 *
 * `/handoff/release` se tragaba el fallo de BD y contestaba 200 `{released:false}`;
 * esta pantalla lo leía «no había nada que liberar» y ofrecía PREPARAR OTRA VEZ,
 * que es el gemelo: un segundo 0xFE sobre un nonce que quizá sigue ocupado por un
 * payload firmable.
 */
describe('describeSeatRelease — «no pude comprobarlo» es su propio veredicto', () => {
  it('un 503 del release no es «nada que liberar» ni promete nada', () => {
    const said = describeSeatRelease(
      {
        kind: 'refused',
        status: 503,
        error: 'SEAT_STATE_UNREADABLE',
        detail: 'no se pudo leer el estado del asiento',
      } as HandoffPostResult,
      t,
    );
    expect(said?.kind).toBe('unknown');
    expect(said?.text).toMatch(/could not check/i);
    // La frase que importa es la que NO se afirma: nunca abre con «no había
    // nada que liberar» (la única lectura que invita al gemelo).
    expect(said?.text).not.toMatch(/^There was nothing to free/i);
    expect(said?.text).toMatch(/is not .there was nothing to free/i);
    expect(said?.text).not.toMatch(/SEAT_STATE_UNREADABLE|no se pudo leer/);
    // No está zanjado: volver a preguntar es exactamente el camino.
    expect(seatReleaseSettled(said)).toBe(false);
  });

  it('un 200 que dice «no pude leer» tampoco se lee como «no había nada»', () => {
    const said = describeSeatRelease(
      { kind: 'ok', status: 200, body: { released: false, code: 'NONCE_SEAT_UNREADABLE' } },
      t,
    );
    expect(said?.kind).toBe('unknown');
    expect(said?.kind).not.toBe('nothing-to-free');
    expect(said?.text).not.toMatch(/^There was nothing to free/i);
  });

  it('un ACCOUNT_BUSY del release cuenta sus segundos, sin el código', () => {
    const said = describeSeatRelease(
      {
        kind: 'refused',
        status: 503,
        error: 'ACCOUNT_BUSY',
        code: 'ACCOUNT_BUSY',
        retryAfterSeconds: 20,
        body: { error: 'ACCOUNT_BUSY', retryAfterSeconds: 20 },
      } as unknown as HandoffPostResult,
      t,
    );
    expect(said?.kind).toBe('unknown');
    expect(said?.text).toContain('20');
    expect(said?.text).not.toMatch(/ACCOUNT_BUSY/);
  });

  it('las tres formas siguen siendo tres: liberado, nada que liberar, no pude comprobarlo', () => {
    expect(describeSeatRelease({ kind: 'ok', status: 200, body: { released: true } }, t)?.kind).toBe('freed');
    expect(describeSeatRelease({ kind: 'ok', status: 200, body: { released: false } }, t)?.kind).toBe('nothing-to-free');
    expect(
      describeSeatRelease({ kind: 'refused', status: 500, error: 'INTERNAL' } as HandoffPostResult, t)?.kind,
    ).toBe('unknown');
    // Un 4xx que SÍ es un veredicto sigue siendo un rechazo, no una duda.
    expect(
      describeSeatRelease({ kind: 'refused', status: 403, error: 'NOT_THE_HANDOFF_OWNER' } as HandoffPostResult, t)?.kind,
    ).toBe('refused');
  });
});

/* ── · El asiento ilegible tiene salida ──────────────────────── */

describe('NONCE_SEAT_UNREADABLE — camino, nunca callejón', () => {
  it('ofrece reintentar y jamás liberar: «no pude leer» no es «está libre»', () => {
    const view = seatRefusalView({ error: 'NONCE_SEAT_UNREADABLE', retryable: false }, t);
    expect(view?.mayTryAgain).toBe(true);
    expect(view?.mayFreeSeat).toBe(false);
    expect(view?.mayRetryFreeingSeat).toBe(false);
    expect(view?.text).not.toMatch(/NONCE_SEAT_UNREADABLE/);
    // Y el botón de liberar no se ofrece ni con memo del servidor.
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_UNREADABLE', memoHex: 'FE01' })).toBeNull();
  });

  it('cuando el servidor marca la salida como reintentable, el camino sigue ahí', () => {
    const view = seatRefusalView({ error: 'NONCE_SEAT_UNREADABLE', retryable: true, secondsLeft: 45 }, t);
    expect(view?.mayTryAgain).toBe(true);
    expect(view?.secondsLeft).toBe(45);
  });
});

/* ── · Los 503 que no tenían lector ──────────────────────────── */

describe('ACCOUNT_BUSY y PROOF_STORE_UNREADABLE — prosa y reintento', () => {
  it('se reconocen como rechazo legible, vengan en `error`, en `code` o dentro del `detail`', () => {
    expect(normalizeSeatRefusal({ error: 'ACCOUNT_BUSY' })).not.toBeNull();
    expect(normalizeSeatRefusal({ code: 'PROOF_STORE_UNREADABLE' })).not.toBeNull();
    expect(
      normalizeSeatRefusal({
        error: 'POTE_EXIT_PREPARE_FAILED',
        detail: 'ACCOUNT_BUSY: hay otra petición de esta cuenta en curso',
      })?.error,
    ).toBe('ACCOUNT_BUSY');
  });

  it('el texto es una frase, no el código ni el castellano del servidor', () => {
    const said = seatRefusalSentence(
      { error: 'ACCOUNT_BUSY', detail: 'hay otra petición de esta cuenta en curso, espera' },
      t,
    );
    expect(said).toBeTruthy();
    expect(said).toMatch(/try again/i);
    expect(said).not.toMatch(/ACCOUNT_BUSY/);
    expect(said).not.toMatch(/hay otra petición/);
  });

  it('lleva reintento y el Retry-After del servidor, y nunca «Free the seat»', () => {
    const view = seatRefusalView({ error: 'ACCOUNT_BUSY', retryAfterSeconds: 30 }, t);
    expect(view?.mayTryAgain).toBe(true);
    expect(view?.mayFreeSeat).toBe(false);
    expect(view?.retryAfterSeconds).toBe(30);
    expect(seatRefusalView({ error: 'ACCOUNT_BUSY', retryAfter: 12 }, t)?.retryAfterSeconds).toBe(12);
    // Ninguno de los dos es un asiento: no se libera nada desde aquí.
    expect(seatReleaseOffer({ error: 'ACCOUNT_BUSY', memoHex: 'FE01' })).toBeNull();
    expect(seatReleaseOffer({ error: 'PROOF_STORE_UNREADABLE' }, 'DEADBEEF')).toBeNull();
  });

  it('una tienda ilegible no se cuenta como «no tienes nada»', () => {
    const said = seatRefusalSentence({ error: 'PROOF_STORE_UNREADABLE' }, t);
    expect(said).toMatch(/could not read/i);
    // Da igual si la frase la pone el lector compartido o el
    // respaldo de aquí: las dos dicen que no se compuso nada y que se reintente.
    expect(said).toMatch(/nothing (was|moved)/i);
    expect(said).toMatch(/try again/i);
    expect(said).not.toMatch(/PROOF_STORE_UNREADABLE/);
  });

  it('lo que no es ni asiento ni 503 nuestro sigue sin ser cosa de este lector', () => {
    expect(normalizeSeatRefusal({ error: 'NOT_REDEEMABLE_NOW' })).toBeNull();
    expect(seatRefusalSentence({ error: 'NO_SHARES' }, t)).toBeNull();
  });
});

describe('mayPrepareAgainAfterRelease — quién gana el derecho a preparar otra', () => {
  it('lo dan el «liberado» y el «no había nada», y la ventana que venció', () => {
    expect(mayPrepareAgainAfterRelease({ kind: 'freed', text: '' }, false)).toBe(true);
    expect(mayPrepareAgainAfterRelease({ kind: 'nothing-to-free', text: '' }, false)).toBe(true);
    expect(mayPrepareAgainAfterRelease(null, true)).toBe(true);
  });

  it('no lo da «no pude comprobarlo», ni aunque el reloj de la pantalla llegue a cero', () => {
    const unknown = { kind: 'unknown', secondsLeft: null, text: '' } as const;
    expect(mayPrepareAgainAfterRelease(unknown, false)).toBe(false);
    expect(mayPrepareAgainAfterRelease(unknown, true)).toBe(false);
  });

  it('tampoco la espera de verdad, ni un rechazo sin ventana vencida', () => {
    expect(mayPrepareAgainAfterRelease({ kind: 'wait', secondsLeft: 40, text: '' }, true)).toBe(false);
    expect(mayPrepareAgainAfterRelease({ kind: 'refused', text: '' }, false)).toBe(false);
    // Un firmado solo cuando su ventana pasó: antes, el segundo pago es el gemelo.
    expect(mayPrepareAgainAfterRelease({ kind: 'signed', text: '' }, false)).toBe(false);
    expect(mayPrepareAgainAfterRelease({ kind: 'signed', text: '' }, true)).toBe(true);
  });
});

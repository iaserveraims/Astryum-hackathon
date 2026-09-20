import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeSeatRefusal,
  freeSeatOfRefusal,
  freeSeatOfRefusalResult,
  looksLikeRawCode,
  readSeatRelease,
  refusalHeadline,
  seatIsReleasableDraft,
  seatRefusalKind,
  seatReleaseSentence,
} from '../seatRefusal';
import { postHandoff } from '../../wallet/handoffRelease';

/**
 * productizer it. 19 (R5 R4 / R3 N2 — «la espera ilegible y el "Free the seat"
 * sobre lo firmado»).
 *
 * TRES MENTIRAS EN LA MISMA PANTALLA, cada una probada aquí:
 *
 *  1. `WAIT_FOR_PAYLOAD_EXPIRY` no estaba en los códigos que el frontend conoce,
 *     así que el 409 que dice «ese pago TODAVÍA puede firmarse» salía como slug.
 *  2. `postHandoff` parseaba `secondsLeft` y lo tiraba, y la pantalla prometía
 *     «se libera en ~5 minutos» con una constante del cliente sobre una ventana
 *     que el servidor acababa de medir en ~6.
 *  3. Un 200 `{released:false}` — que es «no había nada que liberar», casi
 *     siempre porque YA ESTÁ FIRMADO — se contaba como liberación exitosa, y su
 *     vecino lo traducía como «aún se puede firmar». Las dos son falsas: a un
 *     pago firmado no le espera nadie.
 */

const MEMO = 'FE' + '11'.repeat(40);
const t = (s: string) => s;

describe('WAIT_FOR_PAYLOAD_EXPIRY — la espera se lee, y jamás ofrece liberar', () => {
  it('es un asiento conocido (antes devolvía null y la pantalla pintaba el código)', () => {
    expect(seatRefusalKind({ error: 'WAIT_FOR_PAYLOAD_EXPIRY' })).toBe('wait-payload-expiry');
    expect(describeSeatRefusal({ error: 'WAIT_FOR_PAYLOAD_EXPIRY' }, t)).not.toBeNull();
  });

  it('dice los segundos REALES del servidor, no una constante del cliente', () => {
    const v = describeSeatRefusal({ error: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 214 }, t)!;
    expect(v.text).toContain('214 s');
    expect(v.secondsLeft).toBe(214);
    // Sin segundos no se inventa ninguno.
    expect(describeSeatRefusal({ error: 'WAIT_FOR_PAYLOAD_EXPIRY' }, t)!.secondsLeft).toBeUndefined();
  });

  it('nunca ofrece «Free the seat»: el servidor acaba de negar ESA liberación', () => {
    const v = describeSeatRefusal({ error: 'WAIT_FOR_PAYLOAD_EXPIRY', memoHex: MEMO, secondsLeft: 90 }, t)!;
    expect(v.mayFreeSeat).toBe(false);
    expect(v.mayRetryFreeingSeat).toBe(false);
    expect(seatIsReleasableDraft({ error: 'WAIT_FOR_PAYLOAD_EXPIRY', memoHex: MEMO })).toBe(false);
  });

  it('el asiento liberable es SOLO un borrador sin firmar — jamás _SIGNED/_REPORTED/_UNREADABLE', () => {
    expect(seatIsReleasableDraft({ error: 'NONCE_SEAT_TAKEN', memoHex: MEMO })).toBe(true);
    expect(seatIsReleasableDraft({ error: 'NONCE_SEAT_TAKEN', retryable: true, memoHex: MEMO })).toBe(true);
    for (const error of ['NONCE_SEAT_TAKEN_SIGNED', 'NONCE_SEAT_TAKEN_REPORTED', 'NONCE_SEAT_UNREADABLE']) {
      expect(seatIsReleasableDraft({ error, memoHex: MEMO })).toBe(false);
      expect(describeSeatRefusal({ error, memoHex: MEMO }, t)!.mayFreeSeat).toBe(false);
    }
  });
});

describe('postHandoff — los campos que la espera necesita ya no se tiran', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { localStorage: { getItem: () => null } } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('un 409 conserva secondsLeft, lastLedgerSequence y el código', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'WAIT_FOR_PAYLOAD_EXPIRY',
        secondsLeft: 186,
        lastLedgerSequence: 98765,
        detail: 'el PA rXXX todavía puede firmar',
      }),
    });
    const r = await postHandoff('release', { memoHex: MEMO });
    expect(r.kind).toBe('refused');
    if (r.kind !== 'refused') return;
    expect(r.secondsLeft).toBe(186);
    expect(r.lastLedgerSequence).toBe(98765);
    expect(r.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
  });

  it('un cero o un negativo no cuentan como ventana', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'X', secondsLeft: 0 }) });
    const r = await postHandoff('release', { memoHex: MEMO });
    expect(r.kind === 'refused' && r.secondsLeft).toBeUndefined();
  });
});

describe('la respuesta del release se lee HONESTAMENTE (200 released:false ≠ liberado)', () => {
  it('200 {released:false} es «no había nada que liberar», nunca «liberado»', () => {
    const o = readSeatRelease({ kind: 'ok', status: 200, body: { released: false } });
    expect(o.kind).toBe('nothing-to-free');
    // …y jamás la frase del 409: a un pago firmado no le espera nadie.
    expect(seatReleaseSentence(o, t)).not.toMatch(/can still be signed/i);
  });

  it('200 {released:false, code:NONCE_SEAT_TAKEN_SIGNED} lo dice: ya está firmado', () => {
    const o = readSeatRelease({
      kind: 'ok',
      status: 200,
      body: { released: false, code: 'NONCE_SEAT_TAKEN_SIGNED' },
    });
    expect(o).toEqual({ kind: 'nothing-to-free', code: 'NONCE_SEAT_TAKEN_SIGNED' });
    expect(seatReleaseSentence(o, t)).toMatch(/already signed/i);
  });

  it('409 WAIT_FOR_PAYLOAD_EXPIRY SÍ es una espera, con sus segundos', () => {
    const o = readSeatRelease({
      kind: 'refused',
      status: 409,
      error: 'WAIT_FOR_PAYLOAD_EXPIRY',
      code: 'WAIT_FOR_PAYLOAD_EXPIRY',
      secondsLeft: 42,
    });
    expect(o).toEqual({ kind: 'wait', secondsLeft: 42 });
    expect(seatReleaseSentence(o, t)).toContain('42 s');
  });

  it('200 liberado de verdad', () => {
    expect(readSeatRelease({ kind: 'ok', status: 200, body: { released: true } }).kind).toBe('freed');
    // Un backend viejo que no manda el campo: se sigue tratando como liberación.
    expect(readSeatRelease({ kind: 'ok', status: 200, body: {} }).kind).toBe('freed');
  });

  it('403 / sin respuesta: rechazo, y nunca la frase de la espera', () => {
    expect(readSeatRelease({ kind: 'refused', status: 403, error: 'NOT_THE_HANDOFF_OWNER' }).kind).toBe('refused');
    expect(readSeatRelease({ kind: 'unreachable', detail: 'offline' }).kind).toBe('refused');
  });
});

describe('freeSeatOfRefusalResult — el viaje completo', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { localStorage: { getItem: () => null } } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('un 200 {released:false} sobre un borrador NO se anuncia como liberado', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ released: false }) });
    const o = await freeSeatOfRefusalResult({ error: 'NONCE_SEAT_TAKEN', memoHex: MEMO });
    expect(o.kind).toBe('nothing-to-free');
    // El booleano de siempre sigue siendo honesto para quien solo elige rama.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ released: false }) });
    await expect(freeSeatOfRefusal({ error: 'NONCE_SEAT_TAKEN', memoHex: MEMO })).resolves.toBe(false);
  });

  it('sobre lo firmado ni se intenta la llamada', async () => {
    const o = await freeSeatOfRefusalResult({ error: 'NONCE_SEAT_TAKEN_SIGNED', memoHex: MEMO });
    expect(o).toEqual({ kind: 'not-offered' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refusalHeadline — un slug del servidor jamás es el titular', () => {
  it('sustituye el código crudo por la única frase honesta', () => {
    expect(refusalHeadline({ error: 'CAP_EXCEEDED' }, t)).toMatch(/refused this operation/i);
    expect(refusalHeadline({ error: 'NO_DIRECTOR_CEDED' }, t)).toMatch(/refused this operation/i);
  });
  it('respeta una frase que escribió una persona', () => {
    expect(refusalHeadline({ error: 'The per-account cap must be a number (0 = no cap).' }, t)).toContain('cap must be');
  });
  it('un asiento se explica con su propia frase, mejor que la genérica', () => {
    expect(refusalHeadline({ error: 'NONCE_SEAT_TAKEN_SIGNED' }, t)).toMatch(/already signed/i);
  });
  it('reconoce qué es un slug y qué no', () => {
    expect(looksLikeRawCode('NONCE_SEAT_TAKEN')).toBe(true);
    expect(looksLikeRawCode('DENIED')).toBe(true);
    expect(looksLikeRawCode('Signed, but the relay refused')).toBe(false);
    expect(looksLikeRawCode('')).toBe(false);
  });
});

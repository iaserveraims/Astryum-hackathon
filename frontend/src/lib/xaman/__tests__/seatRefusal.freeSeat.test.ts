import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSeatRefusal, freeSeatOfRefusal, seatRefusalCode, serverDetailIfEnglish } from '../seatRefusal';

/**
 * CINCO SUPERFICIES MUDAS.
 *
 * El usuario veía `NONCE_SEAT_TAKEN` crudo y, debajo, un párrafo EN CASTELLANO
 * con hashes, sobre una pantalla en inglés, y ~604 s de espera sin ninguna
 * acción: su propia salida bloqueada y sin explicación.
 *
 * Lo que faltaba no era la frase (ya existía) sino los campos:
 *   · `code` — algunas rutas lo llaman así y no `error`;
 *   · `memoHex` — el 0xFE que OCUPA el asiento. El servidor solo se lo manda a
 *     quien lo preparó o a quien prueba la cuenta, porque nombra un pago; con
 *     él, la persona libera SU propio asiento en vez de esperarlo;
 *   · y el `detail` en castellano, que no se pinta.
 */

const t = (s: string) => s;
const MEMO = 'FE' + '01'.repeat(40);

describe('el código llega como `error` o como `code`', () => {
  it('lee los dos', () => {
    expect(seatRefusalCode({ error: 'NONCE_SEAT_TAKEN_SIGNED' })).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(seatRefusalCode({ code: 'NONCE_SEAT_TAKEN_SIGNED' })).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(describeSeatRefusal({ code: 'NONCE_SEAT_UNREADABLE' }, t)?.kind).toBe('unreadable');
  });

  it('la vista lleva el código para el llamante, y jamás lo pinta en la frase', () => {
    const v = describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN_SIGNED' }, t)!;
    expect(v.code).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(v.text).not.toContain('NONCE_SEAT');
  });
});

describe('«Free the seat» — solo cuando el servidor nos dijo cuál es', () => {
  it('sin memo no se ofrece (es lo que pasaba en las cinco superficies)', () => {
    expect(describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', retryable: false, secondsLeft: 604 }, t)?.mayFreeSeat).toBe(false);
  });

  it('con memo, sobre un BORRADOR, sí — aunque no se pueda desplazar', () => {
    const v = describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', retryable: false, secondsLeft: 604, memoHex: MEMO }, t)!;
    expect(v.mayFreeSeat).toBe(true);
    expect(v.memoHex).toBe(MEMO.toUpperCase());
    expect(v.secondsLeft).toBe(604);
    expect(v.text).toContain('your own prepared payment');
  });

  it('NUNCA sobre un asiento firmado o reportado: ese pago aún puede aterrizar', () => {
    for (const error of ['NONCE_SEAT_TAKEN_SIGNED', 'NONCE_SEAT_TAKEN_REPORTED']) {
      expect(describeSeatRefusal({ error, memoHex: MEMO }, t)?.mayFreeSeat).toBe(false);
    }
  });

  it('NUNCA con el ledger ilegible: «no pude leer» no es «está libre»', () => {
    expect(describeSeatRefusal({ error: 'NONCE_SEAT_UNREADABLE', memoHex: MEMO }, t)?.mayFreeSeat).toBe(false);
  });

  it('un memo que no es un memo se ignora', () => {
    expect(describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', memoHex: '  ' }, t)?.mayFreeSeat).toBe(false);
    expect(describeSeatRefusal({ error: 'NONCE_SEAT_TAKEN', memoHex: 'no-hex' }, t)?.mayFreeSeat).toBe(false);
  });
});

describe('freeSeatOfRefusal — la liberación real, por el memo', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { localStorage: { getItem: () => null } } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('llama a /handoff/release con el memo y dice que sí cuando el servidor libera', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(freeSeatOfRefusal({ error: 'NONCE_SEAT_TAKEN', memoHex: MEMO })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/flare-demo/handoff/release');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ memoHex: MEMO });
  });

  it('un rechazo del servidor NO se pinta como liberado', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'NOT_THE_HANDOFF_OWNER' }) });
    await expect(freeSeatOfRefusal({ error: 'NONCE_SEAT_TAKEN', memoHex: MEMO })).resolves.toBe(false);
  });

  it('sin memo, sobre un firmado, o sobre algo que no es un asiento: ni se intenta', async () => {
    await expect(freeSeatOfRefusal({ error: 'NONCE_SEAT_TAKEN' })).resolves.toBe(false);
    await expect(freeSeatOfRefusal({ error: 'NONCE_SEAT_TAKEN_SIGNED', memoHex: MEMO })).resolves.toBe(false);
    await expect(freeSeatOfRefusal({ error: 'CAP_EXCEEDED', memoHex: MEMO })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('serverDetailIfEnglish — el castellano del servidor no se pinta', () => {
  it('deja pasar un detalle claramente inglés', () => {
    expect(serverDetailIfEnglish('seat held until ledger 96812341')).toBe('seat held until ledger 96812341');
  });

  it('se traga el párrafo en castellano (con y sin tildes)', () => {
    expect(serverDetailIfEnglish('el PA rXXXX ya tiene un 0xFE firmado y el asiento sigue ocupado')).toBeNull();
    expect(serverDetailIfEnglish('La orden está pendiente hasta que pase su ventana')).toBeNull();
  });

  it('vacío o ausente es null, nunca una cadena huérfana bajo un titular', () => {
    expect(serverDetailIfEnglish('')).toBeNull();
    expect(serverDetailIfEnglish(null)).toBeNull();
    expect(serverDetailIfEnglish(undefined)).toBeNull();
  });
});

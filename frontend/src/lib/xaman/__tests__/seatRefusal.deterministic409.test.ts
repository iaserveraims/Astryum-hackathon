import { describe, expect, it } from 'vitest';
import { describeDeterministicProofRefusal, isDeterministicProofRefusal, refusalHeadline } from '../seatRefusal';
import { serverRefusalText } from '../../errors/serverRefusal';

/**
 * productizer it. 23 (it. 22 §2.5) — LOS DOS 409 SIN LECTOR.
 *
 * `ACCOUNT_RECORD_MISSING` y `PROOF_FLOOR_UNREADABLE` (agente E, it. 21 §2.4)
 * son lo CONTRARIO de la familia «no pude leer, vuelve a intentarlo»: la fila
 * del usuario no está, o su bloque `security` no se parsea, y esperar no cambia
 * nada. Por eso son 409 con `retryable:false` y no el 503 que eran.
 *
 * Ninguna pantalla los conocía, así que los dos degradaban a «The server refused
 * this operation» — sobre los únicos bytes que un cosignatario puede firmar, y
 * tirando las dos ÚNICAS salidas reales: firmar con esa wallet (una wallet
 * conectada se prueba sola y no necesita fila guardada) o que un admin repare.
 */

const t = (s: string) => s;

describe('los dos 409 deterministas tienen frase propia', () => {
  it.each(['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE'])('%s: nombra las dos salidas reales', (code) => {
    const v = describeDeterministicProofRefusal({ status: 409, error: code, retryable: false }, t);
    expect(v).not.toBeNull();
    expect(v!.mayRetry).toBe(false);
    expect(v!.text).toContain('sign in with the wallet that controls this address');
    expect(v!.text).toContain('administrator');
    expect(v!.text).toContain('will not fix itself by waiting');
    // Jamás el código en pantalla.
    expect(v!.text).not.toContain(code);
    expect(isDeterministicProofRefusal({ error: code })).toBe(true);
  });

  it('jamás ofrecen un reintento: es la promesa que el 503 no podía cumplir', () => {
    const v = describeDeterministicProofRefusal({ error: 'ACCOUNT_RECORD_MISSING' }, t);
    expect(v!.text).not.toContain('Try again');
  });

  it('el titular genérico ya no se los come', () => {
    for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE']) {
      const said = refusalHeadline({ status: 409, error: code, retryable: false }, t) ?? '';
      expect(said).not.toContain('The server refused this operation');
      expect(said).toContain('needs no stored record');
    }
  });

  it('y el lector del otro carril (serverRefusal) tampoco', () => {
    for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE']) {
      const said = serverRefusalText(Object.assign(new Error(code), { status: 409, body: { error: code } }), t);
      expect(said).not.toContain('did not explain why');
      expect(said).toContain('administrator');
    }
  });

  it('lo que no es uno de los dos sigue sin lector aquí', () => {
    expect(describeDeterministicProofRefusal({ error: 'ADDRESS_NOT_PROVEN' }, t)).toBeNull();
    expect(describeDeterministicProofRefusal(null, t)).toBeNull();
    expect(isDeterministicProofRefusal({ error: 'PROOF_STORE_UNREADABLE' })).toBe(false);
  });
});

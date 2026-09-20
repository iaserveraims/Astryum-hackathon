import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWithdrawnSeat } from '@/lib/xaman/seatRefusal';

/**
 * `ProposalInbox.withdraw` IGNORABA EL CAMPO `seat`.
 *
 * `POST /council/proposals/:id/withdraw` contesta
 * `{ ok, proposal, seat }` y `seat` lleva la MISMA gramática que el release de la
 * ceremonia (`seatReleaseAnswer`): si el asiento de nonce del 0xFE se soltó y, si
 * no, por qué. La bandeja hacía `await withdraw(); reload()` y tiraba el campo, así
 * que el proponente no veía que el asiento quedó retenido ni por qué — y se
 * encontraba `NONCE_SEAT_TAKEN` en la siguiente salida sin que nadie se lo hubiera
 * dicho, cuando el servidor SÍ se lo había dicho.
 */

const t = (s: string) => s;
const SRC = readFileSync(join(__dirname, '..', 'ProposalInbox.tsx'), 'utf8');

describe('describeWithdrawnSeat — la gramática del servidor, en una frase', () => {
  it('sin marca y con el payload vivo: `released:false` + WAIT_FOR_PAYLOAD_EXPIRY + segundos ⇒ «sigue ocupado», con la cuenta atrás del servidor', () => {
    const v = describeWithdrawnSeat(
      {
        released: false,
        reason: 'not-pinned-by-us',
        pin: 'none',
        code: 'WAIT_FOR_PAYLOAD_EXPIRY',
        retryable: true,
        secondsLeft: 604,
        detail:
          'We have no record that this app’s multisig coordinator pinned these bytes — they may have been composed elsewhere; the seat is measured exactly as any unsigned dispatch is: it can still be signed for 604 s.',
      },
      t,
    )!;
    expect(v).toBeTruthy();
    expect(v.kind).toBe('held');
    expect(v.secondsLeft).toBe(604);
    expect(v.text).toContain('604');
    expect(v.text).toMatch(/is withdrawn/);
    expect(v.text).toMatch(/not free yet/);
    // La retirada NO se disfraza de asiento libre, y no se pinta la mecánica interna del pin.
    expect(v.text).not.toMatch(/free again/);
    expect(v.text).not.toMatch(/multisig coordinator/);
    expect(v.text).not.toMatch(/WAIT_FOR_PAYLOAD_EXPIRY/);
  });

  it('firma reportada y ledger sin validar (WAIT_FOR_PAYLOAD_EXPIRY + detail del servidor): la frase del servidor viaja', () => {
    const detail =
      'A signature was reported for that dispatch and the ledger has not validated it yet, so its nonce seat stays taken. The ledger decides — it either shows that Payment or closes its window without it.';
    const v = describeWithdrawnSeat({ released: false, pin: 'row', code: 'WAIT_FOR_PAYLOAD_EXPIRY', retryable: true, secondsLeft: 40, detail }, t)!;
    expect(v.kind).toBe('held');
    expect(v.text).toContain(detail);
  });

  it('ya firmado / reportado sin ventana: «el ledger decide», jamás «libre»', () => {
    for (const code of ['NONCE_SEAT_TAKEN_SIGNED', 'NONCE_SEAT_TAKEN_REPORTED']) {
      const v = describeWithdrawnSeat({ released: false, pin: 'row', code, retryable: false }, t)!;
      expect(v.kind, code).toBe('held');
      expect(v.text).toMatch(/ledger decides/);
      expect(v.text).not.toMatch(/free again/);
    }
  });

  it('una BD caída al soltar: `SEAT_STATE_UNREADABLE` ⇒ «no pude leer», que no es «libre»', () => {
    const v = describeWithdrawnSeat({ released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true }, t)!;
    expect(v.kind).toBe('unreadable');
    expect(v.text).toMatch(/could not read/);
    expect(v.text).toMatch(/never «it is free»/);
    expect(v.text).toMatch(/is withdrawn/);
  });

  it('Soltado: verde, y sin reservar el asiento', () => {
    const v = describeWithdrawnSeat({ released: true, reason: 'ceremony-ended', pin: 'row' }, t)!;
    expect(v.kind).toBe('freed');
    expect(v.text).toMatch(/free again/);
    expect(v.text).toMatch(/not reserved/);
  });

  it('sin campo (no era un 0xFE) o sin fila bajo esos bytes: nada que decir', () => {
    expect(describeWithdrawnSeat(undefined, t)).toBeNull();
    expect(describeWithdrawnSeat(null, t)).toBeNull();
    expect(describeWithdrawnSeat({ released: false, reason: 'not-found' }, t)).toBeNull();
  });

  it('jamás el `detail` en castellano de una ruta vieja', () => {
    const v = describeWithdrawnSeat(
      { released: false, code: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 12, detail: 'el payload aún puede firmarse durante 12 s' },
      t,
    )!;
    expect(v.text).not.toMatch(/el payload/);
    expect(v.text).toContain('12');
  });
});

describe('EL CABLE: ProposalInbox.withdraw lee `seat` y lo pinta', () => {
  it('la respuesta del withdraw ya no se tira: se lee `seat` con el lector y se guarda', () => {
    expect(SRC).toMatch(/const res = await councilProposalsApi\.withdraw\(/);
    expect(SRC).toMatch(/setWithdrawnSeat\(describeWithdrawnSeat\(\(res as \{ seat\?: unknown \}\)\.seat, tRef\.current\)\)/);
    // Y se limpia al empezar, para que un aviso viejo no sobreviva a la siguiente retirada.
    expect(SRC).toMatch(/setActionError\(null\);\s*setWithdrawnSeat\(null\);/);
  });

  it('se pinta al lado de los errores de acción: verde solo si se soltó', () => {
    expect(SRC).toMatch(/\{withdrawnSeat && \(\s*<InlineNotice tone=\{withdrawnSeat\.kind === 'freed' \? 'success' : 'warning'\}>\{withdrawnSeat\.text\}<\/InlineNotice>/);
  });
});

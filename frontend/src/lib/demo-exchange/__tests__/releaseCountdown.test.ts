/**
 * «Back» on a composed put-to-work leaves the
 * reservation waiting for the LEDGER, and the desk says how long with the
 * server's own numbers, then tries ONCE when the window closes.
 */
import { describe, expect, it } from 'vitest';
import { msUntilRetry, releaseWaitFromRefusal, releaseWaitText, seatSecondsLeft, seatWaitFrom, seatWaitText, secondsLeft, RELEASE_RETRY_MARGIN_MS } from '../releaseCountdown';

const t = (s: string) => s;
const NOW = 1_700_000_000_000;

describe('releaseWaitFromRefusal', () => {
  it('takes the ledger and the seconds the server named', () => {
    const w = releaseWaitFromRefusal('dp1', { status: 409, error: 'WAIT_FOR_LAST_LEDGER', lastLedgerSequence: 1100, ledgersLeft: 41, secondsLeft: 164 }, NOW)!;
    expect(w.deskPaymentId).toBe('dp1');
    expect(w.lastLedgerSequence).toBe(1100);
    expect(w.retryAtMs).toBe(NOW + 164_000 + RELEASE_RETRY_MARGIN_MS);
    expect(w.retried).toBe(false);
  });

  it('with only the ledgers left, estimates from them; with neither, waits without inventing a ledger', () => {
    const byLedgers = releaseWaitFromRefusal('dp1', { status: 409, error: 'WAIT_FOR_LAST_LEDGER', ledgersLeft: 10 }, NOW)!;
    expect(byLedgers.retryAtMs).toBe(NOW + 40_000 + RELEASE_RETRY_MARGIN_MS);
    const bare = releaseWaitFromRefusal('dp1', { status: 409, error: 'WAIT_FOR_LAST_LEDGER' }, NOW)!;
    expect(bare.lastLedgerSequence).toBeNull();
    expect(bare.retryAtMs).toBeGreaterThan(NOW);
  });

  it('any other refusal is not a wait (a release that failed is not a countdown)', () => {
    for (const r of [
      { status: 409, error: 'DESK_PAYMENT_UNACCOUNTED_ON_LEDGER' },
      { status: 503, error: 'DESK_PAYMENT_UNPROVABLE' },
      { status: 409, error: 'DESK_PAYMENT_EXECUTED' },
    ]) {
      expect(releaseWaitFromRefusal('dp1', r, NOW)).toBeNull();
    }
  });
});

describe('the countdown and the single retry', () => {
  const wait = releaseWaitFromRefusal('dp1', { status: 409, error: 'WAIT_FOR_LAST_LEDGER', lastLedgerSequence: 1100, secondsLeft: 60 }, NOW)!;

  it('counts down to zero and never below', () => {
    expect(secondsLeft(wait, NOW)).toBe(66);
    expect(secondsLeft(wait, NOW + 30_000)).toBe(36);
    expect(secondsLeft(wait, NOW + 600_000)).toBe(0);
  });

  it('the automatic retry is owed once, and only while it has not happened', () => {
    expect(msUntilRetry(wait, NOW)).toBe(66_000);
    expect(msUntilRetry(wait, NOW + 600_000)).toBe(0);
    expect(msUntilRetry({ ...wait, retried: true }, NOW)).toBeNull();
  });

  it('says the ledger and the seconds, and after the retry it is the operator\'s button', () => {
    const before = releaseWaitText(wait, NOW, t);
    expect(before).toContain('XRPL ledger 1100');
    expect(before).toContain('66 s');
    expect(before).toMatch(/asks again by itself/);
    const after = releaseWaitText({ ...wait, retried: true }, NOW + 600_000, t);
    expect(after).toContain('XRPL ledger 1100');
    expect(after).toMatch(/can no longer be signed/);
  });

  /**
   * The three surfaces of one rule. The line no
   * longer promises «release it now» beside a button that says «only if it
   * never reached Xaman» — every one of them now names the SAME fact: the
   * payload can no longer be signed.
   */
  it('never tells the operator to judge whether it reached Xaman — the ledger decides', () => {
    for (const w of [wait, { ...wait, retried: true }]) {
      for (const at of [NOW, NOW + 600_000]) {
        expect(releaseWaitText(w, at, t)).not.toMatch(/reached Xaman/i);
      }
    }
  });

  it('a ledger nobody told us is «—», never a guess', () => {
    const bare = releaseWaitFromRefusal('dp1', { status: 409, error: 'WAIT_FOR_LAST_LEDGER' }, NOW)!;
    expect(releaseWaitText(bare, NOW, t)).toContain('ledger — ');
  });
});

/**
 * EL ASIENTO DE UN 0xFE QUE SE CANCELÓ EN XAMAN.
 *
 * Rechazar (o cerrar la pestaña) no lo libera, y no debe: mientras el payload se
 * pueda firmar, soltarlo pone una segunda instrucción en el mismo nonce. Lo que
 * faltaba era la frase — y una cuenta atrás que CUENTE (3.4).
 */
describe('La espera del asiento del ómnibus (3.3)', () => {
  const NOW2 = 1_700_000_000_000;

  it('toma los segundos del SERVIDOR y les añade el mismo margen', () => {
    const w = seatWaitFrom(120, NOW2, 'WAIT_FOR_PAYLOAD_EXPIRY');
    expect(w.freesAtMs).toBe(NOW2 + 120_000 + RELEASE_RETRY_MARGIN_MS);
    expect(w.detail).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
  });

  it('sin número del servidor no se inventa ventana: solo el margen, y se marca «no medido»', () => {
    expect(seatWaitFrom(undefined, NOW2).freesAtMs).toBe(NOW2 + RELEASE_RETRY_MARGIN_MS);
    expect(seatWaitFrom(undefined, NOW2).measured).toBe(false);
    expect(seatWaitFrom(Number.NaN, NOW2).freesAtMs).toBe(NOW2 + RELEASE_RETRY_MARGIN_MS);
    expect(seatWaitFrom(-30, NOW2).freesAtMs).toBe(NOW2 + RELEASE_RETRY_MARGIN_MS);
    expect(seatWaitFrom(120, NOW2).measured).toBe(true);
  });

  it('y sin medida NO afirma que el payload esté muerto — solo lo que sabemos', () => {
    const t = (s: string) => s;
    const text = seatWaitText(seatWaitFrom(undefined, NOW2, '503'), NOW2 + 600_000, t);
    expect(text).toMatch(/Nothing was signed/);
    expect(text).toMatch(/could not read/i);
    expect(text).not.toMatch(/can no longer be signed/);
  });

  it('la cuenta atrás DECRECE y toca fondo en cero, nunca en negativo', () => {
    const w = seatWaitFrom(60, NOW2);
    expect(seatSecondsLeft(w, NOW2)).toBe(66);
    expect(seatSecondsLeft(w, NOW2 + 30_000)).toBe(36);
    expect(seatSecondsLeft(w, NOW2 + 600_000)).toBe(0);
  });

  it('la frase dice que nada se firmó mientras queda ventana, y qué hacer cuando pasa', () => {
    const w = seatWaitFrom(60, NOW2);
    const t = (s: string) => s;
    const waiting = seatWaitText(w, NOW2, t);
    expect(waiting).toContain('66');
    expect(waiting).toMatch(/Nothing was signed/);
    // Jamás promete que ya está libre mientras se pueda firmar.
    expect(waiting).not.toMatch(/was freed/);
    const past = seatWaitText(w, NOW2 + 600_000, t);
    expect(past).toMatch(/no longer be signed/);
  });
});

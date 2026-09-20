import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeRetryableRefusal,
  isRetryableReadFailure,
  readSeatRelease,
  refusalHeadline,
  seatFreesItselfSentence,
  seatReleaseRetryable,
  seatReleaseSentence,
} from '../seatRefusal';

/**
 * .
 *
 * Cuatro agujeros de una misma familia, y todos con la misma forma: EL SERVIDOR
 * DIJO ALGO ACCIONABLE Y LA PANTALLA NO LO LEÍA.
 */

const t = (s: string) => s;
const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

describe('describeRetryableRefusal — «una lectura nuestra falló» tiene frase y botón', () => {
  it('ACCOUNT_BUSY: nada se guardó, nada se movió, y cuándo volver', () => {
    const v = describeRetryableRefusal(
      { status: 503, error: 'ACCOUNT_BUSY', retryable: true, retryAfterSeconds: 2 },
      t,
    )!;
    expect(v).toBeTruthy();
    expect(v.mayRetry).toBe(true);
    expect(v.retryAfterSeconds).toBe(2);
    expect(v.text).toContain('Nothing was saved and nothing moved');
    expect(v.text).toContain('2');
    // Jamás el código crudo en la frase.
    expect(v.text).not.toContain('ACCOUNT_BUSY');
    // Y no es la salida de un duplicado: no ofrece componer otra orden.
    expect(v.mayConfirmAnotherOrder).toBe(false);
  });

  it('el `Retry-After` puede llegar en el cuerpo, y también cuenta', () => {
    const v = describeRetryableRefusal(
      { status: 503, error: 'ACCOUNT_BUSY', body: { retryAfter: '5' } },
      t,
    )!;
    expect(v.retryAfterSeconds).toBe(5);
  });

  it('sin segundos, la frase sigue siendo accionable — nunca un callejón', () => {
    const v = describeRetryableRefusal({ status: 503, error: 'PROOF_STORE_UNREADABLE' }, t)!;
    expect(v.mayRetry).toBe(true);
    expect(v.retryAfterSeconds).toBeUndefined();
    expect(v.text).toContain('Try again in a moment.');
    // No es un veredicto sobre la persona: no le quita nada.
    expect(v.text).toContain('we will not take anything away from you');
  });

  it('DUPLICATE_CHECK_UNREADABLE: reintento Y la salida explícita del servidor', () => {
    const v = describeRetryableRefusal(
      { status: 409, error: 'DUPLICATE_CHECK_UNREADABLE', retryable: true, confirmAnotherOrder: true },
      t,
    )!;
    expect(v.mayRetry).toBe(true);
    expect(v.mayConfirmAnotherOrder).toBe(true);
    // No afirma que la orden saliera: dice que NO se pudo comprobar.
    expect(v.text).toContain('could not check');
    expect(v.text).toContain('Nothing was composed and nothing moved');
  });

  it('lo que no es de esta familia devuelve null: el llamante conserva su pintura', () => {
    expect(describeRetryableRefusal({ error: 'CAP_EXCEEDED' }, t)).toBeNull();
    expect(describeRetryableRefusal({ error: 'NONCE_SEAT_TAKEN' }, t)).toBeNull();
    expect(describeRetryableRefusal(null, t)).toBeNull();
    expect(isRetryableReadFailure({ error: 'CAP_EXCEEDED' })).toBe(false);
    expect(isRetryableReadFailure({ error: 'ACCOUNT_BUSY' })).toBe(true);
  });

  it('refusalHeadline ya no manda un 503 al genérico «el servidor lo rechazó»', () => {
    const said = refusalHeadline({ status: 503, error: 'ACCOUNT_BUSY' }, t)!;
    expect(said).not.toContain('The server refused this operation');
    expect(said).toContain('busy');
  });
});

describe('ReadSeatRelease — «no pude leer» no es «no había nada»', () => {
  it('503 del release: ni libre ni ocupado, y con reintento', () => {
    const o = readSeatRelease({ kind: 'refused', status: 503, error: 'SEAT_STATE_UNREADABLE', body: { retryAfterSeconds: 3 } });
    expect(o.kind).toBe('unreadable');
    expect(seatReleaseRetryable(o)).toBe(true);
    const said = seatReleaseSentence(o, t)!;
    expect(said).toContain('we will not tell you it is free');
    expect(said).toContain('3');
  });

  it('200 {released:false} sigue siendo «no había nada que liberar», no un 503', () => {
    const o = readSeatRelease({ kind: 'ok', status: 200, body: { released: false } });
    expect(o.kind).toBe('nothing-to-free');
    expect(seatReleaseRetryable(o)).toBe(false);
  });
});

describe('La frase del asiento liberado no promete la carrera', () => {
  it('«freed» dice que está libre, y que no está reservado', () => {
    const said = seatReleaseSentence({ kind: 'freed' }, t)!;
    expect(said).toContain('was freed');
    expect(said).toContain('not reserved');
    // La frase vieja afirmaba un futuro que el servidor no controla.
    expect(said).not.toContain('you can prepare this one now.');
  });
});

describe('SeatFreesItselfSentence — qué se dice cuando nadie firmó', () => {
  it('sin respuesta del release, la verdad genérica: el asiento sigue tomado', () => {
    const said = seatFreesItselfSentence(null, t)!;
    expect(said).toContain('Nothing was signed');
    expect(said).toContain('holds this account’s nonce seat');
  });

  it('con el 409 del servidor, SUS segundos — jamás una estimación nuestra', () => {
    const said = seatFreesItselfSentence({ kind: 'wait', secondsLeft: 287 }, t)!;
    expect(said).toContain('287');
    expect(said).toContain('signing window passes');
  });

  it('liberado: se puede intentar, sin prometer que se gana', () => {
    const said = seatFreesItselfSentence({ kind: 'freed' }, t)!;
    expect(said).toContain('not reserved');
  });
});

describe('el cable: las pantallas que poseo leen esto', () => {
  it('XamanSingleSign cuenta la suerte del asiento cuando nadie firmó', () => {
    const src = read('components/xrpl/XamanSingleSign.tsx');
    // El final sin firma (cancelado / caducado / declinado) pasa por aquí.
    expect(src).toContain('const endWithoutSignature = (message: string) => {');
    expect(src).toContain('seatFreesItselfSentence(null, tRef.current)');
    expect(src).toContain('releaseHandoffSeatResult(memo)');
    expect(src).toContain('seatFreesItselfSentence(readSeatRelease(res), tRef.current)');
    // Y se pinta.
    expect(src).toContain('{seatNote ?');
  });

  it('el bloque compartido de «reintenta» existe y lo usan las consolas', () => {
    expect(read('components/xrpl/XamanSingleSign.tsx')).toContain('export function ReadFailureNotice(');
    for (const rel of [
      'components/institutional/OperatorConsole.tsx',
      'components/institutional/CageConsole.tsx',
      'components/managed/ManagerConsole.tsx',
      'components/managed/VaultCreator.tsx',
    ]) {
      expect(read(rel)).toContain('ReadFailureNotice');
    }
  });

  it('un 503 nuestro ya no se pinta como «la jaula rechazó»', () => {
    // OperatorConsole: el veredicto DENIED se calla para una lectura fallida.
    expect(read('components/institutional/OperatorConsole.tsx')).toContain(
      '!queueFull && !isRetryableReadFailure(denied)',
    );
    // ManagerConsole: lo mismo, y el panel literal de la jaula queda para la jaula.
    expect(read('components/managed/ManagerConsole.tsx')).toContain(
      '{denied && !isRetryableReadFailure(denied) && (',
    );
  });

  it('las cinco puertas de orden de consejo aceptan el 409 no comprobable', () => {
    for (const rel of [
      'components/institutional/OperatorConsole.tsx',
      'components/institutional/CageConsole.tsx',
      'components/managed/ManagerConsole.tsx',
      'components/managed/VaultCreator.tsx',
      'components/legacy/CouncilOrderCard.tsx',
      'components/legacy/CouncilVaultEntry.tsx',
    ]) {
      const src = read(rel);
      expect(src).toContain('mayConfirmAnotherOrder(');
      // El reintento existe además del confirm, y son botones distintos.
      expect(src).toContain('onRetry={');
      expect(src).toContain('retryAfterSeconds={');
    }
  });

  it('el panel distingue «ya salió» de «no pude comprobarlo»', () => {
    const src = read('components/xrpl/XamanSingleSign.tsx');
    expect(src).toContain("const uncheckable = code === 'DUPLICATE_CHECK_UNREADABLE'");
    expect(src).toContain("t('Compose another order anyway')");
    // Y no reutiliza la frase que afirma un duplicado que nadie vio.
    // La rama de «no pude comprobarlo» termina donde empieza el titular del
    // duplicado real: nada de esa rama puede afirmar que la orden ya salió.
    const idx = src.indexOf('const uncheckable');
    const end = src.indexOf('const headline = legacyGuard', idx);
    expect(idx).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(idx);
    expect(src.slice(idx, end)).not.toContain('The same order was sent to this council');
  });
});

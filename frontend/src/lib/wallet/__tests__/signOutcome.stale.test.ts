import { describe, expect, it } from 'vitest';
import { describeStaleHandoff, signFailureAction, signOutcome, staleEngineResult } from '../signOutcome';

/**
 * productizer it.16 (R5 5.2) — FIRMAR PASADA LA VENTANA NO LLEVABA A NINGÚN
 * SITIO.
 *
 * La ruta 'stale' vivía solo en `XamanSingleSign`, que NINGÚN 0xFE usa. En todas
 * las demás superficies el `tefMAX_LEDGER` llegaba como un mensaje que
 * `signOutcome` no conocía, así que se clasificaba «no se pudo confirmar…
 * recarga» — la frase más cara del repo dicha sobre la única cosa que sí
 * sabemos: que esa transacción JAMÁS va a validar y que no movió nada.
 *
 * El texto real que llega es el que envuelve `XamanWalletService`:
 *   «Transaction submission failed: The network refused this transaction
 *    (tefMAX_LEDGER). It never entered the ledger and it cost nothing.»
 * — el catch exterior construye un Error NUEVO con el mensaje, así que el campo
 * `xrplResult` ya no existe cuando alguien clasifica. Se leen las tres formas.
 */

const t = (s: string) => s;

/** El mensaje EXACTO que produce XamanWalletService.submitTransaction. */
const WRAPPED = (code: string) =>
  `Transaction submission failed: The network refused this transaction (${code}). It never entered the ledger and it cost nothing.`;

describe('staleEngineResult — las tres formas en que llega el veredicto', () => {
  it('la frase envuelta, que es la que de verdad llega a las pantallas', () => {
    expect(staleEngineResult(new Error(WRAPPED('tefMAX_LEDGER')))).toBe('tefMAX_LEDGER');
    expect(staleEngineResult(new Error(WRAPPED('tefPAST_SEQ')))).toBe('tefPAST_SEQ');
  });

  it('el campo que adjunta el servicio antes de envolverlo', () => {
    expect(staleEngineResult(Object.assign(new Error('boom'), { xrplResult: 'tefPAST_SEQ' }))).toBe('tefPAST_SEQ');
  });

  it('el código pelado', () => {
    expect(staleEngineResult('tefMAX_LEDGER')).toBe('tefMAX_LEDGER');
  });

  it('nada más lo dispara', () => {
    for (const e of [null, undefined, new Error('Failed to fetch'), new Error('tecNO_PERMISSION'), new Error('tefBAD_AUTH')]) {
      expect(staleEngineResult(e)).toBeNull();
    }
  });
});

describe('signOutcome — un tef* caducado ya no es «no se pudo confirmar»', () => {
  it('devuelve «stale» con su código', () => {
    expect(signOutcome(new Error(WRAPPED('tefMAX_LEDGER')), true)).toEqual({ kind: 'stale', code: 'tefMAX_LEDGER' });
  });

  it('el veredicto de la RED manda incluso si el llamante creía no haber entregado nada', () => {
    // Un tef* solo existe porque la tx llegó a la red: la inferencia no lo entierra.
    expect(signOutcome(new Error(WRAPPED('tefPAST_SEQ')), false)).toEqual({ kind: 'stale', code: 'tefPAST_SEQ' });
  });

  it('lo de siempre sigue igual: un «Failed to fetch» tras entregar sigue siendo sin confirmar', () => {
    expect(signOutcome(new Error('Failed to fetch'), true).kind).toBe('unconfirmed');
    expect(signOutcome(new Error('user rejected the request'), true).kind).toBe('not-sent');
    expect(signOutcome(new Error('execution reverted: cap'), true).kind).toBe('reverted');
  });
});

describe('describeStaleHandoff — la frase que sale en TODA superficie 0xFE', () => {
  it('dice que no se puede usar, que no movió nada y que el asiento se libera solo', () => {
    const d = describeStaleHandoff(new Error(WRAPPED('tefMAX_LEDGER')), t);
    expect(d?.code).toBe('tefMAX_LEDGER');
    expect(d?.message).toContain('can no longer be used');
    expect(d?.message).toContain('Prepare it again');
    expect(d?.message).toContain('seat frees itself');
    // Nada de «recarga la página» ni «no se pudo confirmar».
    expect(d?.message).not.toMatch(/could not (be )?confirm/i);
    expect(d?.message).not.toMatch(/reload/i);
  });

  it('distingue la ventana del ledger de la secuencia consumida', () => {
    expect(describeStaleHandoff(new Error(WRAPPED('tefMAX_LEDGER')), t)?.message).toContain('ledger window passed');
    expect(describeStaleHandoff(new Error(WRAPPED('tefPAST_SEQ')), t)?.message).toContain('sequence number');
  });

  it('devuelve null cuando no es un caducado, para que el llamante siga con su lectura', () => {
    expect(describeStaleHandoff(new Error('Failed to fetch'), t)).toBeNull();
  });
});

describe('signFailureAction — el caducado manda a PREPARARLA OTRA VEZ, no a la ambar', () => {
  it('vista «form» (suelta el payload preparado) con la frase del caducado', () => {
    const a = signFailureAction(new Error(WRAPPED('tefMAX_LEDGER')), true, t);
    expect(a.view).toBe('form');
    expect(a.view === 'form' && a.message).toContain('Prepare it again');
  });
});

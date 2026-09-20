/**
 * «La mandaste, todavía no sé si entró» NO es un fallo.
 *
 * `sendIntentCalls` lanza con `code: RECEIPT_UNREAD` cuando la transacción SALIÓ
 * pero no se pudo leer su recibo (timeout, 429, nodo caído). Distinguirlo de un
 * error de verdad importa porque la reacción correcta es la CONTRARIA: ante un
 * fallo se reintenta, y ante esto no se vuelve a firmar — reintentar es
 * exactamente como se paga dos veces.
 */
import { describe, it, expect } from 'vitest';
import { isInFlight, inFlightInfo, explorerTxUrl, RECEIPT_UNREAD } from '../inFlightError';

const HASH = '0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';

const unread = () =>
  Object.assign(new Error('Step 1/2 is IN FLIGHT — sent, but not confirmed yet.'), {
    code: RECEIPT_UNREAD, txHash: HASH, stepIndex: 0, totalSteps: 2,
  });

describe('isInFlight', () => {
  it('reconoce el error de recibo ilegible', () => {
    expect(isInFlight(unread())).toBe(true);
  });

  it('un revert de verdad NO es «en vuelo» — ahí sí se reintenta', () => {
    expect(isInFlight(new Error('transaction reverted (0xdead…)'))).toBe(false);
  });

  it('un rechazo del usuario tampoco', () => {
    expect(isInFlight(Object.assign(new Error('User rejected'), { code: 4001 }))).toBe(false);
  });

  it('no revienta con null, undefined ni con un string', () => {
    expect(isInFlight(null)).toBe(false);
    expect(isInFlight(undefined)).toBe(false);
    expect(isInFlight('boom')).toBe(false);
  });
});

describe('inFlightInfo — los datos que hacen útil el aviso', () => {
  it('devuelve el hash y en qué paso se quedó', () => {
    expect(inFlightInfo(unread())).toEqual({ txHash: HASH, stepIndex: 0, totalSteps: 2 });
  });

  it('devuelve null para cualquier otro error', () => {
    expect(inFlightInfo(new Error('nope'))).toBeNull();
  });
});

describe('explorerTxUrl — poder comprobarlo con los propios ojos', () => {
  it('chain 1 va a Etherscan', () => {
    expect(explorerTxUrl(1, HASH)).toBe(`https://etherscan.io/tx/${HASH}`);
  });

  it('lo demás va al explorador de Flare', () => {
    expect(explorerTxUrl(14, HASH)).toBe(`https://flarescan.com/tx/${HASH}`);
  });

  it('un hash de XRPL va a XRPScan, jamás a Flarescan', () => {
    const XRPL_HASH = 'A'.repeat(64);
    expect(explorerTxUrl('xrpl', XRPL_HASH)).toBe(`https://xrpscan.com/tx/${XRPL_HASH}`);
    expect(explorerTxUrl('xrpl', XRPL_HASH)).not.toContain('flarescan');
  });
});

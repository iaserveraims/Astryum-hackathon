/**
 * La regla que decide si un pago XRPL ocurrió. Dos fallos reales la motivan:
 *
 *   · un `tec*` está VALIDADO y no hizo el pago — se pintaba verde;
 *   · un rechazo del nodo (`tef*`/`tem*`) devuelve txid igualmente — se vigilaba
 *     para siempre un hash que jamás iba a aparecer.
 *
 * Y el contrapeso, que también es un bug cerrado de esta casa: «no he podido
 * leer» JAMÁS puede convertirse en «ha fallado» (anunciar el timeout
 * como fallo empujaba al DOBLE depósito).
 */

import { describe, expect, it } from 'vitest';
import { classifyXrplResult, isTerminalFailure, verdictFromTxRead } from '../xrpl/txResult';

describe('classifyXrplResult', () => {
  it('tesSUCCESS es la única que asienta', () => {
    expect(classifyXrplResult('tesSUCCESS')).toBe('success');
  });

  it('tec* es fallo VALIDADO — está en el ledger y cobró fee', () => {
    expect(classifyXrplResult('tecUNFUNDED_PAYMENT')).toBe('failed-onchain');
    expect(classifyXrplResult('tecNO_DST_INSUF_XRP')).toBe('failed-onchain');
    expect(classifyXrplResult('tecNEED_MASTER_KEY')).toBe('failed-onchain');
  });

  it('ter* es reintentable — todavía puede entrar, no es terminal', () => {
    expect(classifyXrplResult('terQUEUED')).toBe('retryable');
    expect(classifyXrplResult('terPRE_SEQ')).toBe('retryable');
    expect(isTerminalFailure(classifyXrplResult('terQUEUED'))).toBe(false);
  });

  it('tef/tem/tel no entran jamás en el ledger', () => {
    expect(classifyXrplResult('tefPAST_SEQ')).toBe('failed-never');
    expect(classifyXrplResult('tefMAX_LEDGER')).toBe('failed-never');
    expect(classifyXrplResult('temREDUNDANT')).toBe('failed-never');
    expect(classifyXrplResult('telINSUF_FEE_P')).toBe('failed-never');
  });

  it('sin código NO se inventa veredicto', () => {
    expect(classifyXrplResult(undefined)).toBe('unknown');
    expect(classifyXrplResult(null)).toBe('unknown');
    expect(classifyXrplResult('')).toBe('unknown');
    expect(classifyXrplResult('   ')).toBe('unknown');
    expect(isTerminalFailure('unknown')).toBe(false);
  });

  it('un código desconocido tampoco se fuerza a verde ni a rojo', () => {
    expect(classifyXrplResult('xyzWHATEVER')).toBe('unknown');
  });

  it('las dos formas de fallo son terminales; el éxito no', () => {
    expect(isTerminalFailure('failed-onchain')).toBe(true);
    expect(isTerminalFailure('failed-never')).toBe(true);
    expect(isTerminalFailure('success')).toBe(false);
  });
});

describe('verdictFromTxRead', () => {
  it('validada + tesSUCCESS = asentada', () => {
    expect(verdictFromTxRead({ validated: true, meta: { TransactionResult: 'tesSUCCESS' } })).toEqual({
      kind: 'settled',
    });
  });

  it('validada + tec = FALLO, y dice que fue on-chain (costó fee)', () => {
    expect(
      verdictFromTxRead({ validated: true, meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' } }),
    ).toEqual({ kind: 'failed', code: 'tecUNFUNDED_PAYMENT', onChain: true });
  });

  it('lee metaData además de meta — rippled usa las dos formas', () => {
    expect(verdictFromTxRead({ validated: true, metaData: { TransactionResult: 'tesSUCCESS' } })).toEqual({
      kind: 'settled',
    });
  });

  it('txnNotFound es PENDIENTE, nunca fallo: el «nunca» no se prueba desde aquí', () => {
    expect(verdictFromTxRead({ error: 'txnNotFound' })).toEqual({ kind: 'pending' });
  });

  it('un resultado presente pero SIN validar sigue siendo pendiente', () => {
    // Provisional: hasta el cierre validado ese código puede cambiar.
    expect(verdictFromTxRead({ validated: false, meta: { TransactionResult: 'tesSUCCESS' } })).toEqual({
      kind: 'pending',
    });
  });

  it('lectura ausente o error del nodo = ilegible, que NO es fallo', () => {
    expect(verdictFromTxRead(null)).toEqual({ kind: 'unreadable' });
    expect(verdictFromTxRead(undefined)).toEqual({ kind: 'unreadable' });
    expect(verdictFromTxRead({ error: 'noNetwork' })).toEqual({ kind: 'unreadable' });
  });

  it('validada con un código ilegible no se pinta verde', () => {
    expect(verdictFromTxRead({ validated: true, meta: { TransactionResult: 'zzzNOPE' } })).toEqual({
      kind: 'unreadable',
    });
  });

  it('meta en binario (string) no rompe ni miente', () => {
    expect(verdictFromTxRead({ validated: true, meta: 'DEADBEEF' })).toEqual({ kind: 'unreadable' });
  });
});

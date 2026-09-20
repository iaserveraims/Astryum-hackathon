/**
 * La puerta de la llave del omnibus para ACEPTAR el KYC de una casilla.
 * Pura: lo que se prueba es qué deja firmar, no el ledger.
 */
import { assessCredentialAccept } from '../DemoExchangeSigner';

const ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const OTHER = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

const run = { omnibusAddress: OMNIBUS, councilAddress: ROOT };
const signer = { enabled: true, address: OMNIBUS };
const slotTypes = ['KYC-101', 'KYC-102'];
const accept = (over: Record<string, unknown> = {}) => ({ TransactionType: 'CredentialAccept', Account: OMNIBUS, Issuer: ROOT, CredentialType: hex('KYC-101'), ...over });

describe('assessCredentialAccept — la caja acepta lo que su raíz emitió, y nada más', () => {
  it('acepta el KYC de una casilla de este run, emitido por su raíz', () => {
    expect(assessCredentialAccept({ tx: accept(), run, signer, slotTypes })).toEqual({ ok: true });
  });

  it('con la llave apagada no firma', () => {
    expect(assessCredentialAccept({ tx: accept(), run, signer: { enabled: false, address: OMNIBUS }, slotTypes }).code).toBe('SIGNER_DISABLED');
  });

  it('solo CredentialAccept: ni emitir, ni borrar, ni pagar', () => {
    for (const TransactionType of ['CredentialCreate', 'CredentialDelete', 'Payment']) {
      expect(assessCredentialAccept({ tx: accept({ TransactionType }), run, signer, slotTypes }).code).toBe('NOT_A_CREDENTIAL_ACCEPT');
    }
  });

  it('ningún campo de más (un Amount o un Destination colados no pasan)', () => {
    expect(assessCredentialAccept({ tx: accept({ Amount: '1000000' }), run, signer, slotTypes }).code).toBe('UNEXPECTED_FIELD');
    expect(assessCredentialAccept({ tx: accept({ Destination: OTHER }), run, signer, slotTypes }).code).toBe('UNEXPECTED_FIELD');
  });

  it('solo desde el omnibus del run que abre la llave', () => {
    expect(assessCredentialAccept({ tx: accept({ Account: OTHER }), run, signer, slotTypes }).code).toBe('WRONG_SIGNER');
    expect(assessCredentialAccept({ tx: accept(), run: { ...run, omnibusAddress: OTHER }, signer, slotTypes }).code).toBe('WRONG_SIGNER');
  });

  it('solo una credencial emitida por la raíz de ESTE run', () => {
    expect(assessCredentialAccept({ tx: accept({ Issuer: OTHER }), run, signer, slotTypes }).code).toBe('ISSUER_NOT_THE_COUNCIL');
  });

  it('solo el tipo de una casilla de un cliente de este run', () => {
    expect(assessCredentialAccept({ tx: accept({ CredentialType: hex('KYC-999') }), run, signer, slotTypes }).code).toBe('TYPE_NOT_A_CLIENT_SLOT');
    expect(assessCredentialAccept({ tx: accept({ CredentialType: hex('OMNIBUS') }), run, signer, slotTypes }).code).toBe('TYPE_NOT_A_CLIENT_SLOT');
    expect(assessCredentialAccept({ tx: accept({ CredentialType: 'not-hex' }), run, signer, slotTypes }).code).toBe('TYPE_NOT_A_CLIENT_SLOT');
    expect(assessCredentialAccept({ tx: accept({ CredentialType: '' }), run, signer, slotTypes }).code).toBe('TYPE_NOT_A_CLIENT_SLOT');
  });
});

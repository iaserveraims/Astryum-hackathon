/**
 * El KYC del exchange, UNA CREDENCIAL POR CASILLA (fundador 14-sep, «solo B»):
 * emisor = la raíz del run, sujeto = el omnibus, tipo = `KYC-<tag>`.
 *
 * Lo que se fija: qué casilla pasa y cuál no; que la credencial de OTRA casilla
 * no sirve; que manda la relación (raíz del run), no la allowlist de Astryum; y
 * que un ledger ilegible jamás se cuenta como «no tiene» (503, no 409).
 *
 * Que la SALIDA no se gatea se fija en demoExchange.credentialGate.test: vive en
 * que ninguna ruta de salida llama al gate.
 */

import { assessClientCredential, credentialSpecForClient, type CredentialRead0 } from '../clientCredentialGate';
import type { CredentialRead } from '../../XrplCredentialVerifier';

const ROOT = 'rspDpPcVKhQtgbrkbhNvAqvvHhpMF49uaS';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const OTHER = 'rQLbzfJH5BT1FS9apRLKV3G8dWEA5njaQi';

const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

function cred(over: Partial<CredentialRead> = {}): CredentialRead {
  return {
    issuer: ROOT,
    subject: OMNIBUS,
    credentialType: 'KYC-101',
    credentialTypeHex: hex('KYC-101'),
    ledgerIndex: null,
    expiresAtISO: '2027-01-01T00:00:00.000Z',
    uri: null,
    accepted: true,
    state: 'valid',
    // A propósito false: el gate es RELACIONAL (emisor == raíz del run), jamás
    // depende de XRPL_CREDENTIAL_ISSUERS.
    issuerAccepted: false,
    reserveHeldBy: 'subject',
    ...over,
  };
}

const read = (credentials: CredentialRead[]): CredentialRead0 => ({ ok: true, credentials });
const spec101 = { issuer: ROOT, subject: OMNIBUS, credentialType: 'KYC-101' };

describe('credentialSpecForClient — qué credencial necesita cada casilla', () => {
  const SAVED = process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE;
    else process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE = SAVED;
  });

  it('emisor la raíz, sujeto el omnibus, tipo KYC-<tag>', () => {
    delete process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE;
    expect(credentialSpecForClient({ councilAddress: ROOT, omnibusAddress: OMNIBUS }, { tag: 101 })).toEqual(spec101);
  });

  it('el tipo base se configura, el tag siempre va detrás', () => {
    process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE = 'AML';
    expect(credentialSpecForClient({ councilAddress: ROOT, omnibusAddress: OMNIBUS }, { tag: 7 }).credentialType).toBe('AML-7');
  });

  it('el tipo de una casilla cabe en los 64 bytes de CredentialType', () => {
    const t = credentialSpecForClient({ councilAddress: ROOT, omnibusAddress: OMNIBUS }, { tag: 4294967295 }).credentialType;
    expect(Buffer.byteLength(t, 'utf8')).toBeLessThanOrEqual(64);
  });
});

describe('assessClientCredential — qué casilla puede mover capital', () => {
  it('la credencial aceptada y vigente de SU casilla abre la puerta', () => {
    const v = assessClientCredential({ spec: spec101, read: read([cred()]) });
    expect(v.ok).toBe(true);
  });

  it('«expiring-soon» sigue valiendo: avisar no es cerrar', () => {
    expect(assessClientCredential({ spec: spec101, read: read([cred({ state: 'expiring-soon' })]) }).ok).toBe(true);
  });

  it('el tipo casa también por hex', () => {
    expect(assessClientCredential({ spec: spec101, read: read([cred({ credentialType: hex('KYC-101') })]) }).ok).toBe(true);
  });

  it('de dos credenciales de la casilla, manda la de vencimiento más lejano', () => {
    const v = assessClientCredential({
      spec: spec101,
      read: read([cred({ expiresAtISO: '2026-10-01T00:00:00.000Z' }), cred({ expiresAtISO: '2028-01-01T00:00:00.000Z' })]),
    });
    expect(v.ok && v.expiresAtISO).toBe('2028-01-01T00:00:00.000Z');
  });
});

describe('assessClientCredential — cuándo se rehúsa, y con qué palabras', () => {
  it('sin la credencial de su casilla, no se mueve capital', () => {
    const v = assessClientCredential({ spec: spec101, read: read([]) });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('CLIENT_NOT_CREDENTIALED');
      expect(v.status).toBe(409);
      expect(v.detail).toMatch(/KYC-101/);
      expect(v.detail).toMatch(/Taking money out is never gated/i);
    }
  });

  it('la credencial de OTRA casilla (KYC-102) no le sirve a la 101', () => {
    const v = assessClientCredential({ spec: spec101, read: read([cred({ credentialType: 'KYC-102', credentialTypeHex: hex('KYC-102') })]) });
    expect(v.ok).toBe(false);
  });

  it('una KYC sin tag (el tipo viejo) no vale como la de ninguna casilla', () => {
    expect(assessClientCredential({ spec: spec101, read: read([cred({ credentialType: 'KYC', credentialTypeHex: hex('KYC') })]) }).ok).toBe(false);
  });

  it('emitida por otra cuenta que no es la raíz del run: no vale', () => {
    expect(assessClientCredential({ spec: spec101, read: read([cred({ issuer: OTHER })]) }).ok).toBe(false);
  });

  it('colgada de otra cuenta que no es el omnibus: no vale', () => {
    expect(assessClientCredential({ spec: spec101, read: read([cred({ subject: OTHER })]) }).ok).toBe(false);
  });

  it('caducada dice CADUCADA (se renueva), no «no tiene»', () => {
    const v = assessClientCredential({ spec: spec101, read: read([cred({ state: 'expired' })]) });
    if (!v.ok) expect(v.code).toBe('CLIENT_CREDENTIAL_EXPIRED');
    expect(v.ok).toBe(false);
  });

  it('emitida y sin aceptar por el omnibus: falta cerrar la ceremonia, y se dice', () => {
    const v = assessClientCredential({ spec: spec101, read: read([cred({ state: 'pending-acceptance', accepted: false })]) });
    if (!v.ok) expect(v.code).toBe('CLIENT_CREDENTIAL_PENDING');
    expect(v.ok).toBe(false);
  });

  it('LEDGER ILEGIBLE ≠ SIN CREDENCIAL: 503, y el texto lo dice', () => {
    const v = assessClientCredential({ spec: spec101, read: { ok: false, reason: 'websocket closed' } });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('CREDENTIALS_UNREADABLE');
      expect(v.status).toBe(503);
      expect(v.detail).toMatch(/NOT «no credential»/);
    }
  });
});

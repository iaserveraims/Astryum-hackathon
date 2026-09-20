/**
 * La vía OFF-LEDGER del título de gestor — una VC firmada por el partner.
 *
 * Lo que aquí se fija: la validación de claims es correcta (tipo, sujeto ligado
 * a la cuenta XRPL, `Expiration` siempre), la config lee/ignora bien, y la
 * verificación de FIRMA real (con jose, clave de juguete) sube de firma buena a
 * mala, emisor desconocido y caducada. FAIL-CLOSED: cualquier duda = «no».
 */
import {
  partnerGateConfig,
  validatePartnerClaims,
  verifyPartnerCredential,
  xrplSubjectMatches,
  type PartnerGateConfig,
} from '../PartnerCredentialVerifier';

const ACCOUNT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const ISS = 'did:web:partner.example';
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86_400;

describe('validatePartnerClaims (pura)', () => {
  const opts = { account: ACCOUNT, credentialTypes: ['AIFM'], nowSec: Math.floor(Date.now() / 1000) };

  it('acepta una VC con tipo AIFM, sujeto ligado a la cuenta y exp futuro', () => {
    const v = validatePartnerClaims(
      { iss: ISS, exp: FUTURE, vc: { type: ['VerifiableCredential', 'AIFM'] }, credentialSubject: { id: `did:xrpl:${ACCOUNT}`, credentialType: 'AIFM' } },
      opts,
    );
    expect(v).toEqual({ ok: true, issuer: ISS, credentialTypes: ['AIFM'] });
  });

  it('rechaza sin exp, o caducada — la Expiration es la revocación', () => {
    expect(validatePartnerClaims({ iss: ISS, credentialSubject: { id: `did:xrpl:${ACCOUNT}`, credentialType: 'AIFM' } }, opts).ok).toBe(false);
    expect(validatePartnerClaims({ iss: ISS, exp: opts.nowSec - 1, credentialSubject: { id: `did:xrpl:${ACCOUNT}`, credentialType: 'AIFM' } }, opts)).toEqual({ ok: false, code: 'EXPIRED' });
  });

  it('rechaza el tipo equivocado y el sujeto que no es esta cuenta', () => {
    expect(validatePartnerClaims({ iss: ISS, exp: FUTURE, credentialSubject: { id: `did:xrpl:${ACCOUNT}`, credentialType: 'KYC' } }, opts)).toEqual({ ok: false, code: 'WRONG_TYPE' });
    expect(validatePartnerClaims({ iss: ISS, exp: FUTURE, credentialSubject: { id: 'did:xrpl:rOTHER', credentialType: 'AIFM' } }, opts)).toEqual({ ok: false, code: 'WRONG_SUBJECT' });
  });

  it('el tipo vale tanto en credentialSubject como en vc.type', () => {
    expect(validatePartnerClaims({ iss: ISS, exp: FUTURE, vc: { type: ['VerifiableCredential', 'AIFM'] }, credentialSubject: { xrplAccount: ACCOUNT } }, opts).ok).toBe(true);
  });
});

describe('xrplSubjectMatches', () => {
  it('acepta did:xrpl:<cuenta> o un claim xrplAccount', () => {
    expect(xrplSubjectMatches({ credentialSubject: { id: `did:xrpl:${ACCOUNT}` } }, ACCOUNT)).toBe(true);
    expect(xrplSubjectMatches({ credentialSubject: { xrplAccount: ACCOUNT } }, ACCOUNT)).toBe(true);
    expect(xrplSubjectMatches({ credentialSubject: { id: 'did:xrpl:rOTRA' } }, ACCOUNT)).toBe(false);
  });
});

describe('partnerGateConfig', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it('sin config, lista vacía', () => {
    delete process.env.MANAGER_PARTNER_KEYS;
    expect(partnerGateConfig().keys).toEqual([]);
  });
  it('un JSON inválido se ignora (no abre la puerta), no revienta', () => {
    process.env.MANAGER_PARTNER_KEYS = 'no-es-json';
    expect(partnerGateConfig().keys).toEqual([]);
  });
  it('filtra entradas sin iss o sin jwk', () => {
    process.env.MANAGER_PARTNER_KEYS = JSON.stringify([{ iss: 'did:x', jwk: { kty: 'OKP' } }, { iss: 'sin-jwk' }, { jwk: {} }]);
    expect(partnerGateConfig().keys.map((k) => k.iss)).toEqual(['did:x']);
  });
});

describe('verifyPartnerCredential (firma real con jose)', () => {
  async function issue(over: Record<string, unknown> = {}, subject: Record<string, unknown> = {}) {
    const jose = await import('jose');
    const { publicKey, privateKey } = await jose.generateKeyPair('EdDSA');
    const jwt = await new jose.SignJWT({
      vc: { type: ['VerifiableCredential', 'ManagerLicense'] },
      credentialSubject: { id: `did:xrpl:${ACCOUNT}`, credentialType: 'AIFM', ...subject },
      ...over,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(ISS)
      .setExpirationTime('30d')
      .sign(privateKey);
    const jwk = (await jose.exportJWK(publicKey)) as Record<string, unknown>;
    return { jwt, jwk };
  }

  it('firma buena de un emisor de la allowlist → ok', async () => {
    const { jwt, jwk } = await issue();
    const cfg: PartnerGateConfig = { keys: [{ iss: ISS, jwk, alg: 'EdDSA' }], credentialTypes: ['AIFM'] };
    const v = await verifyPartnerCredential(jwt, { account: ACCOUNT, cfg });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.issuer).toBe(ISS);
  });

  it('emisor NO en la allowlist → UNKNOWN_ISSUER', async () => {
    const { jwt } = await issue();
    const other = await issue();
    const cfg: PartnerGateConfig = { keys: [{ iss: 'did:web:otro', jwk: other.jwk }], credentialTypes: ['AIFM'] };
    expect((await verifyPartnerCredential(jwt, { account: ACCOUNT, cfg })).ok).toBe(false);
  });

  it('firma con OTRA clave (mismo iss) → BAD_SIGNATURE', async () => {
    const { jwt } = await issue();
    const impostor = await issue(); // otra clave, mismo iss
    const cfg: PartnerGateConfig = { keys: [{ iss: ISS, jwk: impostor.jwk, alg: 'EdDSA' }], credentialTypes: ['AIFM'] };
    const v = await verifyPartnerCredential(jwt, { account: ACCOUNT, cfg });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('BAD_SIGNATURE');
  });

  it('sin JWT, o sin claves configuradas → no pasa', async () => {
    const { jwk } = await issue();
    const cfg: PartnerGateConfig = { keys: [{ iss: ISS, jwk }], credentialTypes: ['AIFM'] };
    expect((await verifyPartnerCredential(undefined, { account: ACCOUNT, cfg })).ok).toBe(false);
    const { jwt } = await issue();
    expect((await verifyPartnerCredential(jwt, { account: ACCOUNT, cfg: { keys: [], credentialTypes: ['AIFM'] } })).ok).toBe(false);
  });

  it('la VC ata al gestor: otra cuenta no vale aunque la firma sea buena', async () => {
    const { jwt, jwk } = await issue();
    const cfg: PartnerGateConfig = { keys: [{ iss: ISS, jwk, alg: 'EdDSA' }], credentialTypes: ['AIFM'] };
    const v = await verifyPartnerCredential(jwt, { account: 'rDIFERENTE0000000000000000000000000', cfg });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('WRONG_SUBJECT');
  });
});

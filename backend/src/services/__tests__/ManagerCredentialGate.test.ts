/**
 * La puerta del título de gestor — la parte pura. Lo que aquí se fija: la puerta
 * es FAIL-CLOSED (sin config no deja pasar; «no pude leer» no abre), que vale
 * SOLO una credencial del tipo exigido, de un emisor de la allowlist de GESTOR,
 * y viva; y que el refusal dice el hecho, nunca un juicio.
 */
import { evaluateManagerCredential, managerGateRefusal, type ManagerGateConfig } from '../ManagerCredentialGate';
import type { CredentialRead } from '../XrplCredentialVerifier';

const ISSUER_OK = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const ISSUER_OTHER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const ID = 'A'.repeat(64);

function cred(over: Partial<CredentialRead> = {}): CredentialRead {
  return {
    issuer: ISSUER_OK,
    subject: 'rSubject00000000000000000000000000',
    credentialType: 'AIFM',
    credentialTypeHex: '41494D46',
    ledgerIndex: ID,
    expiresAtISO: null,
    accepted: true,
    state: 'valid',
    issuerAccepted: false, // OJO: se calcula contra la lista del DEPOSITANTE, no la del gestor
    reserveHeldBy: 'subject',
    ...over,
  };
}

const CFG: ManagerGateConfig = { enabled: true, credentialTypes: ['AIFM'], issuers: new Set([ISSUER_OK]) };

describe('evaluateManagerCredential', () => {
  it('deja pasar una AIFM válida de un emisor acreditado, y devuelve su ledgerIndex como CredentialIDs', () => {
    const v = evaluateManagerCredential([cred()], CFG);
    expect(v.ok).toBe(true);
    if (v.ok && v.source === 'ledger') expect(v.credentialIds).toEqual([ID]);
    else throw new Error('esperaba una credencial on-ledger');
  });

  it('acepta expiring-soon (sigue valiendo, solo avisa)', () => {
    expect(evaluateManagerCredential([cred({ state: 'expiring-soon' })], CFG).ok).toBe(true);
  });

  it('el emisor se comprueba contra la allowlist de GESTOR, no contra issuerAccepted', () => {
    // issuerAccepted=false (lista del depositante) pero el emisor SÍ está en la del gestor → pasa.
    expect(evaluateManagerCredential([cred({ issuerAccepted: false })], CFG).ok).toBe(true);
    // emisor que no está en la del gestor → no pasa, aunque el tipo case.
    const v = evaluateManagerCredential([cred({ issuer: ISSUER_OTHER })], CFG);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('NO_MANAGER_CREDENTIAL');
  });

  it('EL TÍTULO ES DEL SUJETO: el emisor no pasa su propio gate con credenciales EMITIDAS a otros', () => {
    // El directorio del emisor lleva las credenciales que emitió (issuer=él,
    // subject=otros). Evaluando AL EMISOR, esas no cuentan (el
    // ancla emisora aterrizó en el estante Manager por esto).
    const issued = cred({ issuer: ISSUER_OK, subject: 'rDcohNUmBApE8bSPP695GkUsSMfBeM5Czj' });
    const asIssuer = evaluateManagerCredential([issued], CFG, ISSUER_OK);
    expect(asIssuer.ok).toBe(false);
    // Evaluando AL SUJETO, la misma credencial sí vale.
    const asSubject = evaluateManagerCredential([issued], CFG, 'rDcohNUmBApE8bSPP695GkUsSMfBeM5Czj');
    expect(asSubject.ok).toBe(true);
    // Sin subject dado, el comportamiento histórico no cambia.
    expect(evaluateManagerCredential([issued], CFG).ok).toBe(true);
  });

  it('rechaza el tipo equivocado, caducada, pendiente de aceptar, o sin ledgerIndex', () => {
    expect(evaluateManagerCredential([cred({ credentialType: 'KYC' })], CFG).ok).toBe(false);
    expect(evaluateManagerCredential([cred({ state: 'expired' })], CFG).ok).toBe(false);
    expect(evaluateManagerCredential([cred({ state: 'pending-acceptance' })], CFG).ok).toBe(false);
    expect(evaluateManagerCredential([cred({ ledgerIndex: null })], CFG).ok).toBe(false);
  });

  it('el tipo casa sin importar mayúsculas', () => {
    expect(evaluateManagerCredential([cred({ credentialType: 'aifm' })], CFG).ok).toBe(true);
  });

  it('FAIL-CLOSED: puerta apagada, o sin emisores configurados', () => {
    expect(evaluateManagerCredential([cred()], { ...CFG, enabled: false })).toEqual({ ok: false, code: 'GATE_DISABLED' });
    expect(evaluateManagerCredential([cred()], { ...CFG, issuers: new Set() })).toEqual({ ok: false, code: 'NO_ISSUERS_CONFIGURED' });
  });

  it('una lista vacía de credenciales no abre la puerta', () => {
    const v = evaluateManagerCredential([], CFG);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('NO_MANAGER_CREDENTIAL');
  });

  describe('grupos OR (`AIFM|CASP,KYC`: la licencia de SU sector, más la identidad)', () => {
    const ORCFG: ManagerGateConfig = { enabled: true, credentialTypes: ['AIFM|CASP', 'KYC'], issuers: new Set([ISSUER_OK]) };

    it('pasa con AIFM+KYC (el gestor) y con CASP+KYC (el exchange)', () => {
      expect(evaluateManagerCredential([cred(), cred({ credentialType: 'KYC' })], ORCFG).ok).toBe(true);
      expect(evaluateManagerCredential([cred({ credentialType: 'CASP' }), cred({ credentialType: 'KYC' })], ORCFG).ok).toBe(true);
    });

    it('la alternativa NO exime del otro grupo: CASP sola no pasa, y falta "KYC"', () => {
      const v = evaluateManagerCredential([cred({ credentialType: 'CASP' })], ORCFG);
      expect(v.ok).toBe(false);
      if (!v.ok && v.code === 'NO_MANAGER_CREDENTIAL') expect(v.missing).toEqual(['KYC']);
      else throw new Error('esperaba NO_MANAGER_CREDENTIAL');
    });

    it('sin ninguna alternativa del grupo, el missing es el grupo entero', () => {
      const v = evaluateManagerCredential([cred({ credentialType: 'KYC' })], ORCFG);
      expect(v.ok).toBe(false);
      if (!v.ok && v.code === 'NO_MANAGER_CREDENTIAL') expect(v.missing).toEqual(['AIFM|CASP']);
      else throw new Error('esperaba NO_MANAGER_CREDENTIAL');
    });

    it('tolera espacios y minúsculas dentro del grupo', () => {
      const cfg: ManagerGateConfig = { ...ORCFG, credentialTypes: ['aifm | casp'] };
      expect(evaluateManagerCredential([cred({ credentialType: 'CASP' })], cfg).ok).toBe(true);
    });
  });
});

describe('managerGateRefusal', () => {
  it('sin credencial: 409 con el tipo y los emisores, y NUNCA un juicio del gestor', () => {
    const r = managerGateRefusal({ ok: false, code: 'NO_MANAGER_CREDENTIAL', credentialTypes: ['AIFM'], missing: ['AIFM'], issuers: [ISSUER_OK] });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('MANAGER_CREDENTIAL_REQUIRED');
    expect(r.body.credentialTypes).toEqual(['AIFM']);
    expect(r.body.acceptedIssuers).toEqual([ISSUER_OK]);
    expect(r.body.detail).not.toMatch(/malo|no eres|incompetente/i);
  });

  it('un grupo OR se lee como alternativa en el detail: «"AIFM" o "CASP"»', () => {
    const r = managerGateRefusal({ ok: false, code: 'NO_MANAGER_CREDENTIAL', credentialTypes: ['AIFM|CASP', 'KYC'], missing: ['AIFM|CASP'], issuers: [ISSUER_OK] });
    expect(r.status).toBe(409);
    expect(r.body.detail).toContain('"AIFM" o "CASP"');
  });

  it('sin emisores configurados: 503, es un fallo de config, no del gestor', () => {
    const r = managerGateRefusal({ ok: false, code: 'NO_ISSUERS_CONFIGURED' });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('MANAGER_GATE_UNCONFIGURED');
  });
});

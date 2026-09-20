/**
 * I2 — la clasificación de credenciales XLS-70, pura (sin red, sin env).
 *
 * Lo que importa: una credencial existe en el ledger mucho antes de VALER.
 * Sin `CredentialAccept` no es válida; expirada no vale aunque siga ocupando
 * reserva; y ningún emisor desbloquea nada si no está en la allowlist
 * CONFIGURADA — jamás en código.
 */
import { classifyCredential, type RawCredentialNode } from '../XrplCredentialVerifier';

const ISSUER = 'rSumsubIssuer1111111111111111111';
const SUBJECT = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const LSF_ACCEPTED = 0x00010000;
const RIPPLE_EPOCH_OFFSET = 946_684_800;
const NOW_MS = Date.UTC(2026, 7, 16, 12, 0, 0); 

/** Un instante en ISO → el entero Expiration de XRPL (Ripple epoch). */
const rippleTime = (ms: number) => Math.floor(ms / 1000) - RIPPLE_EPOCH_OFFSET;

function node(over: RawCredentialNode = {}): RawCredentialNode {
  return {
    Issuer: ISSUER,
    Subject: SUBJECT,
    CredentialType: Buffer.from('KYC', 'utf8').toString('hex').toUpperCase(),
    Flags: LSF_ACCEPTED,
    ...over,
  };
}

const classify = (n: RawCredentialNode, issuers: string[] = [ISSUER]) =>
  classifyCredential(n, { nowMs: NOW_MS, issuers: new Set(issuers) });

describe('classifyCredential', () => {
  it('accepted + no expiry → valid, con el tipo decodificado a texto', () => {
    const c = classify(node())!;
    expect(c.state).toBe('valid');
    expect(c.accepted).toBe(true);
    expect(c.credentialType).toBe('KYC');
    expect(c.expiresAtISO).toBeNull();
    expect(c.issuerAccepted).toBe(true);
  });

  it('sin lsfAccepted → pending-acceptance: existe, pero NO es válida', () => {
    // El sujeto todavía no firmó su CredentialAccept — el ledger la tiene,
    // y aun así no vale para nada.
    const c = classify(node({ Flags: 0 }))!;
    expect(c.state).toBe('pending-acceptance');
    expect(c.accepted).toBe(false);
  });

  it('expirada manda sobre TODO — aunque esté aceptada', () => {
    const c = classify(node({ Expiration: rippleTime(NOW_MS - 86_400_000) }))!;
    expect(c.state).toBe('expired');
    expect(c.expiresAtISO).toBe(new Date(NOW_MS - 86_400_000).toISOString());
  });

  it('dentro de los 30 días → expiring-soon (aviso, no fallo)', () => {
    const c = classify(node({ Expiration: rippleTime(NOW_MS + 10 * 86_400_000) }))!;
    expect(c.state).toBe('expiring-soon');
  });

  it('más allá de la ventana → valid', () => {
    expect(classify(node({ Expiration: rippleTime(NOW_MS + 90 * 86_400_000) }))!.state).toBe('valid');
  });

  it('el emisor NO configurado se lee igual, pero no desbloquea', () => {
    // La verdad del ledger no depende de nuestra config: la credencial se
    // lista y su estado es real; lo que cambia es que no habilita features.
    const c = classify(node(), [])!;
    expect(c.state).toBe('valid');
    expect(c.issuerAccepted).toBe(false);
  });

  it('un tipo hex no imprimible se muestra tal cual, sin inventar texto', () => {
    const c = classify(node({ CredentialType: 'DEADBEEF' }))!;
    expect(c.credentialType).toBe('DEADBEEF');
    expect(c.credentialTypeHex).toBe('DEADBEEF');
  });

  it('un nodo ilegible devuelve null en vez de una credencial fantasma', () => {
    expect(classify({ Issuer: ISSUER })).toBeNull();
    expect(classify({ Subject: SUBJECT, CredentialType: '4B5943' })).toBeNull();
  });

  // La reserva de 0,2 XRP viaja CON el accept (XLS-70) — no con la caducidad.
  // Es el XRP bloqueado que el usuario ve en su cuenta y no sabe explicar.
  describe('quién sostiene la reserva', () => {
    it('sin aceptar: cuelga del EMISOR (y sin límite de tiempo)', () => {
      expect(classify(node({ Flags: 0 }))!.reserveHeldBy).toBe('issuer');
    });

    it('aceptada: pasa al SUJETO', () => {
      expect(classify(node())!.reserveHeldBy).toBe('subject');
    });

    it('expirada pero que el sujeto aceptó: SIGUE colgando de él hasta que se barra', () => {
      const c = classify(node({ Expiration: rippleTime(NOW_MS - 86_400_000) }))!;
      expect(c.state).toBe('expired');
      expect(c.reserveHeldBy).toBe('subject');
    });
  });
});

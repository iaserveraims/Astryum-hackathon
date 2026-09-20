/**
 * La ceremonia de credencial — pura, sin red, sin Xaman.
 *
 * Lo que se fija aquí: la caducidad es OBLIGATORIA y acotada (I5 — la
 * autoridad caduca), el tipo viaja en hex y jamás lleva datos personales,
 * y cada txjson lo firma quien debe: el emisor crea, el sujeto acepta.
 */

import {
  composeCredentialAccept,
  composeCredentialCreate,
  CredentialCeremonyError,
  DEFAULT_EXPIRATION_DAYS,
  encodeCredentialType,
  encodeCredentialUri,
  toRippleEpoch,
} from '../XrplCredentialCeremony';

const ISSUER = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const SUBJECT = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const NOW_MS = 1_787_300_000_000;

describe('encodeCredentialType', () => {
  it('encodes a short label to uppercase hex («KYC» → 4B5943)', () => {
    expect(encodeCredentialType('KYC')).toBe('4B5943');
  });

  it('refuses empty, oversized or non-printable labels', () => {
    expect(() => encodeCredentialType('')).toThrow(CredentialCeremonyError);
    expect(() => encodeCredentialType('x'.repeat(33))).toThrow(/1-32/);
    expect(() => encodeCredentialType('con espacio')).toThrow(CredentialCeremonyError);
  });
});

describe('composeCredentialCreate — el emisor firma, y SIEMPRE caduca', () => {
  it('composes the issuer-signed txjson with a ripple-epoch Expiration', () => {
    const tx = composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, nowMs: NOW_MS });
    expect(tx.TransactionType).toBe('CredentialCreate');
    expect(tx.Account).toBe(ISSUER); // quien firma es el emisor
    expect(tx.Subject).toBe(SUBJECT);
    expect(tx.CredentialType).toBe('4B5943');
    const expectedUnix = Math.floor(NOW_MS / 1000) + DEFAULT_EXPIRATION_DAYS * 86_400;
    expect(tx.Expiration).toBe(toRippleEpoch(expectedUnix));
    // Ripple epoch = Unix − 946684800, y el offset es exacto.
    expect(expectedUnix - tx.Expiration).toBe(946_684_800);
  });

  it('there is NO version without expiration, and the bounds hold (I5)', () => {
    expect(() =>
      composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, expirationDays: 0 })
    ).toThrow(/caducidad/);
    expect(() =>
      composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, expirationDays: 367 })
    ).toThrow(CredentialCeremonyError);
    expect(() =>
      composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, expirationDays: Number.NaN })
    ).toThrow(CredentialCeremonyError);
  });

  it('refuses malformed parties and self-issuance', () => {
    expect(() => composeCredentialCreate({ issuer: '0xnope', subject: SUBJECT })).toThrow(/emisor/);
    expect(() => composeCredentialCreate({ issuer: ISSUER, subject: 'nope' })).toThrow(/sujeto/);
    expect(() => composeCredentialCreate({ issuer: ISSUER, subject: ISSUER })).toThrow(/misma cuenta/);
  });
});

describe('encodeCredentialUri — un puntero a la VC/QEAA, jamás el documento', () => {
  it('encodes an https link to uppercase hex and rides as URI', () => {
    const link = 'https://qtsp.example/qeaa/abc123';
    expect(encodeCredentialUri(link)).toBe(Buffer.from(link, 'utf8').toString('hex').toUpperCase());
    const tx = composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, uri: link, nowMs: NOW_MS });
    expect(tx.URI).toBe(encodeCredentialUri(link));
  });

  it('without a uri the tx carries NO URI field', () => {
    const tx = composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, nowMs: NOW_MS });
    expect(tx).not.toHaveProperty('URI');
    const blank = composeCredentialCreate({ issuer: ISSUER, subject: SUBJECT, uri: '   ', nowMs: NOW_MS });
    expect(blank).not.toHaveProperty('URI');
  });

  it('refuses non-https/ipfs schemes and oversized links (256 bytes)', () => {
    expect(() => encodeCredentialUri('http://insecure.example')).toThrow(CredentialCeremonyError);
    expect(() => encodeCredentialUri('javascript:alert(1)')).toThrow(/https/);
    expect(() => encodeCredentialUri(`https://qtsp.example/${'x'.repeat(300)}`)).toThrow(/256/);
    expect(encodeCredentialUri('ipfs://bafybeigdyrzt5example')).toMatch(/^[0-9A-F]+$/);
  });
});

describe('composeCredentialAccept — la firma del sujeto ES el consentimiento', () => {
  it('composes the subject-signed txjson', () => {
    const tx = composeCredentialAccept({ issuer: ISSUER, subject: SUBJECT, credentialType: 'KYC' });
    expect(tx.TransactionType).toBe('CredentialAccept');
    expect(tx.Account).toBe(SUBJECT); // quien firma es el sujeto
    expect(tx.Issuer).toBe(ISSUER);
    expect(tx.CredentialType).toBe('4B5943');
  });

  it('the accept carries no Expiration — the create already fixed it', () => {
    const tx = composeCredentialAccept({ issuer: ISSUER, subject: SUBJECT });
    expect('Expiration' in tx).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { holdsGateGroup, isManagerTitleCredential, managerTitleLegs, managerTitleTray } from '../managerTitle';
import type { CredentialRead, CredentialsTray } from '../../xrpl/credentialsApi';

const ME = 'rDcohNUmBApE8bSPP695GkUsSMfBeM5Czj';
const ISSUER = 'rHKxjrGRrCegQhLrdnXEPAeGyeJ1JR4Hae';
const OTHER = 'rpM7wQNUmAPSSbbb6J3yFJGnS9eoZthu8v';

const cred = (over: Partial<CredentialRead>): CredentialRead => ({
  issuer: ISSUER,
  subject: ME,
  credentialType: 'AIFM',
  credentialTypeHex: '4149464d',
  ledgerIndex: 'A'.repeat(64),
  expiresAtISO: null,
  accepted: true,
  state: 'valid',
  issuerAccepted: true,
  reserveHeldBy: 'subject',
  ...over,
});

const tray = (credentials: CredentialRead[]): CredentialsTray => ({
  account: ME,
  credentials,
  hasAcceptedValidCredential: credentials.length > 0,
  issuerAllowlistConfigured: true,
  readAtISO: '2026-09-15T00:00:00.000Z',
  pendingAcceptance: 0,
  note: '',
});

describe('managerTitleLegs — the gate’s OR-groups resolved to the manager’s legs', () => {
  it('The exchange-era gate (AIFM|CASP, KYC|KYB) reads as KYC + AIFM on the manager desk (the bug)', () => {
    expect(managerTitleLegs(['AIFM|CASP', 'KYC|KYB'])).toEqual(['KYC', 'AIFM']);
  });

  it('the plain gate (AIFM,KYC) is unchanged, identity first', () => {
    expect(managerTitleLegs(['AIFM', 'KYC'])).toEqual(['KYC', 'AIFM']);
    expect(managerTitleLegs(['KYC', 'AIFM'])).toEqual(['KYC', 'AIFM']);
  });

  it('no gate read yet → the two legs, never an empty list', () => {
    expect(managerTitleLegs(undefined)).toEqual(['KYC', 'AIFM']);
    expect(managerTitleLegs([])).toEqual(['KYC', 'AIFM']);
  });

  it('a group with none of the manager’s types keeps its first type — the gate really requires it', () => {
    expect(managerTitleLegs(['CASP', 'KYC|KYB'])).toEqual(['KYC', 'CASP']);
  });

  it('is case-insensitive, trims, and never repeats a leg', () => {
    expect(managerTitleLegs([' aifm | casp ', 'kyc', 'KYC|KYB'])).toEqual(['KYC', 'AIFM']);
  });
});

describe('isManagerTitleCredential / managerTitleTray — only the account’s OWN KYC/AIFM', () => {
  const legs = ['KYC', 'AIFM'];

  it('keeps what the account holds of the manager’s types', () => {
    expect(isManagerTitleCredential(cred({ credentialType: 'AIFM' }), ME, legs)).toBe(true);
    expect(isManagerTitleCredential(cred({ credentialType: 'kyc' }), ME, legs)).toBe(true);
  });

  it('drops what the account ISSUED to others (the directory lists both directions)', () => {
    expect(isManagerTitleCredential(cred({ issuer: ME, subject: OTHER, credentialType: 'KYC' }), ME, legs)).toBe(false);
  });

  it('drops other types — CASP, KYB, a per-slot KYC-<tag> — the exchange’s credentials are not this desk’s', () => {
    for (const type of ['CASP', 'KYB', 'KYC-2607090002', 'OMNIBUS']) {
      expect(isManagerTitleCredential(cred({ credentialType: type }), ME, legs)).toBe(false);
    }
  });

  it('narrows the tray and recomputes its counts; null stays null (could not read ≠ holds nothing)', () => {
    const full = tray([
      cred({ credentialType: 'AIFM' }),
      cred({ credentialType: 'KYC', state: 'pending-acceptance', accepted: false }),
      cred({ credentialType: 'CASP' }),
      cred({ issuer: ME, subject: OTHER, credentialType: 'KYC' }),
    ]);
    const own = managerTitleTray(full, ME, legs);
    expect(own?.credentials.map((c) => c.credentialType)).toEqual(['AIFM', 'KYC']);
    expect(own?.pendingAcceptance).toBe(1);
    expect(own?.hasAcceptedValidCredential).toBe(true);
    expect(managerTitleTray(null, ME, legs)).toBeNull();
  });
});

describe('holdsGateGroup — one gate entry, mirrored from the backend', () => {
  it('any type of the OR-group, alive, satisfies the group', () => {
    expect(holdsGateGroup([cred({ credentialType: 'AIFM' })], 'AIFM|CASP')).toBe(true);
    expect(holdsGateGroup([cred({ credentialType: 'CASP', state: 'expiring-soon' })], 'AIFM|CASP')).toBe(true);
    expect(holdsGateGroup([cred({ credentialType: 'KYC' })], 'AIFM|CASP')).toBe(false);
  });

  it('pending, expired or unreadable never count; an empty group never passes', () => {
    expect(holdsGateGroup([cred({ state: 'pending-acceptance' })], 'AIFM')).toBe(false);
    expect(holdsGateGroup([cred({ state: 'expired' })], 'AIFM')).toBe(false);
    expect(holdsGateGroup([cred({ state: 'unreadable' })], 'AIFM')).toBe(false);
    expect(holdsGateGroup([cred({})], '')).toBe(false);
  });
});

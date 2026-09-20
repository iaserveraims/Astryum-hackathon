import { describe, expect, it } from 'vitest';

import { composeManagerKeys, holdsManagerCredentials } from '../wallet/managerWallets';
import type { CredentialRead } from '../xrpl/credentialsApi';

const cred = (over: Partial<CredentialRead>): CredentialRead => ({
  issuer: 'rIssuer',
  subject: 'rSubject',
  credentialType: 'AIFM',
  credentialTypeHex: '4149464d',
  ledgerIndex: 'A'.repeat(64),
  expiresAtISO: null,
  accepted: true,
  state: 'valid',
  issuerAccepted: false,
  reserveHeldBy: 'subject',
  ...over,
});

describe('holdsManagerCredentials', () => {
  it('passes only when EVERY required type is held valid', () => {
    const creds = [cred({ credentialType: 'AIFM' }), cred({ credentialType: 'KYC' })];
    expect(holdsManagerCredentials(creds, ['AIFM', 'KYC'])).toBe(true);
    expect(holdsManagerCredentials([cred({ credentialType: 'AIFM' })], ['AIFM', 'KYC'])).toBe(false);
  });

  it('counts expiring-soon as alive, never pending or expired', () => {
    expect(holdsManagerCredentials([cred({ state: 'expiring-soon' })], ['AIFM'])).toBe(true);
    expect(holdsManagerCredentials([cred({ state: 'pending-acceptance' })], ['AIFM'])).toBe(false);
    expect(holdsManagerCredentials([cred({ state: 'expired' })], ['AIFM'])).toBe(false);
    expect(holdsManagerCredentials([cred({ state: 'unreadable' })], ['AIFM'])).toBe(false);
  });

  it('matches the type case-insensitively and refuses an empty requirement', () => {
    expect(holdsManagerCredentials([cred({ credentialType: 'aifm' })], ['AIFM'])).toBe(true);
    // Sin tipos exigidos no hay título que probar: jamás un pase vacío.
    expect(holdsManagerCredentials([cred({})], [])).toBe(false);
  });

  it('reads the gate’s OR-groups: AIFM + KYC satisfy AIFM|CASP,KYC|KYB (the 15-sep shelf bug)', () => {
    const creds = [cred({ credentialType: 'AIFM' }), cred({ credentialType: 'KYC' })];
    expect(holdsManagerCredentials(creds, ['AIFM|CASP', 'KYC|KYB'])).toBe(true);
    // Una sola pata no basta, tampoco en grupos.
    expect(holdsManagerCredentials([cred({ credentialType: 'AIFM' })], ['AIFM|CASP', 'KYC|KYB'])).toBe(false);
  });
});

describe('composeManagerKeys', () => {
  const R = 'rDcohNUmBApE8bSPP695GkUsSMfBeM5Czj';
  const EVM = '0xAbCd000000000000000000000000000000001234';

  it('folds the three legs and lower-cases only EVM keys', () => {
    const keys = composeManagerKeys({
      wallets: [{ address: R }, { address: EVM }],
      councilKeys: new Set(),
      poteCouncils: new Set([R]),
      directorKeys: new Set([EVM.toLowerCase()]),
      credentialedKeys: null,
    });
    expect(keys.has(R)).toBe(true);
    expect(keys.has(EVM.toLowerCase())).toBe(true);
  });

  it('adds a wallet that only the credential leg vouches for', () => {
    const keys = composeManagerKeys({
      wallets: [{ address: R }],
      councilKeys: new Set(),
      poteCouncils: new Set(),
      directorKeys: new Set(),
      credentialedKeys: new Set([R]),
    });
    expect(keys.has(R)).toBe(true);
  });

  it('never moves a Legacy council: governed beats mandate', () => {
    const keys = composeManagerKeys({
      wallets: [{ address: R }],
      councilKeys: new Set([R]),
      poteCouncils: new Set([R]),
      directorKeys: null,
      credentialedKeys: new Set([R]),
    });
    expect(keys.size).toBe(0);
  });

  it('an unanswered leg (null) adds nothing — «no pude leer» ≠ «no gestionas»', () => {
    const keys = composeManagerKeys({
      wallets: [{ address: R }],
      councilKeys: new Set(),
      poteCouncils: null,
      directorKeys: null,
      credentialedKeys: null,
    });
    expect(keys.size).toBe(0);
  });

  it('a Smart Account row is NEVER the manager wallet — even named cage director', () => {
    const FSA = '0xAbCd000000000000000000000000000000005678';
    const keys = composeManagerKeys({
      wallets: [{ address: FSA, walletType: 'smart-account' }],
      councilKeys: new Set(),
      poteCouncils: null,
      directorKeys: new Set([FSA.toLowerCase()]),
      credentialedKeys: null,
    });
    expect(keys.size).toBe(0);
  });

  it('unknown governance never sits on Manager: unresolved XRPL wallets wait', () => {
    const base = {
      wallets: [{ address: R }],
      councilKeys: new Set<string>(),
      poteCouncils: new Set([R]),
      directorKeys: null,
      credentialedKeys: new Set([R]),
    };
    // Mientras el consejo no contesta `false`, fuera del estante…
    expect(composeManagerKeys({ ...base, unresolvedXrplKeys: new Set([R]) }).size).toBe(0);
    // …y en cuanto contesta, entra.
    expect(composeManagerKeys({ ...base, unresolvedXrplKeys: new Set() }).has(R)).toBe(true);
  });

  it('XRPL council match is exact-case: a mangled r-address never matches', () => {
    const keys = composeManagerKeys({
      wallets: [{ address: R.toLowerCase() }],
      councilKeys: new Set(),
      poteCouncils: new Set([R]),
      directorKeys: null,
      credentialedKeys: null,
    });
    expect(keys.size).toBe(0);
  });
});

/**
 * One door in production, a way in everywhere else.
 *
 * The rule is not "is this astryum.xyz" but "can XRP Identity complete on this
 * origin" — the only question whose wrong answer locks people out. These tests
 * pin the four situations that actually happen, plus the two overrides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyDoorsVisible, xrplIdentityDoorVisible, xrplIdentityUsableHere } from '../authDoors';
import type { XrplIdentityConfig } from '../xrplIdentity/login';

const PROD_CALLBACK = 'https://astryum.xyz/auth/xrpl-identity/callback';

function configWith(redirectUris: string[]): XrplIdentityConfig {
  return {
    clientId: '14ffba280bfcbccacdfb768c91a18c6b',
    authorizeUrl: 'https://account.xrpl.in/auth',
    scopes: 'openid profile email',
    redirectUris,
  };
}

function atOrigin(origin: string) {
  vi.stubGlobal('window', { location: { origin } });
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS;
  atOrigin('https://astryum.xyz');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS;
});

describe('xrplIdentityUsableHere', () => {
  it('is true only where our callback is one the provider will return to', () => {
    expect(xrplIdentityUsableHere(configWith([PROD_CALLBACK]))).toBe(true);

    atOrigin('https://astryum-git-build-ventana.vercel.app');
    expect(xrplIdentityUsableHere(configWith([PROD_CALLBACK]))).toBe(false);

    atOrigin('http://localhost:3000');
    expect(xrplIdentityUsableHere(configWith([PROD_CALLBACK]))).toBe(false);
  });

  it('is false when the provider is not configured at all (backend answers 503)', () => {
    expect(xrplIdentityUsableHere(null)).toBe(false);
  });

  it('does not treat www as the apex — a different origin is a different URI', () => {
    atOrigin('https://www.astryum.xyz');
    expect(xrplIdentityUsableHere(configWith([PROD_CALLBACK]))).toBe(false);
    expect(
      xrplIdentityUsableHere(configWith([PROD_CALLBACK, 'https://www.astryum.xyz/auth/xrpl-identity/callback'])),
    ).toBe(true);
  });
});

describe('legacyDoorsVisible', () => {
  it('hides email/Google/Apple in production, where the single door works', () => {
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: true })).toBe(false);
  });

  it('keeps them in a Vercel preview, where XRP Identity physically cannot complete', () => {
    atOrigin('https://astryum-git-build-ventana.vercel.app');
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: true })).toBe(true);
  });

  it('keeps them on localhost until that redirect URI is registered', () => {
    atOrigin('http://localhost:3000');
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: true })).toBe(true);
  });

  it('brings them back if the provider config breaks — nobody gets locked out', () => {
    expect(legacyDoorsVisible({ config: null, resolved: true })).toBe(true);
  });

  it('shows nothing until the answer is in: a flash is a promise we then take back', () => {
    expect(legacyDoorsVisible({ config: null, resolved: false })).toBe(false);
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: false })).toBe(false);
  });

  it('honours the manual override in both directions, and forcing ON does not wait', () => {
    process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS = 'true';
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: true })).toBe(true);
    expect(legacyDoorsVisible({ config: null, resolved: false })).toBe(true);

    process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS = 'false';
    atOrigin('https://astryum-git-build-ventana.vercel.app');
    expect(legacyDoorsVisible({ config: configWith([PROD_CALLBACK]), resolved: true })).toBe(false);
  });
});

describe('xrplIdentityDoorVisible — never leave a card with zero doors', () => {
  it('shows where it can complete, hides where it cannot', () => {
    const config = configWith([PROD_CALLBACK]);
    expect(xrplIdentityDoorVisible({ config, resolved: true })).toBe(true);

    atOrigin('https://astryum-git-build-ventana.vercel.app');
    expect(xrplIdentityDoorVisible({ config, resolved: true })).toBe(false);
  });

  it('shows even on an unregistered origin once the old rail is forced off', () => {
    // Hiding both would be a login screen with no way in at all. The button
    // appears, and the click explains that this origin is not registered.
    atOrigin('https://astryum-git-build-ventana.vercel.app');
    process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS = 'false';

    const config = configWith([PROD_CALLBACK]);
    expect(legacyDoorsVisible({ config, resolved: true })).toBe(false);
    expect(xrplIdentityDoorVisible({ config, resolved: true })).toBe(true);
  });

  it('stays hidden while the answer is in flight, and when there is no provider at all', () => {
    const config = configWith([PROD_CALLBACK]);
    expect(xrplIdentityDoorVisible({ config, resolved: false })).toBe(false);
    process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS = 'false';
    expect(xrplIdentityDoorVisible({ config: null, resolved: true })).toBe(false);
  });
});

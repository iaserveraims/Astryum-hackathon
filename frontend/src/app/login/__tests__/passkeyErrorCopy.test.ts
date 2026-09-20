import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../../components/legacy/__tests__/extractFromSource';

/**
 * R5 1.5 — LOS 401 DE LA PASSKEY, EN CRUDO.
 *
 * `/auth/passkey/auth/verify` answers 401 with `credentials_changed`,
 * `credential_revoked` or `account_disabled` when the credential lock refuses to
 * issue a session, and the card answered all three with one dead end («La passkey
 * no se pudo verificar.»), while the store kept the machine code in its `error`
 * — which another surface prints as is. These run the SHIPPING functions
 * (extracted: the page and the store cannot be imported in the `node` env).
 */

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const pageSrc = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');
const storeSrc = readFileSync(join(__dirname, '..', '..', '..', 'stores', 'authStore.ts'), 'utf8');

const errorToCopy = extract<(code: string, lang: Lang) => string>(
  pageSrc,
  'function errorToCopy(code: string, lang: Lang): string {',
  'function errorToCopy(code, lang) {',
  'errorToCopy',
  { T },
);

const passkeyErrorToCopy = extract<(err: unknown, lang: Lang) => string>(
  pageSrc,
  'function passkeyErrorToCopy(err: unknown, lang: Lang): string {',
  'function passkeyErrorToCopy(err, lang) {',
  'passkeyErrorToCopy',
  { T, errorToCopy },
);

const passkeyLoginErrorText = extract<(code: string) => string>(
  storeSrc,
  'function passkeyLoginErrorText(code: string): string {',
  'function passkeyLoginErrorText(code) {',
  'passkeyLoginErrorText',
);

const CODES = ['credentials_changed', 'credential_revoked', 'account_disabled'];

describe('passkeyErrorToCopy — el código nunca se enseña', () => {
  it('says what changed, and what to do about it', () => {
    expect(passkeyErrorToCopy(new Error('credentials_changed'), 'en')).toBe(
      "Your account's sign-in methods just changed — sign in again.",
    );
    expect(passkeyErrorToCopy(new Error('credential_revoked'), 'en')).toBe(
      'This passkey is no longer valid for this account. Sign in another way and register a new passkey.',
    );
    expect(passkeyErrorToCopy(new Error('account_disabled'), 'en')).toBe('This account is disabled.');
  });

  it('THE REGRESSION: no machine code ever reaches the card', () => {
    for (const code of [...CODES, 'rate_limited']) {
      for (const lang of ['es', 'en'] as Lang[]) {
        const copy = passkeyErrorToCopy(new Error(code), lang);
        expect(copy).not.toContain(code);
        expect(copy).not.toMatch(/_/);
      }
    }
  });

  it('each code is answered in the reader’s language', () => {
    for (const code of CODES) {
      expect(passkeyErrorToCopy(new Error(code), 'es')).not.toBe(passkeyErrorToCopy(new Error(code), 'en'));
    }
  });

  it('a cancelled prompt, a 422 or a dead channel keep the generic sentence', () => {
    expect(passkeyErrorToCopy(new Error('authentication_failed'), 'en')).toBe('The passkey could not be verified.');
    expect(passkeyErrorToCopy(new Error('NotAllowedError: The operation either timed out or was not allowed'), 'en')).toBe(
      'The passkey could not be verified.',
    );
    expect(passkeyErrorToCopy(undefined, 'en')).toBe('The passkey could not be verified.');
    expect(passkeyErrorToCopy(new Error('http_500'), 'es')).toBe('La passkey no se pudo verificar.');
  });
});

describe('authStore — el `error` del store tampoco lleva el código', () => {
  it('turns each 401 code into a sentence', () => {
    expect(passkeyLoginErrorText('credentials_changed')).toBe(
      "Your account's sign-in methods just changed — sign in again.",
    );
    expect(passkeyLoginErrorText('credential_revoked')).toBe(
      'This passkey is no longer valid for this account. Sign in another way and register a new passkey.',
    );
    expect(passkeyLoginErrorText('account_disabled')).toBe('This account is disabled.');
  });

  it('anything else — including an empty message — is the generic sentence, never a code', () => {
    for (const code of ['', 'http_401', 'authentication_failed', 'missing_params']) {
      const text = passkeyLoginErrorText(code);
      expect(text).toBe('The passkey could not be verified.');
      expect(text).not.toContain(code || 'never');
    }
  });

  it('the store still throws the CODE, so the login card can translate it', () => {
    // The catch maps the message for `error` and rethrows the original error.
    expect(storeSrc).toContain('const msg = passkeyLoginErrorText(err instanceof Error ? err.message : \'\');');
    expect(storeSrc).toMatch(/passkeyLoginErrorText\(err instanceof Error[^]*?throw err;/);
  });
});

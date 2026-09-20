/**
 * El alta con Face ID / Windows Hello jamás pinta un `HTTP 401` crudo, y todo
 * lo que dice tiene su traducción.
 */

import { describe, expect, it } from 'vitest';
import { translate } from '../../../i18n/dict';
import { PasskeyAccountError, describePasskeyError, passkeyAccountRefusalText } from '../passkeyErrors';

describe('passkeyAccountRefusalText', () => {
  it('a stale session reads as "sign in again", never as a status number', () => {
    const text = describePasskeyError(new PasskeyAccountError(401, 'token_expired'));
    expect(text).toMatch(/session expired/i);
    expect(text).not.toMatch(/HTTP|401/);
  });

  it('no session at all asks to sign in first and says the key is ready', () => {
    expect(passkeyAccountRefusalText(401, 'missing_bearer_token')).toMatch(/Sign in to Astryum first/);
  });

  it('a server without the route, an unconfigured factory, no network and a failed read each say so', () => {
    expect(passkeyAccountRefusalText(404, null)).toMatch(/does not have Face ID accounts yet/);
    expect(passkeyAccountRefusalText(503, 'FACTORY_UNCONFIGURED')).toMatch(/not configured/);
    expect(passkeyAccountRefusalText(0, null)).toMatch(/could not be reached/);
    expect(passkeyAccountRefusalText(502, 'ACCOUNT_READ_FAILED')).toMatch(/could not be read from Flare/);
  });
});

describe('describePasskeyError', () => {
  it('maps the WebAuthn refusals by name', () => {
    // Cerrar una ventana sin sitio para la llave también es NotAllowedError: el texto ofrece el móvil.
    expect(describePasskeyError({ name: 'NotAllowedError', message: 'The operation either timed out or was not allowed.' })).toMatch(/No key was created.*on your phone/);
    expect(describePasskeyError({ name: 'NotSupportedError' })).toMatch(/P-256/);
  });

  it('keeps an unknown message, and does not map inherited names', () => {
    expect(describePasskeyError(new Error('El autenticador no expuso la clave pública (getPublicKey).'))).toMatch(/getPublicKey/);
    expect(describePasskeyError({ name: 'constructor' })).toBe('Something went wrong — try again.');
    expect(describePasskeyError(null)).toBe('Something went wrong — try again.');
  });

  it('every text it can show has a Spanish entry', () => {
    const texts = [
      passkeyAccountRefusalText(401, 'token_expired'),
      passkeyAccountRefusalText(401, 'missing_bearer_token'),
      passkeyAccountRefusalText(404, null),
      passkeyAccountRefusalText(503, 'FACTORY_UNCONFIGURED'),
      passkeyAccountRefusalText(0, null),
      passkeyAccountRefusalText(502, null),
      ...['NotAllowedError', 'InvalidStateError', 'NotSupportedError', 'SecurityError'].map((name) => describePasskeyError({ name })),
      describePasskeyError(null),
    ];
    for (const text of texts) expect(translate('es', text), text).not.toBe(text);
  });
});

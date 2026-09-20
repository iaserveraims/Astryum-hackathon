/**
 * passkeyErrors — lo que la persona lee cuando el alta con Face ID / Windows
 * Hello no llega a su cuenta.
 *
 * Antes la lectura de la cuenta contrafactual pintaba `HTTP 401`: el JWT dura
 * 24 h y nada lo refresca, así que quien abría el sitio del cliente con la
 * sesión de ayer ponía el PIN, la llave SE CREABA en el dispositivo y veía un
 * número. Aquí cada fallo dice qué pasó y que la llave ya creada no se perdió.
 *
 * Puro y sin red: los textos son las claves de i18n (dict.ts).
 */

const SESSION_EXPIRED = 'Your session expired — sign in again to continue.';
const SIGN_IN_FIRST = 'Sign in to Astryum first — your Face ID key is ready, and its account is read with your session.';

/** La lectura de la cuenta de la passkey falló en el servidor (o no llegó). */
export class PasskeyAccountError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null) {
    super(passkeyAccountRefusalText(status, code));
    this.name = 'PasskeyAccountError';
    this.status = status;
    this.code = code;
  }
}

/** status 0 = la petición no llegó al servidor. */
export function passkeyAccountRefusalText(status: number, code: string | null): string {
  if (status === 401) {
    return code === 'missing_bearer_token' || code === 'token_invalid' || code === 'session_not_found'
      ? SIGN_IN_FIRST
      : SESSION_EXPIRED;
  }
  if (status === 404) return 'This server does not have Face ID accounts yet — nothing was created on-chain. Try again once it is updated.';
  if (status === 503 && code === 'FACTORY_UNCONFIGURED') return 'Face ID accounts are not configured on this server yet.';
  if (status === 0) return 'The server could not be reached — your key is safe on this device. Try again.';
  return 'Your account could not be read from Flare right now — your key is safe on this device. Try again.';
}

/**
 * Los DOMException de navigator.credentials.create, en palabras. Cerrar la
 * ventana porque el ordenador no ofrecía dónde guardar la llave (PC sin
 * Bluetooth y con Windows Hello en RSA) también llega como NotAllowedError:
 * el texto no puede decir solo «cancelaste».
 */
const NOT_CREATED =
  'No key was created — the window was closed, it timed out, or this computer had nowhere to keep this kind of key. Try again, or create it on your phone.';
const WEBAUTHN_TEXT = new Map<string, string>([
  ['NotAllowedError', NOT_CREATED],
  ['AbortError', NOT_CREATED],
  ['InvalidStateError', 'This device refused to create the key. Try again, or use another browser.'],
  ['NotSupportedError', 'This device cannot create the kind of key the account needs (P-256). Try another browser or device.'],
  ['SecurityError', 'This page is not allowed to create passkeys on this address.'],
]);

/** El texto de un fallo del alta o de la lectura de la cuenta. */
export function describePasskeyError(e: unknown): string {
  if (e instanceof PasskeyAccountError) return e.message;
  const named = typeof e === 'object' && e !== null ? (e as { name?: unknown; message?: unknown }) : null;
  const known = typeof named?.name === 'string' ? WEBAUTHN_TEXT.get(named.name) : undefined;
  if (known) return known;
  const message = typeof named?.message === 'string' ? named.message : '';
  return message || 'Something went wrong — try again.';
}

/**
 * XrplCredentialCeremony — composición SIN FIRMAR de las dos transacciones
 * XLS-70 del circuito de consentimiento/KYC (escena 2 de la demo).
 */

/** Ripple epoch = Unix epoch − 946684800 (segundos). */
const RIPPLE_EPOCH_OFFSET = 946_684_800;

/** Cotas de la caducidad: nunca sin fecha, nunca a más de un año vista. */
export const MIN_EXPIRATION_DAYS = 1;
export const MAX_EXPIRATION_DAYS = 366;
export const DEFAULT_EXPIRATION_DAYS = 180;

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** XLS-70 capa el tipo a 64 bytes; una etiqueta debe ser corta y legible. */
const MAX_CREDENTIAL_TYPE_CHARS = 32;

export class CredentialCeremonyError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ISSUER'
      | 'INVALID_SUBJECT'
      | 'ISSUER_IS_SUBJECT'
      | 'INVALID_CREDENTIAL_TYPE'
      | 'EXPIRATION_OUT_OF_BOUNDS'
      | 'INVALID_URI',
    detail: string
  ) {
    super(detail);
    this.name = 'CredentialCeremonyError';
  }
}

export function toRippleEpoch(unixSeconds: number): number {
  return unixSeconds - RIPPLE_EPOCH_OFFSET;
}

/** «KYC» → «4B5943» — el tipo viaja en hex mayúsculas (XLS-70). */
export function encodeCredentialType(label: string): string {
  const trimmed = label.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_CREDENTIAL_TYPE_CHARS ||
    !/^[\x21-\x7E]+$/.test(trimmed) // imprimible, sin espacios — una etiqueta
  ) {
    throw new CredentialCeremonyError(
      'INVALID_CREDENTIAL_TYPE',
      `el tipo debe ser una etiqueta imprimible de 1-${MAX_CREDENTIAL_TYPE_CHARS} caracteres`
    );
  }
  return Buffer.from(trimmed, 'utf8').toString('hex').toUpperCase();
}

/** XLS-70 capa el URI a 256 bytes. Es un ENLACE al documento verificable del
 *  emisor (VC W3C / QEAA de un QTSP) — jamás el documento: en el ledger no va
 *  ni un byte de PII, solo dónde comprobar la atestación. */
const MAX_URI_BYTES = 256;

export function encodeCredentialUri(uri: string): string {
  const trimmed = uri.trim();
  const bytes = Buffer.from(trimmed, 'utf8');
  if (trimmed.length === 0 || bytes.length > MAX_URI_BYTES || !/^(https|ipfs):\/\/\S+$/.test(trimmed)) {
    throw new CredentialCeremonyError(
      'INVALID_URI',
      `el URI debe ser una URL https:// o ipfs:// de 1-${MAX_URI_BYTES} bytes — apunta a la credencial verificable, no la contiene`
    );
  }
  return bytes.toString('hex').toUpperCase();
}

function assertParties(issuer: string, subject: string): void {
  if (!XRPL_ADDRESS_RE.test(issuer)) {
    throw new CredentialCeremonyError('INVALID_ISSUER', 'el emisor no es una r-address válida');
  }
  if (!XRPL_ADDRESS_RE.test(subject)) {
    throw new CredentialCeremonyError('INVALID_SUBJECT', 'el sujeto no es una r-address válida');
  }
  if (issuer === subject) {
    // Autoemitirse el consentimiento vaciaría de sentido el circuito entero.
    throw new CredentialCeremonyError('ISSUER_IS_SUBJECT', 'emisor y sujeto no pueden ser la misma cuenta');
  }
}

export interface CredentialCreateTx {
  TransactionType: 'CredentialCreate';
  Account: string; // el EMISOR firma
  Subject: string;
  CredentialType: string; // hex
  Expiration: number; // ripple epoch — SIEMPRE presente
  URI?: string; // hex — enlace a la VC/QEAA del emisor, jamás el documento
}

export interface CredentialAcceptTx {
  TransactionType: 'CredentialAccept';
  Account: string; // el SUJETO firma — esta firma ES el consentimiento
  Issuer: string;
  CredentialType: string; // hex
}

/**
 * El txjson que firmará el EMISOR tras su proceso de KYC. La reserva de
 * 0,2 XRP del objeto cuelga del emisor hasta que el sujeto acepte.
 */
export function composeCredentialCreate(params: {
  issuer: string;
  subject: string;
  credentialType?: string;
  expirationDays?: number;
  /** Enlace (https/ipfs) a la credencial verificable del emisor — VC W3C o QEAA eIDAS. */
  uri?: string;
  nowMs?: number;
}): CredentialCreateTx {
  assertParties(params.issuer, params.subject);
  const days = params.expirationDays ?? DEFAULT_EXPIRATION_DAYS;
  if (!Number.isFinite(days) || days < MIN_EXPIRATION_DAYS || days > MAX_EXPIRATION_DAYS) {
    throw new CredentialCeremonyError(
      'EXPIRATION_OUT_OF_BOUNDS',
      `la caducidad debe estar entre ${MIN_EXPIRATION_DAYS} y ${MAX_EXPIRATION_DAYS} días — sin fecha no hay credencial (I5)`
    );
  }
  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const tx: CredentialCreateTx = {
    TransactionType: 'CredentialCreate',
    Account: params.issuer,
    Subject: params.subject,
    CredentialType: encodeCredentialType(params.credentialType ?? 'KYC'),
    Expiration: toRippleEpoch(nowSec + days * 86_400),
  };
  if (params.uri !== undefined && params.uri.trim().length > 0) tx.URI = encodeCredentialUri(params.uri);
  return tx;
}

/** El txjson que firmará el SUJETO — su consentimiento, en el ledger. */
export function composeCredentialAccept(params: {
  issuer: string;
  subject: string;
  credentialType?: string;
}): CredentialAcceptTx {
  assertParties(params.issuer, params.subject);
  return {
    TransactionType: 'CredentialAccept',
    Account: params.subject,
    Issuer: params.issuer,
    CredentialType: encodeCredentialType(params.credentialType ?? 'KYC'),
  };
}

/**
 * XrplCredentialVerifier — la lectura de credenciales XLS-70 (I2 del plan,
 * construida).
 */

import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';

/** Ripple epoch → Unix epoch (segundos). */
const RIPPLE_EPOCH_OFFSET = 946_684_800;
/** Ventana en la que una credencial se declara «expira pronto». */
const EXPIRING_SOON_DAYS = 30;

export type CredentialState = 'valid' | 'pending-acceptance' | 'expiring-soon' | 'expired' | 'unreadable';

/** Una credencial tal y como vive en el ledger (campos XLS-70). */
export interface RawCredentialNode {
  Issuer?: unknown;
  Subject?: unknown;
  CredentialType?: unknown;
  Expiration?: unknown;
  /** lsfAccepted (0x00010000) — sin este flag la credencial NO es válida. */
  Flags?: unknown;
  URI?: unknown;
  /** El ID del objeto en el ledger (`index` de account_objects): lo que un
   *  Payment lleva en `CredentialIDs` para cruzar una puerta DepositAuth. */
  index?: unknown;
}

export interface CredentialRead {
  issuer: string;
  subject: string;
  /** El tipo, decodificado a texto cuando el hex es UTF-8 legible. */
  credentialType: string;
  credentialTypeHex: string;
  /** El ID del objeto Credential en el ledger (64 hex), o null si el nodo no lo
   *  traía. Es lo que va en `CredentialIDs` de un Payment hacia un ancla con
   *  DepositAuth + AuthorizeCredentials. */
  ledgerIndex: string | null;
  /** ISO de expiración, o null cuando la credencial no lleva `Expiration`. */
  expiresAtISO: string | null;
  /** El URI de la XLS-70 decodificado (el puntero a la prueba — p. ej. la
   *  atestación de Coinbase en Base), o null si la credencial no lo lleva. */
  uri: string | null;
  accepted: boolean;
  state: CredentialState;
  /** true solo si el emisor está en la allowlist CONFIGURADA (nunca en código). */
  issuerAccepted: boolean;
  /**
   * Quién paga los 0,2 XRP de reserva de este objeto AHORA MISMO. La reserva
   * viaja con el accept (XLS-70): cuelga del EMISOR mientras la credencial
   * está sin aceptar — sin límite de tiempo — y pasa al SUJETO al aceptarla.
   * Se expone porque explica un XRP bloqueado que el usuario ve y no entiende,
   * y porque una expirada sigue reteniéndolo hasta que alguien la barre.
   */
  reserveHeldBy: 'issuer' | 'subject';
}

/** lsfAccepted, del XLS-70: sin él la credencial existe pero no vale. */
const LSF_ACCEPTED = 0x00010000;

function hexToText(hex: string): string {
  try {
    const text = Buffer.from(hex, 'hex').toString('utf8');
    // Solo se muestra si es texto imprimible; si no, se enseña el hex crudo.
    return /^[\x20-\x7E]+$/.test(text) ? text : hex;
  } catch {
    return hex;
  }
}

/**
 * Los emisores que esta instancia acepta — CONFIGURACIÓN, no código.
 * `XRPL_CREDENTIAL_ISSUERS` = lista separada por comas de r-addresses.
 * Vacía ⇒ ninguna credencial se marca como aceptada por Astryum (se siguen
 * leyendo y mostrando: el ledger es público y la verdad no depende de
 * nuestra configuración).
 */
export function acceptedIssuers(): Set<string> {
  const raw = process.env.XRPL_CREDENTIAL_ISSUERS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Deriva el estado de UNA credencial. Puro: sin red, sin env — la allowlist
 * y el «ahora» entran como argumentos para que el test los fije.
 */
export function classifyCredential(
  node: RawCredentialNode,
  opts: { nowMs: number; issuers: Set<string> },
): CredentialRead | null {
  const issuer = String(node.Issuer ?? '');
  const subject = String(node.Subject ?? '');
  const typeHex = String(node.CredentialType ?? '');
  if (!issuer || !subject || !typeHex) return null; // nodo ilegible: no se inventa

  const flags = Number(node.Flags ?? 0);
  const accepted = Number.isFinite(flags) ? (flags & LSF_ACCEPTED) !== 0 : false;

  let expiresAtISO: string | null = null;
  let expired = false;
  let expiringSoon = false;
  const exp = node.Expiration;
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    const ms = (exp + RIPPLE_EPOCH_OFFSET) * 1000;
    expiresAtISO = new Date(ms).toISOString();
    expired = ms <= opts.nowMs;
    expiringSoon = !expired && ms - opts.nowMs <= EXPIRING_SOON_DAYS * 86_400_000;
  }

  // El orden IMPORTA: expirada manda sobre todo (una credencial vencida sigue
  // en el ledger ocupando reserva hasta que alguien la barre, y aceptada o no
  // ya no vale). Sin aceptar es el segundo estado: existe, pero no es válida.
  const state: CredentialState = expired
    ? 'expired'
    : !accepted
      ? 'pending-acceptance'
      : expiringSoon
        ? 'expiring-soon'
        : 'valid';

  const uriHex = typeof node.URI === 'string' && node.URI.length > 0 ? node.URI : null;
  return {
    issuer,
    subject,
    credentialType: hexToText(typeHex),
    credentialTypeHex: typeHex,
    uri: uriHex ? hexToText(uriHex) : null,
    ledgerIndex:
      typeof node.index === 'string' && /^[0-9a-fA-F]{64}$/.test(node.index) ? node.index.toUpperCase() : null,
    expiresAtISO,
    accepted,
    state,
    issuerAccepted: opts.issuers.has(issuer),
    // El accept es lo que mueve la reserva, no la caducidad: una expirada que
    // el sujeto aceptó en su día sigue colgando de él.
    reserveHeldBy: accepted ? 'subject' : 'issuer',
  };
}

export interface CredentialsSummary {
  account: string;
  credentials: CredentialRead[];
  /** ¿Hay ALGUNA credencial válida de un emisor configurado? Es la única
   *  pregunta que una feature debería hacerle a este módulo. */
  hasAcceptedValidCredential: boolean;
  /** Se dice cuando la allowlist está vacía: sin emisor configurado nada
   *  desbloquea, y callarlo parecería «este usuario no tiene credenciales». */
  issuerAllowlistConfigured: boolean;
  readAtISO: string;
}

/**
 * Lee las credenciales que sostiene una cuenta. Read-only de punta a punta:
 * ni firma, ni emite, ni acepta — eso último lo firma el sujeto en su Xaman
 * (prepare-only, post).
 */
export async function readAccountCredentials(
  account: string,
  opts: { nowMs?: number } = {},
): Promise<CredentialsSummary> {
  const issuers = acceptedIssuers();
  const nowMs = opts.nowMs ?? Date.now();
  const nodes = await xrplProvider.getCredentialObjects(account);
  const credentials = nodes
    .map((n) => classifyCredential(n, { nowMs, issuers }))
    .filter((c): c is CredentialRead => c !== null);
  return {
    account,
    credentials,
    hasAcceptedValidCredential: credentials.some(
      (c) => c.issuerAccepted && (c.state === 'valid' || c.state === 'expiring-soon'),
    ),
    issuerAllowlistConfigured: issuers.size > 0,
    readAtISO: new Date(nowMs).toISOString(),
  };
}

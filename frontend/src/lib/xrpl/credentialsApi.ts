/**
 * credentialsApi — la bandeja de credenciales XLS-70 (`/api/xrpl-credentials`).
 *
 * Dos verbos y ninguno más: leer lo que el ledger dice de una cuenta, y componer
 * sin firmar el `CredentialAccept` que firma el SUJETO en su Xaman. Astryum no
 * emite ni acepta por nadie — por eso aquí no hay `prepareIssue`, a propósito.
 */

import { getApiBase } from '../env';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export type CredentialState = 'valid' | 'pending-acceptance' | 'expiring-soon' | 'expired' | 'unreadable';

/** Una credencial tal y como la lee el backend del ledger. */
export interface CredentialRead {
  issuer: string;
  subject: string;
  credentialType: string;
  credentialTypeHex: string;
  /** El ID del objeto Credential en el ledger (64 hex), o null. Es lo que un
   *  Payment lleva en `CredentialIDs` para cruzar una puerta DepositAuth. */
  ledgerIndex: string | null;
  expiresAtISO: string | null;
  accepted: boolean;
  state: CredentialState;
  /** Solo dice si el emisor está en la allowlist del backend; NO es un juicio de Astryum. */
  issuerAccepted: boolean;
  reserveHeldBy: 'issuer' | 'subject';
}

export interface CredentialsTray {
  account: string;
  credentials: CredentialRead[];
  hasAcceptedValidCredential: boolean;
  issuerAllowlistConfigured: boolean;
  readAtISO: string;
  pendingAcceptance: number;
  note: string;
}

/**
 * Lo que el ledger dice de esa cuenta. Lanza si no se pudo leer — y el que
 * llama tiene que pintar «no pude leer», nunca «no tiene».
 */
/** El estado de la puerta del TÍTULO DE GESTOR para una cuenta XRPL. */
export interface ManagerCredentialStatus {
  account: string;
  gate: 'disabled' | 'enabled';
  ok: boolean;
  /** Con qué vía pasó: on-ledger (XLS-70) o partner (VC off-ledger). */
  source?: 'ledger' | 'partner';
  /** Los títulos que el gestor debe sostener — todos (p. ej. ['AIFM'] o ['AIFM','KYC']). */
  credentialTypes: string[];
  acceptedIssuers?: string[];
  /** Emisores off-ledger configurados (VC del partner presentada con la petición). */
  offLedgerPartners?: string[];
  /** Partners de verificación (flujo alojado): el gestor se acredita ahí, no en Astryum. */
  verificationPartners?: Array<{ name: string; url: string }>;
  /** true = el robot emisor está encendido (pegar atestación → verificar → emitir). */
  notaryIssuer?: boolean;
  reason?: string;
}

/** El MISMO reto que verifica el backend (ManagerNotaryIssuer.bindingMessage). */
export function notaryBindingMessage(subject: string, uid: string): string {
  return `Astryum notary binding\nsubject: ${subject}\nattestation: ${uid}`;
}

export interface NotaryIssueResult {
  txHash: string;
  result: string;
  validated: boolean;
  issuer: string;
  subject: string;
  credentialType: string;
  uri?: string;
}

/** El robot: verifica la atestación EAS + el binding firmado y EMITE la KYC. */
export async function requestNotaryKyc(input: {
  subject: string;
  attestation: string;
  evmSignature: string;
}): Promise<CredentialsApiResult<NotaryIssueResult>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary/issue-kyc`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as NotaryIssueResult };
}

export type NotaryRenewLeg =
  | { status: 'issued'; txHash: string; result: string }
  | { status: 'already-valid'; detail: string }
  | { status: 'refused'; code: string; detail: string }
  | { status: 'skipped'; detail: string };

export interface DiscoveredNotaryAttestation {
  subject: string;
  evmAddress: string;
  uid: string;
  url: string;
  attestedAtISO: string | null;
  /** El reto ya compuesto (= notaryBindingMessage(subject, uid)): la wallet EVM lo firma. */
  challenge: string;
}

/**
 * Encuentra la atestación de Coinbase de la wallet EVM conectada, sin pegar
 * nada (9-sep): el backend pregunta al indexador de EAS y relee la cadena.
 * 404 ATTESTATION_NOT_FOUND = no hay atestación para ESA wallet (el detalle
 * dice qué hacer en Coinbase); 502 = el indexador no respondió, que no es lo
 * mismo que «no estás verificado».
 */
export async function discoverNotaryAttestation(input: { subject: string; evmAddress: string }): Promise<CredentialsApiResult<DiscoveredNotaryAttestation>> {
  const qs = new URLSearchParams({ subject: input.subject, evmAddress: input.evmAddress });
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary/discover?${qs.toString()}`, { headers: authHeaders(), credentials: 'include' });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as DiscoveredNotaryAttestation };
}

/** UN gesto, las DOS credenciales: el robot re-verifica y (re)emite KYC + AIFM. */
export async function requestNotaryRenew(input: {
  subject: string;
  attestation?: string;
  evmSignature?: string;
}): Promise<CredentialsApiResult<{ subject: string; kyc: NotaryRenewLeg; aifm: NotaryRenewLeg }>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary/renew`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as { subject: string; kyc: NotaryRenewLeg; aifm: NotaryRenewLeg } };
}

/** El robot AIFM: re-ejecuta los checks del notario y emite solo si TODOS pasan. */
export async function requestNotaryAifm(input: { subject: string }): Promise<CredentialsApiResult<NotaryIssueResult>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary/issue-aifm`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as NotaryIssueResult };
}

/**
 * SOLO RODAJE — el servidor firma la LICENCIA (AIFM por defecto, CASP para la
 * raíz de un exchange, KYB para el vehículo) con la seed del notario, saltándose
 * los checks de Domain (flag MANAGER_DEMO_AIFM_ENABLED en el backend). Desde el
 * 20-sep vuelve a pedir la puerta de los fundadores (`NOT_AN_ADMIN` para una
 * cuenta corriente) y se llama solo desde /app/admin; el sujeto puede ser
 * cualquier r-address. Sigue con tope (`RATE_LIMITED`). Devuelve el
 * emisor real (la seed del notario) para que el sujeto acepte contra él.
 */
export async function requestNotaryAifmDemo(
  input: { subject: string; type?: 'AIFM' | 'CASP' | 'KYB'; uri?: string },
  opts: { adminSession?: string | null } = {},
): Promise<CredentialsApiResult<NotaryIssueResult>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary/issue-aifm-demo`, {
    method: 'POST',
    // La sesión de la app abre el montaje (`requireSiweAuth`); la del panel abre
    // `requireAdmin` aunque el email de la cuenta no esté en la allowlist.
    headers: { ...authHeaders(), ...(opts.adminSession ? { 'x-admin-session': opts.adminSession } : {}) },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as NotaryIssueResult };
}

/**
 * ¿Esta cuenta puede gobernar un pote agrupado? Con la puerta apagada,
 * `gate: 'disabled'` y `ok: true` (nada bloquea). Con la puerta encendida, dice
 * si sostiene la credencial exigida y de quién la puede pedir.
 */
export async function readManagerCredentialStatus(account: string): Promise<ManagerCredentialStatus> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/manager-status?account=${encodeURIComponent(account)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ManagerCredentialStatus;
}

export async function readCredentialTray(account: string): Promise<CredentialsTray> {
  const res = await fetch(`${API_BASE}/xrpl-credentials?account=${encodeURIComponent(account)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CredentialsTray;
}

export interface CredentialAcceptPrepared {
  txjson: Record<string, unknown>;
  signer: 'subject';
  disclosure: { disclosedToUser: true; defibroSigns: false; title: string; lines: string[] };
}

export type CredentialsApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: { status: number; error: string; detail?: string } };

export interface AnchorTxPrepared {
  txjson: Record<string, unknown>;
  signer: 'anchor-owner';
  disclosure: { disclosedToUser: true; defibroSigns: false; title: string; lines: string[] };
}

/**
 * Paso 1 de la puerta del ancla: `AccountSet{asfDepositAuth}`. Lo firma el DUEÑO
 * del ancla en Xaman — desde aquí el ancla rechaza a extraños.
 */
export async function prepareAnchorDepositAuth(anchor: string): Promise<CredentialsApiResult<AnchorTxPrepared>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/anchor/deposit-auth/prepare`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ anchor }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as AnchorTxPrepared };
}

/**
 * Paso 2: `DepositPreauth{AuthorizeCredentials}`. Sin lista explícita, autoriza
 * el/los título(s) de gestor configurados (cada emisor × cada tipo). Lo firma el
 * dueño del ancla. `mode: 'unauthorize'` retira el acceso.
 */
export async function prepareAnchorAuthorizeCredentials(
  anchor: string,
  mode: 'authorize' | 'unauthorize' = 'authorize',
): Promise<CredentialsApiResult<AnchorTxPrepared>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/anchor/authorize-credentials/prepare`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ anchor, mode }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as AnchorTxPrepared };
}

/** El `CredentialAccept` sin firmar. Lo firma el sujeto; el ledger no admite otra cosa. */
export async function prepareCredentialAcceptance(input: {
  issuer: string;
  subject: string;
  credentialType?: string;
}): Promise<CredentialsApiResult<CredentialAcceptPrepared>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/accept/prepare`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      refusal: {
        status: res.status,
        error: String(body.error ?? `HTTP ${res.status}`),
        detail: typeof body.detail === 'string' ? body.detail : undefined,
      },
    };
  }
  return { ok: true, data: body as unknown as CredentialAcceptPrepared };
}

/** Un partner de verificación/certificación configurado en el backend. */
export interface ConfiguredVerificationPartner {
  name: string;
  url: string;
}

/**
 * Las certificadoras a las que se manda al gestor (config runtime del backend
 * — la misma fuente que la puerta del título). Lista vacía = aún sin elegir.
 */
export async function readVerificationPartners(): Promise<ConfiguredVerificationPartner[]> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/verification-partners`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { partners?: ConfiguredVerificationPartner[] };
  return Array.isArray(body.partners) ? body.partners : [];
}

/**
 * Los emisores acreditados que Astryum acepta (MANAGER_CREDENTIAL_ISSUERS), para
 * que la ceremonia los ofrezca en un desplegable en vez de teclear la r-address.
 */
export async function readManagerIssuers(): Promise<{ issuers: string[]; credentialTypes: string[] }> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/manager-issuers`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { issuers?: string[]; credentialTypes?: string[] };
  return { issuers: Array.isArray(body.issuers) ? body.issuers : [], credentialTypes: Array.isArray(body.credentialTypes) ? body.credentialTypes : [] };
}

// ── El verificador del bot-notario (binding dominio↔wallet + registro) ──────

export interface NotaryCheckItem {
  key: 'domain-set' | 'toml-binding' | 'register-entry';
  ok: boolean;
  detail: string;
}

export interface NotaryVerdict {
  account: string;
  domain: string | null;
  firm: { name: string; domain: string; register: string; url?: string } | null;
  checks: NotaryCheckItem[];
  ok: boolean;
  checkedAtISO: string;
  methodology: string;
}

/**
 * Los tres checks reproducibles que respaldan una credencial AIFM: dominio
 * declarado, toml que lo devuelve, y firma en el registro. Público — la misma
 * lectura que puede hacer cualquiera.
 */
export async function readNotaryCheck(account: string): Promise<NotaryVerdict> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/notary-check?account=${encodeURIComponent(account)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as NotaryVerdict;
}

export interface DomainTxPrepared {
  txjson: Record<string, unknown>;
  signer: 'subject';
  disclosure: { disclosedToUser: true; defibroSigns: false; title: string; lines: string[] };
}

/** El `AccountSet{Domain}` sin firmar — la mitad del binding, firmada por el gestor. */
export async function prepareAccountDomain(account: string, domain: string): Promise<CredentialsApiResult<DomainTxPrepared>> {
  const res = await fetch(`${API_BASE}/xrpl-credentials/domain/prepare`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ account, domain }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, refusal: { status: res.status, error: String(body.error ?? `HTTP ${res.status}`), detail: typeof body.detail === 'string' ? body.detail : undefined } };
  return { ok: true, data: body as unknown as DomainTxPrepared };
}

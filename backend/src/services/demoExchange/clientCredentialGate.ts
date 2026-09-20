/**
 * clientCredentialGate — el KYC del exchange, UNA CREDENCIAL POR CASILLA.
 *
 * Decisión del fundador (14-sep, «solo B»): la credencial XLS-70 la emite la
 * RAÍZ del exchange y su SUJETO es el propio OMNIBUS, con un tipo por tag —
 * `KYC-101`. Así cada casilla del omnibus lleva su KYC en el ledger y el cliente
 * no necesita cuenta XRPL propia para operar (la necesita para retirar a
 * autocustodia, que es otra cosa).
 *
 * QUÉ ES Y QUÉ NO ES, dicho sin adornos:
 *  · Es un **registro notarizado del proceso del exchange**: público, fechado,
 *    no reescribible, y con caducidad que este gate relee en cada movimiento.
 *  · NO es consentimiento del cliente (no firma él) ni una credencial portable.
 *  · NO la hace cumplir el ledger: XRPL no condiciona nada a un DestinationTag,
 *    y una credencial cuyo sujeto es el omnibus solo autorizaría al omnibus como
 *    PAGADOR (`CredentialIDs` exige que el emisor de la tx sea el sujeto). El
 *    enforcement lo hace este backend; llamarlo de otra forma sería mentir.
 *
 * Tres reglas que no son negociables:
 *  1. **Se gatea lo que ENTRA, jamás lo que SALE.** Una credencial caducada se
 *     renueva; mientras tanto el dinero ya dentro sale igual.
 *  2. **El ledger lleva el SÍ, nunca el NO.** Aquí solo se LEE la atestación
 *     positiva; no se publica ningún rechazo.
 *  3. **Fail-closed sin mentir**: si el ledger no se puede leer es 503
 *     `CREDENTIALS_UNREADABLE`, que NO es «no tiene credencial».
 */

import { readAccountCredentials, type CredentialRead } from '../XrplCredentialVerifier';
import type { DemoClient, DemoRun } from './DemoExchangeStore';

/** El tipo BASE; el tipo real de cada casilla es `<base>-<tag>`. */
export const DEFAULT_CLIENT_CREDENTIAL_TYPE = 'KYC';

export type ClientCredentialCode =
  | 'CLIENT_NOT_CREDENTIALED'
  | 'CLIENT_CREDENTIAL_PENDING'
  | 'CLIENT_CREDENTIAL_EXPIRED'
  | 'CREDENTIALS_UNREADABLE';

/** Quién la emite, sobre qué cuenta vive y qué tipo identifica a ESTA casilla. */
export interface ClientCredentialSpec {
  issuer: string;
  subject: string;
  credentialType: string;
}

export interface ClientCredentialOk {
  ok: true;
  spec: ClientCredentialSpec;
  state: 'valid' | 'expiring-soon';
  expiresAtISO: string | null;
}

export interface ClientCredentialRefusal {
  ok: false;
  status: number;
  code: ClientCredentialCode;
  detail: string;
  spec: ClientCredentialSpec;
}

export type ClientCredentialVerdict = ClientCredentialOk | ClientCredentialRefusal;

/** Lo que el ledger contestó sobre el sujeto — o que no se pudo leer. */
export type CredentialRead0 = { ok: true; credentials: CredentialRead[] } | { ok: false; reason: string };

/** Guarda explícita: este tsconfig no estrecha la unión por su discriminante. */
export function isCredentialRefusal(v: ClientCredentialVerdict): v is ClientCredentialRefusal {
  return v.ok === false;
}

function readFailed(r: CredentialRead0): r is { ok: false; reason: string } {
  return r.ok === false;
}

/** ¿Está el gate encendido? Por defecto SÍ: un exchange custodial pide KYC. */
export function clientCredentialGateEnabled(): boolean {
  return process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL !== 'false';
}

/**
 * La credencial que ESTA casilla necesita: emitida por la raíz del run, sobre el
 * omnibus, del tipo `<base>-<tag>`. El tipo cabe de sobra en los 64 bytes que
 * admite `CredentialType`.
 */
export function credentialSpecForClient(
  run: Pick<DemoRun, 'councilAddress' | 'omnibusAddress'>,
  client: Pick<DemoClient, 'tag'>,
): ClientCredentialSpec {
  const base = (process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE || DEFAULT_CLIENT_CREDENTIAL_TYPE).trim();
  return {
    issuer: run.councilAddress,
    subject: run.omnibusAddress,
    credentialType: `${base || DEFAULT_CLIENT_CREDENTIAL_TYPE}-${client.tag}`,
  };
}

/** El tipo viaja en hex en el ledger; se compara por texto o por hex, sin distinguir mayúsculas. */
function sameType(credential: CredentialRead, wanted: string): boolean {
  const want = wanted.trim().toUpperCase();
  if (!want) return false;
  const asHex = Buffer.from(wanted.trim(), 'utf8').toString('hex').toUpperCase();
  return (
    credential.credentialType.trim().toUpperCase() === want ||
    credential.credentialTypeHex.toUpperCase() === want ||
    credential.credentialTypeHex.toUpperCase() === asHex
  );
}

/**
 * PURO: dado lo que el ledger dijo del OMNIBUS, ¿tiene esta casilla su KYC?
 * Sin red, sin reloj propio — todo entra por parámetro.
 */
export function assessClientCredential(input: { spec: ClientCredentialSpec; read: CredentialRead0 }): ClientCredentialVerdict {
  const { spec } = input;
  if (readFailed(input.read)) {
    return {
      ok: false,
      status: 503,
      code: 'CREDENTIALS_UNREADABLE',
      spec,
      detail: `the XRP Ledger could not be read, so this client's KYC credential could not be checked (${input.read.reason.slice(0, 80)}) — this is NOT «no credential». Nothing was moved; try again.`,
    };
  }
  const mine = input.read.credentials.filter(
    (c) => c.issuer === spec.issuer && c.subject === spec.subject && sameType(c, spec.credentialType),
  );
  const live = mine.filter((c) => c.state === 'valid' || c.state === 'expiring-soon');
  if (live.length) {
    // La de vencimiento más lejano manda (una renovación convive con la vieja).
    const best = live.reduce((a, b) => ((a.expiresAtISO ?? '9999') >= (b.expiresAtISO ?? '9999') ? a : b));
    return {
      ok: true,
      spec,
      state: best.state === 'expiring-soon' ? 'expiring-soon' : 'valid',
      expiresAtISO: best.expiresAtISO,
    };
  }
  if (mine.some((c) => c.state === 'expired')) {
    return {
      ok: false,
      status: 409,
      code: 'CLIENT_CREDENTIAL_EXPIRED',
      spec,
      detail: `the KYC credential of this slot (${spec.credentialType}) has expired — the exchange re-issues it. Taking money out is never gated by this.`,
    };
  }
  if (mine.some((c) => c.state === 'pending-acceptance')) {
    return {
      ok: false,
      status: 409,
      code: 'CLIENT_CREDENTIAL_PENDING',
      spec,
      detail: `the KYC credential of this slot (${spec.credentialType}) was issued but the omnibus has not accepted it yet — finish the ceremony; until it is accepted the ledger does not treat it as valid.`,
    };
  }
  return {
    ok: false,
    status: 409,
    code: 'CLIENT_NOT_CREDENTIALED',
    spec,
    detail: `this slot has no KYC credential (${spec.credentialType}) from the exchange root, so the exchange cannot move its capital — run the KYC ceremony for this client. Taking money out is never gated by this.`,
  };
}

/**
 * Una lectura del omnibus sirve para TODAS sus casillas: se cachea por cuenta, y
 * la lectura EN VUELO también se comparte — sin eso, la mesa pidiendo el KYC de N
 * clientes a la vez disparaba N lecturas del mismo omnibus (lo cazó el test).
 */
const READ_TTL_MS = 20_000;
const FAILED_READ_TTL_MS = 3_000;
const reads = new Map<string, { untilMs: number; read: Promise<CredentialRead0> }>();

/** Para los tests y para releer tras una ceremonia. */
export function clearClientCredentialCache(): void {
  reads.clear();
}

function readCredentialsCached(account: string, nowMs: number): Promise<CredentialRead0> {
  const hit = reads.get(account);
  if (hit && hit.untilMs > nowMs) return hit.read;
  const read = (async (): Promise<CredentialRead0> => {
    try {
      const summary = await readAccountCredentials(account, { nowMs });
      return { ok: true, credentials: summary.credentials };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  })();
  const entry = { untilMs: nowMs + READ_TTL_MS, read };
  reads.set(account, entry);
  // Una lectura fallida se cachea MUY poco: el siguiente intento vuelve a mirar.
  void read.then((r) => {
    if (!r.ok && reads.get(account) === entry) entry.untilMs = nowMs + FAILED_READ_TTL_MS;
  });
  return read;
}

/**
 * Lee el ledger (con caché corta) y dicta el veredicto de ESTA casilla. Nunca
 * lanza: un fallo de lectura es un `CREDENTIALS_UNREADABLE`, no un 500.
 */
export async function checkClientCredential(
  run: Pick<DemoRun, 'councilAddress' | 'omnibusAddress'>,
  client: Pick<DemoClient, 'tag'>,
  opts: { nowMs?: number } = {},
): Promise<ClientCredentialVerdict> {
  const nowMs = opts.nowMs ?? Date.now();
  const spec = credentialSpecForClient(run, client);
  const read = await readCredentialsCached(spec.subject, nowMs);
  return assessClientCredential({ spec, read });
}

/**
 * PartnerCredentialVerifier — la credencial de gestor en su forma OFF-LEDGER.
 *
 * El modelo de dos capas (recon 29-ago, Parte H; decisión del fundador): un
 * partner regulado (p. ej. Dock/Truvera + cheqd, o Sumsub) verifica el título
 * OFF-chain y emite una **Verifiable Credential** firmada — la PII nunca toca
 * ninguna cadena. Aquí se comprueba la FIRMA del partner y las claims. Es la
 * capa que funciona HOY sin un emisor XRPL-nativo:
 *
 *   · OFF-LEDGER (esto): el gestor PRESENTA su VC (JWT) con la petición; el
 *     backend la verifica contra la clave del partner. Privado por defecto, pero
 *     la hace cumplir NUESTRO servidor, no el consenso.
 *   · ON-LEDGER (XLS-70, `ManagerCredentialGate`): el mismo partner (o un puente)
 *     la refleja como credencial XRPL; entonces la hace cumplir el CONSENSO
 *     (`tecNO_PERMISSION`). Es el «premium».
 *
 * El gate acepta CUALQUIERA de las dos, así que la caza de partner no bloquea:
 * se arranca con la VC off-ledger y se sube a on-ledger cuando el emisor exista.
 *
 * ── GUARDARRAÍL: Astryum NO emite ni verifica el título ─────────────────────
 * Astryum solo comprueba que la VC la firmó un EMISOR de su allowlist (clave
 * pública en config) y que las claims casan. El juicio del título es del partner.
 * Astryum jamás ve el documento — solo una firma sobre unas claims mínimas.
 */

export interface PartnerKey {
  /** El emisor (DID o URL) tal y como aparece en el claim `iss` de la VC. */
  iss: string;
  /** Clave pública del emisor, en JWK (la parte pública; jamás la privada). */
  jwk: Record<string, unknown>;
  /** Algoritmo de la firma (EdDSA por defecto — el de XRPL y el más común en VC). */
  alg?: string;
}

export interface PartnerGateConfig {
  /** Claves de los emisores acreditados. Vacío ⇒ la vía off-ledger no acepta nada. */
  keys: PartnerKey[];
  /** Los tipos que la VC debe atestiguar — TODOS (mismo que el on-ledger: p. ej. AIFM, o AIFM+KYC). */
  credentialTypes: string[];
}

/**
 * Lee la config de la vía off-ledger. `MANAGER_PARTNER_KEYS` es un JSON:
 *   [{ "iss": "did:web:partner", "jwk": { ...clave pública... }, "alg": "EdDSA" }]
 * Un JSON inválido se ignora (lista vacía) y se avisa — nunca abre la puerta.
 */
export function partnerGateConfig(): PartnerGateConfig {
  const credentialTypes = (process.env.MANAGER_CREDENTIAL_TYPE ?? 'AIFM')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const types = credentialTypes.length > 0 ? credentialTypes : ['AIFM'];
  const raw = (process.env.MANAGER_PARTNER_KEYS ?? '').trim();
  if (!raw) return { keys: [], credentialTypes: types };
  try {
    const parsed = JSON.parse(raw) as PartnerKey[];
    const keys = Array.isArray(parsed)
      ? parsed.filter((k) => k && typeof k.iss === 'string' && k.jwk && typeof k.jwk === 'object')
      : [];
    return { keys, credentialTypes: types };
  } catch {
    console.warn('[partner-credential] MANAGER_PARTNER_KEYS no es un JSON válido — vía off-ledger deshabilitada');
    return { keys: [], credentialTypes: types };
  }
}

export type PartnerVerdict =
  | { ok: true; issuer: string; credentialTypes: string[] }
  | { ok: false; code: 'NO_JWT' | 'NO_KEYS' | 'BAD_SIGNATURE' | 'UNKNOWN_ISSUER' | 'WRONG_TYPE' | 'WRONG_SUBJECT' | 'EXPIRED' | 'MALFORMED' };

/** El binding cuenta↔VC que aceptamos: la VC nombra la cuenta XRPL del gestor. */
export function xrplSubjectMatches(payload: Record<string, unknown>, account: string): boolean {
  const subj = (payload.credentialSubject ?? {}) as Record<string, unknown>;
  const id = String(subj.id ?? '');
  const acc = String(subj.xrplAccount ?? subj.account ?? '');
  // Aceptamos `credentialSubject.id = did:xrpl:<r-address>` o un claim explícito.
  return id === `did:xrpl:${account}` || id.endsWith(`:${account}`) || acc === account;
}

/**
 * PURA: dadas las claims YA verificadas (firma OK), ¿valen para este gestor?
 * Comprueba tipo, sujeto y caducidad. La firma y el emisor los valida
 * `verifyPartnerCredential` (necesita crypto); esto se puede testear sin red.
 */
export function validatePartnerClaims(
  payload: Record<string, unknown>,
  opts: { account: string; credentialTypes: string[]; nowSec?: number },
): PartnerVerdict {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN;
  // `Expiration` SIEMPRE (regla del 15-ago): sin `exp` futuro, no vale.
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, code: 'EXPIRED' };

  // La VC presentada tiene que cubrir TODOS los tipos exigidos (en `vc.type` o en
  // `credentialSubject.credentialType`). Una sola VC puede llevar varios en `vc.type`.
  const subj = (payload.credentialSubject ?? {}) as Record<string, unknown>;
  const subjType = String(subj.credentialType ?? '').toUpperCase();
  const vc = (payload.vc ?? {}) as Record<string, unknown>;
  const vcTypes = Array.isArray(vc.type) ? (vc.type as unknown[]).map((t) => String(t).toUpperCase()) : [];
  const covers = (type: string) => {
    const want = type.toUpperCase();
    return subjType === want || vcTypes.includes(want);
  };
  if (!opts.credentialTypes.every(covers)) return { ok: false, code: 'WRONG_TYPE' };

  if (!xrplSubjectMatches(payload, opts.account)) return { ok: false, code: 'WRONG_SUBJECT' };

  return { ok: true, issuer: String(payload.iss ?? ''), credentialTypes: opts.credentialTypes };
}

/**
 * Verifica una VC off-ledger presentada como JWT/JWS compacto: firma del emisor
 * (contra su clave de la allowlist), emisor conocido, y claims (tipo/sujeto/exp).
 * Devuelve el veredicto; JAMÁS lanza — un fallo es un «no», nunca un «sí».
 */
export async function verifyPartnerCredential(
  jwt: string | undefined,
  opts: { account: string; cfg: PartnerGateConfig; nowSec?: number },
): Promise<PartnerVerdict> {
  if (!jwt || typeof jwt !== 'string' || jwt.split('.').length !== 3) return { ok: false, code: 'NO_JWT' };
  if (opts.cfg.keys.length === 0) return { ok: false, code: 'NO_KEYS' };

  let jose: typeof import('jose');
  try {
    jose = await import('jose');
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }

  // El `iss` sin verificar solo elige QUÉ clave probar; la firma decide de verdad.
  let issClaim = '';
  try {
    const [, body] = jwt.split('.');
    issClaim = String(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).iss ?? '');
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
  const key = opts.cfg.keys.find((k) => k.iss === issClaim);
  if (!key) return { ok: false, code: 'UNKNOWN_ISSUER' };

  let payload: Record<string, unknown>;
  try {
    const pub = await jose.importJWK(key.jwk, key.alg ?? 'EdDSA');
    const verified = await jose.jwtVerify(jwt, pub, { issuer: key.iss });
    payload = verified.payload as Record<string, unknown>;
  } catch (e) {
    // jose distingue caducado de firma mala: lo respetamos.
    const code = (e as { code?: string }).code;
    return { ok: false, code: code === 'ERR_JWT_EXPIRED' ? 'EXPIRED' : 'BAD_SIGNATURE' };
  }

  return validatePartnerClaims(payload, { account: opts.account, credentialTypes: opts.cfg.credentialTypes, nowSec: opts.nowSec });
}

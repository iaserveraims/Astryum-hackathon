/**
 * ManagerCredentialGate — la puerta del TÍTULO DE GESTOR (MiCA/AIFMD).
 *
 * El pote agrupado pro-rata es un vehículo de inversión colectiva: gobernarlo sin
 * licencia ES el acto regulado. Así que un gestor solo puede hacer nacer una
 * jaula / abrir un pote / mandar órdenes si sostiene una **credencial de gestor
 * vigente** (XLS-70) de un **emisor acreditado** — un tercero regulado, JAMÁS
 * Astryum.
 *
 * ── DÓNDE MANDA DE VERDAD: EL LEDGER, NO ESTO ──────────────────────────────
 *
 * La comprobación fuerte la hace XRPL: el ancla lleva
 * `DepositPreauth{AuthorizeCredentials}` y una orden sin la credencial que case
 * la tumba el CONSENSO con `tecNO_PERMISSION`, antes de que este código la vea.
 * Esta clase es solo el PRE-FLIGHT: dice «no» ANTES de firmar, para no hacer
 * firmar una orden condenada (doctrina del 23-ago). El emisor verifica el título
 * OFF-ledger; en el ledger va solo la atestación mínima (tipo, sin PII) — «esta
 * cuenta tiene credencial OK», y Astryum permite la tx sin ver el documento.
 *
 * ── LOS GUARDARRAÍLES (recon 29-ago, Parte E) ──────────────────────────────
 *  1. Astryum JAMÁS emite ni verifica el título. Solo ELIGE qué emisores acepta
 *     — filtro técnico uniforme, como el registro de venues. Sin ranking.
 *  2. `Expiration` es la revocación (30–90 días). Una licencia se retira y el
 *     ledger no se entera: la única salida es que caduque y no se reemita.
 *  3. Jamás PII on-ledger.
 *  4. Sin `lsfAccepted` la credencial existe pero NO vale.
 *
 * Feature-flag: `MANAGER_GATE_ENABLED`. Apagada por defecto (nada se rompe).
 */

import type { CredentialRead } from './XrplCredentialVerifier';

export interface ManagerGateConfig {
  enabled: boolean;
  /**
   * Las etiquetas on-ledger que el GESTOR debe sostener — TODAS. En AIFMD la
   * carga de compliance es del gestor, no del depositante: un gestor puede tener
   * que probar identidad Y licencia (`AIFM,KYC`). El depositante de un vehículo
   * agrupado no necesita ninguna (su puerta va aparte y por pote, ver
   * `enforceCredentialGate`). Por defecto una sola: `AIFM`.
   *
   * Cada entrada puede ser un grupo OR con `|`: `AIFM|CASP,KYC` exige
   * (AIFM **o** CASP) **y** KYC — cada raíz sostiene la licencia de SU sector
   * (el gestor de vehículos agrupados la AIFM, el exchange la CASP) más su
   * identidad. El tipo de cuenta ES la credencial (decisión 9-sep).
   */
  credentialTypes: string[];
  /** Los emisores acreditados (r-addresses). Vacío ⇒ la puerta NO deja pasar a nadie. */
  issuers: Set<string>;
}

/**
 * Los partners de VERIFICACIÓN a los que se manda al gestor para acreditarse.
 *
 * Astryum NO recoge documentos ni los transmite: solo enseña un punto de entrada
 * que abre el flujo alojado del partner (su dominio) pasándole la r-address del
 * gestor. El partner verifica off-chain y emite; el gestor acepta en su bandeja.
 * `MANAGER_VERIFICATION_PARTNERS` = JSON `[{ "name": "…", "url": "https://…" }]`.
 * La `url` recibe la cuenta como `?subject=<r-address>` (y `return` de vuelta).
 */
export interface VerificationPartner {
  name: string;
  url: string;
}

export function verificationPartners(): VerificationPartner[] {
  const raw = (process.env.MANAGER_VERIFICATION_PARTNERS ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as VerificationPartner[];
    return Array.isArray(parsed)
      ? parsed.filter((p) => p && typeof p.name === 'string' && typeof p.url === 'string' && /^https:\/\//.test(p.url))
      : [];
  } catch {
    console.warn('[manager-credential] MANAGER_VERIFICATION_PARTNERS no es un JSON válido');
    return [];
  }
}

/**
 * ¿ESTÁ PUESTA LA PUERTA? — en código, no en una variable (fundador 2026-09-20:
 * «el producto se podrá probar solo si tienes las credenciales»).
 *
 * Hasta hoy era `MANAGER_GATE_ENABLED === 'true'`: apagada salvo que alguien se
 * acordara de encenderla. Con el módulo institucional abierto y esa variable sin
 * definir, cualquier cuenta con sesión hacía nacer una jaula y componía órdenes de
 * consejo SIN que nadie mirase su título — la puerta existía y no estaba puesta.
 * Es la misma lección del 14-sep leída al revés: si una variable que se clona entre
 * entornos no puede PUBLICAR nada, tampoco puede ser lo único que sostiene una
 * exigencia regulatoria.
 *
 *   · en producción (NODE_ENV=production, que es también el de staging) la puerta
 *     está SIEMPRE puesta: ninguna variable la apaga;
 *   · fuera de producción —local y tests— está puesta por defecto y
 *     `MANAGER_GATE_ENABLED=false` la apaga, para poder ensayar el resto del
 *     circuito sin un emisor a mano.
 *
 * Puesta y sin emisores (`MANAGER_CREDENTIAL_ISSUERS` vacío) no pasa nadie
 * (`NO_ISSUERS_CONFIGURED`): falla cerrada, que es el lado correcto del error. Para
 * que el rodaje siga funcionando, la cuenta del notario de demo tiene que estar en
 * esa lista en el entorno donde se ruede.
 */
export function managerGateEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return true;
  return env.MANAGER_GATE_ENABLED !== 'false';
}

/** Lee la config de la puerta del env. Separada de la KYC del depositante. */
export function managerGateConfig(): ManagerGateConfig {
  const types = (process.env.MANAGER_CREDENTIAL_TYPE ?? 'AIFM')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    enabled: managerGateEnforced(),
    // AIFMD (pote agrupado pro-rata): el gestor prueba su(s) título(s). El
    // depositante, ninguno. `MANAGER_CREDENTIAL_TYPE=AIFM,KYC` exige las dos.
    credentialTypes: types.length > 0 ? types : ['AIFM'],
    issuers: new Set(
      (process.env.MANAGER_CREDENTIAL_ISSUERS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  };
}

export type ManagerGateVerdict =
  | { ok: true; source: 'ledger'; credentials: CredentialRead[]; credentialIds: string[] }
  | { ok: true; source: 'partner'; issuer: string }
  | { ok: false; code: 'GATE_DISABLED' }
  | { ok: false; code: 'NO_ISSUERS_CONFIGURED' }
  | { ok: false; code: 'NO_MANAGER_CREDENTIAL'; credentialTypes: string[]; missing: string[]; issuers: string[] };

/**
 * PURA: dado lo que el ledger dice de una cuenta, ¿sostiene el GESTOR todos los
 * títulos exigidos?
 *
 * Para CADA grupo de `credentialTypes` tiene que haber una credencial que: (a) sea
 * de uno de los tipos del grupo (`AIFM|CASP` = cualquiera de los dos), (b) de un
 * emisor de la allowlist de GESTOR (no la del depositante — por eso no se usa
 * `issuerAccepted`, que es de otra lista), (c) esté `valid` o `expiring-soon`.
 * Falta un grupo → no pasa, y se dice CUÁL falta. Devuelve los `ledgerIndex` de
 * todos, que es lo que un Payment adjunta para cruzar la puerta.
 */
export function evaluateManagerCredential(
  credentials: CredentialRead[],
  cfg: ManagerGateConfig,
  /** EL TÍTULO ES DEL SUJETO (2026-09-13). El directorio de un EMISOR lleva
   *  las credenciales que EMITIÓ (issuer = él, subject = otros): sin este
   *  filtro el emisor pasaba su propio gate como si estuviera licenciado —
   *  visto en vivo, el ancla emisora aterrizó en el estante Manager. Con la
   *  cuenta evaluada dada, solo cuentan credenciales cuyo SUJETO es ella. */
  subject?: string,
): ManagerGateVerdict {
  if (!cfg.enabled) return { ok: false, code: 'GATE_DISABLED' };
  if (cfg.issuers.size === 0) return { ok: false, code: 'NO_ISSUERS_CONFIGURED' };

  const own = subject ? credentials.filter((c) => c.subject === subject) : credentials;
  const matched: CredentialRead[] = [];
  const missing: string[] = [];
  for (const type of cfg.credentialTypes) {
    const wants = type
      .split('|')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    const m = own.find(
      (c) =>
        cfg.issuers.has(c.issuer) &&
        wants.includes(c.credentialType.toUpperCase()) &&
        (c.state === 'valid' || c.state === 'expiring-soon') &&
        c.ledgerIndex,
    );
    if (m) matched.push(m);
    else missing.push(type);
  }

  if (missing.length > 0) {
    return { ok: false, code: 'NO_MANAGER_CREDENTIAL', credentialTypes: cfg.credentialTypes, missing, issuers: [...cfg.issuers] };
  }
  return { ok: true, source: 'ledger', credentials: matched, credentialIds: matched.map((c) => c.ledgerIndex as string) };
}

/**
 * Evalúa el título de gestor por las DOS vías, en orden de fuerza:
 *  1. ON-LEDGER (XLS-70): la hace cumplir el consenso. No necesita presentación.
 *  2. OFF-LEDGER: una VC firmada por el partner, PRESENTADA con la petición.
 *     La hace cumplir el backend; privada por defecto. Es la que funciona hoy
 *     sin un emisor XRPL-nativo.
 * Basta con UNA. Lanza no: un fallo de lectura NO abre la puerta.
 *
 * @param presentedJwt VC off-ledger que el gestor adjunta (opcional).
 */
export async function checkManagerCredential(council: string, presentedJwt?: string): Promise<ManagerGateVerdict> {
  const cfg = managerGateConfig();
  if (!cfg.enabled) return { ok: false, code: 'GATE_DISABLED' };

  // 1. On-ledger primero (más fuerte, sin presentación).
  const { readAccountCredentials } = await import('./XrplCredentialVerifier');
  const summary = await readAccountCredentials(council);
  const onLedger = evaluateManagerCredential(summary.credentials, cfg, council);
  if (onLedger.ok) return onLedger;

  // 2. Off-ledger: una VC del partner presentada con la petición.
  if (presentedJwt) {
    const { partnerGateConfig, verifyPartnerCredential } = await import('./PartnerCredentialVerifier');
    const partner = await verifyPartnerCredential(presentedJwt, { account: council, cfg: partnerGateConfig() });
    if (partner.ok) return { ok: true, source: 'partner', issuer: partner.issuer };
  }

  // Ninguna vía: devolvemos el motivo on-ledger (el que la UI ya sabe pintar),
  // salvo que el problema sea que no hay emisores configurados en absoluto.
  return onLedger;
}

/**
 * El 409 legible del pre-flight: qué falta y de quién. Nunca dice «no eres
 * gestor» — dice el hecho: «hace falta una credencial `AIFM` de un emisor
 * acreditado». Filtro técnico, no juicio.
 */
export function managerGateRefusal(
  verdict: Extract<ManagerGateVerdict, { ok: false }>,
): { status: number; body: { error: string; detail: string; credentialTypes?: string[]; missing?: string[]; acceptedIssuers?: string[] } } {
  if (verdict.code === 'GATE_DISABLED') {
    // No debería llegar aquí (la ruta comprueba `enabled` antes), pero jamás
    // convertir «apagada» en una acusación: es un no-op, no un rechazo del gestor.
    return { status: 200, body: { error: 'GATE_DISABLED', detail: 'La puerta de título de gestor no está activa.' } };
  }
  if (verdict.code === 'NO_ISSUERS_CONFIGURED') {
    return {
      status: 503,
      body: {
        error: 'MANAGER_GATE_UNCONFIGURED',
        detail:
          'La puerta de título de gestor está activa pero no hay ningún emisor acreditado configurado (MANAGER_CREDENTIAL_ISSUERS). ' +
          'Astryum no emite: hace falta un emisor regulado en la allowlist.',
      },
    };
  }
  // NO_MANAGER_CREDENTIAL (GATE_DISABLED nunca llega aquí: si está apagada, no se llama).
  const v = verdict as Extract<ManagerGateVerdict, { code: 'NO_MANAGER_CREDENTIAL' }>;
  // Un grupo OR se lee como alternativa: `AIFM|CASP` → «"AIFM" o "CASP"».
  const missing = v.missing.map((t) => t.split('|').map((x) => `"${x.trim()}"`).join(' o ')).join(' y ');
  return {
    status: 409,
    body: {
      error: 'MANAGER_CREDENTIAL_REQUIRED',
      detail:
        `Este pote es un vehículo agrupado (pro-rata): gobernarlo es competencia del GESTOR, que prueba su(s) título(s) ` +
        `— el depositante no necesita ninguno. A esta cuenta le falta la credencial ${missing} de un emisor acreditado. ` +
        `La emite un tercero regulado, no Astryum; acéptala en tu bandeja cuando te la conceda.`,
      credentialTypes: v.credentialTypes,
      missing: v.missing,
      acceptedIssuers: v.issuers,
    },
  };
}

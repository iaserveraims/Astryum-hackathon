/**
 *
 * La tesis: el emisor de la credencial AIFM no ejerce juicio — atesta hechos
 * públicos que CUALQUIERA puede re-comprobar. Este módulo ES esa
 * re-comprobación, expuesta como endpoint público, para que cada emisión sea
 * auditable por terceros:
 */

import { BlockList, isIP } from 'net';
import { isValidClassicAddress, validate } from 'xrpl';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** El campo Domain de XRPL capa a 256 bytes. */
const MAX_DOMAIN_BYTES = 256;
/** Cota de lectura del toml: nadie necesita más para listar sus cuentas. */
const MAX_TOML_BYTES = 512 * 1024;
const TOML_TIMEOUT_MS = 10_000;

export class NotaryVerifierError extends Error {
  constructor(
    public readonly code: 'INVALID_ACCOUNT' | 'INVALID_DOMAIN',
    detail: string,
  ) {
    super(detail);
    this.name = 'NotaryVerifierError';
  }
}

// ── La lista de firmas del registro (config, futuro: API oficial) ───────────

export interface RegisterFirm {
  /** Nombre legal tal y como figura en el registro. */
  name: string;
  /** Dominio oficial de la firma (el que lista el regulador), en minúsculas. */
  domain: string;
  /** Qué registro la lista (p. ej. «FCA FRN 123456», «CSSF A00001234»). */
  register: string;
  /** Enlace a la entrada pública del registro, si se tiene. */
  url?: string;
}

/**
 * `MANAGER_REGISTER_FIRMS` = JSON `[{ name, domain, register, url? }]`.
 * Lista mantenida CONTRA el registro público — es el input que el adaptador a
 * la API oficial reemplazará. Vacía ⇒ el check `register-entry` nunca pasa.
 */
export function registerFirms(): RegisterFirm[] {
  const raw = (process.env.MANAGER_REGISTER_FIRMS ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RegisterFirm[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f) =>
          f &&
          typeof f.name === 'string' &&
          f.name.trim().length > 0 &&
          typeof f.domain === 'string' &&
          f.domain.trim().length > 0 &&
          typeof f.register === 'string' &&
          f.register.trim().length > 0,
      )
      .map((f) => ({ ...f, domain: f.domain.trim().toLowerCase() }));
  } catch {
    console.warn('[notary-verifier] MANAGER_REGISTER_FIRMS no es un JSON válido');
    return [];
  }
}

// ── Piezas puras ────────────────────────────────────────────────────────────

/** Hex del ledger → dominio en minúsculas, o null si no es texto legible. */
export function decodeDomainHex(hex: string | null): string | null {
  if (!hex) return null;
  try {
    const text = Buffer.from(hex, 'hex').toString('utf8');
    if (!/^[\x21-\x7E]+$/.test(text)) return null;
    return text.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Las cuentas declaradas en un `xrp-ledger.toml`: cada `address = "r…"` dentro
 * de un bloque `[[ACCOUNTS]]`. Parser tolerante a mano — el formato es simple
 * y una dependencia TOML entera no se gana el sitio para esto.
 */
export function parseXrplTomlAccounts(toml: string): string[] {
  const accounts: string[] = [];
  let inAccounts = false;
  for (const line of toml.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\[?\s*([A-Za-z_]+)\s*\]?\]/);
    if (section) {
      inAccounts = section[1].toUpperCase() === 'ACCOUNTS';
      continue;
    }
    if (!inAccounts) continue;
    const m = line.match(/^\s*address\s*=\s*"(r[1-9A-HJ-NP-Za-km-z]{24,34})"/);
    if (m && !accounts.includes(m[1])) accounts.push(m[1]);
  }
  return accounts;
}

export interface NotaryCheckItem {
  key: 'domain-set' | 'toml-binding' | 'register-entry';
  ok: boolean;
  /** El hecho, nunca un juicio. Un fallo de LECTURA se dice como tal. */
  detail: string;
}

export interface NotaryVerdict {
  account: string;
  /** El dominio que la cuenta declara, decodificado, o null. */
  domain: string | null;
  /** La firma del registro cuyo dominio casa, si la hay. */
  firm: RegisterFirm | null;
  checks: NotaryCheckItem[];
  /** true solo si TODOS los checks pasan. */
  ok: boolean;
  checkedAtISO: string;
  methodology: string;
}

/**
 * PURA: dado lo leído (dominio del ledger, cuentas del toml o su error de
 * lectura, y la lista del registro), el veredicto completo.
 */
export function evaluateNotary(input: {
  account: string;
  domain: string | null;
  /** null = el toml no se pudo leer (distinto de leído-y-no-lista). */
  tomlAccounts: string[] | null;
  tomlError?: string;
  firms: RegisterFirm[];
  nowMs?: number;
}): NotaryVerdict {
  const { account, domain, tomlAccounts, firms } = input;
  const checks: NotaryCheckItem[] = [];

  checks.push(
    domain
      ? { key: 'domain-set', ok: true, detail: `La cuenta declara el dominio ${domain} (campo Domain).` }
      : { key: 'domain-set', ok: false, detail: 'La cuenta no declara ningún dominio (campo Domain vacío).' },
  );

  if (!domain) {
    checks.push({ key: 'toml-binding', ok: false, detail: 'Sin dominio declarado no hay toml que comprobar.' });
  } else if (tomlAccounts === null) {
    // «No pude leer» nunca es «no»: se dice el fallo, no se inventa el veredicto.
    checks.push({
      key: 'toml-binding',
      ok: false,
      detail: `No se pudo leer https://${domain}/.well-known/xrp-ledger.toml${input.tomlError ? ` (${input.tomlError})` : ''} — sin lectura no hay binding, pero esto NO afirma que la firma no controle la wallet.`,
    });
  } else if (tomlAccounts.includes(account)) {
    checks.push({
      key: 'toml-binding',
      ok: true,
      detail: `El dominio devuelve la declaración: ${account} figura en su xrp-ledger.toml. Vínculo en las dos direcciones.`,
    });
  } else {
    checks.push({
      key: 'toml-binding',
      ok: false,
      detail: `El toml de ${domain} se leyó pero NO lista esta cuenta — el vínculo solo existe si las dos direcciones casan.`,
    });
  }

  const firm = domain ? (firms.find((f) => f.domain === domain) ?? null) : null;
  if (firms.length === 0) {
    checks.push({
      key: 'register-entry',
      ok: false,
      detail: 'No hay firmas del registro configuradas (MANAGER_REGISTER_FIRMS) — este check no puede pasar.',
    });
  } else if (firm) {
    checks.push({
      key: 'register-entry',
      ok: true,
      detail: `${firm.domain} pertenece a ${firm.name} según ${firm.register}.`,
    });
  } else {
    checks.push({
      key: 'register-entry',
      ok: false,
      detail: domain
        ? `${domain} no casa con ninguna firma de la lista del registro configurada.`
        : 'Sin dominio no hay firma que buscar en el registro.',
    });
  }

  return {
    account,
    domain,
    firm,
    checks,
    ok: checks.every((c) => c.ok),
    checkedAtISO: new Date(input.nowMs ?? Date.now()).toISOString(),
    methodology:
      'Tres hechos reproducibles, cero juicio: (1) la cuenta declara un dominio; (2) ese dominio devuelve la declaración en su xrp-ledger.toml; (3) el dominio es el oficial de una firma del registro de AIFMs. Cualquiera puede re-ejecutar estos checks.',
  };
}

// ── La frontera de red ──────────────────────
//
// El `Domain` lo escribe el DUEÑO de la cuenta — cualquiera — y el endpoint
// del notario es público. Sin frontera, `https://${domain}/…` era un oráculo
// de red interna: un Domain `169.254.169.254`, `x.railway.internal:5432/` o
// `evil.example` con redirección a una IP privada, y el `detail` devolvía el
// status o el mensaje de error del destino. Ahora: solo un hostname DNS
// público, que además RESUELVA a IPs públicas; sin seguir redirecciones; con
// timeout y techo de bytes; y el motivo de un fallo es un código genérico,
// jamás el texto del destino.

const PUBLIC_HOSTNAME_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const NON_PUBLIC_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home.arpa', '.arpa', '.test', '.invalid'];

/** ¿Es `domain` un hostname DNS público al que el notario puede ir a leer? */
export function isFetchableDomain(domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (!PUBLIC_HOSTNAME_RE.test(d)) return false; // IPs literales, puertos, rutas, userinfo: fuera
  if (d.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))) return false;
  if (d === 'localhost' || NON_PUBLIC_SUFFIXES.some((s) => d.endsWith(s))) return false;
  return true;
}

/** Rangos a los que el notario jamás va: privados, loopback, link-local
 *  (metadata cloud), CGNAT, benchmark, multicast/reservados, ULA, NAT64 y
 *  cualquier IPv4 mapeada en IPv6 (fail-closed: dns.lookup no las devuelve). */
const NON_PUBLIC_IPS = (() => {
  const list = new BlockList();
  for (const [net, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as Array<[string, number]>) list.addSubnet(net, bits, 'ipv4');
  for (const [net, bits] of [
    // Sin `::ffff:0:0/96` aquí: BlockList compara TODA IPv4 también contra su
    // forma mapeada, y esa regla bloqueaba internet entero. Las mapeadas se
    // tratan abajo, a mano.
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ] as Array<[string, number]>) list.addSubnet(net, bits, 'ipv6');
  return list;
})();

/** IPv4/IPv6 no pública — o algo que ni siquiera es una IP (⇒ no se va). */
export function isNonPublicIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  const family = isIP(addr);
  if (family === 4) return NON_PUBLIC_IPS.check(addr, 'ipv4');
  if (family === 6) {
    // IPv4 mapeada (::ffff:a.b.c.d o ::ffff:hhhh:hhhh): dns.lookup no las
    // devuelve para un hostname normal ⇒ fail-closed, jamás se lee.
    if (addr.startsWith('::ffff:') || addr.startsWith('0:0:0:0:0:ffff:')) return true;
    return NON_PUBLIC_IPS.check(addr, 'ipv6');
  }
  return true;
}

export type HostLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: HostLookup = async (hostname) => {
  const { promises: dns } = await import('dns');
  return dns.lookup(hostname, { all: true, verbatim: true });
};

/** Lee el cuerpo sin pasar de `max` bytes; null = demasiado grande. */
async function readBodyCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text();
    return Buffer.byteLength(text, 'utf8') > max ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Lee `https://domain/.well-known/xrp-ledger.toml` tras la frontera de red.
 * Devuelve las cuentas o un CÓDIGO de motivo genérico — nunca el texto, el
 * status ni el mensaje de error del destino.
 */
export async function fetchXrplToml(
  domain: string,
  opts: { fetchImpl?: typeof fetch; lookupImpl?: HostLookup } = {},
): Promise<{ accounts: string[] | null; reason?: string }> {
  if (!isFetchableDomain(domain)) return { accounts: null, reason: 'dominio no apto para lectura' };

  let resolved: Array<{ address: string }>;
  try {
    resolved = await (opts.lookupImpl ?? defaultLookup)(domain);
  } catch {
    return { accounts: null, reason: 'no resuelve' };
  }
  if (!Array.isArray(resolved) || resolved.length === 0) return { accounts: null, reason: 'no resuelve' };
  if (resolved.some((r) => isNonPublicIp(String(r?.address ?? '')))) {
    return { accounts: null, reason: 'dominio no apto para lectura' };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOML_TIMEOUT_MS);
  try {
    const res = await doFetch(`https://${domain}/.well-known/xrp-ledger.toml`, {
      signal: ctrl.signal,
      redirect: 'manual',
    });
    // Una redirección es un fallo, no un camino: el destino podría ser interno.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { accounts: null, reason: 'redirección rechazada' };
    }
    if (!res.ok) return { accounts: null, reason: 'respuesta no satisfactoria' };
    const text = await readBodyCapped(res, MAX_TOML_BYTES);
    if (text === null) return { accounts: null, reason: 'toml demasiado grande' };
    return { accounts: parseXrplTomlAccounts(text) };
  } catch (e) {
    return { accounts: null, reason: (e as Error)?.name === 'AbortError' ? 'timeout' : 'inalcanzable' };
  } finally {
    clearTimeout(timer);
  }
}

// ── El check en vivo ────────────────────────────────────────────────────────

/**
 * Ejecuta los tres checks contra el ledger y la web. No lanza por un check
 * fallido — el veredicto SIEMPRE se devuelve con sus motivos; solo lanza por
 * input inválido.
 */
export async function runNotaryCheck(
  account: string,
  opts: { fetchImpl?: typeof fetch; lookupImpl?: HostLookup; nowMs?: number } = {},
): Promise<NotaryVerdict> {
  if (!XRPL_ADDRESS_RE.test(account)) {
    throw new NotaryVerifierError('INVALID_ACCOUNT', 'account debe ser una r-address válida');
  }
  const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
  const domainHex = await xrplProvider.getAccountDomain(account);
  const domain = decodeDomainHex(domainHex);

  let tomlAccounts: string[] | null = null;
  let tomlError: string | undefined;
  if (domain) {
    const read = await fetchXrplToml(domain, { fetchImpl: opts.fetchImpl, lookupImpl: opts.lookupImpl });
    tomlAccounts = read.accounts;
    tomlError = read.reason;
  }

  return evaluateNotary({ account, domain, tomlAccounts, tomlError, firms: registerFirms(), nowMs: opts.nowMs });
}

// ── El AccountSet{Domain} sin firmar (lo firma el GESTOR) ───────────────────

/**
 * El txjson que declara el dominio en la cuenta del gestor — la mitad del
 * binding que firma ÉL en Xaman. La otra mitad (el toml en su web) la hace su
 * equipo web; Astryum no toca ninguna de las dos.
 */
export function composeAccountSetDomain(account: string, domain: string): Record<string, unknown> {
  if (!isValidClassicAddress(account)) {
    throw new NotaryVerifierError('INVALID_ACCOUNT', 'account debe ser una r-address válida');
  }
  const trimmed = domain.trim().toLowerCase();
  const bytes = Buffer.from(trimmed, 'utf8');
  // Un dominio, no una URL: sin esquema, sin ruta, con al menos un punto.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed) || bytes.length > MAX_DOMAIN_BYTES) {
    throw new NotaryVerifierError(
      'INVALID_DOMAIN',
      `domain debe ser un dominio (ej. gestora.example), máx ${MAX_DOMAIN_BYTES} bytes, sin https:// ni rutas`,
    );
  }
  const tx = { TransactionType: 'AccountSet' as const, Account: account, Domain: bytes.toString('hex').toUpperCase() };
  validate(tx as never);
  return tx;
}

/**
 * XrplAnchorGateService — la PUERTA del ancla, compuesta sin firmar.
 *
 * La autoridad de un gestor sobre su jaula viaja como un Payment XRPL al ancla,
 * atestiguado por FDC. El bridge v2 solo ejecuta órdenes que ATERRIZARON en el
 * ancla (`ANCHOR_ADDRESS_HASH`). Este módulo compone lo que convierte el ancla en
 * una puerta que solo cruza quien lleva un título XLS-70 válido:
 *
 *   1. `AccountSet { SetFlag: asfDepositAuth }` — el ancla rechaza a extraños con
 *      `tecNO_PERMISSION`.
 *   2. `DepositPreauth { AuthorizeCredentials: [{ Credential: { Issuer,
 *      CredentialType } }] }` — solo entran los pagos de cuentas que sostengan una
 *      credencial ACEPTADA, no caducada, de ese emisor y tipo.
 *   3. El pago de la orden lleva `CredentialIDs: [<id del objeto Credential>]`.
 *
 * Sin título válido, el ledger rechaza el pago en consenso → no hay pago → no hay
 * prueba FDC → no hay orden. La puerta la pone XRPL; nosotros solo la componemos.
 *
 * Quién firma: 1 y 2 el DUEÑO del ancla (el emisor del título; en la demo, la
 * cuenta de issuing, y se dice). 3 el gestor. Astryum no firma nada.
 *
 * Todo es puro: entra JSON, sale txjson sin firmar. Sin RPC, testable en seco.
 */

import { isValidClassicAddress, validate } from 'xrpl';

/** `asfDepositAuth` — AccountSet flag 9 (xrpl.org, AccountSet flags). */
export const ASF_DEPOSIT_AUTH = 9;

/** XRPL admite como mucho 8 credenciales por DepositPreauth y por Payment. */
export const MAX_CREDENTIALS = 8;

export class AnchorGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnchorGateError';
  }
}

export interface CredentialSpec {
  issuer: string;
  /** Texto (se codifica a hex) o ya hex. */
  credentialType: string;
}

const HEX_RE = /^[0-9A-Fa-f]+$/;
const LEDGER_ID_RE = /^[0-9A-Fa-f]{64}$/;

/** El CredentialType del ledger va en hex, 1-64 bytes. Texto → hex; hex → tal cual. */
export function credentialTypeToHex(credentialType: string): string {
  const raw = credentialType.trim();
  if (!raw) throw new AnchorGateError('BAD_TYPE', 'credentialType no puede estar vacío');
  const hex = HEX_RE.test(raw) && raw.length % 2 === 0 ? raw.toUpperCase() : Buffer.from(raw, 'utf8').toString('hex').toUpperCase();
  if (hex.length > 128) throw new AnchorGateError('BAD_TYPE', 'credentialType no puede superar 64 bytes');
  return hex;
}

/**
 * 1. Encender `DepositAuth` en el ancla. Desde este momento, el ancla solo admite
 * pagos de cuentas preautorizadas (por cuenta o por credencial).
 */
export function composeEnableDepositAuth(anchor: string): Record<string, unknown> {
  if (!isValidClassicAddress(anchor)) throw new AnchorGateError('BAD_ANCHOR', 'anchor debe ser una r-address válida');
  const tx = { TransactionType: 'AccountSet' as const, Account: anchor, SetFlag: ASF_DEPOSIT_AUTH };
  validate(tx as never);
  return tx;
}

/**
 * 2. Preautorizar por CREDENCIAL: quien sostenga una credencial válida de este
 * emisor y tipo puede pagar al ancla. `mode: 'unauthorize'` la retira (revocar
 * el acceso de todo un emisor es inmediato y no toca capital de nadie).
 */
export function composeAuthorizeCredentials(
  anchor: string,
  credentials: CredentialSpec[],
  mode: 'authorize' | 'unauthorize' = 'authorize',
): Record<string, unknown> {
  if (!isValidClassicAddress(anchor)) throw new AnchorGateError('BAD_ANCHOR', 'anchor debe ser una r-address válida');
  if (!Array.isArray(credentials) || credentials.length === 0) {
    throw new AnchorGateError('EMPTY', 'hace falta al menos una credencial');
  }
  if (credentials.length > MAX_CREDENTIALS) {
    throw new AnchorGateError('TOO_MANY', `XRPL admite como mucho ${MAX_CREDENTIALS} credenciales por DepositPreauth`);
  }
  const seen = new Set<string>();
  const list = credentials.map((c) => {
    if (!isValidClassicAddress(c.issuer)) throw new AnchorGateError('BAD_ISSUER', `issuer inválido: ${String(c.issuer)}`);
    const typeHex = credentialTypeToHex(c.credentialType);
    const key = `${c.issuer}:${typeHex}`;
    if (seen.has(key)) throw new AnchorGateError('DUPLICATE', `credencial repetida: ${key}`);
    seen.add(key);
    return { Credential: { Issuer: c.issuer, CredentialType: typeHex } };
  });
  const tx = {
    TransactionType: 'DepositPreauth' as const,
    Account: anchor,
    ...(mode === 'authorize' ? { AuthorizeCredentials: list } : { UnauthorizeCredentials: list }),
  };
  validate(tx as never);
  return tx;
}

/**
 * 3. Adjuntar los IDs de credencial a un Payment ya compuesto. El ledger exige
 * que cada una exista, esté ACEPTADA, no haya caducado y sea del firmante — si
 * no, `tecBAD_CREDENTIALS`. Por eso solo se adjuntan las que el lector marcó
 * como válidas; una lista vacía deja el Payment tal cual.
 */
export function withCredentialIds<T extends Record<string, unknown>>(payment: T, credentialIds: string[]): T {
  if (!Array.isArray(credentialIds) || credentialIds.length === 0) return payment;
  if (credentialIds.length > MAX_CREDENTIALS) {
    throw new AnchorGateError('TOO_MANY', `XRPL admite como mucho ${MAX_CREDENTIALS} credenciales por Payment`);
  }
  const ids = credentialIds.map((id) => {
    if (!LEDGER_ID_RE.test(id)) throw new AnchorGateError('BAD_ID', `CredentialID inválido (64 hex): ${id}`);
    return id.toUpperCase();
  });
  if (new Set(ids).size !== ids.length) throw new AnchorGateError('DUPLICATE', 'CredentialIDs repetidos');
  return { ...payment, CredentialIDs: ids };
}

/* ────────────────────────────────────────────────────────────────────────────
 * La regla del ledger que decide si un pago CRUZA (rippled, Credentials.cpp
 * `authorized`): con `lsfDepositAuth` en el destino, el pago entra si (a) el
 * firmante está preautorizado POR CUENTA, o (b) el CONJUNTO de credenciales
 * que lleva en `CredentialIDs` — como pares {Issuer, CredentialType}, ordenado
 * y sin repetir — es EXACTAMENTE uno de los `AuthorizeCredentials` del destino
 * (`keylet::depositPreauth(dst, sortedSet)`). Ni un subconjunto ni un
 * superconjunto: una credencial de más tumba el pago con `tecNO_PERMISSION`.
 *
 * Visto en mainnet (17-sep-2026): la raíz rNyre… sostiene AIFM+KYC del notario
 * Y un AIFM+KYC que se emitió a sí misma; adjuntar «todas las válidas» le daba
 * 4 IDs, que no casan con {AIFM,KYC} del notario. Por eso la orden ELIGE el
 * conjunto que el ancla admite, en vez de llevarse todo lo que tiene.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Un par {emisor, tipo} tal y como lo compara el ledger: tipo YA en hex. */
export interface CredentialSpecHex {
  issuer: string;
  credentialTypeHex: string;
}

/** Un conjunto autorizado (un objeto DepositPreauth con `AuthorizeCredentials`). */
export type GateSet = CredentialSpecHex[];

/** La clave canónica de un conjunto: la misma para el mismo conjunto, venga de config o del ledger. */
export function gateSetKey(set: ReadonlyArray<CredentialSpecHex>): string {
  return set
    .map((c) => `${c.issuer}:${c.credentialTypeHex.toUpperCase()}`)
    .sort()
    .join(',');
}

/**
 * De la config de la puerta del gestor (`MANAGER_CREDENTIAL_TYPE`, grupos OR
 * con `|` separados por `,`, × emisores) a los CONJUNTOS EXACTOS que el ancla
 * tiene que preautorizar — uno por cada combinación, porque el ledger no sabe
 * de «o»: `AIFM|CASP,KYC|KYB` con un emisor son 4 objetos DepositPreauth
 * ({AIFM,KYC} {AIFM,KYB} {CASP,KYC} {CASP,KYB}); cada uno cuesta una reserva
 * de owner (0,2 XRP). Un solo objeto con los cuatro pares exigiría sostener
 * los CUATRO a la vez — eso era lo que componía el default antiguo, y es lo
 * contrario de la puerta del servidor.
 *
 * Determinista y sin repetidos: los conjuntos idénticos (grupos que se solapan)
 * colapsan por clave canónica; el orden de salida es el canónico.
 */
export function expandGateSets(credentialTypes: ReadonlyArray<string>, issuers: Iterable<string>): GateSet[] {
  const issuerList = [...new Set([...issuers].map((s) => s.trim()).filter((s) => s.length > 0))];
  const groups = credentialTypes
    .map((g) =>
      g
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .filter((g) => g.length > 0);
  if (issuerList.length === 0 || groups.length === 0) return [];

  // Cada grupo aporta sus alternativas (tipo × emisor); el producto cartesiano
  // entre grupos son los conjuntos.
  let partial: GateSet[] = [[]];
  for (const group of groups) {
    const alternatives: CredentialSpecHex[] = [];
    for (const type of group) {
      for (const issuer of issuerList) alternatives.push({ issuer, credentialTypeHex: credentialTypeToHex(type) });
    }
    const next: GateSet[] = [];
    for (const set of partial) for (const alt of alternatives) next.push([...set, alt]);
    partial = next;
  }

  const byKey = new Map<string, GateSet>();
  for (const set of partial) {
    // Dentro de un conjunto, un par repetido (dos grupos que aceptan el mismo
    // tipo) es UNA credencial: el ledger lo compara como conjunto.
    const dedup = new Map<string, CredentialSpecHex>();
    for (const c of set) dedup.set(`${c.issuer}:${c.credentialTypeHex}`, c);
    const unique = [...dedup.values()];
    if (unique.length > MAX_CREDENTIALS) {
      throw new AnchorGateError('TOO_MANY', `un conjunto de ${unique.length} credenciales supera las ${MAX_CREDENTIALS} que admite XRPL`);
    }
    byKey.set(gateSetKey(unique), unique);
  }
  return [...byKey.keys()].sort().map((k) => byKey.get(k) as GateSet);
}

/** Lo que el ancla tiene HOY en el ledger, ya interpretado. */
export interface ParsedPreauth {
  /** Conjuntos autorizados por CREDENCIAL (uno por objeto `AuthorizeCredentials`). */
  credentialSets: GateSet[];
  /** Cuentas autorizadas directamente (`Authorize`). */
  accounts: string[];
}

/** De `account_objects type=deposit_preauth` (nodos crudos) a conjuntos y cuentas. Ilegible ⇒ se ignora, nunca se inventa. */
export function parseDepositPreauthObjects(objects: ReadonlyArray<Record<string, unknown>>): ParsedPreauth {
  const credentialSets: GateSet[] = [];
  const accounts: string[] = [];
  for (const o of objects) {
    if (o?.LedgerEntryType !== 'DepositPreauth') continue;
    if (typeof o.Authorize === 'string' && isValidClassicAddress(o.Authorize)) {
      accounts.push(o.Authorize);
      continue;
    }
    const list = o.AuthorizeCredentials;
    if (!Array.isArray(list)) continue;
    const set: GateSet = [];
    for (const entry of list) {
      const cred = (entry as { Credential?: { Issuer?: unknown; CredentialType?: unknown } })?.Credential;
      const issuer = String(cred?.Issuer ?? '');
      const typeHex = String(cred?.CredentialType ?? '');
      if (!isValidClassicAddress(issuer) || !HEX_RE.test(typeHex) || typeHex.length === 0) {
        set.length = 0;
        break;
      }
      set.push({ issuer, credentialTypeHex: typeHex.toUpperCase() });
    }
    if (set.length > 0) credentialSets.push(set);
  }
  return { credentialSets, accounts };
}

/** Lo mínimo que hace falta saber de una credencial del firmante para elegir. */
export interface HeldCredential {
  subject: string;
  issuer: string;
  credentialTypeHex: string;
  ledgerIndex: string | null;
  state: string;
}

function usable(account: string, c: HeldCredential): boolean {
  return (
    c.subject === account &&
    (c.state === 'valid' || c.state === 'expiring-soon') &&
    typeof c.ledgerIndex === 'string' &&
    LEDGER_ID_RE.test(c.ledgerIndex)
  );
}

/**
 * El conjunto que el firmante puede presentar: el PRIMER conjunto autorizado
 * que cubre entero con credenciales propias, válidas y con id. Se prueban
 * primero los conjuntos más pequeños (menos credenciales = menos formas de
 * caducar a mitad de camino) y, a igual tamaño, en orden canónico — así la
 * elección es la misma en cualquier nodo y en cualquier test. `null` = no hay
 * ninguno que cubra.
 */
export function selectCredentialIdsForGate(
  account: string,
  sets: ReadonlyArray<GateSet>,
  held: ReadonlyArray<HeldCredential>,
): { credentialIds: string[]; set: GateSet } | null {
  const own = held.filter((c) => usable(account, c));
  const ordered = [...sets].sort((a, b) => a.length - b.length || gateSetKey(a).localeCompare(gateSetKey(b)));
  for (const set of ordered) {
    const ids: string[] = [];
    for (const want of set) {
      const match = own.find(
        (c) => c.issuer === want.issuer && c.credentialTypeHex.toUpperCase() === want.credentialTypeHex.toUpperCase(),
      );
      if (!match) break;
      ids.push((match.ledgerIndex as string).toUpperCase());
    }
    if (ids.length === set.length && set.length > 0) return { credentialIds: ids, set };
  }
  return null;
}

/** El estado del ancla que la orden necesita para decidir qué adjunta. */
export interface AnchorGateState {
  anchor: string;
  /** `lsfDepositAuth` (0x01000000) en el AccountRoot. */
  depositAuth: boolean;
  credentialSets: GateSet[];
  accounts: string[];
}

export interface OrderCredentialDecision {
  credentialIds: string[];
  /**
   * `exact-set`: el ancla publica conjuntos y el firmante cubre uno → van esos.
   * `preauthorized-account`: la cuenta está en la lista → no hace falta título.
   * `no-gate`: el ancla no publica conjuntos → todas las propias válidas (como
   *   antes: sin puerta el ledger las ignora, y sirven de prueba de título).
   * `unverified`: no se pudo leer el ancla → mismo fallback; se dice.
   */
  reason: 'exact-set' | 'preauthorized-account' | 'no-gate' | 'unverified';
  set?: GateSet;
}

/**
 * PURA: qué `CredentialIDs` lleva la orden. La única negativa es la que evita
 * una firma condenada: el ancla tiene la puerta ENCENDIDA, el firmante no está
 * en la lista de cuentas y ningún conjunto le cubre → `NO_MATCHING_TITLE`, con
 * los conjuntos que el ancla admite para que la pantalla diga qué falta. Si la
 * puerta está apagada, un conjunto que no cubre no es un error: se adjuntan
 * las propias válidas y el pago entra igual (el ledger no exige nada).
 */
export function decideOrderCredentialIds(
  account: string,
  gate: AnchorGateState | null,
  held: ReadonlyArray<HeldCredential>,
): OrderCredentialDecision {
  const ownAll = held
    .filter((c) => usable(account, c))
    .map((c) => (c.ledgerIndex as string).toUpperCase())
    .slice(0, MAX_CREDENTIALS);
  if (!gate) return { credentialIds: ownAll, reason: 'unverified' };
  if (gate.accounts.includes(account)) return { credentialIds: [], reason: 'preauthorized-account' };
  if (gate.credentialSets.length === 0) return { credentialIds: ownAll, reason: 'no-gate' };
  const pick = selectCredentialIdsForGate(account, gate.credentialSets, held);
  if (pick) return { credentialIds: pick.credentialIds, reason: 'exact-set', set: pick.set };
  if (gate.depositAuth) {
    const accepted = gate.credentialSets.map((s) => s.map((c) => `${hexToTypeLabel(c.credentialTypeHex)} from ${c.issuer}`).join(' + '));
    throw new AnchorGateError(
      'NO_MATCHING_TITLE',
      `the anchor ${gate.anchor} only admits orders from an account holding one of these accepted, unexpired credential sets: ` +
        accepted.map((s) => `[${s}]`).join(' | ') +
        `. ${account} holds none of them in full, so the ledger would reject the Payment with tecNO_PERMISSION - nothing was composed.`,
    );
  }
  return { credentialIds: ownAll, reason: 'no-gate' };
}

/** Hex → texto si es imprimible (para mensajes); si no, el hex tal cual. */
export function hexToTypeLabel(hex: string): string {
  try {
    const text = Buffer.from(hex, 'hex').toString('utf8');
    return /^[\x20-\x7E]+$/.test(text) ? text : hex;
  } catch {
    return hex;
  }
}

/** Config vs ledger: qué conjuntos faltan en el ancla y cuáles sobran. */
export function gateDrift(
  configSets: ReadonlyArray<GateSet>,
  ledgerSets: ReadonlyArray<GateSet>,
): { missing: GateSet[]; extra: GateSet[] } {
  const ledgerKeys = new Set(ledgerSets.map(gateSetKey));
  const configKeys = new Set(configSets.map(gateSetKey));
  return {
    missing: configSets.filter((s) => !ledgerKeys.has(gateSetKey(s))),
    extra: ledgerSets.filter((s) => !configKeys.has(gateSetKey(s))),
  };
}

/** El plan de armado: qué firmaría la clave del ancla, y si el saldo lo cubre. */
export interface AnchorGateArmPlan {
  /** Los DepositPreauth que faltan (uno por conjunto), en orden canónico. */
  toAuthorize: GateSet[];
  /** true = hace falta el AccountSet{asfDepositAuth}. */
  setFlag: boolean;
  /** Reserva que el ancla tendrá que sostener tras el plan (base + objetos). */
  reserveAfterXrp: number;
  /** XRP que faltan para poder ejecutar el plan (0 = cubierto). */
  shortfallXrp: number;
  /** Nada que hacer: la puerta ya está como la config dice. */
  alreadyArmed: boolean;
}

/**
 * PURA. Reserva: base + inc × (objetos actuales + nuevos), más el margen de las
 * fees de las propias txs. Se exige también quedar POR ENCIMA de la base
 * reserve: con DepositAuth, un destino con saldo ≤ base reserve acepta pagos
 * ≤ base reserve de cualquiera (rippled, Payment.cpp — la excepción anti-
 * bloqueo). Un ancla con objetos no puede bajar de ahí sin borrarlos, pero se
 * comprueba igual: la puerta no puede nacer con el agujero abierto.
 */
export function planAnchorGateArm(input: {
  state: AnchorGateState;
  configSets: ReadonlyArray<GateSet>;
  balanceXrp: number;
  ownerCount: number;
  baseReserveXrp: number;
  ownerReserveXrp: number;
  /** Margen para las fees de las txs del plan (por defecto 0,01 XRP). */
  feeMarginXrp?: number;
}): AnchorGateArmPlan {
  const { missing } = gateDrift(input.configSets, input.state.credentialSets);
  const setFlag = !input.state.depositAuth;
  const reserveAfterXrp = input.baseReserveXrp + input.ownerReserveXrp * (input.ownerCount + missing.length);
  const needed = reserveAfterXrp + (input.feeMarginXrp ?? 0.01);
  const shortfallXrp = Math.max(0, Number((needed - input.balanceXrp).toFixed(6)));
  return {
    toAuthorize: missing,
    setFlag,
    reserveAfterXrp,
    shortfallXrp,
    alreadyArmed: missing.length === 0 && !setFlag,
  };
}

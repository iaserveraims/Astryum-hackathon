/**
 * handoffAuthority — who may act on a 0xFE handoff that belongs to an XRPL account.
 *
 * A prepared `0xFE` dispatch holds the nonce seat of the Personal Account that
 * `xrplAddress` controls. Releasing that seat, or displacing it with a new
 * prepare (`supersede`), decides whether a Payment the owner may already hold
 * in Xaman can still execute — so neither may be decided by the request body.
 */
import type { Request } from 'express';
import type { ProofPurpose, ProofRefusal, ProofStoreFailure, ProofOutcome } from '../identity/provenAddresses';

/**
 * QUÉ SE LE DEBE A QUIEN NO PUDIMOS COMPROBAR.
 *
 * `mayAct` es lo único que hace falta para dejar pasar. Cuando es false, la ruta
 * tiene además el cuerpo exacto que debe responder: 403 «no lo has probado», o
 * **503 «no pude leer»** — que solo aparece en una SALIDA y que NO puede
 * degradarse a un 403, porque un fallo transitorio de lectura jamás puede quitar
 * a nadie su última llave de salida.
 */
export interface XrplAccountAuthority {
  mayAct: boolean;
  /** null exactamente cuando `mayAct` es true; si no, la respuesta a enviar. */
  refusal: ProofRefusal | null;
  /**
   * POR QUÉ no se pudo leer, para quien necesite
   * distinguir. `'read-failed'` es transitorio (BD caída, pool agotado): ahí un
   * «vuelve a intentarlo» es verdad. `'no-user-row'` y `'unreadable-floor'` son
   * DETERMINISTAS: repetir no las arregla, así que un 503 perpetuo sería un muro
   * con cara de espera. null = la tienda se leyó bien (o no había nada que leer).
   */
  failure: ProofStoreFailure | null;
  /**
   * §P1 1.1/1.4 — LAS TRES RESPUESTAS
   * QUE HAY. `mayAct: false` arrastraba dos estados muy distintos: «esta sesión
   * no tiene esa cuenta» y «no pude leer si la tiene». El segundo marcaba la fila
   * como desplazable, que es cómo un parpadeo de BD se convertía en el asiento de
   * otro. La puerta del fundador cuenta como `'proven'`: si pasa, pasa.
   */
  outcome: ProofOutcome;
}

/**
 * ¿Puede esta sesión actuar sobre un handoff de `xrplAddress`, y qué se le debe
 * si no? Dos fundamentos, los dos server-side: la dirección PROBADA (login o
 * binding firmado — nunca la tabla `wallet`) o el fundador verificado.
 *
 * `purpose` decide UNA sola cosa (contrato de `proveAddress`, it19): qué
 * significa una tienda de pruebas ilegible. En una ENTRADA, un «no» (falla
 * cerrado); en una SALIDA, un 503 que conserva el derecho. La puerta del fundador
 * se comprueba ANTES de devolver ese 503: si es fundador verificado, pasa igual.
 */
export async function sessionAuthorityOnXrplAccount(
  req: Request,
  xrplAddress: string,
  purpose: ProofPurpose = 'entry',
): Promise<XrplAccountAuthority> {
  const address = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
  if (!address) {
    return {
      mayAct: false,
      refusal: {
        status: 403,
        error: 'ADDRESS_NOT_PROVEN',
        detail: 'No XRPL account was named, so nothing could be proven about it.',
        retryable: false,
      },
      failure: null,
      outcome: 'not-proven',
    };
  }
  const userId = req.siwe?.userId ?? null;
  let refusal: ProofRefusal | null = null;
  let failure: ProofStoreFailure | null = null;
  let outcome: ProofOutcome = 'not-proven';
  try {
    const { proveAddress, proofOutcome } = await import('../identity/provenAddresses');
    const verdict = await proveAddress(userId, req.siwe?.walletAddress ?? null, address, purpose);
    if (verdict.proven) return { mayAct: true, refusal: null, failure: verdict.failure, outcome: 'proven' };
    refusal = verdict.refusal;
    failure = verdict.failure;
    outcome = proofOutcome(verdict);
  } catch {
    // Ni el propio módulo de pruebas respondió: eso es un fallo de lectura, y de
    // los transitorios — nunca una afirmación sobre lo que esta sesión probó.
    failure = 'read-failed';
    outcome = 'could-not-read';
    /* fall through to the founder check — never a throw in this seam */
  }
  if (userId && process.env.DATABASE_URL) {
    try {
      const { isAdminEmail } = await import('../../routes/adminPanel');
      const { prisma } = await import('../../database/prismaClient');
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
      if (!!user && user.emailVerified === true && isAdminEmail(user.email)) {
        return { mayAct: true, refusal: null, failure, outcome: 'proven' };
      }
    } catch {
      /* una lectura fallida no convierte a nadie en fundador */
    }
  }
  return {
    mayAct: false,
    // EL DEFECTO DE ESTA COSTURA ERA UN 403, INCLUSO
    // EN UNA SALIDA. Si el `import()` del módulo de pruebas falla (build rota,
    // ciclo de módulos, OOM), el `catch` de arriba deja `refusal` en null y aquí
    // se devolvía un 403 `ADDRESS_NOT_PROVEN` NO reintentable: un fallo nuestro
    // se le contaba al usuario como «no has probado esa cuenta» y le cerraba la
    // salida. `fallbackRefusalFor` contesta lo que ese estado ES — 503
    // reintentable en una salida, el 403 honesto en una entrada.
    refusal: refusal ?? fallbackRefusalFor(outcome, purpose),
    failure,
    outcome,
  };
}

const NOT_PROVEN_FALLBACK_DETAIL = 'This session has not proven control of that XRPL account.';

const PROOF_MODULE_UNREADABLE_DETAIL =
  'We could not check your wallet proofs just now — the check itself failed, not your signature — so we will not answer ' +
  'for them either way, and we will not take this away from you because of it. Nothing was composed and nothing moved. ' +
  'Try again in a moment; if it keeps failing, sign in again with the wallet that controls this account.';

/**
 * La respuesta que se debe cuando NI SIQUIERA se pudo
 * preguntar (el módulo de pruebas no cargó), y por tanto no hay `refusal` suyo
 * que propagar. Misma regla que `refusalForUnreadableStore` para el fallo
 * transitorio, escrita aquí porque este caso es justo aquel en que ese módulo no
 * está disponible para preguntarle. Pura, en inglés, y jamás un 403 sobre una
 * salida: «no pude leer» no es ni permiso ni castigo.
 */
function fallbackRefusalFor(outcome: ProofOutcome, purpose: ProofPurpose): ProofRefusal {
  if (outcome === 'could-not-read' && purpose === 'exit') {
    return { status: 503, error: 'PROOF_STORE_UNREADABLE', detail: PROOF_MODULE_UNREADABLE_DETAIL, retryable: true };
  }
  return { status: 403, error: 'ADDRESS_NOT_PROVEN', detail: NOT_PROVEN_FALLBACK_DETAIL, retryable: false };
}

/**
 * EL REFUSAL QUE UNA PUERTA DEL ASIENTO
 * REENVÍA, TAL CUAL, HASTA LA RESPUESTA.
 */
export function forwardedProofRefusalBody(e: unknown): Record<string, unknown> | null {
  const r = (e as { proofRefusal?: ProofRefusal } | null)?.proofRefusal;
  if (!r || typeof r !== 'object' || typeof r.error !== 'string') return null;
  return {
    error: r.error,
    retryable: r.retryable === true,
    ...(typeof r.headline === 'string' ? { headline: r.headline } : {}),
    ...(Array.isArray(r.ways) && r.ways.length ? { ways: [...r.ways] } : {}),
    ...(typeof r.retryAfterSeconds === 'number' ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
    detail: r.detail,
  };
}

/** The HTTP status the forwarded proof refusal chose, or null when none is forwarded. */
export function forwardedProofRefusalStatus(e: unknown): number | null {
  const r = (e as { proofRefusal?: ProofRefusal } | null)?.proofRefusal;
  return r && typeof r === 'object' && typeof r.status === 'number' ? r.status : null;
}

/**
 * §Q1 1.1 (contrato A→C) — LAS DOS MARCAS DEL ASIENTO, LLENADAS
 * EN UN SOLO SITIO.
 */
export interface SeatProofFields {
  /** true SOLO con prueba. Jamás true sobre una lectura que no se pudo hacer. */
  preparedByProven: boolean;
  /** true cuando NO consta que se llegara a preguntar: la fila no se aparta sola. */
  preparedByProofUnreadable: boolean;
}

export function seatProofFieldsFrom(
  verdictOrBoolean:
    | boolean
    | null
    | undefined
    | {
        proven?: boolean;
        storeReadable?: boolean;
        mayAct?: boolean;
        outcome?: ProofOutcome;
        preparedByProven?: boolean;
        preparedByProofUnreadable?: boolean;
      },
): SeatProofFields {
  const proven = { preparedByProven: true, preparedByProofUnreadable: false };
  const notProven = { preparedByProven: false, preparedByProofUnreadable: false };
  /** El lado seguro: no consta que se preguntara ⇒ nadie aparta esta fila. */
  const unknown = { preparedByProven: false, preparedByProofUnreadable: true };

  if (verdictOrBoolean === true) return proven;
  // `false` a secas es la forma booleana: colapsa los dos «no» en uno, así que
  // no puede sostener la frase «pregunté y no la tiene». Lado seguro.
  if (verdictOrBoolean === false || verdictOrBoolean == null) return unknown;

  const v = verdictOrBoolean;
  // Un claim ya construido (`seatProofFromVerdict`) viaja tal cual.
  if (typeof v.preparedByProven === 'boolean' || typeof v.preparedByProofUnreadable === 'boolean') {
    if (v.preparedByProven === true) return proven;
    return v.preparedByProofUnreadable === false ? notProven : unknown;
  }
  if (v.outcome === 'proven' || v.mayAct === true || v.proven === true) return proven;
  if (v.outcome === 'could-not-read') return unknown;
  if (v.outcome === 'not-proven') return notProven;
  // Sin `outcome`: el veredicto de `proveAddress`. `storeReadable` es la mitad
  // que separa las dos negativas; si tampoco viene, no consta que se preguntara.
  if (v.storeReadable === true) return notProven;
  return unknown;
}

/**
 * May this session act on a handoff owned by `xrplAddress`? Only if the address
 * is one it has PROVEN, or the session is a verified founder. Moved verbatim from
 * routes/flareDemo.ts (`sessionMayActOnHandoff`) so the prepare
 * routes of every module share one verdict.
 *
 * Forma booleana de `sessionAuthorityOnXrplAccount`: pierde el 503 de una tienda
 * ilegible, así que en una salida conviene la forma completa. `purpose` viaja
 * igual, porque de él depende que un fallo de lectura no cueste una salida.
 */
export async function sessionMayActOnXrplAccount(
  req: Request,
  xrplAddress: string,
  purpose: ProofPurpose = 'entry',
): Promise<boolean> {
  return (await sessionAuthorityOnXrplAccount(req, xrplAddress, purpose)).mayAct;
}

/**
 * Pure: is `sessionUserId` the Astryum user who prepared the handoff? Both ids
 * must be non-empty strings — a row without a preparer (older rows, CLI/server
 * jobs) or an anonymous session is never «the same preparer».
 */
export function isSameHandoffPreparer(sessionUserId: unknown, preparedByUserId: unknown): boolean {
  return (
    typeof sessionUserId === 'string' &&
    typeof preparedByUserId === 'string' &&
    sessionUserId.length > 0 &&
    preparedByUserId.length > 0 &&
    sessionUserId === preparedByUserId
  );
}

// ── How long the Xaman payload of a 0xFE stays signable (§L1) ──
//
// The seat of a nonce is not held by a clock and not held by a row: it is held
// by a PAYLOAD that somebody can still sign. Two independent deadlines bound it:
//   - the Xaman payload `expire` (minutes) the frontend sets when it pushes the
//     dispatch to the wallet — after it, Xaman will not sign that payload at all;
//   - the `LastLedgerSequence` the builder stamps — after that ledger, even a
//     signed Payment can no longer enter.
// The window must therefore COVER the payload expiry, and a seat may only be
// freed once the payload can no longer be signed. Both numbers come from here so
// they can never drift apart again (/1.5).

/** Minutes a Xaman 0xFE payload stays signable when `HANDOFF_PAYLOAD_EXPIRY_MIN` is unset. */
export const DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN = 5;
/** Bounds for the env override: under a minute nothing is signable, over an hour no seat should wait. */
const MIN_PAYLOAD_EXPIRY_MIN = 1;
const MAX_PAYLOAD_EXPIRY_MIN = 60;
/** Xaman's own ceiling for `expire` (24 h) — and the ceiling of a signing CEREMONY. */
export const MAX_CEREMONY_PAYLOAD_EXPIRY_MIN = 1440;
/** Lo que vive el payload de una ceremonia multifirma (`expire: 1440` en Xaman). */
export const DEFAULT_HANDOFF_CEREMONY_EXPIRY_MIN = MAX_CEREMONY_PAYLOAD_EXPIRY_MIN;

/**
 * Minutes the Xaman payload of a 0xFE stays signable (`HANDOFF_PAYLOAD_EXPIRY_MIN`,
 * default 5, clamped to [1, 60]). It is the SAME figure the frontend passes to
 * Xaman as `expire`; changing it here moves the ledger window with it.
 */
export function handoffPayloadExpiryMin(): number {
  const raw = Number(process.env.HANDOFF_PAYLOAD_EXPIRY_MIN);
  const min = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HANDOFF_PAYLOAD_EXPIRY_MIN;
  return Math.min(Math.max(min, MIN_PAYLOAD_EXPIRY_MIN), MAX_PAYLOAD_EXPIRY_MIN);
}

/**
 * LA VENTANA DE UNA CEREMONIA SE MIDE CON SU PROPIO
 * PAYLOAD, NO CON EL DE UNA FIRMA SIMPLE.
 */
export function handoffCeremonyExpiryMin(): number {
  const raw = Number(process.env.HANDOFF_CEREMONY_EXPIRY_MIN);
  const min = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HANDOFF_CEREMONY_EXPIRY_MIN;
  return Math.min(Math.max(min, handoffPayloadExpiryMin()), MAX_CEREMONY_PAYLOAD_EXPIRY_MIN);
}

/**
 * La vida declarada de un payload, acotada a [1, 24 h]. `undefined` (o basura) =
 * la de una firma simple. NUNCA se toma del cuerpo de una petición: alargar la
 * vida de un payload alarga el asiento de nonce de esa cuenta, así que lo declara
 * la ruta que compone, en código, y el servidor lo acota igualmente.
 */
export function clampPayloadExpiryMin(requested?: number | null): number {
  const raw = Number(requested);
  if (!Number.isFinite(raw) || raw <= 0) return handoffPayloadExpiryMin();
  return Math.min(Math.max(raw, MIN_PAYLOAD_EXPIRY_MIN), MAX_CEREMONY_PAYLOAD_EXPIRY_MIN);
}

/** ISO instant at which the payload composed at `composedAtMs` stops being signable (contrato C3). */
export function handoffPayloadExpiresAt(composedAtMs: number = Date.now(), expiryMin?: number | null): string {
  const min = expiryMin === undefined || expiryMin === null ? handoffPayloadExpiryMin() : clampPayloadExpiryMin(expiryMin);
  return new Date(composedAtMs + min * 60_000).toISOString();
}

/**
 * Los minutos que vive el payload de ESTA fila: los que declaró quien la compuso
 * (una ceremonia, 24 h) o los de una firma simple. Nunca sale de aquí un número
 * fuera de [1, 24 h].
 */
export function rowPayloadExpiryMin(row: { payloadExpiryMin?: number | null }): number {
  return clampPayloadExpiryMin(row?.payloadExpiryMin ?? null);
}

/**
 * When this row's payload stops being signable, in ms — the persisted
 * `payloadExpiresAt` when the row carries one (contrato C3), else the row's own
 * creation time plus the expiry it declared (`payloadExpiryMin` §Q1 1.3) or
 * the configured one (rows composed before), else null: with nothing to date
 * the payload by, no clock may free its seat.
 */
export function handoffPayloadExpiryMsOf(row: {
  payloadExpiresAt?: string | null;
  payloadExpiryMin?: number | null;
  createdAt?: Date | string | null;
}): number | null {
  const stamped = typeof row.payloadExpiresAt === 'string' ? Date.parse(row.payloadExpiresAt) : NaN;
  if (Number.isFinite(stamped)) return stamped;
  const created = rowCreatedAtMs(row);
  return created !== null ? created + rowPayloadExpiryMin(row) * 60_000 : null;
}

/** `createdAt` de una fila en ms (Date o ISO), o null si no se puede fechar. */
function rowCreatedAtMs(row: { createdAt?: Date | string | null }): number | null {
  const ms =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : typeof row.createdAt === 'string'
        ? Date.parse(row.createdAt)
        : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// ── LA CADUCIDAD REAL LA FIJA QUIEN CREA EL PAYLOAD (C2) ──
//
// `payloadExpiresAt` se estampaba al COMPONER, pero el `expire` de Xaman corre
// desde que se CREA el payload (cuando el usuario abre el modal, a veces un
// minuto después). El asiento se declaraba libre mientras una firma seguía viva.
// Ahora quien crea el payload lo dice al servidor y el reloj se
// mueve — solo HACIA ADELANTE, nunca más allá de lo que la ventana de ledger
// permite: pasada la LastLedgerSequence el Payment no entra ni firmado, así que
// una caducidad posterior sería mentira y congelaría el asiento por nada.

/** Segundos que tarda en cerrar un ledger validado de XRPL (~3-4 s; 4 redondea al alza). */
export const SEAT_SECONDS_PER_LEDGER = 4;
/** Ledgers que cierran en un minuto a ~4 s cada uno. */
const LEDGERS_PER_MINUTE = 15;
/** Margen sobre la caducidad del payload: un minuto para que la firma del último segundo entre. */
const LLS_MARGIN_LEDGERS = 15;

/**
 * La ventana que cubre la vida del payload + un minuto, SIN acotar (el builder
 * la acota a [10, 1000] en `defaultLastLedgerWindow`, que delega aquí). Vive
 * junto a la caducidad del payload porque las dos son la misma decisión.
 */
export function defaultSeatWindowLedgers(expiryMin?: number | null): number {
  const min = expiryMin === undefined || expiryMin === null ? handoffPayloadExpiryMin() : clampPayloadExpiryMin(expiryMin);
  return Math.ceil(min * LEDGERS_PER_MINUTE + LLS_MARGIN_LEDGERS);
}

/**
 * Los ledgers que hacen falta para cubrir ENTERA la
 * vida de un payload de `expiryMin` minutos. Es el SUELO de la ventana de una
 * fila: si la ventana no cubre el payload, quien firme al final firma bytes que
 * ya no pueden entrar (y el asiento se habría soltado antes con el payload vivo).
 */
export function seatWindowLedgersFor(expiryMin: number): number {
  return defaultSeatWindowLedgers(expiryMin);
}

/**
 * Ledgers que cubre la ventana de esta fila: `LastLedgerSequence` menos el
 * ledger en que se compuso, o `fallbackLedgers` cuando la fila no lleva los dos
 * índices (filas anteriores a it15, o ledger ilegible al componer).
 */
export function seatWindowLedgersOf(
  row: { lastLedgerSequence?: number | null; composedLedgerIndex?: number | null },
  fallbackLedgers: number,
): number {
  const lls = Number(row.lastLedgerSequence);
  const composed = Number(row.composedLedgerIndex);
  const known = Number.isInteger(lls) && Number.isInteger(composed) && lls > composed;
  return known ? lls - composed : fallbackLedgers;
}

/** Minutos de más allá de su ventana que un asiento ilegible debe llevar para poder desplazarse. */
export const DEFAULT_UNREADABLE_DISPLACE_MIN = 30;

/** `HANDOFF_UNREADABLE_DISPLACE_MIN` en ms, con suelo de 5 min: nunca un desplazamiento «rápido». */
export function unreadableDisplaceGraceMs(): number {
  const raw = Number(process.env.HANDOFF_UNREADABLE_DISPLACE_MIN);
  const min = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UNREADABLE_DISPLACE_MIN;
  return Math.max(min, 5) * 60_000;
}

/**
 * ¿la ventana de esta fila quedó MUY atrás? Se mide por
 * tiempo porque este caso es justo aquel en que el ledger no se puede leer: la
 * fila lleva viva más que su propia ventana MÁS el margen. Sin `createdAt` no se
 * puede fechar nada y la respuesta es no. Puro (el llamador pasa su ventana por
 * defecto) — `FlareDirectMintService.seatWindowLongPast` delega aquí para que la
 * regla del builder y la del release no puedan volver a separarse.
 */
export function seatWindowLongPastOf(
  row: { createdAt?: Date | string | null; lastLedgerSequence?: number | null; composedLedgerIndex?: number | null },
  nowMs: number,
  fallbackWindowLedgers: number,
): boolean {
  const created = rowCreatedAtMs(row);
  if (created === null) return false;
  const ledgers = seatWindowLedgersOf(row, fallbackWindowLedgers);
  return nowMs - created >= ledgers * SEAT_SECONDS_PER_LEDGER * 1000 + unreadableDisplaceGraceMs();
}

/**
 * Techo absoluto de la caducidad de un payload: el instante en que su ventana de
 * ledger se cierra (compuesto + ventana × ~4 s). Pasado eso el Payment no entra
 * ni firmado, así que ninguna caducidad declarada puede ir más lejos.
 */
export function seatWindowClosesAtMs(
  row: { createdAt?: Date | string | null; lastLedgerSequence?: number | null; composedLedgerIndex?: number | null },
  fallbackWindowLedgers: number,
): number | null {
  const created = rowCreatedAtMs(row);
  if (created === null) return null;
  return created + seatWindowLedgersOf(row, fallbackWindowLedgers) * SEAT_SECONDS_PER_LEDGER * 1000;
}

/**
 * La caducidad que el servidor acepta de quien CREA el
 * payload. Puro. Solo se mueve hacia adelante, nunca más allá del cierre de la
 * ventana de ledger, y nunca más de lo que un payload vive desde ahora: así una
 * llamada repetida no puede sostener un asiento indefinidamente.
 */
export function clampStampedPayloadExpiry(
  row: {
    payloadExpiresAt?: string | null;
    payloadExpiryMin?: number | null;
    createdAt?: Date | string | null;
    lastLedgerSequence?: number | null;
    composedLedgerIndex?: number | null;
  },
  requestedIso: string,
  ctx: { nowMs: number; fallbackWindowLedgers: number },
): { accepted: boolean; expiresAt?: string; reason?: 'unparseable' | 'not-forward' } {
  const requested = Date.parse(requestedIso);
  if (!Number.isFinite(requested)) return { accepted: false, reason: 'unparseable' };
  const current = handoffPayloadExpiryMsOf(row);
  // El techo «una vida de payload desde ahora» es el de ESTA fila:
  // una ceremonia declaró 24 h al componer, y medirla con los 5 min de una firma
  // simple la dejaba sin poder sellar jamás la caducidad real que Xaman devuelve.
  const ceilings = [ctx.nowMs + rowPayloadExpiryMin(row) * 60_000];
  const windowCloses = seatWindowClosesAtMs(row, ctx.fallbackWindowLedgers);
  if (windowCloses !== null) ceilings.push(windowCloses);
  const capped = Math.min(requested, ...ceilings);
  if (current !== null && capped <= current) return { accepted: false, reason: 'not-forward' };
  return { accepted: true, expiresAt: new Date(capped).toISOString() };
}

// ── EL PREDICADO ÚNICO DEL ASIENTO (§M1 1.1/1.2/1.3) ─────────
//
// Tres puertas decidían por separado si un asiento podía soltarse: el release
// (`classifyHandoffRelease`), el supersede del mismo preparador (`mayDisplaceRow`
// rama b) y el desplazamiento automático del builder. La rama (b) desplazaba una
// fila con la ventana VIVA que el release se negaba a soltar — el mismo gemelo
// por la otra puerta — y el release decidía por reloj sin leer
// jamás la ventana del memo (1.3). Ahora las tres preguntan aquí.

/** Lo que dijo la lectura de la ventana del memo, si se leyó (`HandoffWindowVerdict.state`). */
export type SeatWindowState = 'signed' | 'failed' | 'absent' | 'unreadable';

export type SeatSignabilityReason =
  /** Firmada (marca o ventana leída): su asiento solo lo vacía ejecutar o aparcar. */
  | 'signed'
  /** Una firma reportada que el ledger aún no ha validado. */
  | 'reported'
  /** El payload sigue firmable en el móvil del usuario: soltar AHORA es crear el gemelo. */
  | 'payload-live'
  /** No se sabe si aquel Payment entró: «no pude leer» jamás libera un asiento. */
  | 'window-unreadable'
  /** La fila no lleva ventana (anterior a it15 o ledger ilegible al componer): regla antigua. */
  | 'no-window'
  /** El payload caducó sin firma y la ventana se leyó entera sin su memo. */
  | 'payload-expired'
  /**
   * El TITULAR dio por terminada la ceremonia que iba a firmar esta
   * fila y la ventana se leyó entera sin su memo. No es una caducidad: es una
   * decisión suya, y por eso se apunta con su propio nombre.
   */
  | 'ceremony-ended'
  /** El ledger pasó su LastLedgerSequence y la ventana se leyó sin su memo: no puede entrar jamás. */
  | 'window-passed'
  /** Entró y falló (tec*): no entregó XRP, el mint no puede ejecutarse — asiento libre. */
  | 'ledger-failed'
  /** Ventana ilegible en todos los nodos y muy pasada: la única puerta. */
  | 'window-long-past'
  /**
   * El payload caducó pero ALGUIEN dijo haberlo firmado y el ledger no lo ha
   * desmentido. No gatea como un informe que cuenta (el informe de un
   * extraño no puede cerrar la salida de nadie), pero tampoco deja que el RELOJ
   * suelte el asiento: si aquel Payment aterriza, el gemelo ya estaría compuesto.
   */
  | 'reported-unverified';

export interface SeatSignabilityVerdict {
  /** true = ese payload ya no puede firmarse NI entrar: soltar su asiento no crea gemelo. */
  unsignable: boolean;
  reason: SeatSignabilityReason;
  /** true = leer la ventana del memo es lo único que falta para decidir. */
  needsWindow: boolean;
  /** Segundos que faltan para que el payload deje de poder firmarse (cuenta atrás real). */
  secondsLeft?: number;
  lastLedgerSequence?: number;
}

/**
 * ¿Puede soltarse el asiento de esta fila? Puro — el llamador inyecta lo que leyó
 * (ledger validado, ventana del memo, si hay un informe que cuente). Lo usan el
 * release del store, el supersede y el desplazamiento automático del builder.
 */
export function classifySeatSignability(
  row: {
    signedAt?: string | null;
    lastLedgerSequence?: number | null;
    composedLedgerIndex?: number | null;
    payloadExpiresAt?: string | null;
    /** La vida declarada del payload (una ceremonia, 24 h). */
    payloadExpiryMin?: number | null;
    createdAt?: Date | string | null;
  },
  ctx: {
    nowMs: number;
    validatedLedgerIndex: number | null;
    /** true = alguien cuya palabra CUENTA reportó una firma que el ledger aún no validó. */
    reported?: boolean;
    /**
     * true = la fila lleva algún hash reportado, venga de quien venga. No gatea
     * por sí solo (un extraño no cierra la salida de nadie), pero impide que el
     * RELOJ suelte el asiento: es la regla de it17, conservada tal cual.
     */
    reportedUnverified?: boolean;
    /** Veredicto de `readHandoffMemoWindow`, o null/undefined si nadie la leyó todavía. */
    windowState?: SeatWindowState | null;
    /** Ventana por defecto (ledgers) para fechar una fila sin sus dos índices. */
    fallbackWindowLedgers?: number;
    /**
     * EL TITULAR DIO POR TERMINADA LA CEREMONIA QUE IBA A
     * FIRMAR ESTA FILA. Sustituye SOLO la mitad del RELOJ, jamás la física.
     */
    holderEndedCeremony?: boolean;
  },
): SeatSignabilityVerdict {
  const held = (reason: SeatSignabilityReason, extra?: Partial<SeatSignabilityVerdict>): SeatSignabilityVerdict => ({
    unsignable: false,
    reason,
    needsWindow: false,
    ...extra,
  });
  const free = (reason: SeatSignabilityReason): SeatSignabilityVerdict => ({ unsignable: true, reason, needsWindow: false });

  if (typeof row.signedAt === 'string' && row.signedAt) return held('signed');
  // El ledger manda sobre cualquier marca o informe: si la ventana leída trae su
  // Payment, está firmada; si solo trae un tec*, el dispatch está muerto.
  if (ctx.windowState === 'signed') return held('signed');
  if (ctx.windowState === 'failed') return free('ledger-failed');
  if (ctx.reported === true) return held('reported');

  const lls =
    typeof row.lastLedgerSequence === 'number' && Number.isInteger(row.lastLedgerSequence) && row.lastLedgerSequence > 0
      ? row.lastLedgerSequence
      : null;
  if (lls === null) return free('no-window'); // sin ventana rige la regla de it13

  const expiresAtMs = handoffPayloadExpiryMsOf(row);
  // El reloj, o el titular que dio por terminada la ceremonia. Una cosa
  // O la otra: nunca se salta la lectura de la ventana que viene después.
  const ceremonyEnded = ctx.holderEndedCeremony === true;
  const payloadDead = ceremonyEnded || (expiresAtMs !== null && ctx.nowMs >= expiresAtMs);
  const windowPassed = ctx.validatedLedgerIndex !== null && ctx.validatedLedgerIndex > lls;
  if (!payloadDead && !windowPassed) {
    return held('payload-live', {
      secondsLeft: expiresAtMs !== null ? Math.max(0, Math.ceil((expiresAtMs - ctx.nowMs) / 1000)) : undefined,
      lastLedgerSequence: lls,
    });
  }
  // El payload ya no puede firmarse (o ya no puede entrar) — pero eso NO dice que
  // no se firmara antes. Solo la ventana leída entera sin su memo lo dice.
  if (ctx.windowState === 'absent') {
    if (windowPassed) return free('window-passed'); // ni firmado podría entrar ya
    // Solo el reloj, y alguien dijo haberlo firmado: se espera a la ventana.
    if (ctx.reportedUnverified === true) {
      return held('reported-unverified', { secondsLeft: 0, lastLedgerSequence: lls });
    }
    // Bookkeeping honesto: si lo que mató al payload fue el titular y no el
    // reloj, el veredicto lo dice — no se apunta una caducidad que no ocurrió.
    return free(ceremonyEnded && !(expiresAtMs !== null && ctx.nowMs >= expiresAtMs) ? 'ceremony-ended' : 'payload-expired');
  }
  if (
    ctx.windowState === 'unreadable' &&
    seatWindowLongPastOf(row, ctx.nowMs, ctx.fallbackWindowLedgers ?? defaultSeatWindowLedgers())
  ) {
    return free('window-long-past');
  }
  return held('window-unreadable', { needsWindow: ctx.windowState == null, lastLedgerSequence: lls });
}

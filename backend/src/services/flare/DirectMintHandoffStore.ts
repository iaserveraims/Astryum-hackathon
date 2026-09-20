/**
 * DirectMintHandoffStore — la copia server-side de cada handoff `0xFE`.
 *
 * El memo del Payment XRPL solo publica keccak256(userOpData): si los bytes
 * completos se pierden, ningún executor puede ejecutar el mint y el XRP del
 * usuario queda aparcado en el Core Vault (lección de la tx 7BFCF65F…,
 * 2026-07-12). Este store persiste el handoff EXACTO en el prepare para que el
 * executor automático (DirectMintExecutorService) lo case por userOpHash y lo
 * ejecute sin reconstruir nada — cubre TODOS los flujos 0xFE (e1, e3, vaults,
 * supply-usdt0, pa-withdraw) porque todos pasan por buildDirectMintHandoff.
 *
 * Usa la tabla `background_jobs` existente (jobType '0xfe-handoff') — sin
 * migración. Los registros son material de payload, no una cola: el disparador
 * de ejecución es SIEMPRE el Payment firmado en Xaman (el usuario autoriza
 * firmando; un handoff preparado y nunca firmado se queda en 'queued' y es
 * inerte). Astryum no firma ni decide nada aquí (invariantes #1/#8).
 */

export interface HandoffRecord {
  userOpHash: string;
  userOpData: string;
  memoHex: string;
  xrplAddress: string;
  personalAccount: string;
  grossXrpDrops: string;
  supplyUBA: string;
  executorFeeUBA: string;
  walletId: number;
  /** Which prepare route built this dispatch ('e1', 'pa-repay', 'vault-withdraw:…').
   *  Label only (the admin unstick modal tags entrante/saliente with it) — rows
   *  older than 2026-07-26 don't carry it. */
  action?: string | null;
  /**
   * ISO del momento en que el CLIENTE reportó la firma en Xaman (2026-08-21,
   * incidente del gemelo con nonce 19). Sin esto, 'queued' significa a la vez
   * «borrador sin firmar» y «dinero comprometido en vuelo», y toda la seguridad
   * del asiento de nonce depende de la memoria del navegador: el TTL daba por
   * abandonada una orden FIRMADA cuando el executor iba lento, y el release del
   * re-prepare la liberaba tras un error de red post-broadcast. Un asiento con
   * `signedAt` no caduca por TTL, no se libera y no se supersede: espera a
   * ejecutar o a que el operador lo aparque.
   */
  signedAt?: string | null;
  /** XRPL tx hash que reportó el cliente al marcar la firma (trazabilidad). */
  signedTxHash?: string | null;
  /** Resultado VALIDADO del ledger cuando la marca vino de una lectura (tesSUCCESS o tec*). */
  signedLedgerResult?: string | null;
  /**
   * productizer-it15 §K1 — LA FÍSICA DEL LEDGER, NO UN RELOJ. Todo `0xFE` se
   * compone con `LastLedgerSequence` = ledger validado + ventana, y el registro
   * la guarda junto al ledger en que se compuso. Un borrador SIN firmar cuya LLS
   * sigue por delante NO caduca (el TTL de 5 min era más corto que la ventana de
   * la mesa, ~6-7 min: el asiento se declaraba libre mientras el Payment aún
   * podía entrar, y el gemelo se firmaba en el mismo nonce). Pasada la LLS, el
   * asiento solo se sustituye tras leer ENTERA la ventana [composedLedgerIndex,
   * lastLedgerSequence] de la cuenta sin ese memo. null = el ledger no se pudo
   * leer al componer (o fila anterior a it15): rige la regla antigua (TTL).
   */
  lastLedgerSequence?: number | null;
  composedLedgerIndex?: number | null;
  /**
   * productizer-it17 §L1 (contrato C3) — ISO en que el PAYLOAD de Xaman deja de
   * poder firmarse (`createdAt` + `HANDOFF_PAYLOAD_EXPIRY_MIN`, el mismo `expire`
   * en minutos que el frontend pone en el payload). Mientras no pase, liberar el
   * asiento es lo que CREA el gemelo: el usuario todavía puede firmar eso que
   * tiene en el móvil. Filas anteriores a it17 no lo llevan: se deduce de
   * `createdAt` (services/flare/handoffAuthority.ts).
   */
  payloadExpiresAt?: string | null;
  /**
   * productizer-it23 §Q1 1.3 — CUÁNTO VIVE EL PAYLOAD DE ESTA FILA, en minutos,
   * tal y como se declaró al componer. Una firma simple vive lo que diga
   * `HANDOFF_PAYLOAD_EXPIRY_MIN` (5 min); el 0xFE de una CEREMONIA multifirma
   * vive lo que viven sus payloads de Xaman (`expire: 1440`, 24 h), porque un
   * quórum firma a velocidad humana. Sin este número la fila se medía siempre
   * con la caducidad de una firma simple: a los seis minutos el asiento se daba
   * por libre y —peor— el `LastLedgerSequence` de aquel Payment quedaba atrás, de
   * modo que el quórum acababa firmando bytes que ya no pueden entrar y la salida
   * institucional multifirma no podía completarse (it22 Q1 1.3). Ausente en filas
   * anteriores a it23: rige la caducidad de una firma simple, como hasta ahora.
   */
  payloadExpiryMin?: number | null;
  /**
   * productizer-it15 §K1 — true si la sesión que preparó PROBÓ la cuenta XRPL
   * (`sessionMayActOnXrplAccount`). Un borrador preparado por quien NO prueba la
   * cuenta lo desplaza el dueño probado: nadie más que el dueño puede firmarlo y
   * el dueño no lo preparó. Nunca se deriva del body.
   */
  preparedByProven?: boolean;
  /**
   * productizer-it21 §P1 1.1/1.4 (contrato del agente E) — true si la tienda de
   * pruebas NO SE PUDO LEER cuando esta fila se compuso. `preparedByProven:
   * false` significaba dos cosas a la vez —«no prueba la cuenta» y «no pude
   * preguntar»— y la segunda dejaba la fila marcada como borrador de un extraño,
   * desplazable por cualquiera: un parpadeo de base de datos regalaba el asiento.
   * Con esta marca, la fila NO se aparta sola ni la desplaza un supersede ajeno.
   */
  preparedByProofUnreadable?: boolean;
  /**
   * productizer-it19 (contrato C1) — ESTA FILA LA COMPUSO EL PROPIO SERVIDOR de
   * Astryum para una cuenta operativa: el put-to-work de la mesa, el autopilot,
   * la alimentación de anchors. Esas filas NO llevan `preparedByProven` (no hay
   * sesión que pruebe nada: firma una semilla nuestra), y por eso el arreglo de
   * it17 las trataba como «borrador de un extraño» y el flujo servidor siguiente
   * las apartaba EN SILENCIO mientras el fundador aún podía firmarlas — dos
   * Payments firmables en el mismo nonce con el XRP del cliente ya en el Core
   * Vault (it18 R1 1.1). Una fila con esta marca no se desplaza jamás sola.
   */
  serverComposed?: boolean;
  /** Quién reportó la firma, y si esa sesión probaba la cuenta (jamás un extraño). */
  reportedByUserId?: string | null;
  reportedByProven?: boolean;
  /**
   * El Payment de este memo se validó con un resultado tec*: consumió el Sequence
   * XRPL pero NO entregó XRP al Core Vault, así que el mint no puede ejecutarse
   * jamás (FAssets `DirectMintingFacet._executeDirectMinting` →
   * `TransactionAttestation.verifyXRPPaymentSuccess`, que exige
   * `status == PAYMENT_SUCCESS`, y `receivedAmount > 0`). El asiento queda LIBRE.
   */
  ledgerFailedTxHash?: string | null;
  ledgerFailedResult?: string | null;
  ledgerFailedAt?: string | null;
  /**
   * productizer-it13 — the Astryum user id of the session that PREPARED this
   * handoff (null: no session, CLI, server job, or a row older than it13). It
   * lets that same user release or supersede their own unsigned draft; it is
   * never read by the execution path.
   */
  preparedByUserId?: string | null;
  /**
   * productizer-it13 §1.1 — a client REPORTED this Payment signed but the ledger
   * had not validated it yet (`POST /handoff/signed` answered PENDING_LEDGER).
   * A report grants nothing by itself (any session may send one): the seat guard
   * looks the hash up on a fresh node before deciding, and a young report keeps
   * the seat from being invalidated by TTL while the Payment may still validate.
   * `reportedTxHash` is the latest hash, `reportedTxHashes` every distinct one
   * (capped), `reportedAt` the time of the FIRST report — never refreshed, so a
   * repeated report cannot extend the protection window.
   */
  reportedTxHash?: string | null;
  reportedTxHashes?: string[] | null;
  reportedAt?: string | null;
  /**
   * productizer-it27 §4 — LA `Sequence` XRPL QUE EL COORDINADOR MULTIFIRMA FIJÓ
   * SOBRE ESTOS BYTES, y la hora en que lo hizo. La escribe SOLO el servidor,
   * desde `POST /xrpl-defi/multisign/prepare` (`stampCeremonyPin`); jamás sale de
   * un cuerpo de petición.
   *
   * PARA QUÉ EXISTE. `releaseAbandonedCeremonySeat` suelta el asiento de nonce de
   * un 0xFE ANTES de que su payload caduque, y todo su argumento de seguridad es
   * que esos bytes los pinó `prepareCouncilMultisig`: con la `Sequence` fijada,
   * dos Payments del mismo consejo llevan el MISMO número y como mucho uno puede
   * aplicar — el otro muere `tefPAST_SEQ` sin llegar al Core Vault, así que el
   * gemelo (dos Payments dentro, un userOp en `InvalidNonce` con el XRP ya
   * pagado) es imposible. Ese argumento NO vale para unos bytes que firma Xaman
   * autorrellenando la `Sequence`: ahí los dos Payments entran.
   *
   * Hasta it27 la puerta solo comprobaba que la ventana fuera larga y que la
   * cuenta coincidiera — dos cosas que una fila de ceremonia compuesta por
   * cualquier ruta cumple sin haber pasado nunca por el coordinador. Con esta
   * marca, la puerta exige la PRUEBA de que fueron pinados aquí.
   */
  ceremonyPinnedSequence?: number | null;
  ceremonyPinnedAt?: string | null;
  /**
   * productizer-it34 (E) — QUÉ SITTING PINÓ ESTOS BYTES LA ÚLTIMA VEZ. El id lo
   * genera el servidor en el mismo prepare que fija la Sequence (`/multisign/
   * prepare` → `randomUUID`; `POST /council-proposals` → el id de la propuesta) y
   * viaja de vuelta al cliente, que lo devuelve con su liberación.
   *
   * PARA QUÉ EXISTE. Dos sittings de la MISMA sesión sobre los MISMOS bytes
   * (Escape en `signing` → «sign again» → nuevo prepare) re-estampan el mismo
   * memo con la misma Sequence: sin este campo la liberación TARDÍA del primero
   * —fire-and-forget con `keepalive`— era indistinguible de la del segundo y
   * soltaba el asiento de nonce bajo una ceremonia viva. Con él, una liberación
   * cuyo id no es el del último pin es un no-op (`stale-sitting`).
   *
   * `null` en filas pinadas antes de este campo: no se puede comparar, y esas
   * filas caen a la regla anterior (como mucho, un día — la vida de la fila).
   */
  ceremonySittingId?: string | null;
}

const XRPL_TX_HASH_RE = /^[0-9A-F]{64}$/;
/** A queued row keeps at most this many distinct reported hashes. */
export const MAX_REPORTED_TX_HASHES = 8;

/**
 * Who is reporting a signature (productizer-it15 §K1). A report is only stored
 * for the Astryum user who PREPARED the handoff or a session that PROVED the
 * XRPL account — the route decides that, server-side, and hands the verdict
 * here. `proven` is what lets a real report displace an unproven one.
 */
export interface HandoffReportAuthority {
  userId?: string | null;
  proven?: boolean;
}

/** Pure: the distinct, well-formed tx hashes reported for a handoff (uppercase, report order). */
export function reportedTxHashesOf(rec: Pick<HandoffRecord, 'reportedTxHash' | 'reportedTxHashes'>): string[] {
  const out: string[] = [];
  const add = (h: unknown) => {
    if (typeof h !== 'string') return;
    const hash = h.trim().toUpperCase();
    if (XRPL_TX_HASH_RE.test(hash) && !out.includes(hash)) out.push(hash);
  };
  if (Array.isArray(rec.reportedTxHashes)) rec.reportedTxHashes.forEach(add);
  add(rec.reportedTxHash);
  return out.slice(0, MAX_REPORTED_TX_HASHES);
}

import { kvGet, kvUpsert, kvDelete, kvList, kvListStrict } from '../persistence/backgroundJobKv';
import {
  handoffPayloadExpiryMsOf,
  handoffPayloadExpiryMin,
  classifySeatSignability,
  clampStampedPayloadExpiry,
  defaultSeatWindowLedgers,
  rowPayloadExpiryMin,
  type SeatWindowState,
} from './handoffAuthority';

const JOB_TYPE = '0xfe-handoff';

async function getPrisma() {
  const { prisma } = await import('../../database/prismaClient');
  return prisma;
}

/**
 * Persiste el handoff (best-effort para el prepare — el usuario aún puede
 * firmar aunque la DB falle — pero NUNCA en silencio: sin esta fila el
 * executor automático no puede casar el memo y el mint queda pendiente).
 */
export async function saveHandoffRecord(record: HandoffRecord): Promise<boolean> {
  // Contextos sin DB (scripts CLI, tests) — el log [0xFE-handoff] del builder
  // sigue siendo la copia mínima; no hay executor automático que alimentar.
  if (!process.env.DATABASE_URL) return false;
  try {
    const prisma = await getPrisma();
    const existing = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['userOpHash'], equals: record.userOpHash } },
      select: { id: true },
    });
    if (existing) return true; // mismo hash ⇒ mismos bytes — idempotente
    await prisma.backgroundJob.create({
      data: {
        jobType: JOB_TYPE,
        status: 'queued', // queued = esperando que el usuario firme el Payment
        payload: { ...record },
      },
    });
    return true;
  } catch (e) {
    console.error(
      `[0xFE-handoff-store] persist FAILED for ${record.userOpHash}: ${(e as Error).message} — ` +
        'el executor automático no podrá casar este memo; queda solo el log [0xFE-handoff]',
    );
    // Al canal, no solo al log (2026-08-03): esta fila es la ÚNICA copia de los
    // bytes que el usuario está a punto de comprometer con su firma. Sin ella el
    // executor solo puede reconstruir las formas deterministas (firelight,
    // earnxrp, monarq, e3) — un e1 o un pa-withdraw se quedan pendientes hasta
    // un rescate manual. Enterarse AHORA (antes de que firme) o enterarse por el
    // usuario media hora después no es lo mismo.
    try {
      const { opsAlert } = await import('../OpsAlertService');
      await opsAlert(
        '0xFE-handoff',
        'critical',
        `no se pudieron guardar los bytes del handoff ${record.userOpHash} (${(e as Error).message}) — ` +
          'si el usuario firma, el executor puede no saber qué ejecutar',
        {
          key: `handoff-persist:${record.userOpHash}`,
          facts: { userOpHash: record.userOpHash, accion: record.action ?? null },
          runbook:
            'Mira primero la base de datos (probe «Base de datos» en /app/admin → Alertas): casi siempre es el pooler ' +
            'de Supabase. Los bytes siguen en los logs de Railway, en la línea [0xFE-handoff] de esta misma operación: ' +
            'con ellos el rescate es USER_OP_DATA=0x… npx ts-node src/scripts/execute-direct-mint.ts --live',
        },
      );
    } catch {
      /* el canal nunca puede empeorar el fallo que está reportando */
    }
    return false;
  }
}

/**
 * productizer-it19 §M1 1.4 — «NO PUDE LEER» NO ES «NO HAY NADA». La lectura de
 * los asientos devolvía `[]` ante un fallo de base de datos, indistinguible de
 * «esta cuenta no tiene ningún 0xFE pendiente»: el guard componía a ciegas y el
 * asiento del omnibus quedaba tomable durante toda su ventana (it18 R1 1.4). Un
 * fallo de lectura sale ahora como ESTE error, y quien lo recibe decide — nunca
 * compone como si el asiento estuviera libre.
 */
export class HandoffSeatStateUnreadableError extends Error {
  readonly code = 'SEAT_STATE_UNREADABLE';
  constructor(message: string) {
    super(message);
    this.name = 'HandoffSeatStateUnreadableError';
  }
}

/**
 * Handoffs aún pendientes de firma ('queued') de un Personal Account — la
 * materia prima del guard de asiento de nonce (incidente 2026-07-14/16).
 * Filtrado en JS por si el checksum difiere entre filas.
 *
 * Sin DB (scripts CLI, tests) → `[]`: ahí no hay filas que consultar y el guard
 * no aplica. Con DB pero ILEGIBLE → `HandoffSeatStateUnreadableError`: eso no es
 * «no hay asientos», y confundirlos es componer el gemelo.
 */
export async function findQueuedHandoffsByPersonalAccount(
  personalAccount: string,
): Promise<Array<HandoffRecord & { createdAt: Date }>> {
  if (!process.env.DATABASE_URL) return [];
  let rows: Array<{ payload: unknown; createdAt: Date }>;
  try {
    const prisma = await getPrisma();
    rows = (await prisma.backgroundJob.findMany({
      where: { jobType: JOB_TYPE, status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })) as unknown as Array<{ payload: unknown; createdAt: Date }>;
  } catch (e) {
    throw new HandoffSeatStateUnreadableError(
      `the 0xFE seats of ${personalAccount} could not be read: ${(e as Error)?.message ?? String(e)}`,
    );
  }
  const pa = personalAccount.toLowerCase();
  // createdAt viaja para el TTL del asiento de nonce: un handoff preparado y
  // nunca firmado caduca solo (buildDirectMintHandoff lo invalida) — el
  // usuario no queda tapiado por una orden que no llegó a firmar.
  return rows
    .map((r) => ({ ...(r.payload as unknown as HandoffRecord), createdAt: r.createdAt }))
    .filter((p) => (p.personalAccount || '').toLowerCase() === pa);
}

/** Un 0xFE FIRMADO y aún no ejecutado: lo que la mesa llama «en vuelo». */
export interface InFlightHandoff {
  memoHex: string;
  action: string | null;
  signedAt: string;
  signedTxHash: string | null;
}

/**
 * De entre las filas en cola, la orden FIRMADA de esta cuenta (y acción) que
 * sigue sin ejecutar — la más reciente si hay varias. Pura: el executor la
 * borra/mueve al ejecutar, así que «queued + signedAt» es exactamente «firmada
 * y en vuelo». Fundador 2026-09-15: «si el usuario ya ha firmado una vez, que
 * no pueda volver a hacerlo» — el prepare de la jaula pregunta aquí antes de
 * componer un segundo nacimiento.
 */
export function inFlightHandoffOf(
  rows: ReadonlyArray<Pick<HandoffRecord, 'xrplAddress' | 'action' | 'memoHex' | 'signedAt' | 'signedTxHash'>>,
  xrplAddress: string,
  action?: string,
): InFlightHandoff | null {
  const acct = xrplAddress.trim();
  let best: InFlightHandoff | null = null;
  for (const r of rows) {
    if ((r.xrplAddress || '').trim() !== acct) continue;
    if (action && (r.action ?? null) !== action) continue;
    if (typeof r.signedAt !== 'string' || !r.signedAt) continue;
    const cand = { memoHex: r.memoHex, action: r.action ?? null, signedAt: r.signedAt, signedTxHash: r.signedTxHash ?? null };
    if (!best || cand.signedAt > best.signedAt) best = cand;
  }
  return best;
}

/**
 * Lectura: la orden firmada en vuelo de una cuenta XRPL (y acción), o null.
 * Sin DB no hay registro que consultar (null, como el resto de guards).
 */
export async function findInFlightHandoffByXrplAddress(xrplAddress: string, action?: string): Promise<InFlightHandoff | null> {
  if (!process.env.DATABASE_URL) return null;
  const prisma = await getPrisma();
  const rows = (await prisma.backgroundJob.findMany({
    where: { jobType: JOB_TYPE, status: 'queued' },
    orderBy: { createdAt: 'asc' },
  })) as unknown as Array<{ payload: unknown }>;
  return inFlightHandoffOf(rows.map((r) => r.payload as HandoffRecord), xrplAddress, action);
}

/**
 * Marca el handoff como FIRMADO (el cliente lo reporta en cuanto Xaman
 * devuelve el hash). A partir de aquí el asiento de nonce es intocable: ni
 * TTL, ni release, ni supersede — solo ejecutar o aparcar. Idempotente;
 * best-effort (sin DB no hay guard que reforzar).
 */
export async function markHandoffSignedByMemo(
  memoHex: string,
  xrplTxHash: string,
  ledgerResult?: string | null,
): Promise<boolean> {
  if (!process.env.DATABASE_URL || !memoHex) return false;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { id: true, payload: true },
    });
    if (!row) return false;
    const payload = row.payload as Record<string, unknown>;
    if (typeof payload.signedAt === 'string') return true; // ya marcada
    // productizer-it15 §K1 — un tec* JAMÁS es «firmada» a efectos del asiento: la
    // tx entró en el ledger pero no entregó XRP, y el contrato de FAssets exige
    // `status == PAYMENT_SUCCESS` para ejecutar el direct minting. Marcarla
    // firmada tapiaba el nonce para siempre por algo que nunca podrá ejecutar.
    // El camino de esa fila es `markHandoffLedgerFailedByMemo` (libera).
    if (ledgerResult && /^tec/i.test(ledgerResult)) return false;
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: {
        payload: {
          ...payload,
          signedAt: new Date().toISOString(),
          signedTxHash: xrplTxHash || null,
          // productizer-it9: el resultado VALIDADO del ledger cuando lo hay
          // (tesSUCCESS o tec* — ambos consumen el asiento). Sin él, la marca
          // la puso el barrido del executor (que ya exige tesSUCCESS).
          ...(ledgerResult ? { signedLedgerResult: ledgerResult } : {}),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * productizer-it13 §1.1 — persist a client's «Xaman signed it» on the queued row
 * when the ledger has not validated the Payment yet. It marks NOTHING signed and
 * grants nothing: the seat guard (buildDirectMintHandoff) looks the hash up on a
 * fresh node before deciding. Until then a young report keeps a Payment that may
 * still validate from being invalidated by TTL — the executor being stopped or
 * slow must not turn a signed 0xFE into a superseded one (incidente 2026-08-21).
 *
 * `reportedAt` is set on the FIRST report only; later reports add their hash but
 * never extend the window. Rows already signed, unknown memos, malformed hashes
 * and a full hash list answer false. Best-effort (sin DB → false).
 */
export async function recordHandoffSignatureReport(
  memoHex: string,
  txHash: string,
  reporter?: HandoffReportAuthority,
): Promise<boolean> {
  const hash = typeof txHash === 'string' ? txHash.trim().toUpperCase() : '';
  if (!process.env.DATABASE_URL || !memoHex || !XRPL_TX_HASH_RE.test(hash)) return false;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { id: true, payload: true },
    });
    if (!row) return false;
    const payload = row.payload as Record<string, unknown>;
    if (typeof payload.signedAt === 'string' && payload.signedAt) return false;
    const prior = reportedTxHashesOf(payload as Pick<HandoffRecord, 'reportedTxHash' | 'reportedTxHashes'>);
    const priorProven = payload.reportedByProven === true;
    const proven = reporter?.proven === true;
    // productizer-it15 §K1 — EL INFORME REAL NUNCA SE QUEDA FUERA. Con el tope
    // «primero que llega», ocho informes falsos llenaban la lista y el aviso del
    // dueño se descartaba (it14 §1.2, el memo viaja en la vista pública). Ahora
    // la ruta solo acepta informes de quien preparó o prueba la cuenta, y uno de
    // una sesión que PRUEBA la cuenta sustituye a los que no la probaban.
    const supersedesUnproven = proven && !priorProven && prior.length > 0;
    if (!supersedesUnproven && prior.includes(hash)) return true;
    const hashes = supersedesUnproven
      ? [hash]
      : [...prior.filter((h) => h !== hash), hash].slice(-MAX_REPORTED_TX_HASHES);
    // La ventana arranca en el PRIMER informe y no se renueva (un informe repetido
    // no puede sostener un asiento para siempre). Solo el salto a una sesión que
    // prueba la cuenta la reinicia: es otra afirmación, de otra autoridad.
    const reportedAt =
      supersedesUnproven || typeof payload.reportedAt !== 'string' || !payload.reportedAt
        ? new Date().toISOString()
        : payload.reportedAt;
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: {
        payload: {
          ...payload,
          reportedTxHash: hash,
          reportedTxHashes: hashes,
          reportedAt,
          reportedByProven: proven || priorProven,
          reportedByUserId: proven
            ? (reporter?.userId ?? null)
            : ((typeof payload.reportedByUserId === 'string' ? payload.reportedByUserId : null) ?? reporter?.userId ?? null),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * productizer-it15 §K1 — EL Payment ENTRÓ EN EL LEDGER Y FALLÓ (tec*). Consumió
 * el Sequence XRPL, pero no entregó XRP al Core Vault: FAssets exige
 * `status == PAYMENT_SUCCESS` y `receivedAmount > 0` para ejecutar el direct
 * minting (`DirectMintingFacet._executeDirectMinting` →
 * `TransactionAttestation.verifyXRPPaymentSuccess`), y el propio barrido del
 * executor de Astryum ignora todo lo que no sea tesSUCCESS. Ese dispatch no
 * puede ejecutar JAMÁS, así que su asiento de nonce queda libre: la fila sale de
 * 'queued' (el guard deja de verla) SIN borrarse — por qué murió queda escrito.
 *
 * Una fila ya firmada con un resultado que NO es tec (o marcada por el barrido,
 * que solo ve tesSUCCESS) no se libera por esta vía: ahí hay dinero vivo.
 */
export async function markHandoffLedgerFailedByMemo(
  memoHex: string,
  xrplTxHash: string,
  ledgerResult: string,
): Promise<boolean> {
  if (!process.env.DATABASE_URL || !memoHex) return false;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { id: true, payload: true },
    });
    if (!row) return false;
    const payload = row.payload as Record<string, unknown>;
    const signedAt = typeof payload.signedAt === 'string' && payload.signedAt;
    const signedResult = typeof payload.signedLedgerResult === 'string' ? payload.signedLedgerResult : '';
    if (signedAt && !/^tec/i.test(signedResult)) return false;
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: {
        status: 'superseded',
        payload: {
          ...payload,
          ledgerFailedTxHash: (xrplTxHash || '').toUpperCase() || null,
          ledgerFailedResult: ledgerResult || null,
          ledgerFailedAt: new Date().toISOString(),
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * La fila 'queued' que comprometió este memo, o null (sin DB, sin fila, o la
 * lectura falló — «no pude leer» nunca se convierte en permiso). Las rutas
 * que actúan sobre un handoff por memo la leen PRIMERO para saber de quién es.
 */
/**
 * La fila 'queued' de un memo, o null.
 *
 * productizer-it21 §P1 1.2 — `null` SIGNIFICABA DOS COSAS. Un fallo de BD se leía
 * como «no hay ninguna fila con ese memo», y las tres rutas que preguntan por
 * aquí (`/handoff/release`, `/handoff/signed`, `/handoff/payload-opened`)
 * contestaban 200 «no había nada que liberar / nada que sellar»: la pantalla
 * ofrecía preparar otra vez y se componía a ciegas sobre un asiento que podía
 * estar ocupado — el gemelo, por la misma puerta que la it. 19 cerró en el
 * release. Con `strict: true` un fallo de lectura LANZA
 * `HandoffSeatStateUnreadableError` y quien pregunta contesta 503; sin él, el
 * comportamiento tolerante de siempre (llamadores que solo enriquecen una vista).
 */
export async function findQueuedHandoffByMemo(
  memoHex: string,
  opts?: { strict?: boolean },
): Promise<(HandoffRecord & { createdAt: Date }) | null> {
  if (!process.env.DATABASE_URL || !memoHex) return null;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { payload: true, createdAt: true },
    });
    return row ? { ...(row.payload as unknown as HandoffRecord), createdAt: row.createdAt } : null;
  } catch (e) {
    if (opts?.strict === true) {
      throw new HandoffSeatStateUnreadableError(
        `the 0xFE queued under memo ${memoHex} could not be read: ${(e as Error)?.message ?? String(e)}`,
      );
    }
    return null;
  }
}

/** Normaliza un memo hex para comparar: sin 0x, en mayúsculas (account_tx lo da así). */
function normMemo(hex: unknown): string {
  return typeof hex === 'string' ? hex.trim().replace(/^0x/i, '').toUpperCase() : '';
}

export type HandoffLedgerVerdict =
  /** Validado en el ledger, del dueño del handoff y con SU memo: el asiento está consumido. */
  | { state: 'validated'; result: string }
  /**
   * Aún no validado, no encontrado o ningún nodo fresco respondió: NO se marca nada.
   * `unreadable: true` = the ledger could not be read (no fresh node, transport
   * error, an answer we do not understand) — as opposed to a node that answered
   * «not validated yet» or `txnNotFound`. The seat guard never invalidates a seat
   * on «could not read».
   */
  | { state: 'pending'; detail: string; unreadable?: boolean }
  /** Validado pero NO es el Payment de este handoff (otra cuenta, otro memo, otro tipo). */
  | { state: 'mismatch'; detail: string };

/**
 * productizer-it9 — LA FIRMA SE LEE DEL LEDGER, JAMÁS DE LA PALABRA DEL CLIENTE.
 *
 * `POST /handoff/signed` marcaba `signedAt` con lo que el navegador dijera: una
 * sesión cualquiera podía declarar firmado el handoff de otra cuenta, dejando su
 * asiento de nonce tomado para siempre (NONCE_SEAT_TAKEN_SIGNED) y bloqueando las
 * reservas del exchange demo. Ahora el aviso solo ACELERA una verdad que el
 * ledger ya dice: la tx tiene que estar VALIDADA en un nodo fresco
 * (`requireFresh` — un rippled congelado miente por omisión), ser un Payment,
 * salir de la cuenta XRPL del handoff y llevar su memo. tesSUCCESS y tec* valen
 * igual: los dos consumen el Sequence (y por tanto el asiento). Si no se puede
 * confirmar, `pending` — y el barrido del executor la marcará cuando la vea.
 */
export async function verifyHandoffPaymentOnLedger(
  record: Pick<HandoffRecord, 'xrplAddress' | 'memoHex'>,
  txHash: string,
): Promise<HandoffLedgerVerdict> {
  let r: Record<string, unknown>;
  try {
    const { xrplJsonRpc } = await import('./DirectMintExecutorService');
    r = (await xrplJsonRpc('tx', { transaction: txHash, binary: false }, undefined, {
      requireFresh: true,
    })) as unknown as Record<string, unknown>;
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    // xrplJsonRpc throws the LAST endpoint's error: only an explicit txnNotFound
    // is a node that answered. Anything else (stale nodes, 402/429/5xx, network)
    // is «could not read» — the conservative reading for the seat guard.
    return /txnNotFound/i.test(message)
      ? { state: 'pending', detail: `ledger read: ${message}` }
      : { state: 'pending', detail: `ledger read: ${message}`, unreadable: true };
  }
  if (r.validated !== true) return { state: 'pending', detail: 'transaction not validated yet' };
  const tx = ((r.tx_json as Record<string, unknown> | undefined) ?? r) as Record<string, unknown>;
  const result = String((r.meta as { TransactionResult?: unknown } | undefined)?.TransactionResult ?? '');
  if (!/^(tes|tec)/.test(result)) {
    // Un validado siempre es tes/tec; cualquier otra cosa es una respuesta que no entendemos.
    return { state: 'pending', detail: `unexpected validated result: ${result || 'none'}`, unreadable: true };
  }
  if (tx.TransactionType !== 'Payment') {
    return { state: 'mismatch', detail: `transaction is ${String(tx.TransactionType)}, not a Payment` };
  }
  if (tx.Account !== record.xrplAddress) {
    return { state: 'mismatch', detail: 'transaction was not sent by the account this handoff belongs to' };
  }
  const want = normMemo(record.memoHex);
  const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string } }> | undefined) ?? [];
  if (!want || !memos.some((m) => normMemo(m?.Memo?.MemoData) === want)) {
    return { state: 'mismatch', detail: 'transaction does not carry this handoff memo' };
  }
  return { state: 'validated', result };
}

/** Un índice de ledger servido por un nodo: entero positivo, o null. */
function servedLedgerIndex(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Tope de espera de la lectura del ledger validado: el prepare no se cuelga tras un nodo caído. */
const VALIDATED_LEDGER_READ_TIMEOUT_MS = 12_000;

/**
 * productizer-it15 §K1 — el índice del ledger VALIDADO ahora mismo, leído en un
 * nodo fresco. Es lo que estampa el `LastLedgerSequence` de cada 0xFE y lo que
 * decide después si esa ventana ya pasó. null = no se pudo leer: el dispatch se
 * compone SIN LastLedgerSequence (la regla antigua del TTL rige esa fila) y
 * ningún asiento se retira por «no pude leer».
 */
export async function readValidatedLedgerIndex(): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const { xrplJsonRpc } = await import('./DirectMintExecutorService');
    const read = xrplJsonRpc('ledger', { ledger_index: 'validated' }, undefined, { requireFresh: true });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('xrpl_validated_ledger_read_timeout')), VALIDATED_LEDGER_READ_TIMEOUT_MS);
    });
    const result = (await Promise.race([read, timeout])) as Record<string, unknown>;
    return servedLedgerIndex(
      (result as { ledger_index?: unknown }).ledger_index ??
        (result as { ledger?: { ledger_index?: unknown } }).ledger?.ledger_index,
    );
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * productizer-it23 §Q1 1.3 — ¿FIRMA ESTA CUENTA XRPL POR QUÓRUM?
 *
 * Una cuenta con SignerList no la firma nadie en cinco minutos: sus payloads
 * viven 24 h porque hay que juntar firmas de varias personas. Si el servidor
 * compone su 0xFE con la ventana de una firma simple, el quórum acaba firmando
 * bytes que ya no pueden entrar en el ledger — y ese es el motivo por el que una
 * salida institucional multifirma no podía completarse.
 *
 *   'quorum'  — la cuenta tiene SignerList (firma un consejo);
 *   'single'  — se leyó y no la tiene;
 *   'unknown' — no se pudo leer. NUNCA se lee como 'quorum': estirar a 24 h el
 *               asiento de una cuenta normal por un fallo de lectura sería tapiar
 *               su nonce un día entero. Un «no pude leer» deja el comportamiento
 *               de siempre y se queja en el log.
 *
 * Se consulta SOLO cuando quien compone no declaró la vida de su payload y
 * `HANDOFF_QUORUM_AUTODETECT=true` (por defecto apagado: la vía primaria es que
 * la ruta que compone para un consejo declare `payloadExpiryMin`, sin lectura
 * ninguna). Cachea el último veredicto BUENO por cuenta y jamás cachea el fallo
 * (lección de `knownPlatformPotes`, it22).
 */
export type XrplSignerQuorumState = 'quorum' | 'single' | 'unknown';

/** Cuánto vale un veredicto bueno antes de volver a preguntar. */
const SIGNER_QUORUM_TTL_MS = 5 * 60_000;
/** Tope de espera: componer no se cuelga porque un nodo no conteste. */
const SIGNER_QUORUM_READ_TIMEOUT_MS = 6_000;
const signerQuorumCache = new Map<string, { state: 'quorum' | 'single'; atMs: number }>();

/** Tests: olvida lo leído. */
export function __resetSignerQuorumCache(): void {
  signerQuorumCache.clear();
}

export async function readXrplSignerQuorum(
  address: string,
  opts?: { nowMs?: number; rpc?: HandoffWindowRpc },
): Promise<XrplSignerQuorumState> {
  const account = typeof address === 'string' ? address.trim() : '';
  if (!account) return 'unknown';
  const nowMs = opts?.nowMs ?? Date.now();
  const cached = signerQuorumCache.get(account);
  if (cached && nowMs - cached.atMs < SIGNER_QUORUM_TTL_MS) return cached.state;
  let timer: NodeJS.Timeout | undefined;
  try {
    const rpc = opts?.rpc ?? (await import('./DirectMintExecutorService')).xrplJsonRpc;
    const read = rpc('account_info', { account, ledger_index: 'validated', signer_lists: true }, undefined, {
      requireFresh: true,
    }) as Promise<Record<string, unknown>>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('xrpl_signer_list_read_timeout')), SIGNER_QUORUM_READ_TIMEOUT_MS);
    });
    const result = (await Promise.race([read, timeout])) as {
      account_data?: { signer_lists?: unknown[] };
      signer_lists?: unknown[];
    };
    const lists = Array.isArray(result?.account_data?.signer_lists)
      ? (result.account_data?.signer_lists as unknown[])
      : Array.isArray(result?.signer_lists)
        ? (result.signer_lists as unknown[])
        : null;
    if (lists === null) return 'unknown'; // el nodo contestó algo que no sabemos leer
    const state: 'quorum' | 'single' = lists.length > 0 ? 'quorum' : 'single';
    signerQuorumCache.set(account, { state, atMs: nowMs });
    return state;
  } catch (e) {
    console.warn(`[0xFE-handoff] signer-list read failed for ${account}: ${(e as Error)?.message ?? String(e)}`);
    return 'unknown'; // jamás se cachea un fallo, y jamás se lee como 'quorum'
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * it. 33 (cierre, B1) — LAS ENTRADAS del SignerList, no solo su estado.
 *
 * `readXrplSignerQuorum` answers 'quorum' | 'single' | 'unknown' — enough to
 * size a window, not enough to say WHO may speak for the account. The report
 * door (`POST /handoff/signed`) needs the second thing: in the asynchronous
 * tempo the member who broadcasts the combined blob is rarely the session that
 * prepared the 0xFE, and proves their OWN address, not the council's — so the
 * report arrived and was never stored, and a later withdraw of the proposal
 * could free the seat with the Payment in flight. Same read, same 5-min cache
 * discipline, and the same honesty: a failed read is 'unknown', never [].
 */
export type XrplSignerEntriesRead = { state: 'read'; accounts: string[] } | { state: 'unknown' };

const signerEntriesCache = new Map<string, { accounts: string[]; atMs: number }>();

export async function readXrplSignerEntries(
  address: string,
  opts?: { nowMs?: number; rpc?: HandoffWindowRpc },
): Promise<XrplSignerEntriesRead> {
  const account = typeof address === 'string' ? address.trim() : '';
  if (!account) return { state: 'unknown' };
  const nowMs = opts?.nowMs ?? Date.now();
  const cached = signerEntriesCache.get(account);
  if (cached && nowMs - cached.atMs < SIGNER_QUORUM_TTL_MS) return { state: 'read', accounts: cached.accounts };
  let timer: NodeJS.Timeout | undefined;
  try {
    const rpc = opts?.rpc ?? (await import('./DirectMintExecutorService')).xrplJsonRpc;
    const read = rpc('account_info', { account, ledger_index: 'validated', signer_lists: true }, undefined, {
      requireFresh: true,
    }) as Promise<Record<string, unknown>>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('xrpl_signer_list_read_timeout')), SIGNER_QUORUM_READ_TIMEOUT_MS);
    });
    const result = (await Promise.race([read, timeout])) as {
      account_data?: { signer_lists?: unknown[] };
      signer_lists?: unknown[];
    };
    const lists = Array.isArray(result?.account_data?.signer_lists)
      ? (result.account_data?.signer_lists as unknown[])
      : Array.isArray(result?.signer_lists)
        ? (result.signer_lists as unknown[])
        : null;
    if (lists === null) return { state: 'unknown' };
    const accounts: string[] = [];
    for (const list of lists) {
      const entries = (list as { SignerEntries?: unknown[] } | null)?.SignerEntries;
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        const acct = (e as { SignerEntry?: { Account?: unknown } } | null)?.SignerEntry?.Account;
        if (typeof acct === 'string' && acct.length > 0) accounts.push(acct);
      }
    }
    signerEntriesCache.set(account, { accounts, atMs: nowMs });
    return { state: 'read', accounts };
  } catch (e) {
    console.warn(`[0xFE-handoff] signer-entries read failed for ${account}: ${(e as Error)?.message ?? String(e)}`);
    return { state: 'unknown' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tests: olvida las entradas leídas. */
export function __resetSignerEntriesCache(): void {
  signerEntriesCache.clear();
}

/**
 * Lo que una lectura COMPLETA de la ventana de la cuenta dice de este memo
 * (productizer-it15 §K1):
 *   'signed'     — hay un Payment tesSUCCESS suyo con ese memo: el asiento está
 *                  consumido, pase lo que pase con el reloj;
 *   'failed'     — solo hay un Payment tec*: entró y falló, no entregó XRP y el
 *                  direct minting no puede ejecutarlo → asiento LIBRE;
 *   'absent'     — la ventana entera se leyó (marcador agotado, rango servido
 *                  completo, nodo fresco) y ese memo NO está;
 *   'unreadable' — no se pudo leer entera. JAMÁS se convierte en 'absent'.
 */
export type HandoffWindowVerdict =
  | { state: 'signed'; txHash: string; ledgerResult: string }
  | { state: 'failed'; txHash: string; ledgerResult: string }
  | { state: 'absent'; rowsRead: number }
  | { state: 'unreadable'; detail: string };

/** Páginas máximas de la ventana de un handoff (200 txs cada una). */
const HANDOFF_WINDOW_MAX_PAGES = 20;

/**
 * productizer-it17 §1.3 — cuántos nodos distintos se intentan antes de declarar
 * una ventana ilegible. Un nodo con historia corta (o que responde 429) no puede
 * tapiar un asiento para siempre: se vuelve a preguntar empezando por otro.
 */
const HANDOFF_WINDOW_MAX_ENDPOINTS = 4;

/** La llamada JSON-RPC con la que se lee una ventana (inyectable: los tests fingen el nodo). */
type HandoffWindowRpc = (
  method: string,
  params: Record<string, unknown>,
  preferred?: string,
  opts?: { requireFresh?: boolean },
) => Promise<Record<string, unknown>>;

/**
 * ¿Entró en el ledger el Payment de ESTE memo dentro de [ledgerIndexMin,
 * ledgerIndexMax]? La única lectura con la que se puede concluir que un 0xFE
 * firmado NO existe — y por tanto que su asiento de nonce puede reutilizarse.
 *
 * Exige las tres cosas que separan «no está» de «no lo vi»: nodo fresco
 * (`requireFresh`: un rippled atascado miente por omisión), el rango que el
 * nodo dice haber buscado cubre el pedido (sin historia completa → unreadable)
 * y el marcador agotado (una página cortada nunca es una ausencia).
 *
 * productizer-it17 §1.3 — Y ROTA DE NODO, como `xrplJsonRpc`. `xrplJsonRpc` solo
 * rota ante un error de transporte o un `status:'error'`; un nodo que responde
 * BIEN con una historia corta (o que devuelve 429 en la página 2) daba
 * `unreadable`, y `unreadable` no libera jamás un asiento: la salida del usuario
 * quedaba tapiada por la caída de UN servidor (it16 R1 1.3). Ahora la lectura se
 * reintenta anclada en cada endpoint de la lista hasta que uno conteste algo
 * concluyente. Solo la última respuesta ilegible se devuelve, con su motivo.
 */
export async function readHandoffMemoWindow(
  record: Pick<HandoffRecord, 'xrplAddress' | 'memoHex'>,
  window: { ledgerIndexMin: number; ledgerIndexMax: number },
  opts?: { rpc?: HandoffWindowRpc; endpoints?: string[] },
): Promise<HandoffWindowVerdict> {
  const want = normMemo(record.memoHex);
  const account = typeof record.xrplAddress === 'string' ? record.xrplAddress.trim() : '';
  const { ledgerIndexMin: min, ledgerIndexMax: max } = window;
  if (!want || !account) {
    return { state: 'unreadable', detail: 'the handoff carries no memo or no account to look for' };
  }
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    return { state: 'unreadable', detail: `ledger window [${min}, ${max}] is not a window` };
  }
  const executor = await import('./DirectMintExecutorService');
  const rpc: HandoffWindowRpc =
    opts?.rpc ?? ((method, params, preferred, o) => executor.xrplJsonRpc(method, params, preferred, o) as Promise<Record<string, unknown>>);
  // El primer intento va SIN endpoint preferido (la rotación propia de
  // xrplJsonRpc); los siguientes anclan uno distinto cada vez. Una build que no
  // pueda enumerar endpoints (o un test que finge el transporte) hace un intento.
  let endpoints: string[] = [];
  try {
    endpoints = opts?.endpoints ?? (typeof executor.xrplHttpEndpoints === 'function' ? executor.xrplHttpEndpoints() : []);
  } catch {
    endpoints = [];
  }
  const attempts: Array<string | undefined> = [undefined, ...endpoints.slice(0, HANDOFF_WINDOW_MAX_ENDPOINTS - 1)];
  let last: HandoffWindowVerdict = { state: 'unreadable', detail: 'no XRPL node answered this window' };
  for (const preferred of attempts) {
    const verdict = await readHandoffMemoWindowOn(rpc, preferred, { account, want, min, max });
    if (verdict.state !== 'unreadable') return verdict;
    last = verdict;
  }
  return attempts.length > 1
    ? { state: 'unreadable', detail: `${last.state === 'unreadable' ? last.detail : ''} (${attempts.length} XRPL endpoints tried)` }
    : last;
}

/** Una pasada completa de la ventana contra UN transporte. Ver `readHandoffMemoWindow`. */
async function readHandoffMemoWindowOn(
  rpc: HandoffWindowRpc,
  preferred: string | undefined,
  q: { account: string; want: string; min: number; max: number },
): Promise<HandoffWindowVerdict> {
  const { account, want, min, max } = q;
  let failed: { txHash: string; ledgerResult: string } | null = null;
  let rowsRead = 0;
  try {
    const xrplJsonRpc = rpc;
    let marker: unknown;
    for (let page = 0; page < HANDOFF_WINDOW_MAX_PAGES; page++) {
      const params: Record<string, unknown> = {
        account,
        ledger_index_min: min,
        ledger_index_max: max,
        limit: 200,
        forward: true,
      };
      if (marker !== undefined) params.marker = marker;
      const result = (await xrplJsonRpc('account_tx', params, preferred, { requireFresh: true })) as Record<string, unknown>;
      const servedMin = servedLedgerIndex(result.ledger_index_min);
      const servedMax = servedLedgerIndex(result.ledger_index_max);
      if (servedMin === null || servedMax === null) {
        return {
          state: 'unreadable',
          detail: `the node did not state the ledger range it searched (min=${String(result.ledger_index_min)}, max=${String(result.ledger_index_max)})`,
        };
      }
      if (servedMin > min || servedMax < max) {
        return { state: 'unreadable', detail: `the node searched ledgers [${servedMin}, ${servedMax}], asked [${min}, ${max}]` };
      }
      const entries = (result.transactions as Array<Record<string, unknown>> | undefined) ?? [];
      for (const entry of entries) {
        rowsRead++;
        if (entry.validated === false) continue;
        const tx = (entry.tx_json ?? entry.tx) as Record<string, unknown> | undefined;
        if (!tx || tx.TransactionType !== 'Payment' || tx.Account !== account) continue;
        const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string } }> | undefined) ?? [];
        if (!memos.some((m) => normMemo(m?.Memo?.MemoData) === want)) continue;
        const txHash = String(entry.hash ?? tx.hash ?? '').toUpperCase();
        const meta = (entry.meta ?? entry.metaData) as { TransactionResult?: unknown } | undefined;
        const ledgerResult = String(meta?.TransactionResult ?? '');
        if (/^tes/.test(ledgerResult)) return { state: 'signed', txHash, ledgerResult };
        if (/^tec/.test(ledgerResult)) {
          failed = { txHash, ledgerResult };
          continue; // sigue leyendo: un tesSUCCESS posterior con el mismo memo mandaría
        }
        return {
          state: 'unreadable',
          detail: `a Payment with this memo carries a result we do not understand: ${ledgerResult || 'none'}`,
        };
      }
      marker = result.marker;
      if (marker === undefined || marker === null || marker === '') {
        return failed ? { state: 'failed', ...failed } : { state: 'absent', rowsRead };
      }
    }
    return {
      state: 'unreadable',
      detail: `more than ${HANDOFF_WINDOW_MAX_PAGES} pages of history in ledgers [${min}, ${max}] without an answer`,
    };
  } catch (e) {
    return { state: 'unreadable', detail: `ledger read: ${(e as Error)?.message ?? String(e)}` };
  }
}

/**
 * Por qué NO se libera un asiento, o por qué sí (productizer-it17 §L1). Un solo
 * objeto (no una unión discriminada): este backend compila con `strict:false`,
 * donde una unión por booleano no estrecha y cada lector acabaría casteando.
 */
export interface HandoffReleaseVerdict {
  /** true = ese payload ya no puede firmarse (o nunca tuvo ventana): soltar es seguro. */
  release: boolean;
  /** Por qué se suelta, cuando se suelta. */
  reason?: 'no-window' | 'payload-expired' | 'window-passed' | 'ledger-failed' | 'window-long-past' | 'ceremony-ended';
  /**
   * Por qué NO se suelta — el código que la ruta devuelve.
   *
   * productizer-it21 §P1 1.2 (contrato C1) — `SEAT_STATE_UNREADABLE` NO es un
   * «no había nada que liberar»: es «no pude mirar». La ruta lo contesta **503**
   * (nunca 200, nunca 409): un 200 lo lee la pantalla como asiento vacío y
   * ofrece preparar otro, que es exactamente cómo se compone el gemelo.
   */
  code?:
    | 'NONCE_SEAT_TAKEN_SIGNED'
    | 'NONCE_SEAT_TAKEN_REPORTED'
    | 'WAIT_FOR_PAYLOAD_EXPIRY'
    | 'NONCE_SEAT_UNREADABLE'
    | 'SEAT_STATE_UNREADABLE';
  /** true = volver a intentarlo más tarde puede funcionar (la espera termina sola). */
  retryable?: boolean;
  secondsLeft?: number;
  lastLedgerSequence?: number;
  /**
   * productizer-it19 §M1 1.3 — true = falta LEER la ventana del memo para
   * decidir. El reloj solo no suelta nada mientras la ventana sea legible: un
   * Payment firmado al minuto 4 y validado al 5:02 existe aunque el payload haya
   * caducado, y soltar su asiento es exactamente el gemelo (it18 R1 1.3).
   */
  needsWindow?: boolean;
  /** Frase para el usuario, en inglés como toda la superficie. */
  detail?: string;
}

/**
 * productizer-it17 §L1 (it16 R1 1.1) — ¿PUEDE LIBERARSE ESTE ASIENTO? Puro.
 *
 * LIBERAR UN ASIENTO MIENTRAS SU PAYLOAD TODAVÍA PUEDE FIRMARSE ES LO QUE CREA
 * EL GEMELO. `/handoff/release` miraba `signedAt` e informes y nunca la ventana:
 * el preparador cancelaba, la fila pasaba a 'superseded', el prepare siguiente
 * componía otro userOp en el MISMO nonce… y el payload viejo seguía vivo en
 * Xaman. Quien firmara los dos condenaba uno de ellos a morir InvalidNonce con
 * su carrier dentro. Un «cancelé» del navegador no borra nada del móvil.
 *
 * Una fila solo se suelta cuando ya no puede firmarse, o cuando nunca fue
 * firmable con ventana:
 *   (a) la caducidad del payload de Xaman pasó y nadie reportó ni marcó firma;
 *   (b) el ledger validado ya pasó su `LastLedgerSequence` (ni firmado entraría);
 *   (c) la fila no lleva ventana (anterior a it15, o ledger ilegible al componer)
 *       — rige la regla de siempre: sin firma se suelta.
 * En cualquier otro caso, espera — y dice cuántos segundos.
 */
export function classifyHandoffRelease(
  row: Pick<
    HandoffRecord,
    | 'signedAt'
    | 'lastLedgerSequence'
    | 'composedLedgerIndex'
    | 'payloadExpiresAt'
    // it23 §Q1 1.3 — la vida declarada del payload viaja hasta el predicado: sin
    // ella una ceremonia de 24 h se soltaba con la caducidad de una firma simple.
    | 'payloadExpiryMin'
    | 'reportedTxHash'
    | 'reportedTxHashes'
  > & {
    createdAt?: Date | string | null;
  },
  ctx: {
    nowMs: number;
    validatedLedgerIndex: number | null;
    reportBlocks?: boolean;
    /** Lo que dijo `readHandoffMemoWindow`, cuando ya se leyó (it19 §M1 1.3). */
    windowState?: SeatWindowState | null;
    /**
     * it25 §4 — el TITULAR terminó la ceremonia que iba a firmar esta fila
     * (`releaseAbandonedCeremonySeat`). Sustituye el reloj del payload, jamás la
     * lectura de la ventana: ver `classifySeatSignability`.
     */
    holderEndedCeremony?: boolean;
  },
): HandoffReleaseVerdict {
  // productizer-it19 §M1 1.2 — UN SOLO PREDICADO. Esta puerta, el supersede del
  // mismo preparador y el desplazamiento automático del builder preguntan lo
  // mismo a `classifySeatSignability`, para que no puedan volver a discrepar.
  const seat = classifySeatSignability(row, {
    nowMs: ctx.nowMs,
    validatedLedgerIndex: ctx.validatedLedgerIndex,
    // Quién gatea y quién solo frena: la ruta dice si ese informe CUENTA
    // (`reportBlocks`: lo firmó quien preparó o quien prueba la cuenta); un
    // informe cualquiera no cierra la salida de nadie, pero impide que el RELOJ
    // suelte el asiento. Es la regla de it17, dividida en sus dos mitades.
    reported: ctx.reportBlocks === true,
    reportedUnverified: reportedTxHashesOf(row).length > 0,
    windowState: ctx.windowState ?? null,
    holderEndedCeremony: ctx.holderEndedCeremony === true,
  });
  if (seat.unsignable) return { release: true, reason: seat.reason as HandoffReleaseVerdict['reason'] };
  if (seat.reason === 'signed') {
    return {
      release: false,
      code: 'NONCE_SEAT_TAKEN_SIGNED',
      retryable: false,
      detail:
        'That order is already signed and waiting to execute: freeing its seat now would let a twin be signed on the same ' +
        'nonce, and one of the two would die InvalidNonce. It clears when it executes — or when an operator parks it.',
    };
  }
  if (seat.reason === 'reported') {
    return {
      release: false,
      code: 'NONCE_SEAT_TAKEN_REPORTED',
      retryable: false,
      detail:
        'A signature was reported for that order and the ledger has not validated it yet. Until it does, freeing the seat ' +
        'could produce a doomed twin. If that Payment never lands, the seat frees itself.',
    };
  }
  if (seat.reason === 'window-unreadable') {
    return {
      release: false,
      code: 'NONCE_SEAT_UNREADABLE',
      retryable: true,
      needsWindow: seat.needsWindow,
      lastLedgerSequence: seat.lastLedgerSequence,
      detail:
        'That payload can no longer be signed, but no XRPL node could confirm whether its Payment already landed. Freeing ' +
        'the seat without knowing could put a second order on the same nonce, so it waits: try again in a minute.',
    };
  }
  // `payload-live` y `reported-unverified` comparten puerta (mismo código, misma
  // espera que termina sola)…
  //
  // productizer it. 33 (B1) — …PERO NO LA MISMA FRASE. En `reported-unverified`
  // el payload YA NO puede firmarse (el titular terminó la ceremonia, o el reloj
  // pasó) y lo que retiene el asiento es un INFORME de firma que el ledger aún no
  // ha validado: el hash que el navegador emisor mandó a `/handoff/signed` en
  // cuanto el nodo lo devolvió. La frase de abajo decía aquí «still signable in
  // Xaman… stops being signable in about 0 s»: falsa en las dos mitades, y es
  // justo la que lee el proponente que retira una propuesta que otro miembro
  // acaba de emitir. Se dice lo que retiene y quién decide (el ledger).
  if (seat.reason === 'reported-unverified') {
    return {
      release: false,
      code: 'WAIT_FOR_PAYLOAD_EXPIRY',
      retryable: true,
      secondsLeft: seat.secondsLeft,
      lastLedgerSequence: seat.lastLedgerSequence,
      detail:
        'A signature was reported for that dispatch and the ledger has not validated it yet, so its nonce seat stays ' +
        'taken: freeing it now and preparing another would put two orders on the same nonce, and if that Payment lands ' +
        'one of them dies InvalidNonce with its XRP already paid. The ledger decides — it either shows that Payment ' +
        `or closes its window without it, no later than ledger ${seat.lastLedgerSequence}. Check the account on an ` +
        'explorer, and try again then.',
    };
  }
  const secondsLeft = seat.secondsLeft;
  return {
    release: false,
    code: 'WAIT_FOR_PAYLOAD_EXPIRY',
    retryable: true,
    secondsLeft,
    lastLedgerSequence: seat.lastLedgerSequence,
    detail:
      'That dispatch is still signable in Xaman, so its nonce seat cannot be freed yet: releasing it now and preparing ' +
      'another would put two orders on the same nonce, and whichever is signed second dies InvalidNonce with its XRP ' +
      `already paid.${secondsLeft !== undefined ? ` The payload stops being signable in about ${secondsLeft} s` : ' The payload stops being signable shortly'}` +
      `, and the seat frees itself no later than ledger ${seat.lastLedgerSequence}. Sign it, let it expire, or try again then.`,
  };
}

/**
 * Libera el asiento de un handoff 0xFE preparado y NO firmado (el usuario
 * canceló o cerró sin firmar) → lo marca 'superseded', SIN esperar al TTL pero
 * NUNCA antes de que su payload deje de poder firmarse (`classifyHandoffRelease`,
 * it17 §L1). Solo toca filas 'queued' sin `signedAt`: liberar el asiento de una
 * orden firmada fue exactamente el agujero del gemelo con nonce 19 (2026-08-21)
 * — el cliente creía tener un borrador porque erró DESPUÉS de que Xaman
 * emitiera, lo liberó, y el prepare siguiente firmó un duplicado condenado.
 *
 * `opts.neverHandedOut` es la ÚNICA excepción, y no la decide el usuario: la
 * pide el flujo servidor cuyo 0xFE firma Astryum con su propia semilla (la mesa
 * del exchange, el autopilot) cuando ese dispatch no llegó a salir de aquí — sin
 * payload en ningún móvil no hay gemelo posible, y esperar seis minutos sería
 * tapiar el nonce del omnibus por nada.
 */
export async function releaseQueuedHandoffDetailed(
  memoHex: string,
  opts?: {
    reportBlocks?: boolean;
    neverHandedOut?: boolean;
    nowMs?: number;
    validatedLedgerIndex?: number | null;
    readValidatedLedgerIndex?: () => Promise<number | null>;
    /** Inyectable para los tests: la lectura de la ventana del memo (it19 §M1 1.3). */
    readWindow?: typeof readHandoffMemoWindow;
    /**
     * it25 §4 — lo pone SOLO `releaseAbandonedCeremonySeat`, que comprueba antes
     * que la fila es de una ceremonia y que quien pide es el titular de esa
     * cuenta. Jamás sale de un cuerpo de petición.
     */
    holderEndedCeremony?: boolean;
  },
): Promise<{ released: boolean; verdict?: HandoffReleaseVerdict }> {
  if (!process.env.DATABASE_URL || !memoHex) return { released: false };
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { id: true, payload: true, createdAt: true },
    });
    if (!row) return { released: false };
    const payload = row.payload as unknown as HandoffRecord;
    if (typeof payload.signedAt === 'string') return { released: false };
    let verdict: HandoffReleaseVerdict = { release: true, reason: 'no-window' };
    if (opts?.neverHandedOut !== true) {
      // El ledger validado solo se lee cuando la fila tiene ventana y su payload
      // sigue vivo: una fila sin ventana (o ya caducada) no gasta una lectura.
      const nowMs = opts?.nowMs ?? Date.now();
      const dated = { ...payload, createdAt: row.createdAt };
      let validated = opts?.validatedLedgerIndex ?? null;
      const hasWindow = typeof payload.lastLedgerSequence === 'number' && payload.lastLedgerSequence > 0;
      // Con ventana SIEMPRE hace falta el ledger validado: o para saber si sigue
      // viva, o para acotar la lectura de la ventana del memo que decide.
      if (validated === null && hasWindow) {
        validated = await (opts?.readValidatedLedgerIndex ?? readValidatedLedgerIndex)();
      }
      verdict = classifyHandoffRelease(dated, {
        nowMs,
        validatedLedgerIndex: validated,
        reportBlocks: opts?.reportBlocks === true,
        holderEndedCeremony: opts?.holderEndedCeremony === true,
      });
      // productizer-it19 §M1 1.3 — EL RELOJ NO BASTA. Si el payload ya no puede
      // firmarse, todavía queda la pregunta que decide: ¿entró aquel Payment? Se
      // lee la ventana del memo y se vuelve a clasificar con lo que diga. Una
      // ventana ilegible NO suelta (salvo la puerta de it17 §1.3, muy pasada).
      if (!verdict.release && verdict.needsWindow === true) {
        const windowState = await readReleaseWindowState(dated, validated, opts?.readWindow);
        verdict = classifyHandoffRelease(dated, {
          nowMs,
          validatedLedgerIndex: validated,
          reportBlocks: opts?.reportBlocks === true,
          windowState,
          holderEndedCeremony: opts?.holderEndedCeremony === true,
        });
        // La ventana dice que aquel Payment SÍ entró: la fila es una firma, no un
        // borrador — se marca (el asiento estaba consumido, no libre).
        if (windowState === 'signed') return { released: false, verdict };
      }
    }
    if (!verdict.release) return { released: false, verdict };
    await prisma.backgroundJob.update({ where: { id: row.id }, data: { status: 'superseded' } });
    return { released: true, verdict };
  } catch {
    // productizer-it21 §P1 1.2 (contrato C1) — «NO PUDE LEER» NO ES «NO HABÍA
    // NADA». Este catch devolvía `{ released: false }` PELADO, la ruta lo
    // contestaba 200 y la pantalla lo leía como «no había asiento que liberar»,
    // ofreciendo preparar otro: se componía a ciegas sobre un asiento que podía
    // seguir ocupado, con su payload vivo en un móvil. Es la lección de `kvUpsert`
    // otra vez, en código nuestro. Ahora sale un veredicto TIPADO y reintentable
    // que la ruta responde 503 — nada se soltó, nada se sabe, vuelve a intentarlo.
    return {
      released: false,
      verdict: {
        release: false,
        code: 'SEAT_STATE_UNREADABLE',
        retryable: true,
        detail:
          'We could not read that order just now, so we cannot tell whether its seat is free — and «could not read» is ' +
          'never «nothing was there». Nothing was released and nothing moved: try again in a moment. Do not prepare ' +
          'another one until this answers, or two orders could end up on the same nonce.',
      },
    };
  }
}

/**
 * productizer-it25 §4 — LA PUERTA DE UNA CEREMONIA ABANDONADA.
 *
 * EL PROBLEMA QUE ABRE LA §2.1. Un 0xFE que firma un quórum se compone con la
 * vida real de sus payloads (24 h), porque un consejo firma a velocidad humana y
 * la `LastLedgerSequence` va DENTRO de los bytes firmados. El precio es que ese
 * asiento de nonce queda ocupado 24 h — y si la ceremonia se abandona (el consejo
 * cambia de idea, la reunión se aplaza, alguien cierra la pantalla), la SEGUNDA
 * salida de ese mismo consejo choca con un 409 durante un día entero. Alargar la
 * ventana sin esta puerta sería tapiar una salida con código nuestro.
 *
 * POR QUÉ UNA ACCIÓN EXPLÍCITA DEL TITULAR Y NO UN BARRIDO. Un barrido tendría
 * que ADIVINAR si el consejo sigue juntando firmas, y ese es justo el hecho que
 * nadie puede inventar: una ceremonia de tres días es normal. El único que lo
 * sabe es quien la abrió, así que es él quien la termina — la misma puerta con la
 * que ya devuelve el asiento de Sequence (`POST /xrpl-defi/multisign/release`).
 *
 * LO QUE ESTA PUERTA NO HACE: no debilita `classifySeatSignability`. El asiento
 * se suelta SOLO si, además, la ventana del memo se lee entera y dice que aquel
 * Payment nunca entró. Una ventana ilegible, una firma marcada o un informe
 * pendiente lo siguen reteniendo, palabra por palabra, como antes.
 *
 * Y CUATRO CERROJOS MÁS, AQUÍ:
 *   1. la fila tiene que ser de una CEREMONIA (`payloadExpiryMin` mayor que el de
 *      una firma simple). El asiento de una firma simple se suelta solo en
 *      minutos y no necesita esta puerta: dársela sería ensancharla por nada;
 *   2. la fila tiene que ser de la MISMA cuenta cuya ceremonia terminó el
 *      titular — un memo ajeno no abre el asiento de nadie;
 *   3. una fila con `signedAt` no se toca (lo impide `releaseQueuedHandoffDetailed`);
 *   4. **it27 §4** — esos bytes los tiene que haber PINADO el coordinador
 *      multifirma (`ceremonyPinnedSequence`, escrita por `stampCeremonyPin` desde
 *      `/multisign/prepare`). Los otros tres los cumple cualquier 0xFE compuesto
 *      para una cuenta con SignerList, haya pasado o no por el coordinador, y sin
 *      `Sequence` fijada el argumento de arriba NO se sostiene: dos Payments de esa
 *      cuenta entran los dos. Hasta it27 la puerta era inalcanzable (el cliente
 *      llamaba sin `memoHex`); el día que llegó el memo, este cerrojo llegó con él.
 */
export type CeremonySeatReleaseOutcome = {
  released: boolean;
  verdict?: HandoffReleaseVerdict;
  /**
   * it29 §3 — `not-pinned-by-us` ya no es una puerta cerrada sino una ETIQUETA
   * sobre la regla ordinaria (ver abajo), y tiene un hermano que antes no se
   * distinguía de él: `pin-unwritten`, «el coordinador SÍ pinó estos bytes y
   * nuestra base no dejó escribir la marca». Son hechos distintos y se dicen
   * distintos.
   */
  reason?: 'not-found' | 'not-a-ceremony' | 'other-account' | 'not-pinned-by-us' | 'pin-unwritten' | 'stale-sitting';
  /**
   * it29 §3 — DE DÓNDE SALIÓ LA PRUEBA DE QUE ESTOS BYTES LOS PINAMOS. `row`: la
   * marca estaba en la fila. `recovered`: la fila no la tenía pero este proceso
   * recordaba que el coordinador la intentó escribir y la BD falló (y se ha vuelto
   * a intentar). `none`: no consta ningún pin — ni en la fila ni en memoria.
   */
  pin?: 'row' | 'recovered' | 'none';
};

/**
 * productizer-it34 (E) — ¿ES ESTA LIBERACIÓN DE UN SITTING QUE YA NO ES EL DEL PIN?
 *
 * Pura. `pinned` es el id del sitting que estampó el pin vigente (de la fila, o de
 * la nota en memoria si es más reciente); `asked` es el que trae la liberación.
 *
 *   · `asked === undefined` → un cliente ANTERIOR a este id (no manda el campo):
 *     no hay nada que comparar y la regla es la de siempre. Compatibilidad
 *     deliberada: romperla de golpe dejaría 24 h de asientos sin puerta a los
 *     navegadores que aún no recargaron.
 *   · `pinned` vacío → la fila se pinó antes de que existiera el id: tampoco se
 *     puede comparar. Esas filas viven como mucho un día.
 *   · `asked === null` → un cliente que SÍ conoce el id pero cuyo sitting no
 *     recibió ninguno (cerró en `idle`, o en `preparing` antes de que volviera el
 *     prepare). Ese sitting no pinó nada: no puede soltar un pin que SÍ tiene
 *     nombre. Solo alcanza los pines sin nombre del punto anterior.
 *   · dos ids distintos → obsoleto: el pin lo puso otro sitting.
 */
export function ceremonySittingIsStale(pinned: unknown, asked: string | null | undefined): boolean {
  if (asked === undefined) return false;
  if (typeof pinned !== 'string' || pinned.length === 0) return false;
  return asked === null || asked !== pinned;
}

export async function releaseAbandonedCeremonySeat(
  memoHex: string,
  account: string,
  opts?: Parameters<typeof releaseQueuedHandoffDetailed>[1] & {
    /**
     * it34 (E): el id del sitting que pide soltar el asiento — el que le dio
     * `/multisign/prepare` (o el id de la propuesta, en el tempo asíncrono).
     * `undefined` = cliente anterior; `null` = sitting sin id. Ver
     * `ceremonySittingIsStale`.
     */
    sittingId?: string | null;
  },
): Promise<CeremonySeatReleaseOutcome> {
  const memo = typeof memoHex === 'string' ? memoHex.trim() : '';
  const holder = typeof account === 'string' ? account.trim() : '';
  if (!memo || !holder) return { released: false, reason: 'not-found' };
  const { sittingId: askedSitting, ...releaseOpts } = opts ?? {};
  // `strict`: un fallo de BD LANZA en vez de leerse como «no hay fila» (it21
  // §P1 1.2). «No pude leer» no suelta un asiento ni afirma que no había ninguno:
  // sube como `HandoffSeatStateUnreadableError` y la puerta lo cuenta como tal.
  const row = await findQueuedHandoffByMemo(memo, { strict: true });
  if (!row) return { released: false, reason: 'not-found' };
  if (row.xrplAddress !== holder) return { released: false, reason: 'other-account' };
  if (rowPayloadExpiryMin(row) <= handoffPayloadExpiryMin()) return { released: false, reason: 'not-a-ceremony' };
  // ── it34 (E) — ¿DE QUÉ SITTING ES EL PIN VIGENTE? ──────────────────────────
  //
  // WHAT FAILED IN SILENCE. Dos sittings de la misma sesión sobre los mismos
  // bytes (Escape en `signing` → «sign again» → nuevo prepare) re-estampaban el
  // mismo memo con la misma Sequence, y la liberación TARDÍA del primero
  // —fire-and-forget con `keepalive`, aterrizando después del segundo prepare—
  // pasaba por aquí con el pin presente, sustituía el reloj (`holderEndedCeremony`)
  // y soltaba el asiento de nonce bajo la ceremonia viva del segundo. El servidor
  // no distinguía sittings; ahora el pin lleva el id del que lo puso.
  //
  // «El más reciente manda», ESTÉ DONDE ESTÉ: si la BD rechazó el último sellado
  // (it29 §3), la fila conserva el id del sitting ANTERIOR y la nota en memoria
  // lleva el del último. Comparar solo con la fila daría por vigente al viejo —
  // el mismo agujero por otra puerta. Así que se compara con el sellado más nuevo
  // de los dos, y una liberación obsoleta NO TOCA LA FILA: ni sustituye el reloj
  // ni cae a la regla ordinaria (que en un payload muerto también la movería).
  const note = unwrittenPinNoteOf(memo, holder);
  const rowPinnedAtMs = Date.parse(String(row.ceremonyPinnedAt ?? '')) || 0;
  const latestPinSitting =
    note !== null && (ceremonyPinOf(row) === null || note.at > rowPinnedAtMs) ? note.sittingId : (row.ceremonySittingId ?? null);
  if ((ceremonyPinOf(row) !== null || note !== null) && ceremonySittingIsStale(latestPinSitting, askedSitting)) {
    return { released: false, reason: 'stale-sitting', pin: ceremonyPinOf(row) !== null ? 'row' : 'recovered' };
  }
  // it27 §4 — EL CERROJO QUE FALTABA, Y QUE ES EL ARGUMENTO ENTERO. Los otros dos
  // («ventana larga», «misma cuenta») los cumple cualquier 0xFE compuesto para una
  // cuenta con SignerList, haya pasado o no por el coordinador. Solo estos bytes
  // —los que `prepareCouncilMultisig` pinó— hacen imposible el gemelo, porque dos
  // Payments con la MISMA Sequence no pueden entrar los dos.
  if (ceremonyPinOf(row) !== null) {
    // it34 (E): la fila lleva un pin más viejo que la nota (la BD rechazó el último
    // sellado): se reintenta la escritura de paso, para que la fila nombre al
    // sitting vigente también cuando este proceso ya no esté. Best-effort.
    if (note !== null && note.at > rowPinnedAtMs) {
      await stampCeremonyPin(memo, holder, note.pinnedSequence, { sittingId: note.sittingId }).catch(() => undefined);
    }
    return { ...(await releaseQueuedHandoffDetailed(memo, { ...releaseOpts, holderEndedCeremony: true })), pin: 'row' };
  }
  // ── it29 §3 — SIN MARCA EN LA FILA: TRES HECHOS DISTINTOS, Y NINGUNA PARED ──
  //
  // WHAT FAILED IN SILENCE. it27 devolvía aquí `not-pinned-by-us` y paraba, y la
  // ruta lo contaba en indicativo: «That dispatch was not pinned by this app's
  // multisig coordinator». Pero el sellado es best-effort por partida doble
  // (`catch` en `stampCeremonyPin` + `.catch()` del llamador), así que una BD que
  // parpadeó al pinar es INDISTINGUIBLE, desde la fila, de unos bytes que jamás
  // pasaron por el coordinador — y la puerta afirmaba lo segundo sin haberlo
  // comprobado. Peor: parar aquí dejaba la fila sin NINGUNA regla, ni siquiera
  // la ordinaria, que para un payload muerto por su propio reloj la habría
  // soltado. Una salida tapiada 24 h por un fallo NUESTRO de escritura.
  //
  // (a) EL PIN QUE NO SE PUDO ESCRIBIR. Cuando la BD rechaza la marca, el
  //     coordinador la deja en la memoria de este proceso (`noteUnwrittenPin`):
  //     memo, cuenta y Sequence, escritos por nuestro propio código, jamás por un
  //     cuerpo de petición. Si consta ahí, el HECHO es el mismo que si estuviera
  //     en la fila —esos bytes llevan la Sequence fijada— y la puerta actúa igual
  //     (se reintenta la escritura de paso, por si la BD ya volvió).
  const recovered = unwrittenCeremonyPinOf(memo, holder);
  if (recovered !== null) {
    // it34 (E): la nota lleva el id del sitting que la dejó; el reintento lo
    // escribe con ella, para que la fila diga QUIÉN pinó y no solo QUÉ.
    await stampCeremonyPin(memo, holder, recovered, { sittingId: note?.sittingId ?? null }).catch(() => undefined);
    return { ...(await releaseQueuedHandoffDetailed(memo, { ...releaseOpts, holderEndedCeremony: true })), pin: 'recovered' };
  }
  // (b) NO CONSTA NINGÚN PIN. No se afirma que «no pasó por el coordinador»
  //     —podría ser una fila anterior a it27, o un proceso distinto del que la
  //     pinó—: se dice que no consta, y la fila cae a la REGLA ORDINARIA, la misma
  //     que aplica `/handoff/release` a cualquier borrador sin firmar. Esa regla
  //     no concede nada nuevo (el reloj del payload y la ventana del memo mandan,
  //     palabra por palabra, como siempre) y quita la pared: un payload muerto por
  //     su propio reloj se suelta, y uno vivo contesta `WAIT_FOR_PAYLOAD_EXPIRY`
  //     con su cuenta atrás REAL en vez de un «no» sin número. Sin `holderEndedCeremony`
  //     a propósito: sin prueba de Sequence fijada, el reloj no se sustituye.
  const ordinary = await releaseQueuedHandoffDetailed(memo, releaseOpts);
  return { ...ordinary, reason: 'not-pinned-by-us', pin: 'none' };
}

/* ── it29 §3 — LA MEMORIA DEL PIN QUE LA BASE NO DEJÓ ESCRIBIR ─────────────── */

/**
 * `stampCeremonyPin` es best-effort por diseño, y hasta it29 un fallo de BD se
 * tragaba el HECHO junto con la escritura. El hecho —«el coordinador fijó la
 * Sequence S sobre el memo M de la cuenta A»— lo produjo nuestro propio código
 * un instante antes, así que puede guardarse donde la BD no llega: en la memoria
 * del proceso. Acotada (oldest-first) y con caducidad de la vida máxima de una
 * ceremonia: pasado eso ningún payload de esa fila es firmable y la nota no
 * describe nada. Nunca se escribe desde una petición; solo desde el sellador.
 *
 * Lo que NO es: no es una prueba compartida entre instancias. Un release que cae
 * en otra réplica no la ve, y entonces la fila cae a la regla ordinaria (b) —
 * que es exactamente lo que pasaba antes de que existiera, nunca peor.
 */
interface UnwrittenCeremonyPin {
  account: string;
  pinnedSequence: number;
  at: number;
  /** it34 (E): the sitting that pinned — the note must say WHO, or a stale release matches it. */
  sittingId: string | null;
}
const MAX_UNWRITTEN_PINS = 64;
const UNWRITTEN_PIN_MAX_AGE_MS = 25 * 60 * 60 * 1000;
const unwrittenPins = new Map<string, UnwrittenCeremonyPin>();

function noteUnwrittenPin(memo: string, account: string, pinnedSequence: number, sittingId: string | null): void {
  if (unwrittenPins.size >= MAX_UNWRITTEN_PINS && !unwrittenPins.has(memo)) {
    const oldest = unwrittenPins.keys().next();
    if (!oldest.done) unwrittenPins.delete(oldest.value);
  }
  unwrittenPins.set(memo, { account, pinnedSequence, at: Date.now(), sittingId });
}

/** The whole note for (memo, account) — or null when there is none, it aged out, or it is another account's. */
function unwrittenPinNoteOf(memoHex: string, account: string): UnwrittenCeremonyPin | null {
  const note = unwrittenPins.get(memoHex);
  if (!note) return null;
  if (Date.now() - note.at > UNWRITTEN_PIN_MAX_AGE_MS) {
    unwrittenPins.delete(memoHex);
    return null;
  }
  return note.account === account ? note : null;
}

/** The Sequence our coordinator pinned on this memo and could not persist — or null. */
export function unwrittenCeremonyPinOf(memoHex: string, account: string): number | null {
  return unwrittenPinNoteOf(memoHex, account)?.pinnedSequence ?? null;
}

/** Tests only. */
export function __resetUnwrittenCeremonyPins(): void {
  unwrittenPins.clear();
}

/**
 * it27 §4 — LA `Sequence` QUE EL COORDINADOR MULTIFIRMA PINÓ SOBRE ESTA FILA, o
 * `null` si estos bytes nunca pasaron por él. Puro, para que la regla se pruebe
 * sin base de datos. Un número que no es una Sequence (0, negativo, decimal, una
 * cadena) es «no pinado»: nadie inventa una prueba a partir de basura.
 */
export function ceremonyPinOf(
  row: Pick<HandoffRecord, 'ceremonyPinnedSequence'> | null | undefined,
): number | null {
  const seq = row?.ceremonyPinnedSequence;
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq : null;
}

/**
 * it27 §4 — MARCAR UNOS BYTES COMO PINADOS POR EL COORDINADOR MULTIFIRMA.
 *
 * La escribe `POST /xrpl-defi/multisign/prepare` en el mismo sitio en que graba
 * el arriendo de la ceremonia, con la `Sequence` que acaba de fijar sobre el
 * `xrplTx`. Es la ÚNICA fuente de `ceremonyPinnedSequence`, y por eso la puerta
 * de liberación puede fiarse de ella: no viene de ningún cuerpo de petición.
 *
 * Best-effort a propósito, como el arriendo: una marca que no se puede escribir
 * deja la puerta de liberación tan cerrada como estaba antes de it25 §4 (el
 * asiento se suelta solo, por su ventana), que es prudente; hacer fallar el
 * prepare por una fila de caché sería parar una ceremonia legítima.
 *
 * NUNCA toca una fila firmada, ni una de otra cuenta: en las dos, marcarla sería
 * escribir una prueba falsa sobre bytes que no son los de esta ceremonia.
 */
export async function stampCeremonyPin(
  memoHex: string,
  account: string,
  pinnedSequence: number,
  /**
   * it34 (E) — QUIÉN pina. El id del sitting que el servidor acaba de generar en
   * este mismo prepare (o el id de la propuesta, en el tempo asíncrono). Un
   * sellado POSTERIOR con otro id SUSTITUYE el anterior: el más reciente manda,
   * y la liberación del sitting anterior deja de alcanzar esta fila
   * (`releaseAbandonedCeremonySeat` → `stale-sitting`). Sin id (un llamador
   * anterior) se escribe `null`: la fila queda sin nombre y cae a la regla de
   * compatibilidad — honesto, y ya no lo hace ningún llamador de producción.
   */
  opts?: { sittingId?: string | null },
): Promise<{ stamped: boolean; reason?: 'no-row' | 'signed' | 'other-account' | 'bad-sequence' | 'store' }> {
  const memo = typeof memoHex === 'string' ? memoHex.trim() : '';
  const holder = typeof account === 'string' ? account.trim() : '';
  const sittingId = typeof opts?.sittingId === 'string' && opts.sittingId.length > 0 ? opts.sittingId : null;
  if (!Number.isInteger(pinnedSequence) || pinnedSequence <= 0) return { stamped: false, reason: 'bad-sequence' };
  if (!process.env.DATABASE_URL || !memo || !holder) return { stamped: false, reason: 'no-row' };
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memo } },
      select: { id: true, payload: true },
    });
    if (!row) return { stamped: false, reason: 'no-row' };
    const payload = row.payload as unknown as HandoffRecord;
    if (payload.xrplAddress !== holder) return { stamped: false, reason: 'other-account' };
    if (typeof payload.signedAt === 'string' && payload.signedAt) return { stamped: false, reason: 'signed' };
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: {
        payload: {
          ...payload,
          ceremonyPinnedSequence: pinnedSequence,
          ceremonyPinnedAt: new Date().toISOString(),
          ceremonySittingId: sittingId,
        } as never,
      },
    });
    unwrittenPins.delete(memo); // it29 §3: written at last — the note has served
    return { stamped: true };
  } catch (e) {
    console.warn('[0xFE-handoff] ceremony pin NOT stamped:', (e as Error)?.message ?? e);
    // it29 §3 — the FACT survives the failed write. Our coordinator pinned this
    // Sequence on these bytes a moment ago; the store refusing to record it does
    // not unpin them. Kept in this process so the release door can tell «the mark
    // could not be written» from «no mark is known», and act on the former.
    noteUnwrittenPin(memo, holder, pinnedSequence, sittingId);
    return { stamped: false, reason: 'store' };
  }
}

/**
 * it29 §2 — EL MEMO DEL 0xFE QUE LLEVA UN Payment, LEÍDO TAL CUAL. Mudado aquí
 * desde `routes/xrplDefi.ts` (`zeroFeMemoOf`, que ahora delega en esto) porque el
 * segundo coordinador que pina una Sequence —`POST /council-proposals`— también
 * tiene que nombrar el asiento, y un router importando a otro router es un ciclo.
 *
 * `singleMemoHex` (councilExitToken) exige EXACTAMENTE 64 hex porque una ORDEN de
 * consejo es un keccak de 32 bytes. El memo de un 0xFE es la instrucción del Smart
 * Account entera, así que es más largo. Puro y sin red: nombra el asiento, no
 * decide nada sobre él. El rango es el que acepta el esquema de `/multisign/release`.
 */
export function zeroFeMemoOfTx(tx: unknown): string | null {
  const memos = (tx as { Memos?: unknown } | null)?.Memos;
  if (!Array.isArray(memos) || memos.length !== 1) return null;
  const data = (memos[0] as { Memo?: { MemoData?: unknown } } | null)?.Memo?.MemoData;
  if (typeof data !== 'string') return null;
  const hex = data.trim().replace(/^0x/i, '').toUpperCase();
  return /^[0-9A-F]{8,2048}$/.test(hex) ? hex : null;
}

/**
 * it29 §2/§3 — LO QUE SE CONTESTA SOBRE EL ASIENTO, EN UN SOLO SITIO. Puro.
 *
 * Dos puertas terminan una ceremonia y sueltan su asiento de nonce —
 * `/xrpl-defi/multisign/release` (el tempo síncrono) y `POST /council-proposals/:id/withdraw`
 * (el asíncrono)— y las dos tienen que decir lo mismo con las mismas palabras, o
 * la pantalla aprende dos gramáticas para un hecho. Aquí se convierte el
 * resultado de `releaseAbandonedCeremonySeat` en el campo `seat` de la respuesta.
 *
 * Lo que dice cada motivo lo dice en INDICATIVO solo cuando se comprobó:
 *   · `pin-unwritten`: sabemos que lo pinamos y sabemos que la BD no lo grabó.
 *   · `not-pinned-by-us`: NO CONSTA — no se afirma que no pasara por aquí. Y el
 *     veredicto de la regla ordinaria viaja entero (código, `secondsLeft`,
 *     `lastLedgerSequence`), para que el consejo lea una cuenta atrás y no una
 *     pared.
 */
export function seatReleaseAnswer(outcome: CeremonySeatReleaseOutcome): Record<string, unknown> {
  if (outcome.released) {
    return {
      released: true,
      reason: outcome.verdict?.reason ?? 'ceremony-ended',
      ...(outcome.pin ? { pin: outcome.pin } : {}),
    };
  }
  const v = outcome.verdict;
  const verdictFields = {
    ...(v?.code ? { code: v.code } : {}),
    ...(v?.detail ? { detail: v.detail } : {}),
    ...(v?.retryable !== undefined ? { retryable: v.retryable } : {}),
    ...(v?.secondsLeft !== undefined ? { secondsLeft: v.secondsLeft } : {}),
    ...(v?.lastLedgerSequence !== undefined ? { lastLedgerSequence: v.lastLedgerSequence } : {}),
  };
  if (outcome.reason === 'not-pinned-by-us') {
    return {
      released: false,
      reason: 'not-pinned-by-us',
      pin: 'none',
      ...verdictFields,
      detail:
        'We have no record that this app’s multisig coordinator pinned these bytes — they may have been composed ' +
        'elsewhere, or the mark may not have been written when they were; we cannot tell which. Without that proof ' +
        'a fixed Sequence cannot be assumed, so the seat is measured exactly as any unsigned dispatch is' +
        (v?.detail ? `: ${v.detail}` : '. It frees itself when that payment can no longer be signed or reach the ledger.'),
    };
  }
  if (outcome.reason === 'stale-sitting') {
    // it34 (E): NOT a refusal of the person's exit and NOT a held seat to count
    // down — the bytes were pinned again by a NEWER sitting (the same person
    // signing again, another tab, the async inbox), and that sitting owns the
    // seat now. Nothing was changed; no countdown is invented (the screen shows
    // no banner over it: `ceremonySeatNotice` needs a measured window).
    return {
      released: false,
      reason: 'stale-sitting',
      ...(outcome.pin ? { pin: outcome.pin } : {}),
      detail:
        'A newer sitting has pinned these bytes since this one was opened, so ending this one does not hand the seat back — ' +
        'that sitting holds it now. Nothing was changed.',
    };
  }
  if (outcome.reason) {
    return { released: false, reason: outcome.reason, ...(outcome.pin ? { pin: outcome.pin } : {}) };
  }
  return { released: false, ...(outcome.pin ? { pin: outcome.pin } : {}), ...verdictFields };
}

/**
 * Techo histórico de una ventana (== `MAX_LAST_LEDGER_WINDOW` del builder): el
 * suelo de búsqueda de una fila que no guardó su `composedLedgerIndex`.
 */
const HANDOFF_WINDOW_SEARCH_FLOOR_LEDGERS = 1000;

/**
 * La ventana del memo de ESTA fila, leída para decidir si su asiento puede
 * soltarse (it19 §M1 1.3). Sin ledger validado no hay rango que pedir: eso es
 * 'unreadable', que nunca libera nada.
 */
async function readReleaseWindowState(
  row: HandoffRecord & { createdAt?: Date | string | null },
  validatedLedgerIndex: number | null,
  readWindow?: typeof readHandoffMemoWindow,
): Promise<SeatWindowState> {
  const lls = Number(row.lastLedgerSequence);
  if (!Number.isInteger(lls) || lls <= 0) return 'unreadable';
  if (validatedLedgerIndex === null) return 'unreadable';
  const composed = Number(row.composedLedgerIndex);
  const from = Number.isInteger(composed) && composed > 0 ? composed : Math.max(1, lls - HANDOFF_WINDOW_SEARCH_FLOOR_LEDGERS);
  const to = Math.min(validatedLedgerIndex, lls);
  if (to < from) return 'absent'; // aún no ha cerrado ningún ledger de su ventana
  try {
    const verdict = await (readWindow ?? readHandoffMemoWindow)(row, { ledgerIndexMin: from, ledgerIndexMax: to });
    return verdict.state;
  } catch {
    return 'unreadable'; // un fallo de transporte jamás es una ausencia
  }
}

/** Forma booleana de `releaseQueuedHandoffDetailed` (los llamadores que solo liberan). */
export async function releaseQueuedHandoffByMemo(
  memoHex: string,
  opts?: Parameters<typeof releaseQueuedHandoffDetailed>[1],
): Promise<boolean> {
  return (await releaseQueuedHandoffDetailed(memoHex, opts)).released;
}

/**
 * productizer-it19 (contrato C2) — QUIEN CREA EL PAYLOAD FIJA SU CADUCIDAD.
 * `payloadExpiresAt` se estampaba al COMPONER, pero el `expire` de Xaman corre
 * desde que el payload se CREA (cuando el usuario abre el modal, a veces un
 * minuto más tarde): el servidor daba por muerta a los 5:01 una firma que seguía
 * viva hasta el 6:00, y soltar ese asiento es el gemelo (it18 R1 1.3). El
 * frontend llama aquí al crear el payload y el reloj se mueve — SOLO hacia
 * adelante y nunca más allá del cierre de la ventana de ledger.
 *
 * Devuelve la caducidad vigente (la nueva si se aceptó, la que había si no).
 */
export async function stampHandoffPayloadExpiry(
  memoHex: string,
  expiresAtIso: string,
  opts?: { nowMs?: number },
): Promise<{
  stamped: boolean;
  payloadExpiresAt?: string;
  /** it23 §Q1 1.2/1.3 — la vida del payload de ESTA fila (una ceremonia, 24 h). */
  payloadExpiryMin?: number;
  reason?: 'no-row' | 'signed' | 'unparseable' | 'not-forward' | 'store';
}> {
  if (!process.env.DATABASE_URL || !memoHex) return { stamped: false, reason: 'no-row' };
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['memoHex'], equals: memoHex } },
      select: { id: true, payload: true, createdAt: true },
    });
    if (!row) return { stamped: false, reason: 'no-row' };
    const payload = row.payload as unknown as HandoffRecord;
    // Una firmada no mueve su reloj: su asiento ya no depende de ninguna caducidad.
    // it23 §Q1 1.2/1.3 — la vida del payload de ESTA fila: la ceremonia declaró
    // la suya al componer, y medirla con la de una firma simple era lo que
    // impedía sellar la caducidad real que devuelve Xaman.
    const lifeMin = rowPayloadExpiryMin(payload);
    if (typeof payload.signedAt === 'string' && payload.signedAt) {
      return {
        stamped: false,
        reason: 'signed',
        payloadExpiresAt: payload.payloadExpiresAt ?? undefined,
        payloadExpiryMin: lifeMin,
      };
    }
    const dated = { ...payload, createdAt: row.createdAt };
    const clamped = clampStampedPayloadExpiry(dated, expiresAtIso, {
      nowMs: opts?.nowMs ?? Date.now(),
      fallbackWindowLedgers: defaultSeatWindowLedgers(payload.payloadExpiryMin ?? null),
    });
    if (!clamped.accepted) {
      return {
        stamped: false,
        reason: clamped.reason,
        payloadExpiresAt: handoffPayloadExpiryMsOf(dated) !== null ? new Date(handoffPayloadExpiryMsOf(dated) as number).toISOString() : undefined,
        payloadExpiryMin: lifeMin,
      };
    }
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: { payload: { ...payload, payloadExpiresAt: clamped.expiresAt } },
    });
    return { stamped: true, payloadExpiresAt: clamped.expiresAt, payloadExpiryMin: lifeMin };
  } catch {
    return { stamped: false, reason: 'store' }; // best-effort: la caducidad de composición sigue valiendo
  }
}

/**
 * Invalida handoffs pendientes cuyo asiento de nonce reclama un prepare nuevo
 * (supersede explícito). La fila NO se borra: sigue localizable por userOpHash
 * — si su Payment se firmó a pesar de todo, el executor aún encuentra los
 * bytes (jamás dejar XRP firmado sin ruta de ejecución).
 */
export async function markHandoffsSuperseded(userOpHashes: string[]): Promise<void> {
  if (!process.env.DATABASE_URL || userOpHashes.length === 0) return;
  try {
    const prisma = await getPrisma();
    for (const hash of userOpHashes) {
      const row = await prisma.backgroundJob.findFirst({
        where: { jobType: JOB_TYPE, payload: { path: ['userOpHash'], equals: hash.toLowerCase() } },
        select: { id: true, status: true, payload: true },
      });
      if (!row || row.status !== 'queued') continue;
      // Defensa en profundidad (2026-08-21): una fila FIRMADA jamás se
      // supersede por esta vía — su asiento solo lo vacía ejecutar o aparcar.
      if (typeof (row.payload as Record<string, unknown>).signedAt === 'string') continue;
      await prisma.backgroundJob.update({
        where: { id: row.id },
        data: { status: 'superseded' },
      });
    }
  } catch {
    /* best-effort — el guard ya avisó; la fila queda como esté */
  }
}

/**
 * Aparcar (acción explícita del operador o tope de fallos) LIBERA el asiento de
 * nonce — INCLUSO de una fila FIRMADA. `markHandoffsSuperseded` se niega a tocar
 * lo firmado para que un prepare nuevo no estrangule un carrier a punto de
 * firmarse; pero un PARK es lo contrario: dice «esto está muerto, déjame seguir
 * en ese nonce». Saca la fila de 'queued' (el guard de asiento deja de verla)
 * SIN borrarla — sus bytes siguen localizables por userOpHash por si su Payment
 * se firmó igual (jamás dejar XRP firmado sin ruta de ejecución). Devuelve true
 * si liberó una fila que seguía 'queued'. Incidente 12-sep: sin esto, aparcar
 * un claim muerto no liberaba el asiento y el re-claim quedaba en bucle
 * (NONCE_SEAT_TAKEN_SIGNED perpetuo).
 */
export async function markHandoffParkedByUserOpHash(userOpHash: string): Promise<boolean> {
  if (!process.env.DATABASE_URL || !userOpHash) return false;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, status: 'queued', payload: { path: ['userOpHash'], equals: userOpHash.toLowerCase() } },
      select: { id: true },
    });
    if (!row) return false;
    await prisma.backgroundJob.update({ where: { id: row.id }, data: { status: 'superseded' } });
    return true;
  } catch {
    return false; // best-effort: si la fila no se libera, el guard seguirá avisando
  }
}

/** Busca el handoff exacto que comprometió un memo (por keccak256(userOpData)). */
export async function findHandoffByUserOpHash(userOpHash: string): Promise<HandoffRecord | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['userOpHash'], equals: userOpHash.toLowerCase() } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? (row.payload as unknown as HandoffRecord) : null;
  } catch {
    return null; // sin DB el executor cae al fallback de reconstrucción
  }
}

/**
 * Marca el resultado de la ejecución sobre la fila del handoff (auditoría —
 * el proof on-chain es el ExecutionReceipt real; esto es trazabilidad interna).
 */
export async function markHandoffExecuted(
  userOpHash: string,
  result: { xrplTxHash: string; flareTxHash: string; executor: string },
): Promise<void> {
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['userOpHash'], equals: userOpHash.toLowerCase() } },
      select: { id: true },
    });
    if (!row) return;
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: { status: 'completed', completedAt: new Date(), result: { ...result } },
    });
  } catch {
    /* auditoría best-effort — la ejecución ya está probada on-chain */
  }
}

// ── Paid-attestation persistence (0xFE) — sobrevive a un redeploy ────────────
//
// Espejo de la persistencia del carril Legacy (LegacyOrderStore), portada aquí
// porque `main` es producción con push diario → el caché en RAM se vacía en cada
// deploy y el reintento del mismo carril RE-PAGA la fee FDC (el incidente de la
// quema). **jobType propio `'0xfe-attestation'`** (NUNCA '0xfe-handoff'): el
// poller `findQueuedHandoffsByPersonalAccount` filtra por '0xfe-handoff'+'queued',
// así que este namespace + status 'completed' es doblemente invisible a él.
//
// Se persiste TAMBIÉN `passesWithoutProof` (pasadas sin proof antes de concluir
// que el request nunca se confirmó): el proof, una vez construido, el DA layer
// lo sirve para siempre → una ronda finalizada sin proof significa un parpadeo
// transitorio (reintentar) o un request no confirmado (fee quemada, re-pagar).
// Se toleran 2 pasadas; si el contador no sobreviviera al redeploy se resetearía
// a 0 en cada reload y nunca se concluiría — el registro "pagado" sobre un proof
// inexistente no se borraría jamás.

const ATTESTATION_JOB_TYPE = '0xfe-attestation';

export async function save0xFeAttestation(
  attKey: string,
  data: { abiEncodedRequest: string; roundId: number; passesWithoutProof: number },
): Promise<void> {
  const key = attKey.toLowerCase();
  await kvUpsert(ATTESTATION_JOB_TYPE, 'attKey', key, { attKey: key, ...data });
}

export async function find0xFeAttestation(
  attKey: string,
): Promise<{ abiEncodedRequest: string; roundId: number; passesWithoutProof: number } | null> {
  const p = await kvGet(ATTESTATION_JOB_TYPE, 'attKey', attKey.toLowerCase());
  if (!p) return null;
  // DIFERENCIA DELIBERADA (explícita, no heredada): este carril tolera filas viejas que
  // aún llevan `misses` en vez de `passesWithoutProof` — se lee como fallback. El carril
  // Legacy NO lo hace (nunca tuvo esas filas). Aquí, no en el helper compartido.
  const passes =
    typeof p.passesWithoutProof === 'number'
      ? p.passesWithoutProof
      : typeof (p as { misses?: number }).misses === 'number'
        ? (p as { misses?: number }).misses!
        : 0;
  return typeof p.abiEncodedRequest === 'string' && typeof p.roundId === 'number'
    ? { abiEncodedRequest: p.abiEncodedRequest, roundId: p.roundId, passesWithoutProof: passes }
    : null;
}

/** Invalida el registro (proof del DA layer expirado, o consumido) → el próximo
 *  intento pide attestation nueva en vez de reutilizar una ronda muerta. */
export async function delete0xFeAttestation(attKey: string): Promise<void> {
  await kvDelete(ATTESTATION_JOB_TYPE, 'attKey', attKey.toLowerCase());
}

// ── Parked-dispatch persistence (0xFE) — el estado de aparcamiento sobrevive ──
//
// Hasta 2026-07-26 `parked` vivía SOLO en la memoria del watcher: un redeploy
// (push diario a main = producción) vaciaba la lista y los aparcados por tope
// de fallos volvían a reintentar desde cero; la DB no sabía qué estaba atascado
// y /app/admin solo podía enseñar un contador. **jobType propio `'0xfe-parked'`**
// (invisible al poller de handoffs, mismo patrón que '0xfe-attestation'), key =
// hash XRPL en MAYÚSCULAS (así llega de account_tx). La skip-list del operador
// (FLARE_EXECUTOR_SKIP_TXS) NO se persiste aquí: su persistencia ES el env.

const PARKED_JOB_TYPE = '0xfe-parked';

export interface Parked0xFeRecord {
  /** XRPL tx hash (uppercase). */
  hash: string;
  reason: string;
  /** Qué aparcó: 'permanent' (bytes inejecutables) | 'failures' (tope) | 'operator' (/app/admin). */
  source: 'permanent' | 'failures' | 'operator';
  parkedAt: string;
  account?: string | null;
  drops?: string | null;
  dateISO?: string | null;
  memoHex?: string | null;
}

export async function saveParked0xFe(rec: Parked0xFeRecord): Promise<void> {
  const hash = rec.hash.toUpperCase();
  await kvUpsert(PARKED_JOB_TYPE, 'hash', hash, { ...rec, hash });
}

export async function deleteParked0xFe(hash: string): Promise<void> {
  await kvDelete(PARKED_JOB_TYPE, 'hash', hash.toUpperCase());
}

/**
 * Los 0xFE aparcados.
 *
 * productizer-it21 §P1 1.4 — QUIEN DECIDE UN ASIENTO LEE EN ESTRICTO. `kvList`
 * convierte cualquier fallo de BD en `[]`, y el guard de asiento usa esta lista
 * para EXCLUIR filas aparcadas: con la lista vacía por un parpadeo, un dispatch
 * ya aparcado (asiento muerto, cero reintentos) resucitaba como ocupante y la
 * salida de su dueño moría en `NONCE_SEAT_TAKEN_SIGNED`, no reintentable — el
 * incidente del 12-sep, por una lectura blanda. Con `strict: true` el fallo
 * LANZA y el llamador decide honestamente (la entrada espera, la salida se
 * compone con aviso). Los lectores de PANEL (el barrido del executor, la vista
 * de aparcados) siguen con la lectura blanda a propósito: ahí una lista corta es
 * ruido, no una decisión sobre el dinero de nadie.
 */
export async function listParked0xFe(opts?: { strict?: boolean }): Promise<Parked0xFeRecord[]> {
  const rows = opts?.strict === true ? await kvListStrict(PARKED_JOB_TYPE) : await kvList(PARKED_JOB_TYPE);
  return rows.filter(
    (r): r is Record<string, unknown> & Parked0xFeRecord =>
      typeof r.hash === 'string' && typeof r.reason === 'string',
  );
}

// ── Dismissed-dispatch persistence (0xFE) — la lápida sale del panel ─────────
//
// Fundador 2026-08-22 («no quiero que esto se quede así para siempre»): un
// dispatch PERMANENTEMENTE inejecutable (bytes con nonce consumido) aparcado es
// una lápida — cero coste, cero reintentos, pero ruido eterno en el panel.
// «Descartar» lo archiva: desaparece de Parked/Pending y el barrido lo ignora.
// El registro NO se borra (auditoría: qué era, por qué murió, cuánto carrier
// quedó en el Core Vault); solo cambia de namespace. Únicamente el operador
// puede descartar, y solo lo aparcado — jamás algo que aún podría ejecutar.

const DISMISSED_JOB_TYPE = '0xfe-dismissed';

export async function saveDismissed0xFe(rec: Parked0xFeRecord & { dismissedAt: string }): Promise<void> {
  const hash = rec.hash.toUpperCase();
  await kvUpsert(DISMISSED_JOB_TYPE, 'hash', hash, { ...rec, hash });
}

export async function listDismissed0xFeHashes(): Promise<Set<string>> {
  const rows = await kvList(DISMISSED_JOB_TYPE);
  return new Set(
    rows.filter((r): r is Record<string, unknown> & { hash: string } => typeof r.hash === 'string')
      .map((r) => r.hash.toUpperCase()),
  );
}

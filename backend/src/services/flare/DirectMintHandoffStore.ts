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
}

import { kvGet, kvUpsert, kvDelete, kvList } from '../persistence/backgroundJobKv';

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
    return false;
  }
}

/**
 * Handoffs aún pendientes de firma ('queued') de un Personal Account — la
 * materia prima del guard de asiento de nonce (incidente 2026-07-14/16).
 * Filtrado en JS por si el checksum difiere entre filas. Sin DB → [].
 */
export async function findQueuedHandoffsByPersonalAccount(personalAccount: string): Promise<HandoffRecord[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const prisma = await getPrisma();
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType: JOB_TYPE, status: 'queued' },
      orderBy: { createdAt: 'asc' },
    });
    const pa = personalAccount.toLowerCase();
    return rows
      .map((r) => r.payload as unknown as HandoffRecord)
      .filter((p) => (p.personalAccount || '').toLowerCase() === pa);
  } catch {
    return []; // best-effort: sin filas no hay guard, el prepare sigue
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
        select: { id: true, status: true },
      });
      if (!row || row.status !== 'queued') continue;
      await prisma.backgroundJob.update({
        where: { id: row.id },
        data: { status: 'superseded' },
      });
    }
  } catch {
    /* best-effort — el guard ya avisó; la fila queda como esté */
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

export async function listParked0xFe(): Promise<Parked0xFeRecord[]> {
  const rows = await kvList(PARKED_JOB_TYPE);
  return rows.filter(
    (r): r is Record<string, unknown> & Parked0xFeRecord =>
      typeof r.hash === 'string' && typeof r.reason === 'string',
  );
}

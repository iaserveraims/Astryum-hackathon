/**
 * LegacyOrderStore — the server-side copy of each council order's bytes.
 *
 * The XRPL memo only publishes keccak256(orderData): if the full bytes are
 * lost, no relayer can execute the order (same lesson as the 0xFE handoff
 * store). This persists orderData at prepare time, keyed by orderHash, so the
 * relayer can match the memo of the validated XRPL tx and deliver the exact
 * committed bytes to the XrplCouncilBridge.
 *
 * Same properties as DirectMintHandoffStore: `background_jobs` table (jobType
 * 'legacy-council-order'), records are payload material, never a queue — the
 * trigger is ALWAYS the quorum-signed XRPL Payment. A prepared order the
 * council never signs stays 'queued' and is inert. Losing a row is recoverable:
 * the client can re-supply orderData (the hash protects fidelity).
 */

import { kvGet, kvUpsert, kvDelete } from '../persistence/backgroundJobKv';

export interface CouncilOrderRecord {
  orderHash: string; // 0x… keccak256(orderData) — the memo commitment
  orderData: string; // 0x… abi.encode(uint64 nonce, bytes vaultCalldata)
  action: string;
  summary: string;
  nonce: number;
  chain: string;
  bridge: string;
  vault: string;
  council: string; // the XRPL council account (r…)
}

const JOB_TYPE = 'legacy-council-order';

async function getPrisma() {
  const { prisma } = await import('../../database/prismaClient');
  return prisma;
}

export async function saveCouncilOrderRecord(record: CouncilOrderRecord): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const prisma = await getPrisma();
    const existing = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['orderHash'], equals: record.orderHash.toLowerCase() } },
      select: { id: true },
    });
    if (existing) return true; // same hash ⇒ same bytes — idempotent
    await prisma.backgroundJob.create({
      data: {
        jobType: JOB_TYPE,
        status: 'queued', // queued = waiting for the quorum to sign the Payment
        payload: { ...record, orderHash: record.orderHash.toLowerCase() },
      },
    });
    return true;
  } catch (e) {
    console.error(
      `[legacy-order-store] persist FAILED for ${record.orderHash}: ${(e as Error).message} — ` +
        'the relayer will need the orderData re-supplied by the client',
    );
    return false;
  }
}

export async function findCouncilOrderByHash(orderHash: string): Promise<CouncilOrderRecord | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['orderHash'], equals: orderHash.toLowerCase() } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? (row.payload as unknown as CouncilOrderRecord) : null;
  } catch {
    return null;
  }
}

export async function markCouncilOrderExecuted(
  orderHash: string,
  result: { xrplTxHash: string; flareTxHash: string; relayer: string },
): Promise<void> {
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType: JOB_TYPE, payload: { path: ['orderHash'], equals: orderHash.toLowerCase() } },
      select: { id: true },
    });
    if (!row) return;
    await prisma.backgroundJob.update({
      where: { id: row.id },
      data: { status: 'completed', completedAt: new Date(), result: { ...result } },
    });
  } catch {
    /* best-effort audit — the on-chain OrderExecuted event is the real receipt */
  }
}

// ── Paid-attestation persistence (survives a redeploy mid-ceremony) ──────────
//
// The FDC attestation fee (~FLR) is paid once per order. Remembering (txId →
// round) in RAM is fragile: a Railway redeploy between the payment and the
// execute wipes it, and the retry re-pays — the exact 0xFE lesson (244 re-pays,
// 2026-07-18). Persisting the round lets any restart REUSE the already-paid
// attestation (its proof stays retrievable from the DA layer forever) instead
// of paying again. Keyed by txId; best-effort (no DB ⇒ falls back to RAM only).

const ATTESTATION_JOB_TYPE = 'legacy-attestation';

export async function savePaidAttestation(
  txId: string,
  data: { abiEncodedRequest: string; roundId: number; passesWithoutProof: number },
): Promise<void> {
  // UPSERT via the shared bg-kv: passesWithoutProof sube en cada pasada sin proof y DEBE
  // persistir (si no, un redeploy lo resetea a 0 y nunca se concluye "nunca confirmado").
  const key = txId.toLowerCase();
  await kvUpsert(ATTESTATION_JOB_TYPE, 'txId', key, { txId: key, ...data });
}

export async function findPaidAttestation(
  txId: string,
): Promise<{ abiEncodedRequest: string; roundId: number; passesWithoutProof: number } | null> {
  const p = await kvGet(ATTESTATION_JOB_TYPE, 'txId', txId.toLowerCase());
  if (!p) return null;
  return typeof p.abiEncodedRequest === 'string' && typeof p.roundId === 'number'
    ? {
        abiEncodedRequest: p.abiEncodedRequest,
        roundId: p.roundId,
        passesWithoutProof: typeof p.passesWithoutProof === 'number' ? p.passesWithoutProof : 0,
      }
    : null;
}

/**
 * Invalidate a persisted attestation. Called when the record is CONSUMED, or
 * when N passes have found no proof for its round. A FDC proof, once built, is
 * served by the DA layer FOREVER (dev.flare.network/fdc/overview — the 14-day
 * limit is on REQUESTING, not on retention). So "finalized round + no proof
 * after N passes" is NOT an expired proof: it means the request was never
 * confirmed (fee too low / insufficient weight → the fee was BURNED, no proof
 * will ever exist). Deleting lets the next attempt pay a fresh attestation.
 */
export async function deletePaidAttestation(txId: string): Promise<void> {
  await kvDelete(ATTESTATION_JOB_TYPE, 'txId', txId.toLowerCase());
}

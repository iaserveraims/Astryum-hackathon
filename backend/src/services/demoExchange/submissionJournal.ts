/**
 * submissionJournal — the durable record of every payment the omnibus key
 * signed, kept APART from the run.
 *
 * xrpl.org (Reliable Transaction Submission): persist the signed transaction
 * before submitting it. Iteration 2 persisted it inside the run — but the run is
 * saved WHOLE by public routes (`/verify`, `/omnibus`) that load, work for
 * seconds and save, so a concurrent save could put a signed request back to
 * 'pending' and the next tick would sign a second payment (productizer cycle,
 * iteration 3). This journal is keyed by request id and written only by the
 * autopilot, so no run save can erase what was signed.
 */

import { kvGet, kvGetStrict, kvUpsert } from '../persistence/backgroundJobKv';
import type { Against, AgainstKind } from './availableBalance';
import { requestsOf, type DemoRun } from './DemoExchangeStore';
import { journalPlan } from './submissionVerdict';

export const SUBMISSION_JOB_TYPE = 'demo-exchange-submission';
const KEY_FIELD = 'requestId';

export interface SubmissionEntry {
  requestId: string;
  runId: string;
  kind: 'put-to-work' | 'withdraw';
  clientId: string;
  drops: string;
  txHash: string;
  lastLedgerSequence: number;
  submittedAtLedger: number;
  memoHex?: string;
  userOpHash?: string;
  supplyUBA?: string;
  status: 'submitting' | 'settled' | 'failed' | 'expired';
  /** The validated result code when it failed on the ledger. */
  code?: string;
  updatedAt: string;
}

/** In-process copy: the journal must still hold without a database (local, tests). */
const memory = new Map<string, SubmissionEntry>();

/**
 * The journal entry of a request, or null when there is NONE.
 *
 * THROWS when the database cannot be read. `kvGet` logs a database failure and
 * answers null, and null here means «never signed» — which authorises a fresh
 * signature. After a restart (in-process copy empty) a DB hiccup would have
 * signed the same request a second time. So with a database this reads through
 * `kvGetStrict`, and the caller must treat a throw as «do not sign».
 */
export async function readSubmission(requestId: string): Promise<SubmissionEntry | null> {
  if (process.env.DATABASE_URL) {
    const fromDb = (await kvGetStrict(SUBMISSION_JOB_TYPE, KEY_FIELD, requestId)) as unknown as SubmissionEntry | null;
    if (fromDb) {
      memory.set(requestId, fromDb);
      return fromDb;
    }
  }
  return memory.get(requestId) ?? null;
}

/**
 * Throws unless the entry is PROVEN persisted: the caller must NOT submit a
 * payment it could not record. `kvUpsert` logs a database failure and returns,
 * so a plain await proves nothing — the entry is read back and compared.
 * Without a database (local, tests) the in-process copy is the journal.
 */
export async function writeSubmission(entry: SubmissionEntry): Promise<void> {
  if (process.env.DATABASE_URL) {
    await kvUpsert(SUBMISSION_JOB_TYPE, KEY_FIELD, entry.requestId, entry as unknown as Record<string, unknown>);
    const back = (await kvGet(SUBMISSION_JOB_TYPE, KEY_FIELD, entry.requestId)) as unknown as SubmissionEntry | null;
    if (!back || back.txHash !== entry.txHash || back.status !== entry.status) {
      throw new Error(`SUBMISSION_JOURNAL_NOT_PERSISTED: request ${entry.requestId} (${entry.status}) could not be verified in the database`);
    }
  }
  memory.set(entry.requestId, entry);
}

/** Test hook. */
export function _resetSubmissionJournal(): void {
  memory.clear();
}

/**
 * it. 29 — LA ASIMETRÍA DE LA RESERVA, APOYADA EN EL JOURNAL.
 *
 * `availableBalance` es pura (ni RPC ni base de datos), así que la prueba de que
 * una entrada pendiente no lleva firma tiene que entrar por la puerta. Esto la
 * construye: para cada `put-to-work` que el run dice 'pending' y sin hash, se
 * mira el journal durable; solo las que él declara nunca firmadas
 * (`journalPlan === 'fulfil'`) quedan eximidas de retener la SALIDA de su dueño.
 *
 * LANZA si el journal no se puede leer (`readSubmission` es estricto con base de
 * datos). El llamador falla CERRADO: sin la prueba, la entrada retiene como
 * antes de la it. 27. Eso es lo correcto aquí y solo aquí — lo único que la
 * reserva compra es no pagar dos veces con el mismo saldo, y afirmar «nada está
 * firmado» sin poder leer el registro de firmas es exactamente el error que hizo
 * falta este journal. Una SALIDA que entra sin ninguna entrada pendiente por
 * delante —el caso normal— no lee el journal en absoluto y no puede fallar.
 *
 * Con `kind === 'put-to-work'` no hay exención posible (dos entradas sí se pisan
 * el saldo), así que no se lee nada.
 */
export async function againstFor(run: DemoRun, clientId: string, kind: AgainstKind): Promise<Against> {
  if (kind !== 'withdraw') return { kind };
  const candidates = requestsOf(run).filter((r) => r.clientId === clientId && r.kind === 'put-to-work' && r.status === 'pending' && !r.txHash);
  const provenUnsigned = new Set<string>();
  const provenSigned = new Set<string>();
  for (const r of candidates) {
    const plan = journalPlan(await readSubmission(r.id));
    // it. 31 — un entry `failed` es un resultado VALIDADO distinto de tes
    // (`submitAndWait`): los drops nunca salieron y ese blob consumió su
    // Sequence, así que no puede pagar nada después. Se agrupaba con «lo
    // firmado» y retenía la salida de su dueño hasta que un tick lo
    // reconciliara — y con el bucle apagado, para siempre. Va con lo que no
    // puede mover dinero; su puerta (DELETE del dueño) reconcilia y cede.
    if (plan === 'fulfil' || plan === 'finish-failed') provenUnsigned.add(r.id);
    else provenSigned.add(r.id);
  }
  return { kind, provenUnsigned, provenSigned };
}

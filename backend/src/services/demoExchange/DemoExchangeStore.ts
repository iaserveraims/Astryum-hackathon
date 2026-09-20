/**
 * DemoExchangeStore — the SIMULATED "exchange system" behind the Demo Exchange
 * surface (BuildSpec Demo Exchange v2 §2).
 */

import type { DemoStructure } from './structures';
import {
  kvCompareAndSet,
  kvDelete,
  kvGetStrict,
  kvListStrict,
  kvUpsert,
  type KvCasOutcome,
} from '../persistence/backgroundJobKv';

export const DEMO_RUN_JOB_TYPE = 'demo-exchange-run';
const KEY_FIELD = 'runId';

export type DemoPolicy = 'A' | 'B';

export type ReceiptStep =
  | 'E1_ANCHOR'
  | 'E2_POTE'
  | 'E3_KYC'
  | 'E3_CREDENTIAL'
  | 'U1_DEPOSIT'
  | 'E5_PUT_TO_WORK'
  | 'E6_ORDER'
  | 'E7_DENIED'
  | 'U4_EXIT'
  | 'U4_EXIT_XRP'
  | 'E8_WITHDRAW'
  | 'NOTE';

export type ReceiptChain = 'xrpl' | 'flare' | 'none';

export interface Check {
  label: string;
  /** What was read and where — filled by the verifier. */
  observed?: string;
  ok?: boolean;
  /** Human reason when ok === false. */
  reason?: string;
}

export interface Receipt {
  id: string;
  runId: string;
  clientId?: string;
  step: ReceiptStep;
  chain: ReceiptChain;
  txHash?: string;
  explorerUrl?: string;
  at: string;
  note?: string;
  /** Facts frozen at record time the verifier compares against (tag, account, amounts…). */
  expect?: Record<string, string | number | boolean>;
  checks: Check[];
  verifiedAt?: string;
}

export interface DemoClient {
  id: string;
  runId: string;
  label: string;
  /** XRPL destination tag the exchange gave this client (uint32). */
  tag: number;
  /** The client's own Flare account (passkey account) — where the shares live. */
  passkeyAccount?: string;
  /** The client's own XRPL wallet, if they registered one (for U1 and the exit to own wallet). */
  xrplAddress?: string;
  kyc: 'none' | 'registry' | 'credential' | 'both';
  /** Drops the exchange ledger says this client has AT the exchange (mirror of on-ledger facts). */
  xrpOnExchangeDrops: string;
  /** Standing instruction: every credited deposit is put to work by the autopilot without a further tap. */
  autoInvest?: boolean;
  /**
   * The Astryum user (SIWE session `userId`) who OWNS this row: the only
   * non-admin who may mutate it. Set by a self-serve alta, or by a claim that
   * presented the desk's one-time claim code. Absent = unowned (desk-created or
   * legacy) — only an admin, or the holder of the claim code, can bind it.
   */
  ownerUserId?: string;
  /**
   * When `ownerUserId` was established (self-serve alta, claim, founder
   * assignment). Absent on rows older than this field: `createdAt` stands in —
   * the earliest possible moment, so a security takeover of the owner's login
   * never leaves an old row trusted by default (see takeover.ts).
   */
  ownedSince?: string;
  /** sha256 (hex) of the one-time claim code the desk handed out. Never the code itself; cleared on claim. Never served. */
  claimCodeHash?: string;
  /**
   * How `xrplAddress` was proven when written: 'session' = the SIWE login
   * wallet of the owner, 'binding' = an active signed WalletBinding of the
   * owner, 'admin' = written by a founder session (NOT payout proof by itself).
   */
  xrplAddressProof?: 'session' | 'binding' | 'admin';
  createdAt: string;
}

/**
 * A request the client made to the exchange — the exchange backend (autopilot)
 * fulfils it by signing with the simulated exchange key, or a human does it in
 * the Exchange tab. Every transition keeps its hash and its reason.
 */
export interface ClientRequest {
  id: string;
  kind: 'put-to-work' | 'withdraw';
  clientId: string;
  drops: string;
  /**
   * 'submitting' = the omnibus key SIGNED this request and its hash was
   * persisted BEFORE the payment was submitted (xrpl.org, Reliable Transaction
   * Submission). Its fate is decided by reading the ledger, never by signing
   * again: see DemoExchangeAutopilot.resolveSubmitting.
   */
  status: 'pending' | 'submitting' | 'signed' | 'refused' | 'done';
  createdAt: string;
  updatedAt: string;
  txHash?: string;
  reason?: string;
  /** While submitting: the signed payment can never enter a ledger past this index. */
  lastLedgerSequence?: number;
  /** While submitting: the last validated ledger when it was signed (lower bound of the search). */
  submittedAtLedger?: number;
  /** put-to-work while submitting: the 0xFE hand-off it belongs to (seat bookkeeping). */
  memoHex?: string;
  userOpHash?: string;
  supplyUBA?: string;
}

/**
 * A payment of the OMNIBUS that the founder desk composed and hands to Xaman by
 * hand (E8 payout, E5 put-to-work) — recorded server-side so that neither a
 * second desk compose nor the autopilot can pay the same balance again while it
 * is in flight.
 */
export interface DeskPayment {
  id: string;
  kind: 'withdraw' | 'put-to-work';
  clientId: string;
  drops: string;
  status: 'prepared' | 'signed' | 'settled' | 'released';
  /** The payment can never enter a ledger past this index (withdraw; server-composed put-to-work). */
  lastLedgerSequence?: number;
  txHash?: string;
  /**
   * The validated ledger index when the reservation was made: the LOWER bound of
   * the exhaustive omnibus read that must prove the payment absent before the
   * reservation is ever released (deskPaymentProof).
   */
  createdAtLedger?: number;
  /** withdraw: the wallet the payout was composed to (its fingerprint, independent of a later re-point). */
  destination?: string;
  /**
   * put-to-work: the 0xFE memo / userOpHash of the hand-off the SERVER composed
   * for this reservation (prepare-put-to-work), or a legacy memo attached by PATCH
   * after it was verified against the hand-off store. The proof matches ONLY by it.
   */
  memoHex?: string;
  userOpHash?: string;
  /** Why it closed — the chain facts that proved it (release or settle by proof). */
  closedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An omnibus 0xFE an operator declared NOT a client movement (signed outside
 * Astryum: the exchange's own treasury, a test). It debits nobody; it only stops
 * blocking the release of memo-less reservations (deskPaymentProof). Every mark
 * leaves a NOTE receipt with the operator's reason.
 */
export interface ExternalFe {
  txHash: string;
  memoHex?: string;
  ledgerIndex?: number;
  note: string;
  markedAt: string;
}

export interface DemoRun {
  runId: string;
  /** 1-based sequence, drives the DEFAULT tag space so two runs on one omnibus never collide. */
  seq: number;
  label: string;
  councilAddress: string;
  omnibusAddress: string;
  policy: DemoPolicy;
  poteAddress?: string;
  bridgeAddress?: string;
  registryAddress?: string;
  /**
   * CONECTA (omnibus VIVO): the run's RESERVED destination-tag range. The
   * exchange picks it so it cannot collide with the tags its existing clients
   * already use; the watcher refuses to classify anything outside it. Absent =
   * the classic demo space (seq×100 + ordinal, fresh omnibus).
   */
  tagBase?: number;
  /** Width of the reserved range (capacity). Default 100 when tagBase is set. */
  tagCount?: number;
  /**
   * The tenant frontier: the validated ledger index at run creation. A payment
   * validated BEFORE it can never be classified as this run's — a live omnibus
   * has years of history with tags that may collide, and old money must stay
   * invisible. Absent (RPC hiccup at creation) = old unbounded behavior.
   */
  sinceLedgerIndex?: number;
  createdAt: string;
  status: 'open' | 'closed';
  /**
   * QUIÉN LO CREÓ. El id de la cuenta de Astryum
   * que hizo `POST /runs`. Hasta hoy un exchange no tenía dueño: la ruta leía la
   * sesión para comprobar el omnibus y la TIRABA, así que no había nada por lo que
   * filtrar y `GET /runs` devolvía todos a cualquiera. Ausente en los runs
   * anteriores a esta fecha (crear siempre fue de admin: esos son de los
   * fundadores) y en un alta hecha solo con la llave del panel, sin sesión.
   * JAMÁS sale en un cuerpo de respuesta.
   */
  createdByUserId?: string;
  /** The simulated exchange backend fulfils client requests on its own (needs the omnibus key on the server). */
  autopilot?: boolean;
  clients: DemoClient[];
  receipts: Receipt[];
  requests?: ClientRequest[];
  /** Omnibus payments the founder desk composed by hand and that may be in flight. */
  deskPayments?: DeskPayment[];
  /** Omnibus 0xFE payments an operator marked as not a client movement. */
  externalFe?: ExternalFe[];
  /**
   * Captive XRPL accounts this tenant gave birth to (a family/Legacy, a
   * company): pointers plus the hash of every ceremony step. Their STATE —
   * signer list, disabled master, live credentials — is read fresh from the
   * ledger, never stored. See services/demoExchange/structures.ts.
   */
  structures?: DemoStructure[];
  /**
   * Monotonic save counter (compare-and-set): a save of a copy whose version is
   * not the stored one is refused. Absent on runs saved before it = 0.
   */
  version?: number;
  /** Unique stamp of the last save — what the read-back compares. */
  savedStamp?: string;
  /** Ledger movements already applied (xrpl tx hashes) so a re-scan never double-credits. */
  appliedTxHashes: string[];
  /**
   * Per client, the XRPL accounts the WATCHER saw pay a credited deposit in.
   * Written ONLY by syncOmnibus when it credits a deposit (never by a route),
   * so it is the proof a payout wallet can be checked against — receipts
   * cannot be, because a public route adds them.
   */
  provenDepositSenders?: Record<string, string[]>;
}

export function requestsOf(run: DemoRun): ClientRequest[] {
  if (!run.requests) run.requests = [];
  return run.requests;
}

export function deskPaymentsOf(run: DemoRun): DeskPayment[] {
  if (!run.deskPayments) run.deskPayments = [];
  return run.deskPayments;
}

/* ── run seq: a monotonic high-water mark ────────────────────────────────── */

/**
 * The classic tag space is seq×100+ordinal. Taking seq = max(LIVE runs)+1 reused
 * the seq of a deleted last run — and a late tagged return to one of its clients
 * landed on a client of the NEW run. The highest seq
 * ever allocated is persisted apart from the runs, so deleting a run never frees
 * its seq.
 */
export const DEMO_SEQ_JOB_TYPE = 'demo-exchange-seq';
const SEQ_KEY_FIELD = 'key';
const SEQ_KEY = 'high-water';
let seqHighWaterMemory = 0;

/** Pure: the seq of a new run — above every live run AND every seq ever allocated. */
export function nextRunSeq(liveRuns: Array<Pick<DemoRun, 'seq'>>, highWater: number): number {
  const liveMax = liveRuns.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0);
  return Math.max(liveMax, Number.isFinite(highWater) ? highWater : 0) + 1;
}

/**
 * The persisted high-water mark. STRICT: a database that cannot be read throws —
 * «could not read» must not read as 0 and hand out a used seq. Without a
 * database the in-process copy is the mark.
 */
export async function readSeqHighWater(): Promise<number> {
  let fromDb = 0;
  if (process.env.DATABASE_URL) {
    const row = await kvGetStrict(DEMO_SEQ_JOB_TYPE, SEQ_KEY_FIELD, SEQ_KEY);
    const n = Number(row?.seq ?? 0);
    fromDb = Number.isFinite(n) ? n : 0;
  }
  seqHighWaterMemory = Math.max(seqHighWaterMemory, fromDb);
  return seqHighWaterMemory;
}

/**
 * Raise the mark to `seq` (never lowers it). Call under the `__runs__` lock.
 *
 * THROWS unless the database PROVES the mark ≥ seq: `kvUpsert` swallows a
 * database error, so a plain await proved nothing and a restart handed the seq
 * out again. The comparison is against the DATABASE copy,
 * not the in-process one — a mark raised in memory by a failed write must not
 * make the retry skip the write.
 */
export async function bumpSeqHighWater(seq: number): Promise<void> {
  seqHighWaterMemory = Math.max(seqHighWaterMemory, seq);
  if (!process.env.DATABASE_URL) return;
  const row = await kvGetStrict(DEMO_SEQ_JOB_TYPE, SEQ_KEY_FIELD, SEQ_KEY);
  const stored = Number(row?.seq ?? 0);
  if (Number.isFinite(stored) && stored >= seq) return;
  await kvUpsert(DEMO_SEQ_JOB_TYPE, SEQ_KEY_FIELD, SEQ_KEY, { [SEQ_KEY_FIELD]: SEQ_KEY, seq });
  const back = await kvGetStrict(DEMO_SEQ_JOB_TYPE, SEQ_KEY_FIELD, SEQ_KEY);
  const persisted = Number(back?.seq ?? NaN);
  if (!Number.isFinite(persisted) || persisted < seq) {
    throw new Error(`SEQ_HIGH_WATER_NOT_PERSISTED: the run sequence mark ${seq} could not be verified in the database`);
  }
}

/* ── tag ranges: every range ever assigned, per omnibus ──────────────────── */

/**
 * The seq high-water protects only the classic seq×100 space. A DECLARED range
 * (CONECTA) of a deleted run was checked against LIVE runs only, so a new run
 * could take it — and a late tagged FAssets return to a deleted run's client was
 * credited as 'return' to the new run's client. Every range
 * ever assigned is persisted apart from the runs and never freed.
 */
export const DEMO_TAG_RANGES_JOB_TYPE = 'demo-exchange-tag-ranges';
const TAG_RANGES_KEY_FIELD = 'key';
const TAG_RANGES_KEY = 'assigned';

export interface AssignedTagRange {
  runId: string;
  seq: number;
  omnibusAddress: string;
  base: number;
  count: number;
  assignedAt: string;
}

let tagRangesMemory: AssignedTagRange[] = [];

function mergeRanges(a: AssignedTagRange[], b: AssignedTagRange[]): AssignedTagRange[] {
  const byRun = new Map<string, AssignedTagRange>();
  for (const r of [...a, ...b]) if (r && typeof r.runId === 'string' && !byRun.has(r.runId)) byRun.set(r.runId, r);
  return Array.from(byRun.values());
}

/** STRICT: a database that cannot be read throws — «could not read» is never «no range was assigned». */
export async function readAssignedTagRanges(): Promise<AssignedTagRange[]> {
  if (process.env.DATABASE_URL) {
    const row = await kvGetStrict(DEMO_TAG_RANGES_JOB_TYPE, TAG_RANGES_KEY_FIELD, TAG_RANGES_KEY);
    const fromDb = Array.isArray(row?.ranges) ? (row!.ranges as AssignedTagRange[]) : [];
    tagRangesMemory = mergeRanges(tagRangesMemory, fromDb);
  }
  return tagRangesMemory.map((r) => ({ ...r }));
}

/**
 * Add a range to the ledger (idempotent per runId). THROWS unless read back from
 * the database — same discipline as the submission journal. Call under the
 * `__runs__` lock, BEFORE the run is saved (or deleted).
 */
export async function recordAssignedTagRange(entry: AssignedTagRange): Promise<void> {
  const current = await readAssignedTagRanges();
  if (current.some((r) => r.runId === entry.runId)) return;
  const next = mergeRanges(current, [entry]);
  if (process.env.DATABASE_URL) {
    await kvUpsert(DEMO_TAG_RANGES_JOB_TYPE, TAG_RANGES_KEY_FIELD, TAG_RANGES_KEY, { [TAG_RANGES_KEY_FIELD]: TAG_RANGES_KEY, ranges: next });
    const back = await kvGetStrict(DEMO_TAG_RANGES_JOB_TYPE, TAG_RANGES_KEY_FIELD, TAG_RANGES_KEY);
    const stored = Array.isArray(back?.ranges) ? (back!.ranges as AssignedTagRange[]) : [];
    const ok = stored.some((r) => r.runId === entry.runId && r.base === entry.base && r.count === entry.count && r.omnibusAddress === entry.omnibusAddress);
    if (!ok) throw new Error(`TAG_RANGES_NOT_PERSISTED: the tag range of ${entry.runId} could not be verified in the database`);
  }
  tagRangesMemory = next;
}

function rangesOverlap(a: { base: number; count: number }, b: { base: number; count: number }): boolean {
  return a.base <= b.base + b.count - 1 && b.base <= a.base + a.count - 1;
}

export interface TagRangeClash {
  source: 'live' | 'assigned' | 'unrecorded-classic';
  label: string;
  base: number;
  count: number;
}

/**
 * Pure: does `mine` (on `omnibus`) overlap any range that is or ever was a run's?
 *  · live runs and the assigned-range ledger — on the SAME omnibus;
 *  · the classic space of every seq ≤ highWater that is neither live nor in the
 *    ledger (a run deleted before the ledger existed: its omnibus is unknown, so
 *    its classic range counts on EVERY omnibus). Its declared range, if it had
 *    one, is unrecoverable — documented residual.
 */
export function findTagRangeClash(
  mine: { base: number; count: number },
  omnibus: string,
  liveRuns: Array<Pick<DemoRun, 'runId' | 'seq' | 'label' | 'omnibusAddress' | 'tagBase' | 'tagCount'>>,
  assigned: AssignedTagRange[],
  highWater: number,
): TagRangeClash | null {
  for (const r of liveRuns) {
    if (r.omnibusAddress !== omnibus) continue;
    const other = runTagRange(r);
    if (rangesOverlap(mine, other)) return { source: 'live', label: `run "${r.label}"`, ...other };
  }
  for (const a of assigned) {
    if (a.omnibusAddress !== omnibus) continue;
    if (rangesOverlap(mine, a)) return { source: 'assigned', label: `the range of run ${a.runId} (seq ${a.seq}, deleted or live)`, base: a.base, count: a.count };
  }
  const known = new Set<number>([...liveRuns.map((r) => Number(r.seq)), ...assigned.map((a) => Number(a.seq))]);
  const hw = Number.isFinite(highWater) ? Math.floor(highWater) : 0;
  for (let s = 1; s <= hw; s++) {
    if (known.has(s)) continue;
    const classic = runTagRange({ seq: s });
    if (rangesOverlap(mine, classic)) return { source: 'unrecorded-classic', label: `the classic tags of seq ${s} (a run deleted before ranges were recorded)`, ...classic };
  }
  return null;
}

/**
 * The run's tag range, ALWAYS defined: the declared reserve (CONECTA) or the
 * classic demo space derived from seq. This is the classification boundary the
 * watcher enforces — a tag outside it is never this run's money.
 */
export function runTagRange(run: Pick<DemoRun, 'seq' | 'tagBase' | 'tagCount'>): { base: number; count: number } {
  if (run.tagBase !== undefined) return { base: run.tagBase, count: run.tagCount ?? 100 };
  return { base: run.seq * 100 + 1, count: 99 };
}

/**
 * Tag space. Default: run.seq × 100 + ordinal (1…99) — a fresh demo omnibus.
 * With a declared range (CONECTA, live omnibus): sequential from tagBase, and
 * the capacity is the range width — a real exchange is not capped at 99.
 */
export function nextClientTag(run: Pick<DemoRun, 'seq' | 'clients' | 'tagBase' | 'tagCount'>): number {
  const { base, count } = runTagRange(run);
  if (run.clients.length >= count) {
    throw new Error(`DEMO_RUN_FULL: this run's tag range holds at most ${count} clients`);
  }
  if (run.tagBase !== undefined) return base + run.clients.length;
  return run.seq * 100 + run.clients.length + 1;
}

export function newId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

/* ── in-memory mirror (also the fallback when there is no DATABASE_URL) ───── */
const memory = new Map<string, DemoRun>();

/**
 * Every load hands out its OWN copy and every save stores its own copy. Before,
 * the in-memory path returned the shared object: a handler that mutated it and
 * then refused (a 409 after setting a label) leaked a half-applied change, and
 * a "snapshot" taken for a slow verification was the live object.
 */
function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serialize(run: DemoRun): Record<string, unknown> {
  return { ...run, [KEY_FIELD]: run.runId } as unknown as Record<string, unknown>;
}

export type DemoRunStoreErrorCode = 'RUN_NOT_PERSISTED' | 'RUN_UNREADABLE' | 'RUN_VERSION_CONFLICT';

/**
 * The run store could not PROVE what a caller needs: the save did not land (or
 * was not read back), the stored run could not be read, or another writer saved
 * a newer version. Routes answer 503 and say nothing was recorded.
 */
export class DemoRunStoreError extends Error {
  constructor(public readonly code: DemoRunStoreErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'DemoRunStoreError';
  }
}

function storedVersion(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Save with compare-and-set and read-back. Before, memory
 * was set first and `kvUpsert` swallowed a database error: the next load
 * preferred the database copy, so a reservation or a debit silently disappeared
 * and the same balance could be paid twice.
 */
export async function saveRun(run: DemoRun): Promise<void> {
  const expected = storedVersion(run.version);
  const next: DemoRun = { ...copyOf(run), version: expected + 1, savedStamp: newId('sv') };
  if (process.env.DATABASE_URL) {
    let outcome: KvCasOutcome;
    try {
      outcome = await kvCompareAndSet(DEMO_RUN_JOB_TYPE, KEY_FIELD, run.runId, serialize(next), { versionField: 'version', expectedVersion: expected, createIfAbsent: true });
    } catch (e) {
      throw new DemoRunStoreError('RUN_NOT_PERSISTED', `the run could not be written (${(e as Error).message.slice(0, 80)})`);
    }
    if (outcome !== 'written') {
      throw new DemoRunStoreError('RUN_VERSION_CONFLICT', `the run was saved by another writer (this copy is version ${expected}, the database holds another)`);
    }
    let back: Record<string, unknown> | null;
    try {
      back = await kvGetStrict(DEMO_RUN_JOB_TYPE, KEY_FIELD, run.runId);
    } catch (e) {
      throw new DemoRunStoreError('RUN_NOT_PERSISTED', `the save could not be read back (${(e as Error).message.slice(0, 80)})`);
    }
    if (!back || storedVersion(back.version) !== next.version || back.savedStamp !== next.savedStamp) {
      throw new DemoRunStoreError('RUN_NOT_PERSISTED', `the save of version ${next.version} is not what the database holds`);
    }
  } else {
    const mem = memory.get(run.runId);
    if (mem && storedVersion(mem.version) !== expected) {
      throw new DemoRunStoreError('RUN_VERSION_CONFLICT', `the run was saved by another writer (stored version ${storedVersion(mem.version)}, this copy ${expected})`);
    }
  }
  memory.set(run.runId, copyOf(next));
  run.version = next.version;
  run.savedStamp = next.savedStamp;
}

/**
 * With a database: STRICT — a read error throws (RUN_UNREADABLE), an absent row
 * is null. Never the in-process copy: it may be a version the database never
 * accepted. Without a database: the in-process copy.
 */
export async function loadRun(runId: string): Promise<DemoRun | null> {
  if (process.env.DATABASE_URL) {
    let fromDb: Record<string, unknown> | null;
    try {
      fromDb = await kvGetStrict(DEMO_RUN_JOB_TYPE, KEY_FIELD, runId);
    } catch (e) {
      throw new DemoRunStoreError('RUN_UNREADABLE', `the run could not be read (${(e as Error).message.slice(0, 80)})`);
    }
    if (!fromDb) return null;
    memory.set(runId, copyOf(fromDb as unknown as DemoRun));
    return copyOf(fromDb as unknown as DemoRun);
  }
  const mem = memory.get(runId);
  return mem ? copyOf(mem) : null;
}

export async function listRuns(): Promise<DemoRun[]> {
  // «NO RUNS» AND «I COULD NOT READ» ARE NOT THE SAME SENTENCE. This
  // list is what declares each run's omnibus to the 0xFE seat guard: read with
  // the best-effort `kvList`, a database outage answered «no runs», the omnibus
  // stopped being an account this deployment operates, and its nonce seat became
  // takeable by any session while client XRP sat in the Core Vault. The strict
  // read throws instead, and the resolver keeps its last good snapshot (or says
  // «unknown», which refuses an entry and still composes an exit).
  let fromDb: DemoRun[];
  try {
    fromDb = (await kvListStrict(DEMO_RUN_JOB_TYPE, 200)) as unknown as DemoRun[];
  } catch (e) {
    throw new DemoRunStoreError('RUN_UNREADABLE', `the exchange ledger could not be read (${(e as Error).message.slice(0, 80)})`);
  }
  // Newest first: a duplicate row of a run never overwrites the newer copy (the one saveRun writes and loadRun reads).
  const seen = new Set<string>();
  for (const r of fromDb) {
    if (!r || typeof r.runId !== 'string' || seen.has(r.runId)) continue;
    seen.add(r.runId);
    memory.set(r.runId, copyOf(r));
  }
  return Array.from(memory.values()).map((r) => copyOf(r)).sort((a, b) => b.seq - a.seq);
}

export async function deleteRun(runId: string): Promise<void> {
  memory.delete(runId);
  await kvDelete(DEMO_RUN_JOB_TYPE, KEY_FIELD, runId);
}

/* ── per-run mutual exclusion ────────────────────────────────────────────── */

/**
 * `withRunLock(runId, fn)` — an in-process async mutex per run. Every writer of
 * a run (the HTTP routes and the autopilot) does load → mutate → save INSIDE it,
 * with a FRESH load, so no writer can save a stale copy over another's work.
 * The failure it closes: a public /verify loaded the run, verified for seconds,
 * and saved the whole run back — erasing a request the autopilot had minted
 * meanwhile, restoring its balance, and letting a new request mint again.
 */
const runLocks = new Map<string, Promise<void>>();

export async function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = runLocks.get(runId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  runLocks.set(runId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (runLocks.get(runId) === tail) runLocks.delete(runId);
  }
}

/** Test hook — never called by production code. */
export function __resetDemoExchangeMemoryForTests(): void {
  memory.clear();
  seqHighWaterMemory = 0;
  tagRangesMemory = [];
}

/* ── ledger math (pure) ──────────────────────────────────────────────────── */

export type LedgerMovement =
  | { kind: 'deposit'; clientId: string; drops: string; txHash: string }
  | { kind: 'return'; clientId: string; drops: string; txHash: string }
  | { kind: 'put-to-work'; clientId: string; drops: string; txHash: string }
  | { kind: 'withdraw'; clientId: string; drops: string; txHash: string };

/**
 * Apply movements to the run's ledger, idempotently by tx hash. Returns the
 * movements that were NEW (for the caller to turn into receipts). Balances are
 * clamped at zero: the ledger mirrors the chain, it never pretends to owe.
 */
/**
 * One canonical key per (direction, tx). The direction — not the kind — is the
 * key on purpose: a payment INTO the omnibus is credited once whether the
 * watcher first read it as 'return' (sender unknown) and later as 'deposit'
 * (the client registered their wallet in between). Keying by kind double-
 * credited exactly that case (bug found in review).
 */
export function movementKey(kind: LedgerMovement['kind'], txHash: string): string {
  const direction = kind === 'deposit' || kind === 'return' ? 'in' : 'out';
  return `${direction}:${txHash.toUpperCase()}`;
}

export function applyMovements(run: DemoRun, movements: LedgerMovement[]): LedgerMovement[] {
  const applied = new Set(run.appliedTxHashes);
  const fresh: LedgerMovement[] = [];
  for (const m of movements) {
    const key = movementKey(m.kind, m.txHash);
    if (applied.has(key)) continue;
    const client = run.clients.find((c) => c.id === m.clientId);
    if (!client) continue;
    const before = BigInt(client.xrpOnExchangeDrops || '0');
    const delta = BigInt(m.drops);
    const after = m.kind === 'deposit' || m.kind === 'return' ? before + delta : before - delta;
    client.xrpOnExchangeDrops = (after < BigInt(0) ? BigInt(0) : after).toString();
    applied.add(key);
    run.appliedTxHashes.push(key);
    fresh.push(m);
  }
  return fresh;
}

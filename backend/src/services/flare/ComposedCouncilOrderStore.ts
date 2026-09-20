/**
 * ComposedCouncilOrderStore — the server-side memory of every council order
 * COMPOSED for a signature (2026-09-14; hardened in productizer it. 13).
 *
 * THE GAP. `/pote-council-order/prepare` and `/cage-order/prepare` compose an
 * order that one account signs in Xaman (`XamanSingleSign`); the Legacy door
 * `/xrpl-defi/council-order/prepare` composes one a quorum signs. The relay to
 * Flare (POST /xrpl-defi/council-order/relay) was launched ONLY by the parent's
 * `onSettled` in the browser. If that component unmounted or the page reloaded
 * while the ledger was confirming, the SIGNED order was never relayed — and after
 * 14 days the FDC can no longer attest it. Nothing on the server knew the order
 * existed.
 *
 * THE RULE NOW. Every composed order is recorded here BEFORE it is handed to the
 * user: its memo (the keccak256 commitment the ledger will carry), the exact
 * `orderData`, the council account, the Destination/Amount of the Payment, the
 * pinned Sequence / LastLedgerSequence and the validated ledger it was composed
 * on. The relay launcher's periodic sweep (`sweepComposedCouncilOrders`) reads the
 * council's `account_tx` from that ledger and, when a validated tesSUCCESS Payment
 * from the council carries the memo, launches the SAME idempotent relay POST relay
 * uses — no browser needed.
 *
 * it. 13 — what the sweep could not see, and now can:
 *  · ALL live records, oldest first, paginated straight from the table (it read
 *    only the newest 200, so 200 compositions pushed a legitimate order out);
 *  · a cap of `MAX_LIVE_ORDERS_PER_COUNCIL` live unlaunched compositions per
 *    council (composing needs no seat, so the table was unbounded) — an EXIT is
 *    never refused by it;
 *  · every write and every forget is a CAS on the record as read (`version` +
 *    `composedAt`): a re-composition during a scan is left for the next pass,
 *    never overwritten or deleted;
 *  · a scan that hits its page cap keeps the progress it fully read;
 *  · a terminal verdict leaves a short-lived FATE (`COMPOSED_ORDER_FATE_JOB`) so
 *    `GET /council-order/fate` can still answer after the record is gone.
 *
 * it. 15 — WHO composes counts, and against WHOM:
 *  · every record carries `preparedByUserId` and `preparedByProven` (the session
 *    controls the council: it proved the account, or a proven address of the
 *    session sits in the council's SignerList — `sessionProvesCouncil`);
 *  · the cap is TWO queues, never one: a proven session has
 *    `MAX_LIVE_ORDERS_PER_COUNCIL`; an unproven one has
 *    `MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER` counted against ITS OWN preparer id
 *    only. A stranger can no longer fill a council's queue: their records are
 *    invisible to the manager's count (finding 2.1);
 *  · an EXIT is recorded whenever the database works — the cap never gets a vote
 *    on it («LA SALIDA JAMÁS SE GATEA»);
 *  · every record carries a `contentKey` (council + action + canonical params) so
 *    the duplicate guard can ask «did THIS order already go out?» by content
 *    instead of by relay state (finding 2.2).
 *
 * STRICT WRITE. With a database configured, the record is written and READ BACK;
 * a failed or mismatched read-back throws `ComposedOrderUnrecordedError`. Without
 * DATABASE_URL (local dev) there is nothing to persist into and the order is
 * composed as before.
 *
 * The record is payload material, never a trigger: an order the council never
 * signs is inert, and expires when its LastLedgerSequence passes (or after the
 * FDC window). Prepare-only: this reads the ledger and remembers bytes. It never
 * signs, never submits, never holds a key.
 */

import { createHash } from 'crypto';
import { ethers } from 'ethers';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

/** Private jobType — invisible to every other poller of `background_jobs`. */
export const COMPOSED_ORDER_JOB = 'council-order-composed';

/** Terminal verdicts of forgotten records, kept for the fate read (pruned at the TTL). */
export const COMPOSED_ORDER_FATE_JOB = 'council-order-fate';

/** The FDC only attests transactions younger than 14 days: past that, nothing to deliver. */
export const COMPOSED_ORDER_TTL_MS = 14 * 86_400_000;

/** Safety cap of one `account_tx` scan per pass. Hitting it keeps only what was FULLY read. */
export const COMPOSED_SCAN_MAX_PAGES = 20;

/**
 * Live, unlaunched compositions a PROVEN session may hold for one council. Beyond
 * it a non-exit is 429 (an exit is always recorded).
 */
export const MAX_LIVE_ORDERS_PER_COUNCIL = 50;

/**
 * it. 15 (finding 2.1) — live compositions ONE UNPROVEN PREPARER may hold for one
 * council. Counted per (council, preparer): a stranger fills only their own bucket,
 * and the manager who proves the account never sees it.
 */
export const MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER = 10;

const LIST_PAGE_SIZE = 200;
/** Hard ceiling of one full listing (a bug guard, far above 50 per council × councils). */
const LIST_MAX_ROWS = 50_000;
const COUNCIL_LIST_MAX_ROWS = 1_000;

export type ComposedOrderRoute = 'pote-council-order' | 'cage-order' | 'legacy-council-order';

export interface ComposedCouncilOrder extends Record<string, unknown> {
  /** 64 uppercase hex — the MemoData of the pinned Payment; the record key. */
  memoHex: string;
  /** 0x… lowercase, = 0x + memoHex. */
  orderHash: string;
  /** 0x… the committed bytes (keccak256(orderData) === orderHash). */
  orderData: string;
  /** The XRPL account that signs (r…). */
  council: string;
  route: ComposedOrderRoute;
  action: string;
  /** The Sequence stamped on the LATEST composition of this order (the account's, for the Legacy door). */
  sequence: number;
  /** null when any composition was for a SignerList account (no window stamped). */
  lastLedgerSequence: number | null;
  /** The EARLIEST validated ledger this order was composed on — where the scan starts. */
  composedLedgerIndex: number;
  /** ISO time of the LATEST composition — the TTL clock. */
  composedAt: string;
  /** Payment Destination as composed (the server-side exit classification compares it). */
  destination?: string;
  /** Payment Amount as composed, canonical string. */
  amount?: string;
  /** Monotonic write counter — the CAS token. Absent on rows older than it. 13. */
  version?: number;
  /** it. 15: the Astryum user id of the session that composed it (null: none/CLI/older row). */
  preparedByUserId?: string | null;
  /** it. 15: that session CONTROLS this council (proved the account, or holds a seat in its SignerList). */
  preparedByProven?: boolean;
  /** it. 15: council + action + canonical params — what makes two orders «the same order». */
  contentKey?: string;
  /** Highest ledger a scan FULLY covered (from the start) without finding the memo. */
  scannedThroughLedger?: number;
  /**
   * The validated XRPL tx the sweep found for this order: its relay was launched,
   * or (it. 15, relayer off) it waits, marked, for the relayer to be switched on.
   */
  launchedXrplTxHash?: string;
  /** ISO time the sweep found it validated (and launched the relay, when it could). */
  launchedAt?: string;
}

export class ComposedOrderUnrecordedError extends Error {
  readonly code = 'ORDER_RECOVERY_UNRECORDED';
  constructor(memoHex: string, cause: string) {
    super(
      `No se pudo guardar la orden compuesta ${memoHex.slice(0, 16)}… para su entrega automática (${cause}). ` +
        'No se entrega una orden firmable sin esa memoria: si la pantalla que la firma se cerrara, nadie la llevaría a Flare. ' +
        'Nada se ha preparado; vuelve a intentarlo.',
    );
    this.name = 'ComposedOrderUnrecordedError';
  }
}

export class TooManyPendingOrdersError extends Error {
  readonly code = 'TOO_MANY_PENDING_ORDERS';
  /** Which queue filled up: the council's own (proven session) or this preparer's. */
  readonly bucket: 'council' | 'preparer';
  readonly limit: number;
  constructor(
    readonly council: string,
    readonly live: number,
    opts: { bucket?: 'council' | 'preparer'; limit?: number } = {},
  ) {
    const bucket = opts.bucket ?? 'council';
    const limit = opts.limit ?? (bucket === 'council' ? MAX_LIVE_ORDERS_PER_COUNCIL : MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER);
    super(
      bucket === 'council'
        ? `This account already has ${live} composed orders waiting to be signed or to reach the ledger ` +
            `(the limit is ${limit}). Sign or let those expire before composing another one — ` +
            'single-sign orders expire on their own within minutes; a council (SignerList) order is remembered up to 14 days.'
        : `You already have ${live} orders composed for this account and not yet signed (the limit is ${limit} ` +
            'for a session that has not proven it controls this account). Sign or let those expire before composing ' +
            'another one — or connect the wallet that controls this account, which has its own, larger queue. ' +
            'An exit (recall / evacuate) is never refused by this limit.',
    );
    this.name = 'TooManyPendingOrdersError';
    this.bucket = bucket;
    this.limit = limit;
  }
}

const HEX64 = /^[0-9A-F]{64}$/;
const XRPL_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function isSafePositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
}

async function getPrisma() {
  const { prisma } = await import('../../database/prismaClient');
  return prisma;
}

function asJson(payload: Record<string, unknown>): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}

function normMemo(memoHex: unknown): string {
  return typeof memoHex === 'string' ? memoHex.trim().replace(/^0x/i, '').toUpperCase() : '';
}

const jsonEq = (field: string, equals: string | number): Prisma.BackgroundJobWhereInput => ({
  payload: { path: [field], equals },
});

/** The row as READ: same memo, same composition time and, when present, same version. */
function casWhere(expected: ComposedCouncilOrder): Prisma.BackgroundJobWhereInput {
  const and: Prisma.BackgroundJobWhereInput[] = [jsonEq('memoHex', expected.memoHex), jsonEq('composedAt', expected.composedAt)];
  if (typeof expected.version === 'number') and.push(jsonEq('version', expected.version));
  return { jobType: COMPOSED_ORDER_JOB, AND: and };
}

/** The first MemoData of a Payment, uppercase — or '' when there is none. */
export function firstMemoHex(tx: unknown): string {
  const memos = (tx as { Memos?: Array<{ Memo?: { MemoData?: unknown } }> } | null)?.Memos;
  const data = Array.isArray(memos) ? memos[0]?.Memo?.MemoData : undefined;
  return typeof data === 'string' ? data.toUpperCase() : '';
}

/**
 * it. 15 (finding 2.2) — WHAT MAKES TWO ORDERS «THE SAME ORDER».
 *
 * Not the memo (it commits the bridge NONCE, so the re-composition that moves the
 * capital twice carries a different one) and not the relay state (an executed order
 * is exactly when the double is possible). It is the CONTENT: the same account, the
 * same action and the same parameters — the amount, the venue / bridge / pote, the
 * destination. `cage-create` then `set-user-gate`, or venue 0 then venue 1, are
 * different content and never collide.
 *
 * Values are normalized so `0` and `"0"`, `0xAB…` and `0xab…`, ` r… ` and `r…` are
 * the same parameter.
 *
 * it. 17 (finding 2.4) — TWO THINGS THAT LET THE SAME ORDER THROUGH TWICE:
 *   · ARRAYS KEPT THEIR ORDER. `venues: [1, 0]` and `venues: [0, 1]` ask the cage for
 *     exactly the same thing and hashed to two different keys, so the second one was
 *     not a duplicate of anything. Arrays are SORTED by their canonical form before
 *     hashing (object keys already were), so the key is the SET the person asked for.
 *     Deliberate: no council order's meaning depends on the order of a list — an
 *     action whose meaning ever does must carry its order in a named field, not in
 *     the position of an element.
 *   · THE KEY WAS TAKEN FROM `req.body.params`. Anything the server derives on the
 *     way to composing (a resolved `feePayer`) was outside it, and so was any extra
 *     field the caller added — one unused key and the order was «different». The
 *     key is now computed from the params the BUILDER actually used (see the
 *     `/cage-order` call site), which is the only thing that decides what moves.
 */
export function councilOrderContentKey(input: { council: string; action: string; params?: unknown }): string {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      return /^0x[0-9a-fA-F]+$/.test(t) ? t.toLowerCase() : t;
    }
    if (Array.isArray(v)) {
      const items = v.map(norm);
      // Sorted by the canonical JSON of each item: a total, stable order that does
      // not depend on the element's type (a number, an address, a nested object).
      return items
        .map((item) => ({ item, key: JSON.stringify(item ?? null) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((e) => e.item);
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        if (obj[k] === undefined) continue;
        out[k] = norm(obj[k]);
      }
      return out;
    }
    return String(v);
  };
  const canonical = JSON.stringify({ v: 1, council: input.council.trim(), action: String(input.action ?? '').trim(), params: norm(input.params ?? {}) });
  return createHash('sha256').update(canonical).digest('hex');
}

/** An XRPL Amount as a comparable string: drops verbatim, an IOU object with sorted keys. */
export function canonicalXrplAmount(amount: unknown): string | undefined {
  if (typeof amount === 'string') return amount;
  if (amount && typeof amount === 'object' && !Array.isArray(amount)) {
    const obj = amount as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`)
      .join(',')}}`;
  }
  return undefined;
}

/** Shape check of a stored row: anything else is dropped by the sweep. */
export function parseComposedOrder(row: Record<string, unknown> | null | undefined): ComposedCouncilOrder | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Partial<ComposedCouncilOrder>;
  if (typeof r.memoHex !== 'string' || !HEX64.test(r.memoHex)) return null;
  if (typeof r.orderData !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.orderData)) return null;
  if (typeof r.council !== 'string' || !XRPL_ADDRESS.test(r.council)) return null;
  if (!isSafePositiveInt(r.composedLedgerIndex)) return null;
  if (typeof r.composedAt !== 'string' || !Number.isFinite(Date.parse(r.composedAt))) return null;
  if (r.lastLedgerSequence !== null && !isSafePositiveInt(r.lastLedgerSequence)) return null;
  return row as ComposedCouncilOrder;
}

/**
 * STRICT read of one record by memo: a database failure THROWS («could not read»
 * is never «absent»); null only when the database answered without it, or there
 * is no database.
 */
export async function getComposedCouncilOrderStrict(memoHex: string): Promise<ComposedCouncilOrder | null> {
  const memo = normMemo(memoHex);
  if (!HEX64.test(memo) || !process.env.DATABASE_URL) return null;
  const prisma = await getPrisma();
  const row = await prisma.backgroundJob.findFirst({
    where: { jobType: COMPOSED_ORDER_JOB, ...jsonEq('memoHex', memo) },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  return parseComposedOrder(row?.payload as Record<string, unknown> | null | undefined);
}

/**
 * STRICT: the records of one council, NEWEST FIRST (it. 15, finding 2.5 — the cap
 * and the duplicate guard have to see what was just composed, and a council past
 * `COUNCIL_LIST_MAX_ROWS` used to answer with its oldest thousand only).
 * Deduplicated by memo. Throws on a database failure; [] without a database.
 *
 * `filter` narrows the READ as well as the result, so a proven manager's count
 * never pages through a stranger's records: `proven: true` counts only records
 * composed by a session that controls the council; `preparedByUserId` only that
 * preparer's; `contentKey` only the same order content.
 */
export async function listComposedCouncilOrdersForCouncil(
  council: string,
  filter: { proven?: boolean; preparedByUserId?: string | null; contentKey?: string } = {},
): Promise<ComposedCouncilOrder[]> {
  if (!process.env.DATABASE_URL) return [];
  const prisma = await getPrisma();
  const and: Prisma.BackgroundJobWhereInput[] = [jsonEq('council', council)];
  if (filter.proven === true) and.push({ payload: { path: ['preparedByProven'], equals: true } });
  if (typeof filter.preparedByUserId === 'string' && filter.preparedByUserId.length > 0) {
    and.push(jsonEq('preparedByUserId', filter.preparedByUserId));
  }
  if (typeof filter.contentKey === 'string' && filter.contentKey.length > 0) and.push(jsonEq('contentKey', filter.contentKey));
  const rows = await prisma.backgroundJob.findMany({
    where: { jobType: COMPOSED_ORDER_JOB, AND: and },
    orderBy: { createdAt: 'desc' },
    take: COUNCIL_LIST_MAX_ROWS,
    select: { payload: true },
  });
  const byMemo = new Map<string, ComposedCouncilOrder>();
  for (const row of rows) {
    const r = parseComposedOrder(row.payload as Record<string, unknown> | null);
    if (!r || r.council !== council) continue;
    if (filter.proven === true && r.preparedByProven !== true) continue;
    if (typeof filter.contentKey === 'string' && filter.contentKey.length > 0 && r.contentKey !== filter.contentKey) continue;
    if (!byMemo.has(r.memoHex)) byMemo.set(r.memoHex, r);
  }
  return [...byMemo.values()];
}

/**
 * The compositions that still hold a place in the council's queue: not launched,
 * inside the FDC window, and — for a pinned single-sign order — with its window
 * still open on the ledger just read (`validatedLedgerIndex`) and its Sequence not
 * yet spent (`sequence`). A SignerList order (no window) counts until launched or
 * past the TTL: its coordinator pins a fresh Sequence at signing time.
 */
export function countLiveUnlaunchedOrders(
  records: ComposedCouncilOrder[],
  at: { now: number; sequence: number; validatedLedgerIndex: number },
  /**
   * it. 15: which queue is being counted. `proven: true` counts only what sessions
   * that CONTROL the council composed; `proven: false` counts only what THIS
   * preparer composed without proving it (a row with no preparer id counts for the
   * anonymous bucket alone). Omitted: everything, as before.
   */
  scope?: { proven: boolean; preparedByUserId?: string | null },
): number {
  const samePreparer = (r: ComposedCouncilOrder) => (r.preparedByUserId ?? null) === (scope?.preparedByUserId ?? null);
  return records.filter((r) => {
    if (scope?.proven === true && r.preparedByProven !== true) return false;
    if (scope?.proven === false && (r.preparedByProven === true || !samePreparer(r))) return false;
    if (r.launchedXrplTxHash) return false;
    const age = at.now - Date.parse(r.composedAt);
    if (!Number.isFinite(age) || age > COMPOSED_ORDER_TTL_MS) return false;
    if (r.lastLedgerSequence === null) return true;
    if (r.lastLedgerSequence < at.validatedLedgerIndex) return false;
    return !(typeof r.sequence === 'number' && r.sequence < at.sequence);
  }).length;
}

/**
 * it. 17 (finding 2.5) — THE CAP, DECIDED BEFORE THE CHAIN READS ARE SPENT.
 *
 * The 429 was raised inside `recordComposedCouncilOrder`, which runs LAST: by then
 * the door had already spent `isCageV2Council`, `readPoteState`, the cage resolution
 * and the Sequence pin. A caller with a full queue could therefore drive thousands
 * of RPC reads a minute without ever taking a place — the queue capped the RECORDS
 * and nothing capped the READS.
 *
 * This is the same count, asked with ONE database read and NO ledger read, so a door
 * can refuse before it spends anything. Because it cannot know the validated ledger
 * yet, it counts only the records that CANNOT have expired by ledger (no window at
 * all): a strict LOWER BOUND of the real queue. Under-counting is the only safe
 * direction — an early refusal built on it is one the real cap would raise too;
 * everything else still meets the authoritative cap at write time.
 *
 * Never throws: a store it cannot read answers «not full», because «I could not
 * read» must not become a refusal (the write-time cap will read it again anyway).
 */
/**
 * it. 19 (finding 2.6): the slowest a ledger can plausibly close. Used ONLY to bound
 * from below how long a pinned window is certainly still open — never to declare one
 * closed. XRPL closes a ledger every ~3.5-4 s; 2.5 s is the conservative floor.
 */
const MIN_LEDGER_CLOSE_MS = 2_500;

/** The widest window any door stamps (`ORDER_LEDGER_WINDOW`), as a cap on the estimate. */
const MAX_PINNED_WINDOW_LEDGERS = 150;

export function countQueueWithoutLedger(
  records: ComposedCouncilOrder[],
  now: number,
  scope?: { proven: boolean; preparedByUserId?: string | null },
): number {
  // ── it. 19 (finding 2.6) — THE PRE-CHECK WAS DEAD ON EXACTLY THE COUNCILS THAT
  //    COMPOSE THE MOST ───────────────────────────────────────────────────────
  //
  // WHAT FAILED: counting only the records with NO window is counting only multisig
  // (SignerList) orders — every single-sign order carries a `LastLedgerSequence`
  // (`ORDER_LEDGER_WINDOW`). So for a single-sig council the lower bound was always
  // zero, the pre-check never fired, and the door spent every chain read it exists to
  // save before the authoritative cap refused at the end.
  //
  // A windowed row is counted while its window CANNOT yet have closed: fewer than
  // (window in ledgers × the slowest a ledger closes) milliseconds have passed since
  // it was composed. That keeps the estimate a strict lower bound of what the ledger
  // would say about the WINDOW — it never counts a row whose window may have expired.
  //
  // THE ONE PLACE IT CAN OVER-COUNT, said out loud: a row whose Payment was signed
  // and APPLIED inside its own window, and which the five-minute sweep has not yet
  // marked `launchedXrplTxHash`. Its Sequence is spent, so the authoritative count
  // (which reads the ledger) would drop it. The consequence is bounded and never
  // touches a way out: an EXIT is never asked (`councilQueuePrecheck` returns early),
  // and the worst case for an entry is a 429 that says «sign or let those expire»
  // minutes before the real cap would have allowed one more.
  const withinCertainWindow = (r: ComposedCouncilOrder): boolean => {
    if (r.lastLedgerSequence === null) return true;
    const windowLedgers = Math.min(
      MAX_PINNED_WINDOW_LEDGERS,
      r.lastLedgerSequence - (typeof r.composedLedgerIndex === 'number' ? r.composedLedgerIndex : r.lastLedgerSequence),
    );
    if (!Number.isFinite(windowLedgers) || windowLedgers <= 0) return false;
    const age = now - Date.parse(r.composedAt);
    return Number.isFinite(age) && age < windowLedgers * MIN_LEDGER_CLOSE_MS;
  };
  return countLiveUnlaunchedOrders(records.filter(withinCertainWindow), { now, sequence: 0, validatedLedgerIndex: 0 }, scope);
}

export interface CouncilQueuePrecheck {
  full: boolean;
  live: number;
  limit: number;
  bucket: 'council' | 'preparer';
}

export async function councilQueuePrecheck(input: {
  council: string;
  proven: boolean;
  preparedByUserId?: string | null;
  /** An exit is never counted and never refused by the cap: it is never even asked. */
  exit?: boolean;
  now?: number;
  list?: typeof listComposedCouncilOrdersForCouncil;
}): Promise<CouncilQueuePrecheck | null> {
  if (input.exit === true) return null;
  const limit = input.proven ? MAX_LIVE_ORDERS_PER_COUNCIL : MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER;
  try {
    const list = input.list ?? listComposedCouncilOrdersForCouncil;
    const records = await list(
      input.council,
      input.proven ? { proven: true } : { preparedByUserId: input.preparedByUserId ?? null },
    );
    const live = countQueueWithoutLedger(records, input.now ?? Date.now(), {
      proven: input.proven,
      preparedByUserId: input.preparedByUserId ?? null,
    });
    return { full: live >= limit, live, limit, bucket: input.proven ? 'council' : 'preparer' };
  } catch (e) {
    console.warn(`[council] queue pre-check for ${input.council} could not be read: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/**
 * Remember one composed order. Called by the prepare routes AFTER the Payment is
 * pinned and BEFORE it is returned.
 *
 *  · no DATABASE_URL → `{ recorded: false, reason: 'no-database' }` (dev: composed as before);
 *  · the memo of the pinned tx must be the keccak256 of `orderData` — a mismatch
 *    is a composer bug and throws (nothing is relayable from it);
 *  · a NEW memo whose own queue is full throws `TooManyPendingOrdersError` — the
 *    council's queue (`MAX_LIVE_ORDERS_PER_COUNCIL`) for a session that CONTROLS the
 *    council, this preparer's (`MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER`) for one that
 *    does not (it. 15: a stranger's records are counted only against the stranger);
 *  · `exit: true` is NEVER counted and never refused by the cap: an exit is recorded
 *    whenever the database works («LA SALIDA JAMÁS SE GATEA»);
 *  · a re-composition of the SAME order (same memo — the bridge nonce did not
 *    move) keeps the EARLIEST ledger to scan from, the launch already made, and
 *    drops the window if any composition had none; it is a CAS on the record as
 *    read, retried on a concurrent change;
 *  · the write is read back strictly; anything but the same bytes throws
 *    `ComposedOrderUnrecordedError`.
 */
export async function recordComposedCouncilOrder(
  input: {
    route: ComposedOrderRoute;
    action: string;
    council: string;
    /** The Payment AS PINNED — what the user signs. */
    pinnedTx: Record<string, unknown>;
    order: { orderData: string; memoHex?: string; orderHash?: string };
    pin: { sequence: number; lastLedgerSequence: number | null; validatedLedgerIndex: number };
    /** it. 15: the session that composed it, and whether it controls the council. */
    preparedByUserId?: string | null;
    preparedByProven?: boolean;
    /** it. 15: `councilOrderContentKey({ council, action, params })` — the duplicate guard's key. */
    contentKey?: string;
    /** it. 15: an exit is recorded whenever the database works — the cap never sees it. */
    exit?: boolean;
  },
  now: () => number = Date.now,
): Promise<{ recorded: boolean; reason?: 'no-database'; record?: ComposedCouncilOrder }> {
  if (!process.env.DATABASE_URL) return { recorded: false, reason: 'no-database' };

  const memoHex = firstMemoHex(input.pinnedTx) || String(input.order.memoHex ?? '').toUpperCase();
  const orderData = String(input.order.orderData ?? '');
  if (!HEX64.test(memoHex)) throw new Error('the pinned order Payment carries no 32-byte memo');
  if (!/^0x[0-9a-fA-F]+$/.test(orderData)) throw new Error('order.orderData must be 0x-prefixed hex');
  if (ethers.keccak256(orderData).slice(2).toUpperCase() !== memoHex) {
    throw new Error('order.orderData does not hash to the memo of the pinned Payment — refusing to record it');
  }
  const destination = typeof input.pinnedTx.Destination === 'string' ? input.pinnedTx.Destination : undefined;
  const amount = canonicalXrplAmount(input.pinnedTx.Amount);

  for (let attempt = 0; attempt < 3; attempt++) {
    let existing: ComposedCouncilOrder | null;
    try {
      existing = await getComposedCouncilOrderStrict(memoHex);
    } catch (e) {
      throw new ComposedOrderUnrecordedError(memoHex, `lectura previa: ${(e as Error)?.message ?? e}`);
    }

    const sameCouncil = existing && existing.council === input.council ? existing : null;
    // THE CAP, BY WHOEVER IS COMPOSING (it. 15, finding 2.1). An exit is never
    // counted or refused here; a re-composition of an order already in the queue
    // takes no new place; and the two queues never see each other, so 50
    // compositions by a stranger cannot stop the manager who proves the account.
    const proven = input.preparedByProven === true;
    if (!sameCouncil && input.exit !== true) {
      const limit = proven ? MAX_LIVE_ORDERS_PER_COUNCIL : MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER;
      let live: number;
      try {
        const scope = proven
          ? { proven: true }
          : { proven: false, preparedByUserId: input.preparedByUserId ?? null };
        const records = await listComposedCouncilOrdersForCouncil(
          input.council,
          proven ? { proven: true } : { preparedByUserId: input.preparedByUserId ?? null },
        );
        live = countLiveUnlaunchedOrders(
          records,
          { now: now(), sequence: input.pin.sequence, validatedLedgerIndex: input.pin.validatedLedgerIndex },
          scope,
        );
      } catch (e) {
        throw new ComposedOrderUnrecordedError(memoHex, `lectura del tope: ${(e as Error)?.message ?? e}`);
      }
      if (live >= limit) {
        throw new TooManyPendingOrdersError(input.council, live, { bucket: proven ? 'council' : 'preparer', limit });
      }
    }

    const keepsProvenAttribution = sameCouncil?.preparedByProven === true && !proven;
    const lls =
      input.pin.lastLedgerSequence === null || (sameCouncil && sameCouncil.lastLedgerSequence === null)
        ? null
        : Math.max(input.pin.lastLedgerSequence, sameCouncil?.lastLedgerSequence ?? 0);
    const record: ComposedCouncilOrder = {
      memoHex,
      orderHash: '0x' + memoHex.toLowerCase(),
      orderData,
      council: input.council,
      route: input.route,
      action: input.action,
      sequence: input.pin.sequence,
      lastLedgerSequence: lls,
      composedLedgerIndex: Math.min(
        input.pin.validatedLedgerIndex,
        sameCouncil?.composedLedgerIndex ?? input.pin.validatedLedgerIndex,
      ),
      composedAt: new Date(now()).toISOString(),
      ...(destination ? { destination } : {}),
      ...(amount ? { amount } : {}),
      version: (existing?.version ?? 0) + 1,
      // Attribution never DOWNGRADES: once a session that controls the council has
      // composed this order, an unproven re-composition of the same bytes cannot
      // move it back into a stranger's bucket.
      preparedByProven: keepsProvenAttribution ? true : proven,
      preparedByUserId: (keepsProvenAttribution ? sameCouncil?.preparedByUserId : input.preparedByUserId) ?? null,
      ...(input.contentKey ?? sameCouncil?.contentKey ? { contentKey: input.contentKey ?? (sameCouncil?.contentKey as string) } : {}),
      ...(sameCouncil?.scannedThroughLedger ? { scannedThroughLedger: sameCouncil.scannedThroughLedger } : {}),
      ...(sameCouncil?.launchedXrplTxHash ? { launchedXrplTxHash: sameCouncil.launchedXrplTxHash } : {}),
      ...(sameCouncil?.launchedAt ? { launchedAt: sameCouncil.launchedAt } : {}),
    };
    // A re-composition never hides a ledger an earlier one could have validated in:
    // the scan keeps starting at the EARLIEST composition, and its progress marker
    // only ever covers ledgers from there on.
    let wrote: boolean;
    try {
      const prisma = await getPrisma();
      if (existing) {
        const r = await prisma.backgroundJob.updateMany({ where: casWhere(existing), data: { payload: asJson(record) } });
        wrote = r.count > 0;
      } else {
        await prisma.backgroundJob.create({ data: { jobType: COMPOSED_ORDER_JOB, status: 'completed', payload: asJson(record) } });
        wrote = true;
      }
    } catch (e) {
      throw new ComposedOrderUnrecordedError(memoHex, `escritura: ${(e as Error)?.message ?? e}`);
    }
    if (!wrote) continue; // changed under us (the sweep, another composition): re-read and retry

    let back: ComposedCouncilOrder | null;
    try {
      back = await getComposedCouncilOrderStrict(memoHex);
    } catch (e) {
      throw new ComposedOrderUnrecordedError(memoHex, `relectura: ${(e as Error)?.message ?? e}`);
    }
    if (
      !back ||
      back.orderData !== record.orderData ||
      back.council !== record.council ||
      back.sequence !== record.sequence ||
      back.composedLedgerIndex !== record.composedLedgerIndex ||
      back.version !== record.version
    ) {
      throw new ComposedOrderUnrecordedError(memoHex, 'la relectura no devolvió la orden escrita');
    }
    return { recorded: true, record };
  }
  throw new ComposedOrderUnrecordedError(memoHex, 'el registro cambió durante la escritura tres veces seguidas');
}

/**
 * EVERY remembered order, OLDEST FIRST, paginated straight from the table (never
 * «the newest N»). A page that fails ends the listing with what was already read
 * — each record is judged on its own, so a shorter list only defers the rest to
 * the next pass. Deduplicated by memo (the newest row wins).
 */
export async function listComposedCouncilOrders(opts: { pageSize?: number; maxRows?: number } = {}): Promise<ComposedCouncilOrder[]> {
  if (!process.env.DATABASE_URL) return [];
  const pageSize = opts.pageSize ?? LIST_PAGE_SIZE;
  const maxRows = opts.maxRows ?? LIST_MAX_ROWS;
  const byMemo = new Map<string, ComposedCouncilOrder>();
  let cursor: string | undefined;
  let read = 0;
  try {
    const prisma = await getPrisma();
    for (;;) {
      const rows = await prisma.backgroundJob.findMany({
        where: { jobType: COMPOSED_ORDER_JOB },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, payload: true },
      });
      for (const row of rows) {
        const r = parseComposedOrder(row.payload as Record<string, unknown> | null);
        if (r) byMemo.set(r.memoHex, r);
      }
      read += rows.length;
      if (rows.length < pageSize || read >= maxRows) break;
      cursor = rows[rows.length - 1].id;
    }
  } catch (e) {
    console.error(`[composed-orders] listing stopped after ${read} rows: ${(e as Error)?.message ?? e}`);
  }
  return [...byMemo.values()];
}

/**
 * CAS update: writes `next` only if the row is still the one read as `expected`
 * (same composedAt and version). false = changed or unreadable — left for the
 * next pass. The version always moves forward.
 */
export async function updateComposedCouncilOrder(next: ComposedCouncilOrder, expected: ComposedCouncilOrder): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const prisma = await getPrisma();
    const r = await prisma.backgroundJob.updateMany({
      where: casWhere(expected),
      data: { payload: asJson({ ...next, version: (expected.version ?? 0) + 1 }) },
    });
    return r.count > 0;
  } catch (e) {
    console.error(`[composed-orders] CAS update of ${expected.memoHex.slice(0, 12)}… failed: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/** CAS forget: deletes the record only if it is still the one read. */
export async function forgetComposedCouncilOrder(expected: ComposedCouncilOrder): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const prisma = await getPrisma();
    const r = await prisma.backgroundJob.deleteMany({ where: casWhere(expected) });
    return r.count > 0;
  } catch (e) {
    console.error(`[composed-orders] CAS forget of ${expected.memoHex.slice(0, 12)}… failed: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/* ── The fate of a forgotten order ───────────────────────────────────────── */

export interface ComposedOrderFate extends Record<string, unknown> {
  memoHex: string;
  council: string;
  state: 'executed' | 'failed';
  xrplTxHash?: string;
  detail?: string;
  at: string;
  /** it. 15: what the order WAS, so the duplicate guard still sees it after the record is gone. */
  action?: string;
  contentKey?: string;
  /** ISO time the sweep found it validated on XRPL (the duplicate window is measured from here). */
  launchedAt?: string;
}

/**
 * it. 15: the fates of one council, newest first — the duplicate guard reads them
 * because the sweep FORGETS a record as soon as its relay is executed, which is
 * exactly when composing the same order again would move the capital twice.
 * Throws on a database failure; [] without a database.
 */
export async function listComposedOrderFatesForCouncil(
  council: string,
  filter: { contentKey?: string } = {},
): Promise<ComposedOrderFate[]> {
  if (!process.env.DATABASE_URL) return [];
  const prisma = await getPrisma();
  const and: Prisma.BackgroundJobWhereInput[] = [jsonEq('council', council)];
  if (typeof filter.contentKey === 'string' && filter.contentKey.length > 0) and.push(jsonEq('contentKey', filter.contentKey));
  const rows = await prisma.backgroundJob.findMany({
    where: { jobType: COMPOSED_ORDER_FATE_JOB, AND: and },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { payload: true },
  });
  const out: ComposedOrderFate[] = [];
  for (const row of rows) {
    const p = row.payload as Partial<ComposedOrderFate> | null;
    if (!p || typeof p.memoHex !== 'string' || p.council !== council) continue;
    if (p.state !== 'executed' && p.state !== 'failed') continue;
    if (filter.contentKey && p.contentKey !== filter.contentKey) continue;
    out.push(p as ComposedOrderFate);
  }
  return out;
}

/** Best-effort: a verdict the sweep reached before forgetting the record. */
export async function rememberComposedOrderFate(fate: ComposedOrderFate): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = await getPrisma();
    const where = { jobType: COMPOSED_ORDER_FATE_JOB, ...jsonEq('memoHex', fate.memoHex) };
    const r = await prisma.backgroundJob.updateMany({ where, data: { payload: asJson(fate) } });
    if (r.count === 0) {
      await prisma.backgroundJob.create({ data: { jobType: COMPOSED_ORDER_FATE_JOB, status: 'completed', payload: asJson(fate) } });
    }
  } catch (e) {
    console.error(`[composed-orders] fate of ${fate.memoHex.slice(0, 12)}… not stored: ${(e as Error)?.message ?? e}`);
  }
}

/** STRICT read of a fate: throws on a database failure. */
export async function readComposedOrderFateStrict(memoHex: string): Promise<ComposedOrderFate | null> {
  const memo = normMemo(memoHex);
  if (!HEX64.test(memo) || !process.env.DATABASE_URL) return null;
  const prisma = await getPrisma();
  const row = await prisma.backgroundJob.findFirst({
    where: { jobType: COMPOSED_ORDER_FATE_JOB, ...jsonEq('memoHex', memo) },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  const p = row?.payload as Partial<ComposedOrderFate> | null | undefined;
  if (!p || typeof p.memoHex !== 'string' || (p.state !== 'executed' && p.state !== 'failed')) return null;
  return p as ComposedOrderFate;
}

/** Fates older than the FDC window answer nothing anyone still needs. Best-effort. */
export async function pruneComposedOrderFates(now: number = Date.now()): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = await getPrisma();
    await prisma.backgroundJob.deleteMany({
      where: { jobType: COMPOSED_ORDER_FATE_JOB, createdAt: { lt: new Date(now - COMPOSED_ORDER_TTL_MS) } },
    });
  } catch (e) {
    console.error(`[composed-orders] fate prune failed: ${(e as Error)?.message ?? e}`);
  }
}

/* ── The route-side verdict, shared by both routers ──────────────────────── */

export interface ServerDelivery {
  /** The server remembered this order: its watcher will relay it once validated. */
  recorded: boolean;
  /** The relayer runs here (FLARE_EXECUTOR_ENABLED). Without it nothing is delivered by the server. */
  executorEnabled: boolean;
}

export type ComposedOrderDeliveryVerdict =
  | { proceed: true; warning: string | null; serverDelivery: ServerDelivery }
  | { proceed: false; status: number; body: { error: string; detail: string } };

/**
 * Record the composed order and say what the route may do with it:
 *  · recorded (or no database) → proceed;
 *  · not recordable (`ORDER_RECOVERY_UNRECORDED`) → an EXIT proceeds with a
 *    `warning`; anything else is refused 503;
 *  · the council's queue is full (`TOO_MANY_PENDING_ORDERS`) → an EXIT proceeds
 *    with a `warning` (LA SALIDA JAMÁS SE GATEA); anything else is refused 429.
 * Any other error is a composer bug and propagates.
 */
export async function recordComposedOrderForDelivery(
  input: Parameters<typeof recordComposedCouncilOrder>[0],
  opts: {
    exit: boolean;
    /** The writer (injectable: a route passes the binding it imported, so its tests can stand in for it). */
    record?: (i: Parameters<typeof recordComposedCouncilOrder>[0]) => ReturnType<typeof recordComposedCouncilOrder>;
  },
): Promise<ComposedOrderDeliveryVerdict> {
  const executorEnabled = process.env.FLARE_EXECUTOR_ENABLED === 'true';
  try {
    // The exit travels INTO the writer (it. 15): the cap is not consulted for it at
    // all, so an exit is recorded whenever the database works — and the warning
    // below stays for the only case left, a database that cannot be written.
    const out = await (opts.record ?? recordComposedCouncilOrder)({ ...input, exit: opts.exit === true });
    return { proceed: true, warning: null, serverDelivery: { recorded: out.recorded, executorEnabled } };
  } catch (e) {
    if (e instanceof ComposedOrderUnrecordedError || e instanceof TooManyPendingOrdersError) {
      if (opts.exit) {
        return {
          proceed: true,
          warning: `${e.code}: the server could not remember this order, so it cannot deliver it on its own — keep this screen open until the order reaches Flare, or relay it by hash if it closes`,
          serverDelivery: { recorded: false, executorEnabled },
        };
      }
      return {
        proceed: false,
        status: e instanceof TooManyPendingOrdersError ? 429 : 503,
        body: { error: e.code, detail: e.message },
      };
    }
    throw e;
  }
}

/* ── Does this session CONTROL the council? (it. 15, finding 2.1) ─────────── */

export interface CouncilAuthorityDeps {
  mayActOnAccount?: (req: Request, account: string) => Promise<boolean>;
  provenAddresses?: (userId: string | null, sessionWalletAddress: string | null) => Promise<string[]>;
  readSignerCouncil?: (account: string) => Promise<{ signers: Array<{ account: string }> } | null>;
}

/** Per-REQUEST memo: composing asks this once per council, never once per check. */
const councilAuthorityByRequest = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * it. 17 (finding 2.5) — A DEAD NODE MUST NOT DEMOTE A REAL MANAGER.
 *
 * The SignerList read had no timeout and no memory: a 429 from the XRPL node made
 * `sessionProvesCouncil` answer false, and the manager who controls the council
 * silently dropped into the STRANGER queue (10 compositions per preparer instead of
 * the council's 50) — a node hiccup rationing a real family's own doors.
 *
 * So the read is bounded (like `councilProposals.ts` bounds its own signer-list
 * read) and a verdict that was PROVED for this exact (session, council) is
 * remembered for `PROVEN_MEMORY_MS`. On a failed read the memory answers instead of
 * `false`, and the fallback is LOGGED — never silent. This is a memory of a proof
 * that already happened, never a widening: nothing is remembered that was not read
 * off the validated ledger first, and it only ever decides WHICH QUEUE a
 * composition counts against (never whether an order may be composed, and never
 * anything about an exit, which the cap does not see at all).
 */
export const COUNCIL_SIGNERLIST_TIMEOUT_MS = 4_000;
export const COUNCIL_PROVEN_MEMORY_MS = 30 * 60_000;
const provenCouncilMemory = new Map<string, number>();

/** Tests (and only tests) start without a remembered verdict. */
export function _resetCouncilProvenMemory(): void {
  provenCouncilMemory.clear();
}

function provenMemoryKey(userId: string | null, council: string): string {
  return `${userId ?? 'anonymous'}::${council}`;
}

function rememberProvenCouncil(userId: string | null, council: string, now = Date.now()): void {
  if (provenCouncilMemory.size > 5_000) {
    for (const [k, at] of provenCouncilMemory) if (now - at > COUNCIL_PROVEN_MEMORY_MS) provenCouncilMemory.delete(k);
  }
  provenCouncilMemory.set(provenMemoryKey(userId, council), now);
}

/** Was this exact session PROVED to control this council within the memory window? */
function rememberedProvenCouncil(userId: string | null, council: string, now = Date.now()): boolean {
  const at = provenCouncilMemory.get(provenMemoryKey(userId, council));
  return typeof at === 'number' && now - at < COUNCIL_PROVEN_MEMORY_MS;
}

async function withReadTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Two independent grounds, both read server-side, neither of them from the body:
 *   · the session PROVED this XRPL account (or is a verified founder) —
 *     `handoffAuthority.sessionMayActOnXrplAccount`, the same verdict the 0xFE
 *     seat uses; or
 *   · one of the session's PROVEN addresses sits in the council's SignerList on the
 *     validated ledger — the multisig case, where nobody holds the account itself.
 *
 * Every failed read answers false («could not read» is never authority), and the
 * ledger is only asked when the session has something to look for. This decides
 * WHICH QUEUE a composition counts against — never whether an order may be
 * composed, and never anything about an exit.
 */
export async function sessionProvesCouncil(req: Request, council: string, deps: CouncilAuthorityDeps = {}): Promise<boolean> {
  const account = typeof council === 'string' ? council.trim() : '';
  if (!account) return false;
  const cached = councilAuthorityByRequest.get(req as unknown as object);
  const hit = cached?.get(account);
  if (hit) return hit;
  const userId = req.siwe?.userId ?? null;
  // it. 17 (2.5): a read that FAILED is not a verdict. When the node (or the
  // binding read) cannot answer, the last verdict PROVED for this exact session and
  // council stands — said out loud in the log, never silently.
  const fallback = (why: string): boolean => {
    if (rememberedProvenCouncil(userId, account)) {
      console.warn(
        `[council] authority read failed for ${account} (${why}); keeping the verdict proved for this session in the ` +
          'last 30 min — the council queue, not the stranger queue',
      );
      return true;
    }
    console.warn(`[council] authority read failed for ${account} (${why}); no proved verdict remembered → stranger queue`);
    return false;
  };
  const run = (async () => {
    try {
      const mayAct =
        deps.mayActOnAccount ??
        (async (r: Request, a: string) => (await import('./handoffAuthority')).sessionMayActOnXrplAccount(r, a));
      if (await mayAct(req, account)) {
        rememberProvenCouncil(userId, account);
        return true;
      }
    } catch {
      /* fall through to the SignerList read */
    }
    let proven: string[] = [];
    try {
      const list =
        deps.provenAddresses ??
        (async (uid: string | null, wallet: string | null) =>
          (await import('../identity/provenAddresses')).provenAddressesOf(uid, wallet));
      proven = await list(userId, req.siwe?.walletAddress ?? null);
    } catch (e) {
      return fallback(`bindings: ${(e as Error)?.message ?? e}`);
    }
    if (proven.length === 0) return false;
    try {
      const read =
        deps.readSignerCouncil ??
        (async (a: string) => (await import('../../integrations/providers/chain/XRPLProvider')).xrplProvider.getSignerCouncil(a));
      const signerCouncil = await withReadTimeout(
        Promise.resolve(read(account)),
        COUNCIL_SIGNERLIST_TIMEOUT_MS,
        `signer list ${account}`,
      );
      const signers = signerCouncil?.signers ?? [];
      const { includesAddress } = await import('../identity/provenAddresses');
      const holds = signers.some((s) => includesAddress(proven, s?.account));
      if (holds) rememberProvenCouncil(userId, account);
      return holds;
    } catch (e) {
      return fallback(`signer list: ${(e as Error)?.message ?? e}`);
    }
  })();
  const map = cached ?? new Map<string, Promise<boolean>>();
  map.set(account, run);
  councilAuthorityByRequest.set(req as unknown as object, map);
  return run;
}

/* ── May this session be TOLD WHY? (productizer it. 21, finding 2.8) ───────── */

/**
 * productizer it. 21 (finding 2.8) — ONE FLOOR FOR «MAY THIS CALLER BE TOLD WHY».
 *
 * WHAT FAILED IN SILENCE: `POST /api/xrpl-defi/multisign/prepare` grew TWO floors ten
 * lines apart. To word a refusal it asked `sessionProvesCouncil` (a PROVEN address);
 * to name the row holding the seat it asked `sessionMayReadCouncil` (proven OR
 * registered — the floor it. 19 opened on purpose, because the bytes a cosignatory
 * signs come only from a read). So the cosignatory the it. 19 fix was written for —
 * on the SignerList of the validated ledger, known to this app only as a `wallet`
 * row — could READ the proposal and still got `GENERIC_PREPARE_REFUSAL`, an opaque
 * 409 with no next step, on their own family's exit.
 *
 * This is that same READ floor asked of an ACCOUNT instead of a stored row (the
 * ceremony has no row: it pins bytes handed to it in the body). Two grounds:
 *   · the session PROVES the council (`sessionProvesCouncil` — unchanged, and still
 *     the only thing that ever decides a WRITE, a queue or a lease); or
 *   · an address this session REGISTERED sits in the council's SignerList on the
 *     validated ledger.
 *
 * WHAT IT DECIDES, AND WHAT IT MUST NEVER DECIDE. Only whether a refusal carries its
 * REASON. Nothing here composes, records, leases, gates or un-gates anything — the
 * region gate, the seat guards and the lease keep their own (higher) floors. A
 * registered address is self-asserted, so it buys a sentence, never an authority.
 *
 * NO AMPLIFICATION: the registry is a single bounded database read keyed by this
 * session, and the ledger is only asked when that read came back with something to
 * look for. A caller with no wallet rows costs exactly one indexed query and no
 * ledger call at all. Every failed read answers false — «no pude leer» is not
 * authority — and the caller still gets the generic refusal, never a 500.
 */
const councilReadFloorByRequest = new WeakMap<object, Map<string, Promise<boolean>>>();

export interface CouncilReadFloorDeps extends CouncilAuthorityDeps {
  /** The session's REGISTERED addresses (the self-asserted `wallet` table). */
  registeredAddresses?: (userId: string, members: string[]) => Promise<string[]>;
}

export async function sessionMayReadCouncilAccount(
  req: Request,
  council: string,
  deps: CouncilReadFloorDeps = {},
): Promise<boolean> {
  const account = typeof council === 'string' ? council.trim() : '';
  if (!account) return false;
  const cached = councilReadFloorByRequest.get(req as unknown as object);
  const hit = cached?.get(account);
  if (hit) return hit;
  const run = (async () => {
    // The proven half first: it is memoised per request and never reads the
    // registry, so a manager pays nothing extra for the wider floor.
    if (await sessionProvesCouncil(req, account, deps)) return true;
    const userId = req.siwe?.userId ?? null;
    if (!userId) return false;
    let registered: string[] = [];
    try {
      const read =
        deps.registeredAddresses ??
        (async (uid: string) => {
          const { prisma } = await import('../../database/prismaClient');
          const rows = await prisma.wallet.findMany({ where: { userId: uid }, select: { address: true } });
          return rows.map((r) => r.address).filter((a): a is string => typeof a === 'string' && a.length > 0);
        });
      registered = await read(userId, []);
    } catch (e) {
      console.warn(`[council] read floor: wallet registry unreadable for ${account}: ${(e as Error)?.message ?? e}`);
      return false;
    }
    if (registered.length === 0) return false;
    try {
      const read =
        deps.readSignerCouncil ??
        (async (a: string) => (await import('../../integrations/providers/chain/XRPLProvider')).xrplProvider.getSignerCouncil(a));
      const signerCouncil = await withReadTimeout(
        Promise.resolve(read(account)),
        COUNCIL_SIGNERLIST_TIMEOUT_MS,
        `signer list ${account}`,
      );
      const signers = signerCouncil?.signers ?? [];
      const { includesAddress } = await import('../identity/provenAddresses');
      return signers.some((s) => includesAddress(registered, s?.account));
    } catch (e) {
      console.warn(`[council] read floor: signer list unreadable for ${account}: ${(e as Error)?.message ?? e}`);
      return false;
    }
  })();
  const map = cached ?? new Map<string, Promise<boolean>>();
  map.set(account, run);
  councilReadFloorByRequest.set(req as unknown as object, map);
  return run;
}

/* ── The ledger read ─────────────────────────────────────────────────────── */

export interface CouncilPaymentMatch {
  hash: string;
  memoHex: string;
  /** tesSUCCESS / tec* — or 'unknown' when the entry carried no readable result (UNREADABLE, never a failure). */
  result: string;
  ledgerIndex?: number;
}

/** A validated engine result we can judge: tes* or tec*. Anything else is unreadable. */
export function isReadableResult(result: string): boolean {
  return /^te[sc]/.test(result);
}

function entryLedgerIndex(entry: Record<string, unknown>): number | null {
  const tx = (entry.tx_json ?? entry.tx) as Record<string, unknown> | undefined;
  const li = Number(entry.ledger_index ?? tx?.ledger_index ?? NaN);
  return Number.isSafeInteger(li) && li > 0 ? li : null;
}

/**
 * Pure: one `account_tx` entry (api_version 1 or 2) → a validated Payment SENT
 * BY `council` carrying a 32-byte memo, or null. A payment from anyone else with
 * the same memo is never the council's order.
 */
export function parseCouncilPaymentEntry(entry: Record<string, unknown>, council: string): CouncilPaymentMatch | null {
  const tx = (entry.tx_json ?? entry.tx) as Record<string, unknown> | undefined;
  if (!tx || tx.TransactionType !== 'Payment' || tx.Account !== council) return null;
  if (entry.validated === false) return null;
  const memoHex = firstMemoHex(tx);
  if (!HEX64.test(memoHex)) return null;
  const hash = String(entry.hash ?? tx.hash ?? '').toUpperCase();
  if (!HEX64.test(hash)) return null;
  const meta = entry.meta as { TransactionResult?: unknown } | undefined;
  const li = entryLedgerIndex(entry);
  return {
    hash,
    memoHex,
    result: typeof meta?.TransactionResult === 'string' ? meta.TransactionResult : 'unknown',
    ...(li !== null ? { ledgerIndex: li } : {}),
  };
}

export type AccountTxRpc = (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const defaultRpc: AccountTxRpc = async (method, params) => {
  const { xrplJsonRpc } = await import('./DirectMintExecutorService');
  return (await xrplJsonRpc(method, params, undefined, { requireFresh: true })) as Record<string, unknown>;
};

/**
 * Every validated Payment the council sent from `ledgerIndexMin`, read OLDEST
 * FIRST (`forward: true`) and paginated until the marker is gone, on FRESH nodes
 * only. `searchedThroughLedger` is the highest ledger FULLY read from the start —
 * only up to there may «the memo is not on the ledger» be concluded.
 *
 *  · marker exhausted → `exhausted: true`, searched through the node's range
 *    (the lowest `ledger_index_max` any page reported);
 *  · page cap reached with a marker still set → `exhausted: false`, the matches
 *    read so far, and searched through the ledger BEFORE the last entry read (that
 *    ledger may continue on the next page). No entry ledger to anchor it, or no
 *    ledger fully read → throws NOT_EXHAUSTED (no progress is ever invented);
 *  · THROWS when a page fails, when the node searched a NARROWER start than asked
 *    (no history for the window), or does not say how far it searched.
 */
export async function scanCouncilPayments(
  council: string,
  opts: { ledgerIndexMin: number; maxPages?: number },
  rpc: AccountTxRpc = defaultRpc,
): Promise<{ matches: CouncilPaymentMatch[]; searchedThroughLedger: number; exhausted: boolean }> {
  const min = opts.ledgerIndexMin;
  if (!Number.isSafeInteger(min) || min < 1) throw new Error(`COMPOSED_SCAN_INVALID: ledger ${min}`);
  const maxPages = opts.maxPages ?? COMPOSED_SCAN_MAX_PAGES;
  const matches: CouncilPaymentMatch[] = [];
  let marker: unknown;
  let searchedThrough: number | null = null;
  let lastEntryLedger: number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = {
      account: council,
      ledger_index_min: min,
      ledger_index_max: -1,
      limit: 200,
      forward: true,
    };
    if (marker !== undefined) params.marker = marker;
    const result = await rpc('account_tx', params);
    const servedMin = Number(result.ledger_index_min);
    const servedMax = Number(result.ledger_index_max);
    if (Number.isFinite(servedMin) && servedMin > min) {
      throw new Error(`COMPOSED_SCAN_HISTORY_MISSING: the node searched from ledger ${servedMin}, asked ${min}`);
    }
    if (!Number.isSafeInteger(servedMax) || servedMax < 1) {
      if (searchedThrough === null) {
        throw new Error('COMPOSED_SCAN_UNBOUNDED: the node did not say up to which ledger it searched');
      }
    } else {
      searchedThrough = searchedThrough === null ? servedMax : Math.min(searchedThrough, servedMax);
    }
    for (const entry of (result.transactions as Array<Record<string, unknown>>) ?? []) {
      const li = entryLedgerIndex(entry);
      if (li !== null) lastEntryLedger = lastEntryLedger === null ? li : Math.max(lastEntryLedger, li);
      const m = parseCouncilPaymentEntry(entry, council);
      if (m) matches.push(m);
    }
    marker = result.marker;
    if (marker === undefined || marker === null || marker === '') {
      return { matches, searchedThroughLedger: searchedThrough as number, exhausted: true };
    }
  }
  if (lastEntryLedger !== null && searchedThrough !== null) {
    const through = Math.min(lastEntryLedger - 1, searchedThrough);
    if (through >= min) return { matches, searchedThroughLedger: through, exhausted: false };
  }
  throw new Error(`COMPOSED_SCAN_NOT_EXHAUSTED: more than ${maxPages} pages of ${council} history since ledger ${min}`);
}

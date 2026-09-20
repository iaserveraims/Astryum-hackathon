/**
 * OmnibusWatcher — reads the exchange's omnibus XRPL account and tells the demo
 * ledger what arrived (by destination tag) and what left. Read-only by
 * construction: only `account_tx`, through the one XRPL transport that refuses
 * a frozen rippled (`xrplJsonRpc(..., {requireFresh:true})` — incident).
 */

import { xrplJsonRpc } from '../flare/DirectMintExecutorService';
import type { DemoClient, LedgerMovement } from './DemoExchangeStore';

export interface OmnibusTx {
  hash: string;
  account: string;
  destination: string;
  destinationTag?: number;
  drops: string;
  dateISO: string;
  result: string;
  validated: boolean;
  direction: 'in' | 'out';
  /** First memo, hex upper, when present (an 0xFE mint payment to the Core Vault carries one). */
  memoHex?: string;
  /** Ledger the tx validated in — the tenant frontier compares against this. */
  ledgerIndex?: number;
  /** The LastLedgerSequence the signer stamped — part of a desk payout's fingerprint. */
  lastLedgerSequence?: number;
}

const RIPPLE_EPOCH_OFFSET = 946684800;

/** Pure: one `account_tx` entry (api_version 1 or 2) → OmnibusTx, or null if it is not a Payment. */
export function parseOmnibusEntry(entry: Record<string, unknown>, omnibus: string): OmnibusTx | null {
  const tx = (entry.tx_json ?? entry.tx) as Record<string, unknown> | undefined;
  if (!tx || tx.TransactionType !== 'Payment') return null;
  const meta = entry.meta as { TransactionResult?: string; delivered_amount?: unknown } | undefined;
  const amountRaw = (meta?.delivered_amount ?? tx.DeliverMax ?? tx.Amount) as unknown;
  // Issued-currency payments (objects) are not XRP; the omnibus demo only mirrors drops.
  if (typeof amountRaw !== 'string') return null;
  const account = String(tx.Account ?? '');
  const destination = String(tx.Destination ?? '');
  const direction: 'in' | 'out' = destination === omnibus ? 'in' : account === omnibus ? 'out' : 'in';
  if (destination !== omnibus && account !== omnibus) return null;
  const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string } }>) ?? [];
  const memoHex = memos[0]?.Memo?.MemoData ? String(memos[0].Memo.MemoData).toUpperCase() : undefined;
  const tag = tx.DestinationTag;
  const liRaw = Number(entry.ledger_index ?? tx.ledger_index ?? NaN);
  const llsRaw = Number(tx.LastLedgerSequence ?? NaN);
  return {
    ledgerIndex: Number.isFinite(liRaw) && liRaw > 0 ? liRaw : undefined,
    lastLedgerSequence: Number.isInteger(llsRaw) && llsRaw > 0 ? llsRaw : undefined,
    hash: String(entry.hash ?? tx.hash ?? ''),
    account,
    destination,
    destinationTag: typeof tag === 'number' ? tag : undefined,
    drops: amountRaw,
    dateISO: new Date((Number(tx.date ?? 0) + RIPPLE_EPOCH_OFFSET) * 1000).toISOString(),
    result: meta?.TransactionResult ?? 'unknown',
    validated: entry.validated === true,
    direction,
    memoHex,
  };
}

export interface ClassifiedTx extends OmnibusTx {
  kind: 'deposit' | 'return' | 'withdraw' | 'other';
  clientId?: string;
}

/**
 * Pure: attach the demo meaning of each omnibus Payment given the run's clients.
 *
 * The two boundaries that make a LIVE omnibus safe (CONECTA):
 *  · `sinceLedgerIndex` — the tenant frontier: a payment validated BEFORE the
 *    run existed is never the run's money, whatever its tag says. On a live
 *    omnibus, legacy traffic with a colliding tag would otherwise be credited
 *    to a demo client — a money bug, not a UI one.
 *  · `tagRange` — an incoming tag outside the run's reserved range is never
 *    classified, even if a client record somehow carries it.
 * Both default to open (absent) so a fresh demo omnibus behaves as before.
 */
export function classifyOmnibusTxs(
  txs: OmnibusTx[],
  clients: DemoClient[],
  opts?: { tagRange?: { base: number; count: number }; sinceLedgerIndex?: number },
): ClassifiedTx[] {
  const byTag = new Map<number, DemoClient>();
  const byXrpl = new Map<string, DemoClient>();
  for (const c of clients) {
    byTag.set(c.tag, c);
    if (c.xrplAddress) byXrpl.set(c.xrplAddress, c);
  }
  const since = opts?.sinceLedgerIndex;
  const range = opts?.tagRange;
  const inRange = (tag: number) => !range || (tag >= range.base && tag < range.base + range.count);
  return txs.map((t) => {
    if (!t.validated || t.result !== 'tesSUCCESS') return { ...t, kind: 'other' as const };
    // Frontier first: with a frontier set, a tx we cannot date is not creditable
    // either — «no pude probar que es de después» nunca acredita dinero.
    if (since !== undefined && !(t.ledgerIndex !== undefined && t.ledgerIndex >= since)) {
      return { ...t, kind: 'other' as const };
    }
    if (t.direction === 'in' && t.destinationTag !== undefined && inRange(t.destinationTag)) {
      const c = byTag.get(t.destinationTag);
      if (c) {
        const fromClient = c.xrplAddress && c.xrplAddress === t.account;
        return { ...t, kind: fromClient ? ('deposit' as const) : ('return' as const), clientId: c.id };
      }
    }
    if (t.direction === 'out') {
      const c = byXrpl.get(t.destination);
      if (c) return { ...t, kind: 'withdraw' as const, clientId: c.id };
    }
    return { ...t, kind: 'other' as const };
  });
}

/** Pure: the ledger movements a classified scan implies. */
export function movementsFrom(classified: ClassifiedTx[]): LedgerMovement[] {
  const out: LedgerMovement[] = [];
  for (const t of classified) {
    if (!t.clientId) continue;
    if (t.kind === 'deposit' || t.kind === 'return' || t.kind === 'withdraw') {
      out.push({ kind: t.kind, clientId: t.clientId, drops: t.drops, txHash: t.hash });
    }
  }
  return out;
}

/**
 * Live: page the omnibus `account_tx` (newest first), fresh nodes only. With
 * `sinceLedgerIndex` (the tenant frontier) the server bounds the query itself:
 * a live omnibus with years of history only ever serves the run's window, so
 * the page cap stops being a correctness ceiling.
 */
export async function scanOmnibus(omnibus: string, opts?: { maxPages?: number; wssUrl?: string; sinceLedgerIndex?: number }): Promise<OmnibusTx[]> {
  const rows: OmnibusTx[] = [];
  let marker: unknown;
  const maxPages = opts?.maxPages ?? 3;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = {
      account: omnibus,
      ledger_index_min: opts?.sinceLedgerIndex ?? -1,
      ledger_index_max: -1,
      limit: 200,
      forward: false,
    };
    if (marker !== undefined) params.marker = marker;
    const result = await xrplJsonRpc('account_tx', params, opts?.wssUrl, { requireFresh: true });
    const transactions = (result.transactions as Array<Record<string, unknown>>) ?? [];
    for (const entry of transactions) {
      const parsed = parseOmnibusEntry(entry, omnibus);
      if (parsed) rows.push(parsed);
    }
    marker = result.marker;
    if (!marker) break;
  }
  return rows;
}

/** Safety cap of the exhaustive window scan: 50 × 200 rows. Hitting it is a FAILURE, never a partial answer. */
export const WINDOW_SCAN_MAX_PAGES = 50;

/** Pure: a ledger index the node stated (a positive integer, as number or decimal string), or null. */
export function servedLedgerIndex(raw: unknown): number | null {
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw.trim()))) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The range the node says it searched. A missing / malformed bound is UNREADABLE
 * (2.6d): `Number(undefined)` is NaN and every `NaN > min`
 * comparison is false, so a node that did not state its range used to pass the
 * «full history» check and a partial history read as «absent».
 */
function assertServedRange(result: unknown, min: number | undefined, max: number): void {
  const r = (result ?? {}) as { ledger_index_min?: unknown; ledger_index_max?: unknown };
  const servedMin = servedLedgerIndex(r.ledger_index_min);
  const servedMax = servedLedgerIndex(r.ledger_index_max);
  if (servedMax === null || (min !== undefined && servedMin === null)) {
    throw new Error(
      `OMNIBUS_WINDOW_RANGE_UNREADABLE: the node did not state the ledger range it searched (ledger_index_min=${String(r.ledger_index_min)}, ledger_index_max=${String(r.ledger_index_max)}) — unreadable, never «absent»`,
    );
  }
  if (min !== undefined && servedMin !== null && servedMin > min) {
    throw new Error(`OMNIBUS_WINDOW_HISTORY_MISSING: the node searched from ledger ${servedMin}, asked ${min}`);
  }
  if (servedMax < max) {
    throw new Error(`OMNIBUS_WINDOW_HISTORY_MISSING: the node searched up to ledger ${servedMax}, asked ${max}`);
  }
}

/**
 * Live, EXHAUSTIVE: every omnibus Payment validated in [ledgerIndexMin,
 * ledgerIndexMax], paginating until the marker is gone. What the page-capped
 * `scanOmnibus` cannot give — «this payment is NOT on the ledger» — is only
 * ever concluded from this read (with >400 omnibus txs since
 * a payout's ledger, a 2-page scan missed a validated payout and its
 * reservation was released → the client was paid again).
 *
 * THROWS (never a partial list) when: a page fails; the page cap is reached
 * with a marker still set; or the node answers a NARROWER ledger range than
 * asked (no full history for the window).
 */
export async function scanOmnibusWindow(
  omnibus: string,
  opts: { ledgerIndexMin?: number; ledgerIndexMax: number; maxPages?: number; wssUrl?: string },
): Promise<OmnibusTx[]> {
  const max = opts.ledgerIndexMax;
  const min = opts.ledgerIndexMin;
  if (!Number.isInteger(max) || max < 1) throw new Error('OMNIBUS_WINDOW_INVALID: ledgerIndexMax must be a ledger index');
  if (min !== undefined && (!Number.isInteger(min) || min < 1 || min > max)) {
    throw new Error(`OMNIBUS_WINDOW_INVALID: ledger window [${min}, ${max}]`);
  }
  const maxPages = opts.maxPages ?? WINDOW_SCAN_MAX_PAGES;
  const rows: OmnibusTx[] = [];
  let marker: unknown;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = {
      account: omnibus,
      ledger_index_min: min ?? -1,
      ledger_index_max: max,
      limit: 200,
      forward: false,
    };
    if (marker !== undefined) params.marker = marker;
    const result = await xrplJsonRpc('account_tx', params, opts.wssUrl, { requireFresh: true });
    // rippled answers the range it actually searched: narrower = history missing; unstated = unreadable.
    assertServedRange(result, min, max);
    const transactions = (result.transactions as Array<Record<string, unknown>>) ?? [];
    for (const entry of transactions) {
      const parsed = parseOmnibusEntry(entry, omnibus);
      if (parsed) rows.push(parsed);
    }
    marker = result.marker;
    if (marker === undefined || marker === null || marker === '') return rows;
  }
  throw new Error(`OMNIBUS_WINDOW_NOT_EXHAUSTED: more than ${maxPages} pages of omnibus history in ledgers [${min ?? 'first'}, ${max}]`);
}

/**
 * Live, BOUNDED and FORWARD: the omnibus Payments validated in [ledgerIndexMin,
 * ledgerIndexMax], oldest first, stopping at the first row `stop` accepts.
 * A put-to-work proof asks one question of its window — «is
 * THIS memo there?» / «is there an 0xFE nobody explains?» — so it never needs the
 * whole history: the first match answers it, and the window itself is bounded by
 * the caller (a LastLedgerSequence, or a fixed search width).
 *
 * `match` set = the scan stopped there (rows end with it). No `match` = the window
 * was read in full. THROWS (never a partial «absent») when a page fails, the node
 * served a narrower range, or the page cap is reached with neither a match nor an
 * exhausted marker.
 */
export async function scanOmnibusWindowUntil(
  omnibus: string,
  opts: { ledgerIndexMin: number; ledgerIndexMax: number; stop?: (tx: OmnibusTx) => boolean; maxPages?: number; wssUrl?: string },
): Promise<{ rows: OmnibusTx[]; match?: OmnibusTx }> {
  const { ledgerIndexMin: min, ledgerIndexMax: max } = opts;
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(min) || min < 1 || min > max) {
    throw new Error(`OMNIBUS_WINDOW_INVALID: ledger window [${min}, ${max}]`);
  }
  const maxPages = opts.maxPages ?? WINDOW_SCAN_MAX_PAGES;
  const rows: OmnibusTx[] = [];
  let marker: unknown;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = { account: omnibus, ledger_index_min: min, ledger_index_max: max, limit: 200, forward: true };
    if (marker !== undefined) params.marker = marker;
    const result = await xrplJsonRpc('account_tx', params, opts.wssUrl, { requireFresh: true });
    assertServedRange(result, min, max);
    const transactions = (result.transactions as Array<Record<string, unknown>>) ?? [];
    for (const entry of transactions) {
      const parsed = parseOmnibusEntry(entry, omnibus);
      if (!parsed) continue;
      rows.push(parsed);
      if (opts.stop?.(parsed)) return { rows, match: parsed };
    }
    marker = result.marker;
    if (marker === undefined || marker === null || marker === '') return { rows };
  }
  throw new Error(`OMNIBUS_WINDOW_NOT_EXHAUSTED: more than ${maxPages} pages of omnibus history in ledgers [${min}, ${max}] without an answer`);
}

/**
 * Live: the current validated ledger index — the tenant frontier stamped at run
 * creation. Null on failure: a missing frontier degrades to the old unbounded
 * behavior (fine for a fresh omnibus), it never blocks creating the run.
 */
export async function currentValidatedLedgerIndex(wssUrl?: string): Promise<number | null> {
  try {
    const result = await xrplJsonRpc('ledger', { ledger_index: 'validated' }, wssUrl, { requireFresh: true });
    const idx = Number(
      (result as { ledger_index?: unknown }).ledger_index ??
        (result as { ledger?: { ledger_index?: unknown } }).ledger?.ledger_index,
    );
    return Number.isFinite(idx) && idx > 0 ? idx : null;
  } catch {
    return null;
  }
}

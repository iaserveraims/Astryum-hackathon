/**
 * positionsReadState — what the positions board does with a `/positions/:wallet`
 * answer that could not be read in full.
 *
 * Doctrine: «could not read» is not permission, not punishment, not a fact,
 * not a zero — and not an empty list. A position that could not be read is
 * painted as «could not be read», never as absent.
 *
 * THE FAILURE (ola 0, 15-sep, two reviewers). `/api/positions/:wallet` answers
 * HTTP 200 with one block per adapter, and a fallen adapter ships as
 * `{ protocolId, error, positions: [] }`. The board's `flattenPositions` read
 * `positions` only; its «could not read» card counted HTTP failures only. So
 * ONE 429 among Kinetic's ~20 reads took the adapter down, the block came
 * back empty with an `error` nobody painted, and the carry holder's FXRP
 * supply, USDT0 debt and «Repay» door were simply not there. With the
 * backend degrading per market now, a block can also carry `unreadable[]` —
 * the reads (markets, queue periods) that did not answer beside the rows
 * that did.
 *
 * Pure: importable by vitest without the component (which drags AppKit in).
 */

/** An address whose read failed, with WHY: the HTTP status, or null for no answer (network/timeout). */
export type UnreadableAddr = { addr: string; status: number | null };

/** One read a block names as not answered (backend `UnreadableRead`). */
export interface UnreadRead {
  what: string;
  reason?: string;
  market?: string;
}

/** One protocol of one wallet the board could not read in full. */
export interface FlareProtocolUnread {
  addr: string;
  protocolId: string;
  /** `true` = the adapter fell entirely (`error`, no rows); `false` = some reads did not answer (`unreadable`), the rows served are a lower bound. */
  whole: boolean;
  reason: string;
  reads: UnreadRead[];
}

/** One raw position of a block, as the adapter shipped it (amount in base units, as a string). */
export interface BlockPosition {
  kind: string;
  asset: string;
  amount: string | number;
  [extra: string]: unknown;
}

/** One adapter's block of a `/positions/:wallet` body, shape-checked. */
export interface PositionsBlock {
  protocolId: string;
  positions: BlockPosition[];
  /** The adapter fell entirely (it. 29 shape). */
  error?: string;
  /** Reads the adapter could not make (ola 0 shape); `positions` is a lower bound. */
  unreadable?: UnreadRead[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/**
 * The blocks of a `/positions/:wallet` body — the ONE reader of that shape,
 * shared by the board's row builder and by `unreadBlocksOf`. Garbage-tolerant:
 * a block without `protocolId` is skipped, non-array `positions`/`unreadable`
 * read as empty.
 */
export function positionsBlocksOf(data: unknown): PositionsBlock[] {
  const results = isObj(data) ? data.results : undefined;
  if (!Array.isArray(results)) return [];
  const out: PositionsBlock[] = [];
  for (const raw of results) {
    if (!isObj(raw)) continue;
    const protocolId = str(raw.protocolId);
    if (!protocolId) continue;
    const positions = (Array.isArray(raw.positions) ? raw.positions : []).filter(isObj) as unknown as BlockPosition[];
    const block: PositionsBlock = { protocolId, positions };
    if (raw.error != null && raw.error !== '') block.error = str(raw.error);
    if (Array.isArray(raw.unreadable)) {
      const reads: UnreadRead[] = raw.unreadable
        .filter(isObj)
        .map((r) => ({
          what: str(r.what),
          ...(r.reason != null ? { reason: str(r.reason) } : {}),
          ...(typeof r.market === 'string' ? { market: r.market } : {}),
        }))
        .filter((r) => r.what);
      if (reads.length > 0) block.unreadable = reads;
    }
    out.push(block);
  }
  return out;
}

/** `chainId` of a raw position when it is a number (the Base cbXRP rows carry one), else undefined. */
export function chainIdOf(p: { [k: string]: unknown }): number | undefined {
  return typeof p.chainId === 'number' ? p.chainId : undefined;
}

/**
 * Every block of a `/positions/:wallet` body whose adapter fell (`error`) or
 * that names reads it could not make (`unreadable`).
 */
export function unreadBlocksOf(data: unknown, owner: string): FlareProtocolUnread[] {
  const out: FlareProtocolUnread[] = [];
  for (const block of positionsBlocksOf(data)) {
    if (block.error) {
      out.push({ addr: owner, protocolId: block.protocolId, whole: true, reason: block.error, reads: [] });
      continue;
    }
    if (block.unreadable && block.unreadable.length > 0) {
      out.push({
        addr: owner,
        protocolId: block.protocolId,
        whole: false,
        reason: block.unreadable.map((r) => r.what).join('; '),
        reads: block.unreadable,
      });
    }
  }
  return out;
}

/**
 * The board's reduction of one scan over N addresses: the rows every
 * answered block contributed, the addresses whose HTTP read failed (with
 * status), and the protocol blocks that came back unread inside an HTTP 200.
 * `flatten` is the board's own row builder — passed in so the shipping one
 * runs here, not a copy.
 */
export function reduceFlareScan<Row>(
  results: PromiseSettledResult<unknown>[],
  addrs: string[],
  flatten: (data: unknown, owner: string) => Row[],
): { rows: Row[]; failed: UnreadableAddr[]; unread: FlareProtocolUnread[] } {
  const rows: Row[] = [];
  const failed: UnreadableAddr[] = [];
  const unread: FlareProtocolUnread[] = [];
  results.forEach((res, i) => {
    const addr = addrs[i];
    if (res.status === 'fulfilled') {
      rows.push(...flatten(res.value, addr));
      unread.push(...unreadBlocksOf(res.value, addr));
    } else {
      const st = (res.reason as { status?: unknown } | null)?.status;
      failed.push({ addr, status: typeof st === 'number' ? st : null });
    }
  });
  return { rows, failed, unread };
}

/** Short form of a market/venue address for the amber card. */
export function shortAddr(a: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Human name of a protocol id for the amber card (falls back to the id). */
export function protocolWord(protocolId: string): string {
  const p = protocolId.toLowerCase();
  if (p === 'kinetic') return 'Kinetic';
  if (p === 'firelight') return 'Firelight';
  if (p === 'upshift') return 'Upshift';
  if (p === 'sceptre') return 'Sceptre';
  if (p === 'ftso') return 'FTSO';
  if (p === 'sparkdex') return 'SparkDEX';
  if (p === 'enosys') return 'Ēnosys';
  return protocolId;
}

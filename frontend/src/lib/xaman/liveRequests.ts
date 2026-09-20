/**
 * liveRequests — the Xaman requests that are still signable, wherever their
 * screen went (productizer-it7, 14-sep).
 *
 * WHAT FAILED IN SILENCE. `XamanSingleSign` fired a blind `cancelXamanPayload`
 * when it unmounted with a live payload. Nobody read the answer. When Xaman
 * answered ALREADY_OPENED (the person has the request OPEN on the phone — still
 * signable), the request lived on for its five minutes with nothing on screen,
 * and any ancestor could cause that unmount: a sidebar link, a failed reload, a
 * lens switch, the X of an operation window, a station rail.
 *
 * THE RULE NOW. A request outlives its component, not the SPA:
 *   · the component REGISTERS the payload the moment Xaman creates it, and
 *     RESOLVES it when a poll (or its own «Cancel this request») decides it;
 *   · unmounting WITHOUT a verdict HANDS IT OFF here — no cancel is fired — and
 *     this module keeps reading `/api/xaman/status` until Xaman says signed,
 *     cancelled, expired or declined;
 *   · SIGNED IS NOT THE END (it.11, 14-sep). A signed request stays listed until
 *     its VALIDATED result is read: while the component follows the ledger the
 *     entry is 'confirming' (guarded by `beforeunload`); if the component leaves
 *     then, it is handed off as 'validating' and this module reads the ledger
 *     itself (`awaitValidation`). The banner then says what the ledger said —
 *     validated, failed, refused, or «could not confirm — check the hash».
 *   · A COUNCIL ORDER is delivered to Flare by the server once validated ONLY
 *     when the server said so at prepare time (it.13): the order was recorded
 *     AND the executor runs (`noteCouncilOrderDelivery`). Before, the banner
 *     promised delivery from the tx syntax alone — exactly when the server could
 *     not deliver it. A council order without that word keeps «do NOT sign it
 *     again» plus «keep this screen open or relay it by hash». A 0xFE
 *     instruction needs the same word (it.14, R2 2.6): its handoff is persisted
 *     at prepare, but only a RUNNING executor sweeps the Core Vault, so without
 *     `noteFlareInstructionDelivery` saying so the prudent sentence speaks.
 *   · A STALE council order (tefPAST_SEQ / tefMAX_LEDGER) asks the server what
 *     became of the ORDER before the banner says «prepare it again»: a sibling
 *     request may have spent the seat and be on its way (`followStaleFate`).
 *   · NOTICES: short-lived messages that belong to no payload — today, a 0xFE
 *     seat the server refused to release (`pushLiveNotice`, lib/wallet/handoffRelease).
 *
 * The global banner (`components/xrpl/LiveXamanRequests`) renders what this
 * module holds, and its «Cancel it here» goes through the same
 * `cancelPayloadAndDecide` round trip as every other surface, obeying the
 * answer (`retreatDecision`): confirmed kill → gone; ALREADY_OPENED or no answer
 * → it stays, with the sentence; ALREADY_RESOLVED → read it now.
 *
 * Module-level state on purpose: it has to survive every React unmount inside
 * the SPA. A full page unload is the one thing it cannot survive — the banner
 * adds a `beforeunload` warning for that.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0): this only READS the status of payloads the
 * user signs in their own Xaman and the public ledger, and asks Xaman to kill one
 * when the user asks. Astryum never holds keys, never signs, never broadcasts.
 */

import { cancelPayloadAndDecide, type XamanCancelAction, type XamanCancelUi } from './payloadBus';
import { awaitValidation } from '../xrpl/councilSigning';
import {
  councilOrderMemoOf,
  decideAfterSigned,
  decideAfterValidation,
  retreatDecision,
  staleOrderFate,
  type CouncilOrderFateReadLike,
  type SingleSignVerdict,
  type StaleOrderFate,
} from '../xrpl/singleSignVerdict';

/* ── Pure: what Xaman's status body says ─────────────────────────────────── */

export interface XamanPayloadStatusRead {
  signed?: boolean;
  cancelled?: boolean;
  expired?: boolean;
  resolved?: boolean;
  /** The ledger txid, once Xaman signed and submitted it. */
  txid?: string;
  /** What the node answered to Xaman's submit (preliminary). */
  dispatched?: string;
}

/** The fields of a `/api/xaman/status/:uuid` body, and nothing invented. */
export function parseXamanStatusBody(data: unknown): XamanPayloadStatusRead {
  const d = (data ?? {}) as {
    meta?: { signed?: unknown; cancelled?: unknown; expired?: unknown; resolved?: unknown };
    response?: { txid?: unknown; dispatched_result?: unknown };
  };
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return {
    signed: bool(d.meta?.signed),
    cancelled: bool(d.meta?.cancelled),
    expired: bool(d.meta?.expired),
    resolved: bool(d.meta?.resolved),
    txid: str(d.response?.txid),
    dispatched: str(d.response?.dispatched_result),
  };
}

/** Read one payload's status. An unreadable answer is `{}` — no verdict, never «dead». */
export async function fetchXamanStatus(
  uuid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<XamanPayloadStatusRead> {
  try {
    const res = await fetchImpl(`/api/xaman/status/${uuid}`);
    if (!res.ok) return {};
    return parseXamanStatusBody(await res.json());
  } catch {
    return {};
  }
}

/**
 * The verdict a status read carries, in the order `XamanSingleSign` has always
 * read it: signed first (a signature outranks anything else in the body), then
 * cancelled, expired, and «answered without a signature» = declined.
 */
export type PayloadWatchVerdict = 'signed' | 'cancelled' | 'expired' | 'declined' | 'pending';

export function payloadWatchVerdict(st: XamanPayloadStatusRead): PayloadWatchVerdict {
  if (st.signed) return 'signed';
  if (st.cancelled) return 'cancelled';
  if (st.expired) return 'expired';
  if (st.resolved && st.signed === false) return 'declined';
  return 'pending';
}

/**
 * What a signing component does with its payload when it goes away. A payload
 * that exists and no poll decided is still signable: it is HANDED OFF to this
 * registry — never cancelled blind. A signed one whose ledger result the
 * component was still reading (`confirming`) is handed off too, so the registry
 * reads it. Anything else decided belongs to its verdict.
 */
export type LeaveAction = 'hand-off' | 'none';

export function leaveAction(input: { uuid?: string | null; decided: boolean; confirming?: boolean }): LeaveAction {
  if (!input.uuid) return 'none';
  return !input.decided || input.confirming ? 'hand-off' : 'none';
}

/**
 * What the server said, at PREPARE time, about delivering each composed council
 * order (keyed by its 32-byte memo, uppercase). `true` only when the order was
 * recorded AND the executor runs — the relay watcher then delivers it without
 * the screen. Absent = the server never said so (older backend, no field): not
 * delivered by the server. Bounded: the oldest word is forgotten first.
 */
const serverDeliveryByMemo = new Map<string, boolean>();
const SERVER_DELIVERY_MEMORY = 200;

/**
 * Called by the prepare clients (lib/institutional/api) with each composed
 * council order and its `serverDelivery`. A tx that is not a council order is
 * ignored. The latest word for a memo wins.
 */
export function noteCouncilOrderDelivery(
  xrplTx: unknown,
  serverDelivery: { recorded?: unknown; executorEnabled?: unknown } | null | undefined,
): void {
  const memo = councilOrderMemoOf(xrplTx);
  if (!memo) return;
  serverDeliveryByMemo.delete(memo);
  serverDeliveryByMemo.set(memo, serverDelivery?.recorded === true && serverDelivery?.executorEnabled === true);
  while (serverDeliveryByMemo.size > SERVER_DELIVERY_MEMORY) {
    const oldest = serverDeliveryByMemo.keys().next().value;
    if (oldest === undefined) break;
    serverDeliveryByMemo.delete(oldest);
  }
}

/**
 * What the server said, at PREPARE time, about the executor that carries each
 * 0xFE instruction to Flare (it.14, R2 2.6), keyed by its `FE…` memo.
 *
 * WHAT FAILED: a 0xFE was assumed delivered «automatically» from its SYNTAX
 * alone — the handoff is persisted and the executor sweeps the Core Vault — so
 * with the executor STOPPED the banner promised a delivery nobody was going to
 * make. The promise now needs the same word as a council order: somebody has to
 * have said the executor runs. Without it the prudent sentence speaks.
 */
const executorByInstructionMemo = new Map<string, boolean>();
const INSTRUCTION_DELIVERY_MEMORY = 200;

/** The `FE…` memo of a 0xFE instruction, or null when the tx is not one. */
export function flareInstructionMemoOf(tx: unknown): string | null {
  let obj: unknown = tx;
  if (typeof tx === 'string') {
    try {
      obj = JSON.parse(tx);
    } catch {
      return null;
    }
  }
  const t = obj as { TransactionType?: unknown; Memos?: Array<{ Memo?: { MemoData?: unknown } }> } | null;
  if (!t || typeof t !== 'object' || t.TransactionType !== 'Payment' || !Array.isArray(t.Memos)) return null;
  const data = t.Memos[0]?.Memo?.MemoData;
  return typeof data === 'string' && /^FE[0-9A-Fa-f]{64,}$/.test(data) ? data.toUpperCase() : null;
}

/**
 * Called by the prepare clients with each composed 0xFE and whatever the server
 * said about its delivery. `executorEnabled === true` is the ONLY word that lets
 * the banner promise delivery; anything else (a stopped executor, an older
 * backend with no field at all) keeps the prudent sentence.
 */
export function noteFlareInstructionDelivery(
  xrplTx: unknown,
  serverDelivery: { executorEnabled?: unknown } | null | undefined,
): void {
  const memo = flareInstructionMemoOf(xrplTx);
  if (!memo) return;
  executorByInstructionMemo.delete(memo);
  executorByInstructionMemo.set(memo, serverDelivery?.executorEnabled === true);
  while (executorByInstructionMemo.size > INSTRUCTION_DELIVERY_MEMORY) {
    const oldest = executorByInstructionMemo.keys().next().value;
    if (oldest === undefined) break;
    executorByInstructionMemo.delete(oldest);
  }
  // it.16 (R3 3.2): remember SEPARATELY whether anybody actually told us. The
  // banner must be able to tell «the server said the executor is stopped» from
  // «no route sends the field», because only the first is an accusation.
  if (serverDelivery && typeof serverDelivery.executorEnabled === 'boolean') {
    instructionDeliveryHeard.add(memo);
  } else {
    instructionDeliveryHeard.delete(memo);
  }
  while (instructionDeliveryHeard.size > INSTRUCTION_DELIVERY_MEMORY) {
    const oldest = instructionDeliveryHeard.values().next().value;
    if (oldest === undefined) break;
    instructionDeliveryHeard.delete(oldest);
  }
}

/** The 0xFE memos whose prepare actually carried an `executorEnabled` word. */
const instructionDeliveryHeard = new Set<string>();

/**
 * productizer it.16 (R3 3.2) — WHAT WE ACTUALLY KNOW ABOUT THIS 0xFE's CARRIER.
 *
 * The prudent sentence of it.14 («nothing confirmed here that the executor is
 * running») went out on EVERY institutional exit, because NO 0xFE route sends
 * `serverDelivery` — only council-order prepares do. A permanent, unfalsifiable
 * warning over a legitimate withdrawal is not prudence: it is noise the person
 * cannot act on, and the server does know the answer.
 *
 *   · 'delivers' → the prepare said the executor runs: the banner may promise it.
 *   · 'stopped'  → the prepare said it does NOT run: the prudent sentence, which
 *                  is now an actual statement about this deployment.
 *   · 'unknown'  → nobody said (no field on this route): neutral wording that
 *                  does not accuse anyone of not delivering. It still says «do
 *                  NOT sign it again» — that part never depended on the field.
 */
export type InstructionDeliveryWord = 'delivers' | 'stopped' | 'unknown';

export function flareInstructionDeliveryWord(txKey: string): InstructionDeliveryWord {
  const memo = flareInstructionMemoOf(txKey);
  if (!memo) return 'unknown';
  if (!instructionDeliveryHeard.has(memo)) return 'unknown';
  return executorByInstructionMemo.get(memo) === true ? 'delivers' : 'stopped';
}

/** Is this serialized transaction a council order (Payment + 32-byte memo commitment)? */
export function isCouncilOrderTx(txKey: string): boolean {
  return councilOrderMemoOf(txKey) !== null;
}

/** Is this serialized transaction a 0xFE Smart Account instruction? */
export function isFlareInstructionTx(txKey: string): boolean {
  return flareInstructionMemoOf(txKey) !== null;
}

/**
 * Is this transaction something the SERVER delivers to Flare once the ledger
 * validates it — so the person must not be told to act on it again?
 *   · a council order: ONLY if its prepare said `recorded && executorEnabled`
 *     (`noteCouncilOrderDelivery`). The syntax alone promised a delivery the
 *     server may not have taken on (R5 1.3 / R2 3.2).
 *   · a 0xFE Smart Account instruction: ONLY if its prepare said the executor
 *     runs (`noteFlareInstructionDelivery`). The persisted handoff is half the
 *     chain; with the executor stopped nothing sweeps the Core Vault, and the
 *     banner used to promise delivery from the syntax alone (it.14, R2 2.6).
 * Anything else (credentials, trust lines, plain payments) is not.
 */
export function deliversToFlareAutomatically(txKey: string): boolean {
  const memo = councilOrderMemoOf(txKey);
  if (memo) return serverDeliveryByMemo.get(memo) === true;
  const instruction = flareInstructionMemoOf(txKey);
  if (instruction) return executorByInstructionMemo.get(instruction) === true;
  return false;
}

/* ── The registry ────────────────────────────────────────────────────────── */

export type LiveRequestState =
  /** A mounted component shows it and watches it. Not in the banner. */
  | 'owned'
  /** Its screen went away undecided: this module reads its status. */
  | 'watched'
  /** Signed; a mounted component is reading the ledger result. Not in the banner. */
  | 'confirming'
  /** Signed; its screen went away before the ledger result: this module reads it. */
  | 'validating'
  /** The ledger validated it with tesSUCCESS while no screen showed it. */
  | 'validated'
  /** It did not take effect: refused / stale before any ledger, or validated with a failure. */
  | 'failed'
  /** It ended SIGNED and the ledger result could not be read: check the result. */
  | 'signed'
  /** The watch ran out of time without a readable verdict. */
  | 'unread';

export type LiveRequestFailure = 'refused' | 'stale' | 'onchain';

export interface LiveXamanRequest {
  uuid: string;
  /** What the surface said it was signing (already translated by it). */
  title: string;
  /** Epoch ms the payload was registered. */
  createdAt: number;
  /** The serialized transaction the payload signs. */
  txKey: string;
  state: LiveRequestState;
  /** Ledger hash, when a signed request returned one. */
  txid?: string;
  /** The result code behind a 'failed' entry. */
  code?: string;
  /** Why a 'failed' entry did not take effect. */
  failure?: LiveRequestFailure;
  /** What Xaman answered to «Cancel it here» (payloadBus vocabulary). */
  cancelUi: XamanCancelUi;
  /**
   * A 'failed' + 'stale' COUNCIL ORDER: what the server said became of the order
   * (it.13). Absent for anything that is not a council order.
   */
  fate?: StaleOrderFate;
}

/**
 * Still signable, or signed with its ledger result still being read: what
 * `beforeunload` guards (a reload would lose the only reader of either).
 */
export function isOpenLiveRequest(r: LiveXamanRequest): boolean {
  return r.state === 'owned' || r.state === 'watched' || r.state === 'confirming' || r.state === 'validating';
}

/** What the global banner lists: everything no mounted component is showing. */
export function bannerRequests(list: readonly LiveXamanRequest[]): LiveXamanRequest[] {
  return list.filter((r) => r.state !== 'owned' && r.state !== 'confirming');
}

/** Poll cadence — the same 2.5 s as the component. */
export const LIVE_POLL_MS = 2500;
/**
 * How long a watch may go without a verdict before it says «could not read».
 * Every payload `XamanSingleSign` creates has `expire: 5` (MINUTES), so a
 * reachable Xaman answers `expired` well before this.
 */
export const LIVE_WATCH_CAP_MS = 12 * 60_000;
/**
 * How long the registry waits for the ledger to validate a handed-off signature.
 * A submitted tx validates in seconds; a pinned order cannot outlive its
 * LastLedgerSequence window (~10 min), and past this we say «check the hash».
 */
export const LIVE_VALIDATION_TIMEOUT_MS = 3 * 60_000;

type Timer = ReturnType<typeof setInterval>;

export interface LiveRequestsDeps {
  fetchStatus: (uuid: string) => Promise<XamanPayloadStatusRead>;
  cancel: (
    uuid: string,
    onScreenUuid: () => string | null | undefined,
  ) => Promise<{ action: XamanCancelAction }>;
  awaitValidation: (
    txid: string,
    opts: { timeoutMs: number },
  ) => Promise<{ validated: boolean; finalResult?: string; timedOut?: boolean }>;
  /** What became of a composed council order (GET /institutional/council-order/fate). */
  fetchFate: (memo: string) => Promise<CouncilOrderFateReadLike>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => Timer;
  clearInterval: (t: Timer) => void;
}

const defaultDeps = (): LiveRequestsDeps => ({
  fetchStatus: (uuid) => fetchXamanStatus(uuid),
  cancel: (uuid, onScreen) => cancelPayloadAndDecide(uuid, onScreen),
  awaitValidation: (txid, opts) => awaitValidation(txid, opts),
  // Dynamic on purpose: lib/institutional/api imports this module (the delivery
  // word is registered at prepare time), so a static import would be a cycle.
  fetchFate: async (memo) => {
    try {
      return await (await import('../institutional/api')).readCouncilOrderFate(memo);
    } catch {
      return { ok: false };
    }
  },
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (t) => clearInterval(t),
});

let deps: LiveRequestsDeps = defaultDeps();
const entries = new Map<string, LiveXamanRequest>();
const timers = new Map<string, Timer>();
/** Status reads in flight, so a slow read and the next tick never overlap. */
const checking = new Set<string>();
/** Cancel round trips in flight, so a double press never fires a second DELETE. */
const cancelling = new Set<string>();
/** Ledger reads in flight, one per request. */
const following = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: LiveXamanRequest[] = [];

function emit(): void {
  snapshot = [...entries.values()];
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('xaman liveRequests listener error:', err);
    }
  });
}

function put(entry: LiveXamanRequest): void {
  entries.set(entry.uuid, entry);
  emit();
}

function patch(uuid: string, change: Partial<LiveXamanRequest>): void {
  const cur = entries.get(uuid);
  if (!cur) return;
  put({ ...cur, ...change });
}

function stopWatch(uuid: string): void {
  const t = timers.get(uuid);
  if (t !== undefined) deps.clearInterval(t);
  timers.delete(uuid);
}

function remove(uuid: string): void {
  stopWatch(uuid);
  if (entries.delete(uuid)) emit();
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeLiveRequests(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The current list. Same array identity until something changes (useSyncExternalStore). */
export function listLiveRequests(): LiveXamanRequest[] {
  return snapshot;
}

export function hasOpenLiveRequests(): boolean {
  return snapshot.some(isOpenLiveRequest);
}

/** A component's payload now exists in Xaman: it is signable from this instant. */
export function registerLiveRequest(input: {
  uuid: string;
  title: string;
  txKey: string;
  createdAt?: number;
}): void {
  const cur = entries.get(input.uuid);
  if (cur && cur.state !== 'owned') return; // already watched / reported: never demoted
  put({
    uuid: input.uuid,
    title: input.title,
    txKey: input.txKey,
    createdAt: cur?.createdAt ?? input.createdAt ?? deps.now(),
    state: 'owned',
    cancelUi: 'idle',
  });
}

/**
 * Its owner read «signed» with a hash and is now reading the LEDGER result:
 * nothing is signable any more, but the signature is not settled either. Listed
 * as 'confirming' (not in the banner — the component shows it; in
 * `beforeunload` — a reload would lose it).
 */
export function confirmLiveRequest(input: { uuid: string; title: string; txKey: string; txid: string }): void {
  const cur = entries.get(input.uuid);
  if (cur && cur.state !== 'owned' && cur.state !== 'confirming') return;
  stopWatch(input.uuid);
  put({
    uuid: input.uuid,
    title: cur?.title ?? input.title,
    txKey: cur?.txKey ?? input.txKey,
    createdAt: cur?.createdAt ?? deps.now(),
    state: 'confirming',
    txid: input.txid,
    cancelUi: 'idle',
  });
}

/**
 * Its owner reached a verdict it SHOWS (a ledger result, cancelled, expired,
 * declined, refused): nothing is left open. A request already handed to the
 * banner (validating / reported) is not the owner's to erase.
 */
export function resolveLiveRequest(uuid: string): void {
  const cur = entries.get(uuid);
  if (!cur || (cur.state !== 'owned' && cur.state !== 'watched' && cur.state !== 'confirming')) return;
  remove(uuid);
}

/**
 * Its screen went away WITHOUT a verdict. No cancel — the registry keeps reading
 * the status until Xaman decides. `title`/`txKey` register it when the owner
 * never got the chance to (the payload arrived after the component was gone).
 * A 'confirming' signature is handed off as 'validating': the registry reads
 * the ledger result the component can no longer read.
 */
export function handOffLiveRequest(input: { uuid: string; title: string; txKey: string }): void {
  const cur = entries.get(input.uuid);
  if (cur && cur.state === 'confirming') {
    put({ ...cur, state: 'validating' });
    void followLiveValidation(input.uuid);
    return;
  }
  if (cur && cur.state !== 'owned') return;
  put({
    uuid: input.uuid,
    title: cur?.title ?? input.title,
    txKey: cur?.txKey ?? input.txKey,
    createdAt: cur?.createdAt ?? deps.now(),
    state: 'watched',
    cancelUi: cur?.cancelUi ?? 'idle',
  });
  if (!timers.has(input.uuid)) {
    timers.set(input.uuid, deps.setInterval(() => void checkLiveRequest(input.uuid), LIVE_POLL_MS));
  }
}

/**
 * A component went away while the ledger outcome of a SIGNED request was still
 * unread (unconfirmed, validated with a failure). Nobody follows it now: the
 * banner says «signed — check the result», with the hash. Never overwrites a
 * request the registry is already reading or has read.
 */
export function noteUnfollowedSignature(input: {
  uuid: string;
  title: string;
  txKey: string;
  txid?: string;
}): void {
  const cur = entries.get(input.uuid);
  if (cur && (cur.state === 'validating' || cur.state === 'validated' || cur.state === 'failed')) return;
  stopWatch(input.uuid);
  put({
    uuid: input.uuid,
    title: cur?.title ?? input.title,
    txKey: cur?.txKey ?? input.txKey,
    createdAt: cur?.createdAt ?? deps.now(),
    state: 'signed',
    txid: input.txid ?? cur?.txid,
    cancelUi: 'idle',
  });
}

/** The person read a notice (validated / failed / signed — check / could not read). */
export function dismissLiveRequest(uuid: string): void {
  const cur = entries.get(uuid);
  if (!cur || (cur.state !== 'signed' && cur.state !== 'unread' && cur.state !== 'validated' && cur.state !== 'failed')) {
    return;
  }
  remove(uuid);
}

/** What a signature verdict read by the REGISTRY does to its entry. */
function applyRegistryVerdict(uuid: string, v: SingleSignVerdict): void {
  switch (v.kind) {
    case 'await-validation':
      patch(uuid, { state: 'validating', txid: v.txid, cancelUi: 'idle' });
      void followLiveValidation(uuid);
      return;
    case 'settled':
      patch(uuid, { state: 'validated', txid: v.txid, cancelUi: 'idle' });
      return;
    case 'failed-onchain':
      patch(uuid, { state: 'failed', failure: 'onchain', code: v.code, txid: v.txid, cancelUi: 'idle' });
      return;
    case 'stale': {
      const memo = councilOrderMemoOf(entries.get(uuid)?.txKey ?? '');
      patch(uuid, {
        state: 'failed',
        failure: 'stale',
        code: v.code,
        txid: v.txid,
        cancelUi: 'idle',
        ...(memo ? { fate: { kind: 'checking' } as StaleOrderFate } : {}),
      });
      // A council order: never «prepare it again» before asking what became of it.
      if (memo) void followStaleFate(uuid, memo);
      return;
    }
    case 'refused':
      patch(uuid, { state: 'failed', failure: 'refused', code: v.code, cancelUi: 'idle' });
      return;
    case 'unconfirmed':
      patch(uuid, { state: 'signed', txid: v.txid, cancelUi: 'idle' });
      return;
  }
}

/**
 * Read the ledger result of a 'validating' entry (once; concurrent calls join).
 * Resolves when the entry has its verdict — or when it is no longer the same
 * request (dismissed, reset).
 */
export async function followLiveValidation(uuid: string): Promise<void> {
  const cur = entries.get(uuid);
  if (!cur || cur.state !== 'validating' || following.has(uuid)) return;
  const txid = cur.txid;
  if (!txid) {
    patch(uuid, { state: 'signed' });
    return;
  }
  following.add(uuid);
  let v: { validated: boolean; finalResult?: string; timedOut?: boolean };
  try {
    v = await deps.awaitValidation(txid, { timeoutMs: LIVE_VALIDATION_TIMEOUT_MS });
  } catch {
    v = { validated: false, timedOut: true };
  } finally {
    following.delete(uuid);
  }
  const now = entries.get(uuid);
  if (!now || now.state !== 'validating' || now.txid !== txid) return;
  applyRegistryVerdict(
    uuid,
    decideAfterValidation({ txid, validated: v.validated, finalResult: v.finalResult, timedOut: v.timedOut }),
  );
}

/**
 * A stale council order in the banner: read the ORDER's fate once and say it.
 * A read that throws is «could not check» — never a silent «prepare it again».
 */
export async function followStaleFate(uuid: string, memo: string): Promise<void> {
  const cur = entries.get(uuid);
  if (!cur || cur.state !== 'failed' || cur.failure !== 'stale' || cur.fate?.kind !== 'checking') return;
  let read: CouncilOrderFateReadLike;
  try {
    read = await deps.fetchFate(memo);
  } catch {
    read = { ok: false };
  }
  const now = entries.get(uuid);
  if (!now || now.state !== 'failed' || now.failure !== 'stale' || now.fate?.kind !== 'checking') return;
  patch(uuid, { fate: staleOrderFate(read) });
}

/* ── Notices: messages that belong to no payload ─────────────────────────── */

export type LiveNoticeKind = 'seat-release-refused';

export interface LiveNotice {
  id: string;
  kind: LiveNoticeKind;
  /** What the server (or the network) answered, verbatim. */
  detail: string;
  /** The 0xFE memo the notice is about, when there is one. */
  memoHex?: string;
  /** How long until the seat frees itself (the backend's HANDOFF_SEAT_TTL_MIN default). */
  freesInMinutes?: number;
  /**
   * it. 19 (R5 R4): the SAME wait, as the SERVER measured it (`secondsLeft` of a
   * 409 `WAIT_FOR_PAYLOAD_EXPIRY`). When it is here it wins over the constant
   * above: a client-side «about 5 minutes» printed over a window the server put
   * at 6 is a promise the person watches break, and the constant only ever
   * existed because nothing carried the real number.
   */
  freesInSeconds?: number;
  createdAt: number;
  /**
   * it. 21 (it. 20 §3.4) — THE INSTANT THE COUNTDOWN COUNTS TO.
   *
   * `freesInSeconds` is a measurement taken WHEN THE NOTICE WAS PUSHED, and the
   * banner printed it verbatim for as long as the notice lived: «it frees itself
   * in about 287 seconds», still saying 287 five minutes later. A number that
   * does not move is not a countdown, it is a claim the person watches go stale.
   *
   * So the seconds are turned into an absolute instant once, here, and the
   * banner derives the remaining time from the clock. Absent ⇔ nothing measured
   * anything (the notice then says so, instead of counting down a guess).
   */
  freesAt?: number;
  /**
   * it. 23 (it. 22 §3.1) — «I COULD NOT CHECK» IS NOT A WINDOW.
   *
   * The release answered 503 (`SEAT_STATE_UNREADABLE` and friends): NOTHING was
   * measured, so the notice carries no window at all and the banner must say
   * that instead of counting down the client's constant and then announcing
   * that the window has passed — which is the fact this rail forbids inventing,
   * and which contradicted the card next to it.
   */
  unreadable?: boolean;
  /** Is asking again expected to work? True for a read failure of ours. */
  retryable?: boolean;
}

const notices = new Map<string, LiveNotice>();
const noticeListeners = new Set<() => void>();
let noticeSnapshot: LiveNotice[] = [];
let noticeSeq = 0;
const NOTICE_MEMORY = 20;

function emitNotices(): void {
  noticeSnapshot = [...notices.values()];
  noticeListeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('xaman liveRequests notice listener error:', err);
    }
  });
}

/** Show a notice in the global banner. The same memo replaces its previous notice. */
export function pushLiveNotice(input: Omit<LiveNotice, 'id' | 'createdAt'>): LiveNotice {
  if (input.memoHex) {
    for (const [id, n] of notices) if (n.kind === input.kind && n.memoHex === input.memoHex) notices.delete(id);
  }
  noticeSeq += 1;
  const createdAt = deps.now();
  // it. 21 (§3.4): the measurement becomes an INSTANT here, once. The caller may
  // also hand us one directly (it already knows the deadline); either way the
  // banner reads the clock from now on, never a frozen number.
  const measuredSeconds =
    input.freesInSeconds !== undefined && Number.isFinite(input.freesInSeconds) && input.freesInSeconds > 0
      ? Math.round(input.freesInSeconds)
      : input.freesInMinutes !== undefined && Number.isFinite(input.freesInMinutes) && input.freesInMinutes > 0
        ? Math.round(input.freesInMinutes) * 60
        : undefined;
  // it. 23 (§3.1): a notice that says «we could not read the seat» NEVER gets a
  // deadline, whatever a caller passed — the countdown is the claim, and there
  // is nothing here to claim. Enforced once, so no future emitter can undo it.
  const freesAt = input.unreadable
    ? undefined
    : (input.freesAt ?? (measuredSeconds !== undefined ? createdAt + measuredSeconds * 1000 : undefined));
  const notice: LiveNotice = {
    ...input,
    ...(freesAt !== undefined ? { freesAt } : {}),
    id: `notice-${noticeSeq}`,
    createdAt,
  };
  notices.set(notice.id, notice);
  while (notices.size > NOTICE_MEMORY) {
    const oldest = notices.keys().next().value;
    if (oldest === undefined) break;
    notices.delete(oldest);
  }
  emitNotices();
  return notice;
}

export function dismissLiveNotice(id: string): void {
  if (notices.delete(id)) emitNotices();
}

export function subscribeLiveNotices(cb: () => void): () => void {
  noticeListeners.add(cb);
  return () => {
    noticeListeners.delete(cb);
  };
}

/** The current notices. Same array identity until something changes (useSyncExternalStore). */
export function listLiveNotices(): LiveNotice[] {
  return noticeSnapshot;
}

/**
 * it. 21 (it. 20 §3.4) — WHAT THE BANNER SHOULD SAY *NOW*.
 *
 * Pure, so the countdown is tested without a browser and without a clock:
 *   · `secondsLeft` counts down from the instant the notice carries;
 *   · `expired` is true once that instant has passed — the banner then flips to
 *     «the window has passed, prepare it again» instead of printing 0, and
 *     instead of promising that preparing it again WINS (it is a race, not a
 *     reservation: it. 20 §3.9);
 *   · both are null/false when nothing ever measured a window, which is not the
 *     same as a window of zero.
 */
export function liveNoticeCountdown(
  n: Pick<LiveNotice, 'freesAt' | 'freesInMinutes'>,
  now: number = deps.now(),
): { secondsLeft: number | null; expired: boolean } {
  if (n.freesAt === undefined || !Number.isFinite(n.freesAt)) return { secondsLeft: null, expired: false };
  const left = Math.ceil((n.freesAt - now) / 1000);
  return left > 0 ? { secondsLeft: left, expired: false } : { secondsLeft: 0, expired: true };
}

/** Read a watched request's status once (also the poll tick). */
export async function checkLiveRequest(uuid: string): Promise<void> {
  const cur = entries.get(uuid);
  if (!cur || cur.state !== 'watched' || checking.has(uuid)) return;
  checking.add(uuid);
  let st: XamanPayloadStatusRead;
  try {
    st = await deps.fetchStatus(uuid);
  } finally {
    checking.delete(uuid);
  }
  const now = entries.get(uuid);
  if (!now || now.state !== 'watched') return;
  switch (payloadWatchVerdict(st)) {
    case 'signed':
      stopWatch(uuid);
      // Signed is not the end: the same first decision as the component, then
      // the ledger's word (validating → validated / failed / «check the hash»).
      applyRegistryVerdict(uuid, decideAfterSigned({ txid: st.txid, dispatched: st.dispatched }));
      return;
    case 'cancelled':
    case 'expired':
    case 'declined':
      // Nothing was signed and nothing is left on the phone.
      remove(uuid);
      return;
    case 'pending':
      if (deps.now() - now.createdAt > LIVE_WATCH_CAP_MS) {
        stopWatch(uuid);
        patch(uuid, { state: 'unread' });
      }
      return;
  }
}

/**
 * «Cancel it here» for a watched request: ask Xaman, then obey its answer —
 * the same `cancelPayloadAndDecide` + `retreatDecision` the component uses.
 */
export async function cancelLiveRequest(uuid: string): Promise<void> {
  const cur = entries.get(uuid);
  if (!cur || cur.state !== 'watched' || cancelling.has(uuid)) return;
  cancelling.add(uuid);
  patch(uuid, { cancelUi: 'cancelling' });
  let action: XamanCancelAction;
  try {
    ({ action } = await deps.cancel(uuid, () => (entries.get(uuid)?.state === 'watched' ? uuid : null)));
  } catch {
    action = 'warn-unknown';
  } finally {
    cancelling.delete(uuid);
  }
  const now = entries.get(uuid);
  // A poll already decided it (signed → validating; expired → gone): that owns it.
  if (!now || now.state !== 'watched') return;
  const d = retreatDecision(action);
  switch (d.kind) {
    case 'closed':
      remove(uuid);
      return;
    case 'follow':
      // Answered on the phone before we asked — maybe signed. Read it now.
      patch(uuid, { cancelUi: 'resolved' });
      void checkLiveRequest(uuid);
      return;
    case 'stay':
      patch(uuid, { cancelUi: d.warn });
      return;
    case 'ignore':
      patch(uuid, { cancelUi: 'idle' });
      return;
  }
}

/* ── Scoped "a signature blocks" tally (pure) ────────────────────────────── */

/**
 * Counts which signing children currently block retreat, and reports only the
 * transitions of «any blocks». The React scope in `XamanSingleSign` wraps it so
 * an ancestor (a lens bar, an operation window's X) can lock itself without
 * every component in between threading `onBlockedChange`.
 */
export function createBlockTally(onChange: (anyBlocked: boolean) => void) {
  const blockers = new Set<unknown>();
  return {
    report(id: unknown, blocked: boolean): void {
      const before = blockers.size > 0;
      if (blocked) blockers.add(id);
      else blockers.delete(id);
      const after = blockers.size > 0;
      if (before !== after) onChange(after);
    },
    get blocked(): boolean {
      return blockers.size > 0;
    },
  };
}

/* ── Test hooks ──────────────────────────────────────────────────────────── */

/** Tests only: swap the network/clock/timers. */
export function __setLiveRequestsDeps(next: Partial<LiveRequestsDeps>): void {
  deps = { ...deps, ...next };
}

/** Tests only: forget everything and restore the real deps. */
export function __resetLiveRequests(): void {
  timers.forEach((t) => deps.clearInterval(t));
  timers.clear();
  entries.clear();
  checking.clear();
  cancelling.clear();
  following.clear();
  listeners.clear();
  snapshot = [];
  serverDeliveryByMemo.clear();
  executorByInstructionMemo.clear();
  instructionDeliveryHeard.clear();
  notices.clear();
  noticeListeners.clear();
  noticeSnapshot = [];
  noticeSeq = 0;
  deps = defaultDeps();
}

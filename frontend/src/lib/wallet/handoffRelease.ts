/**
 * releaseHandoffSeat — libera el asiento de nonce de una orden 0xFE preparada
 * y NO firmada (el usuario canceló, pulsó Atrás o cerró el modal en revisión).
 *
 * El backend marca esa fila 'superseded' para que el usuario pueda preparar
 * otra al instante, sin esperar al TTL del asiento (buildDirectMintHandoff) ni
 * quedar tapiado por NONCE_SEAT_TAKEN. `keepalive` para que sobreviva al
 * desmontaje del modal / navegación.
 *
 * Solo toca filas 'queued' server-side: jamás vuelve inejecutable una Payment
 * ya firmada (el executor la resuelve por hash pase cual sea el status). Por eso
 * solo debe llamarse cuando el usuario ABANDONA sin firmar, no tras firmar.
 *
 * LOS RECHAZOS SE VEN (productizer it.13, R5 1.2). `postHandoff` se tragaba la
 * respuesta: un 403 NOT_THE_HANDOFF_OWNER (quien preparó sin binding firmado) o
 * un 500 dejaban el asiento tomado en silencio, y el siguiente NONCE_SEAT_TAKEN
 * decía «se libera al cancelar» — falso para esa persona. Ahora el resultado es
 * tipado y, sin tocar a quien llama (sigue siendo fire-and-forget), un rechazo
 * del release llega al banner global (`pushLiveNotice` → LiveXamanRequests):
 * «no se pudo liberar el asiento: <detalle>. Se libera solo en ~N minutos».
 */
import { getApiBase } from '../env';
import { pushLiveNotice, type LiveNotice } from '../xaman/liveRequests';
import {
  describeRetryableRefusal,
  isRetryableReadFailure,
  looksLikeRawCode,
  readSeatRelease,
  serverDetailIfEnglish,
} from '../xaman/seatRefusal';

/**
 * The backend's default seat TTL (`HANDOFF_SEAT_TTL_MIN`, FlareDirectMintService).
 * A deployment can change it; the notice says «about», never an exact promise.
 */
export const HANDOFF_SEAT_TTL_MIN_DEFAULT = 5;

/**
 * it. 21 (it. 20 §3.9) — ONE NUMBER, AND THE SERVER OWNS IT.
 *
 * Xaman's `expire` (in MINUTES) is what decides how long a payload can be
 * signed, and the backend measures the SEAT's window from exactly that
 * (`HANDOFF_PAYLOAD_EXPIRY_MIN` → `payloadExpiryMin`, which every prepare and
 * every `payload-opened` answer carries). The frontend had its own hand-written
 * `5` and never read the server's, so a deployment that raised the server's
 * number to 10 would mint 5-minute payloads whose seat stayed held for ten —
 * and one that LOWERED it would free a seat while its payload was still
 * signable, which is the twin this whole rail exists to prevent.
 *
 * So the constant is the FALLBACK, not the truth: `notePayloadExpiryMin` learns
 * the server's value from any answer that carries it and `payloadExpiryMin()`
 * is what the mint reads. Nothing is invented — an absurd value (≤0, not
 * finite, or beyond Xaman's own 24 h cap) is ignored and the constant stands.
 */
export const XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT = 5;

/** Xaman's own ceiling for `expire` (24 h). Nothing above this is a real window. */
const XAMAN_MAX_EXPIRY_MIN = 1440;

/**
 * it. 25 (§2) — WHAT AN *ORDINARY* SIGNATURE'S WINDOW CAN BE, AT MOST.
 *
 * The backend clamps `HANDOFF_PAYLOAD_EXPIRY_MIN` to [1, 60] (`handoffAuthority`),
 * and anything LONGER than that is, by construction, a row that declared a signing
 * CEREMONY — a quorum's payload, 24 h. The distinction is what makes the value
 * below per-row rather than per-tab; see `notePayloadExpiryMin`.
 */
export const ORDINARY_PAYLOAD_EXPIRY_MAX_MIN = 60;

let learnedPayloadExpiryMin: number | null = null;
/** The window of a SPECIFIC 0xFE, by its memo. Bounded: a tab may mint many. */
const perMemoExpiryMin = new Map<string, number>();
const MAX_REMEMBERED_MEMOS = 64;

/**
 * it. 31 (§5) — WHAT THE SERVER *READ* ABOUT THE ACCOUNT, PER ROW.
 *
 * `'single'` / `'quorum'` are readings of the SignerList the server made when it
 * composed that row; `'unknown'` is the server saying it did NOT read (a node
 * timeout, an operational account, a route that never asked). A row whose
 * answer carried no field at all is `'unknown'` too — an older backend, or a
 * prepare that never went through the learners — and silence is never a verdict.
 */
export type ServerSignerListRead = 'single' | 'quorum' | 'unknown';
const perMemoSignerListRead = new Map<string, ServerSignerListRead>();

function saneSignerListRead(value: unknown): ServerSignerListRead | null {
  return value === 'single' || value === 'quorum' || value === 'unknown' ? value : null;
}

/** A number that could be a Xaman `expire`, in minutes — or null. */
function sanePayloadExpiryMin(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const mins = Math.round(value);
  // Xaman caps `expire` at 24 h; below a minute nothing is signable in practice.
  return mins >= 1 && mins <= XAMAN_MAX_EXPIRY_MIN ? mins : null;
}

function memoKey(memoHex: unknown): string | null {
  const memo = typeof memoHex === 'string' ? memoHex.trim().toUpperCase() : '';
  return memo.length > 0 ? memo : null;
}

/* ── it. 29 (§5) — LA VENTANA TIENE QUE SOBREVIVIR A UNA RECARGA ───────────── */

/**
 * WHAT FAILED IN SILENCE. `perMemoExpiryMin` is a module Map, so an F5 — or a
 * second tab, or a browser that evicted the page — erased everything the server
 * had said about every row. After the reload `serverDeclaredCeremony(memo)` went
 * back to `false`, the routing decision fell to `accountHasQuorum` (a public RPC
 * with a 60 s cache), and when THAT could not be read `sendIntent` took the
 * single-signature path: Xaman AUTOFILLS the `Sequence` there, which is the one
 * shape in which two Payments of the same account can both reach the ledger.
 * it. 27 closed the twin for a tab that never reloads, which is not a tab.
 *
 * So the server's per-row verdict is written down. What is stored is exactly
 * what was already held in memory — a memo and the number of minutes the SERVER
 * answered for it — never a secret, never a key, never anything a request body
 * could set: the only writer is `notePayloadExpiryMin`, fed by the server's own
 * answers.
 *
 * BOUNDED AND SELF-EXPIRING, because a trace that outlives what it describes is
 * how this rail has wedged families shut before. At most `MAX_REMEMBERED_MEMOS`
 * rows, oldest first, and nothing older than Xaman's own ceiling plus an hour:
 * past that, no payload of that row can still be signable, so the note describes
 * nothing. A storage that is unavailable, full or corrupt is NOT an error — the
 * Map alone is exactly the behaviour of it. 27, never worse.
 */
const WINDOW_STORE_KEY = 'astryum.handoff.rowWindow.v1';
/** Xaman's ceiling (24 h) plus an hour of slack: past it nothing is signable. */
const WINDOW_STORE_MAX_AGE_MS = (XAMAN_MAX_EXPIRY_MIN + 60) * 60_000;
/** When each memo's window was learnt, so an old note can be dropped on sight. */
const perMemoLearntAt = new Map<string, number>();
let hydrated = false;

function windowStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // storage disabled (private mode, blocked cookies): the Map stands
  }
}

/** Read the tab's written notes ONCE, lazily: never at import time (SSR). */
function hydrateWindows(): void {
  if (hydrated) return;
  hydrated = true;
  const store = windowStore();
  if (!store) return;
  try {
    const raw = store.getItem(WINDOW_STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    for (const [memo, note] of Object.entries(parsed as Record<string, unknown>)) {
      const key = memoKey(memo);
      if (!key) continue;
      const mins = sanePayloadExpiryMin((note as { m?: unknown })?.m);
      const at = (note as { t?: unknown })?.t;
      if (mins === null || typeof at !== 'number' || !Number.isFinite(at)) continue;
      if (now - at > WINDOW_STORE_MAX_AGE_MS) continue; // nothing of that row is signable
      if (perMemoExpiryMin.size >= MAX_REMEMBERED_MEMOS) break;
      perMemoExpiryMin.set(key, mins);
      perMemoLearntAt.set(key, at);
      // it. 31 (§5): the server's read survives the reload with the window it
      // qualifies. A note without one reads as «not read» — never as 'single'.
      const read = saneSignerListRead((note as { r?: unknown })?.r);
      if (read) perMemoSignerListRead.set(key, read);
    }
  } catch {
    /* a corrupt note teaches nothing — the Map alone is it. 27's behaviour */
  }
}

/** Write the notes back. Best-effort: a full or blocked storage changes nothing. */
function persistWindows(): void {
  const store = windowStore();
  if (!store) return;
  try {
    const out: Record<string, { m: number; t: number; r?: ServerSignerListRead }> = {};
    for (const [memo, mins] of perMemoExpiryMin) {
      const read = perMemoSignerListRead.get(memo);
      out[memo] = { m: mins, t: perMemoLearntAt.get(memo) ?? Date.now(), ...(read ? { r: read } : {}) };
    }
    store.setItem(WINDOW_STORE_KEY, JSON.stringify(out));
  } catch {
    /* the Map is still right for this tab */
  }
}

/**
 * it. 25 (§2) — THE WINDOW BELONGS TO A ROW, NOT TO THE TAB.
 *
 * WHAT FAILED: this remembered ONE number for the whole module, so the LAST
 * prepare read in the tab decided the `expire` of every payload minted after it.
 * Since §2.1 an institutional exit of a council pote answers `payloadExpiryMin:
 * 1440` — so opening that screen and then signing ANY ordinary 0xFE (a repay, a
 * personal exit) would mint a 24-hour payload and hold that account's nonce seat
 * for a day. The reverse leak is the twin itself: a 5 learnt somewhere else,
 * applied to a ceremony, frees a seat while a quorum is still signing.
 *
 * SO: a ceremony's window (anything longer than an ordinary signature can be) is
 * remembered ONLY against its own memo and is only ever handed back for that memo.
 * An ordinary value still updates the tab-wide fallback, because that one IS a
 * deployment-wide setting (`HANDOFF_PAYLOAD_EXPIRY_MIN`) — which is what this
 * learning was built for. Nothing is invented: an absurd value is ignored.
 */
export function notePayloadExpiryMin(value: unknown, memoHex?: unknown, signerListRead?: unknown): void {
  const mins = sanePayloadExpiryMin(value);
  if (mins === null) return;
  const memo = memoKey(memoHex);
  if (memo) {
    // it. 29 (§5): read the written notes BEFORE evicting, or a fresh tab would
    // trim a Map it has not filled in yet and drop rows it never looked at.
    hydrateWindows();
    // Bounded, oldest-first: a long session must not grow this without limit.
    if (perMemoExpiryMin.size >= MAX_REMEMBERED_MEMOS && !perMemoExpiryMin.has(memo)) {
      const oldest = perMemoExpiryMin.keys().next();
      if (!oldest.done) {
        perMemoExpiryMin.delete(oldest.value);
        perMemoLearntAt.delete(oldest.value);
        perMemoSignerListRead.delete(oldest.value);
      }
    }
    perMemoExpiryMin.set(memo, mins);
    perMemoLearntAt.set(memo, Date.now());
    // it. 31 (§5): the same answer says whether the window was READ or merely
    // defaulted. Learnt with the window, against the same memo; an answer that
    // says nothing leaves the row «not read», which is the safe reading.
    const read = saneSignerListRead(signerListRead);
    if (read) perMemoSignerListRead.set(memo, read);
    else perMemoSignerListRead.delete(memo);
    persistWindows();
  }
  if (mins <= ORDINARY_PAYLOAD_EXPIRY_MAX_MIN) learnedPayloadExpiryMin = mins;
}

/**
 * it. 31 (§5) — what the server said it READ about this row's account. `'unknown'`
 * for a row it never spoke about, or spoke about without saying.
 */
export function serverSignerListRead(memoHex?: unknown): ServerSignerListRead {
  hydrateWindows();
  const memo = memoKey(memoHex);
  if (!memo) return 'unknown';
  return perMemoSignerListRead.get(memo) ?? 'unknown';
}

/**
 * The `expire` a payload must carry, in minutes: the value the caller is holding
 * (`preferred` — the answer of the prepare that composed THIS dispatch), else the
 * one this memo's own prepare answered, else the deployment's ordinary setting,
 * else the constant. Never a ceremony's window on a row that did not declare one.
 */
export function payloadExpiryMin(preferred?: unknown, memoHex?: string | null): number {
  const chosen = sanePayloadExpiryMin(preferred);
  if (chosen !== null) return chosen;
  hydrateWindows();
  const memo = memoKey(memoHex);
  if (memo) {
    const row = perMemoExpiryMin.get(memo);
    if (row !== undefined) return row;
  }
  return learnedPayloadExpiryMin ?? XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT;
}

/**
 * it. 27 (§3) — LA VENTANA DE UNA CEREMONIA, Y DE DÓNDE SALE DE VERDAD.
 *
 * WHAT FAILED: the server has decided this since it. 25 §2.1 (it reads the
 * account's SignerList and composes the 0xFE with the quorum's window), and its
 * number reached NO payload. `notePayloadExpiryMin` was called with no memo at
 * the three doors that carry one, so the per-row value was never learnt; and
 * 1440 is above the ordinary clamp, so the tab-wide branch discards it too. What
 * made ceremonies work at all was a hand-written `expire: 1440` in
 * `lib/xrpl/councilSigning.ts` — a second number for one fact, which is exactly
 * the drift this module exists to end.
 *
 * `payloadExpiryMin` cannot serve a ceremony: its fallback is the ORDINARY
 * deployment setting (5 min), so a sitting over a transaction the server never
 * composed (a cage birth, a SignerSet) would mint 5-minute requests and no
 * quorum could ever be gathered. So the fallback here is the ceremony's own
 * default — and the server's per-row number wins whenever there IS one.
 *
 * Nothing is invented: an absurd value was already dropped on the way in.
 */
export const CEREMONY_PAYLOAD_EXPIRY_MIN_DEFAULT = XAMAN_MAX_EXPIRY_MIN;

export function ceremonyPayloadExpiryMin(memoHex?: unknown): number {
  hydrateWindows();
  const memo = memoKey(memoHex);
  if (memo) {
    const row = perMemoExpiryMin.get(memo);
    if (row !== undefined) return row;
  }
  return CEREMONY_PAYLOAD_EXPIRY_MIN_DEFAULT;
}

/**
 * it. 27 (§4) — ¿DIJO EL SERVIDOR QUE ESTOS BYTES LOS FIRMA UN QUÓRUM?
 *
 * Two independent reads of the same SignerList decided this until now: the
 * backend's (`signingCeremonyFor`, which composes the 0xFE and its
 * `LastLedgerSequence`) and the browser's (`lib/xrpl/accountQuorum.ts`, a public
 * RPC with a 60 s cache). They can disagree, and the direction that hurts is
 * silent: the server composes a 24-hour dispatch while the browser's read fails,
 * so `sendIntent` takes the single-signature path and Xaman AUTOFILLS the
 * Sequence — the one shape in which two Payments of the same account can both
 * reach the ledger.
 *
 * The server's read is the one that shaped the bytes, so it is the one that
 * decides. `true` only when a row's own answer says so; silence is never a
 * verdict (the browser's read is still the fallback for a transaction the
 * server never composed).
 */
export function serverDeclaredCeremony(memoHex?: unknown): boolean {
  hydrateWindows();
  const memo = memoKey(memoHex);
  if (!memo) return false;
  const row = perMemoExpiryMin.get(memo);
  return row !== undefined && row > ORDINARY_PAYLOAD_EXPIRY_MAX_MIN;
}

/**
 * it. 29 (§5) — …Y EL OTRO VEREDICTO DEL SERVIDOR, QUE NADIE PREGUNTABA.
 *
 * `serverDeclaredCeremony` answers one half of the server's read; this is the
 * other, and leaving it unasked is what made the browser's RPC the only judge of
 * an ORDINARY row.
 *
 * it. 31 (§5) — WHAT it. 29 GOT WRONG HERE, AND WHY IT COST A WORKING CHECK.
 * The sentence this used to carry — «a row the server composed with a single
 * signature's window IS a row it read the account for and found no quorum on» —
 * is FALSE. `signingCeremonyFor` answers the ordinary window for a read that
 * said 'single' AND for a read that failed ('unknown': a 6 s SignerList timeout,
 * an exception, an operational account, a route that never asked). it. 29 took
 * every short window for the first case and removed the browser's own read on
 * its strength — so a quorum account whose SignerList could not be read got a
 * single-signature payload with an autofilled Sequence. The twin, by our hand.
 *
 * So the window alone no longer decides. `true` only when the row's own answer
 * DECLARED the read (`signerListRead: 'single'`, learnt by `notePayloadExpiryMin`)
 * — a short window with no declaration, or with `'unknown'`, hands the decision
 * back to the browser's read, exactly as before it. 29. Silence is never a verdict.
 */
export function serverDeclaredSingleSignature(memoHex?: unknown): boolean {
  hydrateWindows();
  const memo = memoKey(memoHex);
  if (!memo) return false;
  const row = perMemoExpiryMin.get(memo);
  if (row === undefined || row > ORDINARY_PAYLOAD_EXPIRY_MAX_MIN) return false;
  return perMemoSignerListRead.get(memo) === 'single';
}

/** Tests only: forget what the server said, per tab and per row. */
export function __resetPayloadExpiryMin(): void {
  learnedPayloadExpiryMin = null;
  perMemoExpiryMin.clear();
  perMemoLearntAt.clear();
  perMemoSignerListRead.clear();
  // it. 29 (§5): and the WRITTEN notes, or a test would inherit the previous
  // one's rows through the very storage this reset exists to clear.
  hydrated = false;
  try {
    windowStore()?.removeItem(WINDOW_STORE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export type HandoffPostResult =
  /** 2xx — including 202 PENDING_LEDGER on /signed (the backend remembers the hash). */
  | { kind: 'ok'; status: number; body: Record<string, unknown> }
  /**
   * The server answered and said no (4xx / 5xx), with its own words.
   *
   * it. 19 (R5 R4 / R3 N2) — THE FIELDS THIS RESULT USED TO THROW AWAY. The 409
   * `WAIT_FOR_PAYLOAD_EXPIRY` of `classifyHandoffRelease` carries `secondsLeft`
   * (how long the payload holding the seat can still be signed) and, when it has
   * one, its `lastLedgerSequence`. Both were parsed and dropped here, so every
   * screen fell back to the client-side constant «about 5 minutes» over a window
   * the server had just measured — a promise that is wrong by a minute and,
   * worse, one nobody can act on. They travel now, and the raw `body` with them.
   */
  | {
      kind: 'refused';
      status: number;
      error: string;
      detail?: string;
      /** `WAIT_FOR_PAYLOAD_EXPIRY` and friends, when the server named a `code`. */
      code?: string;
      /** Seconds the payload holding the seat still has, as the SERVER measured it. */
      secondsLeft?: number;
      /** The ledger that draft dies at, when the server read the window. */
      lastLedgerSequence?: number;
      /**
       * Everything the server answered, for a reader that needs a field we did
       * not name. OPTIONAL so a hand-built refusal (a test, a surface faking one
       * it already read) still types as this result.
       */
      body?: Record<string, unknown>;
    }
  /** The request never got an answer (offline, aborted, CORS…). */
  | { kind: 'unreachable'; detail: string }
  /** Nothing was sent: no window, or nothing to send. */
  | { kind: 'skipped' };

/** A number the server may or may not have sent. Only a finite, positive one counts. */
function positiveNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

export async function postHandoff(
  path: 'release' | 'signed' | 'payload-opened',
  body: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<HandoffPostResult> {
  if (typeof window === 'undefined') return { kind: 'skipped' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    /* no storage: the cookie session still travels (credentials: 'include') */
  }
  let res: Response;
  try {
    res = await (fetchImpl ?? fetch)(`${getApiBase()}/flare-demo/handoff/${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch (e) {
    return { kind: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
  }
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // it. 21 (3.9): `payload-opened` answers with the server's own expiry. Learn it
  // here so the NEXT payload this tab mints carries the number the seat is
  // measured with, whatever a deployment changed it to.
  // …against the memo it was asked about (it. 25, §2): the answer of
  // `payload-opened` is about THAT row, and a ceremony's 24 h must not become the
  // window of the next ordinary payload this tab mints.
  notePayloadExpiryMin(parsed.payloadExpiryMin, body.memoHex);
  if (res.ok) return { kind: 'ok', status: res.status, body: parsed };
  const error = typeof parsed.error === 'string' && parsed.error ? parsed.error : `HTTP ${res.status}`;
  const code = typeof parsed.code === 'string' && parsed.code ? parsed.code : error;
  const secondsLeft = positiveNumber(parsed.secondsLeft);
  const lastLedgerSequence = positiveNumber(parsed.lastLedgerSequence);
  return {
    kind: 'refused',
    status: res.status,
    error,
    ...(typeof parsed.detail === 'string' && parsed.detail ? { detail: parsed.detail } : {}),
    ...(code ? { code } : {}),
    ...(secondsLeft !== undefined ? { secondsLeft } : {}),
    ...(lastLedgerSequence !== undefined ? { lastLedgerSequence } : {}),
    body: parsed,
  };
}

/**
 * it. 19 (R1 1.3) — WHOSE CLOCK THE SEAT'S WINDOW RUNS ON.
 *
 * `payloadExpiresAt` used to be stamped when the 0xFE was COMPOSED, but Xaman's
 * `expire` starts counting when the PAYLOAD IS CREATED — which happens later,
 * when the signing modal opens. A request that is still perfectly signable at
 * 4:30 was therefore treated as expired at 5:01 and its seat handed to a second
 * instruction: the twin, again, this time built by our own clock skew.
 *
 * The only process that knows the real instant is the one that asked Xaman for
 * the payload, so it tells the server: `{ memoHex, expiresAt }` re-stamps the
 * window on the queued row (agent A's `POST /flare-demo/handoff/payload-opened`).
 *
 * BEST EFFORT, NEVER BLOCKING. A backend that has not caught up answers 404 and
 * the seat simply keeps measuring as it did before — never worse. Nothing here
 * signs, cancels or broadcasts anything: it reports an instant.
 */
export async function notePayloadOpenedResult(
  memoHex: string | undefined | null,
  expiresAt: string | Date | undefined | null,
  fetchImpl?: typeof fetch,
): Promise<HandoffPostResult> {
  const memo = (memoHex ?? '').trim();
  if (!memo) return { kind: 'skipped' };
  const iso =
    expiresAt instanceof Date
      ? Number.isFinite(expiresAt.getTime())
        ? expiresAt.toISOString()
        : ''
      : (expiresAt ?? '').trim();
  if (!iso) return { kind: 'skipped' };
  return postHandoff('payload-opened', { memoHex: memo, expiresAt: iso }, fetchImpl);
}

/** Fire-and-forget: the caller is a render path and must never wait on this. */
export function notePayloadOpened(
  memoHex: string | undefined | null,
  expiresAt: string | Date | undefined | null,
): void {
  const memo = (memoHex ?? '').trim();
  if (!memo) return;
  void notePayloadOpenedResult(memo, expiresAt)
    .then((r) => {
      // Logged, never shown: the person did nothing wrong and there is nothing
      // for them to do — but a deploy where this silently 404s must be findable.
      if (r.kind === 'refused' || r.kind === 'unreachable') {
        console.warn('[handoff] payload-opened not recorded:', memo, r);
      }
    })
    .catch((e) => console.warn('[handoff] payload-opened failed:', memo, e));
}

/**
 * The words a release refusal shows: the server's detail, else its code. Pure.
 *
 * it. 17 — THE BANNER IS AN ENGLISH SCREEN. Some of these refusals are composed
 * in Spanish by the 0xFE builder (built code, left as it is), and a Spanish
 * paragraph with hashes in the middle of an English banner reads as a crash.
 * `serverDetailIfEnglish` keeps the sentence only when it is in the screen's
 * language; otherwise the code alone says enough (the surfaces that can say more
 * use describeSeatRefusal).
 */
export function releaseRefusalDetail(r: HandoffPostResult, t?: (s: string) => string): string | null {
  const say = t ?? ((s: string) => s);
  if (r.kind === 'refused') {
    // it. 23 (it. 22 §3.7) — THE CODE WAS THE HEADLINE. This put the RAW slug in
    // front of the sentence («SEAT_STATE_UNREADABLE — we could not read…»), which
    // is exactly what `describeRetryableRefusal` exists to stop, and when there
    // was no English detail the slug was the WHOLE message. The readable sentence
    // wins; the code stays in the result for bookkeeping and never on screen.
    const readFailure = describeRetryableRefusal(r, say);
    if (readFailure) return readFailure.text;
    const detail = serverDetailIfEnglish(r.detail);
    if (detail) return detail;
    // No sentence arrived. A slug is not one either — say the honest generic.
    return looksLikeRawCode(r.error)
      ? say('the server refused to release it and did not say why')
      : r.error;
  }
  if (r.kind === 'unreachable') return `${say('the request did not reach the server')} (${r.detail})`;
  return null;
}

/**
 * Release the seat and return what the server said. A refusal (or no answer) is
 * ALSO pushed to the global banner, so callers that fire-and-forget still let
 * the person see that the seat stays taken until it expires.
 */
export async function releaseHandoffSeatResult(
  memoHex: string | undefined | null,
  fetchImpl?: typeof fetch,
): Promise<HandoffPostResult> {
  if (!memoHex) return { kind: 'skipped' };
  const r = await postHandoff('release', { memoHex }, fetchImpl);
  const detail = releaseRefusalDetail(r);
  if (detail) {
    try {
      // it. 19 (R5 R4): the constant is the LAST resort. When the server measured
      // the window (`secondsLeft` on a 409 WAIT_FOR_PAYLOAD_EXPIRY) the banner
      // says THAT, because «about 5 minutes» over a six-minute window is a
      // promise the person watches break.
      const seconds = r.kind === 'refused' ? r.secondsLeft : undefined;
      pushLiveNotice({
        kind: 'seat-release-refused',
        detail,
        memoHex,
        // it. 23 (it. 22 §3.1) — AN UNMEASURED REFUSAL IS NOT A COUNTDOWN.
        //
        // This pushed the five-minute constant for EVERY refusal, the 503
        // `SEAT_STATE_UNREADABLE` included — and that answer measured NOTHING:
        // the route could not even read whether the seat is still held. Five
        // minutes later the banner flipped to «its signing window has passed, so
        // the seat should be free now», contradicting the card beside it, where
        // `mayPrepareAgainAfterRelease` refuses to offer «prepare again» for
        // exactly this case. Inventing the fact the whole rail exists to stop
        // inventing, one surface over.
        //
        // So a read failure carries NO window at all — no `freesInSeconds`, no
        // constant, therefore no `freesAt` and no countdown — and says what it
        // is: we could not check, nothing changed, ask again.
        ...(unreadableRelease(r)
          ? { unreadable: true as const, retryable: true as const }
          : {
              ...(seconds !== undefined ? { freesInSeconds: seconds } : {}),
              freesInMinutes: HANDOFF_SEAT_TTL_MIN_DEFAULT,
            }),
      });
    } catch {
      /* the banner is a courtesy; the result is still returned */
    }
  }
  return r;
}

/**
 * Did this release answer «I could not read the seat»? Read through the SAME
 * classifier the cards use (`readSeatRelease`), so the banner and the card can
 * no longer disagree about what the server said — plus the code check, for a
 * refusal that never reached the classifier.
 *
 * it. 25 (it. 23 §3.1, THE HALF THAT WAS LEFT) — …AND A REQUEST THAT NEVER
 * ARRIVED MEASURED EVEN LESS.
 *
 * The it. 23 fix covered the 503 and stopped there, so `kind: 'unreachable'`
 * (offline, aborted, CORS, a proxy that dropped it) still fell into the else
 * branch and pushed the client's five-minute constant: a countdown over a seat
 * NOBODY looked at, from a request that never reached the server at all. Five
 * minutes later the banner announced «its signing window has passed, so the
 * seat should be free now» — inventing, from the strongest possible evidence of
 * ignorance, the one fact this rail exists to never invent.
 *
 * Not reaching the server is the same epistemic state as the server not being
 * able to read: nothing was freed, nothing changed, and nothing was measured.
 * So it gets the same shape — no window, no countdown, and the retry the
 * banner already renders for it (`LiveXamanRequests`, `n.unreadable`).
 */
function unreadableRelease(r: HandoffPostResult): boolean {
  if (r.kind === 'unreachable') return true;
  if (r.kind !== 'refused') return false;
  return readSeatRelease(r).kind === 'unreadable' || isRetryableReadFailure(r);
}

/** Fire-and-forget (unchanged signature for every caller); refusals reach the banner. */
export function releaseHandoffSeat(memoHex: string | undefined | null): void {
  if (!memoHex) return;
  void releaseHandoffSeatResult(memoHex).catch(() => {});
}

const TX_HASH_RE = /^[0-9A-Fa-f]{64}$/;

/**
 * notifyHandoffSigned — el momento en que Xaman devuelve el hash, el backend
 * lo aprende (incidente 2026-08-21: el gemelo con nonce 19). El backend lo
 * verifica contra el ledger: validado → marca `signedAt` (asiento intocable);
 * aún sin validar → 202 PENDING_LEDGER y RECUERDA el hash (it.13), así que hay
 * que mandarlo EN CUANTO se firma, no tras validar. Fire-and-forget: si este
 * aviso se pierde, el guard degrada al TTL de antes, nunca a algo peor.
 *
 * Sin un hash real (64 hex) no se manda nada: el backend lo rechazaría con 400
 * INVALID_TX_HASH y un aviso vacío no enseña nada (ManagerSetupWizard mandaba '').
 */
export function notifyHandoffSigned(memoHex: string | undefined | null, txHash: string | undefined | null): void {
  if (!memoHex || !txHash || !TX_HASH_RE.test(txHash.trim())) return;
  void notifyHandoffSignedResult(memoHex, txHash.trim()).catch(() => {});
}

/** The same report, with the server's answer (202 PENDING_LEDGER is `ok`). */
export async function notifyHandoffSignedResult(
  memoHex: string,
  txHash: string,
  fetchImpl?: typeof fetch,
): Promise<HandoffPostResult> {
  if (!memoHex || !TX_HASH_RE.test(txHash)) return { kind: 'skipped' };
  return postHandoff('signed', { memoHex, txHash }, fetchImpl);
}

/* ── it. 29 (§1) — EL ASIENTO DE UNA CEREMONIA, DEVUELTO DESDE DONDE SEA ───── */

/**
 * MUDADA AQUÍ DESDE `components/legacy/CouncilMultisigFlow.tsx` (it. 29 §1), con
 * su historia entera. El motivo de la mudanza es el fallo: allí sólo podía
 * llamarla el botón de aquella pantalla, y las otras tres puertas de cierre
 * (Escape, el fondo, la X) desmontan la pantalla sin pulsarlo. Aquí —módulo del
 * asiento, sin React— la llama también el bus de la ceremonia, que es por donde
 * pasan las tres.
 */
/**
 * arriendo-ceremonia (round 5) — GIVING THE SEAT BACK, SERVER-SIDE.
 *
 * The ceremony's prepare leaves a 30-minute lease on this council's Sequence
 * (`recordCeremonySeat`), and until this round nothing ever asked for it back:
 * «Cancel this ceremony» killed the Xaman payloads, cleared the screen, and its
 * own comment claimed "the ceremony gives the seat back" while making no HTTP
 * call at all. One click later the door beside it answered 422 with "finish or
 * abandon that sitting" — exactly what the family had just done.
 *
 * `jpost` (services/v1Api) is module-private and that file belongs to another
 * frontier in this window, so the call is made here the way a dozen other
 * surfaces in this app already make theirs: `getApiBase()` plus the same bearer
 * header. One deliberate difference — a 401 here must NOT bounce the tab to
 * /login the way `jpost` does: a family mid-ceremony losing the screen is worse
 * than a lease that expires by itself.
 *
 * NEVER reports 'released' over an answer it did not read: an unreachable
 * server is 'unconfirmed', which keeps the async door closed WITH the reason,
 * instead of opening it onto a refusal.
 */
/**
 * it. 27 (§1) — …Y EL NOMBRE DEL ASIENTO DE NONCE, QUE ES LA MITAD QUE FALTABA.
 *
 * WHAT FAILED IN SILENCE. it. 25 §2.1 compuso el 0xFE de una cuenta con quórum
 * con la vida REAL de sus payloads — 24 h — porque la `LastLedgerSequence` va
 * dentro de los bytes firmados y no se puede alargar después. La escapatoria se
 * construyó en el mismo commit (`releaseAbandonedCeremonySeat`), y esta función
 * la llamaba con UN solo parámetro: el servidor (`endedCeremonySeat`) hace
 * `if (!memo) return {}` en su primera línea, así que la puerta solo se ejecutaba
 * desde sus tests. Un consejo cancelaba su ceremonia, los payloads morían, la
 * pantalla se limpiaba — y el asiento seguía ocupado **24 horas**
 * (`NONCE_SEAT_TAKEN`, `secondsLeft ≈ 86400`). Le alargamos la ventana a un día y
 * le quitamos la salida a la vez.
 *
 * `memoHex` es el memo del 0xFE que esa ceremonia iba a firmar: sale de los bytes
 * que están en pantalla (`paymentMemoHex(xrplTx)`), no de ningún estado. Si no
 * hay memo (una constitución, un SignerSet — bytes que no llevan 0xFE) no se
 * manda nada y la puerta se comporta como siempre: no hay asiento de nonce que
 * devolver.
 */
/**
 * it. 34 (E) — …Y EL NOMBRE DEL SITTING QUE SUELTA, PARA QUE UNA LIBERACIÓN TARDÍA
 * NO SUELTE EL ASIENTO DE LA SIGUIENTE.
 *
 * WHAT FAILED IN SILENCE. Escape en `signing` dispara esta llamada desde la
 * limpieza de desmontaje —fire-and-forget, con `keepalive`— y el bus rechaza
 * ABANDONED, que `signOutcome` lee como 'review': la superficie ofrece firmar otra
 * vez, `sendIntent` abre un sitting nuevo y su `/multisign/prepare` —misma sesión,
 * mismos bytes— vuelve a arrendar y a pinar. Si la liberación del primero
 * aterriza DESPUÉS, el servidor no la distinguía de la del segundo: soltaba el
 * arriendo (mismo usuario), leía el pin, sustituía el reloj y el asiento de nonce
 * quedaba libre bajo una ceremonia que la familia seguía firmando.
 *
 * `sittingId` es el que `/multisign/prepare` devolvió a ESTE sitting. Tres formas:
 *   · una cadena — la de este sitting; el servidor la compara con el arriendo y
 *     el pin vigentes y, si es otra, no toca nada (`stale-sitting`);
 *   · `null` — este sitting NO recibió id (cerró en `idle` sin preparar, o en
 *     `preparing` antes de que volviera el prepare): se dice tal cual, y el
 *     servidor solo le deja alcanzar arriendos y pines SIN nombre — nunca el de
 *     un sitting que sí lo tiene. Un servidor anterior a este campo lo descarta
 *     (zod strip) y se comporta como siempre;
 *   · `undefined` — un llamador que no transporta el id: la petición de antes,
 *     byte a byte. Ya no queda ninguno en producción; se conserva por contrato.
 */
export async function releaseCeremonySeat(
  account: string,
  memoHex?: string | null,
  sittingId?: string | null,
): Promise<'released' | 'not-held' | 'unconfirmed'> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof window !== 'undefined') {
      const jwt = window.localStorage.getItem('auth_token');
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
    }
    const memo = typeof memoHex === 'string' ? memoHex.trim().toUpperCase() : '';
    const res = await fetch(`${getApiBase()}/xrpl-defi/multisign/release`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ceremonyReleaseBody(account, memo, sittingId)),
      // it. 29 (§1): the three doors that reach this one (Escape, the backdrop,
      // the X) DESTROY the screen in the same tick, and a navigation may destroy
      // the page. Without `keepalive` the browser cancels the request on the way
      // out and the seat stays taken for a day — the same silence, one layer down.
      keepalive: true,
    });
    if (!res.ok) return 'unconfirmed';
    const body = (await res.json().catch(() => null)) as
      | { released?: boolean; reason?: string; seat?: Record<string, unknown> }
      | null;
    // it. 31 (§3): the NONCE SEAT's own answer, which nobody read until now.
    if (memo) noteCeremonySeatAnswer(memo, body?.seat);
    if (body?.released === true) return 'released';
    // 'no-seat' is an ANSWER: nothing was holding it, so nothing blocks.
    // it. 34 (E): so is 'stale-sitting' — a NEWER sitting holds the seat now, and
    // this one has nothing left to hand back. Not «unconfirmed»: nothing of this
    // sitting's is in doubt, and painting a refusal over it would tell the person
    // their cancel failed when it simply had nothing left to do.
    return body?.reason === 'no-seat' || body?.reason === 'stale-sitting' ? 'not-held' : 'unconfirmed';
  } catch {
    // A network failure is not a verdict about the lease.
    return 'unconfirmed';
  }
}

/**
 * it. 34 (E) — the release body, pure so the three shapes are tested without a
 * browser: no key at all for a caller that does not transport the id, `null` for a
 * sitting that never received one, the string otherwise. The memo travels only
 * when these bytes carry one (a 0xFE); a constitution names no nonce seat.
 */
export function ceremonyReleaseBody(
  account: string,
  memo: string,
  sittingId: string | null | undefined,
): { account: string; memoHex?: string; sittingId?: string | null } {
  return {
    account,
    ...(memo ? { memoHex: memo } : {}),
    ...(sittingId === undefined ? {} : { sittingId: typeof sittingId === 'string' && sittingId.length > 0 ? sittingId : null }),
  };
}

/**
 * it. 31 (§3) — CERRAR EN `idle` NO SOLTABA NADA, Y EL FALLO ERA MUDO.
 *
 * WHAT FAILED IN SILENCE. `/xrpl-defi/multisign/release` answers TWO things: the
 * Sequence LEASE of the sitting (`released`, top level) and the 0xFE NONCE SEAT
 * (`seat`, its own field — `endedCeremonySeat`). This function read only the
 * first. Closing the dialog before «Sign now» (phase `idle`) has no lease to
 * give back and no ceremony pin either — the pin is stamped by `/multisign/
 * prepare`, in `start()` — so the row falls to the ordinary rule: its payload is
 * still signable for the whole window the server composed (`payload-live`, up
 * to 86 400 s), and the seat stays taken. The server SAID so, with `secondsLeft`,
 * and the screen said nothing: the family closed the dialog, believed the seat
 * free, and met a 409 NONCE_SEAT_TAKEN on the next exit with no idea why.
 *
 * So the seat's answer is read and, when it says «still held», it goes to the
 * global banner with the server's own countdown — the same notice the ordinary
 * release already uses (`releaseHandoffSeatResult`), so the person reads one
 * grammar. Nothing is invented: a refusal without a measured window carries no
 * countdown (it. 23 §3.1), and a read failure says «we could not check». Pure
 * except for the notice, so the shape is tested without a browser.
 */
export function ceremonySeatNotice(
  memoHex: string,
  seat: Record<string, unknown> | null | undefined,
): Omit<LiveNotice, 'id' | 'createdAt'> | null {
  if (!seat || typeof seat !== 'object') return null;
  if (seat.released === true) return null;
  const code = typeof seat.code === 'string' ? seat.code : undefined;
  const secondsLeft = positiveNumber(seat.secondsLeft);
  const unreadable = code === 'SEAT_STATE_UNREADABLE' || (seat.retryable === true && secondsLeft === undefined);
  // Only a MEASURED hold, or a read we could not make, is worth a banner. A row
  // that is not queued any more (`not-found`: already released or already
  // signed), an ordinary row this door does not judge (`not-a-ceremony`) or a
  // refusal with no window carries nothing the person can act on — and a notice
  // over nothing is the noise that teaches people to dismiss the real one.
  if (!unreadable && secondsLeft === undefined) return null;
  const said = serverDetailIfEnglish(typeof seat.detail === 'string' ? seat.detail : undefined);
  const detail = unreadable
    ? (said ?? 'we could not read whether that dispatch can still be signed, so nothing was changed')
    : (said ??
      'that dispatch is still measured by its own signing window, so its seat stays taken until that window passes');
  return {
    kind: 'seat-release-refused',
    detail,
    memoHex,
    ...(unreadable ? { unreadable: true as const, retryable: true as const } : { freesInSeconds: secondsLeft }),
  };
}

function noteCeremonySeatAnswer(memoHex: string, seat: unknown): void {
  const notice = ceremonySeatNotice(memoHex, seat as Record<string, unknown> | null | undefined);
  if (!notice) return;
  try {
    pushLiveNotice(notice);
  } catch {
    /* the banner is a courtesy; the release's own answer is still returned */
  }
}

/**
 * deskPaymentProof — a desk reservation (DeskPayment) is closed by CHAIN FACTS,
 * never by a guess (productizer cycle, it. 8 and it. 10).
 *
 * The holes it closes:
 *  1. A put-to-work reservation whose 0xFE was signed and VALIDATED but never
 *     reported stayed 'prepared'. «Release» freed its drops and a later withdraw
 *     paid the same XRP again (2X from the omnibus).
 *  2. A prepared payout past its LastLedgerSequence was released after a
 *     page-capped scan. With >400 omnibus txs since its ledger the validated
 *     payout was never debited → paid again.
 *  3. (it. 10) The reservation matched hand-offs HEURISTICALLY (same omnibus,
 *     same drops, the passkey inside the userOp): anyone with a session could
 *     build such a hand-off through the generic institutional prepare and report
 *     it signed → the reservation was stuck forever. The proof read unbounded
 *     history (>10,000 rows → 503 forever) and a capped hand-off list (false
 *     «unaccounted»); one 0xFE signed outside Astryum blocked every release.
 *
 * DESIGN of the put-to-work proof:
 *  · The desk reserves (POST desk-payments), then asks the SERVER to compose the
 *    0xFE for that reservation (prepare-put-to-work): the memo and userOpHash are
 *    stored on the reservation inside the run lock, and the Payment carries a
 *    LastLedgerSequence (PUT_TO_WORK_LEDGER_WINDOW) — so its window is bounded by
 *    construction, like a payout's.
 *  · A reservation WITH memo matches ONLY that memo (or its own reported hash).
 *    Window: [createdAtLedger, min(validated, LLS)] — or, for a legacy memo with no
 *    LLS, [createdAtLedger, createdAtLedger + PUT_TO_WORK_SEARCH_WINDOW]. Read
 *    forward, stopping at the first match. Found → the XRP LEFT: settle + debit
 *    (409 DESK_PAYMENT_EXECUTED). Before the LLS, a hand-off of that memo reported
 *    SIGNED (or the reservation's own hash) not on the ledger → 409, it may land.
 *    Past the LLS and absent → it can never land.
 *  · A reservation WITHOUT memo (legacy, or its prepare failed) is released only
 *    if no validated omnibus 0xFE in [createdAtLedger, createdAtLedger +
 *    PUT_TO_WORK_SEARCH_WINDOW] (capped at validated) carries a memo/hash the run
 *    cannot explain (requests, other reservations, marked-external payments).
 *  · (it. 12, 2.3) A reservation WITH memo and LastLedgerSequence is NEVER released
 *    while its window is open: `signedAt` only exists after validation, so «not
 *    reported signed» was the operator's word while a Xaman already on a phone
 *    could still land it. Verdict 'wait' → 409 WAIT_FOR_LAST_LEDGER, with the
 *    ledgers (≈ seconds) left. Past the LLS the ledger alone decides.
 *  · Any read that fails (ledger, window, hand-off store) → 503.
 *  · Residual (documented): a memo-less reservation whose 0xFE lands after its
 *    bounded window; a legacy memo with no LastLedgerSequence released before its
 *    search window closes (it has no LLS to wait for).
 */

import { handoffPayloadExpiryMin } from '../flare/handoffAuthority';
import { applyMovements, deskPaymentsOf, type DemoRun, type DeskPayment } from './DemoExchangeStore';
import { currentValidatedLedgerIndex, scanOmnibusWindow, scanOmnibusWindowUntil, type OmnibusTx } from './OmnibusWatcher';
import { makeReceipt } from './DemoExchangeSync';
import { findHandoffByMemo, mintExecutedOnFlare, type OmnibusHandoff, type ReportedTx } from './deskPaymentReads';

/**
 * Ledgers a desk payout stays signable (~5–8 min at 3–5 s per ledger). Stamped
 * as LastLedgerSequence by /withdraw/prepare.
 */
export const DESK_PAYOUT_LEDGER_WINDOW = 100;

/**
 * Ledgers a server-composed desk 0xFE stayed signable UNTIL the it. 19 (100).
 * Kept — and still read — because every reservation composed before that change
 * carries a LastLedgerSequence built with it; the live window is
 * `putToWorkLedgerWindow()` below.
 */
export const PUT_TO_WORK_LEDGER_WINDOW = DESK_PAYOUT_LEDGER_WINDOW;

/** Ledgers that close in a minute on XRPL at ~4 s each. */
const LEDGERS_PER_MINUTE = 15;
/** A minute of margin so a signature made in the payload's LAST second still lands. */
const LLS_MARGIN_LEDGERS = 15;
/** The same bounds the builder applies, so the two numbers can never disagree. */
const MIN_LEDGER_WINDOW = 10;
const MAX_LEDGER_WINDOW = 1000;

/**
 * productizer it. 19 (R1 1.6) — LA VENTANA DE LA MESA, MEDIDA CONTRA EL PAYLOAD.
 *
 * La mesa clavaba 100 ledgers (~6,7 min) mientras el payload de Xaman caduca a
 * los 5: el asiento de nonce del omnibus —que comparten TODOS los clientes de la
 * mesa— quedaba congelado casi dos minutos después de que ya nadie pudiera
 * firmar nada, en CADA composición abandonada. La ventana más pequeña que aún
 * deja firmar es «lo que vive el payload + un minuto de margen»: con la
 * caducidad por defecto (5 min) son **90 ledgers ≈ 6 min**.
 *
 * Es la misma fórmula, y por tanto el mismo número, que
 * `defaultLastLedgerWindow()` del constructor del 0xFE; ambas salen de
 * `handoffPayloadExpiryMin()`, así que mover `HANDOFF_PAYLOAD_EXPIRY_MIN` las
 * mueve a la vez. Un test (deskLedgerWindow.test) compara las dos cada vez que
 * corre la suite: si alguien cambia una sola, se cae.
 *
 * No se acorta más: por debajo del payload, un fundador que firma en el minuto 5
 * firmaría un Payment que ya no puede entrar — y eso se paga en una firma
 * perdida y un re-prepare, no en un segundo de asiento.
 */
export function putToWorkLedgerWindow(): number {
  const ledgers = Math.ceil(handoffPayloadExpiryMin() * LEDGERS_PER_MINUTE + LLS_MARGIN_LEDGERS);
  return Math.min(Math.max(ledgers, MIN_LEDGER_WINDOW), MAX_LEDGER_WINDOW);
}

/** Width of the search of a put-to-work reservation with no LastLedgerSequence (no memo, or a legacy memo). */
export const PUT_TO_WORK_SEARCH_WINDOW = 2_000;

const strip0x = (h: string | undefined | null) => String(h ?? '').replace(/^0x/i, '');
const upper = (h: string | undefined | null) => strip0x(h).toUpperCase();

/* ── payouts (withdraw) ──────────────────────────────────────────────────── */

export type PayoutProbe =
  | { kind: 'landed'; tx: OmnibusTx }
  | { kind: 'absent'; rowsRead: number; failedOnLedger: number; window: [number, number] }
  | { kind: 'unreadable'; detail: string };

/**
 * Pure: the payout's fingerprint in a window read — omnibus → the composed
 * destination, exactly its drops, exactly its LastLedgerSequence (or its hash
 * when the desk reported one). A validated non-success match consumed the
 * signed blob's Sequence: it moved no XRP and can never apply again.
 */
export function matchPayout(run: DemoRun, p: DeskPayment, rows: OmnibusTx[], destination: string): { landed?: OmnibusTx; failedOnLedger: number } {
  const own = p.txHash ? upper(p.txHash) : '';
  const matches = rows.filter(
    (t) =>
      t.validated &&
      t.direction === 'out' &&
      t.account === run.omnibusAddress &&
      ((own && upper(t.hash) === own) ||
        (t.destination === destination && t.drops === p.drops && typeof p.lastLedgerSequence === 'number' && t.lastLedgerSequence === p.lastLedgerSequence)),
  );
  return { landed: matches.find((t) => t.result === 'tesSUCCESS'), failedOnLedger: matches.filter((t) => t.result !== 'tesSUCCESS').length };
}

async function readPayoutWindow(run: DemoRun, p: DeskPayment, upperLedger: number): Promise<PayoutProbe> {
  const destination = p.destination ?? run.clients.find((c) => c.id === p.clientId)?.xrplAddress;
  if (!destination) return { kind: 'unreadable', detail: 'the payout has no destination on file to fingerprint' };
  const lls = p.lastLedgerSequence;
  let min = p.createdAtLedger ?? (typeof lls === 'number' ? lls - DESK_PAYOUT_LEDGER_WINDOW : undefined);
  if (min === undefined) return { kind: 'unreadable', detail: 'the payout has neither its creation ledger nor a LastLedgerSequence — its window cannot be bounded' };
  min = Math.max(1, Math.min(min, upperLedger));
  let rows: OmnibusTx[];
  try {
    rows = await scanOmnibusWindow(run.omnibusAddress, { ledgerIndexMin: min, ledgerIndexMax: upperLedger });
  } catch (e) {
    return { kind: 'unreadable', detail: `the omnibus history of ledgers [${min}, ${upperLedger}] could not be read in full (${(e as Error).message.slice(0, 120)})` };
  }
  const m = matchPayout(run, p, rows, destination);
  if (m.landed) return { kind: 'landed', tx: m.landed };
  return { kind: 'absent', rowsRead: rows.length, failedOnLedger: m.failedOnLedger, window: [min, upperLedger] };
}

/** The payout DID leave the omnibus: debit its client once (by the reservation, not by the current wallet) and settle. */
export function settlePayoutByProof(run: DemoRun, p: DeskPayment, tx: OmnibusTx, nowIso = new Date().toISOString()): void {
  const hash = upper(tx.hash);
  const fresh = applyMovements(run, [{ kind: 'withdraw', clientId: p.clientId, drops: p.drops, txHash: hash }]);
  if (fresh.length) {
    run.receipts.push(makeReceipt(run, {
      step: 'E8_WITHDRAW',
      chain: 'xrpl',
      txHash: hash,
      clientId: p.clientId,
      note: 'Desk payout found on the ledger by an exhaustive omnibus read (it was never reported) — debited once.',
      expect: { drops: p.drops, to: tx.destination, lastLedgerSequence: tx.lastLedgerSequence ?? '' },
    }));
  }
  p.txHash = hash;
  p.status = 'settled';
  p.closedBy = `on the ledger: ${hash} (ledger ${tx.ledgerIndex ?? '?'})`;
  p.updatedAt = nowIso;
}

export interface PayoutProofs {
  /** Desk payment ids proven absent over their full window — the only ones a sweep may release. */
  provenAbsent: Set<string>;
  /** Desk payment ids found on the ledger and settled (with their debit). */
  settled: string[];
  /** Kept in flight: the window could not be read in full. */
  unreadable: Array<{ id: string; detail: string }>;
  /** The chain facts behind `settled` / `provenAbsent`, by desk payment id — so a proof read on a snapshot can be applied to a fresh copy. */
  landed?: Map<string, OmnibusTx>;
  absentProof?: Map<string, { lastLedgerSequence: number; closedBy: string }>;
}

/**
 * Pure (mutates `fresh`): apply payout proofs read OUTSIDE the run lock on a
 * snapshot to a FRESH copy loaded inside it (productizer it. 12, 2.6b). A chain
 * fact is applied only to the reservation it was read for, and only while that
 * reservation is still the prepared payout the proof describes (same id, same
 * LastLedgerSequence, no hash reported since): anything that changed meanwhile
 * keeps its reservation.
 */
export function applyPayoutProofs(fresh: DemoRun, proofs: PayoutProofs, nowIso = new Date().toISOString()): PayoutProofs {
  const out: PayoutProofs = { provenAbsent: new Set<string>(), settled: [], unreadable: [...proofs.unreadable] };
  const stillPrepared = (id: string) => deskPaymentsOf(fresh).find((d) => d.id === id && d.kind === 'withdraw' && d.status === 'prepared');
  for (const [id, tx] of proofs.landed ?? new Map<string, OmnibusTx>()) {
    const p = stillPrepared(id);
    if (!p) continue;
    settlePayoutByProof(fresh, p, tx, nowIso);
    out.settled.push(id);
  }
  for (const id of proofs.provenAbsent) {
    const p = stillPrepared(id);
    const proof = proofs.absentProof?.get(id);
    if (!p || !proof || p.txHash || p.lastLedgerSequence !== proof.lastLedgerSequence) continue;
    p.closedBy = proof.closedBy;
    out.provenAbsent.add(id);
  }
  return out;
}

/**
 * For every prepared withdraw past its LastLedgerSequence (against a validated
 * index read BEFORE this call): read [LLS-100 (or its creation ledger), LLS]
 * exhaustively. Landed → settle + debit (mutates run). Absent → proven (the
 * sweep may release it). Unreadable → nothing; the reservation stays.
 */
export async function proveDeskPayouts(run: DemoRun, validatedLedgerIndex?: number | null, nowIso = new Date().toISOString()): Promise<PayoutProofs> {
  const out: PayoutProofs = { provenAbsent: new Set<string>(), settled: [], unreadable: [], landed: new Map(), absentProof: new Map() };
  if (typeof validatedLedgerIndex !== 'number') return out;
  for (const p of deskPaymentsOf(run)) {
    if (p.kind !== 'withdraw' || p.status !== 'prepared' || typeof p.lastLedgerSequence !== 'number') continue;
    if (validatedLedgerIndex <= p.lastLedgerSequence) continue;
    const probe = await readPayoutWindow(run, p, p.lastLedgerSequence);
    if (probe.kind === 'landed') {
      settlePayoutByProof(run, p, probe.tx, nowIso);
      out.settled.push(p.id);
      out.landed!.set(p.id, probe.tx);
    } else if (probe.kind === 'absent') {
      out.provenAbsent.add(p.id);
      p.closedBy = `absent: ${probe.rowsRead} omnibus txs of ledgers [${probe.window[0]}, ${probe.window[1]}] read in full, no payout with LastLedgerSequence ${p.lastLedgerSequence}${probe.failedOnLedger ? ` (${probe.failedOnLedger} failed on the ledger, no XRP moved)` : ''}; validated ledger ${validatedLedgerIndex}`;
      out.absentProof!.set(p.id, { lastLedgerSequence: p.lastLedgerSequence, closedBy: p.closedBy });
    } else {
      out.unreadable.push({ id: p.id, detail: probe.detail });
    }
  }
  return out;
}

/**
 * Manual release of a withdraw reservation: whatever the operator believes, a
 * payout already on the ledger is settled (and debited), never released. Reads
 * [creation ledger, min(validated, LLS)] in full. Before its LLS an absent payout
 * may still land — that stays the operator's call (the desk warns).
 */
export async function probePreparedPayout(run: DemoRun, p: DeskPayment): Promise<PayoutProbe> {
  const validated = await currentValidatedLedgerIndex();
  if (!validated) return { kind: 'unreadable', detail: 'the validated XRP Ledger could not be read' };
  const top = typeof p.lastLedgerSequence === 'number' ? Math.min(validated, p.lastLedgerSequence) : validated;
  return readPayoutWindow(run, p, top);
}

/* ── put-to-work (0xFE) ──────────────────────────────────────────────────── */

/** Rough XRPL ledger close time used only to say «≈ N seconds» to a person — never to decide anything. */
export const XRPL_SECONDS_PER_LEDGER_ESTIMATE = 4;

export type PutToWorkVerdict =
  | { kind: 'release'; proof: string }
  | { kind: 'executed'; tx: OmnibusTx; mintExecuted: boolean | null; memoHex?: string; userOpHash?: string }
  | { kind: 'unaccounted'; hashes: string[] }
  | { kind: 'signed-off-ledger'; detail: string }
  /** Its 0xFE can still land: nothing is released until the validated ledger passes `lastLedgerSequence`. */
  | { kind: 'wait'; detail: string; lastLedgerSequence: number; ledgersLeft: number; secondsLeft: number }
  | { kind: 'unreadable'; detail: string };

/** Pure: a validated, successful 0xFE-memo Payment out of the omnibus. */
export function isOmnibusFe(run: DemoRun, t: OmnibusTx): boolean {
  return t.validated && t.result === 'tesSUCCESS' && t.direction === 'out' && t.account === run.omnibusAddress && upper(t.memoHex).startsWith('FE');
}

/**
 * Pure: every omnibus hash and 0xFE memo the run can already explain — mirrored
 * debits, the requests the omnibus key signed, the other reservations, and the
 * payments an operator marked external. `exceptId` = the reservation under proof.
 */
export function knownOmnibusFe(run: DemoRun, exceptId?: string): { hashes: Set<string>; memos: Set<string> } {
  const hashes = new Set<string>();
  const memos = new Set<string>();
  for (const k of run.appliedTxHashes ?? []) if (k.startsWith('out:')) hashes.add(k.slice(4).toUpperCase());
  for (const r of run.requests ?? []) {
    if (r.txHash) hashes.add(upper(r.txHash));
    if (r.memoHex) memos.add(upper(r.memoHex));
  }
  for (const d of run.deskPayments ?? []) {
    if (d.id === exceptId) continue;
    if (d.txHash) hashes.add(upper(d.txHash));
    // 18-sep (fundador: «The 0xFE is validated (CA8C7BF8…) but the exchange
    // ledger could not record it: … its memo FE0000000000… already belongs to
    // another record of this run»). A RELEASED reservation does not own its
    // memo: a put-to-work is released ONLY with the ledger's proof that its
    // 0xFE did not land and can never land (provePutToWorkRelease — its
    // LastLedgerSequence is past and its window was read in full). And the memo
    // is derived from the omnibus Personal Account nonce, which a 0xFE that
    // never executed does not advance — so the NEXT 0xFE of the same client and
    // amount carries the SAME memo. Counting the released one refused that
    // second, real payment as «another record's», and the client was never
    // debited for XRP that had already left the omnibus. Its hash still counts.
    if (d.memoHex && d.status !== 'released') memos.add(upper(d.memoHex));
  }
  for (const x of run.externalFe ?? []) {
    if (x.txHash) hashes.add(upper(x.txHash));
    if (x.memoHex) memos.add(upper(x.memoHex));
  }
  return { hashes, memos };
}

export interface PutToWorkWindow {
  min: number;
  max: number;
  /** The reservation's LastLedgerSequence is past: absent over the window = can never land. */
  closed: boolean;
  lastLedgerSequence?: number;
}

/**
 * Pure: the bounded ledger window of a put-to-work proof, against a validated
 * index. null = no lower bound on file (neither creation ledger nor run frontier).
 */
export function putToWorkWindow(run: DemoRun, p: DeskPayment, validated: number): PutToWorkWindow | null {
  const lower = p.createdAtLedger ?? run.sinceLedgerIndex;
  if (lower === undefined) return null;
  const lls = p.memoHex && typeof p.lastLedgerSequence === 'number' ? p.lastLedgerSequence : undefined;
  const top = lls !== undefined ? lls : lower + PUT_TO_WORK_SEARCH_WINDOW;
  const max = Math.max(1, Math.min(validated, top));
  const min = Math.max(1, Math.min(lower, max));
  return { min, max, closed: lls !== undefined && validated > lls, lastLedgerSequence: lls };
}

/** Pure: where the forward read of a put-to-work window may stop — the first row that answers the proof. */
export function putToWorkStop(run: DemoRun, p: DeskPayment): (t: OmnibusTx) => boolean {
  const memo = upper(p.memoHex);
  const own = upper(p.txHash);
  const success = (t: OmnibusTx) => t.validated && t.result === 'tesSUCCESS' && t.direction === 'out' && t.account === run.omnibusAddress;
  if (memo) return (t) => success(t) && (upper(t.memoHex) === memo || (Boolean(own) && upper(t.hash) === own));
  const known = knownOmnibusFe(run, p.id);
  return (t) =>
    (Boolean(own) && success(t) && upper(t.hash) === own) ||
    (isOmnibusFe(run, t) && !known.hashes.has(upper(t.hash)) && !(t.memoHex && known.memos.has(upper(t.memoHex))));
}

/**
 * Pure: the verdict over a bounded window read (possibly stopped at its first
 * match) and the hand-off of the reservation's memo. `mintExecuted` is filled by
 * the live wrapper.
 */
export function judgePutToWork(input: { run: DemoRun; p: DeskPayment; rows: OmnibusTx[]; handoff: OmnibusHandoff | null; window: PutToWorkWindow }): Exclude<PutToWorkVerdict, { kind: 'unreadable' }> {
  const { run, p, rows, handoff, window } = input;
  const memo = upper(p.memoHex);
  const ownHash = upper(p.txHash);
  const success = (t: OmnibusTx) => t.validated && t.result === 'tesSUCCESS' && t.direction === 'out' && t.account === run.omnibusAddress;

  const landed = rows.find((t) => success(t) && ((memo && upper(t.memoHex) === memo) || (ownHash && upper(t.hash) === ownHash)));
  if (landed) {
    return { kind: 'executed', tx: landed, mintExecuted: null, memoHex: upper(landed.memoHex) || undefined, userOpHash: p.userOpHash ?? handoff?.userOpHash };
  }

  if (!memo) {
    const known = knownOmnibusFe(run, p.id);
    const unknown = rows.filter((t) => isOmnibusFe(run, t) && !known.hashes.has(upper(t.hash)) && !(t.memoHex && known.memos.has(upper(t.memoHex))));
    if (unknown.length) return { kind: 'unaccounted', hashes: unknown.map((t) => upper(t.hash)) };
  }

  const validatedHashes = new Set(rows.filter((t) => t.validated).map((t) => upper(t.hash)));
  if (!window.closed) {
    if (ownHash && !validatedHashes.has(ownHash)) {
      return { kind: 'signed-off-ledger', detail: `this reservation carries the signed hash ${ownHash}, which is not in the omnibus history of ledgers [${window.min}, ${window.max}] — it may still land` };
    }
    if (memo && handoff?.signedAt) {
      const sh = upper(handoff.signedTxHash);
      if (!sh || !validatedHashes.has(sh)) {
        return { kind: 'signed-off-ledger', detail: `its 0xFE hand-off ${handoff.userOpHash.slice(0, 12)}… was reported SIGNED${sh ? ` (${sh.slice(0, 12)}…)` : ''} and is not on the ledger yet — it may still land` };
      }
    }
    // A composed 0xFE with its LastLedgerSequence still ahead: whether it reached a
    // phone is not something the server can know — only the ledger passing the LLS is.
    if (memo && typeof window.lastLedgerSequence === 'number') {
      const lls = window.lastLedgerSequence;
      const ledgersLeft = Math.max(1, lls + 1 - window.max);
      const secondsLeft = ledgersLeft * XRPL_SECONDS_PER_LEDGER_ESTIMATE;
      return {
        kind: 'wait',
        lastLedgerSequence: lls,
        ledgersLeft,
        secondsLeft,
        detail: `its 0xFE (memo ${memo.slice(0, 12)}…) is not on the ledger yet, but it can still be signed and land until XRPL ledger ${lls} — ${ledgersLeft} ledger(s) left, ≈ ${secondsLeft} s. Nothing is released before that ledger passes; if it was signed, record it instead`,
      };
    }
  }
  const read = `${rows.length} omnibus txs of ledgers [${window.min}, ${window.max}] read in full`;
  const proof = memo
    ? window.closed
      ? `absent: ${read} — no 0xFE with memo ${memo.slice(0, 12)}…; its LastLedgerSequence ${window.lastLedgerSequence} is past, it can never land`
      : `absent: ${read} — no 0xFE with memo ${memo.slice(0, 12)}…; its hand-off is not reported signed`
    : `absent: ${read} — no reservation memo, and no 0xFE of the omnibus the run cannot account for`;
  return { kind: 'release', proof };
}

/** Live: ledger → bounded forward window → the memo's hand-off → verdict (+ isTransactionIdUsed when it landed). */
export async function provePutToWorkRelease(run: DemoRun, p: DeskPayment): Promise<PutToWorkVerdict> {
  const validated = await currentValidatedLedgerIndex();
  if (!validated) return { kind: 'unreadable', detail: 'the validated XRP Ledger could not be read' };
  const window = putToWorkWindow(run, p, validated);
  if (!window) return { kind: 'unreadable', detail: 'the reservation has neither its creation ledger nor the run frontier — its search window cannot be bounded' };
  let rows: OmnibusTx[];
  try {
    ({ rows } = await scanOmnibusWindowUntil(run.omnibusAddress, { ledgerIndexMin: window.min, ledgerIndexMax: window.max, stop: putToWorkStop(run, p) }));
  } catch (e) {
    return { kind: 'unreadable', detail: `the omnibus history of ledgers [${window.min}, ${window.max}] could not be read (${(e as Error).message.slice(0, 120)})` };
  }
  let handoff: OmnibusHandoff | null = null;
  // Past its LLS the hand-off cannot change the verdict — do not let a database
  // outage block a release the ledger already proves.
  if (p.memoHex && !window.closed) {
    try {
      handoff = await findHandoffByMemo(p.memoHex);
    } catch (e) {
      return { kind: 'unreadable', detail: `the 0xFE hand-off store could not be read (${(e as Error).message.slice(0, 120)})` };
    }
  }
  const verdict = judgePutToWork({ run, p, rows, handoff, window });
  if (verdict.kind === 'executed') {
    try {
      verdict.mintExecuted = await mintExecutedOnFlare(verdict.tx.hash);
    } catch {
      verdict.mintExecuted = null; // the XRPL fact alone settles it; Flare is only reported
    }
  }
  return verdict;
}

/** The 0xFE left the omnibus: debit the client once (as put-to-work/record would) and settle. */
export function settlePutToWorkByProof(run: DemoRun, p: DeskPayment, verdict: Extract<PutToWorkVerdict, { kind: 'executed' }>, nowIso = new Date().toISOString()): void {
  const hash = upper(verdict.tx.hash);
  const client = run.clients.find((c) => c.id === p.clientId);
  const fresh = applyMovements(run, [{ kind: 'put-to-work', clientId: p.clientId, drops: p.drops, txHash: hash }]);
  if (fresh.length) {
    run.receipts.push(makeReceipt(run, {
      step: 'E5_PUT_TO_WORK',
      chain: 'xrpl',
      txHash: hash,
      clientId: p.clientId,
      note: `Desk 0xFE found on the ledger by a bounded omnibus read (it was never recorded) — debited once; mint on Flare: ${verdict.mintExecuted === true ? 'executed' : verdict.mintExecuted === false ? 'not yet' : 'unread'}.`,
      expect: { drops: p.drops, receiver: client?.passkeyAccount ?? '', pote: run.poteAddress ?? '' },
    }));
  }
  p.txHash = hash;
  if (verdict.memoHex && !p.memoHex) p.memoHex = verdict.memoHex;
  if (verdict.userOpHash && !p.userOpHash) p.userOpHash = verdict.userOpHash;
  p.status = 'settled';
  p.closedBy = `on the ledger: ${hash} (ledger ${verdict.tx.ledgerIndex ?? '?'}), isTransactionIdUsed=${verdict.mintExecuted ?? 'unread'}`;
  p.updatedAt = nowIso;
}

/* ── put-to-work/record: the reported hash must BE this movement ─────────── */

/**
 * `retryable` (it. 12, 1.4): the backend's node does not show the hash validated
 * YET — a node a few ledgers behind says exactly that about a 0xFE Xaman just saw
 * validate. That is «not yet visible» (503, try again), never «not this client's».
 */
export type RecordVerdict = { ok: true; memoHex: string } | { ok: false; reason: string; retryable?: boolean };

/**
 * Pure (productizer it. 10): the hash an operator records as a client's
 * put-to-work must be a validated tesSUCCESS Payment from the omnibus to the
 * FAssets Core Vault, for exactly these drops, whose 0xFE memo is the
 * reservation's — or, without a reservation memo, the memo of a hand-off built
 * for this omnibus, these drops and this client's Flare account. A memo another
 * record already explains (another reservation, a request, an external mark) is
 * never this client's. Before, any hash was accepted: recording an unrelated
 * 0xFE debited the wrong client.
 */
export function judgePutToWorkRecord(input: {
  run: DemoRun;
  clientId: string;
  drops: string;
  tx: ReportedTx;
  coreVault: string;
  reservation?: DeskPayment;
  handoff: OmnibusHandoff | null;
}): RecordVerdict {
  const { run, clientId, drops, tx, coreVault, reservation, handoff } = input;
  const no = (reason: string): RecordVerdict => ({ ok: false, reason });
  const notYet = (reason: string): RecordVerdict => ({ ok: false, reason, retryable: true });
  if (!tx.found) return notYet('the XRPL node this backend reads does not know this hash yet');
  if (!tx.validated) return notYet('the XRPL node this backend reads does not show this transaction validated yet');
  if (tx.result !== 'tesSUCCESS') return no(`the transaction result is ${tx.result}, not tesSUCCESS`);
  if (tx.type !== 'Payment') return no(`it is a ${tx.type || 'non-Payment'} transaction`);
  if (tx.account !== run.omnibusAddress) return no(`it was sent by ${tx.account}, not by the omnibus ${run.omnibusAddress}`);
  if (!coreVault || tx.destination !== coreVault) return no(`it pays ${tx.destination ?? 'nobody'}, not the FAssets Core Vault ${coreVault}`);
  if (tx.drops !== drops) return no(`it delivered ${tx.drops ?? 'a non-XRP amount'} drops, not ${drops}`);
  if (reservation && reservation.drops !== drops) return no(`the reservation holds ${reservation.drops} drops, not ${drops}`);
  const memo = upper(tx.memoHex);
  if (!memo.startsWith('FE')) return no('it carries no 0xFE memo');
  const client = run.clients.find((c) => c.id === clientId);
  if (reservation?.memoHex) {
    if (upper(reservation.memoHex) !== memo) return no(`its memo ${memo.slice(0, 12)}… is not this reservation's (${upper(reservation.memoHex).slice(0, 12)}…)`);
  } else {
    if (!handoff || upper(handoff.memoHex) !== memo) return no(`no 0xFE hand-off on file carries its memo ${memo.slice(0, 12)}…`);
    if (handoff.xrplAddress !== run.omnibusAddress) return no('its hand-off was built for another XRPL account');
    if (handoff.grossXrpDrops !== drops) return no(`its hand-off moves ${handoff.grossXrpDrops} drops, not ${drops}`);
    const receiverHex = client?.passkeyAccount ? strip0x(client.passkeyAccount).toLowerCase() : '';
    if (!receiverHex) return no('this client has no Flare account on file to check the receiver against');
    if (!handoff.userOpData.toLowerCase().includes(receiverHex)) return no("its hand-off does not name this client's Flare account as receiver");
  }
  const known = knownOmnibusFe(run, reservation?.id);
  // A request of THIS client whose memo it is stays this client's (the autopilot's own record).
  const ownRequest = (run.requests ?? []).some((r) => r.clientId === clientId && upper(r.memoHex) === memo);
  if (known.memos.has(memo) && !ownRequest) return no(`its memo ${memo.slice(0, 12)}… already belongs to another record of this run`);
  return { ok: true, memoHex: memo };
}

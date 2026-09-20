/**
 * runHealth — the ONE reducer that turns GET /rules/:id/runs into a verdict a
 * human can read, plus the loader that fetches it honestly.
 *
 * WHY THIS FILE EXISTS (G4-strategies, auditoría 2026-08-17 §G4):
 *
 * When an AutomationRule fires, the engine records an AutomationRun
 * (backend/src/engines/automation/AutomationEngine.ts). If the ACTION could not
 * be composed — `NoCageForLegacy`, `NOT_A_COUNCIL`, `council_compose_failed`,
 * `scheduled_payment_invalid`, a failed prepare — the run is stored with
 * `status: 'error'` and the reason in `notes`, and then, BY DESIGN (the «éxito
 * no ganado» guard), `totalTimesTriggered` is NOT incremented and NO push is
 * sent. Correct on the engine side, catastrophic on every surface that decides
 * a rule's state from its ROW: with no counter and no push, a rule that failed
 * every single fire rendered exactly like a healthy one — green «active»,
 * «expires in 87d» — and an owner read that as protection.
 *
 * Round 1 fixed three surfaces (MoneyFlowsPanel, LegacyActivityFeed,
 * DefiPositionsBoard) by pasting the SAME reducer into each of them, each copy
 * carrying a comment promising that the shared home «is a follow-up». This is
 * that home. Three literal copies were one accident away from four, and four
 * copies of a verdict is four chances for two surfaces to disagree about the
 * same rule — which is the failure mode this whole front exists to kill.
 *
 * DOCTRINE (CLAUDE.md): never paint green over a state we did not read. «I
 * could not read it» is NOT «it never fired», and neither of them is «it works».
 * That is why `unreadable` is a first-class verdict and not a silent catch.
 */

/** One row of GET /rules/:id/runs (backend/src/routes/rules.ts, newest first). */
export interface RuleRun {
  triggeredAt: string;
  /** AutomationRunStatus: triggered | intent_prepared | proposal_created | user_acted | expired | error */
  status: string;
  notes: string | null;
}

export type RunHealth =
  /** Not read yet (first paint) — say nothing rather than guess. */
  | { state: 'unread' }
  /** The read itself failed: we do NOT know whether the rule works. */
  | { state: 'unreadable'; detail: string }
  /** Read fine, the rule has never fired. */
  | { state: 'never' }
  /** Last fire produced its artefact (proposal / intent / nudge). */
  | { state: 'ok' }
  /** Last fire ERRORED — the rule is armed and producing nothing. */
  | { state: 'failed'; at: string; note: string | null; consecutive: number };

/** The shared «not read yet» singleton, so surfaces stop re-typing the literal. */
export const UNREAD: RunHealth = { state: 'unread' };

/**
 * The run statuses that mean THIS FIRE PRODUCED NOTHING TO SIGN.
 *
 * G4-pildoras (round 3, from the G3-tormenta verdict) — `expired` joined
 * `error` here. G3 taught AutomationEngine to close an abandoned occurrence
 * with a run of its own (`AutomationEngine.announceExpiredOccurrence` →
 * `status: 'expired'`, the reason in `notes`): after ~36 h of barren attempts
 * the occurrence leaves the catch-up window and will NOT be retried. That run
 * lands at the HEAD of GET /rules/:id/runs, and this reducer used to answer
 * `!== 'error'` → `ok`, so the rule turned GREEN at the exact instant the
 * engine gave up on it — the abandonment notice was invisible AND inverted.
 * `expired` is not a state of the world we merely failed to read: it is the
 * engine saying, in its own row, that nothing was sent and nothing was signed.
 *
 * `triggered` / `intent_prepared` / `proposal_created` / `user_acted` stay out:
 * they cover the honest cases the engine retries after the cooldown (a busy
 * council, a debt already repaid).
 */
const FAILED_RUN_STATUSES: ReadonlySet<string> = new Set(['error', 'expired']);

/**
 * The run list reduced to the one fact an owner needs: did the LAST fire work,
 * and if not, why. `consecutive` counts the unbroken streak of failures at the
 * head of the list (the endpoint orders by triggeredAt desc) — «it failed its
 * last 6 fires» is a different sentence from «it failed once».
 */
export function summarizeRuns(runs: RuleRun[]): RunHealth {
  if (runs.length === 0) return { state: 'never' };
  const last = runs[0];
  if (!FAILED_RUN_STATUSES.has(last.status)) return { state: 'ok' };
  let consecutive = 0;
  for (const r of runs) {
    if (!FAILED_RUN_STATUSES.has(r.status)) break;
    consecutive += 1;
  }
  return { state: 'failed', at: last.triggeredAt, note: last.notes ?? null, consecutive };
}

/** True when the LAST fire errored — the one test a pill needs before going green. */
export function isFailing(health: RunHealth | undefined): boolean {
  return health?.state === 'failed';
}

/** The Pill tones the primitive offers (components/ui/primitives.tsx). */
export type RulePillTone = 'neutral' | 'success' | 'warning' | 'danger';

/** What a rule's status chip is ALLOWED to say, given what we actually read. */
export type RulePillState = 'paused' | 'failing' | 'unreadable' | 'unread' | 'active';

/**
 * G4-pildoras (round 3) — THE BUG THIS CLOSES.
 *
 * Every surface wrote the same expression by hand:
 *
 *   tone={!r.enabled ? 'neutral' : failing ? 'danger' : 'success'}
 *
 * with `failing = isFailing(health)`. `isFailing` is true ONLY for `failed`, so
 * `unread` and `unreadable` both fell into the green `success` arm. Two
 * consequences, both verified on screen:
 *
 *   · first paint of EVERY surface: each enabled rule reads a green «active»
 *     for the whole round-trip to /runs, before a single run was read;
 *   · worse, when the read BREAKS (500 / timeout), a rule already known to be
 *     FAILING flips back to green «active» — a failed read served as a verdict
 *     of health, which is the exact inversion CLAUDE.md forbids: «never paint
 *     green over a state we did not read; "I could not read it" is NOT "it
 *     works"».
 *
 * So the verdict gets its own tone. `unread` is a NO-CLAIM (neutral, like a
 * paused rule: we are saying nothing about its health because we know nothing
 * yet) and `unreadable` is a FACT about us (warning — we tried and failed, the
 * same amber the RunHealthNote already uses for it). Green now requires a run
 * list we actually read.
 *
 * Pure and primitive-only on purpose: this is the piece a test can hold, and
 * the six surfaces can no longer drift apart about the same rule.
 */
export function rulePillState(enabled: boolean, health: RunHealth | undefined): RulePillState {
  if (!enabled) return 'paused';
  const state = health?.state ?? 'unread';
  if (state === 'failed') return 'failing';
  if (state === 'unreadable') return 'unreadable';
  if (state === 'unread') return 'unread';
  return 'active';
}

export const RULE_PILL_TONE: Record<RulePillState, RulePillTone> = {
  paused: 'neutral',
  failing: 'danger',
  unreadable: 'warning',
  unread: 'neutral',
  active: 'success',
};

/** Severity, worst last: what a card standing for SEVERAL rules must show. */
const PILL_SEVERITY: Record<RulePillState, number> = {
  paused: 0,
  active: 1,
  unread: 2,
  unreadable: 3,
  failing: 4,
};

/**
 * The chip of a card that stands for a GROUP of rules (a MoneyFlow bundles
 * several). The worst thing we know wins, and «I do not know yet» outranks
 * «active»: a card cannot claim green while one of its rules is still unread —
 * that is the same green-over-unread lie, one level up. An empty group claims
 * nothing (`paused`).
 */
export function worstPillState(states: RulePillState[]): RulePillState {
  let worst: RulePillState = 'paused';
  for (const s of states) if (PILL_SEVERITY[s] > PILL_SEVERITY[worst]) worst = s;
  return worst;
}

/** A message we can show, from anything a rejected promise may carry. */
function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

/** Coerce one API row; a missing `notes` is null, never an invented reason. */
function toRun(x: unknown): RuleRun {
  const r = (x ?? {}) as Record<string, unknown>;
  return {
    triggeredAt: String(r.triggeredAt ?? ''),
    status: String(r.status ?? ''),
    notes: typeof r.notes === 'string' ? r.notes : null,
  };
}

export function toRuns(rows: unknown): RuleRun[] {
  return Array.isArray(rows) ? rows.map(toRun) : [];
}

/**
 * Read the run history of N rules and reduce each to its verdict.
 *
 * EVERY id asked about gets an entry, INCLUDING the ones whose read failed: an
 * absent entry is indistinguishable from «healthy», which is exactly the bug
 * this module closes. One read per rule per mount/refresh — never a poll of its
 * own: run history only changes on an engine tick, and a broken rule stays
 * broken until someone repairs it.
 */
export async function loadRunHealth(
  ruleIds: string[],
  readRuns: RunsReader,
): Promise<Record<string, RunHealth>> {
  const readings = await loadRunReadings(ruleIds, readRuns);
  return Object.fromEntries(Object.entries(readings).map(([id, r]) => [id, r.verdict]));
}

/** What GET /rules/:id/runs answers (backend/src/routes/rules.ts L311). */
export type RunsReader = (id: string) => Promise<{ count?: number; runs?: unknown }>;

/**
 * The run history of ONE rule for a surface that also PRINTS it: the verdict
 * plus the counters the endpoint returned.
 *
 * REUSE (auditoría 2026-08-18) — why this exists. Five of the six surfaces only
 * need the verdict, and `loadRunHealth` gives them exactly that. The sixth,
 * DefiPositionsBoard, ALSO writes a history line under each rule's name («N
 * triggers · last …»), so it kept a hand-rolled fetch of /rules/:id/runs — the
 * last private copy of this read, with its own headers, its own error wording
 * and its own idea of what a failed read means. Rather than leave it outside
 * the shared home, the home learned the three extra facts it needed. One
 * reader, one definition of «unreadable», six surfaces.
 */
export interface RuleRunReading {
  /** Runs the endpoint returned (0 with a `never` verdict = it truly never fired). */
  count: number;
  lastAt?: string;
  lastStatus?: string;
  /** The verdict — the same one `loadRunHealth` hands the other five surfaces. */
  verdict: RunHealth;
}

/** One /rules/:id/runs payload → its reading. `count` comes from the endpoint
 *  when it sent one, and otherwise from the rows we actually read. */
export function summarizeReading(payload: { count?: number; runs?: unknown } | null | undefined): RuleRunReading {
  const runs = toRuns(payload?.runs);
  return {
    count: typeof payload?.count === 'number' ? payload.count : runs.length,
    lastAt: runs[0]?.triggeredAt,
    lastStatus: runs[0]?.status,
    verdict: summarizeRuns(runs),
  };
}

/**
 * The reading of a read that FAILED: zero counters and a verdict that says so.
 *
 * The counters are zero because we have none — and every surface must render
 * this off the `unreadable` VERDICT, never off `count === 0`, which is the
 * «No triggers yet» lie this module exists to kill.
 */
export function unreadableReading(detail: string): RuleRunReading {
  return { count: 0, verdict: { state: 'unreadable', detail } };
}

/**
 * {@link loadRunHealth} with the counters kept. Same contract in every other
 * respect: EVERY id asked about gets an entry, including the ones whose read
 * failed, and one read per rule per mount/refresh — never a poll of its own.
 */
export async function loadRunReadings(
  ruleIds: string[],
  readRuns: RunsReader,
): Promise<Record<string, RuleRunReading>> {
  const entries = await Promise.all(
    ruleIds.map(async (id): Promise<[string, RuleRunReading]> => {
      try {
        return [id, summarizeReading(await readRuns(id))];
      } catch (e) {
        return [id, unreadableReading(errText(e))];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * G4-strategies — what to hold WHILE the next read is in flight.
 *
 * The round-1 surfaces wiped the map (`setLastRuns({})`) at the top of every
 * refresh, so a rule already known to be FAILING flipped back to the green
 * «active» / «watching» wording for the whole round-trip — the exact reassurance
 * the front exists to remove, reintroduced once per refresh. Keep what we
 * already read for the rules still in the list, and drop only the ones that
 * left. A rule that is new to the list simply has no entry, which
 * reads as `unread` and prints nothing.
 */
export function retainKnownRuns(
  prev: Record<string, RunHealth>,
  ruleIds: string[],
): Record<string, RunHealth> {
  const keep: Record<string, RunHealth> = {};
  for (const id of ruleIds) {
    const known = prev[id];
    if (known) keep[id] = known;
  }
  return keep;
}

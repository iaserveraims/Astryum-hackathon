/**
 * rulePrefill — carry PRECOMPUTED, user-chosen values from one flow into a
 * rule/automation form, as EDITABLE starting values with a fallback to the
 * form's own defaults.
 */

import { getApiBase } from '../env';

/** Field-key → value, in the same string form the form's inputs hold. */
export type RulePrefillValues = Record<string, string>;

export interface RulePrefill {
  values: RulePrefillValues;
  /** Where the values came from (shown to the user, e.g. 'strategy-entry'). */
  source: string;
  /** Extra display-only context (e.g. the precomputed trigger price). */
  context?: Record<string, string>;
  savedAt: number;
}

/** Minimal shape of a form field this pattern can prefill. */
export interface PrefillableField {
  key: string;
  default: string;
}

const KEY_PREFIX = 'astryum.rulePrefill.';

/** Stashed values older than this are ignored: thresholds chosen for a
 *  position weeks ago no longer describe it. */
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Local copy of the DefiPositionsBoard authHeaders pattern — deliberately
 *  not imported from there, this file has no component dependencies. */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Canonical scope key, e.g. scope(['PROTECT', 'kinetic', owner]). */
export function rulePrefillScope(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.toLowerCase())
    .join(':');
}

export function stashRulePrefill(scope: string, prefill: Omit<RulePrefill, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  const entry: RulePrefill = { ...prefill, savedAt: Date.now() };
  try {
    window.localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(entry));
  } catch {
    /* storage full/blocked — prefill is best-effort UX, never load-bearing */
  }
  // F25: best-effort cross-device mirror. Fire-and-forget — the localStorage
  // write above already satisfies this device's flow, so a slow/failed
  // request here must never block or interrupt whatever the caller is
  // mid-way through (often a signing flow).
  try {
    fetch(`${getApiBase()}/preferences/rule-prefills`, {
      method: 'PUT',
      headers: authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ scope, entry }),
    }).catch(() => {
      /* network/server error — local write already succeeded */
    });
  } catch {
    /* ignore — server sync is best-effort only */
  }
}

export function readRulePrefill(scope: string, maxAgeMs = DEFAULT_MAX_AGE_MS): RulePrefill | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + scope);
    if (!raw) return null;
    const entry = JSON.parse(raw) as RulePrefill;
    if (!entry || typeof entry.savedAt !== 'number' || typeof entry.values !== 'object') return null;
    if (Date.now() - entry.savedAt > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}

export function clearRulePrefill(scope: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY_PREFIX + scope);
  } catch {
    /* ignore */
  }
}

/**
 * Initial form values: the stashed value where one exists, the field's own
 * default otherwise. `prefilledKeys` lets the form tell the user WHICH fields
 * were brought in (they all stay editable).
 */
export function resolveInitialValues(
  fields: PrefillableField[],
  prefill: RulePrefill | null,
): { values: RulePrefillValues; prefilledKeys: Set<string> } {
  const values: RulePrefillValues = {};
  const prefilledKeys = new Set<string>();
  for (const f of fields) {
    const stashed = prefill?.values[f.key];
    if (typeof stashed === 'string' && stashed.length > 0) {
      values[f.key] = stashed;
      prefilledKeys.add(f.key);
    } else {
      values[f.key] = f.default;
    }
  }
  return { values, prefilledKeys };
}

// Module-level guard: hydrate at most once per page session, no matter how
// many callers ask (each rule/template form could otherwise trigger its own
// fetch). A concurrent second call while the first is still in flight awaits
// the same request rather than firing a duplicate one.
let hydratedThisSession = false;
let hydrateInFlight: Promise<void> | null = null;

/**
 * F25 read-back: pull this user's stashed prefills from the server and
 * backfill any scope this device's localStorage is missing or has an older
 * copy of (compared by `savedAt`). Writes in the exact on-disk shape
 * `stashRulePrefill`/`readRulePrefill` already use, so nothing downstream
 * needs to change. Best-effort and silent — a failed/slow request just means
 * this device falls back to whatever it already had (or nothing, same as
 * today).
 */
export async function hydrateRulePrefillsFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (hydratedThisSession) return;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/preferences/rule-prefills`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { prefills?: Record<string, RulePrefill> };
      const serverPrefills = body?.prefills ?? {};

      for (const [scope, serverEntry] of Object.entries(serverPrefills)) {
        if (
          !serverEntry ||
          typeof serverEntry.savedAt !== 'number' ||
          typeof serverEntry.values !== 'object'
        ) {
          continue; // malformed — ignore, same defensive check as readRulePrefill
        }

        let shouldWrite = true;
        try {
          const localRaw = window.localStorage.getItem(KEY_PREFIX + scope);
          if (localRaw) {
            const local = JSON.parse(localRaw) as RulePrefill;
            if (local && typeof local.savedAt === 'number' && local.savedAt >= serverEntry.savedAt) {
              shouldWrite = false; // local is same-age-or-newer — keep it
            }
          }
        } catch {
          /* corrupt local entry — the server value is at least as good */
        }

        if (shouldWrite) {
          try {
            window.localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(serverEntry));
          } catch {
            /* storage full/blocked — best-effort */
          }
        }
      }
    } catch {
      /* network/parse error — hydration is best-effort, never blocks the UI */
    } finally {
      hydratedThisSession = true;
      hydrateInFlight = null;
    }
  })();

  return hydrateInFlight;
}

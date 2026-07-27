'use client';

/**
 * Global watcher for automation-prepared intents left `proposed` /
 * `pending_user_review` (F3-entrega: "the user must find out without the tab
 * open"). Polls GET /api/intents for every EVM wallet the user has connected
 * — same source and dedupe-by-id pattern as app/intents/page.tsx — every 60s
 * while the tab is `visible`, and the first time an intent shows up that this
 * device hasn't alerted on yet, fires a browser Notification (only if the
 * user already granted permission) pointing back at /app/intents.
 *
 * Read + alert only: nothing here signs, custodies or broadcasts anything
 * (CLAUDE.md invariants #1/#8). Mount ONCE in AppShell — not per page — so
 * every surface shares one poller and one badge count.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMyWallets } from './useMyWallets';
import { EVM_ADDRESS_RE } from '../lib/portfolioMerge';
import { hasAuthToken } from '../lib/authError';
import { intentsApi, type IntentStatus, type PreparedIntent } from '../services/v1Api';

const POLL_MS = 60_000;
const WAITING_STATUSES: IntentStatus[] = ['proposed', 'pending_user_review'];

const NOTIFIED_KEY = 'astryum.notifiedIntents';
// 30 days — comfortably longer than any intent's own expiresAt TTL (minutes to
// hours), so the ledger only exists to stop a re-notify; it isn't a record of
// anything load-bearing and can be pruned aggressively.
const NOTIFIED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readNotifiedMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeNotifiedMap(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    /* storage full/blocked — the ledger is best-effort UX, worst case we re-notify once */
  }
}

/** Merges `newIds` into `map` (stamped now) and drops anything past
 *  NOTIFIED_MAX_AGE_MS — the poda (pruning) pass runs every tick, not just
 *  when something new shows up, so the ledger never grows unbounded even in
 *  a tab that's been open for weeks. Returns `changed: false` when nothing
 *  needs writing, so we don't hit localStorage every 60s for no reason. */
function pruneAndMerge(
  map: Record<string, number>,
  newIds: string[],
): { map: Record<string, number>; changed: boolean } {
  const now = Date.now();
  let changed = false;
  const next: Record<string, number> = {};
  for (const [id, ts] of Object.entries(map)) {
    if (now - ts <= NOTIFIED_MAX_AGE_MS) next[id] = ts;
    else changed = true;
  }
  for (const id of newIds) {
    if (!(id in next)) changed = true;
    next[id] = now;
  }
  return { map: next, changed };
}

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export interface IntentWatcherState {
  /** Count of intents currently `proposed` / `pending_user_review` across every EVM wallet — feeds the nav badge. */
  waitingCount: number;
  /** The waiting intents themselves — feeds the always-on sidebar card so it can list them without a second poller. */
  waiting: PreparedIntent[];
  /** Waiting intents from the latest tick that hadn't been notified on this device before (the hook already fired the Notification itself — this is informational for callers that want it). */
  newSinceLastSeen: PreparedIntent[];
  /** Force an immediate re-poll (e.g. right after the user signs/dismisses from the sidebar). No-op while a poll is already in flight or the tab is hidden. */
  refresh: () => void;
}

const EMPTY_STATE = { waitingCount: 0, waiting: [] as PreparedIntent[], newSinceLastSeen: [] as PreparedIntent[] };

export function useIntentWatcher(): IntentWatcherState {
  const { wallets: myWallets } = useMyWallets();
  const evmWallets = useMemo(
    () => myWallets.map((w) => w.address).filter((a) => EVM_ADDRESS_RE.test(a)),
    [myWallets],
  );
  const walletsKey = evmWallets.join(',').toLowerCase();

  const [state, setState] = useState<Omit<IntentWatcherState, 'refresh'>>(EMPTY_STATE);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The tick reads the live wallet list through a ref so `tick` itself stays
  // stable (no re-subscribe on every render) and `refresh` can be handed out safely.
  const evmRef = useRef(evmWallets);
  evmRef.current = evmWallets;

  const tick = useCallback(async () => {
    const wallets = evmRef.current;
    if (wallets.length === 0 || !hasAuthToken()) {
      if (mounted.current) setState(EMPTY_STATE);
      return;
    }
    if (inFlight.current || document.visibilityState !== 'visible') return;
    inFlight.current = true;
    try {
      const results = await Promise.all(
        wallets.map((address) => intentsApi.list(address).catch(() => null)),
      );

      const seen = new Map<string, PreparedIntent>();
      for (const r of results) {
        for (const it of r?.intents ?? []) seen.set(it.id, it);
      }
      const waiting = Array.from(seen.values())
        .filter((i) => WAITING_STATUSES.includes(i.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const notifiedMap = readNotifiedMap();
      const unnotified = waiting.filter((i) => !(i.id in notifiedMap));

      if (
        unnotified.length > 0 &&
        notificationsSupported() &&
        Notification.permission === 'granted'
      ) {
        for (const intent of unnotified) {
          try {
            const n = new Notification('Astryum — waiting for your signature', {
              body: `${intent.action} · ${intent.protocolId}`,
              tag: `astryum-intent-${intent.id}`,
            });
            n.onclick = () => {
              window.focus();
            };
          } catch {
            /* a single bad Notification() call (e.g. no service worker in some browsers) never blocks the rest */
          }
        }
      }

      // Mark notified regardless of permission — otherwise the moment the
      // user later grants permission, every intent that ever piled up
      // fires at once.
      const { map: nextMap, changed } = pruneAndMerge(notifiedMap, unnotified.map((i) => i.id));
      if (changed) writeNotifiedMap(nextMap);

      if (mounted.current) setState({ waitingCount: waiting.length, waiting, newSinceLastSeen: unnotified });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (evmWallets.length === 0 || !hasAuthToken()) {
      setState(EMPTY_STATE);
      return;
    }

    void tick();
    const intervalId = setInterval(() => void tick(), POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // `evmWallets.length` is covered by `walletsKey` (both derive from the same
    // wallet list), so re-subscribing on walletsKey alone is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsKey, tick]);

  return { ...state, refresh: () => void tick() };
}

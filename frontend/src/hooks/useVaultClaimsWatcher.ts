'use client';

/**
 * useVaultClaimsWatcher — the "money in flight" poller behind the Intents card.
 *
 * Some vaults do NOT pay on redeem: Firelight stXRP burns the shares now and
 * queues the FXRP into a ~24h withdrawal period (verified on-chain 2026-07-14).
 * Between the redeem and the claim the money is invisible unless something
 * watches the queue — this hook is that watcher, feeding the sidebar Intents
 * card so the user sees the FXRP in flight, WHEN it unlocks, and gets the
 * one-tap Claim the moment the period ends.
 *
 * Authority-scoped on purpose (useAuthorityWallets): under Astryum Personal it
 * watches the personal wallets and their Smart Accounts; under a Legacy it
 * watches the governed account's Smart Account — the card tells each product
 * its own truth. Owners scanned = every 0x wallet directly + the resolved PA
 * of every XRPL wallet (lib/wallet/paOwnership, shared session cache).
 *
 * Read + alert only: nothing here signs, custodies or broadcasts (invariants
 * #1/#8). The Claim itself goes through VaultClaimModal → prepare → the USER
 * signs. Fires a browser Notification once per claim when it turns claimable
 * (same dedupe-ledger pattern as useIntentWatcher).
 *
 * it. 31 — A FAILED READ KEEPS THE LAST GOOD LIST. it. 29 made `/vault-claims`
 * answer 502 instead of an empty 200; this hook turned every `!res.ok` into
 * `null`, that owner contributed no rows, and `setEntries(next)` REPLACED the
 * list — the queued exit disappeared from the tray one floor up, and the tray,
 * with no rows and no notice, went quiet («nothing waiting»). The tick now
 * lives in lib/earn/vaultClaimsTick (runnable without React): an unread owner
 * keeps its rows (marked stale) and is named in `unreadable`, which the tray
 * reads before it may say «nothing».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorityWallets } from './useAuthorityWallets';
import { resolvePersonalAccountOf } from '../lib/wallet/paOwnership';
import { hasAuthToken } from '../lib/authError';
import { getApiBase } from '../lib/env';
import {
  mergeClaimsTick,
  readOwnerQueue,
  type FetchLike,
  type VaultClaimEntry,
  type VaultClaimsUnreadable,
} from '../lib/earn/vaultClaimsTick';

export type { VaultClaimEntry, VaultClaimsUnreadable } from '../lib/earn/vaultClaimsTick';

const API_BASE = getApiBase();
const POLL_MS = 120_000; // periods are ~24h — a 2-min tick is plenty
const NOTIFIED_KEY = 'astryum.notifiedClaims';
const NOTIFIED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function readNotified(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTIFIED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeNotified(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    /* best-effort — worst case one repeat notification */
  }
}

export interface VaultClaimsState {
  /** Every queued exit of the active authority, claimable first, newest period first. */
  entries: VaultClaimEntry[];
  /** How many are claimable RIGHT NOW — feeds the badge. */
  claimableCount: number;
  /** Force an immediate re-poll (after a claim signature). */
  refresh: () => void;
  /** it. 31 — owners whose queue the last tick could not (fully) read. Empty
   *  when every owner answered. The tray must not say «nothing waiting» while
   *  this is non-empty: the rows above may be the last good read. */
  unreadable: VaultClaimsUnreadable[];
}

export function useVaultClaimsWatcher(): VaultClaimsState {
  const { wallets } = useAuthorityWallets();
  const addressesKey = useMemo(
    () => wallets.map((w) => w.address).join(',').toLowerCase(),
    [wallets],
  );

  const [entries, setEntries] = useState<VaultClaimEntry[]>([]);
  const [unreadable, setUnreadable] = useState<VaultClaimsUnreadable[]>([]);
  // The last list shown — what a failed read falls back to (never []).
  const entriesRef = useRef<VaultClaimEntry[]>([]);
  entriesRef.current = entries;
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const tick = useCallback(async () => {
    if (!hasAuthToken()) {
      // No session is a FACT (nothing to watch), not a failed read.
      if (mounted.current) {
        setEntries([]);
        setUnreadable([]);
      }
      return;
    }
    if (inFlight.current || document.visibilityState !== 'visible') return;
    inFlight.current = true;
    try {
      // Owners = 0x wallets as-is + the Smart Account of every XRPL wallet.
      const records = walletsRef.current;
      const evm = records.map((w) => w.address).filter((a) => EVM_RE.test(a));
      const xrpl = records.map((w) => w.address).filter((a) => XRPL_RE.test(a));
      const pas = (
        await Promise.all(xrpl.map((x) => resolvePersonalAccountOf(x).catch(() => null)))
      ).filter((pa): pa is string => !!pa);
      const owners = [...new Set([...evm, ...pas].map((a) => a.toLowerCase()))];
      if (owners.length === 0) {
        // No owner to watch is a fact about the authority, not a failed read.
        if (mounted.current) {
          setEntries([]);
          setUnreadable([]);
        }
        return;
      }

      // it. 31 — one read per owner, each an ANSWER or an admission; then the
      // fold over the LAST list (a refused owner keeps its rows, marked stale).
      const headers = authHeaders();
      const reads = await Promise.all(
        owners.map((owner) => readOwnerQueue(owner, fetch as unknown as FetchLike, API_BASE, headers)),
      );
      const { entries: next, unreadable: unread } = mergeClaimsTick(entriesRef.current, reads);

      // One browser Notification per claim, the first time it shows claimable.
      const ready = next.filter((e) => e.claimable);
      const ledger = readNotified();
      const fresh = ready.filter((e) => !(`${e.owner}-${e.period}` in ledger));
      if (fresh.length > 0) {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          for (const e of fresh) {
            try {
              const est = e.estFxrpBase != null ? `≈${(Number(e.estFxrpBase) / 1e6).toFixed(4)} FXRP` : 'FXRP';
              new Notification('Astryum — withdrawal ready to claim', {
                body: `${est} · ${e.vaultLabel} · period ${e.period}`,
                tag: `astryum-claim-${e.owner}-${e.period}`,
              });
            } catch {
              /* never let one bad Notification() block the rest */
            }
          }
        }
        const now = Date.now();
        const merged: Record<string, number> = {};
        for (const [k, ts] of Object.entries(ledger)) {
          if (now - ts <= NOTIFIED_MAX_AGE_MS) merged[k] = ts;
        }
        for (const e of fresh) merged[`${e.owner}-${e.period}`] = now;
        writeNotified(merged);
      }

      if (mounted.current) {
        setEntries(next);
        setUnreadable(unread);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hasAuthToken() || addressesKey.length === 0) {
      setEntries([]);
      setUnreadable([]);
      return;
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // addressesKey covers the wallet list identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesKey, tick]);

  return {
    entries,
    claimableCount: entries.filter((e) => e.claimable).length,
    refresh: () => void tick(),
    unreadable,
  };
}

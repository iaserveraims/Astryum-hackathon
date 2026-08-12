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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorityWallets } from './useAuthorityWallets';
import { resolvePersonalAccountOf } from '../lib/wallet/paOwnership';
import { hasAuthToken } from '../lib/authError';
import { getApiBase } from '../lib/env';

const API_BASE = getApiBase();
const POLL_MS = 120_000; // periods are ~24h — a 2-min tick is plenty
const NOTIFIED_KEY = 'astryum.notifiedClaims';
const NOTIFIED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export interface VaultClaimEntry {
  /** 'firelight' — the only queued-exit vault today. */
  vault: 'firelight';
  vaultLabel: string;
  /** The 0x account that queued the exit (EVM wallet or Smart Account). */
  owner: string;
  period: number;
  /** FXRP queued for release (base units, 6 dec). The stXRP shares burned at
   *  redeem — `withdrawalsOf` reports the assets waiting, not shares. */
  queuedFxrpBase: string;
  /** Estimated FXRP the claim releases (base units); null if unreadable. */
  estFxrpBase: string | null;
  /** true once the period ended — claimWithdraw succeeds now. */
  claimable: boolean;
  /** ISO end of the still-running period (null once claimable). */
  claimableAt: string | null;
}

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
}

export function useVaultClaimsWatcher(): VaultClaimsState {
  const { wallets } = useAuthorityWallets();
  const addressesKey = useMemo(
    () => wallets.map((w) => w.address).join(',').toLowerCase(),
    [wallets],
  );

  const [entries, setEntries] = useState<VaultClaimEntry[]>([]);
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
      if (mounted.current) setEntries([]);
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
        if (mounted.current) setEntries([]);
        return;
      }

      const results = await Promise.all(
        owners.map(async (owner) => {
          try {
            const res = await fetch(`${API_BASE}/flare-demo/vault-claims/${owner}`, {
              headers: authHeaders(),
              credentials: 'include',
            });
            if (!res.ok) return null;
            return (await res.json()) as {
              owner: string;
              pending?: Array<{
                period: number;
                queuedFxrpBase: string;
                estFxrpBase: string | null;
                claimable: boolean;
                claimableAt: string | null;
              }>;
            };
          } catch {
            return null;
          }
        }),
      );

      const next: VaultClaimEntry[] = [];
      for (const r of results) {
        if (!r) continue;
        for (const p of r.pending ?? []) {
          next.push({
            vault: 'firelight',
            vaultLabel: 'stXRP',
            owner: r.owner,
            period: p.period,
            queuedFxrpBase: p.queuedFxrpBase,
            estFxrpBase: p.estFxrpBase,
            claimable: p.claimable,
            claimableAt: p.claimableAt,
          });
        }
      }
      next.sort((a, b) => Number(b.claimable) - Number(a.claimable) || b.period - a.period);

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

      if (mounted.current) setEntries(next);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hasAuthToken() || addressesKey.length === 0) {
      setEntries([]);
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
  };
}

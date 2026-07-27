'use client';

/**
 * useSettlement — the React shell over the settlement tracker. ONE operation at
 * a time (a new track() supersedes the previous), which matches every consumer:
 * a modal signs one intent and follows it to settled | failed | stalled.
 *
 * The chain reads are all READ-ONLY (getCallsStatus / receipt / mint-status) —
 * the wallet signed and broadcast; Astryum only watches (invariant #1 intact).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { getApiBase } from '../env';
import type { CallsStatusLike, SettlementState } from './settlement';
import { trackSettlement, type TrackerDeps } from './tracker';

/**
 * The READ-ONLY chain deps every settlement poll needs, shared by
 * useSettlement (one op per modal) and useResumePendingSettlements (the
 * rehydrated ops after a reload). Stable object; the functions read the LIVE
 * connector/client through refs, so a wallet that reconnects after mount
 * (wagmi autoconnect) starts answering getCallsStatus without a re-track.
 */
export function useTrackerDeps(): TrackerDeps {
  const { connector } = useAccount();
  const publicClient = usePublicClient();
  const connectorRef = useRef(connector);
  connectorRef.current = connector;
  const clientRef = useRef(publicClient);
  clientRef.current = publicClient;

  return useMemo<TrackerDeps>(
    () => ({
      async getCallsStatus(id) {
        const provider = (await connectorRef.current?.getProvider?.()) as
          | { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }
          | undefined;
        if (!provider) throw new Error('NO_WALLET_PROVIDER');
        return (await provider.request({
          method: 'wallet_getCallsStatus',
          params: [id],
        })) as CallsStatusLike;
      },
      async getTxReceipt(hash) {
        const client = clientRef.current;
        if (!client) return null;
        try {
          return await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        } catch {
          return null; // not mined yet / node hiccup — keep polling
        }
      },
      async getMintStatus(xrplHash) {
        try {
          const res = await fetch(`${getApiBase()}/flare-demo/mint-status/${xrplHash}`);
          if (!res.ok) return null;
          const body = (await res.json()) as { executed?: boolean };
          return typeof body.executed === 'boolean' ? body.executed : null;
        } catch {
          return null; // red caída ≠ pendiente — retry without changing state
        }
      },
      async getXrplTxValidated(xrplHash) {
        // Plain XRPL Payment (transfers): the settle-read is the tx VALIDATED in
        // the ledger — public cluster, CORS-enabled, read-only.
        try {
          const res = await fetch('https://xrplcluster.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'tx', params: [{ transaction: xrplHash.toUpperCase() }] }),
          });
          if (!res.ok) return null;
          const body = (await res.json()) as { result?: { validated?: boolean } };
          if (body.result?.validated === true) return true;
          return body.result ? false : null; // txnNotFound = not yet validated — keep polling
        } catch {
          return null;
        }
      },
      async getCouncilOrderExecuted(xrplHash) {
        // Council order: LegacyBridge.consumedTxId, read through the status
        // endpoint (the same truth the ceremony card enriches with relay detail).
        try {
          const res = await fetch(`${getApiBase()}/xrpl-defi/council-order/status?txId=${xrplHash}`);
          if (!res.ok) return null;
          const body = (await res.json()) as { executed?: boolean };
          return typeof body.executed === 'boolean' ? body.executed : null;
        } catch {
          return null;
        }
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    }),
    [],
  );
}

export interface TrackCallbacks {
  /** Fires ONCE, on real confirmation — the only place a consumer may act on success. */
  onSettled?: (s: SettlementState) => void;
  onFailed?: (reason: string | undefined, s: SettlementState) => void;
}

export interface UseSettlement {
  /** Live state of the tracked operation, or null before track()/after reset(). */
  state: SettlementState | null;
  /** Follow a handle returned by sendIntentCalls (or startPending for XRPL mints). */
  track: (handle: SettlementState, cbs?: TrackCallbacks) => void;
  reset: () => void;
}

export function useSettlement(): UseSettlement {
  const deps = useTrackerDeps();
  const [state, setState] = useState<SettlementState | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const track = useCallback(
    (handle: SettlementState, cbs?: TrackCallbacks) => {
      cancelRef.current?.();
      cancelRef.current = trackSettlement(handle, deps, {
        onUpdate: (s) => {
          setState(s);
          if (s.status === 'settled') cbs?.onSettled?.(s);
          if (s.status === 'failed') cbs?.onFailed?.(s.reason, s);
        },
      });
    },
    [deps],
  );

  const reset = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setState(null);
  }, []);

  return { state, track, reset };
}

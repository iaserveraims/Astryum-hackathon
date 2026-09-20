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
import { startPending, type CallsStatusLike, type PendingRef, type SettlementState } from './settlement';
import { trackSettlement, type TrackerDeps } from './tracker';
import { fetchCouncilOrderExecuted, fetchMintExecuted } from './statusReads';
import { verdictFromTxRead, type XrplTxReadLike } from '../xrpl/txResult';

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
  // Chain-anchored clients (B5-UI paso 1.4): an eth-morpho op settles on
  // Ethereum even if the user switches the wallet back to Flare mid-poll — the
  // receipt read must follow the HANDLE's chain, never the active one.
  const flareClient = usePublicClient({ chainId: 14 });
  const ethClient = usePublicClient({ chainId: 1 });
  const connectorRef = useRef(connector);
  connectorRef.current = connector;
  const clientRef = useRef(publicClient);
  clientRef.current = publicClient;
  const flareClientRef = useRef(flareClient);
  flareClientRef.current = flareClient;
  const ethClientRef = useRef(ethClient);
  ethClientRef.current = ethClient;

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
      async getTxReceipt(hash, chainId) {
        // Legacy handles (no chainId) keep the old behaviour: the active client.
        const client =
          chainId === 1 ? ethClientRef.current
          : chainId === 14 ? flareClientRef.current
          : clientRef.current;
        if (!client) return null;
        try {
          return await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        } catch {
          return null; // not mined yet / node hiccup — keep polling
        }
      },
      getMintStatus: fetchMintExecuted,
      async getXrplTxVerdict(xrplHash) {
        // Plain XRPL Payment (transfers) — public cluster, CORS-enabled,
        // read-only. La traducción a veredicto vive en `verdictFromTxRead`,
        // que es pura y está testeada: aquí sólo se pide el dato.
        //
        // Lo que esto arregla: antes bastaba `validated === true`
        // para pintar verde, sin mirar `TransactionResult`. Un `tec*` está
        // validado, ocupa ledger y cobra fee — y NO hizo el pago. Se anunciaba
        // como asentado.
        try {
          const res = await fetch('https://xrplcluster.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'tx', params: [{ transaction: xrplHash.toUpperCase() }] }),
          });
          if (!res.ok) return { kind: 'unreadable' };
          const body = (await res.json()) as { result?: XrplTxReadLike };
          return verdictFromTxRead(body.result);
        } catch {
          return { kind: 'unreadable' };
        }
      },
      // Council order: LegacyBridge.consumedTxId, read (autenticado) por el
      // endpoint de status — la misma verdad que enriquece la card de la ceremonia.
      getCouncilOrderExecuted: fetchCouncilOrderExecuted,
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
  track: (handle: SettlementState, cbs?: TrackCallbacks, opts?: { opKey?: string }) => void;
  /** Adoptar un pendiente persistido (tras recargar): la ventana rehidratada
   *  vuelve a seguir SU asiento donde lo dejó. */
  adopt: (pending: PendingRef, cbs?: TrackCallbacks) => void;
  reset: () => void;
}

export function useSettlement(): UseSettlement {
  const deps = useTrackerDeps();
  const [state, setState] = useState<SettlementState | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const track = useCallback(
    (handle: SettlementState, cbs?: TrackCallbacks, opts?: { opKey?: string }) => {
      // track() runs the moment the wallet hands back a signature — THE
      // chokepoint every signing surface passes (consumers-wired.test.ts).
      // (The shell-level ceremony that used to fire from here is gone: the
      // SignedMark plays ONCE, in the settlement block — the QR only ticks off its spent code.)
      cancelRef.current?.();
      cancelRef.current = trackSettlement(handle, deps, {
        opKey: opts?.opKey,
        onUpdate: (s) => {
          setState(s);
          if (s.status === 'settled') cbs?.onSettled?.(s);
          if (s.status === 'failed') cbs?.onFailed?.(s.reason, s);
        },
      });
    },
    [deps],
  );

  const adopt = useCallback(
    (pending: PendingRef, cbs?: TrackCallbacks) => {
      cancelRef.current?.();
      cancelRef.current = trackSettlement(
        startPending(pending.rail, pending.ref, pending.explorerUrl, pending.chainId),
        deps,
        {
          startedAt: pending.startedAt,
          opKey: pending.opKey,
          onUpdate: (s) => {
            setState(s);
            if (s.status === 'settled') cbs?.onSettled?.(s);
            if (s.status === 'failed') cbs?.onFailed?.(s.reason, s);
          },
        },
      );
    },
    [deps],
  );

  const reset = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setState(null);
  }, []);

  return { state, track, adopt, reset };
}

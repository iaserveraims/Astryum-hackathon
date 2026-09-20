'use client';

/**
 * useDemoRun — one hook that owns the selected demo run: the run itself (demo
 * ledger + receipts), the live chain facts (pote state, each client's shares,
 * registry, council DID) and the omnibus scan. Everything the three surfaces
 * show comes from here, so the Exchange tab, the User tab and the curtain
 * always agree — and every "done" on screen traces back to a hash.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { demoApi, type DemoRun, type Receipt, type ReceiptChain, type ReceiptStep, type RunSummary } from './api';

export interface PoteStateLite {
  pote: string;
  name: string;
  symbol: string;
  asset: { address: string; symbol: string; decimals: number };
  totalAssets: string;
  totalSupply: string;
  sharePrice: string;
  cooldownSeconds: number;
  bufferFloorBps: number;
  freeBalance: string;
  maxVenueBps: number;
  venues: Array<{ id: number; target: string; kind: string | number; value: string; queuedTotal?: string; readyAt?: number; retired?: boolean }>;
  governance: { council: string; constitutionRef: string; director: string; directorUntil: number };
  error?: string;
}

export interface ClientFacts {
  clientId: string;
  passkeyAccount?: string;
  shares?: string;
  sharesHuman?: string;
  fxrpFree?: string;
  fxrpFreeHuman?: string;
  registryApproved?: boolean;
  registryTag?: number;
  error?: string;
}

export interface ChainFacts {
  readAt: string;
  pote: PoteStateLite | null;
  clients: ClientFacts[];
  council: { didAnchored: boolean; dataHex?: string };
}

const SELECTED_KEY = 'astryum:demoExchange:run';

/**
 * @param opts.fixedRunId — pin the hook to ONE run and never touch the list or
 *   localStorage: the client surface resolves its exchange from its identity
 *   and must not be able to wander into another exchange's ledger.
 * @param opts.allRuns — the founders' operations panel only: list every exchange of
 *   the deployment instead of the caller's own. The backend honours it for an
 *   admin door and ignores it for anybody else.
 */
export function useDemoRun(opts: { fixedRunId?: string; allRuns?: boolean } = {}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<DemoRun | null>(null);
  const [chain, setChain] = useState<ChainFacts | null>(null);
  const [omnibus, setOmnibus] = useState<Awaited<ReturnType<typeof demoApi.scanOmnibus>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const selectedRef = useRef<string | null>(null);

  const refreshRuns = useCallback(async () => {
    const r = await demoApi.listRuns({ all: opts.allRuns });
    if (r.ok) setRuns(r.data.runs);
    else setError(r.refusal.detail ?? r.refusal.error);
    return r;
  }, [opts.allRuns]);

  const loadRun = useCallback(async (runId: string) => {
    selectedRef.current = runId;
    try {
      window.localStorage.setItem(SELECTED_KEY, runId);
    } catch {
      /* private mode */
    }
    setLoading(true);
    setError('');
    const r = await demoApi.getRun(runId);
    setLoading(false);
    if (!r.ok) {
      setError(r.refusal.detail ?? r.refusal.error);
      setRun(null);
      return null;
    }
    setRun(r.data.run);
    return r.data.run;
  }, []);

  const refreshChain = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return null;
    const r = await demoApi.chain(id);
    if (r.ok) setChain(r.data as unknown as ChainFacts);
    return r.ok ? r.data : null;
  }, []);

  const scanOmnibus = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return null;
    const r = await demoApi.scanOmnibus(id);
    if (r.ok) {
      setOmnibus(r);
      // A scan can also settle / release desk payments (their reservation ends).
      if (r.data.credited.length || r.data.deskPaymentsSwept) {
        const fresh = await demoApi.getRun(id);
        if (fresh.ok) setRun(fresh.data.run);
      }
    }
    return r;
  }, []);

  const reload = useCallback(async () => {
    const id = selectedRef.current;
    if (!id) return;
    const fresh = await demoApi.getRun(id);
    if (fresh.ok) setRun(fresh.data.run);
    void refreshChain();
  }, [refreshChain]);

  const addReceipt = useCallback(
    async (input: { step: ReceiptStep; chain: ReceiptChain; txHash?: string; clientId?: string; note?: string; expect?: Record<string, string | number | boolean> }): Promise<Receipt | null> => {
      const id = selectedRef.current;
      if (!id) return null;
      const r = await demoApi.addReceipt(id, input);
      if (r.ok) {
        setRun(r.data.run);
        return r.data.receipt;
      }
      setError(r.refusal.detail ?? r.refusal.error);
      return null;
    },
    [],
  );

  const verify = useCallback(async (receiptId?: string) => {
    const id = selectedRef.current;
    if (!id) return null;
    const r = await demoApi.verify(id, receiptId);
    if (r.ok) setRun(r.data.run);
    else setError(r.refusal.detail ?? r.refusal.error);
    return r;
  }, []);

  // Boot: pinned → load exactly that run; otherwise list runs and reopen the last selected one.
  const fixedRunId = opts.fixedRunId;
  useEffect(() => {
    void (async () => {
      if (fixedRunId) {
        selectedRef.current = fixedRunId;
        setLoading(true);
        const r = await demoApi.getRun(fixedRunId);
        setLoading(false);
        if (r.ok) {
          setRun(r.data.run);
          void refreshChain();
        } else setError(r.refusal.detail ?? r.refusal.error);
        return;
      }
      const r = await refreshRuns();
      if (!r.ok) return;
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(SELECTED_KEY);
      } catch {
        /* ignore */
      }
      const pick = r.data.runs.find((x) => x.runId === last)?.runId ?? r.data.runs[0]?.runId ?? null;
      if (pick) {
        await loadRun(pick);
        void refreshChain();
      }
    })();
  }, [fixedRunId, refreshRuns, loadRun, refreshChain]);

  return {
    runs,
    run,
    chain,
    omnibus,
    loading,
    error,
    setError,
    refreshRuns,
    loadRun,
    reload,
    refreshChain,
    scanOmnibus,
    addReceipt,
    verify,
    setRun,
  };
}

export type DemoRunApi = ReturnType<typeof useDemoRun>;

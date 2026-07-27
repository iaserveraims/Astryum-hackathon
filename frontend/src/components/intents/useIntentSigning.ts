'use client';

/**
 * useIntentSigning — the ONE place a prepared intent is handed to the user's
 * wallet, shared by the full page (app/intents/page.tsx) and the always-on
 * sidebar card (SidebarIntents.tsx).
 *
 * REGULATORY BOUNDARY (CLAUDE.md invariants #1/#8): Astryum builds the unsigned
 * calldata, forwards it to the user's OWN connected wallet via
 * useWalletPartner.sendIntentCalls, and reports the hash back so the backend
 * FSM can advance. Astryum never signs, never broadcasts, never custodies.
 * `dismiss` only cancels a not-yet-signed intent.
 *
 * SETTLEMENT: `submitted` is reported to the backend ONLY once the settlement
 * machine confirms the operation on-chain (real receipt / 5792 status) — the
 * old flow persisted 'submitted' with an unconfirmed 5792 bundle id. While the
 * machine watches, `signingId` stays set (no double-sign) and `settling`
 * exposes pending | stalled | failed for the UI.
 *
 * `onChanged(intentId)` fires after a CONFIRMED sign OR a dismiss so the caller
 * can re-poll / optimistically drop the intent it just acted on.
 */

import { useState } from 'react';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import type { SettlementState } from '../../lib/settlement/settlement';
import { intentsApi, type PreparedIntent } from '../../services/v1Api';

export interface IntentSigning {
  evm: ReturnType<typeof useWalletPartner>;
  /** id of the intent being signed OR still settling (blocks a second sign). */
  signingId: string | null;
  /** id of the intent currently being dismissed, or null. */
  busyId: string | null;
  actionError: string | null;
  /** set ONLY after real on-chain confirmation (settlement machine). */
  lastSigned: { id: string; txHash: string } | null;
  /** live settlement state of the signed intent (pending/stalled/…), or null. */
  settling: SettlementState | null;
  clearError: () => void;
  sign: (intent: PreparedIntent) => Promise<void>;
  dismiss: (intent: PreparedIntent) => Promise<void>;
}

export function useIntentSigning(
  onChanged?: (intentId: string) => void | Promise<void>,
): IntentSigning {
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const [signingId, setSigningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSigned, setLastSigned] = useState<{ id: string; txHash: string } | null>(null);

  async function sign(intent: PreparedIntent) {
    if (!intent.txData) return;
    setActionError(null);
    if (!evm.isConnected) {
      evm.openConnect();
      return;
    }
    setSigningId(intent.id);
    try {
      const txData = intent.txData;
      const prereqs = (intent.preState.prerequisiteCalls ?? []).map((c) => ({
        to: c.to,
        data: c.data,
        value: c.value,
        chainId: c.chainId,
      }));
      const calls = [
        ...prereqs,
        { to: txData.to, data: txData.data, value: String(txData.value ?? '0'), chainId: txData.chainId },
      ];
      const { handle } = await evm.sendIntentCalls(calls);
      // The backend FSM only ever hears about CONFIRMED submissions — the ref
      // reported is a real tx hash (5792 refs upgrade on confirmation).
      const confirm = async (ref: string) => {
        await intentsApi.submitted(intent.id, ref);
        setLastSigned({ id: intent.id, txHash: ref });
        await onChanged?.(intent.id);
      };
      if (handle.status === 'settled') {
        await confirm(handle.ref);
        setSigningId(null);
      } else {
        settlement.track(handle, {
          onSettled: (s) => {
            void confirm(s.ref)
              .catch((e) => setActionError((e as Error).message ?? String(e)))
              .finally(() => setSigningId(null));
          },
          onFailed: (reason) => {
            setActionError(reason ?? 'la operación firmada falló on-chain');
            setSigningId(null);
          },
        });
      }
    } catch (e) {
      setActionError((e as Error).message ?? String(e));
      setSigningId(null);
    }
  }

  async function dismiss(intent: PreparedIntent) {
    setBusyId(intent.id);
    setActionError(null);
    try {
      await intentsApi.cancel(intent.id);
      await onChanged?.(intent.id);
    } catch (e) {
      setActionError((e as Error).message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  return {
    evm,
    signingId,
    busyId,
    actionError,
    lastSigned,
    settling: settlement.state,
    clearError: () => setActionError(null),
    sign,
    dismiss,
  };
}

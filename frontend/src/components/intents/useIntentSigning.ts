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
 * UNCONFIRMED (unearned-success family, 13-sep): an error AFTER the calls
 * reached the wallet (RECEIPT_UNREAD, a dropped RPC…) used to clear
 * `signingId` and hand the sign button back — a second signature of an
 * intent that may already be on-chain. Such an intent is now BLOCKED for the
 * life of this hook (`isBlocked`), and `unconfirmed` carries the amber panel.
 * The same block applies when the operation settled on-chain but recording it
 * in the backend failed: the intent still reads as waiting, and signing it
 * again would execute it twice.
 *
 * `onChanged(intentId)` fires after a CONFIRMED sign OR a dismiss so the caller
 * can re-poll / optimistically drop the intent it just acted on.
 */

import { useState } from 'react';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import type { SettlementState } from '../../lib/settlement/settlement';
import { intentsApi, type PreparedIntent } from '../../services/v1Api';
import { translateError } from '../../lib/errors/translateError';
import { settlementReasonText } from '../../lib/settlement/reasonText';
import { signFailureAction, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { useT } from '../../i18n/LanguageProvider';

export interface IntentUnconfirmed extends UnconfirmedSignature {
  /** The intent whose signature could not be followed. */
  id: string;
  /** Chain of the calls, for the explorer link. */
  chainId: number;
}

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
  /** The latest signature we could not follow — render the amber panel. */
  unconfirmed: IntentUnconfirmed | null;
  /** True when this intent may already be on-chain: never offer to sign it. */
  isBlocked: (intentId: string) => boolean;
  /** Hides the amber panel. The intent stays blocked. */
  closeUnconfirmedNotice: () => void;
  clearError: () => void;
  sign: (intent: PreparedIntent) => Promise<void>;
  dismiss: (intent: PreparedIntent) => Promise<void>;
}

export function useIntentSigning(
  onChanged?: (intentId: string) => void | Promise<void>,
): IntentSigning {
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const { t } = useT();
  const [signingId, setSigningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSigned, setLastSigned] = useState<{ id: string; txHash: string } | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<IntentUnconfirmed | null>(null);
  const [blocked, setBlocked] = useState<Record<string, true>>({});
  const block = (id: string) => setBlocked((b) => ({ ...b, [id]: true }));

  async function sign(intent: PreparedIntent) {
    if (!intent.txData) return;
    // Defence in depth: even if a surface forgets to disable the button, an
    // intent that may already be on-chain never reaches the wallet again.
    if (blocked[intent.id]) return;
    setActionError(null);
    if (!evm.isConnected) {
      evm.openConnect();
      return;
    }
    setSigningId(intent.id);
    let handedToPartner = false;
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
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(calls);
      // The backend FSM only ever hears about CONFIRMED submissions — the ref
      // reported is a real tx hash (5792 refs upgrade on confirmation).
      const confirm = async (ref: string) => {
        await intentsApi.submitted(intent.id, ref);
        setLastSigned({ id: intent.id, txHash: ref });
        await onChanged?.(intent.id);
      };
      // On-chain it SETTLED; only the backend record can fail here. The intent
      // then still reads as waiting, so it is blocked instead of re-offered.
      const confirmOrBlock = (ref: string) =>
        confirm(ref).catch(() => {
          block(intent.id);
          setActionError(
            t('The operation settled on-chain, but recording it in Astryum failed. Do not sign this intent again — its receipt is already on the explorer.'),
          );
        });
      if (handle.status === 'settled') {
        await confirmOrBlock(handle.ref);
        setSigningId(null);
      } else {
        settlement.track(handle, {
          onSettled: (s) => {
            void confirmOrBlock(s.ref).finally(() => setSigningId(null));
          },
          onFailed: (reason) => {
            setActionError(
              settlementReasonText(reason, t) ?? t('The signed operation failed on-chain.'),
            );
            setSigningId(null);
          },
        });
      }
    } catch (e) {
      const action = signFailureAction(e, handedToPartner, t);
      if (action.view === 'unconfirmed') {
        // No red error beside the amber panel, and no sign button for this
        // intent again: it may already be on-chain.
        block(intent.id);
        setActionError(null);
        setUnconfirmed({
          id: intent.id,
          chainId: intent.txData?.chainId ?? 14,
          txHash: action.txHash,
          trace: action.trace,
        });
      } else {
        setActionError(action.message);
      }
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
      setActionError(translateError(e, t).message);
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
    unconfirmed,
    isBlocked: (intentId: string) => blocked[intentId] === true,
    closeUnconfirmedNotice: () => setUnconfirmed(null),
    clearError: () => setActionError(null),
    sign,
    dismiss,
  };
}

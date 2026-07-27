'use client';

/**
 * useXrplWalletPartner — XRPL counterpart to useWalletPartner.
 *
 * Wraps the existing XamanWalletService singleton so the unified
 * useSigningSession facade can route XRPL intents alongside EVM and Solana.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0):
 *   The Xaman partner shows the user the unsigned XRPL transaction via QR or
 *   deeplink, the user signs in the Xaman mobile app, and the partner submits
 *   to XRPL. Astryum never holds keys, never signs, never broadcasts.
 */

import { useCallback, useMemo } from 'react';
import { useWalletStore } from '../../stores/walletStore';
import { WalletServiceFactory } from '../../services/wallets/WalletServiceFactory';
import { XamanWalletService, type XRPLTransaction } from '../../services/wallets/XamanWalletService';
import type { WalletAccount } from '../../lib/types/wallet';

export interface XrplIntentTx {
  /**
   * XRPL transaction in canonical XRPL JSON shape — built by the Astryum
   * backend or directly by the user via an XRPL-aware Money Flow node.
   * Account field is auto-injected by XamanWalletService if missing.
   */
  tx: XRPLTransaction;
}

export interface XrplSendIntentResult {
  /** XRPL tx hash (HEX) returned by the partner after broadcast. */
  txHash: string;
}

export function useXrplWalletPartner() {
  // The Xaman service is a singleton managed by WalletServiceFactory. Wallet
  // store carries which wallets are currently connected from the user POV.
  const service = useMemo(
    () => WalletServiceFactory.getWalletService('xaman') as XamanWalletService,
    [],
  );

  // The ACTIVE wallet decides who signs (switcher review 2026-07-17, Fase 0 —
  // the old first-connected pick ignored walletStore.activeWallet and was the
  // wrong-account UX bug). When the active wallet isn't a Xaman account (or
  // nothing was ever picked), fall back to the first connected Xaman wallet.
  const connectedXrp: WalletAccount | undefined = useWalletStore((s) => {
    const active = s.activeWallet;
    if (active?.walletType === 'xaman') {
      const live = s.wallets.find((w) => w.id === active.id && w.isConnected);
      if (live) return live;
    }
    return s.wallets.find((w) => w.isConnected && w.walletType === 'xaman');
  });

  const address = connectedXrp?.address ?? null;
  const isConnected = !!connectedXrp;

  const sendIntent = useCallback(
    async (intent: XrplIntentTx): Promise<XrplSendIntentResult> => {
      if (!isConnected || !address) {
        throw new Error('XRPL_WALLET_PARTNER_NOT_CONNECTED');
      }
      // Pin the signer to THIS hook's active address when the builder didn't —
      // the service respects an explicit Account instead of stomping it.
      const tx = intent.tx.Account ? intent.tx : { ...intent.tx, Account: address };
      // submitTransaction builds the Xaman payload, opens the deeplink/QR, polls
      // for user authorization, then submits to XRPL. Returns the tx hash.
      const txHash = await service.submitTransaction(tx);
      return { txHash };
    },
    [service, isConnected, address],
  );

  return {
    address,
    isConnected,
    sendIntent,
    service, // exposed so callers needing multi-account / signTransaction can drill in
  };
}

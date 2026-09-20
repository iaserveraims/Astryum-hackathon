'use client';

/**
 * useXrplWalletPartner — XRPL counterpart to useWalletPartner.
 *
 * Wraps the existing XamanWalletService singleton so the unified
 * useSigningSession facade can route XRPL intents alongside EVM and Solana.
 *
 * REGULATORY BOUNDARY:
 *   The Xaman partner shows the user the unsigned XRPL transaction via QR or
 *   deeplink, the user signs in the Xaman mobile app, and the partner submits
 *   to XRPL. Astryum never holds keys, never signs, never broadcasts.
 */

import { useCallback, useMemo } from 'react';
import { useWalletStore } from '../../stores/walletStore';
import { WalletServiceFactory } from '../../services/wallets/WalletServiceFactory';
import { XamanWalletService, type XRPLTransaction } from '../../services/wallets/XamanWalletService';
import type { WalletAccount } from '../../lib/types/wallet';
import { accountHasQuorum } from '../xrpl/accountQuorum';
import { paymentMemoHex } from '../xrpl/councilSigning';
import { requestQuorumCeremony } from '../xrpl/quorumCeremonyBus';
import { flareInstructionMemoOf } from '../xaman/liveRequests';
import { serverDeclaredCeremony, serverDeclaredSingleSignature } from './handoffRelease';

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

// The pure rule lives in its own module (small test graph); re-exported here
// so every signing surface imports it next to the partner.
import { pinnedXrplSigner } from './xrplSigner';
export { pinnedXrplSigner };

export function useXrplWalletPartner() {
  // The Xaman service is a singleton managed by WalletServiceFactory. Wallet
  // store carries which wallets are currently connected from the user POV.
  const service = useMemo(
    () => WalletServiceFactory.getWalletService('xaman') as XamanWalletService,
    [],
  );

  // The ACTIVE wallet decides who signs (switcher review, Fase 0 —
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
      // A pinned Account signs without a session (see pinnedXrplSigner); only a
      // payload that needs the connected account as its signer requires one.
      const pinned = pinnedXrplSigner(intent.tx);
      if (!pinned && (!isConnected || !address)) {
        throw new Error('XRPL_WALLET_PARTNER_NOT_CONNECTED');
      }
      // Pin the signer to THIS hook's active address when the builder didn't —
      // the service respects an explicit Account instead of stomping it.
      const tx = pinned ? intent.tx : { ...intent.tx, Account: String(address) };

      // ── EL DESVÍO A LA CEREMONIA ──────────────────
      //
      // Diecisiete superficies llaman aquí — enviar, Kinetic lend, el vault,
      // las posiciones, los moneyflows — y todas terminaban en un payload de
      // Xaman con `multi_sign: false`: un QR, una firma. Sobre una cuenta
      // reforzada eso no vale NUNCA: esa firma no cuenta para el quórum y, con
      // la llave maestra apagada, la red la rechaza sin más.
      const signerAccount = String(tx.Account ?? address);
      const memoHex = paymentMemoHex(tx);
      if (serverDeclaredCeremony(memoHex)) {
        const txHash = await requestQuorumCeremony(tx as Record<string, unknown>, signerAccount);
        return { txHash };
      }
      // ── Y EL OTRO VEREDICTO DEL SERVIDOR… QUE NO LO ERA ─────
      //
      // Wrote here that «a row the server composed with a SINGLE
      // signature's window is a row it read this account for and found no quorum
      // on», and on that sentence skipped the browser's own read. The sentence is
      // FALSE: `signingCeremonyFor` answers the ordinary window for a read that
      // said 'single' AND for one that failed (a 6 s SignerList timeout, an
      // exception, an operational account). So a quorum account whose SignerList
      // the server could not read got a single-signature payload with Xaman's
      // autofilled Sequence — the twin, and removed the check that caught
      // it.
      const serverSaysSingle = serverDeclaredSingleSignature(memoHex);
      const hasQuorum = serverSaysSingle ? false : await accountHasQuorum(signerAccount);
      if (hasQuorum === true) {
        const txHash = await requestQuorumCeremony(tx as Record<string, unknown>, signerAccount);
        return { txHash };
      }
      // ── «NO PUDE LEER» YA NO SE FIRMA COMO SI FUERA UN «NO» ──
      //
      // WHAT FAILED IN SILENCE: `null` fell straight through to
      // `service.submitTransaction`, where Xaman AUTOFILLS the `Sequence`. That
      // is the one shape in which two Payments of the same account both reach the
      // ledger — the twin — and it is reachable from a plain F5 (the row's window
      // lived only in a module Map until §5 wrote it down) plus one sick public
      // node. The seat rail spends its whole existence refusing to invent a fact;
      // this line invented the most expensive one available.
      if (hasQuorum === null && flareInstructionMemoOf(tx) !== null) {
        throw new Error(
          'We could not read whether this account signs by quorum — no XRPL node answered — and this payment carries ' +
            'a nonce seat. Signing it with a Sequence filled in for us could put two payments on the same seat, so ' +
            'nothing was signed. Try again in a moment.',
        );
      }

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

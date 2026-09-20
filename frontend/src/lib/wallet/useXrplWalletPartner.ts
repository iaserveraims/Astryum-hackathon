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
      // A pinned Account signs without a session (see pinnedXrplSigner); only a
      // payload that needs the connected account as its signer requires one.
      const pinned = pinnedXrplSigner(intent.tx);
      if (!pinned && (!isConnected || !address)) {
        throw new Error('XRPL_WALLET_PARTNER_NOT_CONNECTED');
      }
      // Pin the signer to THIS hook's active address when the builder didn't —
      // the service respects an explicit Account instead of stomping it.
      const tx = pinned ? intent.tx : { ...intent.tx, Account: String(address) };

      // ── EL DESVÍO A LA CEREMONIA (fundador, 22-ago-2026) ──────────────────
      //
      // Diecisiete superficies llaman aquí — enviar, Kinetic lend, el vault,
      // las posiciones, los moneyflows — y todas terminaban en un payload de
      // Xaman con `multi_sign: false`: un QR, una firma. Sobre una cuenta
      // reforzada eso no vale NUNCA: esa firma no cuenta para el quórum y, con
      // la llave maestra apagada, la red la rechaza sin más.
      //
      // Arreglar la pantalla en la que uno se tropieza es cómo se acaba con
      // diecisiete copias que se desincronizan (y con tres intentos fallidos
      // antes de este). El desvío vive AQUÍ, en el cuello de botella: quien
      // llama sigue escribiendo `await sendIntent(...)` y no se entera.
      //
      // Lo decide la CADENA, leída justo antes de firmar. Una lectura fallida
      // (`null`) sigue por el camino de siempre: bloquear todas las firmas de
      // la casa porque un nodo público no contesta sería peor que el fallo que
      // esto arregla.
      //
      // ── it. 27 (§4) — Y CUÁL DE LAS DOS LECTURAS MANDA ────────────────────
      //
      // Hay DOS lecturas del mismo SignerList: la del backend
      // (`signingCeremonyFor`, que compone el 0xFE y, con él, la
      // `LastLedgerSequence` que va DENTRO de los bytes firmados) y la de
      // `accountQuorum.ts` — un RPC público cacheado 60 s. Pueden discrepar, y la
      // dirección que hace daño es silenciosa: el servidor compone un dispatch de
      // 24 h, la lectura del navegador falla (`null`), esta función sigue por el
      // camino de siempre y Xaman AUTORRELLENA la `Sequence`. Ahí es donde dos
      // Payments de la misma cuenta pueden entrar los dos — el gemelo.
      //
      // Manda la del servidor, porque es la que ya dio forma a los bytes: si la
      // respuesta que compuso ESTOS bytes declaró ceremonia, se va a la ceremonia
      // aunque el nodo público no conteste. El silencio no es un veredicto, así
      // que la lectura del navegador sigue siendo el respaldo para una
      // transacción que el servidor no compuso (una constitución, un envío suelto).
      const signerAccount = String(tx.Account ?? address);
      const memoHex = paymentMemoHex(tx);
      if (serverDeclaredCeremony(memoHex)) {
        const txHash = await requestQuorumCeremony(tx as Record<string, unknown>, signerAccount);
        return { txHash };
      }
      // ── it. 29 (§5) — Y EL OTRO VEREDICTO DEL SERVIDOR… QUE NO LO ERA ─────
      //
      // it. 29 wrote here that «a row the server composed with a SINGLE
      // signature's window is a row it read this account for and found no quorum
      // on», and on that sentence skipped the browser's own read. The sentence is
      // FALSE: `signingCeremonyFor` answers the ordinary window for a read that
      // said 'single' AND for one that failed (a 6 s SignerList timeout, an
      // exception, an operational account). So a quorum account whose SignerList
      // the server could not read got a single-signature payload with Xaman's
      // autofilled Sequence — the twin, and it. 29 removed the check that caught
      // it.
      //
      // it. 31 (§5): the server now DECLARES whether it read (`signerListRead`,
      // learnt per row by `notePayloadExpiryMin`), and `serverDeclaredSingleSignature`
      // is true only for a row whose answer said `'single'` — a reading. With
      // `'unknown'`, or no field at all, the browser's read decides again, as it
      // did before it. 29. A server that could not read hands the question back;
      // it never answers it.
      const serverSaysSingle = serverDeclaredSingleSignature(memoHex);
      const hasQuorum = serverSaysSingle ? false : await accountHasQuorum(signerAccount);
      if (hasQuorum === true) {
        const txHash = await requestQuorumCeremony(tx as Record<string, unknown>, signerAccount);
        return { txHash };
      }
      // ── it. 29 (§5) — «NO PUDE LEER» YA NO SE FIRMA COMO SI FUERA UN «NO» ──
      //
      // WHAT FAILED IN SILENCE: `null` fell straight through to
      // `service.submitTransaction`, where Xaman AUTOFILLS the `Sequence`. That
      // is the one shape in which two Payments of the same account both reach the
      // ledger — the twin — and it is reachable from a plain F5 (the row's window
      // lived only in a module Map until §5 wrote it down) plus one sick public
      // node. The seat rail spends its whole existence refusing to invent a fact;
      // this line invented the most expensive one available.
      //
      // WHAT IS REFUSED, AND WHAT IS NOT. Only a dispatch that HOLDS A NONCE SEAT
      // (a 0xFE: it carries a memo) and that the server never spoke about. An
      // ordinary send, a trustline, a constitution — anything with no seat to
      // contest — signs exactly as before, because an autofilled Sequence costs
      // nothing there. And the refusal is RETRYABLE and says so: every node we
      // know of has to fail for it to fire at all (`accountQuorum`, §5), so this
      // is «the chain is unreachable», not a door we closed. Nothing is signed,
      // nothing is pinned, nothing is lost — which is the opposite of a twin,
      // where the client is debited and gets zero shares. «No pude leer» no es
      // permiso: no es un «sí», y tampoco es una cárcel, porque termina solo.
      // it. 31 (§6): only a 0xFE holds a nonce seat. `paymentMemoHex` accepts any
      // 8–2048 hex memo because that is what the release route names a seat by;
      // a proof-by-memo, a KYC tag or any other memo'd Payment contests no seat,
      // and refusing it over an unreadable SignerList would gate a send that an
      // autofilled Sequence cannot hurt.
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

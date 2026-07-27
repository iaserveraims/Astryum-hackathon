'use client';

/**
 * useUniversalConnect — one entry point to connect a wallet on ANY chain and
 * register it (read-only) in the user's account so it shows up in the Wallets
 * tab and aggregates in the portfolio.
 *
 * Two connection surfaces, unified here:
 *   - AppKit (EVM + Solana + Bitcoin): one modal, persisted via the connected
 *     account hooks / banners in the Wallets page.
 *   - Native partners (XRPL=Xaman, Aptos=Petra, Stellar=Freighter): connected
 *     through their own SDK/service, then persisted here.
 *
 * REGULATORY (CLAUDE.md §0): connecting is READ-ONLY. It never authorizes a
 * transaction and never broadcasts. Signing stays in the user's wallet.
 */

import { useCallback, useState } from 'react';
import { getAppKitModal } from './appkit';
import { walletService } from '../../services/walletService';
import { connectWallet as persistWallet } from '../../services/walletLinkService';
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getAddress as freighterGetAddress,
} from '@stellar/freighter-api';

export type ConnectableEcosystem = 'xrpl' | 'aptos' | 'stellar';

interface PersistArgs {
  address: string;
  ecosystem: 'xrpl' | 'aptos' | 'stellar';
  network: string;
  caip2: string;
  walletType: string;
}

async function persist({ address, ecosystem, network, caip2, walletType }: PersistArgs): Promise<void> {
  await persistWallet({
    address,
    walletType,
    network,
    caip2,
    ecosystem,
    purpose: 'watch',
  });
}

export function useUniversalConnect(refresh: () => Promise<void> | void) {
  const [busy, setBusy] = useState<ConnectableEcosystem | 'appkit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** EVM + Solana + Bitcoin share the AppKit modal. */
  const openAppKit = useCallback(() => {
    setError(null);
    setBusy('appkit');
    try {
      getAppKitModal().open();
    } finally {
      setBusy(null);
    }
  }, []);

  /** XRPL via Xaman (deeplink/QR). Updates walletStore so signing sees it too. */
  const connectXrpl = useCallback(async () => {
    setError(null);
    setBusy('xrpl');
    try {
      const account = await walletService.connectWallet('xaman');
      if (!account?.address) throw new Error('XAMAN_CONNECT_FAILED');
      await persist({
        address: account.address,
        ecosystem: 'xrpl',
        network: 'xrpl',
        caip2: 'xrpl:mainnet',
        walletType: 'Xaman',
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /** Aptos via Petra. Updates walletStore so signing sees it too. */
  const connectAptos = useCallback(async () => {
    setError(null);
    setBusy('aptos');
    try {
      const account = await walletService.connectWallet('petra');
      if (!account?.address) throw new Error('PETRA_CONNECT_FAILED');
      await persist({
        address: account.address,
        ecosystem: 'aptos',
        network: 'aptos',
        caip2: 'aptos:mainnet',
        walletType: 'Petra',
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /** Stellar via Freighter (used directly by the signing hook). */
  const connectStellar = useCallback(async () => {
    setError(null);
    setBusy('stellar');
    try {
      let address: string | undefined;
      const conn = await freighterIsConnected().catch(() => null);
      if (conn?.isConnected) {
        const got = await freighterGetAddress().catch(() => null);
        if (got?.address && !got.error) address = got.address;
      }
      if (!address) {
        const res = await freighterRequestAccess();
        if (res?.error || !res?.address) throw new Error(res?.error || 'FREIGHTER_ACCESS_DENIED');
        address = res.address;
      }
      await persist({
        address,
        ecosystem: 'stellar',
        network: 'stellar',
        caip2: 'stellar:pubnet',
        walletType: 'Freighter',
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return { busy, error, openAppKit, connectXrpl, connectAptos, connectStellar };
}

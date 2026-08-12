'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FLARE_CHAIN_ID,
  FLARE_CHAIN_ID_HEX,
  FLARE_ADD_CHAIN_PARAMS,
  isUserRejection,
  isUnrecognizedChain,
} from './flareChain';

/**
 * Shared engine behind every "Switch to Flare" surface — the global
 * NetworkSwitcher banner and the active wallet's card in WalletManager both
 * consume THIS hook, so the switch/add flow and its failure contract live in
 * exactly one place.
 *
 * Failure contract: a rejection (4001) is a choice → `declined`, CTA stays; a
 * wallet that can't do it → `manualNeeded` (caller shows Chainlist/manual
 * data). Raw wallet error text never leaves this hook.
 */
export interface FlareSwitch {
  /** Live chainId of the injected provider (null = unknown / no wallet). */
  chainId: number | null;
  /** The site has an APPROVED EVM connection (eth_accounts non-empty). */
  connected: boolean;
  /** connected AND live network ≠ Flare — the only state where a CTA belongs. */
  wrongNetwork: boolean;
  switching: boolean;
  declined: boolean;
  manualNeeded: boolean;
  switchToFlare: () => Promise<void>;
}

export function useSwitchToFlare(): FlareSwitch {
  const [chainId, setChainId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [manualNeeded, setManualNeeded] = useState(false);

  const refresh = useCallback(async () => {
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth) return;
    try {
      const [hex, accounts] = await Promise.all([
        eth.request({ method: 'eth_chainId' }) as Promise<string>,
        eth.request({ method: 'eth_accounts' }) as Promise<string[]>,
      ]);
      setChainId(parseInt(hex, 16));
      setConnected(Array.isArray(accounts) && accounts.length > 0);
    } catch {
      setChainId(null);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth?.on) return;
    const handler = () => {
      setDeclined(false);
      refresh();
    };
    eth.on('chainChanged', handler);
    eth.on('accountsChanged', handler);
    return () => {
      eth.removeListener?.('chainChanged', handler);
      eth.removeListener?.('accountsChanged', handler);
    };
  }, [refresh]);

  const switchToFlare = useCallback(async () => {
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth) return;
    setSwitching(true);
    setDeclined(false);
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: FLARE_CHAIN_ID_HEX }],
      });
    } catch (err: unknown) {
      if (isUserRejection(err)) {
        setDeclined(true);
      } else if (isUnrecognizedChain(err)) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [FLARE_ADD_CHAIN_PARAMS],
          });
        } catch (addErr: unknown) {
          if (isUserRejection(addErr)) setDeclined(true);
          else setManualNeeded(true);
        }
      } else {
        // Method unsupported or anything unexpected → honest manual fallback.
        setManualNeeded(true);
      }
    } finally {
      setSwitching(false);
      refresh();
    }
  }, [refresh]);

  return {
    chainId,
    connected,
    wrongNetwork: connected && chainId !== null && chainId !== FLARE_CHAIN_ID,
    switching,
    declined,
    manualNeeded,
    switchToFlare,
  };
}

'use client';

import { useEffect, useState, useCallback } from 'react';

const FLARE_CHAIN_ID = 14;
const FLARE_CHAIN_HEX = '0xe'; // 14
const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const FLARE_EXPLORER = 'https://flarescan.com';

/**
 * V1 FINAL Flare-only enforcer.
 *
 * If user's wallet is connected to a chain other than Flare Mainnet, render a
 * banner with a "Switch to Flare" button. Calls wallet_switchEthereumChain or
 * wallet_addEthereumChain (4902) as fallback.
 *
 * V1 explicitly disallows: Songbird, Coston2, Ethereum, Solana, anything ≠ 14.
 */
export function NetworkSwitcher() {
  const [chainId, setChainId] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshChain = useCallback(async () => {
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth) return;
    try {
      const hex: string = await eth.request({ method: 'eth_chainId' });
      setChainId(parseInt(hex, 16));
    } catch {
      setChainId(null);
    }
  }, []);

  useEffect(() => {
    refreshChain();
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth?.on) return;
    const handler = () => refreshChain();
    eth.on('chainChanged', handler);
    eth.on('accountsChanged', handler);
    return () => {
      eth.removeListener?.('chainChanged', handler);
      eth.removeListener?.('accountsChanged', handler);
    };
  }, [refreshChain]);

  const switchToFlare = useCallback(async () => {
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
    if (!eth) {
      setError('No EVM wallet detected');
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: FLARE_CHAIN_HEX }],
      });
    } catch (err: any) {
      // 4902 = chain not added → try to add it
      if (err?.code === 4902) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: FLARE_CHAIN_HEX,
                chainName: 'Flare Mainnet',
                nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 },
                rpcUrls: [FLARE_RPC],
                blockExplorerUrls: [FLARE_EXPLORER],
              },
            ],
          });
        } catch (addErr: any) {
          setError(addErr?.message ?? 'Failed to add Flare network');
        }
      } else {
        setError(err?.message ?? 'Failed to switch network');
      }
    } finally {
      setSwitching(false);
      refreshChain();
    }
  }, [refreshChain]);

  // Hide entirely when on the right chain or wallet not connected.
  if (chainId === null || chainId === FLARE_CHAIN_ID) return null;

  return (
    <div className="w-full bg-red-950 border-b border-red-500/60 text-red-100 text-sm py-2 px-4 flex items-center justify-between font-mono">
      <span>
        Wrong network for this action — Astryum needs Flare Mainnet here. Switch network to continue.
      </span>
      <button
        onClick={switchToFlare}
        disabled={switching}
        className="ml-4 px-3 py-1 rounded bg-red-100 text-red-950 font-medium hover:bg-white disabled:opacity-50"
      >
        {switching ? 'Switching…' : 'Switch to Flare'}
      </button>
      {error && <span className="ml-3 text-xs text-red-200">{error}</span>}
    </div>
  );
}

export default NetworkSwitcher;

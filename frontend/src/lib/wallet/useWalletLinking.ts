'use client';

/**
 * useWalletLinking — orchestrates the Wallets tab.
 *
 * Bridges the wallet partner layer (wagmi/AppKit) with the unified backend:
 *
 *   1. LOGIN / CONNECT  → register the wallet READ-ONLY (purpose 'watch').
 *                         Repeatable: connect many wallets, even several from
 *                         the same provider (switch account → add again).
 *   2. ENABLE TX        → user explicitly signs an ownership-proof message
 *                         (personal_sign, NOT a transaction). Backend verifies
 *                         and records a read_and_receive binding, upgrading the
 *                         wallet to tx-capable.
 *
 * REGULATORY: this hook never broadcasts and never auto-signs. Logging in only
 * reads an address; transactions require the separate, explicit binding step.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useChainId, useSignMessage, useDisconnect } from 'wagmi';
import { getAppKitModal } from './appkit';
import {
  listMyWallets,
  connectWallet,
  updateWallet,
  removeWallet,
  initiateBinding,
  confirmBinding,
  setBindingMode,
  type BackendWallet,
} from '../../services/walletLinkService';
import { WalletServiceFactory } from '../../services/wallets/WalletServiceFactory';
import type { XamanWalletService } from '../../services/wallets/XamanWalletService';
import { useAuthStore } from '../../stores/authStore';

/** XRPL classic address shape (case-sensitive base58, starts with `r`). */
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/**
 * Removed-wallet memory. MetaMask shares every permitted account on each
 * connection — including the empty "Smart Account" it now auto-creates — so a
 * wallet the user deleted reappeared silently on the next "Add wallet".
 * Deleting a wallet records its address here; passively-shared accounts on the
 * list are skipped at registration. Actively selecting the account in the
 * wallet app (it becomes the connected address) or watch-adding it by hand
 * expresses fresh intent and clears the mark.
 */
const REMOVED_ADDRESSES_KEY = 'astryum-removed-wallet-addresses';

/** EVM addresses compare lower-cased; XRPL base58 stays case-sensitive. */
function removalKey(address: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
}

function removedAddresses(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(REMOVED_ADDRESSES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistRemovedAddresses(set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMOVED_ADDRESSES_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — removal simply won't stick across reconnects */
  }
}

function markAddressRemoved(address: string): void {
  const set = removedAddresses();
  set.add(removalKey(address));
  persistRemovedAddresses(set);
}

function unmarkAddressRemoved(address: string): void {
  const set = removedAddresses();
  if (set.delete(removalKey(address))) persistRemovedAddresses(set);
}

const CHAIN_LABEL: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  8453: 'base',
  137: 'polygon',
  43114: 'avalanche',
  10: 'optimism',
  56: 'bsc',
  14: 'flare',
};

function networkLabel(chainId?: number): string {
  return (chainId && CHAIN_LABEL[chainId]) || (chainId ? `eip155:${chainId}` : 'evm');
}

/**
 * Collapse duplicate rows for the same wallet. The backend list can carry the
 * same address more than once (a watch row plus a tx binding, or a stale dupe),
 * which surfaced as "Xaman listed twice". Key by address (EVM lower-cased, other
 * ecosystems kept case-sensitive) + chain, keeping the more capable (tx-authorized)
 * row so we never drop signing capability.
 */
function dedupeWallets(list: BackendWallet[]): BackendWallet[] {
  const byKey = new Map<string, BackendWallet>();
  for (const w of list) {
    const addrKey = /^0x[0-9a-fA-F]{40}$/.test(w.address) ? w.address.toLowerCase() : w.address;
    const key = `${addrKey}:${w.chainId ?? ''}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      (!existing.txAuthorized && w.txAuthorized) ||
      // Same capability → prefer the row carrying the user's nickname, so a
      // stale duplicate (old build, different `network` label) can't shadow
      // the renamed wallet with the raw address.
      (existing.txAuthorized === w.txAuthorized && !existing.nickname && !!w.nickname)
    ) {
      byKey.set(key, w);
    }
  }
  return Array.from(byKey.values());
}

export interface UseWalletLinkingResult {
  wallets: BackendWallet[];
  loading: boolean;
  error: string | null;
  /** Currently connected wallet partner account (wagmi), or null. */
  connectedAddress: string | null;
  isConnected: boolean;
  chainId: number;
  connectorName: string | null;
  /** Open the AppKit modal to connect / switch a wallet partner. */
  openConnect: () => void;
  /** Release the active wallet partner session so the picker resets. */
  disconnect: () => Promise<void>;
  /** Re-fetch the backend wallet list. */
  refresh: () => Promise<void>;
  /** Register the currently-connected wagmi account as read-only. */
  registerConnected: () => Promise<void>;
  /** Register the connected account read-only, then release it (add-many flow). */
  addConnected: () => Promise<void>;
  /**
   * Add a watch-only / delivery address by hand (no signing). XRPL classic
   * addresses (r…) register under the XRPL ecosystem; anything else registers
   * as EVM on `chainId`.
   */
  watchAddress: (address: string, chainId: number, label?: string) => Promise<void>;
  /** Sign the ownership proof for `address` and upgrade it to tx-capable. */
  enableTransactions: (address: string) => Promise<void>;
  /** Revoke tx capability (binding → read). */
  disableTransactions: (bindingId: string) => Promise<void>;
  /** Rename a wallet (nickname). */
  rename: (id: string, nickname: string) => Promise<void>;
  /** Make a wallet the primary for its ecosystem (tx-enabled only). */
  setPrimary: (id: string) => Promise<void>;
  /** Remove a wallet from the list. */
  remove: (id: string) => Promise<void>;
  /** Toggle whether the wallet counts in the dashboard's monetary totals. */
  setIncludeInPortfolio: (id: string, included: boolean) => Promise<void>;
}

export function useWalletLinking(enabled: boolean): UseWalletLinkingResult {
  const { address, addresses, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnectAsync } = useDisconnect();

  const [wallets, setWallets] = useState<BackendWallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const list = dedupeWallets(await listMyWallets());
      setWallets(list);
      // Mirror a linked wallet into authStore so the rest of the dashboard recognises
      // the connection (not only SIWE logins). Uses the same /wallets/mine list shown
      // here, then refreshes the /auth/me aggregate. Never overrides a SIWE address;
      // prefers an EVM (0x) wallet since user.address is consumed as an EVM address.
      const auth = useAuthStore.getState();
      if (auth.user && !auth.user.address && list.length > 0) {
        const isEvm = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
        const primary = list.find((w) => isEvm(w.address)) ?? list[0];
        if (primary?.address) {
          auth.setUser({
            ...auth.user,
            address: primary.address,
            username:
              auth.user.username ||
              `${primary.address.slice(0, 6)}…${primary.address.slice(-4)}`,
          });
        }
      }
      void auth.refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openConnect = useCallback(() => {
    // Always the wallet PICKER. A plain open() with a live session lands on
    // the Account view, hiding the wallet list + WalletConnect QR — which made
    // it impossible to reach the QR while the desktop extension was connected.
    getAppKitModal().open({ view: 'Connect' });
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch {
      /* already disconnected — ignore */
    }
  }, [disconnectAsync]);

  const registerConnected = useCallback(async () => {
    if (!address) {
      openConnect();
      return;
    }
    const addr = address.toLowerCase();
    // The ACTIVE account is explicit intent — registering it always clears any
    // earlier deletion mark, so re-adding a removed wallet stays one click away.
    unmarkAddressRemoved(addr);
    // 1. Make the wallet(s) appear in the list (read layer). A wallet app can
    // share more than one account in a single connection (MetaMask "connected
    // accounts"); register every shared account read-only so the whole set
    // shows up and aggregates in the portfolio — not just the active one.
    // Exception: accounts the user deleted from the list stay out unless they
    // are the active account (see removed-wallet memory above).
    const removed = removedAddresses();
    const sharedAddresses = (addresses && addresses.length > 0 ? addresses : [address])
      .map((a) => a.toLowerCase())
      .filter((a) => a === addr || !removed.has(a));
    for (const shared of sharedAddresses) {
      await connectWallet({
        address: shared,
        walletType: connector?.name ?? 'EVM Wallet',
        network: networkLabel(chainId),
        chainId,
        caip2: `eip155:${chainId}`,
        ecosystem: 'evm',
        purpose: 'watch',
      });
    }
    await refresh();
    // 2. One signature → read + write. The per-transaction confirmation in the
    // user's own wallet remains the execution gate. If the user declines the
    // ownership proof, the wallet stays read-only and the "Enable transactions"
    // button is the fallback to authorize it later.
    try {
      const { nonce, message } = await initiateBinding(addr, 'evm');
      const signature = await signMessageAsync({ message });
      await confirmBinding({
        nonce,
        message,
        signature,
        address: addr,
        chainType: 'evm',
        mode: 'read_and_receive',
      });
      await refresh();
    } catch {
      /* declined — stays read-only, can be enabled later */
    }
  }, [address, addresses, connector, chainId, openConnect, refresh, signMessageAsync]);

  // Add-many flow: persist the connected account read-only, then release the
  // session so the AppKit picker resets and ANY wallet can be chosen next.
  // wagmi/AppKit only keeps one live connection, so the backend (not the live
  // session) is the source of truth for "my wallets".
  const addConnected = useCallback(async () => {
    await registerConnected();
    await disconnect();
  }, [registerConnected, disconnect]);

  const watchAddress = useCallback(
    async (addr: string, cid: number, label?: string) => {
      const trimmed = addr.trim();
      // Hand-adding an address is explicit intent — lift any deletion mark.
      unmarkAddressRemoved(trimmed);
      if (XRPL_ADDRESS_RE.test(trimmed)) {
        // XRPL classic addresses are base58 (case-sensitive): keep the case
        // and register under the XRPL ecosystem — no EVM chainId applies.
        await connectWallet({
          address: trimmed,
          walletType: 'manual',
          network: 'xrpl',
          caip2: 'xrpl:mainnet',
          ecosystem: 'xrpl',
          purpose: 'watch',
          nickname: label,
        });
      } else {
        await connectWallet({
          address: trimmed.toLowerCase(),
          walletType: 'manual',
          network: networkLabel(cid),
          chainId: cid,
          caip2: `eip155:${cid}`,
          ecosystem: 'evm',
          purpose: 'watch',
          nickname: label,
        });
      }
      await refresh();
    },
    [refresh],
  );

  const enableTransactions = useCallback(
    async (target: string) => {
      // XRPL addresses are case-sensitive and never reach wagmi — route them
      // through Xaman (QR / deeplink ownership proof) instead of the EVM modal.
      const known = wallets.find(
        (w) => w.address === target || w.address.toLowerCase() === target.toLowerCase(),
      );
      const isXrpl = known?.ecosystem === 'xrpl' || XRPL_ADDRESS_RE.test(target);

      if (isXrpl) {
        // Keep XRPL case intact (base58 is case-sensitive).
        const { nonce, message } = await initiateBinding(target, 'xrpl');
        const xaman = WalletServiceFactory.getWalletService('xaman') as XamanWalletService;
        // Surfaces the QR + "open in Xaman" deeplink via the payload bus; the user
        // signs the ownership proof in their app. Astryum never signs.
        const { signedTxHex } = await xaman.signOwnershipProof(target, message);
        await confirmBinding({
          nonce,
          message,
          signedTxHex,
          address: target,
          chainType: 'xrpl',
          mode: 'read_and_receive',
        });
        await refresh();
        return;
      }

      // EVM — ownership proof can only be produced by the active wallet partner account.
      const targetLc = target.toLowerCase();
      if (!isConnected || address?.toLowerCase() !== targetLc) {
        openConnect();
        throw new Error(
          'Connect (or switch to) this exact wallet in your wallet app, then press "Enable transactions" again.',
        );
      }
      const { nonce, message } = await initiateBinding(targetLc, 'evm');
      const signature = await signMessageAsync({ message });
      await confirmBinding({
        nonce,
        message,
        signature,
        address: targetLc,
        chainType: 'evm',
        mode: 'read_and_receive',
      });
      await refresh();
    },
    [wallets, address, isConnected, signMessageAsync, openConnect, refresh],
  );

  const disableTransactions = useCallback(
    async (bindingId: string) => {
      await setBindingMode(bindingId, 'read');
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, nickname: string) => {
      await updateWallet(id, { nickname });
      await refresh();
    },
    [refresh],
  );

  const setPrimary = useCallback(
    async (id: string) => {
      await updateWallet(id, { isPrimary: true });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      // Remember the address BEFORE deleting, so the next wallet-app connection
      // (which re-shares every permitted account) doesn't resurrect this row.
      const target = wallets.find((w) => w.id === id);
      if (target) markAddressRemoved(target.address);
      await removeWallet(id);
      await refresh();
    },
    [wallets, refresh],
  );

  const setIncludeInPortfolio = useCallback(
    async (id: string, included: boolean) => {
      await updateWallet(id, { includeInPortfolio: included });
      await refresh();
    },
    [refresh],
  );

  return {
    wallets,
    loading,
    error,
    connectedAddress: address ?? null,
    isConnected,
    chainId,
    connectorName: connector?.name ?? null,
    openConnect,
    disconnect,
    refresh,
    registerConnected,
    addConnected,
    watchAddress,
    enableTransactions,
    disableTransactions,
    rename,
    setPrimary,
    remove,
    setIncludeInPortfolio,
  };
}

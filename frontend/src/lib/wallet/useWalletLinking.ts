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
import { useAccount, useChainId, useConnect, useSignMessage, useDisconnect } from 'wagmi';
import type { Connector } from 'wagmi';
import { getAppKitModal } from './appkit';
import {
  FLARE_CHAIN_ID,
  ensureFlareNetwork,
  injectedProvider,
  isUserRejection,
} from './flareChain';
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
import { isAutoNickname } from '../walletIdentity';
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

/**
 * Whether the user deleted this address from their wallet list. Every path that
 * re-registers a wallet on its own (not from an explicit click) MUST ask first —
 * otherwise the trash button is a no-op the user has to keep pressing.
 */
export function isAddressRemoved(address: string): boolean {
  return removedAddresses().has(removalKey(address));
}

/**
 * The MetaMask connector among the ones wagmi discovered.
 *
 * EIP-6963 announces it as `io.metamask`; older/edge builds surface it through
 * the generic `injected` connector, which we accept ONLY when the injected
 * provider itself claims to be MetaMask — otherwise "Browser Wallet" would let
 * any other extension in through the back door.
 */
function findMetaMaskConnector(connectors: readonly Connector[]): Connector | null {
  const eth = injectedProvider();
  const injectedIsMetaMask = Boolean(eth?.isMetaMask);
  return (
    connectors.find((c) => c.id === 'io.metamask') ??
    connectors.find((c) => /metamask/i.test(c.id) || /metamask/i.test(c.name ?? '')) ??
    (injectedIsMetaMask ? connectors.find((c) => c.id === 'injected') : undefined) ??
    null
  );
}

/** Prose for the Flare switch when the user is LINKING a wallet (not signing in). */
const LINK_FLARE_MESSAGES = {
  declined:
    'Linking a wallet needs Flare Mainnet and the switch was declined in MetaMask. Nothing was added — try again whenever you like.',
  failed: (detail: string) => `Could not put MetaMask on Flare Mainnet: ${detail}`,
};

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
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(w.address);
    const addrKey = isEvm ? w.address.toLowerCase() : w.address;
    // Non-EVM rows collapse across chainId: for the same XRPL address the
    // login writer stamps -1, the connect flow null and the demo 1440002 —
    // all the same ledger. Keeping them apart was exactly the "Xaman here,
    // XRPL 1 there" split (two rows, each surface picking a different one).
    const key = isEvm ? `${addrKey}:${w.chainId ?? ''}` : addrKey;
    const existing = byKey.get(key);
    const preferNew =
      !existing ||
      (!existing.txAuthorized && w.txAuthorized) ||
      // Same capability → prefer the row carrying the user's nickname, so a
      // stale duplicate (old build, different `network` label) can't shadow
      // the renamed wallet with the raw address.
      (existing.txAuthorized === w.txAuthorized && !existing.nickname && !!w.nickname);
    const winner = preferNew ? w : (existing as BackendWallet);
    const loser = preferNew ? existing : w;
    // Capability decides which ROW survives, but the user's identity fields
    // (nickname/colour/glyph — saved on whichever duplicate was visible at
    // the time) must survive the collapse regardless of which row wins.
    byKey.set(
      key,
      loser
        ? {
            ...winner,
            nickname: winner.nickname ?? loser.nickname,
            color: winner.color ?? loser.color,
            icon: winner.icon ?? loser.icon,
          }
        : winner,
    );
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
  /**
   * Connect MetaMask ON Flare Mainnet — the only EVM rail this beta links.
   * Rejects (without linking anything) if MetaMask never lands on chain 14.
   */
  connectMetaMaskFlare: () => Promise<void>;
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
  const { address, addresses, isConnected, connector, chainId: accountChainId } = useAccount();
  const configChainId = useChainId();
  // The LIVE chain of the connection, not the config's default: wagmi's
  // useChainId falls back to the first configured chain, which (now that Flare
  // is the only one) would report 14 for a wallet sitting on Ethereum.
  const chainId = accountChainId ?? configChainId;
  const { connectAsync, connectors } = useConnect();
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
      // Machine-made "<Chain> <n>" nicknames (the retired backend generator)
      // are stripped at ingestion so EVERY consumer — display rule, rename
      // drafts, sort-by-name — sees them as unnamed, not as user identity.
      const list = dedupeWallets(await listMyWallets()).map((w) =>
        isAutoNickname(w.nickname) ? { ...w, nickname: null } : w,
      );
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

  // ─── The EVM door of this beta (founder 2026-08-04) ─────────────────────────
  // MetaMask, on Flare Mainnet (14), or nothing. No wallet picker to wander
  // through, no chain to pick wrong: press the button, MetaMask opens, and the
  // connection only survives if it ends up on chain 14 — otherwise this throws
  // and NOTHING is linked. (The other accepted wallet, Xaman, is XRPL and never
  // touches wagmi; it has its own connect path.)
  const connectMetaMaskFlare = useCallback(async () => {
    // Linking means picking a NEW account: release the live session first, or
    // the extension hands back the account that is already connected forever.
    if (isConnected) {
      try {
        await disconnectAsync();
      } catch {
        /* nothing live to release */
      }
    }
    const metamask = findMetaMaskConnector(connectors);
    if (!metamask) {
      // No MetaMask in this browser. AppKit's picker is filtered to MetaMask
      // alone (see appkit.ts) and carries the QR / "open in MetaMask" deeplink,
      // which is the honest way in from a phone.
      getAppKitModal().open({ view: 'Connect' });
      throw new Error(
        'MetaMask is not available in this browser — use the QR or the “Open in MetaMask” link that just opened, or install the MetaMask extension.',
      );
    }
    try {
      await connectAsync({ connector: metamask, chainId: FLARE_CHAIN_ID });
    } catch (err) {
      throw new Error(
        isUserRejection(err)
          ? 'The MetaMask connection was declined — nothing was linked.'
          : (err as Error).message,
      );
    }
    // wagmi asks for the switch but swallows a refusal: the session stays alive
    // on the old chain. Settle it against the provider itself (switch, adding
    // Flare if the wallet doesn't know it) and, if it still isn't Flare, drop
    // the session so nothing is left half-connected on a chain we won't link.
    const provider = ((await metamask.getProvider().catch(() => null)) ??
      injectedProvider()) as any;
    if (!provider) return;
    try {
      await ensureFlareNetwork(provider, LINK_FLARE_MESSAGES);
    } catch (err) {
      await disconnectAsync().catch(() => {
        /* best effort — the guard in registerConnected still refuses non-Flare */
      });
      throw err;
    }
  }, [isConnected, disconnectAsync, connectors, connectAsync]);

  const registerConnected = useCallback(async () => {
    if (!address) {
      openConnect();
      return;
    }
    // Flare or nothing: this beta files EVM wallets as chain 14 rows, so a
    // session sitting on another chain is refused instead of being silently
    // recorded as an Ethereum/Polygon/… wallet (which is what used to happen).
    if (chainId !== FLARE_CHAIN_ID) {
      throw new Error(
        'This beta links Flare wallets only — switch MetaMask to Flare Mainnet (chain 14), then add the wallet again.',
      );
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

      // A Flare Smart Account (Personal Account) is registered as EVM but holds
      // NO key: it only executes 0xFE userOps signed from the XRPL account that
      // controls it. Falling into the EVM branch below opened the wallet picker
      // and asked the user to "connect this exact wallet" — a demand no wallet
      // app can ever satisfy (founder 2026-08-03). Say so instead of pretending.
      if (known && known.walletType === 'smart-account') {
        throw new Error(
          'This is a Flare Smart Account: it has no key of its own — it executes orders signed in Xaman by the XRPL account that controls it. There is nothing to enable here.',
        );
      }

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
    connectMetaMaskFlare,
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

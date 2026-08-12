/**
 * Wallet Partner Configuration (wagmi v2 + viem + AppKit)
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0):
 *   Astryum PREPARES unsigned calldata. The WALLET PARTNER (MetaMask, WalletConnect,
 *   Coinbase, Bifrost, Safe, etc.) TRANSMITS. The user AUTHORIZES. The blockchain EXECUTES.
 *
 * This file configures the wallet partner connection layer. It does NOT execute or
 * relay transactions on behalf of the user. All sendTransaction calls flow through
 * the user's wallet partner via wagmi's eth_sendTransaction abstraction.
 *
 * CONNECTABLE CHAIN (this beta):
 *   - Flare Mainnet (14) — the only network wagmi/AppKit expose, reached with
 *     MetaMask alone. See MULTI_VM_CONNECT_ENABLED below.
 *
 * The other seven EVM chains stay in EVM_NETWORKS_ALL, built and unwired.
 * XRPL (Xaman) is the second accepted wallet and never passes through wagmi;
 * Solana and Aptos keep their own adapters, currently without an entry point.
 */

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin';
import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  bsc,
  avalanche,
  flare,
  solana,
  bitcoin,
  type AppKitNetwork,
} from '@reown/appkit/networks';
import { cookieStorage, createStorage } from 'wagmi';

export const WALLET_CONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'defibro-dev-placeholder';

/**
 * ─── The connect rail of this beta (founder 2026-08-04) ──────────────────────
 * Only TWO wallets may be connected: MetaMask on Flare Mainnet (chain 14) and
 * Xaman on XRPL. XRPL never touches wagmi/AppKit (it has its own service), so
 * on this layer the rule reads: MetaMask, Flare, nothing else.
 *
 * Everything below that isn't Flare/MetaMask stays BUILT but INERT — the
 * multi-VM adapters, the eight EVM chains and the connectable-ecosystem
 * helpers are preserved for when the control plane opens beyond the demo; they
 * simply have no entry point while this flag is false.
 */
export const MULTI_VM_CONNECT_ENABLED: boolean = false;

/**
 * MetaMask's id in the WalletConnect Explorer registry — the key AppKit filters
 * its picker by (includeWalletIds/featuredWalletIds). Announced (EIP-6963) and
 * injected connectors are matched against this same id, so a second extension
 * (Rabby, Phantom's EVM mode, Coinbase…) never reaches the list.
 */
export const METAMASK_WALLET_ID =
  'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96';

/**
 * Every EVM chain the control plane knows how to execute on. BUILT, not wired:
 * while MULTI_VM_CONNECT_ENABLED is false the wallet layer exposes Flare alone
 * (see EVM_NETWORKS below), so this list is the shelf, not the rail.
 */
export const EVM_NETWORKS_ALL = [
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  bsc,
  avalanche,
  flare,
] as [AppKitNetwork, ...AppKitNetwork[]];

/**
 * EVM chains exposed to wagmi — Flare Mainnet (14) and nothing else.
 *
 * The app has been Flare-only at the surface for a while (NetworkSwitcher is
 * the "V1 Flare-only enforcer", SIWE pins Chain ID 14). Keeping seven other
 * chains inside wagmi meant a wallet connected on Ethereum was still a valid
 * wagmi session, and its address got filed as an Ethereum row. One chain in the
 * config makes the rule structural instead of cosmetic.
 */
export const EVM_NETWORKS = [flare] as [AppKitNetwork, ...AppKitNetwork[]];

/**
 * Solana mainnet network. Single-chain VM. Routed by AppKit through the
 * SolanaAdapter; wagmi never sees it.
 */
export const SOLANA_NETWORKS = [solana] as [AppKitNetwork, ...AppKitNetwork[]];

/** Bitcoin mainnet. Routed by AppKit through the BitcoinAdapter (UTXO, non-EVM). */
export const BITCOIN_NETWORKS = [bitcoin] as [AppKitNetwork, ...AppKitNetwork[]];

/**
 * Networks offered by the connect modal. Flare only: the picker can't hand back
 * a session on a chain this beta refuses to link. Solana/Bitcoin are appended
 * only when the multi-VM rail is switched back on — their adapters stay built
 * either way (see appkit.ts).
 */
export const APPKIT_NETWORKS = (
  MULTI_VM_CONNECT_ENABLED
    ? [...EVM_NETWORKS_ALL, ...SOLANA_NETWORKS, ...BITCOIN_NETWORKS]
    : [...EVM_NETWORKS]
) as [AppKitNetwork, ...AppKitNetwork[]];

/** App metadata shown by wallet partners during the connection handshake. */
export const APP_METADATA = {
  name: 'Astryum',
  description:
    'Universal Financial Control Plane. Non-custodial coordination layer. ' +
    'You always sign — Astryum never broadcasts.',
  url:
    (typeof window !== 'undefined' && window.location.origin) ||
    'https://astryum.com',
  icons: ['https://astryum.com/logo-icon.png'],
};

/**
 * WagmiAdapter — bridges AppKit's universal wallet UI with the wagmi v2 hook layer.
 * Exposes `.wagmiConfig` for use with WagmiProvider.
 *
 * SSR is enabled so Next.js App Router can hydrate wallet state without a flash.
 * Cookie storage keeps the connected wallet partner across page reloads.
 *
 * Note: only EVM networks are passed to wagmi. AppKit handles the Solana side
 * via the separate SolanaAdapter — wagmi has no concept of non-EVM chains.
 */
export const wagmiAdapter = new WagmiAdapter({
  networks: EVM_NETWORKS,
  projectId: WALLET_CONNECT_PROJECT_ID,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

/**
 * SolanaAdapter — bridges AppKit's modal with Solana wallet partners (Phantom,
 * Solflare, etc.). When a user with a Solana wallet clicks Connect, AppKit
 * surfaces them in the same modal as EVM wallets and routes signing through
 * this adapter.
 */
export const solanaAdapter = new SolanaAdapter();

/**
 * BitcoinAdapter — bridges AppKit's modal with Bitcoin wallet partners (Xverse,
 * Leather, etc.) via the sats-connect standard. Read + sign happen in the user's
 * wallet; Astryum never holds keys or broadcasts.
 */
export const bitcoinAdapter = new BitcoinAdapter();

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
 * SUPPORTED CHAINS (V1):
 *   - Ethereum Mainnet (1)
 *   - Arbitrum One (42161)
 *   - Base (8453)
 *   - Optimism (10)
 *   - Polygon (137)
 *   - BNB Smart Chain (56)
 *   - Avalanche C-Chain (43114)
 *   - Flare Mainnet (14)
 *
 * Solana, XRPL, Aptos use their own adapters (not wagmi).
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
 * EVM chains exposed to wagmi.
 * Order matters: first chain is the default for wallet partner connection.
 * Ethereum has the most pool liquidity, so it leads. Users can switch via NetworkSwitcher.
 */
export const EVM_NETWORKS = [
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
 * Solana mainnet network. Single-chain VM. Routed by AppKit through the
 * SolanaAdapter; wagmi never sees it.
 */
export const SOLANA_NETWORKS = [solana] as [AppKitNetwork, ...AppKitNetwork[]];

/** Bitcoin mainnet. Routed by AppKit through the BitcoinAdapter (UTXO, non-EVM). */
export const BITCOIN_NETWORKS = [bitcoin] as [AppKitNetwork, ...AppKitNetwork[]];

/**
 * All AppKit networks across every VM. The AppKit modal renders a unified
 * wallet picker — EVM users see MetaMask/WC/Coinbase/Rabby/Bifrost; Solana
 * users see Phantom/Solflare; Bitcoin users see Xverse/Leather; they share the
 * same Connect button.
 */
export const APPKIT_NETWORKS = [
  ...EVM_NETWORKS,
  ...SOLANA_NETWORKS,
  ...BITCOIN_NETWORKS,
] as [AppKitNetwork, ...AppKitNetwork[]];

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

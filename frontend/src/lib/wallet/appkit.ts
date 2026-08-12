/**
 * AppKit Modal Singleton
 *
 * Creates the AppKit modal once per browser session and exposes the singleton.
 * AppKit handles the wallet partner UI (connection modal, network switching,
 * account view). All on-chain calls go through wagmi hooks — AppKit only owns
 * the connection UX.
 *
 * REGULATORY BOUNDARY:
 *   AppKit and wagmi are wallet partner abstractions. Astryum never holds keys,
 *   never relays, never broadcasts. The wallet partner transmits — we just hand
 *   it the unsigned calldata built by the CalldataBuilder.
 */

import { createAppKit } from '@reown/appkit/react';
import { flare } from '@reown/appkit/networks';
import {
  wagmiAdapter,
  solanaAdapter,
  bitcoinAdapter,
  WALLET_CONNECT_PROJECT_ID,
  APPKIT_NETWORKS,
  APP_METADATA,
  METAMASK_WALLET_ID,
  MULTI_VM_CONNECT_ENABLED,
} from './config';

let _modal: ReturnType<typeof createAppKit> | null = null;

/**
 * Lazy-initialize the AppKit modal. Returns the same instance on every call.
 * Idempotent — safe to call from multiple components.
 *
 * ONE wallet, ONE network (founder 2026-08-04): the picker offers MetaMask on
 * Flare Mainnet and nothing else. The other rail of this beta is Xaman on XRPL,
 * which never passes through AppKit — it connects through its own service.
 *
 * The Solana and Bitcoin adapters stay imported and built; they are simply not
 * registered while MULTI_VM_CONNECT_ENABLED is false, so re-opening that rail is
 * a flag flip, not a rebuild.
 */
export function getAppKitModal() {
  if (_modal) return _modal;

  _modal = createAppKit({
    adapters: MULTI_VM_CONNECT_ENABLED
      ? [wagmiAdapter, solanaAdapter, bitcoinAdapter]
      : [wagmiAdapter],
    networks: APPKIT_NETWORKS,
    defaultNetwork: flare,
    projectId: WALLET_CONNECT_PROJECT_ID,
    metadata: APP_METADATA,
    // MetaMask only. `includeWalletIds` filters the registry list AND the
    // injected/announced (EIP-6963) connectors, so a second extension in the
    // same browser never shows up; `allWallets: 'HIDE'` removes the "All
    // wallets" escape hatch that would list the registry anyway.
    includeWalletIds: MULTI_VM_CONNECT_ENABLED ? undefined : [METAMASK_WALLET_ID],
    featuredWalletIds: MULTI_VM_CONNECT_ENABLED ? undefined : [METAMASK_WALLET_ID],
    allWallets: MULTI_VM_CONNECT_ENABLED ? 'SHOW' : 'HIDE',
    enableCoinbase: MULTI_VM_CONNECT_ENABLED,
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#C9A227',
      '--w3m-color-mix': '#0A0A0A',
      '--w3m-color-mix-strength': 40,
      // AppKit scales every corner (incl. the WalletConnect QR's corner masking)
      // off this master value. 12px over-rounded the QR and clipped its finder
      // patterns, making it unscannable. 4px is AppKit's default and keeps the QR
      // readable while still rounding the modal chrome.
      '--w3m-border-radius-master': '4px',
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    },
  });

  return _modal;
}

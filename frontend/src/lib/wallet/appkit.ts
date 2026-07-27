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
import {
  wagmiAdapter,
  solanaAdapter,
  bitcoinAdapter,
  WALLET_CONNECT_PROJECT_ID,
  APPKIT_NETWORKS,
  APP_METADATA,
} from './config';

let _modal: ReturnType<typeof createAppKit> | null = null;

/**
 * Lazy-initialize the AppKit modal. Returns the same instance on every call.
 * Idempotent — safe to call from multiple components.
 *
 * Both wagmi (EVM) and Solana adapters are registered: users see ONE Connect
 * button that surfaces all supported wallets across both VMs.
 */
export function getAppKitModal() {
  if (_modal) return _modal;

  _modal = createAppKit({
    adapters: [wagmiAdapter, solanaAdapter, bitcoinAdapter],
    networks: APPKIT_NETWORKS,
    projectId: WALLET_CONNECT_PROJECT_ID,
    metadata: APP_METADATA,
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

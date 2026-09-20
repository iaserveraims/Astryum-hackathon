/**
 * injectedBrand — WHICH app is behind window.ethereum.
 *
 * Extensions announce themselves with boolean flags on the provider. Order
 * matters: almost everyone fakes `isMetaMask` for compatibility, so the
 * SPECIFIC flags are checked first and MetaMask is the conclusion only when
 * nobody more specific claimed the provider. Multi-extension browsers expose
 * `providers[]` (pre-EIP-6963 convention) — every candidate is checked.
 *
 * Returns a PRESENTABLE app name (what walletType stores and the display
 * rule shows via connectorProperName), or null when nothing identifies
 * itself — the caller keeps its honest fallback.
 */

type FlaggedProvider = Record<string, unknown> & { providers?: unknown };

const BRAND_FLAGS: Array<[flag: string, name: string]> = [
  ['isBraveWallet', 'Brave Wallet'],
  ['isRabby', 'Rabby'],
  ['isBifrost', 'Bifrost'],
  ['isCoinbaseWallet', 'Coinbase Wallet'],
  ['isTrust', 'Trust Wallet'],
  ['isPhantom', 'Phantom'],
  // Last on purpose — the compatibility flag everyone else also raises.
  ['isMetaMask', 'MetaMask'],
];

export function injectedWalletName(eth: unknown): string | null {
  if (!eth || typeof eth !== 'object') return null;
  const root = eth as FlaggedProvider;
  const candidates: FlaggedProvider[] = Array.isArray(root.providers)
    ? [...(root.providers as FlaggedProvider[]), root]
    : [root];
  for (const [flag, name] of BRAND_FLAGS) {
    for (const c of candidates) {
      if (c && typeof c === 'object' && (c as Record<string, unknown>)[flag] === true) return name;
    }
  }
  return null;
}

/**
 * Flare Mainnet chain parameters — the SINGLE source of truth for every
 * wallet_switchEthereumChain / wallet_addEthereumChain surface (NetworkSwitcher
 * banner, SIWE login's ensureFlareNetwork). Verified against the official
 * Network Configuration page at dev.flare.network on 2026-07-29.
 *
 * Explorer note: the dev hub lists flare-explorer.flare.network; this app links
 * flarescan.com everywhere (both are canonical Flare explorers), so the wallet
 * entry stays consistent with the rest of the UI.
 *
 * wagmi/AppKit consume their own `flare` network object in ./config.ts — that
 * is the provider layer. This module is for raw EIP-3085/3326 requests only.
 */

export const FLARE_CHAIN_ID = 14;
export const FLARE_CHAIN_ID_HEX = '0xe'; // 14

/** EIP-3085 params, ready to hand to wallet_addEthereumChain. */
export const FLARE_ADD_CHAIN_PARAMS = {
  chainId: FLARE_CHAIN_ID_HEX,
  chainName: 'Flare Mainnet',
  nativeCurrency: { name: 'Flare', symbol: 'FLR', decimals: 18 },
  rpcUrls: ['https://flare-api.flare.network/ext/C/rpc'],
  blockExplorerUrls: ['https://flarescan.com'],
};

/** One-click add for wallets where the in-app dialog is unavailable. */
export const CHAINLIST_FLARE_URL = 'https://chainlist.org/chain/14';

/** EIP-1193 user rejection (MetaMask 4001) — a choice, not an error. */
export function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return e?.code === 4001 || /rejected|denied/i.test(e?.message ?? '');
}

/** EIP-3326 "chain not added yet" (4902) → caller should try addEthereumChain. */
export function isUnrecognizedChain(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return e?.code === 4902 || /unrecognized chain|4902/i.test(e?.message ?? '');
}

/** The injected EIP-1193 provider, or null when no wallet extension is present. */
export function injectedProvider(): any | null {
  return (typeof window !== 'undefined' && (window as any).ethereum) || null;
}

/**
 * Put the wallet on Flare Mainnet (14) — switch, and add the chain first if the
 * wallet doesn't know it yet. Resolves only when the wallet IS on Flare.
 *
 * Shared by every surface that refuses to proceed off-chain-14: SIWE login and
 * the Wallets connect rail. Callers pass their own prose so the user reads why
 * *their* action needs Flare; raw wallet error text never surfaces on its own.
 */
export async function ensureFlareNetwork(
  eth: any,
  messages?: { declined?: string; failed?: (detail: string) => string },
): Promise<void> {
  try {
    const current: string = await eth.request({ method: 'eth_chainId' });
    if (current?.toLowerCase() === FLARE_CHAIN_ID_HEX) return;
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: FLARE_CHAIN_ID_HEX }],
      });
    } catch (switchErr: unknown) {
      // 4902 = chain not added to wallet yet
      if (isUnrecognizedChain(switchErr)) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [FLARE_ADD_CHAIN_PARAMS],
        });
      } else {
        throw switchErr;
      }
    }
  } catch (err: unknown) {
    // Declining the switch is a choice, not a fault — say so without wallet
    // error prose.
    if (isUserRejection(err)) {
      throw new Error(
        messages?.declined ??
          'This app runs on Flare and the network switch was declined in your wallet. Try again whenever you like.',
      );
    }
    const detail = (err as { message?: string })?.message ?? 'unknown error';
    throw new Error(
      messages?.failed?.(detail) ?? `Could not switch wallet to Flare Mainnet: ${detail}`,
    );
  }
}

/**
 * registrationChain — what a connected account is called when we REGISTER it
 * in the backend wallet table.
 *
 * The backend (`POST /api/wallets/connect`) validates the ecosystem against the
 * address shape and refuses any mismatch: an EVM address is always 0x + 40 hex,
 * and no XRPL address ever is. When the caller sends no `ecosystem`, the backend
 * derives one from the `network` LABEL and falls back to 'evm' for anything it
 * does not recognise — so the generic 'mainnet' the wallet services report made
 * every Xaman r-address arrive as EVM and bounce with ADDRESS_ECOSYSTEM_MISMATCH
 * (the wallet then never appeared in the list, and surfaces that read from it —
 * the FXRP bridge among them — had no owner to work with).
 *
 * Labels match `useWalletLinking` (the canonical registration path) so the two
 * writers never create twin rows for one wallet: the backend's uniqueness key is
 * (userId, address, network), so two labels for one chain means two rows.
 *
 * EVM keeps whatever label the wallet service reported. That path already worked
 * (its addresses pass the EVM check), and rewriting the label would orphan the
 * rows production already holds; only the explicit `ecosystem` is added, so the
 * backend stops having to guess.
 */
import type { WalletAccount } from '../types/wallet';

export interface RegistrationChain {
  ecosystem: 'evm' | 'xrpl' | 'aptos';
  network: string;
  caip2?: string;
}

export function registrationChain(
  account: Pick<WalletAccount, 'chainType' | 'network'>,
): RegistrationChain {
  // XamanWalletService reports 'xrp' (cast past ChainType, which spells it
  // 'xrpl'); both mean the same ledger.
  const chainType = String(account.chainType ?? '').toLowerCase();

  if (chainType === 'xrpl' || chainType === 'xrp' || chainType === 'ripple') {
    return { ecosystem: 'xrpl', network: 'xrpl', caip2: 'xrpl:mainnet' };
  }
  if (chainType === 'aptos') {
    return { ecosystem: 'aptos', network: 'aptos', caip2: 'aptos:mainnet' };
  }
  // `network` is optional on WalletAccount, and the backend requires a non-empty
  // label — falling back to the chainType keeps a label it can read ('ethereum',
  // 'flare'…) instead of a request that bounces as INVALID_BODY.
  return { ecosystem: 'evm', network: account.network || chainType || 'evm' };
}

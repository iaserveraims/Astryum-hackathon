/**
 * registrationChain — what a connected account is called when we REGISTER it
 * in the backend wallet table.
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

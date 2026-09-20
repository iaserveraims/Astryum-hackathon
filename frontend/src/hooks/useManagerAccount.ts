'use client';

/**
 * useManagerAccount — THE account the manager desk and its ceremony follow,
 * and the selector rows to switch it. One rule, two surfaces (the desk and
 * ManagerSetupOperation/ManagerSetupWizard): see lib/managed/managerAccount.
 *
 * Candidates are the Xaman sessions connected in THIS browser plus the XRPL
 * wallets LINKED to the signed-in account. A linked-only account reads its
 * ledger like any other; when it has to sign, every order names its Account
 * and Xaman asks for that account — no session required beforehand.
 */

import { useCallback, useMemo } from 'react';
import { useWalletStore } from '../stores/walletStore';
import { useChosenManagerAccount, useManagerAccountStore } from '../stores/managerAccountStore';
import { useMyWallets } from './useMyWallets';
import { useXrplWalletPartner } from '../lib/wallet/useXrplWalletPartner';
import { useT } from '../i18n/LanguageProvider';
import { walletDisplayName } from '../lib/walletIdentity';
import { shortAddr } from '../lib/institutional/format';
import { linkedManagerWallets, managerCandidates, resolveManagerAccount, type ManagerCandidate } from '../lib/managed/managerAccount';
import type { WalletOption } from '../components/wallet/WalletSelect';

export interface ManagerAccountView {
  /** The account the desk follows, or null when nothing can be followed yet. */
  address: string | null;
  /** The followed account has a Xaman session in this browser. */
  liveConnected: boolean;
  /** Everything that could be followed, connected first. */
  candidates: ManagerCandidate[];
  /** Rows for WalletSelect (keyed by address), names by the canonical rule. */
  options: WalletOption[];
  /** Follow this address (remembered per user); a connected one also becomes the active signer. */
  choose: (address: string) => void;
  /** The linked wallets are still being read (no cache yet): "none" is not known yet. */
  resolving: boolean;
}

export function useManagerAccount(): ManagerAccountView {
  const { t } = useT();
  const { address: live } = useXrplWalletPartner();
  const sessions = useWalletStore((s) => s.wallets);
  const setActiveWallet = useWalletStore((s) => s.setActiveWallet);
  // EVERY linked wallet, also the ones toggled out of the dashboard totals:
  // the desk follows an
  // account as an IDENTITY that governs, not as money — and a dedicated
  // governing account is exactly the kind one excludes from the totals.
  const { wallets: myWallets, loading } = useMyWallets({ includeExcluded: true });
  // The hand-pick of THIS user, remembered across reloads; a pointer
  // only — resolveManagerAccount drops it the moment it is not a candidate.
  const chosen = useChosenManagerAccount();
  const remember = useManagerAccountStore((s) => s.choose);

  const connected = useMemo(() => sessions.filter((w) => w.isConnected && w.walletType === 'xaman'), [sessions]);
  const candidates = useMemo(() => managerCandidates(connected, linkedManagerWallets(myWallets)), [connected, myWallets]);
  const address = resolveManagerAccount(candidates, chosen, live);
  const liveConnected = !!live && live === address;

  const options = useMemo<WalletOption[]>(
    () =>
      candidates.map((c) => ({
        key: c.address,
        record: c.linked ?? { address: c.address, walletType: 'xaman', ecosystem: 'xrpl' },
        name: c.linked ? walletDisplayName(c.linked, t) : (c.session?.nickname || 'Xaman'),
        detail: c.live ? `${shortAddr(c.address)} · ${t('connected')}` : shortAddr(c.address),
      })),
    [candidates, t],
  );

  const choose = useCallback(
    (addr: string) => {
      const session = connected.find((w) => w.address === addr);
      // A connected one also becomes the active signer (the primitive
      // useXrplWalletPartner follows). The pick itself is ALWAYS remembered:
      // it used to be dropped for a connected account, so in the
      // next browser — where that session does not exist — the desk fell back
      // to the first linked wallet instead of the one the manager chose.
      if (session) setActiveWallet(session);
      remember(addr);
    },
    [connected, setActiveWallet, remember],
  );

  return { address, liveConnected, candidates, options, choose, resolving: loading && candidates.length === 0 };
}

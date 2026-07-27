/**
 * AuthorityAccount — the unifying primitive of the authority switcher
 * (review 2026-07-17, §1 of the improved prompt).
 *
 * One app, N authority accounts, two ways to operate. An authority account is
 * NOT a WalletAccount: a governed Legacy is not "connected" — it is an
 * observed r-address whose state (council, health) is read fresh from the
 * ledger. This layer is the union of:
 *   - walletStore wallets  → kind 'simple'   (you sign directly)
 *   - legacyLocal pointers → kind 'governed' (the council signs; you propose)
 *
 * `executors` is deliberately empty today: it is the open door to PMW and
 * XLS-75 permission delegations without a redesign. DO NOT build on it until
 * their gates open (see §4 of the review — "ni una línea hasta el gate").
 */

import type { WalletAccount } from '../types/wallet';
import type { LegacyHealth } from '../../services/v1Api';

export interface AuthorityAccount {
  /** Stable id: `simple:<walletId>` or `governed:<address>`. */
  id: string;
  kind: 'simple' | 'governed';
  address: string;
  /** ChainType for simples ('xrp', 'evm', …); governed Legacies are XRPL today. */
  chain: string;
  /** Display name: wallet nickname or Legacy apodo (client-side only). */
  nickname?: string;
  authority: {
    type: 'single' | 'quorum';
    /** Signatures required (quorum) — from the ledger read, when known. */
    quorum?: number;
    /** Council size — from the ledger read, when known. */
    total?: number;
  };
  /** Backend-computed health verdict (governed only; never re-derived here). */
  health?: LegacyHealth;
  /** Simple accounts only: whether the wallet partner is currently connected. */
  isConnected?: boolean;
  /** Future executors (PMW, XLS-75 delegations). Always [] today — a door, not a feature. */
  executors: never[];
}

/** What the ledger told us about a governed address (cached per session). */
export interface GovernedLedgerRead {
  hasCouncil: boolean;
  quorum?: number;
  total?: number;
  /** Members with on-chain rehearsal evidence — the master-key gate. */
  signedCount?: number;
  health?: LegacyHealth;
  fetchedAt: number;
}

export const simpleAuthorityId = (walletId: string) => `simple:${walletId}`;
export const governedAuthorityId = (address: string) => `governed:${address}`;

/**
 * Compose the authority account list from its two sources. Pure — the hook
 * feeds it store state; tests can feed it fixtures.
 *
 * Dedupe rule: an address that is BOTH a connected wallet and an observed
 * Legacy appears once, as governed when the ledger read confirmed a council
 * (a council account must never be offered single-sig — the canSignDirect
 * footgun), and as simple otherwise.
 */
export function composeAuthorityAccounts(
  wallets: WalletAccount[],
  observedLegacies: string[],
  nicknameOf: (address: string) => string | undefined,
  ledger: Record<string, GovernedLedgerRead | undefined>,
): AuthorityAccount[] {
  const connected = (wallets ?? []).filter((w) => w && w.isConnected);

  const governed: AuthorityAccount[] = observedLegacies.map((address) => {
    const read = ledger[address];
    return {
      id: governedAuthorityId(address),
      kind: 'governed',
      address,
      chain: 'xrp',
      nickname: nicknameOf(address),
      authority:
        read?.hasCouncil
          ? { type: 'quorum', quorum: read.quorum, total: read.total }
          : { type: 'single' },
      health: read?.health,
      isConnected: connected.some((w) => w.address === address),
      executors: [],
    };
  });

  const governedCouncilAddresses = new Set(
    governed.filter((g) => ledger[g.address]?.hasCouncil).map((g) => g.address),
  );

  const simples: AuthorityAccount[] = connected
    .filter((w) => !governedCouncilAddresses.has(w.address))
    .map((w) => ({
      id: simpleAuthorityId(w.id),
      kind: 'simple' as const,
      address: w.address,
      chain: w.chainType,
      nickname: w.nickname,
      authority: { type: 'single' as const },
      isConnected: true,
      executors: [] as never[],
    }));

  // A connected address only observed (no confirmed council) would otherwise
  // show twice — drop the governed duplicate, the simple card carries it.
  const simpleAddresses = new Set(simples.map((s) => s.address));
  const governedDeduped = governed.filter(
    (g) => governedCouncilAddresses.has(g.address) || !simpleAddresses.has(g.address),
  );

  return [...simples, ...governedDeduped];
}

/**
 * The authority model — the account-switcher's vocabulary (ADR-009).
 *
 * An AUTHORITY ACCOUNT is what the user operates AS: either a single-key
 * wallet (today's connected wallets) or a council-governed account (a quorum
 * of keys). The whole app contextualises to the active authority. 'overview'
 * is the wide watchtower — every simple wallet aggregated, today's default
 * dashboard behaviour — kept so the multi-wallet Capital Map never regresses.
 *
 * The shape deliberately does not assume XRPL-only: `ecosystem` plus the id
 * scheme leave room for an authority that governs executor accounts on other
 * chains (PMW vision, gated). Nothing PMW is built here.
 */

import { EVM_ADDRESS_RE, type WalletRecord } from './portfolioMerge';
import type { LegacyHealth, RehearsalStatus, XrplCouncil } from '../services/v1Api';

export const OVERVIEW_AUTHORITY_ID = 'all';

/** EVM addresses compare case-insensitively; XRPL/Solana are case-sensitive. */
export function addressKey(address: string): string {
  return EVM_ADDRESS_RE.test(address) ? address.toLowerCase() : address;
}

export function walletAuthorityId(address: string): string {
  return `wallet:${addressKey(address)}`;
}

export function governedAuthorityId(address: string, ecosystem = 'xrpl'): string {
  return `governed:${ecosystem}:${address}`;
}

export interface OverviewAuthority {
  id: typeof OVERVIEW_AUTHORITY_ID;
  kind: 'overview';
}

export interface SingleAuthority {
  id: string;
  kind: 'single';
  wallet: WalletRecord;
}

/** The ledger's read of a governed account — never stored, always fresh. */
export interface GovernedLedgerRead {
  loading: boolean;
  hasCouncil?: boolean;
  quorum?: number;
  memberCount?: number;
  signers?: XrplCouncil['signers'];
  status?: RehearsalStatus;
  health?: LegacyHealth;
  error?: string;
}

export interface GovernedAuthority extends GovernedLedgerRead {
  id: string;
  kind: 'governed';
  ecosystem: 'xrpl';
  address: string;
  label?: string;
  /** Backend registry row id — absent when the entry only exists because the
   *  connected XRPL wallet is itself a council. */
  registryId?: string;
  source: 'connected' | 'registered';
  /** Proposals waiting for THIS user's signature (wired by the proposal inbox;
   *  undefined until that read exists — never fabricated). */
  pendingSignatures?: number;
}

export type Authority = OverviewAuthority | SingleAuthority | GovernedAuthority;

export function isGoverned(a: Authority | null | undefined): a is GovernedAuthority {
  return a?.kind === 'governed';
}

export function authorityDisplayName(a: Authority): string {
  if (a.kind === 'overview') return 'Overview';
  if (a.kind === 'single') return a.wallet.label || shortAddress(a.wallet.address);
  return a.label || shortAddress(a.address);
}

export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 7)}…${address.slice(-5)}` : address;
}

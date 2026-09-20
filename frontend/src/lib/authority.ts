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
  /** E2 third state (2026-08-16): a PERSONAL wallet whose keys are a quorum —
   *  a SignerList on a simple account (the reinforced account), marked so by
   *  its owner (personalQuorum). Read fresh from the ledger; undefined =
   *  single-key, unmarked, or not yet read. It never makes the wallet a
   *  Legacy — that is the whole point of the third state. */
  hardenedQuorum?: GovernedLedgerRead;
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
  /** Proposals still in flight on this account (collecting | ready) — the
   *  council's decisions mid-air, whoever's turn it is. Same read as
   *  pendingSignatures; undefined until it exists — never fabricated. */
  liveProposals?: number;
  /**
   * productizer it. 27 (6) — LA AUSENCIA POR ILEGIBLE SE VEÍA IGUAL QUE EL CERO.
   *
   * `useAuthorities` deja los dos contadores en `undefined` cuando la lectura se
   * rechazó o vino a medias (it. 25: filas `unreadable[]` ⇒ ningún recuento),
   * que es lo único honesto. Pero una insignia que solo se pinta con un número
   * positivo convierte «no lo pude leer» en «no hay nada»: un Legacy con dos
   * firmas pendientes que nadie consiguió leer se veía EXACTAMENTE igual que uno
   * sin nada pendiente. Esta bandera distingue las dos ausencias — todavía no
   * leído (false: la insignia calla) de leído y fallado (true: lo dice) — sin
   * fabricar jamás un número.
   */
  proposalsUnread?: boolean;
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

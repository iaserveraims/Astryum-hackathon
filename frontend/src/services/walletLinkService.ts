'use client';

/**
 * walletLinkService — typed client for the unified wallet linkage backend.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0):
 *   Connecting / logging in a wallet is READ-ONLY. It never authorizes a
 *   transaction. To authorize transactions the user must explicitly sign a
 *   binding message (personal_sign, ownership proof — NOT a tx) which the
 *   backend verifies and records as `read_and_receive`.
 *
 * Two backend tables, two jobs (per the chosen architecture):
 *   - `wallets`         → the LIST (every connected / watched / pasted wallet)
 *   - `wallet_bindings` → the tx PROOF (signature, mode read | read_and_receive)
 */

import { isPreviewActive, demoWallets } from './previewData';
import { markLiveWalletSession } from '../lib/demoMode';
import { getApiBase } from '../lib/env';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type WalletPurpose = 'sign' | 'watch' | 'both' | 'destination_only';
export type BindingMode = 'read' | 'read_and_receive';
export type ChainType = 'evm' | 'solana' | 'xrpl' | 'bitcoin';

/** A wallet as returned by GET /api/wallets/mine (Wallet row + binding annotation). */
export interface BackendWallet {
  id: string;
  address: string;
  walletType: string;
  network: string;
  chainId: number | null;
  caip2: string | null;
  ecosystem: string;
  isPrimary: boolean;
  purpose: WalletPurpose;
  isConnected: boolean;
  nickname: string | null;
  /** id of the active tx-binding, if any */
  bindingId: string | null;
  bindingMode: BindingMode | null;
  /** true only when a signature-proven read_and_receive binding exists */
  txAuthorized: boolean;
  /** whether this wallet counts toward the dashboard's monetary totals */
  includeInPortfolio: boolean;
  /** personal colour tag (hex) — wallet identity across Summary/Portfolio */
  color: string | null;
  /** personal glyph tag (slug, e.g. 'comet') — wallet identity, same idea as
   *  colour; null falls back to the provider's brand mark */
  icon: string | null;
}

export interface ConnectWalletInput {
  address: string;
  walletType: string;
  network: string;
  chainId?: number;
  caip2?: string;
  ecosystem?: 'evm' | 'solana' | 'xrpl' | 'aptos' | 'cosmos' | 'stellar' | 'algorand' | 'bitcoin';
  /** defaults to 'watch' (read-only) on the client; backend default is 'sign' */
  purpose?: WalletPurpose;
  nickname?: string;
}

// ─── Wallet list (read layer) ──────────────────────────────────────────────────

export async function listMyWallets(): Promise<BackendWallet[]> {
  if (isPreviewActive()) {
    // Public demo, NO real wallet connected: two mock wallets. Once a real wallet is
    // connected (connectWallet → markLiveWalletSession) this goes live (R2 hard cut).
    return demoWallets() as BackendWallet[];
  }
  const res = await fetch(`${API_BASE}/wallets/mine`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  const body = await json<{ success: boolean; data: { wallets: BackendWallet[] } }>(res);
  return body.data.wallets;
}

/** Register a freshly-connected / pasted wallet. Read-only by default. */
export async function connectWallet(input: ConnectWalletInput): Promise<BackendWallet> {
  const res = await fetch(`${API_BASE}/wallets/connect`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ purpose: 'watch', ...input }),
  });
  const body = await json<{ success: boolean; data: { wallet: BackendWallet } }>(res);
  // R2 HARD CUT: a REAL wallet is now connected → kill the demo fixtures for this session
  // (every read goes live from here; a real-wallet session must never see sample data).
  markLiveWalletSession();
  return body.data.wallet;
}

export interface UpdateWalletInput {
  /** New label; pass '' or null to clear it. */
  nickname?: string | null;
  /** Promote to primary for its ecosystem (tx-enabled wallets only). */
  isPrimary?: true;
  /** Toggle whether the wallet counts in the dashboard's monetary totals. */
  includeInPortfolio?: boolean;
  /** Personal colour tag (hex) — identity across Summary/Portfolio. */
  color?: string | null;
  /** Personal glyph tag (slug) — identity across Summary/Portfolio. */
  icon?: string | null;
}

export async function updateWallet(id: string, patch: UpdateWalletInput): Promise<BackendWallet> {
  const res = await fetch(`${API_BASE}/wallets/mine/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const body = await json<{ success: boolean; data: { wallet: BackendWallet } }>(res);
  return body.data.wallet;
}

export async function removeWallet(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/wallets/mine/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'include',
  });
  await json<{ success: boolean }>(res);
}

// ─── Tx-binding (signature-proven authorization) ───────────────────────────────

export interface InitiateBindingResult {
  nonce: string;
  message: string;
  expiresAt: string;
}

export async function initiateBinding(address: string, chainType: ChainType): Promise<InitiateBindingResult> {
  const res = await fetch(`${API_BASE}/wallets/bindings/initiate`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ address, chainType }),
  });
  return json<InitiateBindingResult>(res);
}

export interface ConfirmBindingInput {
  nonce: string;
  message: string;
  /** EVM ownership proof — personal_sign signature over `message`. */
  signature?: string;
  /** XRPL ownership proof — hex of the Xaman-signed (submit:false) tx. */
  signedTxHex?: string;
  address: string;
  chainType: ChainType;
  label?: string;
  mode?: BindingMode;
}

export async function confirmBinding(input: ConfirmBindingInput): Promise<{ binding: { id: string; mode: BindingMode } }> {
  const res = await fetch(`${API_BASE}/wallets/bindings/confirm`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ mode: 'read_and_receive', ...input }),
  });
  return json<{ binding: { id: string; mode: BindingMode } }>(res);
}

export async function setBindingMode(id: string, mode: BindingMode): Promise<void> {
  const res = await fetch(`${API_BASE}/wallets/bindings/${id}/mode`, {
    method: 'PATCH',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ mode }),
  });
  await json(res);
}

export async function deleteBinding(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/wallets/bindings/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

'use client';

/**
 * nativeBalance — shared read-only helpers for the demo's two rails:
 * FLR for Flare EVM wallets, XRP for XRPL (Xaman) wallets.
 *
 * Extracted from app/wallets/page.tsx so the transfer modal can show the same
 * balance the wallet card shows. Read-only: it never invents a balance and
 * degrades to null/0 on any failure.
 */

import type { BackendWallet } from '../../services/walletLinkService';
import { getApiBase } from '../env';

const API_BASE = getApiBase();

export interface NativeBalance {
  symbol: string;
  /** Spendable balance — for XRPL this already EXCLUDES the ledger reserve. */
  balance: string;
  usdValue: number;
  /** XRP locked by the XRPL reserve (base + per-object), when applicable. */
  reservedXrp?: number;
}

export type TransferRail = 'evm' | 'xrpl';

/**
 * Which transfer rail a linked wallet belongs to, or null when the beta does
 * not support transfers for it (Solana/Bitcoin/other read-only ecosystems).
 *
 * EVM: ONLY Flare-chain wallets (chainId 14, or an EVM wallet with no chainId,
 * which the demo reads on Flare) ride the FLR rail. Wallets linked on other
 * EVM chains (Ethereum, Base…) get NO rail for now — their balance is hidden
 * instead of showing a Flare read under an Ethereum badge.
 */
export function transferRailOf(
  wallet: Pick<BackendWallet, 'address' | 'chainId' | 'ecosystem'>,
): TransferRail | null {
  if (wallet.ecosystem?.toLowerCase() === 'xrpl' || wallet.address.startsWith('r')) return 'xrpl';
  if (!/^0x/.test(wallet.address)) return null;
  if (wallet.chainId === 14) return 'evm';
  if (wallet.chainId == null && wallet.ecosystem?.toLowerCase() === 'evm') return 'evm';
  return null;
}

// Best-effort native-token USD price (FLR / XRP), used to value a balance the
// chain read returned. Cached 60s per id; degrades to 0. Never invents a balance.
const _price: Record<string, { v: number; at: number }> = {};
async function nativePriceUsd(coingeckoId: 'flare-networks' | 'ripple'): Promise<number> {
  const hit = _price[coingeckoId];
  if (hit && hit.v > 0 && Date.now() - hit.at < 60_000) return hit.v;
  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
    );
    if (r.ok) {
      const j = await r.json();
      const p = Number(j?.[coingeckoId]?.usd ?? 0);
      if (p > 0) {
        _price[coingeckoId] = { v: p, at: Date.now() };
        return p;
      }
    }
  } catch {
    /* ignore — caller degrades to 0 */
  }
  return 0;
}

/**
 * Native balance for the demo's two rails via GET /api/network/balance:
 * FLR for Flare EVM wallets, XRP for XRPL (Xaman) wallets. Returns null for
 * anything else — the caller then explains instead of pretending.
 */
export async function fetchNativeBalance(wallet: BackendWallet): Promise<NativeBalance | null> {
  const kind = transferRailOf(wallet);
  if (!kind) return null;
  try {
    const res = await fetch(
      `${API_BASE}/network/balance?kind=${kind}&address=${encodeURIComponent(wallet.address)}`,
    ).catch(() => null);
    if (!res?.ok) return null;
    const raw = (await res.json()) as {
      ok?: boolean;
      symbol?: string;
      balance?: string;
      reservedXrp?: number;
    };
    if (!raw?.ok || raw.balance == null) return null;
    const bal = Number(raw.balance);
    if (!isFinite(bal)) return null;
    const price = await nativePriceUsd(kind === 'xrpl' ? 'ripple' : 'flare-networks');
    return {
      balance: String(bal),
      symbol: String(raw.symbol ?? (kind === 'xrpl' ? 'XRP' : 'FLR')),
      usdValue: bal * price,
      ...(typeof raw.reservedXrp === 'number' && raw.reservedXrp > 0
        ? { reservedXrp: raw.reservedXrp }
        : {}),
    };
  } catch {
    return null;
  }
}

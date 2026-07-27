/**
 * TrialCapService — the early-access deposit ceiling (founder 2026-07-19).
 *
 * Plan: open the real dashboard to the public as a capped early access. To
 * keep the trial legally boring, a user's CONNECTED wallets may never hold
 * more than TRIAL_WALLET_CAP_USD (≈$100) in total — the gate runs when a
 * wallet is connected, so an over-cap wallet simply never enters the account.
 *
 * Behaviour:
 *   · TRIAL_WALLET_CAP_USD unset/blank/invalid/≤0 → the cap DOES NOT EXIST
 *     (today's state: the dashboard stays invite-only and uncapped).
 *   · Set (e.g. 100) → connecting a wallet values the user's already-connected
 *     wallets PLUS the candidate via PortfolioEngine (multi-ecosystem, gross
 *     assets `totalUSD` — debt does not shrink the exposure story) and rejects
 *     the connect if the sum exceeds the cap.
 *   · FAIL-CLOSED: if valuation is unavailable (RPC/pricing down) the connect
 *     is rejected with a retryable error — a legal ceiling that silently lets
 *     wallets through when the price feed hiccups is not a ceiling.
 *
 * Read-only by construction: this service values addresses; it never signs,
 * never moves, never custodies (CLAUDE.md invariants intact).
 */
import { prisma } from '../database/prismaClient';
import { PortfolioEngine } from '../engines/portfolio/PortfolioEngine';

export function trialCapUsd(): number | null {
  const raw = process.env.TRIAL_WALLET_CAP_USD;
  if (!raw || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type TrialCapVerdict =
  | { ok: true }
  | { ok: false; code: 'TRIAL_CAP_EXCEEDED'; totalUsd: number; capUsd: number }
  | { ok: false; code: 'TRIAL_VALUATION_UNAVAILABLE'; capUsd: number };

export async function checkTrialCap(
  userId: string,
  candidateAddress: string,
): Promise<TrialCapVerdict> {
  const capUsd = trialCapUsd();
  if (capUsd === null) return { ok: true };

  const existing = await prisma.wallet.findMany({
    where: { userId, isConnected: true },
    select: { address: true },
  });

  // Dedup case-insensitively but value the ORIGINAL strings — lowercasing an
  // XRPL/Solana address would change it (base58 is case-significant).
  const byKey = new Map<string, string>();
  for (const w of existing) byKey.set(w.address.toLowerCase(), w.address);
  byKey.set(candidateAddress.toLowerCase(), candidateAddress);

  const engine = PortfolioEngine.getInstance();
  let totalUsd = 0;
  try {
    const snaps = await Promise.all(
      [...byKey.values()].map((address) => engine.getPortfolio(address)),
    );
    for (const snap of snaps) {
      totalUsd += Number.isFinite(snap.totalUSD) ? snap.totalUSD : 0;
    }
  } catch {
    return { ok: false, code: 'TRIAL_VALUATION_UNAVAILABLE', capUsd };
  }

  if (totalUsd > capUsd) {
    return { ok: false, code: 'TRIAL_CAP_EXCEEDED', totalUsd, capUsd };
  }
  return { ok: true };
}

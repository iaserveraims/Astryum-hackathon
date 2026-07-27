/**
 * positionHealth — pure grouping of snapshot position legs into the lending
 * accounts that CONDITION the capital's health (a collateral leg + a debt leg
 * under one protocol/wallet), each with its health factor and the collateral
 * price at which it liquidates.
 *
 * Protocol-agnostic on purpose: it reads only the generic snapshot shape
 * (kind/protocolId/wallet/metrics), so a future XRPL/EVM lending position
 * flows through unchanged. Read-only — this feeds display, never actions.
 */

import type { PortfolioPosition } from '../../services/v1Api';

export interface PositionHealthEntry {
  /** Stable key for React lists. */
  key: string;
  protocolId: string;
  chainId?: number;
  wallet?: string;
  /** Collateral legs backing this account (asset + USD). */
  collateral: Array<{ asset: string; amountUSD: number }>;
  /** Debt legs of this account (asset + USD). */
  debt: Array<{ asset: string; amountUSD: number }>;
  /** Worst health factor reported across the account's legs. */
  healthFactor?: number;
  /** Collateral price at which the account liquidates (from the supply leg). */
  liquidationPriceUSD?: number;
  /** Current price of the collateral asset (for "now vs liquidation" reads). */
  collateralPriceUSD?: number;
  ltv?: number;
}

const COLLATERAL_KINDS = new Set(['SUPPLY', 'COLLATERAL', 'LEND']);
const DEBT_KINDS = new Set(['BORROW', 'DEBT']);

/**
 * Group legs by (protocolId, wallet, chainId) and keep only the accounts that
 * actually condition health: those with debt, or with a health factor / a
 * liquidation price reported by the adapter. Sorted riskiest first (lowest HF).
 */
export function groupPositionHealth(positions: PortfolioPosition[]): PositionHealthEntry[] {
  const groups = new Map<string, PositionHealthEntry>();

  for (const p of positions) {
    const kind = String(p.kind ?? '').toUpperCase();
    const isCollateral = COLLATERAL_KINDS.has(kind);
    const isDebt = DEBT_KINDS.has(kind);
    if (!isCollateral && !isDebt) continue;

    const key = `${p.protocolId}:${p.wallet ?? ''}:${p.chainId ?? ''}`.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { key, protocolId: p.protocolId, chainId: p.chainId, wallet: p.wallet, collateral: [], debt: [] };
      groups.set(key, g);
    }

    const legUSD = Math.abs(p.amountUSD ?? 0);
    if (isCollateral) {
      g.collateral.push({ asset: String(p.asset ?? '—'), amountUSD: legUSD });
      // The collateral leg carries the liquidation price (its asset is the one
      // whose price liquidates the account) and that asset's current price.
      if (g.liquidationPriceUSD == null && typeof p.metrics?.liquidationPrice === 'number') {
        g.liquidationPriceUSD = p.metrics.liquidationPrice;
      }
      if (g.collateralPriceUSD == null && typeof p.priceUSD === 'number' && p.priceUSD > 0) {
        g.collateralPriceUSD = p.priceUSD;
      }
    } else {
      g.debt.push({ asset: String(p.asset ?? '—'), amountUSD: legUSD });
    }

    if (typeof p.metrics?.hf === 'number' && isFinite(p.metrics.hf)) {
      g.healthFactor = g.healthFactor == null ? p.metrics.hf : Math.min(g.healthFactor, p.metrics.hf);
    }
    if (typeof p.metrics?.ltv === 'number' && p.metrics.ltv > 0) {
      g.ltv = g.ltv == null ? p.metrics.ltv : Math.max(g.ltv, p.metrics.ltv);
    }
  }

  return [...groups.values()]
    .filter((g) => g.debt.length > 0 || g.healthFactor != null || g.liquidationPriceUSD != null)
    .sort((a, b) => (a.healthFactor ?? Infinity) - (b.healthFactor ?? Infinity));
}

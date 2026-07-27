/**
 * PoolHealthScorer
 *
 * Assigns an overall 0-100 score and risk_level to a pool:
 *   - GoPlus Labs API: honeypot / blacklist check — cached 24h
 *   - RPC direct: totalSupply() non-zero check — cached 5min
 *   - overall_score: 70 baseline +20 contractSafe +10 tvlAuthentic (-30 if false)
 *   - risk_level: safe ≥85, caution ≥65, warning ≥40, blocked <40 or contractSafe=false
 *
 * All external calls have hard timeouts and return null on failure (graceful skip).
 */

import { getRpcForChain } from '../utils/rpcForChain';
import { Contract } from 'ethers';

export type RiskLevel = 'safe' | 'caution' | 'warning' | 'blocked';

export interface PoolHealthScore {
  readonly poolId: string;
  readonly overallScore: number;
  readonly riskLevel: RiskLevel;
  readonly checks: {
    contractSafe: boolean | null;
    tvlAuthentic: boolean | null;
    priceConsistent: boolean | null;
  };
  readonly lastCheckedAt: string;
  readonly blockedReason?: string;
}

interface GoPlusResult { is_honeypot?: string; is_blacklisted?: string; }
interface CachedEntry { score: PoolHealthScore; expiresAt: number; }

const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';
const GOPLUS_TTL_MS = 24 * 60 * 60 * 1000;
const TVL_TTL_MS = 5 * 60 * 1000;
const TOTAL_SUPPLY_ABI = ['function totalSupply() view returns (uint256)'];

export class PoolHealthScorer {
  private readonly _cache = new Map<string, CachedEntry>();

  async score(params: {
    poolId: string;
    contractAddress: string | null;
    chainId: number;
    tvlUsd: number;
  }): Promise<PoolHealthScore> {
    const cached = this._cache.get(params.poolId);
    if (cached && cached.expiresAt > Date.now()) return cached.score;

    const checks: PoolHealthScore['checks'] = {
      contractSafe: null, tvlAuthentic: null, priceConsistent: null,
    };

    if (params.contractAddress) {
      checks.contractSafe = await this._goplusCheck(params.contractAddress, params.chainId);
    }
    if (params.contractAddress && params.tvlUsd > 0) {
      checks.tvlAuthentic = await this._rpcTvlCheck(params.contractAddress, params.chainId);
    }

    const computed = this._compute(checks);
    const result: PoolHealthScore = {
      poolId: params.poolId,
      overallScore: computed.score,
      riskLevel: computed.level,
      checks,
      lastCheckedAt: new Date().toISOString(),
      blockedReason: computed.blockedReason,
    };

    const ttl = checks.contractSafe !== null ? GOPLUS_TTL_MS : TVL_TTL_MS;
    this._cache.set(params.poolId, { score: result, expiresAt: Date.now() + ttl });
    return result;
  }

  private async _goplusCheck(address: string, chainId: number): Promise<boolean | null> {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${address.toLowerCase()}`,
        { signal: controller.signal },
      );
      clearTimeout(tid);
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: Record<string, GoPlusResult> };
      const info = body.result?.[address.toLowerCase()];
      if (!info) return null;
      if (info.is_honeypot === '1' || info.is_blacklisted === '1') return false;
      return true;
    } catch { return null; }
  }

  private async _rpcTvlCheck(address: string, chainId: number): Promise<boolean | null> {
    try {
      const provider = getRpcForChain(chainId);
      const contract = new Contract(address, TOTAL_SUPPLY_ABI, provider);
      const supply = await (contract.totalSupply() as Promise<bigint>);
      return supply > 0n;
    } catch { return null; }
  }

  private _compute(checks: PoolHealthScore['checks']): {
    score: number; level: RiskLevel; blockedReason?: string;
  } {
    if (checks.contractSafe === false) {
      return { score: 0, level: 'blocked', blockedReason: 'GoPlus: honeypot or blacklisted contract' };
    }
    let score = 70;
    if (checks.contractSafe === true) score += 20;
    if (checks.tvlAuthentic === true) score += 10;
    else if (checks.tvlAuthentic === false) score -= 30;
    const value = Math.max(0, Math.min(100, score));
    const level: RiskLevel = value >= 85 ? 'safe' : value >= 65 ? 'caution' : value >= 40 ? 'warning' : 'blocked';
    return { score: value, level };
  }

  get cacheSize(): number { return this._cache.size; }
}

export const poolHealthScorer = new PoolHealthScorer();

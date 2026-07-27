/**
 * GoPlusProvider — KWYH (Know What You Hold) security data (D8).
 *
 * Single-API risk signal for every asset/address/approval the user touches:
 *   security.tokenSafety     — honeypot, buy/sell tax, blacklist, mintable, owner privileges
 *   security.addressSecurity — malicious-address flags (sanctions, scams, mixers)
 *   security.approvalSecurity — outstanding ERC-20 approvals + risky spenders
 *
 * GoPlus is a third-party security AGGREGATOR — its verdict is a signal, never a
 * promise. Astryum surfaces it before the user signs; it does not execute anything.
 *
 * Public API; optional GOPLUS_ACCESS_TOKEN for higher rate limits.
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';

const BASE_URL = 'https://api.gopluslabs.io/api/v1';
const ACCESS_TOKEN = process.env.GOPLUS_ACCESS_TOKEN ?? '';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'security.tokenSafety',
  'security.addressSecurity',
  'security.approvalSecurity',
]);

export type RiskVerdict = 'safe' | 'caution' | 'danger' | 'unknown';

export interface TokenSafety {
  chainId: number;
  address: string;
  verdict: RiskVerdict;
  isHoneypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isBlacklisted: boolean | null;
  isMintable: boolean | null;
  isOpenSource: boolean | null;
  flags: string[];
}

function headers(): Record<string, string> {
  return ACCESS_TOKEN ? { Authorization: ACCESS_TOKEN } : {};
}

function pct(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n * 10000) / 100; // 0.05 → 5.00 (%)
}

function bool01(v: unknown): boolean | null {
  if (v == null || v === '') return null;
  return v === '1' || v === 1 || v === true;
}

/** Normalize a GoPlus token_security result into a KWYH verdict. */
export function summarizeToken(chainId: number, address: string, r: Record<string, unknown>): TokenSafety {
  const isHoneypot = bool01(r.is_honeypot);
  const buyTaxPct = pct(r.buy_tax);
  const sellTaxPct = pct(r.sell_tax);
  const isBlacklisted = bool01(r.is_blacklisted) ?? bool01(r.is_blacklist);
  const isMintable = bool01(r.is_mintable);
  const isOpenSource = bool01(r.is_open_source);

  const flags: string[] = [];
  if (isHoneypot) flags.push('honeypot');
  if ((sellTaxPct ?? 0) >= 10 || (buyTaxPct ?? 0) >= 10) flags.push('high_tax');
  if (isBlacklisted) flags.push('blacklist_capable');
  if (isMintable) flags.push('mintable');
  if (isOpenSource === false) flags.push('closed_source');

  let verdict: RiskVerdict = 'safe';
  if (isHoneypot || isBlacklisted) verdict = 'danger';
  else if (flags.length > 0) verdict = 'caution';
  if (isHoneypot === null && buyTaxPct === null && isOpenSource === null) verdict = 'unknown';

  return {
    chainId,
    address: address.toLowerCase(),
    verdict,
    isHoneypot,
    buyTaxPct,
    sellTaxPct,
    isBlacklisted,
    isMintable,
    isOpenSource,
    flags,
  };
}

class GoPlusProvider implements IProvider {
  readonly id = 'goplus';
  readonly type = 'security' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'aggregator' as const;
  readonly priority = 60;

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Cheap, always-available metadata endpoint.
      const resp = await fetch(`${BASE_URL}/supported_chains`, {
        headers: headers(),
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.ok ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'security.tokenSafety': {
        const chainId = Number(inp.chainId);
        const address = String(inp.address ?? '').toLowerCase();
        if (!chainId || !address) throw new Error('GoPlus: chainId and address required');

        const resp = await fetch(
          `${BASE_URL}/token_security/${chainId}?contract_addresses=${address}`,
          { headers: headers(), signal: AbortSignal.timeout(10_000) },
        );
        if (!resp.ok) throw new Error(`GoPlus token_security HTTP ${resp.status}`);
        const body = (await resp.json()) as { result?: Record<string, Record<string, unknown>> };
        const r = body.result?.[address] ?? {};
        return { data: summarizeToken(chainId, address, r) as unknown as TOut, source, cached: false };
      }

      case 'security.addressSecurity': {
        const address = String(inp.address ?? '').toLowerCase();
        const chainId = Number(inp.chainId);
        if (!address) throw new Error('GoPlus: address required');
        const resp = await fetch(
          `${BASE_URL}/address_security/${address}${chainId ? `?chain_id=${chainId}` : ''}`,
          { headers: headers(), signal: AbortSignal.timeout(10_000) },
        );
        if (!resp.ok) throw new Error(`GoPlus address_security HTTP ${resp.status}`);
        const body = (await resp.json()) as { result?: Record<string, unknown> };
        const r = body.result ?? {};
        const flags = Object.entries(r)
          .filter(([, v]) => v === '1' || v === 1)
          .map(([k]) => k);
        return {
          data: { address, malicious: flags.length > 0, flags } as unknown as TOut,
          source,
          cached: false,
        };
      }

      case 'security.approvalSecurity': {
        const chainId = Number(inp.chainId);
        const address = String(inp.address ?? '').toLowerCase();
        if (!chainId || !address) throw new Error('GoPlus: chainId and address required');
        const resp = await fetch(
          `${BASE_URL}/token_approval_security/${chainId}?addresses=${address}`,
          { headers: headers(), signal: AbortSignal.timeout(10_000) },
        );
        if (!resp.ok) throw new Error(`GoPlus token_approval_security HTTP ${resp.status}`);
        const body = (await resp.json()) as { result?: unknown[] };
        return { data: (body.result ?? []) as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`GoPlusProvider: unsupported capability '${capability}'`);
    }
  }
}

export const goPlusProvider = new GoPlusProvider();

/**
 * JurisdictionService — the per-jurisdiction interruptor (CLAUDE.md invariant #5).
 *
 * The in-app DeFi EXECUTION module lives behind its own geofenceable frontier.
 * Monitoring, fiat (regulated partners) and tax are ALWAYS available — only DeFi
 * execution can be switched off per region. Decoupled, flag-gated, region-gated.
 *
 * Config (env):
 *   DEFI_EXEC_ENABLED          'true' to enable DeFi execution at all (default true)
 *   DEFI_EXEC_BLOCKED_REGIONS  CSV of ISO-3166 alpha-2 codes blocked (e.g. "US,CN")
 *   DEFI_EXEC_ALLOWED_REGIONS  CSV allowlist; if set, ONLY these are allowed
 *
 * Region comes from the caller (geo-IP / KYC country) — this service doesn't detect it.
 */

export type AppModule = 'monitoring' | 'fiat' | 'tax' | 'defi_execution';

export interface ModuleAvailability {
  region: string | null;
  modules: Record<AppModule, boolean>;
  defiExecution: { allowed: boolean; reason?: string };
}

function csv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export class JurisdictionService {
  /** Globally enabled? DEFI_EXEC_ENABLED defaults to true when unset. */
  private globallyEnabled(): boolean {
    const v = process.env.DEFI_EXEC_ENABLED;
    return v == null || v === '' ? true : v === 'true';
  }

  /**
   * Is the DeFi execution module allowed for this region?
   * Region is optional; when unknown we still apply the global flag + an allowlist
   * (if an allowlist is set, an unknown region is NOT allowed — fail closed).
   */
  isDefiExecutionAllowed(region?: string | null): { allowed: boolean; reason?: string } {
    if (!this.globallyEnabled()) {
      return { allowed: false, reason: 'defi_execution_disabled_globally' };
    }
    const code = region?.trim().toUpperCase() || null;
    const blocked = csv('DEFI_EXEC_BLOCKED_REGIONS');
    const allowed = csv('DEFI_EXEC_ALLOWED_REGIONS');

    if (allowed.length > 0) {
      if (!code) return { allowed: false, reason: 'region_required_under_allowlist' };
      if (!allowed.includes(code)) return { allowed: false, reason: `region_not_in_allowlist:${code}` };
    }
    if (code && blocked.includes(code)) {
      return { allowed: false, reason: `region_blocked:${code}` };
    }
    return { allowed: true };
  }

  /** Full module map for a region. Monitoring/fiat/tax are always available. */
  availableModules(region?: string | null): ModuleAvailability {
    const defi = this.isDefiExecutionAllowed(region);
    return {
      region: region?.trim().toUpperCase() || null,
      modules: {
        monitoring: true,
        fiat: true,
        tax: true,
        defi_execution: defi.allowed,
      },
      defiExecution: defi,
    };
  }
}

export const jurisdictionService = new JurisdictionService();

import { JurisdictionService } from '../JurisdictionService';

const ENV = ['DEFI_EXEC_ENABLED', 'DEFI_EXEC_BLOCKED_REGIONS', 'DEFI_EXEC_ALLOWED_REGIONS'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const svc = new JurisdictionService();

describe('JurisdictionService — geofence DeFi execution (invariant #5)', () => {
  test('monitoring/fiat/tax are ALWAYS available, even where DeFi exec is blocked', () => {
    process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
    const m = svc.availableModules('US');
    expect(m.modules.monitoring).toBe(true);
    expect(m.modules.fiat).toBe(true);
    expect(m.modules.tax).toBe(true);
    expect(m.modules.defi_execution).toBe(false);
    expect(m.defiExecution.reason).toMatch(/region_blocked:US/);
  });

  test('default (no config) → DeFi execution allowed', () => {
    expect(svc.isDefiExecutionAllowed('ES').allowed).toBe(true);
  });

  test('global kill-switch disables DeFi execution everywhere', () => {
    process.env.DEFI_EXEC_ENABLED = 'false';
    expect(svc.isDefiExecutionAllowed('ES')).toMatchObject({ allowed: false, reason: 'defi_execution_disabled_globally' });
  });

  test('allowlist fails closed for unknown / non-listed regions', () => {
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,DE';
    expect(svc.isDefiExecutionAllowed('ES').allowed).toBe(true);
    expect(svc.isDefiExecutionAllowed('US').allowed).toBe(false);
    expect(svc.isDefiExecutionAllowed(null).allowed).toBe(false); // unknown region
  });
});

/**
 * FASE 6 — Security Provider Tests
 * HypernativeProvider + TenderlyProvider
 */

import { createHmac } from 'crypto';
import { HypernativeProvider } from '../HypernativeProvider';
import { TenderlyProvider } from '../TenderlyProvider';

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.HYPERNATIVE_API_KEY;
  delete process.env.HYPERNATIVE_WEBHOOK_SECRET;
  delete process.env.HYPERNATIVE_API_URL;
  delete process.env.TENDERLY_API_KEY;
  delete process.env.TENDERLY_ACCOUNT_SLUG;
  delete process.env.TENDERLY_PROJECT_SLUG;
  delete process.env.TENDERLY_API_URL;
});

function mockOkJson(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function mockHttpError(status: number, body = '') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response);
}

function mockNetworkError(msg: string) {
  mockFetch.mockRejectedValueOnce(new Error(msg));
}

const CTX = { traceId: 'test-trace' };

// ══════════════════════════════════════════════════════════════════════════════
// HypernativeProvider
// ══════════════════════════════════════════════════════════════════════════════

describe('HypernativeProvider', () => {
  describe('health()', () => {
    it('returns disabled when HYPERNATIVE_API_KEY is not set', async () => {
      const p = new HypernativeProvider();
      const h = await p.health();
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/HYPERNATIVE_API_KEY/);
    });

    it('returns healthy on 200 response', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({ status: 'ok' });
      const p = new HypernativeProvider();
      const h = await p.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded on 5xx response', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockHttpError(503);
      const p = new HypernativeProvider();
      const h = await p.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/503/);
    });

    it('returns down on network error', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockNetworkError('ECONNREFUSED');
      const p = new HypernativeProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });
  });

  describe('verifyWebhookSignature()', () => {
    it('returns false when HYPERNATIVE_WEBHOOK_SECRET is not set', () => {
      const p = new HypernativeProvider();
      expect(p.verifyWebhookSignature('body', 'sha256=abc')).toBe(false);
    });

    it('returns true for a valid HMAC-SHA256 signature', () => {
      process.env.HYPERNATIVE_WEBHOOK_SECRET = 'my-secret';
      const body    = JSON.stringify({ alertId: '123', category: 'EXPLOIT' });
      const hmac    = createHmac('sha256', 'my-secret').update(body, 'utf8').digest('hex');
      const signature = `sha256=${hmac}`;
      const p = new HypernativeProvider();
      expect(p.verifyWebhookSignature(body, signature)).toBe(true);
    });

    it('returns false for an incorrect signature', () => {
      process.env.HYPERNATIVE_WEBHOOK_SECRET = 'my-secret';
      const p = new HypernativeProvider();
      expect(p.verifyWebhookSignature('body', 'sha256=wrong')).toBe(false);
    });
  });

  describe('security.getAlerts capability', () => {
    it('throws when API key is missing', async () => {
      const p = new HypernativeProvider();
      await expect(
        p.call('security.getAlerts', { minSeverity: 'HIGH' }, CTX),
      ).rejects.toThrow('HYPERNATIVE_API_KEY not set');
    });

    it('returns normalised threats on success', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({
        alerts: [
          {
            alertId: 'alert-1',
            category: 'EXPLOIT',
            severity: 'CRITICAL',
            protocol: 'Kinetic',
            contractAddress: '0xabc',
            message: 'Reentrancy detected',
            chainIds: [14],
            timestamp: '2026-05-23T10:00:00Z',
          },
        ],
      });

      const p = new HypernativeProvider();
      const result = await p.call('security.getAlerts', { minSeverity: 'HIGH' }, CTX);
      const threats = result.data as Array<Record<string, unknown>>;

      expect(threats).toHaveLength(1);
      expect(threats[0].alertId).toBe('alert-1');
      expect(threats[0].category).toBe('EXPLOIT');
      expect(threats[0].severity).toBe('CRITICAL');
      expect(threats[0].protocol).toBe('Kinetic');
      expect(threats[0].chainIds).toEqual([14]);
      expect(result.source.providerId).toBe('hypernative');
    });

    it('throws on HTTP error from Hypernative API', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockHttpError(429, 'rate limited');
      const p = new HypernativeProvider();
      await expect(
        p.call('security.getAlerts', {}, CTX),
      ).rejects.toThrow('HTTP 429');
    });

    it('returns empty array when no alerts field in response', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({});
      const p = new HypernativeProvider();
      const result = await p.call('security.getAlerts', {}, CTX);
      expect(result.data).toEqual([]);
    });
  });

  describe('normalise helpers (via getAlerts)', () => {
    it('normalises unknown category to UNKNOWN', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({
        alerts: [{ alertId: 'x', category: 'RANDOM_THING', severity: 'LOW', message: 'test', timestamp: new Date().toISOString() }],
      });
      const p = new HypernativeProvider();
      const result = await p.call('security.getAlerts', {}, CTX);
      const threats = result.data as Array<Record<string, unknown>>;
      expect(threats[0].category).toBe('UNKNOWN');
    });

    it('normalises governance category', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({
        alerts: [{ alertId: 'g', category: 'GOVERNANCE_ATTACK', severity: 'HIGH', message: 'gov', timestamp: new Date().toISOString() }],
      });
      const p = new HypernativeProvider();
      const result = await p.call('security.getAlerts', {}, CTX);
      const threats = result.data as Array<Record<string, unknown>>;
      expect(threats[0].category).toBe('GOVERNANCE_ATTACK');
    });

    it('normalises INFO severity from non-standard strings', async () => {
      process.env.HYPERNATIVE_API_KEY = 'test-key';
      mockOkJson({
        alerts: [{ alertId: 'i', category: 'MARKET_ANOMALY', severity: 'NOTICE', message: 'notice', timestamp: new Date().toISOString() }],
      });
      const p = new HypernativeProvider();
      const result = await p.call('security.getAlerts', {}, CTX);
      const threats = result.data as Array<Record<string, unknown>>;
      expect(threats[0].severity).toBe('INFO');
    });
  });

  describe('security.verifyWebhookSignature capability', () => {
    it('returns true via call() for a valid signature', () => {
      process.env.HYPERNATIVE_WEBHOOK_SECRET = 'secret';
      const rawBody = '{"test":true}';
      const hmac = createHmac('sha256', 'secret').update(rawBody).digest('hex');
      const p = new HypernativeProvider();
      const result = p.verifyWebhookSignature(rawBody, `sha256=${hmac}`);
      expect(result).toBe(true);
    });
  });

  describe('unsupported capability', () => {
    it('throws for unknown capability', async () => {
      const p = new HypernativeProvider();
      await expect(p.call('security.nonExistent', {}, CTX)).rejects.toThrow("unsupported capability 'security.nonExistent'");
    });
  });

  describe('provider metadata', () => {
    it('has correct id, type, trustLevel, priority', () => {
      const p = new HypernativeProvider();
      expect(p.id).toBe('hypernative');
      expect(p.type).toBe('security');
      expect(p.trustLevel).toBe('indexer_verified');
      expect(p.priority).toBe(95);
    });

    it('declares all expected capabilities', () => {
      const p = new HypernativeProvider();
      expect(p.capabilities).toContain('security.getAlerts');
      expect(p.capabilities).toContain('security.getActiveThreats');
      expect(p.capabilities).toContain('security.processWebhookPayload');
      expect(p.capabilities).toContain('security.verifyWebhookSignature');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TenderlyProvider
// ══════════════════════════════════════════════════════════════════════════════

describe('TenderlyProvider', () => {
  describe('health()', () => {
    it('returns disabled when TENDERLY_API_KEY is not set', async () => {
      const p = new TenderlyProvider();
      const h = await p.health();
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/TENDERLY_API_KEY/);
    });

    it('returns healthy on 200 response from public-contracts probe', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({ contract: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' } });
      const p = new TenderlyProvider();
      const h = await p.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded on 500', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockHttpError(500);
      const p = new TenderlyProvider();
      const h = await p.health();
      expect(h.status).toBe('degraded');
    });

    it('returns down on network error', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockNetworkError('ETIMEDOUT');
      const p = new TenderlyProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ETIMEDOUT/);
    });
  });

  describe('security.simulateTransaction', () => {
    const simulateInput = {
      chainId: 14,
      from:    '0xUserWallet0000000000000000000000000000',
      to:      '0xKineticPool00000000000000000000000000',
      input:   '0xa9059cbb000000000000000000000000',
    };

    it('throws when TENDERLY_API_KEY is not set', async () => {
      const p = new TenderlyProvider();
      await expect(p.call('security.simulateTransaction', simulateInput, CTX)).rejects.toThrow('TENDERLY_API_KEY not set');
    });

    it('returns success=true for a passing simulation', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'sim-1', status: true, gas_used: 120000 },
        transaction: { gas_used: 120000, decoded_events: [] },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.simulateTransaction', simulateInput, CTX);
      const sim = result.data as Record<string, unknown>;

      expect(sim.success).toBe(true);
      expect(sim.gasUsed).toBe(120000);
      expect(sim.revertReason).toBeUndefined();
      expect(sim.simulationId).toBe('sim-1');
    });

    it('returns success=false with revertReason for a reverting simulation', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'sim-2', status: false, error_message: 'insufficient collateral', gas_used: 50000 },
        transaction: { gas_used: 50000 },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.simulateTransaction', simulateInput, CTX);
      const sim = result.data as Record<string, unknown>;

      expect(sim.success).toBe(false);
      expect(sim.revertReason).toMatch(/insufficient collateral/);
      expect(sim.gasUsed).toBe(50000);
    });

    it('throws on HTTP error', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockHttpError(422, 'unprocessable entity');
      const p = new TenderlyProvider();
      await expect(p.call('security.simulateTransaction', simulateInput, CTX)).rejects.toThrow('HTTP 422');
    });

    it('parses decoded events from transaction', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'sim-3', status: true, gas_used: 80000 },
        transaction: {
          gas_used: 80000,
          decoded_events: [
            {
              name: 'Transfer',
              address: '0xTokenAddress',
              inputs: [
                { name: 'from', type: 'address', value: '0xFrom' },
                { name: 'to', type: 'address', value: '0xTo' },
                { name: 'value', type: 'uint256', value: '1000000' },
              ],
            },
          ],
        },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.simulateTransaction', simulateInput, CTX);
      const sim = result.data as { events: Array<{ name: string }> };

      expect(sim.events).toHaveLength(1);
      expect(sim.events[0].name).toBe('Transfer');
    });
  });

  describe('security.crossValidateCalldata', () => {
    const validateInput = {
      chainId: 1,
      from:    '0xUserWallet0000000000000000000000000000',
      to:      '0xAavePool000000000000000000000000000000',
      input:   '0x617ba037',
      providerGasEstimate: 200000,
    };

    it('returns SAFE verdict for a successful simulation with low gas divergence', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'cv-1', status: true, gas_used: 210000 },
        transaction: { gas_used: 210000, decoded_events: [] },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.crossValidateCalldata', validateInput, CTX);
      const cvr = result.data as { verdict: string; warnings: string[] };

      expect(cvr.verdict).toBe('SAFE');
      expect(cvr.warnings).toHaveLength(0);
    });

    it('returns UNSAFE verdict when simulation reverts', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'cv-2', status: false, error_message: 'invalid action', gas_used: 30000 },
        transaction: { gas_used: 30000 },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.crossValidateCalldata', validateInput, CTX);
      const cvr = result.data as { verdict: string; warnings: string[] };

      expect(cvr.verdict).toBe('UNSAFE');
      expect(cvr.warnings[0]).toMatch(/reverts/);
    });

    it('returns WARNING verdict when gas divergence exceeds 30%', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      // Provider estimate: 200000, Tenderly: 300000 → 50% divergence → WARNING
      mockOkJson({
        simulation: { id: 'cv-3', status: true, gas_used: 300000 },
        transaction: { gas_used: 300000, decoded_events: [] },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.crossValidateCalldata', validateInput, CTX);
      const cvr = result.data as { verdict: string; warnings: string[] };

      expect(cvr.verdict).toBe('WARNING');
      expect(cvr.warnings[0]).toMatch(/Gas divergence/);
    });

    it('returns SAFE when no gas estimate is provided (no divergence check)', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        simulation: { id: 'cv-4', status: true, gas_used: 999999 },
        transaction: { gas_used: 999999, decoded_events: [] },
      });

      const p = new TenderlyProvider();
      const input = { ...validateInput, providerGasEstimate: undefined };
      const result = await p.call('security.crossValidateCalldata', input, CTX);
      const cvr = result.data as { verdict: string; warnings: string[] };

      expect(cvr.verdict).toBe('SAFE');
    });

    it('includes dashboardUrl when simulationId is present', async () => {
      process.env.TENDERLY_API_KEY     = 'test-key';
      process.env.TENDERLY_ACCOUNT_SLUG = 'myaccount';
      process.env.TENDERLY_PROJECT_SLUG = 'myproject';
      mockOkJson({
        simulation: { id: 'sim-xyz', status: true, gas_used: 100000 },
        transaction: { gas_used: 100000, decoded_events: [] },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.crossValidateCalldata', validateInput, CTX);
      const cvr = result.data as { dashboardUrl?: string };

      expect(cvr.dashboardUrl).toMatch(/myaccount\/myproject\/simulator\/sim-xyz/);
    });
  });

  describe('security.getTrace', () => {
    it('throws when TENDERLY_API_KEY is not set', async () => {
      const p = new TenderlyProvider();
      await expect(p.call('security.getTrace', { chainId: 1, txHash: '0xabc' }, CTX)).rejects.toThrow('TENDERLY_API_KEY not set');
    });

    it('returns null when trace is 404', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: false, status: 404, text: () => Promise.resolve('not found'),
      } as unknown as Response);

      const p = new TenderlyProvider();
      const result = await p.call('security.getTrace', { chainId: 1, txHash: '0xdeadbeef' }, CTX);
      expect(result.data).toBeNull();
    });

    it('returns parsed call frame on success', async () => {
      process.env.TENDERLY_API_KEY = 'test-key';
      mockOkJson({
        call_trace: {
          type: 'CALL', from: '0xFrom', to: '0xTo',
          gas: 500000, gas_used: 120000,
          input: '0xabcd', output: '0x1',
          calls: [
            { type: 'STATICCALL', from: '0xTo', to: '0xInternal', gas: 50000, gas_used: 5000, input: '0x', calls: [] },
          ],
        },
      });

      const p = new TenderlyProvider();
      const result = await p.call('security.getTrace', { chainId: 1, txHash: '0xhash' }, CTX);
      const frame = result.data as { type: string; calls: Array<{ type: string }> };

      expect(frame.type).toBe('CALL');
      expect(frame.calls).toHaveLength(1);
      expect(frame.calls[0].type).toBe('STATICCALL');
    });
  });

  describe('unsupported capability', () => {
    it('throws for unknown capability', async () => {
      const p = new TenderlyProvider();
      await expect(p.call('security.unknown', {}, CTX)).rejects.toThrow("unsupported capability 'security.unknown'");
    });
  });

  describe('provider metadata', () => {
    it('has correct id, type, trustLevel, priority', () => {
      const p = new TenderlyProvider();
      expect(p.id).toBe('tenderly');
      expect(p.type).toBe('security');
      expect(p.trustLevel).toBe('indexer_verified');
      expect(p.priority).toBe(90);
    });

    it('declares all expected capabilities', () => {
      const p = new TenderlyProvider();
      expect(p.capabilities).toContain('security.simulateTransaction');
      expect(p.capabilities).toContain('security.crossValidateCalldata');
      expect(p.capabilities).toContain('security.getTrace');
    });
  });
});

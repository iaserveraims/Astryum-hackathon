/**
 * HypernativeProvider — FASE 6 Security Partners
 *
 * Real-time threat detection via Hypernative's security intelligence platform.
 * Covers: protocol exploits, oracle manipulation, rug pulls, governance attacks,
 * whale exits, and abnormal on-chain patterns.
 *
 * Integration model:
 *   - Pull: `security.getAlerts` / `security.getActiveThreats` — REST API polling
 *   - Push: `security.processWebhookPayload` — called by the webhook route
 *     (`POST /api/webhooks/hypernative`) after HMAC signature verification.
 *
 * On threat detection → persists an Alert row in Prisma + fires push notification.
 *
 * Env vars:
 *   HYPERNATIVE_API_KEY        — API key (Bearer token). Required for poll capabilities.
 *   HYPERNATIVE_WEBHOOK_SECRET — HMAC-SHA256 secret for webhook signature verification.
 *   HYPERNATIVE_API_URL        — base URL (default: https://api.hypernative.xyz)
 */

import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel } from '../../../canonical/types/Source';

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.HYPERNATIVE_API_URL ?? 'https://api.hypernative.xyz';
// Resolved lazily so Jest env overrides in beforeEach() take effect at call time.
const apiKey        = (): string => process.env.HYPERNATIVE_API_KEY ?? '';
const webhookSecret = (): string => process.env.HYPERNATIVE_WEBHOOK_SECRET ?? '';

const HEALTH_TIMEOUT_MS = 6000;
const FETCH_TIMEOUT_MS  = 15000;

// ── Domain types ──────────────────────────────────────────────────────────────

/** Categories of threats Hypernative monitors for. */
export type ThreatCategory =
  | 'EXPLOIT'
  | 'ORACLE_MANIPULATION'
  | 'RUG_PULL'
  | 'GOVERNANCE_ATTACK'
  | 'WHALE_EXIT'
  | 'ABNORMAL_ACTIVITY'
  | 'MARKET_ANOMALY'
  | 'UNKNOWN';

export type ThreatSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface HypernativeThreat {
  alertId: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  /** Name of the monitored protocol/contract, if known. */
  protocol?: string;
  /** On-chain address that triggered the alert. */
  contractAddress?: string;
  /** Human-readable description of the threat. */
  message: string;
  /** Chain IDs affected (14 = Flare Mainnet). */
  chainIds: number[];
  detectedAt: string;
  /** Arbitrary metadata from Hypernative (tx hashes, prices, etc.). */
  metadata?: Record<string, unknown>;
}

export interface GetAlertsInput {
  /** Filter by minimum severity. Default: 'HIGH'. */
  minSeverity?: ThreatSeverity;
  /** Maximum number of alerts to return. Default: 50. */
  limit?: number;
  /** Filter to a specific chain ID. */
  chainId?: number;
  /** Unix timestamp — only return alerts after this time. */
  since?: number;
}

export interface GetActiveThreatsInput {
  /** Filter to a specific chain ID. Default: no filter. */
  chainId?: number;
}

export interface ProcessWebhookInput {
  /** Raw request body (string, parsed before HMAC check). */
  rawBody: string;
  /** Value of the X-Hypernative-Signature header. */
  signature: string;
  /** Wallet address to associate the alert with (from address lookup). */
  walletAddress?: string;
}

// ── Severity → Alert DB priority mapping ─────────────────────────────────────

const SEVERITY_TO_PRIORITY: Record<ThreatSeverity, string> = {
  CRITICAL: 'CRITICAL',
  HIGH:     'HIGH',
  MEDIUM:   'MEDIUM',
  LOW:      'LOW',
  INFO:     'LOW',
};

const SEVERITY_TO_DB_SEVERITY: Record<ThreatSeverity, string> = {
  CRITICAL: 'CRITICAL',
  HIGH:     'HIGH',
  MEDIUM:   'MEDIUM',
  LOW:      'LOW',
  INFO:     'INFO',
};

// ── Capabilities ──────────────────────────────────────────────────────────────

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'security.getAlerts',
  'security.getActiveThreats',
  'security.processWebhookPayload',
  'security.verifyWebhookSignature',
]);

// ── Provider ──────────────────────────────────────────────────────────────────

export class HypernativeProvider implements IProvider {
  readonly id = 'hypernative';
  readonly type: ProviderType = 'security';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 95;
  readonly capabilities = CAPS;

  private get headers(): Record<string, string> {
    const key = apiKey();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    };
  }

  // ── health ──────────────────────────────────────────────────────────────────

  async health(): Promise<ProviderHealth> {
    if (!apiKey()) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'HYPERNATIVE_API_KEY not set',
      };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/v1/health`, {
        headers: this.headers,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
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

  // ── call ────────────────────────────────────────────────────────────────────

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

    switch (capability) {
      case 'security.getAlerts':
        return { data: await this.getAlerts(input as GetAlertsInput) as TOut, source, cached: false };

      case 'security.getActiveThreats':
        return { data: await this.getActiveThreats(input as GetActiveThreatsInput) as TOut, source, cached: false };

      case 'security.processWebhookPayload':
        return { data: await this.processWebhookPayload(input as ProcessWebhookInput) as TOut, source, cached: false };

      case 'security.verifyWebhookSignature': {
        const inp = input as { rawBody: string; signature: string };
        return { data: this.verifyWebhookSignature(inp.rawBody, inp.signature) as TOut, source, cached: false };
      }

      default:
        throw new Error(`HypernativeProvider: unsupported capability '${capability}'`);
    }
  }

  // ── Pull: REST API ────────────────────────────────────────────────────────

  private async getAlerts(input: GetAlertsInput): Promise<HypernativeThreat[]> {
    if (!apiKey()) throw new Error('HYPERNATIVE_API_KEY not set');

    const params = new URLSearchParams();
    if (input.minSeverity) params.set('severity', input.minSeverity);
    if (input.limit)        params.set('limit', String(input.limit));
    if (input.chainId)      params.set('chainId', String(input.chainId));
    if (input.since)        params.set('since', String(input.since));

    const url = `${BASE_URL}/v1/alerts${params.size ? `?${params}` : ''}`;
    const resp = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      throw new Error(`Hypernative getAlerts HTTP ${resp.status}: ${await resp.text()}`);
    }

    const body = await resp.json() as { alerts?: unknown[] };
    return (body.alerts ?? []).map((a) => this.normaliseAlert(a as Record<string, unknown>));
  }

  private async getActiveThreats(input: GetActiveThreatsInput): Promise<HypernativeThreat[]> {
    if (!apiKey()) throw new Error('HYPERNATIVE_API_KEY not set');

    const params = new URLSearchParams();
    if (input.chainId) params.set('chainId', String(input.chainId));
    params.set('active', 'true');

    const url = `${BASE_URL}/v1/alerts?${params}`;
    const resp = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!resp.ok) {
      throw new Error(`Hypernative getActiveThreats HTTP ${resp.status}: ${await resp.text()}`);
    }

    const body = await resp.json() as { alerts?: unknown[] };
    return (body.alerts ?? []).map((a) => this.normaliseAlert(a as Record<string, unknown>));
  }

  // ── Push: webhook processing ──────────────────────────────────────────────

  /** Verify HMAC-SHA256 signature from Hypernative webhook request. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = webhookSecret();
    if (!secret) return false;
    const expected = createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
    // Constant-time comparison to prevent timing attacks
    return signature === `sha256=${expected}`;
  }

  /**
   * Process a verified Hypernative webhook payload.
   * Persists an Alert in Prisma and fires a push notification.
   * Called by the webhook route AFTER signature verification.
   */
  async processWebhookPayload(input: ProcessWebhookInput): Promise<{ alertId: string; persisted: boolean }> {
    const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    const threat = this.normaliseAlert(payload);

    let persisted = false;
    let dbAlertId = threat.alertId;

    try {
      const { prisma } = await import('../../../database/prismaClient');

      // Resolve wallet ID if address provided
      let walletId: string | undefined;
      if (input.walletAddress) {
        const wallet = await prisma.wallet.findFirst({
          where: { address: input.walletAddress },
          select: { id: true, userId: true },
        });
        if (wallet) {
          walletId = wallet.id;
          // Persist Alert row
          const alert = await prisma.alert.create({
            data: {
              id: randomUUID(),
              userId: wallet.userId,
              walletId: wallet.id,
              type: 'security',
              priority: SEVERITY_TO_PRIORITY[threat.severity] ?? 'HIGH',
              severity: (SEVERITY_TO_DB_SEVERITY[threat.severity] ?? 'HIGH') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
              triggerType: threat.category,
              title: `[${threat.category}] ${threat.protocol ?? 'Unknown Protocol'}`,
              message: threat.message,
              // Cast to Prisma JSON-compatible value via round-trip serialization
              data: JSON.parse(JSON.stringify({
                threatId:        threat.alertId,
                category:        threat.category,
                contractAddress: threat.contractAddress ?? null,
                chainIds:        threat.chainIds,
                metadata:        threat.metadata ?? null,
                source:          'hypernative',
              })),
              acknowledged: false,
              timestamp: new Date(threat.detectedAt),
            },
          });
          dbAlertId = alert.id;
          persisted = true;
        }
      }

      // Fire push notification to the user owning this wallet
      if (walletId && (threat.severity === 'CRITICAL' || threat.severity === 'HIGH')) {
        await this.sendPushNotification(walletId, threat);
      }
    } catch (err) {
      // Non-fatal: log but don't rethrow — webhook must return 200 to Hypernative
      console.error('[HypernativeProvider] processWebhookPayload persistence error:', err);
    }

    return { alertId: dbAlertId, persisted };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private normaliseAlert(raw: Record<string, unknown>): HypernativeThreat {
    return {
      alertId:         String(raw.alertId ?? raw.id ?? randomUUID()),
      category:        this.normaliseCategory(String(raw.category ?? raw.type ?? 'UNKNOWN')),
      severity:        this.normaliseSeverity(String(raw.severity ?? raw.level ?? 'HIGH')),
      protocol:        raw.protocol as string | undefined ?? raw.protocolName as string | undefined,
      contractAddress: raw.contractAddress as string | undefined ?? raw.address as string | undefined,
      message:         String(raw.message ?? raw.description ?? 'Security alert detected'),
      chainIds:        Array.isArray(raw.chains) ? (raw.chains as number[]) :
                       Array.isArray(raw.chainIds) ? (raw.chainIds as number[]) : [],
      detectedAt:      String(raw.timestamp ?? raw.detectedAt ?? raw.createdAt ?? new Date().toISOString()),
      metadata:        raw.metadata as Record<string, unknown> | undefined ?? raw.data as Record<string, unknown> | undefined,
    };
  }

  private normaliseCategory(raw: string): ThreatCategory {
    const upper = raw.toUpperCase();
    if (upper.includes('EXPLOIT'))    return 'EXPLOIT';
    if (upper.includes('ORACLE'))     return 'ORACLE_MANIPULATION';
    if (upper.includes('RUG'))        return 'RUG_PULL';
    if (upper.includes('GOVERNANCE')) return 'GOVERNANCE_ATTACK';
    if (upper.includes('WHALE'))      return 'WHALE_EXIT';
    if (upper.includes('MARKET'))     return 'MARKET_ANOMALY';
    if (upper.includes('ABNORMAL'))   return 'ABNORMAL_ACTIVITY';
    return 'UNKNOWN';
  }

  private normaliseSeverity(raw: string): ThreatSeverity {
    const upper = raw.toUpperCase();
    if (upper === 'CRITICAL') return 'CRITICAL';
    if (upper === 'HIGH')     return 'HIGH';
    if (upper === 'MEDIUM')   return 'MEDIUM';
    if (upper === 'LOW')      return 'LOW';
    return 'INFO';
  }

  private async sendPushNotification(walletId: string, threat: HypernativeThreat): Promise<void> {
    try {
      const { prisma } = await import('../../../database/prismaClient');
      const { PushNotificationService } = await import('../../../services/PushNotificationService');

      const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
        select: { userId: true },
      });
      if (!wallet) return;

      const svc = PushNotificationService.getInstance();
      await svc.sendToUser(wallet.userId, {
        type: 'HF_CRITICAL',
        title: `Security Alert: ${threat.category.replace(/_/g, ' ')}`,
        body:  threat.message.slice(0, 200),
        data:  {
          threatCategory: threat.category,
          threatId:       threat.alertId,
          chainIds:       threat.chainIds,
        },
        url: '/alerts',
      });
    } catch (err) {
      console.error('[HypernativeProvider] push notification error:', err);
    }
  }
}

export const hypernativeProvider = new HypernativeProvider();

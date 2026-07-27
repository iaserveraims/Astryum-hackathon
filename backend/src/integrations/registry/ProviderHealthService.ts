import { IntegrationRegistry, registry as defaultRegistry } from './IntegrationRegistry';
import type { ProviderHealth } from '../interfaces/IProvider';

const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 60_000;
/** Ticks 'down' consecutivos antes de alertar — evita el flapping de un blip. */
const DOWN_TICKS_BEFORE_ALERT = 3;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HEALTH_TIMEOUT_${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class ProviderHealthService {
  private timer: NodeJS.Timeout | null = null;
  /** ticks 'down' consecutivos por provider (se resetea al primer verde). */
  private downTicks = new Map<string, number>();
  /** providers cuya caída ya se alertó — su recuperación también se alerta. */
  private alertedDown = new Set<string>();

  constructor(
    private readonly registry: IntegrationRegistry = defaultRegistry,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    const providers = this.registry.list();
    await Promise.all(
      providers.map(async (p) => {
        const start = Date.now();
        try {
          const h = await withTimeout(p.health(), HEALTH_TIMEOUT_MS);
          const enriched: ProviderHealth = {
            ...h,
            latencyMs: h.latencyMs ?? Date.now() - start,
            lastCheckAt: h.lastCheckAt ?? new Date().toISOString(),
          };
          this.registry.updateHealth(p.id, enriched);
          await this.trackTransition(p.id, enriched.status !== 'down');
        } catch (err) {
          this.registry.updateHealth(p.id, {
            status: 'down',
            latencyMs: Date.now() - start,
            lastCheckAt: new Date().toISOString(),
            reason: (err as Error).message,
          });
          await this.trackTransition(p.id, false, (err as Error).message);
        }
      }),
    );
  }

  /**
   * Alerta de transición (Ola 1 de la doctrina agéntica): el registry ya
   * guardaba el estado, pero nadie se enteraba. 3 ticks 'down' consecutivos
   * (~3 min) → warn por el canal común; recuperación tras haber alertado →
   * info. Sin flag: sin webhook configurado esto es solo log, como antes.
   */
  private async trackTransition(id: string, healthy: boolean, reason?: string): Promise<void> {
    if (healthy) {
      this.downTicks.delete(id);
      if (this.alertedDown.delete(id)) {
        const { opsAlert } = await import('../../services/OpsAlertService');
        await opsAlert('provider-health', 'info', `provider ${id} recuperado`);
      }
      return;
    }
    const n = (this.downTicks.get(id) ?? 0) + 1;
    this.downTicks.set(id, n);
    if (n === DOWN_TICKS_BEFORE_ALERT && !this.alertedDown.has(id)) {
      this.alertedDown.add(id);
      const { opsAlert } = await import('../../services/OpsAlertService');
      await opsAlert(
        'provider-health',
        'warn',
        `provider ${id} lleva ${n} chequeos seguidos caído${reason ? ` (${reason})` : ''}`,
      );
    }
  }
}

export const providerHealthService = new ProviderHealthService();

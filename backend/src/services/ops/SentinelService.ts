/**
 * SentinelService — el vigía de los vigías.
 *
 * Los agentes de Astryum ya avisaban de lo que les pasaba MIENTRAS corrían
 * (executor 0xFE, provider-health, relayer). El hueco era el otro: lo que NO
 * pasa no emite nada. El 31-jul el watcher se quedó 5 horas ciego sirviendo
 * una ventana XRPL congelada y el canal estuvo en silencio todo ese rato —
 * porque un tick que no encuentra nada y un tick que no corre se parecen
 * demasiado desde fuera.
 *
 * Este servicio da la vuelta al planteamiento: cada N minutos PREGUNTA por el
 * estado de cada carril (probes), compara con el estado anterior y solo abre
 * la boca cuando algo CAMBIA — se rompe, empeora, mejora o se resuelve. Cada
 * aviso lleva el objeto afectado (hash/cuenta/importe) y la línea de arreglo,
 * de modo que el texto que llega al móvil basta para actuar:
 *
 *   🔴 CRITICAL · sentinel/executor-pendientes
 *   la tx 7BFC…65F (12.5 XRP de rN7n…) lleva 47 min pillada en el executor
 *   hash: 7BFC…65F · xrp: 12.5 · fallos: 3
 *   ↳ Arreglo: /app/admin → Sistema → Desatascar → Reintentar en esa fila.
 *
 * Tres propiedades que lo hacen fiable:
 *  · Antifrágil al ruido — un aviso por objeto y por transición; los críticos
 *    se recuerdan cada hora, los warns cada 6h, y la RESOLUCIÓN también se
 *    anuncia (si no, nadie sabe cuándo dejar de mirar).
 *  · Verdad en el panel — el snapshot vive en /app/admin (regla del fundador:
 *    los gauges no viven en la consola), aunque no haya webhook configurado.
 *  · Interruptor de hombre muerto — si el proceso ENTERO muere, ningún vigía
 *    interno puede avisar. Por eso cada pasada hace ping a OPS_HEARTBEAT_URL
 *    (healthchecks.io / Better Stack): el silencio lo detecta alguien de fuera.
 *
 * Read-only por construcción: los probes leen: nunca firman, nunca escriben
 * on-chain, nunca tocan capital (invariantes #1/#8). Nunca lanza.
 */

import { opsAlert, alertChannels, type AlertLevel } from '../OpsAlertService';
import type { IssueLevel, Probe, ProbeCtx, ProbeFacts, ProbeFinding, ProbeLevel } from './sentinelTypes';

const SOURCE_PREFIX = 'sentinel';

const RANK: Record<ProbeLevel, number> = { ok: 0, info: 1, warn: 2, critical: 3 };

/* ────────────────────────────────────────────────────────────────────────── */
/* Núcleo puro — la máquina de estados de un aviso (unit-testeable sin red)   */
/* ────────────────────────────────────────────────────────────────────────── */

export type AlertKind = 'new' | 'escalated' | 'eased' | 'repeat' | 'recovered';

export interface RepeatConfig {
  /** Cada cuánto se recuerda un problema que sigue abierto, por severidad. */
  criticalMs: number;
  warnMs: number;
  /** Los `info` no se repiten: son contexto, no incidencias. */
  infoMs: number;
}

export function repeatConfigFromEnv(): RepeatConfig {
  const min = (name: string, fallback: number): number => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    criticalMs: min('OPS_SENTINEL_REPEAT_CRITICAL_MIN', 60) * 60_000,
    warnMs: min('OPS_SENTINEL_REPEAT_WARN_MIN', 360) * 60_000,
    infoMs: Number.POSITIVE_INFINITY,
  };
}

function repeatMsFor(level: IssueLevel, cfg: RepeatConfig): number {
  return level === 'critical' ? cfg.criticalMs : level === 'warn' ? cfg.warnMs : cfg.infoMs;
}

/**
 * ¿Hay que avisar de esta transición? Puro: entra el estado previo del aviso
 * (o null si no había) y el nivel actual; sale el tipo de aviso o null.
 *
 * Regla de oro: se avisa en los CAMBIOS, y se recuerda solo lo que sigue roto.
 * Un problema que persiste sin cambiar no puede escribir cada 5 minutos — un
 * canal que cría lobos se ignora justo el día que grita de verdad.
 */
export function decideAlert(
  prev: { level: IssueLevel; lastAlertMs: number } | null,
  next: ProbeLevel,
  now: number,
  cfg: RepeatConfig,
): AlertKind | null {
  if (next === 'ok') {
    if (!prev) return null;
    // Un `info` que desaparece no merece un "resuelto": no era una incidencia.
    return prev.level === 'info' ? null : 'recovered';
  }
  if (!prev) return 'new';
  if (RANK[next] > RANK[prev.level]) return 'escalated';
  if (RANK[next] < RANK[prev.level]) return 'eased';
  return now - prev.lastAlertMs >= repeatMsFor(next, cfg) ? 'repeat' : null;
}

/** Edad legible para un humano con el móvil en la mano. */
export function humanAge(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  if (h < 24) return restMin > 0 ? `${h} h ${restMin} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH > 0 ? `${d} d ${restH} h` : `${d} d`;
}

/** El mensaje que se manda, decorado según el tipo de transición. */
export function decorateMessage(kind: AlertKind, message: string, openMs: number): string {
  switch (kind) {
    case 'escalated':
      return `EMPEORA (${humanAge(openMs)} abierto): ${message}`;
    case 'eased':
      return `MEJORA pero sigue abierto (${humanAge(openMs)}): ${message}`;
    case 'repeat':
      return `SIGUE SIN RESOLVERSE (${humanAge(openMs)}): ${message}`;
    case 'recovered':
      return `RESUELTO tras ${humanAge(openMs)}: ${message}`;
    default:
      return message;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Estado observado                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TrackedIssue {
  id: string;
  probeId: string;
  probeTitle: string;
  key: string;
  level: IssueLevel;
  message: string;
  runbook?: string;
  facts?: ProbeFacts;
  sinceMs: number;
  lastSeenMs: number;
  lastAlertMs: number;
  alertCount: number;
}

export interface ProbeSnapshot {
  id: string;
  title: string;
  /** `ok` = comprobado y verde. `skipped` aparte: NO se comprobó. */
  level: ProbeLevel;
  skipped: boolean;
  skipReason?: string;
  message: string | null;
  findings: number;
  checkedAt: string | null;
  durationMs: number | null;
}

export interface SentinelSnapshot {
  enabled: boolean;
  running: boolean;
  intervalMin: number;
  lastPassAt: string | null;
  lastPassMs: number | null;
  passes: number;
  /** Canales externos armados y desde qué severidad entregan (sin URLs). */
  channels: ReturnType<typeof alertChannels>;
  heartbeatConfigured: boolean;
  lastHeartbeatAt: string | null;
  probes: ProbeSnapshot[];
  issues: Array<{
    id: string;
    probeId: string;
    probeTitle: string;
    level: IssueLevel;
    message: string;
    runbook: string | null;
    facts: ProbeFacts | null;
    since: string;
    ageMin: number;
    alerts: number;
  }>;
  counts: { critical: number; warn: number; info: number };
  checkedAt: string;
}

function intervalMin(): number {
  const n = Number(process.env.OPS_SENTINEL_INTERVAL_MIN || 5);
  return Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 5, 1), 60);
}

function digestHours(): number {
  const n = Number(process.env.OPS_SENTINEL_DIGEST_H ?? 24);
  return Number.isFinite(n) && n >= 0 ? n : 24;
}

/** Tope de tiempo por probe: uno colgado no puede secuestrar la pasada. */
const PROBE_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SENTINEL_PROBE_TIMEOUT_${ms}ms (${what})`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function asFindings(r: ProbeFinding | ProbeFinding[] | null): ProbeFinding[] {
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export class Sentinel {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private passing = false;
  private issues = new Map<string, TrackedIssue>();
  private lastProbes: ProbeSnapshot[] = [];
  private lastPassAt: Date | null = null;
  private lastPassMs: number | null = null;
  private lastHeartbeatAt: Date | null = null;
  private lastDigestMs = 0;
  private passes = 0;

  constructor(private readonly probes: Probe[]) {}

  enabled(): boolean {
    return process.env.OPS_SENTINEL_DISABLED !== 'true';
  }

  start(): void {
    if (this.timer || !this.enabled()) return;
    this.stopped = false;
    const everyMs = intervalMin() * 60_000;
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.runPass();
      } catch (e) {
        console.error(`[sentinel] pasada fallida: ${(e as Error).message}`);
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(loop, everyMs);
          this.timer.unref?.();
        }
      }
    };
    // 20 s de gracia: que el proceso termine de arrancar antes de juzgarlo.
    this.timer = setTimeout(loop, 20_000);
    this.timer.unref?.();
    console.log(`[sentinel] armado — vigilancia cada ${intervalMin()} min sobre ${this.probes.length} probes`);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Solo tests: olvida lo observado. */
  _resetForTests(): void {
    this.issues.clear();
    this.lastProbes = [];
    this.lastPassAt = null;
    this.passes = 0;
    this.lastDigestMs = 0;
  }

  /**
   * Una pasada completa: ejecuta los probes, casa lo visto con lo que ya se
   * sabía, avisa de las transiciones y hace ping al hombre muerto. Nunca lanza.
   */
  async runPass(ctx?: Partial<ProbeCtx>): Promise<SentinelSnapshot> {
    if (this.passing) return this.snapshot();
    this.passing = true;
    const startedAt = Date.now();
    const cfg = repeatConfigFromEnv();
    try {
      const { buildProbeContext } = await import('./sentinelProbes');
      const fullCtx: ProbeCtx = { ...buildProbeContext(startedAt), ...ctx } as ProbeCtx;
      const seen = new Set<string>();
      const probeSnapshots: ProbeSnapshot[] = [];

      const results = await Promise.all(
        this.probes.map(async (probe): Promise<{ probe: Probe; findings: ProbeFinding[]; snapshot: ProbeSnapshot }> => {
          const t0 = Date.now();
          if (probe.applies && !probe.applies()) {
            return {
              probe,
              findings: [],
              snapshot: {
                id: probe.id,
                title: probe.title,
                level: 'ok',
                skipped: true,
                skipReason: 'carril apagado en este entorno',
                message: null,
                findings: 0,
                checkedAt: new Date(t0).toISOString(),
                durationMs: 0,
              },
            };
          }
          try {
            const findings = asFindings(await withTimeout(probe.run(fullCtx), PROBE_TIMEOUT_MS, probe.id)).filter(
              (f) => f.level !== 'ok',
            );
            const worst = findings.reduce<ProbeLevel>((w, f) => (RANK[f.level] > RANK[w] ? f.level : w), 'ok');
            return {
              probe,
              findings,
              snapshot: {
                id: probe.id,
                title: probe.title,
                level: worst,
                skipped: false,
                message: findings[0]?.message ?? null,
                findings: findings.length,
                checkedAt: new Date().toISOString(),
                durationMs: Date.now() - t0,
              },
            };
          } catch (e) {
            // Un probe que revienta ES una incidencia: si el termómetro se
            // rompe, no se puede concluir que no hay fiebre.
            const finding: ProbeFinding = {
              key: 'probe-error',
              level: 'warn',
              message: `el chequeo «${probe.title}» falló: ${(e as Error).message}`,
              runbook:
                'Mira los logs del backend (Railway → Deployments → Logs, busca [sentinel]). ' +
                'Mientras falle, este carril NO está vigilado.',
            };
            return {
              probe,
              findings: [finding],
              snapshot: {
                id: probe.id,
                title: probe.title,
                level: 'warn',
                skipped: false,
                message: finding.message,
                findings: 1,
                checkedAt: new Date().toISOString(),
                durationMs: Date.now() - t0,
              },
            };
          }
        }),
      );

      for (const { probe, findings, snapshot } of results) {
        probeSnapshots.push(snapshot);
        for (const f of findings) {
          const key = f.key ?? '';
          const id = key ? `${probe.id}#${key}` : probe.id;
          seen.add(id);
          await this.observe(id, probe, key, f, startedAt, cfg);
        }
      }

      // Lo que ya no aparece se ha resuelto — anunciarlo cierra el bucle.
      for (const [id, issue] of [...this.issues]) {
        if (seen.has(id)) continue;
        this.issues.delete(id);
        if (decideAlert({ level: issue.level, lastAlertMs: issue.lastAlertMs }, 'ok', startedAt, cfg) === 'recovered') {
          await opsAlert(
            `${SOURCE_PREFIX}/${issue.probeId}`,
            'info',
            decorateMessage('recovered', issue.message, startedAt - issue.sinceMs),
            { key: id, facts: issue.facts },
          );
        }
      }

      this.lastProbes = probeSnapshots;
      this.lastPassAt = new Date();
      this.lastPassMs = Date.now() - startedAt;
      this.passes += 1;

      await this.pingHeartbeat();
      await this.maybeDigest(startedAt);
      return this.snapshot();
    } finally {
      this.passing = false;
    }
  }

  /** Casa UN hallazgo con lo que ya se sabía y avisa si toca. */
  private async observe(
    id: string,
    probe: Probe,
    key: string,
    f: ProbeFinding,
    now: number,
    cfg: RepeatConfig,
  ): Promise<void> {
    const level = f.level as IssueLevel;
    const prev = this.issues.get(id);
    const kind = decideAlert(prev ? { level: prev.level, lastAlertMs: prev.lastAlertMs } : null, level, now, cfg);
    const sinceMs = prev?.sinceMs ?? now;

    const next: TrackedIssue = {
      id,
      probeId: probe.id,
      probeTitle: probe.title,
      key,
      level,
      message: f.message,
      ...(f.runbook ? { runbook: f.runbook } : {}),
      ...(f.facts ? { facts: f.facts } : {}),
      sinceMs,
      lastSeenMs: now,
      lastAlertMs: kind ? now : (prev?.lastAlertMs ?? 0),
      alertCount: (prev?.alertCount ?? 0) + (kind ? 1 : 0),
    };
    this.issues.set(id, next);
    if (!kind) return;

    const facts: ProbeFacts = { ...(f.facts ?? {}) };
    if (kind !== 'new') facts.abierto = humanAge(now - sinceMs);
    await opsAlert(`${SOURCE_PREFIX}/${probe.id}`, level as AlertLevel, decorateMessage(kind, f.message, now - sinceMs), {
      key: id,
      ...(f.runbook ? { runbook: f.runbook } : {}),
      facts,
    });
  }

  /**
   * Interruptor de hombre muerto. Un proceso muerto no puede avisar de que
   * está muerto: quien lo detecta es el servicio externo que deja de recibir
   * este ping (healthchecks.io, Better Stack, cron-job.org…). Con críticos
   * abiertos se pega a la URL de fallo, para que el estado rojo también viaje.
   */
  private async pingHeartbeat(): Promise<void> {
    const url = process.env.OPS_HEARTBEAT_URL;
    if (!url) return;
    const critical = [...this.issues.values()].some((i) => i.level === 'critical');
    const target = critical ? `${url.replace(/\/$/, '')}/fail` : url;
    try {
      await fetch(target, { method: 'GET', signal: AbortSignal.timeout(5_000) });
      this.lastHeartbeatAt = new Date();
    } catch (e) {
      console.error(`[sentinel] heartbeat no entregado (${(e as Error).message})`);
    }
  }

  /**
   * Resumen periódico. No es ruido: es la prueba de vida del propio canal —
   * si el digest no llega, el canal está roto (o el proceso), y eso también
   * es información. OPS_SENTINEL_DIGEST_H=0 lo apaga.
   */
  private async maybeDigest(now: number): Promise<void> {
    const hours = digestHours();
    if (hours <= 0) return;
    if (this.lastDigestMs === 0) {
      // Nunca se manda uno nada más arrancar: el primero toca una ventana después.
      this.lastDigestMs = now;
      return;
    }
    if (now - this.lastDigestMs < hours * 3_600_000) return;
    this.lastDigestMs = now;
    const open = [...this.issues.values()].sort((a, b) => RANK[b.level] - RANK[a.level]);
    const checked = this.lastProbes.filter((p) => !p.skipped).length;
    const message =
      open.length === 0
        ? `todo en verde: ${checked} chequeos, 0 incidencias abiertas (últimas ${hours} h)`
        : `${open.length} incidencia(s) abierta(s) sobre ${checked} chequeos:\n` +
          open
            .slice(0, 10)
            .map((i) => `· ${i.level.toUpperCase()} ${i.probeTitle}: ${i.message} (${humanAge(now - i.sinceMs)})`)
            .join('\n');
    await opsAlert(`${SOURCE_PREFIX}/resumen`, 'info', message, {
      key: 'digest',
      ...(open.length > 0
        ? { runbook: 'El detalle y los botones de arreglo, en /app/admin → Alertas.' }
        : {}),
    });
  }

  snapshot(): SentinelSnapshot {
    const now = Date.now();
    const issues = [...this.issues.values()].sort(
      (a, b) => RANK[b.level] - RANK[a.level] || a.sinceMs - b.sinceMs,
    );
    const counts = { critical: 0, warn: 0, info: 0 };
    for (const i of issues) counts[i.level] += 1;
    return {
      enabled: this.enabled(),
      running: this.timer != null,
      intervalMin: intervalMin(),
      lastPassAt: this.lastPassAt?.toISOString() ?? null,
      lastPassMs: this.lastPassMs,
      passes: this.passes,
      channels: alertChannels(),
      heartbeatConfigured: !!process.env.OPS_HEARTBEAT_URL,
      lastHeartbeatAt: this.lastHeartbeatAt?.toISOString() ?? null,
      probes: this.lastProbes,
      issues: issues.map((i) => ({
        id: i.id,
        probeId: i.probeId,
        probeTitle: i.probeTitle,
        level: i.level,
        message: i.message,
        runbook: i.runbook ?? null,
        facts: i.facts ?? null,
        since: new Date(i.sinceMs).toISOString(),
        ageMin: Math.round((now - i.sinceMs) / 60_000),
        alerts: i.alertCount,
      })),
      counts,
      checkedAt: new Date(now).toISOString(),
    };
  }
}

/* El singleton del proceso — armado en index-simple. Los probes se cargan de
 * forma perezosa para que importar este módulo (p.ej. desde una ruta) no
 * arrastre ethers/xrpl ni toque la red. */
let instance: Sentinel | null = null;

export function getSentinel(): Sentinel {
  if (!instance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SENTINEL_PROBES } = require('./sentinelProbes') as { SENTINEL_PROBES: Probe[] };
    instance = new Sentinel(SENTINEL_PROBES);
  }
  return instance;
}

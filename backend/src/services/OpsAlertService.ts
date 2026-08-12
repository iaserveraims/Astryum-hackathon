/**
 * OpsAlertService — el canal único de alertas de operación de los agentes.
 *
 * Todos los vigías/ejecutores del backend (executor 0xFE, vigía XRPL, health
 * de providers, Sentinel) empujan aquí: log estructurado SIEMPRE + bandeja del
 * panel admin SIEMPRE + los canales externos que estén armados.
 *
 * Tres destinos, cada uno con su umbral (un canal que grita por todo se
 * silencia, y entonces no sirve el día que importa):
 *
 *   1. OPS_ALERT_WEBHOOK_URL — el canal común. Si la URL es de Discord se
 *      manda un EMBED nativo (color por severidad, el objeto en campos, el
 *      arreglo destacado); cualquier otra recibe el body genérico con
 *      `content` y `text` a la vez, que sirve a Slack sin config extra.
 *      Umbral OPS_ALERT_MIN_LEVEL (default `info`).
 *      EXECUTOR_ALERT_WEBHOOK_URL sigue valiendo como alias.
 *   2. OPS_ALERT_WEBHOOK_URL_CRITICAL — un segundo webhook SOLO para críticos
 *      (otro canal, otra sala, otro grito).
 *   3. Telegram (OPS_ALERT_TELEGRAM_BOT_TOKEN + _CHAT_ID) — opcional.
 *      Umbral OPS_ALERT_TELEGRAM_MIN_LEVEL (default `warn`).
 *
 * Que suene el móvil (founder 2026-08-03, Discord elegido como canal): Discord
 * solo notifica de verdad cuando MENCIONA. `OPS_ALERT_DISCORD_MENTION`
 * (`@everyone`, `<@tu_id>`, `<@&rol>`) se antepone a partir de
 * OPS_ALERT_DISCORD_MENTION_MIN_LEVEL (default `critical`): el registro no
 * molesta, y lo grave despierta.
 *
 * El texto que sale es AUTOSUFICIENTE por diseño: qué pasa, sobre qué objeto
 * (hash/cuenta/importe) y — la línea que lo convierte en acción — QUÉ HACER
 * (`runbook`). Leer la notificación en el móvil debe bastar para saber si hay
 * que levantarse o no, y para arreglarlo sin abrir el código.
 *
 * Nunca lanza: una alerta caída no puede tumbar el tick de ningún agente.
 */

export type AlertLevel = 'info' | 'warn' | 'critical';

export interface AlertOptions {
  /** Identidad estable del suceso (`stuck:7BFC…`) — viaja en el payload para
   *  que el canal agrupe y el panel case aviso ↔ resolución. También es la
   *  identidad de DEDUPLICACIÓN (sin key, se usa el mensaje literal). */
  key?: string;
  /** QUÉ HACER. La línea que convierte un aviso en una acción. */
  runbook?: string;
  /** Datos que el operador querrá leer o copiar (hash, cuenta, importe, edad). */
  facts?: Record<string, string | number | boolean | null | undefined>;
  /** `false` = esta alerta se entrega SIEMPRE, aunque se repita (latidos,
   *  resúmenes periódicos). El default deduplica: un fallo que se repite
   *  idéntico cada tick es UNA noticia, no sesenta. */
  dedupe?: boolean;
}

const LEVEL_RANK: Record<AlertLevel, number> = { info: 0, warn: 1, critical: 2 };
const LEVEL_MARK: Record<AlertLevel, string> = { info: '🔵', warn: '🟠', critical: '🔴' };

/** Discord rechaza `content` > 2000 chars con un 400. */
const DISCORD_MAX = 2000;

function normLevel(v: unknown, fallback: AlertLevel): AlertLevel {
  return v === 'info' || v === 'warn' || v === 'critical' ? v : fallback;
}

function envLevel(name: string, fallback: AlertLevel): AlertLevel {
  return normLevel((process.env[name] || '').trim().toLowerCase(), fallback);
}

function factsLine(facts: AlertOptions['facts']): string | null {
  if (!facts) return null;
  const parts = Object.entries(facts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * El texto humano de una alerta. Puro y exportado a propósito: es el contrato
 * que se testea, porque de él depende que el operador sepa actuar SIN abrir el
 * repo. Forma:
 *
 *   🔴 CRITICAL · 0xFE-executor
 *   la tx 7BFC… lleva 47 min pillada en el executor
 *   hash: 7BFC… · xrp: 12.5
 *   ↳ Arreglo: /app/admin → Sistema → Desatascar → Reintentar
 */
export function formatAlertText(
  source: string,
  level: AlertLevel,
  message: string,
  opts: AlertOptions = {},
): string {
  const head = `${LEVEL_MARK[level]} ${level.toUpperCase()} · ${source}`;
  const lines = [head, message];
  const facts = factsLine(opts.facts);
  if (facts) lines.push(facts);
  if (opts.runbook) lines.push(`↳ Arreglo: ${opts.runbook}`);
  return lines.join('\n');
}

/** La línea de UNA sola línea que va a los logs (formato histórico, grep-able). */
export function formatAlertLine(source: string, level: AlertLevel, message: string): string {
  return `[${source}] [${level.toUpperCase()}] ${message}`;
}

interface Destination {
  name: 'webhook' | 'webhook-critical' | 'telegram';
  minLevel: AlertLevel;
  send: (text: string, payload: Record<string, unknown>) => Promise<void>;
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
}

/**
 * POST con UN reintento cuando el destino pide esperar (429 con `retry_after`).
 * Discord limita por webhook: en una ráfaga (varias incidencias en la misma
 * pasada del vigía) el 2º o 3º mensaje puede rebotar. Perder por rate-limit
 * justo el aviso que importaba sería la peor forma de fallar.
 */
async function postWithRetry(url: string, body: unknown, name: string): Promise<void> {
  let res = await postJson(url, body);
  if (res.status === 429) {
    const raw = await res.text().catch(() => '');
    let waitMs = 1_000;
    try {
      const j = JSON.parse(raw) as { retry_after?: number };
      // Discord lo da en segundos (a veces fraccionarios); tope 5 s.
      if (typeof j.retry_after === 'number') waitMs = Math.min(Math.ceil(j.retry_after * 1000), 5_000);
    } catch {
      /* cuerpo no-JSON: se usa el segundo por defecto */
    }
    await new Promise((r) => setTimeout(r, waitMs));
    res = await postJson(url, body);
  }
  await assertOk(res, name);
}

async function assertOk(res: Response, name: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  // OJO: nunca se registra la URL ni el token — solo el nombre del destino (#2).
  throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''} (${name})`);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Discord — el canal elegido (founder 2026-08-03): tarjeta y mención          */
/* ────────────────────────────────────────────────────────────────────────── */

/** Color de la barra lateral del embed: se distingue de un vistazo, sin leer. */
const EMBED_COLOR: Record<AlertLevel, number> = {
  info: 0x38bdf8, // cielo
  warn: 0xf59e0b, // ámbar
  critical: 0xef4444, // rojo
};

const WEBHOOK_USERNAME = 'Astryum · Vigilancia';

export function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//i.test(url.trim());
}

/**
 * A quién se menciona y desde qué nivel. Discord solo hace sonar el móvil
 * cuando MENCIONA (un canal silenciado se traga el resto), así que esta es la
 * pieza que convierte el canal en un aviso real y no en un registro que se lee
 * cuando toca. `OPS_ALERT_DISCORD_MENTION` acepta `@everyone`, `@here`,
 * `<@ID_DE_USUARIO>` o `<@&ID_DE_ROL>`; por defecto solo en los críticos.
 */
export function discordMentionFor(level: AlertLevel): string | null {
  const mention = (process.env.OPS_ALERT_DISCORD_MENTION || '').trim();
  if (!mention) return null;
  const min = envLevel('OPS_ALERT_DISCORD_MENTION_MIN_LEVEL', 'critical');
  return LEVEL_RANK[level] >= LEVEL_RANK[min] ? mention : null;
}

/** Trunca respetando los topes de Discord sin cortar a mitad de palabra. */
function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * El cuerpo nativo de Discord: un embed con color por severidad, el objeto
 * afectado en campos copiables y el ARREGLO destacado al final. El texto plano
 * (`content`) queda solo para la mención, de modo que el mensaje no salga dos
 * veces. Datos idénticos a los del payload genérico — cambia la presentación,
 * no la verdad.
 */
export function discordBody(payload: Record<string, unknown>): Record<string, unknown> {
  const level = normLevel(payload.level, 'info');
  const source = String(payload.source ?? 'astryum');
  const message = String(payload.message ?? '');
  const runbook = typeof payload.runbook === 'string' ? payload.runbook : null;
  const facts = (payload.facts ?? null) as AlertOptions['facts'];
  const mention = discordMentionFor(level);

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (facts) {
    for (const [k, v] of Object.entries(facts)) {
      if (v === undefined || v === null || v === '') continue;
      if (fields.length >= 8) break; // el resto vive en el panel; aquí manda la legibilidad
      fields.push({ name: clamp(k, 256), value: clamp('`' + String(v) + '`', 1024), inline: true });
    }
  }
  if (runbook) fields.push({ name: '↳ Arreglo', value: clamp(runbook, 1024), inline: false });

  return {
    username: WEBHOOK_USERNAME,
    ...(mention ? { content: mention } : {}),
    // Sin mención configurada NADA hace ping, ni aunque el texto lleve un @.
    allowed_mentions: mention ? { parse: ['everyone', 'roles', 'users'] } : { parse: [] },
    embeds: [
      {
        title: clamp(`${LEVEL_MARK[level]} ${level.toUpperCase()} · ${source}`, 256),
        description: clamp(message, 4000),
        color: EMBED_COLOR[level],
        ...(fields.length > 0 ? { fields } : {}),
        ...(typeof payload.at === 'string' ? { timestamp: payload.at } : {}),
        footer: { text: clamp(String(payload.key ?? 'astryum'), 2048) },
      },
    ],
  };
}

/** Cuerpo genérico (Slack y cualquier otro receptor): `content` + `text` a la
 *  vez, más los campos estructurados. Es el que había, intacto. */
function genericBody(text: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    content: text.length > DISCORD_MAX ? `${text.slice(0, DISCORD_MAX - 3)}...` : text,
    text,
  };
}

/** Un webhook, hablando el idioma del receptor. */
function sendWebhook(url: string, name: string, text: string, payload: Record<string, unknown>): Promise<void> {
  return postWithRetry(url, isDiscordWebhook(url) ? discordBody(payload) : genericBody(text, payload), name);
}

/** Los destinos ARMADOS ahora mismo. Se lee el env en cada llamada: un cambio
 *  de config en Railway entra sin redeploy del proceso que alerta. */
function destinations(): Destination[] {
  const out: Destination[] = [];

  const common = process.env.OPS_ALERT_WEBHOOK_URL || process.env.EXECUTOR_ALERT_WEBHOOK_URL;
  if (common) {
    out.push({
      name: 'webhook',
      minLevel: envLevel('OPS_ALERT_MIN_LEVEL', 'info'),
      send: (text, payload) => sendWebhook(common, 'webhook', text, payload),
    });
  }

  const criticalUrl = process.env.OPS_ALERT_WEBHOOK_URL_CRITICAL;
  if (criticalUrl && criticalUrl !== common) {
    out.push({
      name: 'webhook-critical',
      minLevel: 'critical',
      send: (text, payload) => sendWebhook(criticalUrl, 'webhook-critical', text, payload),
    });
  }

  const token = process.env.OPS_ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPS_ALERT_TELEGRAM_CHAT_ID;
  if (token && chatId) {
    out.push({
      name: 'telegram',
      minLevel: envLevel('OPS_ALERT_TELEGRAM_MIN_LEVEL', 'warn'),
      send: async (text) => {
        const res = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: text.slice(0, 4000),
          disable_web_page_preview: true,
        });
        await assertOk(res, 'telegram');
      },
    });
  }

  return out;
}

/** Qué canales están armados y desde qué severidad — para el panel y el probe
 *  del Sentinel (booleanos y umbrales; JAMÁS la URL ni el token). */
export function alertChannels(): Array<{ name: string; armed: boolean; minLevel: AlertLevel }> {
  const armed = destinations();
  const byName = new Map(armed.map((d) => [d.name, d]));
  return (['webhook', 'webhook-critical', 'telegram'] as const).map((name) => ({
    name,
    armed: byName.has(name),
    minLevel: byName.get(name)?.minLevel ?? 'info',
  }));
}

/** ¿Hay algún canal externo capaz de entregar una alerta de este nivel? */
export function hasChannelFor(level: AlertLevel): boolean {
  return destinations().some((d) => LEVEL_RANK[level] >= LEVEL_RANK[d.minLevel]);
}

/**
 * Deduplicación (founder 2026-08-01: el anchor-feed roto repetía el MISMO warn
 * en cada tick del executor y ensuciaba el canal — "un canal que grita por
 * todo se silencia"). Identidad = source + (key ?? mensaje literal). Dentro de
 * la ventana, una repetición al MISMO nivel o inferior se loguea pero no se
 * re-entrega (ni canal ni panel); una ESCALADA de nivel pasa siempre; y al
 * reaparecer tras la ventana el texto declara cuántas veces se silenció —
 * nada desaparece sin dejar rastro.
 */
const DEDUP_DEFAULT_WINDOW_MIN = 360; // 6h — un fallo persistente re-suena 4×/día
const recentAlerts = new Map<string, { at: number; level: AlertLevel; suppressed: number }>();
const DEDUP_MAX_ENTRIES = 500;

function dedupWindowMs(): number {
  const n = Number(process.env.OPS_ALERT_DEDUP_WINDOW_MIN);
  return (Number.isFinite(n) && n >= 0 ? n : DEDUP_DEFAULT_WINDOW_MIN) * 60_000;
}

/** Solo tests: la ventana vive en un Map de módulo. */
export function __resetAlertDedupForTests(): void {
  recentAlerts.clear();
}

export async function opsAlert(
  source: string,
  level: AlertLevel,
  message: string,
  opts: AlertOptions = {},
): Promise<void> {
  const at = new Date().toISOString();
  const line = formatAlertLine(source, level, message);
  if (level === 'info') console.log(line);
  else console.error(line);
  if (opts.runbook) console.log(`[${source}]   ↳ ${opts.runbook}`);

  // ── Deduplicación — decide ANTES de persistir o entregar nada. ──
  if (opts.dedupe !== false) {
    const windowMs = dedupWindowMs();
    const id = `${source}|${opts.key ?? message}`;
    const prev = recentAlerts.get(id);
    const now = Date.now();
    if (prev && windowMs > 0 && now - prev.at < windowMs && LEVEL_RANK[level] <= LEVEL_RANK[prev.level]) {
      prev.suppressed += 1;
      console.log(`[${source}] alerta repetida (${prev.suppressed}× en ventana) — no se re-entrega`);
      return;
    }
    if (prev && prev.suppressed > 0) {
      message = `${message} (se repitió ${prev.suppressed}× desde el último aviso)`;
    }
    if (recentAlerts.size >= DEDUP_MAX_ENTRIES) {
      for (const [k, v] of recentAlerts) {
        if (now - v.at >= windowMs) recentAlerts.delete(k);
      }
      if (recentAlerts.size >= DEDUP_MAX_ENTRIES) recentAlerts.clear(); // backstop
    }
    recentAlerts.set(id, { at: now, level, suppressed: 0 });
  }

  // Bandeja del panel admin: SIEMPRE persiste, no depende de ningún webhook.
  // Best-effort — el store se traga sus propios errores y es no-op sin DB; el
  // try extra solo protege el import dinámico. Una alerta caída jamás tumba al
  // agente que la emite (misma postura que el resto de esta línea).
  try {
    const { saveOpsAlert } = await import('./OpsAlertStore');
    await saveOpsAlert({
      source,
      level,
      // El runbook viaja DENTRO del mensaje persistido: la bandeja del panel
      // debe ser tan accionable como la notificación del móvil.
      message: opts.runbook ? `${message}\n↳ Arreglo: ${opts.runbook}` : message,
      at,
    });
  } catch (e) {
    console.error(`[${source}] no se pudo persistir la alerta (${(e as Error).message}) — queda en logs`);
  }

  const text = formatAlertText(source, level, message, opts);
  const payload: Record<string, unknown> = {
    source,
    level,
    message,
    at,
    ...(opts.key ? { key: opts.key } : {}),
    ...(opts.runbook ? { runbook: opts.runbook } : {}),
    ...(opts.facts ? { facts: opts.facts } : {}),
  };

  // Entrega en paralelo: un canal caído no retrasa ni cancela a los demás.
  await Promise.all(
    destinations()
      .filter((d) => LEVEL_RANK[level] >= LEVEL_RANK[d.minLevel])
      .map(async (d) => {
        try {
          await d.send(text, payload);
        } catch (e) {
          console.error(
            `[${source}] canal '${d.name}' no entregó la alerta (${(e as Error).message}) — queda en logs y en el panel`,
          );
        }
      }),
  );
}

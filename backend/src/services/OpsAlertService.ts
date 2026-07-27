/**
 * OpsAlertService — el canal único de alertas de operación de los agentes.
 *
 * Todos los vigías/ejecutores del backend (executor 0xFE, vigía XRPL, health
 * de providers) empujan aquí: log estructurado SIEMPRE + webhook opcional
 * (OPS_ALERT_WEBHOOK_URL, con EXECUTOR_ALERT_WEBHOOK_URL como alias para no
 * romper la config ya documentada). El body lleva `content` y `text` a la vez
 * para ser compatible con Discord y Slack sin config extra.
 *
 * Nunca lanza: una alerta caída no puede tumbar el tick de ningún agente.
 */

export type AlertLevel = 'info' | 'warn' | 'critical';

export async function opsAlert(source: string, level: AlertLevel, message: string): Promise<void> {
  const at = new Date().toISOString();
  const line = `[${source}] [${level.toUpperCase()}] ${message}`;
  if (level === 'info') console.log(line);
  else console.error(line);

  // Bandeja del panel admin: SIEMPRE persiste, no depende de ningún webhook.
  // Best-effort — el store se traga sus propios errores y es no-op sin DB; el
  // try extra solo protege el import dinámico. Una alerta caída jamás tumba al
  // agente que la emite (misma postura que el resto de esta línea).
  try {
    const { saveOpsAlert } = await import('./OpsAlertStore');
    await saveOpsAlert({ source, level, message, at });
  } catch (e) {
    console.error(`[${source}] no se pudo persistir la alerta (${(e as Error).message}) — queda en logs`);
  }

  // Webhook externo OPCIONAL (Discord/Slack) — sigue funcionando si se configura.
  const url = process.env.OPS_ALERT_WEBHOOK_URL || process.env.EXECUTOR_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        level,
        message,
        at,
        content: line,
        text: line,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.error(`[${source}] webhook de alerta caído (${(e as Error).message}) — la alerta queda en logs y en el panel`);
  }
}

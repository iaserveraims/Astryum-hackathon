/**
 * check-sentinel — una pasada de vigilancia AQUÍ y AHORA, impresa en la consola.
 *
 *   npx ts-node src/scripts/check-sentinel.ts          # ensayo: no entrega nada
 *   npx ts-node src/scripts/check-sentinel.ts --send   # entrega por los canales reales
 *
 * Por defecto es un ENSAYO: desarma los canales externos (webhooks/Telegram) y
 * la persistencia en la bandeja, de modo que probar la vigilancia desde un
 * portátil no escriba en el Discord del equipo ni en la base de datos de
 * producción. Con `--send` se comporta exactamente como el vigía del backend.
 *
 * Sirve para dos cosas: ver de un vistazo qué está roto sin abrir el panel, y
 * comprobar que un probe nuevo hace lo que dice antes de desplegarlo.
 *
 * Read-only: los probes solo leen (salud del executor, frescura de nodos, RPC,
 * filas de la DB). Nada firma ni mueve capital.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LEVEL_MARK: Record<string, string> = { ok: '·', info: 'i', warn: '!', critical: 'X' };

async function main(): Promise<void> {
  const send = process.argv.includes('--send');
  if (!send) {
    for (const k of [
      'OPS_ALERT_WEBHOOK_URL',
      'EXECUTOR_ALERT_WEBHOOK_URL',
      'OPS_ALERT_WEBHOOK_URL_CRITICAL',
      'OPS_ALERT_TELEGRAM_BOT_TOKEN',
      'OPS_ALERT_TELEGRAM_CHAT_ID',
      'OPS_HEARTBEAT_URL',
      'DATABASE_URL',
    ]) {
      delete process.env[k];
    }
    console.log('ENSAYO — sin entrega por webhook/Telegram y sin escribir en la bandeja.');
    console.log('        (los chequeos que necesitan la base de datos salen como «no aplica»)\n');
  } else {
    console.log('ENTREGA REAL — los avisos saldrán por los canales configurados.\n');
  }

  const { getSentinel } = await import('../services/ops/SentinelService');
  const snap = await getSentinel().runPass();

  console.log(`Chequeos (${snap.lastPassMs} ms):`);
  for (const p of snap.probes) {
    const mark = p.skipped ? '–' : LEVEL_MARK[p.level] ?? '?';
    const state = p.skipped ? 'no aplica' : p.findings > 0 ? `${p.findings} incidencia(s)` : 'ok';
    console.log(`  [${mark}] ${p.title.padEnd(34)} ${state}`);
  }

  console.log(
    `\nIncidencias abiertas: ${snap.issues.length} ` +
      `(${snap.counts.critical} críticas, ${snap.counts.warn} avisos, ${snap.counts.info} info)`,
  );
  for (const i of snap.issues) {
    console.log(`\n  ${i.level.toUpperCase()} · ${i.probeTitle}`);
    console.log(`  ${i.message}`);
    if (i.facts) {
      const line = Object.entries(i.facts)
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      if (line) console.log(`  ${line}`);
    }
    if (i.runbook) console.log(`  ↳ ${i.runbook}`);
  }

  const armed = snap.channels.filter((c) => c.armed).map((c) => `${c.name} (≥${c.minLevel})`);
  console.log(`\nCanales: ${armed.length > 0 ? armed.join(', ') : 'ninguno armado'}`);
  console.log(`Hombre muerto: ${snap.heartbeatConfigured ? 'configurado' : 'sin configurar'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('check-sentinel falló:', err);
    process.exit(1);
  });

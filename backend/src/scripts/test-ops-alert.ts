/**
 * test-ops-alert — fire ONE test alert through the real opsAlert path.
 *
 * Verifies the whole alerting circuit end-to-end: structured log + admin-panel
 * inbox + external webhook (Discord/Slack). Run it after wiring a new webhook
 * so the first real critical is not also the first delivery attempt.
 *
 *   npx ts-node src/scripts/test-ops-alert.ts [webhookUrl]
 *
 * With no argument it uses OPS_ALERT_WEBHOOK_URL / EXECUTOR_ALERT_WEBHOOK_URL
 * from backend/.env. Passing a URL overrides them for this run only — useful to
 * try a freshly created Discord webhook BEFORE putting it in Railway.
 *
 * Read-only otherwise: no executor, no signing, no chain access.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const override = process.argv[2];
  if (override) process.env.OPS_ALERT_WEBHOOK_URL = override;

  const url = process.env.OPS_ALERT_WEBHOOK_URL || process.env.EXECUTOR_ALERT_WEBHOOK_URL;
  if (!url) {
    console.error(
      'No webhook configured: set OPS_ALERT_WEBHOOK_URL in backend/.env or pass it as an argument.\n' +
        'usage: npx ts-node src/scripts/test-ops-alert.ts [webhookUrl]',
    );
    process.exit(1);
  }
  console.log(`Webhook: ${url.slice(0, 40)}… (${override ? 'argument' : 'env'})`);

  const { opsAlert, isDiscordWebhook } = await import('../services/OpsAlertService');
  // Muestra REAL, no un "hola mundo": el aviso de prueba se manda con la misma
  // forma que tendría el de verdad (objeto afectado + arreglo), para ver en el
  // canal exactamente lo que se verá el día que pase. `dedupe: false` porque
  // una prueba debe llegar SIEMPRE, aunque se repita.
  await opsAlert(
    'test-ops-alert',
    'warn',
    'PRUEBA — así se ve un aviso real: la tx 7BFC65…F2A1 lleva 47 min pillada en el executor',
    {
      dedupe: false,
      key: `prueba:${Date.now()}`,
      facts: { hash: '7BFC65…F2A1', cuenta: 'rN7n7…tFQr', xrp: 12.5, fallos: 3 },
      runbook:
        '/app/admin → Sistema → Desatascar → Reintentar (no cuesta fee: la attestation ya pagada se reutiliza). ' +
        'Esto es solo una prueba: no hay ninguna tx pillada.',
    },
  );

  console.log(
    '\nAlerta enviada. Comprueba:\n' +
      (isDiscordWebhook(url)
        ? '  1. El canal de Discord — debe verse una TARJETA ámbar con el aviso, los datos y el arreglo.\n' +
          '     (En los críticos, además, la mención de OPS_ALERT_DISCORD_MENTION si está puesta.)\n'
        : '  1. El canal — debe haber llegado "🟠 WARN · test-ops-alert …".\n') +
      "  2. Si arriba aparece \"canal ... no entregó la alerta\", la URL está mal o el webhook fue borrado.\n" +
      '  3. La bandeja del panel admin también la registra (si hay DATABASE_URL en este entorno).',
  );
}

main().catch((err) => {
  console.error('test-ops-alert failed:', err);
  process.exit(1);
});

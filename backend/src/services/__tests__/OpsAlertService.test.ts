/**
 * OpsAlertService — el canal único de salida de las alertas de operación.
 *
 * Lo que se fija aquí:
 *  · El TEXTO que sale es autosuficiente: nivel, fuente, qué pasa, sobre qué
 *    objeto y — la línea que lo vuelve accionable — qué hacer.
 *  · Cada destino entrega desde SU umbral: el webhook común lo ve todo, el
 *    canal de críticos solo lo crítico, Telegram (el que suena en el móvil)
 *    desde warn. Un canal que grita por todo se silencia, y entonces no sirve.
 *  · Nunca lanza: un canal caído no puede tumbar al agente que alerta, y los
 *    demás destinos siguen recibiendo.
 */

jest.mock('../OpsAlertStore', () => ({ saveOpsAlert: jest.fn(async () => undefined) }));

import {
  __resetAlertDedupForTests,
  alertChannels,
  formatAlertText,
  hasChannelFor,
  opsAlert,
} from '../OpsAlertService';

const ENV_KEYS = [
  'OPS_ALERT_WEBHOOK_URL',
  'EXECUTOR_ALERT_WEBHOOK_URL',
  'OPS_ALERT_WEBHOOK_URL_CRITICAL',
  'OPS_ALERT_MIN_LEVEL',
  'OPS_ALERT_TELEGRAM_BOT_TOKEN',
  'OPS_ALERT_TELEGRAM_CHAT_ID',
  'OPS_ALERT_TELEGRAM_MIN_LEVEL',
  'OPS_ALERT_DISCORD_MENTION',
  'OPS_ALERT_DISCORD_MENTION_MIN_LEVEL',
];

const DISCORD_URL = 'https://discord.com/api/webhooks/123/abc';

let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const realFetch = global.fetch;

beforeEach(() => {
  calls = [];
  // Cada test es un suceso NUEVO: sin esto, dos tests que alertan el mismo
  // texto caerían en la ventana de dedup del anterior (que es el contrato de
  // producción, pero no el de un suite que aísla escenarios).
  __resetAlertDedupForTests();
  for (const k of ENV_KEYS) delete process.env[k];
  global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
    return { ok: true, status: 200, text: async () => '' } as Response;
  }) as unknown as typeof fetch;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = realFetch;
});

describe('formatAlertText', () => {
  it('escribe el aviso como se lee en el móvil: qué, sobre qué y qué hacer', () => {
    const text = formatAlertText('0xFE-executor', 'critical', 'la tx 7BFC…65F lleva 47 min pillada', {
      facts: { hash: '7BFC65F', xrp: 12.5, vacio: null },
      runbook: '/app/admin → Sistema → Desatascar → Reintentar',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('🔴 CRITICAL · 0xFE-executor');
    expect(lines[1]).toContain('47 min pillada');
    expect(lines[2]).toBe('hash: 7BFC65F · xrp: 12.5'); // los vacíos no ensucian
    expect(lines[3]).toBe('↳ Arreglo: /app/admin → Sistema → Desatascar → Reintentar');
  });

  it('sin datos ni arreglo se queda en cabecera + mensaje', () => {
    expect(formatAlertText('vigia', 'info', 'todo en verde')).toBe('🔵 INFO · vigia\ntodo en verde');
  });
});

describe('encaminado por severidad', () => {
  it('el webhook común lo recibe todo; el canal de críticos, solo lo crítico', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = 'https://discord.test/comun';
    process.env.OPS_ALERT_WEBHOOK_URL_CRITICAL = 'https://discord.test/urgente';

    await opsAlert('x', 'warn', 'aviso');
    expect(calls.map((c) => c.url)).toEqual(['https://discord.test/comun']);

    calls = [];
    await opsAlert('x', 'critical', 'fuego');
    expect(calls.map((c) => c.url).sort()).toEqual(['https://discord.test/comun', 'https://discord.test/urgente']);
  });

  it('Telegram calla en los info por defecto y suena desde warn', async () => {
    process.env.OPS_ALERT_TELEGRAM_BOT_TOKEN = 'tok';
    process.env.OPS_ALERT_TELEGRAM_CHAT_ID = '42';

    await opsAlert('x', 'info', 'contexto');
    expect(calls).toHaveLength(0);

    await opsAlert('x', 'warn', 'mira esto');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/bottok/sendMessage');
    expect(calls[0].body.chat_id).toBe('42');
    expect(String(calls[0].body.text)).toContain('🟠 WARN · x');
  });

  it('OPS_ALERT_MIN_LEVEL sube el listón del webhook común', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = 'https://discord.test/comun';
    process.env.OPS_ALERT_MIN_LEVEL = 'warn';
    await opsAlert('x', 'info', 'ruido');
    expect(calls).toHaveLength(0);
    expect(hasChannelFor('info')).toBe(false);
    expect(hasChannelFor('warn')).toBe(true);
  });

  it('el alias histórico EXECUTOR_ALERT_WEBHOOK_URL sigue armando el canal', async () => {
    process.env.EXECUTOR_ALERT_WEBHOOK_URL = 'https://discord.test/viejo';
    await opsAlert('x', 'info', 'hola');
    expect(calls[0].url).toBe('https://discord.test/viejo');
    expect(alertChannels().find((c) => c.name === 'webhook')?.armed).toBe(true);
  });

  it('el body genérico sirve a Slack y a cualquier receptor, con el arreglo estructurado', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = 'https://discord.test/comun';
    await opsAlert('0xFE-executor', 'critical', 'tx pillada', { key: 'stuck:7BFC', runbook: 'reintentar' });
    const b = calls[0].body;
    expect(b.content).toBe(b.text); // Discord lee content, Slack lee text
    expect(b.key).toBe('stuck:7BFC');
    expect(b.runbook).toBe('reintentar');
    expect(b.level).toBe('critical');
  });
});

describe('Discord — el canal elegido', () => {
  it('a un webhook de Discord le manda una tarjeta (embed), no texto plano duplicado', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = DISCORD_URL;
    await opsAlert('0xFE-executor', 'critical', 'la tx 7BFC…65F lleva 47 min pillada', {
      key: 'stuck:7BFC',
      facts: { hash: '7BFC65F', xrp: 12.5, vacio: null },
      runbook: '/app/admin → Sistema → Desatascar → Reintentar',
    });

    const b = calls[0].body as {
      content?: string;
      username?: string;
      allowed_mentions?: { parse: string[] };
      embeds: Array<{
        title: string;
        description: string;
        color: number;
        fields?: Array<{ name: string; value: string }>;
        footer?: { text: string };
      }>;
    };
    const embed = b.embeds[0];
    expect(embed.title).toBe('🔴 CRITICAL · 0xFE-executor');
    expect(embed.description).toContain('47 min pillada');
    expect(embed.color).toBe(0xef4444); // rojo = crítico, se ve sin leer
    // El objeto afectado, en campos copiables; los vacíos no ensucian.
    expect(embed.fields?.map((f) => f.name)).toEqual(['hash', 'xrp', '↳ Arreglo']);
    expect(embed.fields?.[2].value).toContain('Desatascar');
    expect(embed.footer?.text).toBe('stuck:7BFC');
    // Sin mención configurada: ni `content` (el mensaje no sale dos veces) ni pings.
    expect(b.content).toBeUndefined();
    expect(b.allowed_mentions?.parse).toEqual([]);
    expect(b.username).toContain('Astryum');
  });

  it('la mención solo aparece a partir de su nivel — el registro no molesta, lo grave despierta', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = DISCORD_URL;
    process.env.OPS_ALERT_DISCORD_MENTION = '@everyone';

    await opsAlert('x', 'warn', 'aviso normal');
    expect((calls[0].body as { content?: string }).content).toBeUndefined();

    await opsAlert('x', 'critical', 'esto sí');
    const b = calls[1].body as { content?: string; allowed_mentions?: { parse: string[] } };
    expect(b.content).toBe('@everyone');
    expect(b.allowed_mentions?.parse).toContain('everyone');
  });

  it('OPS_ALERT_DISCORD_MENTION_MIN_LEVEL baja el listón de la mención', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = DISCORD_URL;
    process.env.OPS_ALERT_DISCORD_MENTION = '<@&999>';
    process.env.OPS_ALERT_DISCORD_MENTION_MIN_LEVEL = 'warn';
    await opsAlert('x', 'warn', 'ahora también avisa');
    expect((calls[0].body as { content?: string }).content).toBe('<@&999>');
  });

  it('un webhook que NO es de Discord sigue recibiendo el body genérico (Slack intacto)', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/x';
    await opsAlert('x', 'warn', 'hola slack');
    const b = calls[0].body as { text?: string; content?: string; embeds?: unknown };
    expect(b.embeds).toBeUndefined();
    expect(b.content).toBe(b.text);
  });

  it('un 429 con retry_after no pierde el aviso: reintenta una vez', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = DISCORD_URL;
    let attempts = 0;
    global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ retry_after: 0.01 }),
        } as Response;
      }
      calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    await opsAlert('x', 'critical', 'ráfaga');
    expect(attempts).toBe(2);
    expect(calls).toHaveLength(1);
  });
});

describe('robustez', () => {
  it('un canal caído no impide la entrega en el otro ni lanza', async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = 'https://discord.test/roto';
    process.env.OPS_ALERT_TELEGRAM_BOT_TOKEN = 'tok';
    process.env.OPS_ALERT_TELEGRAM_CHAT_ID = '42';
    global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes('discord')) throw new Error('ECONNRESET');
      calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    await expect(opsAlert('x', 'critical', 'fuego')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('telegram');
  });

  it('sin ningún canal armado no explota: la alerta vive en logs y en el panel', async () => {
    await expect(opsAlert('x', 'critical', 'fuego')).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(alertChannels().every((c) => !c.armed)).toBe(true);
  });
});

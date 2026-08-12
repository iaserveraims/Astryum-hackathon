/**
 * Admin ops — la vigilancia (Sentinel) desde /app/admin.
 *
 * Mismas puertas que el resto del panel (requireAdmin de adminPanel.ts: sesión
 * de panel / x-admin-key / SIWE+ADMIN_EMAILS) y router propio para que
 * adminPanel siga siendo read-only por construcción.
 *
 * Qué toca y qué no: los probes del Sentinel son LECTURAS (salud del executor,
 * frescura de nodos, filas de la DB). Nada aquí firma, escribe on-chain ni
 * mueve capital (invariantes #1/#8). Los dos POST son operativos:
 *   · /sentinel/run  — forzar una pasada ahora (lo que el vigía haría solo).
 *   · /sentinel/test — mandar UNA alerta de prueba por los canales reales,
 *     para que el primer crítico de verdad no sea también el primer intento
 *     de entrega. Rate-limitado: el canal del fundador no es un juguete.
 */
import { Router, Request, Response } from 'express';
import { requireAdmin } from './adminPanel';

const router = Router();
router.use(requireAdmin);

// GET /sentinel — el estado de la vigilancia: probes, incidencias abiertas,
// canales armados. Si el vigía aún no ha hecho ninguna pasada (proceso recién
// arrancado, o apagado por env) se hace una en el momento para no servir un
// panel vacío que parece "todo bien".
router.get('/sentinel', async (_req: Request, res: Response) => {
  try {
    const { getSentinel } = await import('../services/ops/SentinelService');
    const sentinel = getSentinel();
    const snap = sentinel.snapshot();
    res.json(snap.passes === 0 ? await sentinel.runPass() : snap);
  } catch (e) {
    res.status(500).json({ error: 'SENTINEL_FAILED', detail: (e as Error).message });
  }
});

// POST /sentinel/run — pasada inmediata (el botón "Comprobar ahora").
router.post('/sentinel/run', async (_req: Request, res: Response) => {
  try {
    const { getSentinel } = await import('../services/ops/SentinelService');
    res.json(await getSentinel().runPass());
  } catch (e) {
    res.status(500).json({ error: 'SENTINEL_RUN_FAILED', detail: (e as Error).message });
  }
});

// Un test cada 60 s como mucho: verificar el canal es sano, machacarlo no.
let lastTestAt = 0;
const TEST_COOLDOWN_MS = 60_000;

// POST /sentinel/test — { level? } dispara una alerta de prueba por el camino
// REAL (log + bandeja + canales). Devuelve qué canales estaban armados para
// ese nivel, de modo que "no me ha llegado nada" se diagnostique sin adivinar.
router.post('/sentinel/test', async (req: Request, res: Response) => {
  const raw = String((req.body as Record<string, unknown> | undefined)?.level ?? 'warn');
  const level = raw === 'info' || raw === 'critical' ? raw : 'warn';
  const now = Date.now();
  if (now - lastTestAt < TEST_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'TOO_SOON',
      detail: `espera ${Math.ceil((TEST_COOLDOWN_MS - (now - lastTestAt)) / 1000)} s entre pruebas`,
    });
  }
  lastTestAt = now;
  try {
    const { opsAlert, alertChannels } = await import('../services/OpsAlertService');
    const channels = alertChannels();
    await opsAlert(
      'sentinel/prueba',
      level,
      `prueba del canal de alertas lanzada desde /app/admin (${new Date(now).toISOString()})`,
      {
        key: 'prueba',
        runbook: 'Si lees esto en el canal, la entrega funciona. Si no llega, revisa la URL/el token en Railway.',
      },
    );
    return res.json({ ok: true, level, channels, sentAt: new Date(now).toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'TEST_ALERT_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /cages — la flota de jaulas, para el panel (Sistema → «Jaulas · factory»).
 *
 * Nació con el carril self-service (2026-08-06, factory en mainnet): desde que
 * las jaulas las crean los users, «¿va bien el carril?» ya no se contesta
 * mirando un vault. Devuelve: la config del factory PROBADA contra la cadena
 * (una dirección con el checksum mal es el fallo silencioso — todo user vería
 * «sin jaula» con el factory sano), el censo de jaulas nacidas con su consejo
 * y su capital, los nacimientos en vuelo, y los rechazos del prepare (fricción
 * de users). Solo lecturas.
 */
router.get('/cages', async (_req: Request, res: Response) => {
  try {
    const { readCageFactoryStatus, readCageCensus, listCageBirths, readBirthEconomics, cageCreateRefusalStats } =
      await import('../services/flare/LegacyCageFleetService');
    const [factory, census, births, economics] = await Promise.all([
      readCageFactoryStatus(),
      readCageCensus(),
      listCageBirths(),
      readBirthEconomics(),
    ]);
    return res.json({
      factory,
      census,
      births,
      economics,
      refusals: cageCreateRefusalStats(),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'CAGES_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /whois?address=r… | 0x… — ¿de QUIÉN es esta dirección?
 *
 * Nació de una investigación real (2026-08-03): tres mints del carril 0xFE en
 * un día con la beta cerrada, y ninguna forma de saber si venían de una cuenta
 * conocida sin abrir la base de datos a mano. Una dirección que gasta
 * presupuesto del executor tiene que poder rastrearse hasta su cuenta desde el
 * panel, no desde una consola.
 *
 * Solo lectura y solo para admins. Devuelve la wallet, la cuenta que la enlazó
 * y las señales que explican POR QUÉ pudo operar (aprobada en la lista de
 * espera, exenta del tope, en la lista de acceso a Legacy).
 */
router.get('/whois', async (req: Request, res: Response) => {
  const address = String(req.query.address ?? '').trim();
  if (!/^(r[1-9A-HJ-NP-Za-km-z]{24,34}|0x[a-fA-F0-9]{40})$/.test(address)) {
    return res.status(400).json({ error: 'INVALID_ADDRESS', detail: 'una r-address de XRPL o una 0x… de EVM' });
  }
  try {
    const { prisma } = await import('../database/prismaClient');
    // Las direcciones EVM se guardan en minúsculas; las de XRPL, tal cual.
    const candidates = address.startsWith('0x') ? [address, address.toLowerCase()] : [address];
    const userSelect = {
      email: true,
      username: true,
      createdAt: true,
      lastLogin: true,
      authProvider: true,
    } as const;
    const wallets = await prisma.wallet.findMany({
      where: { address: { in: candidates } },
      select: {
        address: true,
        nickname: true,
        walletType: true,
        network: true,
        ecosystem: true,
        purpose: true,
        isConnected: true,
        lastActivity: true,
        createdAt: true,
        user: { select: userSelect },
      },
    });
    const governed = await prisma.governedAccount.findMany({
      where: { address: { in: candidates } },
      select: { label: true, createdAt: true, removedAt: true, user: { select: { email: true } } },
    });
    // Una cuenta creada por SIWE/Xaman lleva su r-address EN EL USUARIO, sin
    // pasar por la tabla de wallets: sin esto, el dueño más probable de una
    // dirección XRPL sería justo el que no aparece.
    const directUsers = address.startsWith('r')
      ? await prisma.user.findMany({ where: { xrplAddress: address }, select: userSelect })
      : [];

    const emails = new Set<string>();
    for (const w of wallets) if (w.user?.email) emails.add(w.user.email.toLowerCase());
    for (const g of governed) if (g.user?.email) emails.add(g.user.email.toLowerCase());
    for (const u of directUsers) if (u.email) emails.add(u.email.toLowerCase());

    // ¿Por qué pudo operar? Las tres puertas que dan permiso, resueltas aquí
    // para no tener que cruzar tres pantallas.
    const listed = (name: string) =>
      (process.env[name] ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const approvals = await prisma.waitlistSignup.findMany({
      where: { email: { in: Array.from(emails) } },
      select: { email: true, approvedAt: true, invitedAt: true, source: true },
    });

    return res.json({
      address,
      found: wallets.length > 0 || governed.length > 0 || directUsers.length > 0,
      wallets,
      /** Cuentas cuya identidad ES esta dirección (login por Xaman/SIWE). */
      loginAccounts: directUsers,
      governedPointers: governed,
      accounts: Array.from(emails).map((email) => ({
        email,
        waitlist: approvals.find((a) => a.email.toLowerCase() === email) ?? null,
        isAdmin: listed('ADMIN_EMAILS').includes(email),
        capExempt: listed('DEMO_CAP_EXEMPT_EMAILS').includes(email),
        legacyAccess: listed('LEGACY_ACCESS_EMAILS').includes(email),
      })),
      capExemptByAddress: listed('DEMO_CAP_EXEMPT_ADDRESSES').includes(address.toLowerCase()),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'WHOIS_FAILED', detail: (e as Error).message });
  }
});

export default router;

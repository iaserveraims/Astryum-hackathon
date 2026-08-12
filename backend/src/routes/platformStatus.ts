/**
 * Platform status — the "Astryum Orbit System" light the dashboard's summary
 * card reads (founder 2026-07-25): online by default; the founders can flip it
 * to offline from the admin panel with a hand-written reason (maintenance,
 * backend incident…) so users KNOW when we are working on the ship instead of
 * guessing why something stalls.
 *
 *   GET /api/platform/status   public — { state, reason, updatedAt }
 *   PUT /api/platform/status   founders only (adminPanel's requireAdmin: the
 *                              same static-key/session/allowlist doors) —
 *                              body { state: 'online'|'offline', reason? }
 *
 * Persistence: ONE row in the existing `configurations` KV table (key
 * `platform.status`) — no new model, no migration. A missing row or an
 * unreachable DB reads as online: the switch exists to ANNOUNCE work, not to
 * gate the app, so its failure mode must never invent an outage banner.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { requireAdmin } from './adminPanel';

const router = Router();

const KEY = 'platform.status';
const MAX_REASON_LENGTH = 300;

type PlatformState = 'online' | 'offline';
interface StoredStatus {
  state: PlatformState;
  reason?: string;
}

const DEFAULT_STATUS = { state: 'online' as PlatformState, reason: null, updatedAt: null };

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const row = await prisma.configuration.findUnique({ where: { key: KEY } });
    if (!row) {
      res.json(DEFAULT_STATUS);
      return;
    }
    const value = (row.value ?? {}) as Partial<StoredStatus>;
    res.json({
      state: value.state === 'offline' ? 'offline' : 'online',
      reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason : null,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch {
    // DB unreachable — see the header: never invent an outage.
    res.json(DEFAULT_STATUS);
  }
});

router.put('/status', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { state, reason } = (req.body ?? {}) as { state?: unknown; reason?: unknown };
  if (state !== 'online' && state !== 'offline') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }
  if (reason != null && typeof reason !== 'string') {
    res.status(400).json({ error: 'INVALID_REASON' });
    return;
  }
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LENGTH) : '';
  // The reason only means something while offline — going back online clears it.
  const value: StoredStatus = state === 'offline' && trimmed ? { state, reason: trimmed } : { state };
  const row = await prisma.configuration.upsert({
    where: { key: KEY },
    create: { key: KEY, value: value as object, description: 'Astryum Orbit System light (admin-set)', isSystem: true },
    update: { value: value as object },
  });
  res.json({ state: value.state, reason: value.reason ?? null, updatedAt: row.updatedAt.toISOString() });
}));

// ── Live activity — the public proof-of-life feed (founder 2026-07-26) ───────
//
// GET /api/platform/activity  public — { total, recent[], updatedAt }
//
// The counterweight to the sign-up risk disclaimer: anyone (no account, no
// auth) can see that operations REALLY execute through Astryum, each one
// verifiable on the public explorers. Source of truth: the 0xFE handoff rows
// the executor marked 'completed' (DirectMintHandoffStore.markHandoffExecuted)
// — real settled operations, never a mock.
//
// PRIVACY (aviso §3.2/§7): the payload row carries the user's xrplAddress and
// personalAccount — they are deliberately NOT returned. And since 2026-08-01 the
// redaction is not enough on its own: the LIST is closed by the public cupo
// below (a tx hash resolves to its account on any explorer), so it keeps what
// was already published and takes nothing new — not even ours. `total` stays
// whole and live on purpose — an aggregate that names nobody.
//
// Cheap by construction: public endpoint → 30s in-process cache, capped list,
// and a DB failure reads as an empty feed, never a 500 (same posture as
// /status: this route announces, it must not invent outages).

const ACTIVITY_CACHE_MS = 30_000;
const ACTIVITY_LIMIT = 20;

// ── El cupo público — qué operaciones puede publicar la landing ──────────────
//
// Founder 2026-08-01, antes de abrir la beta: "cerrar ya el cupo de
// transacciones visibles; dejamos las que hay, que son de cuentas nuestras de
// prueba" — y, al repasarlo: "dejamos visible todo lo que hay hoy allí. no van a
// entrar más". Corte seco: ni de usuarios ni nuestras.
//
// El motivo es de privacidad, no de estética: aunque estas rutas ya redactan
// xrplAddress/personalAccount, un tx hash ES un identificador — quien lo abre en
// el explorador ve la cuenta, el importe y todo su historial. Y el `userOpData`
// del verificador lleva dentro el Personal Account del firmante. Publicar una
// operación equivale a publicar la cuenta que la firmó (aviso §3.2).
//
// Regla, evaluada por operación: se publica si es anterior al corte. Punto. Una
// fecha mal escrita cae al default, nunca a "pasa todo". Mover el corte hacia
// delante es un acto deliberado (cambiar la env), no algo que ocurra solo.
//
//   PROOF_PUBLIC_CUTOFF_AT   ISO-8601. Default: el cierre del cupo.
//
// El CONTADOR de operaciones liquidadas queda fuera de esta regla a propósito
// (founder 2026-08-01): es un agregado que no identifica a nadie y es la métrica
// de tracción real. La landing lo dice explícitamente para no prometer que la
// lista de abajo sea "todo lo que pasa".
const PROOF_CUTOFF_DEFAULT = '2026-08-02T00:00:00Z';

function proofCutoff(): Date {
  const raw = (process.env.PROOF_PUBLIC_CUTOFF_AT || '').trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  return new Date(Number.isFinite(parsed) ? parsed : Date.parse(PROOF_CUTOFF_DEFAULT));
}

interface ActivityItem {
  at: string | null;
  xrp: number | null;
  xrplTxHash: string | null;
  flareTxHash: string | null;
}
interface ActivityFeed {
  total: number;
  recent: ActivityItem[];
  updatedAt: string;
}

let activityCache: { at: number; data: ActivityFeed } | null = null;

router.get('/activity', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (activityCache && now - activityCache.at < ACTIVITY_CACHE_MS) {
    res.json(activityCache.data);
    return;
  }
  try {
    const [rows, total] = await Promise.all([
      // Solo lo que ya había cuando se cerró el cupo — ver el bloque de arriba.
      prisma.backgroundJob.findMany({
        where: { jobType: '0xfe-handoff', status: 'completed', completedAt: { lt: proofCutoff() } },
        orderBy: { completedAt: 'desc' },
        take: ACTIVITY_LIMIT,
        select: { completedAt: true, payload: true, result: true },
      }),
      // El contador cuenta TODAS (agregado sin identidad) — ver el bloque del cupo.
      prisma.backgroundJob.count({ where: { jobType: '0xfe-handoff', status: 'completed' } }),
    ]);
    const recent: ActivityItem[] = rows.map((r) => {
      const p = (r.payload ?? {}) as { grossXrpDrops?: string };
      const x = (r.result ?? {}) as { xrplTxHash?: string; flareTxHash?: string };
      const drops = Number(p.grossXrpDrops);
      return {
        at: r.completedAt ? r.completedAt.toISOString() : null,
        xrp: Number.isFinite(drops) && drops > 0 ? drops / 1_000_000 : null,
        xrplTxHash: typeof x.xrplTxHash === 'string' ? x.xrplTxHash : null,
        flareTxHash: typeof x.flareTxHash === 'string' ? x.flareTxHash : null,
      };
    });
    const data: ActivityFeed = { total, recent, updatedAt: new Date().toISOString() };
    activityCache = { at: now, data };
    res.json(data);
  } catch {
    // DB unreachable — an empty feed, never an invented error banner.
    res.json({ total: 0, recent: [], updatedAt: new Date().toISOString() });
  }
});

// ── Trust — who is who on the money's path (founder 2026-07-29) ──────────────
//
// GET /api/platform/trust  public — { path, sample, updatedAt }
//
// Feeds the landing's /proof page ("No te pedimos confianza. La da el código."):
// the four pieces XRP travels through on a 0xFE operation, each resolved LIVE
// from the chain/config so the page can never drift from production:
//
//   coreVaultXrpl            FAssets' XRPL address — the Payment Destination
//   assetManagerFxrp         Flare's — mints FXRP into the Personal Account
//   masterAccountController  Flare's — validates keccak256(_data) == memo hash
//   executor                 OURS — delivers the signed order, pays gas. Only
//                            piece Astryum controls; address derived from the
//                            env key, the key itself never leaves the server.
//
// `sample` is the latest SETTLED 0xFE operation with its full bytes so the
// visitor can recompute keccak256(userOpData) in their own browser and match
// it against the hash committed in the signed memo.
//
// PRIVACY (aviso §3.2): same posture as /activity — the handoff row's
// xrplAddress/personalAccount are deliberately NOT returned, AND the sample
// obeys the public cupo: only operations already published before the cut are
// served. That matters more here than in the feed, because userOpData is the
// order's raw bytes — the signer's Personal Account travels inside them.
//
// Same failure posture as the rest of this file: unresolved pieces come back
// null and the route never 500s — the page renders what it can prove.

const TRUST_CACHE_MS = 5 * 60_000;

interface TrustPath {
  coreVaultXrpl: string | null;
  assetManagerFxrp: string | null;
  masterAccountController: string | null;
  executor: string | null;
}
interface TrustSample {
  at: string | null;
  xrp: number | null;
  userOpHash: string;
  userOpData: string;
  memoHex: string;
  xrplTxHash: string | null;
  flareTxHash: string | null;
}
// The Legacy circuit — served for the /proof page's Legacy tab (founder
// 2026-07-29: "un toggle con las pruebas, más o menos como el de personal").
// Addresses come from the deployed-stack env config; constitutionRef and the
// executed-order count are read LIVE from the chain. The council's own XRPL
// account is per-family and is deliberately NOT served (same posture as user
// addresses in the 0xFE sample) — the sample's explorer links already show
// what the chain shows.
interface TrustLegacy {
  chain: string;
  vault: string;
  bridge: string;
  orderAnchor: string;
  constitutionRef: string | null;
  ordersExecuted: number | null;
  sample: {
    at: string | null;
    action: string | null;
    xrplTxHash: string | null;
    flareTxHash: string | null;
  } | null;
}

interface TrustPayload {
  path: TrustPath;
  sample: TrustSample | null;
  legacy: TrustLegacy | null;
  updatedAt: string;
}

let trustCache: { at: number; data: TrustPayload } | null = null;

const ZERO_EVM_ADDR = '0x0000000000000000000000000000000000000000';

async function resolveTrustPath(): Promise<TrustPath> {
  const path: TrustPath = {
    coreVaultXrpl: null,
    assetManagerFxrp: null,
    masterAccountController: null,
    executor: null,
  };
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(
      process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    );
    const [{ resolveAssetManagerFxrp, readDirectMintParams, resolveRedemptionExecutor }, { resolveMasterAccountController }] =
      await Promise.all([
        import('../connectors/protocols/flare/FlareDirectMintService'),
        import('../connectors/protocols/flare/FlareSmartAccountService'),
      ]);
    // Each piece resolves independently — one RPC hiccup must not blank the rest.
    const [am, params, mac, executor] = await Promise.all([
      resolveAssetManagerFxrp(provider).catch(() => null),
      readDirectMintParams(provider).catch(() => null),
      resolveMasterAccountController(provider).catch(() => null),
      resolveRedemptionExecutor().catch(() => null),
    ]);
    path.assetManagerFxrp = am;
    path.coreVaultXrpl = params?.paymentAddress || null;
    path.masterAccountController = mac;
    path.executor = executor && executor !== ZERO_EVM_ADDR ? executor : null;
  } catch {
    // ethers/provider unavailable — all nulls, the page says so honestly.
  }
  return path;
}

async function resolveTrustSample(): Promise<TrustSample | null> {
  try {
    // Mismo cupo que el feed — y aquí importa el doble: `userOpData` son los
    // bytes de la orden, con el Personal Account del firmante dentro.
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType: '0xfe-handoff', status: 'completed', completedAt: { lt: proofCutoff() } },
      orderBy: { completedAt: 'desc' },
      take: 10,
      select: { completedAt: true, payload: true, result: true },
    });
    for (const r of rows) {
      const p = (r.payload ?? {}) as { userOpHash?: string; userOpData?: string; memoHex?: string; grossXrpDrops?: string };
      const x = (r.result ?? {}) as { xrplTxHash?: string; flareTxHash?: string };
      // The verifier needs the full triplet: bytes, committed hash, signed memo.
      if (
        typeof p.userOpHash !== 'string' ||
        typeof p.userOpData !== 'string' ||
        typeof p.memoHex !== 'string'
      ) {
        continue;
      }
      const drops = Number(p.grossXrpDrops);
      return {
        at: r.completedAt ? r.completedAt.toISOString() : null,
        xrp: Number.isFinite(drops) && drops > 0 ? drops / 1_000_000 : null,
        userOpHash: p.userOpHash,
        userOpData: p.userOpData,
        memoHex: p.memoHex,
        xrplTxHash: typeof x.xrplTxHash === 'string' ? x.xrplTxHash : null,
        flareTxHash: typeof x.flareTxHash === 'string' ? x.flareTxHash : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveTrustLegacy(): Promise<TrustLegacy | null> {
  let legacy: TrustLegacy;
  try {
    // Throws when the stack env is unset (e.g. local dev) — legacy reads as
    // null and the page's Legacy tab says so honestly.
    const { legacyStackConfig } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const cfg = legacyStackConfig();
    legacy = {
      chain: cfg.chain,
      vault: cfg.vault,
      bridge: cfg.bridge,
      orderAnchor: cfg.orderAnchor,
      constitutionRef: null,
      ordersExecuted: null,
      sample: null,
    };
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const vault = new ethers.Contract(cfg.vault, ['function constitutionRef() view returns (bytes32)'], provider);
      const bridge = new ethers.Contract(cfg.bridge, ['function nextNonce() view returns (uint64)'], provider);
      const [ref, nonce] = await Promise.all([
        vault.constitutionRef().catch(() => null),
        bridge.nextNonce().catch(() => null),
      ]);
      legacy.constitutionRef = typeof ref === 'string' && /^0x[0-9a-fA-F]{64}$/.test(ref) ? ref : null;
      legacy.ordersExecuted = nonce != null ? Number(nonce) : null;
    } catch {
      /* chain reads are optional — the addresses alone are already provable */
    }
  } catch {
    return null;
  }
  try {
    // El cupo también aquí: hoy el único consejo es el nuestro, pero cuando una
    // familia real ejecute su orden, su circuito no se publica (su cuenta XRPL
    // es tan identificable como la de un usuario).
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType: 'legacy-council-order', status: 'completed', completedAt: { lt: proofCutoff() } },
      orderBy: { completedAt: 'desc' },
      take: 1,
      select: { completedAt: true, payload: true, result: true },
    });
    const r = rows[0];
    if (r) {
      const p = (r.payload ?? {}) as { action?: string };
      const x = (r.result ?? {}) as { xrplTxHash?: string; flareTxHash?: string };
      // The payload row carries the family's council r-address — NOT returned.
      legacy.sample = {
        at: r.completedAt ? r.completedAt.toISOString() : null,
        action: typeof p.action === 'string' ? p.action : null,
        xrplTxHash: typeof x.xrplTxHash === 'string' ? x.xrplTxHash : null,
        flareTxHash: typeof x.flareTxHash === 'string' ? x.flareTxHash : null,
      };
    }
  } catch {
    /* DB unreachable — no sample, never an error */
  }
  return legacy;
}

router.get('/trust', asyncHandler(async (_req: Request, res: Response) => {
  const now = Date.now();
  if (trustCache && now - trustCache.at < TRUST_CACHE_MS) {
    res.json(trustCache.data);
    return;
  }
  const [path, sample, legacy] = await Promise.all([
    resolveTrustPath(),
    resolveTrustSample(),
    resolveTrustLegacy(),
  ]);
  const data: TrustPayload = { path, sample, legacy, updatedAt: new Date().toISOString() };
  // A fully-empty answer (cold RPC / no DB) only sticks for 30s, not 5 min —
  // the underlying resolvers memoize, so the retry is cheap.
  const empty = !sample && !legacy && Object.values(path).every((v) => v === null);
  trustCache = { at: empty ? now - (TRUST_CACHE_MS - 30_000) : now, data };
  res.json(data);
}));

export default router;

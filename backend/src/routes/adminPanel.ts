/**
 * Admin panel — read-only overview for the 2 founders (DB counts + the
 * waitlist), so they never need to open the database directly.
 *
 * Gate, two doors (founder 2026-07-19 — "de momento un login estático"):
 *
 *   1. STATIC KEY (the current door): ADMIN_PANEL_KEY env — the founders type
 *      it into the panel's login card and it travels as `x-admin-key`. The
 *      secret lives ONLY in the backend env (never NEXT_PUBLIC_*, never in
 *      the repo — invariant §2), and the comparison is constant-time over
 *      sha256 digests. Works without a backend account, mirroring how the
 *      dashboard's own static door creates no backend session.
 *
 *   2. SIWE + ADMIN_EMAILS (the future default): a logged-in caller whose
 *      email is on the comma-separated allowlist. Kept fully functional so
 *      retiring the static key is a one-env change, not a code change.
 *
 * If NEITHER env is configured the whole surface 404s — it doesn't even
 * reveal it exists. Nothing is read from the DB before a gate passes.
 *
 * Read-only by construction: every handler in this router is a GET, and none
 * of them ever selects passwordHash, resetToken or any other secret column.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/prismaClient';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { resolveJwtSecret } from '../services/SiweAuth';
import { requireTurnstile } from '../middleware/turnstile';
import { clientIp } from '../middleware/clientIp';
import { isNoiseEmail } from './waitlist';

const router = Router();

// ── Failed-attempt tracker (2026-07-23 hardening) ─────────────────────────────
// The static key is strong only while nobody can grind it. Every WRONG key —
// on POST /session or on a raw x-admin-key header — is recorded per IP; past
// MAX_KEY_FAILURES in the window the door answers 429 BEFORE any comparison
// runs (so a burnt IP can't keep testing guesses — even the right key waits
// out the window there). The counter only moves on FAILURES: honest use never
// fills it, and other IPs are never affected.
const KEY_FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_KEY_FAILURES = 10;
const keyFailures = new Map<string, number[]>();

function keyFailuresExceeded(ip: string): boolean {
  const now = Date.now();
  const recent = (keyFailures.get(ip) ?? []).filter((t) => now - t < KEY_FAILURE_WINDOW_MS);
  keyFailures.set(ip, recent);
  return recent.length >= MAX_KEY_FAILURES;
}

function recordKeyFailure(ip: string): void {
  const now = Date.now();
  const recent = (keyFailures.get(ip) ?? []).filter((t) => now - t < KEY_FAILURE_WINDOW_MS);
  recent.push(now);
  keyFailures.set(ip, recent);
  if (keyFailures.size > 10_000) {
    for (const [k, v] of keyFailures) {
      if (v.every((t) => now - t >= KEY_FAILURE_WINDOW_MS)) keyFailures.delete(k);
    }
  }
}

/** Test hook — clears the failure tracker between cases. */
export function _resetKeyFailuresForTests(): void {
  keyFailures.clear();
}

// Short-lived panel session: the founder types the key ONCE (captcha-gated),
// gets a 2h scope-limited token, and THAT is what travels on every overview
// call — the raw key stops living in sessionStorage and stops riding every
// request, which shrinks what a phishing page or an XSS could steal.
const ADMIN_SESSION_TTL_S = 2 * 60 * 60;
const ADMIN_SESSION_SCOPE = 'admin-panel';

// ADMIN_EMAILS: comma-separated, case-insensitive, trimmed. Unset/blank →
// null (that door is closed).
function adminAllowlist(): Set<string> | null {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || !raw.trim()) return null;
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? new Set(emails) : null;
}

/**
 * Whether this email sits on the ADMIN_EMAILS allowlist. Consumed by
 * GET /auth/me so the dashboard can surface the panel entry to the founders —
 * a VISIBILITY hint only: every panel read stays behind requireAdmin, so a
 * client lying about this flag opens nothing.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminAllowlist()?.has(email.trim().toLowerCase()) ?? false;
}

// Constant-time equality over sha256 digests — digesting first makes the
// buffers equal-length, which timingSafeEqual requires, and leaks nothing
// about where the mismatch happened.
function keyMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function emailGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const allowlist = adminAllowlist();
  const userId = req.siwe?.userId;
  const user =
    allowlist && userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
      : null;
  const email = user?.email?.toLowerCase();
  if (!allowlist || !email || !allowlist.has(email)) {
    res.status(403).json({ error: 'NOT_AN_ADMIN' });
    return;
  }
  next();
}

// Exported (2026-07-25) so platformStatus.ts can guard its ONE write — the
// online/offline switch — behind the exact same founders' doors. THIS router
// stays read-only by construction; the write lives in its own router.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const staticKey = (process.env.ADMIN_PANEL_KEY ?? '').trim();
  const allowlist = adminAllowlist();
  if (!staticKey && !allowlist) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  // Door 0 — a panel session issued by POST /session (the UI's normal path).
  const sessionToken = (req.header('x-admin-session') ?? '').trim();
  if (staticKey && sessionToken) {
    try {
      const payload = jwt.verify(sessionToken, resolveJwtSecret()) as { scope?: string };
      if (payload.scope === ADMIN_SESSION_SCOPE) {
        next();
        return;
      }
    } catch {
      /* expired/forged — fall through to the explicit 401 below */
    }
    res.status(401).json({ error: 'ADMIN_SESSION_EXPIRED' });
    return;
  }

  const presented = (req.header('x-admin-key') ?? '').trim();
  if (staticKey && presented) {
    const ip = clientIp(req);
    if (keyFailuresExceeded(ip)) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      return;
    }
    if (keyMatches(presented, staticKey)) {
      next();
      return;
    }
    recordKeyFailure(ip);
    console.warn(`[admin-panel] wrong x-admin-key from ${ip}`);
    res.status(401).json({ error: 'BAD_ADMIN_KEY' });
    return;
  }

  if (allowlist) {
    // The SIWE door. req.siwe may already be populated (tests / an auth'd
    // mount); otherwise authenticate here — this router is mounted WITHOUT a
    // global requireSiweAuth so the static-key door works session-less.
    if (req.siwe?.userId) {
      void emailGate(req, res, next);
      return;
    }
    void requireSiweAuth(req, res, () => void emailGate(req, res, next));
    return;
  }

  res.status(401).json({ error: 'ADMIN_KEY_REQUIRED' });
}

/**
 * POST /session — trade the static key for a 2h scope-limited token.
 * Captcha-gated (when TURNSTILE_SECRET_KEY is set) + per-IP failure limit.
 * Mounted BEFORE requireAdmin on purpose: this IS the door.
 * 404s like everything else when the panel is unconfigured.
 */
router.post('/session', requireTurnstile(), (req: Request, res: Response) => {
  const staticKey = (process.env.ADMIN_PANEL_KEY ?? '').trim();
  if (!staticKey) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  const ip = clientIp(req);
  if (keyFailuresExceeded(ip)) {
    res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
    return;
  }
  const presented = String((req.body as Record<string, unknown> | undefined)?.key ?? '').trim();
  if (!presented) {
    res.status(400).json({ error: 'KEY_REQUIRED' });
    return;
  }
  if (!keyMatches(presented, staticKey)) {
    recordKeyFailure(ip);
    console.warn(`[admin-panel] failed session login from ${ip}`);
    res.status(401).json({ error: 'BAD_ADMIN_KEY' });
    return;
  }
  const token = jwt.sign({ scope: ADMIN_SESSION_SCOPE }, resolveJwtSecret(), {
    expiresIn: ADMIN_SESSION_TTL_S,
  });
  res.json({
    token,
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_S * 1000).toISOString(),
  });
});

router.use(requireAdmin);

// GET /executor — gauges vivos del executor 0xFE, servidos bajo la sesión del
// panel (regla fundador 2026-07-25: las métricas se miran en /app/admin, no en
// snippets de consola). Mismo snapshot que /flare-demo/executor-health: todo
// información on-chain pública o booleanos de config, jamás claves ni env.
router.get('/executor', async (_req: Request, res: Response) => {
  try {
    const { directMintExecutorWatcher } = await import('../services/flare/DirectMintExecutorService');
    res.json({ ...directMintExecutorWatcher.health(), checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'EXECUTOR_HEALTH_FAILED', detail: (e as Error).message });
  }
});

// GET /alerts — la bandeja de alertas/notificaciones de operación (executor
// 0xFE, vigía XRPL, provider-health, relay Legacy). Persistidas SIEMPRE por
// OpsAlertStore (no dependen del webhook), servidas bajo la sesión del panel.
// Read-only: solo lee el buffer circular de `background_jobs` (jobType
// 'ops-alert') — mensajes de operación, jamás claves ni env. `counts` es el
// resumen por severidad de lo devuelto; `sources` alimenta el filtro de la UI.
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const { listOpsAlerts } = await import('../services/OpsAlertStore');
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const alerts = await listOpsAlerts({ limit });
    const counts = { info: 0, warn: 0, critical: 0 };
    for (const a of alerts) counts[a.level] += 1;
    const sources = Array.from(new Set(alerts.map((a) => a.source))).sort();
    res.json({ alerts, counts, sources, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'OPS_ALERTS_FAILED', detail: (e as Error).message });
  }
});

// GET /overview — counts + waitlist + recentUsers. Read-only, capped
// (10,000 waitlist rows fetched once to separate signal from noise, 200
// shown in the table, 50 users) — this is a glance at the DB, not an export.
//
// Signal vs noise (founder 2026-07-23): the public POST gets hammered by bots
// with syntactically-valid throwaway addresses. `isNoiseEmail` — the SAME
// predicate waitlist.ts uses to reject new noise at the door — separates
// signal from whatever got in before/around that guard, so the two never
// drift into different definitions of "noise". `counts.waitlistSignups` /
// `waitlistBySource` count clean rows only; `counts.waitlistNoise` is the
// noisy total. The `waitlist` table defaults to clean rows (each tagged
// `noise: false`); `?includeNoise=1` swaps in the top 200 rows by recency
// regardless of noise, tagged `noise: true/false`, for the rare audit pass.
router.get('/overview', async (req: Request, res: Response) => {
  const includeNoise = req.query.includeNoise === '1';

  const [users, wallets, governedAccounts, councilProposals, allSignups, recentUsersRaw, providerGroups] = await Promise.all([
    prisma.user.count(),
    prisma.wallet.count(),
    prisma.governedAccount.count(),
    prisma.councilProposal.count(),
    prisma.waitlistSignup.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      // approvedAt/invitedAt: the beta gate's state, so the Waitlist tab can
      // show who has a seat and the approve button (writes live in
      // adminBetaGate.ts — this surface stays read-only).
      select: { email: true, source: true, lang: true, createdAt: true, approvedAt: true, invitedAt: true },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { email: true, username: true, createdAt: true, lastLogin: true, authProvider: true, oauthSub: true },
    }),
    // OAuth users separated from plain-email users (founder 2026-07-23).
    prisma.user.groupBy({ by: ['authProvider'], _count: { _all: true } }),
  ]);

  // authProviders per user: creation origin + any OAuth identity linked later
  // (an email account that adopted Google shows both badges). The raw
  // oauthSub never leaves the backend — only the provider prefix does.
  const recentUsers = recentUsersRaw.map(({ oauthSub, authProvider, ...rest }) => {
    const providers = new Set<string>([authProvider]);
    const linked = oauthSub?.split(':')[0];
    if (linked) providers.add(linked);
    return { ...rest, authProviders: Array.from(providers) };
  });

  const usersByProvider: Record<string, number> = {};
  for (const group of providerGroups) {
    usersByProvider[group.authProvider] = group._count._all;
  }

  const waitlistBySource: Record<string, number> = {};
  const clean: typeof allSignups = [];
  let waitlistNoise = 0;
  let waitlistApproved = 0;
  for (const row of allSignups) {
    if (isNoiseEmail(row.email)) {
      waitlistNoise += 1;
      continue;
    }
    clean.push(row);
    if (row.approvedAt != null) waitlistApproved += 1;
    waitlistBySource[row.source] = (waitlistBySource[row.source] ?? 0) + 1;
  }

  const waitlist = includeNoise
    ? allSignups.slice(0, 200).map((row) => ({ ...row, noise: isNoiseEmail(row.email) }))
    : clean.slice(0, 200).map((row) => ({ ...row, noise: false }));

  return res.json({
    counts: {
      users,
      wallets,
      governedAccounts,
      councilProposals,
      waitlistSignups: clean.length,
      waitlistApproved,
      waitlistNoise,
      waitlistBySource,
      usersByProvider,
    },
    waitlist,
    recentUsers,
  });
});

export default router;

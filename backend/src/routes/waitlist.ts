/**
 * Early-access waitlist — public email capture for the landing's /early-access page.
 *
 * POST /api/waitlist { email, source?, lang? } → { ok: true }
 *
 * Deliberately minimal: no auth (it's the public front door), idempotent upsert
 * (resubmitting the same email is a success, and reveals nothing about whether
 * it already existed), and NO read endpoint — the list of emails is never
 * exposed over HTTP. A light in-process rate limit keeps a single IP from
 * scripting the form. `isNoiseEmail` blocks reserved/disposable domains at
 * the door (400 invalid_email) and is reused by the admin panel to filter
 * whatever got in before/around this guard — see its own doc comment below.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prismaClient';
import { sendWaitlistWelcome, mailerDiag, verifyMailer, testSend } from '../services/waitlistMailer';
import { requireTurnstile } from '../middleware/turnstile';
import { clientIp } from '../middleware/clientIp';

const router = Router();

const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.enum(['early-access', 'demo', 'legacy']).optional(),
  lang: z.enum(['es', 'en']).optional(),
});

// ── Noise filter: reserved (RFC 2606/6761) and disposable-email domains ────────
// The public POST is the front door, and bots hammer it with syntactically
// valid throwaway addresses — Zod's .email() happily accepts a@example.com.
// isNoiseEmail is the single source of truth: the POST handler rejects these
// at the door, and the admin panel (adminPanel.ts) reuses the SAME predicate
// to separate signal from noise for whatever got in before/around this guard,
// rather than trusting two definitions of "noise" to stay in sync.
const RESERVED_TLDS = new Set(['test', 'invalid', 'example', 'localhost']); // RFC 6761 special-use + RFC 2606 "example"
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'sharklasers.com',
  'yopmail.com',
  '10minutemail.com',
  'tempmail.com',
  'trashmail.com',
]);

export function isNoiseEmail(email: string): boolean {
  const domain = (email.split('@').pop() ?? '').trim().toLowerCase();
  if (!domain) return true; // no domain at all — not a real signup either
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] ?? '';
  const sld = labels.length > 1 ? labels[labels.length - 2] : '';
  // RFC 2606 reserves the "example" second-level label under ANY tld
  // (example.com/.org/.net/.io…) as well as the "example" tld itself
  // (foo.example); RFC 6761 reserves test/invalid/localhost the same way.
  return sld === 'example' || RESERVED_TLDS.has(tld);
}

// ── In-process rate limit: max 5 signups per IP per minute ─────────────────────
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

// Client IP resolution lives in middleware/clientIp.ts (shared with auth and
// the admin panel) — see its doc comment for the trust-proxy caveat.

router.post('/', requireTurnstile(), async (req: Request, res: Response) => {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  // Honeypot: the form ships a visually-hidden "website" field no human ever
  // fills. A non-empty value is a bot — answer the SAME success shape as a
  // real signup (zero signal that the trap fired) and store nothing.
  const honeypot = (req.body as Record<string, unknown> | undefined)?.website;
  if (typeof honeypot === 'string' && honeypot.trim()) {
    console.warn(`[waitlist] honeypot tripped from ${ip}`);
    return res.json({ ok: true });
  }

  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }

  const { email, source, lang } = parsed.data;
  // Same error shape as a Zod failure — bots get no signal that this address
  // specifically hit a blocklist rather than just being malformed.
  if (isNoiseEmail(email)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  try {
    const existing = await prisma.waitlistSignup.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Idempotent: refresh the language preference, keep first-seen source,
      // and do NOT resend the welcome (resubmitting isn't a mail cannon).
      await prisma.waitlistSignup.update({ where: { email }, data: { lang } });
    } else {
      await prisma.waitlistSignup.create({ data: { email, source: source ?? 'early-access', lang } });
      // Fire-and-forget: the confirmation mail must never block or fail the
      // signup (the mailer logs its own errors and no-ops if unconfigured).
      void sendWaitlistWelcome({ email, lang: lang ?? 'en', source: source ?? 'early-access' });
    }
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: 'storage_unavailable' });
  }
});

// ── TEMPORARY SMTP diagnostics ──────────────────────────────────────────────────
// GET /api/waitlist/diag?key=…            → config state + verify() (auth check)
// GET /api/waitlist/diag?key=…&send=you@x → also attempt a real send, return error
// Disabled unless WAITLIST_DIAG_KEY is set; never returns the password. Remove
// once the mailer is confirmed working.
router.get('/diag', async (req: Request, res: Response) => {
  const key = process.env.WAITLIST_DIAG_KEY;
  if (!key) return res.status(404).json({ ok: false, error: 'diag_disabled' });
  if (req.query.key !== key) return res.status(403).json({ ok: false, error: 'forbidden' });

  const diag = mailerDiag();
  const out: Record<string, unknown> = { ok: true, diag };

  // ?verify=0 → return config instantly (skip the SMTP round-trip).
  if (req.query.verify !== '0') {
    out.verify = await verifyMailer();
  }

  const send = req.query.send;
  if (typeof send === 'string' && /.+@.+\..+/.test(send)) {
    out.send = await testSend(send.trim().toLowerCase());
  }
  return res.json(out);
});

// ── Admin: list / export the signups ────────────────────────────────────────────
// GET /api/waitlist/list?key=…            → { ok, count, signups: [...] }
// GET /api/waitlist/list?key=…&format=csv → CSV download
// Gated by WAITLIST_ADMIN_KEY (falls back to WAITLIST_DIAG_KEY so it works with
// the key already in Railway). This exposes collected emails (PII): keep the key
// secret. There is deliberately no public/unauthenticated read.
function adminKey(): string | undefined {
  return process.env.WAITLIST_ADMIN_KEY || process.env.WAITLIST_DIAG_KEY;
}

router.get('/list', async (req: Request, res: Response) => {
  const key = adminKey();
  if (!key) return res.status(404).json({ ok: false, error: 'admin_disabled' });
  if (req.query.key !== key) return res.status(403).json({ ok: false, error: 'forbidden' });

  try {
    const rows = await prisma.waitlistSignup.findMany({
      orderBy: { createdAt: 'desc' },
      select: { email: true, source: true, lang: true, createdAt: true },
      take: 10_000,
    });

    if (req.query.format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = 'email,source,lang,createdAt';
      const body = rows.map((r) => [r.email, r.source, r.lang, r.createdAt.toISOString()].map(esc).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="astryum-waitlist.csv"');
      return res.send(`${header}\n${body}\n`);
    }

    return res.json({ ok: true, count: rows.length, signups: rows });
  } catch {
    return res.status(500).json({ ok: false, error: 'storage_unavailable' });
  }
});

export default router;

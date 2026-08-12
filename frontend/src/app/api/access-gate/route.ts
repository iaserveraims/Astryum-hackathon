/**
 * /api/access-gate — the ONLY place the pre-launch access code is verified.
 *
 * POST { code, captchaToken? } → sets the signed httpOnly gate cookie that
 * middleware.ts demands on /app, /login, /register and /forgot-password.
 * GET → { access } so client UI can reflect gate state (it cannot read the
 * httpOnly cookie itself). DELETE → drops the cookie.
 *
 * Defence stack, in order: per-IP throttle (8 tries / 10 min) → Cloudflare
 * Turnstile settlement (when TURNSTILE_SECRET_KEY is set) → constant-time
 * code comparison over sha256 digests. The code and both secrets are SERVER
 * env vars — nothing here ever reaches the client bundle (invariant §2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { GATE_COOKIE, GATE_TTL_MS, gateMode, gateOpenFlag, signGateToken, verifyGateToken } from '../../../lib/accessGate';

export const runtime = 'nodejs';

// ── Per-IP throttle (in-memory; per-instance on serverless — the captcha is
// the IP-independent layer, this one just makes single-origin grinding slow).
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = req.headers.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || 'unknown';
}

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5_000) {
    for (const [k, v] of attempts) {
      if (v.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
    }
  }
  return false;
}

async function captchaPasses(token: unknown, ip: string): Promise<'ok' | 'missing' | 'failed' | 'unavailable'> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return 'ok'; // feature-flagged off (local dev)
  if (typeof token !== 'string' || !token.trim()) return 'missing';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
      signal: AbortSignal.timeout(6_000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true ? 'ok' : 'failed';
  } catch {
    return 'unavailable';
  }
}

function codeMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function currentMode() {
  return gateMode({
    open: process.env.ACCESS_GATE_OPEN,
    code: process.env.ACCESS_GATE_CODE,
    secret: process.env.ACCESS_GATE_SECRET,
    nodeEnv: process.env.NODE_ENV,
  });
}

export async function POST(req: NextRequest) {
  const mode = currentMode();
  if (mode === 'open') return NextResponse.json({ ok: true, open: true });
  if (mode === 'closed') return NextResponse.json({ ok: false, error: 'gate_unconfigured' }, { status: 503 });

  const ip = clientIp(req);
  if (throttled(ip)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown; captchaToken?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) return NextResponse.json({ ok: false, error: 'code_required' }, { status: 400 });

  const captcha = await captchaPasses(body?.captchaToken, ip);
  if (captcha !== 'ok') {
    const status = captcha === 'unavailable' ? 503 : 403;
    return NextResponse.json({ ok: false, error: `captcha_${captcha}` }, { status });
  }

  if (!codeMatches(code, (process.env.ACCESS_GATE_CODE as string).trim())) {
    console.warn(`[access-gate] wrong code from ${ip}`);
    return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 401 });
  }

  const expiresAtMs = Date.now() + GATE_TTL_MS;
  const token = await signGateToken((process.env.ACCESS_GATE_SECRET as string).trim(), expiresAtMs);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(GATE_TTL_MS / 1000),
  });
  return res;
}

/**
 * Why the launch switch is not opening the gate (2026-08-07).
 *
 * "Lo he puesto en Vercel" + `open:false` had no way to tell three very
 * different problems apart, and each has a different fix:
 *
 *   switch.seen=false → this deployment cannot see ACCESS_GATE_OPEN at all.
 *       Vercel binds env vars to a BUILD: setting one does not touch the
 *       deployment already running. Redeploy — or the var is scoped to
 *       Preview/Development instead of Production, or sits on another project.
 *   switch.seen=true, accepted=false → the deployment sees it but the VALUE is
 *       not an affirmative (a stray quote, a pasted `ACCESS_GATE_OPEN=1`, an
 *       invisible character). Accepted: 1 / true / yes / on.
 *
 * Leaks nothing: `open` was already public here, the code and the secret are
 * never read, and only the length of the switch value is reported so a
 * trailing space or a wrapping quote is visible without printing it.
 */
function switchDiagnostics() {
  const raw = process.env.ACCESS_GATE_OPEN;
  return {
    seen: typeof raw === 'string' && raw.trim() !== '',
    accepted: gateOpenFlag(raw),
    length: typeof raw === 'string' ? raw.length : 0,
    configured: Boolean(process.env.ACCESS_GATE_CODE?.trim()) && Boolean(process.env.ACCESS_GATE_SECRET?.trim()),
  };
}

/**
 * WHICH build is answering, and under WHICH environment's env vars.
 *
 * Without this, "I set it in Vercel" and "the server does not see it" could
 * not be reconciled: there was no way to tell a stale deployment from a fresh
 * one that genuinely lacks the variable, and no way to notice that the URL
 * being tested was answering as `preview` rather than `production` (env vars
 * are scoped per environment, so a preview deployment reads a different set).
 * Both fields are injected by Vercel itself — nothing to configure.
 * The commit sha is public (the repo is a due-diligence artifact) and is cut
 * to 7 chars, the same thing `git log --oneline` prints.
 */
function buildDiagnostics() {
  return {
    sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local',
    env: process.env.VERCEL_ENV ?? 'local',
  };
}

export async function GET(req: NextRequest) {
  const mode = currentMode();
  const gate = { mode, switch: switchDiagnostics(), build: buildDiagnostics() };
  if (mode === 'open') return NextResponse.json({ access: true, open: true, gate });
  if (mode === 'closed') return NextResponse.json({ access: false, open: false, gate });
  const verdict = await verifyGateToken(
    (process.env.ACCESS_GATE_SECRET as string).trim(),
    req.cookies.get(GATE_COOKIE)?.value,
  );
  return NextResponse.json({ access: verdict.valid, open: false, gate });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

/**
 * Cloudflare Turnstile — server-side settlement of the browser captcha token.
 *
 * The widget (frontend TurnstileWidget) yields a ONE-TIME token; every
 * bot-sensitive POST carries it (body.captchaToken, or x-captcha-token header
 * as a fallback) and this middleware settles it against Cloudflare BEFORE any
 * handler logic runs. Feature-flagged by TURNSTILE_SECRET_KEY: unset (local
 * dev, unit tests) → no-op, so the suite never needs network access.
 *
 * Invariant §2: the SECRET lives server-side only. The sitekey the widget
 * renders with (NEXT_PUBLIC_TURNSTILE_SITE_KEY) is public by design.
 *
 * Failure posture is CLOSED: if Cloudflare itself is unreachable we answer
 * 503 rather than letting traffic through — these endpoints exist to keep
 * bots out (they already flooded the waitlist once, 2026-07-23), and a
 * siteverify outage is rarer than a bot run.
 */
import { Request, Response, NextFunction } from 'express';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 6_000;

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export interface TurnstileVerdict {
  ok: boolean;
  /** 'unavailable' when Cloudflare could not be reached (distinct from a bad token). */
  errorCodes: string[];
}

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<TurnstileVerdict> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true, errorCodes: [] };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return { ok: json.success === true, errorCodes: json['error-codes'] ?? [] };
  } catch {
    return { ok: false, errorCodes: ['unavailable'] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Express guard. Reads the token from `req.body.captchaToken` (or the
 * `x-captcha-token` header) and rejects the request when Turnstile is
 * configured and the token is missing/invalid. No-op when unconfigured.
 */
export function requireTurnstile() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!turnstileEnabled()) {
      next();
      return;
    }
    const fromBody = (req.body as Record<string, unknown> | undefined)?.captchaToken;
    const token =
      (typeof fromBody === 'string' && fromBody.trim()) ||
      (req.header('x-captcha-token') ?? '').trim();
    if (!token) {
      res.status(403).json({ error: 'captcha_required' });
      return;
    }
    const verdict = await verifyTurnstileToken(token, req.ip);
    if (verdict.ok) {
      next();
      return;
    }
    if (verdict.errorCodes.includes('unavailable')) {
      console.warn('[turnstile] siteverify unreachable — failing closed');
      res.status(503).json({ error: 'captcha_unavailable' });
      return;
    }
    res.status(403).json({ error: 'captcha_failed' });
  };
}

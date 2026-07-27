/**
 * Best-effort client IP for in-process rate limiting.
 *
 * The app does not set `trust proxy`, so behind Railway's proxy `req.ip` is
 * the proxy address — one shared bucket for every visitor. Take the first hop
 * of x-forwarded-for instead (spoofable, but for public write endpoints the
 * worst case is a bypassed soft limit, not a shared 429 for honest users —
 * and the captcha layer doesn't care about IPs at all).
 *
 * Single source of truth: waitlist, auth and the admin panel all key their
 * limiters off THIS function so they never drift into different notions of
 * "the caller".
 */
import { Request } from 'express';

export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.ip || 'unknown';
}

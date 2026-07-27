/**
 * Waitlist mailer — sends the one-time boarding-call confirmation.
 *
 * Two transports, chosen at runtime (invariant #2 — creds only from env):
 *  1. Resend HTTP API (preferred) — used when RESEND_API_KEY is set. Sends over
 *     HTTPS/443, which PaaS hosts like Railway do NOT block. This is the path
 *     that actually works in production (Railway blocks outbound SMTP: verify()
 *     returns "Connection timeout" on 25/465/587).
 *  2. SMTP (nodemailer) — fallback when only WAITLIST_SMTP_* are set. Works
 *     locally / on hosts that allow outbound SMTP.
 *
 * Env:
 *   RESEND_API_KEY        Resend API key → enables the HTTP transport
 *   WAITLIST_FROM         From header, default "Astryum <astryum@astryum.xyz>"
 *                         (the domain must be verified in Resend to send)
 *   WAITLIST_SMTP_USER/PASS/HOST/PORT   SMTP fallback (Zoho: smtp.zoho.eu:465)
 *
 * Fail-open: unconfigured → disabled (signups still stored); a send failure is
 * logged but never surfaces to the signup response.
 */
import nodemailer, { Transporter } from 'nodemailer';
import { renderWaitlistWelcome, WelcomeEmailParams } from '../emails/waitlistWelcome';

export type { WelcomeEmailParams };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM_ADDR = 'astryum@astryum.xyz';

function fromHeader(): string {
  return process.env.WAITLIST_FROM || `Astryum <${process.env.WAITLIST_SMTP_USER || DEFAULT_FROM_ADDR}>`;
}

// ── Transport 1: Resend (HTTPS) ────────────────────────────────────────────────
async function deliverViaResend(params: WelcomeEmailParams): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'no_resend_key' };
  try {
    const rendered = renderWaitlistWelcome(params);
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromHeader(),
        to: params.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `resend_http_${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Transport 2: SMTP (nodemailer) ─────────────────────────────────────────────
let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const user = process.env.WAITLIST_SMTP_USER;
  const pass = process.env.WAITLIST_SMTP_PASS;
  if (!user || !pass) {
    transporter = null;
    return transporter;
  }
  const port = Number(process.env.WAITLIST_SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.WAITLIST_SMTP_HOST || 'smtp.zoho.eu',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

async function deliverViaSmtp(params: WelcomeEmailParams): Promise<{ ok: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'mailer_disabled_no_credentials' };
  try {
    const rendered = renderWaitlistWelcome(params);
    await t.sendMail({
      from: fromHeader(),
      to: params.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

function activeTransport(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.WAITLIST_SMTP_USER && process.env.WAITLIST_SMTP_PASS) return 'smtp';
  return 'none';
}

async function deliver(params: WelcomeEmailParams): Promise<{ ok: boolean; error?: string }> {
  const transport = activeTransport();
  if (transport === 'resend') return deliverViaResend(params);
  if (transport === 'smtp') return deliverViaSmtp(params);
  return { ok: false, error: 'mailer_disabled_no_credentials' };
}

/** Fire-and-forget: resolves true if sent, false otherwise. Never throws. */
export async function sendWaitlistWelcome(params: WelcomeEmailParams): Promise<boolean> {
  const r = await deliver(params);
  if (r.ok) console.log(`[WaitlistMailer] welcome sent via ${activeTransport()} (${params.lang}, ${params.source})`);
  else console.error(`[WaitlistMailer] send failed via ${activeTransport()}:`, r.error);
  return r.ok;
}

// ── Diagnostics (temporary; gated behind WAITLIST_DIAG_KEY in the route) ────────

export function mailerDiag() {
  const mask = (s?: string) => (s ? s.replace(/^(.{2}).*(@.*)$/, '$1***$2') : null);
  const transport = activeTransport();
  const port = Number(process.env.WAITLIST_SMTP_PORT || 465);
  return {
    transport,
    configured: transport !== 'none',
    from: fromHeader(),
    resend: {
      hasKey: !!process.env.RESEND_API_KEY,
      keyLen: process.env.RESEND_API_KEY?.length ?? 0,
    },
    smtp: {
      host: process.env.WAITLIST_SMTP_HOST || 'smtp.zoho.eu',
      port,
      secure: port === 465,
      userHint: mask(process.env.WAITLIST_SMTP_USER),
      hasPass: !!process.env.WAITLIST_SMTP_PASS,
      passLen: process.env.WAITLIST_SMTP_PASS?.length ?? 0,
    },
  };
}

/** Verify the active transport (Resend: key check; SMTP: connect+auth). */
export async function verifyMailer(): Promise<{ ok: boolean; error?: string }> {
  const transport = activeTransport();
  if (transport === 'none') return { ok: false, error: 'mailer_disabled_no_credentials' };
  if (transport === 'resend') {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { ok: false, error: `resend_http_${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const t = getTransporter();
  if (!t) return { ok: false, error: 'mailer_disabled_no_credentials' };
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A real one-off send, returning the actual error (for diagnostics only). */
export async function testSend(email: string, lang: 'es' | 'en' = 'en'): Promise<{ ok: boolean; error?: string }> {
  return deliver({ email, lang, source: 'early-access' });
}

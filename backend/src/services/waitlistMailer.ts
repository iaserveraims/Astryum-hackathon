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
import { renderWaitlistWelcome, WelcomeEmailParams, RenderedEmail } from '../emails/waitlistWelcome';
import { renderBetaInvite, BetaInviteParams } from '../emails/betaInvite';

export type { WelcomeEmailParams, BetaInviteParams };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM_ADDR = 'astryum@astryum.xyz';

function fromHeader(): string {
  return process.env.WAITLIST_FROM || `Astryum <${process.env.WAITLIST_SMTP_USER || DEFAULT_FROM_ADDR}>`;
}

// ── Transport 1: Resend (HTTPS) ────────────────────────────────────────────────
async function deliverViaResend(to: string, rendered: RenderedEmail): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'no_resend_key' };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromHeader(),
        to,
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

async function deliverViaSmtp(to: string, rendered: RenderedEmail): Promise<{ ok: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'mailer_disabled_no_credentials' };
  try {
    await t.sendMail({
      from: fromHeader(),
      to,
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

async function deliver(to: string, rendered: RenderedEmail): Promise<{ ok: boolean; error?: string }> {
  const transport = activeTransport();
  if (transport === 'resend') return deliverViaResend(to, rendered);
  if (transport === 'smtp') return deliverViaSmtp(to, rendered);
  return { ok: false, error: 'mailer_disabled_no_credentials' };
}

/**
 * Un correo que no sale es una promesa incumplida a una persona concreta, y
 * hasta hoy solo lo sabía el log (2026-08-03). El aviso va al canal en `warn`
 * y deduplicado por transporte + causa: si el proveedor está caído, es UNA
 * noticia, no una por cada persona que se apunta.
 */
async function alertMailFailure(kind: string, email: string, error?: string): Promise<void> {
  try {
    const { opsAlert } = await import('./OpsAlertService');
    const transport = activeTransport();
    await opsAlert('mailer', 'warn', `no salió el correo de ${kind} (transporte ${transport}): ${error ?? 'sin detalle'}`, {
      key: `mail-fail:${kind}:${transport}:${error ?? ''}`.slice(0, 200),
      facts: { destinatario: email, transporte: transport },
      runbook:
        transport === 'none'
          ? 'No hay transporte configurado: pon RESEND_API_KEY (o WAITLIST_SMTP_USER/PASS) en Railway. ' +
            'Mientras tanto NADIE recibe correos de la lista ni pases de embarque.'
          : 'Mira el estado del proveedor y las credenciales en Railway. En /app/admin → Waitlist puedes reintentar ' +
            'la aprobación de esa persona cuando vuelva: el botón informa honestamente de si el correo salió.',
    });
  } catch {
    /* el canal nunca puede empeorar el fallo que está reportando */
  }
}

/** Fire-and-forget: resolves true if sent, false otherwise. Never throws. */
export async function sendWaitlistWelcome(params: WelcomeEmailParams): Promise<boolean> {
  const r = await deliver(params.email, renderWaitlistWelcome(params));
  if (r.ok) console.log(`[WaitlistMailer] welcome sent via ${activeTransport()} (${params.lang}, ${params.source})`);
  else {
    console.error(`[WaitlistMailer] send failed via ${activeTransport()}:`, r.error);
    await alertMailFailure('bienvenida', params.email, r.error);
  }
  return r.ok;
}

/**
 * Beta-gate boarding pass — sent when a founder approves an email (see
 * routes/adminBetaGate.ts). NOT fire-and-forget at the call site: the approve
 * endpoint reports whether the invite actually went out, so the founder knows
 * to resend instead of assuming.
 */
export async function sendBetaInvite(params: BetaInviteParams): Promise<boolean> {
  const r = await deliver(params.email, renderBetaInvite(params));
  if (r.ok) console.log(`[WaitlistMailer] beta invite sent via ${activeTransport()} (${params.lang})`);
  else {
    console.error(`[WaitlistMailer] beta invite failed via ${activeTransport()}:`, r.error);
    await alertMailFailure('pase de embarque de la beta', params.email, r.error);
  }
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
  return deliver(email, renderWaitlistWelcome({ email, lang, source: 'early-access' }));
}

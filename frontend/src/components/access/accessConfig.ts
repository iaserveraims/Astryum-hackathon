/**
 * Client helpers for the pre-launch access gate.
 *
 * 2026-07-23 — the hardcoded ACCESS_CREDENTIALS + sessionStorage flag are
 * GONE (they shipped the shared password inside the public JS bundle; bots
 * read it). The gate is now server-side: /api/access-gate verifies the code
 * (captcha + throttle) and answers with an httpOnly signed cookie that
 * middleware.ts checks on every protected request. These helpers are the
 * only client-side surface: submit a code, ask gate state, drop the cookie.
 */

export interface GateSubmitResult {
  ok: boolean;
  /** 'invalid_code' | 'rate_limited' | 'captcha_*' | 'gate_unconfigured' | 'network' */
  error?: string;
}

export async function submitGateCode(code: string, captchaToken?: string | null): Promise<GateSubmitResult> {
  try {
    const res = await fetch('/api/access-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, captchaToken: captchaToken ?? undefined }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && json?.ok) return { ok: true };
    return { ok: false, error: json?.error ?? `http_${res.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Whether THIS browser currently passes the gate (cookie is httpOnly — only the server knows). */
export async function checkGateAccess(): Promise<boolean> {
  try {
    const res = await fetch('/api/access-gate', { method: 'GET' });
    const json = (await res.json().catch(() => null)) as { access?: boolean } | null;
    return json?.access === true;
  } catch {
    return false;
  }
}

export async function clearGateAccess(): Promise<void> {
  try {
    await fetch('/api/access-gate', { method: 'DELETE' });
  } catch {
    /* best-effort */
  }
}

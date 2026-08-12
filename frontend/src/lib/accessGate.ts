/**
 * accessGate — the pre-launch door, server-side edition (2026-07-23).
 *
 * Until launch, every dashboard surface (/app/*, /login, /register,
 * /forgot-password) sits behind an ACCESS CODE. The old door compared
 * hardcoded credentials inside the client bundle and set a sessionStorage
 * flag — anyone reading the JS walked straight in (and bots did). This one
 * is real:
 *
 *   · the code lives ONLY in server env (ACCESS_GATE_CODE — never NEXT_PUBLIC_*),
 *   · /api/access-gate verifies it (captcha + per-IP throttle) and answers
 *     with an httpOnly cookie carrying an HMAC-signed expiry,
 *   · middleware.ts verifies that signature on EVERY page request — client
 *     JS cannot mint, read or forge it.
 *
 * Web Crypto only (no node:crypto): the SAME helpers run in the Edge
 * middleware and the Node route handler.
 *
 * Launch day: set ACCESS_GATE_OPEN=1 (or `true`) and the whole gate steps
 * aside — no deploy, no code change.
 */

export const GATE_COOKIE = 'astryum_gate';
export const GATE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-enter the code weekly
const TOKEN_VERSION = 'v1';

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Mint a gate token: `v1.<expiresAtMs>.<hmacHex>`. */
export async function signGateToken(secret: string, expiresAtMs: number): Promise<string> {
  const payload = `${TOKEN_VERSION}.${expiresAtMs}`;
  const key = await importHmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${bytesToHex(sig)}`;
}

export interface GateTokenVerdict {
  valid: boolean;
  expiresAtMs: number;
}

/** Verify signature + expiry. crypto.subtle.verify is constant-time. */
export async function verifyGateToken(secret: string, token: string | undefined): Promise<GateTokenVerdict> {
  if (!token) return { valid: false, expiresAtMs: 0 };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { valid: false, expiresAtMs: 0 };
  const expiresAtMs = Number(parts[1]);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return { valid: false, expiresAtMs: 0 };
  const sig = hexToBytes(parts[2]);
  if (!sig) return { valid: false, expiresAtMs: 0 };
  const key = await importHmacKey(secret, 'verify');
  const ok = await crypto.subtle.verify('HMAC', key, sig as unknown as ArrayBuffer, encoder.encode(`${parts[0]}.${parts[1]}`));
  return { valid: ok, expiresAtMs: ok ? expiresAtMs : 0 };
}

export type GateMode = 'open' | 'enforced' | 'closed';

/**
 * The launch switch, spelled the way a human types it into a dashboard.
 *
 * It used to accept the literal '1' and nothing else — so `ACCESS_GATE_OPEN=true`
 * (the spelling its own sibling flag uses, BETA_REGISTRATION_OPEN=true on
 * Railway) left the gate shut with no signal anywhere. A launch switch that
 * fails silently on the obvious spelling is a trap, and it sprang once already.
 *
 * Deliberately MORE generous than backend betaGate.isBetaRegistrationOpen(),
 * which pins the literal 'true' and nothing else — do not "unify" them. That
 * one decides who may CREATE AN ACCOUNT and must fail closed on a typo; this
 * one only draws back a pre-launch curtain. Account creation stays guarded by
 * the backend gate + the waitlist approval behind it either way, so the worst
 * this flag can do when it reads generously is show the login card to someone
 * the backend will still turn away in plain words.
 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
export function gateOpenFlag(value?: string): boolean {
  return TRUTHY.has((value ?? '').trim().toLowerCase());
}

/**
 * How the gate behaves given the server env:
 *   'open'     — launch switch on, or dev without config → no gate.
 *   'enforced' — code + secret present → cookie required.
 *   'closed'   — production WITHOUT config → fail closed (nobody enters
 *                until the envs are seeded; safer than silently public).
 */
export function gateMode(env: { open?: string; code?: string; secret?: string; nodeEnv?: string }): GateMode {
  if (gateOpenFlag(env.open)) return 'open';
  const configured = Boolean(env.code?.trim()) && Boolean(env.secret?.trim());
  if (configured) return 'enforced';
  return env.nodeEnv === 'production' ? 'closed' : 'open';
}

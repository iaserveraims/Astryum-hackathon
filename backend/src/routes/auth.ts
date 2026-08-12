import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import {
  issueNonce,
  buildSiweMessage,
  verifySiweAndIssueToken,
  revokeSession,
  getLinkedWallets,
} from '../services/SiweAuth';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { PointsEngine } from '../engines/points/PointsEngine';
import { authService } from '../services/AuthService';
import { createSlidingWindowLimiter, SlidingWindowLimiter } from '../middleware/slidingWindowRateLimit';
import { requireTurnstile } from '../middleware/turnstile';
import { clientIp } from '../middleware/clientIp';
import { isOAuthProvider, oauthProviderConfigured, verifyOAuthIdToken } from '../services/oauthVerify';
import {
  XRPL_IDENTITY_AUTHORIZE_URL,
  XRPL_IDENTITY_SCOPES,
  allowedRedirectUris,
  exchangeCodeForIdToken,
  xrplIdentityConfigured,
} from '../services/xrplIdentityOidc';
import { isAdminEmail } from './adminPanel';
import { hasLegacyToggleAccess } from '../config/legacyAccess';
import { computeLegalStatus, withLegalAcceptance } from '../config/legalAcceptance';

const router = Router();

// ── Per-route rate limits (2026-07-23 hardening) ──────────────────────────────
// The global limiter (500 req/15 min) is sized for the whole app and useless
// against credential brute force. These are per-IP sliding windows on the
// credential-bearing POSTs specifically; the Turnstile guard below is the
// second, IP-independent layer. In-process (per instance) — same trade-off as
// the waitlist limiter.
const loginLimiter    = createSlidingWindowLimiter({ perKeyMax: 15, windowMs: 15 * 60_000, dailyMax: 50_000 });
const registerLimiter = createSlidingWindowLimiter({ perKeyMax: 5,  windowMs: 60 * 60_000, dailyMax: 5_000 });
const forgotLimiter   = createSlidingWindowLimiter({ perKeyMax: 5,  windowMs: 60 * 60_000, dailyMax: 2_000 });
const resetLimiter    = createSlidingWindowLimiter({ perKeyMax: 10, windowMs: 60 * 60_000, dailyMax: 2_000 });
const oauthLimiter    = createSlidingWindowLimiter({ perKeyMax: 20, windowMs: 15 * 60_000, dailyMax: 50_000 });

function rateLimitBy(limiter: SlidingWindowLimiter) {
  return (req: Request, res: Response, next: () => void): void => {
    const decision = limiter.check(clientIp(req), Date.now());
    if (decision.limited) {
      res.setHeader('Retry-After', String(decision.retryAfter));
      res.status(429).json({ error: 'rate_limited', retryAfter: decision.retryAfter });
      return;
    }
    next();
  };
}

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_address');

/**
 * POST /api/auth/nonce
 * Body: { address }
 * Returns: { nonce, message, expiresAt } — client signs `message` with their wallet
 */
const nonceSchema = z.object({
  address: evmAddress,
  chainId: z.number().int().positive().optional(), // client's current chain — any EVM chain accepted
});
router.post('/nonce', (req: Request, res: Response) => {
  const parsed = nonceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const { nonce, expiresAt, chainId } = issueNonce(parsed.data.address, parsed.data.chainId);
    const message = buildSiweMessage({ address: parsed.data.address, chainId }, nonce, new Date());
    return res.json({ nonce, message, expiresAt, chainId });
  } catch (err: any) {
    return res.status(400).json({ error: err?.code ?? 'nonce_failed' });
  }
});

/**
 * POST /api/auth/verify
 * Body: { address, nonce, signature, message }
 * Returns: { token, sessionId, walletAddress, expiresAt }
 */
const verifySchema = z.object({
  address: evmAddress,
  nonce: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  message: z.string().min(1),
});
router.post('/verify', async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await verifySiweAndIssueToken({
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      signature: parsed.data.signature,
      message: parsed.data.message,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Sprint S5.4 — best-effort points grant for first wallet connect.
    // Idempotency keyed by walletAddress so re-logins don't double-grant.
    void PointsEngine.getInstance().grantSafe({
      userId: result.sessionId.includes('-') ? result.sessionId.split('-')[0] : result.sessionId,
      eventType: 'FIRST_WALLET_CONNECTED',
      idempotencyKey: `wallet-connect:${result.walletAddress}`,
      reason: 'SIWE login completed',
    });
    return res.status(201).json(result);
  } catch (err: any) {
    const code = err?.code ?? 'verify_failed';
    const status =
      code === 'invalid_address' || code === 'signature_invalid'
        ? 400
        : code === 'nonce_unknown' || code === 'nonce_expired' || code === 'nonce_address_mismatch'
          ? 409
          : code === 'not_invited' // closed beta — new wallet-first accounts need an approved email first
            ? 403
            : 500;
    return res.status(status).json({ error: code });
  }
});

/**
 * GET /api/auth/me
 * Returns the current session info (requires Bearer token).
 */
router.get('/me', requireSiweAuth, asyncHandler(async (req: Request, res: Response) => {
  const [linkedWallets, profileRow] = await Promise.all([
    getLinkedWallets(req.siwe!.userId),
    prisma.user.findUnique({
      where: { id: req.siwe!.userId },
      select: { email: true, username: true, firstName: true, lastName: true, avatar: true, preferences: true },
    }),
  ]);
  return res.json({
    userId: req.siwe!.userId,
    sessionId: req.siwe!.sessionId,
    walletAddress: req.siwe!.walletAddress,
    linkedWallets,
    // Legal acceptance gate (founder 2026-07-30): whether THIS account still
    // has to be shown the current /demo-terms + /privacy versions. Covers
    // wallet-first accounts (no register click-wrap) and version bumps.
    legal: computeLegalStatus(profileRow?.preferences, DEMO_TERMS_VERSION),
    // Server-side profile (founder 2026-07-19: name/photo must survive
    // logout→login) — the store hydrates presentation from here.
    profile: profileRow ?? null,
    // Visibility hint for the founders' panel nav entry (ADMIN_EMAILS door).
    // The panel itself re-checks the allowlist on every read (requireAdmin),
    // so this flag grants nothing on its own.
    isAdmin: isAdminEmail(profileRow?.email),
    // Visibility hint for the Personal↔Legacy product toggle. FAIL-CLOSED:
    // LEGACY_ENABLED='true' ⇒ everyone; anything else (incl. unset) ⇒ only
    // the LEGACY_ACCESS_EMAILS allowlist — off + empty list ⇒ nobody. Pure
    // UI discovery — governed-account APIs keep their own server-side auth.
    legacyAccess: hasLegacyToggleAccess(profileRow?.email),
  });
}));

/**
 * POST /api/auth/legal-accept — record that the signed-in account accepted
 * the current demo terms and READ the current privacy notice (the notice is
 * informed, not consented — see config/legalAcceptance.ts). Both flags must
 * be literally true; the record rides User.preferences.legal with version and
 * timestamp, preserving sibling keys.
 */
const legalAcceptSchema = z.object({
  terms: z.literal(true, { errorMap: () => ({ message: 'terms_required' }) }),
  privacyRead: z.literal(true, { errorMap: () => ({ message: 'privacy_read_required' }) }),
});

router.post('/legal-accept', requireSiweAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = legalAcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const row = await prisma.user.findUnique({
    where: { id: req.siwe!.userId },
    select: { preferences: true },
  });
  const merged = withLegalAcceptance(row?.preferences, DEMO_TERMS_VERSION);
  await prisma.user.update({
    where: { id: req.siwe!.userId },
    data: { preferences: merged as never },
  });
  return res.json({ ok: true, legal: computeLegalStatus(merged, DEMO_TERMS_VERSION) });
}));

// Profile schema shared by PATCH /profile: presentation only, nothing
// custodial. Avatar is a small data-URL the client downscales (~96px square);
// empty string clears it. Hard cap so nobody parks megabytes in the row.
const profilePatchSchema = z.object({
  // '' clears the field (falls back to the derived display name client-side).
  username: z.union([z.literal(''), z.string().trim().min(2).max(32)]).optional(),
  avatar: z
    .union([z.literal(''), z.string().regex(/^data:image\/(png|jpe?g|webp);base64,/).max(150_000)])
    .optional(),
});

/**
 * PATCH /api/auth/profile — persist display name / avatar on the account so
 * they survive logout→login and follow the user across devices.
 */
router.patch('/profile', requireSiweAuth, asyncHandler(async (req: Request, res: Response) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_profile', detail: parsed.error.flatten() });
  }
  const data: { username?: string | null; avatar?: string | null } = {};
  if (parsed.data.username !== undefined) data.username = parsed.data.username === '' ? null : parsed.data.username;
  if (parsed.data.avatar !== undefined) data.avatar = parsed.data.avatar === '' ? null : parsed.data.avatar;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'empty_patch' });
  const user = await prisma.user.update({
    where: { id: req.siwe!.userId },
    data,
    select: { username: true, avatar: true },
  });
  return res.json({ profile: user });
}));

/**
 * POST /api/auth/logout
 * Best-effort session revocation — does NOT require a valid/non-expired token.
 * Always returns 204 so the frontend can clean up local state even when the JWT
 * has already expired.
 */
router.post('/logout', async (req: Request, res: Response) => {
  const header = req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    try {
      // jwt.decode works on expired tokens (no signature verification needed here)
      const payload = jwt.decode(token) as { sid?: string } | null;
      if (payload?.sid) {
        await revokeSession(payload.sid);
      }
    } catch {
      /* best-effort — session may already be gone or token malformed */
    }
  }
  return res.status(204).end();
});

// ── P-AUTH: Email + Password endpoints — ON by default (primary login).
// Set EMAIL_AUTH_ENABLED=0 to disable. ──

const EMAIL_AUTH_ENABLED = process.env.EMAIL_AUTH_ENABLED !== '0';

function requireEmailAuth(_req: Request, res: Response, next: () => void) {
  if (!EMAIL_AUTH_ENABLED) {
    res.status(503).json({ error: 'email_auth_disabled', message: 'Email+password auth is not enabled yet. Use dev mode.' });
    return;
  }
  next();
}

/**
 * Demo risk acceptance (founder 2026-07-26): the risks live as PUBLIC
 * reviewable documentation (/demo-terms — experimental software, real XRP
 * under caps, irreversible signatures, no execution guarantee), and the
 * create button carries a notice line linking it — creating the account
 * under that notice is the acceptance. Enforced SERVER-side (this literal)
 * so every account carries a recorded acceptance with version + timestamp
 * (see AuthService.register). Bump the version when /demo-terms materially
 * changes.
 */
// 2026-07-30: /demo-terms gained automation/rules, data & on-chain permanence,
// the €50 liability cap with consumer carve-outs, and the operator
// identification link (/privacy) — material additions, hence the bump.
// 2026-08-01: accuracy audit. The council fee was described as charged "when
// the order is delivered with its proof" — it is actually paid inside the
// signed Payment itself, so a failed delivery leaves it already paid: a
// correction that works AGAINST us, which is exactly why it must ship. Also
// narrowed the caps, simulation and boot-guard claims to what the code does.
// 2026-08-01.1 (same day, second material change — hence the suffix: anyone
// who accepted the morning text must see the evening one): /demo-terms gains
// the rules of use that never shipped — minimum age 18 (the demo had NONE),
// excluded/sanctioned territories by declaration, suspension right that can
// never withhold funds, tax responsibility and permitted use. Law & forum
// stay deliberately absent: that clause is counsel's (legal/02 §12).
export const DEMO_TERMS_VERSION = '2026-08-01.1';

const registerSchema = z.object({
  email:        z.string().email(),
  password:     z.string().min(8, 'password_too_short'),
  // Demo-signup profile (founder 2026-07-18): deliberately light — phone/2FA
  // arrive with the full product.
  username:     z.string().trim().min(2).max(32).optional(),
  firstName:    z.string().trim().min(1).max(64).optional(),
  lastName:     z.string().trim().min(1).max(64).optional(),
  referralCode: z.string().length(8).optional(), // P-GROWTH: optional manager referral code
  // Must be literally true — sent by the create form under its /demo-terms notice.
  demoTermsAccepted: z.literal(true, { errorMap: () => ({ message: 'demo_terms_required' }) }),
});

/**
 * POST /api/auth/register
 * Body: { email, password, referralCode? }
 * Returns: { accessToken, refreshToken, sessionId, expiresAt, userId }
 */
router.post('/register', (req, res, next) => requireEmailAuth(req as Request, res as Response, next), rateLimitBy(registerLimiter), requireTurnstile(), async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await authService.register(
      parsed.data.email,
      parsed.data.password,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      {
        username: parsed.data.username,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        // Schema guarantees acceptance === true; record WHICH text was accepted.
        demoTermsVersion: DEMO_TERMS_VERSION,
      },
    );
    // Every new account is also a newsletter signup (founder 2026-07-18; the
    // demo flow is gone but the enrolment stays for the capped early access):
    // same welcome email as the landing waitlist, only on FIRST insertion —
    // fire-and-forget, a mail hiccup must never fail the registration.
    void (async () => {
      try {
        const { prisma } = await import('../database/prismaClient');
        const email = parsed.data.email.toLowerCase().trim();
        const existing = await prisma.waitlistSignup.findUnique({ where: { email } });
        if (!existing) {
          await prisma.waitlistSignup.create({ data: { email, source: 'register' } });
          const { sendWaitlistWelcome } = await import('../services/waitlistMailer');
          void sendWaitlistWelcome({ email, lang: undefined, source: 'register' });
        }
      } catch {
        /* newsletter enrolment is best-effort */
      }
    })();
    // P-GROWTH: track referral conversion if code provided
    if (parsed.data.referralCode) {
      const { referralService } = await import('../services/ReferralService');
      await referralService.trackRegistration(parsed.data.referralCode, result.userId);
    }
    return res.status(201).json(result);
  } catch (err: any) {
    const code = err?.code ?? 'register_failed';
    // not_invited: closed beta — the email has no founder approval yet (betaGate).
    return res.status(code === 'email_taken' ? 409 : code === 'not_invited' ? 403 : 500).json({ error: code });
  }
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { accessToken, refreshToken, sessionId, expiresAt, userId }
 */
router.post('/login', (req, res, next) => requireEmailAuth(req as Request, res as Response, next), rateLimitBy(loginLimiter), requireTurnstile(), async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await authService.login(parsed.data.email, parsed.data.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(200).json(result);
  } catch (err: any) {
    const code = err?.code ?? 'login_failed';
    return res.status(code === 'invalid_credentials' || code === 'account_disabled' ? 401 : 500).json({ error: code });
  }
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Returns: { accessToken, refreshToken, sessionId, expiresAt, userId }
 */
router.post('/refresh', (req, res, next) => requireEmailAuth(req as Request, res as Response, next), async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await authService.refresh(parsed.data.refreshToken);
    return res.status(200).json(result);
  } catch (err: any) {
    const code = err?.code ?? 'refresh_failed';
    return res.status(401).json({ error: code });
  }
});

const forgotSchema = z.object({ email: z.string().email() });

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Always returns 200 (prevents email enumeration).
 * In dev: also returns resetToken in body.
 */
router.post('/forgot-password', (req, res, next) => requireEmailAuth(req as Request, res as Response, next), rateLimitBy(forgotLimiter), requireTurnstile(), async (req: Request, res: Response) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const { resetToken } = await authService.forgotPassword(parsed.data.email);
    const body: Record<string, unknown> = { message: 'If this email is registered, a reset link has been sent.' };
    // Return token in body only in dev for easy testing
    if (process.env.NODE_ENV !== 'production' && resetToken) {
      body.resetToken = resetToken;
    }
    return res.status(200).json(body);
  } catch {
    return res.status(200).json({ message: 'If this email is registered, a reset link has been sent.' });
  }
});

const resetSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(8, 'password_too_short'),
});

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 */
router.post('/reset-password', (req, res, next) => requireEmailAuth(req as Request, res as Response, next), rateLimitBy(resetLimiter), async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    await authService.resetPassword(parsed.data.token, parsed.data.newPassword);
    return res.status(200).json({ message: 'Password updated. Please log in again.' });
  } catch (err: any) {
    const code = err?.code ?? 'reset_failed';
    return res.status(code === 'reset_token_invalid' ? 400 : 500).json({ error: code });
  }
});

// ── OAuth (Google / Apple) ─────────────────────────────────────────────────────
// The browser completes the provider popup and POSTs the resulting id_token;
// oauthVerify settles signature/iss/aud/exp against the provider's JWKS and
// AuthService resolves claims → account → the SAME session shape as email
// login. No captcha here: Google/Apple already gate their own popups, and the
// token is single-audience + short-lived. Self-gates per provider until its
// client-id env is set (503), like EMAIL_AUTH_ENABLED does for email.

const oauthSchema = z.object({
  idToken: z.string().min(20).max(8192),
  // Apple sends the user's name ONLY on the very first authorization, and
  // only to the browser — the client forwards it so the account isn't nameless.
  profile: z
    .object({
      username:  z.string().trim().min(2).max(32).optional(),
      firstName: z.string().trim().min(1).max(64).optional(),
      lastName:  z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
});

router.post('/oauth/:provider', rateLimitBy(oauthLimiter), async (req: Request, res: Response) => {
  const provider = String(req.params.provider ?? '').toLowerCase();
  if (!isOAuthProvider(provider)) {
    return res.status(404).json({ error: 'unknown_provider' });
  }
  if (!oauthProviderConfigured(provider)) {
    return res.status(503).json({ error: 'oauth_not_configured', provider });
  }
  const parsed = oauthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const claims = await verifyOAuthIdToken(provider, parsed.data.idToken);
    const result = await authService.oauthLogin(
      claims,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      parsed.data.profile,
    );
    // First-insertion newsletter enrolment, same as email registration.
    if (result.created && result.email) {
      const email = result.email;
      void (async () => {
        try {
          const existing = await prisma.waitlistSignup.findUnique({ where: { email } });
          if (!existing) {
            await prisma.waitlistSignup.create({ data: { email, source: 'register' } });
            const { sendWaitlistWelcome } = await import('../services/waitlistMailer');
            void sendWaitlistWelcome({ email, lang: undefined, source: 'register' });
          }
        } catch {
          /* newsletter enrolment is best-effort */
        }
      })();
    }
    const { created, email: _email, ...session } = result;
    return res.status(created ? 201 : 200).json(session);
  } catch (err: any) {
    const code = err?.code ?? 'oauth_failed';
    const status =
      code === 'oauth_token_invalid' || code === 'oauth_token_malformed' || code === 'oauth_unknown_key'
        ? 401
        : code === 'oauth_email_missing' || code === 'oauth_email_unverified'
          ? 400
          : code === 'account_disabled'
            ? 401
            : code === 'not_invited' // closed beta — first OAuth login is a signup, and this email isn't approved
              ? 403
              : code === 'oauth_jwks_unavailable'
                ? 503
                : 500;
    return res.status(status).json({ error: code });
  }
});

// ── XRP Identity (account.xrpl.in) — the ecosystem's own front door ───────────
// Astryum adopts the XRPL ecosystem's identity provider as its main entrance.
// Flow: browser generates PKCE (S256) → redirects to the provider's /auth →
// gets a one-time `code` back → POSTs it here → we exchange it server-side and
// run the SAME verification and account-linking rail as Google/Apple.
//
// What this door proves: WHO the person is. What it does not prove: which XRPL
// account they control — that stays a signature, on the wallet-binding rail.

/**
 * GET /api/auth/oauth/xrplid/config
 * Public, non-secret parameters the browser needs to build the authorize URL.
 * The client id of a PUBLIC OIDC client is not a secret (it travels in the
 * authorize URL by design); serving it from here keeps a single source of
 * truth in Railway env instead of a NEXT_PUBLIC_* copy in the bundle.
 */
router.get('/oauth/xrplid/config', (_req: Request, res: Response) => {
  if (!xrplIdentityConfigured()) {
    return res.status(503).json({ error: 'xrplid_not_configured' });
  }
  const redirectUris = allowedRedirectUris();
  if (redirectUris.length === 0) {
    return res.status(503).json({ error: 'xrplid_redirect_not_configured' });
  }
  return res.json({
    clientId: process.env.XRPL_IDENTITY_CLIENT_ID?.trim(),
    authorizeUrl: XRPL_IDENTITY_AUTHORIZE_URL,
    scopes: XRPL_IDENTITY_SCOPES,
    redirectUris,
  });
});

const xrplIdExchangeSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  codeVerifier: z.string().trim().min(43).max(128),
  redirectUri: z.string().trim().url().max(512),
  profile: z
    .object({
      username:  z.string().trim().min(2).max(32).optional(),
      firstName: z.string().trim().min(1).max(64).optional(),
      lastName:  z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
});

/**
 * POST /api/auth/oauth/xrplid/exchange
 * Body: { code, codeVerifier, redirectUri }
 * Returns the Astryum session, exactly like the other OAuth providers.
 */
router.post('/oauth/xrplid/exchange', rateLimitBy(oauthLimiter), async (req: Request, res: Response) => {
  if (!xrplIdentityConfigured()) {
    return res.status(503).json({ error: 'xrplid_not_configured' });
  }
  const parsed = xrplIdExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }

  try {
    const idToken = await exchangeCodeForIdToken({
      code: parsed.data.code,
      codeVerifier: parsed.data.codeVerifier,
      redirectUri: parsed.data.redirectUri,
    });
    const claims = await verifyOAuthIdToken('xrplid', idToken);
    const result = await authService.oauthLogin(
      claims,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      parsed.data.profile,
    );
    const { created, email: _email, ...session } = result;
    return res.status(created ? 201 : 200).json(session);
  } catch (err: any) {
    const code = err?.code ?? 'oauth_failed';
    const status =
      code === 'xrplid_redirect_not_allowed'
        ? 400
        : code === 'oauth_token_invalid' ||
            code === 'oauth_token_malformed' ||
            code === 'oauth_unknown_key' ||
            code === 'account_disabled'
          ? 401
          : code === 'oauth_email_missing' || code === 'oauth_email_unverified'
            ? 400
            : code === 'not_invited' // closed beta — first login here is a signup
              ? 403
              : code === 'oauth_jwks_unavailable' ||
                  code === 'xrplid_token_unreachable' ||
                  code.startsWith('xrplid_token_http_')
                ? 503
                : 500;
    return res.status(status).json({ error: code });
  }
});

export default router;

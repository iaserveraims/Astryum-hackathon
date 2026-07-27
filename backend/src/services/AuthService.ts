/**
 * AuthService — email + password authentication
 *
 * Issues JWT tokens with the same payload shape as SiweAuth so
 * requireSiweAuth middleware works for both auth methods without changes.
 *
 * Password hashing: Node.js built-in crypto.scrypt (no external deps).
 * Refresh tokens:   64-byte random hex, stored as SHA-256 hash in Session.
 * Reset tokens:     32-byte random hex, stored as SHA-256 hash in User.
 *
 * INVARIANTS:
 *   - DEV (ALLOW_NO_AUTH=1): these endpoints exist but are never called
 *     (dev flow bypasses auth entirely via requireSiweAuth middleware)
 *   - PROD: email+password is the primary login; SIWE stays for wallet binding
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/prismaClient';
import type { OAuthClaims } from './oauthVerify';

const ACCESS_TTL_SECONDS  = 24 * 60 * 60;   // 24h
const REFRESH_TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30d
const RESET_TTL_MS        = 60 * 60 * 1000; // 1h

function resolveJwtSecret(): string {
  const explicit = process.env.JWT_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is missing or too short (>=32 chars) in production.');
  }
  return explicit || 'dev-secret-change-me-32-chars-min-fallback';
}
const JWT_SECRET = resolveJwtSecret();

// ── Password hashing (scrypt) ─────────────────────────────────────────────────

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function issueAccessJwt(userId: string, sessionId: string): string {
  return jwt.sign(
    { sub: userId, sid: sessionId, addr: '' },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL_SECONDS },
  );
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: Date;
  userId: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AuthService {

  async register(
    email: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
    profile?: { username?: string; firstName?: string; lastName?: string; demoTermsVersion?: string },
  ): Promise<AuthResult> {
    const normalised = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalised } });
    if (existing) {
      throw Object.assign(new Error('email_taken'), { code: 'email_taken' });
    }

    const passwordHash = await hashPassword(password);

    // xrplAddress must be @unique — use a placeholder for email-only users
    const xrplPlaceholder = `email:${normalised}`;

    const user = await prisma.user.create({
      data: {
        xrplAddress: xrplPlaceholder,
        email: normalised,
        passwordHash,
        username: profile?.username?.trim() || null,
        firstName: profile?.firstName?.trim() || null,
        lastName: profile?.lastName?.trim() || null,
        isActive: true,
        lastLogin: new Date(),
        // Click-wrap proof: WHICH demo-risk text was accepted and WHEN
        // (route enforces acceptance; no migration — rides preferences JSON).
        ...(profile?.demoTermsVersion
          ? { preferences: { demoTerms: { version: profile.demoTermsVersion, acceptedAt: new Date().toISOString() } } }
          : {}),
      },
    });

    return this._createSession(user.id, meta);
  }

  async login(
    email: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const normalised = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email: normalised } });
    if (!user || !user.passwordHash) {
      throw Object.assign(new Error('invalid_credentials'), { code: 'invalid_credentials' });
    }
    if (!user.isActive) {
      throw Object.assign(new Error('account_disabled'), { code: 'account_disabled' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw Object.assign(new Error('invalid_credentials'), { code: 'invalid_credentials' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    return this._createSession(user.id, meta);
  }

  /**
   * OAuth (Google/Apple) login — the id_token has ALREADY been verified by
   * oauthVerify (signature, iss, aud, exp) before this is called; here we
   * only resolve claims → account and issue the same session as email login.
   *
   * Account resolution, in order:
   *   1. by `oauthSub` ("<provider>:<sub>") — the returning OAuth user;
   *   2. by verified email — links the OAuth identity onto an existing
   *      account (provider-verified email only; oauthSub is written once and
   *      never overwritten, so a second provider still signs in via email);
   *   3. otherwise a new account, authProvider = the provider.
   */
  async oauthLogin(
    claims: OAuthClaims,
    meta?: { ipAddress?: string; userAgent?: string },
    profile?: { username?: string; firstName?: string; lastName?: string },
  ): Promise<AuthResult & { created: boolean; email: string | null }> {
    const oauthSub = `${claims.provider}:${claims.sub}`;

    let user = await prisma.user.findUnique({ where: { oauthSub } });

    if (!user && claims.email && claims.emailVerified) {
      const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            oauthSub: byEmail.oauthSub ?? oauthSub,
            emailVerified: true,
          },
        });
      }
    }

    let created = false;
    if (!user) {
      // Creating an account needs an email we can trust. Apple's private
      // relay addresses count — they are real, deliverable and verified.
      if (!claims.email) {
        throw Object.assign(new Error('oauth_email_missing'), { code: 'oauth_email_missing' });
      }
      if (!claims.emailVerified) {
        throw Object.assign(new Error('oauth_email_unverified'), { code: 'oauth_email_unverified' });
      }
      const username =
        profile?.username?.trim() ||
        claims.name?.trim() ||
        [claims.givenName, claims.familyName].filter(Boolean).join(' ').trim() ||
        claims.email.split('@')[0];
      user = await prisma.user.create({
        data: {
          // Same placeholder convention as email registration (xrplAddress is
          // @unique and required to be distinct per account).
          xrplAddress: `email:${claims.email}`,
          email: claims.email,
          oauthSub,
          authProvider: claims.provider,
          emailVerified: true,
          username: username.slice(0, 32) || null,
          firstName: profile?.firstName?.trim() || claims.givenName || null,
          lastName: profile?.lastName?.trim() || claims.familyName || null,
          isActive: true,
          lastLogin: new Date(),
        },
      });
      created = true;
    } else {
      if (!user.isActive) {
        throw Object.assign(new Error('account_disabled'), { code: 'account_disabled' });
      }
      await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    }

    const session = await this._createSession(user.id, meta);
    return { ...session, created, email: user.email };
  }

  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const hashed = sha256(rawRefreshToken);

    const session = await prisma.session.findFirst({
      where: { refreshToken: hashed, isActive: true },
    });
    if (!session) {
      throw Object.assign(new Error('refresh_token_invalid'), { code: 'refresh_token_invalid' });
    }
    if (session.expiresAt < new Date()) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
      throw Object.assign(new Error('refresh_token_expired'), { code: 'refresh_token_expired' });
    }

    // Revoke old session and issue new one (rotation)
    await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });

    return this._createSession(session.userId);
  }

  async logout(sessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
  }

  async forgotPassword(email: string): Promise<{ resetToken: string }> {
    const normalised = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalised } });
    // Always return 200 to avoid email enumeration
    if (!user || !user.passwordHash) return { resetToken: '' };

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = sha256(rawToken);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashed,
        resetTokenExpiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    // In production wire this to an email provider (SMTP/SendGrid).
    // For now, log to server console (never exposed in API response).
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[AuthService] Password reset token for ${normalised}: ${rawToken}`);
    }

    return { resetToken: rawToken }; // returned only in dev; prod would email it
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const hashed = sha256(rawToken);

    const user = await prisma.user.findFirst({
      where: { resetToken: hashed, resetTokenExpiresAt: { gt: new Date() } },
    });
    if (!user) {
      throw Object.assign(new Error('reset_token_invalid'), { code: 'reset_token_invalid' });
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    // Revoke all active sessions for this user after password change
    await prisma.session.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _createSession(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const rawRefresh = crypto.randomBytes(64).toString('hex');
    const hashedRefresh = sha256(rawRefresh);

    // Use a random opaque token as the session identifier (same as SIWE flow)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    const session = await prisma.session.create({
      data: {
        userId,
        token: sessionToken,
        refreshToken: hashedRefresh,
        ipAddress: meta?.ipAddress ?? 'unknown',
        userAgent: meta?.userAgent,
        isActive: true,
        lastActivity: new Date(),
        expiresAt,
      },
    });

    const accessToken = issueAccessJwt(userId, session.id);

    return {
      accessToken,
      refreshToken: rawRefresh, // plaintext — sent to client once, never stored plaintext
      sessionId: session.id,
      expiresAt,
      userId,
    };
  }
}

export const authService = new AuthService();

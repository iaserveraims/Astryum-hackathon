/**
 * AuthService — email + password authentication
 *
 * Issues JWT tokens with the same payload shape as SiweAuth so
 * requireSiweAuth middleware works for both auth methods without changes.
 */

import crypto from 'crypto';
import { withLegalAcceptance } from '../config/legalAcceptance';
import jwt from 'jsonwebtoken';
import { prisma } from '../database/prismaClient';
import { assertSignupAllowed } from '../config/betaGate';
import type { OAuthClaims } from './oauthVerify';
import type { Prisma } from '@prisma/client';
import {
  credentialsEpochOf,
  lockCredentialState,
  sessionPredatesEpoch,
  splitTakeoverPreferences,
} from './identity/credentialsEpoch';
import { forgetCageAck } from './flare/LegacyCageAckService';
import { forgetStepUpConfig } from './StepUpLockService';

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

/**
 * A password row whose address nobody ever proved: plain `register` writes it
 * with `emailVerified` false. A verified row, or one with no password, links
 * onto an OAuth identity as before.
 */
/**
 * May the reset token leave the server by any path other than the mailbox (the
 * POST /auth/forgot-password body, the server log)? Only on an explicit opt-in
 * for local development: NODE_ENV must not be production AND
 * AUTH_EXPOSE_RESET_TOKEN must be literally 'true'. The default is never — a
 * staging that forgot NODE_ENV=production used to hand the token of any
 * password account to whoever typed its address (5.4).
 */
export function resetTokenExposureEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.AUTH_EXPOSE_RESET_TOKEN === 'true';
}

/**
 * Does a successful reset prove the mailbox? Only when the reset token could
 * not have travelled anywhere else. With exposure enabled, whoever typed the
 * address holds the token — flipping `emailVerified` there would hand a stranger
 * the verified-founder doors the takeover exists to protect.
 */
function resetTokenOnlyReachesMailbox(): boolean {
  return !resetTokenExposureEnabled();
}

function isSquattedPasswordAccount(row: { passwordHash: string | null; emailVerified: boolean }): boolean {
  return Boolean(row.passwordHash) && row.emailVerified !== true;
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
    profile?: {
      username?: string;
      firstName?: string;
      lastName?: string;
      demoTermsVersion?: string;
      /** The sign-up ceremony presented BOTH documents and the user signed:
       * the unified `legal` record is written at birth, so the
       *  first dashboard entry does not ask for the same texts again. */
      legalSigned?: boolean;
    },
  ): Promise<AuthResult> {
    const normalised = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalised } });
    if (existing) {
      throw Object.assign(new Error('email_taken'), { code: 'email_taken' });
    }

    // Closed beta: only founder-approved waitlist emails may create an
    // account (betaGate throws not_invited). AFTER the email_taken check so
    // an existing user is still told to just sign in.
    await assertSignupAllowed(normalised);

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
          ? {
              preferences: (() => {
                const clickWrap = { demoTerms: { version: profile.demoTermsVersion, acceptedAt: new Date().toISOString() } };
                // Signed both texts at sign-up ⇒ the same record /legal-accept
                // writes, from day one. One signature, never asked twice.
                return profile.legalSigned ? withLegalAcceptance(clickWrap, profile.demoTermsVersion) : clickWrap;
                // `as never`: Prisma's Json input type rejects a plain
                // Record<string, unknown> — same cast /legal-accept uses.
              })() as never,
            }
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

    // scrypt is a window: a takeover (or a reset) can commit while it runs. The
    // session is born only if the row STILL holds the password just checked —
    // compare-and-swap under the row lock (lockCredentialState).
    try {
      return await prisma.$transaction(async (tx) => {
        await lockCredentialState(tx, user.id, user);
        await tx.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        return this._createSession(user.id, meta, tx);
      });
    } catch (err: any) {
      if (err?.code === 'credentials_changed') {
        throw Object.assign(new Error('invalid_credentials'), { code: 'invalid_credentials' });
      }
      throw err;
    }
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
      if (byEmail && isSquattedPasswordAccount(byEmail)) {
        user = await this._takeOverSquattedAccount(byEmail, oauthSub, claims.provider);
      } else if (byEmail && byEmail.isActive === false) {
        // A disabled row (an admin suspension, or a takeover QUARANTINE account)
        // never takes an identity on: linking it would write `oauthSub` and
        // `emailVerified` onto an account nobody may sign into.
        throw Object.assign(new Error('account_disabled'), { code: 'account_disabled' });
      } else if (byEmail) {
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
      // Closed beta: same gate as email registration — the create branch only.
      // A returning OAuth user (resolved above) never reaches this.
      await assertSignupAllowed(claims.email);
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

    const invalid = () => Object.assign(new Error('refresh_token_invalid'), { code: 'refresh_token_invalid' });

    // Observe the credential state right after the session check.
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, preferences: true },
    });
    if (!user) throw invalid();
    if (sessionPredatesEpoch(session.createdAt, credentialsEpochOf(user.preferences))) {
      await prisma.session.update({ where: { id: session.id }, data: { isActive: false } }).catch(() => undefined);
      throw invalid();
    }

    // Rotation under the row lock: if a takeover committed since the check the
    // CAS fails and no new session is born; the old one is revoked only if it
    // is STILL active (two concurrent refreshes cannot both rotate it).
    try {
      return await prisma.$transaction(async (tx) => {
        await lockCredentialState(tx, session.userId, user);
        const rotated = await tx.session.updateMany({
          where: { id: session.id, isActive: true },
          data: { isActive: false },
        });
        if (rotated.count !== 1) throw invalid();
        return this._createSession(session.userId, undefined, tx);
      });
    } catch (err: any) {
      if (err?.code === 'credentials_changed') throw invalid();
      throw err;
    }
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

    // In production wire this to an email provider (SMTP/SendGrid). The token
    // is logged, and the route returns it, ONLY under the explicit dev opt-in
    // (resetTokenExposureEnabled) — never by default.
    if (resetTokenExposureEnabled()) {
      console.info(`[AuthService] Password reset token for ${normalised}: ${rawToken}`);
    }

    // The caller (route) decides exposure; this value never reaches a response
    // unless resetTokenExposureEnabled() — a mailer would send it instead.
    return { resetToken: rawToken };
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

    await prisma.$transaction(async (tx) => {
      // Conditional on the token STILL being there: the hash above is a window,
      // and a takeover that committed during it cleared the token — without
      // this the old holder's new password would land on the owner's account.
      const updated = await tx.user.updateMany({
        where: { id: user.id, resetToken: hashed, resetTokenExpiresAt: { gt: new Date() } },
        data: {
          passwordHash,
          resetToken: null,
          resetTokenExpiresAt: null,
          // Using the link proves the mailbox — only where the link reached
          // nothing BUT the mailbox (see resetTokenOnlyReachesMailbox).
          ...(resetTokenOnlyReachesMailbox() ? { emailVerified: true } : {}),
        },
      });
      if (updated.count !== 1) {
        throw Object.assign(new Error('reset_token_invalid'), { code: 'reset_token_invalid' });
      }
      // Revoke all active sessions for this user after password change
      await tx.session.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * PRE-ACCOUNT HIJACK. `register` stores any address with
   * no verification loop, so whoever typed a password on this row never proved
   * they own the mailbox. The provider that just attested the address is the
   * first real proof of ownership: its holder TAKES OVER the account instead of
   * inheriting a stranger's password and live sessions — which, since the
   * admin/exemption/Legacy doors key on `emailVerified`, would have handed the
   * squatter those powers the moment the real owner signed in.
   */
  private async _takeOverSquattedAccount(
    byEmail: { id: string; oauthSub: string | null },
    oauthSub: string,
    provider: string,
  ) {
    const takeoverAt = new Date();
    const { user, quarantineId, residue } = await prisma.$transaction(async (tx) => {
      const cleared = await tx.user.update({
        where: { id: byEmail.id },
        data: {
          oauthSub: byEmail.oauthSub ?? oauthSub,
          emailVerified: true,
          authProvider: provider,
          passwordHash: null,
          resetToken: null,
          resetTokenExpiresAt: null,
        },
      });
      // Preferences re-read under the lock the update above holds: the owner
      // keeps everything EXCEPT the consent the previous holder clicked (legal /
      // demoTerms), which travels to the quarantine row.
      const split = splitTakeoverPreferences(cleared.preferences, takeoverAt);
      const updated = await tx.user.update({
        where: { id: byEmail.id },
        data: { preferences: split.owner as never },
      });
      // The account that inherits the residue. It can never be signed into:
      // no password, no oauthSub, no passkey, no session, isActive false — and
      // the address is in the reserved `.invalid` TLD (RFC 2606), so no provider
      // can ever verify it either.
      const quarantine = await tx.user.create({
        data: {
          xrplAddress: null,
          email: `takeover-quarantine+${byEmail.id}+${takeoverAt.getTime()}@invalid`,
          passwordHash: null,
          oauthSub: null,
          authProvider: 'quarantine',
          emailVerified: false,
          isActive: false,
          preferences: {
            ...split.quarantined,
            quarantine: { fromUserId: byEmail.id, takeoverAt: takeoverAt.toISOString() },
          } as never,
        },
        select: { id: true },
      });
      const sessions = await tx.session.updateMany({
        where: { userId: byEmail.id, isActive: true },
        data: { isActive: false },
      });
      // Login credentials, not history: the only rows still removed (and they
      // have no dependants, so nothing cascades).
      const passkeys = await tx.passkeyCredential.deleteMany({ where: { userId: byEmail.id } });
      const bindings = await tx.walletBinding.updateMany({
        where: { userId: byEmail.id, isActive: true },
        data: { isActive: false },
      });
      const owned = { userId: byEmail.id };
      const moveTo = { userId: quarantine.id };
      // BEFORE the wallets move: the rules that hang off them are switched off
      // and counted while they can still be found by their owner's id.
      const automationRules = await tx.automationRule.updateMany({
        where: { wallet: owned, enabled: true },
        data: { enabled: false },
      });
      const wallets = await tx.wallet.updateMany({ where: owned, data: moveTo });
      const contacts = await tx.addressBookEntry.updateMany({ where: owned, data: moveTo });
      const agentDocuments = await tx.agentDocument.updateMany({ where: owned, data: moveTo });
      const agentRules = await tx.agentRule.updateMany({ where: owned, data: { ...moveTo, isActive: false } });
      const agentConversations = await tx.agentConversation.updateMany({ where: owned, data: moveTo });
      const anthropicKeys = await tx.userAnthropicKey.updateMany({ where: owned, data: moveTo });
      const mcpConnections = await tx.userMCPConnection.updateMany({
        where: owned,
        data: { ...moveTo, isActive: false },
      });
      const triggerRules = await tx.triggerRule.updateMany({ where: owned, data: { ...moveTo, enabled: false } });
      const moneyFlows = await tx.moneyFlow.updateMany({
        where: { ownerId: byEmail.id },
        data: { ownerId: quarantine.id, enabled: false },
      });
      const governedAccounts = await tx.governedAccount.updateMany({ where: owned, data: moveTo });
      const watchlist = await tx.walletWatchlist.updateMany({ where: owned, data: { ...moveTo, isActive: false } });
      const alerts = await tx.alert.updateMany({ where: owned, data: moveTo });
      const partnerIntents = await tx.partnerIntent.updateMany({ where: owned, data: moveTo });
      const taxEvents = await tx.taxEvent.updateMany({ where: owned, data: moveTo });
      const executions = await tx.transactionExecution.updateMany({ where: owned, data: moveTo });
      const confirmations = await tx.transactionConfirmation.updateMany({ where: owned, data: moveTo });
      // One row per user: a fresh quarantine account has none, so the move never
      // collides, and the owner is back to the default (off) until they set
      // their own — an intruder's matrix would lock them out of their features.
      const stepUpLocks = await tx.stepUpLockConfig.updateMany({ where: owned, data: moveTo });
      return {
        user: updated,
        quarantineId: quarantine.id,
        residue: {
          sessions: sessions.count,
          passkeys: passkeys.count,
          bindings: bindings.count,
          wallets: wallets.count,
          contacts: contacts.count,
          automationRules: automationRules.count,
          agentDocuments: agentDocuments.count,
          agentRules: agentRules.count,
          agentConversations: agentConversations.count,
          anthropicKeys: anthropicKeys.count,
          mcpConnections: mcpConnections.count,
          triggerRules: triggerRules.count,
          moneyFlows: moneyFlows.count,
          governedAccounts: governedAccounts.count,
          watchlist: watchlist.count,
          alerts: alerts.count,
          partnerIntents: partnerIntents.count,
          taxEvents: taxEvents.count,
          executions: executions.count,
          confirmations: confirmations.count,
          stepUpLocks: stepUpLocks.count,
        },
      };
    });
    // The cage acknowledgement is cached in memory per user: a positive cached
    // before the takeover would let the OWNER fund a cage on the intruder's
    // reading (4.1). Dropped only after the transaction commits, and
    // with the takeover instant so a read still in flight cannot re-seed the
    // positive it computed BEFORE the handover (4.4).
    forgetCageAck(byEmail.id, takeoverAt);
    // Same shape for the step-up lock matrix: the row moved to quarantine above,
    // but this process would keep serving the intruder's matrix for its TTL and
    // lock the owner out of their own features.
    forgetStepUpConfig(byEmail.id);
    // No email and no address in the log line: ids and counts diagnose it.
    console.warn(
      `[AuthService] ${provider} verified the address of password account ${byEmail.id} — ` +
        `password cleared; revoked ${residue.sessions} sessions, ${residue.passkeys} passkeys, ` +
        `${residue.bindings} wallet bindings; moved to quarantine account ${quarantineId}: ` +
        `${residue.wallets} wallet rows, ${residue.contacts} address-book entries, ` +
        `${residue.automationRules} automation rules, ${residue.agentDocuments} agent documents, ` +
        `${residue.agentRules} agent rules, ${residue.agentConversations} agent conversations, ` +
        `${residue.anthropicKeys} Anthropic keys, ${residue.mcpConnections} MCP connections, ` +
        `${residue.triggerRules} trigger rules, ${residue.moneyFlows} money flows, ` +
        `${residue.governedAccounts} governed accounts, ${residue.watchlist} watchlist entries, ` +
        `${residue.alerts} alerts, ${residue.partnerIntents} partner intents, ` +
        `${residue.taxEvents} tax events, ${residue.executions} transaction executions, ` +
        `${residue.confirmations} transaction confirmations, ${residue.stepUpLocks} step-up lock configs`,
    );
    return user;
  }

  private async _createSession(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
    db: Prisma.TransactionClient = prisma,
  ): Promise<AuthResult> {
    const rawRefresh = crypto.randomBytes(64).toString('hex');
    const hashedRefresh = sha256(rawRefresh);

    // Use a random opaque token as the session identifier (same as SIWE flow)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    const session = await db.session.create({
      data: {
        userId,
        token: sessionToken,
        refreshToken: hashedRefresh,
        ipAddress: meta?.ipAddress ?? 'unknown',
        userAgent: meta?.userAgent,
        isActive: true,
        lastActivity: new Date(),
        // App clock, same clock that stamps the credential epoch.
        createdAt: new Date(),
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

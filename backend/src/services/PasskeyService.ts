import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../database/prismaClient';
import { credentialsEpochOf, lockCredentialState, sessionPredatesEpoch } from './identity/credentialsEpoch';

/**
 * PasskeyService — WebAuthn registration + authentication via @simplewebauthn.
 *
 * Keys never leave the user's device; Astryum only stores the public key. This
 * is a LOGIN credential (and a way to add a device), not a signer for on-chain
 * transactions. Lazy-required so the backend compiles even when the optional
 * package or env (WEBAUTHN_*) isn't present — the router returns 503 then.
 */

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Astryum';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

let lib: any = null;
function getLib(): any {
  if (lib) return lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    lib = require('@simplewebauthn/server');
    return lib;
  } catch {
    throw Object.assign(new Error('passkey_unavailable'), { code: 'passkey_unavailable' });
  }
}

export function passkeyConfigured(): boolean {
  try {
    getLib();
    return true;
  } catch {
    return false;
  }
}

interface ChallengeEntry { challenge: string; userId?: string; expiresAt: number }
const regChallenges = new Map<string, ChallengeEntry>(); // keyed by userId
const authChallenges = new Map<string, ChallengeEntry>(); // keyed by challengeId

function purge(map: Map<string, ChallengeEntry>): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.expiresAt < now) map.delete(k);
}

// ── Registration (logged-in: add a passkey to the current account) ───────────
export async function getRegistrationOptions(userId: string, userName: string): Promise<any> {
  const { generateRegistrationOptions } = getLib();
  const existing = await prisma.passkeyCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userId),
    userName,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  purge(regChallenges);
  regChallenges.set(userId, { challenge: options.challenge, userId, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return options;
}

function sessionRevoked(): Error {
  return Object.assign(new Error('session_revoked'), { code: 'session_revoked' });
}

/**
 * Add a passkey to the account of `sessionId`'s session.
 *
 * The auth middleware checked the session BEFORE the WebAuthn verification ran;
 * an account takeover can commit in between, and a passkey written after its
 * sweep would log the previous holder in forever. So the credential is created
 * inside a transaction that first takes the row lock (lockCredentialState, a
 * CAS on the credential state observed here) and THEN re-reads the session:
 * alive, the user's, and born after the credential epoch — or nothing is written.
 */
export async function verifyRegistration(
  userId: string,
  response: any,
  deviceLabel: string | undefined,
  sessionId: string,
): Promise<{ verified: boolean }> {
  const { verifyRegistrationResponse } = getLib();
  purge(regChallenges);
  // Consumed before the verification window opens, like the login challenge: two
  // parallel registrations of the same challenge cannot both proceed.
  const entry = regChallenges.get(userId);
  regChallenges.delete(userId);
  if (!entry) throw Object.assign(new Error('challenge_expired'), { code: 'challenge_expired' });

  const observed = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, preferences: true },
  });
  if (!observed || !sessionId) throw sessionRevoked();

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: entry.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('registration_failed'), { code: 'registration_failed' });
  }

  const info = verification.registrationInfo;
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await lockCredentialState(tx, userId, observed);
      const session = await tx.session.findUnique({ where: { id: sessionId } });
      if (
        !session ||
        !session.isActive ||
        session.userId !== userId ||
        session.expiresAt < new Date() ||
        sessionPredatesEpoch(session.createdAt, credentialsEpochOf(fresh.preferences))
      ) {
        throw sessionRevoked();
      }
      await tx.passkeyCredential.create({
        data: {
          userId,
          credentialId: info.credentialID, // Base64URLString
          publicKey: Buffer.from(info.credentialPublicKey),
          counter: BigInt(info.counter ?? 0),
          transports: response?.response?.transports ?? [],
          deviceLabel: deviceLabel ?? null,
          backedUp: Boolean(info.credentialBackedUp),
          // App clock, same clock that stamps the credential epoch (login
          // refuses a credential born before it).
          createdAt: new Date(),
        },
      });
    });
  } catch (err: any) {
    if (err?.code === 'credentials_changed') throw sessionRevoked();
    throw err;
  }
  return { verified: true };
}

// ── Authentication (login with an existing passkey) ──────────────────────────
export async function getAuthenticationOptions(): Promise<{ options: any; challengeId: string }> {
  const { generateAuthenticationOptions } = getLib();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
  });
  purge(authChallenges);
  const challengeId = crypto.randomBytes(16).toString('hex');
  authChallenges.set(challengeId, { challenge: options.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { options, challengeId };
}

function credentialRevoked(): Error {
  return Object.assign(new Error('credential_revoked'), { code: 'credential_revoked' });
}

/**
 * Log in with a passkey and issue the session — both under the row lock.
 *
 * The WebAuthn verification is a window: an account takeover can commit while
 * it runs (or right after), deleting this credential and moving the credential
 * epoch. A session issued outside any lock is born AFTER the epoch, passes
 * verifyToken, and with it /register/verify adds a brand-new passkey — the
 * previous holder would be back forever (productizer it. 12, finding 5.1).
 *
 * So `issue` runs inside a transaction that first takes the row lock
 * (lockCredentialState, CAS on the credential state observed BEFORE the
 * verification) and then, under that lock:
 *   · re-reads the credential: it must still exist, still be this user's, and
 *     be born after the credential epoch — or `credential_revoked`;
 *   · advances the counter conditionally on the value verified against, in the
 *     same transaction (a parallel use of the same assertion loses);
 *   · refuses a disabled account.
 * A takeover that committed first fails the CAS (`credentials_changed`); one
 * that locks after us sees and revokes the session we just wrote.
 * `issue` is mandatory: no caller gets a verified user id without the lock.
 */
export async function verifyAuthentication<T>(
  challengeId: string,
  response: any,
  issue: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
): Promise<{ userId: string; issued: T }> {
  const { verifyAuthenticationResponse } = getLib();
  purge(authChallenges);
  // CONSUMED FIRST, in one synchronous step (productizer it. 14, menores). The
  // challenge used to be deleted only after the WebAuthn verification, so two
  // assertions of the SAME challenge both read it before either deleted it and
  // both reached the issue step — and an authenticator that always reports
  // counter 0 (most platform passkeys) leaves the conditional counter advance
  // unable to tell them apart. `get` + `delete` with no await between them
  // cannot interleave: the loser gets `challenge_expired`. A failed verification
  // burns the challenge; the client asks for fresh options.
  const entry = authChallenges.get(challengeId);
  authChallenges.delete(challengeId);
  if (!entry) throw Object.assign(new Error('challenge_expired'), { code: 'challenge_expired' });

  const credentialId: string = response?.id;
  if (!credentialId) throw Object.assign(new Error('no_credential'), { code: 'no_credential' });

  const cred = await prisma.passkeyCredential.findUnique({ where: { credentialId } });
  if (!cred) throw Object.assign(new Error('credential_unknown'), { code: 'credential_unknown' });

  // Observe the credential state BEFORE the verification window opens.
  const observed = await prisma.user.findUnique({
    where: { id: cred.userId },
    select: { passwordHash: true, preferences: true },
  });
  if (!observed) throw credentialRevoked();

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: entry.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    authenticator: {
      credentialID: cred.credentialId,
      credentialPublicKey: new Uint8Array(cred.publicKey),
      counter: Number(cred.counter),
      transports: cred.transports as any,
    },
  });
  if (!verification.verified) {
    throw Object.assign(new Error('authentication_failed'), { code: 'authentication_failed' });
  }

  const userId = cred.userId;
  const issued = await prisma.$transaction(async (tx) => {
    const fresh = await lockCredentialState(tx, userId, observed);
    if (!fresh.isActive) {
      throw Object.assign(new Error('account_disabled'), { code: 'account_disabled' });
    }
    const live = await tx.passkeyCredential.findUnique({ where: { credentialId } });
    if (!live || live.userId !== userId || sessionPredatesEpoch(live.createdAt, credentialsEpochOf(fresh.preferences))) {
      throw credentialRevoked();
    }
    const advanced = await tx.passkeyCredential.updateMany({
      where: { credentialId, userId, counter: cred.counter },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    if (!advanced || advanced.count !== 1) throw credentialRevoked();
    await tx.user.update({ where: { id: userId }, data: { lastLogin: new Date() } });
    return issue(tx, userId);
  });

  return { userId, issued };
}

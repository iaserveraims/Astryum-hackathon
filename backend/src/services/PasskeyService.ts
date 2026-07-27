import crypto from 'crypto';
import { prisma } from '../database/prismaClient';

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

export async function verifyRegistration(
  userId: string,
  response: any,
  deviceLabel?: string
): Promise<{ verified: boolean }> {
  const { verifyRegistrationResponse } = getLib();
  purge(regChallenges);
  const entry = regChallenges.get(userId);
  if (!entry) throw Object.assign(new Error('challenge_expired'), { code: 'challenge_expired' });

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: entry.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('registration_failed'), { code: 'registration_failed' });
  }
  regChallenges.delete(userId);

  const info = verification.registrationInfo;
  await prisma.passkeyCredential.create({
    data: {
      userId,
      credentialId: info.credentialID, // Base64URLString
      publicKey: Buffer.from(info.credentialPublicKey),
      counter: BigInt(info.counter ?? 0),
      transports: response?.response?.transports ?? [],
      deviceLabel: deviceLabel ?? null,
      backedUp: Boolean(info.credentialBackedUp),
    },
  });
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

export async function verifyAuthentication(
  challengeId: string,
  response: any
): Promise<{ userId: string }> {
  const { verifyAuthenticationResponse } = getLib();
  purge(authChallenges);
  const entry = authChallenges.get(challengeId);
  if (!entry) throw Object.assign(new Error('challenge_expired'), { code: 'challenge_expired' });

  const credentialId: string = response?.id;
  if (!credentialId) throw Object.assign(new Error('no_credential'), { code: 'no_credential' });

  const cred = await prisma.passkeyCredential.findUnique({ where: { credentialId } });
  if (!cred) throw Object.assign(new Error('credential_unknown'), { code: 'credential_unknown' });

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
  authChallenges.delete(challengeId);

  await prisma.passkeyCredential.update({
    where: { credentialId },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });

  return { userId: cred.userId };
}

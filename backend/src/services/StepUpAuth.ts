import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { prisma } from '../database/prismaClient';
import { resolveJwtSecret } from './SiweAuth';

/**
 * StepUpAuth — generalized "prove you still control a linked wallet" challenge.
 *
 * This is APP-LEVEL authentication (a one-time personal_sign of a throwaway
 * message), NOT a DeFi transaction. It gates sensitive in-app reads/writes when
 * the user has opted into step-up locks. A successful verification mints a short
 * lived, stateless grant JWT that the frontend replays via the X-StepUp-Grant
 * header so the user isn't re-prompted on every action.
 *
 * Mirrors the nonce → sign → verify pattern already used in routes/walletBindings.ts.
 */

export type StepUpFeature =
  | 'moneyflows'
  | 'goals'
  | 'strategies'
  | 'wallet_security'
  | 'kyc'
  | 'data_export'
  | 'profile'
  | 'rules_alerts';

export type StepUpAction = 'read' | 'write';

export const STEP_UP_FEATURES: StepUpFeature[] = [
  'moneyflows',
  'goals',
  'strategies',
  'wallet_security',
  'kyc',
  'data_export',
  'profile',
  'rules_alerts',
];

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 min to use a challenge
const JWT_SECRET = resolveJwtSecret();

/**
 * A CHALLENGE IS ONE ATTEMPT, NOT A FIVE-MINUTE WINDOW OF THEM (productizer
 * it. 22, «Menor»). The nonce used to survive a failed signature, so the same
 * challenge accepted unlimited guesses until its TTL ran out, and `/challenge`
 * had no limit at all — so a stolen session could mint challenges in a loop and
 * grind each one. Two cheap bounds, both in memory, both per process:
 *   · a failed VERDICT about the signature burns the nonce (see below);
 *   · a user may ask for at most `MAX_CHALLENGES_PER_WINDOW` challenges per
 *     window. It is per user (the session's own id), so one account can never
 *     affect another, and the cap sits far above any honest use — a person
 *     verifies a handful of times an hour, not twenty times in five minutes.
 */
const CHALLENGE_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_CHALLENGES_PER_WINDOW = 20;

interface ChallengeEntry {
  userId: string;
  feature: StepUpFeature;
  action: StepUpAction;
  address: string; // lower-case EVM address
  expiresAt: number;
}
const challenges = new Map<string, ChallengeEntry>();
/** userId -> the instants of the challenges it asked for inside the window. */
const challengeIssues = new Map<string, number[]>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [n, e] of challenges) if (e.expiresAt < now) challenges.delete(n);
}

/** Drop a nonce so it can never be tried again. Single use means single use. */
function burn(nonce: string): void {
  challenges.delete(nonce);
}

/**
 * Has this user asked for too many challenges? Counts only what is INSIDE the
 * window, and prunes as it goes so the map cannot grow without bound.
 */
function challengeRateExceeded(userId: string): boolean {
  const now = Date.now();
  const recent = (challengeIssues.get(userId) ?? []).filter((t) => now - t < CHALLENGE_RATE_WINDOW_MS);
  challengeIssues.set(userId, recent);
  if (challengeIssues.size > 10_000) {
    for (const [k, v] of challengeIssues) {
      if (v.every((t) => now - t >= CHALLENGE_RATE_WINDOW_MS)) challengeIssues.delete(k);
    }
  }
  return recent.length >= MAX_CHALLENGES_PER_WINDOW;
}

function recordChallengeIssued(userId: string): void {
  const now = Date.now();
  const recent = (challengeIssues.get(userId) ?? []).filter((t) => now - t < CHALLENGE_RATE_WINDOW_MS);
  recent.push(now);
  challengeIssues.set(userId, recent);
}

/** How long a rate-limited caller waits. Honest, not a guess: the window itself. */
export const CHALLENGE_RATE_RETRY_AFTER_S = Math.ceil(CHALLENGE_RATE_WINDOW_MS / 1000);

/** Test hook - clears the in-memory challenge state between cases. */
export function _resetStepUpChallengesForTests(): void {
  challenges.clear();
  challengeIssues.clear();
}

export function buildStepUpMessage(
  feature: StepUpFeature,
  action: StepUpAction,
  address: string,
  nonce: string,
  timestamp: string
): string {
  return [
    'Astryum Security Verification',
    `Feature: ${feature}`,
    `Action: ${action}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
    'By signing you confirm a sensitive action. No funds are moved.',
  ].join('\n');
}

export interface ChallengeResult {
  nonce: string;
  message: string;
  expiresAt: string;
}

/**
 * Issue a challenge bound to (user, feature, action, address). The address must
 * be verified later against an active WalletBinding of the same user.
 */
export function issueChallenge(
  userId: string,
  feature: StepUpFeature,
  action: StepUpAction,
  address: string
): ChallengeResult {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw Object.assign(new Error('invalid_address'), { code: 'invalid_address' });
  }
  purgeExpired();
  // The cap is checked BEFORE a nonce is minted, so a rate-limited caller costs
  // nothing but the check. It never refuses an exit, and never a signature the
  // person already made: this is only the door that hands out NEW challenges.
  if (challengeRateExceeded(userId)) {
    throw Object.assign(new Error('too_many_challenges'), {
      code: 'too_many_challenges',
      retryAfterSeconds: CHALLENGE_RATE_RETRY_AFTER_S,
    });
  }
  recordChallengeIssued(userId);
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  const addr = address.toLowerCase();
  challenges.set(nonce, { userId, feature, action, address: addr, expiresAt });
  return {
    nonce,
    message: buildStepUpMessage(feature, action, addr, nonce, timestamp),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export interface VerifyChallengeInput {
  userId: string;
  feature: StepUpFeature;
  action: StepUpAction;
  address: string;
  nonce: string;
  message: string;
  signature: string;
  ttlSeconds: number; // grant lifetime, from the user's StepUpLockConfig
}

export interface GrantResult {
  grantToken: string;
  expiresAt: string;
}

/**
 * Verify the signed challenge and mint a grant JWT.
 * Throws Error with code: nonce_unknown | nonce_expired | nonce_mismatch |
 *   signature_invalid | wallet_not_linked
 *
 * The challenge is burned by ANY verdict about the signature (mismatch, bad
 * recovery, a nonce not echoed in the message) as well as by success - never by
 * a failure of ours.
 */
export async function verifyChallengeAndIssueGrant(
  input: VerifyChallengeInput
): Promise<GrantResult> {
  purgeExpired();
  const entry = challenges.get(input.nonce);
  if (!entry) throw Object.assign(new Error('nonce_unknown'), { code: 'nonce_unknown' });
  if (entry.expiresAt < Date.now()) {
    challenges.delete(input.nonce);
    throw Object.assign(new Error('nonce_expired'), { code: 'nonce_expired' });
  }
  if (
    entry.userId !== input.userId ||
    entry.feature !== input.feature ||
    entry.action !== input.action ||
    entry.address !== input.address.toLowerCase()
  ) {
    // A nonce presented for a different (user, feature, action, address) is
    // spent: it was issued for one thing and offered for another.
    burn(input.nonce);
    throw Object.assign(new Error('nonce_mismatch'), { code: 'nonce_mismatch' });
  }

  // Recover signer.
  //
  // EVERY VERDICT ABOUT THE SIGNATURE BURNS THE NONCE (it. 22, «Menor»). Until
  // now only SUCCESS burned it, so a single challenge accepted attempt after
  // attempt for its whole five-minute TTL - which is the one thing a nonce
  // exists to prevent. Note what does NOT burn: the binding read below, and
  // anything else that can fail because WE could not answer. A failure of ours
  // must never cost the person the challenge they already signed.
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(input.message, input.signature);
  } catch {
    burn(input.nonce);
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }
  if (recovered.toLowerCase() !== input.address.toLowerCase()) {
    burn(input.nonce);
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }
  if (!input.message.includes(`Nonce: ${input.nonce}`)) {
    burn(input.nonce);
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }

  // Only a wallet the user has actually linked may elevate privileges.
  // Deliberately NOT burning around this read: it can throw or lag, and that is
  // ours. A person who links the wallet and comes straight back must still be
  // able to use the challenge they already signed.
  const binding = await prisma.walletBinding.findFirst({
    where: { userId: input.userId, address: input.address.toLowerCase(), isActive: true },
    select: { id: true },
  });
  if (!binding) {
    throw Object.assign(new Error('wallet_not_linked'), { code: 'wallet_not_linked' });
  }

  // Burn the challenge — single use.
  burn(input.nonce);

  const ttl = Math.min(Math.max(input.ttlSeconds || 300, 60), 1800);
  const grantToken = jwt.sign(
    {
      sub: input.userId,
      feat: input.feature,
      act: input.action,
      addr: input.address.toLowerCase(),
      jti: crypto.randomBytes(8).toString('hex'),
      typ: 'stepup',
    },
    JWT_SECRET,
    { expiresIn: ttl }
  );
  return { grantToken, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

export interface VerifiedGrant {
  ok: boolean;
  userId?: string;
  reason?: string;
}

/**
 * Stateless verification of a grant JWT for a given (feature, action). A write
 * grant also satisfies a read requirement. No DB hit — bounded by short TTL and
 * binding to {userId, feature, action}.
 */
export function verifyGrant(
  grantToken: string,
  feature: StepUpFeature,
  action: StepUpAction
): VerifiedGrant {
  let payload: any;
  try {
    payload = jwt.verify(grantToken, JWT_SECRET);
  } catch {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (payload?.typ !== 'stepup' || !payload?.sub) {
    return { ok: false, reason: 'grant_invalid' };
  }
  if (payload.feat !== feature) {
    return { ok: false, reason: 'grant_feature_mismatch' };
  }
  const grantAct: StepUpAction = payload.act;
  const covers = grantAct === action || (grantAct === 'write' && action === 'read');
  if (!covers) {
    return { ok: false, reason: 'grant_action_mismatch' };
  }
  return { ok: true, userId: payload.sub };
}

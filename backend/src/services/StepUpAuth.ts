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

interface ChallengeEntry {
  userId: string;
  feature: StepUpFeature;
  action: StepUpAction;
  address: string; // lower-case EVM address
  expiresAt: number;
}
const challenges = new Map<string, ChallengeEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [n, e] of challenges) if (e.expiresAt < now) challenges.delete(n);
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
    throw Object.assign(new Error('nonce_mismatch'), { code: 'nonce_mismatch' });
  }

  // Recover signer
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(input.message, input.signature);
  } catch {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }
  if (recovered.toLowerCase() !== input.address.toLowerCase()) {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }
  if (!input.message.includes(`Nonce: ${input.nonce}`)) {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }

  // Only a wallet the user has actually linked may elevate privileges.
  const binding = await prisma.walletBinding.findFirst({
    where: { userId: input.userId, address: input.address.toLowerCase(), isActive: true },
    select: { id: true },
  });
  if (!binding) {
    throw Object.assign(new Error('wallet_not_linked'), { code: 'wallet_not_linked' });
  }

  // Burn the challenge — single use.
  challenges.delete(input.nonce);

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

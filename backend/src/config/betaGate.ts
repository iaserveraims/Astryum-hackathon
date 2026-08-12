/**
 * Beta gate — who may CREATE an account (founder 2026-08-01, beta opens 08-06).
 *
 * One env, FAIL-CLOSED like legacyAccess:
 *
 *   · BETA_REGISTRATION_OPEN — only the literal 'true' (case-insensitive)
 *     opens registration to everyone. Anything else — 'false', unset, a
 *     typo — ⇒ CLOSED: an account can only be created by an email a founder
 *     approved in the waitlist (waitlist_signups.approvedAt set via the
 *     admin panel's approve button, POST /api/admin-beta/approve).
 *
 * Why closed-by-default: the public X post says "Closed beta — request early
 * access", and the Make Waves posture (limited pilot, caps, per-user switch)
 * depends on the door actually existing. Deploying this code CLOSES public
 * registration until the founders approve emails or flip the env.
 *
 * Scope — the gate guards CREATION only, on every path that mints a new User:
 *   · email register        (AuthService.register)        → approved email
 *   · OAuth first login     (AuthService.oauthLogin)      → approved email
 *   · SIWE first login      (SiweAuth wallet-first create) → closed (no email)
 *   · Xaman first login     (SiweAuth.verifyXamanPayload)  → closed (no email)
 * Existing accounts are NEVER touched: login/refresh/OAuth-returning all skip
 * this module. Wallet-first signup has no email to approve, so in closed beta
 * it is closed — an approved user registers with their email first and binds
 * wallets inside the app (the product's normal binding flow).
 *
 * Jury note (mainnet review 08-05): approve the judges' emails from the admin
 * panel — approval is instant and the invite email is optional.
 */
import { prisma } from '../database/prismaClient';

/** The global switch: only the literal 'true' opens registration for everyone. */
export function isBetaRegistrationOpen(): boolean {
  return (process.env.BETA_REGISTRATION_OPEN ?? '').trim().toLowerCase() === 'true';
}

/** Whether this email has a founder approval on the waitlist. */
export async function isEmailApproved(email: string): Promise<boolean> {
  const row = await prisma.waitlistSignup.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { approvedAt: true },
  });
  return row?.approvedAt != null;
}

/**
 * Throws { code: 'not_invited' } when account creation is not allowed for this
 * identity. Call ONLY from create branches — never from login paths.
 * `email = null` is the wallet-first case (see header: closed while gated).
 */
export async function assertSignupAllowed(email: string | null | undefined): Promise<void> {
  if (isBetaRegistrationOpen()) return;
  if (email && (await isEmailApproved(email))) return;
  throw Object.assign(new Error('not_invited'), { code: 'not_invited' });
}

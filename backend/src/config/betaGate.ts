/**
 * Beta gate — who may CREATE an account.
 *
 * DEFAULT OPEN since 2026-08-16 (founder: the closed-beta phase ends at the
 * next deploy of this code — acquisition needs the world to be able to sign
 * up). One env closes it again:
 *
 *   · BETA_REGISTRATION_OPEN — only the literal 'false' (case-insensitive)
 *     CLOSES registration. Closed ⇒ an account can only be created by an
 *     email a founder approved in the waitlist (waitlist_signups.approvedAt
 *     set via the admin panel's approve button, POST /api/admin-beta/approve).
 *     Unset, 'true', or anything else ⇒ OPEN.
 *
 * History: until 2026-08-16 this was FAIL-CLOSED (only the literal 'true'
 * opened it) — right while the public X post said "Closed beta — request
 * early access"; a wall once the doors are meant to be open. The waitlist
 * keeps working either way (marketing list + the approve flow still sends
 * the boarding-pass email); it is simply no longer the only way in.
 *
 * Scope — the gate guards CREATION only, on every path that mints a new User:
 *   · email register        (AuthService.register)
 *   · OAuth first login     (AuthService.oauthLogin)
 *   · SIWE first login      (SiweAuth wallet-first create)
 *   · Xaman first login     (SiweAuth.verifyXamanPayload)
 * Existing accounts are NEVER touched: login/refresh/OAuth-returning all skip
 * this module. When CLOSED, wallet-first signup has no email to approve, so
 * it is closed — an approved user registers with their email first and binds
 * wallets inside the app (the product's normal binding flow).
 */
import { prisma } from '../database/prismaClient';

/** The global switch: open unless the literal 'false' closes it. */
export function isBetaRegistrationOpen(): boolean {
  return (process.env.BETA_REGISTRATION_OPEN ?? '').trim().toLowerCase() !== 'false';
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

/**
 * Beta gate — who may CREATE an account.
 *
 * DEFAULT OPEN. One env closes it again:
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

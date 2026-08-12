/**
 * Beta-gate writes — approve / revoke waitlist emails (founder 2026-08-01).
 *
 * The ONLY writes of the closed beta's door, in their own router behind
 * adminPanel's requireAdmin (same rule as platformStatus: adminPanel itself
 * stays read-only by construction).
 *
 *   POST /api/admin-beta/approve  { email, sendInvite? }  founders only
 *        → sets waitlist_signups.approvedAt (idempotent: the FIRST approval
 *          instant is kept), creates the row when the email never signed the
 *          public form (source 'admin' — how judges get their seat for the
 *          08-05 mainnet review), and sends the boarding-pass email unless
 *          sendInvite === false. invitedAt records the LAST successful send,
 *          so re-approving is the natural "resend the invite" gesture.
 *
 *   POST /api/admin-beta/revoke   { email }               founders only
 *        → clears approvedAt: the email can no longer CREATE an account.
 *          Deliberately does NOT touch any existing User row — suspending a
 *          live account is a different power (User.isActive) with its own
 *          consequences, and this door must never silently exercise it.
 *
 * The gate itself (fail-closed BETA_REGISTRATION_OPEN) lives in
 * config/betaGate.ts; the enforcement sits in the account-creation paths.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { requireAdmin } from './adminPanel';
import { isNoiseEmail } from './waitlist';
import { sendBetaInvite } from '../services/waitlistMailer';

const router = Router();

const ApproveSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Approve without emailing (e.g. staging a batch, or a judge you'll brief
  // in person). Default is to send — approval that nobody learns about is a
  // seat nobody takes.
  sendInvite: z.boolean().optional(),
  lang: z.enum(['es', 'en']).optional(),
});

router.post('/approve', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = ApproveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }
  const { email, sendInvite, lang } = parsed.data;
  // Same predicate the public door uses — approving a reserved/disposable
  // address is always a typo, and catching it here beats a bounced invite.
  if (isNoiseEmail(email)) {
    res.status(400).json({ error: 'NOISE_EMAIL' });
    return;
  }

  const existing = await prisma.waitlistSignup.findUnique({ where: { email } });
  const approvedAt = existing?.approvedAt ?? new Date();
  const row = existing
    ? await prisma.waitlistSignup.update({ where: { email }, data: { approvedAt } })
    : await prisma.waitlistSignup.create({ data: { email, source: 'admin', approvedAt } });

  let inviteSent = false;
  if (sendInvite !== false) {
    inviteSent = await sendBetaInvite({ email, lang: lang ?? (row.lang === 'es' ? 'es' : 'en') });
    if (inviteSent) {
      await prisma.waitlistSignup.update({ where: { email }, data: { invitedAt: new Date() } });
    }
  }

  res.json({
    ok: true,
    email,
    approvedAt: approvedAt.toISOString(),
    inviteSent,
    alreadyApproved: existing?.approvedAt != null,
  });
}));

const RevokeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

router.post('/revoke', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = RevokeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }
  const { email } = parsed.data;
  const existing = await prisma.waitlistSignup.findUnique({ where: { email }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'NOT_ON_WAITLIST' });
    return;
  }
  // invitedAt stays as history — the record of what was sent should survive
  // the decision to close the door again.
  await prisma.waitlistSignup.update({ where: { email }, data: { approvedAt: null } });
  res.json({ ok: true, email, approvedAt: null });
}));

export default router;

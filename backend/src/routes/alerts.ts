import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';

const router = Router();
// Alerts are chain-agnostic: a wallet is an EVM 0x address OR an XRPL classic
// address (r…). The old EVM-only regex silently 400'd every governed-council
// (r…) query, so council MoneyFlow failures/proposals never reached their inbox
// — the same failure class as the rules route (which already accepts both).
const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_wallet');
const xrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'invalid_wallet');
const walletAddress = z.union([evmAddress, xrplAddress]);

// ── Ownership ───────────────────────────────────────────
// An address is public; an alert is not. The wallet lookup used to match the
// address alone, so any session read another user's alert inbox (council
// failures, proposals, amounts) by typing their address, and PATCH acknowledged
// any alert id. Both are now scoped to the session user's wallet rows, and a
// foreign id answers the same 404 as a missing one, so ids cannot be probed.

function sessionUserId(req: Request): string | null {
  return req.siwe?.userId ?? null;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  const parsed = z
    .object({
      address: walletAddress,
      unread: z.coerce.boolean().optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const wallets = await prisma.wallet.findMany({
    // Case-insensitive: rows may hold the EIP-55 checksummed form while the
    // caller sends lowercase (mirrors the rules route).
    where: { userId, address: { equals: parsed.data.address, mode: 'insensitive' } },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  const alerts = await prisma.alert.findMany({
    where: {
      walletId: { in: walletIds },
      ...(parsed.data.unread ? { acknowledged: false } : {}),
    },
    orderBy: { timestamp: 'desc' },
    take: 100,
  });
  return res.json({ count: alerts.length, alerts });
}));

router.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  try {
    const alert = await prisma.alert.findUnique({
      where: { id: req.params.id },
      select: { id: true, walletId: true },
    });
    if (!alert || !alert.walletId) return res.status(404).json({ error: 'alert_not_found' });
    const owned = await prisma.wallet.findFirst({
      where: { id: alert.walletId, userId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'alert_not_found' });
    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { acknowledged: true },
    });
    return res.json(updated);
  } catch {
    return res.status(404).json({ error: 'alert_not_found' });
  }
});

export default router;

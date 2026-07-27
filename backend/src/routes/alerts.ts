import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prismaClient';

const router = Router();
// Alerts are chain-agnostic: a wallet is an EVM 0x address OR an XRPL classic
// address (r…). The old EVM-only regex silently 400'd every governed-council
// (r…) query, so council MoneyFlow failures/proposals never reached their inbox
// — the same failure class as the rules route (which already accepts both).
const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_wallet');
const xrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'invalid_wallet');
const walletAddress = z.union([evmAddress, xrplAddress]);

router.get('/', async (req: Request, res: Response) => {
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
    where: { address: { equals: parsed.data.address, mode: 'insensitive' } },
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
});

router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.alert.update({
      where: { id: req.params.id },
      data: { acknowledged: true },
    });
    return res.json(updated);
  } catch {
    return res.status(404).json({ error: 'alert_not_found' });
  }
});

export default router;

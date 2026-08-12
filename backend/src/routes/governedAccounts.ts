/**
 * Governed-account registry — the authority switcher's server-side list.
 *
 * A row is a POINTER the user placed: "I govern/observe this council-governed
 * account". It replaces the per-device localStorage list
 * ('astryum-observed-legacies') so a user's authorities follow them across
 * devices. The account's STATE (council, quorum, health) is never stored —
 * every surface reads it fresh from the ledger via /xrpl-defi/rehearsal-status.
 * Losing this table loses pointers, never governance state.
 *
 * Pointers only: nothing here touches keys, signatures or transactions.
 * Mounted with requireSiweAuth in index-simple.ts.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const router = Router();

function requireUserId(req: Request, res: Response): string | null {
  const userId = req.siwe?.userId;
  if (!userId) {
    res.status(401).json({ error: 'missing_siwe_session' });
    return null;
  }
  return userId;
}

const selectFields = {
  id: true,
  ecosystem: true,
  address: true,
  label: true,
  createdAt: true,
} as const;

// GET / — the user's active governed-account pointers.
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const accounts = await prisma.governedAccount.findMany({
    where: { userId, removedAt: null },
    orderBy: { createdAt: 'asc' },
    select: selectFields,
  });
  return res.json({ accounts });
}));

// POST / — add a pointer (idempotent: re-adding revives a removed row and
// keeps the existing one otherwise). Only XRPL councils are readable today,
// so only 'xrpl' is accepted — the DB column is wider on purpose.
const createSchema = z.object({
  address: z.string().trim().min(1),
  ecosystem: z.literal('xrpl').default('xrpl'),
  label: z.string().trim().max(64).optional(),
});

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const { address, ecosystem, label } = parsed.data;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
  }
  const account = await prisma.governedAccount.upsert({
    where: { userId_ecosystem_address: { userId, ecosystem, address } },
    create: { userId, ecosystem, address, label: label ?? null },
    update: { removedAt: null, ...(label !== undefined ? { label } : {}) },
    select: selectFields,
  });
  return res.status(201).json({ account });
}));

// PATCH /:id — rename the pointer's label.
const patchSchema = z.object({ label: z.string().trim().max(64).nullable() });

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const { count } = await prisma.governedAccount.updateMany({
    where: { id: req.params.id, userId, removedAt: null },
    data: { label: parsed.data.label },
  });
  if (count === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json({ ok: true });
}));

// DELETE /:id — soft-remove the pointer (the account itself is untouched;
// re-observing the address revives the row).
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { count } = await prisma.governedAccount.updateMany({
    where: { id: req.params.id, userId, removedAt: null },
    data: { removedAt: new Date() },
  });
  if (count === 0) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json({ ok: true });
}));

export default router;

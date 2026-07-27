/**
 * Address book — user-saved destination addresses for the Wallets page.
 *
 * Pruned in e8f6f58 and restored for the Send flow: the send modal offers the
 * saved entries as one-tap destinations next to the user's own wallets.
 * Restored with one extension over the pre-prune version: entries can be XRPL
 * classic addresses (r…) as well as EVM (0x…) — the send modal infers the rail
 * from the format exactly like a pasted address.
 *
 * Pure UX data (labels + public addresses), SIWE-scoped to the owner. No keys,
 * no funds, no payloads — saving an address never authorizes anything.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { prisma } from '../database/prismaClient';

const router = Router();
router.use(requireSiweAuth);

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// XRPL classic address (base58, no 0/O/I/l) — case-SENSITIVE, never lowercase it.
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const entrySchema = z.object({
  label: z.string().min(1).max(64),
  address: z
    .string()
    .trim()
    .refine((a) => EVM_ADDRESS_RE.test(a) || XRPL_CLASSIC_RE.test(a), 'invalid_address'),
  chainId: z.number().int().positive().optional(),
  ens: z.string().max(128).optional(),
});

/** EVM addresses are case-insensitive → store lowercase so the unique index
 *  catches duplicates. XRPL base58 is case-sensitive → store verbatim. */
function normalizeAddress(address: string): string {
  return EVM_ADDRESS_RE.test(address) ? address.toLowerCase() : address;
}

/**
 * GET /api/address-book
 * List all address book entries for the authenticated user.
 * Optional query: ?chainId=1 to filter by chain.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : undefined;

  const entries = await prisma.addressBookEntry.findMany({
    where: { userId, ...(chainId != null && { chainId }) },
    orderBy: { label: 'asc' },
  });
  return res.json({ entries });
});

/**
 * POST /api/address-book
 * Add a new address book entry.
 */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }

  const { label, address, chainId, ens } = parsed.data;

  try {
    const entry = await prisma.addressBookEntry.create({
      data: { userId, label, address: normalizeAddress(address), chainId, ens },
    });
    return res.status(201).json({ entry });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({
        error: 'ENTRY_ALREADY_EXISTS',
        detail: 'An entry with this address and chainId already exists',
      });
    }
    return res.status(500).json({ error: 'CREATE_FAILED', detail: err?.message });
  }
});

/**
 * PATCH /api/address-book/:id
 * Update label or ENS of an existing entry.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const { label, ens } = req.body as { label?: string; ens?: string };

  const existing = await prisma.addressBookEntry.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'ENTRY_NOT_FOUND' });
  }

  const entry = await prisma.addressBookEntry.update({
    where: { id: req.params.id },
    data: {
      ...(label !== undefined && { label }),
      ...(ens !== undefined && { ens }),
    },
  });
  return res.json({ entry });
});

/**
 * DELETE /api/address-book/:id
 * Remove an address book entry.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;

  const existing = await prisma.addressBookEntry.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'ENTRY_NOT_FOUND' });
  }

  await prisma.addressBookEntry.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

export default router;

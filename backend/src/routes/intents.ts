import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { IntentEngine } from '../engines/intent/IntentEngine';
import { prisma } from '../database/prismaClient';

/**
 * The signing surface's backend: the intents the AutomationEngine (or a user
 * flow) PREPARED and left in `proposed`, waiting for the user's signature.
 * Notifications point at /app/intents; this is what that page reads.
 *
 * Read + user-lifecycle only. Nothing here signs, broadcasts or executes —
 * the user fetches the unsigned payload, signs in their own wallet, and
 * reports the hash back (invariants #1/#8).
 *
 * Ownership: every read and every transition is scoped to the session user.
 * An intent belongs to whoever owns a wallet row for `intent.owner`; anyone
 * else gets the same 404 as a missing id, so ids cannot be probed.
 */
const router = Router();

// Chain-agnostic (A.1): the signing surface serves EVM intents (0x owner) and
// XRPL intents (r… owner) alike — the wallet, not the chain, is the identity.
const address = z
  .string()
  .regex(/^(0x[a-fA-F0-9]{40}|r[1-9A-HJ-NP-Za-km-z]{24,34})$/, 'invalid_address');

// The hash the user reports after signing in their own wallet: an EVM tx hash
// (0x + 32 bytes) or an XRPL tx hash (32 bytes, no prefix). Anything else is
// not a transaction reference and must never advance the FSM.
const txHash = z
  .string()
  // A ledger hash (XRPL: 64 hex; EVM: 0x + 64 hex) OR an EIP-5792 call-bundle id:
  // when getCallsStatus returns no transactionHash the settlement tracker keeps
  // the bundle id as the reference (frontend lib/settlement/tracker.ts), and a
  // hash-only rule answered 400 to the legitimate owner. Wallets return that id
  // as 0x-prefixed, even-length hex of at least 32 bytes.
  .regex(/^(0x(?:[0-9a-fA-F]{2}){32,8097}|[0-9a-fA-F]{64})$/, 'invalid_tx_hash');

function sessionUserId(req: Request): string | null {
  return (req as Request & { siwe?: { userId?: string } }).siwe?.userId ?? null;
}

/** Addresses of the session user's wallet rows (any chain, any storage case). */
async function sessionAddresses(userId: string): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { address: true },
  });
  return wallets.map((w) => w.address.toLowerCase());
}

/** The intent, only if its owner is one of the session user's wallets. */
async function findOwnedIntent(id: string, userId: string) {
  const intent = await IntentEngine.getInstance().getIntent(id);
  if (!intent) return null;
  const mine = await sessionAddresses(userId);
  return mine.includes(String(intent.owner).toLowerCase()) ? intent : null;
}

router.use((req: Request, res: Response, next) => {
  if (!sessionUserId(req)) {
    res.status(401).json({ error: 'missing_siwe_session' });
    return;
  }
  next();
});

/** GET /api/intents?address=0x… — newest first, all lifecycle states (the UI
 *  separates "waiting for signature" from history by status). */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ address }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const userId = sessionUserId(req)!;
  const mine = await sessionAddresses(userId);
  if (!mine.includes(parsed.data.address.toLowerCase())) {
    // Not the caller's wallet: same answer as an unknown one.
    return res.status(404).json({ error: 'wallet_not_registered' });
  }
  const intents = await IntentEngine.getInstance().listUserIntents(parsed.data.address);
  return res.json({ count: intents.length, intents });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const intent = await findOwnedIntent(req.params.id, sessionUserId(req)!);
  if (!intent) return res.status(404).json({ error: 'intent_not_found' });
  return res.json(intent);
}));

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const owned = await findOwnedIntent(req.params.id, sessionUserId(req)!);
    if (!owned) return res.status(404).json({ error: 'intent_not_found' });
    const updated = await IntentEngine.getInstance().cancelIntent(
      req.params.id,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined,
    );
    return res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'intent_not_found' ? 404 : 409;
    return res.status(status).json({ error: msg });
  }
});

/** The user signed in their wallet and reports the hash: advance the FSM
 *  READY_TO_SIGN → SIGNED → SUBMITTED. The signature happened OUTSIDE Astryum. */
router.post('/:id/submitted', async (req: Request, res: Response) => {
  const parsed = z.object({ txHash }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const owned = await findOwnedIntent(req.params.id, sessionUserId(req)!);
    if (!owned) return res.status(404).json({ error: 'intent_not_found' });
    const engine = IntentEngine.getInstance();
    await engine.transition(req.params.id, 'SIGNED');
    const updated = await engine.transition(req.params.id, 'SUBMITTED', {
      txHash: parsed.data.txHash,
    });
    return res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'intent_not_found' ? 404 : 409;
    return res.status(status).json({ error: msg });
  }
});

export default router;

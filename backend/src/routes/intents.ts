import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { IntentEngine } from '../engines/intent/IntentEngine';

/**
 * The signing surface's backend: the intents the AutomationEngine (or a user
 * flow) PREPARED and left in `proposed`, waiting for the user's signature.
 * Notifications point at /app/intents; this is what that page reads.
 *
 * Read + user-lifecycle only. Nothing here signs, broadcasts or executes —
 * the user fetches the unsigned payload, signs in their own wallet, and
 * reports the hash back (invariants #1/#8).
 */
const router = Router();

// Chain-agnostic (A.1): the signing surface serves EVM intents (0x owner) and
// XRPL intents (r… owner) alike — the wallet, not the chain, is the identity.
const address = z
  .string()
  .regex(/^(0x[a-fA-F0-9]{40}|r[1-9A-HJ-NP-Za-km-z]{24,34})$/, 'invalid_address');

/** GET /api/intents?address=0x… — newest first, all lifecycle states (the UI
 *  separates "waiting for signature" from history by status). */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ address }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const intents = await IntentEngine.getInstance().listUserIntents(parsed.data.address);
  return res.json({ count: intents.length, intents });
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const intent = await IntentEngine.getInstance().getIntent(req.params.id);
  if (!intent) return res.status(404).json({ error: 'intent_not_found' });
  return res.json(intent);
}));

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
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
  const parsed = z.object({ txHash: z.string().min(4) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
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

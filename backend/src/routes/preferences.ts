import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';

/**
 * /api/preferences — small, best-effort user preferences store.
 *
 * First (and so far only) use: server-side backup of automation rule-form
 * prefills (F25). `frontend/src/lib/automation/rulePrefill.ts` stashes
 * precomputed form values (e.g. the E1 entry's `a1` threshold) in
 * localStorage so the PROTECT template opens pre-filled — but localStorage
 * doesn't cross devices. This router lets that same value be read back on a
 * second device, best-effort. The values are pure form UX — never signed,
 * never executed (CLAUDE.md invariants #1/#8) — so every handler here reads
 * or writes only the calling user's OWN row, keyed by `req.siwe.userId`.
 *
 * Mounted behind requireSiweAuth elsewhere (index-simple.ts), so req.siwe is
 * populated by the time these handlers run.
 */
const router = Router();

// Server-side retention is generous vs. the client's own freshness window
// (rulePrefill.ts DEFAULT_MAX_AGE_MS = 14 days) — this just keeps the row
// from growing without bound; the client still decides what counts as fresh.
const MAX_PREFILL_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// This is UX convenience, not a data store: cap breadth so the field can
// never become an arbitrary blob.
const MAX_ENTRY_KEYS = 12;
const MAX_ENTRY_VALUE_LEN = 64;

const boundedStringRecord = z
  .record(z.string().max(MAX_ENTRY_VALUE_LEN))
  .refine((v) => Object.keys(v).length <= MAX_ENTRY_KEYS, {
    message: `too_many_keys (max ${MAX_ENTRY_KEYS})`,
  });

const rulePrefillEntrySchema = z.object({
  values: boundedStringRecord,
  source: z.string().min(1).max(120),
  context: boundedStringRecord.optional(),
  savedAt: z.number().int().positive(),
});

const putRulePrefillSchema = z.object({
  scope: z.string().min(3).max(120),
  entry: rulePrefillEntrySchema,
});

type RulePrefillEntry = z.infer<typeof rulePrefillEntrySchema>;

/** Drop anything malformed or older than MAX_PREFILL_AGE_MS — defence in
 *  depth against rows written by a future/older shape of this schema. */
function prunePrefills(raw: unknown): Record<string, RulePrefillEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const now = Date.now();
  const out: Record<string, RulePrefillEntry> = {};
  for (const [scope, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = rulePrefillEntrySchema.safeParse(value);
    if (parsed.success && now - parsed.data.savedAt <= MAX_PREFILL_AGE_MS) {
      out[scope] = parsed.data;
    }
  }
  return out;
}

// ── GET /rule-prefills ───────────────────────────────────────────────────────
router.get('/rule-prefills', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const row = await prisma.userPreferences.findUnique({ where: { userId } });
  const tradingPreferences = (row?.tradingPreferences ?? null) as Record<string, unknown> | null;
  const prefills = prunePrefills(tradingPreferences?.rulePrefills);
  return res.json({ prefills });
}));

// ── PUT /rule-prefills ───────────────────────────────────────────────────────
router.put('/rule-prefills', async (req: Request, res: Response) => {
  const parsed = putRulePrefillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const userId = req.siwe!.userId;
  const { scope, entry } = parsed.data;

  try {
    const row = await prisma.userPreferences.findUnique({ where: { userId } });
    const existingTradingPreferences =
      row?.tradingPreferences && typeof row.tradingPreferences === 'object'
        ? (row.tradingPreferences as Record<string, unknown>)
        : {};
    const prefills = prunePrefills(existingTradingPreferences.rulePrefills);
    prefills[scope] = entry;

    const tradingPreferences = { ...existingTradingPreferences, rulePrefills: prefills };

    await prisma.userPreferences.upsert({
      where: { userId },
      update: { tradingPreferences: tradingPreferences as object },
      create: {
        userId,
        // Required Json columns on this model — this endpoint doesn't own
        // them, so they start empty; whatever feature does own them fills
        // them in later without this row needing to be re-created.
        notifications: {},
        alertSettings: {},
        tradingPreferences: tradingPreferences as object,
      },
    });
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({
      error: 'rule_prefill_save_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;

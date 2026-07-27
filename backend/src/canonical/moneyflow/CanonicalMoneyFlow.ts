/**
 * CanonicalMoneyFlow (CMF) v0.1 — the chain-agnostic MoneyFlow spec.
 *
 * The CMF is the TOP layer of the canonical language (F1, estrategia conjunta):
 * the AI copilot composes a CMF DRAFT, the user reviews/edits it in the
 * MoneyFlow modal, and a deterministic per-chain translator compiles it DOWN to
 * what already exists — AutomationRule + IntentPayload on EVM/Flare today;
 * unsigned txjson on XRPL post-builders (X1); Smart Escrows (XLS-100) only when
 * the amendment activates. The CMF is ADDITIVE: it replaces nothing, and the
 * engine/boundary/builders stay untouched (design doc
 * Astryum_Agente_MoneyFlows_Canonical_Verificacion_Diseno_2026-07-09 §2-§3).
 *
 * Line of custody (invariant #8): the LLM only ever DRAFTS a CMF. Zod validates
 * it server-side (an invalid draft is discarded, never repaired silently), the
 * user confirms it in the modal, the translator is deterministic, and every
 * resulting rule fires through the existing prepare→push→user-signs path.
 * Nothing here can reach a wallet.
 *
 * Naming: `CanonicalIntent` (ERC-7683, EVM solver intents) and
 * `CanonicalAction` (canonical/types/Action.ts, intent-level action) were both
 * taken — CMF sub-types use the `Cmf` prefix to avoid collision.
 */

import { z } from 'zod';

export const CMF_VERSION = 'cmf/0.1' as const;

/* ------------------------------------------------------------------ */
/* Schemas (zod is the source of truth; types are inferred)            */
/* ------------------------------------------------------------------ */

/** CAIP-2 chain id, e.g. 'eip155:14' (Flare) or 'xrpl:0'. */
const caip2 = z.string().regex(/^[a-z0-9]{3,8}:[a-zA-Z0-9._-]{1,32}$/, 'invalid_caip2_chain');

/**
 * Asset in CAIP style: agnostic until resolved. The address is resolved by the
 * translator from config/registries — the LLM NEVER writes one (a draft with an
 * address is rejected by the compose route before it reaches the user).
 */
export const cmfAssetSchema = z.object({
  symbol: z.string().min(1).max(20),
  chain: caip2.optional(),
  address: z.string().max(64).optional(),
});

export const CMF_TRIGGER_KINDS = ['health-factor', 'ltv', 'price', 'reward', 'idle-balance', 'time'] as const;

/**
 * Chain-agnostic superset of the engine's TriggerConfig. 'below' on
 * health-factor = protect (de-leverage); 'above' = expand (re-leverage);
 * a bidirectional flow holds steps with opposite comparators.
 */
export const cmfTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('health-factor'),
    comparator: z.enum(['below', 'above']),
    threshold: z.number().positive(),
    positionRef: z.string().max(120).optional(),
  }),
  z.object({ kind: z.literal('ltv'), comparator: z.literal('above'), threshold: z.number().positive() }),
  z.object({
    kind: z.literal('price'),
    asset: cmfAssetSchema,
    comparator: z.enum(['below', 'above']),
    threshold: z.number().positive(),
  }),
  z.object({ kind: z.literal('reward'), minUsd: z.number().positive() }),
  z.object({ kind: z.literal('idle-balance'), asset: cmfAssetSchema, minUsd: z.number().positive() }),
  z.object({ kind: z.literal('time'), cron: z.string().min(1).max(100) }),
]);

export const CMF_VERBS = [
  'supply', 'withdraw', 'borrow', 'repay', 'swap',
  'provide-liquidity', 'remove-liquidity', 'stake', 'unstake',
  'claim-rewards', 'transfer', 'bridge',
] as const;

/**
 * Amounts: 'absolute' is a human-readable decimal string in the asset's display
 * units (the translator converts to base units — never the LLM).
 * 'percent-of-position' and 'to-target' resolve to a concrete amount at trigger
 * time — that is engine work scheduled AFTER F1, so today's EVM translator
 * rejects them with a readable error (see ChainCapability.amountTypes).
 */
export const cmfAmountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('absolute'), value: z.string().regex(/^\d+(\.\d+)?$/, 'invalid_decimal') }),
  z.object({ type: z.literal('percent-of-position'), pct: z.number().gt(0).lte(100) }),
  z.object({ type: z.literal('to-target'), target: z.literal('hf'), value: z.number().gt(1) }),
]);

export const cmfActionSchema = z.object({
  verb: z.enum(CMF_VERBS),
  asset: cmfAssetSchema,
  /** Optional for verbs with no amount semantics (claim-rewards). */
  amount: cmfAmountSchema.optional(),
  /** Optional: the translator/user resolves the venue when absent. */
  venue: z
    .object({
      protocolId: z.string().max(60).optional(),
      positionId: z.string().max(120).optional(),
      /** Venue-specific extras the templates already use (e.g. FTSO wrap). */
      params: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export const cmfStepSchema = z.object({
  /** Escalón order (1, 2, 3…) — unique within a flow. */
  level: z.number().int().min(1).max(20),
  trigger: cmfTriggerSchema,
  /** Action sequence when the step fires (the EVM translator takes 1 per step today). */
  actions: z.array(cmfActionSchema).min(1).max(4),
});

export const cmfPolicySchema = z.object({
  maxAmountPerTriggerUsd: z.number().positive().optional(),
  /** ≥5: the cooldown is a MANDATORY anti-thrash guard for agent-composed flows
   *  (estrategia conjunta C.2: "cooldown + tramo mínimo obligatorios"). */
  cooldownMinutes: z.number().int().min(5),
  /** ISO datetime — a flow expires like an intent does. */
  expiry: z.string().datetime({ offset: true }).optional(),
  /** Invariant #6, literal: fees/terms are disclosed before any signature. */
  disclosedToUser: z.literal(true),
});

/**
 * What the LLM emits in compose_moneyflow mode — the DRAFT. version/id/origin
 * are stamped server-side after validation so the model can't forge them.
 */
export const cmfDraftSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  direction: z.enum(['protect', 'expand', 'bidirectional']),
  steps: z.array(cmfStepSchema).min(1).max(6),
  policy: cmfPolicySchema,
});

export const canonicalMoneyFlowSchema = cmfDraftSchema.extend({
  version: z.literal(CMF_VERSION),
  id: z.string().min(8).max(64),
  origin: z.object({
    source: z.enum(['user', 'ai_copilot']),
    /** Audit anchor — mirrors IntentPayload.audit.intentSource. */
    conversationRef: z.string().max(200).optional(),
  }),
});

export type CmfAsset = z.infer<typeof cmfAssetSchema>;
export type CmfTrigger = z.infer<typeof cmfTriggerSchema>;
export type CmfTriggerKind = CmfTrigger['kind'];
export type CmfVerb = (typeof CMF_VERBS)[number];
export type CmfAmount = z.infer<typeof cmfAmountSchema>;
export type CmfAmountType = CmfAmount['type'];
export type CmfAction = z.infer<typeof cmfActionSchema>;
export type CmfStep = z.infer<typeof cmfStepSchema>;
export type CmfPolicy = z.infer<typeof cmfPolicySchema>;
export type CmfDraft = z.infer<typeof cmfDraftSchema>;
export type CanonicalMoneyFlow = z.infer<typeof canonicalMoneyFlowSchema>;

/* ------------------------------------------------------------------ */
/* Invariant validator (beyond shape: the rules zod can't express)     */
/* ------------------------------------------------------------------ */

/** E-money tokens — the only stables EU-facing strategies may ACQUIRE (inv. #4). */
export const EMT_STABLES = new Set(['USDC', 'EURC', 'RLUSD']);

/** Known non-EMT stables: read-only, except for de-risking existing debt. */
export const NON_EMT_STABLES = new Set([
  'USDT', 'USDT0', 'DAI', 'FRAX', 'TUSD', 'BUSD', 'FDUSD', 'USDD', 'USDE', 'PYUSD',
]);

/** Verbs that only ever REDUCE exposure — allowed even on non-EMT stables. */
const DERISK_VERBS: ReadonlySet<CmfVerb> = new Set(['repay', 'withdraw'] as CmfVerb[]);

export interface CmfViolation {
  code: string;
  message: string;
  level?: number;
}

/**
 * Enforce the hard invariants a structurally-valid CMF can still break.
 * Returns [] when the flow is clean. This is code, not prompt — the validator
 * forces invariant #4/#6, the CAGE merely explains it.
 */
export function validateCmfInvariants(
  cmf: CmfDraft | CanonicalMoneyFlow,
  now: Date = new Date(),
): CmfViolation[] {
  const violations: CmfViolation[] = [];

  // Invariant #4 — EU-facing strategies acquire EMTs only; non-EMT stables are
  // read-only except when de-risking existing debt (repay/withdraw).
  for (const step of cmf.steps) {
    for (const action of step.actions) {
      const symbol = action.asset.symbol.toUpperCase();
      if (NON_EMT_STABLES.has(symbol) && !DERISK_VERBS.has(action.verb)) {
        violations.push({
          code: 'non_emt_stable',
          message:
            `${symbol} is not an e-money token (EMT). EU-facing strategies use USDC/EURC/RLUSD; ` +
            `${symbol} is allowed only to de-risk existing debt (repay/withdraw).`,
          level: step.level,
        });
      }
      // The LLM never writes token addresses — resolution belongs to the translator.
      if (cmfIsAiOrigin(cmf) && action.asset.address) {
        violations.push({
          code: 'ai_wrote_address',
          message: `An AI-drafted flow may not carry token addresses (got one for ${symbol}); the translator resolves them.`,
          level: step.level,
        });
      }
    }
  }

  // Step levels must be unique (they are the escalones of the flow).
  const levels = cmf.steps.map((s) => s.level);
  if (new Set(levels).size !== levels.length) {
    violations.push({ code: 'duplicate_step_levels', message: 'Step levels must be unique within a flow.' });
  }

  // A flow with an expiry must not be born expired.
  if (cmf.policy.expiry && new Date(cmf.policy.expiry).getTime() <= now.getTime()) {
    violations.push({ code: 'expired_flow', message: 'policy.expiry is in the past — the flow would never run.' });
  }

  return violations;
}

function cmfIsAiOrigin(cmf: CmfDraft | CanonicalMoneyFlow): boolean {
  return 'origin' in cmf ? cmf.origin.source === 'ai_copilot' : true; // drafts default to AI origin
}

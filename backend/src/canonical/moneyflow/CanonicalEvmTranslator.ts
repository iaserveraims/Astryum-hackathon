/**
 * CanonicalEvmTranslator — CMF → AutomationRule payloads (Flare/EVM, F1).
 *
 * Deterministic, pure, no I/O: one CanonicalStep compiles to ONE AutomationRule
 * payload (design doc §3.1). The rules are then created through the EXISTING
 * SIWE+step-up-gated POST /api/rules path and linked by `canonicalRef = cmf.id`
 * — from there the untouched engine does the rest: tick → TriggerEvaluator →
 * IntentEngine.createIntent (prepare-only) → push → THE USER SIGNS. The
 * translator opens no new path toward a wallet; it only writes vocabulary the
 * engine already speaks.
 *
 * Degradation is explicit: anything outside the chain capability (stub
 * triggers, unsupported verbs, non-absolute amounts, multi-action steps)
 * FAILS with a readable error — never a silent approximation (§2.3).
 */

import {
  validateCmfInvariants,
  type CanonicalMoneyFlow,
  type CmfAction,
  type CmfTrigger,
  type CmfViolation,
} from './CanonicalMoneyFlow';
import { FLARE_EVM_CAPABILITY, type ChainCapability, type ExecutionMode } from './ChainCapability';

/** Matches routes/rules.ts createRuleSchema (plus the canonicalRef link). */
export interface EvmRulePayload {
  chainId: number;
  name: string;
  trigger: Record<string, unknown>;
  action: {
    kind: string;
    protocolId?: string;
    positionId?: string;
    params?: Record<string, unknown>;
  };
  cooldownMinutes: number;
  maxValueUSD: number;
  canonicalRef: string;
  /** Enforced TTL (ISO): policy.expiry clamped to ≤90d, defaulted when absent. */
  expiresAt: string;
}

// The `?: undefined` counter-fields keep property access typeable without
// narrowing — this repo compiles with strict off, where boolean-discriminant
// narrowing is unavailable (same trick zod's SafeParseReturnType uses).
export type TranslateResult =
  | { ok: true; chain: string; mode: ExecutionMode; rules: EvmRulePayload[]; notes: string[]; errors?: undefined }
  | { ok: false; errors: CmfViolation[]; chain?: undefined; mode?: undefined; rules?: undefined; notes?: undefined };

/** rules.ts default — kept in sync with createRuleSchema.maxValueUSD. */
const DEFAULT_MAX_VALUE_USD = 10_000;

/** TTL guardrail — kept in sync with rules.ts MAX_TTL_DAYS. A MoneyFlow rule
 *  without expiry is an agent with a budget over time: not deliverable. */
const MAX_TTL_DAYS = 90;

/** policy.expiry → enforced ISO expiry: absent → now+90d; provided → ≤ now+90d. */
export function resolveFlowExpiry(expiry: string | undefined, now: Date): string {
  const cap = new Date(now.getTime() + MAX_TTL_DAYS * 24 * 60 * 60 * 1000);
  if (!expiry) return cap.toISOString();
  const provided = new Date(expiry);
  if (Number.isNaN(provided.getTime()) || provided.getTime() <= now.getTime()) return cap.toISOString();
  return (provided.getTime() > cap.getTime() ? cap : provided).toISOString();
}

/** CMF verb → AutomationRule action.kind (routes/rules.ts actionSchema enum). */
const VERB_TO_ACTION_KIND: Readonly<Record<string, string>> = Object.freeze({
  supply: 'supply',
  withdraw: 'withdraw',
  borrow: 'borrow',
  repay: 'repay',
  swap: 'swap',
  'provide-liquidity': 'addLiquidity',
  'remove-liquidity': 'exitLP',
  stake: 'stake',
  unstake: 'unstake',
  'claim-rewards': 'claimRewards',
});

/** Verbs whose prepared action needs no amount (the venue params carry the config). */
const AMOUNTLESS_VERBS = new Set(['claim-rewards']);

/**
 * Display decimals for the assets the Flare venue trades today. The CMF carries
 * HUMAN amounts (the user edits those in the modal); the translator converts to
 * base units exactly like the PROTECT template does (USDT0 = 6). An asset
 * missing here fails translation with a readable error — we never guess
 * decimals for money.
 */
const ASSET_DECIMALS: Readonly<Record<string, number>> = Object.freeze({
  USDT0: 6,
  USDC: 6,
  EURC: 6,
  FXRP: 6, // UBA == XRP drops
  WFLR: 18,
  FLR: 18,
  SFLR: 18,
});

/** '25.5' × 10^6 → '25500000' — string math, no floats near money. */
export function toBaseUnits(value: string, decimals: number): string {
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new Error(`more than ${decimals} decimal places`);
  }
  const scaled = BigInt(whole + fraction.padEnd(decimals, '0'));
  return scaled.toString();
}

function translateTrigger(
  trigger: CmfTrigger,
  capability: ChainCapability,
  level: number,
): { trigger?: Record<string, unknown>; error?: CmfViolation } {
  if (!capability.triggers.includes(trigger.kind)) {
    return {
      error: {
        code: 'trigger_not_supported',
        message: `Trigger "${trigger.kind}" is not available on ${capability.chain} yet (${
          trigger.kind === 'price' || trigger.kind === 'time'
            ? 'its evaluator is a stub — excluded until implemented'
            : 'not in the chain capability'
        }).`,
        level,
      },
    };
  }
  switch (trigger.kind) {
    case 'health-factor':
      if (trigger.comparator === 'above') {
        return {
          error: {
            code: 'hf_above_not_supported',
            message:
              'health-factor "above" (re-leverage) needs an HF_ABOVE evaluator — post-F1. Today only "below" (protect) translates.',
            level,
          },
        };
      }
      return { trigger: { type: 'HF_BELOW', threshold: trigger.threshold } };
    case 'ltv':
      return { trigger: { type: 'LTV_ABOVE', threshold: trigger.threshold } };
    case 'reward':
      return { trigger: { type: 'REWARD_THRESHOLD', minUSD: trigger.minUsd } };
    case 'idle-balance':
      return {
        trigger: { type: 'IDLE_BALANCE', asset: trigger.asset.symbol.toUpperCase(), minUSD: trigger.minUsd },
      };
    case 'time':
      // TIME_TRIGGER evaluator implemented (Fase 3) — the CMF cron passes
      // through; TriggerEvaluator.parseCron rejects unsupported syntax at
      // evaluation with a readable reason.
      return { trigger: { type: 'TIME_TRIGGER', cron: trigger.cron } };
    default:
      // 'price' — unreachable while excluded from the capability, kept for exhaustiveness.
      return {
        error: { code: 'trigger_not_supported', message: `Trigger "${trigger.kind}" not translatable.`, level },
      };
  }
}

function translateAction(
  action: CmfAction,
  capability: ChainCapability,
  level: number,
): { action?: EvmRulePayload['action']; error?: CmfViolation } {
  if (!capability.verbs.includes(action.verb)) {
    return {
      error: {
        code: 'verb_not_supported',
        message:
          action.verb === 'transfer' || action.verb === 'bridge'
            ? `"${action.verb}" is not an automation action on ${capability.chain} — cross-ecosystem moves are the C.2 primitive (post-F1).`
            : `Verb "${action.verb}" is not in the ${capability.chain} capability.`,
        level,
      },
    };
  }

  const kind = VERB_TO_ACTION_KIND[action.verb];
  const params: Record<string, unknown> = { ...(action.venue?.params ?? {}) };

  if (!AMOUNTLESS_VERBS.has(action.verb)) {
    if (!action.amount) {
      return {
        error: {
          code: 'amount_required',
          message: `"${action.verb}" needs an amount (only claim-rewards is amount-less).`,
          level,
        },
      };
    }
    if (action.amount.type !== 'absolute') {
      return {
        error: {
          code: 'amount_type_not_supported',
          message: `Amount type "${action.amount.type}" resolves at trigger time — post-F1 engine work. Use an absolute amount for now.`,
          level,
        },
      };
    }
    const symbol = action.asset.symbol.toUpperCase();
    const decimals = ASSET_DECIMALS[symbol];
    if (decimals === undefined) {
      return {
        error: {
          code: 'unknown_asset_decimals',
          message: `No verified decimals for ${symbol} on ${capability.chain} — supported today: ${Object.keys(ASSET_DECIMALS).join(', ')}.`,
          level,
        },
      };
    }
    let base: string;
    try {
      base = toBaseUnits(action.amount.value, decimals);
    } catch (e) {
      return {
        error: { code: 'invalid_amount', message: `Amount ${action.amount.value} ${symbol}: ${(e as Error).message}.`, level },
      };
    }
    if (base === '0') {
      return { error: { code: 'zero_amount', message: `Amount must be > 0 ${symbol}.`, level } };
    }
    params.amount = base;
  }

  return {
    action: {
      kind,
      protocolId: action.venue?.protocolId,
      positionId: action.venue?.positionId,
      params,
    },
  };
}

/**
 * Compile a validated CMF into AutomationRule payloads for Flare/EVM.
 * All-or-nothing: any step failing returns every error found (the modal shows
 * them; nothing partial gets persisted).
 */
export function translateCmfToEvmRules(
  cmf: CanonicalMoneyFlow,
  opts: { chainId?: number; now?: Date } = {},
): TranslateResult {
  const capability = FLARE_EVM_CAPABILITY;
  const chainId = opts.chainId ?? 14;
  const errors: CmfViolation[] = [...validateCmfInvariants(cmf, opts.now)];
  const rules: EvmRulePayload[] = [];

  for (const step of [...cmf.steps].sort((a, b) => a.level - b.level)) {
    // One AutomationRule per CanonicalStep (§3.1) — multi-action sequencing is
    // the multi-step orchestration work (canonicalRef chains, C.4), not F1.
    if (step.actions.length !== 1) {
      errors.push({
        code: 'multi_action_step',
        message: `Step L${step.level} has ${step.actions.length} actions — the EVM translator takes exactly one per step today; split into levels.`,
        level: step.level,
      });
      continue;
    }

    const t = translateTrigger(step.trigger, capability, step.level);
    if (t.error) {
      errors.push(t.error);
      continue;
    }
    const a = translateAction(step.actions[0], capability, step.level);
    if (a.error) {
      errors.push(a.error);
      continue;
    }

    rules.push({
      chainId,
      name: `${cmf.name} · L${step.level}`.slice(0, 120),
      trigger: t.trigger!,
      action: a.action!,
      cooldownMinutes: cmf.policy.cooldownMinutes,
      maxValueUSD: cmf.policy.maxAmountPerTriggerUsd ?? DEFAULT_MAX_VALUE_USD,
      canonicalRef: cmf.id,
      expiresAt: resolveFlowExpiry(cmf.policy.expiry, opts.now ?? new Date()),
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const notes: string[] = [
    `Execution mode: ${capability.mode} — every trigger prepares an UNSIGNED action; you sign each one in your wallet.`,
    `Enforced expiry: ${rules[0]?.expiresAt ?? 'n/a'} (TTL ≤ ${MAX_TTL_DAYS} days — the engine disables the flow past this moment; renewing is an explicit re-create).`,
  ];

  return { ok: true, chain: capability.chain, mode: capability.mode, rules, notes };
}

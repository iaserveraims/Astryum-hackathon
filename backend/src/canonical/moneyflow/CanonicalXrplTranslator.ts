/**
 * CanonicalXrplTranslator — CMF → AutomationRule payloads (XRPL, M4).
 *
 * The piece that makes the canonical language XRPL-native (plan del mes §3
 * M4, built): one CanonicalStep compiles to ONE AutomationRule the
 * engine ALREADY speaks — the same deterministic, pure, no-I/O shape as the
 * EVM twin. It became buildable the week it was scheduled to be skipped:
 * M1 (`scheduledPayment`), B.1 (`escrow`) and M3 (real `PRICE_DROP_PCT`)
 * built exactly the vocabulary this translator compiles to.
 */

import {
  validateCmfInvariants,
  type CanonicalMoneyFlow,
  type CmfAction,
  type CmfTrigger,
  type CmfViolation,
} from './CanonicalMoneyFlow';
import { XRPL_CAPABILITY, type ChainCapability, type ExecutionMode } from './ChainCapability';
import { resolveFlowExpiry, toBaseUnits } from './CanonicalEvmTranslator';

/** The backend's pseudo chain-id for XRPL rules (rules.ts convention). */
export const XRPL_PSEUDO_CHAIN_ID = 1440002;

const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** XRP is 6 decimals (1 XRP = 1,000,000 drops) — a ledger constant. The only
 *  asset the v1 translator accepts: IOU rails (RLUSD on XRPL…) are post. */
const XRP_DECIMALS = 6;
const MAX_LOCK_DAYS = 365;
const DEFAULT_MAX_VALUE_USD = 10_000;

export interface XrplRulePayload {
  chainId: typeof XRPL_PSEUDO_CHAIN_ID;
  name: string;
  trigger: Record<string, unknown>;
  action: { kind: string; params: Record<string, unknown> };
  cooldownMinutes: number;
  maxValueUSD: number;
  canonicalRef: string;
  expiresAt: string;
}

export type XrplTranslateResult =
  | { ok: true; chain: string; mode: ExecutionMode; rules: XrplRulePayload[]; notes: string[]; errors?: undefined }
  | { ok: false; errors: CmfViolation[]; chain?: undefined; mode?: undefined; rules?: undefined; notes?: undefined };

function translateTrigger(
  trigger: CmfTrigger,
  capability: ChainCapability,
  level: number,
  prices: Record<string, number> | undefined,
): { trigger?: Record<string, unknown>; error?: CmfViolation } {
  if (!capability.triggers.includes(trigger.kind)) {
    return {
      error: {
        code: 'trigger_not_supported',
        message: `Trigger "${trigger.kind}" is not in the ${capability.chain} capability (XRPL has no ${trigger.kind} read today).`,
        level,
      },
    };
  }
  switch (trigger.kind) {
    case 'time':
      // TIME_TRIGGER's 5-field cron subset; parseCron rejects unsupported
      // syntax at evaluation with a readable reason.
      return { trigger: { type: 'TIME_TRIGGER', cron: trigger.cron } };
    case 'idle-balance':
      return {
        trigger: { type: 'IDLE_BALANCE', asset: trigger.asset.symbol.toUpperCase(), minUSD: trigger.minUsd },
      };
    case 'price': {
      if (trigger.comparator !== 'below') {
        return {
          error: {
            code: 'price_above_not_supported',
            message: 'price "above" needs a PRICE_ABOVE evaluator — today only "below" (protection) translates.',
            level,
          },
        };
      }
      const symbol = trigger.asset.symbol.toUpperCase();
      const baseline = prices?.[symbol];
      if (!(typeof baseline === 'number' && baseline > 0)) {
        return {
          error: {
            code: 'price_baseline_unavailable',
            message: `A price floor for ${symbol} needs the LIVE price at translation time to become a drop-from-baseline rule, and it could not be read. Try again in a moment.`,
            level,
          },
        };
      }
      if (trigger.threshold >= baseline) {
        return {
          error: {
            code: 'price_floor_above_market',
            message: `The floor $${trigger.threshold} is at or above the current ${symbol} price $${baseline} — the rule would fire immediately. Pick a floor below the market.`,
            level,
          },
        };
      }
      // floor T with baseline B ⇒ fires when price ≤ B·(1−pct/100) = T.
      const pct = Number((((1 - trigger.threshold / baseline) * 100).toFixed(4)));
      return {
        trigger: { type: 'PRICE_DROP_PCT', asset: symbol, pct, baselineUsd: baseline },
      };
    }
    default:
      return {
        error: { code: 'trigger_not_supported', message: `Trigger "${trigger.kind}" not translatable.`, level },
      };
  }
}

function translateAction(
  action: CmfAction,
  capability: ChainCapability,
  level: number,
  governed: boolean,
): { action?: XrplRulePayload['action']; error?: CmfViolation } {
  if (!capability.verbs.includes(action.verb)) {
    return {
      error: {
        code: 'verb_not_supported',
        message: `Verb "${action.verb}" is not in the ${capability.chain} capability — XRPL compiles 'transfer' (a Payment you sign) and 'supply' (the savings escrow) today.`,
        level,
      },
    };
  }
  const symbol = action.asset.symbol.toUpperCase();
  if (symbol !== 'XRP') {
    return {
      error: {
        code: 'asset_not_supported',
        message: `Only native XRP translates on ${capability.chain} today — ${symbol} (IOU rails) is post-v1.`,
        level,
      },
    };
  }
  if (!action.amount) {
    return { error: { code: 'amount_required', message: `"${action.verb}" needs an amount on XRPL.`, level } };
  }
  if (action.amount.type !== 'absolute') {
    // percent-of-position stays rejected on purpose — the pending §10.8
    // decision (translator vs direct-rule surfaces) resolves who may relax it.
    return {
      error: {
        code: 'amount_type_not_supported',
        message: `Amount type "${action.amount.type}" resolves at trigger time — use an absolute amount of XRP for now.`,
        level,
      },
    };
  }
  let drops: string;
  try {
    drops = toBaseUnits(action.amount.value, XRP_DECIMALS);
  } catch (e) {
    return {
      error: { code: 'invalid_amount', message: `Amount ${action.amount.value} XRP: ${(e as Error).message}.`, level },
    };
  }
  if (drops === '0') {
    return { error: { code: 'zero_amount', message: 'Amount must be > 0 XRP.', level } };
  }
  const venueParams = (action.venue?.params ?? {}) as Record<string, unknown>;

  if (action.verb === 'transfer') {
    const destination = String(venueParams.destination ?? '');
    if (!XRPL_CLASSIC_RE.test(destination)) {
      return {
        error: {
          code: 'destination_required',
          message: 'A transfer needs venue.params.destination (an XRPL r-address).',
          level,
        },
      };
    }
    const memo = typeof venueParams.memo === 'string' && venueParams.memo.trim() ? venueParams.memo.trim() : undefined;
    if (governed) {
      // The council rail: the trigger composes a proposal; the QUORUM signs.
      return {
        action: {
          kind: 'councilPayment',
          params: { destination, amountDrops: drops, ...(memo ? { memo } : {}) },
        },
      };
    }
    const tagRaw = venueParams.destinationTag;
    let destinationTag: number | undefined;
    if (tagRaw !== undefined && tagRaw !== null && tagRaw !== '') {
      const tag = Number(tagRaw);
      if (!Number.isInteger(tag) || tag < 0 || tag > 0xffffffff) {
        return {
          error: { code: 'invalid_destination_tag', message: 'destinationTag must be a whole number (uint32).', level },
        };
      }
      destinationTag = tag;
    }
    return {
      action: {
        kind: 'scheduledPayment',
        params: {
          destination,
          amountDrops: drops,
          ...(memo ? { memo } : {}),
          ...(destinationTag !== undefined ? { destinationTag } : {}),
        },
      },
    };
  }

  // 'supply' — the B.1 savings escrow. Personal-only: the governed programmed
  // transfer is a council ceremony (EscrowCreate signed by the quorum), not a
  // rule kind — refusing here beats compiling a rule no rail serves.
  if (governed) {
    return {
      error: {
        code: 'governed_escrow_not_a_rule',
        message: 'A governed savings escrow is a council ceremony (programmed transfer), not an automation rule — compose it from the Legacy surface.',
        level,
      },
    };
  }
  const lockDays = Number(venueParams.lockDays);
  if (!Number.isInteger(lockDays) || lockDays < 1 || lockDays > MAX_LOCK_DAYS) {
    return {
      error: {
        code: 'lock_days_required',
        message: `The savings escrow needs venue.params.lockDays (1–${MAX_LOCK_DAYS} whole days).`,
        level,
      },
    };
  }
  return { action: { kind: 'escrow', params: { amountDrops: drops, lockDays } } };
}

/**
 * Compile a validated CMF into AutomationRule payloads for XRPL.
 * All-or-nothing, like the EVM twin: any failing step returns every error
 * found; nothing partial gets persisted.
 */
export function translateCmfToXrplRules(
  cmf: CanonicalMoneyFlow,
  opts: { governed?: boolean; prices?: Record<string, number>; now?: Date } = {},
): XrplTranslateResult {
  const capability = XRPL_CAPABILITY;
  const governed = opts.governed === true;
  const errors: CmfViolation[] = [...validateCmfInvariants(cmf, opts.now)];
  const rules: XrplRulePayload[] = [];

  for (const step of [...cmf.steps].sort((a, b) => a.level - b.level)) {
    if (step.actions.length !== 1) {
      errors.push({
        code: 'multi_action_step',
        message: `Step L${step.level} has ${step.actions.length} actions — the XRPL translator takes exactly one per step today; split into levels.`,
        level: step.level,
      });
      continue;
    }
    const t = translateTrigger(step.trigger, capability, step.level, opts.prices);
    if (t.error) {
      errors.push(t.error);
      continue;
    }
    const a = translateAction(step.actions[0], capability, step.level, governed);
    if (a.error) {
      errors.push(a.error);
      continue;
    }
    rules.push({
      chainId: XRPL_PSEUDO_CHAIN_ID,
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
    governed
      ? `Execution mode: ${capability.mode}, governed — every trigger COMPOSES a council proposal; only the quorum's signatures move anything.`
      : `Execution mode: ${capability.mode} — every trigger prepares an UNSIGNED XRPL action; you sign each one in Xaman.`,
    'Nothing composed waits in storage: Payments and escrows are composed FRESH at the signing door (Account pinned to the owning wallet).',
    `Enforced expiry: ${rules[0]?.expiresAt ?? 'n/a'} (TTL ≤ 90 days — the engine disables the flow past this moment; renewing is an explicit re-create).`,
  ];

  return { ok: true, chain: capability.chain, mode: capability.mode, rules, notes };
}

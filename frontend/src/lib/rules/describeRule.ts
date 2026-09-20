'use client';

/**
 * describeRule — the ONE plain-language reading of an automation rule
 * (Fase 3). Three surfaces used to describe the same rule three
 * different ways: the board's hardcoded-English "When LTV > 0.3 → prepare
 * claimRewards" (raw ratio + machine kind, no t()), StrategySection's
 * untranslated summarize(), and MoneyFlowsPanel's own text. One rule, one
 * sentence, both languages, ratios always as %.
 */

const KNOWN_CRONS: Record<string, string> = {
  '0 12 * * *': 'Every day at 12:00 UTC',
  '0 12 * * 1': 'Every Monday at 12:00 UTC',
  '0 12 1 * *': 'On the 1st of each month at 12:00 UTC',
};

export function describeTrigger(
  trigger: Record<string, unknown> | null | undefined,
  t: (s: string) => string,
): string {
  const type = String(trigger?.type ?? '');
  switch (type) {
    case 'HF_BELOW':
      return `${t('If your cushion (health factor) drops below')} ${Number(trigger?.threshold ?? 0).toFixed(2)}`;
    case 'HF_CRITICAL':
      return `${t('If your cushion (health factor) drops below')} 1.20 (${t('critical')})`;
    case 'LTV_ABOVE': {
      const ratio = Number(trigger?.threshold ?? 0);
      if (ratio > 1) return t('invalid threshold — edit and save this rule to fix it');
      return `${t('If the borrowed share goes above')} ${Math.round(ratio * 100)}%`;
    }
    case 'REWARD_THRESHOLD':
      return `${t('When your rewards exceed')} $${trigger?.minUSD ?? 0}`;
    case 'IDLE_BALANCE':
      return `${t('When idle')} ${String(trigger?.asset ?? '')} ${t('exceeds')} $${trigger?.minUSD ?? 0}`;
    case 'TIME_TRIGGER': {
      const cron = String(trigger?.cron ?? '');
      if (KNOWN_CRONS[cron]) return t(KNOWN_CRONS[cron]);
      // Day-of-month rules (M1 recurring payments: `0 12 <d> * *`) — say the
      // day instead of the generic "On a schedule" a family cannot verify.
      const dom = cron.match(/^0 12 (\d{1,2}) \* \*$/);
      if (dom) return `${t('On day')} ${dom[1]} ${t('of each month at 12:00 UTC')}`;
      return t('On a schedule');
    }
    case 'APY_BELOW':
      return `${t('If the rate you are paid drops below')} ${trigger?.thresholdPct ?? 0}%`;
    case 'PRICE_DROP_PCT': {
      const base = Number(trigger?.baselineUsd ?? 0);
      const from = base > 0 ? ` ${t('from')} $${base}` : '';
      return `${t('If the price of')} ${String(trigger?.asset ?? '')} ${t('falls')} ${trigger?.pct ?? 0}%${from}`;
    }
    default:
      return type || t('trigger');
  }
}

const ACTION_PHRASES: Record<string, string> = {
  repay: 'we prepare a repayment for you to sign',
  withdraw: 'we prepare a withdrawal for you to sign',
  supply: 'we prepare a deposit for you to sign',
  claimRewards: 'we prepare the rewards claim for you to sign',
  compound: 'we prepare the reinvestment for you to sign',
  harvest: 'we prepare the harvest for you to sign',
  delegate: 'we prepare the delegation for you to sign',
  escrow: 'we prepare the savings lock for you to sign',
};

export function describeAction(
  action: Record<string, unknown> | null | undefined,
  t: (s: string) => string,
): string {
  const kind = String(action?.kind ?? '');
  if (kind === 'councilPayment') return t('a payment proposal goes to the council to sign');
  if (kind === 'councilOrder') return t('a vault order proposal goes to the council to sign');
  if (kind === 'scheduledPayment') return t('we prepare the payment for you to sign in Xaman');
  if (kind === 'emRepay') return t('we prepare the RLUSD repayment fresh for you to sign on Ethereum');
  if (!kind) return t('you get an alert — nothing is prepared');
  const phrase = ACTION_PHRASES[kind];
  return phrase ? t(phrase) : `${t('we prepare it for you to sign')} (${kind})`;
}

/** The full one-liner: "If your cushion drops below 1.20 → we prepare a repayment…" */
export function describeRule(
  trigger: Record<string, unknown> | null | undefined,
  action: Record<string, unknown> | null | undefined,
  t: (s: string) => string,
): string {
  return `${describeTrigger(trigger, t)} → ${describeAction(action, t)}`;
}

'use client';

/**
 * RuleEditModal — edit an ACTIVE MoneyFlow rule in place (founder 2026-07-25:
 * the card must be editable in every surface, not recreate-only).
 *
 * Edits only the knobs the user owns: the trigger threshold, the fixed repay
 * amount (PROTECT fixed mode) and the cooldown — through the SAME gated
 * PATCH /api/rules/:id the panels already use for pause/delete. For a PROTECT
 * restore rule the trigger threshold IS the action's targetHF (the template
 * writes them equal), so the edit keeps them in sync. Everything else in the
 * rule — wallet binding, action kind, venue, expiry — is deliberately
 * untouched: changing WHAT a rule does is a new rule, not an edit.
 *
 * Vigilance only, as ever: the rule prepares on trigger; the USER signs.
 */

import { useState } from 'react';
import { AlertTriangle, Loader2, Pencil, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { rules as rulesApi, type AutomationRule } from '../../services/v1Api';

const USDT0_DECIMALS = 6;

interface EditableField {
  key: string;
  label: string;
  value: string;
  min?: number;
  step?: number;
  unit?: string;
  /** Write the parsed value back into trigger/action. */
  apply: (n: number, trigger: Record<string, unknown>, action: Record<string, unknown>) => void;
}

/** The editable projection of one rule — null when nothing here is editable. */
function fieldsOf(rule: AutomationRule, t: (s: string) => string): EditableField[] {
  const trigger = (rule.trigger ?? {}) as Record<string, unknown>;
  const action = (rule.action ?? {}) as { kind?: string; params?: Record<string, unknown> };
  const out: EditableField[] = [];

  switch (String(trigger.type ?? '')) {
    case 'HF_BELOW':
      out.push({
        key: 'threshold',
        label: t('Stop-loss Health Factor'),
        value: String(trigger.threshold ?? ''),
        min: 1.01,
        step: 0.05,
        apply: (n, tr, ac) => {
          tr.threshold = n;
          // PROTECT restore keeps targetHF == threshold (template contract).
          const params = (ac.params ?? {}) as Record<string, unknown>;
          if (params.mode === 'restore') params.targetHF = n;
        },
      });
      break;
    case 'LTV_ABOVE':
      out.push({
        key: 'threshold',
        label: `${t('LTV above')} (0–1)`,
        value: String(trigger.threshold ?? ''),
        min: 0.01,
        step: 0.01,
        apply: (n, tr) => {
          tr.threshold = n;
        },
      });
      break;
    case 'REWARD_THRESHOLD':
    case 'IDLE_BALANCE':
      out.push({
        key: 'minUSD',
        label: t('Minimum (USD)'),
        value: String(trigger.minUSD ?? ''),
        min: 0,
        step: 1,
        unit: 'USD',
        apply: (n, tr) => {
          tr.minUSD = n;
        },
      });
      break;
    case 'APY_BELOW':
      out.push({
        key: 'thresholdPct',
        label: t('APY floor (%)'),
        value: String(trigger.thresholdPct ?? ''),
        min: 0.01,
        step: 0.1,
        unit: '%',
        apply: (n, tr) => {
          tr.thresholdPct = n;
        },
      });
      break;
    default:
      break;
  }

  // PROTECT fixed mode: the repay amount is a user knob too.
  const params = (action.params ?? {}) as { mode?: string; amount?: string; pct?: number };
  if (action.kind === 'repay' && params.mode === 'fixed') {
    const human = Number(params.amount ?? '0') / 10 ** USDT0_DECIMALS;
    out.push({
      key: 'repayAmount',
      label: t('Fixed repay amount'),
      value: Number.isFinite(human) ? String(human) : '',
      min: 0.000001,
      step: 0.1,
      unit: 'USDT0',
      apply: (n, _tr, ac) => {
        const p = (ac.params ?? {}) as Record<string, unknown>;
        p.amount = String(BigInt(Math.round(n * 10 ** USDT0_DECIMALS)));
        ac.params = p;
      },
    });
  }
  // Escalonado (mode 'pct'): el % de la deuda VIVA que este escalón repaga.
  if (action.kind === 'repay' && params.mode === 'pct') {
    out.push({
      key: 'repayPct',
      label: t('% of live debt to repay'),
      value: params.pct != null ? String(params.pct) : '',
      min: 0.01,
      step: 5,
      unit: '%',
      apply: (n, _tr, ac) => {
        const p = (ac.params ?? {}) as Record<string, unknown>;
        p.pct = Math.min(100, n);
        ac.params = p;
      },
    });
  }

  return out;
}

export function RuleEditModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: AutomationRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const fields = fieldsOf(rule, t);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [cooldown, setCooldown] = useState(String(rule.cooldownMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    // Deep-ish copies: never mutate the row the list is still rendering.
    const trigger = JSON.parse(JSON.stringify(rule.trigger ?? {})) as Record<string, unknown>;
    const action = JSON.parse(JSON.stringify(rule.action ?? {})) as Record<string, unknown>;
    for (const f of fields) {
      const n = parseFloat(vals[f.key]);
      if (!Number.isFinite(n) || n < (f.min ?? 0)) {
        setError(`${t('Invalid value for')} "${f.label}"`);
        return;
      }
      f.apply(n, trigger, action);
    }
    const cd = Math.round(parseFloat(cooldown));
    if (!Number.isFinite(cd) || cd < 0) {
      setError(`${t('Invalid value for')} "${t('Cooldown')}"`);
      return;
    }
    setBusy(true);
    try {
      await rulesApi.update(rule.id, { trigger, action, cooldownMinutes: cd });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-5 py-4 border-b border-ink/5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-volt/30 bg-volt/10 text-volt">
              <Pencil className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">{t('Edit MoneyFlow')}</h2>
              <p className="text-[11px] text-ink/40 mt-0.5 truncate max-w-[220px]">{rule.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {fields.length === 0 && (
            <p className="text-[11px] text-ink/45">
              {t('This rule has no editable threshold — only its cooldown can change here.')}
            </p>
          )}
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-ink/40 block mb-1.5">
                {f.label}
                {f.unit && <span className="text-ink/30"> · {f.unit}</span>}
              </label>
              <input
                type="number"
                min={f.min}
                step={f.step}
                value={vals[f.key]}
                onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-ink/40 block mb-1.5">
              {t('Cooldown')}
              <span className="text-ink/30"> · min</span>
            </label>
            <input
              type="number"
              min={0}
              step={5}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-tone-danger/25 bg-tone-danger/5 px-3 py-2 text-[11px] text-tone-danger">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2 rounded-xl hover:bg-ink/10 transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2 rounded-xl hover:brightness-95 transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
              {t('Save changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

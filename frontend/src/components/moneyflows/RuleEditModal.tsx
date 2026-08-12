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
import { ModalOverlay } from '@/components/ui/ModalPortal';

const USDT0_DECIMALS = 6;

interface EditableField {
  key: string;
  label: string;
  value: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** One plain-language line under the input — what the number means. */
  hint?: string;
  /** Render as a range slider (percent-style knobs) with the value beside it. */
  slider?: boolean;
  /** Named presets rendered as chips above the input. */
  presets?: Array<{ label: string; value: number }>;
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
        label: t('Alert me when my cushion (health factor) drops below'),
        value: String(trigger.threshold ?? ''),
        min: 1.01,
        max: 3,
        step: 0.05,
        hint: t('1.00 = liquidation. When it fires, we prepare the repayment for YOU to sign.'),
        presets: [
          { label: t('Cautious (1.50)'), value: 1.5 },
          { label: t('Balanced (1.25)'), value: 1.25 },
          { label: t('Tight (1.10)'), value: 1.1 },
        ],
        apply: (n, tr, ac) => {
          tr.threshold = n;
          // PROTECT restore keeps targetHF == threshold (template contract).
          const params = (ac.params ?? {}) as Record<string, unknown>;
          if (params.mode === 'restore') params.targetHF = n;
        },
      });
      break;
    case 'LTV_ABOVE': {
      // The user thinks in %, the wire keeps the 0–1 ratio. Legacy rows saved by
      // the old editor with "30" (meaning 30%) render as the % the user meant,
      // so one Save writes the valid ratio back and revives the dead rule.
      const raw = Number(trigger.threshold ?? 0);
      const pctValue = raw > 1 ? Math.round(raw) : Math.round(raw * 100);
      out.push({
        key: 'threshold',
        label: t('Borrowed share — alert me above'),
        value: pctValue > 0 ? String(Math.min(99, pctValue)) : '',
        min: 1,
        max: 99,
        step: 1,
        unit: '%',
        slider: true,
        hint: t('How much of your borrowing limit you are using. Above 80% liquidation risk is high.'),
        apply: (n, tr) => {
          tr.threshold = n / 100;
        },
      });
      break;
    }
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
      min: 1,
      max: 100,
      step: 1,
      unit: '%',
      slider: true,
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
      const n = parseFloat(String(vals[f.key]).replace(',', '.'));
      if (!Number.isFinite(n) || n < (f.min ?? 0) || (f.max != null && n > f.max)) {
        const range = f.max != null ? `${f.min ?? 0}–${f.max}` : `≥ ${f.min ?? 0}`;
        const unit = f.unit ? ` ${f.unit}` : '';
        setError(
          `${t('Enter a value between')} ${range}${unit}. ${t('You typed')}: ${vals[f.key] || '—'}.`,
        );
        return;
      }
      f.apply(n, trigger, action);
    }
    const cd = Math.round(parseFloat(cooldown));
    if (!Number.isFinite(cd) || cd < 0) {
      setError(`${t('Enter a value between')} 0–10080 min. ${t('You typed')}: ${cooldown || '—'}.`);
      return;
    }
    setBusy(true);
    try {
      await rulesApi.update(rule.id, { trigger, action, cooldownMinutes: cd });
      onSaved();
      onClose();
    } catch (e) {
      console.error('[RuleEditModal] save failed', e);
      setError(t('Could not save the changes. Nothing was modified — try again in a minute.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm my-auto shadow-2xl overflow-hidden">
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
              {String((rule.trigger as Record<string, unknown> | null)?.type ?? '') === 'HF_CRITICAL'
                ? t('This rule watches the fixed critical level (health factor 1.2) — that number cannot change, by design. You can only adjust how often it alerts you.')
                : t('This rule has no editable threshold — only its cooldown can change here.')}
            </p>
          )}
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-ink/40 block mb-1.5">
                {f.label}
                {f.unit && <span className="text-ink/30"> · {f.unit}</span>}
              </label>
              {f.presets && (
                <div className="flex gap-1.5 mb-1.5">
                  {f.presets.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setVals((s) => ({ ...s, [f.key]: String(p.value) }))}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
                        parseFloat(String(vals[f.key]).replace(',', '.')) === p.value
                          ? 'border-volt/50 bg-volt/10 text-volt'
                          : 'border-ink/10 bg-ink/5 text-ink/60 hover:bg-ink/10'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {f.slider ? (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={Number(vals[f.key]) || f.min || 0}
                    onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="flex-1 accent-volt"
                  />
                  <span className="w-14 text-right font-mono text-sm text-ink tabular-nums">
                    {vals[f.key] || '—'}
                    {f.unit === '%' ? ' %' : ''}
                  </span>
                </div>
              ) : (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={vals[f.key]}
                  onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                />
              )}
              {f.hint && <p className="text-[11px] text-ink/40 mt-1">{f.hint}</p>}
            </div>
          ))}
          <div>
            <label className="text-xs text-ink/40 block mb-1.5">
              {t('Minimum wait between alerts')}
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
          <p className="text-[11px] text-ink/45 pt-1">
            {t('Saving moves no money and signs nothing. When the rule fires, we will ask YOU to sign.')}
          </p>
        </div>
      </div>
    </ModalOverlay>
  );
}

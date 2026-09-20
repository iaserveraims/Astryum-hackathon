'use client';

/**
 * CmfReviewModal — the CUSTOM MoneyFlow review step (F1, design doc §4.3).
 *
 * The agent DRAFTS a CanonicalMoneyFlow; nothing persists until the user
 * reviews, edits and confirms HERE — same UX contract as the PROTECT/HARVEST
 * template modal (editable thresholds/amounts/cooldown, honest N1 note).
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, X, Loader2, AlertTriangle, Zap } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { describeAction } from '../../lib/rules/describeRule';
import { describeServerRefusal, type ReadableRefusal } from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
import {
  moneyflows as moneyflowsApi,
  rules as rulesApi,
  cmfRailChainId,
  XRPL_PSEUDO_CHAIN_ID,
  type CanonicalMoneyFlow,
  type CmfStep,
} from '../../services/v1Api';
import { ModalOverlay } from '@/components/ui/ModalPortal';

/** A wallet the flow's rules can bind to: the one that holds the position and
 *  transacts — Smart Account of a linked Xaman / linked EVM wallet on the Flare
 *  rail, or the XRPL account itself ('xrpl') when the flow compiles to XRPL. */
export interface CmfRuleTarget {
  address: string;
  label: string;
  kind: 'smart-account' | 'evm' | 'xrpl';
}

/** XRPL classic address — the XRPL rail may only bind to one of these
 *  (rules.ts creates the rule against this wallet, and the M1 signing door
 *  composes the Payment with Account pinned to it). */
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** Editable projection of one step (string-typed for inputs, like the templates). */
interface StepEdit {
  /** threshold (health-factor/ltv) or minUsd (reward/idle-balance) */
  triggerValue: string;
  /** absolute amount in human units — absent for claim-rewards */
  amountValue?: string;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function triggerLabel(step: CmfStep, t: (s: string) => string): string {
  const tr = step.trigger;
  switch (tr.kind) {
    case 'health-factor':
      return `${t('Alert me when my cushion (health factor) drops below')}`;
    case 'ltv':
      // The person edits a % — the wire keeps the 0–1 ratio (seed case R1.1).
      return `${t('Borrowed share — alert me above')} (%)`;
    case 'reward':
      return `${t('When claimable rewards exceed')} (USD)`;
    case 'idle-balance':
      return `${t('When idle balance exceeds')} (${tr.asset.symbol} · USD)`;
    // G7 — the two XRPL trigger kinds used to fall through to `default` and
    // render the bare kind ("price") over an empty number box: the price FLOOR,
    // the whole point of the protection, was uneditable.
    case 'price':
      return `${t('Protect me if the price falls below')} (${tr.asset.symbol} · USD)`;
    case 'time':
      return t('On this schedule (UTC)');
  }
  // Exhaustive over today's CMF trigger vocabulary (that is WHY tsc narrows the
  // switch to `never` here). A kind added later shows its raw name instead of a
  // silent blank label — the same reason G7 was invisible for a whole build.
  return (step.trigger as { kind: string }).kind;
}

/** The scale, one line under the input — a bare number box was the trap. */
function triggerHint(step: CmfStep, t: (s: string) => string): string | null {
  const kind = step.trigger.kind;
  if (kind === 'health-factor') return t('1.00 = liquidation. When it fires, we prepare the repayment for YOU to sign.');
  if (kind === 'ltv') return t('How much of your borrowing limit you are using. Above 80% liquidation risk is high.');
  // The floor becomes a drop-from-baseline rule using the LIVE price read at
  // activation — say so, and say what happens when that read fails (it blocks
  // activation with its reason; a baseline is never guessed).
  if (kind === 'price') {
    return t('The floor is anchored to the live price when you activate — it must be below today’s price, and if the price cannot be read the flow is not created and we say why.');
  }
  return null;
}

function triggerValueOf(step: CmfStep): string {
  const tr = step.trigger;
  if (tr.kind === 'ltv') {
    // Display in % (legacy out-of-range rows saved as "30" already mean 30%).
    const ratio = Number(tr.threshold);
    return String(ratio > 1 ? Math.round(ratio) : Math.round(ratio * 100));
  }
  if (tr.kind === 'health-factor' || tr.kind === 'price') return String(tr.threshold);
  if (tr.kind === 'reward' || tr.kind === 'idle-balance') return String(tr.minUsd);
  // 'time' has no numeric value — the cron is shown as text, never as a number box.
  return '';
}

function actionSummary(step: CmfStep, t: (s: string) => string): string {
  const a = step.actions[0];
  if (!a) return '';
  const venue = a.venue?.protocolId ? ` · ${a.venue.protocolId}` : '';
  return `${describeAction({ kind: a.verb }, t)} — ${a.asset.symbol}${venue}`;
}

export function CmfReviewModal({
  cmf,
  targets,
  governed = false,
  onClose,
  onCreated,
}: {
  cmf: CanonicalMoneyFlow;
  /** Candidate rule wallets (position holders), Smart Accounts first. May grow
   *  while PAs resolve — the selector follows. */
  targets: CmfRuleTarget[];
  /** XRPL rail only: the active authority is a council, so a 'transfer' must
   *  compile to councilPayment (the trigger composes a proposal, the QUORUM
   *  signs) instead of the personal scheduledPayment. Default false = personal;
   *  either way the rail is NAMED on screen before activation. */
  governed?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(cmf.name);
  const [cooldown, setCooldown] = useState(String(cmf.policy.cooldownMinutes));

  // G7 — the rail the flow itself demands, not a hardcoded 14. It decides which
  // server-side translator compiles the CMF AND which wallets may hold the
  // resulting rules.
  const railChainId = useMemo(() => cmfRailChainId(cmf), [cmf]);
  const isXrplRail = railChainId === XRPL_PSEUDO_CHAIN_ID;
  // An XRPL rule must sit on the XRPL account that pays (r-address); an EVM
  // rule on the 0x wallet that holds the position. Binding across rails does
  // not error — it produces a rule whose prepared transaction nobody can sign.
  const eligibleTargets = useMemo(
    () => targets.filter((x) => XRPL_CLASSIC_RE.test(x.address) === isXrplRail),
    [targets, isXrplRail],
  );

  const [targetAddress, setTargetAddress] = useState(eligibleTargets[0]?.address ?? '');
  // PA resolution is async: adopt the first candidate once it lands. Also drops
  // a selection that stops being eligible (the rail is fixed by the flow).
  useEffect(() => {
    if (eligibleTargets.length === 0) return;
    if (!eligibleTargets.some((x) => x.address === targetAddress)) {
      setTargetAddress(eligibleTargets[0].address);
    }
  }, [eligibleTargets, targetAddress]);
  const [steps, setSteps] = useState<Record<number, StepEdit>>(() =>
    Object.fromEntries(
      cmf.steps.map((s) => [
        s.level,
        {
          triggerValue: triggerValueOf(s),
          amountValue: s.actions[0]?.amount?.type === 'absolute' ? s.actions[0].amount.value : undefined,
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  /**
   * El rechazo del servidor, ENTERO. `serverRefusalText`
   * conservaba la frase y tiraba `headline`, `ways[]` y la puerta:
   * un 403 «no eres miembro probado de este consejo» llegaba sin nada que
   * pulsar. Las validaciones (`errors`) siguen siendo su lista; esto es el otro
   * caso — «el servidor dijo que no» — y se pinta con el mismo cuerpo que la
   * bandeja del consejo.
   */
  const [refusal, setRefusal] = useState<ReadableRefusal | null>(null);

  const setStep = (level: number, patch: Partial<StepEdit>) =>
    setSteps((s) => ({ ...s, [level]: { ...s[level], ...patch } }));

  /** Rebuild the CMF with the user's edits — the server re-validates everything. */
  const editedCmf = useMemo((): CanonicalMoneyFlow => {
    return {
      ...cmf,
      name: name.trim() || cmf.name,
      policy: { ...cmf.policy, cooldownMinutes: Math.round(parseFloat(cooldown) || 0) },
      steps: cmf.steps.map((s) => {
        const edit = steps[s.level];
        const n = parseFloat(String(edit?.triggerValue ?? '').replace(',', '.'));
        const trigger = { ...s.trigger } as CmfStep['trigger'];
        if (Number.isFinite(n)) {
          if (trigger.kind === 'health-factor') trigger.threshold = n;
          // The field shows %, the wire keeps the 0–1 ratio (seed case R1.1).
          if (trigger.kind === 'ltv') trigger.threshold = Math.min(99, Math.max(1, n)) / 100;
          if (trigger.kind === 'reward' || trigger.kind === 'idle-balance') trigger.minUsd = n;
          // G7 — the price FLOOR in USD, edited like any other threshold. The
          // server turns it into the drop-from-baseline rule with a LIVE read.
          if (trigger.kind === 'price') trigger.threshold = n;
        }
        const actions = s.actions.map((a, i) =>
          i === 0 && a.amount?.type === 'absolute' && edit?.amountValue !== undefined
            ? { ...a, amount: { type: 'absolute' as const, value: edit.amountValue } }
            : a,
        );
        return { ...s, trigger, actions };
      }),
    };
  }, [cmf, name, cooldown, steps]);

  async function activate() {
    setErrors([]);
    setRefusal(null);
    // The rule wallet is the position holder — never a fallback to the login
    // address (a rule on a positionless wallet never fires) and never a wallet
    // of the other rail (G7: an XRPL rule on a 0x wallet prepares a Payment
    // whose Account nobody controls).
    const target = eligibleTargets.find((x) => x.address === targetAddress);
    if (!target) {
      setErrors([
        isXrplRail
          ? t('This flow runs on the XRP Ledger: it must bind to the XRPL account that pays (an r-address). Connect that wallet before activating.')
          : t('Link the wallet that holds the position (or connect your Xaman so its Smart Account resolves) before activating.'),
      ]);
      return;
    }
    setBusy(true);
    try {
      // 1. Deterministic dry-run: the server validates + compiles the exact
      //    rules — on the rail THIS flow needs (G7). `governed` only means
      //    anything on the XRPL rail; the EVM translator ignores it.
      const translation = await moneyflowsApi.translate(editedCmf, {
        chainId: railChainId,
        ...(isXrplRail ? { governed } : {}),
      });
      // 2. Create each rule through the EXISTING gated path — one POST per step.
      for (const rule of translation.rules) {
        await rulesApi.create({ walletAddress: target.address, ...rule });
      }
      onCreated();
      onClose();
    } catch (e) {
      const body = (e as { body?: { errors?: Array<{ message?: string }>; issues?: unknown[] } }).body;
      if (body?.errors?.length) {
        setErrors(body.errors.map((x) => x.message ?? '').filter(Boolean));
      } else {
        // The server's `detail` (e.g. why you are not on this council), not the
        // bare code jpost puts in `message`; the code travels in parentheses
        // when there is no prose (lib/errors/serverRefusal). And its
        // `ways` and door with it, not the sentence alone.
        setRefusal(describeServerRefusal(e, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-volt border-volt/30 bg-volt/10">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{t('Custom MoneyFlow')}</h2>
              <p className="text-xs text-ink/40 mt-0.5">{t('Drafted by the assistant. Watching is free and touches nothing — when it fires, we will ask YOU to sign.')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-ink/55 leading-relaxed">{cmf.description}</p>

          <div>
            <label className="text-xs text-ink/40 block mb-2">{t('Flow name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
            />
          </div>

          {/* G7 — the rail is NAMED before activation: which ledger runs this
              flow, and who signs when it fires. It is derived from the flow,
              never guessed by the person. */}
          <div className="bg-surface-2/80 rounded-xl px-3 py-2 text-[11px] text-ink/50 border border-ink/5">
            {isXrplRail
              ? governed
                ? t('Rail: XRP Ledger, governed — every trigger composes a council proposal and only the quorum’s signatures move anything.')
                : t('Rail: XRP Ledger — every trigger nudges you and the transaction is composed fresh at the signing door; you sign it in Xaman.')
              : t('Rail: Flare (EVM) — every trigger prepares an unsigned action for you to sign in your wallet.')}
          </div>

          {/* The wallet every rule binds to — the position holder that transacts,
              never the login address (a rule elsewhere would never fire) and
              never a wallet of the other rail (G7). */}
          <div>
            <label className="text-xs text-ink/40 block mb-2">{t('Rule wallet')}</label>
            {eligibleTargets.length === 0 ? (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3 text-[11px] text-amber-200/80">
                {isXrplRail
                  ? t('No XRPL account available — this flow pays from the XRP Ledger, so it must bind to your XRPL account (an r-address). Connect your Xaman.')
                  : t('No position wallet available — link the wallet that holds the position (or connect your Xaman so its Smart Account resolves).')}
              </div>
            ) : (
              <>
                <select
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                >
                  {eligibleTargets.map((x) => (
                    <option key={x.address} value={x.address}>
                      {x.label} · {shortAddr(x.address)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-ink/35 mt-1">
                  {t('The flow watches this wallet and every prepared action targets it.')}
                </p>
              </>
            )}
          </div>

          {cmf.steps.map((s) => (
            <div key={s.level} className="bg-ink/[0.03] border border-ink/10 rounded-xl px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink/70">
                  {t('Step')} {s.level}
                </span>
                <span className="text-[10px] text-ink/40">{actionSummary(s, t)}</span>
              </div>
              <div>
                <label className="text-xs text-ink/40 block mb-2">{triggerLabel(s, t)}</label>
                {s.trigger.kind === 'time' ? (
                  // A cron is not a number: showing it in a number box gave an
                  // empty field that silently discarded the schedule on edit.
                  // Read-only here — the schedule is the assistant's draft and
                  // the server re-validates it (G7).
                  <div className="px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink/70 text-sm font-mono">
                    {s.trigger.cron}
                  </div>
                ) : (
                  <input
                    type="number"
                    step="any"
                    value={steps[s.level]?.triggerValue ?? ''}
                    onChange={(e) => setStep(s.level, { triggerValue: e.target.value })}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                  />
                )}
                {triggerHint(s, t) && (
                  <p className="text-[11px] text-ink/40 mt-1.5">{triggerHint(s, t)}</p>
                )}
              </div>
              {steps[s.level]?.amountValue !== undefined && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">
                    {t('Amount')}
                    <span className="text-ink/30"> · {s.actions[0]?.asset.symbol}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={steps[s.level]?.amountValue ?? ''}
                    onChange={(e) => setStep(s.level, { amountValue: e.target.value })}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                  />
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="text-xs text-ink/40 block mb-2">
              {t('Cooldown')}
              <span className="text-ink/30"> · min</span>
            </label>
            <input
              type="number"
              min={5}
              step={5}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
            />
          </div>

          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('When it triggers, Astryum prepares the action and asks you to sign. It never signs or executes on its own.')}
          </div>

          {errors.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {errors.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
              </div>
            </div>
          )}
          {refusal && (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <ServerRefusalBody refusal={refusal} t={t} />
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              onClick={activate}
              disabled={busy || eligibleTargets.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {t('Turn on the watch (nothing is signed now)')}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

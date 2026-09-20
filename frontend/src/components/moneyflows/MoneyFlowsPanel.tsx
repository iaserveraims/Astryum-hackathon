'use client';

/**
 * MoneyFlowsPanel — the ONE MoneyFlows surface, shared by both authorities
 * (decisión fundador 2026-07-18: el MISMO sistema para Personal y Legacy).
 *
 * Same brain everywhere (CMF → AutomationRules → engine tick → trigger); the
 * mode only changes WHO signs when a rule fires:
 *  - 'personal': the trigger prepares the exact unsigned action and pushes —
 *    the OWNER signs it in their wallet. Nothing moves without that signature.
 *  - 'governed': the trigger composes a PROPOSAL into the council inbox — the
 *    QUORUM signs it there. The rule holds zero authority by construction.
 *
 * COPY IS LOAD-BEARING (blacklist §4): always "vigilada sin discreción,
 * preparada al dispararse, firmada por ti / por el quórum, con caducidad" —
 * never "automatización sin firmar". Expiry is ENFORCED server-side (≤90d);
 * this panel shows it and offers the instant owner-side revocation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Hourglass, Loader2, Pause, Pencil, Play, ShieldCheck, Trash2, Waves } from 'lucide-react';
import { Card, MicroLabel, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { moneyflows as moneyflowsApi, rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { RuleEditModal } from './RuleEditModal';
import { describeAction, describeTrigger } from '../../lib/rules/describeRule';
import {
  RULE_PILL_TONE,
  UNREAD,
  loadRunHealth,
  retainKnownRuns,
  rulePillState,
  worstPillState,
  type RunHealth as LastRun,
} from '../../lib/rules/runHealth';

export type MoneyFlowsMode = 'personal' | 'governed';

interface Flow {
  canonicalRef: string;
  name: string;
  enabled: boolean;
  rules: AutomationRule[];
  /** wallet address the flow was fetched for (revocation is scoped to it). */
  address: string;
}

/** Loose rules (no canonicalRef): PROTECT/HARVEST templates + council rules. */
interface LooseRule extends AutomationRule {
  address: string;
}

/**
 * G4 (auditoría 2026-08-17) — «watching» que no vigila.
 *
 * WHAT WAS FAILING IN SILENCE: when a rule fires, the engine records an
 * AutomationRun (backend/src/engines/automation/AutomationEngine.ts). If the
 * ACTION could not be composed — a `councilOrder` on a Legacy with no cage
 * (`NoCageForLegacy`), `NOT_A_COUNCIL`, `council_compose_failed`,
 * `scheduled_payment_invalid` — the run is stored with `status: 'error'` and
 * the reason in `notes`, and then, by design (the "éxito no ganado" guard),
 * `totalTimesTriggered` is NOT incremented and NO push is sent. Correct on the
 * engine side, catastrophic on this surface: with no counter and no push, a
 * rule that failed EVERY SINGLE fire rendered exactly like a healthy one —
 * green "active" pill, "expires in 87d" — so a family believed they were
 * protected by a rule that had never once produced anything to sign.
 *
 * The run history was already there: GET /rules/:id/runs (backend/src/routes/
 * rules.ts) returns status + notes, newest first. This panel READS it — one
 * read per mount/refresh, no polling — and says what the ledger of runs says.
 * If the read itself fails we SAY so; we never infer health from silence, and
 * we never paint green over a status we could not read.
 *
 * G4-strategies (round 2): the reducer and the loader now live in ONE place,
 * lib/rules/runHealth.ts. This file used to carry a literal copy of them (as
 * did LegacyActivityFeed and DefiPositionsBoard) — three copies of the same
 * verdict is three chances for two surfaces to disagree about the same rule.
 */

function runAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The failure line. Loud on `failed`, honest on `unreadable`, silent otherwise
 * (a healthy rule already speaks through "fired ×N" and its expiry).
 *
 * G4-pildoras (round 3) — `enabled` arrived because this note never looked at
 * it: a PAUSED rule with an old failed run claimed «this rule is armed» beside
 * a Resume button. The failure still shows (it happened); the tense follows the
 * rule's actual state.
 */
function LastRunNote({ run, enabled, t }: { run: LastRun; enabled: boolean; t: (s: string) => string }) {
  if (run.state === 'failed') {
    return (
      <div className="rounded-md border border-red-500/25 bg-red-500/[0.06] px-2 py-1.5 text-[11px] text-red-200/90">
        <div className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-[1px] shrink-0" />
          <div className="min-w-0">
            {/* Whole sentences, never assembled fragments — the translator
                needs the full clause, and so does the reader. */}
            <p className="font-medium">
              {enabled
                ? t('Its last run FAILED — this rule is armed but it produced nothing to sign.')
                : t('Its last run FAILED before it was paused — it produced nothing to sign.')}
            </p>
            <p className="mt-0.5 text-red-200/70">
              {runAt(run.at)}
              {run.note ? ` · ${run.note}` : ` · ${t('the engine recorded no reason')}`}
            </p>
            {run.consecutive > 1 && (
              <p className="mt-0.5 text-red-200/70">
                {t('Consecutive failed runs:')} {run.consecutive}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (run.state === 'unreadable') {
    return (
      <p className="text-[11px] text-amber-300/70">
        {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
        {run.detail ? ` (${run.detail})` : ''}
      </p>
    );
  }
  return null;
}

// One rule, one sentence — the shared reader (lib/rules/describeRule) speaks
// for triggers everywhere; the council payment keeps its amount+destination
// detail because that is the fact a family checks.
function triggerText(trigger: Record<string, unknown>, t: (s: string) => string): string {
  return describeTrigger(trigger, t);
}

function actionText(action: Record<string, unknown>, t: (s: string) => string): string {
  const kind = String(action?.kind ?? '');
  // Both payment kinds keep their amount+destination detail because that is
  // the fact an owner (or a family) checks — the phrase alone hides the money.
  if (kind === 'councilPayment' || kind === 'scheduledPayment') {
    const p = (action.params ?? {}) as Record<string, unknown>;
    const xrp = Number(p.amountDrops ?? 0) / 1_000_000;
    const dst = String(p.destination ?? '');
    const verb = kind === 'councilPayment' ? t('propose payment of') : t('prepare payment of');
    return `${verb} ${xrp} XRP → ${dst.slice(0, 6)}…${dst.slice(-4)}`;
  }
  const proto = action.protocolId ? ` · ${action.protocolId}` : '';
  return `${describeAction(action, t)}${proto}`;
}

function expiryText(expiresAt: string | null | undefined, t: (s: string) => string): { label: string; expired: boolean } {
  if (!expiresAt) return { label: t('no expiry (legacy rule)'), expired: false };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return { label: t('no expiry (legacy rule)'), expired: false };
  if (ms <= 0) return { label: t('expired'), expired: true };
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return { label: `${t('expires in')} ${days}d`, expired: false };
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return { label: `${t('expires in')} ${hours}h`, expired: false };
}

export default function MoneyFlowsPanel({
  addresses,
  mode,
  title,
  onChanged,
}: {
  /** Wallets whose flows/rules this panel manages (Personal: linked wallets; Governed: the council account). */
  addresses: string[];
  mode: MoneyFlowsMode;
  title?: string;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loose, setLoose] = useState<LooseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  // In-place edit (founder 2026-07-25): threshold/amount/cooldown, PATCH-gated.
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  // G4 — last run per rule id, READ from GET /rules/:id/runs. `unread` until
  // the read lands; the seq guard drops the answer of a superseded refresh so a
  // slow read can never repaint a stale verdict over a fresh list.
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const runsSeq = useRef(0);

  const key = useMemo(() => addresses.filter(Boolean).join(','), [addresses]);

  /**
   * G4 — one read per rule, per mount/refresh. NOT a poll: run history only
   * changes on an engine tick, and a rule that failed stays failed until the
   * owner fixes it, so hammering the endpoint would buy nothing. Every rule
   * gets an entry, including the ones whose read failed: an absent entry would
   * be indistinguishable from "healthy", which is the bug this closes.
   */
  const loadRuns = useCallback(async (ruleIds: string[], seq: number) => {
    const next = await loadRunHealth(ruleIds, (id) => rulesApi.runs(id));
    if (seq !== runsSeq.current) return;
    setLastRuns(next);
  }, []);

  const refresh = useCallback(async () => {
    const addrs = key.split(',').filter(Boolean);
    if (addrs.length === 0) {
      setFlows([]);
      setLoose([]);
      setLastRuns({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const perAddress = await Promise.all(
        addrs.map(async (address) => {
          const [flowsRes, rulesRes] = await Promise.all([
            moneyflowsApi.list(address).catch(() => ({ count: 0, flows: [] as Flow[] })),
            rulesApi.list(address).catch(() => ({ count: 0, rules: [] as AutomationRule[] })),
          ]);
          return {
            flows: (flowsRes.flows ?? []).map((f) => ({ ...f, address })),
            loose: (rulesRes.rules ?? [])
              .filter((r) => !r.canonicalRef)
              .map((r) => ({ ...r, address })),
          };
        }),
      );
      const nextFlows = perAddress.flatMap((x) => x.flows);
      const nextLoose = perAddress.flatMap((x) => x.loose);
      setFlows(nextFlows);
      setLoose(nextLoose);
      // G4 — the run history is read AFTER the list is on screen (fire and
      // forget): a slow /runs must never delay the rules themselves. Until it
      // lands every rule reads as `unread`, which prints nothing.
      const ruleIds = [
        ...nextFlows.flatMap((f) => f.rules.map((r) => r.id)),
        ...nextLoose.map((r) => r.id),
      ];
      const seq = ++runsSeq.current;
      // G4-strategies — do NOT wipe the map here. `setLastRuns({})` sent every
      // rule back to `unread` for the whole round-trip, so a rule already known
      // to be FAILING flashed back to the green «active» pill on every refresh
      // — the reassurance this front exists to remove, reintroduced once per
      // reload. Hold the verdicts we already read for the rules still present.
      setLastRuns((prev) => retainKnownRuns(prev, ruleIds));
      void loadRuns(ruleIds, seq);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [key, loadRuns]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(k: string, fn: () => Promise<unknown>) {
    setBusyKey(k);
    setError('');
    try {
      await fn();
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  const governed = mode === 'governed';
  const empty = flows.length === 0 && loose.length === 0;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Waves size={16} className="text-ink/50" />
        <MicroLabel>{title ?? t('MoneyFlows')}</MicroLabel>
        <Pill tone="neutral">{governed ? t('quorum signs') : t('you sign')}</Pill>
      </div>

      <p className="text-[12px] text-ink/55">
        {governed
          ? t(
              'A governed MoneyFlow is a rule that watches without discretion and, when it fires, COMPOSES a proposal into the council inbox — only the quorum signature moves anything. It always expires (90 days at most) and any councillor can pause it instantly.',
            )
          : t(
              'A MoneyFlow is a rule signed off by you: it watches without discretion and, when it fires, prepares the exact action for YOU to sign in your wallet. It always expires (90 days at most) and you can pause or delete it instantly.',
            )}
      </p>

      {error && <p className="text-[12px] text-red-400/90">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-ink/45">
          <Loader2 size={13} className="animate-spin" /> {t('Loading rules…')}
        </div>
      ) : empty ? (
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
          <p className="text-sm text-ink/70">{t('No active rules')}</p>
          <p className="mt-1 text-[12px] text-ink/45">
            {governed
              ? t('Create the first governed rule below — it will only ever compose proposals for the quorum.')
              : t('Create one from a position (Protect/Harvest) or ask the strategy agent to compose a MoneyFlow.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flows.map((f) => {
            const exp = expiryText(f.rules[0]?.expiresAt, t);
            const anyEnabled = f.rules.some((r) => r.enabled);
            const k = `flow:${f.canonicalRef}`;
            // G4 — an enabled flow whose last fire errored is NOT "active": the
            // green pill was the lie the family read as protection.
            // G4-pildoras (round 3) — and a flow whose runs we have NOT READ is
            // not "active" either: `isFailing` is false for `unread` and for
            // `unreadable`, so both fell into the green arm and a /runs timeout
            // returned a failing flow to green. The worst verdict among its
            // rules wins, and «I do not know yet» outranks «active».
            const pill = worstPillState(f.rules.map((r) => rulePillState(r.enabled, lastRuns[r.id])));
            return (
              <div key={k} className="rounded-lg border border-ink/[0.08] bg-ink/[0.02] p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={13} className="shrink-0 text-ink/40" />
                  <span className="text-sm text-ink/80 truncate">{f.name}</span>
                  <Pill tone={RULE_PILL_TONE[pill]}>
                    {pill === 'paused'
                      ? t('paused')
                      : pill === 'failing'
                        ? t('failing')
                        : pill === 'unreadable'
                          ? t('unknown')
                          : pill === 'unread'
                            ? t('checking…')
                            : t('active')}
                  </Pill>
                  <span className={`ml-auto flex items-center gap-1 text-[11px] ${exp.expired ? 'text-amber-400/80' : 'text-ink/40'}`}>
                    <Hourglass size={11} /> {exp.label}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {f.rules.map((r) => (
                    <li key={r.id} className="space-y-1 text-[12px] text-ink/50">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate">
                          {triggerText(r.trigger, t)} → {actionText(r.action, t)}
                          {r.totalTimesTriggered > 0 && (
                            <span className="text-ink/30"> · {t('fired')} ×{r.totalTimesTriggered}</span>
                          )}
                        </span>
                        <button
                          onClick={() => setEditRule(r)}
                          title={t('Edit')}
                          className="shrink-0 rounded p-0.5 text-ink/30 hover:text-ink/70 transition-colors"
                        >
                          <Pencil size={11} />
                        </button>
                      </span>
                      <LastRunNote run={lastRuns[r.id] ?? UNREAD} enabled={r.enabled} t={t} />
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 pt-1">
                  {anyEnabled ? (
                    <button
                      onClick={() => act(k, () => moneyflowsApi.pauseFlow(f.canonicalRef, f.address))}
                      disabled={busyKey === k}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08]"
                    >
                      <Pause size={12} /> {t('Pause')}
                    </button>
                  ) : (
                    <button
                      onClick={() => act(k, () => moneyflowsApi.resumeFlow(f.canonicalRef, f.address))}
                      disabled={busyKey === k || exp.expired}
                      title={exp.expired ? t('Expired — create it again to renew (the 90-day clamp re-runs)') : undefined}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08] disabled:opacity-40"
                    >
                      <Play size={12} /> {t('Resume')}
                    </button>
                  )}
                  <button
                    onClick={() => act(k, () => moneyflowsApi.deleteFlow(f.canonicalRef, f.address))}
                    disabled={busyKey === k}
                    className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-red-300/70 hover:bg-red-500/10"
                  >
                    <Trash2 size={12} /> {t('Delete')}
                  </button>
                  {busyKey === k && <Loader2 size={13} className="animate-spin text-ink/40" />}
                </div>
              </div>
            );
          })}

          {loose.map((r) => {
            const exp = expiryText(r.expiresAt, t);
            const k = `rule:${r.id}`;
            // G4 — the council rules (councilOrder / councilPayment) live HERE:
            // they carry no canonicalRef, so this is the card that used to say
            // "active / expires in 87d" for a rule failing every single fire.
            const lastRun = lastRuns[r.id] ?? UNREAD;
            // G4-pildoras (round 3) — `state === 'failed'` alone left `unread`
            // and `unreadable` in the green arm: a council rule read as
            // «active» before its first run was read, and went back to green
            // whenever /runs broke.
            const pill = rulePillState(r.enabled, lastRun);
            return (
              <div key={k} className="rounded-lg border border-ink/[0.08] bg-ink/[0.02] p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={13} className="shrink-0 text-ink/40" />
                  <span className="text-sm text-ink/80 truncate">{r.name}</span>
                  <Pill tone={RULE_PILL_TONE[pill]}>
                    {pill === 'paused'
                      ? t('paused')
                      : pill === 'failing'
                        ? t('failing')
                        : pill === 'unreadable'
                          ? t('unknown')
                          : pill === 'unread'
                            ? t('checking…')
                            : t('active')}
                  </Pill>
                  <span className={`ml-auto flex items-center gap-1 text-[11px] ${exp.expired ? 'text-amber-400/80' : 'text-ink/40'}`}>
                    <Hourglass size={11} /> {exp.label}
                  </span>
                </div>
                <p className="text-[12px] text-ink/50">
                  {triggerText(r.trigger, t)} → {actionText(r.action, t)}
                  {r.totalTimesTriggered > 0 && <span className="text-ink/30"> · {t('fired')} ×{r.totalTimesTriggered}</span>}
                </p>
                <LastRunNote run={lastRun} enabled={r.enabled} t={t} />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setEditRule(r)}
                    disabled={busyKey === k}
                    className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08]"
                  >
                    <Pencil size={12} /> {t('Edit')}
                  </button>
                  {r.enabled ? (
                    <button
                      onClick={() => act(k, () => rulesApi.disable(r.id))}
                      disabled={busyKey === k}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08]"
                    >
                      <Pause size={12} /> {t('Pause')}
                    </button>
                  ) : (
                    <button
                      onClick={() => act(k, () => rulesApi.enable(r.id))}
                      disabled={busyKey === k || exp.expired}
                      title={exp.expired ? t('Expired — create it again to renew (the 90-day clamp re-runs)') : undefined}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08] disabled:opacity-40"
                    >
                      <Play size={12} /> {t('Resume')}
                    </button>
                  )}
                  <button
                    onClick={() => act(k, () => rulesApi.delete(r.id))}
                    disabled={busyKey === k}
                    className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-red-300/70 hover:bg-red-500/10"
                  >
                    <Trash2 size={12} /> {t('Delete')}
                  </button>
                  {busyKey === k && <Loader2 size={13} className="animate-spin text-ink/40" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editRule && (
        <RuleEditModal
          rule={editRule}
          onClose={() => setEditRule(null)}
          onSaved={() => {
            void refresh();
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}

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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hourglass, Loader2, Pause, Pencil, Play, ShieldCheck, Trash2, Waves } from 'lucide-react';
import { Card, MicroLabel, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { moneyflows as moneyflowsApi, rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { RuleEditModal } from './RuleEditModal';

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

function triggerText(trigger: Record<string, unknown>, t: (s: string) => string): string {
  const type = String(trigger?.type ?? '');
  switch (type) {
    case 'HF_BELOW':
      return `${t('HF below')} ${trigger.threshold}`;
    case 'HF_CRITICAL':
      return `${t('HF below')} 1.2 (${t('critical')})`;
    case 'LTV_ABOVE':
      return `${t('LTV above')} ${Number(trigger.threshold) * 100}%`;
    case 'REWARD_THRESHOLD':
      return `${t('rewards over')} $${trigger.minUSD}`;
    case 'IDLE_BALANCE':
      return `${t('idle')} ${trigger.asset} > $${trigger.minUSD}`;
    case 'TIME_TRIGGER':
      return `${t('on schedule')} (${trigger.cron} UTC)`;
    default:
      return type || t('trigger');
  }
}

function actionText(action: Record<string, unknown>, t: (s: string) => string): string {
  const kind = String(action?.kind ?? '');
  if (kind === 'councilPayment') {
    const p = (action.params ?? {}) as Record<string, unknown>;
    const xrp = Number(p.amountDrops ?? 0) / 1_000_000;
    return `${t('propose payment of')} ${xrp} XRP → ${String(p.destination ?? '').slice(0, 10)}…`;
  }
  if (kind === 'councilOrder') {
    const p = (action.params ?? {}) as Record<string, unknown>;
    return `${t('propose vault order')}: ${String(p.orderAction ?? '')}`;
  }
  const proto = action.protocolId ? ` · ${action.protocolId}` : '';
  return `${t('prepare')} ${kind}${proto}`;
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

  const key = useMemo(() => addresses.filter(Boolean).join(','), [addresses]);

  const refresh = useCallback(async () => {
    const addrs = key.split(',').filter(Boolean);
    if (addrs.length === 0) {
      setFlows([]);
      setLoose([]);
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
      setFlows(perAddress.flatMap((x) => x.flows));
      setLoose(perAddress.flatMap((x) => x.loose));
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

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
            return (
              <div key={k} className="rounded-lg border border-ink/[0.08] bg-ink/[0.02] p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={13} className="shrink-0 text-ink/40" />
                  <span className="text-sm text-ink/80 truncate">{f.name}</span>
                  <Pill tone={anyEnabled ? 'success' : 'neutral'}>{anyEnabled ? t('active') : t('paused')}</Pill>
                  <span className={`ml-auto flex items-center gap-1 text-[11px] ${exp.expired ? 'text-amber-400/80' : 'text-ink/40'}`}>
                    <Hourglass size={11} /> {exp.label}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {f.rules.map((r) => (
                    <li key={r.id} className="flex items-center gap-1.5 text-[12px] text-ink/50">
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
            return (
              <div key={k} className="rounded-lg border border-ink/[0.08] bg-ink/[0.02] p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={13} className="shrink-0 text-ink/40" />
                  <span className="text-sm text-ink/80 truncate">{r.name}</span>
                  <Pill tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? t('active') : t('paused')}</Pill>
                  <span className={`ml-auto flex items-center gap-1 text-[11px] ${exp.expired ? 'text-amber-400/80' : 'text-ink/40'}`}>
                    <Hourglass size={11} /> {exp.label}
                  </span>
                </div>
                <p className="text-[12px] text-ink/50">
                  {triggerText(r.trigger, t)} → {actionText(r.action, t)}
                  {r.totalTimesTriggered > 0 && <span className="text-ink/30"> · {t('fired')} ×{r.totalTimesTriggered}</span>}
                </p>
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

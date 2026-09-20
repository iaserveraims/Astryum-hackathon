'use client';

/**
 * StrategySection — the "Strategy · MoneyFlows" apartado (founder 2026-07-20).
 *
 * Peer of the Positions apartado in My strategies: where MoneyFlows are
 * COMPOSED and managed as cards. A MoneyFlow is an AutomationRule — it watches
 * without discretion and, when it fires, PREPARES the exact on-chain action for
 * YOU to sign (Astryum never signs — CLAUDE.md §0 / invariants #1, #7).
 *
 * The artifact is a card grid, same language as the position tiles:
 *   - Online  → the ACTIVE MoneyFlows (enabled rules).
 *   - Offline → the SAVED ones (paused rules + agent/manual drafts).
 *   - A first "＋" card opens the builder modal (Manual or with the AI agent).
 *
 * Savings/escrow rules are excluded here — they live in the savings surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Loader2,
  Power,
  Trash2,
  Workflow,
  ShieldCheck,
  Sprout,
  Bot,
  SlidersHorizontal,
  X,
  Play,
  Pencil,
  Waves,
  AlertTriangle,
} from 'lucide-react';
import { Card, MicroLabel, Pill, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { listDrafts, deleteDraft, type StrategyDraft } from '../../lib/strategyDrafts';
import ManualStrategyBuilder from '../earn/ManualStrategyBuilder';
import { StrategyLLMChat } from '../earn/StrategyLLMChat';
import type { LaunchStrategy } from '../earn/StrategyAgent';
import { RuleEditModal } from '../moneyflows/RuleEditModal';
import { describeRule } from '../../lib/rules/describeRule';
import {
  RULE_PILL_TONE,
  UNREAD,
  loadRunHealth,
  retainKnownRuns,
  rulePillState,
  type RunHealth,
} from '../../lib/rules/runHealth';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { AstryumLoader } from '../ui/AstryumLoader';

/** A rule that moves savings (escrow), not a DeFi MoneyFlow — kept out here. */
function isEscrowRule(r: AutomationRule): boolean {
  return ((r.action ?? {}) as { kind?: string }).kind === 'escrow';
}

/** One plain-language line: what watches → what it prepares — from the ONE
 *  shared reader (lib/rules/describeRule), so every surface says it the same. */
function summarize(r: AutomationRule, t: (s: string) => string): string {
  const action = (r.action ?? {}) as { protocolId?: string };
  const proto = action.protocolId ? ` · ${action.protocolId}` : '';
  return `${describeRule(r.trigger as Record<string, unknown>, r.action as Record<string, unknown>, t)}${proto}`;
}

/**
 * G4-strategies (auditoria 2026-08-17 [G4]) — la superficie que faltaba.
 *
 * WHAT WAS FAILING IN SILENCE HERE: this apartado IS the automations surface of
 * /app/strategies. The position board is mounted on that page with
 * `showStrategyPanel={false}`, so the embedded MoneyFlows panel that round 1
 * made honest never renders there — these cards are what the user reads. And
 * they decided a rule's state from `r.enabled` alone:
 * `<Pill tone={r.enabled ? 'success' : 'neutral'}>`.
 *
 * A PROTECT / HARVEST / councilOrder rule that errors on EVERY fire keeps
 * `enabled: true`, sends no push and never increments `totalTimesTriggered`
 * (the «exito no ganado» guard in AutomationEngine stores the run with
 * `status: 'error'` and the reason in `notes`, and stops). So it rendered here
 * as a green «active» card, indistinguishable from one that works: the page
 * dedicated to automations was the one lying hardest.
 *
 * Fixed with the SAME reducer and the SAME sentences as MoneyFlowsPanel,
 * LegacyActivityFeed and DefiPositionsBoard — lib/rules/runHealth.ts. One read
 * per rule per mount/refresh, never a poll: run history only changes on an
 * engine tick and a broken rule stays broken until someone repairs it. If the
 * read itself fails we SAY so; «I could not read it» is never «it works».
 */

/** The rules this section RENDERS, in one place: refresh reads the run history
 *  for exactly this set, so the cards and the reads can never drift apart. */
function visibleFlows(all: AutomationRule[], mode: 'online' | 'offline'): AutomationRule[] {
  return all.filter((r) => !isEscrowRule(r)).filter((r) => (mode === 'online' ? r.enabled : !r.enabled));
}

/**
 * The failure line inside a MoneyFlow card. Loud on `failed`, honest on
 * `unreadable`, silent otherwise — a healthy rule already speaks through its
 * card. Same wording (and the same i18n keys) as every other surface.
 *
 * G4-pildoras (round 3) — `enabled` arrived because this note was rendered
 * without ever looking at it, and the OFFLINE tab of this very section lists
 * paused rules ONLY: a paused rule with an old failed run claimed «this rule is
 * armed» right under a pill reading «paused». Two sentences from the same card
 * contradicting each other is the same disease as the green pill, with the sign
 * flipped. The failure is still shown — it happened — in the past tense.
 */
function RunHealthNote({
  health,
  enabled,
  t,
}: {
  health: RunHealth;
  enabled: boolean;
  t: (s: string) => string;
}) {
  if (health.state === 'failed') {
    return (
      <div className="mt-2 rounded-md border border-red-500/25 bg-red-500/[0.06] px-2 py-1.5 text-[10px] leading-relaxed text-red-200/90">
        <span className="flex items-start gap-1.5">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0">
            <span className="font-medium">
              {enabled
                ? t('Its last run FAILED — this rule is armed but it produced nothing to sign.')
                : t('Its last run FAILED before it was paused — it produced nothing to sign.')}
            </span>
            <span className="mt-0.5 block text-red-200/70">
              {health.note ?? t('the engine recorded no reason')}
              {health.consecutive > 1 ? ` · ${t('Consecutive failed runs:')} ${health.consecutive}` : ''}
            </span>
          </span>
        </span>
      </div>
    );
  }
  if (health.state === 'unreadable') {
    return (
      <p className="mt-2 text-[10px] leading-relaxed text-amber-300/70" title={health.detail}>
        {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
      </p>
    );
  }
  return null;
}

/** The mark for a rule: custom MoneyFlow (assistant) vs the two templates. */
function ruleIcon(r: AutomationRule) {
  if (r.canonicalRef) return <Workflow className="w-4 h-4" />;
  const type = ((r.trigger ?? {}) as { type?: string }).type;
  if (type === 'HF_BELOW' || type === 'HF_CRITICAL') return <ShieldCheck className="w-4 h-4" />;
  return <Sprout className="w-4 h-4" />;
}

/* ------------------------------------------------------------------ */
/* BUILDER MODAL — compose a MoneyFlow: Manual or with the AI agent     */
/* ------------------------------------------------------------------ */

export function MoneyFlowBuilderModal({
  onClose,
  onLaunch,
}: {
  onClose: () => void;
  /** Run the composed strategy through the SAME prepare→review→sign rail. */
  onLaunch: LaunchStrategy;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<'ai' | 'manual'>('ai');

  // Launching goes through the tested prepare→sign modal; then we close.
  const launchAndClose: LaunchStrategy = (kind, initial) => {
    onLaunch(kind, initial);
    onClose();
  };

  return (
    <ModalOverlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-ink/5 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-volt/30 bg-volt/10 text-volt">
              <Waves className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">{t('New MoneyFlow')}</h2>
              <p className="text-[11px] text-ink/40">{t('Compose it manually or with the AI agent — you always sign.')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 transition-colors hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Manual / AI chooser — the same two builders Earn's Create door uses. */}
        <div className="flex gap-1 border-b border-ink/5 px-6 pt-3">
          {([
            ['ai', <Bot key="i" className="h-4 w-4" />, t('With AI')],
            ['manual', <SlidersHorizontal key="i" className="h-4 w-4" />, t('Manual')],
          ] as const).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`inline-flex items-center gap-2 rounded-t-lg px-3 py-2 text-[13px] font-medium transition ${
                tab === id ? 'border-b-2 border-volt text-ink' : 'text-ink/45 hover:text-ink/80'
              }`}
            >
              <span className={tab === id ? 'text-volt' : 'text-ink/40'}>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto px-5 py-5 scrollbar-thin">
          {tab === 'ai' ? (
            <StrategyLLMChat onLaunch={launchAndClose} />
          ) : (
            <ManualStrategyBuilder onLaunch={launchAndClose} />
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* THE APARTADO                                                         */
/* ------------------------------------------------------------------ */

export default function StrategySection({
  mode,
  addresses,
  identity,
  onLaunch,
  onChanged,
}: {
  /** 'online' = active MoneyFlows · 'offline' = paused rules + saved drafts. */
  mode: 'online' | 'offline';
  /** Wallets whose rules this section manages (linked wallets). */
  addresses: string[];
  /** Draft namespace (profile identity) — offline drafts are read from here. */
  identity: string;
  /** Run a strategy/draft through the prepare→review→sign rail. */
  onLaunch: LaunchStrategy;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const [allRules, setAllRules] = useState<AutomationRule[]>([]);
  const [drafts, setDrafts] = useState<StrategyDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  // In-place edit (founder 2026-07-25) — same modal as the MoneyFlows panel.
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  // G4-strategies — last run per rule id, READ from GET /rules/:id/runs. Every
  // rule rendered gets an entry, INCLUDING the ones whose read failed: an
  // absent entry is indistinguishable from "healthy", which is the bug this
  // closes. The seq guard drops the answer of a superseded refresh so a slow
  // read can never repaint a stale verdict over a fresh list.
  const [runHealth, setRunHealth] = useState<Record<string, RunHealth>>({});
  const runsSeq = useRef(0);

  const key = useMemo(() => addresses.filter(Boolean).join(','), [addresses]);

  const refresh = useCallback(async () => {
    const addrs = key.split(',').filter(Boolean);
    setDrafts(mode === 'offline' ? listDrafts(identity) : []);
    if (addrs.length === 0) {
      setAllRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const per = await Promise.all(
        addrs.map((a) => rulesApi.list(a).then((r) => r.rules ?? []).catch(() => [] as AutomationRule[])),
      );
      // De-dup by id across wallets.
      const next = [...new Map(per.flat().map((r) => [r.id, r])).values()];
      setAllRules(next);
      // G4-strategies — the run history is read AFTER the cards are on screen
      // (fire and forget): a slow /runs must never delay the rules themselves.
      // Until it lands a rule reads as `unread`, which prints nothing. We do
      // NOT wipe the map first: that flashed a rule already known to be failing
      // back to the green "active" pill once per refresh.
      const ruleIds = visibleFlows(next, mode).map((r) => r.id);
      const seq = ++runsSeq.current;
      setRunHealth((prev) => retainKnownRuns(prev, ruleIds));
      void (async () => {
        const health = await loadRunHealth(ruleIds, (id) => rulesApi.runs(id));
        if (seq !== runsSeq.current) return;
        setRunHealth(health);
      })();
    } finally {
      setLoading(false);
    }
  }, [key, identity, mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flows = useMemo(() => visibleFlows(allRules, mode), [allRules, mode]);

  const bumped = () => {
    void refresh();
    onChanged?.();
  };

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      bumped();
    } finally {
      setBusyId(null);
    }
  }

  const removeDraft = (d: StrategyDraft) => {
    deleteDraft(identity, d.id);
    setDrafts(listDrafts(identity));
  };

  const empty = flows.length === 0 && drafts.length === 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Waves className="h-4 w-4 text-ink/50" strokeWidth={1.6} />
        <MicroLabel>{t('Strategy · MoneyFlows')}</MicroLabel>
        <Pill tone="neutral">{mode === 'online' ? t('active') : t('saved')}</Pill>
      </div>
      <p className="text-xs text-ink/45">
        {t(
          'A MoneyFlow watches without discretion; when it fires it prepares the exact on-chain action for YOU to sign. Configure triggers over your DeFi positions. It always expires (90 days at most) and you can pause or delete it instantly — Astryum never signs or executes.',
        )}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* ＋ card — opens the Manual / AI builder modal. Always first. */}
        <button
          type="button"
          onClick={() => setBuilding(true)}
          className="group flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-volt/30 bg-volt/[0.04] p-4 text-center transition-colors hover:border-volt/60 hover:bg-volt/[0.08]"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-volt/30 bg-volt/10 text-volt transition-transform group-hover:scale-105">
            <Plus className="h-5 w-5" strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-ink">{t('New MoneyFlow')}</span>
          <span className="text-[11px] text-ink/45">{t('Manual or with AI')}</span>
        </button>

        {loading && flows.length === 0 && drafts.length === 0 ? (
          <div className="flex min-h-[150px] items-center justify-center rounded-2xl border border-ink/[0.08] bg-ink/[0.02] sm:col-span-1">
            {/* La espera de sección lleva el cometa (regla en AstryumLoader). */}
            <AstryumLoader size={40} label={t('Loading rules…')} />
          </div>
        ) : null}

        {/* MoneyFlow cards (rules) */}
        {flows.map((r) => {
          // G4-strategies — an enabled rule whose LAST fire errored is not
          // "active": it is armed and preparing nothing. The green pill on
          // `r.enabled` alone was the reassurance that hid it, on the very page
          // dedicated to automations.
          // G4-pildoras (round 3) — and neither is a rule we have not READ yet:
          // `isFailing` is false for `unread`/`unreadable`, so both fell into
          // the green arm. A /runs timeout returned a FAILING rule to «active».
          // The verdict now picks its own tone (lib/rules/runHealth).
          const health = runHealth[r.id] ?? UNREAD;
          const pill = rulePillState(r.enabled, health);
          return (
          <Card key={r.id} padded={false} className="flex min-h-[150px] flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                  r.canonicalRef ? 'border-volt/30 bg-volt/10 text-volt' : 'border-ink/10 bg-ink/5 text-ink/70'
                }`}
              >
                {ruleIcon(r)}
              </span>
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
            </div>
            <div className="mt-3 min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{r.name}</div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink/50">{summarize(r, t)}</p>
              <RunHealthNote health={health} enabled={r.enabled} t={t} />
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <button
                onClick={() => act(r.id, () => (r.enabled ? rulesApi.disable(r.id) : rulesApi.enable(r.id)))}
                disabled={busyId === r.id}
                title={r.enabled ? t('Pause') : t('Resume')}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink/10 bg-ink/5 px-2 py-1.5 text-[11px] text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-40"
              >
                {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                {r.enabled ? t('Pause') : t('Resume')}
              </button>
              <button
                onClick={() => setEditRule(r)}
                disabled={busyId === r.id}
                title={t('Edit')}
                className="rounded-lg border border-ink/10 bg-ink/5 p-1.5 text-ink/50 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => act(r.id, () => rulesApi.delete(r.id))}
                disabled={busyId === r.id}
                title={t('Delete')}
                className="rounded-lg border border-ink/10 bg-ink/5 p-1.5 text-ink/50 transition-colors hover:bg-tone-danger/10 hover:text-tone-danger disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </Card>
          );
        })}

        {/* Saved drafts (offline only) — agent/manual, re-runnable. */}
        {drafts.map((d) => (
          <Card key={d.id} padded={false} className="flex min-h-[150px] flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink/10 bg-ink/5 text-ink/70">
                <Workflow className="h-4 w-4" />
              </span>
              <Pill tone="neutral">{d.kind === 'custom' ? t('draft') : d.kind.toUpperCase()}</Pill>
            </div>
            <div className="mt-3 min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{d.name}</div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink/50">{d.prompt}</p>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {/* Compact scale of the same PrimaryButton recipe (className
                  overrides its padding/size — the primitive accepts it).
                  PrimaryButton has no `title` prop, so the tooltip wraps it. */}
              <span
                className="flex-1"
                title={d.kind === 'custom' ? t('Custom drafts can’t run in the beta') : t('Run')}
              >
                <PrimaryButton
                  onClick={() =>
                    onLaunch(d.kind === 'custom' ? 'e1' : d.kind, {
                      amount: d.amount,
                      ratio: d.ratio,
                      targetHF: d.targetHF,
                    })
                  }
                  disabled={d.kind === 'custom'}
                  className="w-full !gap-1.5 !rounded-lg !px-2 !py-1.5 !text-[11px] !font-medium !shadow-none"
                >
                  <Play className="h-3.5 w-3.5" /> {t('Run')}
                </PrimaryButton>
              </span>
              <button
                onClick={() => removeDraft(d)}
                title={t('Delete')}
                className="rounded-lg border border-ink/10 bg-ink/5 p-1.5 text-ink/50 transition-colors hover:bg-tone-danger/10 hover:text-tone-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </Card>
        ))}

        {!loading && empty && (
          <div className="flex min-h-[150px] items-center justify-center rounded-2xl border border-ink/[0.06] bg-ink/[0.02] p-4 text-center text-[12px] text-ink/40 sm:col-span-2 lg:col-span-2">
            {mode === 'online'
              ? t('No active MoneyFlows yet — compose one with the ＋ card, or add Protect/Harvest from a position.')
              : t('No saved MoneyFlows — draft one with the ＋ card and it will wait here until you run it.')}
          </div>
        )}
      </div>

      {building && <MoneyFlowBuilderModal onClose={() => setBuilding(false)} onLaunch={onLaunch} />}
      {editRule && (
        <RuleEditModal rule={editRule} onClose={() => setEditRule(null)} onSaved={bumped} />
      )}
    </section>
  );
}

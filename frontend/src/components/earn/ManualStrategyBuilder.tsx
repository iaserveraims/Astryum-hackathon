'use client';

/**
 * ManualStrategyBuilder — the "Create Manually" door of Earn.
 *
 * The do-it-yourself counterpart of the agent: the SAME strategy parameters
 * the agent compiles (asset, amount, borrow ratio, protection HF), composed by
 * hand, plus the MoneyFlow tools. A composed strategy is saved as a draft
 * (lib/strategyDrafts — device-local, per identity) and surfaces in
 * Estrategias · Guardadas Offline, the registry of every manual and
 * agent-created strategy.
 *
 * Honesty (invariant #9): parameters that map to a live rail (E1 FXRP→Kinetic,
 * E2 FLR→FTSO) can Run through the same prepare→review→sign modal as the
 * ready-made packs; anything else is saved as Custom and says plainly that the
 * beta can't execute it yet. MoneyFlows (Protect · Harvest) attach to a LIVE
 * position, so the tool card points at Estrategias · Funcionando. Astryum
 * never signs, never executes.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Play, Save, ShieldCheck, Sprout, Workflow } from 'lucide-react';
import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { profileIdentity } from '../../lib/profileStore';
import { saveDraft } from '../../lib/strategyDrafts';
import { inferDraftKind, type LaunchStrategy } from './StrategyAgent';

const field =
  'w-full px-3.5 py-2.5 bg-ink/5 border border-ink/10 rounded-xl text-ink text-xs placeholder-ink/30 focus:outline-none focus:border-volt/50';

export default function ManualStrategyBuilder({ onLaunch }: { onLaunch: LaunchStrategy }) {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const identity = profileIdentity(user) ?? 'anon';

  const [name, setName] = useState('');
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [ratio, setRatio] = useState('');
  const [targetHF, setTargetHF] = useState('');
  const [notes, setNotes] = useState('');
  // Set after the first save so re-saving updates the SAME draft (upsert by
  // id) instead of stacking near-duplicates in the registry.
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState('');

  const kind = inferDraftKind(asset);
  const railLabel =
    kind === 'e1'
      ? 'FXRP → Kinetic · Xaman'
      : kind === 'e2'
        ? 'FLR → FTSO · EVM'
        : t('Custom · beta — not executable yet');

  const save = (): boolean => {
    setError('');
    if (!name.trim() && !asset.trim() && !amount.trim()) {
      setError(t('Give the strategy at least a name, an asset or an amount.'));
      return false;
    }
    const stored = saveDraft(identity, {
      id: draftId,
      name: name.trim() || `${amount.trim() || '?'} ${asset.trim().toUpperCase() || '—'}`,
      kind,
      asset: asset.trim().toUpperCase() || undefined,
      amount: amount.trim() || undefined,
      ratio: ratio.trim() || undefined,
      targetHF: targetHF.trim() || undefined,
      // The user's own wording, kept verbatim — same slot the agent chat uses.
      prompt: notes.trim(),
    });
    setDraftId(stored.id);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 2500);
    return true;
  };

  const saveAndRun = () => {
    if (!save()) return;
    if (kind === 'e1' || kind === 'e2') {
      onLaunch(kind, {
        amount: amount.trim() || undefined,
        ratio: ratio.trim() || undefined,
        targetHF: targetHF.trim() || undefined,
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-5 items-start">
      {/* ── The composer — the same parameters the agent compiles, by hand ── */}
      <Card spotlight padded={false} className="p-6">
        <MicroLabel>{t('Do it yourself')}</MicroLabel>
        <h2 className="text-lg font-semibold tracking-tight text-ink mt-2">{t('Create Manually')}</h2>
        <p className="text-sm text-ink/50 leading-relaxed mt-1.5 mb-5">
          {t('Compose the strategy with your own parameters. It is saved to your registry in Estrategias · Saved, editable and ready to run when it maps to a live rail.')}
        </p>

        <div className="space-y-3.5">
          <div>
            <label className="text-[11px] text-ink/40 block mb-1.5">{t('Name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('e.g. 25 XRP — protected carry')}
              className={field}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-ink/40 block mb-1.5">{t('Asset')}</label>
              <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="XRP / FLR…" className={field} />
            </div>
            <div>
              <label className="text-[11px] text-ink/40 block mb-1.5">{t('Amount')}</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-ink/40 block mb-1.5">{t('Borrow ratio')}</label>
              <input value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="0.30" className={field} />
            </div>
            <div>
              <label className="text-[11px] text-ink/40 block mb-1.5">{t('Stop-loss HF')}</label>
              <input value={targetHF} onChange={(e) => setTargetHF(e.target.value)} placeholder="1.10" className={field} />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-ink/40 block mb-1.5">{t('Notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t('What this strategy is for, in your own words — kept with the card.')}
              className={`${field} resize-none`}
            />
          </div>

          {/* Where these parameters land, stated before any button is pressed. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-3.5 py-2.5">
            <span className="text-[11px] text-ink/45">{t('Maps to')}</span>
            <span className={`text-[11px] font-medium ${kind === 'custom' ? 'text-ink/55' : 'text-emerald-300'}`}>
              {railLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-volt text-volt-ink text-xs font-medium hover:brightness-95 transition-all"
            >
              {savedTick ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {savedTick ? t('Saved') : t('Save strategy')}
            </button>
            {(kind === 'e1' || kind === 'e2') && (
              <button
                onClick={saveAndRun}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-ink/15 bg-ink/[0.05] text-ink/80 text-xs font-medium hover:bg-ink/10 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> {t('Save and run')}
              </button>
            )}
          </div>
          {error && <p className="text-[11px] text-amber-300">{error}</p>}
          {savedTick && (
            <p className="text-[11px] text-emerald-300">
              {t('Saved to your registry.')}{' '}
              <Link href="/app/strategies?view=offline" className="underline hover:text-emerald-200">
                {t('View it in Estrategias · Saved')}
              </Link>
            </p>
          )}
          <p className="text-[10px] text-ink/30 leading-relaxed">
            {t('Running opens the same review — nothing moves until you sign in your own wallet.')}
          </p>
        </div>
      </Card>

      {/* ── The tools rail — what you build WITH, honestly scoped ── */}
      <aside className="space-y-4">
        <Card spotlight padded={false} className="p-5">
          <MicroLabel>{t('Tools')}</MicroLabel>
          <ul className="mt-3 space-y-2.5">
            <li className="rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-3.5 py-3">
              <div className="flex items-center gap-2">
                <Workflow className="w-3.5 h-3.5 text-volt/80" strokeWidth={1.6} />
                <span className="text-[13px] font-medium text-ink">{t('MoneyFlows')}</span>
              </div>
              <p className="text-[11px] text-ink/45 mt-1 leading-relaxed">
                {t('Protect (repay when HF drops) and Harvest (claim when rewards accrue) attach to a live position.')}
              </p>
              <Link
                href="/app/strategies?view=online"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-volt hover:text-volt/80 transition-colors"
              >
                {t('Open a running strategy to add one')} <ArrowRight className="w-3 h-3" />
              </Link>
            </li>
            <li className="rounded-xl border border-ink/[0.07] bg-ink/[0.02] px-3.5 py-3">
              <div className="flex items-center gap-2">
                <Sprout className="w-3.5 h-3.5 text-emerald-300/80" strokeWidth={1.6} />
                <span className="text-[13px] font-medium text-ink">{t('Live rails')}</span>
              </div>
              <p className="text-[11px] text-ink/45 mt-1 leading-relaxed">
                {t('XRP/FXRP maps to the Kinetic vault rail; FLR/WFLR to the FTSO delegation rail. Anything else stays a saved draft for now.')}
              </p>
            </li>
          </ul>
        </Card>

        <Card spotlight padded={false} className="p-5">
          <MicroLabel>{t('How it works')}</MicroLabel>
          <ol className="mt-3 space-y-3">
            {[
              t('Set the parameters yourself — no agent in the loop.'),
              t('The strategy is saved to your registry in Estrategias.'),
              t('You review every figure and sign in your own wallet.'),
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 shrink-0 grid place-items-center rounded-full border border-volt/25 bg-volt/[0.08] text-volt font-mono text-[10px]">
                  {i + 1}
                </span>
                <span className="text-xs text-ink/55 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 pt-3 border-t border-ink/[0.06] text-[10px] text-ink/35 leading-relaxed flex items-start gap-1.5">
            <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
            {t('Astryum builds unsigned payloads only — it never signs, never custodies, never executes.')}
          </p>
        </Card>
      </aside>
    </div>
  );
}

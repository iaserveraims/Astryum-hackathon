'use client';

/**
 * RunsPanel — a run is one recording: one council XRPL account (→ one pote),
 * one omnibus, its clients and its receipts. "New take" = a new council
 * account; the old runs stay listed with their receipts. Says out loud that a
 * passkey is bound to the domain it was created on.
 */

import { useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { demoApi, describeRefusal, omnibusOwnerUnknownStep, shortHash, type DemoPolicy } from '../../lib/demo-exchange/api';
import type { DemoRunApi } from '../../lib/demo-exchange/useDemoRun';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function RunsPanel({ demo }: { demo: DemoRunApi }) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [council, setCouncil] = useState('');
  const [omnibus, setOmnibus] = useState('');
  const [registry, setRegistry] = useState('');
  const [policy, setPolicy] = useState<DemoPolicy>('A');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setErr('');
    if (!XRPL_RE.test(council.trim())) return setErr(t('The council XRPL address is not valid'));
    if (!XRPL_RE.test(omnibus.trim())) return setErr(t('The omnibus XRPL address is not valid'));
    if (registry.trim() && !EVM_RE.test(registry.trim())) return setErr(t('The registry address is not a valid 0x address'));
    setBusy(true);
    const r = await demoApi.createRun({ label: label.trim() || undefined, councilAddress: council.trim(), omnibusAddress: omnibus.trim(), policy, registryAddress: registry.trim() || undefined });
    setBusy(false);
    if (!r.ok) {
      // Ni el código crudo ni la prosa del servidor — y el paso
      // que resuelve OMNIBUS_OWNER_UNKNOWN, que aquí tampoco se decía.
      const step = omnibusOwnerUnknownStep(r.refusal, t);
      return setErr(step ? `${describeRefusal(r.refusal, t)} ${step}` : describeRefusal(r.refusal, t));
    }
    await demo.refreshRuns();
    await demo.loadRun(r.data.run.runId);
    void demo.refreshChain();
    setLabel('');
    setCouncil('');
  }

  async function remove(runId: string) {
    if (!window.confirm(t('Delete this run and its receipts? The chain keeps its own record.'))) return;
    await demoApi.deleteRun(runId);
    await demo.refreshRuns();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink">{t('New take')}</h3>
        <p className="text-xs text-ink/60">
          {t('One run = one council XRPL account (it births ONE pote) + one omnibus account (where clients deposit with a tag). Single-signature accounts are fine for a take. The council anchors its constitution and creates the pote in the Exchange tab.')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink/60">
            {t('Take name')}
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('e.g. take 4 — custodial')} className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-ink/60">
            {t('Policy')}
            <select value={policy} onChange={(e) => setPolicy(e.target.value as DemoPolicy)} className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink">
              <option value="A">{t('A — conservative, immediate exit')}</option>
              <option value="B">{t('B — yield, 72h cooldown')}</option>
            </select>
          </label>
          <label className="text-xs text-ink/60">
            {t('Council XRPL account (the exchange authority)')}
            <input value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
          </label>
          <label className="text-xs text-ink/60">
            {t('Omnibus XRPL account (clients deposit here, with a tag)')}
            <input value={omnibus} onChange={(e) => setOmnibus(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
          </label>
          <label className="text-xs text-ink/60 sm:col-span-2">
            {t('KYC registry on Flare (optional — read from the pote gate if empty)')}
            <input value={registry} onChange={(e) => setRegistry(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
          </label>
        </div>
        {err ? <p className="text-xs text-danger">{err}</p> : null}
        <button onClick={create} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
          {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {t('Create the run')}
        </button>
        <p className="text-[11px] text-ink/40">
          {t('Passkeys are bound to the domain they were created on: record every take from the same URL.')}
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{t('Runs')}</h3>
          <button onClick={() => void demo.refreshRuns()} className="text-[11px] text-ink/50 hover:text-ink inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> {t('Refresh')}
          </button>
        </div>
        {demo.runs.length === 0 ? <p className="text-xs text-ink/50">{t('No runs yet.')}</p> : null}
        {demo.runs.map((r) => {
          const active = demo.run?.runId === r.runId;
          return (
            <div key={r.runId} className={`rounded-xl border p-3 flex flex-wrap items-center gap-3 ${active ? 'border-volt' : 'border-ink/10'} bg-surface-1`}>
              <button onClick={() => void demo.loadRun(r.runId).then(() => demo.refreshChain())} className="text-left flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">
                  #{r.seq} · {r.label} <span className="text-xs text-ink/50">· {t('policy')} {r.policy}</span>
                </div>
                <div className="text-[11px] text-ink/50 font-mono">
                  {t('council')} {shortHash(r.councilAddress, 6, 4)} · {t('omnibus')} {shortHash(r.omnibusAddress, 6, 4)} · {t('pote')} {r.poteAddress ? shortHash(r.poteAddress, 6, 4) : t('not born yet')}
                </div>
                <div className="text-[11px] text-ink/50">
                  {r.clients} {t('clients')} · {r.receipts} {t('receipts')} · {new Date(r.createdAt).toLocaleString()}
                </div>
              </button>
              <button onClick={() => remove(r.runId)} className="text-ink/40 hover:text-danger" title={t('Delete run')}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

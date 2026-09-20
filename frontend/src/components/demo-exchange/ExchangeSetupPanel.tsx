'use client';

/**
 * ExchangeSetupPanel — the exchange's own profile in the operator console:
 * which XRPL account governs (the council), which one receives deposits (the
 * omnibus), which policy its pote follows, and whether it carries an on-chain
 * registry. Product copy — an exchange, not a "take". The data model beneath is
 * the same `run` the backend keeps: one exchange = one council = one pote.
 *
 * Several exchanges can exist (multi-tenant); the operator picks which one it
 * is operating. Clients never see this screen.
 */

import { useState } from 'react';
import { Building2, Plus, RefreshCw, Archive } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { demoApi, describeRefusal, omnibusOwnerUnknownStep, refusalIsRetryable, shortHash, type DemoPolicy } from '../../lib/demo-exchange/api';
import type { DemoRunApi } from '../../lib/demo-exchange/useDemoRun';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function ExchangeSetupPanel({ demo }: { demo: DemoRunApi }) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [council, setCouncil] = useState('');
  const [omnibus, setOmnibus] = useState('');
  const [registry, setRegistry] = useState('');
  const [policy, setPolicy] = useState<DemoPolicy>('A');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // it. 19 (R5 copy): «no pude leerlo» sobre un alta no es un callejón — nada se
  // creó, así que la pantalla ofrece repetir la misma llamada tal cual.
  const [errRetryable, setErrRetryable] = useState(false);
  /** it. 23 (3.3): la negativa que no se repite, pero que sí tiene un paso. */
  const [errStep, setErrStep] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function create() {
    setErr('');
    setErrRetryable(false);
    setErrStep(null);
    if (!label.trim()) return setErr(t('Give the exchange a name'));
    if (!XRPL_RE.test(council.trim())) return setErr(t('The council XRPL address is not valid'));
    if (!XRPL_RE.test(omnibus.trim())) return setErr(t('The omnibus XRPL address is not valid'));
    if (registry.trim() && !EVM_RE.test(registry.trim())) return setErr(t('The registry address is not a valid 0x address'));
    setBusy(true);
    const r = await demoApi.createRun({ label: label.trim(), councilAddress: council.trim(), omnibusAddress: omnibus.trim(), policy, registryAddress: registry.trim() || undefined });
    setBusy(false);
    // Nunca el código crudo ni la prosa del servidor: la frase es NUESTRA
    // (describeRefusal), y solo cae al detalle del servidor si no la tenemos.
    if (!r.ok) {
      setErrRetryable(refusalIsRetryable(r.refusal));
      // it. 23 (3.3): OMNIBUS_OWNER_UNKNOWN no se arregla repitiendo, pero SÍ
      // tiene un paso — y sin decirlo tapiaba al fundador que entró por la
      // puerta de admin (que prueba el despliegue, no de quién es la cuenta).
      setErrStep(omnibusOwnerUnknownStep(r.refusal, t));
      return setErr(describeRefusal(r.refusal, t));
    }
    await demo.refreshRuns();
    await demo.loadRun(r.data.run.runId);
    void demo.refreshChain();
    setCreating(false);
    setLabel('');
    setCouncil('');
    setOmnibus('');
    setRegistry('');
  }

  /** it. 33 (7): the close can be refused (RUN_HAS_LIVE_WORK, a read of ours); the founder pressed «close» and saw nothing. Said, per profile. */
  const [archiveErr, setArchiveErr] = useState<{ runId: string; text: string } | null>(null);

  async function archive(runId: string) {
    if (!window.confirm(t('Close this exchange profile? Its ledger stays readable; the chain keeps its own record.'))) return;
    setArchiveErr(null);
    const r = await demoApi.patchRun(runId, { status: 'closed' });
    if (!r.ok) {
      setArchiveErr({ runId, text: describeRefusal(r.refusal, t) });
      return;
    }
    await demo.refreshRuns();
    if (demo.run?.runId === runId) demo.setRun(r.data.run);
  }

  const run = demo.run;

  return (
    <div className="space-y-6">
      {run ? (
        <section className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" style={{ color: 'var(--authority, #A76A15)' }} />
            <h3 className="text-sm font-semibold text-ink">{run.label}</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink/50">{t('policy')} {run.policy} · {run.status === 'open' ? t('operating') : t('closed')}</span>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-ink/50">{t('Council (governs the pote, signs every order)')}</dt>
              <dd className="font-mono break-all text-ink">{run.councilAddress}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-ink/50">{t('Omnibus (clients deposit here, with their tag)')}</dt>
              <dd className="font-mono break-all text-ink">{run.omnibusAddress}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-ink/50">{t('Pote (the cage on Flare)')}</dt>
              <dd className="font-mono break-all text-ink">{run.poteAddress ?? t('not born yet')}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-ink/50">{t('On-chain registry (optional)')}</dt>
              <dd className="font-mono break-all text-ink">{run.registryAddress ?? t('none — entry is gated by the exchange itself')}</dd>
            </div>
          </dl>
          <div className="text-[11px] text-ink/50">{run.clients.length} {t('clients')} · {run.receipts.length} {t('receipts')} · {t('since')} {new Date(run.createdAt).toLocaleDateString()}</div>
        </section>
      ) : (
        <p className="text-xs text-ink/50">{t('No exchange profile selected.')}</p>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{t('Exchange profiles')}</h3>
          <div className="flex items-center gap-3">
            <button onClick={() => void demo.refreshRuns()} className="text-[11px] text-ink/50 hover:text-ink inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> {t('Refresh')}</button>
            <button onClick={() => setCreating((v) => !v)} className="text-[11px] text-volt inline-flex items-center gap-1"><Plus className="w-3 h-3" /> {t('New exchange profile')}</button>
          </div>
        </div>
        {demo.runs.map((r) => {
          const active = demo.run?.runId === r.runId;
          return (
            <div key={r.runId} className={`rounded-xl border p-3 flex flex-wrap items-center gap-3 ${active ? 'border-volt' : 'border-ink/10'} bg-surface-1`}>
              <button onClick={() => void demo.loadRun(r.runId).then(() => demo.refreshChain())} className="text-left flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">{r.label} <span className="text-xs text-ink/50">· {t('policy')} {r.policy}{r.status === 'closed' ? ` · ${t('closed')}` : ''}</span></div>
                <div className="text-[11px] text-ink/50 font-mono">{t('council')} {shortHash(r.councilAddress, 6, 4)} · {t('omnibus')} {shortHash(r.omnibusAddress, 6, 4)} · {t('pote')} {r.poteAddress ? shortHash(r.poteAddress, 6, 4) : t('not born yet')} · {r.clients} {t('clients')}</div>
              </button>
              {r.status === 'open' ? (
                <button onClick={() => archive(r.runId)} className="text-ink/40 hover:text-danger" title={t('Close profile')}><Archive className="w-4 h-4" /></button>
              ) : null}
              {archiveErr?.runId === r.runId ? <p data-testid="setup-panel-archive-error" className="basis-full text-xs text-danger">{archiveErr.text}</p> : null}
            </div>
          );
        })}
        {demo.runs.length === 0 ? <p className="text-xs text-ink/50">{t('No exchange profiles yet.')}</p> : null}
      </section>

      {creating ? (
        <section className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-ink">{t('New exchange profile')}</h3>
          <p className="text-xs text-ink/60">{t('One exchange = one council XRPL account (it governs ONE pote) + one omnibus account (where clients deposit with a tag). The council anchors its constitution and births the pote in Operate.')}</p>
          {/* it. 16 (R5 5.1): decir aquí lo que la declaración hace — antes el
              servidor exigía que la cuenta estuviera ya en una variable de
              entorno y el alta moría sin que esta pantalla dijera nada. */}
          <p className="text-[11px] text-ink/45">{t('The omnibus you name here becomes this exchange\'s declared cash desk: only this desk prepares transactions against it, and a stranger\'s request on that account is refused. Its key never reaches Astryum.')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-ink/60">{t('Exchange name')}<input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" /></label>
            <label className="text-xs text-ink/60">{t('Policy')}
              <select value={policy} onChange={(e) => setPolicy(e.target.value as DemoPolicy)} className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink">
                <option value="A">{t('A — conservative, immediate exit')}</option>
                <option value="B">{t('B — yield, 72h cooldown')}</option>
              </select>
            </label>
            <label className="text-xs text-ink/60">{t('Council XRPL account (the exchange authority)')}<input value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" /></label>
            <label className="text-xs text-ink/60">{t('Omnibus XRPL account (clients deposit here, with a tag)')}<input value={omnibus} onChange={(e) => setOmnibus(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" /></label>
            <label className="text-xs text-ink/60 sm:col-span-2">{t('KYC registry on Flare (optional — read from the pote gate if empty)')}<input value={registry} onChange={(e) => setRegistry(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" /></label>
          </div>
          {err ? (
            <div className="space-y-1">
              <p data-testid="setup-panel-error" className="text-xs text-danger">{err}</p>
              {errStep ? <p data-testid="setup-panel-error-step" className="text-[11px] text-ink/60">{errStep}</p> : null}
              {errRetryable ? (
                <button type="button" onClick={() => void create()} disabled={busy} className="text-[11px] text-volt underline disabled:opacity-50">
                  {t('Try again')}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button onClick={create} disabled={busy} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {t('Create the exchange profile')}</button>
            <button onClick={() => setCreating(false)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

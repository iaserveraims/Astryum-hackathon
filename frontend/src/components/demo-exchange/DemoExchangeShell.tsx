'use client';

/**
 * DemoExchangeShell — the five tabs of the Demo Exchange v2 and the header that
 * says, every time, what is simulated and what is real. Owns the run hook so
 * every tab reads the same run, the same chain facts and the same receipts.
 */

import { useState } from 'react';
import { Building2, Eye, ListChecks, ScanFace, Layers } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useDemoRun } from '../../lib/demo-exchange/useDemoRun';
import { shortHash } from '../../lib/demo-exchange/api';
import { RunsPanel } from './RunsPanel';
import { ExchangeDesk } from './ExchangeDesk';
import { ClientApp } from './ClientApp';
import { CurtainGraph } from './CurtainGraph';
import { EvidencePanel } from './EvidencePanel';

type Tab = 'exchange' | 'user' | 'curtain' | 'evidence' | 'runs';

export function DemoExchangeShell() {
  const { t } = useT();
  // El panel de operaciones de los fundadores ve todos los exchanges del despliegue.
  const demo = useDemoRun({ allRuns: true });
  const [tab, setTab] = useState<Tab>(demo.run ? 'exchange' : 'runs');
  // While a desk door is in flight the desk keeps its state (it never unmounts)
  // and the other tabs wait.
  const [deskBlocked, setDeskBlocked] = useState(false);
  const run = demo.run;

  const tabs: Array<[Tab, string, typeof Building2]> = [
    ['exchange', t('Exchange'), Building2],
    ['user', t('User'), ScanFace],
    ['curtain', t('Behind the curtain'), Eye],
    ['evidence', t('Evidence'), ListChecks],
    ['runs', t('Runs'), Layers],
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-ink">{t('Demo Exchange')}</h1>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-tone-warning">
            {t('simulated exchange · real chain')}
          </span>
        </div>
        <p className="text-xs text-ink/60 max-w-3xl">
          {t('The exchange system on this page — client accounts, tags, the internal ledger — is simulated and labelled so. Everything that touches capital is real on Flare and XRPL mainnet and leaves a receipt you can read from the chain. Astryum plays the operator; no exchange uses this yet.')}
        </p>
        {run ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink/60 font-mono">
            <span><span className="text-ink/40">{t('run')}</span> #{run.seq} {run.label}</span>
            <span><span className="text-ink/40">{t('council')}</span> {shortHash(run.councilAddress, 8, 4)}</span>
            <span><span className="text-ink/40">{t('omnibus')}</span> {shortHash(run.omnibusAddress, 8, 4)}</span>
            <span><span className="text-ink/40">{t('pote')}</span> {run.poteAddress ? shortHash(run.poteAddress, 8, 4) : t('not born yet')}</span>
            <span><span className="text-ink/40">{t('policy')}</span> {run.policy}</span>
          </div>
        ) : (
          <p className="text-[11px] text-ink/50">{t('No run selected — create one in Runs.')}</p>
        )}
        {demo.error ? <p className="text-xs text-danger">{demo.error}</p> : null}
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map(([key, label, Icon]) => {
          const locked = deskBlocked && key !== 'exchange';
          return (
            <button
              key={key}
              disabled={locked}
              onClick={() => { if (!locked) setTab(key); }}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold border disabled:opacity-40 disabled:cursor-not-allowed ${tab === key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
      </nav>
      {deskBlocked ? <p className="text-[11px] text-tone-warning">{t('A signature of the exchange is in flight at the desk — the other tabs come back once the ledger settles or refuses it.')}</p> : null}

      {tab === 'runs' ? <RunsPanel demo={demo} /> : null}
      <div hidden={tab !== 'exchange'}>
        <ExchangeDesk demo={demo} onBlockedChange={setDeskBlocked} />
      </div>
      {tab === 'user' ? <ClientApp demo={demo} /> : null}
      {tab === 'curtain' ? <CurtainGraph run={demo.run} chain={demo.chain} /> : null}
      {tab === 'evidence' ? <EvidencePanel demo={demo} /> : null}
    </div>
  );
}

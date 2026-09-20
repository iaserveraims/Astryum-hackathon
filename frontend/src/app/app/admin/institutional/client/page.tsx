'use client';

/**
 * /app/admin/institutional/client — the CLIENT's surface, as any exchange app:
 * my balance, put it to work, my position, take out, withdraw. No wallet, no
 * gas, no operator controls anywhere on this page.
 *
 * The client's exchange is resolved from their identity (their passkey
 * account), never from a picker: Face ID → "which exchange am I a client of?"
 * → that exchange's ledger, and only that one. A brand-new account chooses
 * the exchange to open an account with — once.
 *
 * Built BESIDE /app/admin/institutional (untouched). Same gate for now; when
 * this ships, the gate is removed and nothing else moves.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useT } from '../../../../../i18n/LanguageProvider';
import { PreviewOnly } from '../../../../../components/ui/PreviewOnly';
import { PasskeyGate } from '../../../../../components/institutional/user/PasskeyGate';
import { ClientInner } from '../../../../../components/demo-exchange/ClientApp';
import { useDemoRun } from '../../../../../lib/demo-exchange/useDemoRun';
import { demoApi, type RunSummary } from '../../../../../lib/demo-exchange/api';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';

/** Pinned to ONE exchange: the hook never lists or wanders. */
function ClientRunView({ runId, account }: { runId: string; account: string }) {
  const { t } = useT();
  const demo = useDemoRun({ fixedRunId: runId });
  if (demo.error) return <p className="text-xs text-danger">{demo.error}</p>;
  if (!demo.run) return <p className="text-xs text-ink/50 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('Opening your account…')}</p>;
  return <ClientInner demo={demo} account={account} />;
}

function ClientPortal({ account }: { account: string }) {
  const { t } = useT();
  const [state, setState] = useState<{ phase: 'resolving' } | { phase: 'found'; runId: string; exchange: RunSummary } | { phase: 'new'; exchanges: RunSummary[] } | { phase: 'error'; detail: string }>({ phase: 'resolving' });
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'resolving' });
    void demoApi.forAccount(account).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setState({ phase: 'error', detail: r.refusal.detail ?? r.refusal.error });
      if (r.data.found) setState({ phase: 'found', runId: r.data.runId, exchange: r.data.exchange });
      else setState({ phase: 'new', exchanges: r.data.exchanges });
    });
    return () => { cancelled = true; };
  }, [account]);

  if (state.phase === 'resolving') return <p className="text-xs text-ink/50 inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('Finding your exchange…')}</p>;
  if (state.phase === 'error') return <p className="text-xs text-danger">{state.detail}</p>;
  if (state.phase === 'found') {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-ink/50">{t('Your exchange')}: <span className="font-semibold text-ink">{state.exchange.label}</span></p>
        <ClientRunView runId={state.runId} account={account} />
      </div>
    );
  }
  // brand-new account: choose the exchange to open an account with (once)
  if (chosen) return <ClientRunView runId={chosen} account={account} />;
  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3 max-w-md">
      <h2 className="text-sm font-semibold text-ink">{t('Open an account')}</h2>
      <p className="text-xs text-ink/60">{t('This device is not a client of any exchange yet. Choose the exchange to open your account with — your deposit tag is assigned there.')}</p>
      {state.exchanges.length === 0 ? <p className="text-xs text-ink/50">{t('No exchange is open for new accounts right now.')}</p> : null}
      {state.exchanges.map((x) => (
        <button key={x.runId} onClick={() => setChosen(x.runId)} className="w-full text-left rounded-xl border border-ink/10 bg-surface-2 p-3 hover:border-volt">
          <div className="text-sm font-semibold text-ink">{x.label}</div>
          <div className="text-[11px] text-ink/50">{t('policy')} {x.policy} · {x.clients} {t('clients')}</div>
        </button>
      ))}
    </div>
  );
}

export default function ClientSurfacePage() {
  const { t } = useT();
  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }
  return (
    <PreviewOnly label="Client surface" pending="rodaje 21-sep">
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-ink">{t('My account')}</h1>
          <p className="text-xs text-ink/60">{t('Your XRP at the exchange, working or not. Face ID once creates the on-chain account where your shares live — in your name. You never touch a wallet, gas or FLR.')}</p>
          <p className="text-[11px] text-ink/40"><Link href="/app/admin/institutional/exchange" className="underline hover:text-ink">{t('Operator console →')}</Link></p>
        </header>
        <PasskeyGate>{(account) => <ClientPortal account={account} />}</PasskeyGate>
      </div>
    </PreviewOnly>
  );
}

'use client';

/**
 * EvidencePanel — the receipt book of the selected run, verified against the
 * chain on demand, exportable as the proof document. This is the "prueba
 * blockchain de que todo funciona": every line is a hash plus what was read.
 */

import { useState } from 'react';
import { FileDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { demoApi } from '../../lib/demo-exchange/api';
import type { DemoRunApi } from '../../lib/demo-exchange/useDemoRun';
import { ReceiptRow, receiptStatus } from './ReceiptRow';

export function EvidencePanel({ demo }: { demo: DemoRunApi }) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | 'all' | null>(null);
  const run = demo.run;
  if (!run) return <p className="text-xs text-ink/50">{t('Select or create a run first.')}</p>;

  const receipts = [...run.receipts].sort((a, b) => b.at.localeCompare(a.at));
  const verified = receipts.filter((r) => receiptStatus(r) === 'verified').length;
  const failed = receipts.filter((r) => receiptStatus(r) === 'failed').length;
  const pending = receipts.length - verified - failed;

  async function verifyAll() {
    setBusy('all');
    await demo.verify();
    setBusy(null);
  }
  async function verifyOne(id: string) {
    setBusy(id);
    await demo.verify(id);
    setBusy(null);
  }
  // The proof is served behind requireAdmin: a plain <a href> cannot carry the
  // admin headers, so fetch it with them and hand the bytes to the browser.
  async function downloadProof() {
    if (!run) return;
    setBusy('proof');
    const r = await demoApi.proof(run.runId);
    setBusy(null);
    if (!r.ok) {
      demo.setError(r.refusal.detail ?? r.refusal.error);
      return;
    }
    const blob = new Blob([r.data], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-run-${new Date().toISOString().slice(0, 10)}-${run.seq}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink/70">
          <span className="font-semibold text-ink">{receipts.length}</span> {t('receipts')} ·{' '}
          <span className="text-tone-success">{verified} {t('verified on-chain')}</span> ·{' '}
          <span className="text-danger">{failed} {t('with a failed check')}</span> ·{' '}
          <span className="text-ink/50">{pending} {t('not read yet')}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={verifyAll} disabled={busy !== null || receipts.length === 0} className="inline-flex items-center gap-1.5 rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            {busy === 'all' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {t('Read every receipt from the chain')}
          </button>
          <button onClick={downloadProof} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">
            {busy === 'proof' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} {t('Proof document (.md)')}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-ink/50">
        {t('Each receipt is a transaction hash and a promise. "Read the chain" measures the promise against XRPL and Flare — the backend never marks anything done by itself.')}
      </p>
      {receipts.length === 0 ? (
        <p className="text-xs text-ink/50">{t('No receipts yet — every step you run in the Exchange and User tabs lands here.')}</p>
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => (
            <ReceiptRow
              key={r.id}
              receipt={r}
              clientLabel={r.clientId ? run.clients.find((c) => c.id === r.clientId)?.label : undefined}
              onVerify={() => verifyOne(r.id)}
              busy={busy === r.id || busy === 'all'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

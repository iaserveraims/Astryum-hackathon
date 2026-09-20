'use client';

/**
 * ReceiptRow — one line of the receipt book: the step, the hash (copyable +
 * explorer link), and the checks as READ from the chain. A check that is not
 * ✅ says why; a receipt without checks says "not verified yet" — never a
 * silent tick.
 */

import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, XCircle } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { shortHash, type Receipt, type ReceiptStep } from '../../lib/demo-exchange/api';

export const STEP_LABEL: Record<ReceiptStep, string> = {
  E1_ANCHOR: 'Council anchors its constitution',
  E2_POTE: 'The pote is born (one council signature)',
  E3_KYC: 'Client registered on-chain (KYC + tag)',
  E3_CREDENTIAL: 'Credential ceremony (XLS-70)',
  U1_DEPOSIT: 'Client deposits XRP at the exchange',
  E5_PUT_TO_WORK: 'Exchange puts the client capital to work',
  E6_ORDER: 'Council order: capital directed to a venue',
  E7_DENIED: 'The cage says no',
  U4_EXIT: 'Client exits with one signature',
  U4_EXIT_XRP: 'Client exits to XRP',
  E8_WITHDRAW: 'Exchange pays the client out',
  NOTE: 'Note',
};

export const STEP_SIDE: Record<ReceiptStep, 'exchange' | 'user' | 'cage'> = {
  E1_ANCHOR: 'exchange',
  E2_POTE: 'exchange',
  E3_KYC: 'exchange',
  E3_CREDENTIAL: 'exchange',
  U1_DEPOSIT: 'user',
  E5_PUT_TO_WORK: 'exchange',
  E6_ORDER: 'exchange',
  E7_DENIED: 'cage',
  U4_EXIT: 'user',
  U4_EXIT_XRP: 'user',
  E8_WITHDRAW: 'exchange',
  // Una nota es el LIBRO del exchange (peticiones, reservas soltadas),
  // no un veredicto de la jaula — pintarla «Cage» la hacía pasar por uno.
  NOTE: 'exchange',
};

export function receiptStatus(r: Receipt): 'verified' | 'failed' | 'pending' {
  if (!r.checks.length) return 'pending';
  if (r.checks.some((k) => k.ok === false)) return 'failed';
  if (r.checks.every((k) => k.ok === true)) return 'verified';
  return 'pending';
}

export function ReceiptRow({ receipt, clientLabel, onVerify, busy }: { receipt: Receipt; clientLabel?: string; onVerify?: () => void; busy?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const status = receiptStatus(receipt);
  const side = STEP_SIDE[receipt.step];
  const accent = side === 'exchange' ? 'var(--authority, #A76A15)' : side === 'user' ? 'var(--muscle, #1F6F70)' : 'var(--ink)';
  const Icon = status === 'verified' ? CheckCircle2 : status === 'failed' ? XCircle : Circle;
  const iconClass = status === 'verified' ? 'text-tone-success' : status === 'failed' ? 'text-danger' : 'text-ink/30';

  return (
    <div className="rounded-xl border border-ink/10 bg-surface-1 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: accent }}>
              {side === 'exchange' ? t('Exchange') : side === 'user' ? t('User') : t('Cage')}
            </span>
            <span className="text-sm font-semibold text-ink">{t(STEP_LABEL[receipt.step])}</span>
            {clientLabel ? <span className="text-xs text-ink/50">· {clientLabel}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/60">
            <span className="font-mono">{new Date(receipt.at).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
            {receipt.txHash ? (
              <>
                <button
                  onClick={() => navigator.clipboard?.writeText(receipt.txHash ?? '')}
                  className="font-mono hover:text-ink"
                  title={receipt.txHash}
                >
                  {receipt.chain} · {shortHash(receipt.txHash)}
                </button>
                {receipt.explorerUrl ? (
                  <a href={receipt.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-volt underline">
                    {t('explorer')} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : null}
              </>
            ) : (
              <span className="italic">{receipt.step === 'E7_DENIED' ? t('no transaction — refused before signing') : t('no transaction — a note in the book')}</span>
            )}
          </div>
          {receipt.note ? <p className="mt-1 text-xs text-ink/60">{receipt.note}</p> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {receipt.checks.length ? (
            <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-ink/50 hover:text-ink underline">
              {open ? t('hide checks') : `${receipt.checks.filter((k) => k.ok).length}/${receipt.checks.length} ${t('checks')}`}
            </button>
          ) : (
            <span className="text-[11px] text-ink/40">{t('not verified yet')}</span>
          )}
          {onVerify ? (
            <button onClick={onVerify} disabled={busy} className="rounded-full border border-ink/10 px-2.5 py-1 text-[11px] text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">
              {t('Read the chain')}
            </button>
          ) : null}
        </div>
      </div>
      {open && receipt.checks.length ? (
        <ul className="ml-7 space-y-1">
          {receipt.checks.map((k, i) => (
            <li key={i} className="text-xs flex items-start gap-2">
              {k.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-tone-success mt-0.5 shrink-0" /> : k.ok === false ? <XCircle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-ink/30 mt-0.5 shrink-0" />}
              <span className="text-ink/80">
                {k.label}
                {k.observed ? <span className="text-ink/50 font-mono"> — {k.observed}</span> : null}
                {k.reason ? <span className="text-danger"> — {k.reason}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

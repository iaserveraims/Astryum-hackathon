'use client';

/**
 * SettlementIndicator — the ONE "how did my signed operation actually end"
 * block, shared by every done-view that used to paint its own unconditional
 * green check. It renders FROM a SettlementState (branded — components cannot
 * fabricate a settled one, §2 of the machine), so success here always means a
 * real confirmation: EVM receipt, 5792 CONFIRMED+receipts, or mintExecuted.
 *
 * The ref (tx hash / bundle id) is ALWAYS shown and copyable; it links to the
 * explorer whenever the rail knows one (§1.3).
 */

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import type { SettlementState } from '../../lib/settlement/settlement';
import { settlementReasonText } from '../../lib/settlement/reasonText';
import { SignedMark } from './SignedMark';

export function SettlementIndicator({
  state,
  settledText,
  pendingText,
}: {
  state: SettlementState;
  /** Headline once REALLY settled (defaults to a generic confirmed line). */
  settledText?: string;
  /** Headline while pending (defaults to "Signed — settling on Flare…"). */
  pendingText?: string;
}) {
  const { t } = useT();

  const icon =
    state.status === 'settled' ? (
      <div className="w-12 h-12 rounded-2xl grid place-items-center bg-tone-success/10 border border-tone-success/25 text-tone-success">
        <CheckCircle2 className="w-6 h-6" />
      </div>
    ) : state.status === 'failed' ? (
      <div className="w-12 h-12 rounded-2xl grid place-items-center bg-tone-danger/10 border border-tone-danger/25 text-tone-danger">
        <AlertTriangle className="w-6 h-6" />
      </div>
    ) : (
      // pending AND stalled share this ONE slot on purpose: the ceremony
      // (SignedMark plays once on mount, then rests as the drawn autograph —
      // founder 2026-08-08: the full-screen overlay version is retired) must
      // NOT replay when a pending op merely turns stalled. The "still
      // watching" affordance moves to the tiny spinner beside the headline.
      <SignedMark className="my-1" />
    );

  const headline =
    state.status === 'settled'
      ? (settledText ?? t('Settled on Flare — confirmed on-chain.'))
      : state.status === 'failed'
        ? t('The signed operation failed on-chain.')
        : state.status === 'stalled'
          ? t('Taking longer than normal — still watching the chain. Nothing is lost.')
          : (pendingText ?? t('Signed — settling on Flare…'));

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {icon}
      <p className="text-sm text-ink font-medium inline-flex items-center justify-center gap-2">
        {(state.status === 'pending' || state.status === 'stalled') && (
          <Loader2
            className={`w-3.5 h-3.5 animate-spin shrink-0 ${state.status === 'stalled' ? 'text-tone-warning' : 'text-ink/40'}`}
          />
        )}
        {headline}
      </p>
      {state.status !== 'settled' && settlementReasonText(state.reason, t) && (
        <p
          className={`text-[11px] max-w-xs leading-relaxed ${
            state.status === 'failed' ? 'text-tone-danger' : 'text-tone-warning'
          }`}
        >
          {settlementReasonText(state.reason, t)}
        </p>
      )}
      {/* R6.10: the hash never dangles unlabelled — it is the user's receipt. */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-ink/40">{t('Receipt')}:</span>
        {state.explorerUrl ? (
          <a
            href={state.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-volt hover:underline font-mono break-all"
          >
            {state.ref.slice(0, 14)}…{state.ref.slice(-8)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          // A 5792 bundle id has no explorer page yet — still shown, selectable,
          // so the user can check it in their wallet (never an invisible op).
          <span className="text-ink/55 font-mono break-all select-all" title={state.ref}>
            {state.ref.slice(0, 14)}…{state.ref.slice(-8)}
          </span>
        )}
      </div>
    </div>
  );
}

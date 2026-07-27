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
    ) : state.status === 'stalled' ? (
      <div className="w-12 h-12 rounded-2xl grid place-items-center bg-tone-warning/10 border border-tone-warning/25 text-tone-warning">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    ) : (
      <div className="w-12 h-12 rounded-2xl grid place-items-center bg-volt/10 border border-volt/25 text-volt">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
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
      <p className="text-sm text-ink font-medium">{headline}</p>
      {state.reason && state.status !== 'settled' && (
        <p
          className={`text-[11px] max-w-xs leading-relaxed ${
            state.status === 'failed' ? 'text-tone-danger' : 'text-tone-warning'
          }`}
        >
          {state.reason}
        </p>
      )}
      {state.explorerUrl ? (
        <a
          href={state.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-volt hover:underline font-mono break-all"
        >
          {state.ref.slice(0, 14)}…{state.ref.slice(-8)}
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        // A 5792 bundle id has no explorer page yet — still shown, selectable,
        // so the user can check it in their wallet (never an invisible op).
        <span className="text-xs text-ink/55 font-mono break-all select-all" title={state.ref}>
          {state.ref.slice(0, 14)}…{state.ref.slice(-8)}
        </span>
      )}
    </div>
  );
}

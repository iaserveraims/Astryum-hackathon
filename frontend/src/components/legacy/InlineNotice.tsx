'use client';

/**
 * InlineNotice — the one shell for an inline status line (error, confirmation,
 * dry-run result…) across the Legacy surface. Extracted (de-AI pass)
 * from dozens of hand-cloned rows spread across LegacyPanel,
 * ProposalInbox, CouncilMultisigFlow, CouncilOrderCard, CloseDoorSign,
 * ProposeToCouncil, FormalPositions, LegacyIntentCompiler, GovernedMoneyFlows,
 * GovernedMovements, ConstitutionBuilder and LegacyActivityFeed — every one of
 * them the same `<p className="flex items-center gap-2 text-sm text-tone-…">`
 * shell with a different tone and message.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';

export function InlineNotice({
  tone,
  children,
  icon,
}: {
  tone: 'warning' | 'success' | 'danger';
  children: ReactNode;
  /** Defaults per tone (Info / Check / AlertTriangle); pass `null` to omit it
   *  (plain confirmation lines that end in a "View on XRPScan" link never had one). */
  icon?: ReactNode | null;
}) {
  const toneCls: Record<typeof tone, string> = {
    warning: 'text-tone-warning',
    success: 'text-tone-success',
    danger: 'text-tone-danger',
  };
  const DEFAULT_ICON: Record<typeof tone, ReactNode> = {
    success: <Check size={14} className="mt-0.5 shrink-0" />,
    warning: <Info size={14} className="mt-0.5 shrink-0" />,
    danger: <AlertTriangle size={14} className="mt-0.5 shrink-0" />,
  };
  const resolvedIcon = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <p
      className={`flex items-start gap-2 text-sm ${toneCls[tone]}`}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    >
      {resolvedIcon}
      <span>{children}</span>
    </p>
  );
}

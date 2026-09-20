'use client';

/**
 * SmartAccountBadge — the subtle Flare mark an owner wallet wears when its
 * Smart Account is visually folded inside it (paFold, founder 2026-08-17:
 * "un sutil pero que se entienda logo de Flare"). The tooltip carries the
 * absorbed PA's address, so the account never becomes invisible — only its
 * separate card does.
 */

import { TokenLogo } from '@/components/ui/TokenLogo';

export function SmartAccountBadge({
  pa,
  compact = false,
  t,
}: {
  /** The absorbed Smart Account's address (shown in the tooltip). */
  pa: string;
  /** compact = logo only, for tight rows (Summary band). */
  compact?: boolean;
  t: (s: string) => string;
}) {
  const title = `${t('Includes your Flare Smart Account — operated from this wallet')} · ${pa.slice(0, 10)}…${pa.slice(-6)}`;
  if (compact) {
    return (
      <span title={title} className="inline-flex shrink-0" aria-label={t('Includes your Flare Smart Account — operated from this wallet')}>
        <TokenLogo symbol="FLR" size="xs" className="ring-1 ring-surface-1" />
      </span>
    );
  }
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] pl-1 pr-1.5 py-0.5"
    >
      <TokenLogo symbol="FLR" size="xs" />
      <span className="text-[9px] font-medium text-ink/45">Smart Account</span>
    </span>
  );
}

export default SmartAccountBadge;

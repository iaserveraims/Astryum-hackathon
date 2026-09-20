'use client';

/**
 * PortfolioUnreadableNotice — the reader of `snapshot.unreadable` (ola 0,
 * 15-sep). The backend has said since it. 31 which adapters a sweep could
 * not read; this is the card that finally says it to the person, on the Home
 * and on the Portfolio, with a retry that asks the backend for a FRESH read
 * (the degraded copy lives 30 s in its cache — a plain reload would only get
 * it back).
 *
 * Same amber card as the positions board's `emUnreadable` and
 * `flareUnreadable`: «could not read», never «you have nothing».
 */

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, GhostButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { portfolioV1, type PortfolioSnapshot } from '../../services/v1Api';
import { invalidatePortfolioCache } from '../../lib/portfolioMerge';
import { unreadableLine, unreadableOf, unreadableWallets } from '../../lib/portfolioUnreadable';

export function PortfolioUnreadableNotice({
  snap,
  onRetry,
  className = '',
}: {
  snap: PortfolioSnapshot | null | undefined;
  /** The page's own refresh, when it has one; otherwise a forced snapshot of the unread wallets. */
  onRetry?: () => void | Promise<void>;
  className?: string;
}) {
  const { t } = useT();
  const [retrying, setRetrying] = useState(false);
  const entries = unreadableOf(snap);
  if (entries.length === 0) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      } else {
        const wallets = unreadableWallets(entries, snap?.wallet ?? null);
        await Promise.allSettled(wallets.map((w) => portfolioV1.forceSnapshot(w, 14)));
        invalidatePortfolioCache();
      }
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Card className={`p-3.5 border-tone-warning/30 bg-tone-warning/5 ${className}`}>
      <p className="text-sm text-ink/75">
        {t("Couldn't read part of your positions just now, so this view may be missing some of them. That is not the same as having none — what you hold is still on-chain. Retry in a moment.")}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {entries.map((e, i) => (
          <li key={`${e.wallet ?? ''}:${e.protocolId}:${i}`} className="text-[11px] font-mono text-ink/45 break-all">
            {e.wallet && e.wallet !== 'all' ? `${e.wallet.slice(0, 8)}…${e.wallet.slice(-4)} · ` : ''}
            {unreadableLine(e)}
          </li>
        ))}
      </ul>
      <GhostButton onClick={() => void retry()} disabled={retrying} className="mt-2">
        <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
        {t('Try again')}
      </GhostButton>
    </Card>
  );
}

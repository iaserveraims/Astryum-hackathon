'use client';

/**
 * Shared presentation for prepared automation intents (F3 — the signing surface).
 *
 * Extracted verbatim from app/intents/page.tsx so BOTH the full page and the
 * always-on sidebar card (components/intents/SidebarIntents.tsx) render the
 * exact same thing — one source of truth for how a "waiting for your signature"
 * intent looks. Nothing here signs, custodies or broadcasts: it's pure display.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileSignature, Loader2, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card, GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import type { IntentStatus, PreparedIntent } from '../../services/v1Api';

export const FLARESCAN_TX = 'https://flarescan.com/tx/';

export const WAITING_STATUSES: IntentStatus[] = ['proposed', 'pending_user_review'];

export const STATUS_TONE: Record<IntentStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  building: 'neutral',
  proposed: 'warning',
  pending_user_review: 'warning',
  expired: 'neutral',
  signed: 'info',
  broadcast: 'info',
  mempool: 'info',
  confirmed: 'success',
  failed: 'danger',
};

export const STATUS_LABEL: Record<IntentStatus, string> = {
  building: 'Being prepared',
  proposed: 'Waiting for your signature',
  pending_user_review: 'Waiting for your signature',
  expired: 'Expired',
  signed: 'Signed',
  // "Broadcasting"/"In mempool" are node vocabulary — the user reads travel.
  broadcast: 'Sending to the network',
  mempool: 'On its way to the network',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

// Mirrors backend IntentAction (backend/src/types/domain/Intent.ts) — falls
// back to the raw action string for anything not yet mapped, so a future
// action never disappears from the card.
export const ACTION_LABEL: Record<string, string> = {
  repay: 'Repay',
  addCollateral: 'Add collateral',
  withdraw: 'Withdraw',
  supply: 'Supply',
  borrow: 'Borrow',
  harvest: 'Harvest',
  exitLP: 'Exit liquidity',
  addLiquidity: 'Add liquidity',
  swap: 'Swap',
  stake: 'Stake',
  unstake: 'Unstake',
  crossChainSwap: 'Cross-chain swap',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
  delegate: 'Delegate',
  undelegate: 'Undelegate',
  claimRewards: 'Claim rewards',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Simple mm:ss / s countdown to `expiresAt` — ticks locally every second,
 *  never refetches. Reads amber once under a minute, danger once past. */
export function ExpiryPill({ expiresAt }: { expiresAt: string }) {
  const { t } = useT();
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isFinite(target)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!isFinite(target)) return null;
  const diffMs = target - now;
  if (diffMs <= 0) return <Pill tone="danger">{t('Expired')}</Pill>;
  const totalSec = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
  return (
    <Pill tone={diffMs < 60_000 ? 'warning' : 'neutral'}>
      {t('Expires in')} {label}
    </Pill>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-tone-warning/90">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

export function WaitingCard({
  intent,
  signing,
  busy,
  onSign,
  onDismiss,
}: {
  intent: PreparedIntent;
  signing: boolean;
  busy: boolean;
  onSign: (intent: PreparedIntent) => void;
  onDismiss: (intent: PreparedIntent) => void;
}) {
  const { t } = useT();
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">{t(actionLabel(intent.action))}</span>
            <Pill tone="neutral">{intent.protocolId}</Pill>
          </div>
          <div className="text-[11px] font-mono text-ink/40 mt-1 truncate">{shortAddr(intent.owner)}</div>
        </div>
        <div className="shrink-0">
          <ExpiryPill expiresAt={intent.expiresAt} />
        </div>
      </div>

      <p className="text-sm text-ink/70 leading-relaxed">{intent.explanation}</p>
      <WarningList warnings={intent.warnings} />

      {/* R5 — every charge visible BEFORE the wallet opens (invariant #6). The
          gas estimate comes from the prepare-time simulation; when it is
          missing we say where the exact figure appears instead of hiding the
          row. Astryum's own fee is stated even when it is zero. */}
      <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.03] divide-y divide-ink/5 text-xs">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-ink/40 shrink-0">{t('Network fee (gas)')}</span>
          {typeof intent.impact?.gasEstimateUSD === 'number' ? (
            <span className="font-mono text-ink/80">≈ ${(intent.impact.gasEstimateUSD as number).toFixed(2)}</span>
          ) : (
            <span className="text-ink/55 text-right text-[11px]">
              {t('your wallet shows the exact figure before signing')}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-ink/40">{t('Astryum fee')}</span>
          <span className="text-emerald-300">0 · {t('we charge nothing')}</span>
        </div>
      </div>

      {/* Pieza 2 — the walletless alternative for a Kinetic repay: the EVM
          txData above needs MetaMask; a Smart-Account user can instead repay
          from INSIDE the PA (Xaman, executor gas). A 0xFE Payment cannot be
          pre-baked at trigger time (it would expire), so this deep-link opens
          the position's repay modal where it is composed FRESH and signed. */}
      {intent.action === 'repay' && intent.protocolId?.toLowerCase() === 'kinetic' && (
        <Link
          href={`/app/portfolio?paAction=repay&protocol=kinetic&owner=${encodeURIComponent(intent.owner)}`}
          className="mt-3 flex items-center gap-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-3 py-2 text-[11px] text-sky-200/90 hover:bg-sky-400/10 transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          {t('No EVM wallet? Repay from the Smart Account itself — sign in Xaman, the executor pays the gas.')}
        </Link>
      )}

      <div className="mt-4 pt-3 border-t border-ink/5 flex items-center justify-between gap-3">
        {intent.txData ? (
          <PrimaryButton onClick={() => onSign(intent)} disabled={busy}>
            {signing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('Signing…')}
              </>
            ) : (
              <>
                <FileSignature className="w-3.5 h-3.5" /> {t('Sign in wallet')}
              </>
            )}
          </PrimaryButton>
        ) : (
          <span className="text-xs text-ink/40">{t('This operation cannot be signed yet.')}</span>
        )}
        <GhostButton onClick={() => onDismiss(intent)} disabled={busy}>
          {t('Dismiss')}
        </GhostButton>
      </div>
    </Card>
  );
}

export function HistoryRow({ intent }: { intent: PreparedIntent }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.04]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-ink/85">{t(actionLabel(intent.action))}</span>
          <span className="text-xs text-ink/40">
            {t('on')} {intent.protocolId}
          </span>
          <Pill tone={STATUS_TONE[intent.status]}>{t(STATUS_LABEL[intent.status])}</Pill>
        </div>
        <div className="text-[11px] text-ink/40 font-mono mt-1 truncate">
          {shortAddr(intent.owner)} · {new Date(intent.createdAt).toLocaleString()}
        </div>
      </div>
      {intent.txHash ? (
        <a
          href={`${FLARESCAN_TX}${intent.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-volt hover:text-volt inline-flex items-center gap-1 shrink-0"
        >
          {t('view')} <ExternalLink className="w-3 h-3" />
        </a>
      ) : null}
    </div>
  );
}

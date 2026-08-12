'use client';

/**
 * Intents — the full signing surface for prepared automation intents (F3).
 *
 * Still reachable by URL and kept as the deep view (waiting + history). The
 * always-on entry point now lives in the sidebar (SidebarIntentsCard); this
 * page and that card share the SAME presentation (components/intents/
 * intentPresentation.tsx) and the SAME sign path (useIntentSigning) — Astryum
 * never signs, only hands the unsigned payload to the user's own wallet.
 *
 * Reads every one of the user's EVM wallets via useMyWallets() (the same
 * source Portfolio/Activity use), fans out GET /api/intents per address and
 * dedupes by id — one automation can touch several wallets.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FileSignature,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet as WalletIcon,
  Check,
  Bell,
} from 'lucide-react';
import {
  Card,
  EmptyState,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SectionTitle,
} from '../../../components/ui/primitives';
import { RevealGroup, RevealItem } from '../../../components/ui/motion';
import { useT } from '../../../i18n/LanguageProvider';
import { useMyWallets } from '../../../hooks/useMyWallets';
import { EVM_ADDRESS_RE } from '../../../lib/portfolioMerge';
import { AuthRequired, FriendlyError, hasAuthToken } from '../../../lib/authError';
import { intentsApi, type PreparedIntent } from '../../../services/v1Api';
import {
  WAITING_STATUSES,
  WaitingCard,
  HistoryRow,
  FLARESCAN_TX,
  shortAddr,
} from '../../../components/intents/intentPresentation';
import { useIntentSigning } from '../../../components/intents/useIntentSigning';

export default function IntentsPage() {
  const { t } = useT();
  const { wallets: myWallets, loading: walletsLoading } = useMyWallets();

  // The backend intent list is address-keyed and validates 0x-EVM addresses
  // only (see backend/src/routes/intents.ts) — non-EVM wallets (XRPL, etc.)
  // never carry a TransactionIntent today, so they're filtered out rather
  // than sent into a guaranteed 400.
  const evmWallets = useMemo(
    () => myWallets.map((w) => w.address).filter((a) => EVM_ADDRESS_RE.test(a)),
    [myWallets],
  );
  const walletsKey = evmWallets.join(',').toLowerCase();

  const [intents, setIntents] = useState<PreparedIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browser Notification permission (F3-entrega — useIntentWatcher in
  // AppShell is the thing that actually fires notifications; this page only
  // offers the affordance to grant permission, so read-only + ask, nothing
  // signs). 'unsupported' covers SSR and browsers without the Notification API.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);
  async function handleEnableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
  }

  const load = async () => {
    if (evmWallets.length === 0) {
      setIntents([]);
      return;
    }
    if (!hasAuthToken()) {
      setError('no_session');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        evmWallets.map((address) => intentsApi.list(address).catch(() => null)),
      );
      const seen = new Map<string, PreparedIntent>();
      for (const r of results) {
        for (const it of r?.intents ?? []) seen.set(it.id, it);
      }
      const merged = Array.from(seen.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setIntents(merged);
      if (results.every((r) => r == null)) setError("Couldn't load your intents right now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsKey]);

  // Shared sign path — the ONE place a prepared intent reaches the user's
  // wallet (identical to the sidebar card). Re-loads this page's list on change.
  const { evm, sign, dismiss, signingId, busyId, actionError, lastSigned, settling } = useIntentSigning(load);

  if (error === 'no_session') return <AuthRequired />;

  const waiting = intents.filter((i) => WAITING_STATUSES.includes(i.status));
  const history = intents.filter((i) => !WAITING_STATUSES.includes(i.status));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automation"
        title="Intents"
        subtitle="Prepared by your automation — review and sign in your wallet. Astryum never signs."
        actions={
          <>
            {notifPermission === 'default' && (
              <GhostButton onClick={() => void handleEnableNotifications()}>
                <Bell className="w-3.5 h-3.5" />
                {t('Enable browser notifications')}
              </GhostButton>
            )}
            <GhostButton onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('Refresh')}
            </GhostButton>
          </>
        }
        meta={
          notifPermission === 'denied' ? (
            <span className="text-xs text-ink/40">
              {t("Browser notifications are blocked — enable them in your browser's site settings if you'd like to be alerted here.")}
            </span>
          ) : undefined
        }
      />

      {!evm.isConnected && (
        <Card className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <WalletIcon className="w-4 h-4 text-tone-warning" />
            </div>
            <p className="text-sm text-ink/70">
              {t('Connect your EVM wallet to sign intents waiting for you.')}
            </p>
          </div>
          <PrimaryButton onClick={evm.openConnect}>{t('Connect wallet')}</PrimaryButton>
        </Card>
      )}

      {settling && settling.status !== 'settled' && settling.status !== 'failed' && (
        <Card className="flex items-center gap-3 py-3 border-amber-500/25">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-tone-warning animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-ink/85">
              {settling.status === 'stalled'
                ? t('Signed — taking longer than normal, still watching the chain.')
                : t('Signed — settling on Flare…')}
            </p>
            <span className="text-xs text-ink/55 font-mono break-all select-all">
              {shortAddr(settling.ref)}
            </span>
          </div>
        </Card>
      )}

      {lastSigned && (
        <Card className="flex items-center gap-3 py-3 border-emerald-500/25">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-tone-success" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-ink/85">{t('Signed and settled on-chain.')}</p>
            <a
              href={`${FLARESCAN_TX}${lastSigned.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-volt hover:text-volt inline-flex items-center gap-1"
            >
              {shortAddr(lastSigned.txHash)} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </Card>
      )}

      {actionError && <FriendlyError message={actionError} />}

      <section className="space-y-3">
        <SectionTitle hint="Automations leave prepared intents here when they fire — nothing signs until you do.">
          Waiting for your signature
        </SectionTitle>

        {error && error !== 'no_session' && intents.length === 0 ? (
          <FriendlyError message={error} />
        ) : (loading || walletsLoading) && intents.length === 0 ? (
          <Card>
            <div className="text-center text-ink/50 py-8">{t('Loading your intents…')}</div>
          </Card>
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="w-8 h-8 text-ink/40" />}
            title="Nothing waiting for your signature"
            hint="Automations leave prepared intents here when they fire."
          />
        ) : (
          <RevealGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {waiting.map((intent) => (
              <RevealItem key={intent.id}>
                <WaitingCard
                  intent={intent}
                  signing={signingId === intent.id}
                  busy={signingId === intent.id || busyId === intent.id}
                  onSign={sign}
                  onDismiss={dismiss}
                />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>{t('History')}</SectionTitle>
          <Card padded={false} className="divide-y divide-ink/5">
            {history.map((intent) => (
              <HistoryRow key={intent.id} intent={intent} />
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

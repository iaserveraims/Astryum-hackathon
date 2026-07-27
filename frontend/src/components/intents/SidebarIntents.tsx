'use client';

/**
 * SidebarIntentsCard — the always-on "waiting for your signature" surface,
 * pinned to the bottom of the app sidebar (replaces the old /app/intents nav
 * row; the page itself is kept and still reachable by URL).
 *
 * Empty almost always → a quiet titled placeholder. The moment an automation
 * leaves a prepared intent, it shows up here (which strategy/action + protocol)
 * without the user having to navigate anywhere. Pressing a row opens a modal
 * that EXPLAINS the intent and lets the user sign it in their OWN wallet — the
 * same WaitingCard + sign path the full page uses. Astryum never signs.
 *
 * Today only EVM-addressed intents reach this card (the backend intent list is
 * EVM-keyed — see useIntentWatcher / backend/src/routes/intents.ts), so the
 * signing modality here is the wallet request. When XRPL/Xaman automation
 * intents land, this is where a Xaman QR would slot in (see modal below).
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileSignature,
  ChevronRight,
  X,
  Check,
  ExternalLink,
  Loader2,
  Wallet as WalletIcon,
  Hourglass,
  HandCoins,
} from 'lucide-react';
import { Card, EmptyState, PrimaryButton } from '../ui/primitives';
import { backdropFade, modalPop } from '../ui/motion';
import { FriendlyError } from '../../lib/authError';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorities } from '../../hooks/useAuthorities';
import type { PreparedIntent } from '../../services/v1Api';
import type { VaultClaimEntry } from '../../hooks/useVaultClaimsWatcher';
import { VaultClaimModal } from '../positions/VaultClaimModal';
import { actionLabel, shortAddr, FLARESCAN_TX, WaitingCard } from './intentPresentation';
import { useIntentSigning } from './useIntentSigning';

const MAX_ROWS = 3;

/** Short local "day month, HH:mm" for the in-flight ETA. */
function etaLabel(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SidebarIntentsCard({
  waiting,
  refresh,
  claims = [],
  refreshClaims,
  onBeforeOpen,
}: {
  /** Waiting intents from the shared AppShell poller (useIntentWatcher). */
  waiting: PreparedIntent[];
  /** Force an immediate re-poll after the user signs or dismisses. */
  refresh: () => void;
  /** Money in flight — queued vault exits of the ACTIVE authority (useVaultClaimsWatcher). */
  claims?: VaultClaimEntry[];
  /** Re-poll the claim queue (after a claim signature). */
  refreshClaims?: () => void;
  /** Called right before the modal opens — closes the mobile drawer so the modal isn't behind it. */
  onBeforeOpen?: () => void;
}) {
  const { t } = useT();
  // In Legacy (a governed authority is active) this same surface IS the council
  // proposals tray → title it "Proposals"; in Personal it stays "Intents".
  const { activeGoverned } = useAuthorities();
  const cardTitle = activeGoverned ? t('Proposals') : t('Intents');
  const [open, setOpen] = useState(false);
  /** The queued exit being claimed right now (opens VaultClaimModal). */
  const [claimOpen, setClaimOpen] = useState<VaultClaimEntry | null>(null);

  // The modal is portalled to <body>: the sidebar <aside> carries a CSS
  // transform (translate-x), which would otherwise become the containing block
  // for a position:fixed child and trap the modal inside the 256px rail.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Optimistically drop an intent the user just signed/dismissed so the count
  // and list update instantly; `refresh` then reconciles with the backend.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Prune ids that are no longer waiting (backend already advanced them).
    setHiddenIds((s) => {
      if (s.size === 0) return s;
      const live = new Set(waiting.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of s) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : s;
    });
  }, [waiting]);

  const visible = useMemo(() => waiting.filter((i) => !hiddenIds.has(i.id)), [waiting, hiddenIds]);
  const claimableNow = useMemo(() => claims.filter((c) => c.claimable).length, [claims]);
  // The badge counts everything that needs the user: signatures + ready claims.
  const count = visible.length + claimableNow;
  const hasAnything = visible.length > 0 || claims.length > 0;

  const signing = useIntentSigning((intentId) => {
    setHiddenIds((s) => new Set(s).add(intentId));
    refresh();
  });

  const openModal = () => {
    onBeforeOpen?.();
    signing.clearError();
    setOpen(true);
  };

  return (
    <>
      <div
        className={`rounded-2xl border px-3.5 py-3 transition-colors ${
          count > 0
            ? 'border-amber-500/25 bg-amber-500/[0.05]'
            : 'border-ink/[0.06] bg-ink/[0.02]'
        }`}
      >
        {/* cabecera */}
        <div className="flex items-center gap-2">
          <FileSignature
            className={`w-4 h-4 shrink-0 ${count > 0 ? 'text-tone-warning' : 'text-ink/40'}`}
            strokeWidth={1.8}
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/55">
            {cardTitle}
          </span>
          {count > 0 ? (
            <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow-[0_0_10px_rgba(239,68,68,0.45)]">
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </div>

        {!hasAnything ? (
          <p className="mt-2 text-[11px] leading-snug text-ink/35">
            {t('Nothing waiting for your signature')}
          </p>
        ) : (
          <div className="mt-2.5 space-y-3">
            {/* Waiting signatures — automation-prepared intents. */}
            {visible.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('To sign')}
                </div>
                <div className="space-y-0.5">
                  {visible.slice(0, MAX_ROWS).map((intent) => (
                    <button
                      key={intent.id}
                      onClick={openModal}
                      className="group w-full text-left rounded-lg px-2 py-1.5 hover:bg-ink/[0.06] transition-colors"
                      title={t('Review and sign')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">
                          {t(actionLabel(intent.action))}
                        </span>
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-volt opacity-80 group-hover:opacity-100">
                          {t('Sign')}
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                      <div className="text-[10px] text-ink/40 truncate">{intent.protocolId}</div>
                    </button>
                  ))}
                  {visible.length > MAX_ROWS ? (
                    <button
                      onClick={openModal}
                      className="w-full text-left px-2 py-1 text-[11px] text-ink/45 hover:text-ink/75 transition-colors"
                    >
                      +{visible.length - MAX_ROWS} {t('more')}
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Money in flight — vault exits queued in a withdrawal period
                (Firelight ~24h). Nothing to do until the period ends; then the
                row turns into the one-tap Claim. The info lives HERE directly
                (founder 2026-07-19) — no navigation needed. */}
            {claims.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink/35 px-1 mb-1">
                  {t('In flight')}
                </div>
                <div className="space-y-0.5">
                  {claims.map((c) => {
                    const est =
                      c.estFxrpBase != null ? `≈ ${(Number(c.estFxrpBase) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })} FXRP` : 'FXRP';
                    return c.claimable ? (
                      <button
                        key={`${c.owner}-${c.period}`}
                        onClick={() => {
                          onBeforeOpen?.();
                          setClaimOpen(c);
                        }}
                        className="group w-full text-left rounded-lg px-2 py-1.5 bg-volt/[0.07] hover:bg-volt/[0.12] border border-volt/20 transition-colors"
                        title={t('Release the FXRP to your account')}
                      >
                        <div className="flex items-center gap-2">
                          <HandCoins className="w-3.5 h-3.5 shrink-0 text-volt" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">{est}</span>
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-volt">
                            {t('Claim')}
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {c.vaultLabel} · {t('ready to release')}
                        </div>
                      </button>
                    ) : (
                      <div key={`${c.owner}-${c.period}`} className="rounded-lg px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <Hourglass className="w-3.5 h-3.5 shrink-0 text-tone-warning/80" strokeWidth={1.8} />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-ink/85">{est}</span>
                        </div>
                        <div className="text-[10px] text-ink/40 truncate">
                          {c.vaultLabel} · {t('arrives')} {etaLabel(c.claimableAt) || t('when the period ends')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <IntentSignModal intents={visible} signing={signing} onClose={() => setOpen(false)} />
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      {/* The one-tap Claim — same portal reasoning as the sign modal (the
          sidebar's transform would trap a fixed overlay inside the rail). */}
      {mounted && claimOpen
        ? createPortal(
            <VaultClaimModal
              claim={{
                vault: claimOpen.vault,
                vaultLabel: claimOpen.vaultLabel,
                owner: claimOpen.owner,
                period: claimOpen.period,
                claimable: claimOpen.claimable,
                claimableAt: claimOpen.claimableAt,
                estFxrpBase: claimOpen.estFxrpBase,
              }}
              onClose={() => setClaimOpen(null)}
              onChanged={() => refreshClaims?.()}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function IntentSignModal({
  intents,
  signing,
  onClose,
}: {
  intents: PreparedIntent[];
  signing: ReturnType<typeof useIntentSigning>;
  onClose: () => void;
}) {
  const { t } = useT();
  const { evm, sign, dismiss, signingId, busyId, actionError, lastSigned, settling } = signing;

  return (
    <motion.div
      variants={backdropFade}
      initial="hidden"
      animate="shown"
      exit="exit"
      className="fixed inset-0 z-[110] flex items-start justify-center pt-[8vh] px-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        variants={modalPop}
        initial="hidden"
        animate="shown"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-ink/10 bg-surface-1 overflow-hidden max-h-[85vh] flex flex-col"
        style={{ boxShadow: '0 30px 90px rgba(0,0,0,0.6)' }}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-volt border-volt/30 bg-volt/10 shrink-0">
              <FileSignature className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">{t('Waiting for your signature')}</h2>
              <p className="text-xs text-ink/40 mt-0.5">
                {t('Prepared by your automation — review and sign in your wallet. Astryum never signs.')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors shrink-0" aria-label={t('Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
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

          {intents.length === 0 ? (
            <EmptyState
              bare
              icon={<FileSignature className="w-8 h-8 text-ink/40" />}
              title="Nothing waiting for your signature"
              hint="Automations leave prepared intents here when they fire."
            />
          ) : (
            <div className="space-y-4">
              {intents.map((intent) => (
                <WaitingCard
                  key={intent.id}
                  intent={intent}
                  signing={signingId === intent.id}
                  busy={signingId === intent.id || busyId === intent.id}
                  onSign={sign}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

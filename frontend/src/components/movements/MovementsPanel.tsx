'use client';

/**
 * MovementsPanel — the "Movimientos" door of Earn (formerly Savings).
 *
 * One compact surface for moving money: SEND between the user's own wallets
 * or to an external address (the reusable WalletSendModal — same-rail
 * transfers and FAssets bridge moves), RECEIVE via address QR, and SET XRP
 * ASIDE on the ledger (the XRPL savings-escrow flow, absorbed from the old
 * SavingsPanel) plus its savings rules.
 *
 * Same invariants as always (CLAUDE.md #1/#6/#8/#9):
 *  - Astryum composes UNSIGNED payloads; the user reviews the FULL disclosure
 *    and signs in their own wallet (Xaman / MetaMask et al.). Never signs,
 *    never custodies, never broadcasts.
 *  - The escrow LOCKS capital, it does NOT generate yield — the copy says so.
 *    XRP only: RLUSD is not escrowable today (issuer flag off).
 *  - Rules only watch and remind (IDLE_BALANCE / TIME_TRIGGER): when one
 *    fires, the user composes + signs here. Nothing moves without a signature.
 *
 * Active and paused savings (escrows + rules) ALSO surface in Estrategias,
 * under Funcionando · Online / Guardadas · Offline respectively.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  PiggyBank,
  QrCode,
  Loader2,
  RefreshCw,
  Lock,
  Unlock,
  Undo2,
  AlertTriangle,
  Check,
  Plus,
  Trash2,
  Zap,
  Repeat,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  Card,
  EmptyState,
  GhostButton,
  MicroLabel,
  Pill,
  PrimaryButton,
  SectionTitle,
} from '../ui/primitives';
import { RevealGroup, RevealItem } from '../ui/motion';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { getUserRegion } from '../../lib/region';
import { AuthRequired, hasAuthToken } from '../../lib/authError';
import { listMyWallets, type BackendWallet } from '../../services/walletLinkService';
import { transferRailOf } from '../../lib/wallet/nativeBalance';
import { WalletReceiveModal, WalletSendModal } from '../wallet/WalletTransferModals';
import {
  rules as rulesApi,
  xrplSavings,
  xrplDex,
  type AutomationRule,
  type XrplAmount,
  type XrplEscrowRow,
  type XrplTxHandoff,
} from '../../services/v1Api';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const XRPL_PSEUDO_CHAIN_ID = 1440002;

function toDrops(xrp: string): string | null {
  const n = Number(xrp);
  if (!isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 1_000_000));
}

function fmtXrp(amount: string | number): string {
  const n = Number(amount);
  return isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(amount);
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Disclosure fact keys → readable labels (the raw camelCase confused the review). */
function factLabel(key: string, t: (s: string) => string): string {
  const map: Record<string, string> = {
    amountXrp: t('Amount (XRP)'),
    amountDrops: t('Amount (drops)'),
    destination: t('Destination'),
    selfEscrow: t('Back to your own account'),
    earnsYield: t('Generates yield'),
    ownerReserveXrp: t('Extra ledger reserve (XRP)'),
    finishAfterISO: t('Unlocks'),
    cancelAfterISO: t('Cancellable after'),
    network: t('Network'),
    owner: t('Owner'),
    offerSequence: t('Escrow sequence'),
    permissionlessAfterFinishAfter: t('Anyone can release after unlock'),
  };
  return map[key] ?? key;
}

function factValue(key: string, value: string | number | boolean, t: (s: string) => string): string {
  if (typeof value === 'boolean') return value ? t('yes') : t('no');
  if (key === 'finishAfterISO' || key === 'cancelAfterISO') return fmtDateTime(String(value));
  return String(value);
}

/** Backend gate errors → honest, human copy (same posture as the Earn modal). */
function gateMessage(err: unknown, t: (s: string) => string): string {
  const status = (err as { status?: number })?.status;
  const msg = (err as Error)?.message ?? '';
  if (status === 503 || msg.includes('XRPL_DEFI_DISABLED')) {
    return t('XRPL savings are not enabled on this deployment yet (feature flag off).');
  }
  if (status === 451 || msg.includes('GEOFENCE_BLOCKED')) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  if (status === 401) {
    return t('Your session expired — sign in again to continue.');
  }
  return msg || t('Something went wrong.');
}

interface SpendableInfo {
  balanceXrp: number;
  spendableXrp: number;
  reserveXrp: number;
  ownerCount: number;
  nextObjectReserveXrp: number;
}

/** Only the triggers the engine REALLY evaluates today — nothing aspirational. */
type RuleTriggerChoice = 'idle' | 'weekly' | 'monthly';

const WEEKLY_CRON = '0 9 * * 1'; // Mondays 09:00 UTC
const MONTHLY_CRON = '0 9 1 * *'; // 1st of the month 09:00 UTC

/** One compact action tile of the top row. */
function ActionTile({
  icon,
  title,
  desc,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[140px] text-left rounded-xl border px-4 py-3 transition-colors ${
        active
          ? 'border-volt/40 bg-volt/10'
          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-volt' : 'text-white/60'}>{icon}</span>
        <span className="text-sm font-medium text-white">{title}</span>
      </div>
      <p className="text-[11px] text-white/40 mt-1 leading-snug">{desc}</p>
    </button>
  );
}

export default function MovementsPanel({
  scopeWallet,
  variant = 'page',
}: {
  /** When set, the panel is scoped to ONE wallet (the per-card modal). Its
   *  ecosystem decides which rails render: an XRPL wallet gets everything
   *  (send/receive + escrow + savings rules + native DEX buy/sell); a Flare
   *  (EVM) wallet gets the rails that exist there (send/receive), with an
   *  honest note that escrow/DEX are XRPL-native. Absent = the Earn/Legacy
   *  surface, which keeps the XRPL behaviour it always had. */
  scopeWallet?: BackendWallet;
  /** 'modal' drops the standalone intro copy (the modal shell carries it). */
  variant?: 'page' | 'modal';
} = {}) {
  const { t } = useT();
  const { address, isConnected, sendIntent } = useXrplWalletPartner();

  // Chain of the scoped wallet decides which rails render. No scope (Earn /
  // Legacy) keeps the XRPL-native behaviour this panel was born with.
  const rail = scopeWallet ? transferRailOf(scopeWallet) : 'xrpl';
  const isXrpl = rail === 'xrpl';
  const isEvm = rail === 'evm';

  // ── linked wallets (transfers can send from ANY transferable wallet) ──
  const [wallets, setWallets] = useState<BackendWallet[]>([]);
  useEffect(() => {
    let cancelled = false;
    listMyWallets()
      .then((ws) => {
        if (!cancelled) setWallets(ws);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const hasTransferable = useMemo(() => wallets.some((w) => transferRailOf(w) !== null), [wallets]);

  // ── the doors of this door: send / receive / set aside / trade ──
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [dexOpen, setDexOpen] = useState(false);

  // ── ledger state ──
  const [escrows, setEscrows] = useState<XrplEscrowRow[]>([]);
  const [spendable, setSpendable] = useState<SpendableInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ── create flow: form → review → signing → done (N1) ──
  const [amountXrp, setAmountXrp] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [handoff, setHandoff] = useState<XrplTxHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [doneHash, setDoneHash] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  // ── release flow (separate feedback — it lives in the list card) ──
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseHash, setReleaseHash] = useState<string | null>(null);

  // ── rules (Bloque C) ──
  const [ruleRows, setRuleRows] = useState<AutomationRule[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleTrigger, setRuleTrigger] = useState<RuleTriggerChoice>('idle');
  const [ruleThresholdUSD, setRuleThresholdUSD] = useState('50');
  const [ruleAmountXrp, setRuleAmountXrp] = useState('');
  const [ruleLockDays, setRuleLockDays] = useState('30');
  const [ruleBusy, setRuleBusy] = useState(false);

  // Re-render every 30s so "releasable" flips without a manual refresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => settleTimers.current.forEach(clearTimeout), []);

  const minDate = useMemo(() => {
    const d = new Date(Date.now() + 86_400_000);
    return d.toISOString().slice(0, 10);
  }, []);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setListError(null);
    try {
      const res = await xrplSavings.escrows(address);
      setEscrows(res.escrows);
      if (res.account) setSpendable(res.account);
    } catch (err) {
      setListError(gateMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [address, t]);

  const refreshRules = useCallback(async () => {
    if (!address) return;
    setRulesError(null);
    try {
      const res = await rulesApi.list(address);
      setRuleRows(res.rules.filter((r) => (r.action as { kind?: string })?.kind === 'escrow'));
    } catch (err) {
      setRulesError(gateMessage(err, t));
    }
  }, [address, t]);

  useEffect(() => {
    void refresh();
    void refreshRules();
  }, [refresh, refreshRules]);

  /**
   * The ledger validates ~4s after Xaman submits; an immediate re-read misses
   * the new object and the list looks unchanged (scary with real XRP). Poll
   * again at 6s and 14s, then clear the "settling" note.
   */
  const refreshAfterSettlement = useCallback(() => {
    setSettling(true);
    void refresh();
    settleTimers.current.push(setTimeout(() => void refresh(), 6_000));
    settleTimers.current.push(
      setTimeout(() => {
        void refresh();
        setSettling(false);
      }, 14_000),
    );
  }, [refresh]);

  // Ledger rules (mirrored, not invented): Finish is only valid from FinishAfter
  // UNTIL CancelAfter (an expired escrow can no longer be finished); Cancel is
  // only valid from CancelAfter. Both are permissionless in their window.
  const canRelease = useCallback((row: XrplEscrowRow): boolean => {
    if (!row.finishAfterISO || row.hasCondition) return false;
    if (Date.parse(row.finishAfterISO) > Date.now()) return false;
    return !row.cancelAfterISO || Date.parse(row.cancelAfterISO) > Date.now();
  }, []);

  const canCancel = useCallback((row: XrplEscrowRow): boolean => {
    if (!row.cancelAfterISO) return false;
    return Date.parse(row.cancelAfterISO) <= Date.now();
  }, []);

  const prepare = useCallback(async () => {
    if (!address) return;
    setActionError(null);
    setDoneHash(null);
    const drops = toDrops(amountXrp);
    if (!drops) {
      setActionError(t('Enter a positive XRP amount.'));
      return;
    }
    if (!untilDate) {
      setActionError(t('Pick the date the savings unlock.'));
      return;
    }
    // Reserve-aware balance check BEFORE preparing (the ledger would reject
    // with a cryptic tec code at signing time otherwise).
    if (spendable) {
      const maxXrp = spendable.spendableXrp - spendable.nextObjectReserveXrp;
      if (Number(amountXrp) > maxXrp) {
        setActionError(
          `${t('Not enough spendable XRP.')} ${t('Available after ledger reserves:')} ${fmtXrp(Math.max(0, maxXrp))} XRP`,
        );
        return;
      }
    }
    setBusy(true);
    try {
      const h = await xrplSavings.prepareCreate({
        account: address,
        amountDrops: drops,
        finishAfterISO: new Date(`${untilDate}T00:00:00Z`).toISOString(),
        region: getUserRegion() ?? undefined,
      });
      setHandoff(h); // review step — disclosure BEFORE any signature (#6)
    } catch (err) {
      setActionError(gateMessage(err, t));
    } finally {
      setBusy(false);
    }
  }, [address, amountXrp, untilDate, spendable, t]);

  const sign = useCallback(async () => {
    if (!handoff) return;
    setBusy(true);
    setActionError(null);
    try {
      const { txHash } = await sendIntent({ tx: handoff.xrplTx as never });
      setDoneHash(txHash);
      setHandoff(null);
      setAmountXrp('');
      setUntilDate('');
      refreshAfterSettlement();
    } catch (err) {
      // Signing failed/rejected: keep the prepared payload — retry the
      // signature, not the prepare (same posture as F22 in Earn).
      setActionError((err as Error)?.message ?? t('Signing was cancelled.'));
    } finally {
      setBusy(false);
    }
  }, [handoff, sendIntent, refreshAfterSettlement, t]);

  const release = useCallback(
    async (row: XrplEscrowRow) => {
      if (!address || !row.owner || !row.previousTxnID) return;
      setReleasingId(row.previousTxnID);
      setReleaseError(null);
      setReleaseHash(null);
      try {
        const h = await xrplSavings.prepareFinish({
          account: address,
          owner: row.owner,
          previousTxnID: row.previousTxnID,
          region: getUserRegion() ?? undefined,
        });
        const { txHash } = await sendIntent({ tx: h.xrplTx as never });
        setReleaseHash(txHash);
        refreshAfterSettlement();
      } catch (err) {
        // The Finish is permissionless: someone else may have released it
        // first — the escrow no longer exists and the submit fails. The XRP
        // is NOT lost either way; it always went to the destination.
        setReleaseError(
          `${gateMessage(err, t)} — ${t('it may already have been released (anyone can, after the unlock date); the XRP always ends at its destination.')}`,
        );
        void refresh();
      } finally {
        setReleasingId(null);
      }
    },
    [address, sendIntent, refresh, refreshAfterSettlement, t],
  );

  // The recovery half of the Create disclosure's promise: after CancelAfter,
  // cancelling returns the XRP to the escrow's CREATOR — never to the sender.
  const cancelEscrow = useCallback(
    async (row: XrplEscrowRow) => {
      if (!address || !row.owner || !row.previousTxnID) return;
      setReleasingId(row.previousTxnID);
      setReleaseError(null);
      setReleaseHash(null);
      try {
        const h = await xrplSavings.prepareCancel({
          account: address,
          owner: row.owner,
          previousTxnID: row.previousTxnID,
          region: getUserRegion() ?? undefined,
        });
        const { txHash } = await sendIntent({ tx: h.xrplTx as never });
        setReleaseHash(txHash);
        refreshAfterSettlement();
      } catch (err) {
        setReleaseError(
          `${gateMessage(err, t)} — ${t('it may already have been cancelled (anyone can, after the expiry date); the XRP always returns to the account that created the escrow.')}`,
        );
        void refresh();
      } finally {
        setReleasingId(null);
      }
    },
    [address, sendIntent, refresh, refreshAfterSettlement, t],
  );

  // ── Bloque C — create/manage savings rules ──

  const createRule = useCallback(async () => {
    if (!address) return;
    setRulesError(null);
    const drops = toDrops(ruleAmountXrp);
    if (!drops) {
      setRulesError(t('Enter a positive XRP amount.'));
      return;
    }
    const lockDays = Number(ruleLockDays);
    if (!Number.isInteger(lockDays) || lockDays <= 0) {
      setRulesError(t('Lock days must be a positive whole number.'));
      return;
    }
    let trigger: Record<string, unknown>;
    let name: string;
    if (ruleTrigger === 'idle') {
      const minUSD = Number(ruleThresholdUSD);
      if (!(minUSD > 0)) {
        setRulesError(t('Enter a positive USD threshold.'));
        return;
      }
      trigger = { type: 'IDLE_BALANCE', asset: 'XRP', minUSD };
      name = `${t('Save when idle XRP exceeds')} $${minUSD}`;
    } else {
      trigger = { type: 'TIME_TRIGGER', cron: ruleTrigger === 'weekly' ? WEEKLY_CRON : MONTHLY_CRON };
      name = ruleTrigger === 'weekly' ? t('Weekly savings reminder') : t('Monthly savings reminder');
    }
    setRuleBusy(true);
    try {
      await rulesApi.create({
        walletAddress: address,
        chainId: XRPL_PSEUDO_CHAIN_ID,
        name,
        trigger,
        action: { kind: 'escrow', params: { amountDrops: drops, lockDays } },
        // one nudge per day at most for idle; hourly window for scheduled
        cooldownMinutes: ruleTrigger === 'idle' ? 1440 : 60,
      });
      setRuleFormOpen(false);
      setRuleAmountXrp('');
      void refreshRules();
    } catch (err) {
      setRulesError(gateMessage(err, t));
    } finally {
      setRuleBusy(false);
    }
  }, [address, ruleTrigger, ruleThresholdUSD, ruleAmountXrp, ruleLockDays, refreshRules, t]);

  const toggleRule = useCallback(
    async (rule: AutomationRule) => {
      setRulesError(null);
      try {
        if (rule.enabled) await rulesApi.disable(rule.id);
        else await rulesApi.enable(rule.id);
        void refreshRules();
      } catch (err) {
        setRulesError(gateMessage(err, t));
      }
    },
    [refreshRules, t],
  );

  const deleteRule = useCallback(
    async (rule: AutomationRule) => {
      setRulesError(null);
      try {
        await rulesApi.delete(rule.id);
        void refreshRules();
      } catch (err) {
        setRulesError(gateMessage(err, t));
      }
    },
    [refreshRules, t],
  );

  const ruleSummary = useCallback(
    (rule: AutomationRule): string => {
      const trig = rule.trigger as { type?: string; minUSD?: number; cron?: string };
      const params = (rule.action as { params?: { amountDrops?: string; lockDays?: number } })?.params ?? {};
      const amount = params.amountDrops ? fmtXrp(Number(params.amountDrops) / 1_000_000) : '?';
      const lock = params.lockDays ?? '?';
      if (trig.type === 'IDLE_BALANCE') {
        return `${t('Idle XRP over')} $${trig.minUSD} → ${amount} XRP · ${lock} ${t('days')}`;
      }
      if (trig.type === 'TIME_TRIGGER') {
        const when = trig.cron === WEEKLY_CRON ? t('every Monday') : trig.cron === MONTHLY_CRON ? t('every 1st of the month') : trig.cron;
        return `${when} → ${amount} XRP · ${lock} ${t('days')}`;
      }
      return `${trig.type} → ${amount} XRP`;
    },
    [t],
  );

  if (!hasAuthToken()) return <AuthRequired />;

  return (
    <div className="space-y-5">
      {/* Embedded header — the page-level PageHeader belongs to Earn now; in
          the modal the shell already shows the "Movements" title. */}
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {variant !== 'modal' && (
            <>
              <ArrowLeftRight className="w-4 h-4 text-volt/80" strokeWidth={1.6} />
              <h2 className="text-[15px] font-semibold tracking-tight text-white">{t('Movements')}</h2>
            </>
          )}
          {scopeWallet ? (
            <MicroLabel>
              {scopeWallet.nickname || scopeWallet.walletType} · {isXrpl ? 'XRPL' : isEvm ? 'Flare' : t('Wallet')}
            </MicroLabel>
          ) : (
            <MicroLabel>{t('Between your wallets')}</MicroLabel>
          )}
        </div>
        <p className="text-xs text-white/45 mt-1.5 max-w-2xl leading-relaxed">
          {isEvm
            ? t(
                'Send from this Flare wallet to another of your wallets or an external address, and receive with a QR. Astryum prepares everything unsigned — you review and sign in your own wallet.',
              )
            : t(
                'Send between your wallets or to an address, receive with a QR, set XRP aside until a date you choose, and trade on the native XRPL DEX. Astryum prepares everything unsigned — you review and sign in your own wallet.',
              )}
        </p>
      </div>

      <RevealGroup className="space-y-5">
        {/* ── Actions — the three things you do here, one row ── */}
        <RevealItem>
          <Card className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row flex-wrap gap-2.5">
              <ActionTile
                icon={<ArrowUpRight className="w-4 h-4" />}
                title={t('Send')}
                desc={t('To another of your wallets or an external address — cross-network rides the FAssets bridge.')}
                onClick={() => setSendOpen(true)}
              />
              <ActionTile
                icon={<QrCode className="w-4 h-4" />}
                title={t('Receive')}
                desc={t('Show a wallet address as a QR to receive assets into it.')}
                onClick={() => setReceiveOpen(true)}
              />
              {isXrpl && (
                <ActionTile
                  icon={<PiggyBank className="w-4 h-4" />}
                  title={t('Set XRP aside')}
                  desc={t('Lock XRP on the ledger until a date you choose. It earns nothing while locked — a savings lock, not a yield product.')}
                  onClick={() => setSaveOpen((v) => !v)}
                  active={saveOpen}
                />
              )}
              {isXrpl && (
                <ActionTile
                  icon={<Repeat className="w-4 h-4" />}
                  title={t('Buy / Sell')}
                  desc={t('Place a buy or sell order on the native XRPL DEX (XRP ↔ RLUSD). The price comes from the open order book.')}
                  onClick={() => setDexOpen((v) => !v)}
                  active={dexOpen}
                />
              )}
            </div>
            {!hasTransferable && (
              <p className="text-[11px] text-white/40">
                {t('Link a Flare or XRPL wallet from Wallets to send from it.')}
              </p>
            )}
            {isEvm && (
              <p className="text-[11px] text-white/40">
                {t('Set XRP aside and DEX buy/sell are native XRPL rails — for Flare, put your assets to work in Earn. Send and receive work here as usual.')}
              </p>
            )}

            {/* ── Buy / Sell — native XRPL DEX order, folded into this card ── */}
            {isXrpl && dexOpen &&
              (!isConnected ? (
                <p className="text-xs text-white/50 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  {t('DEX orders sign on your own XRPL account — connect Xaman from Wallets to trade.')}
                </p>
              ) : (
                <XrplDexOrder
                  address={address!}
                  sendIntent={sendIntent as (i: { tx: unknown }) => Promise<{ txHash: string }>}
                  t={t}
                />
              ))}

            {/* ── Set aside — the XRPL savings-escrow flow, folded into this card ── */}
            {saveOpen &&
              (!isConnected ? (
                <p className="text-xs text-white/50 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  {t('Savings escrows live on your own XRPL account — connect Xaman from Wallets to start.')}
                </p>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-white/70">{t('Set XRP aside')}</span>
                    {spendable && (
                      <span className="text-[11px] text-white/45">
                        {t('Spendable:')} {fmtXrp(spendable.spendableXrp)} XRP
                        <span className="text-white/30"> · {t('ledger reserve')} {fmtXrp(spendable.reserveXrp)} XRP</span>
                      </span>
                    )}
                  </div>
                  {!handoff ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
                          {spendable && (
                            <button
                              type="button"
                              onClick={() =>
                                // The escrow object itself raises the reserve —
                                // MAX is spendable minus that next-object step.
                                setAmountXrp(
                                  String(Math.max(0, spendable.spendableXrp - spendable.nextObjectReserveXrp)),
                                )
                              }
                              disabled={spendable.spendableXrp - spendable.nextObjectReserveXrp <= 0}
                              className="text-[11px] text-volt hover:underline font-medium disabled:opacity-40 disabled:no-underline"
                            >
                              MAX
                            </button>
                          )}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={amountXrp}
                          onChange={(e) => setAmountXrp(e.target.value)}
                          placeholder="25"
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                        />
                      </label>
                      <label className="flex-1">
                        <MicroLabel>{t('Locked until')}</MicroLabel>
                        <input
                          type="date"
                          min={minDate}
                          value={untilDate}
                          onChange={(e) => setUntilDate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                        />
                      </label>
                      <PrimaryButton onClick={prepare} disabled={busy}>
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                        {t('Review')}
                      </PrimaryButton>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Disclosure BEFORE signing (invariant #6) */}
                      <p className="text-sm text-white/70">{handoff.disclosure.note}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {Object.entries(handoff.disclosure.facts).map(([k, v]) => (
                          <div key={k} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                            <MicroLabel>{factLabel(k, t)}</MicroLabel>
                            <div className="mt-0.5 truncate text-sm">{factValue(k, v, t)}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <PrimaryButton onClick={sign} disabled={busy}>
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          {t('Sign in Xaman')}
                        </PrimaryButton>
                        <GhostButton onClick={() => setHandoff(null)} disabled={busy}>
                          {t('Back')}
                        </GhostButton>
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-white/35">
                    {t('This is a savings lock, not a yield product — it earns nothing while locked. XRP only: RLUSD is not escrowable today (issuer flag off).')}
                    {spendable && (
                      <>
                        {' '}
                        {t('Each active saving also sets aside')} {fmtXrp(spendable.nextObjectReserveXrp)} XRP{' '}
                        {t('of ledger reserve — it returns to your balance when you release it.')}
                      </>
                    )}
                  </p>
                </div>
              ))}
            {actionError && (
              <p className="flex items-center gap-2 text-sm text-amber-400">
                <AlertTriangle size={14} /> {actionError}
              </p>
            )}
            {doneHash && (
              <div className="space-y-2">
                <p className="text-sm text-emerald-400">
                  {t('Signed and submitted from your wallet.')}{' '}
                  <a href={`${XRPSCAN_TX}${doneHash}`} target="_blank" rel="noreferrer" className="underline">
                    {t('View on XRPScan')}
                  </a>
                  {settling && (
                    <span className="ml-2 text-white/45">{t('The ledger takes a few seconds — the list refreshes itself.')}</span>
                  )}
                </p>
                {/* Auto-release hand-off — link-out, not API integration: the
                    registration runs through xrpl.services' own backend and its
                    per-escrow fee, and their tool reads escrows straight from
                    the ledger (account_objects), so savings created here show
                    up there. Same "go to the protocol →" posture as the
                    Translation-layer fallback. Astryum signs/registers nothing. */}
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] text-white/45">
                  {t("Don't want to come back to release it yourself? The XRPL ecosystem has a permissionless auto-release service:")}{' '}
                  <a
                    href="https://xrpl.services/tools?escrowReleaser=open"
                    target="_blank"
                    rel="noreferrer"
                    className="text-white/70 underline"
                  >
                    Escrow Releaser · xrpl.services
                    <ArrowUpRight size={11} className="ml-0.5 inline" />
                  </a>{' '}
                  {t('— a third-party service (not Astryum) with a small XRP fee. Sign in there with this same Xaman account, pick this saving and enable it. Its keeper signs the release with its own key — your XRP can only ever land in your own account.')}
                </p>
              </div>
            )}
          </Card>
        </RevealItem>

        {/* ── Locked savings + rules — XRPL-side, need the Xaman connection ── */}
        {isXrpl && (!isConnected ? (
          <RevealItem>
            <Card className="p-4">
              <EmptyState
                icon={<PiggyBank size={20} />}
                title={t('Connect an XRPL wallet')}
                hint={t('Savings escrows live on your own XRPL account — connect Xaman from Wallets to start.')}
              />
            </Card>
          </RevealItem>
        ) : (
          <>
            {/* ── Existing escrows ── */}
            <RevealItem>
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <SectionTitle>{t('Your escrows')}</SectionTitle>
                  <GhostButton onClick={() => void refresh()} disabled={loading}>
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  </GhostButton>
                </div>
                {listError ? (
                  <p className="flex items-center gap-2 text-sm text-amber-400">
                    <AlertTriangle size={14} /> {listError}
                  </p>
                ) : escrows.length === 0 && !loading ? (
                  <EmptyState
                    icon={<Lock size={20} />}
                    title={t('No savings locked yet')}
                    hint={t('Escrows you create appear here, and in your portfolio as locked value.')}
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {escrows.map((row, i) => (
                      <li key={row.previousTxnID ?? i} className="flex flex-wrap items-center gap-3 py-2.5">
                        <Lock size={14} className="text-white/40" />
                        <span className="text-sm font-medium">
                          {fmtXrp(row.amount)} {row.currency}
                        </span>
                        <span className="text-sm text-white/50">
                          {t('until')} {fmtDateTime(row.finishAfterISO)}
                        </span>
                        {row.hasCondition && <Pill tone="warning">{t('conditional')}</Pill>}
                        {!row.isOutgoing && <Pill tone="info">{t('incoming')}</Pill>}
                        <span className="ml-auto">
                          {canRelease(row) ? (
                            <PrimaryButton
                              onClick={() => void release(row)}
                              disabled={releasingId !== null || !row.previousTxnID}
                            >
                              {releasingId === row.previousTxnID ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Unlock size={14} />
                              )}
                              {t('Release')}
                            </PrimaryButton>
                          ) : canCancel(row) ? (
                            <PrimaryButton
                              onClick={() => void cancelEscrow(row)}
                              disabled={releasingId !== null || !row.previousTxnID}
                            >
                              {releasingId === row.previousTxnID ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Undo2 size={14} />
                              )}
                              {t('Recover')}
                            </PrimaryButton>
                          ) : (
                            <Pill tone="neutral">{t('locked')}</Pill>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {releaseError && (
                  <p className="flex items-center gap-2 text-sm text-amber-400">
                    <AlertTriangle size={14} /> {releaseError}
                  </p>
                )}
                {releaseHash && (
                  <p className="text-sm text-emerald-400">
                    {t('Release signed and submitted.')}{' '}
                    <a href={`${XRPSCAN_TX}${releaseHash}`} target="_blank" rel="noreferrer" className="underline">
                      {t('View on XRPScan')}
                    </a>
                    {settling && (
                      <span className="ml-2 text-white/45">{t('The ledger takes a few seconds — the list refreshes itself.')}</span>
                    )}
                  </p>
                )}
                <p className="text-[11px] text-white/40">
                  {t(
                    'After the unlock date, anyone can release a time-based escrow — the XRP always goes to its destination. No key is ever delegated.',
                  )}
                </p>
              </Card>
            </RevealItem>

            {/* ── Savings rules (Bloque C) ── */}
            <RevealItem>
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <SectionTitle>{t('Savings rules')}</SectionTitle>
                  {!ruleFormOpen && (
                    <GhostButton onClick={() => setRuleFormOpen(true)}>
                      <Plus size={14} /> {t('New rule')}
                    </GhostButton>
                  )}
                </div>
                <p className="text-[11px] text-white/45">
                  {t(
                    'A rule only watches and reminds: when it fires, Astryum prepares the escrow here and YOU sign it in Xaman. Nothing moves without your signature.',
                  )}
                </p>

                {ruleFormOpen && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label>
                        <MicroLabel>{t('When')}</MicroLabel>
                        <select
                          value={ruleTrigger}
                          onChange={(e) => setRuleTrigger(e.target.value as RuleTriggerChoice)}
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                        >
                          <option value="idle">{t('Idle XRP exceeds a threshold')}</option>
                          <option value="weekly">{t('Every Monday (09:00 UTC)')}</option>
                          <option value="monthly">{t('Every 1st of the month (09:00 UTC)')}</option>
                        </select>
                      </label>
                      {ruleTrigger === 'idle' && (
                        <label>
                          <MicroLabel>{t('Idle threshold (USD)')}</MicroLabel>
                          <input
                            type="number"
                            min="1"
                            value={ruleThresholdUSD}
                            onChange={(e) => setRuleThresholdUSD(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                          />
                        </label>
                      )}
                      <label>
                        <MicroLabel>{t('Amount to set aside (XRP)')}</MicroLabel>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={ruleAmountXrp}
                          onChange={(e) => setRuleAmountXrp(e.target.value)}
                          placeholder="10"
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                        />
                      </label>
                      <label>
                        <MicroLabel>{t('Lock for (days)')}</MicroLabel>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={ruleLockDays}
                          onChange={(e) => setRuleLockDays(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <PrimaryButton onClick={createRule} disabled={ruleBusy}>
                        {ruleBusy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {t('Create rule')}
                      </PrimaryButton>
                      <GhostButton onClick={() => setRuleFormOpen(false)} disabled={ruleBusy}>
                        {t('Back')}
                      </GhostButton>
                    </div>
                  </div>
                )}

                {rulesError && (
                  <p className="flex items-center gap-2 text-sm text-amber-400">
                    <AlertTriangle size={14} /> {rulesError}
                  </p>
                )}

                {ruleRows.length === 0 && !ruleFormOpen ? (
                  <EmptyState
                    icon={<Zap size={20} />}
                    title={t('No savings rules yet')}
                    hint={t('Create one and Astryum will nudge you to set XRP aside — you always sign in Xaman.')}
                  />
                ) : (
                  <ul className="divide-y divide-white/5">
                    {ruleRows.map((rule) => (
                      <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <Zap size={14} className={rule.enabled ? 'text-volt' : 'text-white/30'} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{rule.name}</div>
                          <div className="text-xs text-white/45">
                            {ruleSummary(rule)}
                            {rule.totalTimesTriggered > 0 && (
                              <span> · {rule.totalTimesTriggered} {t('nudges')}</span>
                            )}
                          </div>
                        </div>
                        <span className="ml-auto flex items-center gap-2">
                          <GhostButton onClick={() => void toggleRule(rule)}>
                            {rule.enabled ? t('Pause') : t('Resume')}
                          </GhostButton>
                          <GhostButton onClick={() => void deleteRule(rule)}>
                            <Trash2 size={14} />
                          </GhostButton>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </RevealItem>
          </>
        ))}
      </RevealGroup>

      {/* Send — prepare-only: unsigned payload + disclosure, signed in the user's wallet.
          Scoped modal prefills the source to this card's wallet. */}
      {sendOpen && (
        <WalletSendModal wallet={scopeWallet} wallets={wallets} onClose={() => setSendOpen(false)} />
      )}

      {/* Receive — address QR, display-only */}
      {receiveOpen && (
        <WalletReceiveModal wallet={scopeWallet} wallets={wallets} onClose={() => setReceiveOpen(false)} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XrplDexOrder — a native XRPL DEX buy/sell order (XRP ↔ RLUSD), prepare-only. */
/*                                                                              */
/* Same invariants: Astryum builds the UNSIGNED OfferCreate + the full          */
/* disclosure (price is the open book's, never an Astryum quote); the user      */
/* reviews and signs in Xaman. Astryum never signs, never custodies (#1/#6/#8). */
/* ────────────────────────────────────────────────────────────────────────── */

// RLUSD on XRPL mainnet: non-standard (5-char) codes travel as 40-char hex.
// Issuer mirrors the backend default (XrplEcosystemWatch) — one source of truth.
const RLUSD = {
  label: 'RLUSD',
  currency: '524C555344000000000000000000000000000000',
  issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
} as const;

/** Trim a decimal to XRPL's 15 significant digits, no trailing zeros. */
function iouValue(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  const s = Number(n.toPrecision(15)).toString();
  return s;
}

function XrplDexOrder({
  address,
  sendIntent,
  t,
}: {
  address: string;
  sendIntent: (intent: { tx: unknown }) => Promise<{ txHash: string }>;
  t: (s: string) => string;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [xrpAmount, setXrpAmount] = useState('');
  const [price, setPrice] = useState(''); // RLUSD per XRP
  const [handoff, setHandoff] = useState<XrplTxHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneHash, setDoneHash] = useState<string | null>(null);

  const xrp = Number(xrpAmount);
  const p = Number(price);
  const rlusdTotal = xrp > 0 && p > 0 ? xrp * p : 0;

  // OfferCreate semantics: TakerGets = what YOU sell, TakerPays = what YOU buy.
  function buildAmounts(): { takerGets: XrplAmount; takerPays: XrplAmount; sell: boolean } {
    const drops = String(Math.round(xrp * 1_000_000));
    const rlusd = { currency: RLUSD.currency, issuer: RLUSD.issuer, value: iouValue(rlusdTotal) };
    return side === 'sell'
      ? { takerGets: drops, takerPays: rlusd, sell: true } // sell XRP → receive RLUSD
      : { takerGets: rlusd, takerPays: drops, sell: false }; // spend RLUSD → receive XRP
  }

  async function prepare() {
    setError(null);
    setDoneHash(null);
    if (!(xrp > 0)) return setError(t('Enter a positive XRP amount.'));
    if (!(p > 0)) return setError(t('Enter a positive price (RLUSD per XRP).'));
    setBusy(true);
    try {
      const { takerGets, takerPays, sell } = buildAmounts();
      const h = await xrplDex.prepareOfferCreate({
        account: address,
        takerGets,
        takerPays,
        flags: { sell, immediateOrCancel: orderType === 'market' },
        region: getUserRegion() ?? undefined,
      });
      setHandoff(h);
    } catch (err) {
      setError(gateMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!handoff) return;
    setBusy(true);
    setError(null);
    try {
      const { txHash } = await sendIntent({ tx: handoff.xrplTx });
      setDoneHash(txHash);
      setHandoff(null);
      setXrpAmount('');
      setPrice('');
    } catch (err) {
      setError((err as Error)?.message ?? t('Signing was cancelled.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      {/* Side + order type */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            type="button"
            onClick={() => { setSide('buy'); setHandoff(null); }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              side === 'buy' ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/50 hover:text-white/80'
            }`}
          >
            <TrendingUp size={13} /> {t('Buy XRP')}
          </button>
          <button
            type="button"
            onClick={() => { setSide('sell'); setHandoff(null); }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              side === 'sell' ? 'bg-red-500/20 text-red-300' : 'text-white/50 hover:text-white/80'
            }`}
          >
            <TrendingDown size={13} /> {t('Sell XRP')}
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            type="button"
            onClick={() => { setOrderType('limit'); setHandoff(null); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              orderType === 'limit' ? 'bg-volt/15 text-white' : 'text-white/50 hover:text-white/80'
            }`}
            title={t('Rests on the book until it fills or you cancel it.')}
          >
            {t('Limit')}
          </button>
          <button
            type="button"
            onClick={() => { setOrderType('market'); setHandoff(null); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              orderType === 'market' ? 'bg-volt/15 text-white' : 'text-white/50 hover:text-white/80'
            }`}
            title={t('Fills against the book now; the remainder is cancelled (immediate-or-cancel).')}
          >
            {t('Market')}
          </button>
        </div>
      </div>

      {!handoff ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <MicroLabel>{t('Amount (XRP)')}</MicroLabel>
              <input
                type="number"
                min="0"
                step="any"
                value={xrpAmount}
                onChange={(e) => setXrpAmount(e.target.value)}
                placeholder="100"
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
              />
            </label>
            <label className="flex-1">
              <MicroLabel>{t('Price (RLUSD per XRP)')}</MicroLabel>
              <input
                type="number"
                min="0"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.50"
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
              />
            </label>
            <PrimaryButton onClick={prepare} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
              {t('Review')}
            </PrimaryButton>
          </div>
          <p className="text-[11px] text-white/45">
            {rlusdTotal > 0
              ? side === 'sell'
                ? `${t('You sell')} ${fmtXrp(xrp)} XRP → ${t('receive')} ~${iouValue(rlusdTotal)} RLUSD`
                : `${t('You spend')} ~${iouValue(rlusdTotal)} RLUSD → ${t('receive')} ${fmtXrp(xrp)} XRP`
              : t('Order price comes from the open XRPL DEX book — Astryum quotes nothing.')}
          </p>
        </>
      ) : (
        <div className="space-y-3">
          {/* Disclosure BEFORE signing (invariant #6) */}
          <p className="text-sm text-white/70">{handoff.disclosure.note}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(handoff.disclosure.facts).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <MicroLabel>{factLabel(k, t)}</MicroLabel>
                <div className="mt-0.5 truncate text-sm">{factValue(k, v, t)}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <PrimaryButton onClick={sign} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {t('Sign in Xaman')}
            </PrimaryButton>
            <GhostButton onClick={() => setHandoff(null)} disabled={busy}>
              {t('Back')}
            </GhostButton>
          </div>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-amber-400">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {doneHash && (
        <p className="text-sm text-emerald-400">
          {t('Order signed and submitted from your wallet.')}{' '}
          <a href={`${XRPSCAN_TX}${doneHash}`} target="_blank" rel="noreferrer" className="underline">
            {t('View on XRPScan')}
          </a>
        </p>
      )}
      <p className="text-[10px] text-white/35">
        {t('A DEX order is a spot buy/sell on the native XRPL order book — not a yield product. Astryum builds it unsigned; you sign it in Xaman and can cancel a resting order any time.')}
      </p>
    </div>
  );
}

'use client';

/**
 * Estrategias — the home of every strategy (UI reorg 2026-07-12).
 *
 * The hub is TWO full-width horizontal shelves, sized to fill the viewport
 * without scrolling:
 *
 *   · Funcionando · Online  → everything working right now: the live on-chain
 *     footprint (moved here from Earn), open positions with their MoneyFlows,
 *     and active savings (locked escrows + enabled savings rules).
 *   · Guardadas · Offline   → the registry of every strategy NOT running:
 *     agent-created and manual drafts (editable, re-runnable, with the words
 *     that created them) plus paused savings rules (resumable here).
 *
 * Each shelf opens INTO its card (view switch, same gesture as Earn's doors).
 * Creating strategies lives in Earn — this page lists, inspects, edits and
 * re-activates. Running a draft deep-links back to Earn's prepare→review→sign
 * modal: Astryum never signs, never executes.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  HandCoins,
  Layers,
  Loader2,
  Lock,
  PiggyBank,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { PageHeader, Card, MicroLabel, Pill, GhostButton, PrimaryButton } from '../../../components/ui/primitives';
import { formatMoney } from '../../../lib/formatMoney';
import { RevealGroup, RevealItem } from '../../../components/ui/motion';
import { OrbitDial } from '../../../components/ui/charts';
import { MoonScene } from '../../../components/earn/icons';
import DefiPositionsBoard, { type BoardAutoAction } from '../../../components/positions/DefiPositionsBoard';
import MoneyFlowsPanel from '../../../components/moneyflows/MoneyFlowsPanel';
import StrategySection from '../../../components/strategies/StrategySection';
import WorkingStrategiesPanel, { useStrategyGroups, type StrategyGroup } from '../../../components/strategies/WorkingStrategies';
import { VaultIcon, AssetIcon } from '../../../components/ui/StrategyIcons';
import { hfWord } from '../../../lib/healthScore';
import { fmtQtyActive } from '../../../lib/format';
import { VaultWithdrawModal, type VaultPositionRef } from '../../../components/positions/VaultWithdrawModal';
import { VaultClaimModal, type VaultClaimRef } from '../../../components/positions/VaultClaimModal';
import { PaActionsModal, type PaHolder, type PaLegs } from '../../../components/positions/PaActionsModal';
import { getApiBase } from '../../../lib/env';
import { canonicalizeSymbol } from '../../../lib/canonicalizeSymbol';
import { MyStrategyDrafts, type LaunchStrategy } from '../../../components/earn/StrategyAgent';
import {
  rules as rulesApi,
  xrplSavings,
  type AutomationRule,
  type XrplEscrowRow,
} from '../../../services/v1Api';
import { useAuthStore } from '../../../stores/authStore';
import { getUserRegion } from '../../../lib/region';
import { useMyWallets } from '../../../hooks/useMyWallets';
import { useAuthorities } from '../../../hooks/useAuthorities';
import GovernedMoneyFlows from '../../../components/legacy/GovernedMoneyFlows';
import CouncilVaultEntry from '../../../components/legacy/CouncilVaultEntry';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { invalidatePortfolioCache } from '../../../lib/portfolioMerge';
import { useAggregatedPortfolio } from '../../../hooks/useAggregatedPortfolio';
import { profileIdentity } from '../../../lib/profileStore';
import { listDrafts, type StrategyDraft } from '../../../lib/strategyDrafts';
import { useT } from '../../../i18n/LanguageProvider';
import { ModalOverlay } from '@/components/ui/ModalPortal';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * The address that actually HOLDS a strategy read from `wallet`: an EVM wallet
 * holds its own positions; an XRPL wallet's positions live on its deterministic
 * Smart Account (Personal Account), resolved read-only before opening a modal.
 */
async function resolveHolder(wallet: string): Promise<string | null> {
  if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) return wallet;
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(wallet)) {
    try {
      const r = await fetch(
        `${API_BASE}/flare-demo/personal-account?xrpl=${encodeURIComponent(wallet)}`,
        { headers: authHeaders(), credentials: 'include' },
      );
      if (!r.ok) return null;
      const b = (await r.json()) as { personalAccount?: string };
      return b.personalAccount ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Kinetic ISO legs (base units) out of a strategy group — same classification
 *  as the Positions board's kineticLegsFor, over the portfolio snapshot legs.
 *  ONLY ISO-market legs qualify: a core-comptroller position (sFLR, USDC.e…)
 *  must never feed the ISO actions' amounts. */
function kineticLegsFromGroup(g: StrategyGroup): PaLegs {
  const legs: PaLegs = {};
  for (const l of g.legs) {
    if (!l.amountBase || l.iso !== true) continue;
    // "USD₮0" (₮ U+20AE) — sin canonicalizar, la pierna de deuda desaparece
    // y el hub no ofrece repay/unwind.
    const sym = canonicalizeSymbol(l.symbol ?? l.asset);
    const isUsdt = sym.includes('USDT');
    const k = l.kind.toUpperCase();
    if (['SUPPLY', 'COLLATERAL', 'LEND'].includes(k)) {
      if (isUsdt) legs.suppliedUsdt0Base = l.amountBase;
      else if (sym === 'FXRP') legs.supplyFxrpBase = l.amountBase;
    } else if (['BORROW', 'DEBT'].includes(k) && isUsdt) {
      legs.debtUsdt0Base = l.amountBase;
    }
  }
  return legs;
}

/** HF → plain-language health word — the shared canonical bands (lib/healthScore). */
function healthWord(hf: number, t: (s: string) => string): { label: string; tone: string } {
  const w = hfWord(hf, t);
  return { label: w.label, tone: `text-tone-${w.tone === 'neutral' ? 'success' : w.tone}` };
}

function fmtXrp(amount: string | number): string {
  const n = Number(amount);
  return isFinite(n) ? fmtQtyActive(n, 6) : String(amount);
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** One instrument reading — a quiet label over a mono figure. The label is
 *  the shared MicroLabel primitive (was a hand-cloned copy of it). */
function Reading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <MicroLabel tone="muted" className="mb-1.5">{label}</MicroLabel>
      <div className="text-lg font-semibold tracking-tight">{children}</div>
    </div>
  );
}

/**
 * Health strip — plain-language liquidation + P&L over the portfolio risk snapshot.
 *
 * Reads the SAME aggregated source as Home/Portfolio (F12): every connected
 * wallet via useMyWallets(), fanned out through loadAggregatedPortfolio() and
 * reduced to the worst health factor (mergeRisks). This used to read a single
 * browser-connected wallet via useWalletPartner() (wagmi), which could show a
 * different "your HF" than the rest of the app whenever the SIWE-login wallet
 * differed from the wagmi-connected one, or the account held more than one
 * wallet. Same source everywhere ⇒ the same number everywhere.
 */
function HealthStrip() {
  const { t } = useT();
  const address = useAuthStore((s) => s.user?.address);
  // Shared reactive store — instant on navigation, refreshes invisibly.
  const { data, loading, error: err } = useAggregatedPortfolio();
  const snap = data?.risk ?? null;

  if (!address) {
    // Quiet inline note — an empty banner card would outrank the real content.
    return (
      <p className="text-sm text-ink/45 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-ink/30" strokeWidth={1.5} />
        {t('Connect your wallet to see the health of your active strategies.')}
      </p>
    );
  }
  if (loading) {
    return (
      <Card padded={false} className="p-5">
        <div className="animate-pulse space-y-3" aria-label={t('Reading your positions…')}>
          <div className="h-4 w-2/3 rounded bg-ink/[0.06]" />
          <div className="h-3 w-1/3 rounded bg-ink/[0.05]" />
          <div className="flex gap-6 pt-1.5">
            <div className="h-8 w-16 rounded bg-ink/[0.05]" />
            <div className="h-8 w-16 rounded bg-ink/[0.05]" />
            <div className="h-8 w-16 rounded bg-ink/[0.05]" />
          </div>
        </div>
      </Card>
    );
  }
  if (err) {
    return (
      <Card className="p-4">
        <p className="text-sm text-tone-danger">{t("Couldn't read your risk right now. Try again in a moment.")}</p>
      </Card>
    );
  }
  const hf = snap?.healthFactor;
  if (!snap || hf == null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-ink/60">
          {t('No debt to watch — your active strategies have no liquidation risk.')}
        </p>
      </Card>
    );
  }

  const w = healthWord(hf, t);
  // Price drop to HF=1: at liquidation price_liq = price_now / HF ⇒ drop = (1 − 1/HF).
  const dropPct = Math.max(0, (1 - 1 / hf) * 100);
  // The protection buffer as an orbit: how far your capital sits from liquidation.
  const buffer = Math.min(100, Math.round(dropPct));

  return (
    <Card spotlight padded={false} className="relative overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 p-5 md:p-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${w.tone}`} strokeWidth={1.6} />
            <p className="text-sm text-ink/85 leading-relaxed">
              {t('Your position is')} <span className={`font-medium ${w.tone}`}>{w.label}</span> —{' '}
              {t("you're protected if the price falls about")}{' '}
              <span className="font-medium font-mono">{dropPct.toFixed(0)}%</span>.
            </p>
          </div>
          {snap.liquidationPriceUSD != null && (
            <p className="text-xs text-ink/55 mt-1.5 ml-6">
              {t('If the price touches')}{' '}
              <span className="font-mono text-ink/80">${snap.liquidationPriceUSD.toFixed(4)}</span>,{' '}
              {t('your position is liquidated.')}
            </p>
          )}

          {/* The readings that used to hide in a <details> — now an open instrument row. */}
          <div className="mt-5 flex flex-wrap gap-x-7 gap-y-3.5">
            <Reading label={t('Health Factor')}>
              <span className={`font-mono ${w.tone}`}>{hf.toFixed(2)}</span>
            </Reading>
            {snap.ltv != null && (
              <Reading label="LTV">
                <span className="font-mono text-ink/85">{(snap.ltv * 100).toFixed(1)}%</span>
              </Reading>
            )}
            {snap.liquidationDistanceUSD != null && (
              <Reading label={t('Distance')}>
                <span className="font-mono text-ink/85">${snap.liquidationDistanceUSD.toFixed(0)}</span>
              </Reading>
            )}
          </div>
          <p className="text-[11px] text-ink/35 pt-3 mt-4 border-t border-ink/5">
            {t('Net P&L per strategy appears once your position accumulates history.')}
          </p>
        </div>

        {/* The protection buffer as a dial — a full orbit is a wide cushion to
            liquidation; a short arc means little room. Words carry the state. */}
        <div className="shrink-0 hidden sm:flex flex-col items-center">
          <div className="mb-2">
            <MicroLabel>{t('Protection buffer')}</MicroLabel>
          </div>
          <OrbitDial value={buffer} words={w.label} size={124} />
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Savings as strategies — escrows + rules read from the XRPL wallet.   */
/* Active (locked escrows, enabled rules) belong to Online; paused      */
/* rules belong to Offline. Best-effort: savings are one voice among    */
/* several on this page, so failures stay quiet.                        */
/* ------------------------------------------------------------------ */

function useSavingsStrategies() {
  const { address } = useXrplWalletPartner();
  const [escrows, setEscrows] = useState<XrplEscrowRow[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);

  const refresh = useCallback(async () => {
    if (!address) {
      setEscrows([]);
      setRules([]);
      return;
    }
    const [esc, rl] = await Promise.allSettled([xrplSavings.escrows(address), rulesApi.list(address)]);
    if (esc.status === 'fulfilled') setEscrows(esc.value.escrows);
    if (rl.status === 'fulfilled') {
      setRules(rl.value.rules.filter((r) => (r.action as { kind?: string })?.kind === 'escrow'));
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { escrows, rules, refresh };
}

/**
 * Withdraw of an XRPL savings escrow = the permissionless EscrowFinish after
 * FinishAfter (same flow as Movements): prepare unsigned → the user signs in
 * Xaman. Available both from the hub preview and inside Running · Online.
 */
function useEscrowRelease(onDone: () => void) {
  const { t } = useT();
  const { address, sendIntent } = useXrplWalletPartner();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const release = useCallback(
    async (row: XrplEscrowRow) => {
      if (!address || !row.owner || !row.previousTxnID) return;
      setBusyId(row.previousTxnID);
      setError('');
      try {
        const h = await xrplSavings.prepareFinish({
          account: address,
          owner: row.owner,
          previousTxnID: row.previousTxnID,
          region: getUserRegion() ?? undefined,
        });
        await sendIntent({ tx: h.xrplTx as never });
        onDone();
      } catch (err) {
        // Finish is permissionless — someone may have released it first; the
        // XRP always ends at its destination either way.
        setError((err as Error)?.message ?? t('Something went wrong.'));
      } finally {
        setBusyId(null);
      }
    },
    [address, sendIntent, onDone, t],
  );

  return { release, busyId, error };
}

/** Active savings inside Funcionando · Online — locked escrows + enabled rules.
 *  A releasable escrow gets its Withdraw right here (EscrowFinish in Xaman). */
function ActiveSavings({
  escrows,
  rules,
  onRelease,
  releasingId,
  releaseError,
}: {
  escrows: XrplEscrowRow[];
  rules: AutomationRule[];
  onRelease: (row: XrplEscrowRow) => void;
  releasingId: string | null;
  releaseError: string;
}) {
  const { t } = useT();
  const router = useRouter();
  if (escrows.length === 0 && rules.length === 0) return null;
  return (
    <Card spotlight padded={false} className="relative overflow-hidden">
      {/* capital resting in shadow until its unlock date — the Movements moon */}
      <div className="pointer-events-none absolute -right-5 -top-7 hidden sm:block opacity-[0.22]">
        <MoonScene size={150} />
      </div>
      <div className="relative z-[1] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <PiggyBank className="w-4 h-4 text-tone-success/80" strokeWidth={1.6} />
          <h3 className="text-[13px] font-semibold text-ink">{t('Active savings')}</h3>
        </div>
        <button
          onClick={() => router.push('/app/asset-production?view=movements')}
          className="inline-flex items-center gap-1.5 text-xs text-volt hover:text-volt/80 transition-colors"
        >
          {t('Manage in Earn · Movements')} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className="divide-y divide-ink/5">
        {escrows.map((row, i) => (
          <li key={row.previousTxnID ?? i} className="flex flex-wrap items-center gap-3 py-2.5">
            <Lock size={14} className="text-ink/40" />
            <span className="text-sm font-medium">
              {fmtXrp(row.amount)} {row.currency}
            </span>
            <span className="text-sm text-ink/50">
              {t('until')} {fmtDate(row.finishAfterISO)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {row.releasableNow ? (
                <GhostButton onClick={() => onRelease(row)} disabled={releasingId !== null}>
                  {releasingId === row.previousTxnID ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    t('Withdraw')
                  )}
                </GhostButton>
              ) : (
                <Pill tone="success">{t('locked')}</Pill>
              )}
            </span>
          </li>
        ))}
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Zap size={14} className="text-volt" />
            <span className="text-sm font-medium min-w-0 truncate">{rule.name}</span>
            <span className="ml-auto">
              <Pill tone="success">{t('active')}</Pill>
            </span>
          </li>
        ))}
      </ul>
      {releaseError && <p className="text-xs text-tone-warning">{releaseError}</p>}
      <p className="text-[11px] text-ink/35">
        {t('Withdraw releases the escrow with an EscrowFinish you sign in Xaman — the XRP always goes to its destination.')}
      </p>
      </div>
    </Card>
  );
}

/** Paused savings rules inside Guardadas · Offline — resumable right here. */
function PausedSavings({
  rules,
  onChanged,
}: {
  rules: AutomationRule[];
  onChanged: () => void;
}) {
  const { t } = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (rules.length === 0) return null;

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id);
    setErr('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr((e as Error)?.message ?? t('Something went wrong.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card spotlight className="p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <PiggyBank className="w-4 h-4 text-ink/40" strokeWidth={1.6} />
        <h3 className="text-[13px] font-semibold text-ink">{t('Paused savings rules')}</h3>
      </div>
      <ul className="divide-y divide-ink/5">
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Zap size={14} className="text-ink/30" />
            <span className="text-sm font-medium min-w-0 truncate">{rule.name}</span>
            <span className="ml-auto flex items-center gap-2">
              <GhostButton onClick={() => void act(() => rulesApi.enable(rule.id), rule.id)} disabled={busyId !== null}>
                {busyId === rule.id ? <Loader2 size={14} className="animate-spin" /> : t('Reactivate')}
              </GhostButton>
              <GhostButton onClick={() => void act(() => rulesApi.delete(rule.id), rule.id)} disabled={busyId !== null}>
                <Trash2 size={14} />
              </GhostButton>
            </span>
          </li>
        ))}
      </ul>
      {err && <p className="text-xs text-tone-warning">{err}</p>}
      <p className="text-[11px] text-ink/35">
        {t('A reactivated rule only watches and reminds — you always sign in Xaman.')}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* PAGE                                                                */
/* ------------------------------------------------------------------ */

type ShelfView = 'online' | 'offline';

export default function StrategiesPage({
  embedded = false,
  onLaunch,
}: {
  embedded?: boolean;
  /** Provided when embedded in Earn: run a strategy through Earn's own
   *  prepare→review→sign modal (no navigation). Standalone falls back to a
   *  deep-link into Earn (goEarn). */
  onLaunch?: LaunchStrategy;
} = {}) {
  const { t } = useT();
  const router = useRouter();
  const [view, setView] = useState<ShelfView>('online');

  const user = useAuthStore((s) => s.user);
  const identity = profileIdentity(user) ?? 'anon';
  const [drafts, setDrafts] = useState<StrategyDraft[]>([]);
  useEffect(() => {
    setDrafts(listDrafts(identity));
  }, [identity, view]);

  // Bumped after any action that changes positions (withdraw, borrow…): drops
  // the shared portfolio cache and re-reads the groups, so a closed strategy
  // actually DISAPPEARS from the tiles instead of lingering as "active".
  const [groupsNonce, setGroupsNonce] = useState(0);
  const refreshStrategies = useCallback(() => {
    invalidatePortfolioCache();
    setGroupsNonce((n) => n + 1);
  }, []);

  const groups = useStrategyGroups(groupsNonce);
  const { escrows, rules, refresh: refreshSavings } = useSavingsStrategies();
  const activeRules = rules.filter((r) => r.enabled);
  const pausedRules = rules.filter((r) => !r.enabled);

  // A COUNCIL account (founder 2026-08-01: "My strategies debe ser igual que
  // Personal"): the SAME page renders, but capital moves by council ORDER
  // through the cage — so the cage's strategy cards open the governed composer
  // (quorum signs, FDC proves, the vault executes) instead of the personal
  // withdraw rails, and MoneyFlows swap for the governed surface.
  const { activeGoverned } = useAuthorities();
  const cageGroups = activeGoverned
    ? (groups ?? []).filter((g) => g.wallet === activeGoverned.address)
    : [];
  const [cageModal, setCageModal] = useState<StrategyGroup | null>(null);

  // Hub → board deep-link: which position's action to open on entering Online.
  const [autoAction, setAutoAction] = useState<BoardAutoAction | null>(null);
  const { release: releaseEscrow, busyId: releasingId, error: releaseError } = useEscrowRelease(() =>
    void refreshSavings(),
  );

  // Withdraw works DIRECTLY from the hub: the modal opens here, over the
  // shelves. XRPL-read strategies resolve their Smart Account first.
  const { wallets: myWallets } = useMyWallets();
  const aliasFor = useCallback(
    (addr?: string) => {
      if (!addr) return undefined;
      const hit = myWallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
      return hit?.label ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    },
    [myWallets],
  );
  type HubModal =
    | { kind: 'vault'; ref: VaultPositionRef; holders?: VaultPositionRef[] }
    | { kind: 'kinetic'; owner: string; legs: PaLegs; holders?: PaHolder[] }
    | { kind: 'claim'; ref: VaultClaimRef }
    | { kind: 'norail'; name: string };
  const [hubModal, setHubModal] = useState<HubModal | null>(null);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [hubError, setHubError] = useState('');

  const hubWithdraw = useCallback(
    async (g: StrategyGroup, tileKey: string, siblings: StrategyGroup[] = []) => {
      setHubError('');
      if (!g.wallet) {
        setHubModal({ kind: 'norail', name: g.name });
        return;
      }
      setResolvingKey(tileKey);
      try {
        // Group wallet → the account that actually holds it on Flare.
        const toRef = async (grp: StrategyGroup): Promise<VaultPositionRef | null> => {
          if (!grp.vaultExit || !grp.wallet) return null;
          const h = await resolveHolder(grp.wallet);
          if (!h) return null;
          return {
            vault: grp.vaultExit.vault,
            vaultLabel: grp.name,
            owner: h,
            sharesBase: grp.vaultExit.sharesBase,
            sharePriceE6: grp.vaultExit.sharePriceE6,
          };
        };
        if (g.vaultExit) {
          const ref = await toRef(g);
          if (!ref) {
            setHubError(`${g.name}: ${t('could not resolve the holding account')}`);
            return;
          }
          // The same vault held from OTHER wallets → the modal's selector.
          const others = (
            await Promise.all(
              siblings
                .filter((s) => s !== g && s.vaultExit?.vault === g.vaultExit!.vault)
                .map(toRef),
            )
          ).filter((r): r is VaultPositionRef => r !== null);
          setHubModal({ kind: 'vault', ref, holders: [ref, ...others] });
        } else if (g.protocol.toLowerCase() === 'kinetic') {
          const holder = await resolveHolder(g.wallet);
          if (!holder) {
            setHubError(`${g.name}: ${t('could not resolve the holding account')}`);
            return;
          }
          // The same market open from OTHER wallets → the modal's selector.
          const kinHolders = (
            await Promise.all(
              siblings
                .filter((s) => s.protocol.toLowerCase() === 'kinetic' && s !== g && s.wallet)
                .map(async (s): Promise<PaHolder | null> => {
                  const h = await resolveHolder(s.wallet!);
                  return h ? { owner: h, legs: kineticLegsFromGroup(s) } : null;
                }),
            )
          ).filter((h): h is PaHolder => h !== null);
          setHubModal({
            kind: 'kinetic',
            owner: holder,
            legs: kineticLegsFromGroup(g),
            holders: [{ owner: holder, legs: kineticLegsFromGroup(g) }, ...kinHolders],
          });
        } else {
          setHubModal({ kind: 'norail', name: g.name });
        }
      } finally {
        setResolvingKey(null);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [t],
  );

  // Release a Firelight queued exit right from the hub — the "1 tap" once the
  // ~24h period ends. Resolves the account that queued it (PA/EVM), then opens
  // the same prepare→sign claim modal; Astryum signs nothing.
  const hubClaim = useCallback(
    async (g: StrategyGroup, tileKey: string) => {
      setHubError('');
      if (!g.claimExit || !g.wallet) {
        setHubModal({ kind: 'norail', name: g.name });
        return;
      }
      setResolvingKey(tileKey);
      try {
        const holder = await resolveHolder(g.wallet);
        if (!holder) {
          setHubError(`${g.name}: ${t('could not resolve the holding account')}`);
          return;
        }
        setHubModal({
          kind: 'claim',
          ref: {
            vault: 'firelight',
            vaultLabel: g.name,
            owner: holder,
            period: g.claimExit.period,
            claimable: g.claimExit.claimable,
            claimableAt: g.claimExit.claimableAt,
            estFxrpBase: g.claimExit.estFxrpBase,
          },
        });
      } finally {
        setResolvingKey(null);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [t],
  );

  // Deep-link contract: /app/strategies?view=online|offline — used by Earn's
  // manual builder ("view it in Estrategias") and cleaned so refreshes land
  // back on the hub.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = new URLSearchParams(window.location.search);
    const wanted = qs.get('view');
    if (wanted !== 'online' && wanted !== 'offline') return;
    setView(wanted);
    qs.delete('view');
    const rest = qs.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, []);

  // Saved-draft actions live in Earn (where the prepare→sign modal is). From here
  // we take the user there to run or create — carrying the draft's kind/params
  // (F15a) so Earn can pre-fill the SAME prepare→sign modal instead of opening
  // it empty. Contract: /app/asset-production?launch=<kind>&amount=&ratio=&hf=
  // — empty params omitted, values encodeURIComponent'd. The prefill Earn
  // builds from this stays fully editable before signing (invariant).
  const goEarn = useCallback<LaunchStrategy>(
    (kind, initial) => {
      const params = new URLSearchParams({ launch: kind });
      if (initial?.amount) params.set('amount', initial.amount);
      if (initial?.ratio) params.set('ratio', initial.ratio);
      if (initial?.targetHF) params.set('hf', initial.targetHF);
      router.push(`/app/asset-production?${params.toString()}`);
    },
    [router],
  );

  // Embedded in Earn → run through Earn's own sign modal (onLaunch); standalone
  // → deep-link into Earn. One handle for the Strategy section + draft cards.
  const runStrategy: LaunchStrategy = onLaunch ?? goEarn;

  // ── The two shelves became one segmented toggle (founder 2026-07-20): the
  //    section switch renders the selected view inline instead of two big
  //    cards you click into. The claimable banner and the hub modals stay. ──
  {
    // "Notify + 1 tap": queued Firelight exits whose ~24h period has ended are
    // money ready to land in the user's wallet — surfaced up top so they don't
    // have to hunt for it, with the claim one tap away.
    const claimableNow = (groups ?? [])
      .filter((g) => g.claimExit?.claimable)
      .map((g) => ({
        g,
        tileKey: `${g.wallet ?? ''}:${g.protocol}:${g.name}`,
        estFxrp: g.claimExit!.estFxrpBase != null ? Number(g.claimExit!.estFxrpBase) / 1e6 : null,
      }));

    return (
      <div className="flex flex-col">
        {/* Embedded inside Earn (founder 2026-07-18): Earn's own header + back
            row give the context, so the page header would be a double title. */}
        {!embedded && (
          <div className="flex-none">
            <PageHeader
              eyebrow={t('Strategies')}
              title={t('My strategies')}
              subtitle={t('Everything in one place — the ones running now and the ones you saved.')}
            />
          </div>
        )}

        {claimableNow.length > 0 && (
          <div className="flex-none mb-4 rounded-2xl border border-tone-warning/25 bg-tone-warning/[0.07] p-4">
            <div className="flex items-center gap-2 mb-2">
              <HandCoins className="w-4 h-4 text-tone-warning" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold text-tone-warning">
                {claimableNow.length === 1
                  ? t('You have FXRP ready to claim')
                  : `${claimableNow.length} ${t('exits ready to claim')}`}
              </span>
            </div>
            <div className="space-y-1.5">
              {claimableNow.map(({ g, tileKey, estFxrp }) => (
                <div key={tileKey} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink/70 min-w-0 truncate">
                    {g.name}
                    {estFxrp != null && (
                      <span className="text-tone-warning/80 font-mono"> · ≈{estFxrp.toLocaleString(undefined, { maximumFractionDigits: 4 })} FXRP</span>
                    )}
                  </span>
                  <button
                    onClick={() => void hubClaim(g, tileKey)}
                    disabled={resolvingKey === tileKey}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg border border-tone-warning/40 bg-tone-warning/15 text-tone-warning font-medium hover:brightness-110 transition-colors disabled:opacity-40"
                  >
                    {resolvingKey === tileKey ? <Loader2 size={12} className="animate-spin" /> : t('Claim')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Section toggle — the SAME segmented control the Legacy panel uses,
            in place of the two big cards you used to click into. The selected
            view renders inline underneath. */}
        <div className="mb-5 inline-flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-ink/10 bg-ink/[0.02] p-1">
          {([
            ['online', <Layers key="i" className="w-4 h-4" strokeWidth={1.6} />, t('Running · Online'), (groups?.length ?? 0) + escrows.length + activeRules.length],
            ['offline', <Bookmark key="i" className="w-4 h-4" strokeWidth={1.6} />, t('Saved · Offline'), drafts.length + pausedRules.length],
          ] as const).map(([id, icon, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition ${
                view === id ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              <span className={view === id ? 'text-volt' : 'text-ink/40'} aria-hidden>
                {icon}
              </span>
              {label}
              <span className="rounded-full border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[11px] font-normal text-ink/55">
                {count}
              </span>
            </button>
          ))}
        </div>

        <RevealGroup className="space-y-6">
          {view === 'online' && (
            <>
              <RevealItem>
                <HealthStrip />
              </RevealItem>

              {/* Apartado 1 — DeFi positions (protocols + capital). The embedded
                  MoneyFlows are hidden here: automations live in the Strategy
                  apartado below (My strategies split, founder 2026-07-20). */}
              <RevealItem>
                <DefiPositionsBoard autoAction={autoAction} showStrategyPanel={false} embedded />
              </RevealItem>

              {/* Council strategies — the cage's capital as strategy cards, the
                  SAME reading Personal gets. The action opens the governed
                  composer: every move is a council order the quorum signs. */}
              {cageGroups.length > 0 && (
                <RevealItem>
                  <div className="space-y-3">
                    {cageGroups.map((g) => (
                      <Card key={`${g.protocol}:${g.name}`} className="p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-ink capitalize">{g.name}</span>
                              <Pill tone="neutral">{t('Council · quorum signs')}</Pill>
                            </div>
                            <p className="mt-1 text-[12px] text-ink/50">
                              {g.legs
                                .map((l) => `${l.asset} ${formatMoney(Math.abs(l.usd))}`)
                                .join(' · ')}
                            </p>
                          </div>
                          <span className="font-mono text-base text-ink">{formatMoney(g.totalUSD)}</span>
                          <PrimaryButton onClick={() => setCageModal(g)}>
                            {t('Move capital')} <ArrowRight size={14} />
                          </PrimaryButton>
                        </div>
                      </Card>
                    ))}
                  </div>
                </RevealItem>
              )}

              {/* Apartado 2 — Strategy · MoneyFlows: the active rules as cards.
                  A council's rules are GOVERNED (quorum-signed) — its surface
                  replaces the personal composer here, same spot, other rail. */}
              <RevealItem>
                {activeGoverned ? (
                  <GovernedMoneyFlows account={activeGoverned.address} />
                ) : (
                  <StrategySection
                    mode="online"
                    addresses={myWallets.map((w) => w.address)}
                    identity={identity}
                    onLaunch={runStrategy}
                    onChanged={refreshStrategies}
                  />
                )}
              </RevealItem>

              {/* Active savings — locked escrows + enabled rules */}
              <RevealItem>
                <ActiveSavings
                  escrows={escrows}
                  rules={activeRules}
                  onRelease={(row) => void releaseEscrow(row)}
                  releasingId={releasingId}
                  releaseError={releaseError}
                />
              </RevealItem>
            </>
          )}

          {view === 'offline' && (
            <>
              {/* Offline has only the Strategy apartado (founder 2026-07-20):
                  paused MoneyFlows + saved drafts as cards, plus the ＋ card.
                  A council has no personal drafts — its rules (active AND
                  paused) live in the governed surface under Online. */}
              {!activeGoverned && (
                <RevealItem>
                  <StrategySection
                    mode="offline"
                    addresses={myWallets.map((w) => w.address)}
                    identity={identity}
                    onLaunch={runStrategy}
                    onChanged={refreshStrategies}
                  />
                </RevealItem>
              )}

              {/* Paused savings rules — resumable in place */}
              <RevealItem>
                <PausedSavings rules={pausedRules} onChanged={() => void refreshSavings()} />
              </RevealItem>
            </>
          )}
        </RevealGroup>

        {/* Direct actions from the hub — the SAME prepare→review→sign modals
            the board uses, opened right here. Astryum signs nothing. */}
        {hubModal?.kind === 'vault' && (
          <VaultWithdrawModal
            position={hubModal.ref}
            holders={hubModal.holders}
            onClose={() => setHubModal(null)}
            onChanged={refreshStrategies}
          />
        )}
        {hubModal?.kind === 'claim' && (
          <VaultClaimModal
            claim={hubModal.ref}
            onClose={() => setHubModal(null)}
            onChanged={refreshStrategies}
          />
        )}
        {hubModal?.kind === 'kinetic' && (
          <PaActionsModal
            owner={hubModal.owner}
            legs={hubModal.legs}
            holders={hubModal.holders}
            action="withdraw"
            onClose={() => setHubModal(null)}
            onChanged={refreshStrategies}
          />
        )}
        {/* The cage's action modal — the governed twin of the hub modals
            above: same gesture, but what it composes is a COUNCIL ORDER
            (prepare-only, quorum signs, the vault executes on Flare). */}
        {cageModal && activeGoverned && (
          <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
                <div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--authority-border)] bg-[var(--authority-soft)] text-ink/60">
                    {t('Council order · the cage')}
                  </span>
                  <h2 className="mt-1.5 text-lg font-semibold text-ink capitalize">{cageModal.name}</h2>
                </div>
                <button onClick={() => setCageModal(null)} className="text-ink/40 hover:text-ink transition-colors mt-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
                <CouncilVaultEntry account={activeGoverned.address} vaultTitle={cageModal.name} />
              </div>
            </div>
          </ModalOverlay>
        )}

        {hubModal?.kind === 'norail' && (
          <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm my-auto shadow-2xl p-6 space-y-4">
              <div className="flex items-start justify-between">
                <h2 className="text-base font-semibold text-ink">
                  {t('Withdraw')} · {hubModal.name}
                </h2>
                <button onClick={() => setHubModal(null)} className="text-ink/40 hover:text-ink transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-ink/60 leading-relaxed">
                {t("This position's in-app exit isn't wired yet — withdraw from the protocol's own app. Your funds are always under your wallet's control, never Astryum's.")}
              </p>
              <GhostButton onClick={() => setHubModal(null)} className="w-full">
                {t('Done')}
              </GhostButton>
            </div>
          </ModalOverlay>
        )}
      </div>
    );
  }
}

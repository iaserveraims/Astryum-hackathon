'use client';

/**
 * WorkingStrategies — the live on-chain footprint of every strategy currently
 * working, grouped by protocol.
 *
 * Moved OUT of FlareDemoEarn (UI reorg 2026-07-12): the "Live on-chain" card
 * now belongs to Estrategias (Funcionando · Online), not Earn. Same data path
 * as before — the merged snapshot the Portfolio reads, wallet balances
 * excluded (free capital is not a strategy).
 */

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Loader2, Wallet } from 'lucide-react';
import { Pill, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useAggregatedPortfolio } from '../../hooks/useAggregatedPortfolio';
import { AssetIcon, VaultIcon } from '../ui/StrategyIcons';
import { formatMoney } from '../../lib/formatMoney';

const KIND_WORD: Record<string, string> = {
  supply: 'Supplied',
  collateral: 'Collateral',
  debt: 'Debt',
  borrow: 'Borrowed',
  lp: 'LP',
  staking: 'Staked',
  locked: 'Locked',
  stake: 'Staked',
  rewards: 'Rewards',
  reward: 'Rewards',
};

export interface StrategyGroup {
  protocol: string;
  /** Human name of THIS strategy: the vault (earnXRP, MXRPY, stXRP…) when the
   *  position carries one, else the protocol. Vaults of the same protocol are
   *  separate strategies — never folded into one "upshift" card. */
  name: string;
  /** Adapter vault key (earnxrp / monarq) when this group is a vault. */
  vaultKey?: string;
  /** Address the positions were read from (EVM wallet, or the XRPL wallet
   *  whose Smart Account holds them — resolve before signing). */
  wallet?: string;
  legs: { kind: string; asset: string; usd: number; amountBase?: string; symbol?: string; iso?: boolean }[];
  /** Net capital: debt legs SUBTRACT (a leveraged position shows its net). */
  totalUSD: number;
  /** A Harvest automation applies (FTSO rewards / staking legs). */
  hasHarvest: boolean;
  /** Underlying asset the tile's logo shows (XRP behind the receipts, FLR…). */
  assetSymbol: string;
  /** Exit rail info when this strategy is a partner vault (shares + price). */
  vaultExit?: { vault: 'earnxrp' | 'monarq' | 'firelight'; sharesBase: string; sharePriceE6: string | null };
  /** A Firelight redeem already burned the stXRP and parked the FXRP in the
   *  ~24h withdrawal queue — this is the "1 tap" to release it once it's ready.
   *  The holding wallet (`wallet`) signs; Astryum only builds the claim. */
  claimExit?: { period: number; claimable: boolean; claimableAt: string | null; estFxrpBase: string | null };
}

/** Vault/receipt name an adapter stashed in position metadata, if any. */
function vaultNameOf(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const token = typeof meta.token === 'string' ? meta.token : null;
  const vaultName = typeof meta.vaultName === 'string' ? meta.vaultName : null;
  return token ?? vaultName;
}

/**
 * Groups the account's REAL on-chain positions (same merged snapshot the
 * Portfolio reads) into strategies, skipping plain wallet balances. One
 * strategy = one protocol position PER VAULT and PER HOLDING WALLET: two
 * Upshift vaults (earnXRP, MXRPY) are two strategies, and the same vault held
 * by two wallets is two strategies (their withdraw rails differ). `null` =
 * loading.
 */
export function useStrategyGroups(reloadKey = 0): StrategyGroup[] | null {
  const { wallets } = useMyWallets();
  // Derived from the shared reactive store — instant on nav, refreshes solo.
  const { data, reload } = useAggregatedPortfolio();

  // Parent bumps reloadKey after a position-changing action → force a rescan.
  useEffect(() => {
    if (reloadKey > 0) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return useMemo(() => {
    if (wallets.length === 0) return [];
    if (data == null) return null; // first load still in flight
    const map = new Map<string, StrategyGroup>();
    {
        for (const p of data.snap?.positions ?? []) {
          const proto = String(p.protocolId ?? '');
          // Free balances sitting in a wallet are capital, not a strategy.
          if (!proto || /^wallet(-\d+)?$/i.test(proto)) continue;
          const meta = p.metadata as Record<string, unknown> | undefined;
          const vault = vaultNameOf(meta);
          // Per-position `wallet` is only tagged when the merge spans ≥2 wallets
          // (mergeSnaps skips a single-wallet snapshot). Fall back to the
          // snapshot's own address so the holding wallet is NEVER unknown —
          // without it the hub's Withdraw/Claim dead-ends at "not wired".
          const snapWallet =
            typeof data.snap?.wallet === 'string' && data.snap.wallet !== 'all' ? data.snap.wallet : undefined;
          const wallet = (typeof p.wallet === 'string' ? p.wallet : undefined) ?? snapWallet;
          const key = `${wallet ?? ''}:${proto}:${vault ?? ''}`;
          const g =
            map.get(key) ??
            {
              protocol: proto,
              name: vault ?? proto,
              vaultKey: typeof meta?.vaultKey === 'string' ? meta.vaultKey : undefined,
              wallet,
              legs: [],
              totalUSD: 0,
              hasHarvest: false,
              assetSymbol: '',
            };
          const usd = typeof p.amountUSD === 'number' ? p.amountUSD : 0;
          const kind = String(p.kind ?? '');
          const legSymbol = typeof meta?.symbol === 'string' ? meta.symbol : undefined;
          g.legs.push({
            kind,
            asset: vault ?? String(p.asset ?? '—'),
            usd,
            amountBase: p.amount != null ? String(p.amount) : undefined,
            symbol: legSymbol,
            iso: meta?.iso === true,
          });
          // Debt subtracts: a leveraged strategy's capital is its NET value.
          g.totalUSD += ['BORROW', 'DEBT'].includes(kind.toUpperCase()) ? -usd : usd;
          if (proto.toLowerCase() === 'ftso' || ['STAKE', 'STAKING', 'REWARD', 'REWARDS'].includes(kind.toUpperCase())) {
            g.hasHarvest = true;
          }
          // Underlying asset for the tile's logo — the protocol's own
          // conversion when present (invariant #9), else the leg symbol.
          const underlying = (meta?.underlying as { symbol?: string } | undefined)?.symbol;
          if (!g.assetSymbol) {
            g.assetSymbol =
              underlying ?? legSymbol ?? (proto.toLowerCase() === 'ftso' ? 'FLR' : vault ?? String(p.asset ?? ''));
          }
          // Exit rail for the partner vaults: shares (amount) + live price.
          const protoLower = proto.toLowerCase();
          // SUPPLY only: an Upshift CLAIM row is capital ALREADY queued to
          // leave (its shares are with the vault), so offering an exit over it
          // would build an instantRedeem the wallet cannot fill.
          if (
            protoLower === 'upshift' &&
            kind.toUpperCase() === 'SUPPLY' &&
            (meta?.vaultKey === 'earnxrp' || meta?.vaultKey === 'monarq')
          ) {
            g.vaultExit = {
              vault: meta.vaultKey,
              sharesBase: String(p.amount ?? '0'),
              sharePriceE6: typeof meta?.sharePriceE6 === 'string' ? meta.sharePriceE6 : null,
            };
          } else if (protoLower === 'firelight' && kind.toUpperCase() === 'STAKE') {
            g.vaultExit = {
              vault: 'firelight',
              sharesBase: String(p.amount ?? '0'),
              sharePriceE6: null,
            };
          } else if (protoLower === 'firelight' && kind.toUpperCase() === 'CLAIM') {
            // Money-in-flight: the redeem already burned the stXRP; the FXRP
            // waits in the vault's period queue. A claimable period wins over a
            // still-running one (that's the actionable "1 tap").
            const fc = meta?.firelightClaim as
              | { period?: number; claimable?: boolean; claimableAt?: string | null; estFxrpBase?: string | null }
              | undefined;
            if (fc && typeof fc.period === 'number') {
              const next = {
                period: fc.period,
                claimable: fc.claimable === true,
                claimableAt: fc.claimableAt ?? null,
                estFxrpBase: fc.estFxrpBase ?? null,
              };
              if (!g.claimExit || (next.claimable && !g.claimExit.claimable)) g.claimExit = next;
            }
          }
          map.set(key, g);
        }
    }
    return [...map.values()].sort((a, b) => b.totalUSD - a.totalUSD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, wallets.length]);
}

export default function WorkingStrategiesPanel({
  onPick,
  reloadKey = 0,
}: {
  onPick: () => void;
  /** Bump to re-read the on-chain footprint (after a withdraw, etc.). */
  reloadKey?: number;
}) {
  const { t } = useT();
  const groups = useStrategyGroups(reloadKey);
  const { wallets: myWallets } = useMyWallets();
  const aliasFor = (addr?: string) => {
    if (!addr) return null;
    const hit = myWallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    return hit?.label ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  if (groups === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink/40">
        <Loader2 className="w-6 h-6 animate-spin text-volt" />
        <span className="text-sm">{t('Reading your positions…')}</span>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-10 rounded-xl border border-dashed border-ink/10">
        <Activity className="w-8 h-8 mx-auto mb-3 text-ink/25" strokeWidth={1.5} />
        <p className="text-sm text-ink/70 font-medium">{t('No strategies working yet')}</p>
        <p className="text-xs text-ink/40 mt-1.5 max-w-sm mx-auto">
          {t('When a strategy is live, its real on-chain legs show up here, read from your wallets.')}
        </p>
        <PrimaryButton onClick={onPick} className="mt-5">
          {t('Choose a Strategy')} <ArrowRight className="w-4 h-4" />
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {groups.map((g) => (
        <div
          key={`${g.wallet ?? ''}:${g.protocol}:${g.name}`}
          className="flex flex-col rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-5"
        >
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <VaultIcon protocol={g.protocol} name={g.name} size={30} />
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink truncate leading-tight">{g.name}</h3>
                <div className="flex items-center gap-2 text-[11px] text-ink/40 min-w-0">
                  {g.name !== g.protocol && <span className="capitalize shrink-0">{g.protocol}</span>}
                  {g.wallet && (
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <Wallet size={10} className="shrink-0 text-ink/30" />
                      <span className="truncate">{aliasFor(g.wallet)}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span className="flex items-center gap-2 shrink-0">
              {g.assetSymbol && <AssetIcon symbol={g.assetSymbol} size={18} />}
              <span className="font-mono tabular-nums text-sm text-ink/70">
                {formatMoney(g.totalUSD)}
              </span>
            </span>
          </div>
          <ul className="space-y-1.5 mb-4">
            {g.legs.map((leg, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <Pill tone={['debt', 'borrow'].includes(leg.kind.toLowerCase()) ? 'danger' : 'success'}>
                    {t(KIND_WORD[leg.kind.toLowerCase()] ?? leg.kind)}
                  </Pill>
                  <span className="text-ink/55 font-mono truncate">{leg.asset}</span>
                </span>
                <span className="font-mono tabular-nums text-ink/70 shrink-0">
                  {formatMoney(Math.abs(leg.usd))}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/app/portfolio?tab=defi"
            className="mt-auto inline-flex items-center gap-1.5 text-xs text-volt hover:text-volt/80 transition-colors"
          >
            {t('Open in Portfolio')} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ))}
    </div>
  );
}

'use client';

/**
 * FlareDemoEarn — the Strategy surface (Earn tab), structured as a hub of four
 * doors: PICK a working strategy pack · CREATE one with text (NLP → intent) ·
 * MOVEMENTS (send/receive between wallets + the XRPL savings-escrow surface,
 * absorbed from /app/savings and renamed 2026-07-12) ·
 * CREATE MANUALLY (compose by hand — MoneyFlows and tools). Earn is where
 * capital gets programmed; the strategies themselves (running + saved) live
 * in Estrategias since the 2026-07-12 UI reorg.
 *
 * Per docs/context/Defibro_Demos_Mainnet_Flare_Plan_2026-06-22.md, the packs on
 * offer are ONLY the two live "entradas" we run on mainnet (NOT the DefiLlama
 * catalogue, which is preserved untouched at /safe-markets and only hidden here):
 *
 *   E1 — FXRP → Kinetic ISO: supply FXRP collateral + borrow USDT0.
 *        Sign rail: Xaman → Flare Smart Account (XRPL Payment).
 *   E2 — FLR  → wrap + delegate WFLR vote power to an FTSO data provider.
 *        Sign rail: EVM direct (MetaMask et al.).
 *
 * Each pack card discloses its REAL composition (the ordered on-chain legs) and
 * opens a modal where the user picks WHICH linked Astryum wallet signs
 * (2026-07-12): an XRPL wallet pays XRP that is minted into FXRP via the
 * Smart Account rail, while a Flare EVM wallet that already holds FXRP enters
 * DIRECTLY — same inner batch, no XRPL mint, no minting fee. The modal asks
 * for the amount, prepares the UNSIGNED payload via /api/flare-demo, and hands
 * it to that exact wallet. If it is not connected in Astryum, the modal blocks
 * and offers to connect it on the spot. Astryum never signs (CLAUDE.md §0 /
 * invariant #1).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProtectRuleCard } from '../moneyflows/ProtectRuleCard';
import { useDisconnect } from 'wagmi';
import { motion } from 'framer-motion';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Wallet,
  ExternalLink,
  Coins,
  Droplets,
  Sprout,
  Info,
  Flame,
  Layers,
  Landmark,
  Compass,
} from 'lucide-react';
import { StrategyFinder } from './StrategyFinder';
import { Card, GhostButton, MicroLabel, PageHeader, PrimaryButton } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import { DUR, EASE_OUT, PulseDot, RevealGroup, RevealItem } from '../ui/motion';
import { ConstellationScene, FlowForgeScene, MoonScene, OrbitScene } from './icons';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { formatMoneyCompact } from '../../lib/formatMoney';
import { hfWord } from '../../lib/healthScore';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useUniversalConnect } from '../../lib/wallet/useUniversalConnect';
import { useAuthorities } from '../../hooks/useAuthorities';
import { listMyWallets, type BackendWallet } from '../../services/walletLinkService';
import { transferRailOf } from '../../lib/wallet/nativeBalance';
import { rulePrefillScope, stashRulePrefill } from '../../lib/automation/rulePrefill';
import { getUserRegion } from '../../lib/region';
import { startPending } from '../../lib/settlement/settlement';
import { releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { type LaunchStrategy } from './StrategyAgent';
import { StrategyLLMChat } from './StrategyLLMChat';
import ManualStrategyBuilder from './ManualStrategyBuilder';
import MovementsPanel from '../movements/MovementsPanel';
import StrategiesPage from '../../app/app/strategies/page';
import CouncilVaultEntry from '../legacy/CouncilVaultEntry';
import ProductTour from '../onboarding/ProductTour';
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

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// Sentinel option of the FTSO provider dropdown — switches to manual entry.
const CUSTOM_PROVIDER = '__custom__';

/* ------------------------------------------------------------------ */
/* DEMO VAULT CATALOGUE (the two interactions — nothing else)          */
/* ------------------------------------------------------------------ */

export type VaultKind = 'e1' | 'e2' | 'e3' | 'v-firelight' | 'v-earnxrp' | 'v-monarq';

/** Partner-vault kinds share one backend route (/vault/prepare) — this maps the
 *  door kind to the backend's vault key. */
const VAULT_KEY: Partial<Record<VaultKind, 'firelight' | 'earnxrp' | 'monarq'>> = {
  'v-firelight': 'firelight',
  'v-earnxrp': 'earnxrp',
  'v-monarq': 'monarq',
};

interface DemoVault {
  kind: VaultKind;
  asset: string;
  title: string;
  action: string;
  /** DEFAULT sign rail. FXRP packs (rail 'xrpl') also accept a linked Flare
   *  EVM wallet that already holds FXRP — the EVM-direct entry, no XRPL mint;
   *  the modal's wallet picker decides which rail actually signs. */
  rail: 'xrpl' | 'evm';
  railLabel: string;
  /** ONE plain-language sentence: what the strategy does with your tokens. */
  plain: string;
  /** Animated token journey: wallet → conversion → venue → outcome. */
  flow: { token: string; sub: string }[];
  /** The facts a person actually asks: converts what, works where, risk, protection. */
  facts: { label: string; value: string; tone?: 'amber' | 'emerald' }[];
  /** The REAL underlying legs this pack is composed of, in execution order. */
  legs: string[];
  icon: React.ReactNode;
  accent: string; // tailwind text/border accent
}

/**
 * §3 (2026-07-24; PA-unmint built 2026-07-26): the road BACK to native XRP,
 * said at ENTRY time. Every XRPL-rail pack leaves FXRP on the Smart Account —
 * and the Smart Account CAN now redeem it back to native XRP (Unmint on your
 * position), with the protocol's on-chain minimum per redemption
 * (AssetManagerFXRP.minimumRedeemAmountUBA = 5 XRP on mainnet, stated as
 * protocol data — the live figure rides the signing disclosure).
 */
const FXRP_EXIT_LEG =
  'Exit: Unmint back to native XRP from this account (5 XRP protocol minimum per redemption; the FAssets agent pays the XRP after the burn)';

const DEMO_VAULTS: DemoVault[] = [
  {
    kind: 'e1',
    asset: 'FXRP',
    title: 'FXRP → Kinetic (carry)',
    action: 'Supply FXRP + borrow USDT0',
    rail: 'xrpl',
    railLabel: 'Xaman or Flare wallet',
    plain:
      'Your XRP becomes FXRP on Flare, works as collateral in the Kinetic market, and you borrow USDT0 against it — watched by a stop-loss.',
    flow: [
      { token: 'XRP', sub: 'your wallet' },
      { token: 'FXRP', sub: 'minted 1:1' },
      { token: 'Kinetic', sub: 'collateral' },
      { token: '+USDT0', sub: 'borrowed' },
    ],
    facts: [
      { label: 'Converts', value: 'XRP → FXRP (1:1)' },
      { label: 'Works in', value: 'Kinetic ISO lending market' },
      { label: 'Risk', value: 'Medium — it borrows against your collateral', tone: 'amber' },
      { label: 'Protection', value: 'Stop-loss at HF 1.10 — you choose it', tone: 'emerald' },
    ],
    legs: [
      'FAssets direct-mint: your XRP is minted into FXRP on Flare',
      'The FXRP lands in your Flare Smart Account',
      'Kinetic ISO market: FXRP supplied as collateral',
      'Kinetic ISO market: USDT0 borrowed at your chosen ratio',
      'Protection: a repay intent is prepared if HF hits your trigger',
      FXRP_EXIT_LEG,
    ],
    icon: <Droplets className="w-5 h-5" />,
    // One identity voice across the catalogue (de-AI pass 2026-07-21): the
    // scene/icon/title differentiate the card, not a hand-picked accent hue.
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'e3',
    asset: 'FXRP',
    title: 'FXRP → Kinetic (lend-only)',
    action: 'Put your XRP to work',
    rail: 'xrpl',
    railLabel: 'Xaman or Flare wallet',
    plain:
      'Your XRP becomes FXRP on Flare and is supplied to the Kinetic market to earn the protocol rate. No loans, no debt, no liquidation — withdraw whenever and you get FXRP back.',
    flow: [
      { token: 'XRP', sub: 'your wallet' },
      { token: 'FXRP', sub: 'minted 1:1' },
      { token: 'Kinetic', sub: 'supplied' },
      { token: 'Yield', sub: 'protocol rate' },
    ],
    facts: [
      { label: 'Converts', value: 'XRP → FXRP (1:1)' },
      { label: 'Works in', value: 'Kinetic ISO — plain supply' },
      { label: 'Risk', value: 'Low — no debt, no liquidation', tone: 'emerald' },
      { label: 'Withdraw', value: 'Anytime — returns FXRP', tone: 'emerald' },
    ],
    legs: [
      'FAssets direct-mint: your XRP is minted into FXRP on Flare',
      'The FXRP lands in your Flare Smart Account',
      'Kinetic ISO market: FXRP supplied as a plain deposit (no borrow)',
      'Withdraw anytime returns FXRP',
      FXRP_EXIT_LEG,
    ],
    icon: <Sprout className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'v-firelight',
    asset: 'FXRP',
    title: 'FXRP → Firelight (stXRP)',
    action: 'Stake FXRP, receive stXRP',
    rail: 'xrpl',
    railLabel: 'Xaman or Flare wallet',
    plain:
      'Your XRP becomes FXRP on Flare and is staked in Firelight — you receive stXRP 1:1, in the same vault behind the Xaman one-click flow. Per Firelight, staking rewards start in Phase 2 (not live yet).',
    flow: [
      { token: 'XRP', sub: 'your wallet' },
      { token: 'FXRP', sub: 'minted 1:1' },
      { token: 'Firelight', sub: 'staked' },
      { token: 'stXRP', sub: 'liquid receipt' },
    ],
    facts: [
      { label: 'Converts', value: 'XRP → FXRP (1:1)' },
      // GLOSSARY §6.5 (cifras solo verificables): the "$66M TVL" hardcoded here
      // froze a live figure into the bundle — the fund size belongs to live data.
      { label: 'Works in', value: 'Firelight staking vault' },
      { label: 'Risk', value: 'Low — no debt, fully on-chain', tone: 'emerald' },
      { label: 'Rewards', value: 'Phase 1 — not live yet (per Firelight)', tone: 'amber' },
    ],
    legs: [
      'FAssets direct-mint: your XRP is minted into FXRP on Flare',
      'The FXRP lands in your Flare Smart Account',
      'Firelight stXRP vault (ERC-4626): FXRP deposited, stXRP minted to your Smart Account',
      'Withdraw redeems stXRP back to FXRP via the vault claim flow',
      FXRP_EXIT_LEG,
    ],
    icon: <Flame className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'v-earnxrp',
    asset: 'FXRP',
    title: 'FXRP → earnXRP (Clearstar)',
    action: 'Deposit FXRP in the earnXRP vault',
    rail: 'xrpl',
    railLabel: 'Xaman or Flare wallet',
    plain:
      "Your XRP becomes FXRP and is deposited into the Flare XRP Yield Vault — the same earnXRP vault D'CENT distributes, curated on-chain by Clearstar. You receive earnXRP; withdraw instantly for a 0.10% fee or free after the 24h epoch.",
    flow: [
      { token: 'XRP', sub: 'your wallet' },
      { token: 'FXRP', sub: 'minted 1:1' },
      { token: 'earnXRP', sub: 'vault deposit' },
      { token: 'Yield', sub: 'vault share price' },
    ],
    facts: [
      { label: 'Converts', value: 'XRP → FXRP (1:1)' },
      { label: 'Works in', value: 'Upshift vault curated by Clearstar' },
      { label: 'Risk', value: 'Low-medium — on-chain strategies, live deposit cap', tone: 'emerald' },
      { label: 'Withdraw', value: 'Instant (0.10% fee) or free after 24h epoch' },
    ],
    legs: [
      'FAssets direct-mint: your XRP is minted into FXRP on Flare',
      'The FXRP lands in your Flare Smart Account',
      'earnXRP vault (Upshift): FXRP deposited, earnXRP shares minted to your Smart Account',
      'Yield accrues in the vault share price (live on-chain, shown before signing)',
      'Withdraw: instantRedeem (0.10% fee) or requestRedeem (free, 24h epoch)',
      FXRP_EXIT_LEG,
    ],
    icon: <Layers className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'v-monarq',
    asset: 'FXRP',
    title: 'FXRP → Monarq (MXRPY)',
    action: 'Deposit FXRP with Monarq',
    rail: 'xrpl',
    railLabel: 'Xaman or Flare wallet',
    plain:
      'Your XRP becomes FXRP and is deposited into the Monarq XRP Yield Vault (MXRPY). Its strategies run OFF-chain (options, basis) by Monarq Asset Management — manager risk you cannot verify on-chain. Withdrawals wait a 7-day epoch unless you pay the 0.30% instant fee.',
    flow: [
      { token: 'XRP', sub: 'your wallet' },
      { token: 'FXRP', sub: 'minted 1:1' },
      { token: 'MXRPY', sub: 'vault deposit' },
      { token: 'Manager', sub: 'off-chain strategies' },
    ],
    facts: [
      { label: 'Converts', value: 'XRP → FXRP (1:1)' },
      { label: 'Works in', value: 'Monarq vault on Upshift (CeDeFi)' },
      { label: 'Risk', value: 'Medium — off-chain manager, not verifiable on-chain', tone: 'amber' },
      { label: 'Withdraw', value: '7-day epoch, or instant with 0.30% fee', tone: 'amber' },
    ],
    legs: [
      'FAssets direct-mint: your XRP is minted into FXRP on Flare',
      'The FXRP lands in your Flare Smart Account',
      'Monarq vault (Upshift): FXRP deposited, MXRPY shares minted to your Smart Account',
      'Monarq Asset Management runs options/basis strategies OFF-chain (manager risk)',
      'Withdraw: requestRedeem (free, 7-day epoch) or instantRedeem (0.30% fee)',
      FXRP_EXIT_LEG,
    ],
    icon: <Landmark className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'e2',
    asset: 'FLR',
    title: 'FLR → FTSO',
    action: 'Wrap + delegate to FTSO',
    rail: 'evm',
    railLabel: 'EVM direct',
    plain:
      'Your FLR is wrapped into WFLR and its vote power delegated to an FTSO data provider — rewards accrue every ~3.5 days.',
    flow: [
      { token: 'FLR', sub: 'your wallet' },
      { token: 'WFLR', sub: 'wrapped 1:1' },
      { token: 'FTSO', sub: 'delegated' },
      { token: 'Rewards', sub: 'per epoch' },
    ],
    facts: [
      { label: 'Converts', value: 'FLR → WFLR (1:1, reversible)' },
      { label: 'Works in', value: 'FTSO delegation' },
      { label: 'Risk', value: 'Low — no debt, undo any time', tone: 'emerald' },
      { label: 'Rewards', value: 'Every ~3.5-day epoch (protocol data)' },
    ],
    legs: [
      'WNat contract: FLR wrapped into WFLR',
      'WFLR vote power delegated to the FTSO provider you pick',
      'FTSO rewards accrue per ~3.5-day epoch (protocol data, not an Astryum offer)',
    ],
    icon: <Coins className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
];

/* ------------------------------------------------------------------ */
/* WHAT A COUNCIL CANNOT REACH — the cage's shape, not a policy         */
/* ------------------------------------------------------------------ */
/**
 * A council's capital enters a venue through the vault on Flare, and that
 * contract knows exactly two moves: `directTo` (put principal to work in a
 * whitelisted venue) and `recall` (bring it back). It has NO borrow function —
 * so a pack whose composition borrows cannot be composed as a council order at
 * all: not from the card, not from a deep link, not from the agent. Saying so
 * on the card is the honest version; the alternative is a Start button that
 * walks a family into a dead end (founder 2026-08-04).
 *
 * ONLY the borrowing entry is out of reach. The lend-only route (e3) is a plain
 * supply — exactly what `directTo` does — and stays fully available.
 */
const GOVERNED_UNSUPPORTED: Partial<Record<VaultKind, string>> = {
  e1: 'The vault on Flare has no borrow function: a council order can only put principal to work in a venue and bring it back. This entry borrows USDT0 against the collateral, so it cannot be composed as a council order. The lend-only entry does the same supply without debt, and it is available.',
};

/** Why this pack is out of reach for the ACTIVE authority, or null if it isn't. */
function governedBlockOf(kind: VaultKind, governed: boolean): string | null {
  return governed ? (GOVERNED_UNSUPPORTED[kind] ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* CURATED PRODUCT METADATA — the specifics DeFiLlama/on-chain data can't    */
/* tell you: the protocol name, its VERIFIED website (so the user can see    */
/* exactly where their money goes), and HOW this product actually generates  */
/* its yield. Honest, product-specific, never a promise (invariant #9).      */
/* Websites verified against PROTOCOL_DOMAINS in ui/StrategyIcons.tsx.        */
/* ------------------------------------------------------------------ */
interface ProductMeta {
  protocolName: string;
  website: string;
  /** ONE paragraph: exactly HOW this product earns — the source of the yield. */
  yieldMechanism: string;
}

const PRODUCT_META: Record<VaultKind, ProductMeta> = {
  e1: {
    protocolName: 'Kinetic',
    website: 'https://kinetic.market',
    yieldMechanism:
      'Kinetic is a Compound/Benqi-style money market on Flare. Your FXRP earns the supply interest that borrowers pay (the base APR, which floats with how much of the market is borrowed), plus FLR reward incentives distributed to suppliers. In the carry you additionally borrow USDT0 against that FXRP and redeploy it — so your net is the carry spread minus the USDT0 borrow cost, watched by a stop-loss. Rates are live and move with utilization.',
  },
  e3: {
    protocolName: 'Kinetic',
    website: 'https://kinetic.market',
    yieldMechanism:
      'Your FXRP is supplied to the Kinetic FXRP market and earns the supply interest borrowers pay (the base APR) plus FLR reward incentives paid to suppliers. No borrow, no debt, no liquidation. The rate floats with market utilization — the more of the pool that is borrowed, the higher the supply APR.',
  },
  'v-firelight': {
    protocolName: 'Firelight',
    website: 'https://firelight.fi',
    yieldMechanism:
      'Firelight is an XRP liquid-staking vault on Flare. Your FXRP is deposited and you receive stXRP 1:1 — a liquid receipt that will accrue value as staking rewards are distributed. Per Firelight, reward distribution begins in Phase 2, so there is no live yield to show yet: today the value is the liquid stXRP position itself, redeemable back to FXRP.',
  },
  'v-earnxrp': {
    protocolName: 'Upshift · earnXRP (curated by Clearstar)',
    website: 'https://upshift.finance',
    yieldMechanism:
      'earnXRP is the Flare XRP Yield Vault on Upshift (August Digital infrastructure), curated on-chain by Clearstar and the same vault D’CENT distributes. Your FXRP is deposited and the vault runs verifiable on-chain strategies; the yield accrues in the vault’s share price (NAV per share), so your earnXRP is worth progressively more FXRP over time. Everything is on-chain and auditable.',
  },
  'v-monarq': {
    protocolName: 'Upshift · Monarq (MXRPY)',
    website: 'https://upshift.finance',
    yieldMechanism:
      'The Monarq XRP Yield Vault (MXRPY) is an Upshift vault whose strategies (options, basis) are run OFF-chain by Monarq Asset Management — a CeDeFi profile: the manager’s positions are not verifiable on-chain, which is manager risk you take on. The yield accrues in the vault’s share price. Withdrawals wait a 7-day epoch unless you pay the instant-redeem fee.',
  },
  e2: {
    protocolName: 'Flare · FTSO',
    website: 'https://flare.network',
    yieldMechanism:
      'Your FLR is wrapped into WFLR and its vote power delegated to an FTSO (Flare Time Series Oracle) data provider. The provider earns rewards for supplying accurate price data, and shares them with the FLR that delegated to it. Rewards accrue per reward epoch (~3.5 days) as a protocol datum — not a fixed rate — and you can undo the delegation at any time. This is not indexed as a DeFiLlama pool.',
  },
};

/* ------------------------------------------------------------------ */
/* LIVE YIELD — protocol data with a source (invariant #9). GET one call */
/* for all six cards; a NUMBER only when the protocol gives one, else an  */
/* honest label. Never a made-up figure, never an Astryum promise.        */
/* ------------------------------------------------------------------ */

type YieldEntry =
  | {
      kind: 'apr' | 'apy';
      pct: number;
      source: string;
      note?: string;
      borrow?: { asset: string; aprPct: number };
      /** Split honesto cuando el headline compone interés base + recompensas. */
      baseAprPct?: number;
      rewardApyPct?: number;
    }
  | { kind: 'none'; pct: null; source: null; label: string };

type YieldMap = Record<string, YieldEntry>;

/** Polls /flare-demo/yields so the cards show the CURRENT rate. Refreshes on a
 *  slow cadence (rates move slowly) and on tab refocus. Never throws. */
function useStrategyYields(): { yields: YieldMap | null; asOf: string | null } {
  const [state, setState] = useState<{ yields: YieldMap | null; asOf: string | null }>({
    yields: null,
    asOf: null,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // /flare-demo is a SIWE-gated router (same tier as the prepares); the
        // Earn surface is a logged-in context, so send the bearer token.
        const res = await fetch(`${API_BASE}/flare-demo/yields`, { headers: authHeaders() });
        if (!res.ok) return;
        const json = (await res.json()) as { yields?: YieldMap; asOf?: string };
        if (!cancelled && json.yields) setState({ yields: json.yields, asOf: json.asOf ?? null });
      } catch {
        /* keep whatever we had — the card shows "live rate loading" until it arrives */
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return state;
}

/** Format a yield entry for a chip: "4.20% APR" or the honest label. */
function yieldChipText(y: YieldEntry | undefined): { pct: string | null; label: string | null } {
  if (!y) return { pct: null, label: null };
  if (y.kind === 'none') return { pct: null, label: y.label };
  return { pct: `${y.pct.toFixed(2)}% ${y.kind.toUpperCase()}`, label: null };
}

/* ------------------------------------------------------------------ */
/* PRODUCT INFO — the full data sheet for the "More info" modal. DeFiLlama */
/* market data where the product is indexed (Kinetic), Upshift API for the  */
/* vaults DeFiLlama doesn't list. Fetched lazily (heavier than the chip) and */
/* cached module-wide so re-opening a modal is instant.                      */
/* ------------------------------------------------------------------ */
interface LlamaInfo {
  poolId: string; project: string; symbol: string;
  tvlUsd: number | null; apy: number | null; apyBase: number | null; apyReward: number | null;
  apyMean30d: number | null; apyPct1D: number | null; apyPct7D: number | null; apyPct30D: number | null;
  ilRisk: string | null; exposure: string | null; stablecoin: boolean | null; dataPoints: number | null;
  rewardTokens: string[]; underlyingTokens: string[];
  outlook: { class: string; probability: number | null } | null;
  url: string; source: string;
}
interface UpshiftInfo {
  vaultName: string | null; receiptToken: string | null; tvlUsd: number | null;
  apy1d: number | null; apy7d: number | null; apy30d: number | null; risk: string | null; source: string;
}
interface BorrowInfo { asset: string; aprPct: number | null; source: string | null }
interface ProductInfo { defillama?: LlamaInfo | null; upshift?: UpshiftInfo | null; borrow?: BorrowInfo | null }
type ProductInfoMap = Record<string, ProductInfo>;

let productInfoCache: { at: number; map: ProductInfoMap } | null = null;

/** Lazily loads /flare-demo/product-info (cached ~10 min module-wide). */
function useProductInfo(): ProductInfoMap | null {
  const fresh = productInfoCache && Date.now() - productInfoCache.at < 600_000 ? productInfoCache.map : null;
  const [map, setMap] = useState<ProductInfoMap | null>(fresh);
  useEffect(() => {
    if (map) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/flare-demo/product-info`, { headers: authHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { products?: ProductInfoMap };
        if (!cancelled && j.products) {
          productInfoCache = { at: Date.now(), map: j.products };
          setMap(j.products);
        }
      } catch {
        // Resolve to an EMPTY map (not cached) so the panel degrades to the
        // honest "not indexed / see the protocol" state instead of an endless
        // skeleton; the next modal open retries the fetch.
        if (!cancelled) setMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [map]);
  return map;
}

/* ------------------------------------------------------------------ */
/* SMALL UI HELPERS                                                     */
/* ------------------------------------------------------------------ */

/**
 * Animated token journey — chips fade in left to right so the eye follows the
 * capital: wallet → conversion → venue → outcome. Pure presentation.
 */
function FlowStrip({ steps }: { steps: { token: string; sub: string }[] }) {
  const { t } = useT();
  return (
    <div className="flex items-stretch gap-1.5 mb-4 overflow-x-auto scrollbar-none">
      {steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: DUR.base, ease: EASE_OUT }}
              className="self-center text-volt shrink-0"
              aria-hidden
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.span>
          )}
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: DUR.base, ease: EASE_OUT }}
            className="flex flex-col items-center justify-center px-3 py-2 rounded-lg border border-ink/10 bg-ink/[0.04] min-w-[72px] shrink-0"
          >
            <span className="text-xs font-semibold text-ink font-mono">{s.token}</span>
            <span className="text-[9px] text-ink/40 mt-0.5 whitespace-nowrap">{t(s.sub)}</span>
          </motion.span>
        </Fragment>
      ))}
    </div>
  );
}

/** Field label with a tap-to-open ⓘ explainer (mobile-friendly — no hover).
 *  Module-level on purpose: defined inside the modal it would remount (and
 *  close) on every parent re-render, i.e. on each keystroke. */
function FieldLabelInfo({ label, info }: { label: string; info: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        <label className="text-xs text-ink/40">{label}</label>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`${label} — info`}
          aria-expanded={open}
          className={`transition-colors ${open ? 'text-volt' : 'text-ink/30 hover:text-ink/60'}`}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <p className="mb-2 rounded-lg border border-ink/10 bg-ink/[0.04] px-3 py-2 text-[11px] leading-relaxed text-ink/60">
          {info}
        </p>
      )}
    </>
  );
}

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className="text-ink/45">{label}</span>
      <span className={`text-ink/85 text-right ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  );
}

function fmt(n: number | undefined, digits = 4): string {
  if (n == null || isNaN(n)) return '—';
  return fmtQtyActive(n, digits); // app-locale aware (Fase 3)
}

/* ------------------------------------------------------------------ */
/* MODAL — drives one demo entry end to end                            */
/* ------------------------------------------------------------------ */

interface E1Prepared {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment: { TransactionType: 'Payment'; Destination: string; Amount: string; Memos: unknown[] };
  /** Precomputed A1 (stop-loss) inputs — the SAME values the user chose/reviewed
   *  for this entry. The PROTECT template prefill reuses them (invariant: A1
   *  reuses these EXACT values, it never recomputes). */
  a1: {
    triggerPriceUSD: number;
    targetHF: number;
    borrowRatio: number;
    collateralFactor: number;
    fxrpPriceUSD: number;
    supplyUBA: string;
    borrowUsdt0Base: string;
  };
  disclosure: {
    grossXrp: number;
    mintingFeeXrp: number;
    executorFeeXrp: number;
    fxrpMinted: number;
    fxrpSupplied: number;
    usdt0Borrowed: number;
    borrowRatio: number;
    collateralFactor: number;
    fxrpPriceUSD: number;
    entryHF: number;
    targetHF: number;
    triggerPriceUSD: number;
    note: string;
  };
}

interface E2Prepared {
  rail: 'evm';
  chainId: number;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  disclosure: { amountFlr: number; provider: string; bips: number; flrPriceUSD: number; note: string };
}

interface E3Prepared {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment: { TransactionType: 'Payment'; Destination: string; Amount: string; Memos: unknown[] };
  disclosure: {
    grossXrp: number;
    mintingFeeXrp: number;
    executorFeeXrp: number;
    fxrpMinted: number;
    fxrpSupplied: number;
    fxrpPriceUSD: number;
    suppliedValueUSD: number;
    supplyApyPct: number | null;
    supplyApySource: string | null;
    noDebt: boolean;
    noLiquidationRisk: boolean;
    note: string;
  };
}

interface VaultPrepared {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment: { TransactionType: 'Payment'; Destination: string; Amount: string; Memos: unknown[] };
  disclosure: {
    vault: 'firelight' | 'earnxrp' | 'monarq';
    vaultName: string;
    vaultAddress: string;
    receiptToken: string;
    riskProfile: 'onchain' | 'cedefi';
    grossXrp: number;
    mintingFeeXrp: number;
    executorFeeXrp: number;
    fxrpMinted: number;
    fxrpDeposited: number;
    fxrpPriceUSD: number;
    depositedValueUSD: number;
    sharePrice: number | null;
    sharePriceSource: string;
    apyPct30d: number | null;
    apySource: string | null;
    capacity: { depositCapFxrp: number; usedFxrp: number; remainingFxrp: number | null } | null;
    withdrawal: {
      kind: 'erc4626-claim' | 'instant-or-epoch';
      instantRedemptionFeeBps: number | null;
      epochLagSeconds: number | null;
      note: string;
    };
    noDebt: boolean;
    noLiquidationRisk: boolean;
    note: string;
  };
}

/* EVM-direct variants (2026-07-12): the signing wallet is a linked Flare EVM
 * wallet that ALREADY holds FXRP — the backend returns the same inner batch as
 * plain unsigned EVM calls (the E2 rail). No XRPL mint, no minting fee. */

interface EvmCall {
  to: string;
  data: string;
  value: string;
  chainId: number;
  label?: string;
}

interface DirectPreparedBase {
  rail: 'evm';
  entry: 'evm-direct';
  chainId: number;
  /** The wallet that signs AND holds the resulting position. */
  account: string;
  calls: EvmCall[];
}

interface E1PreparedEvm extends DirectPreparedBase {
  a1: E1Prepared['a1'];
  disclosure: {
    fxrpSupplied: number;
    usdt0Borrowed: number;
    borrowRatio: number;
    collateralFactor: number;
    fxrpPriceUSD: number;
    entryHF: number;
    targetHF: number;
    triggerPriceUSD: number;
    note: string;
  };
}

interface E3PreparedEvm extends DirectPreparedBase {
  disclosure: {
    fxrpSupplied: number;
    fxrpPriceUSD: number;
    suppliedValueUSD: number;
    supplyApyPct: number | null;
    supplyApySource: string | null;
    note: string;
  };
}

interface VaultPreparedEvm extends DirectPreparedBase {
  disclosure: Omit<
    VaultPrepared['disclosure'],
    'grossXrp' | 'mintingFeeXrp' | 'executorFeeXrp' | 'fxrpMinted'
  > & { entry: 'evm-direct' };
}

type Prepared =
  | E1Prepared
  | E2Prepared
  | E3Prepared
  | VaultPrepared
  | E1PreparedEvm
  | E3PreparedEvm
  | VaultPreparedEvm;

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'error';

function DemoVaultModal({
  vault,
  onClose,
  initial,
}: {
  vault: DemoVault;
  onClose: () => void;
  /** Pre-compiled inputs (NLP layer) — the user still reviews and signs. */
  initial?: { amount?: string; ratio?: string; targetHF?: string };
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const connect = useUniversalConnect(async () => {});
  const { disconnectAsync } = useDisconnect();
  // The signing scope follows the AUTHORITY SWITCHER: a single authority
  // narrows the picker to its wallet; a governed authority blocks personal
  // Earn entirely (council capital moves by quorum-signed council order, never
  // by a personal signature while the bar says "Governing…").
  const { active: activeAuthority, activeGoverned } = useAuthorities();

  // Linked wallets (GET /api/wallets/mine) — the full rows, because the picker
  // needs walletType/nickname, not just addresses.
  const [myWallets, setMyWallets] = useState<BackendWallet[]>([]);
  const [walletsNonce, setWalletsNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listMyWallets()
      .then((ws) => {
        if (!cancelled) setMyWallets(ws);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [walletsNonce]);
  const reloadWallets = useCallback(() => setWalletsNonce((n) => n + 1), []);

  // Which linked Astryum wallets can sign this entry. FXRP packs accept BOTH
  // rails: an XRPL wallet pays XRP (minted 1:1 into FXRP via the Smart
  // Account), and a Flare EVM wallet holding FXRP enters DIRECTLY — no mint.
  // The FLR entry (e2) is EVM-only. The Personal Account is EXCLUDED: it only
  // executes 0xFE userOps signed from XRPL, it can never sign an EVM tx — its
  // FXRP enters via the Xaman rail instead.
  const allCandidates = useMemo(
    () =>
      myWallets
        .filter((w) => w.walletType !== 'smart-account')
        .map((w) => ({ record: w, rail: transferRailOf(w) }))
        .filter(
          (c): c is { record: BackendWallet; rail: 'xrpl' | 'evm' } =>
            c.rail !== null && (vault.kind !== 'e2' || c.rail === 'evm'),
        ),
    [myWallets, vault.kind],
  );
  const candidates = useMemo(() => {
    if (activeGoverned) return []; // governed mode: see the banner below
    if (activeAuthority.kind === 'single') {
      const key = activeAuthority.wallet.address.toLowerCase();
      return allCandidates.filter((c) => c.record.address.toLowerCase() === key);
    }
    return allCandidates;
  }, [allCandidates, activeAuthority, activeGoverned]);

  // The user picks the signing wallet. Default: the wallet already connected
  // as a signer (least surprise), else the pack's default rail, else the first.
  const [selectedAddr, setSelectedAddr] = useState('');
  useEffect(() => {
    if (candidates.length === 0) return;
    if (candidates.some((c) => c.record.address === selectedAddr)) return;
    const connected = candidates.find(
      (c) =>
        (c.rail === 'xrpl' &&
          xrpl.address &&
          c.record.address.toLowerCase() === xrpl.address.toLowerCase()) ||
        (c.rail === 'evm' &&
          evm.address &&
          c.record.address.toLowerCase() === evm.address.toLowerCase()),
    );
    const defaultRail = candidates.find((c) => c.rail === vault.rail);
    setSelectedAddr((connected ?? defaultRail ?? candidates[0]).record.address);
  }, [candidates, selectedAddr, xrpl.address, evm.address, vault.rail]);

  const selected = candidates.find((c) => c.record.address === selectedAddr) ?? null;
  /** The rail the SELECTED wallet signs on — decides prepare body + payload. */
  const activeRail: 'xrpl' | 'evm' = selected?.rail ?? vault.rail;

  // The wallet partner that will SIGN must hold this exact address.
  const signerAddress = activeRail === 'xrpl' ? xrpl.address : evm.address;
  const signerMatches =
    !!selected &&
    !!signerAddress &&
    signerAddress.toLowerCase() === selected.record.address.toLowerCase();

  // Inputs (optionally pre-filled by the NLP compiler — always user-reviewable)
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [borrowRatio, setBorrowRatio] = useState(initial?.ratio ?? '0.30'); // E1
  const [targetHF, setTargetHF] = useState(initial?.targetHF ?? '1.10'); // E1
  const [provider, setProvider] = useState(''); // E2 FTSO data provider
  const [bipsPct, setBipsPct] = useState('100'); // E2 delegation %

  // FTSO provider directory (E2 only) — the public TowoLabs registry the
  // explorers render, served A–Z by the backend (#9: directory, not ranking).
  const [providerDir, setProviderDir] = useState<Array<{ address: string; name: string }>>([]);
  // 'list' offers the directory dropdown; 'custom' the manual 0x… input.
  const [providerMode, setProviderMode] = useState<'list' | 'custom'>('list');

  const [phase, setPhase] = useState<Phase>('form');
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  // Una entrada 0xFE preparada y NO firmada libera su asiento de nonce al
  // abandonar (el usuario no queda tapiado por NONCE_SEAT_TAKEN). Cleanup de
  // desmontaje vía ref (captura X, Escape y cierre del padre); nunca tras firmar.
  const seatRef = useRef<{ memoHex?: string; abandonable: boolean }>({ abandonable: false });
  seatRef.current = {
    memoHex: prepared?.rail === 'xrpl' ? (prepared as { memoHex?: string }).memoHex : undefined,
    abandonable: prepared?.rail === 'xrpl' && phase === 'review',
  };
  useEffect(() => {
    return () => {
      if (seatRef.current.abandonable) releaseHandoffSeat(seatRef.current.memoHex);
    };
  }, []);
  const releaseSeatIfUnsigned = () => {
    if (prepared?.rail === 'xrpl' && phase === 'review') {
      releaseHandoffSeat((prepared as { memoHex?: string }).memoHex);
    }
  };
  // Invariant #11 — the prepare's dry-run verdict (e1 today; optional elsewhere).
  const preflight = (prepared as { preflight?: PreflightInfo } | null)?.preflight;
  const [errorMsg, setErrorMsg] = useState('');
  const [connecting, setConnecting] = useState(false);
  // Settlement is the PRIMARY state after signing — 'done' means "signed", the
  // machine (lib/settlement) says settled/failed/stalled. The XRPL rail polls
  // mint-status (0xFE really executed — stuck-mint lesson, 2026-07-12), the
  // EVM rails the receipt / 5792 bundle status. No local poll, no local green.
  const settlement = useSettlement();

  const amountNum = parseFloat(amount) || 0;

  useEffect(() => {
    if (vault.kind !== 'e2') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/ftso/providers/registry`, {
          headers: authHeaders(),
          credentials: 'include',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
        const items = (body.data ?? [])
          .map((p) => ({
            address: String(p.address ?? ''),
            name: typeof p.name === 'string' ? p.name : '',
          }))
          .filter((p) => ADDRESS_RE.test(p.address) && p.name);
        if (!cancelled) setProviderDir(items);
      } catch {
        /* the directory is optional — manual address entry still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault.kind]);

  /** Connect the partner that signs on `rail` — for EVM, drop the live session
   *  first so the picker appears instead of the already-connected account. */
  const connectSigner = useCallback(
    async (rail: 'xrpl' | 'evm') => {
      setErrorMsg('');
      setConnecting(true);
      try {
        if (rail === 'xrpl') await connect.connectXrpl();
        else {
          if (evm.isConnected) await disconnectAsync().catch(() => {});
          evm.openConnect();
        }
        reloadWallets();
      } catch (e) {
        setErrorMsg((e as Error).message ?? String(e));
      } finally {
        setConnecting(false);
      }
    },
    [connect, evm, disconnectAsync, reloadWallets],
  );

  /** Map prepare/sign HTTP failures to sentences a person can act on —
   *  session expiry, geofence and the feature flag arrive as raw codes. */
  function friendlyHttpError(status: number, body: { error?: string; detail?: string }): string {
    const code = String(body.error ?? '');
    if (status === 401) return t('Your session expired — sign in again to continue.');
    if (status === 451 || code.startsWith('GEOFENCE')) {
      return t('This action is not available in your region yet.');
    }
    if (code === 'FLARE_DEFI_DISABLED') {
      return t('Flare DeFi execution is disabled on this server (feature flag).');
    }
    if (code === 'MONARQ_DISABLED') {
      return t('The Monarq vault is temporarily unavailable on this server (feature flag).');
    }
    if (code === 'VAULT_DEPOSITS_PAUSED') {
      return t('This vault has deposits paused right now — try again later.');
    }
    if (code === 'VAULT_CAP_EXCEEDED') {
      const cap = (body as { capRemainingFxrp?: number }).capRemainingFxrp;
      return `${t('The vault deposit cap does not fit this amount.')}${
        typeof cap === 'number' ? ` ${t('Remaining capacity')}: ${fmt(cap, 2)} FXRP` : ''
      }`;
    }
    if (code === 'INSUFFICIENT_FXRP') {
      const bal = (body as { balanceFxrp?: number }).balanceFxrp;
      return `${t('That wallet does not hold enough FXRP for this amount.')}${
        typeof bal === 'number' ? ` ${t('Available')}: ${fmt(bal, 2)} FXRP` : ''
      }`;
    }
    return body.detail || body.error || `HTTP ${status}`;
  }

  async function prepare() {
    setErrorMsg('');
    // A linked wallet must be chosen before we can hand off the intent.
    if (!selected) {
      setErrorMsg(t('Link or connect a wallet that can sign this entry to continue'));
      setPhase('error');
      return;
    }
    if (amountNum <= 0) {
      setErrorMsg(t('Amount must be greater than 0'));
      setPhase('error');
      return;
    }

    // The selected wallet decides the rail: XRPL pays XRP (mint → FXRP), a
    // Flare EVM wallet spends its own FXRP directly (no mint).
    const signerFields =
      activeRail === 'evm' && vault.kind !== 'e2'
        ? { evmAddress: selected.record.address, amountFxrp: amountNum }
        : { xrplAddress: selected.record.address, amountXrp: amountNum };

    setPhase('preparing');
    try {
      if (vault.kind === 'e1') {
        const ratio = parseFloat(borrowRatio) || 0;
        const hf = parseFloat(targetHF) || 0;
        const res = await fetch(`${API_BASE}/flare-demo/e1/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            ...signerFields,
            borrowRatio: ratio,
            targetHF: hf,
            region: getUserRegion(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
        setPrepared(body as E1Prepared | E1PreparedEvm);
      } else if (vault.kind === 'e3') {
        // Lend-only: the only input is how much to put to work. No borrow, no HF.
        const res = await fetch(`${API_BASE}/flare-demo/e3/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            ...signerFields,
            region: getUserRegion(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
        setPrepared(body as E3Prepared | E3PreparedEvm);
      } else if (VAULT_KEY[vault.kind]) {
        // Partner vault: FXRP → deposit. One input (amount), no borrow, no HF.
        const res = await fetch(`${API_BASE}/flare-demo/vault/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            ...signerFields,
            vault: VAULT_KEY[vault.kind],
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
        setPrepared(body as VaultPrepared | VaultPreparedEvm);
      } else {
        if (!ADDRESS_RE.test(provider.trim())) {
          throw new Error(t('Enter a valid FTSO data provider address (0x…)'));
        }
        const pct = parseFloat(bipsPct) || 0;
        const res = await fetch(`${API_BASE}/flare-demo/e2/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            amountFlr: amountNum,
            provider: provider.trim(),
            bips: Math.round(pct * 100),
            region: getUserRegion(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
        setPrepared(body as E2Prepared);
      }
      setPhase('review');
    } catch (e) {
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  async function sign() {
    if (!prepared) return;
    setErrorMsg('');
    setPhase('signing');
    try {
      // The partner that signs must hold the EXACT wallet the intent was
      // prepared for — never silently sign from a different account.
      if (!signerMatches) {
        throw new Error(
          activeRail === 'xrpl'
            ? t('Open Xaman with this exact account to sign this entry.')
            : t('Your connected EVM account is different — reconnect with the selected wallet to sign.'),
        );
      }
      if (prepared.rail === 'xrpl') {
        if (!xrpl.isConnected) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        const { txHash: hash } = await xrpl.sendIntent({
          // XamanWalletService injects Account; we hand it the unsigned Payment.
          tx: prepared.xrplPayment as never,
        });
        // Signed ≠ minted: the machine follows the 0xFE execution on Flare.
        settlement.track(startPending('xrpl-mint', hash));
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle);
      }
      // E1 signed (either rail) → carry the thresholds the user chose for THIS
      // entry to the PROTECT template (prefill only: the form stays editable,
      // the rule is still created via POST /api/rules, nothing signs —
      // invariant #8). The position account is the Smart Account on the XRPL
      // rail, or the signing EVM wallet itself on the direct rail.
      if (vault.kind === 'e1' && 'a1' in prepared && prepared.a1) {
        const a1 = prepared.a1;
        const positionAccount =
          prepared.rail === 'xrpl'
            ? (prepared as E1Prepared).personalAccount
            : (prepared as E1PreparedEvm).account;
        stashRulePrefill(rulePrefillScope(['PROTECT', 'kinetic', positionAccount]), {
          source: 'strategy-entry',
          values: {
            hf: String(a1.targetHF),
            // Full USDT0 debt of the entry (6 dec → human): worst-case cover,
            // editable down. a1 has no per-trigger repay — that is computed
            // live at trigger time (mode 'restore' in /a1/prepare).
            repay: String(Number(a1.borrowUsdt0Base) / 1e6),
          },
          context: { triggerPriceUSD: a1.triggerPriceUSD.toFixed(5) },
        });
      }
      setPhase('done');
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setErrorMsg(translateError(e, t).message);
      // Stay on the review: the prepared payload is still valid — the user
      // retries the SIGNATURE, not the whole prepare (fresh FTSO reads).
      setPhase('review');
    }
  }

  // What the amount input denominates: XRPL rail pays XRP (minted 1:1 into
  // FXRP), the direct rail spends the wallet's FXRP, e2 wraps FLR.
  const amountAsset = vault.kind === 'e2' ? 'FLR' : activeRail === 'evm' ? 'FXRP' : 'XRP';

  // Available balance of that asset in the SELECTED wallet — the number the
  // user needs before typing an amount. Same read as the wallet cards
  // (/network/balance; XRP already excludes the ledger reserve). Best-effort:
  // null hides the line, it never blocks the form.
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    if (!selected) {
      setAvailable(null);
      return;
    }
    const kind = activeRail === 'xrpl' ? 'xrpl' : vault.kind === 'e2' ? 'evm' : 'fxrp';
    let cancelled = false;
    setAvailable(null);
    fetch(`${API_BASE}/network/balance?kind=${kind}&address=${encodeURIComponent(selected.record.address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { ok?: boolean; balance?: string } | null) => {
        if (cancelled || !b?.ok || b.balance == null) return;
        const n = Number(b.balance);
        if (Number.isFinite(n)) setAvailable(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.record.address, activeRail, vault.kind]);

  // MAX: the full spendable balance — except FLR (wrap+delegate still needs
  // gas: keep 1 FLR) and the XRPL rail, where the wallet is the STEERING
  // WHEEL of the Smart Account: minting ALL the XRP strands the account with
  // no carrier payment for any future order (founder hit it live, 2026-07-30)
  // — MAX keeps ~2 XRP back.
  const XRPL_STEERING_RESERVE = 2;
  const maxSpendable =
    available == null
      ? null
      : vault.kind === 'e2'
        ? Math.max(0, available - 1)
        : activeRail === 'xrpl'
          ? Math.max(0, available - XRPL_STEERING_RESERVE)
          : available;
  /** Typed amount would leave the XRPL wallet below the steering reserve. */
  const drainsXrplSteering =
    activeRail === 'xrpl' &&
    available != null &&
    (parseFloat(amount) || 0) > 0 &&
    available - (parseFloat(amount) || 0) < XRPL_STEERING_RESERVE;
  const railBadge =
    vault.kind === 'e2'
      ? t(vault.railLabel)
      : activeRail === 'xrpl'
        ? t('Xaman · Smart Account')
        : t('Flare direct · no mint');

  // ── A COUNCIL account (founder refactor 2026-07-28). Its capital moves by
  //    council ORDER through the cage on Flare — the quorum signs, the FDC
  //    proves, the vault executes — not by one wallet's signature. That is a
  //    different rail end to end, so it returns here rather than threading
  //    `activeGoverned` through a personal flow none of which applies. Earn is
  //    no longer a dead end for a council: it composes the order right here.
  if (activeGoverned) {
    // …unless the cage cannot express this pack at all. The borrowing entry is
    // one such: `directTo`/`recall` supply and un-supply, and there is no third
    // function. This is the LAST gate, so every route in (card, deep link,
    // agent, saved draft) ends in the same honest explanation instead of a
    // composer that can only fail.
    const governedBlock = governedBlockOf(vault.kind, true);
    return (
      <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex items-center gap-1 text-[10px] pl-1 pr-2 py-0.5 rounded-full border font-mono ${vault.accent}`}>
                  <TokenLogo symbol={vault.asset} size="xs" />
                  {vault.asset}
                </span>
                {governedBlock ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning">
                    {t('Unsupported for a council')}
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--authority-border)] bg-[var(--authority-soft)] text-ink/60">
                    {t('Council order · the cage')}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-ink">{t(vault.action)}</h2>
              <p className="text-xs text-ink/40 mt-0.5">{vault.title}</p>
            </div>
            <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
            {governedBlock ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-tone-warning/25 bg-tone-warning/[0.07] p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-tone-warning">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t('This strategy cannot be run by a council')}
                  </div>
                  <p className="text-xs leading-relaxed text-ink/60">{t(governedBlock)}</p>
                </div>
                <GhostButton onClick={onClose}>{t('Close')}</GhostButton>
              </div>
            ) : (
              <CouncilVaultEntry account={activeGoverned.address} vaultTitle={vault.title} />
            )}
          </div>
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 text-[10px] pl-1 pr-2 py-0.5 rounded-full border font-mono ${vault.accent}`}>
                <TokenLogo symbol={vault.asset} size="xs" />
                {vault.asset}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-ink/15 bg-ink/5 text-ink/55">
                {railBadge}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-ink">{t(vault.action)}</h2>
            <p className="text-xs text-ink/40 mt-0.5">{vault.title}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* Signing wallet — ANY linked Astryum wallet that can sign this
              entry. On FXRP packs an XRPL pick mints from XRP (Xaman), while a
              Flare pick spends its own FXRP directly — no XRPL mint. */}
          {/* The governed branch that used to live here — "Earn entries are
              signed by simple wallets… open the Legacy panel" — is gone
              (founder 2026-07-28). It was a dead end: a council was told to
              leave the page. A council now composes its cage order in this
              same modal; see the early return above. */}
          {candidates.length > 0 ? (
            <div>
              <label className="text-xs text-ink/40 block mb-2">{t('Signing wallet')}</label>
              <select
                value={selectedAddr}
                onChange={(e) => setSelectedAddr(e.target.value)}
                disabled={phase !== 'form' && phase !== 'error'}
                className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 disabled:opacity-50 [&>option]:bg-surface-1"
              >
                {candidates.map((c) => (
                  <option key={c.record.address} value={c.record.address}>
                    {`${c.record.nickname || c.record.walletType} · ${c.record.address.slice(0, 8)}…${c.record.address.slice(-6)} · ${c.rail === 'xrpl' ? 'XRPL' : 'Flare'}`}
                  </option>
                ))}
              </select>
              {vault.kind !== 'e2' && (
                <p className={`text-[10px] mt-1.5 ${activeRail === 'evm' ? 'text-tone-success/80' : 'text-ink/35'}`}>
                  {activeRail === 'evm'
                    ? t('This wallet spends its FXRP directly on Flare — no XRPL mint, no minting fee.')
                    : t('This wallet pays XRP — minted 1:1 into FXRP on Flare before entering.')}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5 text-tone-warning text-sm font-medium">
                <Wallet className="w-4 h-4" />
                {activeAuthority.kind === 'single' && allCandidates.length > 0
                  ? t('The active account cannot sign this entry')
                  : t('No linked wallet can sign this entry')}
              </div>
              <p className="text-xs text-tone-warning/70 mb-3">
                {activeAuthority.kind === 'single' && allCandidates.length > 0
                  ? t('Switch account in the sidebar switcher, or connect another wallet.')
                  : t('Connect a wallet and it will be linked to your Astryum account on the spot.')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                {vault.kind !== 'e2' && (
                  <button
                    onClick={() => connectSigner('xrpl')}
                    disabled={connecting}
                    className="flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl bg-tone-warning/15 border border-tone-warning/30 text-tone-warning font-medium text-sm hover:bg-tone-warning/25 transition-all disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                    {t('Connect Xaman (XRPL)')}
                  </button>
                )}
                <button
                  onClick={() => connectSigner('evm')}
                  disabled={connecting}
                  className="flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl bg-tone-warning/15 border border-tone-warning/30 text-tone-warning font-medium text-sm hover:bg-tone-warning/25 transition-all disabled:opacity-50"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                  {t('Connect EVM wallet')}
                </button>
              </div>
            </div>
          )}
          {selected && !signerMatches && phase !== 'done' && (
            <div className="bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3">
              <p className="text-xs text-tone-warning/80 mb-2">
                {activeRail === 'xrpl'
                  ? t('Open Xaman with this exact account to sign this entry.')
                  : t('Your connected EVM account is different — reconnect with the selected wallet to sign.')}
              </p>
              <button
                onClick={() => connectSigner(activeRail)}
                disabled={connecting}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-tone-warning/15 border border-tone-warning/30 text-tone-warning font-medium text-xs hover:bg-tone-warning/25 transition-all disabled:opacity-50"
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                {activeRail === 'xrpl' ? t('Connect Xaman (XRPL)') : t('Connect EVM wallet')}
              </button>
            </div>
          )}
          {selected && signerMatches && (
            <div className="flex items-center gap-2 text-[11px] text-ink/45">
              <CheckCircle2 className="w-3.5 h-3.5 text-tone-success" />
              {t('Signing wallet')}:{' '}
              <span className="font-mono text-ink/70">
                {selected.record.address.slice(0, 8)}…{selected.record.address.slice(-6)}
              </span>
            </div>
          )}

          {/* Step: form */}
          {(phase === 'form' || phase === 'error') && (
            <>
              <div>
                <label className="text-xs text-ink/40 mb-2 flex items-center justify-between gap-3">
                  <span>
                    {t('Amount')} · {amountAsset}
                  </span>
                  {available != null && maxSpendable != null && (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-ink/45 truncate">
                        {t('Available')}: <span className="font-mono text-ink/70">{fmt(available, 4)}</span>
                      </span>
                      <button
                        onClick={() => setAmount(String(maxSpendable))}
                        disabled={maxSpendable <= 0}
                        className="text-volt hover:underline font-medium shrink-0 disabled:opacity-40 disabled:no-underline"
                      >
                        MAX
                      </button>
                    </span>
                  )}
                </label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs font-medium">
                    {amountAsset}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-4 pr-16 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                  />
                </div>
                {vault.kind === 'e2' && available != null && (
                  <p className="text-[10px] text-ink/35 mt-1.5">
                    {t('MAX keeps 1 FLR back for gas — the wrap and delegate calls pay fees from this same balance.')}
                  </p>
                )}
                {activeRail === 'xrpl' && available != null && (
                  <p className="text-[10px] text-ink/35 mt-1.5">
                    {t('MAX keeps ~2 XRP back — your Astryum account is steered from this wallet and every order needs a small XRP payment.')}
                  </p>
                )}
                {drainsXrplSteering && (
                  <div className="mt-2 bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                    {t('This would leave your XRPL wallet almost empty. Your Astryum account is steered FROM it — every order needs ~1 XRP of carrier payment. Keep at least ~2 XRP or you will not be able to withdraw or convert until you refund it from outside.')}
                  </div>
                )}
              </div>

              {/* E3 lend-only — no extra inputs; one reassuring line for the non-crypto user */}
              {vault.kind === 'e3' && (
                <div className="rounded-xl border border-tone-success/20 bg-tone-success/[0.06] px-3 py-2.5 text-[11px] text-tone-success/80 flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{t('No loans, no debt, no risk of liquidation. Withdraw whenever — you get FXRP back.')}</span>
                </div>
              )}

              {/* Partner vaults — the same reassurance, plus the honest CeDeFi
                  warning for Monarq (off-chain manager — invariant #9/#10). */}
              {(vault.kind === 'v-firelight' || vault.kind === 'v-earnxrp') && (
                <div className="rounded-xl border border-tone-success/20 bg-tone-success/[0.06] px-3 py-2.5 text-[11px] text-tone-success/80 flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{t('No loans, no debt, no liquidation. The live share price, cap and exit terms are read on-chain and shown before you sign.')}</span>
                </div>
              )}
              {vault.kind === 'v-monarq' && (
                <div className="rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] px-3 py-2.5 text-[11px] text-tone-warning/85 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{t('This vault runs OFF-chain strategies managed by Monarq Asset Management — returns are not verifiable on-chain, and withdrawals wait a 7-day epoch unless you pay the instant fee.')}</span>
                </div>
              )}

              {/* E1 extra inputs */}
              {vault.kind === 'e1' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabelInfo
                      label={t('Borrow ratio')}
                      info={t(
                        "How much of your maximum borrow capacity you use. Your FXRP collateral × the market's live collateral factor sets the most USDT0 you could borrow; 0.30 borrows 30% of that maximum. The lower the ratio, the higher your opening Health Factor (≈ 1 ÷ ratio) and the further you start from liquidation (HF < 1.0).",
                      )}
                    />
                    <input
                      type="number"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={borrowRatio}
                      onChange={(e) => setBorrowRatio(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                    />
                    <p className="text-[10px] text-ink/35 mt-1">{t('% of max borrow capacity')}</p>
                  </div>
                  <div>
                    <FieldLabelInfo
                      label={t('Protect your position')}
                      info={t(
                        'The Health Factor (HF) compares your collateral (× its collateral factor) with your debt: at 1.0 the market can liquidate the position. This threshold sets the trigger price shown in the review and pre-fills the Protect rule you create afterwards from your position: when the live HF drops below it, Astryum prepares the exact repay and asks YOU to sign it — it never signs or executes on its own.',
                      )}
                    />
                    <input
                      type="number"
                      min="1.01"
                      step="0.05"
                      value={targetHF}
                      onChange={(e) => setTargetHF(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                    />
                    <p className="text-[10px] text-ink/35 mt-1">{t('Stop-loss HF · trigger to repay')}</p>
                  </div>
                </div>
              )}

              {/* E2 extra inputs */}
              {vault.kind === 'e2' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">{t('FTSO data provider')}</label>
                    {providerDir.length > 0 && providerMode === 'list' ? (
                      <>
                        <select
                          value={provider}
                          onChange={(e) => {
                            if (e.target.value === CUSTOM_PROVIDER) {
                              setProviderMode('custom');
                              setProvider('');
                            } else setProvider(e.target.value);
                          }}
                          className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                        >
                          <option value="">{t('Choose a provider…')}</option>
                          {providerDir.map((p) => (
                            <option key={p.address} value={p.address}>
                              {p.name} · {p.address.slice(0, 6)}…{p.address.slice(-4)}
                            </option>
                          ))}
                          <option value={CUSTOM_PROVIDER}>{t('Another provider — enter its address (0x…)')}</option>
                        </select>
                        <p className="text-[10px] text-ink/35 mt-1">
                          {t('Public registry of listed providers, A–Z — a directory, not a recommendation.')}
                        </p>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="0x…"
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                          className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
                        />
                        {providerDir.length > 0 && (
                          <button
                            onClick={() => {
                              setProviderMode('list');
                              setProvider('');
                            }}
                            className="text-[10px] text-ink/50 hover:text-ink underline underline-offset-2 mt-1.5"
                          >
                            {t('Choose from the registry list instead')}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">{t('Delegation %')}</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={bipsPct}
                      onChange={(e) => setBipsPct(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                    />
                  </div>
                </div>
              )}

              {phase === 'error' && errorMsg && (
                <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <PrimaryButton onClick={prepare} disabled={amountNum <= 0 || !selected} className="w-full">
                <ShieldCheck className="w-4 h-4" />
                {t('Review before signing')}
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
              {!selected && (
                <p className="text-[10px] text-ink/30 text-center">
                  {t('Connect the required wallet above to prepare this entry')}
                </p>
              )}
            </>
          )}

          {/* Step: preparing */}
          {phase === 'preparing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Building unsigned payload…')}</p>
              <p className="text-[10px] text-ink/30">{t('Astryum never signs — your wallet does')}</p>
            </div>
          )}

          {/* Step: review (disclosure before signing — invariant #6). A failed
              or rejected signature lands BACK here with the error shown — the
              prepared payload stays valid, so the user retries the signature. */}
          {phase === 'review' && prepared && errorMsg && (
            <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {phase === 'review' && prepared && (
            <>
              {/* Two clear blocks — the disclosure table and the verdict/custody
                  column — sit side by side on the wider panel, stacking below sm. */}
              <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                {/* Each FXRP branch handles BOTH rails: the XRPL mint (gross
                    XRP, minting/executor fees, Smart Account) and the direct
                    entry (the wallet's own FXRP — no mint, gas quoted by the
                    wallet). Same protocol data either way (#6/#9). */}
                {VAULT_KEY[vault.kind] ? (
                  (() => {
                    const direct = prepared.rail === 'evm';
                    const d = prepared.disclosure as VaultPrepared['disclosure'];
                    const wd = d.withdrawal;
                    return (
                      <>
                        {direct ? (
                          <>
                            <Row label={t('FXRP from your wallet')} value={`${fmt(d.fxrpDeposited)} FXRP`} />
                            <Row label={t('Minting fee')} value={t('None — no XRPL mint')} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} />
                            <Row label={t('FXRP deposited')} value={`${fmt(d.fxrpDeposited)} FXRP`} />
                          </>
                        )}
                        <Row label={t('Value now')} value={`$${fmt(d.depositedValueUSD, 2)}`} />
                        {d.sharePrice != null && (
                          <Row
                            label={t('Share price (protocol data)')}
                            value={`${fmt(d.sharePrice, 6)} FXRP`}
                          />
                        )}
                        <Row
                          label={t('30d APY (protocol data)')}
                          value={
                            d.apyPct30d != null
                              ? `≈ ${fmt(d.apyPct30d, 2)}% · ${t('source')}: Upshift API`
                              : vault.kind === 'v-firelight'
                                ? t('Rewards not live yet (Firelight Phase 1)')
                                : t('see the live figure on the protocol')
                          }
                        />
                        {d.capacity?.remainingFxrp != null && (
                          <Row
                            label={t('Vault capacity left')}
                            value={`${fmt(d.capacity.remainingFxrp, 0)} FXRP`}
                          />
                        )}
                        <Row
                          label={t('Withdrawal terms')}
                          value={
                            wd.kind === 'instant-or-epoch'
                              ? `${wd.instantRedemptionFeeBps != null ? `${(wd.instantRedemptionFeeBps / 100).toFixed(2)}% ${t('instant')}` : ''}${
                                  wd.epochLagSeconds != null
                                    ? ` · ${t('free after')} ${Math.round(wd.epochLagSeconds / 3600)}h`
                                    : ''
                                }`
                              : t('redeem via vault claim flow')
                          }
                        />
                        {d.riskProfile === 'cedefi' && (
                          <Row label={t('Risk profile')} value={t('CeDeFi — off-chain manager')} />
                        )}
                        <Row label={t('Debt · liquidation risk')} value={t('None — plain deposit')} />
                        {direct ? (
                          <>
                            <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                            <Row label={t('Signing wallet')} value={`${(prepared as VaultPreparedEvm).account.slice(0, 10)}…${(prepared as VaultPreparedEvm).account.slice(-6)}`} mono />
                          </>
                        ) : (
                          <Row label={t('Smart Account')} value={`${(prepared as VaultPrepared).personalAccount.slice(0, 10)}…${(prepared as VaultPrepared).personalAccount.slice(-6)}`} mono />
                        )}
                      </>
                    );
                  })()
                ) : vault.kind === 'e3' ? (
                  (() => {
                    const direct = prepared.rail === 'evm';
                    const d = prepared.disclosure as E3Prepared['disclosure'];
                    return (
                      <>
                        {direct ? (
                          <>
                            <Row label={t('FXRP from your wallet')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                            <Row label={t('Minting fee')} value={t('None — no XRPL mint')} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} />
                            <Row label={t('FXRP supplied')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                          </>
                        )}
                        <Row label={t('Value now')} value={`$${fmt(d.suppliedValueUSD, 2)}`} />
                        <Row
                          label={t('Supply rate (protocol data)')}
                          value={d.supplyApyPct != null ? `≈ ${fmt(d.supplyApyPct, 2)}% APR` : t('see live rate on Kinetic')}
                        />
                        <Row label={t('Debt · liquidation risk')} value={t('None — plain supply')} />
                        {direct ? (
                          <>
                            <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                            <Row label={t('Signing wallet')} value={`${(prepared as E3PreparedEvm).account.slice(0, 10)}…${(prepared as E3PreparedEvm).account.slice(-6)}`} mono />
                          </>
                        ) : (
                          <Row label={t('Smart Account')} value={`${(prepared as E3Prepared).personalAccount.slice(0, 10)}…${(prepared as E3Prepared).personalAccount.slice(-6)}`} mono />
                        )}
                      </>
                    );
                  })()
                ) : vault.kind === 'e1' ? (
                  (() => {
                    const direct = prepared.rail === 'evm';
                    const d = prepared.disclosure as E1Prepared['disclosure'];
                    return (
                      <>
                        {direct ? (
                          <>
                            <Row label={t('FXRP from your wallet')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                            <Row label={t('Minting fee')} value={t('None — no XRPL mint')} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} />
                            <Row label={t('FXRP supplied')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                          </>
                        )}
                        <Row label={t('USDT0 borrowed')} value={`${fmt(d.usdt0Borrowed, 2)} USDT0`} />
                        <Row label={t('FXRP/USD now')} value={`$${fmt(d.fxrpPriceUSD, 4)}`} />
                        <Row
                          label={t('Your cushion at entry')}
                          value={`${hfWord(d.entryHF, t).label} (${fmt(d.entryHF, 2)} — ${t('liquidation at 1.00')})`}
                        />
                        <Row
                          label={t('Stop-loss triggers below')}
                          value={`$${fmt(d.triggerPriceUSD, 4)} (${t('cushion')} ${fmt(d.targetHF, 2)})`}
                        />
                        {direct ? (
                          <>
                            <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                            <Row label={t('Signing wallet')} value={`${(prepared as E1PreparedEvm).account.slice(0, 10)}…${(prepared as E1PreparedEvm).account.slice(-6)}`} mono />
                          </>
                        ) : (
                          <Row label={t('Smart Account')} value={`${(prepared as E1Prepared).personalAccount.slice(0, 10)}…${(prepared as E1Prepared).personalAccount.slice(-6)}`} mono />
                        )}
                      </>
                    );
                  })()
                ) : (
                  (() => {
                    const d = (prepared as E2Prepared).disclosure;
                    const shortProvider = `${d.provider.slice(0, 10)}…${d.provider.slice(-6)}`;
                    const knownProvider = providerDir.find(
                      (p) => p.address.toLowerCase() === d.provider.toLowerCase(),
                    );
                    return (
                      <>
                        <Row label={t('Wrap')} value={`${fmt(d.amountFlr)} FLR → WFLR`} />
                        <Row
                          label={t('Delegate to')}
                          value={knownProvider ? `${knownProvider.name} · ${shortProvider}` : shortProvider}
                          mono
                        />
                        <Row label={t('Delegation %')} value={`${(d.bips / 100).toFixed(0)}%`} />
                        {d.flrPriceUSD > 0 && (
                          <Row label={t('FLR/USD now')} value={`$${fmt(d.flrPriceUSD, 4)}`} />
                        )}
                        <Row label={t('Calls to sign')} value={`${(prepared as E2Prepared).calls.length} (wrap + delegate)`} />
                        {/* No Astryum fee on this entry; the only cost is network gas,
                            which the wallet quotes at signature time (#6 — no number
                            is invented here). */}
                        <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                      </>
                    );
                  })()
                )}
              </div>

              <div className="space-y-4">
                {/* Invariant #11 — the dry-run verdict BEFORE the wallet opens. */}
                <PreflightNotice preflight={preflight} />

                <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
                  <p className="font-medium text-ink/70 mb-0.5">{t('Astryum does not custody your funds.')}</p>
                  <p>{prepared.disclosure.note}</p>
                </div>
              </div>
              </div>

              {/* Sign stays reachable while the disclosure scrolls. */}
              <div className="sticky bottom-0 -mx-6 -mb-5 bg-surface-1 px-6 pb-5 pt-3 flex gap-3">
                <GhostButton onClick={() => { releaseSeatIfUnsigned(); setPhase('form'); }} className="flex-1">
                  {t('Back')}
                </GhostButton>
                <PrimaryButton
                  onClick={sign}
                  disabled={!signerMatches}
                  className={`flex-1 ${preflightSaysFail(preflight) ? 'opacity-80 saturate-50' : ''}`}
                >
                  {preflightSaysFail(preflight)
                    ? t('Sign anyway — the dry-run says it will fail')
                    : prepared.rail === 'xrpl'
                      ? t('Sign in Xaman')
                      : t('Sign in wallet')}
                </PrimaryButton>
              </div>
            </>
          )}

          {/* Step: signing */}
          {phase === 'signing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">
                {prepared?.rail === 'xrpl' ? t('Approve the Payment in Xaman…') : t('Confirm in your wallet…')}
              </p>
            </div>
          )}

          {/* Step: done = SIGNED. Success/failure/stalled comes from the
              settlement machine — never painted locally (§2). */}
          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={
                  prepared?.rail === 'xrpl'
                    ? t('Executed on Flare — your position is settled and appears in Positions.')
                    : t('Confirmed on-chain — the position appears in Positions.')
                }
                pendingText={t('Signed — settling on Flare…')}
              />
              {prepared?.rail === 'xrpl' && settlement.state.status === 'pending' && (
                <p className="text-[11px] text-ink/45 max-w-xs leading-relaxed">
                  {t(
                    VAULT_KEY[vault.kind]
                      ? 'Your XRP Payment is signed. FXRP mint + the vault deposit settle on Flare via the executor — the vault shares land in your Smart Account.'
                      : vault.kind === 'e3'
                        ? 'Your XRP Payment is signed. FXRP mint + the plain Kinetic supply settle on Flare via the executor — no borrow, no debt.'
                        : 'Your XRP Payment is signed. FXRP mint + the Kinetic supply/borrow batch settle on Flare via the executor.',
                  )}
                </p>
              )}
              {prepared?.rail === 'evm' && vault.kind !== 'e2' && settlement.state.status === 'pending' && (
                <p className="text-[11px] text-ink/45 max-w-xs leading-relaxed">
                  {t('Signed from your Flare wallet — no XRPL mint. The position lands directly in that wallet and appears in Positions once the transaction confirms.')}
                </p>
              )}
              {prepared?.rail === 'xrpl' && settlement.state.status !== 'settled' && (
                <p className="text-[11px] text-ink/45 max-w-xs leading-relaxed">
                  {t('Awaiting execution on Flare — your XRP is safe at the Core Vault; this can take a few minutes.')}
                </p>
              )}
              {prepared?.rail === 'xrpl' && settlement.state.status === 'stalled' && (
                <p className="text-[11px] text-ink/40 max-w-xs leading-relaxed">
                  {t('If it stays pending for long, nothing is lost: the signed operation can always be executed later. Contact support with your transaction hash.')}
                </p>
              )}
              {/* E1 promised a stop-loss in the review — this is where it gets
                  ARMED: the SAME manual Protect card, embedded (founder
                  2026-07-25: every creation path shows the card directly),
                  pre-filled with the thresholds the user just chose and bound
                  to the wallet that HOLDS the position (PA on the XRPL rail,
                  the signing EVM wallet on the direct rail). */}
              {vault.kind === 'e1' && prepared && 'a1' in prepared && prepared.a1 && (
                <ProtectRuleCard
                  walletAddress={
                    prepared.rail === 'xrpl'
                      ? (prepared as E1Prepared).personalAccount
                      : (prepared as E1PreparedEvm).account
                  }
                  protocolId="kinetic"
                  assetLabel="FXRP"
                  prefill={{
                    hf: String(prepared.a1.targetHF),
                    repay: String(Number(prepared.a1.borrowUsdt0Base) / 1e6),
                  }}
                  ensureXrplRegistered={prepared.rail === 'xrpl' ? selected?.record.address : undefined}
                />
              )}
              {vault.kind === 'e1' && (
                <p className="text-[10px] text-ink/35 max-w-xs leading-relaxed">
                  {t('The Protect template comes pre-filled with the thresholds you chose for this entry — editable before you activate it.')}
                </p>
              )}
              {/* R8.3: "Done" while the settlement is still pending told the
                  user it was over. Closing is fine (the op stays tracked and
                  resumes after a reload) — the label just stops lying. */}
              <GhostButton onClick={onClose} className="mt-2 w-full">
                {settlement.state?.status === 'settled' ? t('Done') : t('Keep waiting in the background')}
              </GhostButton>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* PAGE — four doors that organise the surface: ready-made · create    */
/* with the agent · movements · create manually. The saved drafts and  */
/* the live on-chain footprint moved to Estrategias (UI reorg          */
/* 2026-07-12): this is where capital gets programmed, Estrategias is  */
/* where its strategies live.                                          */
/* ------------------------------------------------------------------ */

/** One door of the hub — not an icon in a box: a living scene occupies the
 *  panel's right side (the solar system turns, the constellation draws itself
 *  on hover) while the words breathe on the left. */
function EarnDoor({
  scene,
  eyebrow,
  title,
  desc,
  cta,
  ctaTone,
  border,
  onClick,
}: {
  scene: React.ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  cta: string;
  ctaTone: string;
  border: string;
  onClick: () => void;
}) {
  return (
    <Card hover spotlight padded={false} className={`group relative overflow-hidden h-full ${border}`}>
      <button onClick={onClick} className="relative z-[2] w-full h-full text-left p-6 md:p-7 sm:pr-40 md:pr-48 flex flex-col min-h-[196px]">
        <MicroLabel>{eyebrow}</MicroLabel>
        <h3 className="text-lg font-semibold tracking-tight text-ink mt-2.5">{title}</h3>
        <p className="text-sm text-ink/50 leading-relaxed mt-2 mb-5 max-w-[36ch]">{desc}</p>
        <span className={`mt-auto inline-flex items-center gap-1.5 text-sm font-medium ${ctaTone}`}>
          {cta}
          <ArrowRight className="w-4 h-4 -translate-x-1 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
        </span>
      </button>
      {/* the scene — lives IN the panel, brightening under attention */}
      <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 hidden sm:block opacity-70 group-hover:opacity-100 transition-opacity duration-500">
        {scene}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* LIVE YIELD CHIP — shown on each card and (larger) in the info modal. */
/* A pulsing dot = live; a number = the protocol figure with its source; */
/* otherwise the honest status label. Never a promise (invariant #9).    */
/* ------------------------------------------------------------------ */
function LiveYieldChip({
  y,
  size = 'sm',
  showSource = false,
}: {
  y: YieldEntry | undefined;
  size?: 'sm' | 'lg';
  /** R9: the figure's SOURCE printed next to the chip — a tooltip does not
   *  exist on touch, and the invariant wants the source AT the decision point. */
  showSource?: boolean;
}) {
  const { t } = useT();
  const { pct, label } = yieldChipText(y);
  const big = size === 'lg';
  if (pct) {
    // A realized NEGATIVE figure (e.g. Monarq's epoch-reported NAV mark) must
    // not wear the green "live yield" costume — neutral tone, and the note
    // (its nature: 30d realized, epochs, off-chain manager) rides the tooltip.
    const negative = y && y.kind !== 'none' && y.pct < 0;
    const tooltip =
      y && y.kind !== 'none' ? `${y.source}${y.note ? ` — ${y.note}` : ''}` : undefined;
    return (
      <span className={showSource ? 'inline-flex flex-col items-start gap-0.5' : undefined}>
        <span
          title={tooltip}
          className={`inline-flex items-center gap-1.5 rounded-full border ${
            negative
              ? 'border-ink/20 bg-ink/5 text-ink/70'
              : 'border-tone-success/30 bg-tone-success/10 text-tone-success'
          } ${big ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'}`}
        >
          {/* Breathing status dot — the system's PulseDot (was a hand-rolled
              animate-ping pair). Its default tone is already tone-success. */}
          {!negative && <PulseDot size={6} />}
          <span className="font-semibold tabular-nums">{pct}</span>
          {big && (
            <span className={negative ? 'text-ink/45' : 'text-tone-success/70'}>
              · {negative ? t('30d realized') : t('current protocol figure')}
            </span>
          )}
        </span>
        {showSource && y && y.kind !== 'none' && (
          <span className="text-[10px] text-ink/45">
            {t('source')}: {y.source}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-ink/5 text-ink/55 ${
        big ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      }`}
    >
      {label ? t(label) : `${t('Loading live rate')}…`}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* PROFIT CALCULATOR — lets the user model the return at a rate they can  */
/* read. The rate is PRE-FILLED from the live protocol figure when there  */
/* is one (editable) and left blank otherwise, so the user enters their   */
/* own assumption. Output is an ESTIMATE over the rate shown — never an    */
/* offer, promise, or Astryum yield (invariant #9).                        */
/* ------------------------------------------------------------------ */
function ProfitCalculator({ vault, y }: { vault: DemoVault; y: YieldEntry | undefined }) {
  const { t } = useT();
  const liveRate = y && y.kind !== 'none' ? y.pct : null;
  // R9: the calculator opens EMPTY — a pre-filled "+42" in green before the
  // user typed anything reads as a promise, not a model. The rate still
  // pre-fills from the live figure (it is a protocol fact, not our number).
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState('12');
  const [rate, setRate] = useState(liveRate != null ? liveRate.toFixed(2) : '');

  // Keep the rate in sync with a freshly-arrived live figure ONLY while the
  // user hasn't overridden it (empty field = "use live").
  useEffect(() => {
    if (liveRate != null && rate === '') setRate(liveRate.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRate]);

  const p = Number(amount);
  const r = Number(rate);
  const mo = Number(months);
  const valid = Number.isFinite(p) && p > 0 && Number.isFinite(r) && r >= 0 && Number.isFinite(mo) && mo > 0;
  const simpleYield = valid ? (p * (r / 100) * mo) / 12 : null; // simple, non-compounded
  const total = valid && simpleYield != null ? p + simpleYield : null;

  const fmt = (n: number) => fmtQtyActive(n, n < 100 ? 2 : 0);

  const usingLive = liveRate != null && rate === liveRate.toFixed(2);

  return (
    <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <MicroLabel>{t('Amount')} · {vault.asset}</MicroLabel>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="mt-1 w-full rounded-lg border border-ink/15 bg-surface-1 px-2.5 py-2 text-sm text-ink tabular-nums outline-none focus:border-volt/50"
          />
        </label>
        <label className="block">
          <MicroLabel>{t('Months')}</MicroLabel>
          <input
            inputMode="numeric"
            value={months}
            onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ''))}
            className="mt-1 w-full rounded-lg border border-ink/15 bg-surface-1 px-2.5 py-2 text-sm text-ink tabular-nums outline-none focus:border-volt/50"
          />
        </label>
        <label className="block">
          <MicroLabel>{t('Rate')} %{usingLive ? ` · ${t('live')}` : ''}</MicroLabel>
          <input
            inputMode="decimal"
            value={rate}
            placeholder={liveRate != null ? liveRate.toFixed(2) : t('your estimate')}
            onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))}
            className="mt-1 w-full rounded-lg border border-ink/15 bg-surface-1 px-2.5 py-2 text-sm text-ink tabular-nums outline-none focus:border-volt/50"
          />
        </label>
      </div>

      {/* R9: neutral tone (a green "+X" wears the costume of a credited gain)
          and the disclaimer at a READABLE size — it was the smallest, faintest
          text in the modal while carrying the only sentence that matters. */}
      <div className="mt-3 flex items-end justify-between gap-3 rounded-lg bg-surface-1 border border-ink/[0.06] px-3 py-2.5">
        <div>
          <MicroLabel>{t('Estimated yield')}</MicroLabel>
          <div className="text-lg font-semibold text-ink/85 tabular-nums leading-tight">
            {simpleYield != null ? `+${fmt(simpleYield)}` : '—'}{' '}
            <span className="text-xs font-normal text-ink/45">{vault.asset}</span>
          </div>
        </div>
        <div className="text-right">
          <MicroLabel>{t('Total after')} {valid ? mo : '—'} {t('mo')}</MicroLabel>
          <div className="text-sm font-medium text-ink/80 tabular-nums leading-tight">
            {total != null ? `${fmt(total)} ${vault.asset}` : '—'}
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink/55">
        {t(
          'If the rate held (it is not guaranteed — it changes constantly), this is what simple interest would add, before fees and price moves. It is not an offer, a promise, or an Astryum yield.',
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STRATEGY INFO MODAL — the "More info" surface. Everything technical    */
/* about a strategy in one place: what it does, the animated flow, the    */
/* facts, the real on-chain legs, the live rate WITH its source, and the  */
/* profit calculator. Separate from the prepare/sign modal — this one     */
/* never signs; a Start button hands off to DemoVaultModal.               */
/* ------------------------------------------------------------------ */
/* Compact formatters for the market-data grid. TVL/USD figures go through the
 * shared formatMoneyCompact (was a duplicate local fmtUsd — de-AI pass). */
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)}%`);
const fmtDelta = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)} pp`);

/** Known Flare reward/underlying token addresses → ticker (for DeFiLlama data). */
const TOKEN_TICKERS: Record<string, string> = {
  '0x1d80c49bbbcd1c0911346656b529df9e5c2f783d': 'WFLR',
  '0xad552a648c74d49e10027ab8a618a3ad4901c5be': 'FXRP',
};
const tickerOf = (addr: string) => TOKEN_TICKERS[addr.toLowerCase()] ?? `${addr.slice(0, 6)}…`;

/** One hairline stat cell in the market-data grid. */
function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-surface-1 px-3 py-2.5">
      <MicroLabel>{label}</MicroLabel>
      <div className={`text-[12px] mt-0.5 font-medium tabular-nums ${tone ?? 'text-ink/80'}`}>{value}</div>
    </div>
  );
}

/** Market data — DeFiLlama where the product is indexed, Upshift API for the
 *  vaults it isn't, and an honest note when neither lists it. Every figure
 *  carries its source; nothing here is an Astryum promise (invariant #9). */
function MarketDataPanel({ info, meta, loading }: { info: ProductInfo | undefined; meta: ProductMeta; loading?: boolean }) {
  const { t } = useT();
  const dl = info?.defillama ?? null;
  const up = info?.upshift ?? null;
  const borrow = info?.borrow ?? null;

  if (loading && !info) {
    return (
      <div>
        <MicroLabel>{t('Market data')}</MicroLabel>
        <div className="mt-2 h-16 rounded-xl border border-ink/[0.06] bg-ink/[0.03] animate-pulse" />
      </div>
    );
  }

  if (dl) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <MicroLabel>{t('Market data')}</MicroLabel>
          <a href={dl.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-ink/45 hover:text-volt transition-colors">
            DeFiLlama <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-ink/[0.06] bg-ink/[0.06]">
          <Stat label={t('TVL')} value={formatMoneyCompact(dl.tvlUsd)} />
          <Stat label={t('APY total')} value={fmtPct(dl.apy)} tone="text-tone-success" />
          <Stat label={t('30d avg APY')} value={fmtPct(dl.apyMean30d)} />
          <Stat label={t('Base APY')} value={fmtPct(dl.apyBase)} />
          <Stat label={t('Reward APY')} value={fmtPct(dl.apyReward)} tone="text-sky-300" />
          <Stat label={t('IL risk')} value={dl.ilRisk === 'no' ? t('none') : (dl.ilRisk ?? '—')} tone={dl.ilRisk === 'yes' ? 'text-tone-warning' : 'text-ink/80'} />
          <Stat label={`${t('APY')} 1d`} value={fmtDelta(dl.apyPct1D)} tone={(dl.apyPct1D ?? 0) < 0 ? 'text-tone-danger' : 'text-tone-success'} />
          <Stat label={`${t('APY')} 7d`} value={fmtDelta(dl.apyPct7D)} tone={(dl.apyPct7D ?? 0) < 0 ? 'text-tone-danger' : 'text-tone-success'} />
          <Stat label={`${t('APY')} 30d`} value={fmtDelta(dl.apyPct30D)} tone={(dl.apyPct30D ?? 0) < 0 ? 'text-tone-danger' : 'text-tone-success'} />
        </div>
        {/* The carry borrows — surface the APR the user PAYS (invariant #6:
            costs visible before signing). */}
        {borrow && borrow.aprPct != null && (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-tone-warning/20 bg-tone-warning/[0.06] px-3 py-2.5">
            <div>
              <MicroLabel>{borrow.asset} {t('borrow APR — you pay')}</MicroLabel>
              <div className="text-[13px] mt-0.5 font-semibold text-tone-warning tabular-nums">{fmtPct(borrow.aprPct)}</div>
            </div>
            <span className="text-[9px] text-ink/35 text-right max-w-[45%] leading-snug">{t('The carry earns the supply side minus this borrow cost')}</span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink/40">
          {dl.exposure && <span>{t('Exposure')}: {dl.exposure}</span>}
          {dl.apyReward != null && dl.rewardTokens.length > 0 && (
            <span>{t('Rewards in')}: {dl.rewardTokens.map(tickerOf).join(', ')}</span>
          )}
          {dl.outlook && <span>{t('DeFiLlama outlook')}: {dl.outlook.class}{dl.outlook.probability != null ? ` (${dl.outlook.probability}%)` : ''}</span>}
          {dl.dataPoints != null && <span>{dl.dataPoints} {t('data points')}</span>}
        </div>
        <p className="mt-1.5 text-[10px] text-ink/30">{t('Source')}: {dl.source}</p>
      </div>
    );
  }

  if (up) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <MicroLabel>{t('Vault data')}</MicroLabel>
          <a href={meta.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-ink/45 hover:text-volt transition-colors">
            Upshift <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-ink/[0.06] bg-ink/[0.06]">
          <Stat label={t('TVL')} value={formatMoneyCompact(up.tvlUsd)} />
          <Stat label={`${t('APY')} 30d`} value={fmtPct(up.apy30d)} tone="text-tone-success" />
          <Stat label={`${t('APY')} 7d`} value={fmtPct(up.apy7d)} />
          <Stat label={`${t('APY')} 1d`} value={fmtPct(up.apy1d)} />
          <Stat label={t('Receipt')} value={up.receiptToken ?? '—'} />
          <Stat label={t('Risk')} value={up.risk ?? '—'} tone="text-ink/70" />
        </div>
        <p className="mt-1.5 text-[10px] text-ink/30">{t('Source')}: {up.source}</p>
      </div>
    );
  }

  // No live figures. Distinguish "genuinely not indexed" (info loaded, but no
  // DeFiLlama/Upshift entry — Firelight, FTSO) from "couldn't load right now"
  // (the fetch failed, so this product's key is missing entirely).
  const loaded = info !== undefined;
  return (
    <div>
      <MicroLabel>{t('Market data')}</MicroLabel>
      <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">
        {loaded
          ? t('Not indexed on DeFiLlama — the numbers come straight from the protocol on-chain. Open the protocol to see live data.')
          : t('Live market data could not load right now — open the protocol to see it.')}
      </p>
    </div>
  );
}

function StrategyInfoModal({
  vault,
  y,
  asOf,
  onClose,
  onStart,
}: {
  vault: DemoVault;
  y: YieldEntry | undefined;
  asOf: string | null;
  onClose: () => void;
  onStart: () => void;
}) {
  const { t } = useT();
  // The sheet stays readable for everyone — a council may want to understand a
  // strategy it cannot run. Only the Start button is withdrawn.
  const { activeGoverned } = useAuthorities();
  const governedBlock = governedBlockOf(vault.kind, !!activeGoverned);
  const asOfLabel = asOf ? new Date(asOf).toLocaleTimeString() : null;
  const meta = PRODUCT_META[vault.kind];
  const productMap = useProductInfo();
  const info = productMap?.[vault.kind];
  const loadingInfo = productMap === null;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl grid place-items-center border ${vault.accent}`}>{vault.icon}</div>
            <div>
              <h2 className="text-lg font-semibold text-ink">{vault.title}</h2>
              <p className="text-xs text-ink/40 mt-0.5">
                {meta.protocolName} · {t(vault.action)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Live yield + source */}
          <div className="flex flex-wrap items-center gap-2">
            <LiveYieldChip y={y} size="lg" showSource />
            {asOfLabel && <span className="text-[10px] text-ink/35">{t('as of')} {asOfLabel}</span>}
          </div>
          {y && y.kind !== 'none' && (
            <p className="-mt-3 text-[10px] leading-relaxed text-ink/40">
              <span className="text-ink/55">{t('Source')}:</span> {y.source}
              {y.note ? ` · ${t(y.note)}` : ''}
            </p>
          )}

          {/* What it does */}
          <div>
            <MicroLabel>{t('How it works')}</MicroLabel>
            <p className="mt-1 text-sm text-ink/70 leading-relaxed">{t(vault.plain)}</p>
          </div>

          <FlowStrip steps={vault.flow} />

          {/* How the yield is generated — the product-specific mechanism. */}
          <div>
            <MicroLabel>{t('How the yield is generated')}</MicroLabel>
            <p className="mt-1 text-sm text-ink/70 leading-relaxed">{t(meta.yieldMechanism)}</p>
          </div>

          {/* Market data — DeFiLlama / Upshift, each figure with its source. */}
          <MarketDataPanel info={info} meta={meta} loading={loadingInfo} />

          {/* Where your money actually goes — the verified protocol website. */}
          <a
            href={meta.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-3 hover:border-volt/40 transition-colors group"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{t('Visit')} {meta.protocolName}</span>
              <span className="block text-[11px] text-ink/45 truncate">{meta.website.replace(/^https?:\/\//, '')} · {t('see exactly where your money goes')}</span>
            </span>
            <ExternalLink className="w-4 h-4 text-ink/40 group-hover:text-volt transition-colors shrink-0" />
          </a>

          {/* The facts people ask about */}
          <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden border border-ink/[0.06] bg-ink/[0.06]">
            {vault.facts.map((f) => (
              <div key={f.label} className="bg-surface-1 px-3 py-2.5">
                <MicroLabel>{t(f.label)}</MicroLabel>
                <div
                  className={`text-[11px] mt-0.5 leading-snug ${
                    f.tone === 'amber' ? 'text-tone-warning' : f.tone === 'emerald' ? 'text-tone-success' : 'text-ink/75'
                  }`}
                >
                  {t(f.value)}
                </div>
              </div>
            ))}
          </div>

          {/* The real on-chain legs, in execution order */}
          <div>
            <MicroLabel>{t('Technical composition')} · {vault.legs.length} {t('legs')}</MicroLabel>
            <ol className="mt-2 space-y-1.5 border-l border-ink/10 pl-4">
              {vault.legs.map((leg, i) => (
                <li key={i} className="text-xs text-ink/55 leading-relaxed">
                  <span className="font-mono text-ink/35 mr-1.5">{i + 1}.</span>
                  {t(leg)}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[10px] text-ink/35">
              {t('Signs on')}: {t(vault.railLabel)}
            </p>
          </div>

          {/* Profit calculator */}
          <div>
            <MicroLabel>{t('Profitability calculator')}</MicroLabel>
            <div className="mt-2">
              <ProfitCalculator vault={vault} y={y} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-ink/5">
          {governedBlock && (
            <p className="flex items-start gap-2 px-6 pt-4 text-[11px] leading-relaxed text-tone-warning/90">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{t(governedBlock)}</span>
            </p>
          )}
          <div className="flex items-center gap-2 px-6 py-4">
            <GhostButton onClick={onClose}>{t('Close')}</GhostButton>
            {governedBlock ? (
              <span className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-sm font-medium text-ink/35 cursor-not-allowed select-none">
                {t('Unsupported for a council')}
              </span>
            ) : (
              <PrimaryButton onClick={onStart} className="flex-1">
                {t('Start')} · {vault.action}
                <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

type StrategyView = 'hub' | 'pick' | 'create' | 'movements' | 'manual' | 'strategies';

export default function FlareDemoEarn() {
  const { t } = useT();
  // Who is operating. A council reaches the same Earn surfaces as a personal
  // wallet (founder 2026-07-28) — only the signature differs — so this page
  // branches in exactly two places: the entry modal (a cage order) and My
  // strategies (the council's own MoneyFlows).
  const { activeGoverned } = useAuthorities();
  const [view, setView] = useState<StrategyView>('hub');
  const [active, setActive] = useState<DemoVault | null>(null);
  const [initialInputs, setInitialInputs] = useState<{ amount?: string; ratio?: string; targetHF?: string } | undefined>(undefined);
  // Which pack has its "More info" (technical + calculator) modal open.
  const [infoVault, setInfoVault] = useState<DemoVault | null>(null);
  // The guided finder (founder 2026-08-08: six full cards at once confuse a
  // first-timer). `matchedKinds` narrows the pick grid to the routes whose
  // FACTS fit the user's two answers — a filter, never a recommendation
  // (invariant #9); null = no filter, the full catalogue.
  const [finderOpen, setFinderOpen] = useState(false);
  const [matchedKinds, setMatchedKinds] = useState<VaultKind[] | null>(null);
  // Live protocol yields for the cards — polled, protocol data with a source.
  const { yields, asOf } = useStrategyYields();

  // ONE launch path for everything (agent prompts, saved drafts, pack cards):
  // open the real prepare→review→sign modal, optionally pre-filled.
  const launch: LaunchStrategy = useCallback((kind, initial) => {
    setInitialInputs(initial);
    setActive(DEMO_VAULTS.find((v) => v.kind === kind) ?? DEMO_VAULTS[0]);
  }, []);

  // Deep-link contract: /app/asset-production?launch=<kind>&amount=&ratio=&hf=
  // — emitted by the Strategies page's draft "Run" so its params survive the
  // navigation — plus ?view=pick|create|movements|manual to land on a door
  // directly (the old /app/savings route and pre-rename ?view=savings links
  // land on movements). Read client-side (window.location, so no Suspense
  // boundary is needed) and cleaned from the URL so a refresh doesn't
  // re-open the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = new URLSearchParams(window.location.search);
    const views: StrategyView[] = ['pick', 'create', 'movements', 'manual', 'strategies'];
    const rawView = qs.get('view') === 'savings' ? 'movements' : qs.get('view');
    const wantedView = views.find((v) => v === rawView);
    const kind = qs.get('launch');
    const known: VaultKind[] = ['e1', 'e2', 'e3', 'v-firelight', 'v-earnxrp', 'v-monarq'];
    const hasLaunch = known.includes(kind as VaultKind);
    if (wantedView) setView(wantedView);
    if (hasLaunch) {
      launch(kind as VaultKind, {
        amount: qs.get('amount') ?? undefined,
        ratio: qs.get('ratio') ?? undefined,
        targetHF: qs.get('hf') ?? undefined,
      });
    }
    if (!wantedView && !hasLaunch) return;
    for (const k of ['launch', 'amount', 'ratio', 'hf', 'view']) qs.delete(k);
    const rest = qs.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, [launch]);

  return (
    <div>
      <PageHeader
        eyebrow="Earn · Flare"
        title={t('Put your assets to work')}
        subtitle={t('Pick a created strategy or create one with text. Six strategies live on mainnet, in beta testing.')}
      />

      {/* ── Hub: four living doors. Top row — a turning solar system for the
          audited ready-made strategies, a constellation that draws itself for
          the agent. Bottom row, same size and disposition — a waning moon for
          Movements (send/receive + capital resting until its date) and a
          moneyflow forging itself for Create Manually. Scenes, not icons.
          Saved strategies and the live on-chain footprint live in
          Estrategias now. ── */}
      {view === 'hub' && (
        <RevealGroup className="space-y-5">
          {/* First-visit coachmarks for the three doors (founder 2026-07-18). */}
          <ProductTour
            tour="earn"
            steps={[
              // "Audited" is FORBIDDEN without a published external report
              // (GLOSSARY §6.2) — assurance language is exactly how scams talk.
              { target: 'door-pick', title: t('Choose a Strategy'), body: t('Ready-made strategies live on mainnet. Open one to see exactly what it does with your tokens before you sign anything.') },
              { target: 'door-create', title: t('Create with AI Agent'), body: t('Describe what you want in plain words; the agent compiles it into a strategy you review and sign. It never signs for you.') },
              { target: 'door-strategies', title: t('My strategies'), body: t('Your registry: everything running on-chain and everything saved as a draft — pause, resume or launch from here.') },
            ]}
          />
          <RevealItem className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div data-tour="door-pick" className="contents">
            <EarnDoor
              scene={<OrbitScene size={172} />}
              eyebrow={t('Ready-made')}
              title={t('Choose a Strategy')}
              desc={t('Six strategies live on Flare mainnet, ready to start. See exactly what each one does with your tokens.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => setView('pick')}
            />
            </div>
            <div data-tour="door-create" className="contents">
            <EarnDoor
              scene={<ConstellationScene />}
              eyebrow={t('With the agent')}
              title={t('Create with AI Agent')}
              desc={t('Chat with the agent: describe the strategy you want, it helps you complete it and compiles it for your signature.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => setView('create')}
            />
            </div>
          </RevealItem>

          {/* Movements + Create Manually are HIDDEN for the hackathon demo
              (founder 2026-07-18) — the views stay reachable by deep-link
              (?view=movements / ?view=manual: the /app/savings redirect and
              the Estrategias links keep working). In their place, Estrategias
              moved INTO Earn as a full-width door — everything about making
              capital work lives behind one nav entry now. */}
          <RevealItem className="grid grid-cols-1 gap-5" data-tour="door-strategies">
            <EarnDoor
              scene={<FlowForgeScene />}
              eyebrow={t('Your registry')}
              title={t('My strategies')}
              desc={t('Everything running and everything saved: live on-chain positions, active savings rules and your drafts — one shelf, always yours to pause or resume.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => setView('strategies')}
            />
          </RevealItem>
        </RevealGroup>
      )}

      {view !== 'hub' && (
        <button
          onClick={() => setView('hub')}
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink/45 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> {t('Back to Earn')}
        </button>
      )}

      {/* ── Pick: the two live packs, with their real composition ── */}
      {view === 'pick' && (
        <RevealGroup className="space-y-5">
          {/* The guided door into the catalogue — or, once answered, the
              honest strip saying WHY the list is short and how to widen it. */}
          <RevealItem>
            {matchedKinds ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-volt/25 bg-volt/[0.06] px-4 py-3">
                <Compass className="w-4 h-4 shrink-0 text-volt" strokeWidth={1.75} />
                <p className="text-sm text-ink/80 flex-1 min-w-[12rem]">
                  {matchedKinds.length === 1
                    ? t('1 route can work with your answers — its live data and risks are on the card.')
                    : `${matchedKinds.length} ${t('routes can work with your answers — their live data and risks are on the cards.')}`}
                </p>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setFinderOpen(true)}
                    className="text-xs font-medium text-volt hover:underline"
                  >
                    {t('Change answers')}
                  </button>
                  <button
                    onClick={() => setMatchedKinds(null)}
                    className="text-xs text-ink/50 hover:text-ink transition-colors"
                  >
                    {t('Show all six')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-ink/[0.08] bg-ink/[0.02] px-4 py-3">
                <Compass className="w-4 h-4 shrink-0 text-volt" strokeWidth={1.75} />
                <p className="text-sm text-ink/70 flex-1 min-w-[12rem]">
                  {t('Not sure where to start? Two questions narrow the list to the routes that can work with what you hold.')}
                </p>
                <button
                  onClick={() => setFinderOpen(true)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-volt/30 bg-volt/10 px-3.5 py-2 text-xs font-semibold text-volt hover:bg-volt/20 transition-colors"
                >
                  {t('Guide me')}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </RevealItem>
          <RevealItem>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {(matchedKinds ? DEMO_VAULTS.filter((v) => matchedKinds.includes(v.kind)) : DEMO_VAULTS).map((v) => {
                // Out of reach for a council: the cage has no borrow (see
                // GOVERNED_UNSUPPORTED). The card says so instead of offering a
                // Start that dead-ends in the composer.
                const blocked = governedBlockOf(v.kind, !!activeGoverned);
                return (
                <Card key={v.kind} hover={!blocked} spotlight className={`flex flex-col ${blocked ? 'opacity-70' : ''}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {/* The pack's scene, badged with the asset it moves — the
                          card says "FXRP → Kinetic" in words, and now the mark
                          says which XRP it is: the FAssets one, on Flare. */}
                      <div className="relative shrink-0">
                        <div className={`w-11 h-11 rounded-xl grid place-items-center border ${v.accent}`}>{v.icon}</div>
                        <TokenLogo
                          symbol={v.asset}
                          size="sm"
                          className="absolute -bottom-1 -right-1 ring-2 ring-surface-1"
                        />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-ink">{v.title}</h3>
                        <p className="text-xs text-ink/45 mt-0.5">{t(v.action)}</p>
                      </div>
                    </div>
                    {blocked ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning shrink-0">
                        {t('Unsupported')}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-ink/15 bg-ink/5 text-ink/55 shrink-0">
                        {t(v.railLabel)}
                      </span>
                    )}
                  </div>

                  {/* Live yield — protocol data with a source (invariant #9): a
                      number when the protocol gives one, an honest label else.
                      The carry also surfaces the USDT0 borrow APR it pays (#6). */}
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <LiveYieldChip y={yields?.[v.kind]} showSource />
                    {(() => {
                      const yv = yields?.[v.kind];
                      const b = yv && yv.kind !== 'none' ? yv.borrow : undefined;
                      // No fallback caption: LiveYieldChip already says "live" —
                      // repeating it in a second chip was redundant (2026-07-21).
                      if (!b) return null;
                      return (
                        <span
                          title={`${b.asset} borrow APR — you pay`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning px-2 py-0.5 text-[11px]"
                        >
                          <span className="tabular-nums font-semibold">{b.aprPct.toFixed(2)}% {b.asset}</span>
                          <span className="text-tone-warning/70">{t('you pay')}</span>
                        </span>
                      );
                    })()}
                  </div>

                  {/* What it does, in one sentence a non-DeFi person can follow. */}
                  <p className="text-sm text-ink/70 leading-relaxed mb-4">{t(v.plain)}</p>

                  {/* The token journey, animated left → right. */}
                  <FlowStrip steps={v.flow} />

                  {/* The four facts people actually ask about — one quiet line,
                      not a grid of cajitas (de-AI pass 2026-07-21: six cloned
                      cards is enough visual weight without four boxes each). */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs">
                    {v.facts.map((f) => (
                      <span key={f.label} className="text-ink/40">
                        {t(f.label)}:{' '}
                        <span
                          className={
                            f.tone === 'amber'
                              ? 'text-tone-warning'
                              : f.tone === 'emerald'
                                ? 'text-tone-success'
                                : 'text-ink/70'
                          }
                        >
                          {t(f.value)}
                        </span>
                      </span>
                    ))}
                  </div>

                  {/* Why it cannot be started — said on the card, before the
                      click, in the contract's own terms. */}
                  {blocked && (
                    <p className="mb-3 flex items-start gap-2 rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-tone-warning/90">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{t(blocked)}</span>
                    </p>
                  )}

                  {/* One visible primary action; More info is a text link, not
                      a second button competing for attention. */}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <button
                      onClick={() => setInfoVault(v)}
                      className="inline-flex items-center gap-1 text-xs text-ink/45 hover:text-volt transition-colors shrink-0"
                    >
                      <Info className="w-3.5 h-3.5" />
                      {t('More info')}
                    </button>
                    {blocked ? (
                      <span className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-sm font-medium text-ink/35 cursor-not-allowed select-none">
                        {t('Unsupported for a council')}
                      </span>
                    ) : (
                      <PrimaryButton onClick={() => { setInitialInputs(undefined); setActive(v); }} className="flex-1">
                        {t('Start')} · {v.action}
                        <ArrowRight className="w-4 h-4" />
                      </PrimaryButton>
                    )}
                  </div>
                </Card>
                );
              })}
            </div>
          </RevealItem>
        </RevealGroup>
      )}

      {/* ── Create with AI Agent: a conversation, not a form. The chat keeps
             its working width; the rail beside it carries what you actually
             want at hand mid-conversation — the two ready routes for one-tap
             launch, and how the flow works. ── */}
      {view === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-5 items-start">
          {/* The agent compiles for whoever is operating: under a council it
              never offers the borrowing route — the cage cannot express it. */}
          <StrategyLLMChat onLaunch={launch} governed={!!activeGoverned} />

          <aside className="space-y-4">
            {/* Quick-launch: the two live packs, compact */}
            <Card spotlight padded={false} className="p-5">
              <MicroLabel>{t('Ready routes')}</MicroLabel>
              <ul className="mt-3 space-y-2.5">
                {DEMO_VAULTS.map((v) => {
                  const blocked = governedBlockOf(v.kind, !!activeGoverned);
                  return (
                  <li key={v.kind}>
                    <button
                      onClick={() => { setInitialInputs(undefined); setActive(v); }}
                      disabled={!!blocked}
                      className={`group/route w-full text-left rounded-xl border border-ink/[0.07] bg-ink/[0.02] transition-colors px-3.5 py-3 ${
                        blocked
                          ? 'opacity-55 cursor-not-allowed'
                          : 'hover:bg-ink/[0.05] hover:border-ink/[0.14]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-ink">{v.title}</span>
                        {!blocked && (
                          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-ink/25 -translate-x-1 opacity-0 group-hover/route:translate-x-0 group-hover/route:opacity-100 transition-all" />
                        )}
                      </div>
                      <div className="text-[11px] text-ink/45 mt-0.5">{v.action}</div>
                      <div className={`text-[10px] mt-1.5 ${blocked ? 'text-tone-warning/80' : 'text-ink/30'}`}>
                        {blocked ? t('Unsupported for a council') : t(v.railLabel)}
                      </div>
                    </button>
                  </li>
                  );
                })}
              </ul>
            </Card>

            {/* How the flow works — three honest beats */}
            <Card spotlight padded={false} className="p-5">
              <MicroLabel>{t('How it works')}</MicroLabel>
              <ol className="mt-3 space-y-3">
                {[
                  t('Describe what you have and what you want.'),
                  t('The agent compiles it with live protocol numbers.'),
                  t('You review every figure and sign in your own wallet.'),
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-5 h-5 shrink-0 grid place-items-center rounded-full border border-volt/25 bg-volt/[0.08] text-volt font-mono text-[10px]">
                      {i + 1}
                    </span>
                    <span className="text-xs text-ink/55 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 pt-3 border-t border-ink/[0.06] text-[10px] text-ink/35 leading-relaxed">
                {t('The agent has zero discretion: it never invents numbers, never promises yield, never executes.')}
              </p>
            </Card>
          </aside>
        </div>
      )}

      {/* ── Movements: send/receive between wallets + the XRPL savings-escrow
             surface, one of Earn's doors (the old /app/savings redirects
             here; pre-rename ?view=savings still lands here too). ── */}
      {view === 'movements' && <MovementsPanel />}

      {/* ── Create Manually: compose a strategy by hand — parameters,
             MoneyFlows and tools. Drafts land in Estrategias · Saved. ── */}
      {view === 'manual' && <ManualStrategyBuilder onLaunch={launch} />}

      {/* Estrategias, embedded (founder 2026-07-18): the registry lives inside
          Earn now — same component as /app/strategies, without its page header. */}
      {/* My strategies — the SAME full page in both products (founder
          2026-08-01: "debe ser igual que Personal"). The page itself is
          authority-aware: for a council it swaps MoneyFlows for the governed
          surface and the cage's cards open the council-order composer — the
          smart contract stays plumbing the person never sees. */}
      {view === 'strategies' && <StrategiesPage embedded onLaunch={launch} />}

      <p className="text-[11px] text-ink/30 mt-6 max-w-2xl leading-relaxed">
        {t(
          'Astryum is non-custodial: it builds unsigned payloads and hands them to your wallet. It never signs, never custodies, never broadcasts.',
        )}
      </p>

      {active && (
        <DemoVaultModal
          key={`${active.kind}-${initialInputs ? `${initialInputs.amount}-${initialInputs.ratio}-${initialInputs.targetHF}` : 'manual'}`}
          vault={active}
          initial={initialInputs}
          onClose={() => { setActive(null); setInitialInputs(undefined); }}
        />
      )}

      {/* The guided finder — two questions, then a result step that TEACHES
          each matching route (plain sentence, live rate with source, risk)
          before landing on the cards. Filters only; never launches or
          recommends anything on its own. Catalogue and yield chip go in as
          props so the finder has no runtime import back into this file. */}
      {finderOpen && (
        <StrategyFinder
          vaults={DEMO_VAULTS}
          yieldChip={(k) => <LiveYieldChip y={yields?.[k]} showSource />}
          onClose={() => setFinderOpen(false)}
          onResult={(kinds) => setMatchedKinds(kinds)}
        />
      )}

      {/* More info — the technical sheet + rate source + profitability
          calculator. Never signs; its Start hands off to the sign modal. */}
      {infoVault && (
        <StrategyInfoModal
          vault={infoVault}
          y={yields?.[infoVault.kind]}
          asOf={asOf}
          onClose={() => setInfoVault(null)}
          onStart={() => { const v = infoVault; setInfoVault(null); setInitialInputs(undefined); setActive(v); }}
        />
      )}
    </div>
  );
}

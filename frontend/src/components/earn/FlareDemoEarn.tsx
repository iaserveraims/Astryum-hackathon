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
 * Per docs/context/Astryum_Demos_Mainnet_Flare_Plan_2026-06-22.md, the packs on
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

import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectRuleCard } from '../moneyflows/ProtectRuleCard';
import { useDisconnect } from 'wagmi';
import { AnimatePresence, motion } from 'framer-motion';
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
  ChevronDown,
  PanelRight,
  PanelRightClose,
  Minus,
  Sparkles,
  HandCoins,
  type LucideIcon,
} from 'lucide-react';
// StrategyFinder (the two-question modal behind «Guide me») is UNMOUNTED
// 2026-08-22: the path is on the screen from the first second now
// (StrategyPath). Component preserved at components/earn/StrategyFinder.tsx.
import { StrategyPath } from './StrategyPath';
import {
  ASSET_GROUPS,
  KINSHIP,
  OUTCOMES,
  SORTS,
  assetGroupOf,
  hasDebt,
  outcomeOf,
  type AssetGroupId,
  type OutcomeId,
  type SortId,
} from '@/lib/earn/strategyTaxonomy';
import { StrategyFan } from './StrategyFan';
// El selector de activos + las dos tipologías. Sustituye al camino interactivo
// y a su menú de orden: lo que se ahorra arriba se lo quedan las cards.
import { EarnCatalog } from './EarnCatalog';
// StrategyColumns (las columnas verticales del 24-ago) queda INERTE desde el
// 25-ago: el fundador pidió la mano de siempre de vuelta. El componente NO se
// borra —código construido se deja inerte, no se elimina— y montarlo otra vez
// es cambiar un elemento por otro: tiene la misma firma de props que
// StrategyFan. Su vocabulario vive en strategyTaxonomy.CATALOGUE_COLUMNS,
// igualmente sin usar.
// El catálogo v2 (tres niveles: con qué → qué quieres que pase → con quién).
// Se monta DONDE VA A VIVIR y tapado (norma 20-ago): publicar es borrar el
// envoltorio y retirar el camino + la mano de abajo.
import { assetNoticeOf, type AssetNotice } from './assetDisclosure';
// De dónde sale un número, dicho para cualquiera — con la cadena técnica
// viajando en el tooltip para quien quiera comprobarla (#9).
import { readableAsOf, readableNote, readableSource } from '@/lib/earn/rateSource';
import { VenueContact } from '@/components/venue/VenueContact';
import { Card, GhostButton, MicroLabel, PageHeader, PrimaryButton } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import { DUR, EASE_OUT, PulseDot, RevealGroup, RevealItem } from '../ui/motion';
// FlowForgeScene and MoonScene are imported but not mounted: they are the
// scenes of the doors that are currently off the hub — Create Manually and
// Movements (hidden 2026-07-18), and the registry door that left on
// 2026-08-24. Kept so restoring a door is one <EarnDoor>, not a hunt.
import { ArmillaryScene, CollateralScene, ConstellationScene, FlowForgeScene, HarvestSunScene, HelmEmblem, MoonScene, OrbitScene, SunSealEmblem, TetherEmblem } from './icons';
import { useMotionLevel } from '../../stores/motionStore';
import { useEngraved } from '../../stores/themeStore';
import { BalanceMark, ColonnadeMark, GuillocheRosette } from '../ui/skin/marks';
// La barra de mando del agente (fundador 2026-08-29): una línea en el hub y
// en cada menú; la conversación solo se despliega al usarla.
import { AgentBar } from './AgentBar';
import { HelpDot } from '../ui/HelpDot';
import { AgentHistoryButton } from './AgentHistory';
// La tipología de cada ruta (fundador 2026-08-28: dos menús — earn y cash):
// la MISMA fuente que ya usa EarnCatalog para partir el catálogo en secciones.
import { actionOfKind, TYPOLOGIES, type TypologyId } from '../../lib/earn/protocols';
import ManagedVaultsSurface from '../managed/ManagedVaultsSurface';
import { CAPITAL_SECTION_HREF } from '../../lib/nav/capitalSection';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { formatMoneyCompact } from '../../lib/formatMoney';
import { hfWord } from '../../lib/healthScore';
import { fmtQtyActive } from '../../lib/format';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { resolvePersonalAccountOf } from '../../lib/wallet/paOwnership';
import { DispatchXrpField } from '../positions/DispatchXrpField';
import { useCarrierXrp } from '@/lib/flare/carrier';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useUniversalConnect } from '../../lib/wallet/useUniversalConnect';
import { useAuthorities } from '../../hooks/useAuthorities';
import { listMyWallets, type BackendWallet } from '../../services/walletLinkService';
import { SigningWalletPicker, useSigningWallets } from './SigningWalletPicker';
import { transferRailOf } from '../../lib/wallet/nativeBalance';
import { rulePrefillScope, stashRulePrefill } from '../../lib/automation/rulePrefill';
import { getUserRegion } from '../../lib/region';
import { useEthMorphoLive, lendYieldEntry, carryBorrowCost } from '../../lib/earn/useEthMorphoLive';
import { toBaseUnits, baseToHuman, emCallsFromLegs, emPreflightInfo, type EmLeg } from '../../lib/earn/ethMorphoPrepare';
import { EmBridgeModal } from './EmBridgeModal';
import { BorrowRiskMeter } from './BorrowRiskMeter';
import { walletDisplayName } from '../../lib/walletIdentity';
import { BorrowFlowRunner } from './BorrowFlowRunner';
import {
  decideRoute, originId,
  FLARE_CHAIN_ID, ETHEREUM_CHAIN_ID, type FxrpOrigin,
} from '../../lib/earn/fxrpOrigin';
import { rules as rulesApi } from '../../services/v1Api';
import { useFxrpBalances } from '../../lib/earn/useFxrpBalances';
import { EmExitModal } from '../positions/EmExitModal';
import { startPending, loadAllPending } from '../../lib/settlement/settlement';
import { releaseHandoffSeat, notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { SeatRefusalNotice, seatRefusalSentence } from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { noteFlareInstructionDelivery } from '../../lib/xaman/liveRequests';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
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
import { AmountSliderUsd } from '../positions/AmountSliderUsd';
import { CloseOperationButton, OperationSurface, OpWindowContext } from '../ui/OperationSurface';
import { useDockStore } from '../../stores/dockStore';
import { useOperationStore } from '../../stores/operationStore';
import { MANAGED_VAULTS_DOOR_OPEN } from '../../lib/nav/managerDesk';
import { isProductionDeploy } from '../../lib/nav/hackathonHub';
import { catalogForDeploy } from '../../lib/earn/productionVaults';

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

export type VaultKind =
  | 'e1' | 'e2' | 'e3' | 'v-firelight' | 'v-earnxrp' | 'v-monarq'
  // eth-morpho pair (W3, plan §13): Ethereum signing rail, gated at RUNTIME by
  // GET /eth-morpho/status (fail-closed) — the cards render only when active.
  | 'em-carry' | 'em-lend';

/** Partner-vault kinds share one backend route (/vault/prepare) — this maps the
 *  door kind to the backend's vault key. */
const VAULT_KEY: Partial<Record<VaultKind, 'firelight' | 'earnxrp' | 'monarq'>> = {
  'v-firelight': 'firelight',
  'v-earnxrp': 'earnxrp',
  'v-monarq': 'monarq',
};

export interface DemoVault {
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

// Exportado (2026-08-29): el AgentOperation del host global lanza estrategias
// desde el chat anclado — mismo catálogo, mismo camino prepare→review→sign.
export const DEMO_VAULTS: DemoVault[] = [
  {
    kind: 'e1',
    asset: 'FXRP',
    title: 'Earn on your XRP and borrow dollars',
    action: 'Kinetic · it earns, and backs a loan',
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
    title: 'Kinetic earning',
    action: 'The market rate on your XRP, with no loan',
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
    title: 'Firelight staking',
    action: 'You get a token you can still use while it earns',
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
      { label: 'When you get paid', value: 'Not yet — Firelight has not started paying', tone: 'amber' },
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
    title: 'earnXRP Vault',
    action: 'Strategies anyone can check on the chain',
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
      { label: 'Getting out', value: 'Right away for a 0.10% fee, or free after 24 h' },
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
    title: 'Monarq XRP fund',
    action: 'Run off the chain, so you cannot check it',
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
      { label: 'Getting out', value: 'You wait 7 days, or pay 0.30% to leave now', tone: 'amber' },
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
    title: 'Earn FLR',
    action: 'It stays in your wallet, working for the network',
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
      { label: 'When you get paid', value: 'Roughly every 3–4 days' },
    ],
    legs: [
      'WNat contract: FLR wrapped into WFLR',
      'WFLR vote power delegated to the FTSO provider you pick',
      'The network pays roughly every 3–4 days. It is its rate, not an Astryum offer',
    ],
    icon: <Coins className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  // ── The eth-morpho pair (W3): Ethereum rail, runtime-gated by /status ──────
  {
    kind: 'em-carry',
    asset: 'FXRP',
    // NO es un carry, y llamarlo así era el error de fondo (fundador, 19-ago).
    // Un carry gana un diferencial; aquí el colateral en Morpho Blue **no cobra
    // supply rate**, así que no hay diferencial que ganar y el préstamo sólo
    // tiene coste. Lo que este producto da es otra cosa, y es legítima:
    // LIQUIDEZ SIN VENDER. Mantienes tu exposición a FXRP y sacas RLUSD
    // gastable contra ella. El 6-7% anual no es un rendimiento a batir: es el
    // precio de no vender.
    //
    // (La card gemela de Kinetic SÍ es un carry y conserva la palabra: allí el
    // colateral cobra el interés de supply del mercado.)
    title: 'Get dollars without selling your XRP',
    action: 'Morpho · your XRP is the guarantee, and it can be liquidated',
    rail: 'evm',
    railLabel: 'Ethereum wallet',
    // La protección NO viene con esta firma: es una regla que se arma DESPUÉS,
    // desde la card de la posición. Decirlo como si viniera incluida —en el
    // `plain`, en un hecho verde y como TERCERA PATA de la entrada— era vender
    // una red que nadie había tendido: el usuario firma la deuda creyendo que
    // tiene stop-loss, el FXRP cae de noche y no hay tick que mire esa posición.
    // Es la familia «éxito no ganado» aplicada al riesgo, que es su peor
    // versión: un error se reintenta, pero un «estás protegido» hace que dejes
    // de mirar. (Auditoría 2026-08-17.)
    plain:
      'Keep your FXRP and still get liquidity from it. Your FXRP stays yours as collateral in the Morpho FXRP/RLUSD market on Ethereum, and you borrow RLUSD — a regulated e-money token — straight to your own wallet. This is not a yield strategy: collateral earns nothing here and the borrow costs interest, shown live with its source before you sign. What you get is spendable liquidity without selling your exposure. Repay protection is a separate rule you arm afterwards; entering does not arm it.',
    flow: [
      { token: 'FXRP', sub: 'your wallet (Ethereum)' },
      { token: 'Morpho', sub: 'collateral' },
      { token: '+RLUSD', sub: 'borrowed' },
    ],
    facts: [
      { label: 'Works in', value: 'Morpho FXRP/RLUSD market (Ethereum)' },
      { label: 'You get', value: 'RLUSD — a regulated e-money token — in your own wallet' },
      // Dicho en la card, no en la letra pequeña: el colateral no renta. Es la
      // frase que impide que alguien lea esto como una estrategia de yield.
      { label: 'Your FXRP', value: 'Stays yours as collateral — it earns nothing while it sits there', tone: 'amber' },
      { label: 'Risk', value: 'Medium — if FXRP falls far enough, the position is liquidated', tone: 'amber' },
      // Sin tono verde: el verde de los otros hechos dice «esto ya está»; aquí
      // lo cierto es «esto está disponible y depende de que lo actives».
      { label: 'Protection', value: 'Optional — a repay rule you arm after entering', tone: 'amber' },
    ],
    // `legs` describe lo que HACE la transacción. La protección no era una pata.
    legs: [
      'Your FXRP on Ethereum is supplied to the Morpho market as collateral',
      'RLUSD is borrowed at your chosen ratio, straight to your own wallet',
      'Exit: repay the RLUSD, withdraw your FXRP',
    ],
    icon: <Droplets className="w-5 h-5" />,
    accent: 'text-volt border-volt/30 bg-volt/10',
  },
  {
    kind: 'em-lend',
    asset: 'RLUSD',
    title: 'Lend your RLUSD',
    action: 'Sentora decides where it goes',
    rail: 'evm',
    railLabel: 'Ethereum wallet',
    plain:
      'Your RLUSD is lent into the Sentora RLUSD vault on Morpho (Ethereum). Lending here is exposure to the aggregate of the curator’s allocations — not to a single market. No debt on your side; withdraw against the vault’s live liquidity.',
    flow: [
      { token: 'RLUSD', sub: 'your wallet (Ethereum)' },
      { token: 'Sentora', sub: 'lent' },
      { token: 'Yield', sub: 'vault rate' },
    ],
    facts: [
      { label: 'Works in', value: 'Sentora RLUSD Main vault (Morpho)' },
      { label: 'Curator', value: 'Sentora decides the allocation — aggregate exposure', tone: 'amber' },
      { label: 'Risk', value: 'No debt on your side — curator and market risk remain', tone: 'amber' },
      { label: 'Withdraw', value: 'Anytime, against the vault’s live liquidity' },
    ],
    legs: [
      'Your RLUSD is deposited into the Sentora vault (finite approval, exact amount)',
      'The curator allocates across Morpho markets — yield accrues in the share price',
      'Withdraw returns RLUSD to your wallet, against live vault liquidity',
    ],
    icon: <Sprout className="w-5 h-5" />,
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
  // The cage lives on FLARE and reaches whitelisted Flare venues only — the
  // eth-morpho pair works on Ethereum, out of a council order's reach entirely.
  'em-carry':
    'The council’s vault lives on Flare and can only put principal to work in whitelisted Flare venues. This entry works on Ethereum and borrows RLUSD — it cannot be composed as a council order.',
  'em-lend':
    'The council’s vault lives on Flare and can only put principal to work in whitelisted Flare venues. This entry lends RLUSD on Ethereum — it cannot be composed as a council order.',
};

/** Why this pack is out of reach for the ACTIVE authority, or null if it isn't. */
function governedBlockOf(kind: VaultKind, governed: boolean): string | null {
  return governed ? (GOVERNED_UNSUPPORTED[kind] ?? null) : null;
}

/**
 * The regulatory notice of what a pack borrows (assetDisclosure.ts), rendered
 * identically wherever it appears: the pick card, the info sheet, and the
 * review step — the last screen before the wallet opens. Same posture as the
 * fee disclosure (invariant #12): said BEFORE the signature, never after, and
 * never conditioned on the device-local region, which is unset for most people
 * and would hide the notice from exactly the reader it is written for.
 */
function AssetNoticeBox({ notice, className = '' }: { notice: AssetNotice; className?: string }) {
  const { t } = useT();
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] px-3 py-2.5 ${className}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-tone-warning" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-snug text-tone-warning">
          {t(notice.headline)} <span className="font-mono text-tone-warning/60">· {notice.asset}</span>
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/55">{t(notice.body)}</p>
      </div>
    </div>
  );
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
  'em-carry': {
    protocolName: 'Morpho — FXRP/RLUSD market (lend side curated by Sentora)',
    website: 'https://morpho.org',
    yieldMechanism:
      'Morpho Blue is an isolated-market lending protocol on Ethereum. In this market your FXRP is collateral only — it earns no supply interest; what you get is RLUSD liquidity against it at the market’s floating borrow rate (AdaptiveCurveIRM, read on-chain). The lend side is funded by the Sentora RLUSD vault. Your cost is the borrow APR, your protection is the repay rule you choose, and rates float with utilization.',
  },
  'em-lend': {
    protocolName: 'Sentora RLUSD Main (Morpho vault)',
    website: 'https://morpho.org',
    yieldMechanism:
      'A curated Morpho vault on Ethereum: your RLUSD is lent across the markets the curator (Sentora) allocates to, and the interest borrowers pay accrues in the vault’s share price, net of the curator’s performance fee. Lending here is exposure to the AGGREGATE of those allocations — not to any single market. The net rate shown includes incentives and is always served with its source.',
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
  | {
      kind: 'none';
      pct: null;
      source: null;
      label: string;
      /**
       * El coste TAMBIÉN cuando no hay rendimiento (fundador 2026-08-22): la
       * card de carry no gana nada por el colateral — en Morpho Blue el
       * colateral jamás se presta — pero la deuda SÍ tiene precio, y ese
       * «pagas X%» tiene que estar en la card, no solo en la revisión.
       */
      borrow?: { asset: string; aprPct: number };
    };

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

function Row({
  label,
  value,
  mono = false,
  info,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  /** Tap-to-open ⓘ explaining WHERE this line comes from (founder 2026-08-17:
   *  every fee on the sign screen carries its own why — informed, quieter).
   *  Mobile-first like FieldLabelInfo: a tooltip does not exist on touch. */
  info?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex justify-between items-center gap-4">
        <span className="text-ink/45 inline-flex items-center gap-1">
          {label}
          {info && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`${label} — info`}
              className={`inline-grid place-items-center w-3.5 h-3.5 rounded-full border text-[9px] leading-none transition-colors ${
                open ? 'border-volt/50 text-volt' : 'border-ink/20 text-ink/40 hover:text-ink/70'
              }`}
            >
              i
            </button>
          )}
        </span>
        <span className={`text-ink/85 text-right ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
      </div>
      {info && open && (
        <p className="mt-1 mb-1.5 text-[10px] leading-relaxed text-ink/45 border-l-2 border-volt/30 pl-2">
          {info}
        </p>
      )}
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

/**
 * it. 19 (R5 R7) — LA PALABRA DE LA ENTREGA, REGISTRADA EN CADA 0xFE.
 *
 * Every prepare here uses raw `fetch`, so nothing fed the live banner the
 * server's word about the executor that carries this 0xFE to Flare, and the
 * banner fell back to the prudent sentence over perfectly normal entries. Read
 * defensively: a body without `serverDelivery` leaves the banner NEUTRAL (it
 * accuses nobody of not delivering), and only `executorEnabled === true` lets it
 * promise a delivery. A body that is not a 0xFE is ignored inside the registry.
 */
function noteHandoffDelivery(body: { xrplPayment?: unknown; serverDelivery?: { executorEnabled?: unknown } } | null | undefined): void {
  noteFlareInstructionDelivery(body?.xrplPayment, body?.serverDelivery);
}

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
  } & PaEntryDisclosure;
}

/** Smart-Account entry fields (fromSmartAccount, 2026-08-12): the strategy
 *  spends FXRP the PA already holds; the Payment is only the 0xFE carrier,
 *  whose own net mint JOINS the deposit. grossXrp is absent by design. */
interface PaEntryDisclosure {
  entry?: 'smart-account';
  fxrpFromAccount?: number;
  mintCoupledXrp?: number;
  fxrpMintedSideEffect?: number;
}

interface E2Prepared {
  rail: 'evm';
  chainId: number;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  disclosure: { amountFlr: number; provider: string; bips: number; flrPriceUSD: number | null; note: string };
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
  } & PaEntryDisclosure;
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
  } & PaEntryDisclosure;
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

/** The eth-morpho pair (em-carry / em-lend): EVM-direct on ETHEREUM. The
 *  adapted PreflightInfo rides under `preflight`, so PreflightNotice and the
 *  sign-button gate work unchanged. Amounts in emAmounts are the HUMAN strings
 *  the user typed (review shows them verbatim; base units already live inside
 *  the calls). */
interface EmPrepared extends DirectPreparedBase {
  em: 'carry' | 'lend';
  hfBefore: number | null;
  hfAfter: number | null;
  /** Keeps every existing `prepared.disclosure` access type-valid; carries the
   *  custody/signer note the shared review column already renders. */
  disclosure: { note: string };
  emAmounts: { supply?: string; borrow?: string; amount?: string };
  /** carry + lendBorrowed: the vault legs the server appended to the calls. */
  emLend?: { vault: string; assetsHuman: string };
  emDisclosure: {
    lltvPct?: number;
    utilizationPct?: number;
    availableLiquidity?: string;
    borrowAprPct?: number | null;
    borrowAprSource?: string;
    totalAssets?: string;
    curatorNote?: string;
    signerNote: string;
    astryumFeeBase: string;
    approvals: string;
  };
  preflight: import('../../lib/preflight').PreflightInfo;
}

type Prepared =
  | E1Prepared
  | E2Prepared
  | E3Prepared
  | VaultPrepared
  | E1PreparedEvm
  | E3PreparedEvm
  | VaultPreparedEvm
  | EmPrepared;

// familia-no-pude-leer (2026-08-20): 'unconfirmed' is the ending an ENTRY was
// missing. Its catch returned every failure to 'review' — the sign button —
// including a 0xFE dispatch whose hash Xaman could not hand back, so the way to
// react to "I could not read it" was the same tap that pays a second carrier
// fee in XRP, takes a second nonce seat and deposits a second time.
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'error' | 'unconfirmed';

export function DemoVaultModal({
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
  // ANCLAJE (fundador 2026-08-25: «estoy haciendo la estrategia... no me
  // permite anclar el cuadro») — misma receta que el piloto de posiciones.
  const docked = useDockStore((st) => st.docked);
  const setDocked = useDockStore((st) => st.setDocked);
  // Multi-op: minimizar = ceder el sitio de activa; el dock lo suelta la
  // superficie al cerrarse la última operación, no cada consumidor.
  const minimizeActive = useOperationStore((st) => st.minimizeActive);
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const connect = useUniversalConnect(async () => {});
  const { disconnectAsync } = useDisconnect();
  // The signing scope follows the AUTHORITY SWITCHER: a single authority
  // narrows the picker to its wallet; a governed authority blocks personal
  // Earn entirely (council capital moves by quorum-signed council order, never
  // by a personal signature while the bar says "Governing…").
  const { active: activeAuthority, activeGoverned } = useAuthorities();

  // ── QUIEN FIRMA: extraido a components/earn/SigningWalletPicker (27-ago) ──
  //
  // Estas ~80 lineas vivian aqui, y por eso las Bovedas con gestor se habian
  // inventado su propio selector de carril. Ahora hay UNA fuente: este modal y
  // el de las bovedas piden el mismo hook y pintan el mismo desplegable, asi que
  // no pueden divergir. La logica no cambia — se mudo entera, con sus notas.
  //
  // Los nombres de siempre se conservan como alias: el resto del componente
  // (unas veinte referencias) sigue leyendo `candidates`, `selected`,
  // `activeRail` y `reloadWallets` sin enterarse de la mudanza.
  const signingWallets = useSigningWallets({
    defaultRail: vault.rail,
    evmOnly: vault.kind === 'e2',
    multiChain: vault.kind === 'em-carry' || vault.kind === 'em-lend',
  });
  const allCandidates = signingWallets.allCandidates;
  const candidates = signingWallets.candidates;
  const selectedAddr = signingWallets.selectedKey;
  const setSelectedAddr = signingWallets.setSelectedKey;
  const selected = signingWallets.selected;
  const reloadWallets = signingWallets.reload;
  /** The rail the SELECTED wallet signs on — decides prepare body + payload. */
  const activeRail: 'xrpl' | 'evm' = signingWallets.activeRail;

  // The wallet partner that will SIGN must hold this exact address.
  const signerAddress = activeRail === 'xrpl' ? xrpl.address : evm.address;
  // XRPL: the payload PINS the selected account, so no session in this browser
  // is fine (Xaman asks for that account on scan, 2026-09-17); a DIFFERENT live
  // session is still a mismatch worth saying. EVM keeps needing the exact wallet.
  const signerMatches =
    !!selected &&
    (activeRail === 'xrpl'
      ? !signerAddress || signerAddress.toLowerCase() === selected.record.address.toLowerCase()
      : !!signerAddress && signerAddress.toLowerCase() === selected.record.address.toLowerCase());

  // Inputs (optionally pre-filled by the NLP compiler — always user-reviewable)
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [borrowRatio, setBorrowRatio] = useState(initial?.ratio ?? '0.30'); // E1
  const [targetHF, setTargetHF] = useState(initial?.targetHF ?? '1.10'); // E1
  // em-carry: the RLUSD to borrow, as an EXPLICIT amount — no client-side
  // ratio×price math (the backend pre-flights + the HF-after in review guide
  // the user instead; money math never lives in the browser).
  const [emBorrowAmt, setEmBorrowAmt] = useState('');
  // B6-UI: the bridge door (FXRP Flare→Ethereum), offered from the em forms
  // when the user's FXRP still lives on Flare.
  const [emBridge, setEmBridge] = useState(false);
  // H2 — la salida de la bóveda Sentora, ofrecida desde la card que la promete.
  const [emVaultExit, setEmVaultExit] = useState(false);

  // What the XRPL rail SPENDS (founder 2026-08-12: "si ya tengo FXRP, la
  // plataforma me obliga a tener primero XRP"): fresh XRP (mint) or FXRP the
  // Smart Account ALREADY holds (fromSmartAccount — no new mint beyond the
  // mandatory 0xFE carrier). The toggle only appears when the account has
  // free FXRP; the signature is the same Xaman Payment either way.
  const [paySource, setPaySource] = useState<'xrp' | 'pa-fxrp'>('xrp');
  // Carrier auto (founder 2026-08-17): live fees + margin from the backend
  // — no user knob; can never block the operation (lib/flare/carrier).
  const xrpForMint = useCarrierXrp();
  const [paFxrpFree, setPaFxrpFree] = useState<number | null>(null);
  useEffect(() => {
    setPaySource('xrp');
    setPaFxrpFree(null);
    if (!selected || selected.rail !== 'xrpl' || vault.kind === 'e2') return;
    let cancelled = false;
    (async () => {
      try {
        const pa = await resolvePersonalAccountOf(selected.record.address);
        if (!pa || cancelled) return;
        const res = await fetch(`${API_BASE}/flare-demo/pa-fxrp/${encodeURIComponent(pa)}`, {
          headers: authHeaders(),
          credentials: 'include',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { freeFxrp?: number };
        if (!cancelled && typeof body.freeFxrp === 'number' && Number.isFinite(body.freeFxrp)) {
          setPaFxrpFree(body.freeFxrp);
        }
      } catch {
        /* best-effort: no reading, no toggle — the mint path still works */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.record.address, selected?.rail, vault.kind]);
  // «Pagar con el FXRP ya minteado en la Personal Account» aplica también a la
  // entrada de Ethereum — ahí decide el PRIMER PASO del flujo (sacar de la PA
  // vs mintear XRP fresco), no el prepare de e1. Lo único que no viaja a esa
  // entrada es el campo del carrier de e1 (gateado aparte por !isEmKind).
  const paSourceActive =
    paySource === 'pa-fxrp' && selected?.rail === 'xrpl' && vault.kind !== 'e2';
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
  /**
   * El memo del último 0xFE preparado aquí. Sobrevive al payload: cuando el
   * siguiente intento choca contra el asiento suele ser ESTE borrador, y con el
   * memo se puede ofrecer liberarlo (it. 17, R5 5.4 · R1 1.5).
   */
  const abandonedMemo = useRef<string | null>(null);
  if (seatRef.current.memoHex) abandonedMemo.current = seatRef.current.memoHex;
  /** El cuerpo de un rechazo de asiento: lo dice y lo resuelve el aviso compartido. */
  const [seatRefusal, setSeatRefusal] = useState<unknown>(null);
  // Invariant #11 — the prepare's dry-run verdict (e1 today; optional elsewhere).
  const preflight = (prepared as { preflight?: PreflightInfo } | null)?.preflight;
  const [errorMsg, setErrorMsg] = useState('');
  // What a signature we could not follow left behind: the hash to check (EVM
  // rail) and the wallet's verbatim words — never a translated verdict.
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Settlement is the PRIMARY state after signing — 'done' means "signed", the
  // machine (lib/settlement) says settled/failed/stalled. The XRPL rail polls
  // mint-status (0xFE really executed — stuck-mint lesson, 2026-07-12), the
  // EVM rails the receipt / 5792 bundle status. No local poll, no local green.
  const settlement = useSettlement();
  // LA VENTANA SOBREVIVE A LA RECARGA (fundador 2026-09-09): si esta ventana
  // rehidratada firmó algo que sigue liquidándose, readopta ese asiento y
  // reabre directamente en «en proceso» — no en el formulario en blanco.
  const win = useContext(OpWindowContext);
  useEffect(() => {
    if (!win?.id) return;
    const pending = loadAllPending().find((p) => p.opKey === win.id);
    if (!pending) return;
    settlement.adopt(pending);
    setPhase('done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // EL ASIENTO DE NONCE, PRIMERO Y EN INGLÉS (it. 17, R5 5.4). El servidor
    // contesta `NONCE_SEAT_TAKEN` y un párrafo en castellano con hashes: el
    // único lector de ese veredicto es `lib/xaman/seatRefusal`, y el cuerpo se
    // guarda para poder ofrecer «Free the seat» sobre el borrador que esta
    // pantalla preparó y abandonó.
    const seat = seatRefusalSentence(body, t);
    if (seat) {
      setSeatRefusal(body);
      return seat;
    }
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
    // eth-morpho pair (B5-UI paso 4.14) — the module's own codes, in human words.
    if (code === 'ETH_RLUSD_FXRP_DISABLED') {
      return t('This strategy is not open yet — the module is switched off.');
    }
    if (code === 'ETH_RPC_UNAVAILABLE') {
      return t('We cannot reach Ethereum right now. Nothing moved — try again in a minute.');
    }
    if (code === 'MARKET_PARAMS_DRIFT' || code === 'VAULT_ASSET_MISMATCH') {
      return t('The market on-chain no longer matches what we verified — we refuse to build this transaction. Nothing moved.');
    }
    if (code === 'BORROW_EXCEEDS_LIQUIDITY') {
      return t('The market cannot lend that much right now — lower the borrow amount.');
    }
    if (code === 'WITHDRAW_EXCEEDS_BALANCE') {
      return t('You cannot withdraw more than your lent balance allows right now.');
    }
    if (code === 'REPAY_EXCEEDS_DEBT') {
      return t('That is more than the live debt — use the full-repay option to close it.');
    }
    if (code === 'PREPARE_FAILED') {
      return t('We could not prepare the operation right now. Nothing moved — try again in a minute.');
    }
    // it. 22 (Q3 3.7) — EL ÚLTIMO RECURSO TAMPOCO PINTA EL SERVIDOR EN CRUDO.
    // Aquí acababa `body.detail || body.error`: el párrafo en castellano del
    // backend, o su slug. `refusalHeadline` convierte el código en una frase
    // (y conoce los «no pude leer»), y el `detail` solo acompaña si está en el
    // idioma de la pantalla.
    const head = refusalHeadline(body, t);
    const detail = serverDetailIfEnglish(body.detail);
    return (
      [head, detail].filter((p): p is string => Boolean(p)).join(' — ') ||
      `${t('The server refused this operation. Nothing was prepared and nothing was signed.')} (HTTP ${status})`
    );
  }

  async function prepare() {
    setErrorMsg('');
    setSeatRefusal(null);
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
    // Flare EVM wallet spends its own FXRP directly (no mint) — and the XRPL
    // rail can also spend FXRP the Smart Account ALREADY holds
    // (fromSmartAccount): same Xaman signature, only the carrier Payment.
    const signerFields =
      activeRail === 'evm' && vault.kind !== 'e2'
        ? { evmAddress: selected.record.address, amountFxrp: amountNum }
        : paSourceActive
          ? {
              xrplAddress: selected.record.address,
              amountFxrp: amountNum,
              fromSmartAccount: true,
              amountXrpForMint: xrpForMint,
            }
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
        noteHandoffDelivery(body);
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
        noteHandoffDelivery(body);
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
        noteHandoffDelivery(body);
        setPrepared(body as VaultPrepared | VaultPreparedEvm);
      } else if (vault.kind === 'em-carry' || vault.kind === 'em-lend') {
        // eth-morpho pair: EVM-direct on ETHEREUM (the wallet switches chain at
        // sign time). Amounts convert with decimals READ on-chain — fetched
        // fresh here, never assumed (F4: the 6/18 asymmetry).
        if (activeRail !== 'evm') {
          throw new Error(t('This entry signs with your EVM wallet — select it to continue.'));
        }
        const region = getUserRegion();
        const regionQs = `?region=${encodeURIComponent(region ?? '')}`;
        const toBase = (human: string, decimals: number, label: string): string => {
          try {
            return toBaseUnits(human, decimals);
          } catch (err) {
            const c = (err as { code?: string }).code;
            if (c === 'AMOUNT_TOO_PRECISE') {
              throw new Error(`${label}: ${t('too many decimals for this asset')} (max ${decimals})`);
            }
            throw new Error(`${label}: ${t('enter a valid amount greater than 0')}`);
          }
        };
        if (vault.kind === 'em-lend') {
          const vres = await fetch(`${API_BASE}/eth-morpho/vault${regionQs}`, {
            headers: authHeaders(), credentials: 'include',
          });
          const vinfo = await vres.json().catch(() => ({}));
          if (!vres.ok) throw new Error(friendlyHttpError(vres.status, vinfo));
          const amountBase = toBase(amount, Number(vinfo.assetDecimals ?? 18), 'RLUSD');
          const res = await fetch(`${API_BASE}/eth-morpho/vault/prepare`, {
            method: 'POST', headers: authHeaders(), credentials: 'include',
            body: JSON.stringify({
              action: 'vault_deposit', user: selected.record.address, amountBase, region,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          setPrepared({
            rail: 'evm', entry: 'evm-direct', chainId: body.chainId,
            account: selected.record.address,
            calls: emCallsFromLegs(body.legs as EmLeg[], body.chainId),
            em: 'lend', hfBefore: null, hfAfter: null,
            disclosure: { note: body.disclosure.signerNote },
            emAmounts: { amount },
            emDisclosure: {
              totalAssets: baseToHuman(body.disclosure.totalAssetsBase, body.decimals.asset, 0),
              curatorNote: body.disclosure.curatorNote,
              signerNote: body.disclosure.signerNote,
              astryumFeeBase: body.disclosure.astryumFeeBase,
              approvals: body.disclosure.approvals,
            },
            preflight: emPreflightInfo(body),
          } satisfies EmPrepared);
        } else {
          const borrowNum = parseFloat(emBorrowAmt.replace(',', '.')) || 0;
          if (borrowNum <= 0) {
            throw new Error(t('Enter how much RLUSD to borrow — greater than 0.'));
          }
          const mres = await fetch(`${API_BASE}/eth-morpho/market${regionQs}`, {
            headers: authHeaders(), credentials: 'include',
          });
          const minfo = await mres.json().catch(() => ({}));
          if (!mres.ok) throw new Error(friendlyHttpError(mres.status, minfo));
          const amountBase = toBase(amount, Number(minfo.decimals?.collateral ?? 6), 'FXRP');
          const borrowBase = toBase(emBorrowAmt, Number(minfo.decimals?.loan ?? 18), 'RLUSD');
          const res = await fetch(`${API_BASE}/eth-morpho/prepare`, {
            method: 'POST', headers: authHeaders(), credentials: 'include',
            body: JSON.stringify({
              action: 'open_carry', user: selected.record.address, amountBase, borrowBase, region,
              lendBorrowed: emLendBorrowed,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(friendlyHttpError(res.status, body));
          setPrepared({
            rail: 'evm', entry: 'evm-direct', chainId: body.chainId,
            account: selected.record.address,
            calls: emCallsFromLegs(body.legs as EmLeg[], body.chainId),
            em: 'carry',
            hfBefore: body.position?.healthFactor ?? null,
            hfAfter: body.positionAfter?.healthFactor ?? null,
            disclosure: { note: body.disclosure.signerNote },
            emAmounts: { supply: amount, borrow: emBorrowAmt },
            // Lo que el servidor COMPUSO, no lo que se pidió: si `lend` viene,
            // las patas de la bóveda están dentro de `calls` y la revisión lo dice.
            emLend: body.lend
              ? { vault: String(body.lend.vault), assetsHuman: emBorrowAmt }
              : undefined,
            emDisclosure: {
              lltvPct: body.disclosure.lltvPct,
              utilizationPct: body.disclosure.utilizationPct,
              availableLiquidity: baseToHuman(body.disclosure.availableLiquidityBase, body.decimals.loan, 0),
              borrowAprPct: body.disclosure.borrowAprPct,
              borrowAprSource: body.disclosure.borrowAprSource,
              signerNote: body.disclosure.signerNote,
              astryumFeeBase: body.disclosure.astryumFeeBase,
              approvals: body.disclosure.approvals,
            },
            preflight: emPreflightInfo(body),
          } satisfies EmPrepared);
        }
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
    setUnconfirmed(null);
    setPhase('signing');
    // Knowledge no error message carries: whether the payload was handed to the
    // wallet partner at all. Everything thrown before this flips is provably
    // unsigned. It says PARTNER, not wallet: sendIntentCalls still guards its
    // input, switches chain and estimates gas before any wallet opens, and what
    // that stage refuses is subtracted by name inside signOutcome.
    let handedToPartner = false;
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
        if (!xrpl.isConnected && !pinnedXrplSigner(prepared.xrplPayment)) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        handedToPartner = true;
        const { txHash: hash } = await xrpl.sendIntent({
          // XamanWalletService injects Account; we hand it the unsigned Payment.
          tx: prepared.xrplPayment as never,
        });
        // El backend aprende «firmado» (incidente 2026-08-21): el asiento de
        // nonce queda intocable — ni TTL, ni release, ni supersede — hasta
        // ejecutar o aparcar. Sin esto, un executor lento + un reintento
        // firman un gemelo condenado que pierde su carrier.
        notifyHandoffSigned((prepared as { memoHex?: string }).memoHex, hash);
        // Signed ≠ minted: the machine follows the 0xFE execution on Flare.
        settlement.track(startPending('xrpl-mint', hash), undefined, { opKey: win?.id });
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        handedToPartner = true;
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        // La entrada DIRECTA de carry arma la protección al ASENTAR — la misma
        // regla que el flujo con puente crea al completarse. Nunca antes: una
        // regla sobre una posición que no llegó a existir es un vigilante de
        // nada. La dirección se captura AQUÍ: `selected` puede cambiar antes
        // de que el settlement dispare el callback.
        const emRuleWallet =
          vault.kind === 'em-carry' && emProtectOn && selected ? selected.record.address : null;
        settlement.track(
          handle,
          emRuleWallet ? { onSettled: () => void createEmProtectRule(emRuleWallet) } : undefined,
          { opKey: win?.id },
        );
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
      // familia-no-pude-leer — «no pude leer» NO es «falló». The line that stood
      // here ("the prepared payload is still valid — the user retries the
      // SIGNATURE") is true only when the signature provably never left. After
      // a dispatch we could not read, that same review screen is one tap from
      // a second entry: a second carrier fee in XRP, a second nonce seat, a
      // second deposit. One decision for every signing surface, and the words
      // it prints come from it too (lib/wallet/signOutcome).
      //
      // Incluido el veredicto que SÍ leímos (it. 17, R5 5.2): un tefMAX_LEDGER /
      // tefPAST_SEQ sale como vista 'form' con la frase «prepáralo otra vez»
      // (aquí, fase 'error', que es la que pinta el formulario) en vez del
      // ámbar «no pude confirmarlo», que cerraba la única puerta correcta.
      applySignFailure(e, handedToPartner, t, {
        setError: setErrorMsg,
        setUnconfirmed,
        // This modal shows its form-level errors under the 'error' phase, which
        // renders the form; 'review' and 'unconfirmed' are phases of their own.
        setPhase: (view) => setPhase(view === 'form' ? 'error' : view),
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  // What the amount input denominates: XRPL rail pays XRP (minted 1:1 into
  // FXRP), the direct rail spends the wallet's FXRP, e2 wraps FLR — and the
  // Smart-Account source spends FXRP already minted (no new XRP).
  const amountAsset =
    vault.kind === 'em-lend' ? 'RLUSD'
    // La entrada de carry con Xaman pagando XRP fresco escribe XRP (el mint lo
    // convierte); con la PA o con una wallet EVM, FXRP.
    : vault.kind === 'em-carry' ? (activeRail === 'xrpl' && paySource === 'xrp' ? 'XRP' : 'FXRP')
    : vault.kind === 'e2' ? 'FLR'
    : activeRail === 'evm' || paSourceActive ? 'FXRP' : 'XRP';

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
    // eth-morpho pair, EVM rows: the asset lives on ETHEREUM and this endpoint
    // reads Flare — `emBalances` (the carril's own two-chain read) fills the
    // line instead; nothing here would be honest. The XRPL row DOES fall
    // through: it pays XRP, and the XRP balance read is this same one every
    // Flare entry uses (reserve already excluded).
    if ((vault.kind === 'em-carry' || vault.kind === 'em-lend') && activeRail !== 'xrpl') {
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
    paSourceActive
      ? paFxrpFree
      : available == null
        ? null
        : vault.kind === 'e2'
          ? Math.max(0, available - 1)
          : activeRail === 'xrpl'
            ? Math.max(0, available - XRPL_STEERING_RESERVE)
            : available;
  /** Typed amount would leave the XRPL wallet below the steering reserve.
   *  Not applicable to the Smart-Account source: the amount there is FXRP
   *  already on Flare — only the small carrier leaves the XRPL wallet. */
  const drainsXrplSteering =
    activeRail === 'xrpl' &&
    !paSourceActive &&
    available != null &&
    (parseFloat(amount) || 0) > 0 &&
    available - (parseFloat(amount) || 0) < XRPL_STEERING_RESERVE;
  const isEmKind = vault.kind === 'em-carry' || vault.kind === 'em-lend';
  /**
   * El camino que le falta a la wallet elegida para poder entrar, o null si ya
   * puede firmar aquí. Solo aparece cuando se elige una wallet XRPL para una
   * entrada de Ethereum: su FXRP vive en la Personal Account y hay que traerlo.
   */
  /**
   * Los saldos del carril para la wallet EVM elegida. Solo se leen cuando hace
   * falta: la entrada de Ethereum es la única que los usa.
   */
  const emBalances = useFxrpBalances(
    isEmKind && selected?.rail === 'evm' ? selected.record.address : null,
  );
  /** La cadena de la fila elegida: decide QUÉ saldo se enseña. */
  const emOnFlare = selected?.rail === 'evm' && selected.chainId === FLARE_CHAIN_ID;
  /** El asset que se aporta, con SUS decimales leídos (asimetría 6/18). */
  const emAssetBase =
    vault.kind === 'em-lend'
      ? emBalances.rlusdEthereumBase
      : emOnFlare
        ? emBalances.fxrpFlareBase
        : emBalances.fxrpEthereumBase;
  const emAssetDecimals = vault.kind === 'em-lend' ? emBalances.rlusdDecimals : emBalances.fxrpDecimals;
  /**
   * ¿Esto cruza cadenas? Lo decide el SALDO, no el usuario: si el FXRP ya está
   * en Ethereum se entra directo; si está en Flare hace falta el puente. Solo
   * aplica a la entrada de carry (la de lend gasta RLUSD, que no se puentea aquí).
   *
   * Elegir la fila de Flare ya dice dónde está el dinero, así que ahí el puente
   * es seguro; en la de Ethereum sigue decidiéndolo el saldo, porque un importe
   * mayor del que hay allí también obliga a traerlo.
   */
  const emCrossChain = useMemo(() => {
    if (vault.kind !== 'em-carry' || !emAssetDecimals || amountNum <= 0) return null;
    let amountBase: string;
    try {
      amountBase = toBaseUnits(String(amountNum), emAssetDecimals);
    } catch {
      return null;
    }
    return decideRoute(amountBase, {
      // Desde la fila de Flare, lo que hay en Ethereum no cuenta para esta
      // entrada: el usuario ha dicho que su FXRP está en Flare.
      ethereumBase: emOnFlare ? '0' : emBalances.fxrpEthereumBase,
      flareBase: emBalances.fxrpFlareBase,
    });
  }, [vault.kind, emAssetDecimals, amountNum, emOnFlare, emBalances.fxrpEthereumBase, emBalances.fxrpFlareBase]);

  /**
   * Las wallets EVM enlazadas entre las que se ELIGE el destino cuando el
   * origen es Xaman: la elegida recibe el FXRP minteado, firma el puente y la
   * entrada, y cobra el RLUSD. Únicas por dirección — en las entradas de
   * Ethereum el selector de arriba desdobla cada wallet EVM en dos filas (una
   * por cadena), y aquí eso serían duplicados.
   */
  const emDestOptions = useMemo(() => {
    const seen = new Set<string>();
    return allCandidates
      .filter((c) => c.rail === 'evm')
      .filter((c) => {
        const key = c.record.address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [allCandidates]);

  /**
   * El destino elegido. Es una ELECCIÓN del usuario (con varias enlazadas, el
   * selector de abajo); por defecto, la conectada ahora mismo o la primera.
   */
  const [emDestChoice, setEmDestChoice] = useState<string | null>(null);
  const emLinkedEvmDest = useMemo(() => {
    if (emDestOptions.length === 0) return null;
    if (
      emDestChoice &&
      emDestOptions.some((c) => c.record.address.toLowerCase() === emDestChoice.toLowerCase())
    ) {
      return emDestChoice;
    }
    const connected = evm.address
      ? emDestOptions.find((c) => c.record.address.toLowerCase() === evm.address!.toLowerCase())
      : undefined;
    return (connected ?? emDestOptions[0]).record.address;
  }, [emDestOptions, emDestChoice, evm.address]);

  /**
   * El origen del flujo cuando la entrada NO es directa. Tres casos, todos
   * derivados de lo que el usuario marcó con opciones — nunca de un texto:
   *
   *   · fila de Flare elegida, o importe mayor que el saldo en Ethereum
   *     → puente desde la propia wallet (2 firmas);
   *   · Xaman pagando XRP → mint directo a la EVM de destino + puente + entrada
   *     (3 firmas, las dos últimas de la EVM de destino);
   *   · Xaman pagando el FXRP de la PA → transfer PA→EVM como 0xFE userOp
   *     (pa-transfer/prepare) + puente + entrada — mismas 3 firmas, solo
   *     cambia la calldata del primer paso.
   */
  const emFlowOrigin = useMemo<FxrpOrigin | null>(() => {
    if (vault.kind !== 'em-carry' || !selected) return null;
    if (selected.rail === 'xrpl') {
      if (!emLinkedEvmDest) return null; // sin EVM enlazada no hay destino — panel aparte
      return paySource === 'xrp'
        ? {
            kind: 'xrpl-mint',
            address: selected.record.address,
            chainId: FLARE_CHAIN_ID,
            signer: selected.record.address,
            id: `${selected.record.address}:mint`,
          }
        : {
            kind: 'smart-account',
            address: selected.record.address,
            chainId: FLARE_CHAIN_ID,
            signer: selected.record.address,
            id: `${selected.record.address}:pa`,
          };
    }
    if (!emOnFlare && emCrossChain?.kind !== 'bridge') return null;
    return {
      kind: 'evm-flare',
      address: selected.record.address,
      chainId: FLARE_CHAIN_ID,
      signer: selected.record.address,
      id: originId(selected.record.address, FLARE_CHAIN_ID),
    };
  }, [vault.kind, selected, paySource, emLinkedEvmDest, emOnFlare, emCrossChain]);

  /** A quién llega el FXRP y quién firma en EVM: la propia wallet, o la enlazada. */
  const emFlowDest =
    selected?.rail === 'xrpl' ? emLinkedEvmDest : selected?.record.address ?? null;

  /**
   * Decimales del mercado LEÍDOS una vez por apertura (FXRP 6 / RLUSD 18 es la
   * asimetría F4: jamás se asume). Los necesitan el flujo y el medidor en vivo;
   * `emBalances` solo los trae en las filas EVM, así que aquí se leen aparte.
   */
  const [emDecimals, setEmDecimals] = useState<{ collateral: number; loan: number } | null>(null);
  useEffect(() => {
    if (vault.kind !== 'em-carry') return;
    let cancelled = false;
    const region = getUserRegion();
    fetch(`${API_BASE}/eth-morpho/market?region=${encodeURIComponent(region ?? '')}`, {
      headers: authHeaders(),
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { decimals?: { collateral?: number; loan?: number } } | null) => {
        if (cancelled || !m?.decimals) return;
        const { collateral, loan } = m.decimals;
        if (typeof collateral === 'number' && typeof loan === 'number') {
          setEmDecimals({ collateral, loan });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.kind]);

  // ── La protección (stop-loss del moneyflow), elegida EN la entrada ─────────
  // El usuario decide aquí el umbral; la regla (HF_BELOW → repago en Ethereum,
  // vigilancia y firma del dueño: invariante #8) se crea cuando la entrada
  // ASIENTA — nunca antes, para no anunciar un vigilante de una posición que
  // aún no existe.
  const [emProtectOn, setEmProtectOn] = useState(true);
  const [emProtectHf, setEmProtectHf] = useState('1.10');
  const [emProtectCreated, setEmProtectCreated] = useState<boolean | null>(null);
  /**
   * El destino del RLUSD prestado, decidido AQUÍ (fundador, 25-ago: «el RLUSD
   * borrowed ponerlo a trabajar en el vault de Sentora»). Marcado, la MISMA
   * firma de la entrada añade approve+deposit en la bóveda — misma cadena y
   * ninguna espera entre patas, así que la física no obliga a otra firma. No
   * viene marcado de serie: meter el dinero en la bóveda de un curador es una
   * elección, no un default (restringir no es asesorar; preseleccionar sí roza).
   */
  const [emLendBorrowed, setEmLendBorrowed] = useState(false);
  const emBorrowNum = parseFloat(emBorrowAmt.replace(',', '.')) || 0;

  const createEmProtectRule = useCallback(
    async (walletAddress: string) => {
      const hf = parseFloat(emProtectHf.replace(',', '.'));
      if (!emProtectOn || !(hf > 1 && hf <= 3)) return;
      try {
        await rulesApi.create({
          walletAddress,
          // El scope sigue a la POSICIÓN, no a la conexión: este mercado vive en
          // Ethereum (misma lección que PROTECT_EM en Positions).
          chainId: 1,
          name: 'Protect (Ethereum) · FXRP/RLUSD',
          trigger: { type: 'HF_BELOW', threshold: hf },
          action: { kind: 'emRepay', protocolId: 'morpho-blue', params: { mode: 'partial' } },
          cooldownMinutes: 60,
        });
        setEmProtectCreated(true);
      } catch (e) {
        // La entrada YA está firmada: un fallo aquí no puede convertirla en
        // error. Se dice en la pantalla final y la plantilla de Positions queda
        // como segunda puerta.
        console.warn('[em] protect rule creation failed:', (e as Error).message);
        setEmProtectCreated(false);
      }
    },
    [emProtectOn, emProtectHf],
  );

  /**
   * El medidor de riesgo EN VIVO, mientras se teclea. La matemática no corre en
   * el navegador (regla R0 de esta pantalla): un debounce pide al servidor la
   * misma preparación que luego se firma y pinta SU veredicto (HF proyectado +
   * LLTV). Con Xaman pagando XRP, primero se cotiza el mint para saber el FXRP
   * NETO que llega (las comisiones salen del pago) y ESO es lo que se proyecta.
   */
  const [emLive, setEmLive] = useState<{ hfAfter: number | null; lltvPct: number; netFxrp: number | null } | null>(null);
  const [emLiveBusy, setEmLiveBusy] = useState(false);
  useEffect(() => {
    if (vault.kind !== 'em-carry') return;
    if (!(amountNum > 0) || !(emBorrowNum > 0) || !emFlowDest || !emDecimals) {
      setEmLive(null);
      return;
    }
    const xrpSource = selected?.rail === 'xrpl' && paySource === 'xrp';
    let cancelled = false;
    const timer = setTimeout(async () => {
      setEmLiveBusy(true);
      try {
        const region = getUserRegion();
        let supplyFxrp = amountNum;
        let netFxrp: number | null = null;
        if (xrpSource) {
          const mres = await fetch(`${API_BASE}/wallet-transfer/bridge/xrpl-to-flare/prepare`, {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              xrplAddress: selected!.record.address,
              evmDestination: emFlowDest,
              amountXrp: amountNum,
              region,
            }),
          });
          const mbody = await mres.json().catch(() => ({}));
          if (cancelled) return;
          if (!mres.ok || typeof mbody?.disclosure?.netFxrp !== 'number') {
            setEmLive(null);
            return;
          }
          netFxrp = mbody.disclosure.netFxrp;
          supplyFxrp = netFxrp!;
        }
        const res = await fetch(`${API_BASE}/eth-morpho/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            action: 'open_carry',
            user: emFlowDest,
            amountBase: toBaseUnits(String(supplyFxrp), emDecimals.collateral),
            borrowBase: toBaseUnits(String(emBorrowNum), emDecimals.loan),
            region,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || typeof body?.disclosure?.lltvPct !== 'number') {
          setEmLive(null);
          return;
        }
        setEmLive({
          hfAfter: body?.positionAfter?.healthFactor ?? null,
          lltvPct: body.disclosure.lltvPct,
          netFxrp,
        });
      } catch {
        if (!cancelled) setEmLive(null);
      } finally {
        if (!cancelled) setEmLiveBusy(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.kind, amountNum, emBorrowNum, emFlowDest, emDecimals, paySource, selected?.rail, selected?.record.address]);
  /** What this entry borrows, in regulatory terms — shown before signing. */
  const assetNotice = assetNoticeOf(vault.kind);
  const railBadge =
    isEmKind
      ? t('Ethereum direct · your wallet')
      : vault.kind === 'e2'
        ? t(vault.railLabel)
        : paSourceActive
          ? t('Xaman · FXRP already minted')
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
      // La orden de consejo TAMBIÉN es una operación de primera (fundador
      // 2026-08-26: «el form del legacy no se mantiene anclado») — misma
      // superficie dual que el resto: ancla, minimiza, sobrevive a la
      // navegación desde el host global.
      <OperationSurface docked={docked} title={`${t(vault.action)} · ${t('Council order')}`} onClose={onClose}>
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
            <div className="mt-1 flex items-center gap-1.5">
              <button
                onClick={minimizeActive}
                className="p-0.5 text-ink/40 hover:text-ink transition-colors"
                title={t('Minimize — it waits at the bottom, exactly as you left it')}
              >
                <Minus className="w-5 h-5" />
              </button>
              <button
                onClick={() => setDocked(!docked)}
                className="hidden lg:block p-0.5 text-ink/40 hover:text-ink transition-colors"
                title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
              >
                {docked ? <PanelRightClose className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
              </button>
<CloseOperationButton onClose={onClose} />
            </div>
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
      </OperationSurface>
    );
  }

  return (
    <OperationSurface docked={docked} title={`${t(vault.action)} · ${vault.asset}`} onClose={onClose}>
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
          <div className="mt-1 flex items-center gap-1.5">
            <button
              onClick={minimizeActive}
              className="p-0.5 text-ink/40 hover:text-ink transition-colors"
              title={t('Minimize — it waits at the bottom, exactly as you left it')}
            >
              <Minus className="w-5 h-5" />
            </button>
            <button
              onClick={() => setDocked(!docked)}
              className="hidden lg:block p-0.5 text-ink/40 hover:text-ink transition-colors"
              title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
            >
              {docked ? <PanelRightClose className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
            </button>
<CloseOperationButton onClose={onClose} />
          </div>
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
              {/* El desplegable tambien es UNO SOLO: mismo componente que el
                  modal de las bovedas con gestor. Las pistas de carril de
                  abajo siguen aqui porque son de ESTA entrada. */}
              <SigningWalletPicker
                wallets={signingWallets}
                disabled={phase !== 'form' && phase !== 'error'}
              />
              {/* The hint has to name the chain the entry actually signs on.
                  The Ethereum entries spend FXRP that already sits ON ETHEREUM;
                  saying "directly on Flare" there sent people to look for their
                  FXRP on the wrong chain. */}
              {isEmKind ? (
                activeRail === 'evm' ? (
                  <p className="text-[10px] mt-1.5 text-tone-success/80">
                    {t('This wallet supplies its FXRP on Ethereum — the entry signs there, not on Flare.')}
                  </p>
                ) : null
              ) : vault.kind !== 'e2' ? (
                <p className={`text-[10px] mt-1.5 ${activeRail === 'evm' ? 'text-tone-success/80' : 'text-ink/35'}`}>
                  {activeRail === 'evm'
                    ? t('This wallet spends its FXRP directly on Flare — no XRPL mint, no minting fee.')
                    : t('This wallet pays XRP — minted 1:1 into FXRP on Flare before entering.')}
                </p>
              ) : null}
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
          {/* Una wallet Xaman elegida sin ninguna EVM enlazada: el flujo no
              tiene destino para el FXRP. Es lo ÚNICO que aquí se pide conectar;
              el resto del camino lo conduce la secuencia de abajo. */}
          {vault.kind === 'em-carry' && selected?.rail === 'xrpl' && !emLinkedEvmDest && (
            <div className="bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3 space-y-2">
              <p className="text-xs text-tone-warning/80">
                {t('The flow mints your XRP into FXRP on your OWN EVM wallet and continues from there — link a MetaMask to receive it.')}
              </p>
              <button
                onClick={() => connectSigner('evm')}
                disabled={connecting}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-tone-warning/15 border border-tone-warning/30 text-tone-warning font-medium text-xs hover:bg-tone-warning/25 transition-all disabled:opacity-50"
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                {t('Connect EVM wallet')}
              </button>
            </div>
          )}
          {selected && !signerMatches && !emFlowOrigin && phase !== 'done' && (
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
              {/* What the entry SPENDS (founder 2026-08-12): fresh XRP (mint)
                  or the FXRP the Smart Account already holds — no new mint.
                  Only offered when that account actually has free FXRP. On the
                  Ethereum entries this choice decides the FIRST STEP of the
                  flow: XRP mints straight into the destination EVM wallet on
                  Flare; PA-FXRP would leave the Smart Account first. */}
              {selected?.rail === 'xrpl' && vault.kind !== 'e2' && (paFxrpFree ?? 0) > 0 && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Pay with')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPaySource('xrp')}
                      className={`flex-1 text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                        !paSourceActive
                          ? 'border-volt/40 bg-volt/10 text-volt font-medium'
                          : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <TokenLogo symbol="XRP" size="xs" /> XRP
                      </span>
                      <span className="block text-[10px] font-normal mt-0.5 opacity-70">
                        {t('Converts now (mint)')}
                      </span>
                    </button>
                    <button
                      onClick={() => setPaySource('pa-fxrp')}
                      className={`flex-1 text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                        paSourceActive
                          ? 'border-volt/40 bg-volt/10 text-volt font-medium'
                          : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <TokenLogo symbol="FXRP" size="xs" /> FXRP
                      </span>
                      <span className="block text-[10px] font-normal mt-0.5 opacity-70">
                        {t('Already minted in your account')} · {fmt(paFxrpFree ?? 0, 2)}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* El DESTINO es una elección del usuario, no una deducción: esa
                  wallet recibe el FXRP en Flare, firma el puente y la entrada
                  en Ethereum, y cobra el RLUSD. Con una sola enlazada se
                  ENSEÑA igualmente — a dónde va el dinero nunca es implícito. */}
              {vault.kind === 'em-carry' && selected?.rail === 'xrpl' && emDestOptions.length > 0 && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">
                    {t('Destination EVM wallet — receives the FXRP, signs on Ethereum, gets the RLUSD')}
                  </label>
                  {emDestOptions.length > 1 ? (
                    <select
                      value={emLinkedEvmDest ?? ''}
                      onChange={(e) => setEmDestChoice(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                    >
                      {emDestOptions.map((c) => (
                        <option key={c.record.address} value={c.record.address}>
                          {`${walletDisplayName(c.record, t)} · ${c.record.address.slice(0, 8)}…${c.record.address.slice(-6)}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink/70 text-sm font-mono">
                      {`${walletDisplayName(emDestOptions[0].record, t)} · ${emDestOptions[0].record.address.slice(0, 8)}…${emDestOptions[0].record.address.slice(-6)}`}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-ink/40 mb-2 flex items-center justify-between gap-3">
                  <span>
                    {t('Amount')} · {amountAsset}
                  </span>
                  {/* Entradas de Ethereum: el saldo sale del carril, que lee sus
                      dos cadenas. Un saldo ilegible NO se pinta como 0 — dice
                      que no se pudo leer, porque mandar a puentear a quien ya
                      tiene el dinero cuesta la comisión del puente. */}
                  {/* Solo hay saldo que enseñar cuando la wallet elegida es la
                      que va a gastar: con una XRPL seleccionada no hay lectura
                      pendiente, así que decir «no pude leerlo» sería inventarse
                      un fallo donde solo hay una pregunta distinta. */}
                  {isEmKind && selected?.rail === 'evm' ? (
                    emBalances.loading ? (
                      <span className="text-ink/35">{t('reading balance…')}</span>
                    ) : emAssetBase != null && emAssetDecimals != null ? (
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-ink/45 truncate">
                          {emOnFlare ? t('On Flare') : t('On Ethereum')}:{' '}
                          <span className="font-mono text-ink/70">
                            {baseToHuman(emAssetBase, emAssetDecimals)}
                          </span>
                        </span>
                        <button
                          onClick={() => setAmount(baseToHuman(emAssetBase, emAssetDecimals))}
                          disabled={emAssetBase === '0'}
                          className="text-volt hover:underline font-medium shrink-0 disabled:opacity-40 disabled:no-underline"
                        >
                          MAX
                        </button>
                      </span>
                    ) : emBalances.unreadable ? (
                      <span className="text-tone-warning/70">{t('balance unreadable')}</span>
                    ) : null
                  ) : (paSourceActive ? paFxrpFree : available) != null && maxSpendable != null ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-ink/45 truncate">
                        {t('Available')}:{' '}
                        <span className="font-mono text-ink/70">{fmt((paSourceActive ? paFxrpFree : available) ?? 0, 4)}</span>
                      </span>
                      <button
                        onClick={() => setAmount(String(maxSpendable))}
                        disabled={maxSpendable <= 0}
                        className="text-volt hover:underline font-medium shrink-0 disabled:opacity-40 disabled:no-underline"
                      >
                        MAX
                      </button>
                    </span>
                  ) : null}
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
                {/* Deslizar en vez de teclear (fundador 2026-08-25: «en todos
                    los selectores... aparece un slider») — mismo componente
                    que el cierre de posición; el tope es el MISMO máximo que
                    el botón MAX, con sus reservas de gas/carrier ya dentro. */}
                <AmountSliderUsd
                  max={
                    isEmKind && selected?.rail === 'evm'
                      ? emAssetBase != null && emAssetDecimals != null
                        ? Number(baseToHuman(emAssetBase, emAssetDecimals))
                        : 0
                      : (maxSpendable ?? 0)
                  }
                  amount={amount}
                  onAmount={(v) => setAmount(v)}
                  usdPrice={null}
                />
                {vault.kind === 'e2' && available != null && (
                  <p className="text-[10px] text-ink/35 mt-1.5">
                    {t('MAX keeps 1 FLR back for gas — the wrap and delegate calls pay fees from this same balance.')}
                  </p>
                )}
                {activeRail === 'xrpl' && !paSourceActive && available != null && (
                  <p className="text-[10px] text-ink/35 mt-1.5">
                    {t('MAX keeps ~2 XRP back — your Astryum account is steered from this wallet and every order needs a small XRP payment.')}
                  </p>
                )}
                {drainsXrplSteering && (
                  <div className="mt-2 bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                    {t('This would leave your XRPL wallet almost empty. Your Astryum account is steered FROM it — every order needs ~1 XRP of carrier payment. Keep at least ~2 XRP or you will not be able to withdraw or convert until you refund it from outside.')}
                  </div>
                )}
                {/* Si esto cruza cadenas lo decide el saldo, no el usuario — y
                    no se le manda a otra puerta: el flujo lo lleva él solo. */}
                {emCrossChain?.kind === 'bridge' && emAssetDecimals != null && (
                  <div className="mt-2 bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3">
                    <p className="text-xs text-tone-warning/90 leading-relaxed">
                      {t('That amount is more than this wallet holds on Ethereum, but you have')}{' '}
                      <span className="font-mono font-medium">
                        {baseToHuman(emCrossChain.availableBase, emAssetDecimals)} FXRP
                      </span>{' '}
                      {t('on Flare — it has to be bridged first.')}
                    </p>
                  </div>
                )}
                {emCrossChain?.kind === 'insufficient' && emAssetDecimals != null && (
                  <div className="mt-2 bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3 text-xs text-tone-warning/90 leading-relaxed">
                    {t('Even counting your FXRP on Flare you hold')}{' '}
                    <span className="font-mono font-medium">
                      {baseToHuman(emCrossChain.totalBase, emAssetDecimals)} FXRP
                    </span>{' '}
                    {t('— less than this entry needs.')}
                  </div>
                )}
              </div>

              {/* The Smart-Account source rides the 0xFE carrier Payment —
                  same field every PA action shows (folded knob, honest copy).
                  Flare-rail only: on the Ethereum entries the PA choice feeds
                  the flow's first step, and that door carries its own copy. */}
              {paSourceActive && !isEmKind && <DispatchXrpField xrp={xrpForMint} t={t} />}

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
                <div className="op-grid-2 gap-3">
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

              {/* H2 — la card de lend-only PROMETE «Withdraw: anytime» y hasta
                  hoy no había puerta que lo cumpliera: la pata `vault_withdraw`
                  llevaba construida y testeada en el backend sin un solo botón
                  que la llamara. La salida se ofrece donde se entra. */}
              {vault.kind === 'em-lend' && (
                <button
                  type="button"
                  onClick={() => setEmVaultExit(true)}
                  className="text-[11px] text-sky-300 hover:text-sky-200 underline underline-offset-2"
                >
                  {t('Already lending? Withdraw your RLUSD →')}
                </button>
              )}

              {/* em-carry extra input: the RLUSD to borrow, as an EXPLICIT
                  amount (R0: the user states how much; the review's HF-after
                  and the server pre-flights show the consequences — no
                  ratio×price math ever runs in the browser). */}
              {vault.kind === 'em-carry' && (
                <div>
                  <FieldLabelInfo
                    label={t('RLUSD to borrow')}
                    info={t(
                      'How much RLUSD arrives in your wallet, borrowed against the FXRP you supply. The review shows the health factor this leaves BEFORE you sign — at 1.0 the market can liquidate the position. The server blocks amounts past the liquidation limit or past what the market can lend right now.',
                    )}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={emBorrowAmt}
                    onChange={(e) => setEmBorrowAmt(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                  />
                  {/* EL GRÁFICO, mientras se teclea: el debounce pide al
                      servidor la MISMA preparación que luego se firma y se
                      pinta su veredicto (R0: aquí solo se convierte). */}
                  {emLive && emLive.hfAfter != null ? (
                    <div className="mt-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
                      {emLive.netFxrp != null && (
                        <p className="text-[11px] text-ink/55 mb-2">
                          {t('After mint fees, the FXRP that travels is')}{' '}
                          <span className="font-mono font-medium">{fmt(emLive.netFxrp, 2)} FXRP</span>.
                        </p>
                      )}
                      <BorrowRiskMeter
                        healthFactor={emLive.hfAfter}
                        lltv={emLive.lltvPct / 100}
                        stopLtv={
                          emProtectOn && parseFloat(emProtectHf.replace(',', '.')) > 1
                            ? emLive.lltvPct / 100 / parseFloat(emProtectHf.replace(',', '.'))
                            : null
                        }
                      />
                    </div>
                  ) : emLiveBusy ? (
                    <p className="text-[10px] text-ink/35 mt-2">{t('projecting the position…')}</p>
                  ) : (
                    <p className="text-[10px] text-ink/35 mt-1">{t('You will see the resulting health factor before signing')}</p>
                  )}

                  {/* A dónde va el RLUSD prestado. El nombre nombra la cosa y
                      dice de quién es la bóveda — no empuja (regla de los
                      nombres). Marcado, el servidor añade approve+deposit a la
                      MISMA preparación que se firma: cinco transacciones, una
                      firma; y la puerta de repago sabe retirarlo de ahí. */}
                  <div className="mt-3 rounded-xl border border-ink/10 p-3 space-y-1.5">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="text-xs text-ink/70">
                        {t('Lend the borrowed RLUSD in the Sentora vault — same signature')}
                      </span>
                      <input
                        type="checkbox"
                        checked={emLendBorrowed}
                        onChange={(e) => setEmLendBorrowed(e.target.checked)}
                        className="accent-[hsl(var(--volt))] w-4 h-4 shrink-0"
                      />
                    </label>
                    <p className="text-[10px] text-ink/40 leading-relaxed">
                      {emLendBorrowed
                        ? t('The RLUSD does not sit in your wallet: it is lent into the Sentora RLUSD vault (Morpho, Ethereum) in this same signature. Sentora decides the allocation — aggregate exposure. When you repay, the repay door redeems what it needs from the vault first.')
                        : t('Off: the borrowed RLUSD stays in your wallet.')}
                    </p>
                  </div>

                  {/* La protección, decidida AQUÍ: si está activa, al asentar la
                      entrada se crea la regla (HF_BELOW → repago en Ethereum).
                      Vigila y prepara; SIEMPRE firma el dueño (invariante #8). */}
                  <div className="mt-3 rounded-xl border border-ink/10 p-3 space-y-2">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="text-xs text-ink/70">{t('Arm the repay protection when this entry settles')}</span>
                      <input
                        type="checkbox"
                        checked={emProtectOn}
                        onChange={(e) => setEmProtectOn(e.target.checked)}
                        className="accent-[hsl(var(--volt))] w-4 h-4 shrink-0"
                      />
                    </label>
                    {emProtectOn && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-ink/50 shrink-0">{t('Repay when the health factor drops below')}</span>
                        <input
                          type="number"
                          min="1.01"
                          max="3"
                          step="0.05"
                          value={emProtectHf}
                          onChange={(e) => setEmProtectHf(e.target.value)}
                          className="w-24 px-3 py-2 bg-ink/5 border border-ink/10 rounded-lg text-ink text-sm focus:outline-none focus:border-volt/50"
                        />
                      </div>
                    )}
                    {emProtectOn && (
                      <p className="text-[10px] text-ink/40 leading-relaxed">
                        {t('When it fires, Astryum prepares the exact RLUSD repay and asks YOU to sign it on Ethereum — it never signs or executes on its own.')}
                      </p>
                    )}
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

              {/* Un asiento tomado no es un fallo rojo: es un 0xFE anterior de
                  esta cuenta sentado en el nonce. Se cuenta en inglés y, si el
                  borrador es el que esta pantalla abandonó, con la salida. */}
              {phase === 'error' && seatRefusal ? (
                <SeatRefusalNotice
                  refusal={seatRefusal}
                  t={t}
                  fallbackMemoHex={abandonedMemo.current}
                  onPrepareAgain={() => void prepare()}
                />
              ) : phase === 'error' && errorMsg ? (
                <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              ) : null}

              {/* Con un camino pendiente el botón no se ofrece: preparar acabaría
                  en el mismo rechazo, solo que después de rellenarlo todo. */}
              {/* Cruzar cadenas no manda a otra puerta: la secuencia conduce —
                  prepara cada tramo, lo pone a firmar en la wallet que toca
                  (Xaman o EVM), espera lo que haya que esperar y sigue. El
                  usuario no elige pasos: sus OPCIONES (wallet, con qué paga,
                  cantidades) determinan la calldata de cada transacción. */}
              {emFlowOrigin && emFlowDest && emDecimals ? (
                amountNum > 0 && emBorrowNum > 0 ? (
                  <BorrowFlowRunner
                    origin={emFlowOrigin}
                    destination={emFlowDest}
                    supplyAmount={amount}
                    mintXrpAmount={emFlowOrigin.kind === 'xrpl-mint' ? amount : undefined}
                    borrowAmount={emBorrowAmt}
                    decimals={emDecimals}
                    lendBorrowed={emLendBorrowed}
                    onComplete={() => void createEmProtectRule(emFlowDest)}
                    onDone={() => onClose()}
                  />
                ) : (
                  <PrimaryButton disabled className="w-full">
                    <ShieldCheck className="w-4 h-4" />
                    {t('Enter the amounts to see the steps of this flow')}
                  </PrimaryButton>
                )
              ) : (
                <PrimaryButton
                  onClick={prepare}
                  disabled={
                    amountNum <= 0 ||
                    !selected ||
                    (vault.kind === 'em-carry' && selected.rail === 'xrpl' && !emLinkedEvmDest) ||
                    // Un «no lo sé» NO bloquea: ahí manda el pre-flight del
                    // servidor, que es quien de verdad lee la cadena.
                    emCrossChain?.kind === 'insufficient'
                  }
                  // EL PORQUÉ del gris, al pasar el ratón (fundador 2026-08-27).
                  // Mismas condiciones que `disabled`, EN SU ORDEN — si dos
                  // fallan a la vez se cuenta la primera, que es la primera que
                  // hay que arreglar. Cada motivo reutiliza la copy que esa
                  // situación ya tiene en el formulario: una sola voz.
                  disabledReason={
                    !selected
                      ? t('Connect the required wallet above to prepare this entry')
                      : amountNum <= 0
                        ? t('Enter an amount above zero to continue')
                        : vault.kind === 'em-carry' && selected.rail === 'xrpl' && !emLinkedEvmDest
                          ? t('The flow mints your XRP into FXRP on your OWN EVM wallet and continues from there — link a MetaMask to receive it.')
                          : emCrossChain?.kind === 'insufficient'
                            ? t('Your balance does not cover this amount — lower it or top up the wallet')
                            : undefined
                  }
                  className="w-full"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {emCrossChain?.kind === 'insufficient'
                    ? t('Not enough FXRP for this amount')
                    : t('Review before signing')}
                  <ArrowRight className="w-4 h-4" />
                </PrimaryButton>
              )}
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
              <div className="op-grid-2 gap-4">
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                {/* Each FXRP branch handles BOTH rails: the XRPL mint (gross
                    XRP, minting/executor fees, Smart Account) and the direct
                    entry (the wallet's own FXRP — no mint, gas quoted by the
                    wallet). Same protocol data either way (#6/#9). */}
                {'em' in prepared ? (
                  (() => {
                    // eth-morpho pair: every figure below came from the prepare
                    // response (protocol data with source) — nothing computed here.
                    const p = prepared as EmPrepared;
                    const d = p.emDisclosure;
                    return (
                      <>
                        {p.em === 'carry' ? (
                          <>
                            <Row label={t('FXRP you supply')} value={`${p.emAmounts.supply} FXRP`} />
                            <Row label={t('RLUSD you borrow')} value={`${p.emAmounts.borrow} RLUSD`} />
                            {p.emLend && (
                              <Row label={t('RLUSD lent in Sentora')} value={`${p.emLend.assetsHuman} RLUSD`} />
                            )}
                            {p.hfAfter != null && (
                              <Row
                                label={t('Health factor after')}
                                value={`${fmt(p.hfAfter, 2)}${p.hfBefore != null && Number.isFinite(p.hfBefore) ? ` (${t('now')} ${fmt(p.hfBefore, 2)})` : ''} · ${t('liquidation at 1.00')}`}
                              />
                            )}
                            {d.lltvPct != null && (
                              <Row label={t('Liquidation threshold')} value={`${fmt(d.lltvPct, 0)}% LLTV`} />
                            )}
                            {/* El mismo veredicto del servidor, en la unidad en la
                                que se decide: «1,78» no dice si estás cerca o
                                lejos; «aguanta una caída del 44 %» sí. No se
                                calcula nada aquí (R0) — solo se convierte. */}
                            {p.hfAfter != null && d.lltvPct != null && (
                              <div className="pt-2">
                                {/* La marca de stop-loss se pinta SOLO si la
                                    protección está activada en el formulario:
                                    esa regla se crea de verdad al asentar la
                                    entrada. Pintarla sin crearla anunciaría un
                                    repago automático inexistente — la peor
                                    mentira posible sobre el riesgo. */}
                                <BorrowRiskMeter
                                  healthFactor={p.hfAfter}
                                  lltv={d.lltvPct / 100}
                                  stopLtv={
                                    emProtectOn && parseFloat(emProtectHf.replace(',', '.')) > 1
                                      ? d.lltvPct / 100 / parseFloat(emProtectHf.replace(',', '.'))
                                      : null
                                  }
                                />
                              </div>
                            )}
                            {d.utilizationPct != null && (
                              <Row label={t('Market utilization')} value={`${fmt(d.utilizationPct, 1)}%`} />
                            )}
                            <Row
                              label={t('Borrow rate')}
                              value={
                                d.borrowAprPct != null
                                  ? `${fmt(d.borrowAprPct, 2)}% APR · ${d.borrowAprSource ?? ''}`
                                  : t('unavailable right now — source down')
                              }
                            />
                            {d.availableLiquidity != null && (
                              <Row label={t('Market can lend')} value={`${d.availableLiquidity} RLUSD`} />
                            )}
                          </>
                        ) : (
                          <>
                            <Row label={t('RLUSD you lend')} value={`${p.emAmounts.amount} RLUSD`} />
                            {d.totalAssets != null && (
                              <Row label={t('Vault holds')} value={`${d.totalAssets} RLUSD`} />
                            )}
                            {d.curatorNote && <Row label={t('Curator')} value={d.curatorNote} />}
                          </>
                        )}
                        <Row label={t('Approvals')} value={t('finite — the exact amount, never unlimited')} />
                        <Row label={t('Astryum fee')} value={d.astryumFeeBase === '0' ? t('None') : d.astryumFeeBase} />
                        <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                        <Row label={t('Signing wallet')} value={`${p.account.slice(0, 8)}… · Ethereum`} mono />
                      </>
                    );
                  })()
                ) : VAULT_KEY[vault.kind] ? (
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
                        ) : d.entry === 'smart-account' ? (
                          <>
                            <Row label={t('FXRP from your account')} value={`${fmt(d.fxrpFromAccount)} FXRP`} />
                            <Row label={t('Carrier payment')} value={`${fmt(d.mintCoupledXrp)} XRP`} info={t('Set automatically from live protocol fees plus a small margin, so the order can never fail for lack of carrier. The margin returns to your account as FXRP.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
                            <Row label={t('FXRP deposited')} value={`${fmt(d.fxrpDeposited)} FXRP`} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} info={t('The XRPL Payment that carries your order — it IS your signature. After the protocol fees below, the remainder becomes the FXRP that goes to work; nothing here goes to Astryum.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
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
                        {/* it. 29 — the cap row used to VANISH when the read failed,
                            and a vanished row reads as «no cap». The prepare now
                            refuses to compose an entry whose cap it could not read,
                            so an unread cap should never reach this payload — and
                            if it ever does, it is said, not hidden (#9). */}
                        {d.capacity?.remainingFxrp != null ? (
                          <Row
                            label={t('Vault capacity left')}
                            value={`${fmt(d.capacity.remainingFxrp, 0)} FXRP`}
                          />
                        ) : (
                          <Row label={t('Vault capacity left')} value={t('could not be read on-chain')} />
                        )}
                        <Row
                          label={t('Withdrawal terms')}
                          value={
                            wd.kind === 'instant-or-epoch'
                              ? // it. 27: this vault DOES charge an instant fee, so a
                                // missing figure is «we could not read it», not «there
                                // is none» — and an empty fee row reads as free (#6).
                                // The prepare now refuses rather than send it blank;
                                // this is the belt to that braces.
                                `${
                                  wd.instantRedemptionFeeBps != null
                                    ? `${(wd.instantRedemptionFeeBps / 100).toFixed(2)}% ${t('instant')}`
                                    : t('could not be read on-chain')
                                }${
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
                        ) : d.entry === 'smart-account' ? (
                          <>
                            <Row label={t('FXRP from your account')} value={`${fmt(d.fxrpFromAccount)} FXRP`} />
                            <Row label={t('Carrier payment')} value={`${fmt(d.mintCoupledXrp)} XRP`} info={t('Set automatically from live protocol fees plus a small margin, so the order can never fail for lack of carrier. The margin returns to your account as FXRP.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
                            <Row label={t('FXRP supplied')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} info={t('The XRPL Payment that carries your order — it IS your signature. After the protocol fees below, the remainder becomes the FXRP that goes to work; nothing here goes to Astryum.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
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
                        ) : d.entry === 'smart-account' ? (
                          <>
                            <Row label={t('FXRP from your account')} value={`${fmt(d.fxrpFromAccount)} FXRP`} />
                            <Row label={t('Carrier payment')} value={`${fmt(d.mintCoupledXrp)} XRP`} info={t('Set automatically from live protocol fees plus a small margin, so the order can never fail for lack of carrier. The margin returns to your account as FXRP.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
                            <Row label={t('FXRP supplied')} value={`${fmt(d.fxrpSupplied)} FXRP`} />
                          </>
                        ) : (
                          <>
                            <Row label={t('You pay (gross)')} value={`${fmt(d.grossXrp)} XRP`} info={t('The XRPL Payment that carries your order — it IS your signature. After the protocol fees below, the remainder becomes the FXRP that goes to work; nothing here goes to Astryum.')} />
                            <Row label={t('Minting fee')} value={`${fmt(d.mintingFeeXrp)} XRP`} info={t('FAssets protocol fee for minting FXRP — max(0.1%, 0.1 XRP), read live from the protocol. Not an Astryum fee.')} />
                            <Row label={t('Executor fee')} value={`${fmt(d.executorFeeXrp)} XRP`} info={t('Pays the executor that completes your order on Flare after your signature — a protocol-level cost, not an Astryum fee.')} />
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
                        {d.flrPriceUSD != null && d.flrPriceUSD > 0 && (
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

                {/* Invariant #9 — the borrowed asset's standing under MiCA,
                    on the LAST screen before the wallet opens. */}
                {assetNotice && <AssetNoticeBox notice={assetNotice} />}

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
                {/* La ENTRADA del carril de Ethereum bloquea igual que sus tres
                    SALIDAS, que ya lo hacían. `preflightSaysFail` solo es true
                    cuando la comprobación CORRIÓ y demostró el fallo (no cuando
                    hubo dudas), así que aquí no se está tolerando una
                    incertidumbre: se estaba dejando firmar sobre una certeza de
                    revert, quemando gas de mainnet. Peor aún, en `open_carry`
                    las patas 1 y 2 sí se minan y solo revierte la 3 — que es
                    como se FABRICA un carry a medio abrir.

                    En los carriles de Flare se conserva el «firmar igual»: allí
                    el dry-run suele no estar disponible y el usuario decide. */}
                <PrimaryButton
                  onClick={sign}
                  disabled={!signerMatches || (isEmKind && preflightSaysFail(preflight))}
                  // El porqué del gris (2026-08-27), con la copy que cada caso
                  // ya usa en su aviso del formulario — una sola voz.
                  disabledReason={
                    !signerMatches
                      ? activeRail === 'xrpl'
                        ? t('Open Xaman with this exact account to sign this entry.')
                        : t('Your connected EVM account is different — reconnect with the selected wallet to sign.')
                      : isEmKind && preflightSaysFail(preflight)
                        ? t('The dry-run proved this transaction would revert on-chain — signing would only burn gas')
                        : undefined
                  }
                  className={`flex-1 ${preflightSaysFail(preflight) ? 'opacity-80 saturate-50' : ''}`}
                >
                  {preflightSaysFail(preflight)
                    ? isEmKind
                      ? t('The dry-run says this would fail')
                      : t('Sign anyway — the dry-run says it will fail')
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

          {/* familia-no-pude-leer — the OTHER honest ending: signed, or
              possibly signed, and unread. Amber, not red, and with no route
              back to the sign button (that route is how an entry is paid for
              twice). */}
          {phase === 'unconfirmed' && unconfirmed && (
            <UnconfirmedSignatureNotice
              rail={prepared?.rail === 'xrpl' ? 'xrpl' : 'evm'}
              chainId={prepared && prepared.rail === 'evm' ? prepared.chainId : undefined}
              unconfirmed={unconfirmed}
              onClose={onClose}
            />
          )}

          {/* Step: done = SIGNED. Success/failure/stalled comes from the
              settlement machine — never painted locally (§2). */}
          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={
                  // Rehidratada tras recargar no hay `prepared`: el carril
                  // lo dice el propio asiento.
                  (prepared?.rail ?? (settlement.state.rail === 'xrpl-mint' ? 'xrpl' : 'evm')) === 'xrpl'
                    ? t('Executed on Flare — your position is settled and appears in Positions.')
                    : t('Confirmed on-chain — the position appears in Positions.')
                }
                pendingText={isEmKind ? t('Signed — confirming on Ethereum…') : t('Signed — settling on Flare…')}
                // A quién se escribe si el problema resulta ser del sitio y no
                // del carril. Sale del catálogo, así que una ruta nueva lo trae
                // puesto en vez de heredar nuestro Discord por defecto.
                protocol={actionOfKind(vault.kind)?.protocol}
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
                  {isEmKind
                    ? t('Signed from your wallet on Ethereum. The position lands directly in that wallet and appears in Positions once the transaction confirms.')
                    : t('Signed from your Flare wallet — no XRPL mint. The position lands directly in that wallet and appears in Positions once the transaction confirms.')}
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
              {/* W5: the em-carry twin arms its protection from the position
                  card (PROTECT_EM — its own template, chain 1 scope). Pointing
                  there beats embedding a card that would build the wrong rule. */}
              {/* Ya no es una nota gris de 10 px: acabas de firmar una deuda y
                  la red NO está puesta. Decirlo en pequeño era la mitad del
                  problema — la card prometía protección y el único sitio donde
                  se desmentía era ilegible. */}
              {/* El estado de la protección se dice según lo que PASÓ, nunca
                  según lo que se pidió: la regla se crea al asentar, y si esa
                  creación falló hay que decirlo — un «armada» sin regla es la
                  peor mentira posible sobre el riesgo. */}
              {vault.kind === 'em-carry' && (
                emProtectOn && emProtectCreated === true ? (
                  <div className="w-full max-w-xs rounded-xl border border-tone-success/30 bg-tone-success/5 px-3.5 py-3 text-left">
                    <p className="text-xs font-medium text-ink/80">
                      {t('Repay protection armed.')}
                    </p>
                    <p className="text-[11px] text-ink/55 leading-relaxed mt-1">
                      {t('If the health factor drops below')}{' '}
                      <span className="font-mono">{emProtectHf}</span>
                      {', '}
                      {t('Astryum prepares the exact RLUSD repay and asks YOU to sign it on Ethereum. Manage it from Positions.')}
                    </p>
                  </div>
                ) : emProtectOn && emProtectCreated === null ? (
                  <div className="w-full max-w-xs rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-3 text-left">
                    <p className="text-[11px] text-ink/55 leading-relaxed">
                      {t('The repay protection arms itself when this entry settles — you chose')}{' '}
                      <span className="font-mono">HF {emProtectHf}</span>.
                    </p>
                  </div>
                ) : (
                  <div className="w-full max-w-xs rounded-xl border border-tone-warning/30 bg-tone-warning/5 px-3.5 py-3 text-left">
                    <p className="text-xs font-medium text-ink/80">
                      {t('Your repay protection is NOT armed yet.')}
                    </p>
                    <p className="text-[11px] text-ink/55 leading-relaxed mt-1">
                      {t('Arm it from this position’s card in Positions — the Protect (Ethereum) template watches your health factor and prepares the RLUSD repayment fresh for you to sign. Until you do, nothing is watching this position.')}
                    </p>
                  </div>
                )
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
      {emBridge && (
        <EmBridgeModal
          owner={selected?.record.address ?? ''}
          onClose={() => setEmBridge(false)}
        />
      )}
      {emVaultExit && (
        <EmExitModal
          owner={selected?.record.address ?? ''}
          mode="vault"
          onClose={() => setEmVaultExit(false)}
        />
      )}
    </OperationSurface>
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
 *  on hover) while the words breathe on the left.
 *
 *  TRES ARTEFACTOS, UNO POR NIVEL DE MOVIMIENTO (stores/motionStore.ts,
 *  fundador 2026-09-10: «quiero estilos nuevos y distintos», no la misma
 *  escena parada):
 *    · full    — la tarjeta con la escena viva y el reflejo que sigue al ratón.
 *    · calm    — la PLACA GRABADA: misma tarjeta, sin reflejo, y en el lado
 *                derecho un emblema monolínea (icons.tsx *Emblem) en vez de la
 *                escena — con PULSO lento (gira cada dos minutos, respira en
 *                seis segundos), nunca al ritmo del cursor. Al pasar el ratón
 *                la tarjeta sube un píxel, se enciende un filete lateral y el
 *                emblema gana luz en medio segundo. Lento, pequeño, suyo.
 *    · minimal — la FILA: icono pequeño, eyebrow, título, una línea y «Open»
 *                a la derecha. Sin tarjeta, sin dibujo: el hub es una lista.
 *  Las tres reciben las mismas palabras y el mismo onClick: cambia la cara,
 *  no la puerta. */
function EarnDoor({
  scene,
  emblem,
  engraving,
  icon: Icon,
  eyebrow,
  title,
  desc,
  help,
  cta,
  ctaTone,
  border,
  onClick,
}: {
  scene: React.ReactNode;
  /** El grabado del nivel sereno. */
  emblem: React.ReactNode;
  /** El GRABADO DEL TEMA INSTITUCIONAL (ui/skin/marks.tsx): la roseta de
   *  guilloché, la balanza o el pórtico. Sustituye a la escena Y al emblema
   *  cuando el tema es la lámina — ver la nota de la cabecera. */
  engraving: React.ReactNode;
  /** El icono de la fila del nivel mínimo. */
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  /** UNA línea corta (fundador 2026-09-07: «los botones se ven
   *  sobrecargados… reduce el texto de manera importante»). */
  desc: string;
  /** La explicación entera — vive en el interrogante, sale al pasar el
   *  ratón. Sin ella, la puerta no monta el punto. */
  help?: string;
  cta: string;
  ctaTone: string;
  border: string;
  onClick: () => void;
}) {
  const level = useMotionLevel();
  // EL MOVIMIENTO MANDA SOBRE EL TEMA. Quien pidió Mínimo pidió listas, y un
  // tema no puede devolverle las tarjetas: el ajuste de movimiento existe
  // por un problema de concentración (fundador 2026-09-10), no por gusto.
  // Por encima de ese suelo, el tema Institucional lleva SIEMPRE la placa
  // grabada —da igual que el movimiento sea completo o sereno—, porque lo que
  // define a este tema es que aquí no hay escenas vivas. Y reutiliza la placa
  // que ya existe: misma caja, otro dibujo.
  const engraved = useEngraved();
  const plate = engraved || level === 'calm';

  if (level === 'minimal') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:bg-volt/[0.06]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-volt/25 bg-volt/[0.06] text-volt">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <MicroLabel>{eyebrow}</MicroLabel>
          <span className="mt-0.5 block text-[15px] font-semibold leading-tight tracking-tight text-ink">{title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink/50">{desc}</span>
        </span>
        {help && <HelpDot text={help} side="top" align="left" />}
        <span className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium ${ctaTone}`}>
          {cta}
          <ArrowRight className="h-4 w-4" />
        </span>
      </button>
    );
  }

  if (plate) {
    return (
      <Card hover padded={false} className={`group relative overflow-hidden h-full ${border}`}>
        {/* el filete lateral: la única respuesta al cursor, y es de color */}
        <span aria-hidden className="absolute inset-y-4 left-0 z-[3] w-[3px] rounded-full bg-transparent transition-colors duration-200 group-hover:bg-volt/70" />
        <button onClick={onClick} className="relative z-[2] w-full h-full text-left p-6 md:p-7 sm:pr-40 md:pr-48 flex flex-col min-h-[196px]">
          <MicroLabel>{eyebrow}</MicroLabel>
          <h3 className="text-lg font-semibold tracking-tight text-ink mt-2.5">{title}</h3>
          <p className="text-sm text-ink/50 leading-relaxed mt-2 mb-5 max-w-[36ch]">{desc}</p>
          <span className="mt-auto flex w-full items-center">
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ctaTone}`}>
              {cta}
              <ArrowRight className="w-4 h-4" />
            </span>
            {help && <HelpDot text={help} side="top" align="left" className="ml-3" />}
          </span>
        </button>
        {/* el grabado — quieto, también bajo el cursor */}
        <div className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 hidden sm:block opacity-70 transition-opacity duration-700 group-hover:opacity-100">
          {engraved ? engraving : emblem}
        </div>
      </Card>
    );
  }

  return (
    <Card hover spotlight padded={false} className={`group relative overflow-hidden h-full ${border}`}>
      <button onClick={onClick} className="relative z-[2] w-full h-full text-left p-6 md:p-7 sm:pr-40 md:pr-48 flex flex-col min-h-[196px]">
        <MicroLabel>{eyebrow}</MicroLabel>
        <h3 className="text-lg font-semibold tracking-tight text-ink mt-2.5">{title}</h3>
        <p className="text-sm text-ink/50 leading-relaxed mt-2 mb-5 max-w-[36ch]">{desc}</p>
        {/* El interrogante vive EN el botón, junto al Open (fundador
            2026-09-07, segunda pasada: «se tienen que mostrar en el botón» —
            en la esquina, sobre la escena, no se veía). El globo abre hacia
            ARRIBA: el punto está al pie de la tarjeta. */}
        <span className="mt-auto flex w-full items-center">
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ctaTone}`}>
            {cta}
            <ArrowRight className="w-4 h-4 -translate-x-1 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
          </span>
          {help && <HelpDot text={help} side="top" align="left" className="ml-3" />}
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
      y && y.kind !== 'none'
        ? `${readableSource(y.source)?.text ?? y.source}${
            readableNote(y.note) ? ` — ${readableNote(y.note)}` : ''
          }`
        : undefined;
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
            <span title={readableSource(y.source)?.tech ?? undefined}>
              {t('source')}: {t(readableSource(y.source)?.text ?? y.source)}
            </span>
          </span>
        )}
      </span>
    );
  }
  // Sin rendimiento que enseñar, el COSTE sigue siendo obligatorio (fundador
  // 2026-08-22): la card de carry paga un borrow APR vivo aunque su colateral
  // gane 0. Pill ámbar «pagas», junto a la etiqueta honesta del 0.
  const borrowCost = y && 'borrow' in y ? y.borrow : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-ink/5 text-ink/55 ${
          big ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
        }`}
      >
        {label ? t(label) : `${t('Loading live rate')}…`}
      </span>
      {borrowCost && (
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning ${
            big ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'
          }`}
        >
          <span className="font-semibold tabular-nums">
            {t('you pay')} {borrowCost.aprPct.toFixed(2)}%
          </span>
          <span className={big ? 'opacity-70' : 'opacity-70 text-[10px]'}>
            APR · {borrowCost.asset}
          </span>
        </span>
      )}
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
  onFullSheet,
  inline = false,
}: {
  vault: DemoVault;
  y: YieldEntry | undefined;
  asOf: string | null;
  onClose: () => void;
  onStart: () => void;
  /** Abre la hoja flotante con TODO (datos de mercado + calculadora). Solo el
   *  panel lateral la usa. */
  onFullSheet?: () => void;
  /**
   * true = esto NO flota: es el panel de la derecha del catálogo (fundador,
   * 25-ago: «allí debe estar la información desplegada toda junta de More
   * info»). Mismo contenido exacto, sin overlay ni caja centrada — así la
   * ficha técnica, sus datos de mercado y su calculadora dejan de estar a un
   * clic y pasan a estar a la vista mientras se comparan las cards.
   */
  inline?: boolean;
}) {
  const { t } = useT();
  // The sheet stays readable for everyone — a council may want to understand a
  // strategy it cannot run. Only the Start button is withdrawn.
  const { activeGoverned } = useAuthorities();
  const governedBlock = governedBlockOf(vault.kind, !!activeGoverned);
  const assetNotice = assetNoticeOf(vault.kind);
  // Sin segundos: la tasa se refresca cada pocos minutos, asi que el segundo
  // exacto es ruido con aspecto de rigor.
  const asOfLabel = readableAsOf(asOf);
  const meta = PRODUCT_META[vault.kind];
  const productMap = useProductInfo();
  const info = productMap?.[vault.kind];
  const loadingInfo = productMap === null;

  const sheet = (
    <div
      className={
        inline
          ? 'bg-surface-1 border border-ink/10 rounded-2xl w-full h-full overflow-hidden flex flex-col'
          : 'bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col'
      }
    >
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
              <span className="text-ink/55">{t('Source')}:</span>{' '}
              <span title={readableSource(y.source)?.tech ?? undefined}>
                {t(readableSource(y.source)?.text ?? y.source)}
              </span>
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

          {/* Market data — DeFiLlama / Upshift, each figure with its source.
              FUERA del panel lateral (25-ago): TVL, medias a 30 días y derivas
              son datos para AUDITAR una ruta, no para elegir entre varias, y en
              un tercio de ancho eran justo lo que obligaba a hacer scroll para
              enterarse de lo básico. Siguen enteros en la hoja flotante. */}
          {!inline && <MarketDataPanel info={info} meta={meta} loading={loadingInfo} />}

          {/* La puerta a lo que se acaba de sacar: nada se esconde, se mueve a
              donde no estorba para elegir. */}
          {inline && onFullSheet && (
            <button
              type="button"
              onClick={onFullSheet}
              className="flex w-full items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-left transition-colors hover:border-volt/40"
            >
              <span className="text-[12.5px] text-ink/70">{t('Market data and calculator')}</span>
              <ArrowRight className="h-3.5 w-3.5 text-ink/35" />
            </button>
          )}

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

          {/* Y quién atiende cuando el problema es de ahí. «Visita Kinetic» dice
              dónde va el dinero; esto dice a quién se le pregunta cuando lo que
              hay ahí no cuadra — que hasta hoy era, por descarte, nuestro
              Discord. Sale del catálogo (`lib/earn/protocols`), leído de la web
              del propio sitio. */}
          {actionOfKind(vault.kind) && (
            <VenueContact protocol={actionOfKind(vault.kind)!.protocol} />
          )}

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

          {/* Profit calculator — fuera del panel lateral por la misma razón: no
              ayuda a decidir CUÁL, ayuda a decidir CUÁNTO, y esa pregunta llega
              después, con el importe delante. En la hoja flotante sigue. */}
          {!inline && (
            <div>
              <MicroLabel>{t('Profitability calculator')}</MicroLabel>
              <div className="mt-2">
                <ProfitCalculator vault={vault} y={y} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-ink/5">
          {assetNotice && <AssetNoticeBox notice={assetNotice} className="mx-6 mt-4" />}
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
  );

  if (inline) return sheet;
  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      {sheet}
    </ModalOverlay>
  );
}

// 'strategies' is INERT since 2026-08-24: the registry got its own nav row, so
// no door reaches this view any more and ?view=strategies redirects out. The
// branch and its embed are PRESERVED, not deleted — restoring the door is
// re-adding one <EarnDoor>, and nothing built gets removed on a layout change.
// 'managers' is the third door's surface (founder-only while Product A builds).
type StrategyView = 'hub' | 'pick' | 'create' | 'movements' | 'manual' | 'strategies' | 'managers';

export default function FlareDemoEarn() {
  const { t } = useT();
  // El nivel de movimiento decide el ARTEFACTO de las puertas (ver EarnDoor).
  const motionLevel = useMotionLevel();
  const router = useRouter();
  // Who is operating. A council reaches the same Earn surfaces as a personal
  // wallet (founder 2026-07-28) — only the signature differs — so this page
  // branches in exactly two places: the entry modal (a cage order) and My
  // strategies (the council's own MoneyFlows).
  const { activeGoverned } = useAuthorities();
  const [view, setView] = useState<StrategyView>('hub');
  // DOS MENÚS (fundador 2026-08-28): la vista pick puede venir acotada a una
  // tipología — earn (poner a trabajar, sin deuda) o cash (borrow). null = el
  // catálogo entero (retro-compatible con el deep-link ?view=pick de siempre).
  const [pickTy, setPickTy] = useState<TypologyId | null>(null);
  // La operación vive en el operationStore y la monta el HOST GLOBAL del
  // shell (EarnOperationHost, 2026-08-25): navegar con ella abierta —anclada
  // o no— ya no la desmonta. Estos dos setters conservan la firma que toda
  // la página ya hablaba (setActive/setInitialInputs) para no tocar cada
  // puerta: el par se junta en el store al abrir.
  const openVaultOp = useOperationStore((st) => st.openVaultOp);
  const pendingInitialRef = useRef<{ amount?: string; ratio?: string; targetHF?: string } | undefined>(undefined);
  const setInitialInputs = (v: { amount?: string; ratio?: string; targetHF?: string } | undefined) => {
    pendingInitialRef.current = v;
  };
  const setActive = (v: DemoVault | null) => {
    if (v) openVaultOp(v, pendingInitialRef.current);
  };
  // Which pack has its "More info" (technical + calculator) modal open.
  const [infoVault, setInfoVault] = useState<DemoVault | null>(null);
  // The guided finder (founder 2026-08-08: six full cards at once confuse a
  // first-timer). `matchedKinds` narrows the pick grid to the routes whose
  // FACTS fit the user's two answers — a filter, never a recommendation
  // (invariant #9); null = no filter, the full catalogue.
  // The interactive path (founder 2026-08-22) replaced the «Guide me» modal:
  // outcome → asset, filtering the catalogue LIVE instead of ending in a
  // separate result list. `matchedKinds` is DERIVED from it below, so every
  // consumer keeps reading exactly one thing.
  const [pathOutcome, setPathOutcome] = useState<OutcomeId | null>(null);
  const [pathAsset, setPathAsset] = useState<AssetGroupId | null>(null);
  const [sortBy, setSortBy] = useState<SortId>('catalogue');
  // Accordion (founder 2026-08-17): entering the catalogue must not dump
  // every full card — compact rows, one unfolds at a time.
  const [expandedKind, setExpandedKind] = useState<VaultKind | null>(null);
  // The hand's anchor — where the viewport glides back to when a route closes.
  const fanRef = useRef<HTMLDivElement | null>(null);
  // Live protocol yields for the cards — polled, protocol data with a source.
  const { yields, asOf } = useStrategyYields();
  // eth-morpho pair (W3): RUNTIME gate + live data. Fail-closed — the two
  // Ethereum cards exist only while the backend says active (a hot kill-switch
  // in Railway hides them without a redeploy).
  const ethMorpho = useEthMorphoLive();
  // PRODUCCIÓN SOLO LLEVA LO PROBADO (fundador 2026-09-14, tras ver «Lend your
  // RLUSD» en astryum.xyz): la lista blanca de lib/earn/productionVaults se
  // aplica ANTES que cualquier interruptor de entorno. Una variable se clona
  // entre entornos y se activa sola en el siguiente deploy — así se hizo
  // efectiva ETH_RLUSD_FXRP_ENABLED=true en Railway producción —; un kind en
  // esa lista solo entra con un commit a main. El kill-switch del carril sigue
  // mandando después, para el preview.
  // Memoizado: la lista blanca y el entorno son constantes del build, y la
  // identidad estable es lo que permite usarla como dependencia de `launch`.
  const deployable = useMemo(() => catalogForDeploy(DEMO_VAULTS, isProductionDeploy()), []);
  const catalogue = ethMorpho.active === true
    ? deployable
    : deployable.filter((v) => v.kind !== 'em-carry' && v.kind !== 'em-lend');
  // One accessor for every chip: the eth-morpho entries come from their own
  // live endpoints (normalised to the same YieldEntry shape), the rest from
  // /flare-demo/yields. Never an invented figure either way.
  const yieldFor = (k: VaultKind): YieldEntry | undefined => {
    if (k === 'em-lend') return lendYieldEntry(ethMorpho.vault);
    if (k === 'em-carry') {
      const cost = carryBorrowCost(ethMorpho.market);
      return {
        kind: 'none',
        pct: null,
        source: null,
        // Verificado en vivo contra Morpho (2026-08-22): el colateral FXRP no
        // genera NADA — diseño de Morpho Blue, el colateral nunca se presta.
        label: 'Your XRP earns nothing here: it is only the guarantee',
        ...(cost ? { borrow: { asset: cost.asset, aprPct: cost.aprPct } } : {}),
      };
    }
    return yields?.[k];
  };

  // What the path leaves standing. DERIVED, never a second state: the path
  // writes outcome/asset and everything downstream reads this (founder
  // 2026-08-22 — "que filtre en vivo", one list, no duplicated result block).
  const matchedKinds = useMemo<VaultKind[] | null>(() => {
    if (!pathOutcome && !pathAsset) return null;
    return catalogue
      .map((v) => v.kind)
      .filter(
        (k) =>
          (!pathOutcome || outcomeOf(k) === pathOutcome) &&
          (!pathAsset || assetGroupOf(k) === pathAsset),
      );
  }, [catalogue, pathOutcome, pathAsset]);

  // The list every surface paints: the path's filter, then the user's sort.
  // Sorting is a GESTURE, never a ranking — the default keeps the curated
  // order so the screen never opens with "the best one first" (invariant #9).
  const shownRoutes = useMemo(() => {
    const base = matchedKinds ? catalogue.filter((v) => matchedKinds.includes(v.kind)) : catalogue;
    if (sortBy === 'catalogue') return base;
    const arr = [...base];
    if (sortBy === 'rate') {
      // A route whose protocol publishes no number sinks to the bottom rather
      // than pretending to be a zero.
      const pct = (k: VaultKind) => {
        const y = yieldFor(k);
        return y && y.kind !== 'none' && typeof y.pct === 'number' ? y.pct : -1;
      };
      arr.sort((a, b) => pct(b.kind) - pct(a.kind));
    } else if (sortBy === 'risk') {
      arr.sort((a, b) => Number(hasDebt(a.kind)) - Number(hasDebt(b.kind)));
    } else if (sortBy === 'market') {
      const name = (k: VaultKind) => PRODUCT_META[k]?.protocolName ?? '';
      arr.sort((a, b) => name(a.kind).localeCompare(name(b.kind)));
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, matchedKinds, sortBy, yields, ethMorpho]);

  // El MENÚ abierto acota las rutas (fundador 2026-08-28: dos menús): la mano
  // del catálogo Y el acordeón móvil beben de esta misma lista — si solo
  // filtrara EarnCatalog, el móvil enseñaría las rutas del otro menú.
  const routesForMenu = useMemo(
    () => (pickTy ? shownRoutes.filter((v) => actionOfKind(v.kind)?.typology === pickTy) : shownRoutes),
    [shownRoutes, pickTy],
  );

  // ONE launch path for everything (agent prompts, saved drafts, pack cards):
  // open the real prepare→review→sign modal, optionally pre-filled.
  //
  // SOLO LO QUE ESTE DESPLIEGUE PUEDE ENSEÑAR (fundador 2026-09-19: «en
  // producción no se pueden ver las dos cards de earn de RLUSD»). La lista
  // blanca filtraba el catálogo, pero esta puerta —el agente, los borradores
  // de Estrategias y cualquier `?launch=`— abría el modal desde DEMO_VAULTS
  // entero: en producción `?launch=em-lend` enseñaba el vault que la portada
  // no enseña. Un kind que no está en el catálogo de este despliegue no abre
  // nada — ni el primero de la lista: aterrizar en otro vault que el pedido
  // es peor que no aterrizar.
  const launch: LaunchStrategy = useCallback((kind, initial) => {
    const vault = deployable.find((v) => v.kind === kind);
    if (!vault) return;
    setInitialInputs(initial);
    setActive(vault);
  }, [deployable]);

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
    const views: StrategyView[] = ['pick', 'create', 'movements', 'manual', 'strategies', 'managers'];
    const rawView = qs.get('view') === 'savings' ? 'movements' : qs.get('view');

    // The registry left Earn (2026-08-24) and has its own nav row again. Every
    // ?view=strategies link ever emitted — the Summary shortcut, the Portfolio
    // shortcut, anything a user bookmarked — is forwarded instead of broken.
    // Whatever else the URL carried travels with it: a link is allowed to say
    // two things at once, and dropping half of it silently is the kind of
    // "it mostly works" that costs an afternoon to find.
    if (rawView === 'strategies') {
      qs.delete('view');
      const carried = qs.toString();
      router.replace(CAPITAL_SECTION_HREF + (carried ? `?${carried}` : ''));
      return;
    }

    const wantedView = views.find((v) => v === rawView);
    const kind = qs.get('launch');
    // Lo que se puede lanzar es lo que este despliegue enseña — no una lista
    // aparte que haya que acordarse de podar (la anterior llevaba los dos
    // kinds de RLUSD que la lista blanca excluye).
    const known = deployable.map((v) => v.kind);
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
  }, [launch, router, deployable]);

  // The route detail — ONE body shared by the mobile accordion and the
  // desktop deck panel (founder 2026-08-18: the detail must arrive and leave
  // with a real transition, and the markup must stay single-source).
  const renderVaultDetail = (v: DemoVault) => {
    const blocked = governedBlockOf(v.kind, !!activeGoverned);
    const notice = assetNoticeOf(v.kind);
    return (
      <div className="flex flex-col">

                      {/* Live yield — protocol data with a source (invariant #9);
                          the carry also surfaces the borrow APR it pays (#6). */}
                      <div className="flex flex-wrap items-center gap-2 mb-4">
                        <LiveYieldChip y={yieldFor(v.kind)} showSource />
                        {(() => {
                          const yv = yieldFor(v.kind);
                          const b = yv && yv.kind !== 'none' ? yv.borrow : undefined;
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

                      {/* SISTERS (founder 2026-08-22: "es la misma estrategia
                          pero con otro ending"). Two pairs of this catalogue
                          run on the SAME market, and the relationship is not
                          the same in both: Kinetic is one route PLUS a step;
                          Morpho is the two SIDES of one market — the RLUSD one
                          borrows is the RLUSD the other lends. Said out loud
                          here, with a jump to the sister, instead of leaving
                          the user to guess why two cards look so alike. */}
                      {(() => {
                        const kin = KINSHIP[v.kind];
                        const sister = kin ? catalogue.find((x) => x.kind === kin.sibling) : undefined;
                        if (!kin || !sister) return null;
                        return (
                          <div className="mb-4 rounded-xl border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Layers className="w-3.5 h-3.5 shrink-0 text-ink/40" strokeWidth={1.75} />
                              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink/40">
                                {kin.market} · {t('same market')}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-ink/55">
                              {t(kin.line)}{' '}
                              <button
                                onClick={() => {
                                  // The sisters live in OPPOSITE outcomes (one
                                  // earns, the other borrows), so with a filter
                                  // on, the sister is always outside the list —
                                  // jumping without clearing it would open a
                                  // card the page is not showing. Clear, then
                                  // jump: never a dead end.
                                  if (!shownRoutes.some((x) => x.kind === kin.sibling)) {
                                    setPathOutcome(null);
                                    setPathAsset(null);
                                  }
                                  // Las hermanas viven en tipologías opuestas:
                                  // con los menús partidos (2026-08-28), saltar
                                  // implica CAMBIAR de menú o la card no está.
                                  const sibTy = actionOfKind(kin.sibling)?.typology;
                                  if (pickTy && sibTy && sibTy !== pickTy) setPickTy(sibTy as TypologyId);
                                  setExpandedKind(kin.sibling);
                                }}
                                className="font-medium text-volt hover:underline"
                              >
                                {t('See')} «{sister.title}» →
                              </button>
                            </p>
                          </div>
                        );
                      })()}

                      {/* The token journey, animated left → right. */}
                      <FlowStrip steps={v.flow} />

                      {/* The four facts people actually ask about. */}
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

                      {/* What this entry borrows and where it stands under
                          MiCA — read before the Start button, not after
                          (INVARIANTS.md #9; founder 2026-08-18). */}
                      {notice && <AssetNoticeBox notice={notice} className="mb-3" />}

                      {/* Why it cannot be started — said before the click. */}
                      {blocked && (
                        <p className="mb-3 flex items-start gap-2 rounded-xl border border-tone-warning/25 bg-tone-warning/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-tone-warning/90">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{t(blocked)}</span>
                        </p>
                      )}

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
      </div>
    );
  };

  return (
    <div>
      {/* El hub se presenta; una pantalla de trabajo NO (fundador, 24-ago:
          «que el texto desaparezca… lo más compacto posible para que la vista
          de las cards sea más espaciosa»). Dentro de una vista, el cabecero es
          una sola línea: la puerta de vuelta —con contorno, para que se lea
          como botón— y el título al lado. */}
      {view === 'hub' ? (
        <PageHeader
          eyebrow="Earn · Flare"
          title={t('Put your assets to work')}
          subtitle={t('Pick a created strategy or create one with text. Every strategy runs live on mainnet, in beta testing.')}
        />
      ) : (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => setView('hub')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.03] px-2.5 py-1.5 text-[12.5px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t('Back to Earn')}
          </button>
          <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink">
            {view === 'pick' && pickTy
              ? t(TYPOLOGIES.find((ty) => ty.id === pickTy)?.title ?? 'Put your assets to work')
              : t('Put your assets to work')}
          </h1>
        </div>
      )}

      {/* ── Hub: two doors up top, one full-width underneath — the shape this
          hub has always had. Scenes, not icons.

          The three doors still read as a LADDER of who decides, and the order
          draws it: you from a closed catalogue → you with the agent compiling
          → a third party, inside limits you signed once. That is what lets the
          manager door sit here without lying, and it is why the copy never has
          to say "delegate" — the verb MiCA reads as discretionary portfolio
          management. The manager's scene carries the rest: a solid ring, and
          no line leaves it.

          The registry left this hub on 2026-08-24 and has its own nav row
          again (lib/nav/capitalSection.ts): a door for the thing you open
          every week, buried behind the thing you open once, was two clicks in
          the wrong order. The slot it freed is where the manager door now
          sits. ── */}
      {view === 'hub' && (
        <RevealGroup className="space-y-5">
          {/* First-visit coachmarks. TWO steps, not three: the manager door is
              founder-only, and a tour must never point at a card the visitor
              cannot see — ProductTour would anchor to nothing. */}
          <ProductTour
            tour="earn"
            steps={[
              // "Audited" is FORBIDDEN without a published external report
              // (GLOSSARY §6.2) — assurance language is exactly how scams talk.
              { target: 'agent-hero', title: t('Create with AI Agent'), body: t('Describe what you want in plain words; the agent compiles it into a strategy you review and sign. It never signs for you.') },
              { target: 'door-earn', title: t('Make it earn, simply'), body: t('Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated.') },
              { target: 'door-cash', title: t('Get cash without selling'), body: t('Your tokens stay as collateral and you borrow against them — this one can be liquidated.') },
            ]}
          />
          {/* ── EL COPILOTO, PRIMERO (fundador 2026-08-29, quinta pasada:
              «vamos a hacer más presente el copiloto en la página de earn
              directamente y no vamos a poner el agente en las pantallas de
              las estrategias»). Tras tres colocaciones dentro de los menús
              que siempre estorbaban —esa pantalla es para COMPARAR cartas—,
              el agente concentra su presencia aquí: un héroe a lo ancho, con
              sus ideas de prompt a la vista y la constelación velando. Las
              claves de copy son las que ya existían: cero estreno en dict. */}
          <RevealItem>
            <div data-tour="agent-hero">
              {/* SIN overflow-hidden: el panel del historial cuelga de la
                  barra y la tarjeta lo guillotinaría; la constelación vive
                  dentro de los límites, no necesita el recorte. */}
              <Card spotlight padded={false} className="group relative p-5 md:p-6">
                <div
                  className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 hidden md:block opacity-60 group-hover:opacity-100 transition-opacity duration-500"
                  aria-hidden
                >
                  <ConstellationScene width={190} height={150} />
                </div>
                <div className="relative space-y-3 md:pr-52">
                  <div>
                    <MicroLabel>{t('With the agent')}</MicroLabel>
                    <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">{t('Create with AI Agent')}</h3>
                    <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-ink/50">
                      {t('Describe what you want in plain words; the agent compiles it into a strategy you review and sign. It never signs for you.')}
                    </p>
                  </div>
                  <AgentBar
                    placeholder={t('Tell the agent what you want with your tokens…')}
                    suggestions={[
                      t('I have 10,000 XRP and need $200 without selling'),
                      t('Which option has the least risk?'),
                      t('Send 5 XRP from my Xaman to my Flare wallet'),
                    ]}
                    chipsAlways
                    // El relojito del historial vive EN la barra, junto a la
                    // flecha (fundador 2026-08-30: arriba flotaba sobre el
                    // dibujo, lejos de todo): tocar una conversación abre el
                    // agente anclado, ya restaurado a ella.
                    trailing={<AgentHistoryButton />}
                  />
                </div>
              </Card>
            </div>
          </RevealItem>

          {/* Back to the shape this hub always had (founder 2026-08-25): two
              doors side by side up top, one FULL-WIDTH door underneath. The
              three-in-a-row I tried on the 24th is out — at a third of the
              width the scene ate the sentence, and the row read as a menu of
              three equal things when it is not. */}
          {/* DOS MENÚS por tipología (fundador 2026-08-28): la puerta del
              catálogo se parte en dos — trabajar sin deuda / pedir prestado —
              y la puerta del agente DESAPARECE del hub: el agente vive ahora
              dentro de cada menú, afinado a su tipología (misma función).
              El deep-link ?view=create sigue vivo para quien lo tenga guardado.
              Las escenas cuentan el mecanismo, no decoran: el disco de acreción
              junta materia (sin deuda, nada tira de ella); el activo retenido
              en su anillo suelta un chorro de luz que sigue ATADO (borrow →
              liquidable). */}
          {/* EN EL NIVEL MÍNIMO el hub es UNA LISTA (fundador 2026-09-10): las
              tres puertas, una fila cada una, en el orden de siempre. Las
              mismas palabras y los mismos onClick que las tarjetas de abajo
              — solo cambia la cara. Los data-tour se conservan para el tour. */}
          {motionLevel === 'minimal' && (
            <RevealItem>
              {/* SIN overflow-hidden (fundador, tercera pasada: «en el modo
                  minimal los interrogantes no funcionan»): el globo del HelpDot
                  abre hacia arriba y el recorte de la caja lo guillotinaba. Las
                  esquinas redondeadas del hover las llevan las propias filas. */}
              <div className="divide-y divide-ink/[0.07] rounded-lg border border-ink/10 bg-surface-1">
                <div data-tour="door-earn">
                  <EarnDoor
                    scene={null}
                    emblem={null}
                    engraving={null}
                    icon={Sprout}
                    eyebrow={t('No debt')}
                    title={t('Make it earn, simply')}
                    desc={t('Your tokens work. No debt.')}
                    help={t('Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated. The agent for this menu lives inside.')}
                    cta={t('Open')}
                    ctaTone="text-volt"
                    border=""
                    onClick={() => { setPickTy('earn'); setView('pick'); }}
                  />
                </div>
                <div data-tour="door-cash">
                  <EarnDoor
                    scene={null}
                    emblem={null}
                    engraving={null}
                    icon={HandCoins}
                    eyebrow={t('Against your tokens')}
                    title={t('Get cash without selling')}
                    desc={t('Borrow — your tokens stay yours.')}
                    help={t('Your tokens stay as collateral and you borrow against them — this one can be liquidated.')}
                    cta={t('Open')}
                    ctaTone="text-volt"
                    border=""
                    onClick={() => { setPickTy('cash'); setView('pick'); }}
                  />
                </div>
                <EarnDoor
                  scene={null}
                  emblem={null}
                  engraving={null}
                  icon={Landmark}
                  eyebrow={t('Run by a third party')}
                  title={t('Managed vaults')}
                  desc={t('A third party runs it, inside your limits.')}
                  help={t('A manager puts your assets to work. You choose the vault and the risk — and the contract, not trust, keeps them to the parameters you signed.')}
                  cta={t('Open')}
                  ctaTone="text-volt"
                  border=""
                  onClick={() => setView('managers')}
                />
              </div>
            </RevealItem>
          )}
          {motionLevel !== 'minimal' && (
          <RevealItem className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div data-tour="door-earn" className="contents">
            <EarnDoor
              scene={<HarvestSunScene size={172} />}
              emblem={<SunSealEmblem size={128} />}
              engraving={<GuillocheRosette size={124} />}
              icon={Sprout}
              eyebrow={t('No debt')}
              title={t('Make it earn, simply')}
              desc={t('Your tokens work. No debt.')}
              help={t('Lend, stake, delegate or deposit in a vault — no debt, nothing that can be liquidated. The agent for this menu lives inside.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => { setPickTy('earn'); setView('pick'); }}
            />
            </div>
            <div data-tour="door-cash" className="contents">
            <EarnDoor
              scene={<CollateralScene />}
              emblem={<TetherEmblem size={128} />}
              engraving={<BalanceMark size={124} />}
              icon={HandCoins}
              eyebrow={t('Against your tokens')}
              title={t('Get cash without selling')}
              desc={t('Borrow — your tokens stay yours.')}
              help={t('Your tokens stay as collateral and you borrow against them — this one can be liquidated.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => { setPickTy('cash'); setView('pick'); }}
            />
            </div>
          </RevealItem>
          )}

          {/* THE VACANT SLOT. «My strategies» sat here as a full-width door
              until it left for its own nav row (2026-08-24); the manager door
              takes the space, same size and same disposition. Movements +
              Create Manually stay HIDDEN (founder 2026-07-18), reachable by
              ?view=movements / ?view=manual.

              Covered while Product A builds. The border and the CTA tone match
              the two doors above ON PURPOSE: the hue lives in the scene, never
              in the frame — a differently-coloured card would read as a
              promotion.

              The copy carries the two things that make this offerable at all,
              and both are MECHANISMS, not reassurances: the manager is a third
              party (Astryum is never the director), and what it may do is
              enforced by the contract. No rate, no track record — a performance
              figure on this card would be a recommendation with extra steps.

              EL NOMBRE, cerrado 2026-08-25. «Invest with a manager» se cayó
              por lo que INCITABA: «invest» hacía sonar la puerta a producto de
              inversión que Astryum ofrece, y «with a manager» se callaba lo
              único que hay que decir — DE QUIÉN es el gestor, porque el usuario
              podía leer que era nuestro.

              «Managed vaults» nombra la COSA en vez de empujar a la acción: no
              urge, no promete, y es imposible leerlo como que gestionamos
              nosotros. El eyebrow carga el hecho que al título le falta —«run
              by a third party»—, que es exactamente el dato que se echaba en
              falta. */}
          {motionLevel !== 'minimal' && MANAGED_VAULTS_DOOR_OPEN && (
          <RevealItem className="grid grid-cols-1 gap-5">
            {/* PUBLICADA 2026-08-25 (fundador: «va a estar disponible para su
                uso cuando despleguemos la web»). Publicar es borrar el
                envoltorio y dejar el hijo — el <PreviewOnly> se fue de aquí y
                de la vista que abre, porque una puerta pública que da a una
                sección tapada es una puerta muerta. No había rutas de backend
                con requireAdmin que retirar: esta superficie todavía no llama a
                ninguna. El día que las tenga, nacen sin guard.

                FUERA DE PRODUCCIÓN 2026-09-13 (fundador: «ni los managed
                vaults… todo esto que no está probado no quiero que lo tenga la
                gente que está en producción»). No es un envoltorio nuevo: es el
                mismo interruptor que cierra la mesa del gestor
                (MANAGED_VAULTS_DOOR_OPEN, lib/nav/managerDesk.ts), abierto en
                preview y en local. Cerrar sólo la fila del sidebar habría sido
                cosmético: esta puerta lleva al mismo sitio, y en producción el
                backend de esa pantalla contesta 404. */}
            <EarnDoor
              scene={<ArmillaryScene />}
              emblem={<HelmEmblem size={128} />}
              engraving={<ColonnadeMark size={124} />}
              icon={Landmark}
              eyebrow={t('Run by a third party')}
              title={t('Managed vaults')}
              desc={t('A third party runs it, inside your limits.')}
              help={t('A manager puts your assets to work. You choose the vault and the risk — and the contract, not trust, keeps them to the parameters you signed.')}
              cta={t('Open')}
              ctaTone="text-volt"
              border="border-volt/15 hover:border-volt/35"
              onClick={() => setView('managers')}
            />
          </RevealItem>
          )}
        </RevealGroup>
      )}

      {/* El botón de volver se mudó al cabecero (24-ago). */}

      {/* ── Pick: the two live packs, with their real composition ── */}
      {view === 'pick' && (
        <RevealGroup className="space-y-5">
          {/* THE PATH, on screen from the first second (founder 2026-08-22:
              "no que tenga que darle el usuario a Guide me"). It is a filter
              wearing the face of a path: each card narrows the list below
              live. The «Guide me» modal it replaces is preserved at
              components/earn/StrategyFinder.tsx. */}
          {/* El catálogo v2 (asset → tipo → producto) está DESMONTADO aquí
              (fundador, 23-ago: «déjalo como al principio, antes de que tocaras
              nada»). Salían los dos catálogos uno encima de otro y el de arriba
              no tenía la forma pedida: las cards de siempre apiladas en vertical
              dentro de DOS columnas — «make it earn» a la izquierda y «get cash
              without selling» a la derecha.
              Nada se ha borrado: `EarnCatalog`, `ProductPanel`, `lib/earn/
              protocols` y `lib/earn/catalogView` siguen en el repo con sus
              tests. Volver a enseñarlo es montar aquí <EarnCatalog … />. */}
          {/* StrategyPath queda INERTE desde el 25-ago (fundador: «vamos a
              sacar el modal para encontrar cards y lo sustituiremos por un
              seleccionador más pequeño»). Hacía de filtro ocupando un tercio de
              la pantalla, y las cards —lo único que se ha venido a mirar—
              empezaban por debajo del pliegue. Ese trabajo lo hace ahora la
              línea de activos de EarnCatalog. El componente NO se borra: sigue
              en el árbol con su filtro por outcome, y volver a montarlo es una
              línea. */}
          <RevealItem>
            {/* El menú de orden se mudó DENTRO del selector (botón «Filtros»,
                25-ago): tres botones no merecen una fila entera cuando lo que
                falta es sitio para las cards. Sigue siendo un gesto, nunca un
                ranking — el orden por defecto es el del catálogo (#9). */}
            {/* Accordion (founder 2026-08-17): the catalogue scans in one
                glance — a compact row per route (identity + live rate) and
                the full card unfolds on tap. Nothing was removed: the body
                is the exact card that used to render open. */}
            {/* Desktop: the hand of cards (founder 2026-08-17). Clicking
                draws a card — its full detail is the SAME accordion card
                below (non-selected cards hide on md+, so there is exactly
                one source of the detail markup). Phones keep the accordion:
                a fan needs horizontal room.

                Se probaron columnas verticales el 24-ago y se retiraron el
                25: la mano se queda. StrategyColumns sigue en el árbol, sin
                montar. */}
            {/* El catálogo y la ficha, lado a lado (fundador, 24-ago): la
                información completa aparece POR LA DERECHA y las cards de la
                izquierda se siguen viendo — ni blur ni bloqueo, porque abrir
                una ficha es justo el momento en que se está comparando. El
                panel tiene su propio scroll, así que la ficha entera cabe sin
                empujar la página: muere el scrollIntoView correctivo. */}
            {/* DOS COLUMNAS cuando hay una ficha abierta (fundador, 26-ago:
                «que se acomode a la derecha SIN anclarse, y las demás se
                estrechen a la izquierda para seguir viéndose todas»). La ficha
                deja de ser un panel fixed centrado —tapaba justo las cards con
                las que se está comparando— y pasa a vivir EN EL FLUJO, como una
                columna más: sin position fixed ni sticky, se desplaza con la
                página. El catálogo recibe `compressed` y la mano aprieta su
                solapamiento para caber a la izquierda entera. */}
            <div className="hidden md:flex md:items-start md:gap-5" ref={fanRef}>
              {/* LOS PAPELES SE INVIERTEN al abrir (fundador 2026-08-26: «mira
                  todo el espacio que sobra cuando se abre la opción»). Antes la
                  columna de las cards seguía siendo flex-1 —acaparando el ancho
                  aunque la mano estaba comprimida— y la ficha quedaba clavada
                  en 430px: todo lo sobrante moría en medio, vacío. Ahora la
                  mano comprimida toma un ancho FIJO (el que de verdad ocupa) y
                  la ficha es la que crece hasta llenar el resto. Cerrada la
                  ficha, la columna vuelve a ser flex-1 como siempre. */}
              <div
                className={
                  expandedKind
                    ? 'min-w-0 shrink-0 md:w-[46%] md:min-w-[19rem] md:max-w-[36rem] xl:max-w-[40rem]'
                    : 'min-w-0 flex-1'
                }
              >
                <EarnCatalog
                  cards={routesForMenu.map((v) => ({
                    kind: v.kind,
                    asset: v.asset,
                    title: v.title,
                    action: v.action,
                    icon: v.icon,
                    accent: v.accent,
                    blocked: !!governedBlockOf(v.kind, !!activeGoverned),
                    market: KINSHIP[v.kind]?.market,
                    // El aviso regulatorio EN LA CARA (fundador 17-sep): el
                    // carry de Kinetic es real y no cumple MiCA por el USDT0.
                    notice: assetNoticeOf(v.kind)?.face,
                  }))}
                  selected={expandedKind}
                  onSelect={(k) => setExpandedKind(expandedKind === k ? null : k)}
                  chip={(k) => <LiveYieldChip y={yieldFor(k)} />}
                  rateOf={(k) => {
                    const y = yieldFor(k);
                    return y && y.kind !== 'none' && typeof y.pct === 'number' ? y.pct : null;
                  }}
                  compressed={!!expandedKind}
                  only={pickTy}
                  t={t}
                />
              </div>

                {expandedKind && (() => {
                  const sel = routesForMenu.find((x) => x.kind === expandedKind);
                  if (!sel) return null;
                  return (
                    /* La ficha ocupa su columna DE ARRIBA A ABAJO y hasta un
                       tercio de la pantalla (fundador, 25-ago). Dentro va la
                       hoja de «More info» ENTERA —lo técnico, los datos de
                       mercado con su fuente y la calculadora—, desplegada en
                       vez de escondida tras un clic, con su propio scroll y su
                       botón de empezar al final. */
                    /* En flujo, no anclada: entra por la derecha y ocupa su
                       columna. El alto acotado conserva el scroll propio de la
                       hoja (la ficha técnica entera es larga) sin convertirla
                       en un panel pegajoso. */
                    <motion.aside
                      initial={{ opacity: 0, x: 28 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                      className="min-w-0 flex-1 h-[min(74vh,46rem)]"
                      role="region"
                      aria-label={t('Strategy details')}
                    >
                      <StrategyInfoModal
                        inline
                        vault={sel}
                        y={yieldFor(sel.kind)}
                        asOf={asOf}
                        onClose={() => setExpandedKind(null)}
                        onFullSheet={() => setInfoVault(sel)}
                        onStart={() => {
                          setInitialInputs(undefined);
                          setActive(sel);
                        }}
                      />
                    </motion.aside>
                  );
                })()}
            </div>
            <div className="space-y-3 md:hidden">
              {routesForMenu.map((v) => {
                // Out of reach for a council: the cage has no borrow (see
                // GOVERNED_UNSUPPORTED). The row says so instead of offering
                // a Start that dead-ends in the composer.
                const blocked = governedBlockOf(v.kind, !!activeGoverned);
                const notice = assetNoticeOf(v.kind);
                const open = expandedKind === v.kind;
                return (
                <Card key={v.kind} hover={!open && !blocked} spotlight={open} padded={false} className={`overflow-hidden ${blocked ? 'opacity-70' : ''}`}>
                  <button
                    onClick={() => setExpandedKind(open ? null : v.kind)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="relative shrink-0">
                      <div className={`w-9 h-9 rounded-xl grid place-items-center border ${v.accent}`}>{v.icon}</div>
                      <TokenLogo symbol={v.asset} size="xs" className="absolute -bottom-1 -right-1 ring-2 ring-surface-1" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink truncate">{v.title}</h3>
                      <p className="text-[11px] text-ink/45 truncate">{t(v.action)}</p>
                      {/* Shared-market chip — the sisters explain themselves
                          before being opened (founder 2026-08-22). */}
                      {KINSHIP[v.kind] && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-ink/40">
                          {KINSHIP[v.kind]!.market} · {t('shared')}
                        </span>
                      )}
                      {/* The regulatory line ON the row, closed or open (founder
                          2026-09-17): the same face the desktop card wears. */}
                      {notice && (
                        <span role="note" className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-tone-warning">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                          <span className="line-clamp-2">{t(notice.face)}</span>
                        </span>
                      )}
                    </div>
                    <div className="hidden sm:flex items-center shrink-0">
                      <LiveYieldChip y={yieldFor(v.kind)} />
                    </div>
                    {blocked ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-tone-warning/30 bg-tone-warning/10 text-tone-warning shrink-0">
                        {t('Unsupported')}
                      </span>
                    ) : (
                      <span className="hidden md:inline text-[10px] px-2 py-0.5 rounded-full border border-ink/15 bg-ink/5 text-ink/55 shrink-0">
                        {t(v.railLabel)}
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: EASE_OUT }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-3 border-t border-ink/5">{renderVaultDetail(v)}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
                );
              })}
            </div>
          </RevealItem>

        </RevealGroup>
      )}

      {/* ── Crear con el agente: una conversación, y NADA MÁS en la pantalla.
             El catálogo estuvo en un raíl de 330px al lado (20-ago) y luego
             como tira dentro del propio chat (22-ago); ninguna de las dos
             gustó, y la razón es la misma en los dos casos: son las rutas de
             OTRA pantalla —la de Pick, a un clic— peleando por el alto que
             necesita la conversación. Fuera las dos veces, queda la puerta.
             (Fundador 2026-08-23: «tal vez lo mejor sea quitarlas ya que ya
             aparecen en el otro menú».) ── */}
      {view === 'create' && (
        <div className="mx-auto max-w-5xl">
          {/* El agente compila para quien opera: bajo un consejo nunca ofrece
              la ruta que pide prestado. */}
          <StrategyLLMChat
            onLaunch={launch}
            governed={!!activeGoverned}
            onBrowseRoutes={() => setView('pick')}
          />
        </div>
      )}

      {/* ── Movements: send/receive between wallets + the XRPL savings-escrow
             surface, one of Earn's doors (the old /app/savings redirects
             here; pre-rename ?view=savings still lands here too). ── */}
      {view === 'movements' && <MovementsPanel />}

      {/* ── Create Manually: compose a strategy by hand — parameters,
             MoneyFlows and tools. Drafts land in Estrategias · Saved. ── */}
      {view === 'manual' && <ManualStrategyBuilder onLaunch={launch} />}

      {/* INERT since 2026-08-24 — preserved, not deleted (repo rule: built code
          is left inert and reported, never removed). The registry took back its
          own nav row, so nothing sets view='strategies' any more and the
          ?view=strategies deep-link redirects to /app/strategies before this
          can render. Restoring the embed is re-adding one <EarnDoor>; the
          `embedded` prop on StrategiesPage stays wired for exactly that.

          Kept from the original note (founder 2026-08-01, "debe ser igual que
          Personal"): the page is authority-aware — for a council it swaps
          MoneyFlows for the governed surface and the cage's cards open the
          council-order composer, so the smart contract stays plumbing the
          person never sees. */}
      {view === 'strategies' && <StrategiesPage embedded onLaunch={launch} />}

      {/* La superficie de Managed vaults: cómo funciona el trato, y quién
          acepta clientes. PÚBLICA desde el 25-ago, igual que la puerta que la
          abre. La LISTA sigue vacía y tiene que seguirlo hasta que haya una
          lectura real: un directorio de gestores es una lista de gente pidiendo
          el dinero de otros, y una fila de ejemplo aquí sería inventarse una
          firma. */}
      {view === 'managers' && <ManagedVaultsSurface />}

      {/* El pie «Astryum is non-custodial…» sale de esta pantalla (fundador
          2026-08-25). No deja al producto callado sobre ello: se sigue diciendo
          en la landing, en About, en Lo que ofrecemos, en Ajustes, en el alta de
          wallet y —lo que de verdad cuenta— EN EL MOMENTO DE FIRMAR
          (WalletTransferModals). Ahí es donde la frontera prepare-only tiene
          efecto; en un hub era una nota gris que nadie leía. */}

      {/* El modal de la operación vive en EarnOperationHost (AppShell) —
          montarlo también aquí sería una segunda copia. */}

      {/* The guided finder — two questions, then a result step that TEACHES
          each matching route (plain sentence, live rate with source, risk)
          before landing on the cards. Filters only; never launches or
          recommends anything on its own. Catalogue and yield chip go in as
          props so the finder has no runtime import back into this file. */}

      {/* More info — the technical sheet + rate source + profitability
          calculator. Never signs; its Start hands off to the sign modal. */}
      {infoVault && (
        <StrategyInfoModal
          vault={infoVault}
          y={yieldFor(infoVault.kind)}
          asOf={asOf}
          onClose={() => setInfoVault(null)}
          onStart={() => { const v = infoVault; setInfoVault(null); setInitialInputs(undefined); setActive(v); }}
        />
      )}
    </div>
  );
}

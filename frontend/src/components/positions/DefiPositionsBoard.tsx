'use client';

/**
 * DefiPositionsBoard — position-centric Earn surface (Flare demo redesign).
 *
 * This is a NEW view (the original positions/page.tsx and the strategy/moneyflow
 * canvas components are left UNTOUCHED). Per the hand-drawn spec:
 *
 *   - Positions tab shows ONLY open DeFi positions, as cards.
 *   - Click a position → its Strategy opens INLINE (1 position = 1 strategy).
 *   - A Strategy here = the position + its MoneyFlows (no Goals, no node canvas).
 *   - A MoneyFlow is created from one of TWO pre-programmed templates:
 *       PROTECT  → defend a borrow: when HF < X, prepare repay   (automation A1)
 *       HARVEST  → compound rewards: when rewards ≥ X, prepare claim (automation A2)
 *
 * MoneyFlows are AutomationRules (POST /api/rules). The AutomationEngine evaluates
 * them every 60s, PREPARES the action and pushes the user to review + sign. Astryum
 * never signs, never executes (CLAUDE.md §0 / invariants #1, #7).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  Sprout,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Zap,
  Trash2,
  Power,
  Pencil,
  Workflow,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, MicroLabel, PageHeader, Pill, SectionTitle } from '../ui/primitives';
import { TokenLogo } from '../ui/TokenLogo';
import { formatMoney } from '../../lib/formatMoney';
// La cantidad en unidades humanas vive en lib para poder testearse: importar
// este componente arrastra AppKit y medio grafo, así que la lógica que decide
// QUÉ NÚMERO VE EL USUARIO era intesteable por vecindad.
import { qtyDisplay } from '../../lib/positionQty';
import { matchesAutoAction, type BoardAutoAction } from '../../lib/positionAutoAction';
import {
  chainIdOf,
  positionsBlocksOf,
  protocolWord,
  reduceFlareScan,
  shortAddr,
  type FlareProtocolUnread,
  type UnreadableAddr,
} from '../../lib/positionsReadState';
import { SceneDoor } from '@/components/ui/SceneDoor';
import { Arrive } from '@/components/ui/motion';
import { SignalBeacon } from '@/components/ui/scenes';
import { SignetMark } from '@/components/ui/skin/marks';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { positions as positionsApi, rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useMyWallets } from '../../hooks/useMyWallets';
import { invalidatePortfolioCache, setEthRailLive } from '../../lib/portfolioMerge';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { toRows, scanEthMorpho, anyVaultLegUnread } from '../../lib/earn/ethMorphoPosition';
import {
  boardShowsEmpty,
  isTransientStatus,
  positionReadFailureKind,
  positionWalletOf,
} from '../../lib/earn/exitReadState';
import {
  hydrateRulePrefillsFromServer,
  readRulePrefill,
  resolveInitialValues,
  rulePrefillScope,
} from '../../lib/automation/rulePrefill';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { canonicalizeSymbol } from '../../lib/canonicalizeSymbol';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { hfWord } from '../../lib/healthScore';
import { translateError } from '../../lib/errors/translateError';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { describeRule } from '../../lib/rules/describeRule';
import {
  RULE_PILL_TONE,
  loadRunReadings,
  rulePillState,
  type RuleRunReading,
} from '../../lib/rules/runHealth';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { type PaActionKind, type PaHolder, type PaLegs } from './PaActionsModal';
import { EmRepayModal } from './EmRepayModal';
import { EmExitModal, type EmExitMode } from './EmExitModal';
import { EmCloseModal } from './EmCloseModal';
import { VaultWithdrawModal, type VaultPositionRef } from './VaultWithdrawModal';
import { FtsoExitModal, type FtsoPositionRef } from './FtsoExitModal';
import { VaultClaimModal } from './VaultClaimModal';
import { TEMPLATES, type TemplateKind } from '../moneyflows/templateCatalog';
import { RuleEditModal } from '../moneyflows/RuleEditModal';
import { ProtectRuleCard } from '../moneyflows/ProtectRuleCard';
import { ModalOverlay, modalsOpen, useModalsOpen } from '@/components/ui/ModalPortal';
import { walletNameResolver } from '../../lib/walletIdentity';
import { useOperationStore } from '../../stores/operationStore';

const API_BASE = getApiBase();

/** Founder 2026-07-31 (interino, hasta el asistente único de salida): la card
 *  enseña UNA sola puerta para deshacer — «Close the position, step by step».
 *  Los botones sueltos (Repay now / Withdraw / Convert to XRP) quedan
 *  construidos pero dormidos tras este flag: los deep-links y los kinds del
 *  modal siguen funcionando; solo desaparece la botonera dispersa. */
const SHOW_SPLIT_EXIT_ACTIONS = false;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/* ------------------------------------------------------------------ */
/* TYPES + NORMALISATION                                               */
/* ------------------------------------------------------------------ */

interface RawDefiPosition {
  protocolId: string;
  kind: string;
  asset: string;
  amount: string | number;
  [extra: string]: unknown;
}

interface DefiPosition extends RawDefiPosition {
  /** Stable synthetic id used to bind MoneyFlows to this position. */
  positionId: string;
  /** Address that HOLDS this position (EVM wallet, or the Smart Account for FXRP). */
  owner: string;
  /** Normalised UPPER kind for logic. */
  kindUpper: string;
  label: string;
  templates: TemplateKind[];
}

const KIND_LABEL: Record<string, string> = {
  COLLATERAL: 'Lend',
  SUPPLY: 'Lend',
  LEND: 'Lend',
  DEBT: 'Borrow',
  BORROW: 'Borrow',
  STAKE: 'Stake',
  STAKING: 'Stake',
  LP: 'LP',
  REWARD: 'Rewards',
  REWARDS: 'Rewards',
  // Money in flight: a redeem already left the venue and the assets wait for
  // its release date (Firelight period, Sceptre cooldown, Upshift epoch).
  // Only says "Claimable" once the venue actually lets you claim — see
  // claimLabelFor: a 14.5-day Sceptre cooldown is NOT claimable, and calling it
  // so is exactly the unearned-success wording the repo bans.
  CLAIM: 'Leaving',
};

/** CLAIM rows split in two by the adapter's own `claimable` flag. */
function claimLabelFor(p: { raw?: unknown; [extra: string]: unknown }): 'Claimable' | 'Leaving' {
  const raw = (p.raw ?? {}) as { claimable?: unknown };
  return raw.claimable === true ? 'Claimable' : 'Leaving';
}

/** El color del TIPO, para pintar la ficha y el filo de cada fila. Es el mismo
 *  criterio que `kindTone` — una sola regla — traducido a clases. */
const KIND_SKIN: Record<string, { tile: string; edge: string }> = {
  success: { tile: 'border-tone-success/30 bg-tone-success/10 text-tone-success', edge: 'bg-tone-success/50' },
  danger: { tile: 'border-tone-danger/30 bg-tone-danger/10 text-tone-danger', edge: 'bg-tone-danger/50' },
  info: { tile: 'border-volt/30 bg-volt/10 text-volt', edge: 'bg-volt/50' },
  warning: { tile: 'border-tone-warning/30 bg-tone-warning/10 text-tone-warning', edge: 'bg-tone-warning/50' },
  neutral: { tile: 'border-ink/10 bg-ink/5 text-ink/70', edge: 'bg-ink/15' },
};

function kindTone(kind: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const k = kind.toUpperCase();
  if (k === 'COLLATERAL' || k === 'SUPPLY' || k === 'LEND') return 'success';
  if (k === 'DEBT' || k === 'BORROW') return 'danger';
  if (k === 'LP' || k === 'STAKE' || k === 'STAKING') return 'info';
  if (k === 'REWARD' || k === 'REWARDS' || k === 'CLAIM') return 'warning';
  return 'neutral';
}

/** Which automation templates apply to a position (the demo's two automations). */
function templatesFor(protocolId: string, kindUpper: string, chainId?: number): TemplateKind[] {
  const out: TemplateKind[] = [];
  const proto = protocolId.toLowerCase();
  // W5/B7 — the Ethereum FXRP/RLUSD position gets its OWN protect twin
  // (emRepay, M1 pattern) and never the Kinetic one; chainId gates it so the
  // Base cbXRP rows (same 'morpho-blue' slug, watch-only) stay template-free.
  if (proto === 'morpho-blue') {
    if (chainId === 1 && ['DEBT', 'BORROW', 'COLLATERAL'].includes(kindUpper)) {
      out.push('PROTECT_EM');
    }
    return out;
  }
  // PROTECT defends a leveraged/borrow position (A1 = Kinetic HF→repay).
  if (proto === 'kinetic' || kindUpper === 'DEBT' || kindUpper === 'BORROW') out.push('PROTECT');
  // HARVEST compounds yield/rewards (A2 = FTSO rewards→claim/compound).
  if (proto === 'ftso' || ['STAKE', 'STAKING', 'REWARD', 'REWARDS'].includes(kindUpper)) out.push('HARVEST');
  return out;
}

/** Open DeFi position kinds we surface (exclude idle/free wallet balances). */
const DEFI_KINDS = new Set([
  'COLLATERAL', 'SUPPLY', 'LEND', 'DEBT', 'BORROW', 'LP', 'STAKE', 'STAKING', 'REWARD', 'REWARDS', 'CLAIM',
]);

/** Adapter positions carry the receipt-token ADDRESS in `asset`; prefer the
 *  human name the adapter put in raw (vaultName / token) when present. */
function assetDisplay(p: { asset: string; raw?: unknown }): string {
  const raw = (p.raw ?? {}) as { vaultName?: string; token?: string; symbol?: string };
  if (raw.vaultName) return raw.vaultName;
  if (raw.token) return raw.token;
  // Kinetic raws llevan el símbolo del UNDERLYING (FXRP, USD₮0) — sin esto la
  // card titulaba con la dirección del contrato (0xAd55…c5bE).
  if (raw.symbol) return raw.symbol;
  if (/^0x[a-fA-F0-9]{40}$/.test(p.asset)) return `${p.asset.slice(0, 6)}…${p.asset.slice(-4)}`;
  return p.asset;
}

/** The partner-vault exit rail this position can use, if any. */
function vaultRefFor(p: DefiPosition): VaultPositionRef | null {
  const raw = (p.raw ?? {}) as {
    vaultKey?: string;
    token?: string;
    vaultName?: string;
    sharePriceE6?: string;
  };
  const proto = p.protocolId.toLowerCase();
  if (proto === 'upshift' && (raw.vaultKey === 'earnxrp' || raw.vaultKey === 'monarq')) {
    return {
      vault: raw.vaultKey,
      vaultLabel: raw.token ?? raw.vaultName ?? assetDisplay(p),
      owner: p.owner,
      sharesBase: String(p.amount),
      sharePriceE6: raw.sharePriceE6 ?? null,
    };
  }
  if (proto === 'firelight' && p.kindUpper === 'STAKE') {
    return {
      vault: 'firelight',
      vaultLabel: raw.token ?? 'stXRP',
      owner: p.owner,
      sharesBase: String(p.amount),
      sharePriceE6: null,
    };
  }
  return null;
}

/** The FTSO delegation exit rail (E2 reverse: undelegate + unwrap WFLR→FLR). */
function ftsoRefFor(p: DefiPosition): FtsoPositionRef | null {
  if (p.protocolId.toLowerCase() === 'ftso' && p.kindUpper === 'STAKE') {
    return { owner: p.owner };
  }
  return null;
}

/** Every account with an open Kinetic ISO position — feeds the PA modal's
 *  selector when the same market is open from more than one wallet. */
function kineticHoldersFor(all: DefiPosition[]): PaHolder[] {
  const owners = [
    ...new Set(all.filter((p) => p.protocolId.toLowerCase() === 'kinetic').map((p) => p.owner)),
  ];
  return owners
    .map((o) => ({ owner: o, legs: kineticLegsFor(all, o) }))
    .filter((h) => h.legs.supplyFxrpBase || h.legs.debtUsdt0Base || h.legs.suppliedUsdt0Base);
}

/** Every wallet holding the SAME vault as `p` — feeds the modal's selector. */
function vaultHoldersFor(all: DefiPosition[], p: DefiPosition): VaultPositionRef[] {
  const me = vaultRefFor(p);
  if (!me) return [];
  return all
    .map(vaultRefFor)
    .filter((r): r is VaultPositionRef => !!r && r.vault === me.vault);
}

/* BoardAutoAction + matchesAutoAction viven en lib/positionAutoAction:
 * la regla que decide QUE PUERTA abre un aviso no puede estar sin tests, y
 * aqui dentro era intesteable (importar este componente arrastra AppKit). */
export type { BoardAutoAction };

/**
 * The board's rows out of one `/positions/:wallet` body. Reads ONLY the rows;
 * what a block could not read (`error`, `unreadable`) is `unreadBlocksOf`'s
 * job — both read the body through `positionsBlocksOf` (lib/positionsReadState).
 * Body kept plain JS so the tests run THIS function, not a copy.
 */
function flattenPositions(data: unknown, owner: string): DefiPosition[] {
  const out: DefiPosition[] = [];
  for (const block of positionsBlocksOf(data)) {
    for (const p of block.positions) {
      const kindUpper = String(p.kind ?? '').toUpperCase();
      if (!DEFI_KINDS.has(kindUpper)) continue;
      const positionId = `${block.protocolId}:${p.asset}:${p.kind}`;
      out.push({
        ...p,
        protocolId: block.protocolId,
        positionId,
        owner,
        kindUpper,
        label: kindUpper === 'CLAIM' ? claimLabelFor(p) : (KIND_LABEL[kindUpper] ?? p.kind),
        templates: templatesFor(block.protocolId, kindUpper, chainIdOf(p)),
      });
    }
  }
  return out;
}

/**
 * H1 — the Ethereum FXRP/RLUSD position, as board rows.
 *
 * Fail-closed by the rail's OWN gate: `/status` says whether the module is
 * on, and a `false` (or an unreachable backend) yields NO rows — never a
 * half-painted position. Best-effort per address: one wallet failing must not
 * cost the others, and nothing here can blank the Flare board.
 */
async function fetchEthMorphoRows(
  addrs: string[],
): Promise<{ rows: DefiPosition[]; unreadable: UnreadableAddr[]; vaultLegUnread: boolean }> {
  // Revisión 14-sep: el lector compartido sólo devuelve QUÉ direcciones no se
  // pudieron leer; el PORQUÉ (451 región ≠ 502 «un momento») se captura aquí,
  // envolviendo su fetch, sin tocar el lector.
  const failures = new Map<string, number | null>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const w = positionWalletOf(url);
    try {
      const r = await fetch(input, init);
      if (w && !r.ok) failures.set(w.toLowerCase(), r.status);
      return r;
    } catch (e) {
      if (w) failures.set(w.toLowerCase(), null);
      throw e;
    }
  };
  // H10 — el tablero sigue el interruptor CALIENTE del carril, no el valor
  // incrustado en el build: `scanEthMorpho` lo publica al leer `/status`.
  const scan = await scanEthMorpho(addrs, {
    apiBase: API_BASE,
    headers: authHeaders,
    region: getUserRegion() ?? null,
    onRailStatus: setEthRailLive,
    fetchImpl,
  });
  const rows: DefiPosition[] = [];
  for (const read of scan.reads) {
    for (const row of toRows(read)) {
      const kindUpper = row.kind;
      rows.push({
        ...row,
        positionId: `${row.protocolId}:${row.asset}:${row.kind}`,
        owner: row.owner,
        kindUpper,
        label: KIND_LABEL[kindUpper] ?? row.kind,
        templates: templatesFor(row.protocolId, kindUpper, row.chainId),
      });
    }
  }
  // Una dirección que no se pudo leer NO es una dirección sin posición: se
  // devuelve para decirlo. Antes se tragaba el fallo y la posición —con su
  // botón de repago— desaparecía del tablero justo cuando podía hacer falta.
  //
  // Y la pata de la bóveda se lee aparte dentro de /position, así que puede
  // fallar ella sola: un cero silencioso ahí es indistinguible de un depósito
  // perdido, y también se dice.
  return {
    rows,
    unreadable: scan.unreadable.map((addr) => ({ addr, status: failures.get(addr.toLowerCase()) ?? null })),
    vaultLegUnread: anyVaultLegUnread(scan.reads),
  };
}

/**
 * The Kinetic ISO legs of one Personal Account, classified by the kToken
 * symbol carried in the raw scan (`kFXRP…`/`kUSDT0…`). Base units throughout.
 */
/**
 * Deuda RLUSD viva del dueño en el mercado de Ethereum, en base units.
 *
 * Es lo que distingue un carry ENTERO de uno a medio abrir. El colateral en
 * Morpho Blue no cobra supply rate, así que colateral aportado y deuda 0 es
 * capital parado — y hasta ahora esa posición no tenía puerta para terminarse:
 * la acción `borrow` existía y estaba testeada en el backend, y ningún botón
 * la llamaba.
 */
function emDebtFor(all: DefiPosition[], owner: string): string {
  for (const p of all) {
    if (p.protocolId.toLowerCase() !== 'morpho-blue') continue;
    if ((p as { chainId?: number }).chainId !== 1) continue;
    if (p.owner.toLowerCase() !== owner.toLowerCase()) continue;
    if (p.kindUpper === 'DEBT') return String(p.amount);
  }
  return '0';
}

function kineticLegsFor(all: DefiPosition[], owner: string): PaLegs {
  const legs: PaLegs = {};
  for (const p of all) {
    if (p.protocolId.toLowerCase() !== 'kinetic' || p.owner !== owner) continue;
    const raw = p.raw as { symbol?: string; iso?: boolean } | undefined;
    // ONLY the ISO market's legs feed the ISO actions: a core-comptroller
    // position (sFLR, USDC.e…) classified as "FXRP collateral" would show and
    // prepare wrong amounts.
    if (raw?.iso !== true) continue;
    // El símbolo ERC-20 real de USDT0 lleva ₮ (U+20AE): "USD₮0" — sin la
    // Sin canonicalizar el ₮, el includes('USDT') jamás casaba, la pierna de
    // deuda no entraba en legs y los botones Repay/Unwind desaparecían
    // (incidente 2026-07-26; tercera víctima del mismo carácter).
    const sym = canonicalizeSymbol(String(raw?.symbol ?? p.asset));
    const isUsdt = sym.includes('USDT');
    if (['SUPPLY', 'COLLATERAL', 'LEND'].includes(p.kindUpper)) {
      if (isUsdt) legs.suppliedUsdt0Base = String(p.amount);
      else if (sym === 'FXRP') legs.supplyFxrpBase = String(p.amount);
    } else if (['BORROW', 'DEBT'].includes(p.kindUpper) && isUsdt) {
      legs.debtUsdt0Base = String(p.amount);
    }
  }
  return legs;
}

/** Bind a rule to a position: the demo matches on protocolId (1 kinetic, 1 ftso). */
function rulesForPosition(allRules: AutomationRule[], pos: DefiPosition): AutomationRule[] {
  return allRules.filter((r) => {
    const action = (r.action ?? {}) as { protocolId?: string; positionId?: string };
    if (action.positionId && action.positionId === pos.positionId) return true;
    return (action.protocolId ?? '').toLowerCase() === pos.protocolId.toLowerCase();
  });
}

function templateOfRule(r: AutomationRule): TemplateKind | null {
  const trigger = (r.trigger ?? {}) as { type?: string };
  if (trigger.type === 'HF_BELOW' || trigger.type === 'HF_CRITICAL') return 'PROTECT';
  if (trigger.type === 'REWARD_THRESHOLD') return 'HARVEST';
  return null;
}

// The rule's sentence comes from the ONE shared reader (lib/rules/describeRule)
// — this file's own version was hardcoded English with raw ratios and machine
// kinds ("When LTV > 0.3 → prepare claimRewards").
function describeRuleText(r: AutomationRule, t: (s: string) => string): string {
  const type = String((r.trigger as { type?: string } | null)?.type ?? '');
  if (!type) return r.name;
  return describeRule(r.trigger as Record<string, unknown>, r.action as Record<string, unknown>, t);
}

/* Template catalogue → ../moneyflows/templateCatalog.tsx (2026-07-25): the ONE
   source of the PROTECT/HARVEST payloads, shared with the embedded entry card
   (ProtectRuleCard) so no creation path drifts from another. */

/* ------------------------------------------------------------------ */
/* NET APY de la posición — la métrica que faltaba (founder 2026-07-25):
   rendimiento del supply (base on-chain + recompensas WFLR) MENOS el coste
   del borrow, sobre el equity. Fuente ÚNICA y citada: el `economics` de
   /flare-demo/iso-legs (calculado server-side con las mismas fuentes que
   /yields). Sin datos → no se pinta nada: jamás un número inventado (#9). */
/* ------------------------------------------------------------------ */
interface IsoEconomics {
  netApyPct: number | null;
  supplyApyPct: number;
  borrowAprPct: number;
  usdt0SupplyAprPct: number | null;
  supplyUsd: number;
  debtUsd: number;
  equityUsd: number;
  sources: string;
  note: string;
}

function IsoNetApyBlock({ owner }: { owner: string }) {
  const { t } = useT();
  const [eco, setEco] = useState<IsoEconomics | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/flare-demo/iso-legs/${owner}`, { headers: authHeaders(), credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { economics?: IsoEconomics } | null) => {
        if (alive && b?.economics) setEco(b.economics);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [owner]);
  if (!eco || eco.netApyPct == null) return null;
  const neg = eco.netApyPct < 0;
  return (
    <div className="mt-4 rounded-xl border border-ink/10 bg-ink/[0.03] p-3" title={eco.sources}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-ink/40">Net APY · {t('at current rates')}</span>
        <span className={`font-mono text-sm font-semibold ${neg ? 'text-tone-warning' : 'text-tone-success'}`}>
          {eco.netApyPct >= 0 ? '+' : ''}
          {eco.netApyPct.toFixed(2)}%
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink/50 leading-relaxed">
        {t('Supply')} {eco.supplyApyPct.toFixed(2)}% APY (${eco.supplyUsd.toFixed(2)}) · {t('Borrow')}{' '}
        {eco.borrowAprPct.toFixed(2)}% APR (${eco.debtUsd.toFixed(2)}) → {t('over your equity')} ($
        {eco.equityUsd.toFixed(2)})
      </p>
      <p className="mt-0.5 text-[9px] text-ink/30">{eco.note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TEMPLATE MODAL — create a MoneyFlow (no nodes, just a template)      */
/* ------------------------------------------------------------------ */

function MoneyFlowTemplateModal({
  position,
  template,
  walletAddress,
  onClose,
  onCreated,
}: {
  position: DefiPosition;
  template: TemplateKind;
  walletAddress: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const tpl = TEMPLATES[template];
  // Editable variables start from the values the user ALREADY CHOSE in the flow
  // that opened this position (stashed at signature time, e.g. the E1 entry's
  // targetHF/debt), falling back to the template defaults when no flow preceded.
  // Prefill is UX only: every field stays editable and the rule is still created
  // via POST /api/rules below.
  const prefill = useMemo(
    () => readRulePrefill(rulePrefillScope([template, position.protocolId, position.owner])),
    [template, position.protocolId, position.owner],
  );
  const initial = useMemo(() => resolveInitialValues(tpl.fields, prefill), [tpl, prefill]);
  const [vals, setVals] = useState<Record<string, string>>(() => initial.values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setVal = (key: string, value: string) => setVals((s) => ({ ...s, [key]: value }));

  async function create() {
    setError('');
    // Validate numeric fields are > 0 where a positive value is required.
    for (const f of tpl.fields) {
      if (f.type === 'number') {
        const n = parseFloat(vals[f.key]);
        if (isNaN(n) || n < (f.min ?? 0)) {
          setError(`${t('Invalid value for')} "${t(f.label)}"`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const { trigger, action, cooldownMinutes } = tpl.build(vals, position);
      await rulesApi.create({
        walletAddress,
        // Chain scope follows the POSITION, not the connection (the b207fff
        // lesson): PROTECT_EM guards the Ethereum market, everything else is
        // Flare. A rule scoped to the wrong chain scans the wrong chain and
        // silently never fires.
        chainId: template === 'PROTECT_EM' ? 1 : 14,
        name: `${tpl.label} · ${position.asset}`,
        trigger,
        action,
        cooldownMinutes,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(translateError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl grid place-items-center border ${tpl.accent}`}>{tpl.icon}</div>
            <div>
              <h2 className="text-base font-semibold text-ink">{tpl.label}</h2>
              <p className="text-xs text-ink/40 mt-0.5">{position.label} · {position.asset}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* PROTECT = the ONE shared card (founder 2026-07-25: la tarjeta
              manual en todos los modales) — simple + escalonado + chips viven
              allí; este modal solo pone el marco. HARVEST sigue genérico. */}
          {template === 'PROTECT' ? (
            <>
              {initial.prefilledKeys.size > 0 && (
                <div className="bg-volt/5 border border-volt/20 rounded-xl p-3 text-[11px] text-ink/60 flex items-start gap-2">
                  <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-volt" />
                  <span>
                    {t('Pre-filled with the thresholds you chose for this entry — adjust them if you like.')}
                    {prefill?.context?.triggerPriceUSD && (
                      <>
                        {' '}
                        {t('Estimated trigger price')}:{' '}
                        <span className="font-mono text-ink/75">${prefill.context.triggerPriceUSD}</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              <ProtectRuleCard
                walletAddress={walletAddress}
                protocolId={position.protocolId}
                positionId={position.positionId}
                assetLabel={position.asset}
                prefill={prefill?.values}
                onCreated={() => {
                  onCreated();
                  onClose();
                }}
              />
              <button
                onClick={onClose}
                className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Cancel')}
              </button>
            </>
          ) : (
            <>
          <p className="text-sm text-ink/55 leading-relaxed">{t(tpl.blurb)}</p>

          {initial.prefilledKeys.size > 0 && (
            <div className="bg-volt/5 border border-volt/20 rounded-xl p-3 text-[11px] text-ink/60 flex items-start gap-2">
              <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-volt" />
              <span>
                {t('Pre-filled with the thresholds you chose for this entry — adjust them if you like.')}
                {prefill?.context?.triggerPriceUSD && (
                  <>
                    {' '}
                    {t('Estimated trigger price')}:{' '}
                    <span className="font-mono text-ink/75">${prefill.context.triggerPriceUSD}</span>
                  </>
                )}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {tpl.fields.map((f) =>
              f.type === 'toggle' ? (
                <label
                  key={f.key}
                  className="flex items-center justify-between gap-3 bg-ink/5 border border-ink/10 rounded-xl px-4 py-3 cursor-pointer"
                >
                  <div>
                    <div className="text-xs text-ink/70">{t(f.label)}</div>
                    {f.hint && <p className="text-[10px] text-ink/40 mt-0.5">{t(f.hint)}</p>}
                  </div>
                  <input
                    type="checkbox"
                    checked={vals[f.key] === 'true'}
                    onChange={(e) => setVal(f.key, e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 accent-volt"
                  />
                </label>
              ) : (
                <div key={f.key}>
                  <label className="text-xs text-ink/40 block mb-2">
                    {t(f.label)}
                    {f.unit && <span className="text-ink/30"> · {f.unit}</span>}
                  </label>
                  <input
                    type="number"
                    min={f.min ?? 0}
                    step={f.step ?? 'any'}
                    value={vals[f.key]}
                    onChange={(e) => setVal(f.key, e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                  />
                  {f.hint && <p className="text-[10px] text-ink/40 mt-1.5">{t(f.hint)}</p>}
                </div>
              ),
            )}
          </div>

          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('When it triggers, Astryum prepares the action and asks you to sign. It never signs or executes on its own.')}
          </div>

          {error && (
            <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              onClick={create}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {t('Activate automation')}
            </button>
          </div>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* INLINE STRATEGY PANEL — position + its MoneyFlows                    */
/* ------------------------------------------------------------------ */

/**
 * G4-residuos (auditoria 2026-08-17 §G4) — the «watching» that watches nothing.
 *
 * WHAT WAS FAILING IN SILENCE HERE: this board was the ONLY consumer of
 * GET /rules/:id/runs — and it threw away the two things that matter. It kept
 * `count`/`lastAt`/`lastStatus` and DROPPED `notes`, so the reason an armed
 * automation produced nothing (`NoCageForLegacy`, `council_compose_failed`,
 * `scheduled_payment_invalid`, a failed prepare) never reached the owner. Worse,
 * a run whose `status` is `error` looked exactly like a healthy one: the pill
 * stayed green on `r.enabled` alone, and the status only appeared as a raw
 * machine word in parentheses at the end of a grey line.
 *
 * And the read itself failed SILENTLY: a non-2xx `continue`d and a throw hit
 * `/* history is best-effort *\/`, leaving NO entry — which the row printed as
 * «No triggers yet», a fact we had never established. «I could not read it» is
 * not «it never fired», and neither of them is «it is fine».
 *
 * Same reducer and same sentences as MoneyFlowsPanel and LegacyActivityFeed —
 * the surfaces must never disagree about the same rule. G4-strategies (round
 * 2): that reducer no longer lives here as a third literal copy — it is
 * lib/rules/runHealth.ts, imported above.
 *
 * REUSE (auditoría 2026-08-18): nor does the READ. This was the only one of the
 * six surfaces still calling GET /rules/:id/runs by hand, with its own headers
 * and its own wording for a failed read, on the excuse that it also needs
 * `count` / `lastAt` / `lastStatus` for the history line. The shared module
 * learned those three facts (`loadRunReadings`) and this surface now asks it,
 * through the same `rulesApi.runs` the other five use — which also means a 401
 * here finally behaves like a 401 everywhere else (v1Api handles it) instead of
 * being reported to the family as «could not read this rule's run history».
 *
 * Read on mount AND on refresh: see `runsRevision` below.
 */

/**
 * The history line under a rule's name. Four different sentences for four
 * different facts, where there used to be two: «N triggers · last …» (whatever
 * the status was) and «No triggers yet» (including when the read had failed).
 *
 * G4-pildoras (round 3) — `enabled` arrived because this line never looked at
 * it: a PAUSED rule with an old failed run claimed «this rule is armed» next to
 * its Resume button. The failure still shows (it happened); the tense follows
 * the rule's actual state.
 */
function RunHistoryLine({
  health,
  enabled,
  t,
}: {
  health: RuleRunReading | undefined;
  enabled: boolean;
  t: (s: string) => string;
}) {
  // Not read yet — the effect is still in flight.
  if (!health) {
    return <div className="text-[10px] text-ink/30 truncate">{t('Reading its run history…')}</div>;
  }
  const { verdict } = health;
  if (verdict.state === 'unreadable') {
    return (
      <div className="text-[10px] text-tone-warning" title={verdict.detail}>
        {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
      </div>
    );
  }
  const when = health.lastAt ? new Date(health.lastAt).toLocaleString() : '—';
  if (verdict.state === 'failed') {
    return (
      <div className="text-[10px] text-tone-danger">
        <span className="inline-flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
          <span>
            {enabled
              ? t('Its last run FAILED — this rule is armed but it produced nothing to sign.')
              : t('Its last run FAILED before it was paused — it produced nothing to sign.')}
          </span>
        </span>
        <span className="block text-tone-danger/70">
          {when}
          {verdict.note ? ` · ${verdict.note}` : ` · ${t('the engine recorded no reason')}`}
          {verdict.consecutive > 1 ? ` · ${t('Consecutive failed runs:')} ${verdict.consecutive}` : ''}
        </span>
      </div>
    );
  }
  if (health.count === 0) {
    return <div className="text-[10px] text-ink/30 truncate">{t('No triggers yet')}</div>;
  }
  return (
    <div className="text-[10px] text-ink/30 truncate">
      {health.count} {t('triggers')} · {t('last')} {when}
      {health.lastStatus ? ` (${health.lastStatus})` : ''}
    </div>
  );
}

function StrategyPanel({
  position,
  rules,
  autoTemplate = null,
  runsRevision = 0,
  onChanged,
}: {
  position: DefiPosition;
  rules: AutomationRule[];
  /** Opens this template's modal on mount (hub deep-link, e.g. Harvest). */
  autoTemplate?: TemplateKind | null;
  /**
   * G4-strategies — bumped by the board every time it finishes re-reading the
   * rules (mount, manual Refresh, focus return, `onChanged` after a pause /
   * edit / delete, the 60s visible poll). WHAT WAS FAILING IN SILENCE: the
   * effect below depended on `[ruleIdsKey]` alone, so with the card OPEN the
   * verdict was frozen at mount — a rule that started failing kept its green
   * «active» pill until the card was collapsed, and an `onChanged()` that
   * returned the SAME rule ids re-read nothing at all. The brief asked for
   * mount AND refresh; this is the refresh.
   */
  runsRevision?: number;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [picking, setPicking] = useState<TemplateKind | null>(autoTemplate);
  // In-place edit (founder 2026-07-25) — same modal as the MoneyFlows panel.
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  // Hub deep-link may arrive after mount (card already expanded) — follow the edge.
  useEffect(() => {
    if (autoTemplate) setPicking(autoTemplate);
  }, [autoTemplate]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Trigger history per rule (GET /rules/:id/runs) — when it fired, what
  // happened AND why, so an armed rule isn't a black box. G4-residuos: the
  // verdict (and the engine's own `notes`) now travel with the counters.
  const [runsByRule, setRunsByRule] = useState<Record<string, RuleRunReading>>({});

  const myRules = rulesForPosition(rules, position);
  const ruleIdsKey = myRules.map((r) => r.id).join(',');

  useEffect(() => {
    let alive = true;
    (async () => {
      // REUSE (auditoría 2026-08-18) — the shared loader, same as the other five
      // surfaces. It fans the reads out in parallel (this loop used to await
      // them one by one) and, crucially, gives EVERY id an entry including the
      // ones whose read failed: an absent entry is indistinguishable from
      // «healthy», which is the bug the module exists to close. G4-residuos'
      // two guards live inside it now — a failed read is `unreadable`, never an
      // empty history, and `notes` travels with the verdict.
      const out = await loadRunReadings(ruleIdsKey.split(',').filter(Boolean), (id) => rulesApi.runs(id));
      // Cancellation stays HERE, not in the loader: the effect knows whether
      // this card is still the one on screen; the reader does not.
      if (alive) setRunsByRule(out);
    })();
    return () => {
      alive = false;
    };
    // G4-strategies — `runsRevision` is the second dependency the round-1 fix
    // was missing: mount AND refresh. Without it the row froze on the verdict
    // it read when the card opened. This adds NO timer of its own — it rides
    // the board's existing reading cadence, and only for the rules of the ONE
    // expanded card.
  }, [ruleIdsKey, runsRevision]);

  async function toggle(rule: AutomationRule) {
    setBusyId(rule.id);
    try {
      if (rule.enabled) await rulesApi.disable(rule.id);
      else await rulesApi.enable(rule.id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(rule: AutomationRule) {
    setBusyId(rule.id);
    try {
      await rulesApi.delete(rule.id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-t border-ink/5 mt-4 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{t('Automations (MoneyFlows)')}</span>
        <div className="flex gap-1.5">
          {position.templates.map((tk) => (
            <button
              key={tk}
              onClick={() => setPicking(tk)}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${TEMPLATES[tk].accent} hover:brightness-110`}
            >
              <Plus className="w-3 h-3" />
              {TEMPLATES[tk].label}
            </button>
          ))}
        </div>
      </div>

      {myRules.length === 0 ? (
        <p className="text-xs text-ink/35">
          {position.templates.length > 0
            ? t('No automation yet. Add Protect or Harvest above.')
            : t('No automation template applies to this position.')}
        </p>
      ) : (
        <div className="space-y-2">
          {myRules.map((r) => {
            const tk = templateOfRule(r);
            // G4-residuos — an enabled automation whose LAST fire errored is not
            // «active»: it is armed and preparing nothing. The green pill on
            // `r.enabled` alone was the reassurance that hid it.
            // G4-pildoras (round 3) — nor is one whose runs we have NOT READ:
            // `state === 'failed'` alone left `unread` and `unreadable` in the
            // green arm, so the first paint claimed «active» before a single
            // run was read and a broken /runs returned a FAILING rule to green.
            const pill = rulePillState(r.enabled, runsByRule[r.id]?.verdict);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 bg-ink/5 border border-ink/10 rounded-xl px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {r.canonicalRef ? (
                    // CMF-compiled rule (F1): part of a custom MoneyFlow drafted
                    // with the assistant — badge it apart from the templates.
                    <span
                      title={t('Custom MoneyFlow')}
                      className="w-7 h-7 rounded-lg grid place-items-center border shrink-0 text-volt border-volt/30 bg-volt/10"
                    >
                      <Workflow className="w-5 h-5" />
                    </span>
                  ) : (
                    tk && <span className={`w-7 h-7 rounded-lg grid place-items-center border shrink-0 ${TEMPLATES[tk].accent}`}>{TEMPLATES[tk].icon}</span>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs text-ink/85 font-medium truncate">{r.name}</div>
                    <div className="text-[10px] text-ink/40 truncate">{describeRuleText(r, t)}</div>
                    <RunHistoryLine health={runsByRule[r.id]} enabled={r.enabled} t={t} />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Pill tone={RULE_PILL_TONE[pill]}>
                    {pill === 'paused'
                      ? t('paused')
                      : pill === 'failing'
                        ? t('failing')
                        : pill === 'unreadable'
                          ? t('unknown')
                          : pill === 'unread'
                            ? t('checking…')
                            : t('active')}
                  </Pill>
                  <button
                    onClick={() => setEditRule(r)}
                    disabled={busyId === r.id}
                    title={t('Edit')}
                    className="p-1.5 rounded-lg border border-ink/10 bg-ink/5 text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors disabled:opacity-40"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggle(r)}
                    disabled={busyId === r.id}
                    title={r.enabled ? t('Pause') : t('Resume')}
                    className="p-1.5 rounded-lg border border-ink/10 bg-ink/5 text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors disabled:opacity-40"
                  >
                    {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    disabled={busyId === r.id}
                    title={t('Delete')}
                    className="p-1.5 rounded-lg border border-ink/10 bg-ink/5 text-ink/50 hover:text-tone-danger hover:bg-tone-danger/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {picking && (
        <MoneyFlowTemplateModal
          position={position}
          template={picking}
          walletAddress={position.owner}
          onClose={() => setPicking(null)}
          onCreated={onChanged}
        />
      )}
      {editRule && (
        <RuleEditModal rule={editRule} onClose={() => setEditRule(null)} onSaved={onChanged} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* COMPLETE BORROW — finish a HALF-OPEN carry (supply landed, borrow    */
/* didn't). EVM-direct positions only: the wallet signs the borrow      */
/* itself against the collateral it ALREADY supplied.                   */
/* ------------------------------------------------------------------ */

interface E1BorrowPrepared {
  rail: 'evm';
  chainId: number;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  /** Invariant #11 — the prepare's dry-run verdict. */
  preflight?: PreflightInfo;
  disclosure: Record<string, unknown> & { note?: string };
}

function CompleteBorrowModal({
  owner,
  onClose,
  onChanged,
}: {
  owner: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  // Nombre canónico de la dueña para la cabecera (2026-08-22).
  const { wallets: borrowWallets } = useMyWallets();
  const walletNameOf = useMemo(() => walletNameResolver(borrowWallets, t), [borrowWallets, t]);
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const [ratio, setRatio] = useState('0.30');
  const [targetHF, setTargetHF] = useState('1.10');
  const [phase, setPhase] = useState<'form' | 'preparing' | 'review' | 'signing' | 'done' | 'unconfirmed'>('form');
  const [prepared, setPrepared] = useState<E1BorrowPrepared | null>(null);
  const [error, setError] = useState('');
  // A borrow we could not follow (e.g. RECEIPT_UNREAD): never back to the sign button.
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);

  async function prepare() {
    setError('');
    setPhase('preparing');
    try {
      const res = await fetch(`${API_BASE}/flare-demo/e1-borrow/prepare`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          evmAddress: owner,
          borrowRatio: parseFloat(ratio) || 0.3,
          targetHF: parseFloat(targetHF) || 1.1,
          region: getUserRegion(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      setPrepared(body as E1BorrowPrepared);
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setUnconfirmed(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      if (!evm.isConnected || evm.address?.toLowerCase() !== owner.toLowerCase()) {
        throw new Error(t('Connect the Flare wallet that holds this position to sign.'));
      }
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
      );
      settlement.track(handle, { onSettled: onChanged });
      // Signed ≠ done: the parent refresh waits for onSettled (a premature
      // onChanged() dropped the row while the op was still live).
      setPhase('done');
    } catch (e) {
      // A borrow that may be on-chain must never be offered again: a second
      // signature is a second debt against the same collateral.
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase,
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  const d = prepared?.disclosure;
  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Complete the borrow')}</h2>
            {/* Nombre primero, dirección como dato (2026-08-22: el código
                nunca es el nombre). */}
            <p className="text-xs text-ink/40 mt-0.5">
              {walletNameOf(owner)}{' '}
              <span className="font-mono text-ink/30">{owner.slice(0, 10)}…{owner.slice(-6)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {error && (
            <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {phase === 'form' && (
            <>
              <p className="text-sm text-ink/55 leading-relaxed">
                {t('This position has FXRP collateral but no USDT0 borrow — the entry stopped halfway. This prepares ONLY the missing borrow against the collateral already supplied.')}
              </p>
              <div>
                <label className="text-xs text-ink/40 block mb-2">{t('Borrow ratio (of the borrowing capacity)')}</label>
                <input
                  type="number" min={0.05} max={1} step={0.05} value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                />
              </div>
              <div>
                <label className="text-xs text-ink/40 block mb-2">{t('Target Health Factor')}</label>
                <input
                  type="number" min={1.01} step={0.05} value={targetHF}
                  onChange={(e) => setTargetHF(e.target.value)}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                />
              </div>
              <button
                onClick={prepare}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20"
              >
                {t('Review before signing')}
              </button>
            </>
          )}
          {phase === 'preparing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Preparing the unsigned payload…')}</p>
            </div>
          )}
          {phase === 'review' && prepared && (
            <>
              <div className="bg-ink/5 border border-ink/10 rounded-xl px-4 py-2 divide-y divide-ink/5 text-xs">
                {[
                  [t('FXRP collateral'), `${Number(d?.fxrpCollateral ?? 0).toLocaleString()} FXRP`],
                  [t('Borrow'), `${Number(d?.usdt0Borrowed ?? 0).toLocaleString()} USDT0`],
                  [
                    t('Your cushion at entry'),
                    `${hfWord(Number(d?.entryHF ?? 0), t).label} (${Number(d?.entryHF ?? 0).toFixed(2)})`,
                  ],
                  [t('Estimated trigger price'), `$${Number(d?.triggerPriceUSD ?? 0).toFixed(4)}`],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-ink/40">{k}</span>
                    <span className="text-ink/80 font-mono">{v}</span>
                  </div>
                ))}
              </div>
              {typeof d?.note === 'string' && <p className="text-[11px] text-ink/45 leading-relaxed">{d.note}</p>}
              {/* Invariant #11 — the dry-run verdict BEFORE the wallet opens. */}
              <PreflightNotice preflight={prepared.preflight} />
              {/* Sign stays reachable while the disclosure scrolls. */}
              <div className="sticky bottom-0 -mx-6 bg-surface-1 px-6 pt-3 space-y-4">
                <button
                  onClick={sign}
                  className={`w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl transition-all ${
                    preflightSaysFail(prepared.preflight)
                      ? 'bg-ink/10 text-tone-danger border border-tone-danger/30 hover:bg-ink/15'
                      : 'bg-volt text-volt-ink hover:brightness-95 shadow-lg shadow-volt/20'
                  }`}
                >
                  {preflightSaysFail(prepared.preflight)
                    ? t('Sign anyway — the dry-run says it will fail')
                    : t('Sign in wallet')}
                </button>
                <button
                  onClick={() => { setPrepared(null); setPhase('form'); }}
                  className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
                >
                  {t('Back')}
                </button>
              </div>
            </>
          )}
          {phase === 'signing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Confirm in your wallet…')}</p>
            </div>
          )}
          {phase === 'unconfirmed' && unconfirmed && (
            <UnconfirmedSignatureNotice
              rail="evm"
              chainId={prepared?.chainId ?? 14}
              unconfirmed={unconfirmed}
              onClose={onClose}
            />
          )}
          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Borrowed — the RLUSD is in your wallet.')}
              />
              <button
                onClick={onClose}
                className="mt-1 w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Done')}
              </button>
            </div>
          )}
          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('Astryum prepares unsigned payloads and discloses every number; you sign in your own wallet. It never signs or executes on its own.')}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* POSITION CARD                                                        */
/* ------------------------------------------------------------------ */

/** R2: only facts with an EARNED label reach the card. The old skip-list
 *  dumped whatever extra keys the backend sent (iso, cToken, sharePriceE6,
 *  discoveredAt…) as raw camelCase labels — a JSON viewer inside a consumer
 *  product. Unknown extras stay in the payload, never on screen. */
function infoRows(p: DefiPosition, t: (s: string) => string): Array<{ k: string; v: string }> {
  const LABELS: Record<string, string> = {
    symbol: t('Asset'),
    apy: 'APY',
    supplyApy: 'APY',
    healthFactor: t('Health factor'),
    priceUSD: t('Price (USD)'),
    amountUSD: t('Value (USD)'),
    wallet: t('Wallet'),
  };
  const out: Array<{ k: string; v: string }> = [];
  for (const [key, raw] of Object.entries(p)) {
    const label = LABELS[key];
    if (!label || raw == null || typeof raw === 'object') continue;
    let v: string;
    if (typeof raw === 'number') v = raw.toLocaleString(undefined, { maximumFractionDigits: 4 });
    else if (/^(0x[0-9a-fA-F]{40}|r[1-9A-HJ-NP-Za-km-z]{24,34})$/.test(String(raw))) {
      const s = String(raw);
      v = `${s.slice(0, 6)}…${s.slice(-4)}`;
    } else v = String(raw);
    out.push({ k: label, v });
  }
  return out;
}

/** A Firelight queued exit (redeem done, FXRP waiting in the period queue). */
interface FirelightClaimRef {
  period: number;
  claimable: boolean;
  claimableAt: string | null;
  estFxrpBase: string | null;
}

function firelightClaimFor(p: DefiPosition): FirelightClaimRef | null {
  if (p.protocolId.toLowerCase() !== 'firelight' || p.kindUpper !== 'CLAIM') return null;
  const raw = (p.raw ?? {}) as { firelightClaim?: FirelightClaimRef };
  return raw.firelightClaim ?? null;
}

/**
 * The Claim of a queued Firelight exit — the founder's ask (2026-07-14): the
 * SAME position keeps showing the money in flight, and one click releases it
 * once the ~24h withdrawal period ends. Opens the dual-rail VaultClaimModal so
 * an exit queued from the Personal Account (0xFE, signed in Xaman) claims just
 * like a wallet-queued one — Astryum only builds the unsigned call, the OWNING
 * wallet signs.
 */
function FirelightClaimAction({
  position,
  claim,
  onChanged,
}: {
  position: DefiPosition;
  claim: FirelightClaimRef;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const raw = (position.raw ?? {}) as { token?: string };
  const est = claim.estFxrpBase != null ? Number(claim.estFxrpBase) / 1e6 : null;
  const eta = claim.claimableAt ? new Date(claim.claimableAt).toLocaleString() : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => setOpen(true)}
        disabled={!claim.claimable}
        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-warning/40 bg-tone-warning/10 text-tone-warning hover:brightness-110 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {claim.claimable
          ? `${t('Claim')}${est != null ? ` ≈${est.toLocaleString(undefined, { maximumFractionDigits: 4 })} FXRP` : ''}`
          : `${t('Claim available')} ${eta ?? ''}`}
      </button>
      {open && (
        <VaultClaimModal
          claim={{
            vault: 'firelight',
            vaultLabel: raw.token ?? 'stXRP',
            owner: position.owner,
            period: claim.period,
            claimable: claim.claimable,
            claimableAt: claim.claimableAt,
            estFxrpBase: claim.estFxrpBase,
          }}
          onClose={() => setOpen(false)}
          onChanged={() => {
            invalidatePortfolioCache();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function PositionCard({
  position,
  pair,
  rules,
  legs,
  emDebtBase,
  vaultHolders,
  paHolders,
  expanded,
  initialAction = null,
  showStrategyPanel = true,
  runsRevision = 0,
  onToggle,
  onChanged,
}: {
  position: DefiPosition;
  /** La OTRA pata de la misma estrategia (fundador 2026-08-24: «lend y borrow
   *  vienen de la misma estrategia, tienen que ser la misma card» — dos
   *  tarjetas para un carry hacían elegir a ciegas cuál cerrar). Con ella, la
   *  tarjeta pinta las dos piernas y UNA sola puerta de cierre. */
  pair?: DefiPosition;
  rules: AutomationRule[];
  /** Kinetic ISO legs of this position's account (enables the PA actions). */
  legs: PaLegs | null;
  /**
   * Deuda RLUSD viva del MISMO dueño en el mercado de Ethereum, en base units.
   * Distingue un carry entero de uno a medio abrir: colateral aportado y
   * deuda 0 es una posición que no renta nada y que hasta ahora no tenía
   * puerta para terminarse (el mismo hueco que el lend-without-borrow de
   * julio, ahora en la cadena donde el gas cuesta dinero de verdad).
   */
  emDebtBase?: string;
  /** Every wallet holding this same vault (feeds the modal's selector). */
  vaultHolders?: VaultPositionRef[];
  /** Every account with an ISO position (feeds the PA modal's selector). */
  paHolders?: PaHolder[];
  expanded: boolean;
  /** Hub deep-link: open this action's modal as soon as the card mounts. */
  initialAction?: 'withdraw' | 'harvest' | 'repay' | null;
  /** When false, the embedded MoneyFlows panel is hidden — automations live in
   *  the separate Strategy apartado (My strategies split, founder 2026-07-20). */
  showStrategyPanel?: boolean;
  /** G4-strategies — bumped on every completed rules read; see StrategyPanel. */
  runsRevision?: number;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const activeCount =
    rulesForPosition(rules, position).filter((r) => r.enabled).length +
    (pair ? rulesForPosition(rules, pair).filter((r) => r.enabled).length : 0);
  const rows = infoRows(position, t);
  const pairRows = pair ? infoRows(pair, t) : [];
  const vaultRef = vaultRefFor(position);
  const claimRef = firelightClaimFor(position);
  const ftsoRef = ftsoRefFor(position);
  // Which PA action modal is open (re-supply / withdraw / repay / derisk).
  // La operación vive en el HOST GLOBAL (operationStore, 2026-08-26):
  // navegar con ella anclada ya no la mata. `setPaAction` conserva su firma
  // — las diez puertas de la tarjeta no se tocan — pero ahora ESCRIBE la
  // intención al store en vez de montar un modal local. Sin piernas aún
  // cargadas no abre nada, como el guard del mount viejo.
  const openPaOp = useOperationStore((st) => st.openPaOp);
  const setPaAction = (kind: PaActionKind | null) => {
    if (!kind || !legs) return;
    openPaOp({ owner: position.owner, legs, holders: paHolders, action: kind, onChanged });
  };
  // W5/B7 — the Ethereum FXRP/RLUSD position's repay door (M1 pattern: the
  // nudge points here; the legs are prepared FRESH inside).
  const [emRepay, setEmRepay] = useState(false);
  // H2 — la puerta de salida (colateral FXRP fuera del mercado).
  const [emExit, setEmExit] = useState<EmExitMode | null>(null);
  // La puerta que faltaba: cancelar la posición ENTERA en una firma. El backend
  // ya sabía hacerlo (`/close/prepare`) y no había botón — el capital entraba y
  // salir era encadenar tres modales a mano.
  const [emClose, setEmClose] = useState(false);
  const isEmPosition =
    position.protocolId.toLowerCase() === 'morpho-blue' &&
    (position as { chainId?: number }).chainId === 1;
  /** La pata lend-only: prestar no se liquida y no se repaga — solo se retira. */
  const isEmLend = isEmPosition && position.kindUpper === 'LEND';
  const ownerIsSigner =
    !!evm.address && evm.address.toLowerCase() === position.owner.toLowerCase();
  /**
   * Carry a medio abrir en Ethereum: el colateral entró y el borrow no. Sin
   * este botón, la única salida era firmar OTRO `open_carry` —aportando MÁS
   * FXRP y pagando approve+supply otra vez en L1— o sacar el colateral y
   * empezar de cero. La acción `borrow` estaba construida y testeada en el
   * backend, y era inalcanzable desde la interfaz.
   */
  const emCanFinishCarry =
    isEmPosition &&
    position.kindUpper === 'COLLATERAL' &&
    BigInt(emDebtBase || '0') === BigInt(0) &&
    ownerIsSigner;
  const [vaultWithdraw, setVaultWithdraw] = useState(false);
  const [ftsoExit, setFtsoExit] = useState(false);
  const [completeBorrow, setCompleteBorrow] = useState(false);
  // Honest fallback when no in-app exit rail exists for this protocol yet.
  const [noRailInfo, setNoRailInfo] = useState(false);
  const hasDebt = !!legs?.debtUsdt0Base;
  // Half-open carry: FXRP supplied, no USDT0 debt, held by the connected EVM
  // wallet — offer to finish the missing borrow leg.
  const canCompleteBorrow =
    !!legs?.supplyFxrpBase &&
    !hasDebt &&
    !!evm.address &&
    evm.address.toLowerCase() === position.owner.toLowerCase();

  // Hub deep-link: the card already exists (collapsed) when the request
  // arrives, so open the right modal on the prop's EDGE, not at mount.
  useEffect(() => {
    if (initialAction === 'repay') {
      // The PA-repay nudge (pieza 2): the trigger only points here; the
      // payload is prepared fresh inside the modal and signed by the user.
      // Same contract for the Ethereum position (emRepay nudge, W5/B7).
      if (legs) setPaAction('repay');
      // Cinturón además del tirante de `matchesAutoAction`: sobre la pata
      // lend-only no hay deuda que repagar, y abrir ahí el modal de repago
      // sería enseñar una puerta que contesta 400.
      else if (isEmPosition && !isEmLend) setEmRepay(true);
      return;
    }
    if (initialAction !== 'withdraw') return;
    if (legs) setPaAction('withdraw');
    // La bóveda tiene su propia salida: el modal de vault genérico no la
    // conoce, y `vaultRef` es null para morpho-blue.
    else if (isEmLend) setEmExit('vault');
    else if (vaultRef) setVaultWithdraw(true);
    else setNoRailInfo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction]);

  return (
    <Card hover={!expanded} glow={expanded}>
      <button onClick={onToggle} className="w-full flex items-start justify-between text-left">
        <div className="flex items-center gap-3 min-w-0">
          {/* The generic position tile, badged with the asset actually held —
              an FXRP position must LOOK like FXRP, not like a stack of layers.
              `assetDisplay` falls back to a shortened address when a receipt
              token has no symbol; there is nothing to badge in that case. */}
          {/* LA FICHA LLEVA EL COLOR DE SU TIPO (2026-08-24). Antes todas las
              posiciones vestían el mismo cuadrado gris con el mismo icono, así
              que una lista de seis era una pared: había que LEER cada fila para
              saber cuál era colateral y cuál deuda. El color no va solo — la
              píldora con la palabra sigue al lado, como manda la casa. */}
          <div className="relative shrink-0">
            <div className={`w-11 h-11 rounded-xl grid place-items-center border ${KIND_SKIN[kindTone(position.kind)].tile}`}>
              <Layers className="w-5 h-5" />
            </div>
            {!assetDisplay(position).includes('…') && (
              <TokenLogo
                symbol={assetDisplay(position)}
                size="sm"
                className="absolute -bottom-1 -right-1 ring-2 ring-surface-1"
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-ink truncate">
                {pair ? `${assetDisplay(position)} + ${assetDisplay(pair)}` : assetDisplay(position)}
              </span>
              {pair ? (
                <Pill tone="warning">{t('Carry')}</Pill>
              ) : (
                <Pill tone={kindTone(position.kind)}>{position.label}</Pill>
              )}
            </div>
            {pair ? (
              // Las dos piernas, cada una con su palabra y su cantidad — una
              // estrategia, una tarjeta, una puerta (fundador 2026-08-24).
              <div className="text-xs text-ink/45 mt-0.5 flex items-center gap-x-2 flex-wrap">
                <span>{position.protocolId}</span>
                <span className="text-tone-success/80">
                  {t('Lend')} · {qtyDisplay(position)}
                </span>
                <span className="text-tone-danger/80">
                  {t('Borrow')} · {qtyDisplay(pair)}
                </span>
              </div>
            ) : (
              <div className="text-xs text-ink/45 mt-0.5">
                {position.protocolId} · {qtyDisplay(position)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {/* El valor, cuando el adapter lo da. Si no lo da no se enseña nada:
              esta pantalla lee `/positions`, y no todos los carriles devuelven
              precio — poner un 0 donde no hay lectura es peor que un hueco. */}
          {typeof position.amountUSD === 'number' && Number.isFinite(position.amountUSD) && (
            <span className="font-mono text-sm tabular-nums text-ink/85">
              {formatMoney(Math.abs(position.amountUSD as number))}
            </span>
          )}
          {/* G4-strategies — this counter is the ONE automation signal the
              collapsed card shows, and on /app/strategies (showStrategyPanel
              false) it is the only one the position row shows AT ALL. It was
              painted `success` (green) from `enabled` alone: three rules
              failing every fire read as «3 ⚡» in green. The count is a fact
              (three rules armed); their health is NOT — it lives in the run
              history, which this header never reads. So the count stays and
              the health claim goes. */}
          {activeCount > 0 && (
            <span title={t('Armed automations. This count does not say whether their last run worked.')}>
              <Pill tone="neutral">{activeCount} ⚡</Pill>
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-ink/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Acciones rápidas SIEMPRE visibles en Kinetic (founder 2026-07-26):
          la salida no puede vivir escondida tras el expand. Founder 2026-07-31:
          UNA sola puerta — el cierre guiado. Ya no exige deuda: sin deuda los
          pasos 1-2 se saltan y el paso 3 es la retirada con su destino. */}
      {legs && !expanded && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {/* The color IS the arrow (founder 2026-07-30) — same scheme as the
              expanded "Position actions" row: staying on Flare reads ROSE,
              going back to XRP reads BLUE, repay wears volt (urgency, not a
              direction). */}
          {SHOW_SPLIT_EXIT_ACTIONS && hasDebt && (
            <button
              onClick={() => setPaAction('repay')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-volt/40 bg-volt/10 text-volt hover:brightness-110 transition-colors"
            >
              {t('Repay now')}
            </button>
          )}
          {SHOW_SPLIT_EXIT_ACTIONS && (
            <button
              onClick={() => setPaAction('withdraw')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:brightness-110 transition-colors"
            >
              {t('Withdraw')}
            </button>
          )}
          {SHOW_SPLIT_EXIT_ACTIONS && (
            <button
              onClick={() => setPaAction('unmint')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:brightness-110 transition-colors"
            >
              {t('Convert to XRP')}
            </button>
          )}
          {/* Las dos puertas quirúrgicas del carry (fundador 2026-08-24,
              segunda pasada): pagar SOLO el préstamo, o retirar colateral si
              el precio sube — sin desmontar la estrategia entera. Solo en la
              tarjeta fusionada: en una pierna suelta la puerta única basta.
              El color es la flecha (2026-07-30): repay viste volt (urgencia),
              retirar viste rosa (se queda en Flare). */}
          {pair && hasDebt && (
            <button
              onClick={() => setPaAction('repay')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-volt/40 bg-volt/10 text-volt hover:brightness-110 transition-colors"
              title={t('Deposit the borrowed dollars back and close the loan — your collateral stays put.')}
            >
              {t('Pay off the loan')}
            </button>
          )}
          {pair && (
            <button
              onClick={() => setPaAction('withdraw')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:brightness-110 transition-colors"
              title={t('Take part of your collateral out — mind the health factor: less backing means closer to liquidation.')}
            >
              {t('Withdraw collateral')}
            </button>
          )}
          {/* El interrogante del novato (fundador 2026-08-24): una frase que
              quita el miedo a «¿cuál cierro primero?» — el paso a paso ya
              ordena las piernas solo. */}
          {pair && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-ink/45 mr-1"
              title={t('One strategy, two legs: what you lent backs what you borrowed. Closing runs in the safe order — the loan first, then your collateral — and the step-by-step does the ordering for you.')}
            >
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              {t('Two legs, one close')}
            </span>
          )}
          <button
            onClick={() => setPaAction('derisk')}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:brightness-110 transition-colors"
          >
            {t('Close the position, step by step')}
          </button>
        </div>
      )}

      {/* W5/B7 — the Ethereum position's own exit door, always visible like
          the Kinetic ones: the exit never hides behind the expand. */}
      {isEmPosition && !expanded && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {/* La pata lend-only NO se repaga ni tiene colateral: su única puerta
              es retirar. Ofrecerle «Repay now» sería enseñar botones que llevan
              a un 400. */}
          {isEmLend ? (
            <button
              onClick={() => setEmExit('vault')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/[0.04] text-ink/70 hover:bg-ink/[0.08] transition-colors"
            >
              {t('Withdraw your RLUSD')}
            </button>
          ) : (
            <>
              {/* Cerrar del todo: una firma, y el interés lo paga el propio
                  colateral sobrante. Va primero porque es lo que la gente
                  quiere hacer — repagar a medias es el caso raro. */}
              <button
                onClick={() => setEmClose(true)}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-volt/40 bg-volt/10 text-volt hover:brightness-110 transition-colors"
              >
                {t('Close it all')}
              </button>
              <button
                onClick={() => setEmRepay(true)}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/[0.04] text-ink/70 hover:bg-ink/[0.08] transition-colors"
              >
                {t('Repay now')}
              </button>
              {/* H2 — la salida existía en el backend y no tenía botón: sin esto
                  el capital entra al carril y no hay puerta para sacarlo. */}
              <button
                onClick={() => setEmExit('collateral')}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/[0.04] text-ink/70 hover:bg-ink/[0.08] transition-colors"
              >
                {t('Take collateral out')}
              </button>
              {/* El carry a medio abrir: colateral dentro, deuda 0. Rinde CERO
                  (el colateral en Morpho Blue no cobra supply rate) y hasta
                  ahora no había forma de terminarlo sin aportar más FXRP. */}
              {emCanFinishCarry && (
                <button
                  onClick={() => setEmExit('finish-carry')}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/40 bg-sky-400/10 text-sky-300 hover:brightness-110 transition-colors"
                >
                  {t('Borrow RLUSD against it')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {expanded && (
        <>
          {rows.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs mt-4">
              {rows.map(({ k, v }) => (
                <div key={k} className="flex flex-col">
                  <span className="text-[11px] text-ink/40">{k}</span>
                  <span className="text-ink/80 font-mono break-all">{v}</span>
                </div>
              ))}
              {/* La otra pierna de la misma estrategia, en la misma rejilla —
                  prefijada para que nunca se confundan las columnas. */}
              {pairRows.map(({ k, v }) => (
                <div key={`pair:${k}`} className="flex flex-col">
                  <span className="text-[11px] text-tone-danger/60">{pair!.label} · {k}</span>
                  <span className="text-ink/80 font-mono break-all">{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Net APY del carry — solo posiciones Kinetic ISO con piernas. */}
          {legs && <IsoNetApyBlock owner={position.owner} />}

          {/* Position actions — EVERY position exposes Withdraw. Kinetic uses
              the PA rails (re-supply / withdraw / repay / DERISK); the partner
              vaults use their instant-redeem rail; protocols with no in-app
              exit yet get the honest fallback. Everything prepares unsigned
              and the user signs in their own wallet. */}
          <div className="border-t border-ink/5 mt-4 pt-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[13px] font-semibold text-ink">{t('Position actions')}</span>
              <div className="flex gap-1.5 flex-wrap">
                {legs ? (
                  <>
                    {canCompleteBorrow && (
                      <button
                        onClick={() => setCompleteBorrow(true)}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-volt/40 bg-volt/10 text-volt hover:brightness-110 transition-colors"
                      >
                        {t('Complete the borrow')}
                      </button>
                    )}
                    {hasDebt && (
                      <button
                        onClick={() => setPaAction('resupply')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-success/30 bg-tone-success/10 text-tone-success hover:brightness-110 transition-colors"
                      >
                        {t('Deposit the borrowed dollars again')}
                      </button>
                    )}
                    {/* The color IS the arrow (founder 2026-07-30): staying on
                        Flare reads ROSE, going back to XRP reads BLUE — the
                        direction is understood before the label is read.
                        Founder 2026-07-31: los botones sueltos de salida
                        duermen tras SHOW_SPLIT_EXIT_ACTIONS — la única puerta
                        visible es el cierre guiado. */}
                    {SHOW_SPLIT_EXIT_ACTIONS && (
                      <button
                        onClick={() => setPaAction('withdraw')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:brightness-110 transition-colors"
                      >
                        {t('Withdraw')}
                      </button>
                    )}
                    {SHOW_SPLIT_EXIT_ACTIONS && (
                      <button
                        onClick={() => setPaAction('unmint')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:brightness-110 transition-colors"
                      >
                        {t('Convert to XRP')}
                      </button>
                    )}
                    {SHOW_SPLIT_EXIT_ACTIONS && hasDebt && (
                      <button
                        onClick={() => setPaAction('repay')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-volt/40 bg-volt/10 text-volt hover:brightness-110 transition-colors"
                      >
                        {t('Repay now')}
                      </button>
                    )}
                    <button
                      onClick={() => setPaAction('derisk')}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:brightness-110 transition-colors"
                    >
                      {t('Close the position, step by step')}
                    </button>
                  </>
                ) : claimRef ? (
                  <FirelightClaimAction position={position} claim={claimRef} onChanged={onChanged} />
                ) : (
                  <button
                    onClick={() => (vaultRef ? setVaultWithdraw(true) : ftsoRef ? setFtsoExit(true) : setNoRailInfo(true))}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-300 hover:brightness-110 transition-colors"
                  >
                    {t('Withdraw')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {showStrategyPanel && (
            <StrategyPanel
              position={position}
              rules={rules}
              autoTemplate={initialAction === 'harvest' && position.templates.includes('HARVEST') ? 'HARVEST' : null}
              runsRevision={runsRevision}
              onChanged={onChanged}
            />
          )}

          {vaultWithdraw && vaultRef && (
            <VaultWithdrawModal
              position={vaultRef}
              holders={vaultHolders}
              onClose={() => setVaultWithdraw(false)}
              onChanged={onChanged}
            />
          )}

          {ftsoExit && ftsoRef && (
            <FtsoExitModal
              position={ftsoRef}
              onClose={() => setFtsoExit(false)}
              onChanged={onChanged}
            />
          )}

          {completeBorrow && (
            <CompleteBorrowModal
              owner={position.owner}
              onClose={() => setCompleteBorrow(false)}
              onChanged={onChanged}
            />
          )}

          {noRailInfo && (
            <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
              <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm my-auto max-h-[min(90dvh,44rem)] overflow-y-auto scrollbar-thin shadow-2xl p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <h2 className="text-base font-semibold text-ink">
                    {t('Withdraw')} · {assetDisplay(position)}
                  </h2>
                  <button onClick={() => setNoRailInfo(false)} className="text-ink/40 hover:text-ink transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-ink/60 leading-relaxed">
                  {t("This position's in-app exit isn't wired yet — withdraw from the protocol's own app. Your funds are always under your wallet's control, never Astryum's.")}
                </p>
                <button
                  onClick={() => setNoRailInfo(false)}
                  className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
                >
                  {t('Done')}
                </button>
              </div>
            </ModalOverlay>
          )}
        </>
      )}

      {/* El modal de acciones PA vive a nivel de Card (no dentro de expanded):
          la tira de acciones rápidas de la card COLAPSADA también lo abre
          (founder 2026-07-26 — repagar/retirar sin expandir). */}
      {/* PaActionsModal vive en EarnOperationHost (AppShell) — montarlo aquí
          también sería una segunda copia que muere al navegar. */}

      {emRepay && (
        <EmRepayModal
          owner={position.owner}
          onClose={() => setEmRepay(false)}
          onChanged={onChanged}
        />
      )}

      {emClose && (
        <EmCloseModal
          owner={position.owner}
          onClose={() => setEmClose(false)}
          onChanged={onChanged}
        />
      )}

      {emExit && (
        <EmExitModal
          owner={position.owner}
          mode={emExit}
          onClose={() => setEmExit(null)}
          onChanged={onChanged}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* BOARD                                                                */
/* ------------------------------------------------------------------ */

export default function DefiPositionsBoard({
  autoAction = null,
  showStrategyPanel = true,
  embedded = false,
  scopeAddresses,
}: {
  autoAction?: BoardAutoAction | null;
  /** ACOTAR el barrido a estas direcciones (Portfolio 2026-09-07: con un
   *  filtro de wallet activo, el tablero seguía escaneando TODA la flota y el
   *  total quedaba mal etiquetado bajo «Wallet: X»). undefined = toda la
   *  flota, como siempre. Se acota el ESCANEO, no el render: un cero aquí es
   *  «esta wallet no tiene posiciones», no «no se pudo leer». */
  scopeAddresses?: string[];
  /** Hide each card's embedded MoneyFlows (they live in the Strategy apartado). */
  showStrategyPanel?: boolean;
  /** Mounted inside another page's own header (Portfolio's Positions tab,
   *  Earn's Positions apartado): degrade PageHeader to SectionTitle and drop
   *  the board's own Refresh button — same pattern as StrategiesPage. */
  embedded?: boolean;
}) {
  const { t } = useT();
  const wallet = useAuthStore((s) => s.user?.address) ?? null;
  // FXRP/Kinetic lives on the user's Smart Account (PA), not their EVM wallet —
  // resolve it from the connected Xaman address and scan it too.
  const xrpl = useXrplWalletPartner();
  // …and on every REGISTERED Flare wallet (including the smart-account row the
  // PA registration created): before this, positions were invisible unless
  // Xaman happened to be connected in the session — while the Estrategias hub
  // (which reads /wallets/mine) still showed them. Same list ⇒ same truth.
  const { wallets: myWallets } = useMyWallets();
  const myWalletsKey = myWallets.map((w) => w.address).join(',');
  const scopeKey = (scopeAddresses ?? []).join(',').toLowerCase();

  const [positions, setPositions] = useState<DefiPosition[]>([]);
  const [allRules, setAllRules] = useState<AutomationRule[]>([]);
  const [scanAddrs, setScanAddrs] = useState<string[]>([]);
  // Watch-only lending positions on OTHER chains (e.g. cbXRP/USDC on Morpho
  // Base — the collateral behind Coinbase's XRP-backed loans). Read-only:
  // no actions here, the Capital Map thesis is "your XRP wherever it lives".
  const [otherChains, setOtherChains] = useState<
    Array<{ protocolName: string; chainId: number; totalCollateralUSD: number; totalDebtUSD: number; healthFactor: number | null }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Direcciones cuya posición de Ethereum no se pudo leer en este barrido. */
  const [emUnreadable, setEmUnreadable] = useState<UnreadableAddr[]>([]);
  /** Direcciones cuya lectura de posiciones de FLARE falló, con su código. */
  const [flareUnreadable, setFlareUnreadable] = useState<UnreadableAddr[]>([]);
  /**
   * Ola 0 (15-sep) — protocolos que contestaron DENTRO de un HTTP 200 con un
   * `error` (adapter caído) o con `unreadable[]` (mercados/periodos sin leer).
   * Antes `flattenPositions` solo leía `positions` y esto no existía: un 429
   * en una sonda de Kinetic dejaba el carry —y su «Repay»— fuera del tablero
   * sin una frase.
   */
  const [flareProtocolUnread, setFlareProtocolUnread] = useState<FlareProtocolUnread[]>([]);
  /**
   * Una puerta de salida abierta desde el aviso de «no pude leer». Las puertas
   * de Ethereum sólo necesitan al dueño —preparan desde la cadena—, así que un
   * /position caído no puede dejar la salida sin botón (la salida jamás se gatea).
   */
  const [emDoor, setEmDoor] = useState<{ owner: string; kind: 'repay' | 'close' | 'collateral' | 'vault' } | null>(null);
  /** La pata de la boveda no contesto: un cero ahi seria indistinguible de un deposito perdido. */
  const [vaultLegUnread, setVaultLegUnread] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Hub deep-link: once positions land, expand the matching card and open its
  // action. Consumed exactly once so later polls don't re-open closed modals.
  const [pendingAuto, setPendingAuto] = useState<BoardAutoAction | null>(autoAction);
  const [autoOpenFor, setAutoOpenFor] = useState<{ key: string; action: 'withdraw' | 'harvest' | 'repay' } | null>(null);
  useEffect(() => {
    if (!pendingAuto || positions.length === 0) return;
    const hit = positions.find((p) => matchesAutoAction(pendingAuto, p));
    if (hit) {
      const key = `${hit.owner}:${hit.positionId}`;
      setExpandedId(key);
      setAutoOpenFor({ key, action: pendingAuto.action });
    }
    setPendingAuto(null);
  }, [pendingAuto, positions]);
  // URL deep-link (pieza 2): a push / the Intents card lands here with
  // ?paAction=repay&protocol=kinetic&owner=0x… and the matching card opens its
  // action modal — the PA repay is composed FRESH at act time (a 0xFE Payment
  // cannot be pre-baked at trigger time; it would expire). Read once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const act = q.get('paAction');
    if (act === 'repay' || act === 'withdraw' || act === 'harvest') {
      setPendingAuto({
        action: act,
        protocolId: q.get('protocol') ?? 'kinetic',
        owner: q.get('owner') ?? undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** All addresses that may hold this user's open DeFi positions. */
  const resolveScanAddrs = useCallback(async (): Promise<string[]> => {
    const addrs = new Map<string, string>(); // lowercase → original
    const add = (a?: string | null) => {
      if (a && /^0x[a-fA-F0-9]{40}$/.test(a)) addrs.set(a.toLowerCase(), a);
    };
    add(wallet);
    // Every registered Flare/EVM wallet — including the smart-account row.
    for (const w of myWallets) {
      if (w.chainId === 14 || (w.chainId == null && w.ecosystem?.toLowerCase() === 'evm')) add(w.address);
    }
    if (xrpl.address) {
      try {
        const r = await fetch(
          `${API_BASE}/flare-demo/personal-account?xrpl=${encodeURIComponent(xrpl.address)}`,
          { headers: authHeaders(), credentials: 'include' },
        );
        if (r.ok) {
          const b = (await r.json()) as { personalAccount?: string };
          add(b.personalAccount);
        }
      } catch {
        /* PA resolution is best-effort; EVM positions still render */
      }
    }
    const all = [...addrs.values()];
    if (!scopeAddresses || scopeAddresses.length === 0) return all;
    // El alcance manda. La Smart Account de la cuenta elegida entra también:
    // es el lado Flare de ESA misma cuenta, y esconderla ocultaría dinero
    // suyo (mismo criterio que el paFold del Portfolio).
    const want = new Set(scopeAddresses.map((a) => a.toLowerCase()));
    const narrowed = all.filter((a) => want.has(a.toLowerCase()));
    return narrowed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, xrpl.address, myWalletsKey, scopeKey]);

  // G4-strategies — every completed rules read bumps this, and the expanded
  // card's StrategyPanel re-reads GET /rules/:id/runs on it. Before, the run
  // verdict was frozen at the card's mount: a rule that started failing kept a
  // green pill until the card was collapsed. No new timer — this rides the
  // board's existing cadence (mount, focus, manual Refresh, onChanged, poll).
  const [runsRevision, setRunsRevision] = useState(0);

  const loadRules = useCallback(async (addrs: string[]) => {
    // Parallel fan-out (app/page.tsx pattern): awaiting each address in
    // sequence made load time grow linearly. Rules stay best-effort — one
    // address failing must not drop the rest.
    const results = await Promise.allSettled(addrs.map((addr) => rulesApi.list(addr)));
    const collected: AutomationRule[] = [];
    for (const res of results) {
      if (res.status !== 'fulfilled') continue; /* rules are best-effort */
      collected.push(...(res.value.rules ?? []));
    }
    // De-dup by id (an address could appear once, but be safe).
    setAllRules([...new Map(collected.map((r) => [r.id, r])).values()]);
    setRunsRevision((n) => n + 1);
  }, []);

  // Freshness guard for the focus handler below: a tab flip seconds after a
  // completed load must not refire the whole chain (the 60s poll still runs).
  const lastLoadDoneAt = useRef(0);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    // Cross-device prefills: pull any rule prefills stashed from ANOTHER
    // browser (best-effort, once per page session) before a template opens.
    void hydrateRulePrefillsFromServer();
    // Best-effort watch-only sweep of Base (8453) — Morpho cbXRP markets. It
    // only needs `wallet`, so it runs in PARALLEL with the Flare chain below.
    // A failure here never touches the Flare board.
    const baseScan = (async () => {
      try {
        const r = await fetch(
          `${API_BASE}/positions/scan?wallet=${encodeURIComponent(wallet)}&chainIds=8453`,
          { headers: authHeaders(), credentials: 'include' },
        );
        if (r.ok) {
          const b = (await r.json()) as {
            positions?: Array<{ protocolName?: string; chainId?: number; totalCollateralUSD?: number; totalDebtUSD?: number; healthFactor?: number | null }>;
          };
          setOtherChains(
            (b.positions ?? []).map((p) => ({
              protocolName: String(p.protocolName ?? '—'),
              chainId: Number(p.chainId ?? 0),
              totalCollateralUSD: Number(p.totalCollateralUSD ?? 0),
              totalDebtUSD: Number(p.totalDebtUSD ?? 0),
              healthFactor: typeof p.healthFactor === 'number' ? p.healthFactor : null,
            })),
          );
        }
      } catch {
        setOtherChains([]);
      }
    })();
    try {
      const addrs = await resolveScanAddrs();
      setScanAddrs(addrs);
      // Parallel fan-out per address (app/page.tsx pattern: awaiting each
      // wallet in sequence made load time grow linearly) — one address
      // failing must not blank the whole board.
      const positionsScan = Promise.allSettled(
        addrs.map((addr) => positionsApi.byWallet(addr)),
      ).then(async (results) => {
        // Una dirección que FALLA no es una dirección sin posiciones: se cuenta
        // con su código y el tablero lo dice (revisión 14-sep). Antes se
        // tragaba y un tablero vacío se leía como «no tengo nada».
        //
        // Ola 0 (15-sep) — y un bloque que llega en un HTTP 200 con `error`
        // o `unreadable[]` tampoco es «sin posiciones»: `reduceFlareScan`
        // (lib/positionsReadState) reparte filas, fallos HTTP y bloques
        // ilegibles; los tres se pintan.
        const scan = reduceFlareScan(results, addrs, flattenPositions);
        const all: DefiPosition[] = [...scan.rows];
        setFlareUnreadable(scan.failed);
        setFlareProtocolUnread(scan.unread);
        // H1 — the Ethereum FXRP/RLUSD position joins the board as a REAL row.
        // `/api/positions/:wallet` is Flare-only by construction, so without
        // this the chain-1 position had no row: no "Repay now" button, no
        // PROTECT_EM template — the repay door and its MoneyFlow were built
        // and unreachable. Fail-closed and best-effort: the rail's own gate
        // decides, and a failure here never blanks the Flare board.
        const em = await fetchEthMorphoRows(addrs);
        all.push(...em.rows);
        setEmUnreadable(em.unreadable);
        setVaultLegUnread(em.vaultLegUnread);
        setPositions(all);
      });
      // Rules only need the addresses, not the positions — run them alongside.
      await Promise.all([positionsScan, loadRules(addrs), baseScan]);
    } catch (e) {
      setError(translateError(e, t).message);
    } finally {
      lastLoadDoneAt.current = Date.now();
      setLoading(false);
    }
  }, [wallet, resolveScanAddrs, loadRules]);

  useEffect(() => {
    void load();
  }, [load]);

  // A refresh REPLACES the positions array, and each PositionCard owns the
  // modal opened from it — so a reload that drops a position (one scan address
  // failing is enough) unmounts the card and takes the open dialog with it.
  // That is the "the modal vanished and came back" the founder hit: the focus
  // handler below fires exactly when they return from Xaman/MetaMask. So while
  // ANY modal is open we hold the refresh and replay it on close — nothing
  // moves under a signature in progress. (Manual Refresh still always runs.)
  const openModals = useModalsOpen();
  const deferredLoad = useRef(false);

  const loadUnlessBusy = useCallback(() => {
    if (modalsOpen() > 0) {
      deferredLoad.current = true;
      return;
    }
    void load();
  }, [load]);

  useEffect(() => {
    if (openModals === 0 && deferredLoad.current) {
      deferredLoad.current = false;
      void load();
    }
  }, [openModals, load]);

  // Settlement lands minutes after the signature — refresh when the user comes
  // back to the tab so the new position appears without a manual reload.
  useEffect(() => {
    const onFocus = () => {
      // The board is already fresh (<30s since the last completed load): a
      // quick tab flip must not refire the whole chain. Settlement returns
      // still land via the 60s poll and the manual Refresh, which skip this.
      if (Date.now() - lastLoadDoneAt.current < 30_000) return;
      loadUnlessBusy();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadUnlessBusy]);

  // …and while they WAIT on this tab: a gentle poll (only when visible) so the
  // executor landing the mint/batch shows up by itself within a minute.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadUnlessBusy();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadUnlessBusy]);

  const subtitle = useMemo(
    () => t('Your open DeFi positions on Flare. Open one to add a Protect or Harvest automation — prepared for your signature, never executed automatically.'),
    [t],
  );

  if (!wallet) {
    return (
      <div>
        {embedded ? (
          <SectionTitle hint={subtitle}>{t('Open DeFi positions')}</SectionTitle>
        ) : (
          <PageHeader eyebrow="Positions" title={t('Open DeFi positions')} subtitle={subtitle} />
        )}
        {/* Finished-page empty state (founder 2026-08-22): the beacon scene
            and a real door, not a bare grey box. */}
        <SceneDoor
          scene={<SignalBeacon width={190} height={160} />}
          engraving={<SignetMark size={140} />}
          tone="gold"
          eyebrow={t('Positions')}
          title={t('Connect a wallet to view your positions')}
          desc={t('Link MetaMask on Flare Mainnet or Xaman on XRPL — your open positions load here, read-only until you sign.')}
          cta={t('Connect a wallet')}
          href="/app/wallets"
        />
      </div>
    );
  }

  return (
    <div>
      {embedded ? (
        <SectionTitle hint={subtitle} actions={<Pill tone="warning">{t('Real money · product in testing')}</Pill>}>
          {t('Your open')} {t('DeFi positions')}
        </SectionTitle>
      ) : (
        <PageHeader
          eyebrow="Positions"
          title={
            <>
              {t('Your open')} <span className="text-volt">{t('DeFi positions')}</span>
            </>
          }
          subtitle={subtitle}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => void load()}
                disabled={loading}
                title={t('Refresh positions')}
                className="p-1.5 rounded-lg border border-ink/10 bg-ink/5 text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <Pill tone="warning">{t('Real money · product in testing')}</Pill>
            </div>
          }
        />
      )}

      {loading && positions.length === 0 && <EmptyState variant="loading" title={t('Loading positions…')} />}

      {error && !loading && (
        <EmptyState
          variant="error"
          title={t('Could not load positions')}
          hint={error}
          action={
            <GhostButton onClick={() => void load()}>
              <RefreshCw className="w-3.5 h-3.5" />
              {t('Try again')}
            </GhostButton>
          }
        />
      )}

      {/* Una posición que no se pudo leer NO se calla: sin este aviso el
          tablero se pinta vacío y se lee como «no tengo nada» — y con la fila
          desaparece también su puerta de repago. Revisión 14-sep: con su razón
          REAL (un 451 de región no es «reintenta en un momento») y con las
          puertas de salida a mano, que no necesitan la fila. */}
      {!loading && emUnreadable.length > 0 && (
        <Card className="p-3.5 mb-4 border-tone-warning/30 bg-tone-warning/5">
          <div className="space-y-3">
            {emUnreadable.map(({ addr, status }) => {
              const kind = positionReadFailureKind(status);
              const doorBtn =
                'text-[11px] px-2.5 py-1 rounded-lg border border-ink/15 bg-ink/5 text-ink/75 hover:bg-ink/10 transition-colors';
              return (
                <div key={addr} className="space-y-2">
                  <p className="text-sm text-ink/75">
                    {kind === 'region'
                      ? t("Your Ethereum position couldn't be read from your region, so it isn't drawn on this board. If you have one open, it is still open on-chain — and leaving it is never blocked: the exit doors below prepare straight from the chain.")
                      : kind === 'auth'
                        ? t("Your session couldn't read your Ethereum position, so it isn't on this board. If you have one open, it's still open — sign in again to see it here.")
                        : kind === 'transient'
                          ? t("Couldn't read your Ethereum position right now, so it isn't on this board. If you have one open, it's still open — retry in a moment.")
                          : t("Couldn't read your Ethereum position, so it isn't on this board. If you have one open, it's still open.")}
                  </p>
                  <p className="text-[11px] font-mono text-ink/45">
                    {addr.slice(0, 8)}…{addr.slice(-4)} · {status != null ? `HTTP ${status}` : t('no answer')}
                  </p>
                  {kind !== 'auth' && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={doorBtn} onClick={() => setEmDoor({ owner: addr, kind: 'close' })}>
                        {t('Close the whole position')}
                      </button>
                      <button type="button" className={doorBtn} onClick={() => setEmDoor({ owner: addr, kind: 'repay' })}>
                        {t('Repay RLUSD (Ethereum)')}
                      </button>
                      <button type="button" className={doorBtn} onClick={() => setEmDoor({ owner: addr, kind: 'collateral' })}>
                        {t('Take FXRP collateral out')}
                      </button>
                      <button type="button" className={doorBtn} onClick={() => setEmDoor({ owner: addr, kind: 'vault' })}>
                        {t('Withdraw RLUSD from the vault')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {emUnreadable.some((u) => isTransientStatus(u.status)) && (
              <GhostButton onClick={() => void load()} disabled={loading}>
                <RefreshCw className="w-3.5 h-3.5" />
                {t('Try again')}
              </GhostButton>
            )}
          </div>
        </Card>
      )}

      {/* Las posiciones de FLARE de una dirección que no contestó: igual de
          «no lo sé», nunca «no tienes nada». */}
      {!loading && flareUnreadable.length > 0 && (
        <Card className="p-3.5 mb-4 border-tone-warning/30 bg-tone-warning/5">
          <p className="text-sm text-ink/75">
            {t("Couldn't read the Flare positions of some of your wallets, so they may be missing from this board. That is not the same as having none.")}
          </p>
          <p className="mt-1 text-[11px] font-mono text-ink/45">
            {flareUnreadable
              .map((u) => `${u.addr.slice(0, 8)}…${u.addr.slice(-4)} · ${u.status != null ? `HTTP ${u.status}` : t('no answer')}`)
              .join('   ')}
          </p>
          <GhostButton onClick={() => void load()} disabled={loading} className="mt-2">
            <RefreshCw className="w-3.5 h-3.5" />
            {t('Try again')}
          </GhostButton>
        </Card>
      )}

      {/* Ola 0 (15-sep) — un protocolo que el backend no pudo leer (entero,
          o un mercado/periodo suyo) dentro de un HTTP 200. Misma tarjeta
          ámbar: «no lo sé», nunca «no tienes nada». Las filas que SÍ se
          leyeron están abajo; las que faltan se nombran aquí. */}
      {!loading && flareProtocolUnread.length > 0 && (
        <Card className="p-3.5 mb-4 border-tone-warning/30 bg-tone-warning/5">
          <div className="space-y-2">
            {flareProtocolUnread.map((u) => (
              <div key={`${u.addr}:${u.protocolId}`}>
                <p className="text-sm text-ink/75">
                  {u.whole
                    ? t("Couldn't read your {protocol} positions for one of your wallets, so they aren't on this board. That is not the same as having none — if you have one open, it is still open on-chain.").replace('{protocol}', protocolWord(u.protocolId))
                    : t("Couldn't read part of your {protocol} positions for one of your wallets: the rows below are what could be read, and one or more markets are missing. That is not the same as having none there.").replace('{protocol}', protocolWord(u.protocolId))}
                </p>
                <p className="mt-1 text-[11px] font-mono text-ink/45 break-all">
                  {u.addr.slice(0, 8)}…{u.addr.slice(-4)} · {protocolWord(u.protocolId)} ·{' '}
                  {u.whole
                    ? u.reason
                    : u.reads.map((r) => (r.market ? `${r.what.replace(r.market, shortAddr(r.market))}` : r.what)).join(' · ')}
                </p>
              </div>
            ))}
            <GhostButton onClick={() => void load()} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" />
              {t('Try again')}
            </GhostButton>
          </div>
        </Card>
      )}

      {!loading && vaultLegUnread && (
        <Card className="p-3.5 mb-4 border-tone-warning/30 bg-tone-warning/5">
          <p className="text-sm text-ink/75">
            {t("Couldn't read your lend-only position in the Sentora vault just now. If you have RLUSD lent, it's still lent — retry in a moment.")}
          </p>
          <GhostButton onClick={() => void load()} disabled={loading} className="mt-2">
            <RefreshCw className="w-3.5 h-3.5" />
            {t('Try again')}
          </GhostButton>
        </Card>
      )}

      {boardShowsEmpty({
        loading,
        error,
        positionsCount: positions.length,
        unreadableCount: emUnreadable.length + flareUnreadable.length + flareProtocolUnread.length,
        vaultLegUnread,
      }) && (
        <EmptyState
          icon={<Sprout className="w-8 h-8" strokeWidth={1.5} />}
          title={t('No open DeFi positions yet')}
          hint={t('Open one from Earn (FXRP → Kinetic or FLR → FTSO), then come back to automate it.')}
        />
      )}

      {positions.length > 0 && (
        <div className="space-y-4">
          {(() => {
            /** UNA estrategia = UNA tarjeta (fundador 2026-08-24: el lend y el
             *  borrow del mismo carry en tarjetas separadas hacían elegir a
             *  ciegas cuál cerrar). Se emparejan SOLO los pares que sabemos
             *  hermanos: las piernas ISO de Kinetic del mismo dueño, y el
             *  colateral+deuda de morpho-blue (Ethereum) del mismo dueño. La
             *  pierna lend-only de Ethereum es su propio producto y no se toca.
             */
            const isSupplyKind = (p: DefiPosition) => ['SUPPLY', 'COLLATERAL', 'LEND'].includes(p.kindUpper);
            const isDebtKind = (p: DefiPosition) => ['BORROW', 'DEBT'].includes(p.kindUpper);
            const isIso = (p: DefiPosition) => (p.raw as { iso?: boolean } | undefined)?.iso === true;
            const pairableWith = (a: DefiPosition, b: DefiPosition): boolean => {
              if (a.owner !== b.owner) return false;
              const proto = a.protocolId.toLowerCase();
              if (proto !== b.protocolId.toLowerCase()) return false;
              if (proto === 'kinetic') return isIso(a) && isIso(b);
              if (proto === 'morpho-blue') {
                return (
                  (a as { chainId?: number }).chainId === 1 &&
                  (b as { chainId?: number }).chainId === 1 &&
                  a.kindUpper !== 'LEND' &&
                  b.kindUpper !== 'LEND'
                );
              }
              return false;
            };
            const idOf = (p: DefiPosition) => `${p.owner}:${p.positionId}`;
            const consumed = new Set<string>();
            const entries: Array<{ primary: DefiPosition; pairLeg?: DefiPosition }> = [];
            for (const p of positions) {
              if (consumed.has(idOf(p))) continue;
              if (isSupplyKind(p)) {
                const debt = positions.find(
                  (q) => q !== p && !consumed.has(idOf(q)) && isDebtKind(q) && pairableWith(p, q),
                );
                if (debt) {
                  consumed.add(idOf(debt));
                  entries.push({ primary: p, pairLeg: debt });
                  continue;
                }
              } else if (isDebtKind(p)) {
                const sup = positions.find(
                  (q) => q !== p && !consumed.has(idOf(q)) && isSupplyKind(q) && pairableWith(q, p),
                );
                if (sup) {
                  consumed.add(idOf(sup));
                  entries.push({ primary: sup, pairLeg: p });
                  continue;
                }
              }
              entries.push({ primary: p });
            }
            return entries;
          })().map(({ primary: p, pairLeg }, cardIdx) => (
            /* Las tarjetas LLEGAN escalonadas con el dato (Arrive, 2026-08-25)
               — antes el tablero entero se enchufaba de golpe en una página ya
               visible, que era el pop que el fundador señaló. */
            <Arrive key={`${p.owner}:${p.positionId}`} index={cardIdx}>
            <PositionCard
              position={p}
              pair={pairLeg}
              rules={allRules}
              legs={p.protocolId.toLowerCase() === 'kinetic' ? kineticLegsFor(positions, p.owner) : null}
              emDebtBase={emDebtFor(positions, p.owner)}
              vaultHolders={vaultHoldersFor(positions, p)}
              paHolders={p.protocolId.toLowerCase() === 'kinetic' ? kineticHoldersFor(positions) : undefined}
              // Los deep-links (nudge de repay, expandir) pueden apuntar a
              // CUALQUIERA de las dos patas — la tarjeta fusionada responde
              // por ambas, o el aviso del guardián moriría en un id fantasma.
              expanded={
                expandedId === `${p.owner}:${p.positionId}` ||
                (!!pairLeg && expandedId === `${pairLeg.owner}:${pairLeg.positionId}`)
              }
              initialAction={
                autoOpenFor?.key === `${p.owner}:${p.positionId}` ||
                (!!pairLeg && autoOpenFor?.key === `${pairLeg.owner}:${pairLeg.positionId}`)
                  ? autoOpenFor!.action
                  : null
              }
              showStrategyPanel={showStrategyPanel}
              runsRevision={runsRevision}
              onToggle={() => setExpandedId((id) => (id === `${p.owner}:${p.positionId}` ? null : `${p.owner}:${p.positionId}`))}
              onChanged={() => {
                // A position changed on-chain: the hub's cached portfolio is
                // stale too — drop it so the tile disappears with the position.
                invalidatePortfolioCache();
                void load();
              }}
            />
            </Arrive>
          ))}
        </div>
      )}

      {/* Watch-only: the same wallet's lending footprint on other chains —
          read on-chain via /positions/scan (Morpho cbXRP markets on Base).
          No actions: observe wide, execute narrow. */}
      {otherChains.length > 0 && (
        <div className="mt-6">
          <div className="mb-2">
            <MicroLabel>{t('Watch-only · other chains')}</MicroLabel>
          </div>
          <div className="space-y-3">
            {otherChains.map((p, i) => (
              <Card key={`${p.protocolName}:${p.chainId}:${i}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl grid place-items-center border border-ink/10 bg-ink/5 text-ink/60 shrink-0">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-ink">{p.protocolName}</span>
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border border-ink/15 bg-ink/5 text-ink/50">
                        {p.chainId === 8453 ? 'Base' : `chain ${p.chainId}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs font-mono tabular-nums">
                    <span className="text-ink/70">
                      <span className="text-ink/40 mr-1">{t('Collateral')}</span>
                      {formatMoney(p.totalCollateralUSD)}
                    </span>
                    <span className="text-ink/70">
                      <span className="text-ink/40 mr-1">{t('Debt')}</span>
                      {formatMoney(p.totalDebtUSD)}
                    </span>
                    {p.healthFactor != null && Number.isFinite(p.healthFactor) && (
                      <span className={`text-tone-${hfWord(p.healthFactor, t).tone === 'neutral' ? 'success' : hfWord(p.healthFactor, t).tone}`}>
                        {hfWord(p.healthFactor, t).label} ({p.healthFactor.toFixed(2)})
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Las puertas de salida abiertas desde el aviso de «no pude leer». */}
      {emDoor?.kind === 'repay' && (
        <EmRepayModal
          owner={emDoor.owner}
          onClose={() => setEmDoor(null)}
          onChanged={() => {
            invalidatePortfolioCache();
            void load();
          }}
        />
      )}
      {emDoor?.kind === 'close' && (
        <EmCloseModal
          owner={emDoor.owner}
          onClose={() => setEmDoor(null)}
          onChanged={() => {
            invalidatePortfolioCache();
            void load();
          }}
        />
      )}
      {emDoor && (emDoor.kind === 'collateral' || emDoor.kind === 'vault') && (
        <EmExitModal
          owner={emDoor.owner}
          mode={emDoor.kind === 'vault' ? 'vault' : 'collateral'}
          onClose={() => setEmDoor(null)}
          onChanged={() => {
            invalidatePortfolioCache();
            void load();
          }}
        />
      )}
    </div>
  );
}

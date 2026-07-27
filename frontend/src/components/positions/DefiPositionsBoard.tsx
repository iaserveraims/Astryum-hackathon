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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { Card, EmptyState, MicroLabel, PageHeader, Pill, SectionTitle } from '../ui/primitives';
import { formatMoney } from '../../lib/formatMoney';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { positions as positionsApi, rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useMyWallets } from '../../hooks/useMyWallets';
import { invalidatePortfolioCache } from '../../lib/portfolioMerge';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import {
  hydrateRulePrefillsFromServer,
  readRulePrefill,
  resolveInitialValues,
  rulePrefillScope,
} from '../../lib/automation/rulePrefill';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { canonicalizeSymbol } from '../../lib/canonicalizeSymbol';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { PaActionsModal, type PaActionKind, type PaHolder, type PaLegs } from './PaActionsModal';
import { VaultWithdrawModal, type VaultPositionRef } from './VaultWithdrawModal';
import { VaultClaimModal } from './VaultClaimModal';
import { TEMPLATES, type TemplateKind } from '../moneyflows/templateCatalog';
import { RuleEditModal } from '../moneyflows/RuleEditModal';
import { ProtectRuleCard } from '../moneyflows/ProtectRuleCard';

const API_BASE = getApiBase();

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
  // Money in flight: a Firelight redeem burned the shares and the FXRP waits
  // in the withdrawal-period queue until claimWithdraw releases it.
  CLAIM: 'Claimable',
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
function templatesFor(protocolId: string, kindUpper: string): TemplateKind[] {
  const out: TemplateKind[] = [];
  const proto = protocolId.toLowerCase();
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

/** Deep-link request from the Estrategias hub: open THIS position's action. */
export interface BoardAutoAction {
  action: 'withdraw' | 'harvest' | 'repay';
  protocolId: string;
  /** Vault/receipt name (earnXRP, MXRPY, stXRP…) when the hub row was a vault. */
  name?: string;
  /** Holding wallet, when the hub knew it. */
  owner?: string;
}

function matchesAutoAction(a: BoardAutoAction, p: DefiPosition): boolean {
  if (a.protocolId.toLowerCase() !== p.protocolId.toLowerCase()) return false;
  if (a.owner && a.owner.toLowerCase() !== p.owner.toLowerCase()) return false;
  if (a.name) {
    const raw = (p.raw ?? {}) as { token?: string; vaultName?: string };
    const names = [raw.token, raw.vaultName, p.asset, assetDisplay(p)]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    if (!names.some((n) => n === a.name!.toLowerCase())) return false;
  }
  return true;
}

function flattenPositions(data: unknown, owner: string): DefiPosition[] {
  const results = (data as { results?: Array<{ protocolId: string; positions?: RawDefiPosition[] }> })?.results ?? [];
  const out: DefiPosition[] = [];
  for (const block of results) {
    for (const p of block.positions ?? []) {
      const kindUpper = String(p.kind ?? '').toUpperCase();
      if (!DEFI_KINDS.has(kindUpper)) continue;
      const positionId = `${block.protocolId}:${p.asset}:${p.kind}`;
      out.push({
        ...p,
        protocolId: block.protocolId,
        positionId,
        owner,
        kindUpper,
        label: KIND_LABEL[kindUpper] ?? p.kind,
        templates: templatesFor(block.protocolId, kindUpper),
      });
    }
  }
  return out;
}

/**
 * The Kinetic ISO legs of one Personal Account, classified by the kToken
 * symbol carried in the raw scan (`kFXRP…`/`kUSDT0…`). Base units throughout.
 */
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

function describeRule(r: AutomationRule): string {
  const trigger = (r.trigger ?? {}) as { type?: string; threshold?: number; minUSD?: number; asset?: string };
  const action = (r.action ?? {}) as { kind?: string; params?: { mode?: string; targetHF?: number } };
  const kind = action.kind ?? 'action';
  if (trigger.type === 'HF_BELOW') {
    if (kind === 'repay' && action.params?.mode === 'restore') {
      return `When HF < ${trigger.threshold} → prepare repay to restore HF ${action.params.targetHF ?? trigger.threshold}`;
    }
    return `When HF < ${trigger.threshold} → prepare ${kind === 'repay' ? 'repay' : kind}`;
  }
  if (trigger.type === 'HF_CRITICAL') return 'When HF < 1.2 → prepare repay';
  if (trigger.type === 'REWARD_THRESHOLD') return `When rewards ≥ $${trigger.minUSD} → prepare ${kind === 'claimRewards' ? 'compound' : kind}`;
  if (trigger.type === 'LTV_ABOVE') return `When LTV > ${trigger.threshold} → prepare ${kind}`;
  if (trigger.type === 'IDLE_BALANCE') return `When idle ${trigger.asset ?? ''} > $${trigger.minUSD} → prepare ${kind}`;
  return r.name;
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
          setError(`${t('Invalid value for')} "${f.label}"`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const { trigger, action, cooldownMinutes } = tpl.build(vals, position);
      await rulesApi.create({
        walletAddress,
        chainId: 14,
        name: `${tpl.label} · ${position.asset}`,
        trigger,
        action,
        cooldownMinutes,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
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

        <div className="px-6 py-5 space-y-4">
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
          <p className="text-sm text-ink/55 leading-relaxed">{tpl.blurb}</p>

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
                    <div className="text-xs text-ink/70">{f.label}</div>
                    {f.hint && <p className="text-[10px] text-ink/35 mt-0.5">{f.hint}</p>}
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
                    {f.label}
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
                  {f.hint && <p className="text-[10px] text-ink/35 mt-1.5">{f.hint}</p>}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* INLINE STRATEGY PANEL — position + its MoneyFlows                    */
/* ------------------------------------------------------------------ */

function StrategyPanel({
  position,
  rules,
  autoTemplate = null,
  onChanged,
}: {
  position: DefiPosition;
  rules: AutomationRule[];
  /** Opens this template's modal on mount (hub deep-link, e.g. Harvest). */
  autoTemplate?: TemplateKind | null;
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
  // Trigger history per rule (GET /rules/:id/runs) — when it fired and what
  // happened, so an armed rule isn't a black box.
  const [runsByRule, setRunsByRule] = useState<Record<string, { count: number; lastAt?: string; lastStatus?: string }>>({});

  const myRules = rulesForPosition(rules, position);
  const ruleIdsKey = myRules.map((r) => r.id).join(',');

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, { count: number; lastAt?: string; lastStatus?: string }> = {};
      for (const id of ruleIdsKey.split(',').filter(Boolean)) {
        try {
          const r = await fetch(`${API_BASE}/rules/${id}/runs`, { headers: authHeaders(), credentials: 'include' });
          if (!r.ok) continue;
          const b = (await r.json()) as { count?: number; runs?: Array<{ triggeredAt?: string; status?: string }> };
          out[id] = {
            count: b.count ?? b.runs?.length ?? 0,
            lastAt: b.runs?.[0]?.triggeredAt,
            lastStatus: b.runs?.[0]?.status,
          };
        } catch {
          /* history is best-effort */
        }
      }
      if (alive) setRunsByRule(out);
    })();
    return () => {
      alive = false;
    };
  }, [ruleIdsKey]);

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
                    <div className="text-[10px] text-ink/40 truncate">{describeRule(r)}</div>
                    <div className="text-[10px] text-ink/30 truncate">
                      {runsByRule[r.id]?.count
                        ? `${runsByRule[r.id].count} ${t('triggers')} · ${t('last')} ${
                            runsByRule[r.id].lastAt ? new Date(runsByRule[r.id].lastAt!).toLocaleString() : '—'
                          }${runsByRule[r.id].lastStatus ? ` (${runsByRule[r.id].lastStatus})` : ''}`
                        : t('No triggers yet')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Pill tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? t('active') : t('paused')}</Pill>
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
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const [ratio, setRatio] = useState('0.30');
  const [targetHF, setTargetHF] = useState('1.10');
  const [phase, setPhase] = useState<'form' | 'preparing' | 'review' | 'signing' | 'done'>('form');
  const [prepared, setPrepared] = useState<E1BorrowPrepared | null>(null);
  const [error, setError] = useState('');

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
      setError((e as Error).message ?? String(e));
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setPhase('signing');
    try {
      if (!evm.isConnected || evm.address?.toLowerCase() !== owner.toLowerCase()) {
        throw new Error(t('Connect the Flare wallet that holds this position to sign.'));
      }
      const { handle } = await evm.sendIntentCalls(
        prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
      );
      settlement.track(handle, { onSettled: onChanged });
      setPhase('done');
      onChanged();
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? String(e));
      setPhase('review');
    }
  }

  const d = prepared?.disclosure;
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Complete the borrow (carry)')}</h2>
            <p className="text-xs text-ink/40 mt-0.5 font-mono">{owner.slice(0, 10)}…{owner.slice(-6)}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
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
                {t('Prepare (unsigned)')}
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
                  ['HF', Number(d?.entryHF ?? 0).toFixed(3)],
                  [t('Estimated trigger price'), `$${Number(d?.triggerPriceUSD ?? 0).toFixed(5)}`],
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
            </>
          )}
          {phase === 'signing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Confirm in your wallet…')}</p>
            </div>
          )}
          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Borrow settled — the carry is complete.')}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* POSITION CARD                                                        */
/* ------------------------------------------------------------------ */

function infoRows(p: DefiPosition): Array<{ k: string; v: string }> {
  const skip = new Set(['protocolId', 'kind', 'asset', 'amount', 'positionId', 'owner', 'kindUpper', 'label', 'templates']);
  return Object.entries(p)
    .filter(([k, v]) => !skip.has(k) && v != null && typeof v !== 'object')
    .slice(0, 6)
    .map(([k, v]) => ({ k, v: String(v) }));
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
  rules,
  legs,
  vaultHolders,
  paHolders,
  expanded,
  initialAction = null,
  showStrategyPanel = true,
  onToggle,
  onChanged,
}: {
  position: DefiPosition;
  rules: AutomationRule[];
  /** Kinetic ISO legs of this position's account (enables the PA actions). */
  legs: PaLegs | null;
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
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const activeCount = rulesForPosition(rules, position).filter((r) => r.enabled).length;
  const rows = infoRows(position);
  const vaultRef = vaultRefFor(position);
  const claimRef = firelightClaimFor(position);
  // Which PA action modal is open (re-supply / withdraw / repay / derisk).
  const [paAction, setPaAction] = useState<PaActionKind | null>(null);
  const [vaultWithdraw, setVaultWithdraw] = useState(false);
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
      if (legs) setPaAction('repay');
      return;
    }
    if (initialAction !== 'withdraw') return;
    if (legs) setPaAction('withdraw');
    else if (vaultRef) setVaultWithdraw(true);
    else setNoRailInfo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction]);

  return (
    <Card hover={!expanded} glow={expanded}>
      <button onClick={onToggle} className="w-full flex items-start justify-between text-left">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl grid place-items-center border border-ink/10 bg-ink/5 text-ink/70 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-ink truncate">{assetDisplay(position)}</span>
              <Pill tone={kindTone(position.kind)}>{position.label}</Pill>
            </div>
            <div className="text-xs text-ink/45 mt-0.5">
              {position.protocolId} · {String(position.amount)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {activeCount > 0 && <Pill tone="success">{activeCount} ⚡</Pill>}
          <ChevronDown className={`w-4 h-4 text-ink/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Acciones rápidas SIEMPRE visibles en Kinetic (founder 2026-07-26):
          repagar la deuda y liberar el colateral no pueden vivir escondidos
          tras el expand. Colapsada = la tira compacta; expandida = la fila
          completa de "Position actions" de abajo (sin duplicar). Nota de
          protocolo que el modal ya explica: el colateral FXRP solo se puede
          retirar con la deuda repagada — "Deshacer" guía ese orden. */}
      {legs && !expanded && (
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {hasDebt && (
            <button
              onClick={() => setPaAction('repay')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:brightness-110 transition-colors"
            >
              {t('Repay now')}
            </button>
          )}
          <button
            onClick={() => setPaAction('withdraw')}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-ink/70 hover:brightness-110 transition-colors"
          >
            {t('Withdraw')}
          </button>
          <button
            onClick={() => setPaAction('unmint')}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-ink/70 hover:brightness-110 transition-colors"
          >
            {t('Unmint → XRP')}
          </button>
          {hasDebt && (
            <button
              onClick={() => setPaAction('derisk')}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:brightness-110 transition-colors"
            >
              {t('Unwind (DERISK)')}
            </button>
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
                        {t('Complete the borrow (carry)')}
                      </button>
                    )}
                    {hasDebt && (
                      <button
                        onClick={() => setPaAction('resupply')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-success/30 bg-tone-success/10 text-tone-success hover:brightness-110 transition-colors"
                      >
                        {t('Re-supply (carry 2)')}
                      </button>
                    )}
                    <button
                      onClick={() => setPaAction('withdraw')}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-ink/70 hover:brightness-110 transition-colors"
                    >
                      {t('Withdraw')}
                    </button>
                    <button
                      onClick={() => setPaAction('unmint')}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-ink/70 hover:brightness-110 transition-colors"
                    >
                      {t('Unmint → XRP')}
                    </button>
                    {hasDebt && (
                      <button
                        onClick={() => setPaAction('repay')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:brightness-110 transition-colors"
                      >
                        {t('Repay now')}
                      </button>
                    )}
                    {hasDebt && (
                      <button
                        onClick={() => setPaAction('derisk')}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:brightness-110 transition-colors"
                      >
                        {t('Unwind (DERISK)')}
                      </button>
                    )}
                  </>
                ) : claimRef ? (
                  <FirelightClaimAction position={position} claim={claimRef} onChanged={onChanged} />
                ) : (
                  <button
                    onClick={() => (vaultRef ? setVaultWithdraw(true) : setNoRailInfo(true))}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-ink/70 hover:brightness-110 transition-colors"
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

          {completeBorrow && (
            <CompleteBorrowModal
              owner={position.owner}
              onClose={() => setCompleteBorrow(false)}
              onChanged={onChanged}
            />
          )}

          {noRailInfo && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
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
            </div>
          )}
        </>
      )}

      {/* El modal de acciones PA vive a nivel de Card (no dentro de expanded):
          la tira de acciones rápidas de la card COLAPSADA también lo abre
          (founder 2026-07-26 — repagar/retirar sin expandir). */}
      {paAction && legs && (
        <PaActionsModal
          owner={position.owner}
          legs={legs}
          holders={paHolders}
          action={paAction}
          onClose={() => setPaAction(null)}
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
}: {
  autoAction?: BoardAutoAction | null;
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
    return [...addrs.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, xrpl.address, myWalletsKey]);

  const loadRules = useCallback(async (addrs: string[]) => {
    const collected: AutomationRule[] = [];
    for (const addr of addrs) {
      try {
        const res = await rulesApi.list(addr);
        collected.push(...(res.rules ?? []));
      } catch {
        /* rules are best-effort */
      }
    }
    // De-dup by id (an address could appear once, but be safe).
    setAllRules([...new Map(collected.map((r) => [r.id, r])).values()]);
  }, []);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    // Cross-device prefills: pull any rule prefills stashed from ANOTHER
    // browser (best-effort, once per page session) before a template opens.
    void hydrateRulePrefillsFromServer();
    try {
      const addrs = await resolveScanAddrs();
      setScanAddrs(addrs);
      const all: DefiPosition[] = [];
      for (const addr of addrs) {
        try {
          const data = await positionsApi.byWallet(addr);
          all.push(...flattenPositions(data, addr));
        } catch {
          /* one address failing must not blank the whole board */
        }
      }
      setPositions(all);
      await loadRules(addrs);

      // Best-effort watch-only sweep of Base (8453) — Morpho cbXRP markets.
      // A failure here never touches the Flare board.
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
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet, resolveScanAddrs, loadRules]);

  useEffect(() => {
    void load();
  }, [load]);

  // Settlement lands minutes after the signature — refresh when the user comes
  // back to the tab so the new position appears without a manual reload.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // …and while they WAIT on this tab: a gentle poll (only when visible) so the
  // executor landing the mint/batch shows up by itself within a minute.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

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
        <EmptyState icon={<Layers className="w-8 h-8" strokeWidth={1.5} />} title={t('Connect a wallet to view your positions')} />
      </div>
    );
  }

  return (
    <div>
      {embedded ? (
        <SectionTitle hint={subtitle} actions={<Pill tone="warning">{t('mainnet demo')}</Pill>}>
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
              <Pill tone="warning">{t('mainnet demo')}</Pill>
            </div>
          }
        />
      )}

      {loading && positions.length === 0 && <EmptyState variant="loading" title={t('Loading positions…')} />}

      {error && !loading && (
        <EmptyState variant="error" title={t('Could not load positions')} hint={error} />
      )}

      {!loading && !error && positions.length === 0 && (
        <EmptyState
          icon={<Sprout className="w-8 h-8" strokeWidth={1.5} />}
          title={t('No open DeFi positions yet')}
          hint={t('Open one from Earn (FXRP → Kinetic or FLR → FTSO), then come back to automate it.')}
        />
      )}

      {positions.length > 0 && (
        <div className="space-y-4">
          {positions.map((p) => (
            <PositionCard
              key={`${p.owner}:${p.positionId}`}
              position={p}
              rules={allRules}
              legs={p.protocolId.toLowerCase() === 'kinetic' ? kineticLegsFor(positions, p.owner) : null}
              vaultHolders={vaultHoldersFor(positions, p)}
              paHolders={p.protocolId.toLowerCase() === 'kinetic' ? kineticHoldersFor(positions) : undefined}
              expanded={expandedId === `${p.owner}:${p.positionId}`}
              initialAction={autoOpenFor?.key === `${p.owner}:${p.positionId}` ? autoOpenFor.action : null}
              showStrategyPanel={showStrategyPanel}
              onToggle={() => setExpandedId((id) => (id === `${p.owner}:${p.positionId}` ? null : `${p.owner}:${p.positionId}`))}
              onChanged={() => {
                // A position changed on-chain: the hub's cached portfolio is
                // stale too — drop it so the tile disappears with the position.
                invalidatePortfolioCache();
                void load();
              }}
            />
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
                      <span className={p.healthFactor < 1.1 ? 'text-tone-danger' : 'text-tone-success'}>
                        HF {p.healthFactor.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Estrategias — the home of every strategy (UI reorg).
 *
 * The hub is TWO full-width horizontal shelves, sized to fill the viewport
 * without scrolling:
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { PageHeader, Card, MicroLabel, Pill, GhostButton, PrimaryButton, SegmentedControl } from '../../../components/ui/primitives';
import ManagedShelf from '../../../components/managed/ManagedShelf';
import {
  capitalSectionLabel,
  isCapitalTab,
  type CapitalTab,
} from '../../../lib/nav/capitalSection';
import { formatMoney } from '../../../lib/formatMoney';
import { Arrive, RevealGroup, RevealItem } from '../../../components/ui/motion';
import { OrbitDial } from '../../../components/ui/charts';
import { MoonScene } from '../../../components/earn/icons';
import { RegisterMark } from '../../../components/ui/skin/marks';
import { useEngraved } from '../../../stores/themeStore';
import DefiPositionsBoard, { type BoardAutoAction } from '../../../components/positions/DefiPositionsBoard';
import MoneyFlowsPanel from '../../../components/moneyflows/MoneyFlowsPanel';
import StrategySection from '../../../components/strategies/StrategySection';
import WorkingStrategiesPanel, { useStrategyGroups, type StrategyGroup } from '../../../components/strategies/WorkingStrategies';
import { VaultIcon, AssetIcon } from '../../../components/ui/StrategyIcons';
import { hfWord } from '../../../lib/healthScore';
import { fmtQtyActive } from '../../../lib/format';
import { VaultWithdrawModal, type VaultPositionRef } from '../../../components/positions/VaultWithdrawModal';
import { VaultClaimModal, type VaultClaimRef } from '../../../components/positions/VaultClaimModal';
import { type PaHolder, type PaLegs } from '../../../components/positions/PaActionsModal';
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
import { useEthMorphoHealth } from '../../../lib/earn/useEthMorphoHealth';
import { useAuthorities } from '../../../hooks/useAuthorities';
import GovernedMoneyFlows from '../../../components/legacy/GovernedMoneyFlows';
import ScheduledPaymentCard from '../../../components/moneyflows/ScheduledPaymentCard';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { applyXrplSignFailure, confirmOnLedger } from '../../../lib/xrpl/ledgerSignOutcome';
import { invalidatePortfolioCache } from '../../../lib/portfolioMerge';
import { useAggregatedPortfolio } from '../../../hooks/useAggregatedPortfolio';
import { profileIdentity } from '../../../lib/profileStore';
import { listDrafts, type StrategyDraft } from '../../../lib/strategyDrafts';
import { useT } from '../../../i18n/LanguageProvider';
import {
  UNREAD,
  isFailing,
  loadRunHealth,
  retainKnownRuns,
  type RunHealth,
  rulePillState,
  RULE_PILL_TONE,
  type RulePillState,
} from '../../../lib/rules/runHealth';
import { ModalOverlay } from '@/components/ui/ModalPortal';
// LA tarjeta compartida de protección — la misma que montan el board y Earn.
// Una sola fábrica de reglas: si cada puerta creara la suya, dos protecciones
// con el mismo nombre podrían vigilar cosas distintas.
import { ProtectRuleCard } from '../../../components/moneyflows/ProtectRuleCard';
import { walletNameResolver } from '../../../lib/walletIdentity';
import { useOperationStore } from '../../../stores/operationStore';

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
/**
 * ProtectionsHealth — LA superficie honesta de las protecciones de esta
 * pantalla, y la razón por la que esconder MoneyFlows no deja un agujero.
 */
function ProtectionsHealth() {
  const { t } = useT();
  const { wallets } = useMyWallets();
  const key = wallets.map((w) => w.address).join(',');
  const [rows, setRows] = useState<AutomationRule[]>([]);
  const [health, setHealth] = useState<Record<string, RunHealth>>({});
  const seq = useRef(0);

  useEffect(() => {
    const addrs = wallets.map((w) => w.address);
    if (addrs.length === 0) {
      setRows([]);
      return;
    }
    const mine = ++seq.current;
    void (async () => {
      const results = await Promise.allSettled(addrs.map((a) => rulesApi.list(a)));
      const collected: AutomationRule[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        collected.push(...(r.value.rules ?? []));
      }
      // Las de ahorro tienen su propio apartado más abajo; aquí van las
      // automatizaciones que vigilan una posición.
      const flows = [...new Map(collected.map((r) => [r.id, r])).values()].filter(
        (r) => (r.action as { kind?: string })?.kind !== 'escrow',
      );
      if (mine !== seq.current) return;
      setRows(flows);
      const ids = flows.map((r) => r.id);
      setHealth((prev) => retainKnownRuns(prev, ids));
      const read = await loadRunHealth(ids, (id) => rulesApi.runs(id));
      if (mine !== seq.current) return;
      setHealth(read);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const armed = rows.filter((r) => r.enabled !== false);
  if (armed.length === 0) return null;
  const broken = armed.filter((r) => isFailing(health[r.id] ?? UNREAD));

  return (
    <Arrive>
    <Card padded={false} className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MicroLabel>{t('Protections')}</MicroLabel>
        <span className="font-mono text-[13px] text-ink/85">{armed.length}</span>
        <span className="text-[12px] text-ink/45">{t('watching your positions')}</span>
        {/* El estado del CONJUNTO, por el mismo reductor compartido: la
            píldora dice «active» solo cuando la lectura lo respalda; mientras
            no se haya leído dice que no se ha leído, nunca verde. */}
        {broken.length === 0 && (() => {
          const worst = armed.reduce<RulePillState>((acc, r) => {
            const st = rulePillState(true, health[r.id] ?? UNREAD);
            return acc === 'active' ? st : acc;
          }, 'active');
          return <Pill tone={RULE_PILL_TONE[worst]}>{t(worst)}</Pill>;
        })()}
        {broken.length > 0 && <Pill tone="danger">{t('failing')} · {broken.length}</Pill>}
      </div>
      {broken.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-ink/5 pt-3">
          {broken.map((r) => (
            <li key={r.id} className="text-[12px] leading-snug text-tone-danger/90">
              {r.name || r.id}
              <span className="text-ink/45">
                {' — '}
                {(() => {
                  const h = health[r.id];
                  return h && h.state === 'failed' && h.note ? h.note : t('the engine recorded no reason');
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
    </Arrive>
  );
}

/**
 * ProtectDialog — la puerta de PROTEGER, abierta desde el health factor.
 *
 * No inventa ninguna protección: monta la MISMA tarjeta que ya crean todos los
 * caminos (ProtectRuleCard — escalera de HF, repago por % de la deuda VIVA o
 * importe fijo). Lo único que aporta es el sitio: hasta hoy esa tarjeta vivía
 * dentro del panel de estrategias de cada fila, apagado en esta pantalla, así
 * que la protección estaba a tres clics de la cifra que te dice que la
 * necesitas.
 *
 * Elegir posición cuando hay varias deudas: se pregunta, no se adivina. Poner
 * una regla sobre la posición equivocada es peor que no ponerla, porque te deja
 * creyendo que estás cubierto.
 */
function ProtectDialog({
  debts,
  onClose,
  onCreated,
}: {
  debts: { protocolId: string; asset: string; wallet: string; usd: number }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const [picked, setPicked] = useState<number | null>(debts.length === 1 ? 0 : null);
  const target = picked != null ? debts[picked] : null;
  return (
    <ModalOverlay
      onEscape={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="my-auto flex max-h-[min(90dvh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-tone-success/30 bg-tone-success/10 text-tone-success">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.7} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">{t('Protect this position')}</h2>
              <p className="mt-0.5 text-xs text-ink/45">
                {t('A watch that repays for you before liquidation — you sign every move.')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 transition-colors hover:text-ink" aria-label={t('Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {target ? (
            <>
              {debts.length > 1 && (
                <button
                  onClick={() => setPicked(null)}
                  className="inline-flex items-center gap-1.5 text-[12px] text-ink/45 transition-colors hover:text-ink"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> {t('Choose another position')}
                </button>
              )}
              <ProtectRuleCard
                walletAddress={target.wallet}
                protocolId={target.protocolId}
                assetLabel={target.asset}
                onCreated={() => {
                  onCreated();
                  onClose();
                }}
              />
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-ink/60">
                {t('Which position do you want to watch?')}
              </p>
              <div className="space-y-2">
                {debts.map((d, i) => (
                  <button
                    key={`${d.protocolId}:${d.asset}:${d.wallet}`}
                    onClick={() => setPicked(i)}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] px-3.5 py-3 text-left transition-colors hover:border-tone-success/30 hover:bg-tone-success/[0.06]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink/85 capitalize">{d.protocolId}</span>
                      <span className="block text-[11px] text-ink/45">{d.asset}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[13px] text-ink/75">{formatMoney(d.usd)}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink/30" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

function HealthStrip() {
  const { t } = useT();
  const address = useAuthStore((s) => s.user?.address);
  // Shared reactive store — instant on navigation, refreshes invisibly.
  const { data, loading, error: err } = useAggregatedPortfolio();
  const snap = data?.risk ?? null;
  // El snapshot agregado NO tiene adapter para morpho-blue: con una deuda viva
  // en Ethereum llegaba `healthFactor: null` y la rama de abajo declaraba «sin
  // riesgo de liquidación». El carril se lee por su propia puerta y entra aquí.
  const { wallets: myWallets } = useMyWallets();
  const emAddrs = useMemo(
    () => {
      const out = new Set<string>();
      if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) out.add(address);
      for (const w of myWallets ?? []) {
        if (/^0x[a-fA-F0-9]{40}$/.test(w.address ?? '')) out.add(w.address);
      }
      return [...out];
    },
    [address, myWallets],
  );
  const em = useEthMorphoHealth(emAddrs);
  const [protectOpen, setProtectOpen] = useState(false);

  /** Las posiciones con deuda ABIERTA, del mismo agregado que ya se lee arriba
   *  — son las únicas que una protección puede vigilar. Sin deuda no hay nada
   *  que proteger, y el botón no aparece: ofrecer una puerta que no lleva a
   *  ningún sitio es peor que no ofrecerla. */
  const debts = useMemo(() => {
    const out: { protocolId: string; asset: string; wallet: string; usd: number }[] = [];
    for (const pos of data?.snap?.positions ?? []) {
      const kind = String(pos.kind ?? '').toLowerCase();
      if (kind !== 'debt' && kind !== 'borrow') continue;
      const usd = Math.abs(typeof pos.amountUSD === 'number' ? pos.amountUSD : 0);
      if (usd <= 0.01) continue;
      const wallet = typeof pos.wallet === 'string' ? pos.wallet : data?.snap?.wallet;
      if (!wallet || wallet === 'all') continue;
      out.push({ protocolId: pos.protocolId, asset: String(pos.asset ?? ''), wallet, usd });
    }
    return out.sort((a, b) => b.usd - a.usd);
  }, [data]);

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
  // El peor de los dos mundos manda: la cartera agregada (Flare) y el carril de
  // Ethereum. Nunca el más bonito.
  const snapHf = snap?.healthFactor ?? null;
  const hf =
    snapHf != null && em.healthFactor != null ? Math.min(snapHf, em.healthFactor)
      : snapHf != null ? snapHf
      : em.healthFactor;

  if (hf == null) {
    // Sin número no se afirma nada. Se dice qué se ha mirado y qué no: decir
    // «no tienes riesgo» sobre una lectura que falló hace que dejes de mirar,
    // y eso es peor que un error, porque el error se reintenta.
    //
    // `em.loading` cuenta como «no lo sé» y no como «no hay»: en el primer
    // pintado la lectura de Ethereum sigue EN VUELO, y sin esta condición la
    // tira afirmaba «sin riesgo de liquidación» durante ese hueco — con la
    // deuda ahí, solo que aún sin leer. Es la afirmación absoluta la que no
    // puede salir; una frase honesta mientras carga, sí.
    return (
      <Card className="p-4">
        <p className="text-sm text-ink/60">
          {em.loading
            ? t('No debt to watch on the chains we could read — still reading Ethereum…')
            : em.unknown
            ? t("No debt to watch on the chains we could read — but one position couldn't be read just now, so this isn't the full picture.")
            : t('No debt to watch — your active strategies have no liquidation risk.')}
        </p>
      </Card>
    );
  }

  const w = healthWord(hf, t);
  /** El HF que se enseña viene del snapshot ⇒ sus detalles acompañan. */
  const showsSnapDetail = snapHf != null && hf === snapHf;
  // Price drop to HF=1: at liquidation price_liq = price_now / HF ⇒ drop = (1 − 1/HF).
  const dropPct = Math.max(0, (1 - 1 / hf) * 100);
  // The protection buffer as an orbit: how far your capital sits from liquidation.
  const buffer = Math.min(100, Math.round(dropPct));

  return (
    /* La tarjeta LLEGA cuando el dato sustituye al esqueleto. */
    <Arrive>
    <Card spotlight padded={false} className="relative overflow-hidden">
      {protectOpen && (
        <ProtectDialog
          debts={debts}
          onClose={() => setProtectOpen(false)}
          onCreated={() => invalidatePortfolioCache()}
        />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 p-5 md:p-6">
        <div className="flex-1 min-w-0">
          {/* EL VEREDICTO, a tamaño de veredicto. Era una frase de
              14px con un icono al lado; ahora la palabra que resume tu riesgo
              se lee primero y el resto la explica. El escudo LATE mientras haya
              deuda viva: hay algo que vigilar y la pantalla lo dice sin
              escribir una palabra más. */}
          <div className="flex items-center gap-3">
            <span
              className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${w.tone} ${
                debts.length > 0 ? 'live-beat' : ''
              }`}
              style={{ borderColor: 'currentColor', background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
            >
              <ShieldCheck className="relative h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink/40">
                {t('Your position is')}
              </div>
              <div className={`text-[19px] font-semibold leading-tight tracking-tight ${w.tone}`}>{w.label}</div>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink/70">
            {t("you're protected if the price falls about")}{' '}
            <span className="font-mono font-medium text-ink/90">{dropPct.toFixed(0)}%</span>.
          </p>
          {/* Estas tres lecturas son del snapshot de cartera. Solo se enseñan
              cuando el HF que manda ES el suyo: colgar el precio de liquidación
              de Flare debajo de un HF que viene de Ethereum sería mezclar dos
              posiciones distintas en la misma frase. */}
          {showsSnapDetail && snap?.liquidationPriceUSD != null && (
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
            {showsSnapDetail && snap?.ltv != null && (
              <Reading label="LTV">
                <span className="font-mono text-ink/85">{(snap.ltv * 100).toFixed(1)}%</span>
              </Reading>
            )}
            {showsSnapDetail && snap?.liquidationDistanceUSD != null && (
              <Reading label={t('Distance')}>
                <span className="font-mono text-ink/85">${snap.liquidationDistanceUSD.toFixed(0)}</span>
              </Reading>
            )}
          </div>

          {/* LA PUERTA DE PROTEGER, pegada a la cifra que la justifica.
              Sale solo cuando hay deuda que vigilar: sin
              posición abierta no protege nada, y una puerta que no lleva a
              ningún sitio es peor que ninguna puerta. Lo que abre es la MISMA
              tarjeta que crea el resto de la app — escalera de HF y repago por
              porcentaje de la deuda viva — así que ninguna protección nace de
              una fábrica distinta. */}
          {debts.length > 0 && (
            <button
              onClick={() => setProtectOpen(true)}
              className="group mt-5 inline-flex items-center gap-2 overflow-hidden rounded-xl border border-tone-success/35 bg-tone-success/[0.08] px-4 py-2.5 text-[13px] font-medium text-tone-success transition-colors hover:bg-tone-success/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-success/40"
            >
              <ShieldCheck className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110" strokeWidth={1.8} />
              {t('Protect this position')}
              <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </button>
          )}
          {(em.unknown || em.loading) && (
            <p className="text-xs text-tone-warning mt-3">
              {em.loading
                ? t('Still reading Ethereum — this reading may not be your worst yet.')
                : t("One position couldn't be read just now — this reading may not be your worst.")}
            </p>
          )}
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
    </Arrive>
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
  // G4-strategies — last run per rule id, READ from GET /rules/:id/runs.
  // `ActiveSavings` below used to pin a green «active» pill on every enabled
  // rule; the verdict now travels with the rules so it cannot. Every rule gets
  // an entry, INCLUDING the ones whose read failed: an absent entry is
  // indistinguishable from "healthy". The seq guard drops the answer of a
  // superseded refresh, and we never wipe the map (that flashed a rule already
  // known to be failing back to green once per refresh).
  const [runHealth, setRunHealth] = useState<Record<string, RunHealth>>({});
  const runsSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) {
      setEscrows([]);
      setRules([]);
      setRunHealth({});
      return;
    }
    const [esc, rl] = await Promise.allSettled([xrplSavings.escrows(address), rulesApi.list(address)]);
    if (esc.status === 'fulfilled') setEscrows(esc.value.escrows);
    if (rl.status === 'fulfilled') {
      const rows = rl.value.rules.filter((r) => (r.action as { kind?: string })?.kind === 'escrow');
      setRules(rows);
      // Read AFTER the rows are on screen (fire and forget): a slow /runs must
      // never delay the list. One read per mount/refresh, never a poll.
      const ruleIds = rows.map((r) => r.id);
      const seq = ++runsSeq.current;
      setRunHealth((prev) => retainKnownRuns(prev, ruleIds));
      void (async () => {
        const health = await loadRunHealth(ruleIds, (id) => rulesApi.runs(id));
        if (seq !== runsSeq.current) return;
        setRunHealth(health);
      })();
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { escrows, rules, runHealth, refresh };
}

/**
 * Withdraw of an XRPL savings escrow = the permissionless EscrowFinish after
 * FinishAfter (same flow as Movements): prepare unsigned → the user signs in
 * Xaman. Available both from the hub preview and inside Running · Online.
 */
/** `busyId` while a release is unconfirmed: disables every Withdraw, spins none. */
const UNCONFIRMED_RELEASE = '__unconfirmed-release__';

function useEscrowRelease(onDone: () => void) {
  const { t } = useT();
  const { address, sendIntent } = useXrplWalletPartner();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // A release that went to Xaman and whose ending we could not read: it may
  // already be on the ledger, so no Withdraw is offered again on this page
  // (until it reloads) and the warning line says why, with the hash to check.
  const [unconfirmed, setUnconfirmed] = useState<{ txHash?: string; trace: string | null } | null>(null);

  const release = useCallback(
    async (row: XrplEscrowRow) => {
      if (!address || !row.owner || !row.previousTxnID || unconfirmed) return;
      setBusyId(row.previousTxnID);
      setError('');
      let handedToPartner = false;
      try {
        const h = await xrplSavings.prepareFinish({
          account: address,
          owner: row.owner,
          previousTxnID: row.previousTxnID,
          region: getUserRegion() ?? undefined,
        });
        handedToPartner = true;
        const { txHash } = await sendIntent({ tx: h.xrplTx as never });
        // «Signed» is Xaman's word: onDone only after a validated tesSUCCESS.
        await confirmOnLedger(txHash);
        onDone();
      } catch (err) {
        if (!handedToPartner) {
          // The prepare refused: nothing reached Xaman.
          setError((err as Error)?.message ?? t('Something went wrong.'));
          return;
        }
        const action = applyXrplSignFailure(err, handedToPartner, t, {
          setError,
          setUnconfirmed,
          setPhase: () => {},
        });
        if (action.view === 'form') {
          // Validated with a failure — Finish is permissionless, someone may
          // have released it first; the XRP always ends at its destination.
          setError(`${action.message} — ${t('it may already have been released (anyone can, after the unlock date); the XRP always ends at its destination.')}`);
        } else if (action.view === 'unconfirmed') {
          setError(
            `${t('The transaction went to Xaman and we could not confirm how it ended. Do NOT sign it again — it may already be on the ledger. Check the hash and your account history first.')}${action.txHash ? ` ${action.txHash}` : ''}`,
          );
          // Re-read: if it did validate, the escrow leaves the list by itself.
          onDone();
        }
      } finally {
        setBusyId(null);
      }
    },
    [address, unconfirmed, sendIntent, onDone, t],
  );

  return { release, busyId: busyId ?? (unconfirmed ? UNCONFIRMED_RELEASE : null), error };
}

/** Active savings inside Funcionando · Online — locked escrows + enabled rules.
 *  A releasable escrow gets its Withdraw right here (EscrowFinish in Xaman). */
function ActiveSavings({
  escrows,
  rules,
  runHealth,
  onRelease,
  releasingId,
  releaseError,
}: {
  escrows: XrplEscrowRow[];
  rules: AutomationRule[];
  /**
   * G4-strategies — the verdict of each rule's LAST fire, read from
   * GET /rules/:id/runs. WHAT WAS FAILING IN SILENCE: this card pinned
   * `<Pill tone="success">{t('active')}</Pill>` and a live-coloured bolt on
   * EVERY enabled rule, with no reading of what its fires produced. An escrow
   * rule that errors on every fire keeps `enabled: true`, gets no push and
   * never increments `totalTimesTriggered` (the "exito no ganado" guard), so
   * it sat here in green under the heading «Active savings» — on the very
   * page dedicated to strategies.
   */
  runHealth: Record<string, RunHealth>;
  onRelease: (row: XrplEscrowRow) => void;
  releasingId: string | null;
  releaseError: string;
}) {
  const { t } = useT();
  const router = useRouter();
  // En la lámina, el registro reglado: lo que quedó apartado está ASENTADO.
  const engraved = useEngraved();
  if (escrows.length === 0 && rules.length === 0) return null;
  return (
    <Card spotlight padded={false} className="relative overflow-hidden">
      {/* capital resting in shadow until its unlock date — the Movements moon */}
      <div className="pointer-events-none absolute -right-5 -top-7 hidden sm:block opacity-[0.22]">
        {engraved ? <RegisterMark size={150} /> : <MoonScene size={150} />}
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
        {rules.map((rule) => {
          // G4-strategies — an enabled rule whose LAST fire errored is not
          // «active»: it is armed and reminding nobody.
          const health = runHealth[rule.id] ?? UNREAD;
          const failing = isFailing(health);
          // G4 — la séptima superficie. Las otras seis ya reparten por
          // `rulePillState`; esta se quedó con `isFailing`, que es FALSO para
          // `unread` y `unreadable` ⇒ verde «active» en el primer pintado y
          // tras cualquier timeout de /runs. Y en la MISMA fila ya se imprimía
          // el descargo ámbar de «no pudimos leer»: el desmentido y la mentira
          // juntos. Verde exige ahora una lista de disparos leída de verdad.
          const pill = rulePillState(rule.enabled !== false, health);
          return (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Zap
                size={14}
                className={
                  pill === 'failing'
                    ? 'text-tone-danger'
                    : pill === 'unreadable'
                      ? 'text-tone-warning'
                      : pill === 'active'
                        ? 'text-volt'
                        : 'text-ink/40'
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{rule.name}</span>
                {health.state === 'failed' && (
                  <span className="block text-[11px] text-tone-danger">
                    {t('Its last run FAILED — this rule is armed but it produced nothing to sign.')}
                  </span>
                )}
                {health.state === 'unreadable' && (
                  <span className="block text-[11px] text-tone-warning" title={health.detail}>
                    {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
                  </span>
                )}
              </span>
              <span className="ml-auto">
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
              </span>
            </li>
          );
        })}
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

// TWO switches, and only ONE of them is on screen (both, from two
// different edits that landed the same day — read them together):
//   · CapitalTab (outer, VISIBLE) — WHAT KIND of thing: run by you, or run by
//     a manager. Lives in lib/nav/capitalSection.ts because the nav reads it
//     too. Uses SegmentedControl, the canonical selected-state language.
//   · ShelfView  (inner, HIDDEN)  — the STATE of your own things: running or
//     saved. Its buttons were retired when MoneyFlows left the page (see the
//     note at the shelves): without that apartado, "Guardadas" was the
//     inventory of what is NOT happening, and this screen is about what IS.
//     The state stays pinned to 'online' and the offline shelf stays mounted
//     below — hiding is not deleting.
// So there is no two-controls-at-two-sizes problem to solve today. If the
// inner switch ever comes back, it must NOT look like the outer one: same
// treatment at two levels reads as one broken control.
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
  const { t, lang } = useT();
  const router = useRouter();
  const [view, setView] = useState<ShelfView>('online');

  // The outer tab. Embedded inside Earn there is no tab row at all (that embed
  // is inert since the section got its own nav row, but the prop is preserved
  // — nothing built gets deleted), so it stays pinned to the strategies side.
  const [tab, setTab] = useState<CapitalTab>('strategies');
  // ABIERTA PARA TODOS. Estuvo un dia tras isAdmin, y
  // dejo de tener sentido en cuanto la puerta de Earn se publico: un usuario
  // podia leer como funciona una boveda con gestor y no tener donde ver la
  // suya. Embebida dentro de Earn no hay barra (ese embed esta inerte desde
  // que la seccion recupero su fila del menu, pero la prop se conserva).
  // Managed vaults ya NO es una pestaña aparte: sus posiciones viven DENTRO de Strategies, como un
  // apartado más. Sin conmutador → siempre la sección de strategies.
  const showTabs = false;
  const activeTab: CapitalTab = 'strategies';
  void tab;

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
  const { escrows, rules, runHealth: savingsRunHealth, refresh: refreshSavings } = useSavingsStrategies();
  const activeRules = rules.filter((r) => r.enabled);
  const pausedRules = rules.filter((r) => !r.enabled);

  // A COUNCIL account: the SAME page renders, but capital moves by council ORDER
  // through the cage — so the cage's strategy cards open the governed composer
  // (quorum signs, FDC proves, the vault executes) instead of the personal
  // withdraw rails, and MoneyFlows swap for the governed surface.
  const { activeGoverned } = useAuthorities();
  const cageGroups = activeGoverned
    ? (groups ?? []).filter((g) => g.wallet === activeGoverned.address)
    : [];
  const openCageOp = useOperationStore((st) => st.openCageOp);

  // Hub → board deep-link: which position's action to open on entering Online.
  const [autoAction, setAutoAction] = useState<BoardAutoAction | null>(null);
  const { release: releaseEscrow, busyId: releasingId, error: releaseError } = useEscrowRelease(() =>
    void refreshSavings(),
  );

  // Withdraw works DIRECTLY from the hub: the modal opens here, over the
  // shelves. XRPL-read strategies resolve their Smart Account first.
  const { wallets: myWallets } = useMyWallets();
  // LA regla canónica — ver WorkingStrategies: nunca la
  // dirección como nombre de una wallet propia.
  const walletNameOf = useMemo(() => walletNameResolver(myWallets, t), [myWallets, t]);
  const aliasFor = useCallback(
    (addr?: string) => (addr ? walletNameOf(addr) : undefined),
    [walletNameOf],
  );
  type HubModal =
    | { kind: 'vault'; ref: VaultPositionRef; holders?: VaultPositionRef[] }
    | { kind: 'kinetic'; owner: string; legs: PaLegs; holders?: PaHolder[] }
    | { kind: 'claim'; ref: VaultClaimRef }
    | { kind: 'norail'; name: string };
  const [hubModal, setHubModal] = useState<HubModal | null>(null);
  const openPaOp = useOperationStore((st) => st.openPaOp);
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
          openPaOp({
            owner: holder,
            legs: kineticLegsFromGroup(g),
            holders: [{ owner: holder, legs: kineticLegsFromGroup(g) }, ...kinHolders],
            action: 'withdraw',
            onChanged: refreshStrategies,
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

  // Deep-link contract: /app/strategies?tab=strategies|managed&view=online|offline
  // — `view` picks the inner shelf (used by Earn's manual builder, "view it in
  // Estrategias"), `tab` picks the outer one. Both are cleaned from the URL so
  // a refresh lands where the user actually is. Two independent reads: a link
  // that only carries `view` must not reset the tab, and vice versa.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = new URLSearchParams(window.location.search);
    const wantedView = qs.get('view');
    const wantedTab = qs.get('tab');
    const hasView = wantedView === 'online' || wantedView === 'offline';
    const hasTab = isCapitalTab(wantedTab);
    if (!hasView && !hasTab) return;
    if (hasView) setView(wantedView);
    if (hasTab) setTab(wantedTab);
    qs.delete('view');
    qs.delete('tab');
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

  // ── The two shelves became one segmented toggle: the
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
        {/* Embedded inside Earn: Earn's own header + back
            row give the context, so the page header would be a double title. */}
        {!embedded && (
          <div className="flex-none">
            {/* The title is the SECTION's name, read from lib/nav/capitalSection.ts
                so the nav row and this header can never disagree — and so the
                rename stays one edit. The old pair stuttered (eyebrow
                "Strategies" over title "My strategies"); the possessive is gone
                because no other destination has one: in a personal dashboard
                every screen is yours, and "My" only earned its keep back when
                this was a CARD inside Earn that had to tell itself apart from
                the catalogue. */}
            <PageHeader
              eyebrow={t('Your registry')}
              title={capitalSectionLabel(lang)}
              subtitle={t('Everything in one place — the ones running now and the ones you saved.')}
            />
          </div>
        )}

        {showTabs && (
          <div className="flex-none mb-4">
            <SegmentedControl<CapitalTab>
              layoutId="capital-tab-pill"
              className="overflow-x-auto scrollbar-hide"
              value={activeTab}
              onChange={setTab}
              options={[
                { key: 'strategies', label: t('Strategies') },
                { key: 'managed', label: t('Managed vaults') },
              ]}
            />
          </div>
        )}

        {/* ── The strategies tab: everything YOU run. The body below is the
            page as it already was — the outer tab only decides whether it is
            on screen, and deliberately changed nothing inside it. ── */}
        {activeTab === 'strategies' && (
          <>
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
        {/* EL CONMUTADOR Funcionando/Guardadas SE ESCONDE. Sin el apartado de MoneyFlows, el estante Guardadas
            se quedaba con los borradores y las reglas en pausa — el inventario
            de lo que NO está pasando — y esta pantalla trata de lo que SÍ.
        { *
            El estante offline sigue montado y entero más abajo (`view` nunca
            sale de 'online'): esconder no es borrar, y el día que vuelva basta
            con devolver estos botones. */}

        <RevealGroup className="space-y-6">
          {view === 'online' && (
            <>
              <RevealItem>
                <HealthStrip />
              </RevealItem>

              {/* La salud de las protecciones, pegada al factor que las
                  justifica: es LA superficie honesta de reglas de esta página
                  desde que MoneyFlows se escondió. */}
              <RevealItem>
                <ProtectionsHealth />
              </RevealItem>

              {/* Apartado 1 — DeFi positions (protocols + capital). The embedded
                  MoneyFlows are hidden here: automations live in the Strategy
                  apartado below (My strategies split, founder). */}
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
                          <PrimaryButton onClick={() => activeGoverned && openCageOp({ account: activeGoverned.address, vaultTitle: g.name })}>
                            {t('Move capital')} <ArrowRight size={14} />
                          </PrimaryButton>
                        </div>
                      </Card>
                    ))}
                  </div>
                </RevealItem>
              )}

              {/* Managed vaults — el capital que un TERCERO gestiona dentro de
                  los límites que firmaste (Producto A). Va DENTRO de Strategies,
                  como un apartado más, no en pestaña aparte.
                  Solo aparece si tienes shares en algún pote — y las busca en
                  TODAS tus wallets y en la Personal Account de cada XRPL. */}
              <RevealItem>
                <ManagedShelf />
              </RevealItem>

              {/* APARTADO DE MONEYFLOWS ESCONDIDO. El
                  motor sigue intacto y las reglas siguen corriendo: lo que se
                  retira es su escaparate en esta pantalla. La protección —que
                  ES una MoneyFlow— entra ahora por su propia puerta, arriba,
                  al lado del health factor, que es donde el usuario la
                  necesita. StrategySection y GovernedMoneyFlows quedan
                  montados y sin tocar para el día que vuelva. */}

              {/* PAGO RECURRENTE ESCONDIDO. Mismo trato: el carril vive,
                  la tarjeta no se enseña. ScheduledPaymentCard sigue entera en
                  components/moneyflows. */}

              {/* Active savings — locked escrows + enabled rules */}
              <RevealItem>
                <ActiveSavings
                  escrows={escrows}
                  rules={activeRules}
                  runHealth={savingsRunHealth}
                  onRelease={(row) => void releaseEscrow(row)}
                  releasingId={releasingId}
                  releaseError={releaseError}
                />
              </RevealItem>
            </>
          )}

          {view === 'offline' && (
            <>
              {/* Offline has only the Strategy apartado:
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
          </>
        )}


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
        {/* La retirada Kinetic abre por el HOST GLOBAL (operationStore) —
            así sobrevive a la navegación con el panel anclado. */}
        {/* La orden de consejo abre por el HOST GLOBAL (operationStore,):
            ancla, minimiza y sobrevive a la navegación como el
            resto de operaciones. */}

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

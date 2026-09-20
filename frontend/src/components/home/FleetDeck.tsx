'use client';

/**
 * ⚠️ UNMOUNTED. The Summary went
 * back to its own composition — hero · band · two rings in one viewport — and
 * the band that lists the fleet is now components/dashboard/FleetBand.tsx:
 * same enriched rows and the same doors, split Personal | Legacy, where
 * picking re-scopes the figures instead of flipping the product.
 */

import { useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Landmark, PenLine, Plus, ShieldCheck, ShieldPlus, Users, Wallet as WalletIcon } from 'lucide-react';
import { Card, Pill } from '@/components/ui/primitives';
import { StructureFacts } from '@/components/legacy/StructuresBand';
import { headlineLabel, healthTone } from '@/components/legacy/MyLegaciesList';
import { RevealGroup, RevealItem } from '@/components/ui/motion';
import { TokenLogo } from '@/components/ui/TokenLogo';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import XamanAvatar from '@/components/wallet/XamanAvatar';
import { useXamanHues } from '@/lib/wallet/xamanHues';
import { useT } from '@/i18n/LanguageProvider';
import { useMyWallets } from '@/hooks/useMyWallets';
import { useAuthorities } from '@/hooks/useAuthorities';
import { useAuthorityAccount } from '@/lib/authority/useAuthorityAccount';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/lib/demoMode';
import { OVERVIEW_AUTHORITY_ID, addressKey } from '@/lib/authority';
import { reinforcedPersonalKeys } from '@/lib/authority/personalQuorum';
import { walletHoldings, type WalletHolding } from '@/lib/portfolioMerge';
import { useScopedFleet, useAggregatedFor } from '@/hooks/useFleetScope';
import { useEthMorphoHealth } from '@/lib/earn/useEthMorphoHealth';
import { positionState } from '@/lib/positionKinds';
import { healthScoreFromHF, healthWords, healthTone as scoreTone } from '@/lib/healthScore';
import type { PortfolioSnapshot, RiskSnapshot } from '@/services/v1Api';
import { usePaFold, foldKey, isSmartAccountType } from '@/lib/wallet/paFold';
import { SmartAccountBadge } from '@/components/wallet/SmartAccountBadge';
import { brandOf, isXrplWallet, usesXamanAvatar, walletColor, walletDisplayName, walletIcon } from '@/lib/walletIdentity';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { useBalanceVisibility } from '@/stores/balanceVisibilityStore';
import { useOperationStore } from '@/stores/operationStore';

// ── What the capital in a wallet is DOING ────────────────────────────────────
// The meter's numbers, read through the SHARED classifier (lib/positionKinds)
// so this row and the Portfolio ring can never disagree about what "working"
// means — including the CLAIM kind, money already leaving a venue, which is
// neither working nor idle. The denominator is the wallet's ASSETS: open debt
// is excluded, exactly as positionKinds prescribes.
function capitalMix(snap: PortfolioSnapshot): {
  assetsUSD: number;
  earningPct: number;
  inflightPct: number;
} {
  let earning = 0;
  let inflight = 0;
  let assets = 0;
  for (const p of snap.positions) {
    const state = positionState(p);
    if (state === 'debt') continue;
    const usd = Math.abs(typeof p.amountUSD === 'number' ? p.amountUSD : 0);
    if (usd <= 0.01) continue;
    assets += usd;
    if (state === 'earning') earning += usd;
    else if (state === 'inflight') inflight += usd;
  }
  if (assets <= 0) return { assetsUSD: 0, earningPct: 0, inflightPct: 0 };
  return { assetsUSD: assets, earningPct: (earning / assets) * 100, inflightPct: (inflight / assets) * 100 };
}

// ── The capital meter ────────────────────────────────────────────────────────
// Two fills over a recessive track: working, in flight, and whatever is left
// is money sitting still. Thin, rounded ends, a 2px SURFACE GAP between
// segments (never a border), and the value always carried by a direct label
// beside the bar, never by colour alone (dataviz spec — see the retired
// band's notes at 7d0e202 for the CVD validation).
function CapitalMeter({ earningPct, inflightPct }: { earningPct: number; inflightPct: number }) {
  const e = Math.max(0, Math.min(100, earningPct));
  const f = Math.max(0, Math.min(100 - e, inflightPct));
  return (
    <span className="relative block h-1.5 w-full rounded-full bg-ink/[0.07]" aria-hidden>
      {e > 0.5 && (
        <span className="absolute inset-y-0 left-0 rounded-full bg-tone-success/85" style={{ width: `${e}%` }} />
      )}
      {f > 0.5 && (
        <span
          className="absolute inset-y-0 rounded-full bg-volt/85"
          style={{ left: `calc(${e}% + 2px)`, width: `max(2px, calc(${f}% - 2px))` }}
        />
      )}
    </span>
  );
}

// ── How a wallet stands, in words (recovered with the meter) ─────────────────
function healthLine(
  snap: PortfolioSnapshot,
  hf: number | null,
  hasDebt: boolean,
  es: boolean,
): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; detail: string | null } {
  const empty = (snap.netWorthUSD ?? 0) < 0.01 && snap.positions.length === 0;
  if (empty) return { text: es ? 'Sin actividad' : 'No activity', tone: 'neutral', detail: null };
  if (!hasDebt) {
    return {
      text: es ? 'Sana' : 'Healthy',
      tone: 'success',
      detail: es ? 'Sin deuda abierta — nada puede liquidarse' : 'No open debt — nothing can be liquidated',
    };
  }
  const score = healthScoreFromHF(hf, true);
  const word = healthWords(score, es);
  return {
    text: score != null ? `${word} · ${score}/100` : word,
    tone: scoreTone(score),
    detail: hf != null ? `HF ${hf.toFixed(2)} — 1.00 = ${es ? 'liquidación' : 'liquidation'}` : null,
  };
}

const MIX_DOT: Record<string, string> = {
  success: 'bg-tone-success',
  warning: 'bg-tone-warning',
  danger: 'bg-tone-danger',
  neutral: 'bg-ink/25',
};

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function FleetDeck({ onOpenWallets }: { onOpenWallets: () => void }) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const { t, lang } = useT();
  const es = lang === 'es';
  const router = useRouter();
  const openReinforceOp = useOperationStore((st) => st.openReinforceOp);
  const hidden = useBalanceVisibility((s) => s.hidden);

  // The fleet — same shared sources as the Summary band, never a new truth.
  const { wallets: myWallets } = useMyWallets();
  // The visual fold (paFold): a Smart Account whose owning XRPL
  // wallet is in the list disappears as a row — its value/tokens already
  // ride the owner's aggregated entry — and the owner wears the Flare badge.
  const paFold = usePaFold(myWallets.map((w) => w.address));
  // ALL-fleets aggregate (per-set entries — the authority slot only carries
  // the active scope and left the other card reading "…"). Its paFold has
  // already absorbed each Smart Account into its owner, so a wallet's meter
  // includes the capital its PA has working on Flare.
  const fleet = useScopedFleet('all');
  const { data: aggregated } = useAggregatedFor(fleet.addresses);
  // La cartera agregada NO tiene adapter para morpho-blue: la deuda de
  // Ethereum nunca entra en snap.debtUSD. Sin esta lectura la fila decía
  // «Sana — sin deuda abierta» sobre un carry apalancado VIVO (la regresión
  // que el band retirado ya había pagado — verificador).
  const emAddrs = useMemo(
    () => [...new Set(fleet.addresses.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a ?? '')))],
    [fleet.addresses],
  );
  const emHealth = useEthMorphoHealth(emAddrs);
  const freshPerWallet = useMemo(() => {
    const m = new Map<
      string,
      { netWorthUSD: number; holdings: WalletHolding[]; snap: PortfolioSnapshot; risk: RiskSnapshot | null }
    >();
    for (const pw of aggregated?.perWallet ?? []) {
      if (pw?.snap) {
        m.set(addressKey(pw.address), {
          netWorthUSD: pw.snap.netWorthUSD ?? 0,
          holdings: walletHoldings(pw.snap),
          snap: pw.snap as PortfolioSnapshot,
          risk: (pw.risk ?? null) as RiskSnapshot | null,
        });
      }
    }
    return m;
  }, [aggregated]);
  // RETENTION. Picking a
  // wallet re-scopes the aggregated store, which empties for a beat while it
  // reloads — the numbers vanished and the two cards jumped. The hub keeps
  // the last known reading per wallet (merging fresh rows over it) and the
  // last known FLEET total (captured only while the overview scope is
  // active, so a single-wallet scope never masquerades as the fleet). Stale
  // for a beat, but the layout never moves.
  const retainedRef = useRef(
    new Map<string, { netWorthUSD: number; holdings: WalletHolding[]; snap: PortfolioSnapshot; risk: RiskSnapshot | null }>(),
  );
  for (const [k, v] of freshPerWallet) retainedRef.current.set(k, v);
  const perWalletByKey = retainedRef.current;
  const listedKeys = new Set(myWallets.map((w) => foldKey(w.address)));
  const visibleWallets = myWallets.filter((w) => {
    const owner = paFold.ownerByPa.get(foldKey(w.address));
    if (owner && listedKeys.has(foldKey(owner))) return false; // absorbed into its owner
    // Si su dueña está en la lista
    // su valor ya se plegó arriba; si es huérfana (dueña fuera de la lista, p. ej.
    // la cuenta del gestor), tampoco se enseña como wallet aparte. Revoca la
    // regla previa de «una huérfana con valor se queda».
    return !isSmartAccountType(w.walletType);
  });


  // Authorities: the selection IS the product switch now. Personal wallet →
  // its single authority (falls back to the overview when the registry has
  // no single row yet); Legacy card → the governed account, with the same
  // access gate the old toggle enforced (popups live inside setProductMode).
  const { authorities, legacies, active, activeGoverned, setActive } = useAuthorities();
  const { setProductMode } = useAuthorityAccount();

  // Which personal wallets are ALREADY reinforced — read back from the ledger
  // (`hardenedQuorum` is only set when a SignerList was actually found), never
  // from the owner's local mark. That distinction is the whole point: a mark
  // without a SignerList is an intention, and painting it as protection would
  // be telling someone their keys are safe when they are not.
  const hardenedKeys = useMemo(() => reinforcedPersonalKeys(authorities), [authorities]);

  const singleIdFor = (address: string): string | null => {
    const found = authorities.find(
      (a) => a.kind === 'single' && addressKey(a.wallet.address) === addressKey(address),
    );
    return found ? found.id : null;
  };
  const selectPersonal = (address: string) => {
    setProductMode('astryum'); // gold — the crossing plays via the shell
    setActive(singleIdFor(address) ?? OVERVIEW_AUTHORITY_ID);
  };
  const selectOverview = () => {
    setProductMode('astryum');
    setActive(OVERVIEW_AUTHORITY_ID);
  };
  const enterLegacy = (id: string) => {
    setProductMode('legacy'); // indigo — gate popups live inside
    if (isDemoMode() || !useAuthStore.getState().legacyAccess) return;
    // NO router.push: selecting a Legacy crosses the theme
    // and scopes the dashboard IN PLACE; the Legacy hub stays one nav away.
    setActive(id);
  };

  const activePersonalKey =
    active.kind === 'single' ? addressKey(active.wallet.address) : null;
  const overviewActive = active.kind === 'overview';


  return (
    <div>
      {/* ── The two products, standing side by side ── */}
      <RevealGroup className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto items-start">
        {/* Personal — gold */}
        <RevealItem>
          <Card
            data-tour="fleet-personal"
            padded={false}
            className="p-5 border-volt/20"
          >
            <div className="flex items-center gap-3 pb-4 border-b border-ink/5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-volt/10 border border-volt/25 text-volt">
                <WalletIcon className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">{t('Personal')}</h2>
                <p className="text-[11px] text-ink/45">{t('your capital — you sign')}</p>
              </div>
              <span className="ml-auto font-mono text-[10px] text-ink/30">{visibleWallets.length}</span>
            </div>

            <div className="py-2">
              {/* "All together" — the aggregated overview is a first-class pick. */}
              {visibleWallets.length > 1 && (
                <button
                  onClick={selectOverview}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    overviewActive ? 'bg-volt/[0.08] border border-volt/30' : 'border border-transparent hover:bg-ink/[0.04]'
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink/5 border border-ink/10 text-ink/50">
                    <Users className="w-3.5 h-3.5" strokeWidth={1.8} />
                  </span>
                  <span className="flex-1 min-w-0 text-[13px] text-ink/85">{t('All wallets together')}</span>
                  {overviewActive && <Pill tone="success">{t('Active')}</Pill>}
                </button>
              )}

              {visibleWallets.map((w) => {
                const glyph = walletIcon(w);
                const info = perWalletByKey.get(addressKey(w.address));
                const isSel = activePersonalKey === addressKey(w.address);
                // The reinforce door — every XRPL account
                // can be given a quorum of its owner's own keys. The row is a
                // <button>, so the door CANNOT nest inside it: the two live
                // side by side in a flex wrapper instead.
                //
                // NOT gated by legacyAccess:
                // reinforcing your own wallet is a PERSONAL feature that only
                // borrows the Legacy ceremony's screens. Gating it behind the
                // Legacy product flag hid it from exactly the people it is for
                // — and fail-closed meant it also vanished whenever /auth/me
                // had not answered yet.
                const canReinforce = isXrplWallet(w);
                const isHardened = hardenedKeys.has(addressKey(w.address));
                return (
                  <div
                    key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem ?? ''}`}
                    className="flex items-center gap-1"
                  >
                    <button
                      onClick={() => selectPersonal(w.address)}
                      className={`min-w-0 flex-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        isSel ? 'bg-volt/[0.08] border border-volt/30' : 'border border-transparent hover:bg-ink/[0.04]'
                      }`}
                      title={t('Work with this wallet — the dashboard scopes to it')}
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                        style={{
                          background: `color-mix(in srgb, ${walletColor(w)} 18%, transparent)`,
                          boxShadow: `inset 0 0 0 1.5px ${walletColor(w)}55`,
                        }}
                      >
                        {glyph ? (
                          <WalletGlyphIcon icon={glyph} size={13} color={walletColor(w)} />
                        ) : (
                          usesXamanAvatar(w) ? (
                          <XamanAvatar address={w.address} size={13} brand={brandOf(w.walletType, w.ecosystem)} />
                        ) : (
                          <WalletBrandIcon brand={brandOf(w.walletType, w.ecosystem)} size={13} tint={walletColor(w)} />
                        )
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-[13px] text-ink/85">{walletDisplayName(w, t)}</span>
                          {paFold.paByOwner.has(foldKey(w.address)) && (
                            <SmartAccountBadge pa={paFold.paByOwner.get(foldKey(w.address))!} compact t={t} />
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-ink/35">{shortAddr(w.address)}</span>
                          {info && info.holdings.length > 0 && (
                            <span className="flex items-center gap-0.5">
                              {info.holdings.slice(0, 3).map((h) => (
                                <TokenLogo key={h.symbol} symbol={h.symbol} size="xs" className="ring-1 ring-surface-1" />
                              ))}
                            </span>
                          )}
                        </span>
                        {/*
                        { */}
                        {info && (() => {
                          const mix = capitalMix(info.snap);
                          const snapHf = typeof info.risk?.healthFactor === 'number' ? info.risk.healthFactor : null;
                          // Manda el PEOR de los dos mundos, nunca el más bonito.
                          const emHf = emHealth.byWallet[String(w.address).toLowerCase()] ?? null;
                          const hf = snapHf != null && emHf != null ? Math.min(snapHf, emHf) : (snapHf ?? emHf);
                          // Una deuda que el snapshot no sabe leer sigue siendo deuda.
                          const hasDebt = (info.snap.debtUSD ?? 0) > 0.01 || emHf != null;
                          const health = healthLine(info.snap, hf, hasDebt, es);
                          const working = Math.round(mix.earningPct + mix.inflightPct);
                          return (
                            <span
                              className="mt-1.5 flex items-center gap-2"
                              title={`${health.text}${health.detail ? ` — ${health.detail}` : ''}`}
                            >
                              <span className="flex-1 min-w-[2rem]">
                                <CapitalMeter earningPct={mix.earningPct} inflightPct={mix.inflightPct} />
                              </span>
                              <span className="shrink-0 font-mono tabular-nums text-[10px] text-ink/55">
                                {mix.assetsUSD > 0 ? `${working}%` : '—'}
                              </span>
                              <span className="hidden sm:inline shrink-0 text-[10px] text-ink/40">
                                {mix.assetsUSD <= 0
                                  ? (es ? 'sin activos' : 'no assets')
                                  : working >= 1
                                    ? (es ? 'trabajando' : 'working')
                                    : (es ? 'quieto' : 'sitting still')}
                              </span>
                              <span
                                className={`hidden md:inline shrink-0 max-w-[7rem] truncate text-[10px] ${
                                  health.tone === 'danger'
                                    ? 'text-tone-danger/90'
                                    : health.tone === 'warning'
                                      ? 'text-tone-warning/90'
                                      : 'text-ink/40'
                                }`}
                              >
                                {health.text}
                              </span>
                              <span className="sr-only md:hidden">{health.text}</span>
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${MIX_DOT[health.tone]}`} aria-hidden />
                            </span>
                          );
                        })()}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono tabular-nums text-xs text-ink/75">
                          {info ? (hidden ? '••••' : formatMoneyCompact(info.netWorthUSD)) : '…'}
                        </span>
                        {isSel && <span className="text-[9px] font-semibold uppercase tracking-wide text-volt">{t('Active')}</span>}
                      </span>
                    </button>
                    {canReinforce &&
                      (isHardened ? (
                        <button
                          onClick={() => router.push(`/app/legacy?govern=${encodeURIComponent(w.address)}`)}
                          aria-label={`${t('Governance')} · ${walletDisplayName(w, t)}`}
                          title={t('Reinforced — no single key moves anything')}
                          className="shrink-0 grid h-7 w-7 place-items-center rounded-lg border border-tone-success/30 bg-tone-success/10 text-tone-success transition-colors hover:bg-tone-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-success/40"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      ) : (
                        <button
                          // Reforzar abre como OPERACIÓN en oro
                          // — nada de viajar a la superficie Legacy en índigo.
                          onClick={() => openReinforceOp(w.address)}
                          aria-label={`${t('Reinforce it')} · ${walletDisplayName(w, t)}`}
                          title={t('Give this account a quorum of your own keys — it stays yours, and you keep signing in Xaman')}
                          className="shrink-0 grid h-7 w-7 place-items-center rounded-lg border border-ink/10 text-ink/40 transition-colors hover:border-ink/25 hover:bg-ink/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                        >
                          <ShieldPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-ink/5 space-y-2">
              <button
                data-tour="home-add"
                onClick={onOpenWallets}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-volt/35 text-volt text-xs font-medium hover:bg-volt/[0.07] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> {t('Add or create a wallet')}
              </button>
              <button
                onClick={onOpenWallets}
                className="w-full text-center text-[11px] text-ink/40 hover:text-ink/70 transition-colors"
              >
                {t('Manage wallets')}
              </button>
            </div>
          </Card>
        </RevealItem>

        {/* Legacy — indigo, wearing its product before you enter */}
        <RevealItem>
          <div
            data-tour="fleet-legacy"
            className="rounded-2xl border p-5"
            style={{
              borderColor: `hsl(var(--product-legacy) / 0.3)`,
              background: `hsl(var(--product-legacy) / 0.05)`,
            }}
          >
            <div className="flex items-center gap-3 pb-4" style={{ borderBottom: '1px solid hsl(var(--product-legacy) / 0.15)' }}>
              <div
                className="grid h-10 w-10 place-items-center rounded-xl"
                style={{ background: `hsl(var(--product-legacy) / 0.14)`, color: `hsl(var(--product-legacy))` }}
              >
                <Landmark className="w-5 h-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">Legacy</h2>
                <p className="text-[11px] text-ink/45">{t('council-governed accounts — the quorum signs')}</p>
              </div>
              <span className="ml-auto font-mono text-[10px] text-ink/30">{legacies.length}</span>
            </div>

            <div className="py-2">
              {legacies.length === 0 && (
                <p className="px-2.5 py-3 text-[12px] leading-relaxed text-ink/45">
                  {t('Nothing constituted yet. A Legacy is an account governed by a council — inheritance, family, treasury — where no single key can move alone.')}
                </p>
              )}
              {legacies.map((l) => {
                const isSel = activeGoverned?.id === l.id;
                return (
                  <button
                    key={l.id}
                    onClick={() => enterLegacy(l.id)}
                    className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors border"
                    style={{
                      borderColor: isSel ? `hsl(var(--product-legacy) / 0.5)` : 'transparent',
                      background: isSel ? `hsl(var(--product-legacy) / 0.1)` : undefined,
                    }}
                    title={t('Enter this Legacy — the dashboard crosses to governed mode')}
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                      style={{ background: `hsl(var(--product-legacy) / 0.14)`, color: `hsl(var(--product-legacy))` }}
                    >
                      <Landmark className="w-3.5 h-3.5" strokeWidth={1.8} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[13px] text-ink/85">{l.label || shortAddr(l.address)}</span>
                        {/* E1 — what needs the user, said on the shelf: a row
                            that only shows the quorum forces you to enter to
                            find out. Both ride as pills WITH their word (colour
                            is never the only indicator). */}
                        {l.hasCouncil && l.health && (
                          <Pill tone={healthTone(l.health.level)}>{headlineLabel(l.health.headline, t)}</Pill>
                        )}
                        {typeof l.pendingSignatures === 'number' && l.pendingSignatures > 0 && (
                          <Pill tone="warning">
                            <PenLine size={10} className="mr-1 inline" aria-hidden />
                            {t('To sign')} · {l.pendingSignatures}
                          </Pill>
                        )}
                        {/* «NO PUDE LEER» NO ES «NO TE TOCA FIRMAR
                            NADA». El hook deja el recuento en `undefined` cuando la
                            lectura se rechazó o vino a medias y lo MARCA,
                            pero solo StructuresBand pintaba la marca: esta estantería
                            —donde se pregunta «¿tengo algo que firmar?»— enseñaba un
                            Legacy con firmas pendientes que nadie pudo leer igual que
                            uno sin nada. La marca la pone el hook solo tras INTENTARLO. */}
                        {l.proposalsUnread && typeof l.pendingSignatures !== 'number' && (
                          <Pill tone="warning">
                            <PenLine size={10} className="mr-1 inline" aria-hidden />
                            {t('To sign')} · {t('could not read')}
                          </Pill>
                        )}
                      </span>
                      {/* signers · XRP · caged principal · proposals in flight ·
                          programmed releases — read live, "could not read" when
                          the read dies, never a fabricated figure. */}
                      <StructureFacts structure={l} className="mt-0.5" />
                      {/* The structure's meter: its two legs —
                          council + Smart Account — read as ONE bar of money
                          working, from the all-fleets aggregate. Only when a
                          leg has been read; never a fabricated figure. */}
                      {(() => {
                        // ONE lookup is the whole structure: the all-fleets
                        // aggregate already folded the Smart Account into its
                        // council row (paFold runs inside portfolioMerge), so
                        // the council's snap carries both legs.
                        const sn = perWalletByKey.get(addressKey(l.address))?.snap;
                        if (!sn) return null;
                        const mix = capitalMix(sn);
                        const working = Math.round(mix.earningPct + mix.inflightPct);
                        const totalUSD = sn.netWorthUSD ?? 0;
                        return (
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="flex-1 min-w-[2rem]">
                              <CapitalMeter earningPct={mix.earningPct} inflightPct={mix.inflightPct} />
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-[10px] text-ink/55">
                              {mix.assetsUSD > 0 ? `${working}%` : '—'}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-[11px] text-ink/75">
                              {hidden ? '••••' : formatMoneyCompact(totalUSD)}
                            </span>
                          </span>
                        );
                      })()}
                    </span>
                    <span
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium"
                      style={{ color: `hsl(var(--product-legacy))` }}
                    >
                      {isSel ? t('Active') : t('Enter')} {!isSel && <ArrowRight className="w-3 h-3" />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-3" style={{ borderTop: '1px solid hsl(var(--product-legacy) / 0.15)' }}>
              <button
                onClick={() => {
                  setProductMode('legacy');
                  if (isDemoMode() || !useAuthStore.getState().legacyAccess) return;
                  router.push('/app/legacy?constitute=1');
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed text-xs font-medium transition-colors"
                style={{ borderColor: `hsl(var(--product-legacy) / 0.4)`, color: `hsl(var(--product-legacy))` }}
              >
                <Landmark className="w-3.5 h-3.5" /> {t('Constitute a Legacy')}
              </button>
            </div>
          </div>
        </RevealItem>
      </RevealGroup>
    </div>
  );
}

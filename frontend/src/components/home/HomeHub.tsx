'use client';

/**
 * HomeHub — the welcome deck (founder 2026-08-15 "Home absorbe W1"; layout v2
 * founder 2026-08-16: a cosier arrival). The page opens with a calm greeting
 * — this is the main landing after login, it should seat the user, not shout
 * — and below it the TWO PRODUCTS stand as vertical cards, side by side:
 * Personal (gold) and Legacy (indigo), each carrying its own wallet list and
 * its own add door.
 *
 * THE THEME FOLLOWS THE SELECTION (founder 2026-08-16: the sidebar
 * ProductToggle retires): clicking a personal wallet activates it as the
 * authority → the shell crosses to gold; clicking a Legacy card activates
 * the governed account → indigo, with the real AuthorityCrossing either way.
 * Same store the toggle wrote — only the gesture changed.
 *
 * The FULL Wallets surface survives with zero functional cut (W1 condition):
 * `?panel=wallets` embeds WalletManager right here, and /app/wallets
 * redirects in (`?add=1` included). The first-run tour moved here from the
 * Summary (it is the meeting point now).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Landmark, PenLine, Plus, ShieldCheck, ShieldPlus, Users, Wallet as WalletIcon } from 'lucide-react';
import { Card, MicroLabel, Pill } from '@/components/ui/primitives';
// E1 — the live facts of each structure, mounted on the hub's Legacy shelf.
// Self-contained (own minute-cached read); never fabricates a figure.
import { StructureFacts } from '@/components/legacy/StructuresBand';
import { headlineLabel, healthTone } from '@/components/legacy/MyLegaciesList';
import { RevealGroup, RevealItem } from '@/components/ui/motion';
import { TokenLogo } from '@/components/ui/TokenLogo';
import ProductTour from '@/components/onboarding/ProductTour';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import XamanAvatar from '@/components/wallet/XamanAvatar';
import { useXamanHues } from '@/lib/wallet/xamanHues';
import WalletManager from '@/components/wallet/WalletManager';
import { useT } from '@/i18n/LanguageProvider';
import { useMyWallets } from '@/hooks/useMyWallets';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { useAuthorities } from '@/hooks/useAuthorities';
import { useAuthorityAccount } from '@/lib/authority/useAuthorityAccount';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/lib/demoMode';
import { OVERVIEW_AUTHORITY_ID, addressKey } from '@/lib/authority';
import { reinforcedPersonalKeys } from '@/lib/authority/personalQuorum';
import { walletHoldings, type WalletHolding } from '@/lib/portfolioMerge';
import { usePaFold, foldKey, isHiddenEmptyOrphanPa } from '@/lib/wallet/paFold';
import { SmartAccountBadge } from '@/components/wallet/SmartAccountBadge';
import { brandOf, isXrplWallet, usesXamanAvatar, walletColor, walletDisplayName, walletIcon } from '@/lib/walletIdentity';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { useBalanceVisibility } from '@/stores/balanceVisibilityStore';
import { useOperationStore } from '@/stores/operationStore';

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function HomeHub() {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const { t } = useT();
  const router = useRouter();
  const openReinforceOp = useOperationStore((st) => st.openReinforceOp);
  const hidden = useBalanceVisibility((s) => s.hidden);
  const user = useAuthStore((s) => s.user);
  // Gestor declarado: el tour gana un paso que enseña su mesa del sidebar.

  // ?panel=wallets — the embedded FULL management surface (W1: zero cut).
  const [panel, setPanel] = useState<'wallets' | null>(null);
  useEffect(() => {
    const read = () =>
      setPanel(new URLSearchParams(window.location.search).get('panel') === 'wallets' ? 'wallets' : null);
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const openPanel = () => {
    const qs = new URLSearchParams(window.location.search);
    qs.set('panel', 'wallets');
    window.history.pushState(null, '', `${window.location.pathname}?${qs.toString()}`);
    setPanel('wallets');
  };
  const closePanel = () => {
    const qs = new URLSearchParams(window.location.search);
    qs.delete('panel');
    const rest = qs.toString();
    window.history.pushState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    setPanel(null);
  };

  // The fleet — same shared sources as the Summary band, never a new truth.
  const { wallets: myWallets } = useMyWallets();
  // The visual fold (paFold, 2026-08-17): a Smart Account whose owning XRPL
  // wallet is in the list disappears as a row — its value/tokens already
  // ride the owner's aggregated entry — and the owner wears the Flare badge.
  const paFold = usePaFold(myWallets.map((w) => w.address));
  const { data: aggregated } = useAggregatedPortfolio();
  const freshPerWallet = useMemo(() => {
    const m = new Map<string, { netWorthUSD: number; holdings: WalletHolding[] }>();
    for (const pw of aggregated?.perWallet ?? []) {
      if (pw?.snap) {
        m.set(addressKey(pw.address), {
          netWorthUSD: pw.snap.netWorthUSD ?? 0,
          holdings: walletHoldings(pw.snap),
        });
      }
    }
    return m;
  }, [aggregated]);
  const listedKeys = new Set(myWallets.map((w) => foldKey(w.address)));
  const visibleWallets = myWallets.filter((w) => {
    const owner = paFold.ownerByPa.get(foldKey(w.address));
    if (owner && listedKeys.has(foldKey(owner))) return false; // absorbed into its owner
    // Founder 2026-08-19: an ORPHAN Smart Account holding nothing is registry
    // plumbing, not capital — hidden. One with value always stays visible.
    return !isHiddenEmptyOrphanPa(w.walletType, freshPerWallet.get(addressKey(w.address))?.netWorthUSD);
  });

  // RETENTION (founder 2026-08-16: "cada vez que se cambia de wallet los dos
  // rectángulos se reposicionan porque el número desaparece"). Picking a
  // wallet re-scopes the aggregated store, which empties for a beat while it
  // reloads — the numbers vanished and the two cards jumped. The hub keeps
  // the last known reading per wallet (merging fresh rows over it) and the
  // last known FLEET total (captured only while the overview scope is
  // active, so a single-wallet scope never masquerades as the fleet). Stale
  // for a beat, but the layout never moves.
  const retainedRef = useRef(new Map<string, { netWorthUSD: number; holdings: WalletHolding[] }>());
  for (const [k, v] of freshPerWallet) retainedRef.current.set(k, v);
  const perWalletByKey = retainedRef.current;

  const scopedTotal = aggregated?.snap?.netWorthUSD ?? null;
  const fleetTotalRef = useRef<number | null>(null);

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
    setActive(id);
    router.push('/app/legacy');
  };

  const activePersonalKey =
    active.kind === 'single' ? addressKey(active.wallet.address) : null;
  const overviewActive = active.kind === 'overview';

  // The fleet total is captured only from the OVERVIEW scope (see retention
  // note above); any other scope shows the last fleet reading it saw.
  if (overviewActive && scopedTotal != null) fleetTotalRef.current = scopedTotal;
  const totalUSD = fleetTotalRef.current ?? scopedTotal;

  // A greeting that follows the clock — cosy, not loud (founder: "solo lo
  // justo para acomodar a la gente").
  const hour = new Date().getHours();
  const greeting = hour < 6 ? t('Good night') : hour < 13 ? t('Good morning') : hour < 21 ? t('Good afternoon') : t('Good night');
  const name = user?.username?.trim();

  if (panel === 'wallets') {
    return (
      <div>
        <button
          onClick={closePanel}
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink/45 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> {t('Back to Home')}
        </button>
        {/* The COMPLETE surface, untouched — connection, binding, rename,
            colours, unmint, movements: everything Wallets always did. */}
        <WalletManager scope="personal" variant="page" />
      </div>
    );
  }

  return (
    <div>
      {/* First-run tour — moved here from the Summary (founder 2026-08-16:
          the Home is the meeting point now). Walks the two shelves first,
          then the sidebar doors; targets the current mode hides are skipped
          by ProductTour itself; replayable from Settings. */}
      <ProductTour
        tour="home"
        steps={[
          { target: null, title: t('Welcome aboard'), body: t('This is your Home: every account you work with lives here. A minute of tour and you will know where everything is — skip and replay it any time from Settings.') },
          { target: 'fleet-personal', title: t('Personal'), body: t('Your own wallets. Click one to work with it — the whole dashboard turns gold and scopes to what you picked. Connect, watch or create wallets from the door below.') },
          { target: 'fleet-legacy', title: t('Legacy'), body: t('Council-governed accounts: capital under rules that a quorum signs. Click one to enter — the dashboard crosses to indigo while you govern.') },
          { target: 'nav-summary', title: t('Summary'), body: t('The overview: net worth, health, alerts and how each wallet is performing — always scoped to the account you picked here.') },
          { target: 'nav-asset-production', title: t('Earn'), body: t('Where capital goes to work: ready-made strategies, the AI agent, and your strategy registry. You always sign in your own wallet.') },
          { target: 'nav-portfolio', title: t('Portfolio'), body: t('Every position, token and movement across your wallets — with filters, health readings and export.') },
          { target: 'nav-settings', title: t('Settings'), body: t('Language, region, security and your profile. The tutorial can be replayed from here whenever you want.') },
          { target: 'copilot', title: t('Co-pilot'), body: t('Stuck anywhere? The co-pilot explains the ship — ask it anything about what a screen or button does.') },
        ]}
      />

      {/* ── The arrival — calm, roomy, one breath before the doors ── */}
      <div className="pt-6 pb-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink/35">Astryum</p>
        <h1 className="mt-3 text-2xl sm:text-3xl font-semibold text-ink text-balance">
          {greeting}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="mt-2 text-sm text-ink/50 max-w-md mx-auto leading-relaxed">
          {t('Pick the account you want to work with — the dashboard follows your choice.')}
        </p>
        {/* Always rendered (reserved line) — appearing/disappearing here is
            exactly what made the two cards jump. '…' only before the very
            first reading; after that the retained figure holds the space. */}
        <p className="mt-3 text-sm text-ink/45">
          {t('Across your fleet')}:{' '}
          <span className="font-mono tabular-nums text-ink/80">
            {hidden ? '••••' : totalUSD != null ? formatMoneyCompact(totalUSD) : '…'}
          </span>
        </p>
      </div>

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
                // The reinforce door (founder 2026-08-21) — every XRPL account
                // can be given a quorum of its owner's own keys. The row is a
                // <button>, so the door CANNOT nest inside it: the two live
                // side by side in a flex wrapper instead.
                //
                // NOT gated by legacyAccess (founder 2026-08-21, second pass):
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
                          // Reforzar abre como OPERACIÓN en oro (fundador 2026-08-27)
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
                onClick={openPanel}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-volt/35 text-volt text-xs font-medium hover:bg-volt/[0.07] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> {t('Add or create a wallet')}
              </button>
              <button
                onClick={openPanel}
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
                        {/* it. 34 (agente D) — «NO PUDE LEER» NO ES «NO TE TOCA FIRMAR
                            NADA». El hook deja el recuento en `undefined` cuando la
                            lectura se rechazó o vino a medias y lo MARCA (it. 27 §6),
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

      {/* One quiet exit row — the person who just wants their numbers. */}
      <p className="mt-8 text-center text-[12px] text-ink/40">
        <Link href="/app" className="text-volt/80 hover:text-volt hover:underline">
          {t('Go to your Summary')}
        </Link>{' '}
        · {t('net worth, health and what your capital is doing')}
      </p>
    </div>
  );
}

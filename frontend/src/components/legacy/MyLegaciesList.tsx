'use client';

/**
 * MyLegaciesList — the "Mis Legacies" home (redesigned 2026-07-16, founder ask;
 * data layer unified 2026-07-18 with the authority switcher; resurrected as
 * the Legacy's HOME 2026-09-12 with the hackathon hub).
 *
 * 2026-09-13 (founder): «quiero que cada wallet se vea como tal en esta
 * pantalla — como las cards de la pantalla Wallets». Each Legacy is now the
 * SAME credit-card (CompactWalletCard, council dress: indigo, crown, seal,
 * flip to the back for the addresses) the Wallets screen paints on its Legacy
 * shelf — one card, not two that look alike. What this page adds under each
 * card is what a Legacy home needs and a wallet shelf does not: where the
 * council stands (health, signers rehearsed) and the Constitute door.
 *
 * REMOVING IS NEVER ONE CLICK (founder 2026-09-13, twice: «cuando le doy a la
 * X de cada wallet se elimina sin más»). The bare X is gone. Removal lives
 * behind «Manage» → «Remove…», which ARMS and explains, and then asks for an
 * acknowledgement that the account and its council stay on XRPL — the same
 * two-step grammar as ManageWalletModal on the Wallets screen.
 *
 * THE HONEST MEMBERSHIP LIMIT (§1): XRPL has no reverse lookup; this list is
 * composed from the connected wallet + the user's pointers. THE SOURCE is the
 * governed-account REGISTRY (/api/governed-accounts) via useAuthorities — the
 * SAME source the authority switcher reads, so the two can never disagree, and
 * pointers follow the user across devices. legacyLocal remains the wizard's
 * local write-buffer; useAuthorities drains it into the registry. State is
 * always read fresh from the ledger (L1).
 *
 * It renders `legacies`, NOT every governed candidate (founder 2026-07-28):
 * being connected while you are a MEMBER of someone else's council does not
 * make your own account a Legacy. Only a confirmed council, or an account you
 * deliberately pointed at, belongs on this page.
 */
import { useCallback, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, Plus, RefreshCw, ScrollText, Trash2, Users, X } from 'lucide-react';
import { EmptyState, GhostButton, PageHeader, Pill, PrimaryButton } from '../ui/primitives';
import { ModalOverlay } from '../ui/ModalPortal';
import { useT } from '../../i18n/LanguageProvider';
import { governedAccountsApi, type LegacyHealth } from '../../services/v1Api';
import { useAuthorities, invalidateAuthorityCache } from '../../hooks/useAuthorities';
import { useAggregatedPortfolio } from '../../hooks/useAggregatedPortfolio';
import { useSmartAccountsOf } from '../../hooks/useSmartAccountsOf';
import { addressKey, type GovernedAuthority } from '../../lib/authority';
import { walletHoldings, type WalletHolding } from '../../lib/portfolioMerge';
import { markPersonalQuorum } from '../../lib/authority/personalQuorum';
import { CompactWalletCard, WalletCardsGrid, legacyWalletRow } from '../wallet/WalletManager';
import { forgetLegacy, getLegacyNickname, setLegacyNickname } from './legacyLocal';

const XRPSCAN_ACCOUNT = 'https://xrpscan.com/account/';

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

// Exported: the authority switcher's miniature cards reuse THIS health
// representation — one source, never a second visual language for the same fact.
export function healthTone(level: LegacyHealth['level']): 'danger' | 'warning' | 'success' | 'neutral' {
  return level === 'red' ? 'danger' : level === 'amber' ? 'warning' : level === 'green' ? 'success' : 'neutral';
}

export function headlineLabel(h: LegacyHealth['headline'], t: (s: string) => string): string {
  switch (h) {
    case 'replace-fallen-signer':
      return t('Emergency: replace the fallen signer');
    case 'run-rehearsal':
      return t('Next: run the signing rehearsal');
    case 'close-the-door':
      return t('Next: close the master-key door');
    case 'healthy':
      return t('Constituted and healthy');
    default:
      return t('Not a council yet');
  }
}

/**
 * Manage ONE Legacy: nickname, the ledger link, and — armed, explained and
 * acknowledged — removal from the list. Mirrors ManageWalletModal's council
 * branch so the two screens never teach two different removal gestures.
 */
function LegacyManageDialog({
  legacy,
  nickname,
  busy,
  onClose,
  onRename,
  onRemove,
}: {
  legacy: GovernedAuthority;
  nickname: string | undefined;
  busy: boolean;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(nickname ?? '');
  const [removeArmed, setRemoveArmed] = useState(false);
  const [removeAck, setRemoveAck] = useState(false);
  const dirty = draft.trim() !== (nickname ?? '');

  return (
    <ModalOverlay
      onEscape={onClose}
      lockScroll
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        data-authority="governed"
        className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('Manage this Legacy')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{nickname ?? t('Unnamed Legacy')}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-ink/45">{shortAddr(legacy.address)}</p>
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="mt-0.5 shrink-0 text-ink/40 transition-colors hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Nickname — the portable name (registry label). */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.12em] text-ink/40" htmlFor="legacy-nickname">{t('Nickname')}</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="legacy-nickname"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void onRename(draft.trim()); }}
                placeholder={t('Nickname')}
                className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-ink/5 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink/30"
              />
              <button
                type="button"
                onClick={() => void onRename(draft.trim())}
                disabled={busy || !dirty}
                className="inline-flex items-center gap-1 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40"
                aria-label={t('Save nickname')}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('Save')}
              </button>
            </div>
          </div>

          <a
            className="inline-flex items-center gap-1.5 text-[12px] text-ink/55 transition-colors hover:text-ink"
            href={`${XRPSCAN_ACCOUNT}${legacy.address}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} /> {t('View on XRPScan')}
          </a>

          {/* Danger — last and quiet, and IN TWO STEPS (founder 2026-09-13):
              arm and explain, then acknowledge, then remove. Only pointers
              (registry rows) can be removed: a Legacy that is here because
              the connected wallet IS the council has nothing to forget. */}
          {legacy.registryId ? (
            <div className="border-t border-ink/5 pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink/35">{t('Stop tracking this Legacy')}</span>
                <button
                  type="button"
                  onClick={() => { setRemoveArmed((a) => !a); setRemoveAck(false); }}
                  disabled={busy}
                  aria-expanded={removeArmed}
                  className={`flex items-center gap-1 text-[11px] transition-colors disabled:opacity-40 ${removeArmed ? 'text-tone-danger' : 'text-ink/40 hover:text-tone-danger'}`}
                >
                  <Trash2 className="h-3 w-3" />
                  {removeArmed ? t('Keep it') : t('Remove…')}
                </button>
              </div>
              {removeArmed ? (
                <div className="mt-2 space-y-2 rounded-lg border border-tone-danger/30 bg-tone-danger/[0.06] p-3">
                  <p className="text-[11.5px] leading-relaxed text-ink/70">
                    {t('This is a Legacy governed by a council. Removing it here only stops tracking it in Astryum: the account, its council and its capital stay on XRPL exactly as they are, and nothing is signed. To see it again you will have to add it back.')}
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-ink/70">
                    <input type="checkbox" checked={removeAck} onChange={(e) => setRemoveAck(e.target.checked)} className="mt-0.5" />
                    <span>{t('I understand the Legacy stays on the ledger — I am only removing it from this list.')}</span>
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => { setRemoveArmed(false); setRemoveAck(false); }} className="text-[11px] text-ink/50 hover:text-ink">{t('Cancel')}</button>
                    <button
                      type="button"
                      onClick={() => void onRemove()}
                      disabled={busy || !removeAck}
                      className="flex items-center gap-1 rounded-lg border border-tone-danger/40 bg-tone-danger/10 px-2.5 py-1 text-[11px] font-medium text-tone-danger transition-colors hover:bg-tone-danger/20 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('Remove this Legacy from my list')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-ink/5 pt-3 text-[11px] leading-relaxed text-ink/40">
              {t('This Legacy is here because the connected wallet is its council — there is no pointer to remove.')}
            </p>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

export default function MyLegaciesList({
  onSelect,
  onConstituteNew,
}: {
  /** Open a Legacy on a chosen surface — the three doors live on the card now. */
  onSelect: (account: string, surface: 'constitute' | 'govern', tab?: 'movements') => void;
  onConstituteNew: () => void;
}) {
  const { t } = useT();
  // The SAME source the authority switcher reads — connected council +
  // registry pointers, enriched from the ledger (health, council shape) —
  // narrowed to the ones that ARE Legacies: a wallet that is only a MEMBER of
  // someone else's council is a signer, not a Legacy of its own.
  const { legacies, loading, reload } = useAuthorities();
  const [managing, setManaging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The SAME readings the Wallets screen feeds its Legacy shelf with: net
  // worth and holdings from the shared aggregated portfolio (unpriced = «…»,
  // never a false zero), and each council's Flare Smart Account for the back
  // of the card.
  const { data: aggregatedPortfolio } = useAggregatedPortfolio();
  const usdByAddress = useMemo(() => {
    const m = new Map<string, number>();
    for (const pw of aggregatedPortfolio?.perWallet ?? []) {
      const v = pw?.snap?.netWorthUSD;
      if (typeof v === 'number') m.set(addressKey(pw.address), v);
    }
    return m;
  }, [aggregatedPortfolio]);
  const holdingsByAddress = useMemo(() => {
    const m = new Map<string, WalletHolding[]>();
    for (const pw of aggregatedPortfolio?.perWallet ?? []) {
      if (pw?.snap) m.set(addressKey(pw.address), walletHoldings(pw.snap));
    }
    return m;
  }, [aggregatedPortfolio]);
  const legacyAddresses = useMemo(() => legacies.map((c) => c.address), [legacies]);
  const { byXrpl: smartAccounts } = useSmartAccountsOf(legacyAddresses);

  const refreshAll = useCallback(() => {
    invalidateAuthorityCache();
    reload();
  }, [reload]);

  const nicknameOf = (c: GovernedAuthority): string | undefined =>
    c.label || getLegacyNickname(c.address) || undefined;

  const saveNickname = useCallback(
    async (c: GovernedAuthority, name: string) => {
      setBusy(true);
      try {
        if (c.registryId) await governedAccountsApi.rename(c.registryId, name || null);
        setLegacyNickname(c.address, name);
        refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [refreshAll],
  );

  const removeObserved = useCallback(
    async (c: GovernedAuthority) => {
      if (!c.registryId) return;
      setBusy(true);
      try {
        await governedAccountsApi.remove(c.registryId);
        forgetLegacy(c.address);
        setManaging(null);
        refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [refreshAll],
  );

  const managingLegacy = managing ? legacies.find((c) => c.address === managing) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('My Legacies')}
        subtitle={t(
          'The council-governed accounts you constitute and control. Their state is read live from the ledger — Astryum stores only your pointers to them.',
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={onConstituteNew}>
          <Plus size={14} /> {t('Constitute a new Legacy')}
        </PrimaryButton>
        <GhostButton onClick={refreshAll} disabled={loading || busy}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('Refresh')}
        </GhostButton>
      </div>

      {legacies.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title={t('No Legacies yet')}
          hint={t(
            'A Legacy is an XRPL account governed by a council of real people — a quorum the ledger itself enforces. Constitute a new one, or open the address of one you already govern in the first step: it will appear here.',
          )}
          action={
            <PrimaryButton onClick={onConstituteNew}>
              <Plus size={14} /> {t('Constitute a new Legacy')}
            </PrimaryButton>
          }
        />
      ) : (
        // The Wallets screen's card grid, with the Wallets screen's card: the
        // council as a credit card (indigo, crown, seal; flip for addresses).
        <div data-authority="governed">
        <WalletCardsGrid>
          {legacies.map((c) => {
            const nickname = nicknameOf(c);
            const row = legacyWalletRow(c.address, {
              walletType: 'Council · multisig',
              network: 'xrpl',
              chainId: null,
              caip2: null,
              ecosystem: 'xrpl',
              nickname: nickname ?? null,
            });
            const pa = smartAccounts[c.address];
            return (
              <div key={c.address} className="space-y-2">
                <CompactWalletCard
                  wallet={row}
                  holdings={holdingsByAddress.get(addressKey(c.address))}
                  usd={usdByAddress.get(addressKey(c.address))}
                  absorbedPa={pa ? { address: pa } : undefined}
                  council
                  councilFacts={{ quorum: c.quorum, memberCount: c.memberCount }}
                  onOpen={() => onSelect(c.address, 'govern')}
                  onMovements={() => onSelect(c.address, 'govern', 'movements')}
                  onGovern={() => onSelect(c.address, 'govern')}
                  onManage={() => setManaging(c.address)}
                  t={t}
                />

                {/* Under the card, what a Legacy home adds: where the council
                    stands, and the Constitute door (the ceremony, or its
                    renewal). Never capital — the card already shows it. */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {c.source === 'connected' && <Pill tone="info">{t('connected')}</Pill>}
                    {c.loading ? (
                      <Loader2 size={13} className="animate-spin text-ink/40" />
                    ) : c.error ? (
                      <Pill tone="warning">{t('could not read')}</Pill>
                    ) : c.hasCouncil && c.health ? (
                      <>
                        <Pill tone={healthTone(c.health.level)}>{headlineLabel(c.health.headline, t)}</Pill>
                        {typeof c.memberCount === 'number' && (
                          <span className="text-[11px] text-ink/45">
                            <Users size={11} className="mr-1 inline" />
                            {c.memberCount} {t('signers')}
                            {typeof c.status?.signedCount === 'number' &&
                              ` · ${c.status.signedCount}/${c.memberCount} ${t('rehearsed')}`}
                          </span>
                        )}
                      </>
                    ) : (
                      <Pill tone="neutral">{t('not a council yet')}</Pill>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(c.address, 'constitute')}
                    aria-label={`${t('Constitute')} · ${nickname ?? shortAddr(c.address)}`}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink/50 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                  >
                    <ScrollText size={12} /> {t('Constitute')}
                  </button>
                </div>

                {/* E2 third state: a council that is here ONLY because the
                    wallet is connected (no deliberate pointer) may be a
                    reinforced PERSONAL account, not a Legacy. One quiet door
                    reclassifies it — the mark is the owner's word; the quorum
                    itself keeps being read from the ledger. */}
                {c.source === 'connected' && !c.registryId && c.hasCouncil === true && (
                  <button
                    type="button"
                    onClick={() => markPersonalQuorum(c.address)}
                    className="w-full px-1 text-left text-[11px] text-ink/40 underline decoration-ink/20 transition hover:text-ink/70"
                  >
                    {t('This is my reinforced personal account, not a Legacy — keep it with my wallets')}
                  </button>
                )}
              </div>
            );
          })}
        </WalletCardsGrid>
        </div>
      )}

      {managingLegacy && (
        <LegacyManageDialog
          key={managingLegacy.address}
          legacy={managingLegacy}
          nickname={nicknameOf(managingLegacy)}
          busy={busy}
          onClose={() => setManaging(null)}
          onRename={(name) => saveNickname(managingLegacy, name)}
          onRemove={() => removeObserved(managingLegacy)}
        />
      )}
    </div>
  );
}

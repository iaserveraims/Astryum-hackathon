'use client';

/**
 * MyLegaciesList — the "Mis Legacies" home (redesigned 2026-07-16, founder ask;
 * data layer unified 2026-07-18 with the authority switcher).
 *
 * Simple, basic, well-structured: a grid of Legacy cards + ONE way in
 * ("Constituir un nuevo Legacy" → the slide wizard). The old standalone
 * artifacts are gone from this page by design:
 *   - "Observe a Legacy you govern" lives INSIDE the wizard's first slide
 *     (opening an address remembers it here — observing IS opening).
 *   - "Discover your Legacy" (the discovery chat) moved into the wizard too.
 *
 * The cards: a nickname, the identity of the Legacy (address, council shape,
 * health), NO capital figures, and NO Open button — the whole card is the button.
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
import { useCallback, useState } from 'react';
import { ArrowLeftRight, Check, ExternalLink, Landmark, Loader2, Pencil, Plus, RefreshCw, ScrollText, Users, X } from 'lucide-react';
import { Card, EmptyState, GhostButton, PageHeader, Pill, PrimaryButton } from '../ui/primitives';
import { RevealGroup, RevealItem } from '../ui/motion';
import { useT } from '../../i18n/LanguageProvider';
import { governedAccountsApi, type LegacyHealth } from '../../services/v1Api';
import { useAuthorities, invalidateAuthorityCache } from '../../hooks/useAuthorities';
import type { GovernedAuthority } from '../../lib/authority';
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
  // Nickname editing. Registry label is the portable name; legacyLocal is
  // kept in sync so the wizard's local readers agree.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshAll = useCallback(() => {
    invalidateAuthorityCache();
    reload();
  }, [reload]);

  const saveNickname = useCallback(
    async (c: GovernedAuthority) => {
      const name = draft.trim();
      setBusy(true);
      try {
        if (c.registryId) await governedAccountsApi.rename(c.registryId, name || null);
        setLegacyNickname(c.address, name);
        setEditing(null);
        refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [draft, refreshAll],
  );

  const removeObserved = useCallback(
    async (c: GovernedAuthority) => {
      if (!c.registryId) return;
      setBusy(true);
      try {
        await governedAccountsApi.remove(c.registryId);
        forgetLegacy(c.address);
        refreshAll();
      } finally {
        setBusy(false);
      }
    },
    [refreshAll],
  );

  const nicknameOf = (c: GovernedAuthority): string | undefined =>
    c.label || getLegacyNickname(c.address) || undefined;

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
        // The cards settle in one after another (immersion pass 2026-08-04) —
        // the same house cascade every page already speaks.
        <RevealGroup className="grid gap-3 sm:grid-cols-2">
          {legacies.map((c) => {
            const nickname = nicknameOf(c);
            const isEditing = editing === c.address;
            return (
              // Two doors per card (founder ask 2026-07-19): you choose the
              // Constitution or the Governance of this Legacy BEFORE entering.
              <RevealItem key={c.address} className="group rounded-2xl">
              <Card className="p-4 transition hover:border-ink/25 hover:bg-ink/[0.04]">
                <div className="space-y-2.5">
                  {/* Identity: nickname big, address small — never capital. */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {isEditing ? (
                        <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveNickname(c);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            placeholder={t('Nickname')}
                            className="w-40 rounded-lg border border-ink/15 bg-ink/5 px-2 py-1 text-sm text-ink outline-none focus:border-ink/30"
                          />
                          <button
                            type="button"
                            onClick={() => void saveNickname(c)}
                            disabled={busy}
                            className="text-tone-success hover:text-tone-success/80"
                            aria-label={t('Save nickname')}
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                        </span>
                      ) : (
                        <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold text-ink">
                          <span className="truncate">{nickname ?? t('Unnamed Legacy')}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraft(nickname ?? '');
                              setEditing(c.address);
                            }}
                            className="shrink-0 rounded text-ink/25 transition hover:text-ink/70 focus-visible:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                            aria-label={t('Edit nickname')}
                          >
                            <Pencil size={12} />
                          </button>
                        </p>
                      )}
                      <p className="mt-0.5 font-mono text-[11px] text-ink/45">{shortAddr(c.address)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.source === 'connected' && <Pill tone="info">{t('connected')}</Pill>}
                      <a
                        className="text-ink/35 hover:text-ink/70"
                        href={`${XRPSCAN_ACCOUNT}${c.address}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t('View on XRPScan')}
                      >
                        <ExternalLink size={13} />
                      </a>
                      {c.registryId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeObserved(c);
                          }}
                          disabled={busy}
                          className="text-ink/30 hover:text-ink/70"
                          aria-label={t('Remove from list')}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* What this Legacy IS: council shape + where it stands. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.loading ? (
                      <Loader2 size={14} className="animate-spin text-ink/40" />
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

                  {/* The three doors: pick where to go before entering. Layout
                      2+1 like a personal wallet card — Movements is the verb
                      you reach for most, so it gets its own full-width row.
                      The labels are the SURFACE names (Constitute / Govern —
                      renamed 2026-08-04): "Constitution" promised the document
                      and delivered the whole ceremony. A door says where the
                      door goes. */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onSelect(c.address, 'constitute')}
                      aria-label={`${t('Constitute')} · ${nickname ?? shortAddr(c.address)}`}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-ink/12 bg-ink/[0.03] px-2.5 py-2 text-[13px] text-ink/70 transition hover:border-ink/25 hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                    >
                      <ScrollText size={14} /> {t('Constitute')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(c.address, 'govern')}
                      aria-label={`${t('Govern')} · ${nickname ?? shortAddr(c.address)}`}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-volt/25 bg-volt/[0.08] px-2.5 py-2 text-[13px] text-ink/80 transition hover:border-volt/45 hover:bg-volt/[0.14] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                    >
                      <Landmark size={14} /> {t('Govern')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect(c.address, 'govern', 'movements')}
                      aria-label={`${t('Movements')} · ${nickname ?? shortAddr(c.address)}`}
                      className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-ink/12 bg-ink/[0.03] px-2.5 py-2 text-[13px] text-ink/70 transition hover:border-ink/25 hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                    >
                      <ArrowLeftRight size={14} /> {t('Movements')}
                    </button>
                  </div>
                </div>
              </Card>
              </RevealItem>
            );
          })}
        </RevealGroup>
      )}
    </div>
  );
}

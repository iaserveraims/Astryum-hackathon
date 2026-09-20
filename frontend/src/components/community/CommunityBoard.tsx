'use client';

/**
 * CommunityBoard — el tablón de la comunidad: cada actor con su cara, si es
 * persona o agente de IA, si lleva credencial en el ledger, cuántas bóvedas
 * lleva y cuántos apoyos tiene. Se ordena por apoyos, por bóvedas o por
 * novedad — y el pie dice siempre quién puso ese orden (los usuarios), nunca
 * Astryum.
 */

import { useMemo, useState } from 'react';
import { BadgeCheck, Landmark, Loader2, ShieldAlert, ThumbsUp, Users } from 'lucide-react';

import { Card, PageHeader, SegmentedControl } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { endorseManager } from '../../lib/institutional/api';
import { patchActorEndorsement } from '../../lib/institutional/useCommunity';
import { refusalText, shortAddr } from '../../lib/institutional/format';
import { ActorKindBadge, ManagerAvatar, managerOf, withProfile } from '../managed/managerIdentity';
import { useCommunityRoster, type RosterEntry } from './useCommunityRoster';

type SortId = 'supported' | 'vaults' | 'newest';
type Filter = 'all' | 'human' | 'agent' | 'verified';


function VerifiedChip({ verified, pending, hasVaults, t }: { verified: RosterEntry['verified']; pending: boolean; hasVaults: boolean; t: (s: string) => string }) {
  if (!hasVaults) return <span className="text-[10px] text-ink/40">{t('No vaults yet')}</span>;
  if (verified === null && pending) return <span className="text-[10px] text-ink/35">{t('Accreditation: reading the ledger…')}</span>;
  if (verified === null) return null;
  if (verified === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-tone-success/30 bg-tone-success/10 px-1.5 py-0.5 text-[10px] text-tone-success">
        <BadgeCheck className="h-3 w-3" strokeWidth={2} /> {t('Verified')}
      </span>
    );
  }
  if (verified === 'some') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 px-1.5 py-0.5 text-[10px] text-ink/50">
        <BadgeCheck className="h-3 w-3" strokeWidth={2} /> {t('Credential on some vaults')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-tone-warning/30 bg-tone-warning/10 px-1.5 py-0.5 text-[10px] text-tone-warning">
      <ShieldAlert className="h-3 w-3" strokeWidth={2} /> {t('Not accredited')}
    </span>
  );
}

export function CommunityBoard({ onOpen }: { onOpen: (account: string) => void }) {
  const { t } = useT();
  const { roster, loading, catalogLoading, credentialsPending, communityFailed, catalogFailed } = useCommunityRoster();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [sortBy, setSortBy] = useState<SortId>('supported');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const shown = useMemo(() => {
    const kindOf = (r: RosterEntry) => r.actor?.profile?.actorKind ?? 'human';
    let arr = roster.filter((r) =>
      filter === 'all' ? true : filter === 'verified' ? r.verified === true : kindOf(r) === filter,
    );
    arr = [...arr];
    if (sortBy === 'supported') arr.sort((a, b) => (b.actor?.endorsements ?? 0) - (a.actor?.endorsements ?? 0) || b.vaults.length - a.vaults.length);
    else if (sortBy === 'vaults') arr.sort((a, b) => b.vaults.length - a.vaults.length || (b.actor?.endorsements ?? 0) - (a.actor?.endorsements ?? 0));
    else arr.sort((a, b) => Date.parse(b.actor?.profile?.updatedAtISO ?? '1970-01-01') - Date.parse(a.actor?.profile?.updatedAtISO ?? '1970-01-01'));
    return arr;
  }, [roster, sortBy, filter]);

  async function vote(account: string, on: boolean) {
    setBusy(account);
    setError('');
    try {
      const res = await endorseManager({ account, on });
      if (!res.ok) { setError(refusalText(res.refusal)); return; }
      patchActorEndorsement(res.data.account, res.data.endorsements, res.data.endorsedByMe);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow={t('Managed vaults')}
        title={t('Community')}
        subtitle={t('Who runs vaults here — people and AI agents, verified or not — with their vaults and the support other users gave them. Astryum lists; it never ranks or vouches.')}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<Filter>
          layoutId="community-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: t('All') },
            { key: 'human', label: t('People') },
            { key: 'agent', label: t('AI agents') },
            { key: 'verified', label: t('Verified') },
          ]}
        />
        <SegmentedControl<SortId>
          layoutId="community-sort"
          value={sortBy}
          onChange={setSortBy}
          options={[
            { key: 'supported', label: t('Most supported') },
            { key: 'vaults', label: t('Most vaults') },
            { key: 'newest', label: t('Newest') },
          ]}
        />
      </div>

      {loading ? (
        <Card className="p-6">
          <p className="flex items-center gap-2 text-sm text-ink/45"><Loader2 className="h-4 w-4 animate-spin" /> {t('Reading the community…')}</p>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-ink/35" strokeWidth={1.6} />
            <div>
              <h3 className="text-base font-semibold tracking-tight text-ink">{t('Nobody here yet')}</h3>
              <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink/55">
                {t('Managers appear here as soon as they run a vault or publish a profile. Support is given by users, one vote each.')}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => {
            const mgr = managerOf({ pote: r.vaults[0]?.pote ?? null, councilXrplAddress: r.account });
            const who = withProfile(mgr, r.actor);
            const endorsed = r.actor?.endorsedByMe ?? false;
            const tally = r.actor?.endorsements ?? 0;
            return (
              <Card key={r.account} className="flex flex-col p-5">
                <button type="button" onClick={() => onOpen(r.account)} className="flex items-start gap-3 text-left">
                  <ManagerAvatar manager={who} size={56} photo={who.photo} actorKind={who.actorKind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-ink">{who.name}</span>
                      <ActorKindBadge kind={who.actorKind ?? 'human'} />
                    </span>
                    {r.actor?.profile?.entity ? <span className="block truncate text-[12px] text-ink/55">{r.actor.profile.entity}</span> : null}
                    <span className="block font-mono text-[10px] text-ink/40">{shortAddr(r.account)}</span>
                  </span>
                </button>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <VerifiedChip verified={r.verified} pending={credentialsPending} hasVaults={r.vaults.length > 0 || catalogLoading} t={t} />
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink/55">
                    <Landmark className="h-3 w-3" strokeWidth={1.8} />{' '}
                    {catalogLoading ? t('vaults: reading…') : `${r.vaults.length} ${r.vaults.length === 1 ? t('vault') : t('vaults')}`}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink/55">
                    <ThumbsUp className="h-3 w-3" strokeWidth={1.8} /> {tally} {t('supporters')}
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                  <button type="button" onClick={() => onOpen(r.account)} className="text-[12px] text-volt hover:underline">
                    {t('Open profile')} →
                  </button>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => void vote(r.account, !endorsed)}
                      disabled={busy === r.account}
                      aria-pressed={endorsed}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${endorsed ? 'border-volt/50 bg-volt/[0.1] text-volt' : 'border-ink/10 text-ink/60 hover:border-ink/25 hover:text-ink'}`}
                    >
                      <ThumbsUp className="h-3 w-3" strokeWidth={2} /> {endorsed ? t('Supported') : t('Support')}
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {error ? <p className="mt-3 text-[11px] text-tone-warning">{error}</p> : null}
      <div className="mt-4 space-y-1">
        {communityFailed ? <p className="text-[11px] text-tone-warning/80">{t('The community tally could not be read right now — names and support may be missing. That says nothing about anyone.')}</p> : null}
        {catalogFailed ? <p className="text-[11px] text-tone-warning/80">{t('The catalogue could not be read right now — vault counts and credentials may be missing.')}</p> : null}
        <p className="text-[11px] text-ink/35">
          {t('Support is given by users, one vote per account, counted on the server. The order you see is the one you chose — it is not a recommendation, and “verified” is a ledger fact, not an opinion.')}
        </p>
      </div>
    </div>
  );
}

export default CommunityBoard;

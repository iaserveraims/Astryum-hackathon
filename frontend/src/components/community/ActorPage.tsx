'use client';

/**
 * ActorPage — la PÁGINA de un actor de la comunidad. Su cara, si es persona o agente, su
 * perfil público con los hechos del ledger, las bóvedas que lleva y el apoyo
 * de la comunidad. La foto es LA del perfil público — la misma en todas partes.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, ExternalLink, Landmark, ThumbsUp } from 'lucide-react';

import { GhostButton, MicroLabel, PageHeader, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { endorseManager } from '../../lib/institutional/api';
import { patchActorEndorsement } from '../../lib/institutional/useCommunity';
import { fmtExitWindow, refusalText, shortAddr } from '../../lib/institutional/format';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import { ActorKindBadge, ManagerAvatar, managerOf, withProfile } from '../managed/managerIdentity';
import { ManagerPublicProfile } from '../managed/ManagerPublicProfile';
import { VaultTile } from '../managed/VaultTile';
import { useCommunityRoster } from './useCommunityRoster';

const XRPL_EXPLORER = 'https://xrpscan.com/account/';

export function ActorPage({ account, onBack }: { account: string; onBack: () => void }) {
  const { t } = useT();
  const { roster, catalogLoading } = useCommunityRoster();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const row = roster.find((r) => r.account === account) ?? null;
  const mgr = managerOf({ pote: row?.vaults[0]?.pote ?? null, councilXrplAddress: account });
  const who = withProfile(mgr, row?.actor ?? null);
  const endorsed = row?.actor?.endorsedByMe ?? false;
  const tally = row?.actor?.endorsements ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function vote(on: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await endorseManager({ account, on });
      if (!res.ok) { setError(refusalText(res.refusal)); return; }
      patchActorEndorsement(res.data.account, res.data.endorsements, res.data.endorsedByMe);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    const url = `${window.location.origin}/app/community?actor=${encodeURIComponent(account)}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2500); }, () => undefined);
  }

  return (
    <div className="max-w-4xl">
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink/50 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {t('Back to community')}
      </button>
      <PageHeader
        eyebrow={t('Community')}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <ManagerAvatar manager={who} size={80} photo={who.photo} actorKind={who.actorKind} />
            <span className="flex flex-wrap items-center gap-2">
              <span>{who.name}</span>
              <ActorKindBadge kind={who.actorKind ?? 'human'} />
            </span>
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-3">
            <a href={`${XRPL_EXPLORER}${account}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink/50 hover:text-ink/80">
              {shortAddr(account)} <ExternalLink className="h-3 w-3" />
            </a>
            <span className="inline-flex items-center gap-1 text-[12px] text-ink/60">
              <ThumbsUp className="h-3.5 w-3.5 text-volt" strokeWidth={2} /> {tally} {t('supporters')}
            </span>
          </span>
        }
      />

      {/* El apoyo: un voto por usuario, contado en el servidor. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {!isAuthenticated ? (
          <p className="text-[12px] text-ink/45">{t('Log in to support this manager.')}</p>
        ) : endorsed ? (
          <GhostButton onClick={() => void vote(false)} disabled={busy}><ThumbsUp className="mr-1.5 inline h-3.5 w-3.5" /> {t('Supported by you — withdraw')}</GhostButton>
        ) : (
          <PrimaryButton onClick={() => void vote(true)} disabled={busy}><ThumbsUp className="mr-1.5 inline h-3.5 w-3.5" /> {t('Support this manager')}</PrimaryButton>
        )}
        <GhostButton onClick={copyLink}><Copy className="mr-1.5 inline h-3.5 w-3.5" /> {copied ? t('Link copied') : t('Copy profile link')}</GhostButton>
        {error ? <p className="text-[11px] text-tone-warning">{error}</p> : null}
      </div>

      {/* El perfil público: auto-declarado + hechos del ledger (misma pieza que en Earn). */}
      <ManagerPublicProfile account={account} />

      {/* Sus bóvedas, con la imagen que eligió para cada una. */}
      <div className="mt-5">
        <MicroLabel>{t('The vaults this manager runs')}</MicroLabel>
        {catalogLoading ? (
          <p className="mt-2 text-[12px] text-ink/45">{t('Reading the catalogue from the chain…')}</p>
        ) : !row || row.vaults.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink/45">{t('No open vaults right now.')}</p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {row.vaults.map((v) => (
              <li key={v.pote}>
                <Link
                  href={`/app/asset-production?view=managers&manager=${encodeURIComponent(account)}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2.5 transition-colors hover:border-volt/35 hover:bg-volt/[0.04]"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ink/10">
                      <VaultTile entry={v} manager={mgr} size={22} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{v.name ?? shortAddr(v.pote)}</span>
                      <span className="block text-[11px] text-ink/40">{(v.asset?.symbol ?? '—') + ' · ' + t('exit') + ' ' + fmtExitWindow(v.cooldownSeconds, t)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ink/60">
                    {v.totalAssets != null && v.asset ? `${fmtBase(v.totalAssets, v.asset.decimals)} ${v.asset.symbol}` : '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex items-center gap-1 text-[11px] text-ink/35">
          <Landmark className="h-3 w-3" strokeWidth={1.8} /> {t('Vaults, capital and accreditation are chain facts, not results. Astryum lists them; it never manages and never recommends one.')}
        </p>
      </div>
    </div>
  );
}

export default ActorPage;

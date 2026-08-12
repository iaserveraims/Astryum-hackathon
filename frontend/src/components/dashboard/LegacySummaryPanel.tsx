'use client';

/**
 * LegacySummaryPanel — the Legacy product's hero in Summary (coherence phase,
 * plan 2026-07-18). When the dashboard operates as Legacy, the first organism
 * answers "what is the Legacy I have loaded", read LIVE from the ledger:
 * capital under rules, spendable after reserves, programmed transfers, and
 * the council with its health. Astryum stores nothing about it (L1).
 *
 * The rest of the Summary stays identical (founder: same skeleton, two
 * suits) — this panel is the ADDED particularity, not a replacement.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, Landmark, Users } from 'lucide-react';
import { Card, HairlineCell, HairlineGroup, MicroLabel, Pill } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { fmtQtyActive } from '../../lib/format';
import { useAuthorityAccount } from '../../lib/authority/useAuthorityAccount';
import {
  xrplLegacy,
  xrplSavings,
  type LegacyHealth,
  type RehearsalStatus,
  type XrplEscrowRow,
  type XrplSpendable,
} from '../../services/v1Api';
import { headlineLabel, healthTone } from '../legacy/MyLegaciesList';

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

function fmtXrp(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtQtyActive(n, 2); // app-locale aware (Fase 3; was en-US pinned)
}

/** Next future release among the escrows, if any. */
function nextRelease(escrows: XrplEscrowRow[]): Date | null {
  const now = Date.now();
  const future = escrows
    .map((e) => (e.finishAfterISO ? new Date(e.finishAfterISO).getTime() : NaN))
    .filter((tms) => Number.isFinite(tms) && tms > now)
    .sort((a, b) => a - b);
  return future.length > 0 ? new Date(future[0]) : null;
}

export default function LegacySummaryPanel() {
  const { t, lang } = useT();
  const { productMode, active } = useAuthorityAccount();

  const governed = productMode === 'legacy' && active?.kind === 'governed' ? active : null;
  const address = governed?.address ?? null;

  const [spendable, setSpendable] = useState<XrplSpendable | null>(null);
  const [escrows, setEscrows] = useState<XrplEscrowRow[] | null>(null);
  const [rehearsal, setRehearsal] = useState<RehearsalStatus | null>(null);
  const [health, setHealth] = useState<LegacyHealth | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    setSpendable(null);
    setEscrows(null);
    setRehearsal(null);
    setHealth(null);
    setFailed(false);
    void Promise.allSettled([xrplSavings.escrows(address), xrplLegacy.rehearsalStatus(address)]).then(
      ([esc, reh]) => {
        if (!alive) return;
        if (esc.status === 'fulfilled') {
          setEscrows(esc.value.escrows);
          setSpendable(esc.value.account);
        }
        if (reh.status === 'fulfilled') {
          setRehearsal(reh.value.status);
          setHealth(reh.value.health);
        }
        if (esc.status === 'rejected' && reh.status === 'rejected') setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [address]);

  // Legacy mode with nothing loaded: the tab is where a Legacy is constituted.
  if (!governed) {
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-volt/15 text-volt" aria-hidden>
              <Landmark size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{t('No Legacy loaded')}</p>
              <p className="text-[12px] text-ink/50">
                {t('Constitute one — or observe one you govern — and it will live here.')}
              </p>
            </div>
          </div>
          <Link
            href="/app/legacy"
            className="inline-flex items-center gap-1.5 rounded-lg bg-volt px-3.5 py-2 text-[13px] font-semibold text-volt-ink hover:brightness-105"
          >
            {t('Open Legacy')} <ArrowRight size={14} />
          </Link>
        </div>
      </Card>
    );
  }

  const release = escrows ? nextRelease(escrows) : null;

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Identity band: which Legacy is loaded, its health, one way in. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5 pb-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-volt/15 text-volt" aria-hidden>
          <Landmark size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">
            {governed.nickname ?? t('Unnamed Legacy')}
          </p>
          <p className="font-mono text-[11px] text-ink/40">{shortAddr(governed.address)}</p>
        </div>
        {health && <Pill tone={healthTone(health.level)}>{headlineLabel(health.headline, t)}</Pill>}
        {failed && <Pill tone="warning">{t('could not read')}</Pill>}
        <Link
          href="/app/legacy"
          className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink/50 hover:text-ink"
        >
          {t('Open Legacy')} <ArrowRight size={13} />
        </Link>
      </div>

      {/* The ledger facts, one breath: capital · spendable · programmed · council. */}
      <HairlineGroup columns="sm:grid-cols-2 lg:grid-cols-4">
        <HairlineCell className="p-5">
          <MicroLabel>{t('Capital under rules')}</MicroLabel>
          <p className="mt-1.5 font-mono text-xl text-ink leading-none">
            {escrows === null && !failed ? '…' : `${fmtXrp(spendable?.balanceXrp)} XRP`}
          </p>
        </HairlineCell>
        <HairlineCell className="p-5">
          <MicroLabel>{t('Spendable after reserves')}</MicroLabel>
          <p className="mt-1.5 font-mono text-xl text-ink leading-none">
            {escrows === null && !failed ? '…' : `${fmtXrp(spendable?.spendableXrp)} XRP`}
          </p>
        </HairlineCell>
        <HairlineCell className="p-5">
          <MicroLabel>{t('Programmed transfers')}</MicroLabel>
          <p className="mt-1.5 flex items-center gap-1.5 text-ink">
            <CalendarClock size={14} className="text-ink/40" aria-hidden />
            <span className="font-mono text-xl leading-none">{escrows === null ? '…' : escrows.length}</span>
          </p>
          {release && (
            <p className="mt-1 text-[11px] text-ink/40">
              {t('next')}: {release.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US')}
            </p>
          )}
        </HairlineCell>
        <HairlineCell className="p-5">
          <MicroLabel>{t('Council')}</MicroLabel>
          <p className="mt-1.5 flex items-center gap-1.5 text-ink">
            <Users size={14} className="text-ink/40" aria-hidden />
            <span className="font-mono text-xl leading-none">
              {rehearsal === null ? '…' : rehearsal.hasCouncil ? rehearsal.memberCount : 0}
            </span>
            <span className="text-[11px] text-ink/45">{t('signers')}</span>
          </p>
          {rehearsal?.hasCouncil && (
            <p className="mt-1 text-[11px] text-ink/40">
              {rehearsal.signedCount}/{rehearsal.memberCount} {t('rehearsed')}
            </p>
          )}
        </HairlineCell>
      </HairlineGroup>

      {/* The product's verb, said once and honestly. */}
      <p className="border-t border-ink/[0.05] px-6 py-3 text-[11px] text-ink/40">
        {t('In this product you propose — the council signs. Astryum never signs, never holds custody.')}
      </p>
    </Card>
  );
}

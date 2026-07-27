'use client';

/**
 * LegacyActivityFeed — the "Actividad" section of Governance (founder ask
 * 2026-07-19): ONE interactive feed that gives constancia of everything a
 * Legacy has done and what still works.
 *
 * It AGGREGATES, read-first, from the sources that already exist — it never
 * invents entries, and it never moves the creation forms out of their sections
 * (proposals are created in Proposals, rules in MoneyFlows). Here you SEE:
 *   · council proposals (signed on XRPL / live / emitted / expired),
 *   · governed rules (active, nearing their 90-day TTL, expired),
 *   · programmed commitments (escrows) on the ledger,
 *   · constitution anchors/amendments.
 *
 * Every entry is clickable → on-chain detail — and where an action is honest
 * WITHOUT re-implementing the Xaman signing stack, it lives INSIDE the row:
 *   · a rule nearing/past its 90 days → renew (+90d) or pause/resume,
 *   · a live proposal → go sign it (jumps to the inbox) or withdraw,
 *   · a council order emitted → read its Flare execution status (FDC).
 * The heavy multisig signing itself stays in the Proposal inbox (single source
 * of the signing machinery — never duplicated here).
 *
 * Honest surface (invariant): nothing here signs, combines or broadcasts. The
 * feed shows only what the ledger / backend actually back.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  PenLine,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Undo2,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, Pill, SectionTitle } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import {
  councilProposalsApi,
  rules as rulesApi,
  xrplLegacy,
  xrplSavings,
  type AutomationRule,
  type ConstitutionAmendment,
  type CouncilProposalRecord,
  type XrplEscrowRow,
} from '../../services/v1Api';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const RENEW_DAYS = 90;
const TTL_WARN_DAYS = 14; // a rule this close to its 90-day expiry is "nearing"

type FeedKind = 'proposal' | 'rule' | 'commitment' | 'constitution';
type FeedFilter = 'all' | 'active' | 'signed';

interface FeedEntry {
  key: string;
  kind: FeedKind;
  chain: 'XRPL' | 'Flare';
  title: string;
  subtitle?: string;
  at: number; // ms — sort key (most recent first)
  active: boolean; // still functioning / live
  signed: boolean; // settled on-chain (history)
  txHash?: string | null;
  proposal?: CouncilProposalRecord;
  rule?: AutomationRule;
  commitment?: XrplEscrowRow;
  amendment?: ConstitutionAmendment;
}

function parseTime(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return isFinite(t) ? t : 0;
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

function fmtWhen(ms: number, t: (s: string) => string): string {
  if (!ms) return t('—');
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(ms);
  }
}

const KIND_ICON: Record<FeedKind, typeof Lock> = {
  proposal: PenLine,
  rule: CalendarClock,
  commitment: Lock,
  constitution: ScrollText,
};

const KIND_LABEL: Record<FeedKind, string> = {
  proposal: 'Council proposal',
  rule: 'Governed rule',
  commitment: 'Programmed commitment',
  constitution: 'Constitution',
};

/** Flare execution status for an emitted council order — read lazily on expand.
 *  A submitted proposal that is NOT a council order simply returns nothing; we
 *  stay silent rather than claim a Flare leg that never existed. */
function FlareLeg({ txHash }: { txHash: string }) {
  const { t } = useT();
  const [state, setState] = useState<{ loading: boolean; executed?: boolean; flareTxHash?: string | null; none?: boolean }>({
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    xrplLegacy
      .councilOrderStatus(txHash)
      .then((st) => {
        if (!alive) return;
        // Only assert a Flare leg with POSITIVE evidence: a relay record exists,
        // or the bridge already consumed the order (executed). A plain Payment
        // (programmed transfer, scheduled council payment) has neither → silent.
        const isOrder = !!st && (st.relay !== null || st.executed === true);
        if (!isOrder) return setState({ loading: false, none: true });
        setState({ loading: false, executed: !!st.executed, flareTxHash: st.relay?.flareTxHash ?? null });
      })
      .catch(() => alive && setState({ loading: false, none: true }));
    return () => {
      alive = false;
    };
  }, [txHash]);
  if (state.loading) {
    return (
      <p className="text-[12px] text-ink/45">
        <Loader2 size={12} className="mr-1 inline animate-spin" /> {t('Reading the Flare execution…')}
      </p>
    );
  }
  if (state.none) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink/50">{t('Flare (FDC):')}</span>
      {state.executed ? (
        <Pill tone="success">
          <Check size={11} /> {t('executed in the cage')}
        </Pill>
      ) : (
        <Pill tone="warning">
          <Loader2 size={11} className="animate-spin" /> {t('FDC round in progress')}
        </Pill>
      )}
      {state.flareTxHash && (
        <a
          href={`https://flare-explorer.flare.network/tx/${state.flareTxHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-ink/55 underline hover:text-ink/80"
        >
          <ExternalLink size={11} className="mr-0.5 inline" /> Flare tx
        </a>
      )}
    </div>
  );
}

export default function LegacyActivityFeed({
  account,
  onGoToProposals,
}: {
  account: string;
  /** Jump to the Proposals section (where the signing machinery lives). */
  onGoToProposals?: () => void;
}) {
  const { t } = useT();
  const [proposals, setProposals] = useState<CouncilProposalRecord[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [commitments, setCommitments] = useState<XrplEscrowRow[]>([]);
  const [amendments, setAmendments] = useState<ConstitutionAmendment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [props, rls, escr, cons] = await Promise.all([
        councilProposalsApi.list([account]).then((r) => r.proposals).catch(() => [] as CouncilProposalRecord[]),
        rulesApi.list(account).then((r) => r.rules).catch(() => [] as AutomationRule[]),
        xrplSavings.escrows(account).then((r) => r.escrows).catch(() => [] as XrplEscrowRow[]),
        xrplLegacy.constitution(account).then((r) => r.history).catch(() => [] as ConstitutionAmendment[]),
      ]);
      setProposals(props);
      setRules(rls);
      setCommitments(escr);
      setAmendments(cons);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── build the unified timeline ──
  const entries = useMemo<FeedEntry[]>(() => {
    const out: FeedEntry[] = [];

    for (const p of proposals) {
      const live = p.status === 'collecting' || p.status === 'ready';
      const emitted = p.status === 'submitted';
      out.push({
        key: `proposal:${p.id}`,
        kind: 'proposal',
        chain: 'XRPL',
        title: p.title || p.txType,
        subtitle:
          p.status === 'collecting'
            ? t('collecting signatures')
            : p.status === 'ready'
              ? t('ready to emit')
              : p.status === 'submitted'
                ? t('emitted on-chain')
                : p.status === 'expired'
                  ? t('expired')
                  : t('withdrawn'),
        at: parseTime(p.txHash ? p.expiresAt : p.createdAt) || parseTime(p.createdAt),
        active: live,
        signed: emitted,
        txHash: p.txHash,
        proposal: p,
      });
    }

    for (const r of rules) {
      const dLeft = daysUntil(r.expiresAt);
      const expired = dLeft !== null && dLeft <= 0;
      out.push({
        key: `rule:${r.id}`,
        kind: 'rule',
        chain: 'XRPL',
        title: r.name,
        subtitle: expired
          ? t('expired — renew to keep watching')
          : !r.enabled
            ? t('paused')
            : dLeft !== null && dLeft <= TTL_WARN_DAYS
              ? `${t('nearing its 90-day limit —')} ${dLeft} ${t('days left')}`
              : t('watching'),
        at: parseTime(r.createdAt),
        active: r.enabled && !expired,
        signed: false,
        rule: r,
      });
    }

    for (const c of commitments) {
      out.push({
        key: `commitment:${c.previousTxnID ?? c.destination ?? Math.random()}`,
        kind: 'commitment',
        chain: 'XRPL',
        title: `${c.amount} ${c.currency}`,
        subtitle: c.destination ? `→ ${c.destination.slice(0, 8)}…${c.destination.slice(-4)}` : undefined,
        at: parseTime(c.finishAfterISO),
        active: true, // an escrow on the ledger is live capital
        signed: true, // it exists because a tx created it
        txHash: c.previousTxnID,
        commitment: c,
      });
    }

    for (const a of amendments) {
      out.push({
        key: `constitution:${a.txHash}`,
        kind: 'constitution',
        chain: 'XRPL',
        title: t('Constitution anchored'),
        subtitle: a.signedByQuorum ? t('quorum-signed') : t('single signature'),
        at: parseTime(a.dateISO),
        active: false,
        signed: true,
        txHash: a.txHash,
        amendment: a,
      });
    }

    return out.sort((x, y) => y.at - x.at);
  }, [proposals, rules, commitments, amendments, t]);

  const shown = entries.filter((e) => (filter === 'active' ? e.active : filter === 'signed' ? e.signed : true));
  const counts = {
    all: entries.length,
    active: entries.filter((e) => e.active).length,
    signed: entries.filter((e) => e.signed).length,
  };

  // ── inline actions (the honest, signature-free ones) ──
  const renewRule = useCallback(
    async (r: AutomationRule) => {
      setActingKey(`rule:${r.id}`);
      setActionError(null);
      try {
        await rulesApi.update(r.id, {
          expiresAt: new Date(Date.now() + RENEW_DAYS * 86_400_000).toISOString(),
          enabled: true,
        });
        await reload();
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setActingKey(null);
      }
    },
    [reload],
  );

  const toggleRule = useCallback(
    async (r: AutomationRule) => {
      setActingKey(`rule:${r.id}`);
      setActionError(null);
      try {
        await (r.enabled ? rulesApi.disable(r.id) : rulesApi.enable(r.id));
        await reload();
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setActingKey(null);
      }
    },
    [reload],
  );

  const withdrawProposal = useCallback(
    async (p: CouncilProposalRecord) => {
      setActingKey(`proposal:${p.id}`);
      setActionError(null);
      try {
        await councilProposalsApi.withdraw(p.id);
        await reload();
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setActingKey(null);
      }
    },
    [reload],
  );

  const filterTab = (id: FeedFilter, label: string, n: number) => (
    <button
      key={id}
      onClick={() => setFilter(id)}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
        filter === id
          ? 'border-ink/25 bg-ink/[0.08] text-ink/85'
          : 'border-ink/10 bg-ink/[0.02] text-ink/45 hover:text-ink/70'
      }`}
    >
      {label} <span className="text-ink/40">· {n}</span>
    </button>
  );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <RotateCw size={16} className="text-ink/50" />
        <SectionTitle>{t('Activity')}</SectionTitle>
        <div className="ml-auto">
          <GhostButton onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('Refresh')}
          </GhostButton>
        </div>
      </div>
      <p className="text-[12px] text-ink/50">
        {t(
          'Everything this Legacy has signed on XRPL and Flare, and everything still running — one record. Open any entry for its on-chain proof and the actions it still allows.',
        )}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {filterTab('all', t('All'), counts.all)}
        {filterTab('active', t('Active now'), counts.active)}
        {filterTab('signed', t('Signed (history)'), counts.signed)}
      </div>

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
      {actionError && <InlineNotice tone="warning">{actionError}</InlineNotice>}

      {shown.length === 0 && !loading ? (
        <EmptyState
          bare
          icon={<RotateCw size={20} />}
          title={t('Nothing here yet')}
          hint={t('As you create proposals, rules and commitments, they land in this record — with their on-chain proof.')}
        />
      ) : (
        <ul className="space-y-1.5">
          {shown.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const open = openKey === e.key;
            const dLeft = e.rule ? daysUntil(e.rule.expiresAt) : e.proposal ? daysUntil(e.proposal.expiresAt) : null;
            return (
              <li key={e.key} className="rounded-lg border border-ink/10 bg-ink/[0.02]">
                {/* the row — clickable to expand */}
                <button
                  onClick={() => setOpenKey(open ? null : e.key)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Icon size={15} className="shrink-0 text-ink/45" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink/85">{e.title}</span>
                      <Pill tone={e.active ? 'success' : e.signed ? 'neutral' : 'warning'}>
                        {e.active ? t('active') : e.signed ? t('signed') : t('closed')}
                      </Pill>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink/40">
                      <span>{t(KIND_LABEL[e.kind])}</span>
                      <span>·</span>
                      <span>{e.chain}</span>
                      {e.subtitle && (
                        <>
                          <span>·</span>
                          <span className="truncate">{e.subtitle}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink/35">{fmtWhen(e.at, t)}</span>
                  <ChevronRight size={14} className={`shrink-0 text-ink/30 transition ${open ? 'rotate-90' : ''}`} />
                </button>

                {/* the expanded detail + inline actions */}
                {open && (
                  <div className="space-y-2.5 border-t border-ink/[0.07] px-3 py-3">
                    {e.txHash && (
                      <a
                        href={`${XRPSCAN_TX}${e.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-ink/55 underline hover:text-ink/85"
                      >
                        <ExternalLink size={12} /> {t('View on XRPScan')}
                      </a>
                    )}

                    {/* proposal detail */}
                    {e.proposal && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Pill tone="neutral">{e.proposal.txType}</Pill>
                          <Pill tone={e.proposal.status === 'ready' ? 'success' : 'warning'}>
                            {e.proposal.signatures.reduce((s, x) => s + x.weight, 0)}/{e.proposal.quorum} {t('quorum')}
                          </Pill>
                          {(e.proposal.status === 'collecting' || e.proposal.status === 'ready') && dLeft !== null && (
                            <span className="flex items-center gap-1 text-[11px] text-ink/40">
                              <Clock size={11} /> {Math.max(0, dLeft)} {t('days left')}
                            </span>
                          )}
                        </div>
                        {/* Flare leg — only shows for an emitted council order */}
                        {e.proposal.status === 'submitted' && e.txHash && <FlareLeg txHash={e.txHash} />}
                        {(e.proposal.status === 'collecting' || e.proposal.status === 'ready') && (
                          <div className="flex flex-wrap items-center gap-2">
                            <GhostButton onClick={onGoToProposals}>
                              <PenLine size={13} /> {t('Go to the inbox to sign')}
                            </GhostButton>
                            <GhostButton onClick={() => void withdrawProposal(e.proposal!)} disabled={actingKey === e.key}>
                              {actingKey === e.key ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                              {t('Withdraw (proposer only)')}
                            </GhostButton>
                          </div>
                        )}
                      </div>
                    )}

                    {/* rule detail — the 90-day renew lives here */}
                    {e.rule && (
                      <div className="space-y-2">
                        <p className="text-[12px] text-ink/55">
                          {t('Fired')} {e.rule.totalTimesTriggered}× ·{' '}
                          {e.rule.expiresAt
                            ? dLeft !== null && dLeft > 0
                              ? `${t('expires in')} ${dLeft} ${t('days')}`
                              : t('expired')
                            : t('no expiry set')}
                        </p>
                        <p className="text-[11px] text-ink/40">
                          {t('The rule holds no authority — it only composes proposals; the quorum signs each one.')}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <GhostButton onClick={() => void renewRule(e.rule!)} disabled={actingKey === e.key}>
                            {actingKey === e.key ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
                            {t('Renew (+90 days)')}
                          </GhostButton>
                          <GhostButton onClick={() => void toggleRule(e.rule!)} disabled={actingKey === e.key}>
                            {e.rule.enabled ? <Clock size={13} /> : <Play size={13} />}
                            {e.rule.enabled ? t('Pause') : t('Resume')}
                          </GhostButton>
                        </div>
                      </div>
                    )}

                    {/* commitment detail */}
                    {e.commitment && (
                      <div className="space-y-1.5">
                        <p className="text-[12px] text-ink/55">
                          {t('Deliverable from')}{' '}
                          {e.commitment.finishAfterISO
                            ? new Date(e.commitment.finishAfterISO).toLocaleDateString()
                            : '—'}
                          {e.commitment.cancelAfterISO && (
                            <>
                              {' · '}
                              {t('recoverable after')} {new Date(e.commitment.cancelAfterISO).toLocaleDateString()}
                            </>
                          )}
                        </p>
                        <p className="text-[11px] text-ink/40">
                          {t('Delivery and recovery are permissionless — trigger them from the Proposals section.')}
                        </p>
                        <GhostButton onClick={onGoToProposals}>
                          <ChevronRight size={13} /> {t('Manage in Proposals')}
                        </GhostButton>
                      </div>
                    )}

                    {/* constitution detail */}
                    {e.amendment && (
                      <p className="text-[12px] text-ink/55">
                        {e.amendment.dataHex?.slice(0, 24)}… ·{' '}
                        {e.amendment.signedByQuorum ? t('signed by the quorum of its day') : t('single signature')}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

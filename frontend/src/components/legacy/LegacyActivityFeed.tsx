'use client';

/**
 * LegacyActivityFeed — the "Actividad" section of Governance (ask):
 * ONE interactive feed that gives constancia of everything a
 * Legacy has done and what still works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  describeServerRefusal,
  describeUnreadableRows,
  refusalMayRetry,
  type ReadableRefusal,
  type UnreadableRowsNotice,
} from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
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
import {
  RULE_PILL_TONE,
  UNREAD,
  isFailing,
  loadRunHealth,
  retainKnownRuns,
  rulePillState,
  type RulePillTone,
  type RunHealth as LastRun,
} from '../../lib/rules/runHealth';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';
const RENEW_DAYS = 90;
const TTL_WARN_DAYS = 14; // a rule this close to its 90-day expiry is "nearing"

/**
 * G4-residuos (auditoria §G4) — the «watching» that watches nothing.
 *
 * WHAT WAS FAILING IN SILENCE HERE: this feed decided a governed rule's state
 * from the rule ROW alone (`enabled` + `expiresAt`) and never looked at what its
 * fires actually produced. When a `councilOrder` rule cannot compose its action
 * — `NoCageForLegacy`, `NOT_A_COUNCIL`, `council_compose_failed`,
 * `scheduled_payment_invalid` — the AutomationEngine stores the run with
 * `status: 'error'` and the reason in `notes`, and then, by design (the «exito
 * no ganado» guard), does NOT increment `totalTimesTriggered` and sends NO push.
 * With no counter and no push, a rule that failed EVERY SINGLE fire rendered
 * here as «watching · expires in 87d» under a green pill — and a family read
 * that as protection.
 */

function runAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * G4-pildoras (round 3, from the G1-cadena verdict) — server refusals carry the
 * honest prose in `body.detail`; the bare `error` code is a dead end in front
 * of a family. Every action here used to render `(e as Error).message`, which
 * is the CODE: the withdraw button (a button that worked before the ledger
 * guard landed) started answering the literal string
 * `LEDGER_CHECK_UNACKNOWLEDGED`. Same reader as ProposalInbox.
 */
export function errText(e: unknown): string {
  const err = e as Error & { body?: { detail?: string | string[] } };
  const d = err?.body?.detail;
  if (Array.isArray(d)) return d.join('; ');
  return d || err?.message || 'Unexpected error';
}

/**
 * G4-pildoras / G1-cadena — IS THIS PROPOSAL'S PINNED SEAT STILL SETTLED?
 *
 * Past the deadline the server stops writing the word "expired" blind: it reads
 * XRPL and, when the pinned Sequence was already CONSUMED (the tx MAY have
 * executed) or could not be read at all, it keeps the stored status and hands
 * back `ledgerCheck` (backend/src/routes/councilProposals.ts · withEffectiveStatus).
 * `unused` is the ONLY verdict that clears a row — and the server already
 * archived that one as `expired`, so it barely travels.
 */
export function seatUnresolvedOf(p: CouncilProposalRecord): boolean {
  const live = p.status === 'collecting' || p.status === 'ready';
  return live && !!p.ledgerCheck && p.ledgerCheck.state !== 'unused';
}

/**
 * The failure line inside an expanded rule. Loud on `failed`, honest on
 * `unreadable`, silent otherwise — a healthy rule already speaks through its
 * fire count and its expiry.
 *
 * G4-pildoras — `enabled` arrived because this note never looked at
 * it: a PAUSED governed rule with an old failed run claimed «this rule is
 * armed» right beside its own Resume button. The failure still shows (it
 * happened); the tense follows the rule's actual state.
 */
function RunHealthNote({
  health,
  enabled,
  t,
}: {
  health: LastRun;
  enabled: boolean;
  t: (s: string) => string;
}) {
  if (health.state === 'failed') {
    return (
      <InlineNotice tone="danger">
        {enabled
          ? t('Its last run FAILED — this rule is armed but it produced nothing to sign.')
          : t('Its last run FAILED before it was paused — it produced nothing to sign.')}{' '}
        <span className="text-ink/50">
          {runAt(health.at)}
          {health.note ? ` · ${health.note}` : ` · ${t('the engine recorded no reason')}`}
          {health.consecutive > 1 ? ` · ${t('Consecutive failed runs:')} ${health.consecutive}` : ''}
        </span>
      </InlineNotice>
    );
  }
  if (health.state === 'unreadable') {
    return (
      <InlineNotice tone="warning">
        {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
        {health.detail ? ` (${health.detail})` : ''}
      </InlineNotice>
    );
  }
  return null;
}

type FeedKind = 'proposal' | 'rule' | 'commitment' | 'constitution';
type FeedFilter = 'all' | 'active' | 'signed';

export interface FeedEntry {
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
  /** G4-residuos — rule entries only: the verdict of GET /rules/:id/runs. */
  runHealth?: LastRun;
  /**
   * G4-pildoras — the chip, decided where the FACTS are (inside the memo that
   * read the run history and the ledger verdict), not by a render-time ternary
   * over `active`/`signed`. `active ? 'success'` is precisely how an unread
   * verdict and an unresolved seat both ended up green. Absent = the plain
   * kinds (commitments, constitution anchors) keep the generic reading.
   */
  pillTone?: RulePillTone;
  pillLabel?: string;
  /** G1-cadena — proposal entries only: its pinned seat is NOT settled. */
  seatUnresolved?: boolean;
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
function FlareLeg({ txHash, account }: { txHash: string; account: string }) {
  const { t } = useT();
  const [state, setState] = useState<{ loading: boolean; executed?: boolean; flareTxHash?: string | null; none?: boolean }>({
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    xrplLegacy
      .councilOrderStatus(txHash, account)
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
  }, [txHash, account]);
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

/**
 * G4-pildoras — THE TIMELINE, AS A PURE FUNCTION.
 *
 * It used to be the body of a `useMemo` inside the component, which meant the
 * only net under it was a regex over this file's own source: the round-2 suite
 * asserted that the string `e.failing ? 'danger'` appeared, and that assertion
 * stayed green while the chip painted an unread verdict — and an unresolved
 * seat — in green. A test cannot hold a closure; it can hold this. Nothing else
 * moved: the component calls it with exactly the state it used to close over.
 */
export function buildFeedEntries(
  input: {
    proposals: CouncilProposalRecord[];
    rules: AutomationRule[];
    commitments: XrplEscrowRow[];
    amendments: ConstitutionAmendment[];
    /** The verdict of GET /rules/:id/runs per rule id — absent = unread. */
    lastRuns: Record<string, LastRun>;
  },
  t: (s: string) => string,
): FeedEntry[] {
  const { proposals, rules, commitments, amendments, lastRuns } = input;
  const out: FeedEntry[] = [];

  for (const p of proposals) {
    const live = p.status === 'collecting' || p.status === 'ready';
    const emitted = p.status === 'submitted';
    // G4-pildoras / G1-cadena — a live status is NOT a live proposal once the
    // ledger says its pinned seat is spent (or once we failed to read it).
    // Such a row cannot be signed, cannot be broadcast and must not be
    // composed again — so it stops counting as «active now», stops claiming
    // «ready to emit», and says what it actually is.
    const unresolved = seatUnresolvedOf(p);
    out.push({
      key: `proposal:${p.id}`,
      kind: 'proposal',
      chain: 'XRPL',
      title: p.title || p.txType,
      subtitle: unresolved
        ? p.ledgerCheck?.state === 'consumed'
          ? t('unresolved — the account already used its seat, so this MAY have executed')
          : t('unresolved — we could not read the ledger, so we do not know whether it executed')
        : p.status === 'collecting'
          ? t('collecting signatures')
          : p.status === 'ready'
            ? t('ready to emit')
            : p.status === 'submitted'
              ? t('emitted on-chain')
              : p.status === 'expired'
                ? t('expired')
                : t('withdrawn'),
      at: parseTime(p.txHash ? p.expiresAt : p.createdAt) || parseTime(p.createdAt),
      active: live && !unresolved,
      signed: emitted,
      txHash: p.txHash,
      proposal: p,
      seatUnresolved: unresolved,
      ...(unresolved ? { pillTone: 'warning' as const, pillLabel: t('unresolved') } : {}),
    });
  }

  for (const r of rules) {
    const dLeft = daysUntil(r.expiresAt);
    const expired = dLeft !== null && dLeft <= 0;
    // G4-residuos — what a governed rule IS doing comes from its RUNS, not
    // from its row. A failed last fire outranks the TTL warning (producing
    // nothing is a worse fact than expiring in twelve days), and a history we
    // could not read is stated instead of being smoothed into «watching».
    const health = lastRuns[r.id] ?? UNREAD;
    const failing = r.enabled && !expired && isFailing(health);
    // G4-pildoras — the chip used to be `failing ? danger: active
    // ? success: …`, and `active` is `enabled && !expired`: a rule whose run
    // history was still in flight, or whose read had just BROKEN, printed the
    // same green «active» as a rule we had read and found healthy. A failed
    // read is not a verdict of health. Same decision as the other five
    // surfaces now (lib/rules/runHealth · rulePillState).
    const pill = rulePillState(r.enabled, health);
    out.push({
      key: `rule:${r.id}`,
      kind: 'rule',
      chain: 'XRPL',
      title: r.name,
      subtitle: expired
        ? t('expired — renew to keep watching')
        : !r.enabled
          ? t('paused')
          : failing
            ? t('its last run FAILED — it is watching nothing')
            : health.state === 'unreadable'
              ? t('armed — its run history could not be read')
              : dLeft !== null && dLeft <= TTL_WARN_DAYS
                ? `${t('nearing its 90-day limit —')} ${dLeft} ${t('days left')}`
                : t('watching'),
      at: parseTime(r.createdAt),
      active: r.enabled && !expired,
      signed: false,
      runHealth: health,
      rule: r,
      pillTone: expired ? 'warning' : RULE_PILL_TONE[pill],
      pillLabel: expired
        ? t('expired')
        : pill === 'paused'
          ? t('paused')
          : pill === 'failing'
            ? t('failing')
            : pill === 'unreadable'
              ? t('unknown')
              : pill === 'unread'
                ? t('checking…')
                : t('active'),
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
  /**
   * LAS FILAS QUE EL SERVIDOR NO PUDO DECIDIR.
   *
   * Este feed leía `.then((r) => r.proposals)` y tiraba el `unreadable[]` que
   * puso en el 200 precisamente para que una fila indecidible dejase de desaparecer.
   * Con el `.catch(() => [])` de al lado, una bandeja a medias se pintaba como un
   * historial completo — y este componente es el que la familia mira para saber qué
   * pasó. Se cuenta y se dice.
   */
  const [unreadableRows, setUnreadableRows] = useState<UnreadableRowsNotice | null>(null);
  /**
   * EL RECHAZO ENTERO DESAPARECÍA, Y EN LA PRIMERA CARGA
   * NO QUEDABA NI UN AVISO ANTERIOR EN PIE.
   */
  const [proposalsRefusal, setProposalsRefusal] = useState<ReadableRefusal | null>(null);
  // El lector no debe re-disparar `reload` cada vez que cambia la identidad del
  // diccionario; la frase solo se construye dentro de la lectura.
  const tRef = useRef(t);
  tRef.current = t;
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // G4-residuos — last run per rule id, READ from GET /rules/:id/runs. Every
  // rule asked about gets an entry, INCLUDING the ones whose read failed: an
  // absent entry would be indistinguishable from «healthy», which is exactly
  // the bug this closes. The seq guard drops the answer of a superseded refresh
  // so a slow read can never repaint a stale verdict over a fresh feed.
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const runsSeq = useRef(0);

  const loadRuns = useCallback(async (ruleIds: string[], seq: number) => {
    const next = await loadRunHealth(ruleIds, (id) => rulesApi.runs(id));
    if (seq !== runsSeq.current) return;
    setLastRuns(next);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [props, rls, escr, cons] = await Promise.all([
        councilProposalsApi
          .list([account])
          .then((r) => {
            // El aviso se fija con la MISMA respuesta que trae las filas —
            // una lectura completa (sin `unreadable`) es la única que puede apagarlo.
            setUnreadableRows(describeUnreadableRows(r.unreadable, tRef.current));
            // Y una lectura que SÍ ocurrió es la única que puede apagar
            // el aviso de la que no ocurrió.
            setProposalsRefusal(null);
            return r.proposals;
          })
          // Un rechazo entero se DICE. Las filas anteriores siguen en
          // pie (no se re-leyó nada, así que nada de lo que decían ha dejado de ser
          // verdad), pero la pantalla ya no presenta el historial como completo.
          .catch((e) => {
            setProposalsRefusal(describeServerRefusal(e, tRef.current));
            return [] as CouncilProposalRecord[];
          }),
        rulesApi.list(account).then((r) => r.rules).catch(() => [] as AutomationRule[]),
        xrplSavings.escrows(account).then((r) => r.escrows).catch(() => [] as XrplEscrowRow[]),
        xrplLegacy.constitution(account).then((r) => r.history).catch(() => [] as ConstitutionAmendment[]),
      ]);
      setProposals(props);
      setRules(rls);
      setCommitments(escr);
      setAmendments(cons);
      // G4-residuos — the run history is read AFTER the record is on screen
      // (fire and forget): a slow /runs must never delay the feed itself. Until
      // it lands every rule reads as `unread`, which keeps the previous wording.
      const ruleIds = rls.map((r) => r.id);
      const seq = ++runsSeq.current;
      // G4-strategies — do NOT wipe the map here. `setLastRuns({})` sent every
      // rule back to `unread` for the whole round-trip, so a rule already known
      // to be FAILING reverted to the green «watching» subtitle on every
      // reload — the reassurance this front exists to remove, reintroduced once
      // per refresh. Hold the verdicts we already read for the rules still on
      // the list; the ones that left are dropped.
      setLastRuns((prev) => retainKnownRuns(prev, ruleIds));
      void loadRuns(ruleIds, seq);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account, loadRuns]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── build the unified timeline ──
  const entries = useMemo<FeedEntry[]>(
    () => buildFeedEntries({ proposals, rules, commitments, amendments, lastRuns }, t),
    [proposals, rules, commitments, amendments, lastRuns, t],
  );

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
        setActionError(errText(e));
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
        setActionError(errText(e));
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
        setActionError(errText(e));
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
      {/* LA LECTURA QUE NO OCURRIÓ, DICHA. Antes de esto el historial se
          pintaba igual con propuestas y sin ellas, y la única diferencia era que
          nadie lo sabía. Lleva las salidas que el servidor nombró y su puerta
          (`ServerRefusalBody`), porque el 403 de esta lectura es justo el que se come
          el usuario de email/Google. El reintento solo se ofrece si el servidor dijo
          que reintentar sirve: «no pude leer» no es permiso, ni castigo, ni un hecho. */}
      {proposalsRefusal && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>
              {t(
                'The proposals of this Legacy could not be read, so this record is NOT complete: whatever the council has in flight is missing from the list below. That is a failure of ours, not an empty history.',
              )}
            </p>
            <ServerRefusalBody refusal={proposalsRefusal} t={t} />
            {refusalMayRetry(proposalsRefusal) && (
              <GhostButton onClick={() => void reload()} disabled={loading}>
                {t('Try reading them again')}
              </GhostButton>
            )}
          </div>
        </InlineNotice>
      )}
      {/* Las filas que no se pudieron leer se cuentan y se dicen, con su
          código entre paréntesis y su reintento — jamás desaparecen en silencio de un
          historial que la familia lee como completo. */}
      {unreadableRows && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>{unreadableRows.text}</p>
            {/* Los ids los calculaba el lector y no los pintaba nadie,
                mientras la prosa del servidor decía «open it on its own». Sin el id
                no hay nada que abrir ni que nombrar al escribirnos. */}
            {unreadableRows.ids.length > 0 && (
              <p className="font-mono text-[11px] text-ink/55">{unreadableRows.ids.join(' · ')}</p>
            )}
            {unreadableRows.retryable && (
              <GhostButton onClick={() => void reload()} disabled={loading}>
                {t('Try reading them again')}
              </GhostButton>
            )}
          </div>
        </InlineNotice>
      )}
      {actionError && <InlineNotice tone="warning">{actionError}</InlineNotice>}

      {shown.length === 0 && !loading ? (
        // «Nothing here yet» es un VEREDICTO sobre el historial, y no se
        // puede emitir cuando una de sus lecturas fue rechazada. El aviso de arriba
        // ya dice lo que pasó; aquí no se dice nada, que es lo honesto.
        proposalsRefusal ? null : (
          <EmptyState
            bare
            icon={<RotateCw size={20} />}
            title={t('Nothing here yet')}
            hint={t('As you create proposals, rules and commitments, they land in this record — with their on-chain proof.')}
          />
        )
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
                      {/* G4-residuos — the green pill was the lie the council
                          read as protection: a rule that is armed but whose
                          last fire errored is NOT «active».
                          G4-pildoras — and neither is one we have not READ, nor
                          a proposal whose seat the ledger says is spent. Those
                          entries carry their own chip, decided over the facts;
                          only the plain kinds (commitments, constitution
                          anchors) still read it off `active`/`signed`. */}
                      <Pill tone={e.pillTone ?? (e.active ? 'success' : e.signed ? 'neutral' : 'warning')}>
                        {e.pillLabel ?? (e.active ? t('active') : e.signed ? t('signed') : t('closed'))}
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
                          {/* G1-cadena — a quorum reached on a seat the ledger
                              says is spent is not a success. Same rule the
                              inbox applies to its own quorum chip. */}
                          <Pill tone={e.proposal.status === 'ready' && !e.seatUnresolved ? 'success' : 'warning'}>
                            {e.proposal.signatures.reduce((s, x) => s + x.weight, 0)}/{e.proposal.quorum} {t('quorum')}
                          </Pill>
                          {/* «0 days left» was what an unresolved row printed
                              here every time: a countdown that had already run
                              out, dressed as time remaining. */}
                          {(e.proposal.status === 'collecting' || e.proposal.status === 'ready') &&
                            !e.seatUnresolved &&
                            dLeft !== null && (
                              <span className="flex items-center gap-1 text-[11px] text-ink/40">
                                <Clock size={11} /> {Math.max(0, dLeft)} {t('days left')}
                              </span>
                            )}
                        </div>
                        {/* G1-cadena — the server's OWN words about the seat:
                            the pinned Sequence and where the account stands
                            now. The evidence, not our summary of it. */}
                        {e.seatUnresolved && e.proposal.ledgerCheck && (
                          <InlineNotice tone="warning">{e.proposal.ledgerCheck.detail}</InlineNotice>
                        )}
                        {/* Flare leg — only shows for an emitted council order */}
                        {e.proposal.status === 'submitted' && e.txHash && <FlareLeg txHash={e.txHash} account={account} />}
                        {(e.proposal.status === 'collecting' || e.proposal.status === 'ready') && (
                          <div className="flex flex-wrap items-center gap-2">
                            {e.seatUnresolved ? (
                              /* G4-pildoras — BOTH buttons were dead here.
                                 «Go to the inbox to sign» pointed at a tray
                                 that no longer offers a signature for this row
                                 (ProposalInbox files it under `unresolved`),
                                 and «Withdraw» called the endpoint WITHOUT the
                                 acknowledgement the server now demands, so the
                                 council got the raw code
                                 LEDGER_CHECK_UNACKNOWLEDGED from a button that
                                 used to work. The two moves that CAN still
                                 succeed — record the hash you found, or file it
                                 after looking at the explorer — live in that
                                 tray, and only there can the human statement be
                                 made. So this sends them there. */
                              <GhostButton onClick={onGoToProposals}>
                                <ChevronRight size={13} /> {t('Go to the inbox to resolve it')}
                              </GhostButton>
                            ) : (
                              <>
                                <GhostButton onClick={onGoToProposals}>
                                  <PenLine size={13} /> {t('Go to the inbox to sign')}
                                </GhostButton>
                                <GhostButton onClick={() => void withdrawProposal(e.proposal!)} disabled={actingKey === e.key}>
                                  {actingKey === e.key ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                                  {t('Withdraw (proposer only)')}
                                </GhostButton>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* rule detail — the 90-day renew lives here */}
                    {e.rule && (
                      <div className="space-y-2">
                        {/* G4-residuos — the WHY, straight from the engine's
                            own `notes`, ahead of every other rule detail. */}
                        {e.runHealth && <RunHealthNote health={e.runHealth} enabled={e.rule.enabled} t={t} />}
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

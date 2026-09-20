'use client';

/**
 * ScheduledPaymentCard — MoneyFlows as a standing order for a NORMAL wallet
 * (M1, plan del mes §3 · Última Milla §1.4/§2, built). The
 * personal twin of the governed «domiciliación» (GovernedMoneyFlows).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, ExternalLink, Loader2, Pause, Play, Plus, Send, Trash2, X } from 'lucide-react';
import { Card, GhostButton, MicroLabel, Pill } from '../ui/primitives';
import { InlineNotice } from '../legacy/InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { rules as rulesApi, type AutomationRule } from '../../services/v1Api';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import type { UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { applyXrplSignFailure, confirmOnLedger } from '../../lib/xrpl/ledgerSignOutcome';
import { parseBaseUnits } from '../../lib/legacy/baseUnits';
import { getApiBase } from '../../lib/env';
import {
  RULE_PILL_TONE,
  UNREAD,
  loadRunHealth,
  retainKnownRuns,
  rulePillState,
  type RunHealth,
} from '../../lib/rules/runHealth';

const XRPL_PSEUDO_CHAIN_ID = 1440002;
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** XRP is always 6 decimals (1 XRP = 1,000,000 drops) — a ledger constant. */
const XRP_DECIMALS = 6;
const XRPSCAN_TX = 'https://xrpscan.com/tx/';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Same registration nudge as ProtectRuleCard: resolving the PA registers the
 *  wallet row server-side so POST /api/rules never 404s on a fresh wallet. */
async function ensureWalletRegistered(xrpl: string): Promise<void> {
  await fetch(`${getApiBase()}/flare-demo/personal-account?xrpl=${encodeURIComponent(xrpl)}`, {
    headers: authHeaders(),
    credentials: 'include',
  }).catch(() => {});
}

function isScheduledPayment(r: AutomationRule): boolean {
  return (r.action as { kind?: string } | null)?.kind === 'scheduledPayment';
}

function Creator({ owner, onCreated, onClose }: { owner: string; onCreated: () => void; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [amountXrp, setAmountXrp] = useState('');
  const [day, setDay] = useState('1');
  const [destinationTag, setDestinationTag] = useState('');
  const [ttlDays, setTtlDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setError('');
    const ttl = Number(ttlDays);
    if (!name.trim()) return setError(t('Give the rule a name.'));
    if (!(ttl >= 1 && ttl <= 90)) return setError(t('Expiry must be between 1 and 90 days.'));
    if (!XRPL_ADDRESS_RE.test(destination)) return setError(t('Destination must be an XRPL address (r…).'));
    if (destination === owner) return setError(t('Destination must differ from your own wallet.'));
    // Exact drops (F4 doctrine): parseBaseUnits refuses to round — a float
    // `Math.round(x * 1e6)` once turned an over-precise amount into a
    // DIFFERENT one.
    let amountDrops: bigint;
    try {
      amountDrops = parseBaseUnits(amountXrp, XRP_DECIMALS);
    } catch {
      return setError(t('Amount must be a positive number of XRP, with at most 6 decimals.'));
    }
    let tag: number | null = null;
    if (destinationTag.trim() !== '') {
      tag = Number(destinationTag.trim());
      if (!Number.isInteger(tag) || tag < 0 || tag > 0xffffffff) {
        return setError(t('The destination tag must be a whole number (many exchanges require one).'));
      }
    }
    setBusy(true);
    try {
      await ensureWalletRegistered(owner);
      await rulesApi.create({
        walletAddress: owner,
        chainId: XRPL_PSEUDO_CHAIN_ID,
        name: name.trim(),
        trigger: { type: 'TIME_TRIGGER', cron: `0 12 ${Number(day)} * *` },
        action: {
          kind: 'scheduledPayment',
          params: {
            destination,
            amountDrops: amountDrops.toString(),
            ...(tag !== null ? { destinationTag: tag } : {}),
          },
        },
        // One nudge per occurrence: the monthly cadence re-arms it; the
        // cooldown only guards against tick thrash inside the same hour.
        cooldownMinutes: 60,
        expiresAt: new Date(Date.now() + ttl * 86_400_000).toISOString(),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full px-3 py-2 bg-ink/5 border border-ink/10 rounded-lg text-ink text-[13px] placeholder-ink/30 focus:outline-none focus:border-ink/25';

  return (
    <div className="rounded-lg border border-ink/[0.1] bg-ink/[0.03] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <MicroLabel>{t('New recurring payment')}</MicroLabel>
        <button onClick={onClose} className="ml-auto text-ink/40 hover:text-ink/70" aria-label={t('Close')}>
          <X size={14} />
        </button>
      </div>
      <p className="text-[12px] text-ink/50">
        {t(
          'Astryum watches the date and prepares the exact payment; you sign it in Xaman, every time; the rule expires on its own. Nothing is ever sent without your signature.',
        )}
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name (e.g. Car insurance)')} className={field} />
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value.trim())}
        placeholder={t('Destination XRPL address (r…)')}
        spellCheck={false}
        className={field}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-ink/45">
          {t('Amount (XRP)')}
          <input value={amountXrp} onChange={(e) => setAmountXrp(e.target.value)} placeholder="10" inputMode="decimal" className={`${field} mt-1`} />
        </label>
        <label className="text-[11px] text-ink/45">
          {t('Day of the month')}
          <select value={day} onChange={(e) => setDay(e.target.value)} className={`${field} mt-1`}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)} className="bg-neutral-900">
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-ink/45">
          {t('Destination tag (optional)')}
          <input
            value={destinationTag}
            onChange={(e) => setDestinationTag(e.target.value)}
            inputMode="numeric"
            className={`${field} mt-1`}
          />
        </label>
        <label className="text-[11px] text-ink/45">
          {t('Expires in (days, max 90)')}
          <input value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} inputMode="numeric" className={`${field} mt-1`} />
        </label>
      </div>
      <p className="text-[11px] text-ink/40">
        {t('Days run 1–28 so the payment exists in every month (a 29–31 rule would silently skip the short ones). Fires at 12:00 UTC.')}
      </p>
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void create()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.07] px-3 py-1.5 text-[13px] text-ink/85 hover:bg-ink/[0.12] disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {t('Create rule')}
        </button>
        <span className="text-[11px] text-ink/35">{t('The rule holds no authority — only your signature moves funds.')}</span>
      </div>
    </div>
  );
}

/**
 * G4-strategies (auditoria [G4]) — the standing order that swore
 * it was standing.
 */
function RunHealthNote({
  health,
  enabled,
  t,
}: {
  health: RunHealth;
  enabled: boolean;
  t: (s: string) => string;
}) {
  if (health.state === 'failed') {
    return (
      <InlineNotice tone="danger">
        <span className="text-[12px]">
          <span className="block font-medium">
            {enabled
              ? t('Its last run FAILED — this rule is armed but it produced nothing to sign.')
              : t('Its last run FAILED before it was paused — it produced nothing to sign.')}
          </span>
          <span className="mt-0.5 block opacity-80">
            {health.note ?? t('the engine recorded no reason')}
            {health.consecutive > 1 ? ` · ${t('Consecutive failed runs:')} ${health.consecutive}` : ''}
          </span>
        </span>
      </InlineNotice>
    );
  }
  if (health.state === 'unreadable') {
    return (
      <p className="text-[11px] text-amber-300/70" title={health.detail}>
        {t('Could not read this rule’s run history — we cannot tell you whether its last fire worked.')}
      </p>
    );
  }
  return null;
}

/**
 * The personal recurring-payments surface: the wallet's scheduledPayment
 * rules with their signing door, plus the creator. Renders nothing without a
 * connected XRPL wallet — the rule belongs to the wallet that pays.
 */
export default function ScheduledPaymentCard() {
  const { t } = useT();
  const { address, sendIntent } = useXrplWalletPartner();
  const [ruleRows, setRuleRows] = useState<AutomationRule[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [signedTx, setSignedTx] = useState<{ ruleId: string; hash: string } | null>(null);
  // Per rule: a payment that reached Xaman and whose ending we could not read.
  // While present, that rule's «Prepare & sign» is not offered — a second
  // signature is a second payment.
  const [unconfirmed, setUnconfirmed] = useState<Record<string, UnconfirmedSignature>>({});
  // G4-strategies — last run per rule id, READ from GET /rules/:id/runs.
  // Every rule rendered gets an entry, INCLUDING the ones whose read failed:
  // an absent entry is indistinguishable from "healthy". The seq guard drops
  // the answer of a superseded refresh so a slow read cannot repaint a stale
  // verdict over a fresh list.
  const [runHealth, setRunHealth] = useState<Record<string, RunHealth>>({});
  const runsSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) {
      setRuleRows([]);
      setRunHealth({});
      return;
    }
    try {
      const r = await rulesApi.list(address);
      const rows = (r.rules ?? []).filter(isScheduledPayment);
      setRuleRows(rows);
      // G4-strategies — the run history is read AFTER the rows are on
      // screen (fire and forget): a slow /runs must never delay the rules
      // themselves. We do NOT wipe the map first — that flashed a rule already
      // known to be failing back to the green "active" pill once per refresh.
      const ruleIds = rows.map((row) => row.id);
      const seq = ++runsSeq.current;
      setRunHealth((prev) => retainKnownRuns(prev, ruleIds));
      void (async () => {
        const health = await loadRunHealth(ruleIds, (id) => rulesApi.runs(id));
        if (seq !== runsSeq.current) return;
        setRunHealth(health);
      })();
    } catch {
      /* quiet — this card is one voice among several on the page */
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** The signing door: compose FRESH server-side, sign in Xaman. Available on
   *  demand — signing early is paying early, and that is the owner's call;
   *  the push notification is what makes it timely. */
  const signNow = useCallback(
    async (rule: AutomationRule) => {
      if (unconfirmed[rule.id]) return;
      setBusyId(rule.id);
      setError('');
      setSignedTx(null);
      let handedToPartner = false;
      try {
        const h = await rulesApi.scheduledPaymentPrepare(rule.id);
        handedToPartner = true;
        const res = (await sendIntent({ tx: h.xrplTx as never })) as { txHash?: string } | undefined;
        // «Signed» is Xaman's word: the row says the ledger has it only once
        // the ledger validated it with tesSUCCESS.
        const hash = await confirmOnLedger(res?.txHash);
        setSignedTx({ ruleId: rule.id, hash });
      } catch (e) {
        const body = (e as { body?: { detail?: string } })?.body;
        if (!handedToPartner) {
          // The server refused to compose it: nothing reached a wallet.
          setError(body?.detail ?? (e as Error)?.message ?? t('Something went wrong.'));
          return;
        }
        // After the payment reached Xaman: cancelled → the button stays;
        // validated with a failure → a fresh prepare is the next click; anything
        // we could not read → amber for THIS rule, and no second signature.
        applyXrplSignFailure(e, handedToPartner, t, {
          setError,
          setUnconfirmed: (u) => {
            if (u) setUnconfirmed((prev) => ({ ...prev, [rule.id]: u }));
          },
          setPhase: () => {},
        });
      } finally {
        setBusyId(null);
      }
    },
    [sendIntent, t, unconfirmed],
  );

  const act = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusyId(id);
      setError('');
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  if (!address) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-ink/50" />
        <MicroLabel>{t('Recurring payments')}</MicroLabel>
        <Pill tone="neutral">{t('you sign')}</Pill>
      </div>
      <p className="text-[12px] text-ink/55">
        {t(
          'A standing order the ledger cannot fake: Astryum watches the date and prepares the exact payment; you sign each one in Xaman; the rule expires on its own (90 days at most).',
        )}
      </p>

      {ruleRows.length > 0 && (
        <ul className="space-y-2">
          {ruleRows.map((r) => {
            const p = ((r.action as { params?: Record<string, unknown> })?.params ?? {}) as Record<string, unknown>;
            const xrp = Number(String(p.amountDrops ?? '0')) / 1_000_000;
            const dst = String(p.destination ?? '');
            const k = r.id;
            // G4-strategies — an enabled standing order whose LAST tick
            // errored is not "active": it is armed and it prepared nothing on
            // its due date. The green pill on `r.enabled` alone hid exactly
            // that.
            // G4-pildoras — `isFailing` is false for `unread` and
            // for `unreadable`, so both fell into the green arm: the first
            // paint claimed «active» before a single run was read, and a /runs
            // timeout returned a FAILING standing order to «active». The
            // verdict now carries its own tone (lib/rules/runHealth).
            const health = runHealth[k] ?? UNREAD;
            const pill = rulePillState(r.enabled, health);
            return (
              <li key={k} className="rounded-lg border border-ink/[0.08] bg-ink/[0.02] p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink/80 truncate">{r.name}</span>
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
                  <span className="ml-auto font-mono text-[12px] text-ink/60">
                    {xrp} XRP → {dst.slice(0, 6)}…{dst.slice(-4)}
                  </span>
                </div>
                <RunHealthNote health={health} enabled={r.enabled} t={t} />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {!unconfirmed[k] && (
                    <button
                      onClick={() => void signNow(r)}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 rounded-lg border border-volt/25 bg-volt/[0.08] px-2.5 py-1 text-[12px] text-ink/80 hover:bg-volt/[0.14] disabled:opacity-40"
                    >
                      {busyId === k ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {t('Prepare & sign in Xaman')}
                    </button>
                  )}
                  {r.enabled ? (
                    <button
                      onClick={() => void act(k, () => rulesApi.disable(k))}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08]"
                    >
                      <Pause size={12} /> {t('Pause')}
                    </button>
                  ) : (
                    <button
                      onClick={() => void act(k, () => rulesApi.enable(k))}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-ink/70 hover:bg-ink/[0.08]"
                    >
                      <Play size={12} /> {t('Resume')}
                    </button>
                  )}
                  <button
                    onClick={() => void act(k, () => rulesApi.delete(k))}
                    disabled={busyId !== null}
                    className="flex items-center gap-1 rounded-lg border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[12px] text-red-300/70 hover:bg-red-500/10"
                  >
                    <Trash2 size={12} /> {t('Delete')}
                  </button>
                </div>
                {unconfirmed[k] && (
                  <UnconfirmedSignatureNotice
                    rail="xrpl"
                    xrplKind="payment"
                    unconfirmed={unconfirmed[k]}
                    onClose={() => {
                      setUnconfirmed((prev) => {
                        const next = { ...prev };
                        delete next[k];
                        return next;
                      });
                      void refresh();
                    }}
                  />
                )}
                {signedTx?.ruleId === k && (
                  <p className="text-[12px] text-ink/60">
                    {t('Signed and sent — the ledger has it:')}{' '}
                    <a
                      href={`${XRPSCAN_TX}${signedTx.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-ink/80"
                    >
                      <ExternalLink size={11} className="mr-0.5 inline" />
                      {signedTx.hash.slice(0, 10)}…
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}

      {creating ? (
        <Creator owner={address} onCreated={() => void refresh()} onClose={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.06] px-3 py-1.5 text-[13px] text-ink/85 hover:bg-ink/[0.1]"
        >
          <Plus size={13} /> {t('Create a recurring payment')}
        </button>
      )}
    </Card>
  );
}

'use client';

/**
 * GovernedMoneyFlows — the governed-mode rules surface, WIRED (2026-07-18).
 *
 * Same MoneyFlows system as Personal (decisión fundador): the shared engine
 * watches the rule; what changes is the end of the rail — when a governed rule
 * fires, the AutomationEngine COMPOSES a proposal into the council inbox
 * (CouncilProposalService) and the QUORUM signs it there. The rule itself
 * holds ZERO authority: nothing moves without the quorum signatures, so this
 * surface can create/pause rules without touching governance.
 *
 * COPY IS LOAD-BEARING (blacklist §4): "vigila sin discreción, compone la
 * propuesta, firma el quórum, caduca sola (≤90d)" — never "automatización sin
 * firmar". TTL is ENFORCED server-side; pause is instant and individual.
 *
 * v1 action = councilPayment (live on mainnet: a Payment from the council the
 * quorum signs). councilOrder (LegacyVault via FDC bridge) stays gated until
 * the Legacy stack is deployed (legacyStackConfig) — shown, not enabled.
 */

import { useEffect, useState } from 'react';
import { CalendarClock, Landmark, Loader2, Plus, TrendingDown, X } from 'lucide-react';
import { Card, MicroLabel } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { moneyflows as moneyflowsApi, rules as rulesApi } from '../../services/v1Api';
import MoneyFlowsPanel from '../moneyflows/MoneyFlowsPanel';

const XRPL_PSEUDO_CHAIN_ID = 1440002;
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const SCHEDULES: Array<{ key: string; label: string; cron: string }> = [
  { key: 'daily', label: 'Every day (12:00 UTC)', cron: '0 12 * * *' },
  { key: 'weekly', label: 'Every Monday (12:00 UTC)', cron: '0 12 * * 1' },
  { key: 'monthly', label: 'Every month, day 1 (12:00 UTC)', cron: '0 12 1 * *' },
];

type ApyMarket = { address: string; label: string; supplyAprPct: number | null; source: string };

function GovernedRuleCreator({
  account,
  onCreated,
  onClose,
}: {
  account: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<'schedule' | 'apy'>('apy');
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // schedule → council payment
  const [schedule, setSchedule] = useState(SCHEDULES[2].key);
  const [destination, setDestination] = useState('');
  const [amountXrp, setAmountXrp] = useState('');
  // apy → vault rotation (LA prueba Legacy: "si el APY cae de X, saca y pon en otro sitio")
  const [markets, setMarkets] = useState<ApyMarket[]>([]);
  const [market, setMarket] = useState('');
  const [thresholdPct, setThresholdPct] = useState('');
  const [apyAction, setApyAction] = useState<'notify' | 'move'>('notify');
  const [fromId, setFromId] = useState('0');
  const [toId, setToId] = useState('1');
  const [moveAmount, setMoveAmount] = useState('');

  useEffect(() => {
    moneyflowsApi
      .apyMarkets()
      .then((r) => {
        setMarkets(r.markets ?? []);
        if (r.markets?.[0]) setMarket((m) => m || r.markets[0].address);
      })
      .catch(() => setMarkets([]));
  }, []);

  async function create() {
    setError('');
    const ttl = Number(ttlDays);
    if (!name.trim()) return setError(t('Give the rule a name.'));
    if (!(ttl >= 1 && ttl <= 90)) return setError(t('Expiry must be between 1 and 90 days.'));

    let trigger: Record<string, unknown>;
    let action: Record<string, unknown>;
    if (kind === 'schedule') {
      const amount = Number(amountXrp);
      if (!XRPL_ADDRESS_RE.test(destination)) return setError(t('Destination must be an XRPL address (r…).'));
      if (destination === account) return setError(t('Destination must differ from the council account.'));
      if (!(amount > 0)) return setError(t('Amount must be a positive number of XRP.'));
      trigger = { type: 'TIME_TRIGGER', cron: SCHEDULES.find((s) => s.key === schedule)?.cron ?? SCHEDULES[2].cron };
      action = {
        kind: 'councilPayment',
        params: { council: account, destination, amountDrops: String(Math.round(amount * 1_000_000)) },
      };
    } else {
      const th = Number(thresholdPct);
      if (!market) return setError(t('Pick the market to watch.'));
      if (!(th > 0)) return setError(t('The APY floor must be a positive percentage.'));
      trigger = { type: 'APY_BELOW', market, thresholdPct: th };
      if (apyAction === 'move') {
        const amt = Number(moveAmount);
        if (!(amt > 0)) return setError(t('Rotation amount must be a positive number of FXRP.'));
        action = {
          kind: 'councilOrder',
          params: {
            council: account,
            orderAction: 'move',
            orderParams: { fromId: Number(fromId) || 0, toId: Number(toId) || 0, amount: String(Math.round(amt * 1_000_000)) },
          },
        };
      } else {
        action = {}; // aviso: el disparo crea la alerta; el consejo decide y propone a mano
      }
    }

    setBusy(true);
    try {
      await rulesApi.create({
        walletAddress: account,
        chainId: XRPL_PSEUDO_CHAIN_ID,
        name: name.trim(),
        trigger,
        action,
        // re-arm per occurrence; cooldown is the anti-thrash floor (APY rules
        // especially: a rate hovering under the floor must not spam proposals).
        cooldownMinutes: kind === 'apy' ? 720 : 60,
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
  const tab = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${
      active ? 'border-ink/25 bg-ink/[0.08] text-ink/85' : 'border-ink/10 bg-ink/[0.03] text-ink/45 hover:text-ink/70'
    }`;

  return (
    <div className="rounded-lg border border-ink/[0.1] bg-ink/[0.03] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <MicroLabel>{t('New governed rule')}</MicroLabel>
        <button onClick={onClose} className="ml-auto text-ink/40 hover:text-ink/70" aria-label={t('Close')}>
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setKind('apy')} className={tab(kind === 'apy')}>
          <TrendingDown size={12} /> {t('If the APY falls below X%')}
        </button>
        <button onClick={() => setKind('schedule')} className={tab(kind === 'schedule')}>
          <CalendarClock size={12} /> {t('Scheduled council payment')}
        </button>
      </div>
      <p className="text-[12px] text-ink/50">
        {kind === 'apy'
          ? t(
              'When the venue’s live supply APY drops below your floor, the rule fires: it alerts the council — or composes the rotation order (move funds to another venue) as a proposal the quorum signs. Rates are read live from the protocol, with source.',
            )
          : t(
              'When the schedule fires, the rule COMPOSES a payment proposal from the council into the inbox above. Nothing is sent: the quorum reviews and signs each proposal, every time.',
            )}
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name (e.g. Monthly stipend)')} className={field} />

      {kind === 'schedule' ? (
        <>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={field}>
            {SCHEDULES.map((s) => (
              <option key={s.key} value={s.key} className="bg-neutral-900">
                {t(s.label)}
              </option>
            ))}
          </select>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value.trim())}
            placeholder={t('Destination XRPL address (r…)')}
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink/45">
              {t('Amount (XRP)')}
              <input value={amountXrp} onChange={(e) => setAmountXrp(e.target.value)} placeholder="10" inputMode="decimal" className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] text-ink/45">
              {t('Expires in (days, max 90)')}
              <input value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} inputMode="numeric" className={`${field} mt-1`} />
            </label>
          </div>
        </>
      ) : (
        <>
          <select value={market} onChange={(e) => setMarket(e.target.value)} className={field}>
            {markets.length === 0 && <option value="">{t('No markets available (backend env)')}</option>}
            {markets.map((m) => (
              <option key={m.address} value={m.address} className="bg-neutral-900">
                {m.label}
                {m.supplyAprPct != null ? ` — ${t('now')} ${m.supplyAprPct.toFixed(2)}%` : ''}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink/45">
              {t('APY floor (%)')}
              <input value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value)} placeholder="3" inputMode="decimal" className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] text-ink/45">
              {t('Expires in (days, max 90)')}
              <input value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} inputMode="numeric" className={`${field} mt-1`} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setApyAction('notify')} className={tab(apyAction === 'notify')}>
              {t('Alert the council')}
            </button>
            <button onClick={() => setApyAction('move')} className={tab(apyAction === 'move')}>
              {t('Compose the rotation order (vault)')}
            </button>
          </div>
          {apyAction === 'move' && (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-ink/45">
                {t('From venue #')}
                <input value={fromId} onChange={(e) => setFromId(e.target.value)} inputMode="numeric" className={`${field} mt-1`} />
              </label>
              <label className="text-[11px] text-ink/45">
                {t('To venue #')}
                <input value={toId} onChange={(e) => setToId(e.target.value)} inputMode="numeric" className={`${field} mt-1`} />
              </label>
              <label className="text-[11px] text-ink/45">
                {t('Amount (FXRP)')}
                <input value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} placeholder="100" inputMode="decimal" className={`${field} mt-1`} />
              </label>
            </div>
          )}
        </>
      )}

      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void create()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.07] px-3 py-1.5 text-[13px] text-ink/85 hover:bg-ink/[0.12] disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {t('Create rule')}
        </button>
        <span className="text-[11px] text-ink/35">{t('The rule holds no authority — only the quorum signature moves funds.')}</span>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-ink/[0.06] bg-ink/[0.02] p-2.5 text-[11px] text-ink/40">
        <Landmark size={12} className="mt-0.5 shrink-0" />
        {t(
          'The rotation order needs the deployed Legacy stack (bridge + vault): until then it fails with a readable error at fire time; the alert variant works today. Machine execution happens only AFTER the quorum signs.',
        )}
      </div>
    </div>
  );
}

export default function GovernedMoneyFlows({ account }: { account: string }) {
  const { t } = useT();
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-3">
      <MoneyFlowsPanel
        key={refreshKey}
        addresses={[account]}
        mode="governed"
        title={t('Council MoneyFlows')}
      />
      {creating ? (
        <GovernedRuleCreator account={account} onCreated={() => setRefreshKey((k) => k + 1)} onClose={() => setCreating(false)} />
      ) : (
        <Card className="p-3">
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.06] px-3 py-1.5 text-[13px] text-ink/85 hover:bg-ink/[0.1]"
          >
            <Plus size={13} /> {t('Create a governed rule')}
          </button>
          <p className="mt-1.5 text-[11px] text-ink/40">
            {t('Sign-at-trigger with N signers: the rule composes proposals; the quorum signs each one; it expires on its own (90 days at most).')}
          </p>
        </Card>
      )}
    </div>
  );
}

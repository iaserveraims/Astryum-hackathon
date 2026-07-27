'use client';

/**
 * ProtectRuleCard — the ONE embeddable Protect MoneyFlow creation card
 * (founder 2026-07-25: every creation path shows the SAME manual card,
 * embedded directly in its modal — the entry modal, the agent-launched entry,
 * and the position board's Protect modal all build the identical rules).
 *
 * Two shapes (founder 2026-07-25 tarde):
 *   · SIMPLE — one HF threshold; repay 'restore' (live minimum) or fixed
 *     amount, with 25/50/100%-of-debt quick chips when the entry's debt is
 *     known.
 *   · ESCALONADO (ladder) — up to 3 levels, each "when HF < X, repay Y" where
 *     Y is a % OF THE LIVE DEBT at trigger time (mode 'pct' — never an amount
 *     frozen at creation) or a fixed USDT0 amount. The N rules share ONE
 *     canonicalRef, so every surface shows/pauses/deletes the ladder as one
 *     flow.
 *
 * Rules go through the SAME gated POST /api/rules and bind to the wallet that
 * HOLDS the position (PA on the XRPL rail, the signing EVM wallet on the
 * direct rail) — never the login address. Vigilance only: the engine prepares
 * on trigger; the USER signs (invariants #1/#8).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Layers, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { rules as rulesApi } from '../../services/v1Api';
import { getApiBase } from '../../lib/env';
import { resolveInitialValues, type RulePrefill } from '../../lib/automation/rulePrefill';
import { TEMPLATES } from './templateCatalog';

const API_BASE = getApiBase();
const USDT0_DECIMALS = 6;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface LadderRow {
  hf: string;
  kind: 'pct' | 'usdt0';
  value: string;
}

/** Default ladder — editable; a sensible protection staircase. */
const DEFAULT_LADDER: LadderRow[] = [
  { hf: '2.0', kind: 'pct', value: '25' },
  { hf: '1.5', kind: 'pct', value: '50' },
  { hf: '1.2', kind: 'pct', value: '100' },
];

export function ProtectRuleCard({
  walletAddress,
  protocolId,
  positionId,
  assetLabel,
  prefill,
  ensureXrplRegistered,
  onCreated,
}: {
  /** The wallet that HOLDS the position the rules watch (PA or EVM). */
  walletAddress: string;
  protocolId: string;
  positionId?: string;
  /** Shown in the rule name, e.g. 'FXRP'. */
  assetLabel?: string;
  /** Initial values overriding the template defaults (all stay editable).
   *  `repay` carries the entry's FULL debt (human) — it also powers the
   *  25/50/100% chips of the fixed mode. */
  prefill?: Record<string, string>;
  /** XRPL owner whose PA resolution registers the wallet row server-side —
   *  pass it on the XRPL rail so POST /api/rules never 404s on a fresh PA. */
  ensureXrplRegistered?: string;
  onCreated?: () => void;
}) {
  const { t } = useT();
  const tpl = TEMPLATES.PROTECT;
  const initial = useMemo(() => {
    const asPrefill: RulePrefill | null = prefill
      ? { values: prefill, source: 'strategy-entry', savedAt: Date.now() }
      : null;
    return resolveInitialValues(tpl.fields, asPrefill);
  }, [tpl, prefill]);
  const [vals, setVals] = useState<Record<string, string>>(() => initial.values);
  const [ladderOn, setLadderOn] = useState(false);
  const [ladder, setLadder] = useState<LadderRow[]>(DEFAULT_LADDER);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');

  const setVal = (key: string, value: string) => setVals((s) => ({ ...s, [key]: value }));
  const setRow = (i: number, patch: Partial<LadderRow>) =>
    setLadder((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** The entry's full debt (human USDT0) when known — powers the fixed-mode chips. */
  const debtHuman = useMemo(() => {
    const n = parseFloat(prefill?.repay ?? '');
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [prefill]);

  async function ensureWalletRegistered() {
    if (!ensureXrplRegistered) return;
    await fetch(
      `${API_BASE}/flare-demo/personal-account?xrpl=${encodeURIComponent(ensureXrplRegistered)}`,
      { headers: authHeaders(), credentials: 'include' },
    ).catch(() => {});
  }

  async function createSimple() {
    for (const f of tpl.fields) {
      if (f.type === 'number') {
        const n = parseFloat(vals[f.key]);
        if (isNaN(n) || n < (f.min ?? 0)) {
          setError(`${t('Invalid value for')} "${f.label}"`);
          return false;
        }
      }
    }
    const { trigger, action, cooldownMinutes } = tpl.build(vals, { protocolId, positionId });
    await rulesApi.create({
      walletAddress,
      chainId: 14,
      name: `${tpl.label} · ${assetLabel ?? protocolId}`,
      trigger,
      action,
      cooldownMinutes,
    });
    return true;
  }

  async function createLadder() {
    const rows = ladder.filter((r) => r.hf.trim() !== '' && r.value.trim() !== '');
    if (rows.length === 0) {
      setError(t('Add at least one ladder level.'));
      return false;
    }
    for (const r of rows) {
      const hf = parseFloat(r.hf);
      const v = parseFloat(r.value);
      if (!(hf > 1)) {
        setError(`${t('Invalid value for')} "HF" (${r.hf})`);
        return false;
      }
      if (r.kind === 'pct' ? !(v > 0 && v <= 100) : !(v > 0)) {
        setError(`${t('Invalid value for')} "${r.kind === 'pct' ? '%' : 'USDT0'}" (${r.value})`);
        return false;
      }
    }
    const cooldown = Math.round(parseFloat(vals.cooldown) || 60);
    // ONE canonicalRef → every surface manages the ladder as one flow.
    const ref = `ladder-${walletAddress.slice(2, 8).toLowerCase()}-${Date.now()}`;
    let level = 0;
    for (const r of rows) {
      level += 1;
      await rulesApi.create({
        walletAddress,
        chainId: 14,
        name: `${t('Protect ladder')} · ${assetLabel ?? protocolId} · L${level}`,
        canonicalRef: ref,
        trigger: { type: 'HF_BELOW', threshold: parseFloat(r.hf) },
        action: {
          kind: 'repay',
          protocolId,
          positionId,
          params:
            r.kind === 'pct'
              ? { mode: 'pct', pct: parseFloat(r.value) } // % de la deuda VIVA al disparar
              : { mode: 'fixed', amount: String(BigInt(Math.round(parseFloat(r.value) * 10 ** USDT0_DECIMALS))) },
        },
        cooldownMinutes: cooldown,
      });
    }
    return true;
  }

  async function create() {
    setError('');
    setBusy(true);
    try {
      // A freshly-derived PA may not exist as a wallet row yet — the
      // authenticated resolution registers it to this user (best-effort;
      // the create below is the real gate).
      await ensureWalletRegistered();
      const ok = ladderOn ? await createLadder() : await createSimple();
      if (!ok) return;
      setCreated(true);
      onCreated?.();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="w-full rounded-xl border border-tone-success/25 bg-tone-success/[0.06] p-3 text-left">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-tone-success" />
          <div className="text-[12px] text-tone-success/90 leading-relaxed">
            {ladderOn
              ? t('Ladder created — its levels fire one by one as HF falls, each preparing a repay for YOU to sign.')
              : t('MoneyFlow created — it watches your position and, on trigger, prepares the repay for YOU to sign.')}{' '}
            <Link href="/app/strategies" className="underline hover:no-underline">
              {t('Manage it in Strategies (pause, resume, delete).')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-sky-400/25 bg-sky-400/[0.05] p-3 text-left space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${tpl.accent}`}>
          <ShieldCheck className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">{t('Protect this position')}</div>
          <p className="text-[10px] text-ink/40">{tpl.blurb}</p>
        </div>
      </div>

      {/* Escalonado on/off — the founder's staircase (2026-07-25). */}
      <label className="flex items-center justify-between gap-3 bg-ink/5 border border-ink/10 rounded-lg px-3 py-2 cursor-pointer">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-ink/45" />
          <div>
            <div className="text-[11px] text-ink/70">{t('Ladder (staggered protection)')}</div>
            <p className="text-[9px] text-ink/35 mt-0.5">
              {t('Several levels: as HF falls, each fires with its own repay — % of the LIVE debt at that moment, or a fixed amount.')}
            </p>
          </div>
        </div>
        <input
          type="checkbox"
          checked={ladderOn}
          onChange={(e) => setLadderOn(e.target.checked)}
          className="w-4 h-4 accent-volt"
        />
      </label>

      {ladderOn ? (
        <div className="space-y-2">
          {ladder.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-ink/35 w-6 shrink-0">L{i + 1}</span>
              <span className="text-[11px] text-ink/50 shrink-0">HF &lt;</span>
              <input
                type="number"
                step={0.1}
                min={1.01}
                value={r.hf}
                onChange={(e) => setRow(i, { hf: e.target.value })}
                className="w-16 px-2 py-1.5 bg-ink/5 border border-ink/10 rounded-lg text-ink text-[12px] focus:outline-none focus:border-volt/50"
              />
              <span className="text-[11px] text-ink/50 shrink-0">→ {t('repay')}</span>
              <input
                type="number"
                step={r.kind === 'pct' ? 5 : 0.1}
                min={0}
                value={r.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                className="w-16 px-2 py-1.5 bg-ink/5 border border-ink/10 rounded-lg text-ink text-[12px] focus:outline-none focus:border-volt/50"
              />
              <button
                type="button"
                onClick={() => setRow(i, { kind: r.kind === 'pct' ? 'usdt0' : 'pct' })}
                className="shrink-0 rounded-lg border border-ink/10 bg-ink/5 px-2 py-1.5 text-[10px] text-ink/60 hover:bg-ink/10"
                title={t('Toggle between % of live debt and a fixed USDT0 amount')}
              >
                {r.kind === 'pct' ? t('% of debt') : 'USDT0'}
              </button>
            </div>
          ))}
          <p className="text-[9px] text-ink/35">
            {t('“% of debt” is computed over the LIVE debt when the level fires — never an amount frozen today.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tpl.fields
            .filter((f) => f.key !== 'cooldown')
            .map((f) =>
              f.type === 'toggle' ? (
                <label
                  key={f.key}
                  className="flex items-center justify-between gap-3 bg-ink/5 border border-ink/10 rounded-lg px-3 py-2 cursor-pointer"
                >
                  <div>
                    <div className="text-[11px] text-ink/70">{f.label}</div>
                    {f.hint && <p className="text-[9px] text-ink/35 mt-0.5">{f.hint}</p>}
                  </div>
                  <input
                    type="checkbox"
                    checked={vals[f.key] === 'true'}
                    onChange={(e) => setVal(f.key, e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 accent-volt"
                  />
                </label>
              ) : (
                <div key={f.key}>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-ink/50 w-40 shrink-0">
                      {f.label}
                      {f.unit && <span className="text-ink/30"> · {f.unit}</span>}
                    </label>
                    <input
                      type="number"
                      min={f.min}
                      step={f.step}
                      value={vals[f.key]}
                      onChange={(e) => setVal(f.key, e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 bg-ink/5 border border-ink/10 rounded-lg text-ink text-[12px] focus:outline-none focus:border-volt/50"
                    />
                  </div>
                  {/* 25/50/100% of the ENTRY's debt — quick-set for the fixed mode
                      (founder 2026-07-25: importes calculados, no a ojo). */}
                  {f.key === 'repay' && debtHuman != null && vals.restore !== 'true' && (
                    <div className="mt-1 flex gap-1.5 pl-40">
                      {[25, 50, 100].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setVal('repay', String(Number(((debtHuman * pct) / 100).toFixed(6))))}
                          className="rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/60 hover:bg-ink/10"
                        >
                          {pct === 100 ? `100% (${debtHuman.toFixed(4)})` : `${pct}%`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
        </div>
      )}

      {/* Cooldown — shared by both shapes. */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-ink/50 w-40 shrink-0">
          Cooldown<span className="text-ink/30"> · min</span>
        </label>
        <input
          type="number"
          min={0}
          step={5}
          value={vals.cooldown}
          onChange={(e) => setVal('cooldown', e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 bg-ink/5 border border-ink/10 rounded-lg text-ink text-[12px] focus:outline-none focus:border-volt/50"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-tone-danger/25 bg-tone-danger/5 px-3 py-2 text-[11px] text-tone-danger">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={create}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-volt text-volt-ink text-[12px] font-semibold py-2 hover:brightness-95 transition-all disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
        {ladderOn ? t('Create the ladder') : t('Create the MoneyFlow')}
      </button>
      <p className="text-[9px] text-ink/30 text-center">
        {t('It expires on its own (90 days at most) and you can pause or delete it instantly.')}
      </p>
    </div>
  );
}

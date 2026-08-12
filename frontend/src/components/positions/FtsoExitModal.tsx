'use client';

/**
 * FtsoExitModal — exit rail of the FTSO delegation position (E2), driven from
 * the Positions board. The reverse of Earn's "Wrap + delegate": unwrap
 * WFLR → FLR in the SAME wallet, with undelegateAll folded in on a full exit.
 *
 * Backend: GET /flare-demo/e2/position (live balance + delegations) →
 * POST /flare-demo/e2/exit/prepare (unsigned calls + disclosure). EVM-only:
 * the wallet that HOLDS the WFLR signs directly — Astryum never signs.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { AmountSliderUsd } from './AmountSliderUsd';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';

const API_BASE = getApiBase();

export interface FtsoPositionRef {
  /** EVM wallet that HOLDS the delegated WFLR (it signs the exit). */
  owner: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function fmt(n: number, digits = 4): string {
  return fmtQtyActive(n, digits);
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface PositionRead {
  balanceWflr: number;
  delegations: Array<{ provider: string; bips: number }>;
  flrPriceUSD: number;
}

interface PreparedExit {
  rail: 'evm';
  chainId: number;
  account: string;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  disclosure: {
    amountFlr: number;
    balanceWflr: number;
    fullExit: boolean;
    undelegates: boolean;
    delegations: Array<{ provider: string; bips: number }>;
    flrPriceUSD: number;
    note?: string;
  };
}

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1.5">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 font-mono text-right">{value}</span>
    </div>
  );
}

export function FtsoExitModal({
  position,
  onClose,
  onChanged,
}: {
  position: FtsoPositionRef;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [read, setRead] = useState<PositionRead | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [amount, setAmount] = useState('');
  const [atMax, setAtMax] = useState(false);
  const [prepared, setPrepared] = useState<PreparedExit | null>(null);

  // The wallet that HOLDS the WFLR must sign — MetaMask picks the account, so
  // all we can do is say it plainly when the connected one is not the owner.
  const ownerIsConnected =
    !!evm.address && evm.address.toLowerCase() === position.owner.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/flare-demo/e2/position?account=${encodeURIComponent(position.owner)}`,
          { headers: authHeaders(), credentials: 'include' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as PositionRead;
        if (!cancelled) setRead(body);
      } catch {
        // The live balance sizes the slider; without it the form cannot offer
        // a truthful MAX — show the honest failure instead of a blind input.
        if (!cancelled) setReadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [position.owner]);

  const amountNum = parseFloat(amount) || 0;
  const balance = read?.balanceWflr ?? 0;
  const willUndelegate = useMemo(
    () => (atMax || (balance > 0 && amountNum >= balance)) && (read?.delegations.length ?? 0) > 0,
    [atMax, amountNum, balance, read?.delegations.length],
  );

  async function prepare() {
    setError('');
    setPhase('preparing');
    try {
      if (!atMax && !(amountNum > 0)) throw new Error(t('Amount must be greater than 0'));
      const body: Record<string, unknown> = {
        account: position.owner,
        region: getUserRegion(),
      };
      if (atMax) body.max = true;
      else body.amountFlr = amountNum;
      const res = await fetch(`${API_BASE}/flare-demo/e2/exit/prepare`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(resBody.error ?? '');
        if (res.status === 451 || code.startsWith('GEOFENCE')) throw new Error(t('This action is not available in your region yet.'));
        if (code === 'FLARE_DEFI_DISABLED') throw new Error(t('Flare DeFi execution is disabled on this server (feature flag).'));
        if (code === 'NO_WFLR') throw new Error(t('This wallet holds no WFLR to unwrap.'));
        if (code === 'INSUFFICIENT_WFLR') {
          throw new Error(
            `${t('That wallet holds less WFLR than requested')} ` +
              `(${fmt(Number(resBody.balanceWflr ?? 0))} vs ${fmt(Number(resBody.requestedFlr ?? 0))}). ` +
              t('Use MAX to unwrap the exact balance.'),
          );
        }
        throw new Error(resBody.detail || resBody.error || `HTTP ${res.status}`);
      }
      setPrepared(resBody as PreparedExit);
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setPhase('signing');
    try {
      if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
      if (!ownerIsConnected) {
        throw new Error(
          `${t('Switch your wallet to the account that holds this position')} (${short(position.owner)}).`,
        );
      }
      const { handle } = await evm.sendIntentCalls(
        prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
      );
      settlement.track(handle, { onSettled: onChanged });
      setPhase('done');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('review');
    }
  }

  const d = prepared?.disclosure;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto max-h-[min(90dvh,44rem)] overflow-y-auto scrollbar-thin shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-volt" />
              {t('Withdraw & unwrap')}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5">WFLR → FLR · {short(position.owner)}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'form' && (
          <>
            {readFailed ? (
              <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t('The live WFLR balance could not be read — try again in a moment.')}</span>
              </div>
            ) : !read ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-volt animate-spin" />
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-ink/40">{t('Amount · WFLR')}</label>
                    <span className="text-xs text-ink/40">
                      {t('Available:')} <span className="text-ink/70 font-mono">{fmt(balance)}</span>{' '}
                      <button
                        onClick={() => {
                          setAmount(String(balance));
                          setAtMax(true);
                        }}
                        className="text-volt hover:brightness-110 font-semibold"
                      >
                        MAX
                      </button>
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAtMax(false);
                    }}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                  />
                  <AmountSliderUsd
                    max={balance}
                    amount={amount}
                    onAmount={(v, isMax) => {
                      setAmount(v);
                      setAtMax(isMax);
                    }}
                    usdPrice={read.flrPriceUSD > 0 ? read.flrPriceUSD : null}
                  />
                  <p className="text-[10px] text-ink/35 mt-1.5">
                    {willUndelegate
                      ? t('Full exit: the delegation is removed and everything unwraps back to FLR.')
                      : t('A partial unwrap keeps your delegation % on the remaining WFLR.')}
                  </p>
                </div>

                {read.delegations.length > 0 && (
                  <div className="bg-ink/[0.03] border border-ink/5 rounded-xl p-3 space-y-1">
                    <p className="text-[11px] text-ink/40">{t('Currently delegated to')}</p>
                    {read.delegations.map((dl) => (
                      <p key={dl.provider} className="text-xs text-ink/70 font-mono">
                        {short(dl.provider)} · {(dl.bips / 100).toFixed(0)}%
                      </p>
                    ))}
                  </div>
                )}

                {!ownerIsConnected && (
                  <div className="bg-tone-warning/5 border border-tone-warning/25 rounded-xl p-3 text-xs text-tone-warning flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {t('Switch your wallet to the account that holds this position')} ({short(position.owner)}).
                    </span>
                  </div>
                )}

                {error && (
                  <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  onClick={prepare}
                  disabled={!atMax && !(amountNum > 0)}
                  className="w-full bg-volt text-black font-semibold text-sm py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('Review before signing')} →
                </button>
              </>
            )}
          </>
        )}

        {phase === 'preparing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-8 h-8 text-volt animate-spin" />
            <p className="text-sm text-ink/60">{t('Preparing the unsigned calls…')}</p>
          </div>
        )}

        {phase === 'review' && prepared && d && (
          <>
            <div className="bg-ink/[0.03] border border-ink/5 rounded-xl p-4">
              {d.undelegates && <Row label={t('Remove delegation')} value={t('all providers')} />}
              <Row label={t('Unwrap')} value={`${fmt(d.amountFlr)} WFLR → FLR`} />
              {!d.fullExit && (
                <Row label={t('Stays wrapped & delegated')} value={`${fmt(d.balanceWflr - d.amountFlr)} WFLR`} />
              )}
              {d.flrPriceUSD > 0 && <Row label={t('FLR/USD now')} value={`$${fmt(d.flrPriceUSD)}`} />}
              <Row label={t('Calls to sign')} value={String(prepared.calls.length)} />
              <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
              <Row label={t('Signing wallet')} value={short(prepared.account)} />
            </div>
            {d.note && <p className="text-[11px] text-ink/40 leading-relaxed">{t(d.note)}</p>}

            {error && (
              <div className="bg-tone-danger/5 border border-tone-danger/25 rounded-xl p-3 text-xs text-tone-danger flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setPrepared(null);
                  setPhase('form');
                }}
                className="flex-1 border border-ink/10 bg-ink/5 text-ink/70 text-sm py-3 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Back')}
              </button>
              <button
                onClick={sign}
                className="flex-1 bg-volt text-black font-semibold text-sm py-3 rounded-xl hover:brightness-110 transition-all"
              >
                {t('Sign in your wallet')}
              </button>
            </div>
          </>
        )}

        {phase === 'signing' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-8 h-8 text-volt animate-spin" />
            <p className="text-sm text-ink/60">{t('Confirm in your wallet…')}</p>
          </div>
        )}

        {phase === 'done' && settlement.state && (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <SettlementIndicator state={settlement.state} />
            <button
              onClick={onClose}
              className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
            >
              {t('Done')}
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}

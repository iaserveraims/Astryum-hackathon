'use client';

/**
 * PoteDepositModal — F2 entrada (escena 2). The client deposits FXRP into the
 * policy pote and the SHARES land on the client's own address — nobody else's.
 * Prepare-only backend; the connected wallet signs; the disclosure repeats the
 * exit speed the client already saw at decision time (F1).
 *
 * The credential gate speaks HERE when the pote is gated: a 409 from the
 * prepare is the product talking (scene 2), painted as a verdict, never
 * swallowed as an error.
 */

import { useState } from 'react';
import { Loader2, X, ShieldQuestion } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { translateError } from '../../lib/errors/translateError';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { prepareDeposit, type PreparedCalls, type Refusal } from '../../lib/institutional/api';
import { parseAmountToBase, type PolicyCard } from '../../lib/institutional/policyCatalog';

// 'unconfirmed' is set by applySignFailure: the amber ending renders on its own
// and no branch below offers the sign button while it holds.
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'unconfirmed';

export function PoteDepositModal({
  policy,
  onClose,
  onChanged,
}: {
  policy: PolicyCard;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('form');
  const [amount, setAmount] = useState('');
  const [xrplAccount, setXrplAccount] = useState('');
  const [needsCredential, setNeedsCredential] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [prepared, setPrepared] = useState<PreparedCalls | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);

  async function prepare() {
    setError('');
    setRefusal(null);
    setPhase('preparing');
    try {
      if (!evm.isConnected || !evm.address) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
      const amountBase = parseAmountToBase(amount, 6);
      if (!amountBase) throw new Error(t('Amount must be greater than 0'));
      const res = await prepareDeposit({
        pote: policy.poteAddress,
        amountBase: amountBase.toString(),
        receiver: evm.address,
        xrplAccount: xrplAccount.trim() || undefined,
      });
      if (!res.ok) {
        // The credential gate is the PRODUCT speaking (scene 2), not an error.
        if (res.refusal.error === 'CREDENTIAL_REQUIRED') setNeedsCredential(true);
        setRefusal(res.refusal);
        setPhase('form');
        return;
      }
      setPrepared(res.data);
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setUnconfirmed(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId }))
      );
      settlement.track(handle, { onSettled: onChanged });
      setPhase('done');
    } catch (e) {
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase,
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto max-h-[min(90dvh,44rem)] overflow-y-auto scrollbar-thin shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">{t(policy.title)}</h2>
            <p className="text-xs text-ink/60 mt-0.5">{t(policy.exitLine)} · {t('you choose the exit speed NOW, not when you need the money')}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase === 'form' || phase === 'preparing' ? (
          <div className="space-y-4">
            <label className="block text-xs text-ink/60">
              {t('Amount to deposit (FXRP)')}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink"
              />
            </label>

            {(needsCredential || xrplAccount) && (
              <label className="block text-xs text-ink/60">
                <span className="inline-flex items-center gap-1"><ShieldQuestion className="w-3 h-3" />{t('Your XRPL root account (this pote requires a credential)')}</span>
                <input
                  value={xrplAccount}
                  onChange={(e) => setXrplAccount(e.target.value)}
                  placeholder="r…"
                  className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono"
                />
              </label>
            )}

            {refusal && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink">
                <div className="font-semibold">{refusal.error}</div>
                {refusal.detail && <div className="mt-1 text-ink/70">{refusal.detail}</div>}
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              onClick={prepare}
              disabled={phase === 'preparing'}
              className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50"
            >
              {phase === 'preparing' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('Review deposit')}
            </button>
          </div>
        ) : null}

        {phase === 'review' && prepared ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-ink/10 bg-surface-2 p-3 space-y-1">
              <div className="text-xs font-semibold text-ink">{prepared.disclosure.title}</div>
              {prepared.disclosure.lines.map((line) => (
                <p key={line} className="text-xs text-ink/70">{line}</p>
              ))}
            </div>
            <ul className="space-y-1">
              {prepared.calls.map((c) => (
                <li key={c.data} className="text-xs text-ink/60">• {c.label}</li>
              ))}
            </ul>
            {error && <p className="text-xs text-danger">{error}</p>}
            <button onClick={sign} className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm">
              {t('Sign in your wallet')}
            </button>
          </div>
        ) : null}

        {phase === 'signing' ? (
          <div className="flex items-center gap-2 text-sm text-ink/70">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('Waiting for your wallet…')}
          </div>
        ) : null}

        {unconfirmed ? (
          <UnconfirmedSignatureNotice rail="evm" chainId={14} unconfirmed={unconfirmed} onClose={() => setUnconfirmed(null)} />
        ) : null}

        {phase === 'done' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">{t('Signed. Your shares appear once the receipt is read — never before.')}</p>
            <button onClick={onClose} className="w-full rounded-lg bg-surface-2 border border-ink/10 py-2 text-sm text-ink">
              {t('Close')}
            </button>
          </div>
        ) : null}
      </div>
    </ModalOverlay>
  );
}

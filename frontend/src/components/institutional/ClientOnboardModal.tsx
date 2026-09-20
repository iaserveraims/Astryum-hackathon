'use client';

/**
 * ClientOnboardModal — escena 2 en MODO B (exchange custodial): el OPERADOR
 * deposita el FXRP de un cliente en el pote, con `receiver` = la dirección del
 * cliente. El operador paga y firma; **las participaciones son del cliente** —
 * solo su firma puede redimirlas (invariante: el director nunca es approved).
 */

import { useEffect, useState } from 'react';
import { Loader2, X, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { translateError } from '../../lib/errors/translateError';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import {
  getCredentialGate,
  prepareDeposit,
  type CredentialGateRead,
  type PreparedCalls,
  type Refusal,
} from '../../lib/institutional/api';
import { parseAmountToBase, type PolicyCard } from '../../lib/institutional/policyCatalog';

// 'unconfirmed' is set by applySignFailure: the amber ending renders on its own
// and no branch below offers the sign button while it holds.
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'unconfirmed';
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function ClientOnboardModal({
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
  const [clientEvm, setClientEvm] = useState(''); // receiver de las participaciones
  const [clientXrpl, setClientXrpl] = useState(''); // raíz XRPL para la puerta
  const [amount, setAmount] = useState('');
  const [gate, setGate] = useState<CredentialGateRead | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [prepared, setPrepared] = useState<PreparedCalls | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);

  // Lee la puerta de credencial en cuanto hay una raíz XRPL válida.
  useEffect(() => {
    if (!XRPL_RE.test(clientXrpl.trim())) {
      setGate(null);
      return;
    }
    let cancelled = false;
    setGateLoading(true);
    (async () => {
      try {
        const g = await getCredentialGate(policy.poteAddress, clientXrpl.trim());
        if (!cancelled) setGate(g);
      } catch {
        if (!cancelled) setGate(null);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientXrpl, policy.poteAddress]);

  // La puerta bloquea el onboard SOLO si el pote está gateado y el cliente no está limpio.
  const gateBlocks = gate?.gated === true && gate?.open !== true;

  async function prepare() {
    setError('');
    setRefusal(null);
    setPhase('preparing');
    try {
      if (!evm.isConnected || !evm.address) throw new Error(t('Connect the operator EVM wallet (Flare) to continue'));
      if (!EVM_RE.test(clientEvm.trim())) throw new Error(t('The client address (receiver of the shares) is not valid'));
      const amountBase = parseAmountToBase(amount, 6);
      if (!amountBase) throw new Error(t('Amount must be greater than 0'));
      const res = await prepareDeposit({
        pote: policy.poteAddress,
        amountBase: amountBase.toString(),
        receiver: clientEvm.trim(),
        xrplAccount: clientXrpl.trim() || undefined,
      });
      if (!res.ok) {
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
            <h2 className="text-base font-semibold text-ink">{t('Onboard a client (custodial)')}</h2>
            <p className="text-xs text-ink/60 mt-0.5">{t(policy.title)} · {t(policy.exitLine)}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {(phase === 'form' || phase === 'preparing') && (
          <div className="space-y-4">
            <p className="text-xs text-ink/60">
              {t('You (the operator) pay and sign; the shares belong to the client. Only the client can redeem them — you never can. There is no new deposit: the capital was already yours to custody, this only changes its state.')}
            </p>

            <label className="block text-xs text-ink/60">
              {t("Client address (receiver of the shares)")}
              <input
                value={clientEvm}
                onChange={(e) => setClientEvm(e.target.value)}
                placeholder="0x…"
                className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono"
              />
            </label>

            <label className="block text-xs text-ink/60">
              {t("Client XRPL root (checked against the credential gate)")}
              <input
                value={clientXrpl}
                onChange={(e) => setClientXrpl(e.target.value)}
                placeholder="r…"
                className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono"
              />
            </label>

            {gateLoading ? (
              <p className="text-xs text-ink/50"><Loader2 className="w-3 h-3 animate-spin inline" /> {t('Checking the credential…')}</p>
            ) : gate?.gated === false ? (
              <p className="text-xs text-ink/50">{t('This pote is not credential-gated.')}</p>
            ) : gate?.open === true ? (
              <p className="text-xs text-muted inline-flex items-center gap-1" style={{ color: 'var(--muscle, #1F6F70)' }}>
                <ShieldCheck className="w-3.5 h-3.5" /> {t('Client cleared: a valid credential is on the ledger.')}
              </p>
            ) : gate ? (
              <p className="text-xs text-danger inline-flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> {t('Client NOT cleared: no valid credential from a configured issuer. Issue and accept it first.')}
              </p>
            ) : null}

            <label className="block text-xs text-ink/60">
              {t('Amount (FXRP)')}
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink"
              />
            </label>

            {refusal && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink">
                <div className="font-semibold">{refusal.error}</div>
                {refusal.detail && <div className="mt-1 text-ink/70">{refusal.detail}</div>}
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              onClick={prepare}
              disabled={phase === 'preparing' || gateBlocks}
              className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50"
            >
              {phase === 'preparing' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('Review onboarding deposit')}
            </button>
          </div>
        )}

        {phase === 'review' && prepared && (
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
              {t('Sign as operator')}
            </button>
          </div>
        )}

        {phase === 'signing' && (
          <div className="flex items-center gap-2 text-sm text-ink/70">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('Waiting for the operator wallet…')}
          </div>
        )}

        {unconfirmed && (
          <UnconfirmedSignatureNotice rail="evm" chainId={14} unconfirmed={unconfirmed} onClose={() => setUnconfirmed(null)} />
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t('Onboarded. The shares are on the client address once the receipt is read. From here, only the client can take them out — and you cannot stop them.')}
            </p>
            <button onClick={onClose} className="w-full rounded-lg bg-surface-2 border border-ink/10 py-2 text-sm text-ink">
              {t('Close')}
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}

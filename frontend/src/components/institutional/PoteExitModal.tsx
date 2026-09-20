'use client';

/**
 * PoteExitModal — F2 salida (escena 5). The holder's exit, unilateral by
 * construction: the backend picks the honest door for the pote's shape —
 * synchronous redeem (pote A) or requestRedeem with the cooldown the client
 * accepted at entry (pote B). The MAX is the holder's REAL share balance read
 * on-chain, never a guess.
 *
 * productizer it. 25 (§1) — EL CÓDIGO CRUDO Y EL CASTELLANO, EN LA PANTALLA DE
 * SALIDA. La it. 23 dijo haber cerrado esto «en las diez superficies» y esta no
 * estaba en la lista: el rechazo se pintaba como `{refusal.error}` (el slug del
 * servidor: `NOT_REDEEMABLE_NOW`, `ABOVE_MAX_REDEEM`…) sobre `{refusal.detail}`,
 * que en este router se compone en castellano (`badRequest(res, 'sharesBase debe
 * ser…')`). Una persona que sale de un pote leía un identificador y un párrafo
 * en un idioma que la pantalla no habla, y no aprendía ni qué pasó ni qué hacer.
 *
 * Ahora: UNA frase — la del lector compartido, que conoce las familias de
 * códigos (asiento, «no pude leer» reintentable, los dos 409 deterministas) y
 * cae en la genérica honesta cuando lo único que llegó es un slug — y, debajo,
 * el `detail` del servidor SOLO si viene en inglés; si no, nuestra propia frase,
 * que nombra el paso siguiente. Y cuando el rechazo es uno de los que tienen
 * camino, el aviso compartido lo ofrece (reintento / entrar con la wallet).
 */

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { translateError } from '../../lib/errors/translateError';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { getPoteState, prepareRedeem, type PoteState, type PreparedRedeem, type Refusal } from '../../lib/institutional/api';
import { fmtBase, type PolicyCard } from '../../lib/institutional/policyCatalog';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { SeatRefusalNotice, seatRefusalView } from '../wallet/SeatRefusalNotice';

// 'unconfirmed' is set by applySignFailure: the amber ending renders on its own
// and no branch below offers the sign button while it holds.
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'unconfirmed';
const PCT_CHOICES = [25, 50, 100] as const;

export function PoteExitModal({
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
  const [state, setState] = useState<PoteState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [pct, setPct] = useState<(typeof PCT_CHOICES)[number]>(100);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [prepared, setPrepared] = useState<PreparedRedeem | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);

  useEffect(() => {
    if (!evm.address) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getPoteState(policy.poteAddress, evm.address!);
        if (!cancelled) setState(s);
      } catch {
        // Without the live share balance there is no truthful MAX — say so
        // instead of offering a blind form.
        if (!cancelled) setReadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [policy.poteAddress, evm.address]);

  const holderShares = BigInt(state?.holder?.shares ?? '0');
  // BigInt(...) instead of `n` literals: the frontend tsconfig targets ES2017.
  const sharesBase = (holderShares * BigInt(pct)) / BigInt(100);
  const estAssets =
    state && BigInt(state.totalSupply) > BigInt(0)
      ? (sharesBase * BigInt(state.totalAssets)) / BigInt(state.totalSupply)
      : BigInt(0);

  async function prepare() {
    setError('');
    setRefusal(null);
    setPhase('preparing');
    try {
      if (!evm.isConnected || !evm.address) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
      if (sharesBase <= BigInt(0)) throw new Error(t('You hold no shares of this pote'));
      const res = await prepareRedeem({
        pote: policy.poteAddress,
        sharesBase: sharesBase.toString(),
        receiver: evm.address,
        owner: evm.address,
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
            <h2 className="text-base font-semibold text-ink">{t('Exit')} — {t(policy.title)}</h2>
            <p className="text-xs text-ink/60 mt-0.5">{t(policy.exitLine)}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {readFailed ? (
          <p className="text-xs text-danger">{t('Could not read your share balance — try again. Nothing was signed.')}</p>
        ) : null}

        {(phase === 'form' || phase === 'preparing') && state ? (
          <div className="space-y-4">
            <div className="text-xs text-ink/70">
              {t('Your shares')}: <span className="font-mono">{fmtBase(holderShares, state.shareDecimals)}</span>
              {' · '}
              {t('estimated value')}: <span className="font-mono">{fmtBase(estAssets, state.asset.decimals)} {state.asset.symbol}</span>
            </div>
            <div className="flex gap-2">
              {PCT_CHOICES.map((p) => (
                <button
                  key={p}
                  onClick={() => setPct(p)}
                  className={`flex-1 rounded-lg border py-1.5 text-sm ${pct === p ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}
                >
                  {p}%
                </button>
              ))}
            </div>

            {refusal && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink">
                <div className="font-semibold">
                  {refusalHeadline(refusal, t) ??
                    t('The server refused this exit. Nothing was prepared and nothing was signed.')}
                </div>
                <div className="mt-1 text-ink/70">
                  {serverDetailIfEnglish(refusal.detail) ??
                    t('Your shares are exactly where they were. Change the amount, or try again in a moment — and write to us if it keeps refusing.')}
                </div>
              </div>
            )}
            {/* The refusals that have a way forward say so here: a read of ours
                that failed gets its retry, and the two deterministic 409s get
                the wallet door. Renders nothing for anything else. */}
            {refusal && seatRefusalView(refusal, t) ? (
              <SeatRefusalNotice refusal={refusal} t={t} onPrepareAgain={() => void prepare()} />
            ) : null}
            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              onClick={prepare}
              disabled={phase === 'preparing' || sharesBase <= BigInt(0)}
              className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50"
            >
              {phase === 'preparing' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : t('Review exit')}
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
            {prepared.mode === 'request' && prepared.maturityISO ? (
              <p className="text-xs text-ink/70">
                {t('Claimable from')}: <span className="font-mono">{new Date(prepared.maturityISO).toLocaleString()}</span>
              </p>
            ) : null}
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
            <p className="text-sm text-ink">
              {prepared?.mode === 'request'
                ? t('Exit requested. Your ticket appears in “My exits” with its clock — anyone can complete the claim when it matures; nobody can stop it.')
                : t('Signed. The pote unwinds the venues inside your own transaction.')}
            </p>
            <button onClick={onClose} className="w-full rounded-lg bg-surface-2 border border-ink/10 py-2 text-sm text-ink">
              {t('Close')}
            </button>
          </div>
        ) : null}
      </div>
    </ModalOverlay>
  );
}

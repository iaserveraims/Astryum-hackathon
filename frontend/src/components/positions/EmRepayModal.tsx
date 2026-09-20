'use client';

/**
 * EmRepayModal — the repay DOOR of the Ethereum FXRP/RLUSD position (W5/B7,
 * M1 pattern end to end): the nudge only points here; the legs are composed
 * FRESH by POST /eth-morpho/prepare when this door opens (debt grows with
 * interest; repay-full needs LIVE borrowShares — trigger-time calldata would
 * arrive stale at the signature). The OWNER signs on Ethereum; Astryum never
 * signs, never broadcasts.
 *
 * Small twin of the entry modal's em branch: same adapters (units 6/18 read
 * from the response, legs→calls with chainId per call, preflight → the
 * app-wide PreflightInfo), same honest review (live numbers, finite
 * approvals, fees before signing).
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ModalOverlay } from '../ui/ModalPortal';
import { GhostButton, PrimaryButton } from '../ui/primitives';
import { ExitRiskWarnings } from '../preflight/ExitRiskWarnings';
import { parseRiskWarnings } from '../../lib/earn/exitRiskWarnings';
import {
  decimalsFallbackNote,
  decimalsRefusalMessage,
  decimalsVerdict,
  isTransientStatus,
  resolveExitDecimals,
  type DecimalsSource,
  type ResolvedDecimals,
} from '../../lib/earn/exitReadState';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import {
  toBaseUnits,
  baseToHuman,
  emCallsFromLegs,
  emPreflightInfo,
  type EmLeg,
  type EmPrepareEnvelope,
} from '../../lib/earn/ethMorphoPrepare';
import { isInFlight, inFlightInfo, inFlightMessage, explorerTxUrl } from '../../lib/wallet/inFlightError';
import { signOutcome } from '../../lib/wallet/signOutcome';

const API_BASE = getApiBase();

// Local copy of the Bearer header builder (Builder A's F1 infra will unify).
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface EmRepayPrepared extends EmPrepareEnvelope {
  chainId: number;
  legs: EmLeg[];
  decimals: { collateral: number; loan: number };
  position: { collateral: string; borrowAssets: string; healthFactor: number | null };
  positionAfter: { healthFactor: number | null };
  disclosure: {
    signerNote: string;
    astryumFeeBase: string;
    // H8 — el prepare YA devolvía estos hechos y la puerta que más importa
    // los tiraba: LLTV, tipo del préstamo con su fuente y la nota de
    // liquidación. Se firma con ellos delante, no de memoria.
    lltvPct?: number;
    borrowAprPct?: number | null;
    borrowAprSource?: string;
    liquidationNote?: string;
  };
  /**
   * La munición sacada de la bóveda de Sentora, cuando la wallet no cubre y la
   * bóveda sí: la retirada del hueco exacto es la PRIMERA pata de esta firma.
   * `null` cuando la wallet cubre sola (la bóveda no se toca).
   */
  fromVault?: {
    withdrawnBase: string;
    walletBalanceBase: string;
    vaultClaimBase: string;
    vaultAvailableNowBase: string;
    note: string;
  } | null;
}

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'error';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink/45">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}

export function EmRepayModal({
  owner,
  initialMode = 'partial',
  onClose,
  onChanged,
}: {
  /** The EVM wallet that HOLDS the position and signs on Ethereum. */
  owner: string;
  initialMode?: 'partial' | 'full';
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('form');
  const [mode, setMode] = useState<'partial' | 'full'>(initialMode);
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<EmRepayPrepared | null>(null);
  const [preflight, setPreflight] = useState<PreflightInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  /** The failure was a READ (server unreachable, 5xx, decimals unconfirmed): offer Retry, not a dead end. */
  const [retryable, setRetryable] = useState(false);
  const [decimalsSource, setDecimalsSource] = useState<DecimalsSource>('market');
  /** La transaccion SALIO y no se pudo leer su recibo: ni exito ni fallo. */
  const [inFlight, setInFlight] = useState<import('../../lib/wallet/inFlightError').InFlightInfo | null>(null);

  const signerMatches =
    !!evm.address && evm.address.toLowerCase() === owner.toLowerCase();

  async function prepare() {
    setErrorMsg('');
    setRetryable(false);
    setPhase('preparing');
    try {
      const region = getUserRegion();
      let amountBase: string | undefined;
      let used: ResolvedDecimals | null = null;
      if (mode === 'partial') {
        // Decimals READ from the module's own endpoint — never blindly assumed
        // (F4). The read is for decimals only: if it fails the repay (an EXIT,
        // never gated) goes on with the documented RLUSD 18, and the prepare
        // below must confirm it on-chain before any review exists.
        let marketDecimals: { collateral?: unknown; loan?: unknown } | null = null;
        try {
          const mres = await fetch(
            `${API_BASE}/eth-morpho/market?region=${encodeURIComponent(region ?? '')}`,
            { headers: authHeaders(), credentials: 'include' },
          );
          const minfo = await mres.json().catch(() => ({}));
          if (mres.ok) marketDecimals = minfo?.decimals ?? null;
        } catch {
          marketDecimals = null;
        }
        used = resolveExitDecimals({ side: 'loan', market: marketDecimals });
        try {
          amountBase = toBaseUnits(amount, used.decimals);
        } catch {
          throw new Error(t('enter a valid amount greater than 0'));
        }
      }
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/eth-morpho/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            action: 'repay',
            user: owner,
            repayMode: mode,
            ...(amountBase ? { amountBase } : {}),
            // El saldo decide, no el usuario: si la wallet no cubre y el RLUSD
            // está prestado en Sentora (el propio carry lo deja ahí), el servidor
            // antepone la retirada del hueco exacto en la MISMA firma. Con la
            // wallet cubriendo, la bóveda no se toca. Antes, este caso era
            // INSUFFICIENT_BALANCE y un viaje a otra pantalla con la liquidación
            // corriendo.
            fromVault: true,
            region,
          }),
        });
      } catch {
        throw Object.assign(
          new Error(t("Couldn't reach the server to prepare this — nothing was sent to your wallet.")),
          { retryable: true },
        );
      }
      const body = (await res.json().catch(() => ({}))) as EmRepayPrepared & {
        error?: string; detail?: string;
      };
      if (!res.ok) {
        if (body.error === 'NO_DEBT') {
          throw new Error(t('This position has no live debt — nothing to repay.'));
        }
        if (body.error === 'REPAY_EXCEEDS_DEBT') {
          throw new Error(t('That is more than the live debt — use the full-repay option to close it.'));
        }
        throw Object.assign(new Error(body.detail || body.error || `HTTP ${res.status}`), {
          retryable: isTransientStatus(res.status),
        });
      }
      if (used) {
        const verdict = decimalsVerdict(used, body.decimals?.loan);
        if (verdict !== 'ok') {
          throw Object.assign(new Error(t(decimalsRefusalMessage(verdict))), { retryable: true });
        }
      }
      setDecimalsSource(used?.source ?? 'market');
      setPrepared(body);
      setPreflight(emPreflightInfo(body));
      setPhase('review');
    } catch (e) {
      setErrorMsg((e as Error).message ?? String(e));
      setRetryable((e as { retryable?: boolean }).retryable === true);
      setPhase('error');
    }
  }

  async function sign() {
    if (!prepared) return;
    setErrorMsg('');
    setPhase('signing');
    // True from the moment the calls go to the wallet: after that, an error
    // that does not PROVE nothing left is unconfirmed, never a way back.
    let handedToPartner = false;
    try {
      if (!signerMatches) {
        throw new Error(t('Your connected EVM account is different — reconnect with the selected wallet to sign.'));
      }
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        emCallsFromLegs(prepared.legs, prepared.chainId),
      );
      settlement.track(handle, { onSettled: () => onChanged?.() });
      setPhase('done');
    } catch (e) {
      // EN VUELO no es un fallo: reintentar es como se repaga dos veces. Y un
      // «Failed to fetch» o un timeout DESPUÉS de entregar las llamadas tampoco
      // lo es (signOutcome): la misma salida ámbar, sin volver al formulario.
      const unconfirmed = isInFlight(e) || signOutcome(e, handedToPartner).kind === 'unconfirmed';
      setInFlight(unconfirmed ? (inFlightInfo(e) ?? {}) : null);
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  const loanDecimals = prepared?.decimals.loan ?? 18;
  const debtHuman = prepared ? baseToHuman(prepared.position.borrowAssets, loanDecimals) : null;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Repay RLUSD (Ethereum)')}</h2>
            <p className="text-[11px] text-ink/45 mt-0.5">
              {t('Prepared fresh with the live debt — you sign in your own wallet.')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === 'form' && (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('partial')}
                  className={`flex-1 text-[12px] px-3 py-2 rounded-lg border transition-colors ${mode === 'partial' ? 'border-volt/50 bg-volt/10 text-ink' : 'border-ink/10 text-ink/50 hover:bg-ink/5'}`}
                >
                  {t('Repay an amount')}
                </button>
                <button
                  onClick={() => setMode('full')}
                  className={`flex-1 text-[12px] px-3 py-2 rounded-lg border transition-colors ${mode === 'full' ? 'border-volt/50 bg-volt/10 text-ink' : 'border-ink/10 text-ink/50 hover:bg-ink/5'}`}
                >
                  {t('Close the whole debt')}
                </button>
              </div>
              {mode === 'partial' ? (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('RLUSD to repay')}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                  />
                </div>
              ) : (
                <p className="text-[12px] text-ink/55 leading-relaxed">
                  {t('The whole LIVE debt is repaid with zero dust — the exact figure is computed when you press continue, and shown before you sign.')}
                </p>
              )}
              <PrimaryButton
                onClick={() => void prepare()}
                disabled={mode === 'partial' && !(parseFloat(amount.replace(',', '.')) > 0)}
                className="w-full"
              >
                {t('Review before signing')}
              </PrimaryButton>
            </>
          )}

          {phase === 'preparing' && (
            <p className="text-sm text-ink/50 py-6 text-center">{t('Reading the live position…')}</p>
          )}

          {phase === 'review' && prepared && (
            <>
              {/* El escáner avisa, no bloquea: repagar es SALIR, y se firma con
                  los flags delante (invariantes #6/#10). */}
              <ExitRiskWarnings warnings={parseRiskWarnings(prepared)} />
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                <Row label={t('Live debt')} value={`${debtHuman} RLUSD`} />
                <Row
                  label={t('You repay')}
                  value={mode === 'full' ? t('the whole live debt (zero dust)') : `${amount} RLUSD`}
                />
                {prepared.fromVault && (
                  <Row
                    label={t('Taken from your Sentora vault')}
                    value={`${baseToHuman(prepared.fromVault.withdrawnBase, loanDecimals)} RLUSD · ${t('your wallet holds')} ${baseToHuman(prepared.fromVault.walletBalanceBase, loanDecimals)} RLUSD`}
                  />
                )}
                <Row
                  label={t('Health factor after')}
                  value={
                    prepared.positionAfter.healthFactor == null
                      ? t('no debt — nothing can liquidate')
                      : `${prepared.positionAfter.healthFactor.toFixed(2)} · ${t('liquidation at 1.00')}`
                  }
                />
                {typeof prepared.disclosure.lltvPct === 'number' && (
                  <Row
                    label={t('Liquidation limit (LLTV)')}
                    value={`${prepared.disclosure.lltvPct.toFixed(2)}%`}
                  />
                )}
                {prepared.disclosure.borrowAprSource && (
                  <Row
                    label={t('Borrow rate')}
                    value={
                      typeof prepared.disclosure.borrowAprPct === 'number'
                        ? `${prepared.disclosure.borrowAprPct.toFixed(2)}%`
                        : t('unavailable right now — not invented')
                    }
                  />
                )}
                <Row label={t('Approvals')} value={t('finite — the exact amount, never unlimited')} />
                <Row label={t('Astryum fee')} value={prepared.disclosure.astryumFeeBase === '0' ? t('None') : prepared.disclosure.astryumFeeBase} />
                <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                <Row label={t('Signing wallet')} value={`${owner.slice(0, 8)}… · Ethereum`} />
              </div>
              <PreflightNotice preflight={preflight ?? undefined} />
              {decimalsFallbackNote(decimalsSource) && (
                <p className="text-[11px] text-tone-warning leading-relaxed">
                  {t(decimalsFallbackNote(decimalsSource) as string)}
                </p>
              )}
              {prepared.fromVault && (
                <p className="text-[11px] text-ink/50 leading-relaxed">
                  {t('The shortfall is redeemed from your Sentora lend position as the first leg of this signature — the rest of your lent RLUSD stays lent.')}
                </p>
              )}
              {prepared.disclosure.liquidationNote && (
                <p className="text-[11px] text-ink/50 leading-relaxed">{prepared.disclosure.liquidationNote}</p>
              )}
              {prepared.disclosure.borrowAprSource && (
                <p className="text-[10px] text-ink/35">
                  {t('Rate source')}: {prepared.disclosure.borrowAprSource}
                </p>
              )}
              <p className="text-[11px] text-ink/40">{prepared.disclosure.signerNote}</p>
              <PrimaryButton
                onClick={() => void sign()}
                disabled={!signerMatches || preflightSaysFail(preflight)}
                className="w-full"
              >
                {preflightSaysFail(preflight)
                  ? t('The dry-run says this would fail')
                  : t('Sign in your wallet')}
              </PrimaryButton>
              {!signerMatches && (
                <p className="text-[11px] text-tone-warning">
                  {t('Your connected EVM account is different — reconnect with the selected wallet to sign.')}
                </p>
              )}
            </>
          )}

          {phase === 'signing' && (
            <p className="text-sm text-ink/50 py-6 text-center">{t('Confirm in your wallet…')}</p>
          )}

          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center py-4 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Confirmed on-chain — the position appears in Positions.')}
                pendingText={t('Signed — confirming on Ethereum…')}
                protocol="morpho"
              />
            </div>
          )}

          {phase === 'error' && (
            <>
              <p className={`text-sm leading-relaxed ${inFlight ? 'text-tone-warning' : 'text-tone-danger'}`}>
                {inFlight ? inFlightMessage(inFlight, t) : errorMsg}
              </p>
              {inFlight?.txHash && (
                <a
                  href={explorerTxUrl(1, inFlight.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sky-300 hover:text-sky-200 underline underline-offset-2 block"
                >
                  {t('Check it on the explorer →')}
                </a>
              )}
              <PrimaryButton
                onClick={() => (inFlight ? onClose() : retryable ? void prepare() : setPhase('form'))}
                className="w-full"
              >
                {inFlight ? t('Close') : retryable ? t('Try again') : t('Back')}
              </PrimaryButton>
              {!inFlight && retryable && (
                <GhostButton onClick={() => setPhase('form')} className="w-full">
                  {t('Back')}
                </GhostButton>
              )}
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

export default EmRepayModal;

'use client';

/**
 * EmCloseModal — CANCELAR LA POSICIÓN ENTERA, en una firma.
 *
 * El problema que resuelve (fundador, 29-ago-2026): para cerrar del todo hay
 * que devolver MÁS de lo que se pidió prestado, porque la deuda devenga interés
 * (~7,5% APR) y lo prestado en la bóveda rinde menos (~6,2%). Ese hueco obligaba
 * al usuario a traer RLUSD de otra cadena — fricción fea en un producto que
 * vende abstracción.
 *
 * No hace falta traer nada: la posición está sobrecolateralizada por diseño y
 * ese exceso se puede retirar ANTES de repagar. Con él se compra el hueco EXACTO
 * (swap `exactOutput`, sin vuelta) y se cierra. Las siete patas viajan en UN
 * lote que el usuario firma una vez.
 *
 * DOCTRINA DE LA CASA (31-jul): elegir es OBLIGATORIO. Si hay hueco, esta
 * pantalla NO decide por él — enseña el hueco y bloquea la firma hasta que
 * marque una de las dos opciones. Un default silencioso que vende su colateral
 * es exactamente lo que no hacemos.
 *
 * Todo lo que se pinta viene del `/close/prepare` del servidor: aquí no se
 * calcula nada, solo se convierte de base units a humano (regla R0).
 */
import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { PrimaryButton, GhostButton } from '../ui/primitives';
import { ModalOverlay } from '../ui/ModalPortal';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { isInFlight, inFlightInfo, inFlightMessage, explorerTxUrl } from '../../lib/wallet/inFlightError';
import { signOutcome } from '../../lib/wallet/signOutcome';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { ExitRiskWarnings } from '../preflight/ExitRiskWarnings';
import { parseRiskWarnings } from '../../lib/earn/exitRiskWarnings';
import {
  baseToHuman,
  emCallsFromLegs,
  emPreflightInfo,
  type EmLeg,
  type EmPrepareEnvelope,
} from '../../lib/earn/ethMorphoPrepare';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Cómo cubrir el hueco. `null` = todavía no ha elegido (y no se puede firmar). */
type CoverGap = 'swap-collateral' | 'wallet' | null;

interface ClosePrepared extends EmPrepareEnvelope {
  chainId: number;
  legs: EmLeg[];
  decimals: { collateral: number; loan: number };
  close: {
    needBase: string;
    fromVaultBase: string;
    fromWalletBase: string;
    gapBase: string;
    coverGap: CoverGap;
    swap: {
      venue: string;
      feeTier: number;
      collateralInQuotedBase: string;
      collateralInMaxBase: string;
      slippagePct: number;
      note: string;
    } | null;
    collateralReturnedBase: string;
    note: string;
  };
  disclosure: { signerNote: string; astryumFeeBase: string; carryNote: string };
}

type Phase = 'loading' | 'plan' | 'signing' | 'done' | 'error';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink/45">{label}</span>
      <span className={`text-right ${strong ? 'text-ink font-medium' : 'text-ink/85'}`}>{value}</span>
    </div>
  );
}

export function EmCloseModal({
  owner,
  onClose,
  onChanged,
}: {
  /** La wallet EVM que TIENE la posición y firma en Ethereum. */
  owner: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('loading');
  const [cover, setCover] = useState<CoverGap>(null);
  const [prepared, setPrepared] = useState<ClosePrepared | null>(null);
  const [preflight, setPreflight] = useState<PreflightInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [inFlight, setInFlight] = useState<ReturnType<typeof inFlightInfo>>(null);

  const signerMatches = !!evm.address && evm.address.toLowerCase() === owner.toLowerCase();

  /** Pide el plan al servidor. Sin elección la primera vez: queremos ver el hueco. */
  async function load(coverGap: CoverGap) {
    setErrorMsg('');
    setPhase('loading');
    try {
      const res = await fetch(`${API_BASE}/eth-morpho/close/prepare`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          user: owner,
          ...(coverGap ? { coverGap } : {}),
          region: getUserRegion(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ClosePrepared & { error?: string; detail?: string };
      if (!res.ok) {
        if (body.error === 'NO_POSITION') throw new Error(t('There is no position to close.'));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      setPrepared(body);
      setPreflight(emPreflightInfo(body));
      setPhase('plan');
    } catch (e) {
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  // Primera carga: sin elección, para que el hueco se vea antes de decidir.
  if (phase === 'loading' && !prepared && !errorMsg) void load(null);

  function choose(c: CoverGap) {
    setCover(c);
    void load(c);
  }

  async function sign() {
    if (!prepared) return;
    setErrorMsg('');
    setPhase('signing');
    // True from the moment the calls go to the wallet: after that, an error
    // that does not PROVE nothing left is unconfirmed, never «Try again».
    let handedToPartner = false;
    try {
      if (!signerMatches) {
        throw new Error(t('Your connected EVM account is different — reconnect with the selected wallet to sign.'));
      }
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(emCallsFromLegs(prepared.legs, prepared.chainId));
      settlement.track(handle, { onSettled: () => onChanged?.() });
      setPhase('done');
    } catch (e) {
      // «Salió y no sé si entró» NO es un fallo: reintentar aquí cierra dos veces.
      // Tampoco un «Failed to fetch» o un timeout DESPUÉS de entregar las
      // llamadas (signOutcome): misma salida ámbar, con «Close» y sin «Try again».
      const unconfirmed = isInFlight(e) || signOutcome(e, handedToPartner).kind === 'unconfirmed';
      setInFlight(unconfirmed ? (inFlightInfo(e) ?? {}) : null);
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  const c = prepared?.close;
  const ld = prepared?.decimals.loan ?? 18;
  const cd = prepared?.decimals.collateral ?? 6;
  const hasGap = !!c && BigInt(c.gapBase) > BigInt(0);
  // Con hueco y sin elección, la firma se queda cerrada a propósito.
  const canSign = !!prepared && (!hasGap || cover === 'swap-collateral') && !preflightSaysFail(preflight) && signerMatches;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Close the whole position')}</h2>
            <p className="text-[11px] text-ink/45 mt-0.5">
              {t('One signature: recover what you lent, repay everything, take your collateral back.')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === 'loading' && (
            <p className="text-sm text-ink/50 py-6 text-center">{t('Reading your live position…')}</p>
          )}

          {(phase === 'plan' || phase === 'signing') && prepared && c && (
            <>
              {/* Cerrar es la salida por excelencia: el escáner avisa, no
                  bloquea — se firma con los flags delante (invariantes #6/#10). */}
              <ExitRiskWarnings warnings={parseRiskWarnings(prepared)} />
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                <Row label={t('You must return')} value={`${baseToHuman(c.needBase, ld, 4)} RLUSD`} strong />
                <Row label={t('From your Sentora position')} value={`${baseToHuman(c.fromVaultBase, ld, 4)} RLUSD`} />
                <Row label={t('From your wallet')} value={`${baseToHuman(c.fromWalletBase, ld, 4)} RLUSD`} />
                {hasGap && (
                  <Row
                    label={t('Missing — this is the interest')}
                    value={`${baseToHuman(c.gapBase, ld, 6)} RLUSD`}
                    strong
                  />
                )}
                {c.swap && (
                  <>
                    <Row
                      label={t('Collateral sold to cover it')}
                      value={`${baseToHuman(c.swap.collateralInQuotedBase, cd, 6)} FXRP`}
                    />
                    <Row
                      label={t('Spending cap for that swap')}
                      value={`${baseToHuman(c.swap.collateralInMaxBase, cd, 6)} FXRP · ${c.swap.venue}`}
                    />
                  </>
                )}
                <Row
                  label={t('Collateral back to you')}
                  value={`${baseToHuman(c.collateralReturnedBase, cd, 4)} FXRP`}
                  strong
                />
                <Row label={t('Astryum fee')} value={prepared.disclosure.astryumFeeBase === '0' ? t('None') : prepared.disclosure.astryumFeeBase} />
                <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
              </div>

              <p className="text-[11px] text-ink/50 leading-relaxed">{c.note}</p>

              {/* El hueco: elegir es OBLIGATORIO. La firma no se abre sin decisión. */}
              {hasGap && (
                <div className="rounded-xl border border-tone-warning/30 bg-tone-warning/5 p-3 space-y-2">
                  <p className="text-xs text-ink/80 font-medium">
                    {t('Closing costs more than you borrowed. Choose how to cover the difference:')}
                  </p>
                  <button
                    onClick={() => choose('swap-collateral')}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      cover === 'swap-collateral'
                        ? 'border-volt/50 bg-volt/10'
                        : 'border-ink/15 hover:bg-ink/5'
                    }`}
                  >
                    <div className="text-xs font-medium text-ink">{t('Sell the minimum collateral, in this same transaction')}</div>
                    <div className="text-[10px] text-ink/45 mt-0.5">
                      {t('It buys exactly what is missing. Anything unspent stays yours.')}
                    </div>
                  </button>
                  <button
                    onClick={() => choose('wallet')}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      cover === 'wallet' ? 'border-volt/50 bg-volt/10' : 'border-ink/15 hover:bg-ink/5'
                    }`}
                  >
                    <div className="text-xs font-medium text-ink">{t('I will bring the RLUSD myself')}</div>
                    <div className="text-[10px] text-ink/45 mt-0.5">
                      {t('Send it to your wallet on Ethereum and come back.')}
                    </div>
                  </button>
                </div>
              )}

              <PreflightNotice preflight={preflight ?? undefined} />
              <p className="text-[10px] text-ink/35 leading-relaxed">{prepared.disclosure.carryNote}</p>
              <p className="text-[11px] text-ink/40">{prepared.disclosure.signerNote}</p>

              {phase === 'signing' ? (
                <p className="text-sm text-ink/50 py-3 text-center">{t('Confirm in your wallet…')}</p>
              ) : (
                <PrimaryButton onClick={() => void sign()} disabled={!canSign} className="w-full">
                  {hasGap && !cover
                    ? t('Choose how to cover the difference')
                    : preflightSaysFail(preflight)
                      ? t('The dry-run says this would fail')
                      : t('Close the position — one signature')}
                </PrimaryButton>
              )}
              {!signerMatches && (
                <p className="text-[11px] text-tone-warning">
                  {t('Your connected EVM account is different — reconnect with the selected wallet to sign.')}
                </p>
              )}
            </>
          )}

          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center py-4 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Position closed. Your FXRP is back in your wallet.')}
                pendingText={t('Signed — confirming on Ethereum…')}
              />
              <GhostButton onClick={onClose} className="w-full">
                {t('Done')}
              </GhostButton>
            </div>
          )}

          {phase === 'error' && (
            <>
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-tone-warning" />
                <p className={`text-sm leading-relaxed ${inFlight ? 'text-tone-warning' : 'text-tone-danger'}`}>
                  {inFlight ? inFlightMessage(inFlight, t) : errorMsg}
                </p>
              </div>
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
              <PrimaryButton onClick={() => (inFlight ? onClose() : void load(cover))} className="w-full">
                {inFlight ? t('Close') : t('Try again')}
              </PrimaryButton>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

export default EmCloseModal;

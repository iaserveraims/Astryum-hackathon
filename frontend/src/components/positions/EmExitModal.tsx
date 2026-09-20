'use client';

/**
 * EmExitModal — LA SALIDA del carril de Ethereum (H2).
 *
 * El hueco que cerraba: el backend tenía las dos patas de salida construidas
 * y testeadas (`withdraw_collateral` en Morpho, `vault_withdraw` en la bóveda
 * Sentora) y **no había un solo botón que las llamara**. La card de lend-only
 * llegaba a prometer literalmente «Withdraw: anytime, against the vault's
 * live liquidity» sin puerta que lo cumpliera, y el runbook del ensayo E2E
 * describía un recorrido —repagar, sacar colateral, puentear de vuelta— cuyo
 * segundo paso no existía en la interfaz.
 *
 * Dos modos, una puerta:
 *   'collateral' → saca FXRP del colateral del mercado (pre-flight de salud:
 *      sacar colateral con deuda viva puede liquidar, y el backend lo bloquea
 *      ANTES de la firma).
 *   'vault'      → redime RLUSD de la bóveda Sentora (pre-flight de
 *      `maxWithdraw`: la liquidez de la bóveda manda sobre tu saldo).
 *
 * Mismo patrón que EmRepayModal: preparar FRESCO al abrir la puerta, revisar
 * con números vivos, y firmar en la wallet del dueño. Astryum jamás firma.
 */
import React, { useEffect, useState } from 'react';
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
import { EmBridgeModal } from '../earn/EmBridgeModal';
import { isInFlight, inFlightInfo, inFlightMessage, explorerTxUrl } from '../../lib/wallet/inFlightError';
import { signOutcome } from '../../lib/wallet/signOutcome';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export type EmExitMode = 'collateral' | 'vault' | 'finish-carry';

interface EmExitPrepared extends EmPrepareEnvelope {
  chainId: number;
  legs: EmLeg[];
  /** `{collateral, loan}` from the market prepare; `{asset}` from the vault prepare. */
  decimals?: { collateral?: number; loan?: number; asset?: number };
  position?: { collateral: string; borrowAssets: string; healthFactor: number | null };
  positionAfter?: { healthFactor: number | null };
  disclosure: { signerNote: string; astryumFeeBase?: string; curatorNote?: string };
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

export function EmExitModal({
  owner,
  mode,
  onClose,
  onChanged,
}: {
  /** La wallet EVM que SOSTIENE la posición y firma en Ethereum. */
  owner: string;
  mode: EmExitMode;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('form');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<EmExitPrepared | null>(null);
  const [preflight, setPreflight] = useState<PreflightInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [bridgeBack, setBridgeBack] = useState(false);
  /** The failure was a READ (server unreachable, 5xx, decimals unconfirmed): offer Retry, not a dead end. */
  const [retryable, setRetryable] = useState(false);
  /** Where the conversion decimals came from — the review says so when it was a confirmed fallback. */
  const [decimalsSource, setDecimalsSource] = useState<DecimalsSource>('market');
  /** La transaccion SALIO y no se pudo leer su recibo: ni exito ni fallo. */
  const [inFlight, setInFlight] = useState<import('../../lib/wallet/inFlightError').InFlightInfo | null>(null);

  const isVault = mode === 'vault';
  /**
   * 'finish-carry' NO es una salida: es la pata que FALTA. Vive en esta puerta
   * porque la maquinaria es exactamente la misma —preparar fresco, revisar con
   * numeros vivos, firmar en la wallet del dueno— y clonarla habria sido
   * duplicar 300 lineas para cambiar el verbo.
   */
  const isBorrow = mode === 'finish-carry';
  const symbol = isVault || isBorrow ? 'RLUSD' : 'FXRP';
  const signerMatches = !!evm.address && evm.address.toLowerCase() === owner.toLowerCase();

  /**
   * El saldo de la bóveda, y el techo de lo que puede pagar hoy.
   *
   * Sin esto la puerta era inservible para lo que más importa: RETIRAR EL
   * TOTAL. El único que sabía la cifra era el servidor, y viajaba dentro del
   * `data` de un check EN ROJO que la interfaz no pinta — así que cada intento
   * por exceso era un rojo sin número y el usuario dejaba polvo para siempre
   * (auditoría 2026-08-17).
   */
  const [vaultInfo, setVaultInfo] = useState<{
    lentBase: string; availableNowBase: string; decimals: number; ok: boolean;
  } | null>(null);
  useEffect(() => {
    if (!isVault) return;
    let alive = true;
    void (async () => {
      try {
        const region = encodeURIComponent(getUserRegion() ?? '');
        const r = await fetch(
          `${API_BASE}/eth-morpho/position?wallet=${encodeURIComponent(owner)}&region=${region}`,
          { headers: authHeaders(), credentials: 'include' },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const b = (await r.json()) as {
          lentAssetsBase?: string; vaultAvailableNowBase?: string;
          lentDecimals?: number; lentReadOk?: boolean;
        };
        if (!alive) return;
        setVaultInfo({
          lentBase: b.lentAssetsBase ?? '0',
          availableNowBase: b.vaultAvailableNowBase ?? '0',
          decimals: b.lentDecimals ?? 18,
          // `ok:false` = no lo sabemos. Se dirá, no se pintará un cero.
          ok: b.lentReadOk !== false,
        });
      } catch {
        if (alive) setVaultInfo({ lentBase: '0', availableNowBase: '0', decimals: 18, ok: false });
      }
    })();
    return () => { alive = false; };
  }, [isVault, owner]);

  /** Lo máximo retirable HOY: lo tuyo, con el techo de lo que la bóveda puede pagar. */
  const vaultMaxBase =
    vaultInfo && vaultInfo.ok
      ? (BigInt(vaultInfo.lentBase) < BigInt(vaultInfo.availableNowBase)
          ? vaultInfo.lentBase
          : vaultInfo.availableNowBase)
      : null;

  async function prepare() {
    setErrorMsg('');
    setRetryable(false);
    setPhase('preparing');
    try {
      const region = getUserRegion();
      // Decimales LEÍDOS del propio módulo — jamás asumidos a ciegas (asimetría
      // 6/18, familia F4): FXRP son 6 y RLUSD 18, y confundirlos son 12 órdenes
      // de magnitud en un importe que se va a firmar.
      //
      // La lectura del mercado es SOLO para esos decimales. Si falla, la salida
      // no muere aquí (la salida jamás se gatea): se usan las constantes
      // documentadas y el prepare de abajo tiene que CONFIRMARLAS on-chain antes
      // de que exista una revisión (exitReadState.decimalsVerdict).
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
      const side = isVault || isBorrow ? 'loan' : 'collateral';
      const used = resolveExitDecimals({
        side,
        market: marketDecimals,
        positionDecimals: isVault && vaultInfo?.ok ? vaultInfo.decimals : null,
      });
      let amountBase: string;
      try {
        amountBase = toBaseUnits(amount, used.decimals);
      } catch {
        throw new Error(t('enter a valid amount greater than 0'));
      }

      let res: Response;
      try {
        res = await fetch(
          `${API_BASE}/eth-morpho/${isVault ? 'vault/prepare' : 'prepare'}`,
          {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({
              action: isVault ? 'vault_withdraw' : isBorrow ? 'borrow' : 'withdraw_collateral',
              user: owner,
              amountBase,
              region,
            }),
          },
        );
      } catch {
        throw Object.assign(
          new Error(t("Couldn't reach the server to prepare this — nothing was sent to your wallet.")),
          { retryable: true },
        );
      }
      const body = (await res.json().catch(() => ({}))) as EmExitPrepared & {
        error?: string; detail?: string;
      };
      if (!res.ok) {
        // La bóveda SÍ lanza cuando pides más de lo que puede pagar hoy
        // (`maxWithdraw` manda sobre tu saldo); el mercado, en cambio, no
        // lanza: devuelve 200 con un check de pre-flight en rojo, que
        // `PreflightNotice` pinta y `preflightSaysFail` usa para bloquear la
        // firma. Los dos caminos acaban en una frase que el dueño entiende.
        if (body.error === 'INVALID_AMOUNT') {
          throw new Error(
            isVault
              ? t("That is more than the vault can pay out right now — its live liquidity decides, not your balance.")
              : t('That amount is not valid for this position.'),
          );
        }
        throw Object.assign(new Error(body.detail || body.error || `HTTP ${res.status}`), {
          retryable: isTransientStatus(res.status),
        });
      }
      // The prepare read the decimals ON-CHAIN: a fallback it does not confirm
      // never reaches the signature.
      const verdict = decimalsVerdict(used, isVault ? body.decimals?.asset : body.decimals?.[side]);
      if (verdict !== 'ok') {
        throw Object.assign(new Error(t(decimalsRefusalMessage(verdict))), { retryable: true });
      }
      setDecimalsSource(used.source);
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
      const { handle } = await evm.sendIntentCalls(emCallsFromLegs(prepared.legs, prepared.chainId));
      settlement.track(handle, { onSettled: () => onChanged?.() });
      setPhase('done');
    } catch (e) {
      // EN VUELO no es un fallo: pintarlo en rojo con un boton de volver al
      // formulario empuja justo a lo unico que no debe hacerse, que es firmar
      // otra vez la pata que ya salio. Un «Failed to fetch» o un timeout
      // DESPUES de entregar las llamadas tampoco lo es (signOutcome).
      const unconfirmed = isInFlight(e) || signOutcome(e, handedToPartner).kind === 'unconfirmed';
      setInFlight(unconfirmed ? (inFlightInfo(e) ?? {}) : null);
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  const collDecimals = prepared?.decimals?.collateral ?? 6;
  const collateralHuman =
    prepared?.position ? baseToHuman(prepared.position.collateral, collDecimals) : null;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {isVault
                ? t('Withdraw RLUSD from the vault')
                : isBorrow
                ? t('Borrow RLUSD against your collateral')
                : t('Take FXRP collateral out')}
            </h2>
            <p className="text-[11px] text-ink/45 mt-0.5">
              {t('Prepared fresh with the live position — you sign in your own wallet.')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === 'form' && (
            <>
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-xs text-ink/40">
                    {isVault ? t('RLUSD to withdraw') : isBorrow ? t('RLUSD to borrow') : t('FXRP to take out')}
                  </label>
                  {/* Sin saldo ni MAX, retirar el total era imposible: había que
                      adivinar la cifra y cada intento por exceso salía en rojo
                      sin decir cuál era. */}
                  {isVault && vaultInfo && (
                    vaultInfo.ok ? (
                      <button
                        type="button"
                        onClick={() => setAmount(baseToHuman(vaultMaxBase as string, vaultInfo.decimals))}
                        className="text-[11px] px-2 py-0.5 rounded-md border border-volt/40 text-volt hover:bg-volt/10 transition-colors"
                      >
                        {t('MAX')} {baseToHuman(vaultMaxBase as string, vaultInfo.decimals)}
                      </button>
                    ) : (
                      <span className="text-[11px] text-tone-warning">
                        {t("couldn't read your balance")}
                      </span>
                    )
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                />
                {isVault && vaultInfo?.ok && (
                  <div className="mt-2 space-y-0.5 text-[11px] text-ink/45">
                    <div>
                      {t('You have lent')}{' '}
                      <span className="font-mono text-ink/70">
                        {baseToHuman(vaultInfo.lentBase, vaultInfo.decimals)} RLUSD
                      </span>
                    </div>
                    <div>
                      {t('The vault can pay out now')}{' '}
                      <span className="font-mono text-ink/70">
                        {baseToHuman(vaultInfo.availableNowBase, vaultInfo.decimals)} RLUSD
                      </span>
                      {' — '}
                      {t('that is a hard ceiling, not an estimate.')}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[12px] text-ink/55 leading-relaxed">
                {isVault
                  ? t("The vault pays out against its own live liquidity: if it cannot cover the amount right now, you are told before signing — never after.")
                  : isBorrow
                  ? t('Your FXRP is already in as collateral and earns nothing while it sits there — collateral pays no supply rate. This is the borrow leg that was missing, over the collateral you already have: no new FXRP, no second approve. What you can borrow is checked against the live liquidation line before you sign.')
                  : t('Collateral holds the debt up. If you still owe RLUSD, taking too much out would cross the liquidation line — that is checked before you sign, not after.')}
              </p>
              <PrimaryButton
                onClick={() => void prepare()}
                disabled={!(parseFloat(amount.replace(',', '.')) > 0)}
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
              {/* El escáner avisa, no bloquea: la salida jamás se gatea, pero
                  se firma con los flags delante (invariantes #6/#10). */}
              <ExitRiskWarnings warnings={parseRiskWarnings(prepared)} />
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                <Row label={isBorrow ? t('You borrow') : t('You take out')} value={`${amount} ${symbol}`} />
                {!isVault && collateralHuman && (
                  <Row label={t('Collateral now')} value={`${collateralHuman} FXRP`} />
                )}
                {!isVault && prepared.positionAfter && (
                  <Row
                    label={t('Health factor after')}
                    value={
                      prepared.positionAfter.healthFactor == null
                        ? t('no debt — nothing can liquidate')
                        : `${prepared.positionAfter.healthFactor.toFixed(2)} · ${t('liquidation at 1.00')}`
                    }
                  />
                )}
                <Row label={t('Where it lands')} value={`${owner.slice(0, 8)}… · Ethereum`} />
                <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
              </div>
              <PreflightNotice preflight={preflight ?? undefined} />
              {decimalsFallbackNote(decimalsSource) && (
                <p className="text-[11px] text-tone-warning leading-relaxed">
                  {t(decimalsFallbackNote(decimalsSource) as string)}
                </p>
              )}
              {prepared.disclosure.curatorNote && (
                <p className="text-[11px] text-ink/40 leading-relaxed">{prepared.disclosure.curatorNote}</p>
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
              {/* H3 — el colateral ya está en tu wallet de Ethereum; el
                  recorrido completo lo devuelve a Flare. La puerta se ofrece
                  aquí, que es donde el usuario descubre que le hace falta.
                  Tras un BORROW no: el FXRP sigue de colateral, no ha vuelto a
                  tu wallet, y ofrecer puentearlo sería ofrecer mover algo que
                  no tienes suelto. */}
              {!isVault && !isBorrow && (
                <button
                  type="button"
                  onClick={() => setBridgeBack(true)}
                  className="text-[11px] text-sky-300 hover:text-sky-200 underline underline-offset-2"
                >
                  {t('Bring your FXRP back to Flare →')}
                </button>
              )}
            </div>
          )}

          {phase === 'error' && (
            <>
              {/* EN VUELO no se pinta en rojo ni se ofrece «volver al
                  formulario»: rojo + volver es lo que empuja a firmar otra vez
                  la pata que YA salió, y así es como se paga dos veces. */}
              <p
                className={`text-sm leading-relaxed ${
                  inFlight ? 'text-tone-warning' : 'text-tone-danger'
                }`}
              >
                {inFlight ? inFlightMessage(inFlight, t) : errorMsg}
              </p>
              {inFlight?.txHash && prepared && (
                <a
                  href={explorerTxUrl(prepared.chainId, inFlight.txHash)}
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
      {bridgeBack && (
        <EmBridgeModal
          owner={owner}
          initialDirection="to-flare"
          onClose={() => setBridgeBack(false)}
          onChanged={onChanged}
        />
      )}
    </ModalOverlay>
  );
}

export default EmExitModal;

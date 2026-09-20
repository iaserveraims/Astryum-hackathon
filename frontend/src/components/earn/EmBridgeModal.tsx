'use client';

/**
 * EmBridgeModal — the bridge DOOR of the em flow (B6-UI): FXRP from the user's
 * Flare wallet to THEIR OWN address on Ethereum, as direct LayerZero OFT
 * calldata. Signs ON
 * FLARE; the legs carry chainId 14 and the wallet switches itself.
 *
 * The LayerZero delivery fee is REAL money (~98 FLR at verification time) —
 * it is quoted LIVE per prepare and shown in front, with the +5% ceiling and
 * the auto-refund said out loud. Twin of EmRepayModal: same adapters, same
 * honest review, fresh prepare every open.
 */
import React, { useMemo, useState } from 'react';
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
import { isInFlight, inFlightInfo, inFlightMessage, explorerTxUrl } from '../../lib/wallet/inFlightError';
import { signOutcome } from '../../lib/wallet/signOutcome';
import { useMyWallets } from '../../hooks/useMyWallets';
import { walletNameResolver } from '../../lib/walletIdentity';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

interface BridgePrepared extends EmPrepareEnvelope {
  chainId: number;
  legs: EmLeg[];
  decimals: { asset: number };
  disclosure: {
    lzFeeQuotedWei: string;
    lzFeeMaxWei: string;
    refundNote: string;
    destinationNote: string;
    timeNote: string;
    paNote: string;
    signerNote: string;
    astryumFeeBase: string;
  };
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

export type BridgeDirection = 'to-ethereum' | 'to-flare';

export function EmBridgeModal({
  owner,
  initialDirection = 'to-ethereum',
  onClose,
  onChanged,
}: {
  /** The EVM wallet that holds the FXRP on Flare AND receives it on Ethereum. */
  owner: string;
  /** H3 — 'to-flare' es la VUELTA: se firma en Ethereum y la comisión es ETH. */
  initialDirection?: BridgeDirection;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useT();
  // Nombre canónico de la wallet en las filas de revisión (
  // «0x62d7…» a secas no identifica; el nombre primero, la dirección al lado).
  const { wallets: myWallets } = useMyWallets();
  const walletNameOf = useMemo(() => walletNameResolver(myWallets, t), [myWallets, t]);
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [phase, setPhase] = useState<Phase>('form');
  const [direction, setDirection] = useState<BridgeDirection>(initialDirection);
  const [amount, setAmount] = useState('');
  const toFlare = direction === 'to-flare';
  const [prepared, setPrepared] = useState<BridgePrepared | null>(null);
  const [preflight, setPreflight] = useState<PreflightInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  /** The failure was a READ (server unreachable, 5xx, decimals unconfirmed): offer Retry, not a dead end. */
  const [retryable, setRetryable] = useState(false);
  const [decimalsSource, setDecimalsSource] = useState<DecimalsSource>('market');
  /** La transaccion SALIO y no se pudo leer su recibo: ni exito ni fallo. */
  const [inFlight, setInFlight] = useState<import('../../lib/wallet/inFlightError').InFlightInfo | null>(null);

  const signerMatches =
    !!evm.address && evm.address.toLowerCase() === owner.toLowerCase();

  /**
   * The bridge moves FXRP between two EVM chains, so the owner must be an EVM
   * address. It can arrive empty (no wallet selected yet) or as an XRPL
   * r-address (the selected wallet signs on XRPL): both make the backend answer
   * a bare 400 INVALID_BODY that says nothing to the user. Name the condition
   * here instead, and never send a request we know is malformed.
   */
  const ownerIsEvm = /^0x[0-9a-fA-F]{40}$/.test(owner);

  async function prepare() {
    setErrorMsg('');
    setRetryable(false);
    if (!ownerIsEvm) {
      setErrorMsg(
        t('This bridge signs on an EVM chain: select (or connect) the EVM wallet that holds the FXRP before bridging.'),
      );
      setPhase('error');
      return;
    }
    setPhase('preparing');
    try {
      // FXRP shared decimals are READ on-chain by the backend and returned in
      // the response; for the request we convert with the market's collateral
      // decimals (same on-chain read) — never blindly assumed (F4). The market
      // read is for decimals only: if it fails, the way BACK is not a dead end —
      // the documented FXRP 6 is used and the prepare must confirm it
      // (`decimals.asset`) before any review exists.
      const region = getUserRegion();
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
      const used = resolveExitDecimals({ side: 'collateral', market: marketDecimals });
      let amountBase: string;
      try {
        amountBase = toBaseUnits(amount, used.decimals);
      } catch {
        throw new Error(t('enter a valid amount greater than 0'));
      }
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/eth-morpho/bridge/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({ user: owner, amountBase, direction, region }),
        });
      } catch {
        throw Object.assign(
          new Error(t("Couldn't reach the server to prepare this — nothing was sent to your wallet.")),
          { retryable: true },
        );
      }
      const body = (await res.json().catch(() => ({}))) as BridgePrepared & {
        error?: string; detail?: string;
      };
      if (!res.ok) {
        throw Object.assign(new Error(body.detail || body.error || `HTTP ${res.status}`), {
          retryable: isTransientStatus(res.status),
        });
      }
      const verdict = decimalsVerdict(used, body.decimals?.asset);
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
      const { handle } = await evm.sendIntentCalls(
        emCallsFromLegs(prepared.legs, prepared.chainId),
      );
      settlement.track(handle, { onSettled: () => onChanged?.() });
      setPhase('done');
    } catch (e) {
      // EN VUELO no es un fallo: el puente cobra comision de entrega, asi que
      // reintentar aqui no es firmar dos veces — es PAGAR el peaje dos veces.
      // Un «Failed to fetch» o un timeout DESPUES de entregar las llamadas
      // tampoco lo es (signOutcome): misma salida ambar.
      const unconfirmed = isInFlight(e) || signOutcome(e, handedToPartner).kind === 'unconfirmed';
      setInFlight(unconfirmed ? (inFlightInfo(e) ?? {}) : null);
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  // La comisión de entrega se paga en la moneda NATIVA de la cadena que
  // firma: FLR en la ida, ETH en la vuelta. Decir «FLR» en la vuelta sería
  // mentir sobre lo que va a salir de la cuenta.
  const feeSymbol = toFlare ? 'ETH' : 'FLR';
  const feeDecimals = 18;
  const feeMax = prepared ? baseToHuman(prepared.disclosure.lzFeeMaxWei, feeDecimals, toFlare ? 5 : 2) : null;
  const feeQuoted = prepared ? baseToHuman(prepared.disclosure.lzFeeQuotedWei, feeDecimals, toFlare ? 5 : 2) : null;
  const originChain = toFlare ? 'Ethereum' : 'Flare';
  const destChain = toFlare ? 'Flare' : 'Ethereum';

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {toFlare ? t('Bring FXRP back to Flare') : t('Bridge FXRP to Ethereum')}
            </h2>
            <p className="text-[11px] text-ink/45 mt-0.5">
              {toFlare
                ? t('To your own address on Flare — same account, other chain. You sign on Ethereum.')
                : t('To your own address on Ethereum — same account, other chain. You sign on Flare.')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink" aria-label={t('Close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === 'form' && (
            <>
              {/* H3 — las dos direcciones, en el mismo sitio: el puente ya no
                  es de ida. Cambiarla reinicia la revisión, porque cambia la
                  cadena que firma Y la moneda de la comisión. */}
              <div className="flex gap-2">
                {(['to-ethereum', 'to-flare'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => { setDirection(d); setPrepared(null); }}
                    className={`flex-1 text-[12px] px-3 py-2 rounded-lg border transition-colors ${
                      direction === d
                        ? 'border-volt/50 bg-volt/10 text-ink'
                        : 'border-ink/10 text-ink/50 hover:bg-ink/5'
                    }`}
                  >
                    {d === 'to-ethereum' ? t('Flare → Ethereum') : t('Ethereum → Flare')}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs text-ink/40 block mb-2">{t('FXRP to bridge')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                />
              </div>
              <p className="text-[11px] text-ink/45 leading-relaxed">
                {toFlare
                  ? t('The LayerZero delivery fee is paid in ETH on this leg and shown before you sign. It spends the FXRP held by the wallet that signs, on Ethereum.')
                  : t('The LayerZero delivery fee is paid in FLR and shown before you sign. If your FXRP sits in the Personal Account, move it to your wallet first (PA → wallet transfer).')}
              </p>
              {!ownerIsEvm && (
                <p className="text-[11px] text-tone-warning">
                  {t('This bridge signs on an EVM chain: select (or connect) the EVM wallet that holds the FXRP before bridging.')}
                </p>
              )}
              <PrimaryButton
                onClick={() => void prepare()}
                disabled={!ownerIsEvm || !(parseFloat(amount.replace(',', '.')) > 0)}
                className="w-full"
              >
                {t('Review before signing')}
              </PrimaryButton>
            </>
          )}

          {phase === 'preparing' && (
            <p className="text-sm text-ink/50 py-6 text-center">{t('Quoting the live delivery fee…')}</p>
          )}

          {phase === 'review' && prepared && (
            <>
              {/* La vuelta es una SALIDA: el escáner avisa, no bloquea — se
                  firma con los flags delante (invariantes #6/#10). */}
              <ExitRiskWarnings warnings={parseRiskWarnings(prepared)} />
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-4 space-y-2.5 text-xs">
                <Row label={t('FXRP you send')} value={`${amount} FXRP`} />
                <Row label={t('Arrives at')} value={`${walletNameOf(owner)} · ${owner.slice(0, 8)}… · ${destChain}`} />
                <Row
                  label={t('LayerZero delivery fee (max)')}
                  value={`${feeMax} ${feeSymbol} (${t('quoted')}: ${feeQuoted} ${feeSymbol})`}
                />
                <Row
                  label={t('Approvals')}
                  value={
                    toFlare
                      ? t('none — on Ethereum FXRP is the token itself')
                      : t('finite — the exact amount, never unlimited')
                  }
                />
                <Row label={t('Astryum fee')} value={prepared.disclosure.astryumFeeBase === '0' ? t('None') : prepared.disclosure.astryumFeeBase} />
                <Row label={t('Network fee (gas)')} value={t('quoted by your wallet before signing')} />
                <Row label={t('Signing wallet')} value={`${walletNameOf(owner)} · ${owner.slice(0, 8)}… · ${originChain}`} />
              </div>
              <p className="text-[11px] text-ink/45 leading-relaxed">
                {t(prepared.disclosure.refundNote)} · {t(prepared.disclosure.timeNote)}
              </p>
              <PreflightNotice preflight={preflight ?? undefined} />
              {decimalsFallbackNote(decimalsSource) && (
                <p className="text-[11px] text-tone-warning leading-relaxed">
                  {t(decimalsFallbackNote(decimalsSource) as string)}
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
                settledText={
                  toFlare
                    ? t('Sent from Ethereum — the FXRP appears in your Flare wallet in minutes (LayerZero delivery).')
                    : t('Sent from Flare — the FXRP appears in your Ethereum wallet in minutes (LayerZero delivery).')
                }
                pendingText={toFlare ? t('Signed — confirming on Ethereum…') : t('Signed — confirming on Flare…')}
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
                  href={explorerTxUrl(direction === 'to-flare' ? 1 : 14, inFlight.txHash)}
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

export default EmBridgeModal;

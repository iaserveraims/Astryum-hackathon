'use client';

/**
 * VaultClaimModal — releases a FINISHED Firelight withdrawal period. After a
 * redeem the stXRP is already burned and the FXRP waits ~24h in the vault's
 * period queue; this is the "1 tap" that lands it in the user's wallet once the
 * period ends.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, AlertTriangle, HandCoins } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useOwningXrpl } from '../../lib/wallet/paOwnership';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { AbandonedSeatNotice, SeatRefusalNotice, seatRefusalSentence } from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { noteFlareInstructionDelivery } from '../../lib/xaman/liveRequests';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { DispatchXrpField } from './DispatchXrpField';
import { useCarrierXrp } from '@/lib/flare/carrier';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { ECOSYSTEM_ACCENT } from '../../lib/ui/ecosystem';
import { explorerTxUrl } from '../../lib/wallet/inFlightError';
import { signFailureAction, dispatchFeeQuote, feeXrpDigits } from './vaultModalTruth';
import { walletNameResolver } from '../../lib/walletIdentity';
import { RedemptionFeeNotice } from '../../lib/fassets/RedemptionFeeNotice';
import { redemptionOf } from '../../lib/fassets/redemptionFeeRow';

const API_BASE = getApiBase();

export interface VaultClaimRef {
  /** 'firelight' — the only queued-exit vault for now. */
  vault: 'firelight';
  /** Human vault name (stXRP…). */
  vaultLabel: string;
  /** Address that QUEUED the exit (EVM wallet or the Personal Account, always 0x). */
  owner: string;
  /** The withdrawal period to release. */
  period: number;
  /** true once the period has ended — claimWithdraw succeeds then. */
  claimable: boolean;
  /** ISO time the still-running period ends (null once claimable). */
  claimableAt: string | null;
  /** Estimated FXRP the claim releases, base units (6 dec); null if unreadable. */
  estFxrpBase: string | null;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function fmt(n: number, digits = 6): string {
  return fmtQtyActive(n, digits); // app-locale aware (Fase 3)
}

interface PreparedEvm {
  rail: 'evm';
  chainId: number;
  account: string;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  preflight?: PreflightInfo;
  disclosure: Record<string, unknown> & { note?: string };
}

interface PreparedXrpl {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment: unknown;
  /** 0xFE memo — identifica el asiento de nonce para liberarlo si se cancela. */
  memoHex?: string;
  preflight?: PreflightInfo;
  disclosure: Record<string, unknown> & { note?: string };
}

// UI-settling (W2-F2 · R6.1): 'settling' is the phase the signature opens.
// 'done' is reached ONLY from the settlement machine's onSettled — the
// CouncilOrderCard mould. Before this, sign() jumped straight to 'done', so
// the modal's own state said "finished" the instant the wallet handed back a
// hash, with nothing read from the ledger yet.
//
// settling-residuos: 'unconfirmed' is the OTHER honest ending — the signature
// may already be out there and we could not read it. It exists precisely so
// that the catch of sign() stops sending everybody back to 'review', which is
// an invitation to sign a second time (see vaultModalTruth.signOutcome).
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'settling' | 'done' | 'unconfirmed';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1.5">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 font-mono text-right">{value}</span>
    </div>
  );
}

/**
 * UI-settling (W2-F2 · R8.1) — WHERE the claimed money actually ends up, read
 * from the rail that was PREPARED (not from the destination toggle alone: the
 * toggle only exists on the PA rail, and a stale 'xrpl' selection could print
 * the XRPL sentence over an EVM claim).
 *
 *  - 'evm-wallet'   the vault pays claimWithdraw straight to the signing wallet.
 *  - 'smart-account' the 0xFE userOp lands the FXRP in the Personal Account —
 *                   it is on Flare, not in the user's own wallet.
 *  - 'xrpl-pending' claim + redeem in one dispatch: the burn is immediate, the
 *                   FAssets agent pays the XRP minutes-to-hours LATER. Saying
 *                   "the FXRP is in your wallet" here was simply false.
 */
export type ClaimArrival = 'evm-wallet' | 'smart-account' | 'xrpl-pending';

export function claimArrival(rail: string, dest: string): ClaimArrival {
  if (rail === 'evm') return 'evm-wallet';
  if (dest === 'xrpl') return 'xrpl-pending';
  return 'smart-account';
}

/**
 * R5 — the cost of claiming, as a QUOTE or as an admitted non-quote.
 *
 * The form said "the only cost is the network fee" on BOTH rails. On the PA
 * rail that is false: the 0xFE dispatch is mint-coupled and pays a minting fee
 * and an executor fee in XRP. And in review the fee rows were rendered with a
 * bare `!= null` guard, so a failed read produced SILENCE — the user signed
 * believing there was nothing to pay. Never a figure that was not read; when
 * the prepare did not carry it, the surface says so.
 */
export type ClaimFeeQuote =
  /** The prepare STATED the vault takes nothing for this release (`fee` key). */
  | { kind: 'gas-only' }
  /** EVM rail, and this prepare said nothing about a vault fee — so neither do we. */
  | { kind: 'gas-only-unstated' }
  | { kind: 'quoted'; mintingFeeXrp: number; executorFeeXrp: number }
  | { kind: 'unquoted' };

export function claimFeeQuote(rail: string, disclosure?: Record<string, unknown>): ClaimFeeQuote {
  if (rail === 'evm') {
    // settling-residuos: "Fee charged by the vault: none" was decided by the
    // RAIL alone and read from nowhere. The route does answer `fee: null` on
    // this rail ("claiming pays gas alone — the exit already happened at
    // redeem"), so the claim of "none" is made only when that field is
    // actually present; a prepare that never spoke about it gets an admission,
    // not a reassurance.
    return disclosure && 'fee' in disclosure ? { kind: 'gas-only' } : { kind: 'gas-only-unstated' };
  }
  // Shared with the withdraw twin — one implementation of "quoted or said".
  return dispatchFeeQuote(disclosure);
}

export function VaultClaimModal({
  claim,
  onClose,
  onChanged,
}: {
  claim: VaultClaimRef;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const { wallets: myWallets } = useMyWallets();

  // LA regla canónica de nombres: la copia local label??dirección
  // saltaba el fallback de marca — una wallet sin apodo se llamaba por su
  // código. walletNameResolver numera («MetaMask 2») y jamás usa la dirección
  // como nombre para una fila conocida; una dirección ajena sigue en corto.
  const aliasOf = useMemo(() => walletNameResolver(myWallets, t), [myWallets, t]);

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<PreparedEvm | PreparedXrpl | null>(null);
  // settling-residuos: what a signature we could not follow left behind — the
  // hash to check (EVM rail) and what the wallet reported, shown as a WARNING
  // and never as a red failure with a way back to the sign button.
  // settling-final: `trace` is the wallet's VERBATIM words, never a translated
  // verdict — `translateError` answers "nothing moved, try again in a minute"
  // to a timeout, and printing that under "Do NOT sign it again" is the double
  // dispatch this panel exists to prevent (vaultModalTruth.unconfirmedTrace).
  const [unconfirmed, setUnconfirmed] = useState<{ txHash?: string; trace: string | null } | null>(
    null,
  );
  // Carrier auto: live fees + margin from the backend
  // — no user knob; can never block the operation (lib/flare/carrier).
  const xrpForMint = useCarrierXrp();
  // Destino del claim (rail PA): FXRP al Smart Account, o encadenar la
  // redención y recibir XRP NATIVO en la wallet XRPL dueña (unmint atómico).
  const [claimDest, setClaimDest] = useState<'pa' | 'xrpl'>('pa');

  // Abandonar una orden 0xFE preparada y NO firmada libera su asiento de nonce
  // (el usuario no queda tapiado por NONCE_SEAT_TAKEN). Cleanup de desmontaje
  // vía ref (captura X, Escape y cierre del padre); nunca tras firmar.
  const seatRef = useRef<{ memoHex?: string; abandonable: boolean }>({ abandonable: false });
  seatRef.current = {
    memoHex: prepared?.rail === 'xrpl' ? prepared.memoHex : undefined,
    abandonable: prepared?.rail === 'xrpl' && phase === 'review',
  };
  useEffect(() => {
    return () => {
      if (seatRef.current.abandonable) releaseHandoffSeat(seatRef.current.memoHex);
    };
  }, []);
  /**
   * El memo del último 0xFE preparado aquí, que sobrevive al payload: cuando el
   * siguiente intento choca contra el asiento suele ser ESTE borrador, y con el
   * memo se puede ofrecer liberarlo (R5 5.4 · R1 1.5).
   */
  const abandonedMemo = useRef<string | null>(null);
  if (prepared?.rail === 'xrpl' && prepared.memoHex) abandonedMemo.current = prepared.memoHex;
  /** El cuerpo del rechazo de asiento en curso: lo pinta el aviso compartido. */
  const [seatRefusal, setSeatRefusal] = useState<unknown>(null);
  const releaseSeatIfUnsigned = () => {
    if (prepared?.rail === 'xrpl' && phase === 'review') releaseHandoffSeat(prepared.memoHex);
  };

  const estFxrp = claim.estFxrpBase != null ? Number(claim.estFxrpBase) / 1e6 : null;
  const eta = claim.claimableAt ? new Date(claim.claimableAt).toLocaleString() : null;

  // Whose exit is this? The connected EVM wallet signs directly; anything else
  // is the Personal Account → 0xFE userOp signed in Xaman.
  const ownerIsEvmWallet =
    !!evm.address && evm.address.toLowerCase() === claim.owner.toLowerCase();

  // The XRPL account that CONTROLS this Smart Account — the claim must pin it
  // (executor rejects any other sender), never the merely-connected Xaman.
  const xrplCandidates = useMemo(
    () => [
      ...myWallets.map((w) => w.address),
      ...(xrpl.address ? [xrpl.address] : []),
    ],
    [myWallets, xrpl.address],
  );
  const { owningXrpl, resolving: resolvingOwner } = useOwningXrpl(
    ownerIsEvmWallet ? null : claim.owner,
    xrplCandidates,
  );
  const connectedIsOwner =
    !!owningXrpl && !!xrpl.address && owningXrpl.toLowerCase() === xrpl.address.toLowerCase();

  async function prepare() {
    setError('');
    setSeatRefusal(null);
    setPhase('preparing');
    try {
      const body: Record<string, unknown> = {
        period: claim.period,
        region: getUserRegion(),
      };
      if (ownerIsEvmWallet) {
        body.evmAddress = claim.owner;
      } else {
        const signerXrpl = owningXrpl ?? xrpl.address;
        if (!signerXrpl) {
          throw new Error(t('This exit was queued from your Smart Account — connect your XRPL wallet (Xaman) to claim it.'));
        }
        body.xrplAddress = signerXrpl;
        body.amountXrpForMint = xrpForMint;
        if (claimDest === 'xrpl') body.unmintToXrpl = true;
      }
      const res = await fetch(`${API_BASE}/flare-demo/vault-claim/prepare`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(resBody.error ?? '');
        if (code === 'CLAIM_NOT_READY') {
          throw new Error(
            `${t('Not ready yet — claimable from')} ${resBody.claimableAt ? new Date(resBody.claimableAt).toLocaleString() : '…'}`,
          );
        }
        if (code === 'AMOUNT_BELOW_MINIMUM_REDEEM') {
          throw new Error(
            `${t('Below the protocol minimum per redemption')} (${resBody.minimumXrp ?? 5} XRP) — ${t('claim as FXRP instead, and Unmint later together with more FXRP.')}`,
          );
        }
        if (res.status === 451 || code.startsWith('GEOFENCE')) throw new Error(t('This action is not available in your region yet.'));
        if (code === 'FLARE_DEFI_DISABLED') throw new Error(t('Flare DeFi execution is disabled on this server (feature flag).'));
        // EL ASIENTO DE NONCE (R5 5.4): ni el código crudo ni el
        // párrafo en castellano del servidor. El cuerpo se guarda para poder
        // ofrecer «Free the seat» sobre el borrador que esta pantalla dejó.
        const seat = seatRefusalSentence(resBody, t);
        if (seat) {
          setSeatRefusal(resBody);
          throw new Error(seat);
        }
        // Ni el slug ni el castellano del servidor por esta
        // puerta tampoco — una frase, y el `detail` solo si está en inglés.
        throw new Error(
          [refusalHeadline(resBody, t), serverDetailIfEnglish(resBody.detail)]
            .filter((p): p is string => Boolean(p))
            .join(' — ') ||
            `${t('The server refused this operation. Nothing was prepared and nothing was signed.')} (HTTP ${res.status})`,
        );
      }
      if (
        resBody.rail === 'xrpl' &&
        String(resBody.personalAccount ?? '').toLowerCase() !== claim.owner.toLowerCase()
      ) {
        throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
      }
      // LA PALABRA DE LA ENTREGA. Raw `fetch` never told the
      // live banner what the server knows about the executor carrying this 0xFE,
      // so a legitimate claim got the prudent sentence. Defensive: without the
      // field the banner stays neutral; only `executorEnabled === true` promises.
      noteFlareInstructionDelivery(
        (resBody as { xrplPayment?: unknown }).xrplPayment,
        (resBody as { serverDelivery?: { executorEnabled?: unknown } }).serverDelivery,
      );
      setPrepared(resBody as PreparedEvm | PreparedXrpl);
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
    // Knowledge no error message carries: whether the order was handed to the
    // wallet partner at all. Everything thrown before this flips is provably
    // unsigned. settling-final: it says handed to the PARTNER, not to the
    // wallet — `sendIntentCalls` still guards its input, switches chain and
    // estimates gas before any wallet opens, so what that stage refuses is
    // subtracted by name in vaultModalTruth (NEVER_REACHED_WALLET) instead of
    // being announced here as "the transaction was sent to your wallet".
    let handedToPartner = false;
    try {
      // UI-settling (W2-F2 · R6.1): the signature opens 'settling'; only the
      // settlement machine (real receipt / mintExecuted) promotes to 'done'.
      // `setPhase('settling')` MUST run before track(): an EVM handle can
      // arrive already-settled (useWalletPartner awaits the receipt on the
      // single/sequential rails), so trackSettlement fires onSettled
      // synchronously — setting 'settling' afterwards would overwrite 'done'.
      const settled = () => {
        setPhase('done');
        onChanged();
      };
      if (prepared.rail === 'xrpl') {
        if (!xrpl.isConnected && !pinnedXrplSigner(prepared.xrplPayment)) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        handedToPartner = true;
        const { txHash: hash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // 0xFE userOp: signed ≠ settled — follow the mint on Flare (executor).
        setPhase('settling');
        settlement.track(startPending('xrpl-mint', hash), { onSettled: settled });
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        handedToPartner = true;
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        setPhase('settling');
        settlement.track(handle, { onSettled: settled });
      }
    } catch (e) {
      // settling-residuos — «no pude leer» NO es «falló». Returning to 'review'
      // after a signature that may already be out there is an invitation to
      // sign again: on this rail that means a second dispatch, a second carrier
      // fee in XRP and a second nonce seat, over a claim that may already have
      // been released. Only an error that PROVES nothing left goes back to the
      // sign button.
      // settling-final: the decision AND the words it puts on screen come from
      // one pure function, so both can be tested by running them — the panel
      // used to classify here and then quote `translateError`, whose sentence
      // for a timeout ("nothing moved — try again in a minute") contradicted
      // the headline above it.
      // FIRMADA TARDE (R5 5.2). tefMAX_LEDGER / tefPAST_SEQ son un
      // veredicto LEÍDO: ese payload no puede validar nunca, no hubo despacho y
      // no puede haber un segundo. `signFailureAction` lo devuelve como vista
      // 'form' con la frase «prepáralo otra vez» (y el asiento se libera solo
      // al pasar su ventana) — jamás el ámbar «no pude confirmarlo, recarga».
      const action = signFailureAction(e, handedToPartner, t);
      if (action.view === 'unconfirmed') {
        setError('');
        setUnconfirmed({ txHash: action.txHash, trace: action.trace });
        setPhase('unconfirmed');
        return;
      }
      setError(action.message);
      if (action.view === 'form') {
        // A revert we READ: it ran, the chain refused it, and this prepared
        // calldata is spent — signing the same payload would be refused the
        // same way (a period that has not ended does not end because it was
        // signed twice). Back to the form for a fresh prepare, never back to
        // the sign button. The 0xFE nonce seat is deliberately NOT released:
        // this rail cannot produce a read revert here (the executor settles
        // later, outside this catch) and freeing a seat that may have been
        // consumed is the wrong direction.
        setPrepared(null);
        setPhase('form');
        return;
      }
      setPhase('review'); // provably never left the wallet — signing again is safe
    }
  }

  const disclosure = prepared?.disclosure;
  // Where the money really lands, and what it really costs (helpers above).
  const arrival = prepared ? claimArrival(prepared.rail, claimDest) : null;
  const feeQuote = prepared ? claimFeeQuote(prepared.rail, disclosure) : null;
  // Invariant #6 (4.2): the claim to XRPL redeems — the FAssets redemption fee
  // comes out of the XRP the agent sends, and it is said before the signature.
  const claimRedemption = prepared?.rail === 'xrpl' ? redemptionOf(prepared) : null;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-amber-300 border-amber-400/30 bg-amber-400/10">
              <HandCoins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">
                {t('Claim')} · {claim.vaultLabel}
              </h2>
              <p className="text-xs text-ink/40 mt-0.5 font-mono">
                <span className="text-ink/60">{aliasOf(claim.owner)}</span> ·{' '}
                {claim.owner.slice(0, 10)}…{claim.owner.slice(-6)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* Un asiento tomado se cuenta en inglés y, cuando el borrador es el
              que esta pantalla abandonó, con la salida (R5 5.4). */}
          {seatRefusal ? (
            <SeatRefusalNotice
              refusal={seatRefusal}
              t={t}
              fallbackMemoHex={abandonedMemo.current}
              onPrepareAgain={() => void prepare()}
            />
          ) : error ? (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {phase === 'form' && (
            <>
              {/* What's waiting in the queue — the money the redeem parked. */}
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs">
                <div className="text-ink/40">{t('Waiting in the exit queue')}</div>
                <div className="font-mono text-ink/85 mt-1 text-sm">
                  {estFxrp != null ? `≈ ${fmt(estFxrp, 4)} FXRP` : t('amount released at claim')}
                  <span className="text-ink/45"> · {t('period')} {claim.period}</span>
                </div>
              </div>

              {!ownerIsEvmWallet && owningXrpl && !connectedIsOwner && (
                <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 text-xs text-sky-200 leading-relaxed">
                  {t('This Smart Account is controlled by your XRPL account')}{' '}
                  <span className="font-mono text-sky-100">{aliasOf(owningXrpl)} · {owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}</span>.{' '}
                  {t('The order is pinned to it — when Xaman opens, approve with that account (no need to reconnect).')}
                </div>
              )}
              {!ownerIsEvmWallet && !resolvingOwner && !owningXrpl && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('None of your linked XRPL accounts controls this Smart Account — the attempt will use the connected Xaman account and may be rejected.')}
                </div>
              )}

              {claim.claimable ? (
                <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-xl p-3 text-xs text-emerald-200 leading-relaxed">
                  {/* R5: the cost sentence follows the RAIL. "The only cost is
                      the network fee" is true of the EVM claim and false of the
                      0xFE dispatch, which is mint-coupled and pays a minting
                      fee plus an executor fee in XRP — figures shown in review.
                      settling-residuos: "the exit fee was already taken when you
                      requested the withdrawal" is GONE from both. Nothing reads
                      it: on the Firelight queued path the withdraw prepare never
                      reads `instantRedemptionFeeBps` (it stays null), so that
                      sentence asserted a charge nobody had looked at. */}
                  {ownerIsEvmWallet
                    ? t('The withdrawal period ended — this releases the FXRP straight to your wallet. The only cost is the network fee (cents; your wallet shows the exact figure before signing). Astryum charges nothing for this release.')
                    : t('The withdrawal period ended — this releases the FXRP into your Smart Account on Flare. Astryum charges nothing for this release, but the dispatch is mint-coupled: it pays a minting fee and an executor fee in XRP. The exact figures are shown before you sign.')}
                </div>
              ) : (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('Not ready yet — the withdrawal period is still running.')} {eta ? `${t('Claimable from')} ${eta}.` : ''}
                </div>
              )}

              {/* Destino: FXRP al PA (clásico) o XRP NATIVO a la wallet XRPL
                  dueña — claim + redención en el MISMO dispatch. */}
              {!ownerIsEvmWallet && (
                <div className="flex gap-2">
                  {/* The color IS the arrow: Flare reads
                      rose, XRPL reads blue — plus the timing, the only
                      difference a person cares about. */}
                  {(['pa', 'xrpl'] as const).map((d) => {
                    const accent = ECOSYSTEM_ACCENT[d === 'pa' ? 'flare' : 'xrpl'];
                    return (
                      <button
                        key={d}
                        onClick={() => setClaimDest(d)}
                        className={`flex-1 text-xs py-2 rounded-xl border transition-colors ${
                          claimDest === d ? `${accent.selected} text-ink` : `${accent.idle} text-ink/50`
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} aria-hidden />
                          {d === 'pa' ? t('Keep it on Flare (instant)') : t('To my XRP wallet (minutes to hours)')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {!ownerIsEvmWallet && claimDest === 'xrpl' && (
                <div className="bg-sky-500/5 border border-sky-500/25 rounded-xl p-3 text-xs text-sky-200 leading-relaxed">
                  {t('The claimed FXRP — plus the FXRP this dispatch mints — is redeemed to NATIVE XRP in the same signature. The burn happens at execution; the FAssets agent pays the XRP after (minutes to hours), minus the protocol redemption fee.')}
                </div>
              )}

              {!ownerIsEvmWallet && (
                <DispatchXrpField xrp={xrpForMint} t={t} />
              )}

              <button
                onClick={prepare}
                disabled={!claim.claimable}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {claim.claimable ? t('Review before signing') : t('Available when the period ends')}
              </button>
            </>
          )}

          {phase === 'preparing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">{t('Preparing the unsigned payload…')}</p>
            </div>
          )}

          {phase === 'review' && prepared && (
            <>
              <div className="bg-ink/5 border border-ink/10 rounded-xl px-4 py-2 divide-y divide-ink/5">
                {disclosure?.period != null && (
                  <Row label={t('Withdrawal period')} value={String(disclosure.period)} />
                )}
                {disclosure?.fxrpQueued != null && (
                  <Row label={t('Queued for release')} value={`${fmt(Number(disclosure.fxrpQueued), 4)} FXRP`} />
                )}
                {disclosure?.estimatedFxrpOut != null && (
                  <Row label={t('You receive (est.)')} value={`${fmt(Number(disclosure.estimatedFxrpOut), 4)} FXRP`} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.fxrpRedeemed != null && (
                  <Row label={t('Redeemed to native XRP')} value={`${fmt(Number(disclosure.fxrpRedeemed), 4)} FXRP`} />
                )}
                {prepared.rail === 'xrpl' && typeof disclosure?.xrplDestination === 'string' && (
                  <Row
                    label={t('XRP arrives at')}
                    value={`${String(disclosure.xrplDestination).slice(0, 8)}…${String(disclosure.xrplDestination).slice(-4)}`}
                  />
                )}
                {prepared.rail === 'xrpl' && disclosure?.mintCoupledXrp != null && (
                  <Row label={t('Dispatch XRP (comes back to you as FXRP)')} value={fmt(Number(disclosure.mintCoupledXrp))} />
                )}
                {/* R5 — the cost is never left to silence. Quoted figures when
                    the prepare carried them; an explicit "not quoted" when it
                    did not (the old `!= null` guards simply rendered nothing,
                    and "Claiming pays only gas" was the last thing the user had
                    read). On the EVM rail the gas is the wallet's to quote, and
                    what the vault takes is said only if the prepare said it. */}
                {/* settling-residuos: the digits follow the size of the fee —
                    `fmt(0.003, 2)` printed "0 XRP", i.e. the disclosure said
                    "free" about a charge that exists. */}
                {feeQuote?.kind === 'quoted' && (
                  <>
                    <Row
                      label={t('Minting fee')}
                      value={`${fmt(feeQuote.mintingFeeXrp, feeXrpDigits(feeQuote.mintingFeeXrp))} XRP`}
                    />
                    <Row
                      label={t('Executor fee')}
                      value={`${fmt(feeQuote.executorFeeXrp, feeXrpDigits(feeQuote.executorFeeXrp))} XRP`}
                    />
                  </>
                )}
                {/* The old value claimed TWO things and read one: the route does
                    state there is no vault fee on this rail (`fee`), but nobody
                    ever read what the redeem itself charged. Only the stated
                    half survives; the invented half is gone. */}
                {feeQuote?.kind === 'gas-only' && (
                  <>
                    <Row label={t('Fee charged by the vault')} value={t('none for this release')} />
                    <Row label={t('Network fee')} value={t('quoted by your wallet before you approve')} />
                  </>
                )}
                {feeQuote?.kind === 'gas-only-unstated' && (
                  <>
                    <Row label={t('Fee charged by the vault')} value={t('not quoted in this prepare')} />
                    <Row label={t('Network fee')} value={t('quoted by your wallet before you approve')} />
                  </>
                )}
                {prepared.rail === 'xrpl' && disclosure?.fxrpMintedSideEffect != null && (
                  <Row
                    label={t('…returns to your Smart Account as')}
                    value={`${fmt(Number(disclosure.fxrpMintedSideEffect), 4)} FXRP`}
                  />
                )}
              </div>
              {typeof disclosure?.note === 'string' && (
                <p className="text-[11px] text-ink/45 leading-relaxed">{disclosure.note}</p>
              )}
              {/* Invariant #6 + R5: a fee that could not be read is SAID, never
                  swallowed. Without this the dispatch's XRP fees vanished from
                  the screen whenever the prepare failed to quote them. */}
              {feeQuote?.kind === 'unquoted' && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('We could not quote the minting and executor fees of this dispatch — they are missing from the disclosure above, not zero. Check the exact amount in Xaman before you approve.')}
                </div>
              )}
              {claimRedemption?.redeems && (
                <RedemptionFeeNotice
                  response={prepared}
                  grossFxrp={claimRedemption.grossFxrp}
                  t={t}
                  showAmount
                  amountLabel="Your XRPL wallet receives"
                />
              )}
              {/* Invariant #11 — the dry-run verdict, before the wallet opens. */}
              <PreflightNotice preflight={prepared.preflight} />
              {prepared.rail === 'xrpl' && preflightSaysFail(prepared.preflight) && owningXrpl && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('The account that signs is your XRPL wallet')}{' '}
                  <span className="font-mono">{owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}</span> —{' '}
                  {t('send it ~2 XRP (from an exchange or another wallet) and come back. Your money on Flare is untouched.')}
                </div>
              )}
              {/* Tras cancelar en Xaman, el 0xFE preparado
                  sigue sentado en el nonce. Se dice y se dice CUÁNDO se suelta;
                  el botón de soltarlo no aparece mientras siga firmable aquí
                  (soltarlo mataría la firma que esta persona aún puede dar). */}
              {error && prepared.rail === 'xrpl' && prepared.memoHex ? (
                /* …y con salida. El estado «aun firmable»
                   escondia las TRES acciones, asi que quien rechazaba en Xaman
                   se quedaba con un parrafo y nada que hacer. */
                <AbandonedSeatNotice
                  memoHex={prepared.memoHex}
                  t={t}
                  stillSignable
                  onPrepareAgain={() => void prepare()}
                />
              ) : null}
              {/* Sign stays reachable while the disclosure scrolls. */}
              <div className="sticky bottom-0 -mx-6 bg-surface-1 px-6 pt-3 space-y-4">
                <button
                  onClick={sign}
                  className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20"
                >
                  {prepared.rail === 'xrpl' ? t('Sign in Xaman') : t('Sign in wallet')}
                </button>
                <button
                  onClick={() => {
                    releaseSeatIfUnsigned();
                    setPrepared(null);
                    setPhase('form');
                  }}
                  className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
                >
                  {t('Back')}
                </button>
              </div>
            </>
          )}

          {phase === 'signing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-8 h-8 text-volt animate-spin" />
              <p className="text-sm text-ink/60">
                {prepared?.rail === 'xrpl' ? t('Approve the Payment in Xaman…') : t('Confirm in your wallet…')}
              </p>
            </div>
          )}

          {(phase === 'settling' || phase === 'done') && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                // R8.1: the success line follows the ARRIVAL of the PREPARED
                // rail — with the XRPL exit the FXRP is NOT in any wallet yet
                // (the FAssets agent pays the XRP minutes-to-hours later), and
                // on the PA rail it lands in the Smart Account, not in "your
                // wallet".
                settledText={
                  arrival === 'xrpl-pending'
                    ? t('Claim confirmed — your XRP is on its way to your XRPL wallet (minutes to hours).')
                    : arrival === 'smart-account'
                      ? t('Claim settled — the FXRP is in your Smart Account on Flare.')
                      : t('Claim settled — the FXRP is in your wallet.')
                }
                pendingText={t('Claim signed — settling on Flare…')}
                // Firelight es el único vault con salida en cola, y por tanto
                // el único donde «no ha llegado» puede ser un problema suyo.
                protocol="firelight"
              />
              <button
                onClick={onClose}
                className="mt-1 w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {settlement.state.status === 'settled' ? t('Done') : t('Keep waiting in the background')}
              </button>
            </div>
          )}

          {/* settling-residuos — the ending that used to be missing. Amber, not
              red: nothing here says the operation failed. And no way back to
              the sign button: re-signing is exactly how a claim is dispatched
              twice. The nonce seat is deliberately NOT released either (the
              dispatch may already have consumed it). */}
          {phase === 'unconfirmed' && unconfirmed && (
            <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4 space-y-3 text-xs text-amber-200 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-amber-100">{t('We could not confirm your signature')}</p>
              </div>
              <p>
                {prepared?.rail === 'xrpl'
                  ? t('The order went to Xaman and we could not read what happened next. Do NOT sign it again: a second dispatch pays a second carrier fee in XRP and takes a second nonce seat. Check your XRPL account and your position first.')
                  : t('The transaction was sent to your wallet and we could not read its receipt. Do NOT sign it again — check it on the explorer and reload your position.')}
              </p>
              {unconfirmed.txHash && (
                <a
                  href={explorerTxUrl(prepared?.rail === 'evm' ? prepared.chainId : prepared?.rail === 'xrpl' ? 'xrpl' : 14, unconfirmed.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 hover:text-sky-200 underline underline-offset-2 block font-mono"
                >
                  {t('Check it on the explorer →')}
                </a>
              )}
              {/* settling-final: the wallet's OWN words, verbatim and clipped,
                  or nothing. A translated verdict here ("nothing moved — try
                  again in a minute", which is what a timeout translates to)
                  told the reader the opposite of the paragraph above and sent
                  them to sign a second time. */}
              {unconfirmed.trace && (
                <p className="text-[11px] text-ink/45">
                  {t('What the wallet reported:')}{' '}
                  <span className="font-mono break-all">{unconfirmed.trace}</span>
                </p>
              )}
              <button
                onClick={() => {
                  onChanged();
                  onClose();
                }}
                className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Close and refresh my positions')}
              </button>
            </div>
          )}

          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('Astryum prepares unsigned payloads and discloses every number; you sign in your own wallet. It never signs or executes on its own.')}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

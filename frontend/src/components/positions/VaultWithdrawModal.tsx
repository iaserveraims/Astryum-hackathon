'use client';

/**
 * VaultWithdrawModal — exit rail of the partner vaults (Firelight stXRP,
 * Upshift earnXRP / Monarq MXRPY), driven from the Positions board and the
 * Estrategias hub.
 *
 * Backend: POST /flare-demo/vault-withdraw/prepare (mirror of /vault/prepare).
 * Two rails, chosen by WHO holds the shares:
 *   - the user's EVM wallet   → one unsigned EVM call (instantRedeem / redeem),
 *   - the Personal Account    → 0xFE userOp signed in Xaman (mint-coupled).
 *
 * The form always shows the vault balance ("what's in the vault") with a MAX
 * button that fills the exact share balance — the user never types blind.
 * Prepare → review (full disclosure, invariant #6) → the USER signs → done.
 * Astryum never signs, never broadcasts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, AlertTriangle, ArrowDownToLine } from 'lucide-react';
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
import type { ProtocolId } from '../../lib/earn/protocols';
import { releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { DispatchXrpField } from './DispatchXrpField';
import { useCarrierXrp } from '@/lib/flare/carrier';
import { DestinationField } from './DestinationField';
import { AmountSliderUsd } from './AmountSliderUsd';
import { useXrpUsdPrice } from '../../hooks/useXrpUsdPrice';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { explorerTxUrl } from '../../lib/wallet/inFlightError';
import { walletNameResolver } from '../../lib/walletIdentity';
import { WalletSelect } from '../wallet/WalletSelect';
import { AbandonedSeatNotice, SeatRefusalNotice, seatRefusalSentence } from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { noteFlareInstructionDelivery } from '../../lib/xaman/liveRequests';
import {
  signFailureAction,
  dispatchFeeQuote,
  feeXrpDigits,
  freshClaimableAt,
  instantFeeQuote,
  releaseLine,
  type ClaimDateRead,
} from './vaultModalTruth';

const API_BASE = getApiBase();
const SHARE_DECIMALS = 6; // LP/stXRP shares mirror FXRP's 6 decimals

export type VaultParam = 'firelight' | 'earnxrp' | 'monarq';

/**
 * El parámetro de la ruta → la entidad del catálogo, para que el recibo pueda
 * decir a quién se escribe si el problema es del sitio. earnXRP y Monarq son
 * DOS productos del MISMO venue (Upshift), y por eso los dos caen en la misma
 * puerta aunque sean cards distintas.
 */
const PROTOCOL_OF_VAULT: Record<VaultParam, ProtocolId> = {
  firelight: 'firelight',
  earnxrp: 'upshift-earnxrp',
  monarq: 'upshift-monarq',
};

export interface VaultPositionRef {
  /** 'firelight' | 'earnxrp' | 'monarq' — resolved by the board from the position. */
  vault: VaultParam;
  /** Human vault name (earnXRP, MXRPY, stXRP…). */
  vaultLabel: string;
  /** Address that HOLDS the shares (EVM wallet or the Personal Account). */
  owner: string;
  /** Share balance in base units (6 dec), as scanned. */
  sharesBase: string;
  /** FXRP-per-share ×1e6 from the scan, for the client-side estimate only. */
  sharePriceE6?: string | null;
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
 * UI-settling (W2-F2 · R8.1) — WHEN the money is really available after this
 * signature, decided from the vault and from the date the prepare READ
 * on-chain (`disclosure.queuedExit.claimableAt` = Firelight `currentPeriodEnd()`).
 *
 * Firelight does not liquidate on the redeem: it burns the stXRP now, queues
 * the FXRP and releases it on a DATE. The done-view used to say "Withdrawal
 * settled on Flare" there — contradicting this same modal's warning three
 * screens earlier and telling the user their money had landed when nothing
 * had arrived at all.
 *
 * The date is never invented: when the on-chain read fails the prepare answers
 * `claimableAt: null` and the copy SAYS it could not be read, instead of
 * printing an approximation ("nunca inventar una cifra: si una fuente falla,
 * se DICE").
 */
export type ExitTiming =
  | { kind: 'instant' }
  | { kind: 'queued'; claimableAt: string }
  | { kind: 'queued-unknown-date' };

export function exitTiming(vault: string, disclosure?: Record<string, unknown>): ExitTiming {
  if (vault !== 'firelight') return { kind: 'instant' };
  const queued = disclosure ? disclosure.queuedExit : null;
  const at =
    queued && typeof queued === 'object' && 'claimableAt' in queued ? queued.claimableAt : null;
  if (typeof at === 'string' && Number.isFinite(Date.parse(at))) {
    return { kind: 'queued', claimableAt: at };
  }
  return { kind: 'queued-unknown-date' };
}

export function VaultWithdrawModal({
  position,
  holders,
  onClose,
  onChanged,
}: {
  position: VaultPositionRef;
  /** Every wallet holding THIS same vault — shown as a selector when >1
   *  (the same position can exist from two different wallets). */
  holders?: VaultPositionRef[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const { wallets: myWallets } = useMyWallets();

  // The wallet being withdrawn FROM — always visible, selectable when the
  // vault is held by more than one wallet.
  const allHolders = useMemo(() => {
    const list = holders && holders.length > 0 ? holders : [position];
    return list.some((h) => h.owner.toLowerCase() === position.owner.toLowerCase())
      ? list
      : [position, ...list];
  }, [holders, position]);
  const [ownerSel, setOwnerSel] = useState(position.owner);
  const selected = allHolders.find((h) => h.owner.toLowerCase() === ownerSel.toLowerCase()) ?? position;
  // LA regla canónica de nombres (2026-08-22): la copia local label??dirección
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
  // settling-residuos: the release date re-read from the ledger AFTER the exit
  // executed. The prepare's date is older than the executor.
  const [claimRead, setClaimRead] = useState<ClaimDateRead>({ state: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
  const releaseSeatIfUnsigned = () => {
    if (prepared?.rail === 'xrpl' && phase === 'review') releaseHandoffSeat(prepared.memoHex);
  };

  // it. 19 (R5 R5) — ESTA PANTALLA NO ENSEÑABA NADA SOBRE EL ASIENTO. It frees a
  // seat on abandon and then meets `NONCE_SEAT_TAKEN` on the next prepare, and
  // the only thing the person saw was the server's raw code inside the red box
  // (or, worse, its Spanish paragraph). The refusal body is kept so the shared
  // notice can say it in one sentence and — over an UNSIGNED draft only — offer
  // the way out. The memo of the draft this screen abandoned is remembered for
  // exactly that offer.
  const [seatRefusal, setSeatRefusal] = useState<unknown>(null);
  const abandonedMemo = useRef<string | null>(null);
  if (prepared?.rail === 'xrpl' && prepared.memoHex) abandonedMemo.current = prepared.memoHex;

  const [amount, setAmount] = useState('');
  // MAX sends the EXACT scanned base units — no float round-trip dust.
  const [maxBase, setMaxBase] = useState<string | null>(null);
  // Carrier auto (founder 2026-08-17): live fees + margin from the backend
  // — no user knob; can never block the operation (lib/flare/carrier).
  const xrpForMint = useCarrierXrp();
  const [evmDest, setEvmDest] = useState(evm.address ?? '');

  const balanceShares = useMemo(() => {
    const n = Number(selected.sharesBase);
    return Number.isFinite(n) ? n / 10 ** SHARE_DECIMALS : 0;
  }, [selected.sharesBase]);

  const balanceFxrp = useMemo(() => {
    const sp = Number(selected.sharePriceE6 ?? 0);
    return sp > 0 ? (balanceShares * sp) / 10 ** SHARE_DECIMALS : null;
  }, [balanceShares, selected.sharePriceE6]);

  // Live XRP/USD (FTSO) → dollar value of shares (via the FXRP share price).
  const xrpUsd = useXrpUsdPrice();
  const shareUsd = useMemo(() => {
    const sp = Number(selected.sharePriceE6 ?? 0);
    return sp > 0 && xrpUsd != null ? (sp / 10 ** SHARE_DECIMALS) * xrpUsd : null;
  }, [selected.sharePriceE6, xrpUsd]);

  // Whose shares are these? The connected EVM wallet signs directly; anything
  // else is the Personal Account → 0xFE userOp signed in Xaman.
  const ownerIsEvmWallet =
    !!evm.address && evm.address.toLowerCase() === selected.owner.toLowerCase();

  // Which XRPL account CONTROLS this Smart Account. The prepare must pin THAT
  // account (the executor rejects any other sender), never whichever Xaman
  // happens to be connected — the 2026-07-19 "INSUFFICIENT_SHARES with every
  // amount" was exactly this mismatch resolving an empty PA.
  const xrplCandidates = useMemo(
    () => [
      ...myWallets.map((w) => w.address),
      ...(xrpl.address ? [xrpl.address] : []),
    ],
    [myWallets, xrpl.address],
  );
  const { owningXrpl, resolving: resolvingOwner } = useOwningXrpl(
    ownerIsEvmWallet ? null : selected.owner,
    xrplCandidates,
  );
  const connectedIsOwner =
    !!owningXrpl && !!xrpl.address && owningXrpl.toLowerCase() === xrpl.address.toLowerCase();

  // Switching the source wallet restarts the form — its balance, its rail.
  function selectOwner(addr: string) {
    setOwnerSel(addr);
    setAmount('');
    setMaxBase(null);
    setPrepared(null);
    setError('');
    setPhase('form');
  }

  function sharesBaseToSend(): string {
    if (maxBase) return maxBase;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return String(BigInt(Math.round(n * 10 ** SHARE_DECIMALS)));
  }

  async function prepare() {
    setError('');
    setSeatRefusal(null);
    setPhase('preparing');
    try {
      const sharesBase = sharesBaseToSend();
      if (sharesBase === '0') throw new Error(t('Amount must be greater than 0'));
      const body: Record<string, unknown> = {
        vault: selected.vault,
        sharesBase,
        region: getUserRegion(),
      };
      if (ownerIsEvmWallet) {
        body.evmAddress = selected.owner;
      } else {
        // Pin the XRPL account that OWNS this Smart Account (the payload's
        // Account field forces Xaman to sign with it). Falling back to the
        // connected address only when the owner could not be resolved.
        const signerXrpl = owningXrpl ?? xrpl.address;
        if (!signerXrpl) {
          throw new Error(t('These shares live on your Smart Account — connect your XRPL wallet (Xaman) to withdraw them.'));
        }
        body.xrplAddress = signerXrpl;
        body.amountXrpForMint = xrpForMint;
        // Destino = la propia Smart Account → sin evmDest: el backend deja el
        // FXRP como saldo libre del PA (su comportamiento nativo).
        const dest = evmDest.trim();
        if (dest && /^0x[a-fA-F0-9]{40}$/.test(dest) && dest.toLowerCase() !== selected.owner.toLowerCase()) {
          body.evmDest = dest;
        }
      }
      const res = await fetch(`${API_BASE}/flare-demo/vault-withdraw/prepare`, {
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
        if (code === 'INSUFFICIENT_SHARES') {
          // Say WHICH account was checked and the exact numbers — the bare
          // code left the user blind (incidente 2026-07-19).
          const holderShort = typeof resBody.holder === 'string'
            ? `${resBody.holder.slice(0, 8)}…${resBody.holder.slice(-6)}`
            : '?';
          throw new Error(
            `${t('That account holds fewer shares than requested')} ` +
            `(${holderShort}: ${fmt(Number(resBody.balanceShares ?? 0))} vs ${fmt(Number(resBody.requestedShares ?? 0))}). ` +
            t('Use MAX to withdraw the exact balance.'),
          );
        }
        // EL ASIENTO DE NONCE (it. 17, R5 5.4): ni el código crudo ni el
        // párrafo en castellano del servidor. El cuerpo se guarda para poder
        // ofrecer «Free the seat» sobre el borrador que esta pantalla dejó.
        const seat = seatRefusalSentence(resBody, t);
        if (seat) {
          setSeatRefusal(resBody);
          throw new Error(seat);
        }
        // it. 22 (Q3 3.7): ni el slug ni el castellano del servidor por esta
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
        String(resBody.personalAccount ?? '').toLowerCase() !== selected.owner.toLowerCase()
      ) {
        throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
      }
      // it. 19 (R5 R7) — LA PALABRA DE LA ENTREGA SE REGISTRA AQUÍ. This prepare
      // uses raw `fetch`, so nothing ever told the live banner whether the
      // server's executor carries this 0xFE; with no word at all the banner fell
      // back to the prudent sentence over a perfectly legitimate exit. Read
      // defensively: a route that does not send the field leaves the banner
      // neutral, exactly as before, and only `executorEnabled === true` promises.
      if (resBody.rail === 'xrpl') {
        noteFlareInstructionDelivery(
          (resBody as { xrplPayment?: unknown }).xrplPayment,
          (resBody as { serverDelivery?: { executorEnabled?: unknown } }).serverDelivery,
        );
      }
      setPrepared(resBody as PreparedEvm | PreparedXrpl);
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('form');
    }
  }

  /**
   * settling-residuos: the release date, re-read from the vault AFTER the exit
   * executed. The prepare answers `currentPeriodEnd()` read BEFORE the
   * signature; on the 0xFE rail the executor runs 2-5 minutes later (ceiling 6)
   * and the exit lands in the NEXT period, so the prepare's date can be a whole
   * period early. This endpoint (`/vault-claims/:owner`, the same one the
   * Intents card polls) returns the queue as it really is. When it cannot be
   * read we say so — the date drops to "estimated", never to an invention.
   */
  async function rereadReleaseDate(owner: string) {
    setClaimRead({ state: 'reading' });
    try {
      const res = await fetch(`${API_BASE}/flare-demo/vault-claims/${owner}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { pending?: unknown };
      const at = freshClaimableAt(body?.pending);
      if (!alive.current) return;
      setClaimRead(at ? { state: 'read', claimableAt: at } : { state: 'unread' });
    } catch {
      if (alive.current) setClaimRead({ state: 'unread' });
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
        // The exit is on the ledger: now the queue can be asked for the REAL
        // release date instead of repeating the one read before signing.
        if (queuedExit) void rereadReleaseDate(selected.owner);
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
      // fee in XRP, a second nonce seat and a second exit from the vault. Only
      // an error that PROVES nothing left goes back to the sign button.
      // settling-final: the decision AND the words it puts on screen come from
      // one pure function, so both can be tested by running them — the panel
      // used to classify here and then quote `translateError`, whose sentence
      // for a timeout ("nothing moved — try again in a minute") contradicted
      // the headline above it.
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
        // same way. Back to the form for a fresh prepare, never back to the
        // sign button. The 0xFE nonce seat is deliberately NOT released: this
        // rail cannot produce a read revert here (the executor settles later,
        // outside this catch) and freeing a seat that may have been consumed
        // is the wrong direction.
        setPrepared(null);
        setPhase('form');
        return;
      }
      setPhase('review'); // provably never left the wallet — signing again is safe
    }
  }

  const disclosure = prepared?.disclosure;
  // What this signature really does to the money (see exitTiming above).
  const timing = exitTiming(selected.vault, disclosure);
  /** This vault parks the money in a period queue — there is a date to re-read. */
  const queuedExit = timing.kind !== 'instant';
  const claimableLocal =
    timing.kind === 'queued' ? new Date(timing.claimableAt).toLocaleString() : null;
  // settling-residuos: what the done-view is ALLOWED to say about the date.
  const release = releaseLine(timing, claimRead);
  const releaseLocal =
    release.kind === 'confirmed' || release.kind === 'floor'
      ? new Date(release.at).toLocaleString()
      : null;
  // settling-residuos (R5, copied from the twin): on the 0xFE rail the XRP
  // fees are quoted or their absence is SAID — a failed read used to render
  // nothing at all, and an empty fee row reads as "free".
  const feeQuote = prepared?.rail === 'xrpl' ? dispatchFeeQuote(disclosure) : null;
  // it. 27: the VAULT's own exit fee, in the three states it really has — a
  // fee, no fee, or a fee nobody could read. The `!= null` guard below used to
  // render nothing for all three at once.
  const instantFee = instantFeeQuote(disclosure);

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center border text-sky-300 border-sky-400/30 bg-sky-400/10">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">
                {t('Withdraw')} · {selected.vaultLabel}
              </h2>
              <p className="text-xs text-ink/40 mt-0.5 font-mono">
                <span className="text-ink/60">{aliasOf(selected.owner)}</span> ·{' '}
                {selected.owner.slice(0, 10)}…{selected.owner.slice(-6)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* Un asiento tomado se cuenta en inglés y, cuando el borrador es el
              que esta pantalla abandonó, con la salida (it. 19, R5 R5). */}
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
              {/* The wallet being withdrawn FROM — a selector when the same
                  vault is held by more than one wallet. */}
              {allHolders.length > 1 ? (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Withdraw from wallet')}</label>
                  {/* Con la cara de cada wallet (fundador 2026-08-30): de
                      aquí sale el dinero, así que la wallet se reconoce por
                      su color y su marca, no por una ristra de texto. */}
                  <WalletSelect
                    value={selected.owner}
                    onChange={selectOwner}
                    options={allHolders.map((h) => ({
                      key: h.owner,
                      record:
                        myWallets.find((w) => w.address.toLowerCase() === h.owner.toLowerCase()) ??
                        ({ address: h.owner } as (typeof myWallets)[number]),
                      name: aliasOf(h.owner),
                      detail: `${h.owner.slice(0, 8)}…${h.owner.slice(-6)} · ${fmt(
                        Number(h.sharesBase) / 10 ** SHARE_DECIMALS,
                      )} ${h.vaultLabel}`,
                    }))}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 text-xs bg-ink/5 border border-ink/10 rounded-xl px-3 py-2.5">
                  <span className="text-ink/40">{t('Withdraw from wallet')}</span>
                  <span className="text-ink/75 min-w-0 truncate">
                    {aliasOf(selected.owner)}{' '}
                    <span className="font-mono text-ink/45">
                      {selected.owner.slice(0, 8)}…{selected.owner.slice(-6)}
                    </span>
                  </span>
                </div>
              )}

              {/* What's in the vault — the number the user came to see. */}
              <div className="bg-ink/5 border border-ink/10 rounded-xl p-3 text-xs">
                <div className="text-ink/40">{t('In the vault')}</div>
                <div className="font-mono text-ink/85 mt-1 text-sm">
                  {fmt(balanceShares)} {selected.vaultLabel}
                  {balanceFxrp != null && (
                    <span className="text-ink/45"> ≈ {fmt(balanceFxrp, 4)} FXRP</span>
                  )}
                  {balanceFxrp != null && xrpUsd != null && balanceFxrp > 0 && (
                    <span className="text-ink/40 text-xs"> ≈ ${fmt(balanceFxrp * xrpUsd, 2)}</span>
                  )}
                </div>
              </div>

              {/* Who signs: the XRPL account that CONTROLS this Smart Account,
                  pinned in the payload — said BEFORE preparing so a different
                  connected Xaman never ends in a blind INSUFFICIENT_SHARES. */}
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

              {/* Firelight pays in TWO steps (verified on-chain 2026-07-14):
                  the redeem burns now and QUEUES the FXRP; nothing arrives in
                  that tx. Said BEFORE preparing, not discovered after.
                  Reads `selected` (the wallet actually being withdrawn from),
                  like every other line here: with `position` the warning and
                  the done-view could disagree about the same operation. */}
              {selected.vault === 'firelight' && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {/* settling-residuos: "exact time shown before you sign" was
                      a promise this screen cannot keep — the date read before
                      the signature is the end of the CURRENT period, and the
                      exit joins the next one.
                      settling-final: so the warning no longer promises an
                      "estimated date" either; it promises what the product
                      actually delivers — the vault fixes the date and the
                      position shows it. */}
                  {t(
                    'Firelight does NOT pay instantly: this redeem burns your stXRP now and queues the FXRP into a ~24h withdrawal period. Nothing arrives in this transaction — your position will keep showing the FXRP in flight with a Claim button, and one click releases it when the period ends (the vault fixes the exact date when the exit is queued, and your position shows it).',
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-ink/40 mb-2 flex items-center justify-between">
                  <span>
                    {t('Amount')} · {selected.vaultLabel}
                  </span>
                  {balanceShares > 0 && (
                    <button
                      onClick={() => {
                        setMaxBase(selected.sharesBase);
                        setAmount(String(balanceShares));
                      }}
                      className="text-volt hover:underline font-medium"
                    >
                      MAX ({fmt(balanceShares)})
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setMaxBase(null); // manual edit → back to the typed amount
                  }}
                  className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                />
                <AmountSliderUsd
                  max={balanceShares}
                  amount={amount}
                  usdPrice={shareUsd}
                  onAmount={(v, atMax) => {
                    setAmount(v);
                    // At the top of the drag, send the EXACT scanned base units
                    // (the MAX semantics) — no float round-trip dust.
                    setMaxBase(atMax ? selected.sharesBase : null);
                  }}
                />
              </div>

              {!ownerIsEvmWallet && (
                <>
                  <div>
                    {/* Adónde va el FXRP: mis wallets / agenda / escribir. La
                        wallet de ORIGEN (esta Smart Account) va primera con su
                        punto — elegirla = dejar el FXRP donde ya vive (el
                        prepare simplemente omite evmDest). */}
                    <DestinationField
                      kind="evm"
                      label={t('Where the capital goes')}
                      value={evmDest}
                      onChange={setEvmDest}
                      myWallets={myWallets}
                      source={{ address: selected.owner, label: aliasOf(selected.owner) }}
                      sourceHint={t('The funds leave from here — pick it to keep the capital in this same wallet.')}
                      t={t}
                    />
                    {evmDest.trim().toLowerCase() === selected.owner.toLowerCase() && (
                      <p className="text-[10px] text-ink/35 mt-1.5">
                        {t('Leaves the vault and stays as free balance in this Smart Account.')}
                      </p>
                    )}
                  </div>
                  <DispatchXrpField xrp={xrpForMint} t={t} />
                </>
              )}

              <button
                onClick={prepare}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20"
              >
                {t('Review before signing')}
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
                {disclosure?.sharesRedeemed != null && (
                  <Row label={t('Shares to redeem')} value={fmt(Number(disclosure.sharesRedeemed))} />
                )}
                {disclosure?.sharePrice != null && (
                  <Row label={t('Share price (live)')} value={`${fmt(Number(disclosure.sharePrice))} FXRP`} />
                )}
                {/* it. 27 — THREE STATES, NOT ONE SILENCE. The old `!= null`
                    guard rendered nothing for «this vault has no instant fee»,
                    for «the fee is zero» and for «the fee could not be read»
                    alike, and an empty fee row reads as free (invariant #6).
                    The prepare now refuses to compose an exit whose fee it
                    could not read, so `unreadable` should never arrive here —
                    and if it ever does, it is SAID rather than hidden. */}
                {instantFee.kind === 'charged' && (
                  <Row
                    label={t('Instant redemption fee')}
                    // bps is desk jargon — the person reads a percentage (R1.5).
                    value={`${(instantFee.bps / 100).toFixed(2)}%${
                      instantFee.fxrp != null
                        ? ` (${fmt(instantFee.fxrp, feeXrpDigits(instantFee.fxrp))} FXRP)`
                        : ''
                    }`}
                  />
                )}
                {instantFee.kind === 'unreadable' && (
                  <Row label={t('Instant redemption fee')} value={t('could not be read on-chain')} />
                )}
                {disclosure?.estimatedFxrpOut != null ? (
                  <Row label={t('You receive (est.)')} value={`${fmt(Number(disclosure.estimatedFxrpOut), 4)} FXRP`} />
                ) : (
                  /* it. 27: no estimate is not «nothing to say». The live share
                     price failed, so this row admits it instead of leaving the
                     person to read the amount above as what arrives. */
                  <Row label={t('You receive (est.)')} value={t('could not be read on-chain')} />
                )}
                {disclosure?.estimatedValueUSD != null && (
                  <Row label={t('Value (est.)')} value={`$${fmt(Number(disclosure.estimatedValueUSD), 2)}`} />
                )}
                {/* The date this modal PROMISED and never showed: the on-chain
                    currentPeriodEnd() the prepare read — or, when that read
                    failed, the fact that it could not be read.
                    settling-final: that instant is NOT the claim date, and it
                    never was an estimate of it. `_requestWithdraw` queues the
                    exit into currentPeriod()+1, so the FXRP is released at the
                    end of the FOLLOWING period; printing this one as "available
                    to claim from (estimated)" sent the user back a whole period
                    early, to a position with no Claim button — the very trap
                    this frente exists to close. It is labelled as what it is,
                    and the line under the box says what follows from it. */}
                {timing.kind === 'queued' && (
                  <Row label={t('Current withdrawal period ends')} value={claimableLocal ?? ''} />
                )}
                {timing.kind === 'queued-unknown-date' && (
                  <Row label={t('Available to claim from')} value={t('could not be read on-chain')} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.mintCoupledXrp != null && (
                  <Row label={t('Dispatch XRP (comes back to you as FXRP)')} value={fmt(Number(disclosure.mintCoupledXrp))} />
                )}
                {/* settling-residuos (R5): quoted with enough precision that a
                    real fee cannot read as free — `fmt(0.003, 2)` printed
                    "0 XRP", which is the opposite of disclosing it. */}
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
                {prepared.rail === 'xrpl' && disclosure?.fxrpMintedSideEffect != null && (
                  <Row
                    label={t('…returns to your Smart Account as')}
                    value={`${fmt(Number(disclosure.fxrpMintedSideEffect), 4)} FXRP`}
                  />
                )}
                {prepared.rail === 'xrpl' && owningXrpl && (
                  <Row label={t('Signs (pinned in the payload)')} value={`${owningXrpl.slice(0, 8)}…${owningXrpl.slice(-4)}`} />
                )}
              </div>
              {/* settling-final: the consequence of the row above, said before
                  the signature. Without it, an honest label alone still leaves
                  the reader assuming that date is when the money comes back. */}
              {timing.kind === 'queued' && (
                <p className="text-[11px] text-ink/45 leading-relaxed">
                  {t(
                    'Your exit joins the NEXT withdrawal period, so the FXRP is released after that date, not on it. The vault fixes the exact date when the exit is queued, and your position shows it.',
                  )}
                </p>
              )}
              {typeof disclosure?.note === 'string' && (
                <p className="text-[11px] text-ink/45 leading-relaxed">{disclosure.note}</p>
              )}
              {/* Invariant #6 + R5, the twin's rule applied here: a fee that
                  could not be read is SAID. Before this, the two `!= null`
                  guards above simply rendered nothing and the XRP cost of the
                  dispatch vanished from the screen the user signs from. */}
              {feeQuote?.kind === 'unquoted' && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('We could not quote the minting and executor fees of this dispatch — they are missing from the disclosure above, not zero. Check the exact amount in Xaman before you approve.')}
                </div>
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
              {/* it. 21 (it. 20 §3.3): tras cancelar en Xaman, el 0xFE preparado
                  sigue sentado en el nonce. Se dice y se dice CUÁNDO se suelta;
                  el botón de soltarlo no aparece mientras siga firmable aquí
                  (soltarlo mataría la firma que esta persona aún puede dar). */}
              {error && prepared.rail === 'xrpl' && prepared.memoHex ? (
                /* it. 22 (Q3 3.6): …y con salida. El estado «aun firmable»
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
                // R8.1: Firelight does NOT pay on this transaction — the exit
                // freezes and is released on a DATE. Saying "settled" here
                // contradicted the modal's own warning three screens earlier.
                // The date is the one the prepare READ on-chain; when that read
                // failed we say so instead of inventing "~24h".
                // settling-residuos: 'confirmed' is the only branch allowed to
                // state the date as a fact — it was re-read from the queue
                // AFTER execution.
                // settling-final: when that re-read fails, the prepare's date
                // is not repeated as an estimate of the release. It is the end
                // of the period that was RUNNING before the signature, and the
                // exit lands in the next one — so it is given as a floor ("the
                // money comes back after this"), which is the one thing about
                // it that is true.
                settledText={
                  release.kind === 'instant'
                    ? t('Withdrawal settled on Flare.')
                    : release.kind === 'reading'
                      ? t('Request registered. Reading the exact release date from the vault…')
                      : release.kind === 'confirmed'
                        ? `${t('Request registered. Your money will be available on')} ${releaseLocal} — ${t('a Claim button appears on your position when it is ready.')}`
                        : release.kind === 'floor'
                          ? `${t('Request registered. We could not re-read the release date: the withdrawal period that was running when you signed ends on')} ${releaseLocal} ${t('and your exit joins the next one, so the FXRP is released after that — your position shows the exact date.')}`
                          : t('Request registered. Your money enters the exit queue — we could not read the release date; a Claim button appears on your position when it is ready.')
                }
                pendingText={t('Withdrawal signed — settling on Flare…')}
                // Y en una salida en cola, más aún: la pregunta «¿por qué no ha
                // llegado?» es del vault, no del carril, y hasta hoy no tenía
                // más dirección que la nuestra.
                protocol={PROTOCOL_OF_VAULT[selected.vault]}
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
              the sign button: re-signing is exactly how this becomes a double
              exit. The nonce seat is deliberately NOT released either (the
              dispatch may already have consumed it). */}
          {phase === 'unconfirmed' && unconfirmed && (
            <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4 space-y-3 text-xs text-amber-200 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-amber-100">{t('We could not confirm your signature')}</p>
              </div>
              <p>
                {prepared?.rail === 'xrpl'
                  ? t('The order went to Xaman and we could not read what happened next. Do NOT sign it again: a second dispatch pays a second carrier fee in XRP, takes a second nonce seat and would take a second amount out of the vault. Check your XRPL account and your position first.')
                  : t('The transaction was sent to your wallet and we could not read its receipt. Do NOT sign it again — a second signature would take a second amount out of the vault. Check it on the explorer and reload your position.')}
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

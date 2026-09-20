'use client';

/**
 * WalletTransferModals — "Send" and "Receive", reusable from any surface
 * (Wallets page, the Movimientos door in Earn, the strategy agent).
 *
 *   WalletReceiveModal — shows the wallet address as a QR (plus copy) so the
 *     user can receive assets into it. Display-only, zero on-chain activity.
 *     `wallet` is optional: without it, the user picks among `wallets`.
 *
 *   WalletSendModal — prepares a native transfer (FLR on Flare, XRP on XRPL)
 *     to another linked wallet or an external address, then hands the UNSIGNED
 *     payload to the user's own wallet partner (MetaMask et al. / Xaman).
 *     `wallet` (the source) is optional — without it the modal offers a source
 *     picker over the user's transferable wallets. `initial` prefills the
 *     form (agent-compiled params); every field stays editable before prepare.
 *
 * REGULATORY BOUNDARY (CLAUDE.md invariant #1): prepare-only. The backend
 * returns an unsigned payload + disclosure; the user reviews and signs in
 * their own wallet. Astryum never signs, never custodies, never broadcasts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDisconnect } from 'wagmi';
import QRCode from 'react-qr-code';
import {
  ArrowUpRight,
  Undo2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import type { BackendWallet } from '../../services/walletLinkService';
import CouncilMultisigFlow from '../legacy/CouncilMultisigFlow';
import { useAuthorities } from '../../hooks/useAuthorities';
import { addressKey } from '../../lib/authority';
import { reinforcedPersonalKeys } from '../../lib/authority/personalQuorum';
import { addressBookService, type AddressBookEntry } from '../../services/v1Api';
import {
  fetchNativeBalance,
  transferRailOf,
  type NativeBalance,
  type TransferRail,
} from '../../lib/wallet/nativeBalance';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useUniversalConnect } from '../../lib/wallet/useUniversalConnect';
import { translateError } from '../../lib/errors/translateError';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { fmtQtyActive } from '../../lib/format';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { usePaFold, foldKey, isSmartAccountType } from '../../lib/wallet/paFold';
import { smartAccountDisplayName, walletDisplayName } from '../../lib/walletIdentity';
import { WalletSelect } from './WalletSelect';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { useOwningXrpl, resolvePersonalAccountOf } from '../../lib/wallet/paOwnership';
import { DispatchXrpField } from '../positions/DispatchXrpField';
import { useCarrierXrp } from '@/lib/flare/carrier';
import { releaseHandoffSeat, notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { SeatRefusalNotice, describeStaleSignature, seatRefusalSentence } from './SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';

/**
 * it. 22 (Q3 3.7) — LO QUE SE PUEDE ENSEÑAR DE UNA NEGATIVA QUE NO ES DE ASIENTO.
 *
 * El asiento ya tiene su lector y corre antes que esto; lo que quedaba después
 * era `body.detail || body.error`, es decir el párrafo en castellano del
 * servidor o su código crudo. `refusalHeadline` dice el código en una frase (y
 * conoce los «no pude leer»), y el `detail` solo se pega si está en inglés.
 */
function refusalText(body: unknown, status: number, t: (s: string) => string): string {
  const r = (body ?? {}) as { error?: string | null; code?: string | null; detail?: string | null };
  const said = [refusalHeadline(r, t), serverDetailIfEnglish(r.detail)]
    .filter((p): p is string => Boolean(p))
    .join(' — ');
  return said || `${t('The server refused this operation. Nothing was prepared and nothing was signed.')} (HTTP ${status})`;
}
import { noteFlareInstructionDelivery } from '../../lib/xaman/liveRequests';
import { getUserRegion } from '../../lib/region';
import {
  assetChoiceVerdict,
  astryumFeeRow,
  balanceValue,
  fillFeeText,
  paDispatchNetworkFee,
  parseNetworkBalance,
  readPaDispatchFees,
  redemptionFeeRow,
  paUnmintNetworkFee,
  paUnmintReturn,
  paUnmintReturnRow,
  readRidesOwnMint,
  finiteOrNull,
  type BalanceRead,
} from '../../lib/wallet/paDispatchDisclosure';
import { RedemptionFeeNotice } from '../../lib/fassets/RedemptionFeeNotice';
import { redemptionOf } from '../../lib/fassets/redemptionFeeRow';

const API_BASE = getApiBase();

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

// Los mismos límites que impone el servidor (routes/walletTransfer.ts): aquí
// solo evitan el viaje de ida y vuelta, la verdad la dice él.
const MEMO_MAX_BYTES = 128;
const XRPL_MAX_DESTINATION_TAG = 4_294_967_295; // uint32


const RAIL_NETWORK: Record<TransferRail, string> = { evm: 'Flare', xrpl: 'XRPL' };

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Cantidad tecleada → wei, por STRING. `parseFloat(x) * 1e18` pierde
 *  precisión en los últimos dígitos y el backend recibe un entero que no es el
 *  que el usuario vio; los 6 decimales del FXRP perdonaban eso, los 18 del FLR
 *  no. Asume un decimal ya validado (> 0) por `validate()`. */
function toWei(v: string): string {
  const [int = '0', frac = ''] = (v.trim() || '0').split('.');
  return BigInt((int || '0') + (frac + '0'.repeat(18)).slice(0, 18)).toString();
}

/** Guard against raw backend floats (0.30000000000000004) reaching the review. */
function fmtAmt(v: number, digits = 6): string {
  return fmtQtyActive(Number(v), digits); // app-locale aware (Fase 3)
}

// El APODO con la regla canónica de nombres (fundador 2026-08-22): apodo →
// marca propia → dirección corta. El walletType crudo ('metamask',
// 'xrp_identity') jamás llega a la pantalla como nombre.
function walletLabel(w: BackendWallet, t: (s: string) => string = (s) => s): string {
  return `${walletDisplayName(w, t)} · ${shortAddr(w.address)}`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/* ------------------------------------------------------------------ */
/* RECEIVE — address QR                                                 */
/* ------------------------------------------------------------------ */

export function WalletReceiveModal({
  wallet: fixedWallet,
  wallets,
  onClose,
}: {
  /** the receiving wallet; omit to let the user pick among `wallets` */
  wallet?: BackendWallet | null;
  /** linked wallets — the picker shown when no fixed wallet is given */
  wallets?: BackendWallet[];
  onClose: () => void;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [selectedId, setSelectedId] = useState(fixedWallet?.id ?? wallets?.[0]?.id ?? '');
  // `wallets` can arrive AFTER mount (the caller fetches them async) — adopt
  // the first one whenever the current selection no longer exists.
  useEffect(() => {
    if (fixedWallet || !wallets || wallets.some((w) => w.id === selectedId)) return;
    setSelectedId(wallets[0]?.id ?? '');
  }, [wallets, fixedWallet, selectedId]);
  const wallet = fixedWallet ?? wallets?.find((w) => w.id === selectedId) ?? null;
  const rail = wallet ? transferRailOf(wallet) : null;

  // The FUNCTIONAL fold (founder 2026-08-19): an XRPL wallet's Smart Account
  // is reached THROUGH its owner — "Receive" on the Xaman wallet asks WHICH
  // asset and routes it: XRP shows the r… address, FXRP shows the Smart
  // Account's Flare address (XRPL cannot hold FXRP; its FSA can). One more
  // FAsset someday = one more target in this list, same logic.
  // FLR nativo (fundador 2026-08-28) entra por la MISMA puerta que el FXRP: la
  // dirección de Flare de la Smart Account. Es un destino más de esta lista, no
  // una pantalla aparte — cada Xaman y su FSA son UNA cuenta.
  // Todas las Xaman del picker, no solo la elegida: el fold también nombra
  // cada Smart Account con su dueña (fundador 2026-08-22).
  const receiveXrpls = useMemo(
    () =>
      [...(wallets ?? []), ...(wallet ? [wallet] : [])]
        .map((w) => w.address)
        .filter((a) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)),
    [wallets, wallet],
  );
  const fold = usePaFold(receiveXrpls);
  const fsa = wallet ? fold.paByOwner.get(foldKey(wallet.address)) : undefined;
  const labelOf = (w: BackendWallet): string => {
    if (!isSmartAccountType(w.walletType)) return walletLabel(w, t);
    const ownerAddr = fold.ownerByPa.get(foldKey(w.address));
    const owner = ownerAddr
      ? ((wallets ?? []).find((x) => x.address === ownerAddr) ?? { address: ownerAddr })
      : null;
    return smartAccountDisplayName(w, owner, t);
  };
  const targets = useMemo(() => {
    if (!wallet) return [];
    const nativeSymbol = rail === 'xrpl' ? 'XRP' : rail === 'evm' ? 'FLR' : null;
    const native = {
      key: 'native' as const,
      symbol: nativeSymbol,
      address: wallet.address,
      network: rail ? RAIL_NETWORK[rail] : null,
      viaFsa: false,
    };
    if (!fsa || rail !== 'xrpl') return [native];
    return [
      native,
      { key: 'FXRP' as const, symbol: 'FXRP', address: fsa, network: 'Flare', viaFsa: true },
      { key: 'FLR' as const, symbol: 'FLR', address: fsa, network: 'Flare', viaFsa: true },
    ];
  }, [wallet, rail, fsa]);
  const [targetKey, setTargetKey] = useState<string>('native');
  // A wallet change resets the asset choice (its targets are different).
  useEffect(() => setTargetKey('native'), [wallet?.id]);
  const target = targets.find((x) => x.key === targetKey) ?? targets[0] ?? null;

  function copy() {
    if (!target) return;
    navigator.clipboard.writeText(target.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const networkLabel =
    target?.network ??
    (wallet?.ecosystem
      ? wallet.ecosystem.charAt(0).toUpperCase() + wallet.ecosystem.slice(1)
      : t('this network'));

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <QrCode className="w-4 h-4 text-volt" />
              {t('Receive')}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5">
              {wallet ? labelOf(wallet) : t('Choose the receiving wallet')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6 flex flex-col items-center gap-4">
          {!fixedWallet && wallets && wallets.length > 0 && (
            /* Con la cara de cada wallet (fundador 2026-08-30) — misma
               identidad que en la pantalla de Wallets. */
            <WalletSelect
              value={selectedId ?? ''}
              onChange={setSelectedId}
              options={wallets.map((w) => ({
                key: String(w.id),
                record: w,
                name: labelOf(w),
                detail: `${w.address.slice(0, 8)}…${w.address.slice(-6)}`,
              }))}
            />
          )}
          {!wallet ? (
            <p className="text-xs text-ink/50 bg-ink/5 border border-ink/10 rounded-xl px-4 py-3">
              {t('Link a wallet from Wallets to receive assets into it.')}
            </p>
          ) : (
            <>
          {targets.length > 1 && (
            <div className="w-full">
              <p className="text-[11px] text-ink/40 mb-1.5">{t('Which asset will you receive?')}</p>
              <div className={`grid gap-2 ${targets.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {targets.map((x) => (
                  <button
                    key={x.key}
                    onClick={() => setTargetKey(x.key)}
                    aria-pressed={target?.key === x.key}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      target?.key === x.key
                        ? 'border-volt/50 bg-volt/10 text-ink'
                        : 'border-ink/10 bg-ink/[0.03] text-ink/60 hover:text-ink hover:bg-ink/[0.06]'
                    }`}
                  >
                    {x.symbol && <TokenLogo symbol={x.symbol} size="xs" />}
                    {x.symbol}
                    <span className="text-[10px] text-ink/35 font-normal">{x.network}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white p-4 rounded-xl">
            <QRCode value={target?.address ?? wallet.address} size={192} />
          </div>

          <button
            onClick={copy}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-ink/5 border border-ink/10 hover:bg-ink/10 transition-colors"
            title={t('Copy address')}
          >
            <span className="text-[11px] font-mono text-ink/80 break-all text-left">{target?.address ?? wallet.address}</span>
            {copied ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-ink/40 shrink-0" />
            )}
          </button>

          {target?.viaFsa && (
            <p className="text-[11px] text-ink/50 bg-ink/[0.03] border border-ink/10 rounded-xl px-3 py-2.5 text-center leading-relaxed">
              {target.key === 'FLR'
                ? t('FLR lives on Flare, so it lands in this wallet’s Smart Account — operated from your own XRPL account. Same capital, shown inside this wallet.')
                : t('FXRP lives on Flare, so it lands in this wallet’s Smart Account — operated from your own XRPL account. Same capital, shown inside this wallet.')}
            </p>
          )}

          <p className="text-[11px] text-amber-200/70 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5 text-center">
            {t('Send only assets on')} <span className="font-semibold">{networkLabel}</span>{' '}
            {t('to this address. Assets sent from other networks would be lost.')}
          </p>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* SEND — prepare → review → sign in the user's wallet                  */
/* ------------------------------------------------------------------ */

interface TransferDisclosure {
  action: string;
  asset: string;
  network: string;
  amount: number;
  from: string;
  to: string;
  /** null = the server stated no Astryum fee figure for this order — never shown as 0. */
  astryumFee: number | null;
  /** With astryumFee null: the order's executor fee is listed in its own row. */
  astryumFeeExecutorListed?: boolean;
  networkFee: string;
  disclosedToUser: boolean;
  astryumSigns: boolean;
  note: string;
  /** XRP nativo: la nota que el usuario escribió, devuelta por el servidor tal
   *  como va dentro del pago — se revisa ANTES de firmar, no después. */
  destinationTag?: number;
  memo?: string;
  /** 0xFE orders: the server did not return the mint-coupled fee figures. */
  feeFiguresUnavailable?: boolean;
  /** 0xFE orders: FXRP the carrier mints back into the user's own account. */
  carrierReturnsFxrp?: number;
  /** pa-unmint: what really returns (the redemption may burn the minted FXRP) —
   *  replaces the plain «≈ X FXRP» (lib/wallet/paDispatchDisclosure · paUnmintReturn). */
  carrierReturnText?: string;
  /** pa-unmint: the FAssets redemption fee, as far as the server stated it. */
  redemptionFeeText?: string;
  /** bridge-mint-fxrp only — fee/net breakdown of the FAssets direct mint. */
  mintingFeeXrp?: number;
  executorFeeXrp?: number;
  netFxrp?: number;
  /** bridge-redeem-fxrp only — on-chain minimum. */
  minimumRedeemXrp?: number;
}

interface PreparedEvmTransfer {
  rail: 'evm';
  calls: Array<{ to: string; data: string; value?: string; chainId: number }>;
  disclosure: TransferDisclosure;
}

interface PreparedXrplTransfer {
  rail: 'xrpl';
  xrplPayment: Record<string, unknown>;
  disclosure: TransferDisclosure;
}

type PreparedTransfer = PreparedEvmTransfer | PreparedXrplTransfer;

// 'unconfirmed': handed to the wallet, outcome unknown — no way back to the form
// or the sign button (a second signature is a second payment / dispatch).
type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'error' | 'unconfirmed';

export interface SendPrefill {
  /** destination address (r… or 0x…) */
  to?: string;
  /** human-unit amount ("25.5") */
  amount?: string;
  /** what an EVM source sends — XRPL sources always pay XRP */
  asset?: 'FLR' | 'FXRP';
}

export function WalletSendModal({
  wallet: fixedWallet,
  wallets,
  onClose,
  initial,
  unmint = false,
}: {
  /** the sending wallet; omit to let the user pick among their transferable wallets */
  wallet?: BackendWallet | null;
  /** all linked wallets — source picker + "my other wallets" destinations */
  wallets: BackendWallet[];
  onClose: () => void;
  /** optional prefill (agent-compiled or deep-linked) — always editable before prepare */
  initial?: SendPrefill;
  /** Unmint door (founder 2026-08-12): same machinery, but the modal opens
   *  NAMED as what it does — convert FXRP back to native XRP. Locks the
   *  asset to FXRP and puts XRPL destinations first, so the redeem path is
   *  the obvious one instead of a Send secret. */
  unmint?: boolean;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const xrpl = useXrplWalletPartner();
  const connect = useUniversalConnect(async () => {});
  const { disconnectAsync } = useDisconnect();

  // Source — fixed by the caller (Wallets page) or picked here among the
  // wallets the beta can actually send from (Flare EVM / XRPL).
  const transferable = useMemo(() => wallets.filter((w) => transferRailOf(w) !== null), [wallets]);
  const prefillTo = initial?.to?.trim() ?? '';
  const [sourceId, setSourceId] = useState(() => {
    if (fixedWallet) return fixedWallet.id;
    // Prefer a source that isn't the prefilled destination.
    const notDest = transferable.find(
      (w) => !prefillTo || w.address.toLowerCase() !== prefillTo.toLowerCase(),
    );
    return (notDest ?? transferable[0])?.id ?? '';
  });
  // `wallets` can arrive AFTER mount (the caller fetches them async) — adopt a
  // source whenever the current pick no longer exists, same preference as above.
  useEffect(() => {
    if (fixedWallet || transferable.some((w) => w.id === sourceId)) return;
    const notDest = transferable.find(
      (w) => !prefillTo || w.address.toLowerCase() !== prefillTo.toLowerCase(),
    );
    setSourceId((notDest ?? transferable[0])?.id ?? '');
  }, [transferable, fixedWallet, sourceId, prefillTo]);
  const wallet = fixedWallet ?? transferable.find((w) => w.id === sourceId) ?? null;
  const rail = wallet ? transferRailOf(wallet) : null;

  const [phase, setPhase] = useState<Phase>('form');

  // Is the EVM source actually a Smart Account (PA)? Then NO EVM key exists
  // for it — the founder hit the "switch to an account that cannot exist"
  // wall live (2026-07-30). A PA source signs in Xaman (its OWNING XRPL) via
  // the 0xFE dispatch: redeem routes to /pa-unmint, the rest gates honestly.
  const xrplCandidates = useMemo(
    () => wallets.map((w) => w.address).filter((a) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)),
    [wallets],
  );
  const { owningXrpl: sourceOwningXrpl } = useOwningXrpl(
    rail === 'evm' && wallet ? wallet.address : null,
    xrplCandidates,
  );
  const sourceIsPa = !!sourceOwningXrpl;
  // Carrier auto (founder 2026-08-17): live fees + margin from the backend
  // — no user knob; can never block the operation (lib/flare/carrier).
  const xrpForMint = useCarrierXrp();
  // 0xFE nonce seat of an unsigned prepared order — released when abandoned
  // (re-prepare or close) so the user is never walled by NONCE_SEAT_TAKEN.
  const [paMemoHex, setPaMemoHex] = useState<string | undefined>(undefined);
  // El candado del incidente 2026-08-21 (gemelo con nonce 19): en cuanto este
  // memo SE ENTREGA a Xaman, liberar su asiento queda prohibido AQUÍ también —
  // un error de red después del broadcast deja `paMemoHex` puesto y el estado
  // local creyendo que era un borrador, y liberar «ese borrador» es lo que
  // permitió firmar el duplicado condenado. El backend ya lo rechaza
  // (signedAt); este ref cierra la ventana en la que el aviso aún viaja.
  const paHandedToXaman = useRef(false);
  const close = () => {
    if (
      paMemoHex &&
      !paHandedToXaman.current &&
      phase !== 'done' &&
      phase !== 'signing' &&
      phase !== 'unconfirmed'
    ) {
      releaseHandoffSeat(paMemoHex);
    }
    onClose();
  };
  const [errorMsg, setErrorMsg] = useState('');
  /** El cuerpo de un rechazo de asiento de nonce: lo pinta el aviso compartido. */
  const [seatRefusal, setSeatRefusal] = useState<unknown>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Destination — any of my other wallets on EITHER rail (a cross-rail pick
  // rides the FAssets bridge: mint XRP→FXRP or redeem FXRP→XRP), a saved
  // address-book entry, or a pasted address whose format decides the rail.
  // Unmint door: XRPL destinations first — the XRP lands on the ledger, so
  // the user's own Xaman account is the default pick, not a Flare address.
  const myDestinations = useMemo(() => {
    const list = wallets.filter((w) => w.id !== wallet?.id && transferRailOf(w) !== null);
    if (!unmint) return list;
    return [...list].sort((a, b) => {
      const ax = transferRailOf(a) === 'xrpl' ? 0 : 1;
      const bx = transferRailOf(b) === 'xrpl' ? 0 : 1;
      return ax - bx;
    });
  }, [wallets, wallet?.id, unmint]);
  // A prefilled destination that IS one of my wallets lands on the "mine" tab.
  const prefillMine = prefillTo
    ? wallets.find((w) => w.address.toLowerCase() === prefillTo.toLowerCase())
    : undefined;
  const [destMode, setDestMode] = useState<'mine' | 'saved' | 'external'>(() =>
    prefillMine ? 'mine' : prefillTo ? 'external' : myDestinations.length > 0 ? 'mine' : 'external',
  );
  const [destWalletId, setDestWalletId] = useState(prefillMine?.id ?? myDestinations[0]?.id ?? '');
  const [destExternal, setDestExternal] = useState(prefillMine ? '' : prefillTo);
  const [amount, setAmount] = useState(initial?.amount ?? '');
  // La nota que viaja con un pago XRP nativo. El tag es el número de cuenta
  // DENTRO del destino (lo que pide un exchange); el memo es texto libre que
  // queda público en el ledger. Solo el rail XRPL sabe llevarlos.
  const [destTag, setDestTag] = useState('');
  const [memo, setMemo] = useState('');

  // Switching the source can leave the picked destination pointing at the
  // source itself — snap it back to a valid option.
  useEffect(() => {
    if (destMode === 'mine' && destWalletId && !myDestinations.some((w) => w.id === destWalletId)) {
      setDestWalletId(myDestinations[0]?.id ?? '');
    }
  }, [myDestinations, destMode, destWalletId]);

  // What an EVM source sends: native FLR or the FXRP ERC-20. The unmint door
  // locks FXRP.
  const [evmAsset, setEvmAsset] = useState<'FLR' | 'FXRP'>(initial?.asset ?? (unmint ? 'FXRP' : 'FLR'));

  // What an XRPL (Xaman) source sends: XRP — o el FXRP que su Smart Account ya
  // tiene minteado (fundador 2026-08-21: el mismo par XRP/FXRP de Earn, aquí).
  // XRPL no puede sostener FXRP; su FSA sí, y quien firma sigue siendo Xaman
  // (dispatch 0xFE): a un destino Flare va por pa-transfer, a un destino XRPL
  // por pa-unmint (redención a XRP nativo).
  // FLR se suma al par (fundador 2026-08-28): la FSA puede tener saldo nativo
  // — de FTSO, de un envío externo, de un unwrap — y hasta hoy no había puerta
  // para sacarlo. Sale por el MISMO dispatch 0xFE que el FXRP.
  const [xrplAsset, setXrplAsset] = useState<'XRP' | 'FXRP' | 'FLR'>('XRP');
  useEffect(() => setXrplAsset('XRP'), [wallet?.id]);
  // El fold cubre TODAS las Xaman enlazadas, no solo la fuente: hace falta
  // para nombrar cada Smart Account con su dueña al lado (fundador 2026-08-22:
  // con varias FSA «no se sabe cuál es cuál») en los selectores de origen y
  // destino, además de para el saldo FXRP de la fuente.
  const sendFold = usePaFold(xrplCandidates);
  const sourceFsa =
    wallet && rail === 'xrpl' ? sendFold.paByOwner.get(foldKey(wallet.address)) : undefined;
  const labelOf = (w: BackendWallet): string => {
    if (!isSmartAccountType(w.walletType)) return walletLabel(w, t);
    const ownerAddr = sendFold.ownerByPa.get(foldKey(w.address));
    const owner = ownerAddr ? (wallets.find((x) => x.address === ownerAddr) ?? { address: ownerAddr }) : null;
    return smartAccountDisplayName(w, owner, t);
  };
  // Saldos FXRP y FLR NATIVO de la Smart Account de la fuente — mismo endpoint
  // público que cualquier dirección de Flare (`kind=fxrp` / `kind=evm`).
  // «No pude leer» NO es cero (14-sep): antes un fallo era null → 0 → el
  // selector «Pay with» desaparecía y un efecto forzaba XRP sin decir nada.
  const [fsaFxrpRead, setFsaFxrpRead] = useState<BalanceRead>({ status: 'idle' });
  const [fsaFlrRead, setFsaFlrRead] = useState<BalanceRead>({ status: 'idle' });
  const [fsaReadNonce, setFsaReadNonce] = useState(0);
  useEffect(() => {
    if (!sourceFsa) {
      setFsaFxrpRead({ status: 'idle' });
      setFsaFlrRead({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const read = (kind: 'fxrp' | 'evm', set: (r: BalanceRead) => void) => {
      set({ status: 'loading' });
      fetch(`${API_BASE}/network/balance?kind=${kind}&address=${encodeURIComponent(sourceFsa)}`)
        .then(async (r) => parseNetworkBalance(r.ok, await r.json().catch(() => null)))
        .then((res) => {
          if (!cancelled) set(res);
        })
        .catch(() => {
          if (!cancelled) set({ status: 'failed' });
        });
    };
    read('fxrp', setFsaFxrpRead);
    read('evm', setFsaFlrRead);
    return () => {
      cancelled = true;
    };
  }, [sourceFsa, fsaReadNonce]);
  const fsaFxrpNum = balanceValue(fsaFxrpRead);
  const fsaFlrNum = balanceValue(fsaFlrRead);
  const fsaReadFailed = fsaFxrpRead.status === 'failed' || fsaFlrRead.status === 'failed';
  const xrplPaysFxrp = rail === 'xrpl' && xrplAsset === 'FXRP' && fsaFxrpNum > 0;
  // EL ACTIVO QUE ELIGES ES EL QUE SALE, también cuando el saldo se evapora bajo
  // los pies: si el refetch deja a cero el activo seleccionado, `paPaysFlr` /
  // `xrplPaysFxrp` caen y el modo se deslizaría solo hasta 'mint' — es decir,
  // el usuario firmaría un pago de XRP habiendo elegido FLR. Con un CERO
  // PROBADO se vuelve a XRP explícitamente; con una lectura fallida o en curso
  // no se toca la elección — `validate()` bloquea el prepare (assetVerdict).
  const assetVerdict = assetChoiceVerdict(xrplAsset, fsaFxrpRead, fsaFlrRead);
  useEffect(() => {
    if (assetVerdict.forceXrp) setXrplAsset('XRP');
  }, [assetVerdict.forceXrp]);

  // Saved addresses — the user's address book, offered next to their wallets.
  const [savedEntries, setSavedEntries] = useState<AddressBookEntry[]>([]);
  const [savedEntryId, setSavedEntryId] = useState('');
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    addressBookService
      .list()
      .then(({ entries }) => {
        if (cancelled) return;
        const usable = entries.filter((e) => e.address.toLowerCase() !== wallet.address.toLowerCase());
        setSavedEntries(usable);
        setSavedEntryId((prev) => prev || (usable[0]?.id ?? ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address]);

  const [balance, setBalance] = useState<NativeBalance | null>(null);
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setBalance(null);
    fetchNativeBalance(wallet).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address]);

  // The wallet partner that will SIGN must hold this exact address. A Smart
  // Account source has NO EVM key: its signer is the OWNING XRPL in Xaman.
  const signerAddress = sourceIsPa || rail === 'xrpl' ? xrpl.address : evm.address;
  const signerConnected = sourceIsPa || rail === 'xrpl' ? xrpl.isConnected : evm.isConnected;
  const signerMatches = sourceIsPa
    ? !!xrpl.address && xrpl.address === sourceOwningXrpl
    : !!wallet && !!signerAddress && signerAddress.toLowerCase() === wallet.address.toLowerCase();

  async function connectSigner() {
    setErrorMsg('');
    setConnecting(true);
    try {
      if (sourceIsPa || rail === 'xrpl') {
        await connect.connectXrpl();
      } else {
        // This button only shows when the connected account is NOT the sender —
        // drop that session first so the picker (extension + WalletConnect QR)
        // appears instead of the already-connected account view.
        if (evm.isConnected) await disconnectAsync().catch(() => {});
        evm.openConnect();
      }
    } catch (e) {
      setErrorMsg((e as Error).message ?? String(e));
    } finally {
      setConnecting(false);
    }
  }

  const destAddress =
    destMode === 'mine'
      ? (myDestinations.find((w) => w.id === destWalletId)?.address ?? '')
      : destMode === 'saved'
        ? (savedEntries.find((e) => e.id === savedEntryId)?.address ?? '')
        : destExternal.trim();

  // The destination FORMAT picks the rail; crossing rails rides the FAssets
  // bridge: XRPL→Flare = direct mint (XRP in, FXRP out), Flare→XRPL = redeem
  // (FXRP burned, agent pays XRP). Same-rail stays a plain transfer — FLR
  // native or the FXRP ERC-20, whichever asset is selected. FLR itself can
  // never cross to XRPL (invariant: only XRP rides the FAssets bridge).
  const destRail: TransferRail | null = XRPL_CLASSIC_RE.test(destAddress)
    ? 'xrpl'
    : EVM_ADDRESS_RE.test(destAddress)
      ? 'evm'
      : null;
  // EL ACTIVO QUE ELIGES ES EL QUE LLEGA (fundador 2026-08-22, tras enviar
  // FXRP Xaman→Xaman y recibir un unmint que no pidió): el Send JAMÁS cambia
  // el activo. FXRP hacia una r-address entrega FXRP en la cuenta Astryum
  // (lado Flare) de ese XRPL — cada Xaman y su Smart Account son UNA cuenta,
  // así que el destino natural del FXRP «de una Xaman» es su PA. La redención
  // a XRP nativo (fee + agente + espera) vive SOLO en la puerta Unmint (`unmint`
  // prop). El mint XRP→FXRP se queda: es 1:1, cambia de sitio, no de activo, y
  // va rotulado. `deliversToDestPa` marca que el `to` real se resuelve al PA
  // del destinatario en el prepare.
  /** El FLR NATIVO de la cuenta Astryum saliendo hacia Flare. Dos entradas a la
   *  misma puerta: la fila PA elegida como fuente (firma su Xaman dueña) y la
   *  propia Xaman eligiendo «pagar con el FLR de mi cuenta». La puerta Unmint
   *  no participa: allí el activo está clavado a FXRP por definición. */
  const paPaysFlr =
    !unmint &&
    ((rail === 'xrpl' && xrplAsset === 'FLR' && fsaFlrNum > 0) ||
      (sourceIsPa && evmAsset === 'FLR'));
  /** El FLR disponible de esa cuenta Astryum, venga por la puerta que venga:
   *  con la fila PA como fuente su saldo nativo YA está leído en `balance`;
   *  con la Xaman dueña como fuente hay que mirar el de su FSA. Sin esto, la
   *  puerta de la fila PA enseñaba «0,0000 FLR» y un MAX de cero sobre una
   *  cuenta con fondos. */
  const paFlrNum = sourceIsPa ? parseFloat(balance?.balance ?? '') || 0 : fsaFlrNum;
  const fxrpToRAddress =
    destRail === 'xrpl' &&
    !paPaysFlr &&
    (xrplPaysFxrp || sourceIsPa || (rail === 'evm' && evmAsset === 'FXRP'));
  const mode: 'transfer' | 'mint' | 'redeem' | 'flr-cross' | 'pa-transfer' | 'pa-unmint' | null =
    !rail || !destRail
      ? null
      : unmint
        ? sourceIsPa || xrplPaysFxrp
          ? 'pa-unmint'
          : 'redeem'
        : paPaysFlr
          ? destRail === 'evm'
            ? 'pa-transfer' // FLR nativo de la cuenta Astryum → dirección de Flare
            : 'flr-cross' // el FLR no cruza a XRPL: solo el XRP monta el puente FAssets
          : xrplPaysFxrp || sourceIsPa
          ? 'pa-transfer' // a EVM directo; a r-address, al PA del destinatario
          : fxrpToRAddress
            ? 'transfer' // ERC-20 en Flare al PA del destinatario (firma EVM)
            : destRail === rail
              ? 'transfer'
              : rail === 'xrpl'
                ? 'mint'
                : 'flr-cross';
  const deliversToDestPa = !unmint && fxrpToRAddress;
  /** Un pago XRP nativo de r-address a r-address es el ÚNICO envío de esta
   *  puerta con sitio para una nota: ni EVM ni el 0xFE tienen dónde meterla
   *  (el memo del 0xFE ya es la orden). */
  const canCarryNote = mode === 'transfer' && rail === 'xrpl' && destRail === 'xrpl';
  /** En una redención el XRP lo paga el AGENTE de FAssets: su pago lleva la
   *  referencia del protocolo y no admite texto libre. Lo único que cabe meter
   *  dentro es el TAG del destino (`redeemWithTag`) — que es justo lo que pide
   *  un exchange para acreditar el ingreso a su cliente. */
  const canCarryRedeemTag = mode === 'pa-unmint' || mode === 'redeem';
  // El límite del servidor son BYTES, no letras: un acento ocupa dos.
  const memoBytes = new TextEncoder().encode(memo.trim()).length;
  const memoTooLong = memoBytes > MEMO_MAX_BYTES;
  const tagTooBig = destTag.trim() !== '' && Number(destTag.trim()) > XRPL_MAX_DESTINATION_TAG;
  const noteBlocksPrepare = (canCarryNote && memoTooLong) || ((canCarryNote || canCarryRedeemTag) && tagTooBig);
  /** Quién es la Xaman que firma el dispatch de la PA: la dueña de la fila PA,
   *  o la propia fuente cuando la fuente ES la Xaman pagando el FXRP o el FLR
   *  de su cuenta. */
  const paSigner = sourceIsPa ? sourceOwningXrpl : wallet?.address ?? null;

  /**
   * ¿La cuenta que firma en XRPL está REFORZADA? (fundador, 22-ago-2026:
   * «solo me aparece un qr, me deben aparecer los 3 del multisig»).
   *
   * EL HUECO QUE CIERRA. La cuenta personal reforzada se quedó en Wallets —
   * que es su promesa — pero su camino de FIRMA no se tocó: seguía siendo el
   * de siempre, un payload de Xaman con `multi_sign: false`. Un QR, una firma.
   * Sobre una cuenta gobernada por quórum eso no vale: la firma no cuenta para
   * el quórum, y con la llave maestra apagada la red la rechaza sin más. Es la
   * misma trampa que LegacyPanel evita desde julio con `canSignDirect` («una
   * cuenta con consejo NUNCA se ofrece single-sig») — y esta pantalla no la
   * tenía porque hasta ahora ninguna wallet personal podía tener quórum.
   *
   * Lo dice el LEDGER (`hardenedQuorum` sólo existe tras leer una SignerList),
   * nunca la marca del dueño: creer una marca aquí sería mandar a la ceremonia
   * a una cuenta que todavía firma sola.
   */
  const { authorities: allAuthorities } = useAuthorities();
  const quorumSigner = useMemo(() => {
    if (!paSigner) return null;
    return reinforcedPersonalKeys(allAuthorities).has(addressKey(paSigner)) ? paSigner : null;
  }, [allAuthorities, paSigner]);

  // FXRP balance of an EVM source — what a transfer or redeem can actually move.
  const [fxrpBalance, setFxrpBalance] = useState<string | null>(null);
  useEffect(() => {
    if (rail !== 'evm' || !wallet) return;
    let cancelled = false;
    setFxrpBalance(null);
    fetch(`${API_BASE}/network/balance?kind=fxrp&address=${encodeURIComponent(wallet.address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { ok?: boolean; balance?: string } | null) => {
        if (!cancelled && b?.ok && b.balance != null) setFxrpBalance(b.balance);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, rail]);

  function validate(): string | null {
    if (!wallet || !rail) return t('Transfers in this beta support Flare (FLR) and XRPL (XRP) wallets only.');
    // The asset picked on a Xaman source whose Smart Account balance is not
    // known: never prepared as something else (an XRP payment) in silence.
    if (rail === 'xrpl' && !unmint && assetVerdict.blocked) {
      return assetVerdict.blocked === 'failed'
        ? t('Could not read your Smart Account balance, so this cannot be prepared with the asset you picked — nothing was switched to XRP. Retry the read, or pick XRP.')
        : t('Still reading your Smart Account balance — try again in a moment.');
    }
    if (!destAddress) return t('Choose a destination');
    if (!destRail) {
      // Both formats are valid now — the other rail just rides the bridge.
      return t('Enter a valid destination address (r… or 0x…)');
    }
    if (mode === 'flr-cross') {
      return t('FLR cannot be sent to an XRPL address. Switch the asset to FXRP to bridge it as XRP (unmint), or pick a Flare destination.');
    }
    // El unmint a tu PROPIA dirección XRPL es el caso natural (el FXRP vuelve
    // como XRP a la misma cuenta que gobierna la PA) — jamás se bloquea.
    if (mode !== 'pa-unmint' && destAddress.toLowerCase() === wallet.address.toLowerCase()) {
      return t('Destination is this same wallet');
    }
    const n = parseFloat(amount);
    if (!(n > 0)) return t('Amount must be greater than 0');
    return null;
  }

  async function prepare() {
    const invalid = validate();
    if (invalid || !wallet) {
      setErrorMsg(invalid ?? t('Choose a destination'));
      setPhase('error');
      return;
    }
    setErrorMsg('');
    setSeatRefusal(null);
    setPhase('preparing');
    try {
      // El FXRP de una Smart Account no tiene clave EVM: sus dos salidas son
      // dispatches 0xFE que firma la Xaman dueña — pa-transfer hacia Flare,
      // pa-unmint (redención a XRP nativo) hacia XRPL. Cubre la fila PA como
      // fuente Y la fuente Xaman pagando el FXRP de su cuenta.
      // FXRP hacia una r-address: el `to` real es la cuenta Astryum (PA) del
      // destinatario — mismo dueño, lado Flare. Resuelta determinista del
      // MasterAccountController; jamás adivinada.
      let destEvmForFxrp = destAddress;
      if (deliversToDestPa) {
        const destPa = await resolvePersonalAccountOf(destAddress);
        if (!destPa) {
          throw new Error(t('Could not resolve the Astryum account of that XRPL address — try again.'));
        }
        destEvmForFxrp = destPa;
      }

      if (mode === 'pa-transfer' || mode === 'pa-unmint') {
        if (!paSigner) {
          throw new Error(t('Open Xaman with this exact account to sign this entry.'));
        }
        if (mode === 'pa-transfer' && destEvmForFxrp.toLowerCase() === (sourceFsa ?? wallet.address).toLowerCase()) {
          throw new Error(
            paPaysFlr
              ? t('That FLR already lives in that account — nothing to move.')
              : t('That FXRP already lives in that account — nothing to move.'),
          );
        }
        // abandoned draft → free the seat. NUNCA tras entregarlo a Xaman: si
        // aquel sign erró después del broadcast, esto liberaría una orden viva.
        if (paMemoHex && !paHandedToXaman.current) releaseHandoffSeat(paMemoHex);
        const amountFxrpBase = String(Math.round((parseFloat(amount) || 0) * 1e6));
        const endpoint =
          mode === 'pa-unmint'
            ? `${API_BASE}/flare-demo/pa-unmint/prepare`
            : `${API_BASE}/flare-demo/pa-transfer/prepare`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify(
            mode === 'pa-unmint'
              ? {
                  xrplAddress: paSigner,
                  amountFxrpBase,
                  xrplDest: destAddress,
                  // El tag entra en el pago del agente vía redeemWithTag.
                  ...(destTag.trim() ? { destinationTag: destTag.trim() } : {}),
                  amountXrpForMint: xrpForMint,
                  region: getUserRegion(),
                }
              : {
                  xrplAddress: paSigner,
                  // A una r-address, el destino real es SU cuenta Astryum (PA).
                  evmWallet: destEvmForFxrp,
                  // El activo que eliges es el que sale: FLR nativo viaja en
                  // wei, el FXRP en sus 6 decimales de siempre.
                  ...(paPaysFlr
                    ? { asset: 'FLR', amountFlrWei: toWei(amount) }
                    : { amountFxrpBase }),
                  amountXrpForMint: xrpForMint,
                  region: getUserRegion(),
                },
          ),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // EL ASIENTO DE NONCE, EN INGLÉS (it. 17, R5 5.4): el backend manda
          // el código crudo y un párrafo en castellano con hashes; ninguno de
          // los dos llega a la pantalla, y el borrador que esta misma pantalla
          // dejó puede liberarse desde el aviso.
          const seat = seatRefusalSentence(body, t);
          if (seat) {
            setSeatRefusal(body);
            throw new Error(seat);
          }
          // it. 22 (Q3 3.7): el `detail` en castellano del servidor y su slug
          // crudo tampoco se pintan por esta puerta — el titular del lector
          // compartido lo dice en una frase, y el `detail` solo acompaña si
          // está en el idioma de la pantalla.
          throw new Error(refusalText(body, res.status, t));
        }
        setPaMemoHex(body.memoHex as string | undefined);
        paHandedToXaman.current = false; // memo nuevo: aún es un borrador liberable
        // it. 19 (R5 R7) — LA PALABRA DE LA ENTREGA, REGISTRADA. This prepare
        // talks to the backend with raw `fetch`, so nothing ever fed the live
        // banner the server's word about the executor that carries this 0xFE: it
        // fell back to the prudent sentence over a legitimate exit, every time.
        // Read defensively (`executorEnabled` may not travel yet): no word keeps
        // the banner neutral, only `true` lets it promise a delivery.
        noteFlareInstructionDelivery(
          body.xrplPayment,
          (body as { serverDelivery?: { executorEnabled?: unknown } }).serverDelivery,
        );
        const d = (body.disclosure ?? {}) as Record<string, unknown>;
        // Invariant #6 — the fee figures are the SERVER's (mintFeeDisclosure(net)
        // in flareDemo.ts), never a client guess; a figure it did not return is
        // said to be unavailable, never 0 (lib/wallet/paDispatchDisclosure).
        const fees = readPaDispatchFees(d, body as Record<string, unknown>);
        const fallbackCarrier = Number.isFinite(xrpForMint) ? xrpForMint : null;
        // pa-unmint: the FXRP this dispatch mints only «returns» when free FXRP
        // already covers the redemption (backend ridesOwnMint); otherwise the
        // redemption burns it and the row says so.
        const unmintReturn =
          mode === 'pa-unmint'
            ? paUnmintReturn({
                mintedFxrp: fees.returnsFxrp,
                redeemedFxrp: finiteOrNull(d.fxrpRedeemed),
                ridesOwnMint: readRidesOwnMint(body as Record<string, unknown>),
                freeFxrp: finiteOrNull(d.freeFxrp) ?? finiteOrNull((body as Record<string, unknown>).freeFxrp),
              })
            : null;
        const nf = unmintReturn
          ? paUnmintNetworkFee(fees, fallbackCarrier, unmintReturn)
          : paDispatchNetworkFee(fees, fallbackCarrier);
        const unmintReturnRow = unmintReturn ? paUnmintReturnRow(unmintReturn, fees.returnsFxrp) : null;
        const feeRow = astryumFeeRow(fees);
        const rf = redemptionFeeRow(fees);
        const feeFields = {
          astryumFee: feeRow.kind === 'stated' ? feeRow.amount : null,
          astryumFeeExecutorListed: feeRow.kind === 'executor-listed',
          networkFee: fillFeeText(t(nf.text), nf.params),
          mintingFeeXrp: fees.mintingFeeXrp ?? undefined,
          executorFeeXrp: fees.executorFeeXrp ?? undefined,
          feeFiguresUnavailable: !fees.known,
          carrierReturnsFxrp: fees.returnsFxrp ?? undefined,
          carrierReturnText: unmintReturnRow ? fillFeeText(t(unmintReturnRow.text), unmintReturnRow.params) : undefined,
        };
        // Adapt to this modal's disclosure shape so the review shows real rows.
        setPrepared({
          rail: 'xrpl',
          xrplPayment: body.xrplPayment,
          disclosure:
            mode === 'pa-unmint'
              ? {
                  action: 'bridge-redeem-fxrp',
                  asset: 'XRP (FXRP)',
                  network: 'Flare → XRPL (FAssets redemption)',
                  amount: Number(d.fxrpRedeemed ?? amount),
                  from: String(body.personalAccount ?? wallet.address),
                  to: String(d.xrplDestination ?? destAddress),
                  // El tag que el servidor metió en redeemWithTag — se revisa
                  // antes de firmar, como el destino.
                  ...(typeof d.destinationTag === 'number' ? { destinationTag: d.destinationTag } : {}),
                  ...feeFields,
                  redemptionFeeText: fillFeeText(t(rf.text), rf.params),
                  disclosedToUser: true,
                  astryumSigns: false,
                  note: String(d.note ?? ''),
                  minimumRedeemXrp: (d.redeemMinimumXrp as number | undefined) ?? undefined,
                }
              : {
                  action: paPaysFlr ? 'pa-transfer-flr' : 'pa-transfer-fxrp',
                  asset: paPaysFlr ? 'FLR' : 'FXRP',
                  network: 'Flare (from your Astryum account)',
                  amount: Number(d.amount ?? amount),
                  from: String(body.personalAccount ?? wallet.address),
                  // Con destino r-address se enseña la r-address elegida — el
                  // PA es SU cuenta; la divulgación habla del dueño, no del rail.
                  to: deliversToDestPa ? `${destAddress} (su cuenta Astryum)` : destEvmForFxrp,
                  ...feeFields,
                  disclosedToUser: true,
                  astryumSigns: false,
                  note: String(d.note ?? ''),
                },
        } as PreparedXrplTransfer);
        setPhase('review');
        return;
      }
      // Same-rail → plain transfer; cross-rail → the FAssets bridge endpoint.
      const endpoint =
        mode === 'mint'
          ? `${API_BASE}/wallet-transfer/bridge/xrpl-to-flare/prepare`
          : mode === 'redeem'
            ? `${API_BASE}/wallet-transfer/bridge/flare-to-xrpl/prepare`
            : `${API_BASE}/wallet-transfer/prepare`;
      const payload =
        mode === 'mint'
          ? { xrplAddress: wallet.address, evmDestination: destAddress, amountXrp: amount.trim() }
          : mode === 'redeem'
            ? {
                evmWallet: wallet.address,
                xrplDestination: destAddress,
                amountXrp: amount.trim(),
                ...(destTag.trim() ? { destinationTag: destTag.trim() } : {}),
              }
            : {
                rail,
                from: wallet.address,
                // FXRP a una r-address = ERC-20 en Flare al PA del destinatario.
                to: deliversToDestPa ? destEvmForFxrp : destAddress,
                amount: amount.trim(),
                // The EVM rail carries the selected asset (FLR native | FXRP ERC-20).
                ...(rail === 'evm' ? { asset: evmAsset } : {}),
                // La nota SOLO donde cabe: el servidor rechaza un tag o un memo
                // en el rail EVM en vez de tragárselo.
                ...(canCarryNote && destTag.trim() ? { destinationTag: destTag.trim() } : {}),
                ...(canCarryNote && memo.trim() ? { memo: memo.trim() } : {}),
              };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const seat = seatRefusalSentence(body, t);
        if (seat) {
          setSeatRefusal(body);
          throw new Error(seat);
        }
        throw new Error(refusalText(body, res.status, t));
      }
      // it. 19 (R5 R7): the same word, on the other prepare of this file.
      noteFlareInstructionDelivery(
        (body as { xrplPayment?: unknown }).xrplPayment,
        (body as { serverDelivery?: { executorEnabled?: unknown } }).serverDelivery,
      );
      setPrepared(body as PreparedTransfer);
      setPhase('review');
    } catch (e) {
      setErrorMsg((e as Error).message ?? String(e));
      setPhase('error');
    }
  }

  async function sign() {
    if (!prepared) return;
    setErrorMsg('');
    setUnconfirmed(null);
    setPhase('signing');
    // True from the moment the payload goes to Xaman / the EVM wallet: after
    // that, an error that does not PROVE nothing left is 'unconfirmed'.
    let handedToPartner = false;
    try {
      if (prepared.rail === 'xrpl') {
        // Una cuenta con quórum SÓLO puede multifirmar. Ofrecerle la firma
        // única es el footgun de `canSignDirect`: la red la rechaza y, si la
        // maestra sigue viva, valida una tx que NO cuenta para el quórum.
        // La ceremonia se pinta en la revisión; aquí sólo se cierra la puerta.
        if (quorumSigner) throw new Error(t('This account signs by quorum — gather the signatures below.'));
        if (!xrpl.isConnected && !pinnedXrplSigner(prepared.xrplPayment)) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        // A partir de aquí el memo puede estar comprometido aunque esta llamada
        // ERRE: Xaman emite en cuanto el usuario firma en el móvil. El asiento
        // deja de ser liberable YA, no al resolver (incidente 2026-08-21).
        if (paMemoHex) paHandedToXaman.current = true;
        handedToPartner = true;
        const { txHash: hash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // El backend aprende «firmado»: ese asiento queda intocable (ni TTL,
        // ni release, ni supersede) hasta ejecutar o aparcar.
        if (paMemoHex) notifyHandoffSigned(paMemoHex, hash);
        // Signed ≠ validated: the machine follows the Payment to its ledger
        // validation — the last surface that painted green on submit alone.
        // A PA dispatch (0xFE) is done only when the EXECUTOR runs it on
        // Flare, so it tracks the mint rail, not mere ledger validation.
        settlement.track(startPending(paMemoHex ? 'xrpl-mint' : 'xrpl-tx', hash));
        if (paMemoHex) setPaMemoHex(undefined); // signed — the seat is spent, never released
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        handedToPartner = true;
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle);
      }
      setPhase('done');
    } catch (e) {
      // Both rails (plain XRPL payment, 0xFE dispatch, EVM). The views of
      // signFailureAction map onto this modal's phases here, in plain sight:
      //   unconfirmed → 'unconfirmed' (amber, no form, no sign button)
      //   form        → 'error' + prepared dropped (the chain refused it)
      //   review      → 'error' (provably nothing left — the form, as before)
      //
      // Antes que todo eso: una firma que llegó TARDE (it. 17, R5 5.2). Un
      // tefMAX_LEDGER / tefPAST_SEQ es un veredicto leído — ese payload no
      // valida nunca — así que se dice «prepáralo otra vez» y su asiento se
      // puede liberar, en vez de «no pude confirmarlo, recarga».
      const stale = describeStaleSignature(e, t);
      if (stale) {
        setUnconfirmed(null);
        setErrorMsg(stale.text);
        setPrepared(null);
        // El payload murió sin entrar en ningún ledger: su asiento no lo ocupa
        // nada, y quien lo preparó puede liberarlo desde aquí.
        paHandedToXaman.current = false;
        setPhase('error');
        return;
      }
      applySignFailure(e, handedToPartner, t, {
        setError: setErrorMsg,
        setUnconfirmed,
        setPhase: (view) => setPhase(view === 'unconfirmed' ? 'unconfirmed' : 'error'),
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  // What the user is sending: an XRPL source pays XRP or its Smart Account's
  // FXRP; an EVM source sends the selected asset (FLR native | FXRP ERC-20)
  // same-rail, or burns FXRP (denominated in XRP) when redeeming to XRPL.
  const asset = !rail
    ? ''
    : paPaysFlr
      ? 'FLR'
      : rail === 'xrpl'
        ? xrplPaysFxrp
          ? mode === 'pa-unmint'
            ? 'XRP (FXRP)'
            : 'FXRP'
          : 'XRP'
        : mode === 'redeem' || mode === 'pa-unmint'
          ? 'XRP (FXRP)'
          : mode === 'pa-transfer'
            ? 'FXRP'
            : evmAsset;

  // MAX per asset. XRPL balance is already spendable (reserve excluded) — keep
  // a fee cushion (~8× the ~0.000012 XRP network fee). FLR pays its own gas, so
  // leave headroom (a 21k-gas transfer at 25 gwei is ~0.0005 FLR). FXRP moves
  // whole: its gas is paid in FLR, and on a redeem the FAssets fee comes out on
  // the XRPL side. Floored to 6 decimals — the resolution every rail accepts.
  const XRPL_FEE_HEADROOM = 0.0001;
  const FLR_GAS_HEADROOM = 0.01;
  /** The XRPL wallet is the STEERING WHEEL of the user's Astryum account:
   *  every 0xFE order needs ~1 XRP of carrier payment. Draining it to zero
   *  strands the Smart Account until the user refunds from outside (founder
   *  hit this live, 2026-07-30) — MAX keeps this back, and the warning below
   *  fires whenever a typed amount would leave less. */
  const XRPL_STEERING_RESERVE = 2;
  const maxSendable: string | null = (() => {
    if (!rail) return null;
    const floor6 = (n: number) => Math.floor(Math.max(0, n) * 1e6) / 1e6;
    let max: number;
    if (paPaysFlr) {
      // El gas del dispatch lo paga el executor y el peaje viaja en el carrier
      // XRP, así que este saldo no reserva nada para sí mismo: sale entero.
      max = floor6(paFlrNum);
    } else if (xrplPaysFxrp) {
      // El FXRP de la Smart Account se mueve entero: el peaje va aparte en el
      // carrier XRP, no sale de este saldo.
      max = floor6(fsaFxrpNum);
    } else if (rail === 'evm' && evmAsset === 'FXRP') {
      if (fxrpBalance == null) return null;
      max = floor6(parseFloat(fxrpBalance) || 0);
    } else {
      if (!balance) return null;
      const spendable = parseFloat(balance.balance) || 0;
      max = floor6(
        spendable - (rail === 'xrpl' ? XRPL_FEE_HEADROOM + XRPL_STEERING_RESERVE : FLR_GAS_HEADROOM),
      );
    }
    return max > 0 ? max.toFixed(6).replace(/\.?0+$/, '') : null;
  })();
  /** True when the typed amount would leave the XRPL account below the
   *  steering reserve — the money still SENDS (it is theirs), but never in
   *  silence. */
  const drainsXrplSteering =
    rail === 'xrpl' &&
    // Pagando el FXRP (o el FLR) de la PA solo sale el carrier (~1 XRP) de la
    // wallet XRPL: la cantidad tecleada no es XRP y no drena el volante.
    !xrplPaysFxrp &&
    !paPaysFlr &&
    balance != null &&
    (parseFloat(amount) || 0) > 0 &&
    (parseFloat(balance.balance) || 0) - (parseFloat(amount) || 0) < XRPL_STEERING_RESERVE;

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl my-auto max-h-[min(90dvh,44rem)] flex flex-col shadow-2xl overflow-hidden">
        <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              {unmint ? (
                <>
                  <Undo2 className="w-4 h-4 text-volt" />
                  {t('Unmint to XRP')}
                </>
              ) : (
                <>
                  <ArrowUpRight className="w-4 h-4 text-volt" />
                  {t('Send')} {asset}
                </>
              )}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5">
              {unmint
                ? t('Burns FXRP on Flare — the FAssets agent pays you native XRP on the XRP Ledger.')
                : wallet
                  ? `${t('From')} ${labelOf(wallet)}`
                  : t('Choose the sending wallet')}
            </p>
          </div>
          <button onClick={close} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-4">
          {/* Unsupported rail / nothing to send from — explain instead of pretending */}
          {!rail && (
            <p className="text-xs text-ink/50 bg-ink/5 border border-ink/10 rounded-xl px-4 py-3">
              {t('Transfers in this beta support Flare (FLR) and XRPL (XRP) wallets only.')}{' '}
              {!fixedWallet && transferable.length === 0
                ? t('Link a Flare or XRPL wallet from Wallets to send from it.')
                : t('This wallet stays read-only here for now.')}
            </p>
          )}

          {rail && (phase === 'form' || phase === 'error' || phase === 'preparing') && (
            <>
              {/* Source — only when the caller didn't fix the sending wallet */}
              {!fixedWallet && transferable.length > 0 && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('From')}</label>
                  <WalletSelect
                    value={sourceId ?? ''}
                    onChange={setSourceId}
                    options={transferable.map((w) => {
                      const r = transferRailOf(w);
                      return {
                        key: String(w.id),
                        record: w,
                        name: labelOf(w),
                        detail: `${w.address.slice(0, 8)}…${w.address.slice(-6)}`,
                        badge: r ? (
                          <span className="shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/55">
                            {RAIL_NETWORK[r]}
                          </span>
                        ) : undefined,
                      };
                    })}
                  />
                </div>
              )}

              {/* The unmint door explains itself before asking anything. */}
              {unmint && (
                <p className="text-xs text-ink/55 bg-volt/[0.06] border border-volt/20 rounded-xl px-4 py-3 leading-relaxed">
                  {t('Pick your XRPL (Xaman) account as the destination — the XRP arrives there after the redemption. The protocol minimum per redemption is shown before you sign.')}
                </p>
              )}

              {/* Asset — una fuente Xaman paga XRP, o lo que su Smart Account ya
                  tiene: el FXRP minteado y (desde 2026-08-28) el FLR nativo. La
                  lista la decide el SALDO, no el catálogo: un activo que esa
                  cuenta no tiene no se ofrece, porque ofrecerlo sería prometer
                  una firma que reventaría en el preflight. */}
              {rail === 'xrpl' && !unmint && (fsaFxrpNum > 0 || fsaFlrNum > 0 || fsaReadFailed || xrplAsset !== 'XRP') && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Pay with')}</label>
                  <div className="flex gap-2">
                    {([
                      { key: 'XRP' as const, show: true, sub: t('Native · a Flare destination mints it into FXRP') },
                      {
                        key: 'FXRP' as const,
                        show: fsaFxrpNum > 0 || xrplAsset === 'FXRP',
                        sub: fsaFxrpRead.status === 'ok' ? `${t('Already minted in your account')} · ${fsaFxrpNum.toFixed(2)}` : t('Balance not read'),
                      },
                      {
                        key: 'FLR' as const,
                        show: fsaFlrNum > 0 || xrplAsset === 'FLR',
                        sub: fsaFlrRead.status === 'ok' ? `${t('Native on Flare, in your account')} · ${fsaFlrNum.toFixed(2)}` : t('Balance not read'),
                      },
                    ] as const)
                      .filter((o) => o.show)
                      .map((o) => (
                        <button
                          key={o.key}
                          onClick={() => setXrplAsset(o.key)}
                          aria-pressed={xrplAsset === o.key}
                          className={`flex-1 text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                            xrplAsset === o.key
                              ? 'border-volt/40 bg-volt/10 text-volt font-medium'
                              : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                          }`}
                        >
                          <span className="flex items-center justify-center gap-1.5">
                            <TokenLogo symbol={o.key} size="xs" /> {o.key}
                          </span>
                          <span className="block text-[10px] font-normal mt-0.5 opacity-70">{o.sub}</span>
                        </button>
                      ))}
                  </div>
                  {fsaReadFailed && (
                    <p className="text-[10px] text-amber-300/90 mt-1.5 leading-relaxed">
                      {t('Could not read your Smart Account balance (FXRP / FLR) — paying with it is not offered until it reads. This is not a zero balance.')}{' '}
                      <button onClick={() => setFsaReadNonce((n) => n + 1)} className="underline hover:text-ink">
                        {t('Retry')}
                      </button>
                    </p>
                  )}
                  {xrplPaysFxrp && (
                    <p className="text-[10px] text-ink/40 mt-1.5 leading-relaxed">
                      {t('You still sign in Xaman. FXRP arrives as FXRP — to an XRPL destination, into its own Astryum account. Native XRP on the ledger is the Unmint door, next to Movements.')}
                    </p>
                  )}
                  {paPaysFlr && (
                    <p className="text-[10px] text-ink/40 mt-1.5 leading-relaxed">
                      {t('You still sign in Xaman. The FLR leaves your account’s Flare side and only travels to a Flare address (0x…) — it cannot cross to the XRP Ledger.')}
                    </p>
                  )}
                </div>
              )}

              {/* Asset — an EVM source picks FLR (native) or FXRP (ERC-20).
                  The unmint door locks FXRP: converting is the whole point. */}
              {rail === 'evm' && !unmint && (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Asset')}</label>
                  <div className="flex gap-2">
                    {(['FLR', 'FXRP'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => setEvmAsset(a)}
                        className={`flex-1 text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                          evmAsset === a
                            ? 'border-volt/40 bg-volt/10 text-volt font-medium'
                            : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1.5">
                          <TokenLogo symbol={a} size="xs" />
                          {a}
                        </span>
                        <span className="block text-[10px] font-normal mt-0.5 opacity-70">
                          {a === 'FLR' ? t('Native · stays on Flare') : t('XRP on Flare · can unmint to XRPL')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Destination */}
              <div>
                <label className="text-xs text-ink/40 block mb-2">{t('Destination')}</label>
                {(myDestinations.length > 0 || savedEntries.length > 0) && (
                  <div className="flex gap-2 mb-2">
                    {myDestinations.length > 0 && (
                      <button
                        onClick={() => setDestMode('mine')}
                        className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                          destMode === 'mine'
                            ? 'border-volt/40 bg-volt/10 text-volt'
                            : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                        }`}
                      >
                        {t('My wallets')}
                      </button>
                    )}
                    {savedEntries.length > 0 && (
                      <button
                        onClick={() => setDestMode('saved')}
                        className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                          destMode === 'saved'
                            ? 'border-volt/40 bg-volt/10 text-volt'
                            : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                        }`}
                      >
                        {t('Saved addresses')}
                      </button>
                    )}
                    <button
                      onClick={() => setDestMode('external')}
                      className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                        destMode === 'external'
                          ? 'border-volt/40 bg-volt/10 text-volt'
                          : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                      }`}
                    >
                      {t('External address')}
                    </button>
                  </div>
                )}
                {destMode === 'mine' && myDestinations.length > 0 ? (
                  <WalletSelect
                    value={destWalletId ?? ''}
                    onChange={setDestWalletId}
                    options={myDestinations.map((w) => {
                      const r = transferRailOf(w);
                      return {
                        key: String(w.id),
                        record: w,
                        name: labelOf(w),
                        detail: `${w.address.slice(0, 8)}…${w.address.slice(-6)}`,
                        badge: r ? (
                          <span className="shrink-0 rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/55">
                            {RAIL_NETWORK[r]}
                          </span>
                        ) : undefined,
                      };
                    })}
                  />
                ) : destMode === 'saved' && savedEntries.length > 0 ? (
                  <select
                    value={savedEntryId}
                    onChange={(e) => setSavedEntryId(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                  >
                    {savedEntries.map((entry) => {
                      const net = XRPL_CLASSIC_RE.test(entry.address)
                        ? RAIL_NETWORK.xrpl
                        : EVM_ADDRESS_RE.test(entry.address)
                          ? RAIL_NETWORK.evm
                          : '';
                      return (
                        <option key={entry.id} value={entry.id}>
                          {entry.label} · {shortAddr(entry.address)}{net ? ` · ${net}` : ''}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={rail === 'xrpl' ? 'r… / 0x…' : '0x… / r…'}
                    value={destExternal}
                    onChange={(e) => setDestExternal(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
                  />
                )}

                {/* Cross-rail pick = the FAssets bridge — say it BEFORE preparing */}
                {mode === 'mint' && (
                  <p className="mt-2 text-[11px] text-sky-200/80 bg-sky-400/5 border border-sky-400/20 rounded-lg px-3 py-2">
                    {t('Cross-network: you pay XRP and the destination receives FXRP on Flare (FAssets mint). Mint fees are deducted from the payment.')}
                  </p>
                )}
                {mode === 'redeem' && (
                  <p className="mt-2 text-[11px] text-sky-200/80 bg-sky-400/5 border border-sky-400/20 rounded-lg px-3 py-2">
                    {t('Cross-network: burns FXRP from this wallet and a FAssets agent pays the XRP to the XRPL destination (redeem).')}
                  </p>
                )}
                {mode === 'flr-cross' && (
                  <p className="mt-2 text-[11px] text-amber-200/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    {t('FLR cannot be sent to an XRPL address. Switch the asset to FXRP to bridge it as XRP (unmint), or pick a Flare destination.')}
                  </p>
                )}
                {mode === 'pa-transfer' && !deliversToDestPa && (
                  <p className="mt-2 text-[11px] text-sky-200/80 bg-sky-400/5 border border-sky-400/20 rounded-lg px-3 py-2">
                    {paPaysFlr
                      ? t('The FLR leaves your Astryum account to the Flare destination — one atomic order you sign in Xaman. The FLR is your account’s own balance; Astryum adds none of its own.')
                      : t('The FXRP leaves your Astryum account to the Flare destination — one atomic order you sign in Xaman.')}
                  </p>
                )}
                {/* El activo que eliges es el que llega (2026-08-22): FXRP a una
                    r-address entra en la cuenta Astryum de ESE XRPL — misma
                    dueña, lado Flare. Nada se redime sin pedirlo. */}
                {deliversToDestPa && (
                  <p className="mt-2 text-[11px] text-sky-200/80 bg-sky-400/5 border border-sky-400/20 rounded-lg px-3 py-2">
                    {t('Arrives as FXRP in the Astryum account of that XRPL address — same owner, Flare side. If you wanted native XRP on the ledger, that is the Unmint door.')}
                    {destMode === 'external' && (
                      <>
                        {' '}
                        {t('External address: its owner will only see this FXRP from Astryum or a FAssets-aware wallet.')}
                      </>
                    )}
                  </p>
                )}
                {mode === 'pa-unmint' && (
                  <p className="mt-2 text-[11px] text-sky-200/80 bg-sky-400/5 border border-sky-400/20 rounded-lg px-3 py-2">
                    {t('Cross-network: the FXRP in your Astryum account is redeemed and a FAssets agent pays native XRP to the XRPL destination. You sign in Xaman.')}
                  </p>
                )}
              </div>

              {/* Amount */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-ink/40">
                    {t('Amount')} · {asset}
                  </label>
                  <span className="flex items-center gap-2">
                    {paPaysFlr ? (
                      <span className="text-[11px] text-ink/40">
                        {t('Available')}:{' '}
                        <span className="font-mono text-ink/60">{paFlrNum.toFixed(4)} FLR</span>
                      </span>
                    ) : xrplPaysFxrp ? (
                      <span className="text-[11px] text-ink/40">
                        {t('Available')}:{' '}
                        <span className="font-mono text-ink/60">{fsaFxrpNum.toFixed(4)} FXRP</span>
                      </span>
                    ) : rail === 'evm' && evmAsset === 'FXRP' && fxrpBalance != null ? (
                      <span className="text-[11px] text-ink/40">
                        {t('Available')}:{' '}
                        <span className="font-mono text-ink/60">
                          {(parseFloat(fxrpBalance) || 0).toFixed(4)} FXRP
                        </span>
                      </span>
                    ) : balance ? (
                      <span className="text-[11px] text-ink/40">
                        {t('Available')}:{' '}
                        <span className="font-mono text-ink/60">
                          {(parseFloat(balance.balance) || 0).toFixed(4)} {balance.symbol}
                        </span>
                      </span>
                    ) : null}
                    {maxSendable != null && (
                      <button
                        onClick={() => setAmount(maxSendable)}
                        title={t('Send the maximum available (fee headroom already deducted)')}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-volt/40 text-volt hover:bg-volt/10 transition-colors"
                      >
                        MAX
                      </button>
                    )}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs font-medium">
                    {asset}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-4 pr-16 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                  />
                </div>
                {rail === 'xrpl' && (
                  <p className="text-[10px] text-ink/30 mt-1.5">
                    {t('XRPL keeps a 1 XRP base reserve locked in the sending account.')}
                  </p>
                )}
                {/* The trap the founder hit live (2026-07-30): minting ALL the
                    XRP strands the Smart Account — no carrier payment, no way
                    to withdraw or convert until refunded from outside. */}
                {drainsXrplSteering && (
                  <div className="mt-2 bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                    {t('This would leave your XRPL wallet almost empty. Your Astryum account is steered FROM it — every order needs ~1 XRP of carrier payment. Keep at least ~2 XRP or you will not be able to withdraw or convert until you refund it from outside.')}
                  </div>
                )}
              </div>

              {/* La nota del pago: el tag identifica la cuenta DENTRO del
                  destino, el memo es texto libre. Los dos opcionales, los dos
                  visibles en la revisión antes de firmar. */}
              {(canCarryNote || canCarryRedeemTag) && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">
                      {t('Destination tag')} · {t('Optional')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={t('Only digits — e.g. 101')}
                      value={destTag}
                      onChange={(e) => setDestTag(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
                    />
                    {tagTooBig ? (
                      <p className="text-[11px] text-amber-200/90 mt-1.5">
                        {t('That tag is too large for XRPL (the maximum is 4294967295).')}
                      </p>
                    ) : (
                      <p className="text-[10px] text-ink/30 mt-1.5">
                        {t('Exchanges credit the deposit by this number. If they gave you one, sending without it loses the payment inside their account.')}
                      </p>
                    )}
                    {/* En la redención el pago lo hace el agente: el tag SÍ
                        viaja dentro (redeemWithTag), el texto libre no existe.
                        Se dice aquí en vez de enseñar un campo que no haría
                        nada. */}
                    {canCarryRedeemTag && !tagTooBig && (
                      <p className="text-[10px] text-ink/30 mt-1.5">
                        {t('The XRP is paid by a FAssets agent, so the tag is the only thing that can travel inside that payment — a free-text memo is not possible on a redemption.')}
                      </p>
                    )}
                  </div>
                  {canCarryNote && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-ink/40">
                        {t('Memo')} · {t('Optional')}
                      </label>
                      {memoBytes > 0 && (
                        <span className={`text-[10px] ${memoTooLong ? 'text-amber-200/90' : 'text-ink/30'}`}>
                          {memoBytes}/{MEMO_MAX_BYTES}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder={t('A reference for the recipient')}
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm placeholder-ink/30 focus:outline-none focus:border-volt/50"
                    />
                    <p className="text-[10px] text-ink/30 mt-1.5">
                      {t('Free text that travels with the payment and stays public on the ledger forever. Never write anything private here.')}
                    </p>
                  </div>
                  )}
                </div>
              )}

              {/* Todo lo que sale de la Smart Account viaja en el dispatch 0xFE
                  firmado en Xaman — el carrier se enseña con la misma pieza que
                  el resto de acciones del PA. */}
              {(mode === 'pa-unmint' || mode === 'pa-transfer') && (
                <DispatchXrpField xrp={xrpForMint} t={t} />
              )}
              <button
                onClick={prepare}
                disabled={phase === 'preparing' || noteBlocksPrepare}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
              >
                {phase === 'preparing' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('Building unsigned payload…')}
                  </>
                ) : (
                  t('Review before signing')
                )}
              </button>
            </>
          )}

          {/* Review — the disclosure, then hand off to the user's wallet */}
          {rail && (phase === 'review' || phase === 'signing') && prepared && (
            <>
              <div className="rounded-xl border border-ink/10 bg-ink/[0.03] divide-y divide-ink/5 text-sm">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-ink/40 text-xs">{t('Amount')}</span>
                  <span className="font-mono text-ink">
                    {fmtAmt(prepared.disclosure.amount)} {prepared.disclosure.asset}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-ink/40 text-xs">{t('From')}</span>
                  <span className="font-mono text-ink/80 text-xs">{shortAddr(prepared.disclosure.from)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-ink/40 text-xs">{t('To')}</span>
                  <span className="font-mono text-ink/80 text-xs">{shortAddr(prepared.disclosure.to)}</span>
                </div>
                {/* La nota, tal como el servidor la metió en el pago: el tag
                    mal tecleado es el error que pierde el dinero, y aquí es
                    donde todavía se puede volver atrás. */}
                {prepared.disclosure.destinationTag !== undefined && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-ink/40 text-xs">{t('Destination tag')}</span>
                    <span className="font-mono text-ink text-xs">{prepared.disclosure.destinationTag}</span>
                  </div>
                )}
                {prepared.disclosure.memo && (
                  <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <span className="text-ink/40 text-xs shrink-0">{t('Memo')}</span>
                    <span className="text-ink/80 text-xs text-right break-all">{prepared.disclosure.memo}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-ink/40 text-xs">{t('Network')}</span>
                  <span className="text-ink/80 text-xs">{prepared.disclosure.network}</span>
                </div>
                <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                  <span className="text-ink/40 text-xs shrink-0">{t('Network fee')}</span>
                  <span className="text-ink/60 text-[11px] text-right">{prepared.disclosure.networkFee}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-ink/40 text-xs">{t('Astryum fee')}</span>
                  {/* Read from the disclosure — a hardcoded 0 would lie the day a fee
                      exists, and a figure the server did not state is not 0. */}
                  {prepared.disclosure.astryumFee == null ? (
                    prepared.disclosure.astryumFeeExecutorListed ? (
                      <span className="text-ink/60 text-[11px] text-right">
                        {t('No separate charge — the executor fee is listed below')}
                      </span>
                    ) : (
                      <span className="text-amber-300/90 text-[11px] text-right">
                        {t('Fee figure unavailable — not returned by the server (not zero)')}
                      </span>
                    )
                  ) : Number(prepared.disclosure.astryumFee) === 0 ? (
                    <span className="text-emerald-300 text-xs">0 · {t('we charge nothing')}</span>
                  ) : (
                    <span className="font-mono text-ink text-xs">
                      {fmtAmt(prepared.disclosure.astryumFee)} {prepared.disclosure.asset}
                    </span>
                  )}
                </div>
                {/* FAssets mint breakdown — fees come out of the XRP paid. A 0xFE
                    order carries it too (its carrier mints); a missing figure
                    reads «unavailable», never 0. */}
                {(prepared.disclosure.netFxrp != null ||
                  prepared.disclosure.mintingFeeXrp != null ||
                  prepared.disclosure.executorFeeXrp != null ||
                  prepared.disclosure.feeFiguresUnavailable) && (
                  <>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink/40 text-xs">{t('Mint fee')}</span>
                      {prepared.disclosure.mintingFeeXrp != null ? (
                        <span className="font-mono text-ink/80 text-xs">
                          {fmtAmt(prepared.disclosure.mintingFeeXrp)} XRP
                        </span>
                      ) : (
                        <span className="text-amber-300/90 text-[11px]">{t('Unavailable (not zero)')}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink/40 text-xs">{t('Executor fee')}</span>
                      {prepared.disclosure.executorFeeXrp != null ? (
                        <span className="font-mono text-ink/80 text-xs">
                          {fmtAmt(prepared.disclosure.executorFeeXrp)} XRP
                        </span>
                      ) : (
                        <span className="text-amber-300/90 text-[11px]">{t('Unavailable (not zero)')}</span>
                      )}
                    </div>
                    {prepared.disclosure.netFxrp != null && (
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-ink/40 text-xs">{t('Destination receives')}</span>
                        <span className="font-mono text-emerald-300 text-xs">
                          ≈ {fmtAmt(prepared.disclosure.netFxrp)} FXRP
                        </span>
                      </div>
                    )}
                    {prepared.disclosure.carrierReturnText ? (
                      // pa-unmint: the redemption may burn what this dispatch
                      // mints — the row says what really comes back.
                      <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                        <span className="text-ink/40 text-xs shrink-0">{t('Returns to your account')}</span>
                        <span className="text-ink/80 text-[11px] text-right">{prepared.disclosure.carrierReturnText}</span>
                      </div>
                    ) : prepared.disclosure.carrierReturnsFxrp != null ? (
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-ink/40 text-xs">{t('Returns to your account')}</span>
                        <span className="font-mono text-ink/80 text-xs">
                          ≈ {fmtAmt(prepared.disclosure.carrierReturnsFxrp)} FXRP
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
                {prepared.disclosure.redemptionFeeText && (
                  <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <span className="text-ink/40 text-xs shrink-0">{t('Redemption fee')}</span>
                    <span className="text-ink/60 text-[11px] text-right">{prepared.disclosure.redemptionFeeText}</span>
                  </div>
                )}
                {prepared.disclosure.minimumRedeemXrp != null && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-ink/40 text-xs">{t('On-chain minimum')}</span>
                    <span className="font-mono text-ink/80 text-xs">
                      {fmtAmt(prepared.disclosure.minimumRedeemXrp)} XRP
                    </span>
                  </div>
                )}
              </div>

              {/* Redeem (FXRP → XRPL from an EVM wallet): the FAssets redemption
                  fee with its figure — or «could not be read — it is not zero» —
                  and the net the destination gets, before signing (invariant #6,
                  productizer 4.2). pa-unmint (rail xrpl) has its own row above. */}
              {prepared.rail === 'evm' && prepared.disclosure.action === 'bridge-redeem-fxrp' && (
                <RedemptionFeeNotice
                  response={prepared}
                  grossFxrp={redemptionOf(prepared).grossFxrp}
                  t={t}
                  showAmount
                  amountLabel="Destination receives"
                />
              )}

              {/* Bridge mechanics — the full protocol note, shown before signing */}
              {(prepared.disclosure.action === 'bridge-mint-fxrp' ||
                prepared.disclosure.action === 'bridge-redeem-fxrp' ||
                prepared.disclosure.action.startsWith('pa-transfer')) &&
                prepared.disclosure.note && (
                <p className="text-[11px] text-ink/40 bg-ink/[0.03] border border-ink/10 rounded-xl px-3 py-2.5">
                  {prepared.disclosure.note}
                </p>
              )}

              <p className="text-[11px] text-ink/40 flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                {t('Astryum built this payload unsigned. You review and sign it in your own wallet — nothing moves without your signature.')}
              </p>

              {/* Signer check — the EXACT wallet this transfer sends from.
                  NO aplica a una cuenta con quórum: ahí no se «conecta» la
                  cuenta, firman sus llaves una a una en la ceremonia de abajo —
                  y con la maestra deshabilitada NO EXISTE ninguna llave que
                  pueda conectarla, así que pedirlo era un callejón sin salida. */}
              {!signerMatches && !quorumSigner && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1.5 text-amber-200 text-sm font-medium">
                    <Wallet className="w-4 h-4" />
                    {sourceIsPa || rail === 'xrpl'
                      ? t('This transfer signs in Xaman (XRPL)')
                      : t('This transfer signs in your EVM wallet (Flare)')}
                  </div>
                  <p className="text-xs text-amber-200/70 mb-3">
                    {signerConnected
                      ? t('The wallet connected in your wallet app is a different account. Switch to') +
                        ' ' +
                        // A PA never signs itself — its OWNING XRPL does.
                        shortAddr(sourceIsPa && sourceOwningXrpl ? sourceOwningXrpl : prepared.disclosure.from) +
                        ' ' + t('and reconnect.')
                      : t('The required wallet is not connected. Connect it to sign this transfer.')}
                  </p>
                  <button
                    onClick={connectSigner}
                    disabled={connecting}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-100 text-sm font-medium hover:bg-amber-400/25 transition-all disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                    {sourceIsPa || rail === 'xrpl' ? t('Connect Xaman (XRPL)') : t('Connect EVM wallet')}
                  </button>
                </div>
              )}

              {/* CUENTA REFORZADA: la ceremonia, no el botón de firma única.
                  Un QR por llave, todos a la vez, cada uno con su dirección —
                  y el envío sale cuando el quórum está reunido. */}
              {quorumSigner && prepared.rail === 'xrpl' && (
                <div className="space-y-2 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
                  <p className="text-[11px] text-ink/45">
                    {t('This account is reinforced: it signs by quorum. Every one of your keys gets its own request below — sign them from their own devices.')}
                  </p>
                  <CouncilMultisigFlow
                    xrplTx={prepared.xrplPayment}
                    account={quorumSigner}
                    onSettled={() => setPhase('done')}
                  />
                </div>
              )}

              {/* Sign stays reachable while the disclosure scrolls. */}
              <div className="sticky bottom-0 -mx-6 -mb-5 bg-surface-1 px-6 pb-5 pt-3 flex gap-2">
                <button
                  onClick={() => setPhase('form')}
                  disabled={phase === 'signing'}
                  className="flex-1 py-3 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm hover:bg-ink/10 transition-colors disabled:opacity-50"
                >
                  {t('Back')}
                </button>
                {/* Sin botón de firma única cuando la cuenta firma por quórum:
                    la ceremonia de arriba ES el botón, y dejar este a mano
                    invitaba a una firma que la red rechaza. */}
                {!quorumSigner && (
                  <button
                    onClick={sign}
                    disabled={phase === 'signing' || !signerMatches}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
                  >
                    {phase === 'signing' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {sourceIsPa || rail === 'xrpl' ? t('Sign in Xaman…') : t('Sign in your wallet…')}
                      </>
                    ) : sourceIsPa || rail === 'xrpl' ? (
                      t('Sign in Xaman')
                    ) : (
                      t('Sign in your wallet')
                    )}
                  </button>
                )}
              </div>
            </>
          )}

          {/* Unconfirmed — the payload reached the wallet and we could not
              follow it. No form, no sign button: only close and check. */}
          {phase === 'unconfirmed' && unconfirmed && (
            <UnconfirmedSignatureNotice
              // A plain XRPL Payment is an XRPL hash too (xrpscan, not Flarescan),
              // but it has no carrier fee and no nonce seat: its own copy.
              rail={prepared?.rail === 'xrpl' ? 'xrpl' : 'evm'}
              xrplKind={paMemoHex ? 'dispatch' : 'payment'}
              chainId={prepared?.rail === 'evm' ? prepared.calls[0]?.chainId : undefined}
              unconfirmed={unconfirmed}
              onClose={close}
            />
          )}

          {/* Done */}
          {phase === 'done' && rail === 'evm' && settlement.state && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Transfer settled on-chain.')}
                pendingText={t('Transfer signed — settling…')}
              />
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2.5 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm hover:bg-ink/10 transition-colors"
              >
                {t('Close')}
              </button>
            </div>
          )}

          {/* XRPL rail: green ONLY when the Payment is VALIDATED in the ledger
              (rail 'xrpl-tx' of the machine). The FAssets executor/agent side
              stays a copy note: validated Payment ≠ FXRP landed, and the
              paragraphs below keep saying who finishes what. */}
          {phase === 'done' && rail === 'xrpl' && settlement.state && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Payment validated on the XRPL ledger.')}
                pendingText={t('Signed — waiting for ledger validation…')}
              />
              {prepared?.disclosure.action === 'bridge-mint-fxrp' && (
                <p className="text-xs text-ink/50 max-w-xs">
                  {t('Your XRP will appear on Flare as FXRP in a few minutes. Sometimes it takes a little longer — it is never lost.')}
                </p>
              )}
              {prepared?.disclosure.action === 'bridge-redeem-fxrp' && (
                <p className="text-xs text-ink/50 max-w-xs">
                  {t('The FAssets agent now pays the XRP to the XRPL destination (minus the protocol redemption fee).')}
                </p>
              )}
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2.5 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm hover:bg-ink/10 transition-colors"
              >
                {t('Close')}
              </button>
            </div>
          )}

          {/* Un asiento tomado no es un fallo rojo: es un 0xFE anterior de esta
              cuenta en el nonce. Se cuenta en inglés y, si el borrador es el
              que esta pantalla dejó, con la salida (it. 17, R5 5.4 · R1 1.5). */}
          {seatRefusal && phase === 'error' ? (
            <SeatRefusalNotice
              refusal={seatRefusal}
              t={t}
              fallbackMemoHex={paHandedToXaman.current ? null : paMemoHex}
              onPrepareAgain={() => void prepare()}
            />
          ) : errorMsg && phase === 'error' ? (
            <p className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5">
              {errorMsg}
            </p>
          ) : null}
        </div>
      </div>
    </ModalOverlay>
  );
}

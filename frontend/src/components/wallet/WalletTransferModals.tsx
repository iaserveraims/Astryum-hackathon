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

import { useEffect, useMemo, useState } from 'react';
import { useDisconnect } from 'wagmi';
import QRCode from 'react-qr-code';
import {
  ArrowUpRight,
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
import { addressBookService, type AddressBookEntry } from '../../services/v1Api';
import {
  fetchNativeBalance,
  transferRailOf,
  type NativeBalance,
  type TransferRail,
} from '../../lib/wallet/nativeBalance';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useUniversalConnect } from '../../lib/wallet/useUniversalConnect';
import { useT } from '../../i18n/LanguageProvider';
import { getApiBase } from '../../lib/env';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';

const API_BASE = getApiBase();

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;


const RAIL_NETWORK: Record<TransferRail, string> = { evm: 'Flare', xrpl: 'XRPL' };

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function walletLabel(w: BackendWallet): string {
  return `${w.nickname || w.walletType} · ${shortAddr(w.address)}`;
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

  function copy() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const networkLabel = rail
    ? RAIL_NETWORK[rail]
    : wallet?.ecosystem
      ? wallet.ecosystem.charAt(0).toUpperCase() + wallet.ecosystem.slice(1)
      : t('this network');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <QrCode className="w-4 h-4 text-volt" />
              {t('Receive')}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5">
              {wallet ? walletLabel(wallet) : t('Choose the receiving wallet')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col items-center gap-4">
          {!fixedWallet && wallets && wallets.length > 0 && (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {walletLabel(w)}
                </option>
              ))}
            </select>
          )}
          {!wallet ? (
            <p className="text-xs text-ink/50 bg-ink/5 border border-ink/10 rounded-xl px-4 py-3">
              {t('Link a wallet from Wallets to receive assets into it.')}
            </p>
          ) : (
            <>
          <div className="bg-white p-4 rounded-xl">
            <QRCode value={wallet.address} size={192} />
          </div>

          <button
            onClick={copy}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-ink/5 border border-ink/10 hover:bg-ink/10 transition-colors"
            title={t('Copy address')}
          >
            <span className="text-[11px] font-mono text-ink/80 break-all text-left">{wallet.address}</span>
            {copied ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-ink/40 shrink-0" />
            )}
          </button>

          <p className="text-[11px] text-amber-200/70 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5 text-center">
            {t('Send only assets on')} <span className="font-semibold">{networkLabel}</span>{' '}
            {t('to this address. Assets sent from other networks would be lost.')}
          </p>
            </>
          )}
        </div>
      </div>
    </div>
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
  astryumFee: number;
  networkFee: string;
  disclosedToUser: boolean;
  defibroSigns: boolean;
  note: string;
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

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done' | 'error';

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
}: {
  /** the sending wallet; omit to let the user pick among their transferable wallets */
  wallet?: BackendWallet | null;
  /** all linked wallets — source picker + "my other wallets" destinations */
  wallets: BackendWallet[];
  onClose: () => void;
  /** optional prefill (agent-compiled or deep-linked) — always editable before prepare */
  initial?: SendPrefill;
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
  const [errorMsg, setErrorMsg] = useState('');
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Destination — any of my other wallets on EITHER rail (a cross-rail pick
  // rides the FAssets bridge: mint XRP→FXRP or redeem FXRP→XRP), a saved
  // address-book entry, or a pasted address whose format decides the rail.
  const myDestinations = useMemo(
    () => wallets.filter((w) => w.id !== wallet?.id && transferRailOf(w) !== null),
    [wallets, wallet?.id],
  );
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

  // Switching the source can leave the picked destination pointing at the
  // source itself — snap it back to a valid option.
  useEffect(() => {
    if (destMode === 'mine' && destWalletId && !myDestinations.some((w) => w.id === destWalletId)) {
      setDestWalletId(myDestinations[0]?.id ?? '');
    }
  }, [myDestinations, destMode, destWalletId]);

  // What an EVM source sends: native FLR or the FXRP ERC-20. An XRPL source
  // always pays XRP (the only native asset there).
  const [evmAsset, setEvmAsset] = useState<'FLR' | 'FXRP'>(initial?.asset ?? 'FLR');

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

  // The wallet partner that will SIGN must hold this exact address.
  const signerAddress = rail === 'xrpl' ? xrpl.address : evm.address;
  const signerConnected = rail === 'xrpl' ? xrpl.isConnected : evm.isConnected;
  const signerMatches =
    !!wallet && !!signerAddress && signerAddress.toLowerCase() === wallet.address.toLowerCase();

  async function connectSigner() {
    setErrorMsg('');
    setConnecting(true);
    try {
      if (rail === 'xrpl') {
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
  const mode: 'transfer' | 'mint' | 'redeem' | 'flr-cross' | null =
    !rail || !destRail
      ? null
      : destRail === rail
        ? 'transfer'
        : rail === 'xrpl'
          ? 'mint'
          : evmAsset === 'FXRP'
            ? 'redeem'
            : 'flr-cross';

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
    if (!destAddress) return t('Choose a destination');
    if (!destRail) {
      // Both formats are valid now — the other rail just rides the bridge.
      return t('Enter a valid destination address (r… or 0x…)');
    }
    if (mode === 'flr-cross') {
      return t('FLR cannot be sent to an XRPL address. Switch the asset to FXRP to bridge it as XRP (unmint), or pick a Flare destination.');
    }
    if (destAddress.toLowerCase() === wallet.address.toLowerCase()) {
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
    setPhase('preparing');
    try {
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
            ? { evmWallet: wallet.address, xrplDestination: destAddress, amountXrp: amount.trim() }
            : {
                rail,
                from: wallet.address,
                to: destAddress,
                amount: amount.trim(),
                // The EVM rail carries the selected asset (FLR native | FXRP ERC-20).
                ...(rail === 'evm' ? { asset: evmAsset } : {}),
              };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
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
    setPhase('signing');
    try {
      if (prepared.rail === 'xrpl') {
        if (!xrpl.isConnected) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        const { txHash: hash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // Signed ≠ validated: the machine follows the Payment to its ledger
        // validation — the last surface that painted green on submit alone.
        settlement.track(startPending('xrpl-tx', hash));
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle);
      }
      setPhase('done');
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setErrorMsg(err.shortMessage ?? err.message ?? String(e));
      setPhase('error');
    }
  }

  // What the user is sending: XRPL sources always pay XRP; an EVM source sends
  // the selected asset (FLR native | FXRP ERC-20) same-rail, or burns FXRP
  // (denominated in XRP) when redeeming to XRPL.
  const asset = !rail ? '' : rail === 'xrpl' ? 'XRP' : mode === 'redeem' ? 'XRP (FXRP)' : evmAsset;

  // MAX per asset. XRPL balance is already spendable (reserve excluded) — keep
  // a fee cushion (~8× the ~0.000012 XRP network fee). FLR pays its own gas, so
  // leave headroom (a 21k-gas transfer at 25 gwei is ~0.0005 FLR). FXRP moves
  // whole: its gas is paid in FLR, and on a redeem the FAssets fee comes out on
  // the XRPL side. Floored to 6 decimals — the resolution every rail accepts.
  const XRPL_FEE_HEADROOM = 0.0001;
  const FLR_GAS_HEADROOM = 0.01;
  const maxSendable: string | null = (() => {
    if (!rail) return null;
    const floor6 = (n: number) => Math.floor(Math.max(0, n) * 1e6) / 1e6;
    let max: number;
    if (rail === 'evm' && evmAsset === 'FXRP') {
      if (fxrpBalance == null) return null;
      max = floor6(parseFloat(fxrpBalance) || 0);
    } else {
      if (!balance) return null;
      const spendable = parseFloat(balance.balance) || 0;
      max = floor6(spendable - (rail === 'xrpl' ? XRPL_FEE_HEADROOM : FLR_GAS_HEADROOM));
    }
    return max > 0 ? max.toFixed(6).replace(/\.?0+$/, '') : null;
  })();

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <div>
            <h2 className="text-base font-semibold text-ink flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-volt" />
              {t('Send')} {asset}
            </h2>
            <p className="text-xs text-ink/40 mt-0.5">
              {wallet ? `${t('From')} ${walletLabel(wallet)}` : t('Choose the sending wallet')}
            </p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
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
                  <select
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                  >
                    {transferable.map((w) => {
                      const r = transferRailOf(w);
                      return (
                        <option key={w.id} value={w.id}>
                          {walletLabel(w)} · {r ? RAIL_NETWORK[r] : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Asset — an EVM source picks FLR (native) or FXRP (ERC-20) */}
              {rail === 'evm' && (
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
                        {a}
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
                  <select
                    value={destWalletId}
                    onChange={(e) => setDestWalletId(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                  >
                    {myDestinations.map((w) => {
                      const r = transferRailOf(w);
                      return (
                        <option key={w.id} value={w.id}>
                          {walletLabel(w)} · {r ? RAIL_NETWORK[r] : ''}
                        </option>
                      );
                    })}
                  </select>
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
              </div>

              {/* Amount */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-ink/40">
                    {t('Amount')} · {asset}
                  </label>
                  <span className="flex items-center gap-2">
                    {rail === 'evm' && evmAsset === 'FXRP' && fxrpBalance != null ? (
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
              </div>

              <button
                onClick={prepare}
                disabled={phase === 'preparing'}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
              >
                {phase === 'preparing' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('Building unsigned payload…')}
                  </>
                ) : (
                  t('Prepare transfer')
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
                    {prepared.disclosure.amount} {prepared.disclosure.asset}
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
                  <span className="text-emerald-300 text-xs">0</span>
                </div>
                {/* FAssets mint breakdown — fees come out of the XRP paid */}
                {prepared.disclosure.netFxrp != null && (
                  <>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink/40 text-xs">{t('Mint fee')}</span>
                      <span className="font-mono text-ink/80 text-xs">
                        {prepared.disclosure.mintingFeeXrp} XRP
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink/40 text-xs">{t('Executor fee')}</span>
                      <span className="font-mono text-ink/80 text-xs">
                        {prepared.disclosure.executorFeeXrp} XRP
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-ink/40 text-xs">{t('Destination receives')}</span>
                      <span className="font-mono text-emerald-300 text-xs">
                        ≈ {prepared.disclosure.netFxrp} FXRP
                      </span>
                    </div>
                  </>
                )}
                {prepared.disclosure.minimumRedeemXrp != null && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-ink/40 text-xs">{t('On-chain minimum')}</span>
                    <span className="font-mono text-ink/80 text-xs">
                      {prepared.disclosure.minimumRedeemXrp} XRP
                    </span>
                  </div>
                )}
              </div>

              {/* Bridge mechanics — the full protocol note, shown before signing */}
              {(prepared.disclosure.action === 'bridge-mint-fxrp' ||
                prepared.disclosure.action === 'bridge-redeem-fxrp') && (
                <p className="text-[11px] text-ink/40 bg-ink/[0.03] border border-ink/10 rounded-xl px-3 py-2.5">
                  {prepared.disclosure.note}
                </p>
              )}

              <p className="text-[11px] text-ink/40 flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                {t('Astryum built this payload unsigned. You review and sign it in your own wallet — nothing moves without your signature.')}
              </p>

              {/* Signer check — the EXACT wallet this transfer sends from */}
              {!signerMatches && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1.5 text-amber-200 text-sm font-medium">
                    <Wallet className="w-4 h-4" />
                    {rail === 'xrpl' ? t('This transfer signs in Xaman (XRPL)') : t('This transfer signs in your EVM wallet (Flare)')}
                  </div>
                  <p className="text-xs text-amber-200/70 mb-3">
                    {signerConnected
                      ? t('The wallet connected in your wallet app is a different account. Switch to') +
                        ' ' + shortAddr(prepared.disclosure.from) + ' ' + t('and reconnect.')
                      : t('The required wallet is not connected. Connect it to sign this transfer.')}
                  </p>
                  <button
                    onClick={connectSigner}
                    disabled={connecting}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-100 text-sm font-medium hover:bg-amber-400/25 transition-all disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                    {rail === 'xrpl' ? t('Connect Xaman (XRPL)') : t('Connect EVM wallet')}
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setPhase('form')}
                  disabled={phase === 'signing'}
                  className="flex-1 py-3 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm hover:bg-ink/10 transition-colors disabled:opacity-50"
                >
                  {t('Back')}
                </button>
                <button
                  onClick={sign}
                  disabled={phase === 'signing' || !signerMatches}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50"
                >
                  {phase === 'signing' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {rail === 'xrpl' ? t('Sign in Xaman…') : t('Sign in your wallet…')}
                    </>
                  ) : (
                    t('Sign in your wallet')
                  )}
                </button>
              </div>
            </>
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
                  {t('The FXRP lands on Flare once the permissionless executor finalizes the mint — rate limits can delay it, never reject it.')}
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

          {errorMsg && phase === 'error' && (
            <p className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2.5">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

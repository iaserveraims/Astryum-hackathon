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

import { useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useOwningXrpl } from '../../lib/wallet/paOwnership';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { SettlementIndicator } from '../settlement/SettlementIndicator';

const API_BASE = getApiBase();
const SHARE_DECIMALS = 6; // LP/stXRP shares mirror FXRP's 6 decimals

export type VaultParam = 'firelight' | 'earnxrp' | 'monarq';

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
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

interface PreparedEvm {
  rail: 'evm';
  chainId: number;
  account: string;
  calls: Array<{ to: string; data: string; value: string; chainId: number; label: string }>;
  disclosure: Record<string, unknown> & { note?: string };
}

interface PreparedXrpl {
  rail: 'xrpl';
  personalAccount: string;
  xrplPayment: unknown;
  disclosure: Record<string, unknown> & { note?: string };
}

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1.5">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 font-mono text-right">{value}</span>
    </div>
  );
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
  const aliasOf = (addr: string) =>
    myWallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label ??
    `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<PreparedEvm | PreparedXrpl | null>(null);

  const [amount, setAmount] = useState('');
  // MAX sends the EXACT scanned base units — no float round-trip dust.
  const [maxBase, setMaxBase] = useState<string | null>(null);
  const [xrpForMint, setXrpForMint] = useState('1');
  const [evmDest, setEvmDest] = useState(evm.address ?? '');

  const balanceShares = useMemo(() => {
    const n = Number(selected.sharesBase);
    return Number.isFinite(n) ? n / 10 ** SHARE_DECIMALS : 0;
  }, [selected.sharesBase]);

  const balanceFxrp = useMemo(() => {
    const sp = Number(selected.sharePriceE6 ?? 0);
    return sp > 0 ? (balanceShares * sp) / 10 ** SHARE_DECIMALS : null;
  }, [balanceShares, selected.sharePriceE6]);

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
        if (!(parseFloat(xrpForMint) > 0)) {
          throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
        }
        body.xrplAddress = signerXrpl;
        body.amountXrpForMint = parseFloat(xrpForMint) || 0;
        if (evmDest && /^0x[a-fA-F0-9]{40}$/.test(evmDest)) body.evmDest = evmDest;
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
        throw new Error(resBody.detail || resBody.error || `HTTP ${res.status}`);
      }
      if (
        resBody.rail === 'xrpl' &&
        String(resBody.personalAccount ?? '').toLowerCase() !== selected.owner.toLowerCase()
      ) {
        throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
      }
      setPrepared(resBody as PreparedEvm | PreparedXrpl);
      setPhase('review');
    } catch (e) {
      setError((e as Error).message ?? String(e));
      setPhase('form');
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setPhase('signing');
    try {
      if (prepared.rail === 'xrpl') {
        if (!xrpl.isConnected) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
        const { txHash: hash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // 0xFE userOp: signed ≠ settled — follow the mint on Flare (executor).
        settlement.track(startPending('xrpl-mint', hash), { onSettled: onChanged });
      } else {
        if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        const { handle } = await evm.sendIntentCalls(
          prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle, { onSettled: onChanged });
      }
      setPhase('done');
      onChanged();
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? String(e));
      setPhase('review'); // prepared payload still valid — retry the signature
    }
  }

  const disclosure = prepared?.disclosure;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
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

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {phase === 'form' && (
            <>
              {/* The wallet being withdrawn FROM — a selector when the same
                  vault is held by more than one wallet. */}
              {allHolders.length > 1 ? (
                <div>
                  <label className="text-xs text-ink/40 block mb-2">{t('Withdraw from wallet')}</label>
                  <select
                    value={selected.owner}
                    onChange={(e) => selectOwner(e.target.value)}
                    className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50 [&>option]:bg-surface-1"
                  >
                    {allHolders.map((h) => (
                      <option key={h.owner} value={h.owner}>
                        {`${aliasOf(h.owner)} · ${h.owner.slice(0, 8)}…${h.owner.slice(-6)} · ${fmt(Number(h.sharesBase) / 10 ** SHARE_DECIMALS)} ${h.vaultLabel}`}
                      </option>
                    ))}
                  </select>
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
                  that tx. Said BEFORE preparing, not discovered after. */}
              {position.vault === 'firelight' && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t(
                    'Firelight does NOT pay instantly: this redeem burns your stXRP now and queues the FXRP into a ~24h withdrawal period. Nothing arrives in this transaction — your position will keep showing the FXRP in flight with a Claim button, and one click releases it when the period ends (exact time shown before you sign).',
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
              </div>

              {!ownerIsEvmWallet && (
                <>
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">
                      {t('Destination EVM wallet (optional — empty keeps the FXRP in your Smart Account)')}
                    </label>
                    <input
                      type="text"
                      placeholder="0x…"
                      value={evmDest}
                      onChange={(e) => setEvmDest(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm font-mono placeholder-ink/30 focus:outline-none focus:border-volt/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink/40 block mb-2">
                      {t('Dispatch XRP (comes back to you as FXRP)')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={xrpForMint}
                      onChange={(e) => setXrpForMint(e.target.value)}
                      className="w-full px-4 py-3 bg-ink/5 border border-ink/10 rounded-xl text-ink text-sm focus:outline-none focus:border-volt/50"
                    />
                    <p className="text-[10px] text-ink/35 mt-1.5">
                      {t("NOT a fee and NOT the withdraw amount: the order must ride an XRPL Payment to the FAssets Core Vault (Xaman will show it, e.g. 1 XRP). It comes back to your Smart Account as FXRP minus the protocol's fees — minting max(0.1%, 0.1 XRP) + 0.2 XRP for the executor — with the exact figures shown before you sign. Nothing goes to Astryum or the vault manager.")}
                    </p>
                  </div>
                </>
              )}

              <button
                onClick={prepare}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20"
              >
                {t('Prepare (unsigned)')}
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
                {disclosure?.instantRedemptionFeeBps != null && (
                  <Row
                    label={t('Instant redemption fee')}
                    value={`${Number(disclosure.instantRedemptionFeeBps)} bps${
                      disclosure.instantFeeFxrp != null ? ` (${fmt(Number(disclosure.instantFeeFxrp), 4)} FXRP)` : ''
                    }`}
                  />
                )}
                {disclosure?.estimatedFxrpOut != null && (
                  <Row label={t('You receive (est.)')} value={`${fmt(Number(disclosure.estimatedFxrpOut), 4)} FXRP`} />
                )}
                {disclosure?.estimatedValueUSD != null && (
                  <Row label={t('Value (est.)')} value={`$${fmt(Number(disclosure.estimatedValueUSD), 2)}`} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.mintCoupledXrp != null && (
                  <Row label={t('Dispatch XRP (comes back to you as FXRP)')} value={fmt(Number(disclosure.mintCoupledXrp))} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.mintingFeeXrp != null && (
                  <Row label={t('Minting fee')} value={`${fmt(Number(disclosure.mintingFeeXrp), 6)} XRP`} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.executorFeeXrp != null && (
                  <Row label={t('Executor fee')} value={`${fmt(Number(disclosure.executorFeeXrp), 6)} XRP`} />
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
              {typeof disclosure?.note === 'string' && (
                <p className="text-[11px] text-ink/45 leading-relaxed">{disclosure.note}</p>
              )}
              <button
                onClick={sign}
                className="w-full flex items-center justify-center gap-2 bg-volt text-volt-ink text-sm font-medium py-2.5 rounded-xl hover:brightness-95 transition-all shadow-lg shadow-volt/20"
              >
                {prepared.rail === 'xrpl' ? t('Sign in Xaman') : t('Sign in wallet')}
              </button>
              <button
                onClick={() => {
                  setPrepared(null);
                  setPhase('form');
                }}
                className="w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Back')}
              </button>
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

          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                settledText={t('Withdrawal settled on Flare.')}
                pendingText={t('Withdrawal signed — settling on Flare…')}
              />
              <button
                onClick={onClose}
                className="mt-1 w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {t('Done')}
              </button>
            </div>
          )}

          <div className="bg-surface-2/80 rounded-xl p-3 text-[11px] text-ink/50 border border-ink/5">
            {t('Astryum prepares unsigned payloads and discloses every number; you sign in your own wallet. It never signs or executes on its own.')}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * VaultClaimModal — releases a FINISHED Firelight withdrawal period. After a
 * redeem the stXRP is already burned and the FXRP waits ~24h in the vault's
 * period queue; this is the "1 tap" that lands it in the user's wallet once the
 * period ends (the founder's "que llegue cuando esté listo").
 *
 * Backend: POST /flare-demo/vault-claim/prepare — TWO rails, chosen by WHO
 * queued the exit:
 *   - the user's EVM wallet   → one unsigned claimWithdraw(period) call,
 *   - the Personal Account    → 0xFE userOp signed in Xaman (mint-coupled).
 *
 * Prepare → review (full disclosure, invariant #6) → the USER signs → done.
 * Astryum never signs, never broadcasts — it only builds the unsigned call and
 * discloses every number.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, AlertTriangle, HandCoins } from 'lucide-react';
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
import { releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { DispatchXrpField } from './DispatchXrpField';
import { translateError } from '../../lib/errors/translateError';
import { fmtQtyActive } from '../../lib/format';
import { PreflightNotice } from '../preflight/PreflightNotice';
import { preflightSaysFail, type PreflightInfo } from '../../lib/preflight';
import { ECOSYSTEM_ACCENT } from '../../lib/ui/ecosystem';

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

type Phase = 'form' | 'preparing' | 'review' | 'signing' | 'done';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs py-1.5">
      <span className="text-ink/40">{label}</span>
      <span className="text-ink/80 font-mono text-right">{value}</span>
    </div>
  );
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

  const aliasOf = (addr: string) =>
    myWallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label ??
    `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<PreparedEvm | PreparedXrpl | null>(null);
  const [xrpForMint, setXrpForMint] = useState('1');
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
        if (!(parseFloat(xrpForMint) > 0)) {
          throw new Error(t('The XRP for the mint-coupled dispatch must be greater than 0'));
        }
        body.xrplAddress = signerXrpl;
        body.amountXrpForMint = parseFloat(xrpForMint) || 0;
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
        throw new Error(resBody.detail || resBody.error || `HTTP ${res.status}`);
      }
      if (
        resBody.rail === 'xrpl' &&
        String(resBody.personalAccount ?? '').toLowerCase() !== claim.owner.toLowerCase()
      ) {
        throw new Error(t('The connected Xaman wallet does not control this Smart Account.'));
      }
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
      // Signed ≠ done: the parent refresh now waits for onSettled (a premature
      // onChanged() dropped the "in flight" row while the op was still live).
      setPhase('done');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase('review'); // prepared payload still valid — retry the signature
    }
  }

  const disclosure = prepared?.disclosure;

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
          {error && (
            <div className="bg-red-500/5 border border-red-500/25 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

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
                  {t('The withdrawal period ended — this releases the FXRP straight to your wallet. The only cost is the network fee (cents; your wallet shows the exact figure before signing). The exit fee was already taken when you requested the withdrawal — nothing else is charged.')}
                </div>
              ) : (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('Not ready yet — the withdrawal period is still running.')} {eta ? `${t('Claimable from')} ${eta}.` : ''}
                </div>
              )}

              {/* Destino: FXRP al PA (clásico) o XRP NATIVO a la wallet XRPL
                  dueña — claim + redención en el MISMO dispatch (2026-07-26). */}
              {!ownerIsEvmWallet && (
                <div className="flex gap-2">
                  {/* The color IS the arrow (founder 2026-07-30): Flare reads
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
                <DispatchXrpField value={xrpForMint} onChange={setXrpForMint} t={t} />
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
                {prepared.rail === 'xrpl' && disclosure?.mintingFeeXrp != null && (
                  <Row label={t('Minting fee')} value={`${fmt(Number(disclosure.mintingFeeXrp), 2)} XRP`} />
                )}
                {prepared.rail === 'xrpl' && disclosure?.executorFeeXrp != null && (
                  <Row label={t('Executor fee')} value={`${fmt(Number(disclosure.executorFeeXrp), 2)} XRP`} />
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
              {/* Invariant #11 — the dry-run verdict, before the wallet opens. */}
              <PreflightNotice preflight={prepared.preflight} />
              {prepared.rail === 'xrpl' && preflightSaysFail(prepared.preflight) && owningXrpl && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
                  {t('The account that signs is your XRPL wallet')}{' '}
                  <span className="font-mono">{owningXrpl.slice(0, 8)}…{owningXrpl.slice(-4)}</span> —{' '}
                  {t('send it ~2 XRP (from an exchange or another wallet) and come back. Your money on Flare is untouched.')}
                </div>
              )}
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

          {phase === 'done' && settlement.state && (
            <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
              <SettlementIndicator
                state={settlement.state}
                // R8.1: the success line follows the DESTINATION — with the
                // XRPL exit the FXRP is NOT in any wallet yet: the FAssets
                // agent pays the XRP minutes-to-hours later.
                settledText={
                  claimDest === 'xrpl'
                    ? t('Claim confirmed — your XRP is on its way to your XRPL wallet (minutes to hours).')
                    : t('Claim settled — the FXRP is in your wallet.')
                }
                pendingText={t('Claim signed — settling on Flare…')}
              />
              <button
                onClick={onClose}
                className="mt-1 w-full border border-ink/10 bg-ink/5 text-ink/70 text-sm py-2.5 rounded-xl hover:bg-ink/10 transition-colors"
              >
                {settlement.state.status === 'settled' ? t('Done') : t('Keep waiting in the background')}
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

'use client';

/**
 * TicketsBoard — F3, the exit clock. Every unclaimed ticket of the connected
 * holder, with the day-scale countdown (useDeadlineClock) and the claim
 * button that only lights up when the chain will say yes. A 409 from the
 * prepare is painted verbatim — CLAIM_NOT_READY is the product telling the
 * truth, not a failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Hourglass, Loader2, RefreshCw } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { resolvePersonalAccountOf } from '../../lib/wallet/paOwnership';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { startPending } from '../../lib/settlement/settlement';
import { notifyHandoffSigned, releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { useDeadlineClock } from '../../lib/useCountdown';
import { applySignFailure, signFailureAction, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import {
  AbandonedSeatNotice,
  SeatRefusalNotice,
  StaleSignatureNotice,
  describeStaleSignature,
  normalizeSeatRefusal,
  seatRefusalSentence,
} from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import {
  getPoteState,
  prepareClaimRedeem,
  preparePoteClaimExit,
  type PoteExitHandoff,
  type PoteState,
  type PoteTicket,
  type Refusal,
} from '../../lib/institutional/api';
import { fmtBase, type PolicyCard } from '../../lib/institutional/policyCatalog';
import { decideTicketsBoard, type PotReadStatus, type TicketRail } from '../../lib/institutional/exitTickets';
import type { PaResolution } from '../../lib/institutional/positionRead';
import { exitCopyFor, exitOffersFxrpAlternative } from '../../lib/institutional/exitCopy';
import { RedemptionFeeNotice } from '../../lib/fassets/RedemptionFeeNotice';
import { exitRedemption } from '../../lib/fassets/redemptionFeeRow';
import { fillFeeText } from '../../lib/wallet/paDispatchDisclosure';

function TicketRow({
  ticket,
  state,
  rail,
  onClaim,
  claiming,
  locked,
}: {
  ticket: PoteTicket;
  state: PoteState;
  rail: TicketRail;
  onClaim: (id: number, rail: TicketRail) => void;
  claiming: boolean;
  /** A claim of this ticket may already be on-chain: no second signature. */
  locked: boolean;
}) {
  const { t } = useT();
  const clock = useDeadlineClock(ticket.maturity);
  return (
    <div className="flex items-center justify-between rounded-lg border border-ink/10 bg-surface-2 px-3 py-2">
      <div className="text-xs text-ink">
        <div className="font-mono">{fmtBase(ticket.assets, state.asset.decimals)} {state.asset.symbol}</div>
        <div className="text-ink/60 flex items-center gap-1">
          <Hourglass className="w-3 h-3" />
          {locked
            ? t('Claim sent — check before claiming again')
            : clock.reached
              ? t('Ready to claim')
              : `${t('Claimable in')} ${clock.label ?? '—'}`}
        </div>
        {rail === 'personal-account' ? (
          <div className="text-[10px] text-ink/40">{t('In your Flare account — claimed with one signature in Xaman')}</div>
        ) : null}
      </div>
      <button
        onClick={() => onClaim(ticket.id, rail)}
        disabled={!clock.reached || claiming || locked}
        className="rounded-lg bg-volt text-black text-xs font-semibold px-3 py-1.5 disabled:opacity-40"
      >
        {claiming ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Claim')}
      </button>
    </div>
  );
}

/** The claim of a Personal Account ticket: prepared by 0xFE, reviewed, signed in Xaman. */
type PaClaim =
  | { ticketId: number; phase: 'preparing' }
  | { ticketId: number; phase: 'refused'; refusal: Refusal }
  | { ticketId: number; phase: 'ready' | 'signing' | 'sent'; handoff: PoteExitHandoff & { unminted?: boolean } };

export function TicketsBoard({ policy }: { policy: PolicyCard }) {
  const { t } = useT();
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const settlement = useSettlement();

  const [state, setState] = useState<PoteState | null>(null);
  const [read, setRead] = useState<PotReadStatus>('pending');
  const [paStatus, setPaStatus] = useState<PaResolution>('none');
  const [pa, setPa] = useState<string | null>(null);
  const [paAttempt, setPaAttempt] = useState(0);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<(UnconfirmedSignature & { chainId: number }) | null>(null);
  const [paClaim, setPaClaim] = useState<PaClaim | null>(null);
  const [paSignError, setPaSignError] = useState('');
  const [paUnconfirmed, setPaUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  /**
   * A claim signed past its ledger window (R5 5.2). It never validated
   * and never will, so the ticket is NOT locked and the row's own offer is a
   * fresh prepare.
   */
  const [paStale, setPaStale] = useState<{ ticketId: number; error: unknown } | null>(null);
  /** The memo of the last 0xFE claim prepared here — the one a seat refusal is about. */
  const abandonedPaMemo = useRef<string | null>(null);
  // Tickets whose claim may already be on-chain. Cleared only by a page reload.
  const [lockedTickets, setLockedTickets] = useState<Record<number, true>>({});

  // The Personal Account of the connected XRPL wallet: where XRPL exits leave their ticket.
  useEffect(() => {
    if (!xrpl.address) {
      setPa(null);
      setPaStatus('none');
      return;
    }
    let alive = true;
    setPaStatus('resolving');
    resolvePersonalAccountOf(xrpl.address)
      .then((r) => {
        if (!alive) return;
        setPa(r);
        setPaStatus(r ? 'resolved' : 'failed');
      })
      .catch(() => {
        if (alive) setPaStatus('failed');
      });
    return () => {
      alive = false;
    };
  }, [xrpl.address, paAttempt]);

  const hasWallet = !!evm.address || !!xrpl.address;

  const reload = useCallback(async () => {
    if (!evm.address && !xrpl.address) return;
    setRead('pending');
    try {
      // Tickets are pot-wide; the holder only adds its share balance.
      setState(await getPoteState(policy.poteAddress, evm.address ?? undefined));
      setRead('ok');
    } catch {
      setRead('failed');
    }
  }, [policy.poteAddress, evm.address, xrpl.address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function retry() {
    if (paStatus === 'failed') setPaAttempt((n) => n + 1);
    void reload();
  }

  async function claim(ticketId: number, rail: TicketRail) {
    if (lockedTickets[ticketId]) return;
    if (rail === 'personal-account') {
      await preparePaClaim(ticketId, true);
      return;
    }
    setNotice('');
    setClaimingId(ticketId);
    let handedToPartner = false;
    let signChainId = 14;
    try {
      const res = await prepareClaimRedeem({ pote: policy.poteAddress, ticketId });
      if (!res.ok) {
        // A seat refusal has ONE reader and it speaks English (R5 5.4):
        // never the raw code, never the server's Spanish detail.
        const seat = seatRefusalSentence(res.refusal, t);
        setNotice(
          seat ??
            (res.refusal.error === 'NOT_MATURE' && res.refusal.remainingSeconds
              ? `${t('Not yet — this exit matures in')} ${Math.ceil(res.refusal.remainingSeconds / 3600)} h`
              : // Ni el código crudo ni el castellano del
                // servidor. `refusalHeadline` convierte un slug en una frase y
                // el `detail` solo acompaña si está en el idioma de la pantalla.
                [refusalHeadline(res.refusal, t), serverDetailIfEnglish(res.refusal.detail)]
                  .filter((p): p is string => Boolean(p))
                  .join(' — '))
        );
        return;
      }
      if (res.data.notes.length > 0) setNotice(res.data.notes.join(' · '));
      signChainId = res.data.calls[0]?.chainId ?? 14;
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        res.data.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId }))
      );
      settlement.track(handle, { onSettled: () => void reload() });
    } catch (e) {
      const verdict = signFailureAction(e, handedToPartner, t);
      if (verdict.view === 'unconfirmed') {
        setNotice('');
        setUnconfirmed({ txHash: verdict.txHash, trace: verdict.trace, chainId: signChainId });
        setLockedTickets((m) => ({ ...m, [ticketId]: true }));
      } else {
        setNotice(verdict.message);
      }
    } finally {
      setClaimingId(null);
    }
  }

  /** `unmint: true` = XRP to the signing account; false only from the explicit FXRP button. */
  async function preparePaClaim(ticketId: number, unmint: boolean) {
    if (!xrpl.address) {
      setNotice(t('Connect the XRPL account (Xaman) that owns this exit to claim it.'));
      return;
    }
    setNotice('');
    setPaSignError('');
    setPaClaim({ ticketId, phase: 'preparing' });
    setPaStale(null);
    const res = await preparePoteClaimExit({ account: xrpl.address, pote: policy.poteAddress, ticketId, unmint });
    if (!res.ok) {
      setPaClaim({ ticketId, phase: 'refused', refusal: res.refusal });
      return;
    }
    // Kept past the payload's own life: a seat refusal on the next attempt is
    // usually THIS draft still sitting on the nonce (R1 1.5).
    if (res.data.memoHex) abandonedPaMemo.current = res.data.memoHex;
    setPaClaim({ ticketId, phase: 'ready', handoff: res.data });
  }

  async function signPaClaim() {
    if (!paClaim || paClaim.phase !== 'ready') return;
    const { ticketId, handoff } = paClaim;
    setPaSignError('');
    setPaUnconfirmed(null);
    setPaClaim({ ticketId, phase: 'signing', handoff });
    let handedToPartner = false;
    try {
      if (!xrpl.isConnected && !pinnedXrplSigner(handoff.xrplTx)) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));
      handedToPartner = true;
      const { txHash } = await xrpl.sendIntent({ tx: handoff.xrplTx as never });
      notifyHandoffSigned(handoff.memoHex, txHash);
      settlement.track(startPending('xrpl-mint', txHash));
      setLockedTickets((m) => ({ ...m, [ticketId]: true }));
      setPaClaim({ ticketId, phase: 'sent', handoff });
    } catch (e) {
      // Signed too late (R5 5.2): this payload can never validate, so
      // the honest offer is a fresh prepare — not the amber «could not confirm».
      if (describeStaleSignature(e, t)) {
        setPaStale({ ticketId, error: e });
        setPaUnconfirmed(null);
        setPaSignError('');
        setPaClaim(null);
        return;
      }
      applySignFailure(e, handedToPartner, t, {
        setError: setPaSignError,
        setUnconfirmed: setPaUnconfirmed,
        setPhase: (view) => {
          if (view === 'unconfirmed') {
            // It may already be on its way: this ticket is never offered again here.
            setLockedTickets((m) => ({ ...m, [ticketId]: true }));
            setPaClaim(null);
          } else if (view === 'review') {
            setPaClaim({ ticketId, phase: 'ready', handoff });
          }
        },
        // 'form': the payload is spent — prepare it again from the row.
        clearPrepared: () => setPaClaim(null),
      });
    }
  }

  const view = decideTicketsBoard({
    evmAddress: evm.address,
    xrplAddress: xrpl.address,
    pa: paStatus,
    personalAccount: pa,
    read,
    tickets: state?.tickets ?? [],
  });

  if (!hasWallet || view.kind === 'no-wallet') {
    return (
      <p className="text-[11px] text-ink/45">
        {t('Connect your Flare wallet or your XRPL account (Xaman) to see your exits from')} {t(policy.title)}.
      </p>
    );
  }

  const hasSideContent = !!notice || !!unconfirmed || !!paUnconfirmed || !!paClaim;

  if (view.kind === 'reading' && !hasSideContent) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink/45">
        <Loader2 className="w-3 h-3 animate-spin" /> {t('Reading your exits from')} {t(policy.title)}…
      </p>
    );
  }

  if (view.kind === 'empty' && !hasSideContent) {
    return (
      <p className="text-[11px] text-ink/40">
        {t('No pending exits in')} {t(policy.title)}.
      </p>
    );
  }

  const paCopy = paClaim && 'handoff' in paClaim ? exitCopyFor(paClaim.handoff.mode, paClaim.handoff.unminted) : null;
  // Invariant #6 (4.2): an unmint claim pays the FAssets redemption fee out of
  // the XRP the agent sends — net amount when read, gross + caveat when not.
  // The gross and the rows come from ONE reader (R3 3.2): reading
  // `exit.xrpOutHuman` here as the gross subtracted the fee a second time over a
  // figure the backend had already netted.
  const paHandoff = paClaim && 'handoff' in paClaim ? paClaim.handoff : null;
  const paFee = exitRedemption(paHandoff, paCopy?.unminted === true);
  const paGrossFxrp = paFee.grossFxrp;
  const paFeeRows = paFee.rows;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{t('My exits')} — {t(policy.title)}</h3>
        <button onClick={retry} className="text-ink/40 hover:text-ink" aria-label={t('Refresh')}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {view.kind === 'failed' ? (
        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
          <p className="text-[11px] leading-relaxed text-ink/65">
            {view.reason === 'personal-account'
              ? t('Could not resolve the Flare account of your XRPL wallet, so exits waiting there cannot be shown. That is not the same as having none.')
              : t('Could not read this pot right now — nothing to show is NOT “you have nothing”. Your exits are where they were.')}
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            <RefreshCw className="w-3 h-3" /> {t('Retry')}
          </button>
        </div>
      ) : null}

      {view.kind === 'list' && state
        ? view.tickets.map(({ ticket, rail }) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              state={state}
              rail={rail}
              onClaim={(id, r) => void claim(id, r)}
              claiming={claimingId === ticket.id || (paClaim?.ticketId === ticket.id && paClaim.phase === 'preparing')}
              locked={lockedTickets[ticket.id] === true}
            />
          ))
        : null}

      {view.kind === 'list' && view.incomplete ? (
        <p className="text-[11px] leading-relaxed text-tone-warning/80">
          {t('The Flare account of your XRPL wallet could not be resolved: exits waiting there may be missing from this list.')}{' '}
          <button type="button" onClick={retry} className="underline">
            {t('Retry')}
          </button>
        </p>
      ) : null}

      {/* The review of a Personal Account claim: the unit comes from what the backend composed. */}
      {/* A taken nonce seat, said in English and with the way out (R5
          5.4): the code and the server's Spanish paragraph never reach the
          screen, and the draft this person just abandoned can be freed. */}
      {paClaim && paClaim.phase === 'refused' && normalizeSeatRefusal(paClaim.refusal) ? (
        <SeatRefusalNotice
          refusal={paClaim.refusal}
          t={t}
          fallbackMemoHex={abandonedPaMemo.current}
          onPrepareAgain={() => void preparePaClaim(paClaim.ticketId, true)}
        />
      ) : null}

      {paStale ? (
        <StaleSignatureNotice
          error={paStale.error}
          t={t}
          onPrepareAgain={() => void preparePaClaim(paStale.ticketId, true)}
        />
      ) : null}

      {/* The claim was dropped because its payload is
          spent, and its 0xFE is still holding the seat. Said here, with the
          release, so re-claiming from the row does not meet NONCE_SEAT_TAKEN. */}
      {!paClaim && !paStale && paSignError && abandonedPaMemo.current ? (
        <AbandonedSeatNotice memoHex={abandonedPaMemo.current} t={t} />
      ) : null}

      {paClaim && paClaim.phase === 'refused' && !normalizeSeatRefusal(paClaim.refusal) ? (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5">
          {/* El titular era el CÓDIGO del servidor y debajo su
              párrafo en castellano. Un slug no es una frase: `refusalHeadline`
              lo dice en inglés, y el `detail` solo se pinta si está en el
              idioma de la pantalla. Sin él queda nuestra propia frase — jamás
              un hueco. */}
          <p className="text-[12px] font-medium text-tone-warning">
            {exitOffersFxrpAlternative(paClaim.refusal.error)
              ? t('Too small to convert back to XRP')
              : refusalHeadline(paClaim.refusal, t)}
          </p>
          <p className="text-[11px] leading-relaxed text-ink/55">
            {serverDetailIfEnglish(paClaim.refusal.detail) ??
              t('Nothing was prepared and nothing was signed: this exit is exactly where it was.')}
          </p>
          {exitOffersFxrpAlternative(paClaim.refusal.error) ? (
            <>
              <p className="text-[11px] leading-relaxed text-ink/60">
                {t('This amount is below what FAssets converts back to XRP. It can still be claimed: as FXRP, into your own Flare account — you can convert it to XRP later, once it is enough.')}
              </p>
              <button
                type="button"
                onClick={() => void preparePaClaim(paClaim.ticketId, false)}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium"
              >
                {t('Keep it as FXRP in your Flare account')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {paClaim && 'handoff' in paClaim && paCopy && (paClaim.phase === 'ready' || paClaim.phase === 'signing') ? (
        <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
          <p className="text-[12px] font-medium text-ink/80">{paClaim.handoff.disclosure.title}</p>
          <p className="font-mono text-[12px] text-ink/75">
            {t(paCopy.amountLabel)}{' '}
            {paFeeRows?.amount
              ? fillFeeText(t(paFeeRows.amount.text), paFeeRows.amount.params)
              : `≈ ${paClaim.handoff.exit.xrpOutHuman} ${paCopy.unit}`}
          </p>
          <p className="text-[11px] leading-relaxed text-ink/55">{t(paCopy.arrival)}</p>
          {paClaim.handoff.disclosure.lines.length ? (
            <ul className="space-y-1">
              {paClaim.handoff.disclosure.lines.map((line, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-ink/45">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {paCopy.unminted ? <RedemptionFeeNotice response={paClaim.handoff} grossFxrp={paGrossFxrp} t={t} /> : null}
          {paSignError ? <p className="text-[11px] leading-relaxed text-tone-warning">{paSignError}</p> : null}
          {/* Rejecting in Xaman leaves this 0xFE holding
              the seat. It is said here, with WHEN it frees itself — and the
              release is not offered while the payload is still signable, which
              is exactly what the button above still is. */}
          {paSignError && paClaim.phase === 'ready' ? (
            <AbandonedSeatNotice
              memoHex={paClaim.handoff.memoHex}
              t={t}
              stillSignable
              onPrepareAgain={() => void preparePaClaim(paClaim.ticketId, true)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void signPaClaim()}
              disabled={paClaim.phase === 'signing'}
              className="inline-flex items-center gap-2 rounded-lg bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              {paClaim.phase === 'signing' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {t('Sign in Xaman')}
            </button>
            {paClaim.phase === 'ready' ? (
              <button
                type="button"
                onClick={() => {
                  // Walking away from an UNSIGNED claim
                  // used to leave its 0xFE sitting on the nonce, so the next
                  // claim of this account met a bare NONCE_SEAT_TAKEN. Only a
                  // draft nobody signed is released, and only from here.
                  releaseHandoffSeat(paClaim.handoff.memoHex);
                  setPaSignError('');
                  setPaClaim(null);
                }}
                className="text-xs text-ink/50 hover:text-ink"
              >
                {t('Back')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {paClaim && paClaim.phase === 'sent' && paCopy ? (
        <div className="space-y-1 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
          <p className="text-[12px] font-medium">{t('Signed. On its way.')}</p>
          <p className="text-[11px] leading-relaxed text-ink/55">{t(paCopy.sent)}</p>
        </div>
      ) : null}

      {paUnconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="xrpl"
          unconfirmed={paUnconfirmed}
          onClose={() => {
            setPaUnconfirmed(null);
            void reload();
          }}
        />
      ) : null}

      {unconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="evm"
          chainId={unconfirmed.chainId}
          unconfirmed={unconfirmed}
          onClose={() => {
            setUnconfirmed(null);
            void reload();
          }}
        />
      ) : null}
      {notice && <p className="text-xs text-ink/60">{notice}</p>}
    </div>
  );
}

'use client';

/**
 * OmnibusSignDoor — the manual signature of the EXCHANGE's own account (the
 * omnibus), single-signature, in Xaman.
 *
 * Why it exists: the council doors (`CouncilSigningDoors`) prepare a MULTISIGN
 * and answer 409 NOT_A_COUNCIL for any account without a SignerList. That is
 * right for the council — a quorum is the point — and wrong for the omnibus,
 * which is an exchange's operational hot account and is single-signature
 * everywhere in the world. Using the council doors for E5/E8 silently demanded
 * a SignerList on the omnibus (found in review, 2026-08-26).
 *
 * The signer is pinned: the transaction carries the omnibus as its `Account`,
 * so the Xaman payload is created for the omnibus and Xaman asks for exactly
 * that account when scanned — whatever account is connected here (18-sep; a
 * transaction WITHOUT a pinned Account still needs the omnibus connected). The
 * door says which wallet is connected and which one signs.
 *
 * «Signed» is not «done» (13-sep): Xaman's hash is checked on the ledger before
 * `onSettled`, and a signature we could not follow never gets its button back.
 *
 * The way BACK is part of the same rule (productizer it. 4): the parent's
 * «Back» → compose again → a fresh door with empty state was a second omnibus
 * payment / 0xFE. `onBlockedChange(true)` from the hand-off until the ledger
 * settles or refuses it (in flight, unconfirmed, or spent without a settle), so
 * the parent hides its Back; `alreadyHandedOff` lets a door that REMOUNTS (the
 * stage hides stations) start in the spent state instead of offering the button.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, PenLine } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { shortHash } from '../../lib/demo-exchange/api';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import type { UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { applyXrplSignFailure, confirmOnLedger } from '../../lib/xrpl/ledgerSignOutcome';
import { onXamanPayload } from '../../lib/xaman/payloadBus';
import { flareInstructionMemoOf } from '../../lib/xaman/liveRequests';
import { notePayloadOpened, payloadExpiryMin, releaseHandoffSeatResult, releaseRefusalDetail } from '../../lib/wallet/handoffRelease';
import { seatSecondsLeft, seatWaitFrom, seatWaitText, type SeatWait } from '../../lib/demo-exchange/releaseCountdown';

/** Why the transaction is spent: only an unconfirmed ending keeps the way back closed. */
type SpentReason = 'settled' | 'failed' | 'unconfirmed';

/**
 * it. 21 (1.3) — THE SEAT'S CLOCK STARTS WHEN THE PAYLOAD EXISTS, ALSO AT THE DESK.
 *
 * `XamanSingleSign` has told the server this since it. 19; this door never did,
 * so the server kept measuring the 0xFE's life from the instant the desk
 * COMPOSED it — minutes before Xaman was even asked for a payload. A signature
 * still perfectly valid at 4:30 was read as expired, its seat handed to the next
 * instruction, and the twin landed on the omnibus nonce with the client's XRP
 * already in the Core Vault.
 *
 * This door does not create the payload itself (`useXrplWalletPartner.sendIntent`
 * → `XamanWalletService.submitTransaction` does), so the instant arrives on the
 * payload bus: the prompt carries the uuid and the `expiresAt` of the payload.
 * We take the first transaction prompt of our own hand-off and report it.
 * Anything without a window, or with a window longer than the one the SERVER
 * asked for, is ignored — stamping THAT would tie up the seat past the life of
 * the signature it is meant to protect.
 *
 * it. 23 (1.2) — THE WINDOW IS THE SERVER'S NUMBER, AND THE INSTANT IS XAMAN'S.
 * The ceiling used to be a hand-written 15 minutes next to a hand-written
 * `expire: 5`, while the backend measures the seat with
 * `HANDOFF_PAYLOAD_EXPIRY_MIN` and answers it as `payloadExpiryMin` on every
 * prepare. Lower the server's number and the seat was freed with the payload
 * still signable — the twin this rail exists to prevent. `payloadExpiryMin()`
 * (lib/wallet/handoffRelease) is the reader: the server's value when anything
 * has carried one, the shared constant otherwise, and a `preferred` that this
 * door's own prepare response wins with, without any plumbing.
 */
function maxPayloadWindowMs(expireMin: number): number {
  // The server's window plus a minute of clock slack, and never more than what
  // a single-signature payload can be (a quorum ceremony's 24 h is not ours).
  return Math.min(15 * 60_000, expireMin * 60_000 + 60_000);
}

export function OmnibusSignDoor({
  xrplTx,
  account,
  title,
  onSettled,
  onBlockedChange,
  alreadyHandedOff,
  payloadExpiryMin: serverExpiryMin,
}: {
  xrplTx: Record<string, unknown>;
  /** The account that MUST sign (the run's omnibus). */
  account: string;
  title?: string;
  /**
   * it. 23 (1.2): the `expire` (MINUTES) the SERVER measures this 0xFE's seat
   * with, as its prepare answered it. Absent → what the shared reader learned
   * from any other prepare, else the constant. Never a number invented here.
   */
  payloadExpiryMin?: number;
  onSettled: (txHash: string) => void;
  /** Told true from the hand-off until the ledger settles or refuses the payment; false after. */
  onBlockedChange?: (blocked: boolean) => void;
  /** The parent knows THIS payment already went to Xaman (read at mount only): start spent, no button. */
  alreadyHandedOff?: boolean;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const txKey = JSON.stringify(xrplTx);
  // The transaction that already went to Xaman and must not be offered again —
  // settled, validated with a failure, or unconfirmed. A NEW transaction from
  // the parent (Back → prepare again) gets its own button.
  const [spentKey, setSpentKey] = useState<string | null>(() => (alreadyHandedOff ? txKey : null));
  const [spentReason, setSpentReason] = useState<SpentReason | null>(() => (alreadyHandedOff ? 'unconfirmed' : null));
  const [settledHash, setSettledHash] = useState<string | null>(null);
  // it. 21 (3.3): what the server said about the omnibus queue place of a 0xFE
  // that was cancelled / expired in Xaman. `null` = nothing to say.
  const [seatWait, setSeatWait] = useState<SeatWait | null>(null);
  const [seatFreed, setSeatFreed] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const connected = xrpl.address ?? null;
  const matches = Boolean(connected && connected === account);
  // 18-sep (fundador, con el QR del omnibus delante y otra cuenta conectada:
  // «crea el payload… QR»). El pago ya lleva el omnibus fijado en `Account`, y
  // un Account fijado no necesita sesión: el payload se crea para ESA cuenta y
  // Xaman la pide al escanear (98900df6, `pinnedXrplSigner`; el servicio
  // resuelve el user_token por la dirección firmante, no por la conectada).
  // Esta puerta se quedó fuera de aquel arreglo y exigía cambiar de cuenta.
  const pinnedToOmnibus = pinnedXrplSigner(xrplTx) === account;
  const canSign = matches || pinnedToOmnibus;
  const spent = spentKey === txKey;

  // Blocked = a way back would offer this payment a second time. `busy` starts
  // at the hand-off (nothing awaits before it) and lasts through the ledger read.
  const blocked = busy || unconfirmed !== null || (spent && spentReason === 'unconfirmed');
  const onBlockedRef = useRef(onBlockedChange);
  onBlockedRef.current = onBlockedChange;
  const reportedRef = useRef(false);
  useEffect(() => {
    // A fresh mount never reports «not blocked»: a remounted door must not
    // reopen a Back its predecessor closed.
    if (!blocked && !reportedRef.current) return;
    reportedRef.current = true;
    onBlockedRef.current?.(blocked);
  }, [blocked]);

  // it. 20 (3.4): A COUNTDOWN THAT DOES NOT COUNT IS A FROZEN NUMBER. The line
  // below prints the seconds the SERVER measured, so the clock has to move while
  // it is on screen — and stop the moment it reaches zero.
  useEffect(() => {
    if (!seatWait) return;
    setNowMs(Date.now());
    if (seatSecondsLeft(seatWait, Date.now()) <= 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      // Past the window there is nothing left to count: stop re-rendering once a
      // second for the rest of the door's life.
      if (seatSecondsLeft(seatWait, t) <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [seatWait]);
  const seatSecs = seatWait ? seatSecondsLeft(seatWait, nowMs) : 0;

  /**
   * it. 21 (3.3) — CANCELLING IS A CHOICE; BEING LEFT WITHOUT A SENTENCE IS NOT.
   *
   * Rejecting in Xaman (or closing the tab) does NOT free the omnibus nonce seat,
   * and that is right: while the payload can still be signed, freeing it would
   * put a second instruction on the same nonce. What was missing is the sentence.
   * We ask the server — it owns the rule (`classifySeatSignability`) — and show
   * its answer: freed, or how long the place stays taken.
   */
  async function askToFreeTheSeat(memo: string) {
    setReleasing(true);
    try {
      const r = await releaseHandoffSeatResult(memo);
      if (r.kind === 'ok') {
        const released = (r.body as { released?: unknown } | undefined)?.released === true;
        setSeatWait(null);
        setSeatFreed(
          released
            ? t('Its place in the omnibus queue is free again — prepare this one again when you want.')
            : t('The server had no place of this one to free: either it was never taken, or that signature already landed. Check the omnibus account history before preparing it again.'),
        );
        return;
      }
      if (r.kind === 'refused') {
        setSeatFreed(null);
        setSeatWait(seatWaitFrom(r.secondsLeft, Date.now(), releaseRefusalDetail(r) ?? undefined));
        return;
      }
      // Never reached the server: say that, and do not invent a window.
      setSeatFreed(null);
      setSeatWait(seatWaitFrom(undefined, Date.now(), releaseRefusalDetail(r) ?? undefined));
    } finally {
      setReleasing(false);
    }
  }

  async function sign() {
    if (busy || unconfirmed || spent) return;
    const key = txKey;
    setError('');
    setSeatWait(null);
    setSeatFreed(null);
    setBusy(true);
    let handedToPartner = false;
    let settled: string | null = null;
    // The 0xFE memo this Payment carries: what names the seat to the server.
    // A plain payout (the other user of this door) has none, and reports nothing.
    const memoHex = flareInstructionMemoOf(xrplTx);
    // The window this payload is being minted with: the server's, never a 5
    // written here (it. 23, 1.2). The same number caps what we are willing to
    // stamp back, so the seat and the payload can never disagree.
    const expireMin = payloadExpiryMin(serverExpiryMin);
    const maxWindowMs = maxPayloadWindowMs(expireMin);
    // it. 23 (1.2) — Y EL INSTANTE ES EL QUE DEVOLVIÓ XAMAN, NO NUESTRA
    // CONJETURA. `XamanWalletService` pone el QR en pantalla con la ventana que
    // PIDIÓ y, un viaje de ida y vuelta después, la reemplaza por el
    // `expires_at` que Xaman está contando de verdad (`correctPayloadExpiry`).
    // Sellar solo el primer aviso guardaba la conjetura para siempre: se sella
    // el primero y se RE-SELLA la corrección del MISMO payload — nunca la de
    // otra ceremonia, y nunca dos veces el mismo instante.
    let sealedUuid: string | null = null;
    let sealedAt: number | null = null;
    const stopWatching = memoHex
      ? onXamanPayload((prompt) => {
          if (!prompt || prompt.purpose !== 'transaction') return;
          const expiresAt = typeof prompt.expiresAt === 'number' ? prompt.expiresAt : null;
          if (expiresAt === null || expiresAt - Date.now() > maxWindowMs) return;
          if (sealedUuid !== null && prompt.uuid !== sealedUuid) return;
          if (sealedAt === expiresAt) return;
          sealedUuid = prompt.uuid ?? sealedUuid;
          sealedAt = expiresAt;
          // Best effort, never blocking: an older backend answers 404 and the
          // window keeps being measured exactly as it was before — never worse.
          notePayloadOpened(memoHex, new Date(expiresAt));
        })
      : null;
    try {
      handedToPartner = true;
      const { txHash } = await xrpl.sendIntent({ tx: xrplTx as never });
      // Xaman's hash is the wallet's word. The omnibus payment is done only
      // when the ledger validates it with tesSUCCESS.
      settled = await confirmOnLedger(txHash);
      setSpentKey(key);
      setSpentReason('settled');
      setSettledHash(settled);
    } catch (e) {
      // Signing and failing to deliver are different things. Cancelled /
      // expired / never connected → the button stays. Validated with a failure
      // → prepare it again. Anything we could not read → amber, no button.
      const action = applyXrplSignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase: () => {},
        clearPrepared: () => {
          setSpentKey(key);
          setSpentReason('failed');
        },
      });
      if (action.view === 'unconfirmed') {
        setSpentKey(key);
        setSpentReason('unconfirmed');
      }
      // 'review' is the ending where NOTHING moved — cancelled, expired, never
      // connected — and the only one where the seat could be free to take back.
      if (action.view === 'review' && memoHex) void askToFreeTheSeat(memoHex);
    } finally {
      stopWatching?.();
      setBusy(false);
    }
    if (settled) onSettled(settled);
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-ink/10 bg-surface-2 p-3 text-[11px] text-ink/60 space-y-1">
        <div>
          {t('Signs')}: <span className="font-mono text-ink">{shortHash(account, 10, 6)}</span> — {t('the exchange omnibus (single signature, its own hot account)')}
        </div>
        <div>
          {t('Connected in Xaman')}:{' '}
          <span className={`font-mono ${matches ? 'text-tone-success' : 'text-tone-warning'}`}>
            {connected ? shortHash(connected, 10, 6) : t('nothing')}
          </span>
        </div>
      </div>
      {!matches && pinnedToOmnibus ? (
        <p className="text-[11px] text-ink/55">
          {t('The QR is created for the omnibus: scan it with the Xaman that holds that account. The account connected here does not need to change.')}
        </p>
      ) : !matches ? (
        <p className="text-[11px] text-tone-warning">
          {connected
            ? t('Connect the omnibus account in Xaman to sign this — the connected one is a different account.')
            : t('Connect the omnibus account in Xaman to sign this.')}
        </p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {seatFreed ? <p data-testid="omnibus-seat-freed" className="text-[11px] text-ink/60">{seatFreed}</p> : null}
      {seatWait ? (
        <div className="space-y-1">
          <p data-testid="omnibus-seat-wait" className="text-[11px] text-tone-warning">{seatWaitText(seatWait, nowMs, t)}</p>
          {seatWait.detail ? <p className="text-[11px] text-ink/45">{seatWait.detail}</p> : null}
          {seatSecs <= 0 ? (
            <button
              type="button"
              disabled={releasing}
              onClick={() => { const memo = flareInstructionMemoOf(xrplTx); if (memo) void askToFreeTheSeat(memo); }}
              className="rounded-full border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {releasing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {t('Free its place in the queue')}
            </button>
          ) : null}
        </div>
      ) : null}
      {unconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="xrpl"
          xrplKind="payment"
          unconfirmed={unconfirmed}
          onClose={() => setUnconfirmed(null)}
        />
      ) : spent && settledHash ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-tone-success">
          <Check className="w-3.5 h-3.5" /> {t('Validated on the ledger')} · <span className="font-mono">{shortHash(settledHash)}</span>
        </p>
      ) : spent ? (
        <p className="text-[11px] text-tone-warning">
          {t('This transaction already went to Xaman. Check the omnibus account history before preparing it again.')}
        </p>
      ) : (
        <button
          onClick={sign}
          disabled={busy || !canSign}
          className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
          {title ?? t('Sign in Xaman')}
        </button>
      )}
    </div>
  );
}

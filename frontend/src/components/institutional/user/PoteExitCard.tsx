/**
 * PoteExitCard — sacar tu capital del pote de vuelta a tu cuenta XRPL.
 *
 * El lado usuario del modo no-custodial: quien entró firmando con Xaman tiene
 * sus participaciones en su Personal Account, que no firma sola. Esta tarjeta
 * prepara UNA firma y el XRP aterriza en su misma r-address — no hay campo de
 * destino, a propósito: se vuelve por donde se vino.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Loader2, Info } from 'lucide-react';
import { useT } from '../../../i18n/LanguageProvider';
import { pinnedXrplSigner, useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { useSettlement } from '../../../lib/settlement/useSettlement';
import { startPending } from '../../../lib/settlement/settlement';
import { notifyHandoffSigned, releaseHandoffSeat } from '../../../lib/wallet/handoffRelease';
import {
  getPoteState,
  preparePoteExit,
  type PoteExitHandoff,
  type PoteState,
  type Refusal,
} from '../../../lib/institutional/api';
import { exitCopyFor, exitOffersFxrpAlternative } from '../../../lib/institutional/exitCopy';
import { serverDetailIfEnglish } from '../../../lib/xaman/seatRefusal';
import { applySignFailure, type UnconfirmedSignature } from '../../../lib/wallet/signOutcome';
import {
  AbandonedSeatNotice,
  SeatRefusalNotice,
  StaleSignatureNotice,
  describeStaleSignature,
  normalizeSeatRefusal,
} from '../../wallet/SeatRefusalNotice';
import { UnconfirmedSignatureNotice } from '../../settlement/UnconfirmedSignatureNotice';
import { RedemptionFeeNotice } from '../../../lib/fassets/RedemptionFeeNotice';
import { exitRedemption } from '../../../lib/fassets/redemptionFeeRow';
import { fillFeeText } from '../../../lib/wallet/paDispatchDisclosure';

// 'unconfirmed' has no way back to 'ready': the exit may already be on its way.
type Phase = 'idle' | 'preparing' | 'ready' | 'signing' | 'sent' | 'unconfirmed';

/** The backend also returns `unminted`; the shared type does not mirror it yet. */
type PreparedExit = PoteExitHandoff & { unminted?: boolean };

export function PoteExitCard({ pote, account }: { pote: string; account: string }) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const settlement = useSettlement();

  const [state, setState] = useState<PoteState | null>(null);
  /** null = todavía no se sabe. Distinto de 0, que sí es una respuesta. */
  const [stateUnreadable, setStateUnreadable] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [prepared, setPrepared] = useState<PreparedExit | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [signError, setSignError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  /**
   * A signature that arrived too late (R5 5.2). `tefMAX_LEDGER` /
   * `tefPAST_SEQ` mean this exact payload can never validate — nothing moved and
   * nothing will — so the card says «prepare it again» instead of the amber
   * «we could not confirm it, reload», which sends people hunting for money that
   * never left.
   */
  const [staleSign, setStaleSign] = useState<unknown>(null);
  /**
   * The memo of the LAST exit this card prepared. Kept after the card drops the
   * payload so that a seat refusal on the next attempt can offer to free the
   * very draft this person just walked away from (R1 1.5).
   */
  const abandonedMemo = useRef<string | null>(null);

  /**
   * LEAVING THIS CARD WITH AN UNSIGNED EXIT ON THE TABLE.
   *
   * The prepared 0xFE holds the nonce seat of the Personal Account until its
   * signing window passes, and this card was the only 0xFE surface that never
   * released it: reject in Xaman, navigate away, come back, and the next exit
   * met a bare `NONCE_SEAT_TAKEN` — on an EXIT, which is the one thing that is
   * never gated. Same rule as every other surface (`VaultWithdrawModal`): the
   * seat is released only from the REVIEW state — a draft nobody signed. While
   * the signature is in flight the phase is 'signing' and closing releases
   * nothing; after it lands the phase is 'sent' and the seat is untouchable.
   */
  const seatRef = useRef<{ memoHex?: string; abandonable: boolean }>({ abandonable: false });
  seatRef.current = {
    memoHex: prepared?.memoHex,
    abandonable: Boolean(prepared?.memoHex) && phase === 'ready',
  };
  useEffect(() => {
    return () => {
      if (seatRef.current.abandonable) releaseHandoffSeat(seatRef.current.memoHex);
    };
  }, []);

  const loadState = useCallback(async () => {
    try {
      setState(await getPoteState(pote));
      setStateUnreadable(false);
    } catch {
      // «No he podido leer» no es «no tienes nada»: la tarjeta lo dice así.
      setStateUnreadable(true);
    }
  }, [pote]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  /**
   * `unmint: true` es la promesa de la tarjeta (XRP a la cuenta que firma).
   * `unmint: false` solo lo pide el botón explícito «quedármelo como FXRP».
   */
  async function prepare(unmint: boolean) {
    setPhase('preparing');
    setRefusal(null);
    setSignError('');
    setStaleSign(null);
    setPrepared(null);

    const res = await preparePoteExit({ account, pote, unmint });
    if (!res.ok) {
      setRefusal(res.refusal);
      setPhase('idle');
      return;
    }
    const data = res.data as PreparedExit;
    if (data.memoHex) abandonedMemo.current = data.memoHex;
    setPrepared(data);
    setPhase('ready');
  }

  async function sign() {
    if (!prepared) return;
    setSignError('');
    setUnconfirmed(null);
    setStaleSign(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      if (!xrpl.isConnected && !pinnedXrplSigner(prepared.xrplTx)) throw new Error(t('Connect your XRPL wallet (Xaman) to continue'));

      handedToPartner = true;
      const { txHash } = await xrpl.sendIntent({ tx: prepared.xrplTx as never });

      // El backend aprende «firmado»: el asiento de nonce
      // queda intocable — ni TTL, ni release, ni supersede — hasta ejecutar. Sin
      // esto, un executor lento más un reintento firman un gemelo condenado.
      notifyHandoffSigned(prepared.memoHex, txHash);
      settlement.track(startPending('xrpl-mint', txHash));
      setPhase('sent');
    } catch (e) {
      // TOO LATE IS NOT «I COULD NOT READ» (R5 5.2). A tefMAX_LEDGER /
      // tefPAST_SEQ is a verdict we DID read: this payload can never validate,
      // nothing moved, and the way forward is a fresh prepare — never the amber
      // panel, which forbids exactly the retry that is correct here.
      if (describeStaleSignature(e, t)) {
        setStaleSign(e);
        setUnconfirmed(null);
        setSignError('');
        setPrepared(null);
        setPhase('idle');
        return;
      }
      // Firmar y fallar al entregar son cosas distintas. Tras entregarlo a
      // Xaman, un error que no PRUEBA que nada salió («Failed to retrieve
      // transaction hash from payload»: Xaman ya firmó y envió) acaba en
      // 'unconfirmed' — jamás de vuelta al botón de firma. Las vistas de
      // signFailureAction se traducen aquí, a la vista:
      //   unconfirmed → 'unconfirmed' · form (payload gastado) → 'idle' · review → 'ready'
      applySignFailure(e, handedToPartner, t, {
        setError: setSignError,
        setUnconfirmed,
        setPhase: (view) => setPhase(view === 'unconfirmed' ? 'unconfirmed' : view === 'form' ? 'idle' : 'ready'),
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  const shares = state?.holder?.shares;
  // BigInt(0) y no 0n: el target de tsc del frontend es anterior a ES2020.
  const hasNothing = shares !== undefined && BigInt(shares) === BigInt(0);

  // Lo que se promete sale de lo que el backend COMPUSO, no de lo que se pidió.
  const copy = prepared ? exitCopyFor(prepared.mode, prepared.unminted) : null;
  const offersFxrp = refusal ? exitOffersFxrpAlternative(refusal.error) : false;
  const seatRefusal = normalizeSeatRefusal(refusal);

  // Invariant #6 (4.2): an unmint pays the FAssets
  // redemption fee out of the XRP the agent sends, so the amount row shows the
  // net when the fee was read and the gross with its caveat when it was not —
  // never the gross as a promise.
  //
  // ONE READER (R3 3.2). The card used to parse `exit.xrpOutHuman` as
  // the gross and subtract the fee again over a figure the backend had already
  // netted: two different nets on the same screen. `exitRedemption` knows which
  // shape the response has and hands back the gross and the rows together.
  const exitFee = exitRedemption(prepared, copy?.unminted === true);
  const grossFxrp = exitFee.grossFxrp;
  const feeRows = exitFee.rows;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="flex items-center gap-2">
        <ArrowDownToLine size={16} className="text-ink/60" />
        <h3 className="text-sm font-medium">
          {copy && copy.unit === 'FXRP' ? t('Take your capital out of the pot') : t('Take your capital back to XRP')}
        </h3>
      </header>

      <p className="text-[12px] leading-relaxed text-ink/55">
        {copy
          ? t(copy.arrival)
          : t('One signature in Xaman. Your share of the pot leaves, converts back to XRP, and lands in the same account you are signing with.')}
      </p>

      {stateUnreadable ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-ink/60">
          {t('Could not read the pot right now. This says nothing about your capital — it is where it was. Try again in a moment.')}
        </p>
      ) : null}

      {hasNothing ? (
        <p className="text-[12px] text-ink/50">{t('You have no shares in this pot.')}</p>
      ) : null}

      {phase === 'idle' || phase === 'preparing' ? (
        <button
          type="button"
          onClick={() => void prepare(true)}
          disabled={phase === 'preparing' || hasNothing}
          className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium disabled:opacity-40"
        >
          {phase === 'preparing' ? <Loader2 size={14} className="animate-spin" /> : null}
          {t('Prepare the exit')}
        </button>
      ) : null}

      {/* A TAKEN SEAT IS NOT A REFUSAL OF THE EXIT (R5 5.4). It is an
          earlier 0xFE of this same account holding the nonce, it is said in
          English by the one reader of that verdict, and — when the draft is the
          one this person just abandoned — it comes with the way out instead of
          the server's Spanish paragraph full of hashes. */}
      {seatRefusal ? (
        <SeatRefusalNotice
          refusal={refusal}
          t={t}
          fallbackMemoHex={abandonedMemo.current}
          onPrepareAgain={() => void prepare(true)}
        />
      ) : null}

      {staleSign ? (
        <StaleSignatureNotice error={staleSign} t={t} onPrepareAgain={() => void prepare(true)} />
      ) : null}

      {/* CANCELAR EN XAMAN NO LIBERA EL ASIENTO, Y NADIE
          LO DECÍA. Tras un rechazo (o un payload caducado) el 0xFE preparado
          sigue sentado en el nonce: la tarjeta lo dice, dice CUÁNDO se suelta, y
          ofrece soltarlo en cuanto el payload deja de estar en pantalla —
          mientras siga firmable, soltarlo sería matar una firma que esta persona
          todavía puede dar. */}
      {signError && !staleSign && abandonedMemo.current ? (
        <AbandonedSeatNotice
          memoHex={abandonedMemo.current}
          t={t}
          stillSignable={phase === 'ready' && Boolean(prepared)}
          onPrepareAgain={() => void prepare(true)}
        />
      ) : null}

      {refusal && !seatRefusal ? (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5">
          <p className="text-[12px] font-medium text-tone-warning">{refusalHeadline(refusal.error, t)}</p>
          {/* EL `detail` DEL SERVIDOR NO SE PINTA A CIEGAS.
              Varias de estas negativas se componen en castellano (y alguna con
              hashes dentro), y esta tarjeta las imprimía tal cual bajo un
              titular en inglés: la persona lee un idioma que la pantalla no
              habla y no aprende nada. Se filtra SIEMPRE, y cuando no sobrevive
              queda nuestra propia frase — nunca un hueco, que es la otra forma
              de no decir nada. Arreglar el origen es de otro agente; esta
              pantalla no puede depender de que lo esté. */}
          <p className="text-[11px] leading-relaxed text-ink/55">
            {serverDetailIfEnglish(refusal.detail) ??
              t('Nothing was prepared and nothing was signed: your capital is exactly where it was. Try again in a moment, and write to us if it keeps refusing.')}
          </p>
          {offersFxrp ? (
            <>
              {/* La salida no se gatea por el mínimo de FAssets: lo que no se
                  puede desmintear SÍ puede salir del pote, como FXRP. Se ofrece
                  en alto y con su unidad — jamás como si fuera XRP. */}
              <p className="text-[11px] leading-relaxed text-ink/60">
                {t('This amount is below what FAssets converts back to XRP. It can still leave the pot: as FXRP, into your own Flare account — you can convert it to XRP later, once it is enough.')}
              </p>
              <button
                type="button"
                onClick={() => void prepare(false)}
                disabled={phase === 'preparing'}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium disabled:opacity-40"
              >
                {phase === 'preparing' ? <Loader2 size={14} className="animate-spin" /> : null}
                {t('Keep it as FXRP in your Flare account')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {prepared && copy && (phase === 'ready' || phase === 'signing') ? (
        <div className="space-y-3">
          <dl className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[12px]">
            <Row label={t('You take out')} value={`${prepared.exit.sharesHuman} ${state?.symbol ?? ''}`} />
            <Row
              label={t(copy.amountLabel)}
              value={
                feeRows?.amount
                  ? fillFeeText(t(feeRows.amount.text), feeRows.amount.params)
                  : `≈ ${prepared.exit.xrpOutHuman} ${copy.unit}`
              }
            />
            <Row
              label={t(copy.destinationLabel)}
              value={copy.destination === 'xrpl-account' ? prepared.account : prepared.personalAccount}
              mono
            />
            {prepared.mode === 'request' && prepared.maturityISO ? (
              <Row label={t('Claimable from')} value={new Date(prepared.maturityISO).toLocaleString()} />
            ) : null}
          </dl>

          {/* El margen se explica SIEMPRE que se desmintea, no solo cuando alguien
              pregunta: es la diferencia entre lo que ve previsto y lo que le llega.
              Sin desminteo no hay margen que explicar. */}
          {copy.unminted ? (
            <p className="flex gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-ink/55">
              <Info size={13} className="mt-0.5 shrink-0 text-ink/40" />
              <span>
                {t('A small part is left un-converted on purpose: the share price can move while the network proves your signature. That part is NOT lost — it stays as FXRP in your own Flare account and you can take it out whenever you want.')}
              </span>
            </p>
          ) : null}

          {prepared.disclosure?.lines?.length ? (
            <ul className="space-y-1">
              {prepared.disclosure.lines.map((line, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-ink/45">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The FAssets redemption fee, with its figure or «could not be read —
              it is not zero», right before the signature. */}
          {copy.unminted ? <RedemptionFeeNotice response={prepared} grossFxrp={grossFxrp} t={t} /> : null}

          {signError ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">
              {signError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void sign()}
            disabled={phase === 'signing'}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium disabled:opacity-40"
          >
            {phase === 'signing' ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('Sign in Xaman')}
          </button>
        </div>
      ) : null}

      {phase === 'unconfirmed' && unconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="xrpl"
          unconfirmed={unconfirmed}
          onClose={() => {
            setUnconfirmed(null);
            void loadState();
          }}
        />
      ) : null}

      {phase === 'unconfirmed' && !unconfirmed ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-ink/60">
          {t('A signature for this exit could not be confirmed. Check your XRPL account and your share balance before preparing another exit — reload the page to start again.')}
        </p>
      ) : null}

      {phase === 'sent' ? (
        <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[12px] font-medium">{t('Signed. On its way.')}</p>
          <p className="text-[11px] leading-relaxed text-ink/55">
            {copy
              ? t(copy.sent)
              : t('The network is proving your signature before Flare acts on it — that usually takes a couple of minutes, and nobody at Astryum takes part in it.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink/45">{label}</dt>
      <dd className={mono ? 'truncate font-mono text-[11px] text-ink/70' : 'text-ink/80'}>{value}</dd>
    </div>
  );
}

/**
 * El titular de cada negativa. El backend ya manda un `detail` que dice qué
 * hacer; esto solo pone nombre a la situación, y nunca la llama «error» cuando
 * lo que pasa es que el capital está trabajando.
 */
function refusalHeadline(error: string, t: (s: string) => string): string {
  switch (error) {
    case 'NOT_REDEEMABLE_NOW':
      return t('Not available to take out right now');
    case 'NO_SHARES':
      return t('Nothing to take out');
    case 'NOT_ENOUGH_SHARES':
    case 'ABOVE_MAX_REDEEM':
      return t('More than you can take out right now');
    case 'BELOW_FASSETS_MINIMUM':
      return t('Too small to convert back to XRP');
    case 'NO_PERSONAL_ACCOUNT':
      return t('Your Flare account is not ready yet');
    case 'NONCE_SEAT_TAKEN':
      return t('You already have one on the way');
    default:
      return t('Cannot prepare this exit');
  }
}

'use client';

/**
 * quorumCeremonyBus — el desvío a la ceremonia multifirma, en UN solo sitio.
 *
 * EL FALLO QUE CIERRA (fundador, 22-ago-2026, tras tres intentos míos de
 * parchear pantallas sueltas: «me pide sólo un puto QR»).
 *
 * En este front hay DIECISIETE llamadas a `sendIntent`: enviar, Kinetic lend,
 * el vault, las posiciones, los moneyflows, la ceremonia del Legacy… Todas
 * terminan en un payload de Xaman con `multi_sign: false`: un QR, una firma.
 * Sobre una cuenta reforzada eso no vale nunca — la firma no cuenta para el
 * quórum y, con la llave maestra apagada, la red la rechaza sin más.
 *
 * Arreglar la pantalla en la que uno se tropieza es cómo se llega a diecisiete
 * copias que se desincronizan. Así que el desvío vive en el CUELLO DE BOTELLA
 * (`sendIntent`) y cada superficie sigue escribiendo `await sendIntent(...)`
 * sin enterarse: si la cuenta firma sola, el camino de siempre; si tiene
 * quórum, se abre la ceremonia —un QR por llave, todos a la vez— y esa misma
 * promesa devuelve el hash cuando el quórum se reúne y se emite.
 *
 * Mismo patrón que `payloadBus` + `XamanQRModal`: un bus de módulo y UN modal
 * montado arriba del todo. Aquí no hay estado global de negocio: sólo una
 * petición viva y su promesa.
 */

import { paymentMemoHex, type CeremonyDispatchEvent } from './councilSigning';
import { releaseCeremonySeat } from '../wallet/handoffRelease';
import { RECEIPT_UNREAD } from '../wallet/inFlightError';

export interface QuorumCeremonyRequest {
  /** La transacción SIN FIRMAR, tal y como la compuso quien llama. */
  readonly tx: Record<string, unknown>;
  /** La cuenta XRPL con quórum que debe firmarla. */
  readonly account: string;
  /** Resuelve con el hash emitido; rechaza si se abandona. */
  readonly resolve: (txHash: string) => void;
  readonly reject: (err: Error) => void;
}

type Listener = (req: QuorumCeremonyRequest | null) => void;

const listeners = new Set<Listener>();
let current: QuorumCeremonyRequest | null = null;

/* ── it. 31 (§1) — LO QUE LA CEREMONIA HA HECHO CON LOS BYTES, VISTO DESDE EL BUS ── */

/**
 * WHAT FAILED IN SILENCE (it. 29 §1, the door it opened). `abandonQuorumCeremony`
 * handed the nonce seat back on EVERY close, without looking at what the sitting
 * had done. The flow hides its «Cancel» once it enters `submitting`
 * (`ceremonyExit`), the bus did not: after `broadcast()` returned a hash and
 * `submitAndConfirm` gave up waiting for validation (20 s), the screen read
 * «Broadcast accepted — still waiting for ledger validation» with NO button, so
 * closing the dialog was the only way out — and closing it released the seat of
 * a Payment that was ALREADY on its way to the ledger. Nobody had reported the
 * hash to `/handoff/signed` either, so with the coordinator's pin in place the
 * server's clock was replaced and a tx emitted two seconds earlier was not yet
 * in the memo's ledger window: `'absent'`, row `superseded`. The executor runs
 * the row anyway (`findHandoffByUserOpHash` ignores status) and the next
 * prepare's guard sees no `queued` row on that nonce → a second 0xFE over the
 * same seat. The XRP is paid twice.
 *
 * So the bus keeps, per live request, what the flow has done with the bytes —
 * the flow reports it through its `onDispatch` prop and the modal writes it
 * here. Three facts decide what a close MEANS:
 *
 *   · never started (`idle`): the sitting pinned nothing, but the dispatch the
 *     caller prepared still holds the account's seat for its whole window. The
 *     close asks the server to release it, so the server's own verdict — held,
 *     and for how long (`seat.secondsLeft`) — reaches the banner (it. 31 §3);
 *   · started, not committed (`preparing` / `signing` / an `error` before any
 *     broadcast): the caller is told ABANDONED (nothing left: `signOutcome` →
 *     'not-sent'), and the seat is handed back by the FLOW's own unmount cleanup
 *     — the one place that covers this modal AND the sixteen inline hosts that
 *     never pass through this bus (it. 31 §2);
 *   · committed (`submitting` onwards): the seat is NEVER released from here.
 *     With a hash the node accepted and no validation read yet, the caller gets
 *     the hash — exactly what a single Xaman signature returns after submit, so
 *     its settlement watcher takes over. Anything else it gets as an in-flight
 *     error (`RECEIPT_UNREAD`, hash attached when there is one): «it may be out
 *     there, do NOT sign it again». A node that refused with tefPAST_SEQ /
 *     tefMAX_LEDGER travels in the text, so `signOutcome` reads it as 'stale'.
 */
export interface CeremonyDispatch {
  /** `/multisign/prepare` was requested: the sitting pins (or pinned) the seat. */
  started?: boolean;
  /** Combining and broadcasting from here: a close never hands the seat back. */
  committed?: boolean;
  hash?: string;
  /** The node's PRELIMINARY engine result, when `broadcast()` returned one. */
  engine?: string;
  message?: string;
  /** True once the tx was seen in a VALIDATED ledger. */
  validated?: boolean;
  finalResult?: string;
  /**
   * it. 33 (B2): `broadcast()` threw — no node CONFIRMED taking the bytes. Not
   * «nothing went out»: the first node may have applied them and lost its
   * answer. The failure text travels in `message`.
   */
  broadcastFailed?: boolean;
}

const dispatches = new WeakMap<QuorumCeremonyRequest, CeremonyDispatch>();

/**
 * The host writes what the flow reported. Only the LIVE request can be marked:
 * a `submit()` continuation of a sitting that was already closed (its promise
 * answered, its screen gone) must not write over the ceremony that replaced it.
 */
export function markQuorumCeremonyDispatch(req: QuorumCeremonyRequest, patch: CeremonyDispatch): void {
  if (current !== req) return;
  dispatches.set(req, { ...(dispatches.get(req) ?? {}), ...patch });
}

/** What the bus knows about a request's dispatch. Tests and the close read it. */
export function quorumCeremonyDispatch(req: QuorumCeremonyRequest): CeremonyDispatch | null {
  return dispatches.get(req) ?? null;
}

/**
 * The flow's report, as the patch the bus keeps. Pure. A new sitting
 * (`started`) clears whatever a previous sitting of the same request left —
 * «Cancel this ceremony» then «Sign now» again is one request, two sittings.
 */
export function ceremonyDispatchPatch(event: CeremonyDispatchEvent): CeremonyDispatch {
  const fresh: CeremonyDispatch = {
    committed: false,
    hash: undefined,
    engine: undefined,
    message: undefined,
    validated: undefined,
    finalResult: undefined,
    broadcastFailed: undefined,
  };
  switch (event.stage) {
    case 'started':
      return { ...fresh, started: true };
    case 'abandoned':
      return { ...fresh, started: false };
    case 'submitting':
      return { started: true, committed: true };
    case 'broadcast':
      return { started: true, committed: true, hash: event.hash, engine: event.engine, message: event.message };
    case 'broadcast-failed':
      // Merged over what is there: a hash the node DID hand back earlier (a throw
      // after the broadcast) is never erased by the failure that followed it.
      return { started: true, committed: true, broadcastFailed: true, message: event.message };
    case 'validation':
      return {
        started: true,
        committed: true,
        hash: event.hash,
        validated: event.validated,
        finalResult: event.finalResult,
      };
  }
}

/**
 * it. 33 (B2) — CAN THIS REPORT UNDO WHAT THE BUS ALREADY KNOWS?
 *
 * WHAT FAILED IN SILENCE. `abandon()` — the «Cancel this ceremony» button — ended
 * with `{stage:'abandoned'}`, and the patch for that is `{committed:false,
 * started:false}`: a sitting that had COMMITTED bytes to a node (a broadcast that
 * threw lands on `error`, where the button was still offered) was reduced to
 * «never started». The Escape that followed took the never-started branch,
 * released the seat a second time and rejected ABANDONED — `signOutcome` then
 * said «nothing left» over a Payment that may be on the ledger.
 *
 * The flow no longer sends `abandoned` over a committed sitting; this is the
 * bus's own half of the same rule, so a host that reports faithfully cannot be
 * made to forget a commitment by a later, weaker report. Pure.
 */
export function dispatchReportAdmissible(prior: CeremonyDispatch | null | undefined, event: CeremonyDispatchEvent): boolean {
  if (event.stage !== 'abandoned') return true;
  return prior?.committed !== true;
}

/** The modal's one-liner: report → patch → the live request's record. */
export function reportQuorumCeremonyDispatch(req: QuorumCeremonyRequest, event: CeremonyDispatchEvent): void {
  if (!dispatchReportAdmissible(dispatches.get(req), event)) return;
  markQuorumCeremonyDispatch(req, ceremonyDispatchPatch(event));
}

/** The code a close carries when the sitting had already committed to a broadcast. */
export const CEREMONY_CLOSED_IN_FLIGHT = 'QUORUM_CEREMONY_CLOSED_IN_FLIGHT';

/**
 * Se suscribe el modal global. Recibe el estado actual al montarse.
 *
 * El aviso inicial va BLINDADO igual que los demás: sin el try, un oyente que
 * reventara al montarse dejaba su propia suscripción dentro del set —el `add`
 * ya había ocurrido— y jamás recibía su función de baja. Ese oyente fantasma
 * hacía creer al bus que había modal, así que las ceremonias siguientes no
 * rechazaban con NO_HOST: se quedaban esperando a nadie. Exactamente la promesa
 * colgada que este módulo existe para impedir.
 */
export function onQuorumCeremony(cb: Listener): () => void {
  listeners.add(cb);
  try {
    cb(current);
  } catch {
    /* un oyente roto no se lleva por delante su propia baja */
  }
  return () => {
    listeners.delete(cb);
    // it. 29 (§1) — DESMONTAR EL ANFITRIÓN TAMBIÉN ES CERRAR.
    //
    // The modal is mounted once, in `WalletProvider`. When it goes away — a
    // navigation that re-mounts the provider, a layout swap, a route that does
    // not carry it — the ceremony it was hosting has no surface left, so it is
    // over whether anybody pressed anything or not. Before this, the request
    // simply stopped being rendered: its promise stayed pending for ever and its
    // 0xFE nonce seat stayed taken for 24 h, with the only rescue button living
    // inside the screen that had just disappeared.
    if (listeners.size === 0) abandonQuorumCeremony();
  };
}

function emit(req: QuorumCeremonyRequest | null): void {
  current = req;
  for (const cb of listeners) {
    try {
      cb(req);
    } catch {
      /* un oyente roto no puede tumbar a los demás */
    }
  }
}

/** El error con el que se rechaza una ceremonia abandonada. */
export const CEREMONY_ABANDONED = 'QUORUM_CEREMONY_ABANDONED';

/**
 * Pide la ceremonia y espera su resultado.
 *
 * Si NADIE la escucha (el modal no está montado) rechaza en el acto en vez de
 * dejar la promesa colgada para siempre: una firma que nunca vuelve es
 * indistinguible de una app rota, y esta casa ya tuvo bastante con un recibo
 * eterno.
 */
export function requestQuorumCeremony(tx: Record<string, unknown>, account: string): Promise<string> {
  if (listeners.size === 0) {
    return Promise.reject(
      new Error('QUORUM_CEREMONY_NO_HOST: this account signs by quorum and no ceremony surface is mounted'),
    );
  }
  if (current) {
    return Promise.reject(new Error('QUORUM_CEREMONY_BUSY: another ceremony is already collecting signatures'));
  }
  return new Promise<string>((resolve, reject) => {
    // it. 31 (§6): a request only clears the bus if it is STILL the live one. The
    // `submit()` continuation of an abandoned sitting used to `emit(null)` on
    // settling and erase the ceremony that had replaced it — a live modal over a
    // request the bus no longer knew, and a promise nobody could answer.
    const req: QuorumCeremonyRequest = {
      tx,
      account,
      resolve: (hash) => {
        if (current === req) emit(null);
        resolve(hash);
      },
      reject: (err) => {
        if (current === req) emit(null);
        reject(err);
      },
    };
    emit(req);
  });
}

/**
 * it. 29 (§1) — CERRAR ES ABANDONAR, Y ABANDONAR DEVUELVE EL ASIENTO.
 *
 * WHAT FAILED IN SILENCE. The modal has four ways out and only ONE of them gave
 * the seat back. Escape, a click on the backdrop and the X all land here
 * (`QuorumCeremonyModal`), and all this did was reject the caller's promise —
 * React then unmounted `CouncilMultisigFlow` with no cleanup at all.
 * `releaseCeremonySeat` had exactly one caller in production: the «Cancel this
 * ceremony» BUTTON inside that screen. So the person closed the dialog, their
 * screen said «cancelled», and their council account kept the 0xFE nonce seat for
 * TWENTY-FOUR HOURS — with no way back, because reaching that button means being
 * inside a ceremony and opening one answers 409 NONCE_SEAT_TAKEN with
 * `secondsLeft ≈ 86400`. If that 0xFE was an EXIT, it was an exit walled up by
 * our own code for a day. «LA SALIDA JAMÁS SE GATEA.»
 *
 * it. 31 (§1 + §2) — WHY THE RELEASE MOVED *OUT* OF HERE, AND WHAT STAYS.
 *
 * it. 29 argued «here and not in an unmount effect» on two claims: that an effect
 * cleanup «does NOT fire when the host itself is torn down mid-flight», and that
 * every close path passes through this bus. Both are false. React runs every
 * child's cleanup when the host unmounts — that is what unmounting is — and this
 * bus hosts ONE of the seventeen mounts of `CouncilMultisigFlow`: the other
 * sixteen (`OperatorConsole`, `ExchangeDesk`, `PoteBirthCard`, `XrpFundCard`,
 * `CageBirthCard`, `CouncilVaultEntry`, `CouncilOrderCard`, `GovernedMovements`,
 * `LegacyPanel`, `CouncilAnchorCard`, `WalletTransferModals`…) render it inline
 * with a «Back» underneath and never touch this module, while the flow's own
 * unmount effect DECLINED to release, quoting this comment. And releasing here
 * blind to the phase is how a Payment already broadcast lost its seat (above).
 *
 * So the release of a sitting that STARTED lives in the flow's unmount cleanup,
 * phase-aware, for all seventeen hosts — and this function decides only what the
 * close means for the CALLER, from what the flow reported (`CeremonyDispatch`).
 * The one release kept here is the case the flow cannot own: a close before the
 * sitting ever started (`idle`), where nothing of the flow's is pinned but the
 * dispatch the caller prepared still holds the seat for its whole window. That
 * release is asked for so the server's own verdict — held, and for how long —
 * reaches the banner (`ceremonySeatNotice`, it. 31 §3) instead of dying unread.
 *
 * A release that fails reaches the global banner on its own, never a silent
 * swallow; it is fire-and-forget WITH `keepalive` because the dialog is
 * destroyed in the same tick.
 */
export function abandonQuorumCeremony(): void {
  const req = current;
  if (!req) return;
  const dispatch = dispatches.get(req);
  if (dispatch?.committed) {
    closeCommittedCeremony(req, dispatch);
    return;
  }
  if (!dispatch?.started) {
    // Never started: nothing of the sitting's to unmount, so the flow's cleanup
    // has nothing to hand back — the prepared dispatch's seat is asked about from
    // here. A memo is only sent when these bytes carry one (a 0xFE); a
    // constitution names no nonce seat and `releaseCeremonySeat` sends the
    // account alone — it never invents a seat to hand back.
    //
    // it. 34 (E): `sittingId: null`, said out loud — this sitting never reached
    // `/multisign/prepare`, so it holds no lease and no pin of its own. The
    // server lets an unnamed sitting reach only UNNAMED leases and pins: this
    // fire-and-forget call, landing late after the person signed again and a new
    // sitting pinned these same bytes, can no longer free THAT sitting's seat.
    // The ordinary verdict (a prepared dispatch nobody pinned: countdown to the
    // banner, it. 31 §3) is unchanged, because such a row carries no pin at all.
    void releaseCeremonySeat(req.account, paymentMemoHex(req.tx), null).catch(() => {
      /* the banner already carries a refusal; a rejection here must not escape */
    });
  }
  // Started and not committed: `reject` tears the screen down, and the flow's
  // unmount cleanup hands the seat back for the phase it was really in.
  req.reject(new Error(CEREMONY_ABANDONED));
}

/**
 * What a close means once the sitting has COMMITTED to a broadcast. The seat is
 * not touched: those bytes may be on the ledger, and only the ledger's window
 * (server-side, `classifySeatSignability`) may ever say otherwise.
 */
function closeCommittedCeremony(req: QuorumCeremonyRequest, d: CeremonyDispatch): void {
  const hash = typeof d.hash === 'string' && /^[0-9A-Fa-f]{64}$/.test(d.hash) ? d.hash : undefined;
  if (hash && d.validated === true && d.finalResult === 'tesSUCCESS') {
    req.resolve(hash); // `onSettled` normally got here first; never contradict it
    return;
  }
  if (hash && d.validated !== true && d.engine === 'tesSUCCESS') {
    // The node accepted it and validation was not read in time. This is exactly
    // the state a single Xaman signature hands back after `submit` — the caller's
    // settlement watcher starts from the hash, as it does there.
    req.resolve(hash);
    return;
  }
  const where = hash ? ` Transaction ${hash}.` : '';
  const verdict =
    d.validated === true
      ? `The ledger validated it but it FAILED: ${d.finalResult ?? 'unknown result'}.`
      : d.engine && d.engine !== 'tesSUCCESS'
        ? `The node answered ${d.engine}${d.message ? ` — ${d.message}` : ''}.`
        : d.broadcastFailed === true
          ? // it. 33 (B2): the node's answer was LOST, not refused — said as such, so
            // nobody reads «closed while broadcasting» as «it never went out».
            `No XRPL node confirmed taking the submission${d.message ? ` (${d.message})` : ''}; it may still have entered through a node whose answer was lost.`
          : 'The signatures were being combined and broadcast when the ceremony was closed.';
  const err = Object.assign(
    new Error(
      `${CEREMONY_CLOSED_IN_FLIGHT}: ${verdict}${where} Do not sign it again: check the account on an explorer first.`,
    ),
    { code: RECEIPT_UNREAD, ...(hash ? { txHash: hash } : {}) },
  );
  req.reject(err);
}

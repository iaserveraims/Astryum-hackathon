'use client';

/**
 * quorumCeremonyBus — el desvío a la ceremonia multifirma, en UN solo sitio.
 *
 * EL FALLO QUE CIERRA.
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

/* ── LO QUE LA CEREMONIA HA HECHO CON LOS BYTES, VISTO DESDE EL BUS ── */

/**
 * WHAT FAILED IN SILENCE (the door it opened). `abandonQuorumCeremony`
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
   * `broadcast()` threw — no node CONFIRMED taking the bytes. Not
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
 * CAN THIS REPORT UNDO WHAT THE BUS ALREADY KNOWS?
 *
 * WHAT FAILED IN SILENCE. `abandon()` — the «Cancel this ceremony» button — ended
 * with `{stage:'abandoned'}`, and the patch for that is `{committed:false,
 * started:false}`: a sitting that had COMMITTED bytes to a node (a broadcast that
 * threw lands on `error`, where the button was still offered) was reduced to
 * «never started». The Escape that followed took the never-started branch,
 * released the seat a second time and rejected ABANDONED — `signOutcome` then
 * said «nothing left» over a Payment that may be on the ledger.
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
    // DESMONTAR EL ANFITRIÓN TAMBIÉN ES CERRAR.
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
    // A request only clears the bus if it is STILL the live one. The
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
 * CERRAR ES ABANDONAR, Y ABANDONAR DEVUELVE EL ASIENTO.
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
          ? // The node's answer was LOST, not refused — said as such, so
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

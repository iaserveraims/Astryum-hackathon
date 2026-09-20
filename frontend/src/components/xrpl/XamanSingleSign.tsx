'use client';

/**
 * XamanSingleSign — la firma XRPL de UNA cuenta, en Xaman.
 *
 * El flujo create-payload + QR + poll (el mismo de la ceremonia de
 * credenciales), empaquetado: para cuentas SIN SignerList — el gestor, el
 * ancla de la demo, el emisor. Una cuenta-consejo firma por
 * `CouncilSigningDoors`; mandar a un gestor single-sig por esas puertas
 * acababa en «no es una cuenta de consejo» (visto 5-sep, el accept de la
 * bandeja). Cada herramienta a su cuenta.
 *
 * Astryum compone y entrega; la firma ocurre en el móvil del dueño. El
 * payload caduca solo (5 min) si nadie firma.
 *
 * «FIRMADO» NO ES «HECHO» (familia unearned-success, 13-sep). Quien usa este
 * componente relaya una prueba FDC o marca un paso completo en `onSettled`, así
 * que `onSettled` solo se llama cuando el LEDGER valida la tx con tesSUCCESS.
 * La decisión vive en `lib/xrpl/singleSignVerdict` (pura, con tests): sin hash
 * o sin validación → 'unconfirmed' y jamás «Try again»; tem/tef/tel → nada
 * entró en un ledger, reintentar es seguro; tec validado → error sin reintento.
 * Arreglarlo aquí lo arregla en todos los que llaman.
 *
 * UNA TX ACTIVA (13-sep, residuos de doble firma). El payload se crea una vez
 * por transacción ACTIVA. Un padre que cambiaba `txjson` con el componente
 * montado (ManagerConsole, con un segundo «Review and sign») dejaba en pantalla
 * el QR del payload ANTERIOR mientras su `onSettled` ya hablaba por la orden
 * nueva — la orden nueva relayada contra el hash viejo. Ahora, con
 * `nextActiveTxKey` (pura, con tests):
 *   · si la firma activa NO bloquea → se adopta la tx nueva y se pide su payload;
 *   · si bloquea (QR vivo, confirmando, sin confirmar, tec validado) → se
 *     CONSERVA la activa, su validación en curso no se aborta, y se avisa de que
 *     hay otra esperando.
 * Tras un tesSUCCESS la fase es 'settled': se dice, y deja de bloquear.
 *
 * EL QR VIVO TAMBIÉN ES UNA FIRMA (13-sep). Con el QR/push en pantalla el
 * usuario puede firmar YA en el móvil, y el «Cancel» del padre solo dejaba de
 * sondear: el payload seguía firmable en Xaman sus 5 minutos, y «Prepare the
 * order» daba un segundo payload al lado — firmar los dos, dos órdenes. Ahora
 * 'waiting' bloquea al padre, y la única salida es «Cancel this request» aquí
 * dentro, que PREGUNTA a Xaman (`cancelPayloadAndDecide`, el mismo viaje de
 * CloseDoorSign y la bandeja del consejo) y obedece su respuesta
 * (`retreatDecision`): matado → 'cancelled' + `onCancelled`; ya respondido en el
 * móvil → se sigue hacia la confirmación, jamás un payload nuevo; vivo o sin
 * respuesta → se queda y se dice.
 *
 * DESMONTAR NO ES CANCELAR (productizer-it7, 14-sep). Al desmontar con un
 * payload vivo se disparaba un DELETE ciego que nadie leía: con ALREADY_OPENED
 * (abierto en el móvil, firmable) la petición seguía viva en silencio. Ahora el
 * payload se REGISTRA al crearse (`lib/xaman/liveRequests`), se RESUELVE con su
 * veredicto, y si el componente se va sin veredicto se ENTREGA al registro, que
 * sigue leyendo su estado; el banner global (`LiveXamanRequests`) lo dice y
 * ofrece cancelarlo obedeciendo la respuesta. Si se va con una firma cuyo
 * resultado del ledger nadie leyó, el banner dice «firmada — comprueba el
 * resultado» con el hash. `XamanSignBlockScope` deja a un ancestro cerrar su
 * propia salida mientras una firma de dentro bloquea.
 *
 * FIRMADA NO ES EL FINAL, Y CADUCADA NO SE REINTENTA (it.11, 14-sep).
 *   · Con la orden FIJADA (Sequence + LastLedgerSequence), tefPAST_SEQ /
 *     tefMAX_LEDGER dicen que ESTA tx no puede validar nunca: fase 'stale', sin
 *     «Try again» (recrearía el mismo payload en bucle) y sin bloquear al padre,
 *     cuyo prepare es el camino. tefALREADY espera al ledger.
 *   · Mientras se lee el resultado del ledger ('confirming') la firma queda
 *     registrada como 'confirming' (la guarda `beforeunload`); si el componente se
 *     va entonces, se ENTREGA al registro, que lee el resultado y lo muestra en el
 *     banner. Una orden de consejo la lleva a Flare el vigía del servidor aunque
 *     esta pantalla ya no exista (`sweepComposedCouncilOrders`) SOLO si su prepare
 *     dijo `serverDelivery` registrada + executor en marcha (it.13); si no, el
 *     banner lo dice y pide relayarla por hash.
 *
 * CADUCADA NO ES «PREPÁRALA OTRA VEZ» SI ES UNA ORDEN (it.13, R2 3.1). La misma
 * orden vive en dos payloads (el del banner y el re-preparado, misma Sequence
 * fijada): si uno se firmó y va de camino, el otro contesta tefPAST_SEQ, y «prepare
 * it again» componía una orden NUEVA — capital movido dos veces. Ante 'stale'
 * sobre una orden de consejo (memo de 32 bytes) se lee su destino
 * (`readCouncilOrderFate`) ANTES de ofrecer nada: salida → «no la prepares otra
 * vez» con el hash; compuesta/desconocida → «prepárala otra vez»; ilegible →
 * «comprueba antes de preparar otra vez». 'stale' sigue sin bloquear al padre.
 *
 * Y EL PADRE SE ENTERA (it.14, R2 2.3). Esa frase era decoración: el padre podía
 * componer otra orden en cuanto esta tarjeta desaparecía, que es justamente el
 * capital movido dos veces. El destino sale por `onStaleFate` y el padre lo
 * guarda en `useStaleOrderLock` — un candado que sobrevive al desmontaje y que
 * solo abre la persona («I checked — compose a new order»).
 *
 * `onSigned` (it.13): el hash en cuanto Xaman firma y la tx va al ledger — para
 * avisar `/handoff/signed` al instante (el backend recuerda el hash con 202
 * PENDING_LEDGER). `onSettled` sigue siendo solo el tesSUCCESS validado.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { awaitValidation, XRPSCAN_TX } from '../../lib/xrpl/councilSigning';
import {
  cancelPayloadAndDecide,
  payloadStrayNotice,
  strayStateOf,
  type XamanCancelUi,
} from '../../lib/xaman/payloadBus';
import {
  cancelLiveRequest,
  confirmLiveRequest,
  createBlockTally,
  fetchXamanStatus,
  flareInstructionMemoOf,
  handOffLiveRequest,
  leaveAction,
  noteUnfollowedSignature,
  payloadWatchVerdict,
  registerLiveRequest,
  resolveLiveRequest,
} from '../../lib/xaman/liveRequests';
import {
  STALE_LOCK_EXIT_NOTE,
  blocksRetreat,
  clearStoredStaleLocks,
  councilOrderMemoOf,
  decideAfterSigned,
  decideAfterValidation,
  defaultStaleLockStore,
  nextActiveTxKey,
  nextStaleOrderLock,
  restoredStaleLock,
  retreatDecision,
  staleLockBlocks,
  staleLockHeadline,
  staleOrderFate,
  staleSentence,
  writeStoredStaleLock,
  type ComposeKind,
  type SingleSignPhase,
  type SingleSignVerdict,
  type StaleOrderFate,
} from '../../lib/xrpl/singleSignVerdict';
import {
  describeRetryableRefusal,
  isRetryableReadFailure,
  readSeatRelease,
  seatFreesItselfSentence,
  serverDetailIfEnglish,
  type RetryableRefusalLike,
} from '../../lib/xaman/seatRefusal';
import {
  XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT,
  notePayloadOpened,
  notePayloadOpenedResult,
  payloadExpiryMin,
  releaseHandoffSeatResult,
} from '../../lib/wallet/handoffRelease';
import { readCouncilOrderFate } from '../../lib/institutional/api';

/** How long to wait for the ledger before saying «we could not confirm». */
const VALIDATION_TIMEOUT_MS = 60_000;

/**
 * The `expire` every payload this component mints carries, in MINUTES — Xaman's
 * unit (300 once meant five HOURS here). Named because the seat's real window is
 * derived from it: `payload-opened` re-stamps the server's `payloadExpiresAt` at
 * «now + this», which is the only clock Xaman is actually running (it. 19, R1 1.3).
 */
export const XAMAN_EXPIRE_MIN = XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT;

/**
 * it. 21 (it. 20 §3.9) — AND IT IS ONLY THE FALLBACK.
 *
 * The number above was hand-written here AND in the backend
 * (`HANDOFF_PAYLOAD_EXPIRY_MIN`), and the server has been answering its own
 * value as `payloadExpiryMin` on every prepare and every `payload-opened` since
 * it. 19 — which this frontend never read. Two hand-kept copies of one number
 * drift the day somebody changes one of them, and the direction that hurts is
 * silent: a seat that outlives its payload (nothing signable, the account
 * walled) or a seat freed under a payload that can still be signed (the twin).
 *
 * `payloadExpiryMin()` (lib/wallet/handoffRelease) is the reader: the server's
 * value when anything has carried one this session, the constant otherwise.
 */

/**
 * it. 25 (§3) — THE SEAT'S REAL DEADLINE, NOT THIS BROWSER'S ARITHMETIC.
 *
 * `payload-opened` has been sealing «now + the window we asked for» ever since
 * it. 19. That is a guess twice over: the payload exists a round trip later than
 * `now`, and Xaman counts to an `expires_at` of its OWN which it reports on the
 * payload. The desk (`OmnibusSignDoor`) has sealed the real one since it. 23 —
 * the ordinary signature, which is every other 0xFE in the product, never did.
 *
 * So: one read of the payload, one re-seal. The server only ever moves a seat's
 * deadline FORWARD and caps it at the ledger window (`clampStampedPayloadExpiry`),
 * so this can neither shorten a seat under a live payload nor stretch one past
 * the ledger. Anything beyond the window we ASKED for is ignored here too — a
 * reading that claims more than we requested is not a fact about this payload.
 *
 * Best effort by construction: a failure leaves the estimate already sealed
 * above, which is exactly today's behaviour. It never blocks the QR and it never
 * signs, cancels or broadcasts anything.
 */
async function sealRealPayloadExpiry(uuid: string, memoHex: string, expireMin: number): Promise<void> {
  try {
    const res = await fetch(`/api/xaman/status/${uuid}`);
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { payload?: { expires_at?: unknown } } | null;
    const said = body?.payload?.expires_at;
    const atMs = typeof said === 'string' ? Date.parse(said) : NaN;
    if (!Number.isFinite(atMs)) return;
    // A slack of one minute over the requested window covers the round trip
    // between asking and Xaman starting its clock — never more.
    if (atMs - Date.now() > (expireMin + 1) * 60_000) return;
    await notePayloadOpenedResult(memoHex, new Date(atMs));
  } catch {
    /* the estimate is already sealed; nothing here is worth interrupting a signature */
  }
}

type Phase = SingleSignPhase;

/**
 * XamanSignBlockScope — lets an ANCESTOR lock its own way out (a lens bar, an
 * operation window's X) while ANY `XamanSingleSign` below it blocks retreat,
 * without every component in between threading `onBlockedChange`
 * (productizer-it7). Scopes nest: an inner scope reports into the outer one.
 * `onBlockedChange` hears only transitions; the scope says nothing on unmount
 * (its owner is going away with it).
 */
type BlockReport = (id: symbol, blocked: boolean) => void;
const BlockScopeContext = createContext<BlockReport | null>(null);

export function XamanSignBlockScope({
  onBlockedChange,
  children,
}: {
  onBlockedChange: (blocked: boolean) => void;
  children: ReactNode;
}) {
  const parent = useContext(BlockScopeContext);
  const parentRef = useRef(parent);
  parentRef.current = parent;
  const cbRef = useRef(onBlockedChange);
  cbRef.current = onBlockedChange;
  const selfId = useRef(Symbol('xaman-sign-scope'));
  const tallyRef = useRef<ReturnType<typeof createBlockTally> | null>(null);
  if (!tallyRef.current) {
    tallyRef.current = createBlockTally((any) => {
      cbRef.current(any);
      parentRef.current?.(selfId.current, any);
    });
  }
  const report = useCallback<BlockReport>((id, blocked) => tallyRef.current?.report(id, blocked), []);
  // Leaving with a blocker inside: the OUTER scope must not stay locked by us.
  useEffect(() => () => {
    if (tallyRef.current?.blocked) parentRef.current?.(selfId.current, false);
  }, []);
  return <BlockScopeContext.Provider value={report}>{children}</BlockScopeContext.Provider>;
}

/** One payload's life: created once per active tx (or retry), read by the cancel. */
interface PayloadRun {
  alive: boolean;
  /** A poll (or the cancel) reached a verdict: signed, cancelled, expired, declined. */
  decided: boolean;
  uuid?: string;
  /** «Cancel this request» was pressed for this payload. */
  cancelRequested: boolean;
  /** A cancel round trip is in flight — a double press never fires a second DELETE. */
  cancelling: boolean;
  /**
   * Signed, and the ledger's word not read yet (confirming, unconfirmed,
   * validated with a failure). Leaving now hands it to the banner as «signed —
   * check the result». Cleared by 'settled' (onSettled fired) and 'refused'.
   */
  signedOpen: { txid?: string } | null;
  /**
   * The hash whose LEDGER result this component is reading right now (phase
   * 'confirming'). Registered as 'confirming' in `liveRequests`; leaving while
   * it is set hands it off so the registry reads the result (it.11).
   */
  confirmingTxid?: string;
  /** Read the status once, now (also the poll tick). */
  check: () => Promise<void>;
  /** Xaman confirmed the kill: close the request and tell the parent. */
  close: () => void;
  stopPolling: () => void;
}

/**
 * The one line a parent shows INSTEAD of its Cancel / Back / Close while this
 * component reports `onBlockedChange(true)`. One sentence, reviewed once: true
 * for a live QR (cancel it in the request) and for a signed one (wait for it).
 */
export function XamanSignBlockedNote({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <p className={`text-[11px] leading-relaxed text-tone-warning ${className}`}>
      {t('The request is live in Xaman — cancel it from the request itself. If it was already signed, wait for its result above before preparing anything again.')}
    </p>
  );
}

/**
 * What the server said about a composed council order besides the order itself
 * (it.13): `recoveryWarning` (an exit the server could not remember — nobody but
 * this screen delivers it) and `inFlightWarning` (another order of the account
 * is already in flight). Rendered visibly by every console that composes one.
 */
export function CouncilOrderServerWarnings({
  recoveryWarning,
  inFlightWarning,
  duplicateWarning,
  className = '',
}: {
  recoveryWarning?: string | null;
  inFlightWarning?: string | null;
  /**
   * it.14 (K2): the SAME order (same action, same parameters) went out for this
   * council a moment ago. An exit is never refused, so the server lets it
   * through with this word instead of a 409 — and the screen must show it, or
   * the quorum signs the second movement of the same capital without knowing.
   */
  duplicateWarning?: string | null;
  className?: string;
}) {
  const { t } = useT();
  if (!recoveryWarning && !inFlightWarning && !duplicateWarning) return null;
  return (
    <div className={`space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-left text-[11px] leading-relaxed text-tone-warning ${className}`} role="alert">
      {recoveryWarning ? (
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{t('The server could not remember this order, so it will not deliver it on its own — keep this screen open until the order reaches Flare, or relay it by hash if it closes.')}</span>{' '}
            <span className="text-ink/55">({recoveryWarning})</span>
          </span>
        </p>
      ) : null}
      {inFlightWarning ? (
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{t('Another order of this account is already in flight — check it before signing this one.')}</span>{' '}
            <span className="text-ink/55">({inFlightWarning})</span>
          </span>
        </p>
      ) : null}
      {duplicateWarning ? (
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{t('The same order was already sent to this council a moment ago — check that one before signing this, or the capital moves twice.')}</span>{' '}
            <span className="text-ink/55">({duplicateWarning})</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * productizer it. 21 (it. 20 §3.5) — THE 503s THAT HAD NO READER AND NO BUTTON.
 *
 * `ACCOUNT_BUSY` (503 + `Retry-After`) and `PROOF_STORE_UNREADABLE` (503) are the
 * server saying A READ OF OURS FAILED: nothing was saved, nothing moved, come
 * back in a moment. Both were shipped with `retryable: true` and a sentence —
 * and reached the screens as nothing but a `detail` under a generic headline,
 * with no way to act. A retry that nobody can press is not a retry.
 *
 * One block for all of them (`describeRetryableRefusal` writes the sentence, the
 * seconds included when the server sent a `Retry-After`), with the retry as a
 * BUTTON. It renders nothing for a refusal that is not one of these, so a caller
 * can put it above its own panel without a condition. Exported so the exit
 * screens use the same words — an exit is the surface where «I could not read»
 * must never look like a no.
 */
export function ReadFailureNotice({
  refusal,
  busy,
  onRetry,
  className = '',
}: {
  refusal: RetryableRefusalLike | null | undefined;
  busy?: boolean;
  /** Absent ⇒ the sentence is shown without a button (the caller has no re-run). */
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useT();
  const view = describeRetryableRefusal(refusal, t);
  if (!view) return null;
  return (
    <div className={`space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-left text-[11px] leading-relaxed text-tone-warning ${className}`} role="alert">
      <p className="flex items-start gap-1.5 text-[12px] font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {view.text}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Try again')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 409 SAME_ORDER_RECENTLY_LAUNCHED (it.14; `COUNCIL_ORDER_IN_FLIGHT` in it.13):
 * the server refuses to compose a non-exit order because the SAME one — same
 * action, same parameters — went out for this council a moment ago. Composing it
 * again anyway is an explicit, separate decision, never a silent retry.
 *
 * The guard changed shape between iterations: it.13 asked «is anything of this
 * council in flight», which blocked harmless pairs and stopped blocking the
 * moment the first order executed — precisely when the double became possible.
 * It.14 asks «is THIS order a repeat», so the sentence names the repetition and,
 * when the server counts it, how long ago.
 */
export function CouncilOrderInFlightConfirm({
  detail,
  minutesAgo,
  code,
  retryAfterSeconds,
  busy,
  onConfirm,
  onRetry,
  onDismiss,
  className = '',
}: {
  detail?: string | null;
  /** Minutes since the same order went out; null/absent → «a moment ago». */
  minutesAgo?: number | null;
  /** The refusal's code, so an older deploy's wording stays truthful. */
  code?: string | null;
  /**
   * it. 21 (it. 20 §2.7): seconds the server asked us to wait, when it said so.
   * Only meaningful for `DUPLICATE_CHECK_UNREADABLE`, which is a retry.
   */
  retryAfterSeconds?: number | null;
  busy?: boolean;
  onConfirm: () => void;
  /**
   * it. 21 (§2.7): `DUPLICATE_CHECK_UNREADABLE` is OUR read failing, not a
   * verdict — so it gets a plain «Try again» that re-runs the same compose
   * WITHOUT confirming anything. Absent ⇒ no retry is offered (an older caller).
   */
  onRetry?: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const { t } = useT();
  const legacyGuard = code === 'COUNCIL_ORDER_IN_FLIGHT';
  /**
   * it. 21 (it. 20 §2.7) — THE 409 THAT HAD NO READER ANYWHERE.
   *
   * `DUPLICATE_CHECK_UNREADABLE` says the duplicate check itself could not run
   * (the fate budget spent, a node down, the store threw). It is NOT «the same
   * order already went out»: nobody found a duplicate, we simply could not look.
   * It travels `retryable: true` AND `confirmAnotherOrder: true` — a retry and
   * an explicit escape — and the screens showed neither, so the manager was
   * locked out for ~60 s with no button at all.
   *
   * Same panel, because the decision is the same shape; different sentences,
   * because telling somebody «the same order was sent a moment ago» when we
   * never checked is inventing a fact.
   */
  const uncheckable = code === 'DUPLICATE_CHECK_UNREADABLE';
  if (uncheckable) {
    const wait =
      typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? `${t('Try again in about')} ${Math.round(retryAfterSeconds)} ${t('seconds.')}`
        : t('Try again in a moment.');
    return (
      <div className={`space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-left text-[11px] leading-relaxed text-tone-warning ${className}`} role="alert">
        <p className="flex items-start gap-1.5 text-[12px] font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('We could not check whether this same order already went out')}
        </p>
        <p className="text-ink/60">
          {t('That check is ours and it failed, so nothing was composed and nothing moved. It is not a verdict about this order: it means we cannot promise an identical one is not already on its way. Check the account on an explorer, or the order you last composed, before signing anything.')}{' '}
          {wait}
        </p>
        {serverDetailIfEnglish(detail) ? <p className="text-ink/50">{serverDetailIfEnglish(detail)}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onDismiss} className="rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">
            {t('Do not compose')}
          </button>
          {onRetry ? (
            <button type="button" onClick={onRetry} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {t('Try again')}
            </button>
          ) : null}
          {/* The server's own escape, and a SEPARATE decision from the retry:
              «I know this order has not gone out». Never auto-pressed. */}
          <button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-tone-warning disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t('Compose another order anyway')}
          </button>
        </div>
      </div>
    );
  }
  const headline = legacyGuard
    ? t('Another order of this account is already in flight')
    : typeof minutesAgo === 'number'
      ? `${t('The same order was sent to this council')} ${minutesAgo} ${t('minutes ago — compose it again anyway?')}`
      : t('The same order was sent to this council a moment ago — compose it again anyway?');
  return (
    <div className={`space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-left text-[11px] leading-relaxed text-tone-warning ${className}`} role="alert">
      <p className="flex items-start gap-1.5 text-[12px] font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {headline}
      </p>
      <p className="text-ink/60">
        {t('It may still reach the ledger and Flare. Composing another order now can move capital twice — check the pending one (its screen, the banner, or the explorer) first.')}
      </p>
      {/* it.16 (R5 5.4): the server writes some of these `detail`s in Spanish,
          and this app is in English. A paragraph the reader cannot read teaches
          nothing and reads as noise under a decision about money, so only a
          plainly English detail is quoted. */}
      {serverDetailIfEnglish(detail) ? <p className="text-ink/50">{serverDetailIfEnglish(detail)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onDismiss} className="rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">
          {t('Do not compose')}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-tone-warning disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Compose it again anyway')}
        </button>
      </div>
    </div>
  );
}

/**
 * productizer it.14 (R2 2.3) — THE PARENT'S LOCK AFTER A 'stale' THAT WENT OUT.
 *
 * `XamanSingleSign` says «another request of this same order already went out —
 * do not prepare it again», and then the surface around it happily composed a
 * new one: the sentence was decoration. The fate now travels out of the
 * component (`onStaleFate`) into this lock, which OUTLIVES the signature (the
 * order is dropped, the card closes, the person presses «Back») and pauses
 * composing until they say they checked.
 *
 * `report` is the component's `onStaleFate`; `release` is the confirmation.
 * The decision itself is pure (`nextStaleOrderLock`, lib/xrpl/singleSignVerdict).
 */
/* ── the lock is ONE fact, not one per mounted hook (it. 19) ─────────────── */

/**
 * productizer it. 19 — TWO MOUNTS, TWO LOCKS, ONE CONFUSED PERSON.
 *
 * `useStaleOrderLock` kept the verdict in ITS OWN React state and only read
 * `sessionStorage` once, on mount. The exchange wizard mounts the hook TWICE
 * (`ExchangeSetupWizard` lines 438 and 577), and the same page can show a
 * console beside a card that both hold one. So pressing «I checked — compose a
 * new order» cleared storage and ONE instance's state: the other went on
 * printing «composing this order again is paused» and went on disabling its
 * buttons, over a lock the person had just released, with no second button
 * anywhere to release it again. The only way out was F5.
 *
 * The fact now lives in the MODULE and every mounted hook subscribes to it, so
 * a report or a release reaches all of them in the same tick. `sessionStorage`
 * stays the memory across a reload (it. 16, R5 5.5); this is the memory across
 * two components of the same render.
 *
 * Restored once per session, in an effect — never in the state initializer, so
 * the server render and the first client render still agree.
 */
let sharedStaleLock: StaleOrderFate | null = null;
let sharedStaleLockRestored = false;
const staleLockListeners = new Set<() => void>();

function publishStaleLock(next: StaleOrderFate | null): void {
  if (next === sharedStaleLock) return;
  sharedStaleLock = next;
  staleLockListeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('stale order lock listener error:', err);
    }
  });
}

/** Tests only: forget the shared lock (the store is cleared by the caller). */
export function __resetStaleOrderLock(): void {
  sharedStaleLock = null;
  sharedStaleLockRestored = false;
  staleLockListeners.clear();
}

export function useStaleOrderLock(): {
  lock: StaleOrderFate | null;
  /**
   * Is a NON-exit compose paused right now? Kept as a field because most call
   * sites compose only non-exits; an exit asks `blocks('exit')`, which is false
   * by construction (it.16, R3 3.1).
   */
  locked: boolean;
  /** Does the lock stop THIS compose? See `staleLockBlocks` for the whole rule. */
  blocks: (kind: ComposeKind, opts?: { confirmed?: boolean }) => boolean;
  /** Is the note pausing anything, or only warning? Drives its headline. */
  pausing: boolean;
  report: (fate: StaleOrderFate | undefined, memoHex?: string | null) => void;
  release: () => void;
} {
  const [lock, setLock] = useState<StaleOrderFate | null>(null);
  // it.16 (R5 5.5): F5 used to drop the lock in silence — it is restored from
  // sessionStorage. it. 19: and every mounted instance follows the SAME fact, so
  // a release in one of them is a release in all of them. The effect, not the
  // initializer, so the server render and the first client render agree.
  useEffect(() => {
    const sync = () => setLock(sharedStaleLock);
    staleLockListeners.add(sync);
    if (!sharedStaleLockRestored) {
      sharedStaleLockRestored = true;
      const restored = restoredStaleLock(defaultStaleLockStore());
      if (restored && sharedStaleLock === null) sharedStaleLock = restored;
    }
    sync();
    return () => {
      staleLockListeners.delete(sync);
    };
  }, []);
  const report = useCallback((fate: StaleOrderFate | undefined, memoHex?: string | null) => {
    const next = nextStaleOrderLock(sharedStaleLock, fate);
    if (next !== sharedStaleLock) writeStoredStaleLock(defaultStaleLockStore(), memoHex ?? null, next);
    publishStaleLock(next);
  }, []);
  const release = useCallback(() => {
    clearStoredStaleLocks(defaultStaleLockStore());
    // Published, not set locally: the sibling instance that was ALSO pausing
    // its buttons has to hear it, or the person releases a lock that stays on.
    publishStaleLock(null);
  }, []);
  const blocks = useCallback(
    (kind: ComposeKind, opts?: { confirmed?: boolean }) => staleLockBlocks(lock, kind, opts),
    [lock],
  );
  return { lock, locked: staleLockBlocks(lock, 'other'), blocks, pausing: staleLockBlocks(lock, 'other'), report, release };
}

/**
 * What a warned surface shows. `pausing` says whether anything is actually
 * held back: with a verdict we could not check — or on a console whose live
 * doors are exits — the note WARNS and says so, because «paused» printed over a
 * door that works is its own lie (it.16, R3 3.1 / R5 5.5).
 */
export function StaleOrderLockNote({
  lock,
  onRelease,
  pausing = true,
  className = '',
}: {
  lock: StaleOrderFate | null;
  onRelease: () => void;
  pausing?: boolean;
  className?: string;
}) {
  const { t } = useT();
  if (!lock) return null;
  const hash = lock.kind === 'already-out' || lock.kind === 'out-failed' ? lock.txHash : undefined;
  return (
    <div className={`space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-left text-[11px] leading-relaxed text-tone-warning ${className}`} role="alert">
      <p className="flex items-start gap-1.5 text-[12px] font-medium">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(staleLockHeadline(pausing))}
      </p>
      <p className="text-ink/50">{t(STALE_LOCK_EXIT_NOTE)}</p>
      <p className="text-ink/60">
        {lock.kind === 'checking' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
        {t(staleSentence(lock))}
      </p>
      {hash ? (
        <a
          href={`${XRPSCAN_TX}${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all font-mono text-[10px] text-ink/45 underline underline-offset-2"
        >
          {hash}
        </a>
      ) : null}
      <button
        type="button"
        onClick={onRelease}
        className="rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-tone-warning"
      >
        {t('I checked — compose a new order')}
      </button>
    </div>
  );
}

export function XamanSingleSign({
  txjson,
  title,
  onSettled,
  onSigned,
  onBlockedChange,
  onCancelled,
  onStaleFate,
}: {
  txjson: Record<string, unknown>;
  title: string;
  /**
   * El hash de la tx, SOLO cuando el ledger la validó con tesSUCCESS — y la tx
   * que validó. Es la tx ACTIVA: si el padre cambió `txjson` mientras esta firma
   * bloqueaba, es la ANTERIOR, así que un padre que cambia el prop compara
   * `settledTx` antes de actuar sobre su estado.
   */
  onSettled: (hash: string, settledTx: Record<string, unknown>) => void;
  /**
   * Opcional (it.13): el hash EN CUANTO Xaman firmó y la tx va camino del ledger
   * (antes de validar). Una vez por tx activa. NO es éxito: solo sirve para
   * avisar al servidor del hash (p. ej. `notifyHandoffSigned` de un 0xFE).
   */
  onSigned?: (hash: string, signedTx: Record<string, unknown>) => void;
  /**
   * Opcional: `true` cuando el padre YA NO debe poder tirar esta firma (su
   * «Cancel»): el QR está vivo y firmable, la tx está confirmándose, sin
   * confirmar, o validó con un fallo. Tirar la orden y prepararla de nuevo es
   * la segunda firma que este componente se niega a ofrecer. `false` en
   * cualquier otro caso y al desmontar.
   */
  onBlockedChange?: (blocked: boolean) => void;
  /**
   * Opcional: Xaman CONFIRMÓ que el payload se canceló (por «Cancel this
   * request») y nada se firmó. El padre puede soltar la orden preparada.
   */
  onCancelled?: () => void;
  /**
   * Opcional (it.14, R2 2.3): esta tx quedó 'stale' (tefPAST_SEQ / tefMAX_LEDGER)
   * y era una ORDEN DE CONSEJO, así que se preguntó qué fue de la orden. El
   * destino viaja al padre — 'checking' primero y el veredicto después — porque
   * decir «no la prepares otra vez» aquí dentro no impedía que el padre
   * compusiera otra en cuanto esta tarjeta desaparecía. `useStaleOrderLock` es
   * el candado que el padre mantiene con esto.
   */
  onStaleFate?: (fate: StaleOrderFate, memoHex?: string | null) => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('creating');
  const [qrPng, setQrPng] = useState<string | undefined>();
  const [deeplink, setDeeplink] = useState<string | undefined>();
  const [error, setError] = useState('');
  // Only an error that provably moved nothing may offer «Try again».
  const [retryable, setRetryable] = useState(false);
  const [txid, setTxid] = useState<string | undefined>();
  // A stale COUNCIL ORDER: what the server said became of the order (it.13).
  const [staleFate, setStaleFate] = useState<StaleOrderFate | undefined>();
  // What Xaman answered to «Cancel this request» (payloadBus vocabulary).
  const [cancelUi, setCancelUi] = useState<XamanCancelUi>('idle');
  // Reintentar (revisión 10-sep): un payload que no se pudo crear o que caducó
  // dejaba el bloque muerto — había que salir y volver a entrar. `attempt`
  // relanza el efecto y pide uno nuevo.
  const [attempt, setAttempt] = useState(0);
  /**
   * it. 21 (it. 20 §3.3) — WHAT HAPPENS TO THE SEAT WHEN NOBODY SIGNS.
   *
   * Rejecting in Xaman (or letting the request expire, or closing the tab) leaves
   * the 0xFE's nonce seat held until its signing window passes, and NOTHING on
   * any screen said so: the person pressed «Try again» and met a bare
   * `NONCE_SEAT_TAKEN` that reads like a refusal about them. The wait was
   * correct; the explanation was missing.
   *
   * So the moment a payload ends WITHOUT a signature, this card asks the server
   * to free that seat (a release of an UNSIGNED draft is not a signature and
   * moves nothing — prepare-only) and says whatever it answered: freed, or
   * «frees itself in ≈N s» with the SERVER's own seconds from the 409.
   */
  const [seatNote, setSeatNote] = useState('');
  const runRef = useRef<PayloadRun | null>(null);
  // The latest translator, for callbacks that outlive a render.
  const tRef = useRef(t);
  tRef.current = t;
  // onSettled fires at most ONCE per active transaction, whatever the polls do.
  const settledRef = useRef(false);
  // The latest callbacks, so a parent re-render never leaves us calling a stale one.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;
  const onBlockedChangeRef = useRef(onBlockedChange);
  onBlockedChangeRef.current = onBlockedChange;
  const onCancelledRef = useRef(onCancelled);
  onCancelledRef.current = onCancelled;
  const onStaleFateRef = useRef(onStaleFate);
  onStaleFateRef.current = onStaleFate;
  // What the registry / global banner calls this request if we leave it open.
  const titleRef = useRef(title);
  titleRef.current = title;
  // The nearest XamanSignBlockScope (a lens bar, an operation window's X).
  const scopeReport = useContext(BlockScopeContext);
  const scopeReportRef = useRef(scopeReport);
  scopeReportRef.current = scopeReport;
  const scopeId = useRef(Symbol('xaman-single-sign'));

  // The transaction the current payload belongs to. The key is the serialized
  // tx, so a parent that rebuilds an equal object on every render is a no-op.
  const incomingKey = useMemo(() => JSON.stringify(txjson), [txjson]);
  const [active, setActive] = useState<{ key: string; tx: Record<string, unknown> }>(() => ({
    key: incomingKey,
    tx: txjson,
  }));

  // The parent learns when retreating stops being honest (lib/xrpl/singleSignVerdict).
  const blocked = blocksRetreat(phase, retryable);
  useEffect(() => {
    onBlockedChangeRef.current?.(blocked);
    scopeReportRef.current?.(scopeId.current, blocked);
  }, [blocked]);
  // Unmounted (settled and dropped, account changed…): nothing of ours blocks.
  useEffect(() => () => {
    onBlockedChangeRef.current?.(false);
    scopeReportRef.current?.(scopeId.current, false);
  }, []);

  // A different txjson: adopt it when nothing blocks, HOLD the active one when
  // something does — re-evaluated when the block lifts (e.g. after 'settled').
  useEffect(() => {
    const next = nextActiveTxKey({ activeKey: active.key, incomingKey, blocked });
    if (next !== active.key) setActive({ key: next, tx: txjson });
    // `txjson` is the transaction `incomingKey` serializes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey, blocked, active.key]);
  const holding = blocked && incomingKey !== active.key;

  useEffect(() => {
    // The transaction THIS payload signs — never the latest prop.
    const tx = active.tx;
    settledRef.current = false;
    setPhase('creating');
    setError('');
    setRetryable(false);
    setTxid(undefined);
    setStaleFate(undefined);
    setQrPng(undefined);
    setDeeplink(undefined);
    setCancelUi('idle');
    setSeatNote('');

    let timer: ReturnType<typeof setInterval> | null = null;
    const run: PayloadRun = {
      alive: true,
      decided: false,
      uuid: undefined,
      cancelRequested: false,
      cancelling: false,
      signedOpen: null,
      check: async () => {},
      close: () => {},
      stopPolling: () => {
        if (timer) clearInterval(timer);
        timer = null;
      },
    };
    runRef.current = run;

    // What the registry and the banner call this request (latest title, this tx).
    const txKey = active.key;
    const meta = (uuid: string) => ({ uuid, title: titleRef.current, txKey });

    const apply = (v: SingleSignVerdict) => {
      // A read verdict that ends the story clears the «signed, unread» mark even
      // if we already left (then nothing is reported for it).
      if (v.kind === 'settled' || v.kind === 'refused' || v.kind === 'stale') run.signedOpen = null;
      if (!run.alive) return;
      switch (v.kind) {
        case 'stale': {
          // This exact tx can never validate (pinned Sequence consumed, or its
          // LastLedgerSequence passed). No «Try again»: it would recreate the same
          // payload forever. The parent's prepare is the way — and it is free
          // ('stale' does not block: onBlockedChange(false) fires on this phase).
          setTxid(v.txid);
          setRetryable(false);
          setPhase('stale');
          setError(v.code);
          // A COUNCIL ORDER (it.13): the seat may have been spent by a sibling
          // request of the same order that is being delivered. Ask what became of
          // the order BEFORE saying «prepare it again».
          const memo = councilOrderMemoOf(tx);
          if (memo) {
            setStaleFate({ kind: 'checking' });
            // The PARENT hears it too, and keeps hearing it after this card is
            // gone: «do not prepare it again» is worth nothing if the surface
            // around composes a new order the moment the person presses Back.
            onStaleFateRef.current?.({ kind: 'checking' }, memo);
            void readCouncilOrderFate(memo)
              .catch(() => ({ ok: false as const, status: 0 }))
              .then((read) => {
                const fate = staleOrderFate(read);
                if (run.alive) setStaleFate(fate);
                // Reported even if we already left: the lock lives in the parent.
                // The MEMO travels with it (it.16, R5 5.5) so the lock can be
                // remembered per order and survive an F5.
                onStaleFateRef.current?.(fate, memo);
              });
          }
          return;
        }
        case 'settled':
          if (settledRef.current) return;
          settledRef.current = true;
          setTxid(v.txid);
          setError('');
          setPhase('settled');
          onSettledRef.current(v.txid, tx);
          return;
        case 'refused':
          setPhase('error');
          setRetryable(true);
          setError(`${t('The network refused this transaction before it entered a ledger. Nothing moved.')} (${v.code})`);
          return;
        case 'failed-onchain':
          setTxid(v.txid);
          setPhase('error');
          setRetryable(false);
          setError(`${t('The ledger validated this transaction with a failure result, so it did not take effect and its network fee was charged. Prepare the operation again before signing.')} (${v.code})`);
          return;
        case 'unconfirmed':
          setTxid(v.txid);
          setError('');
          setRetryable(false);
          setPhase('unconfirmed');
          return;
        case 'await-validation':
          setTxid(v.txid);
          setPhase('confirming');
          return;
      }
    };

    const endWithoutSignature = (message: string) => {
      run.decided = true;
      run.stopPolling();
      if (run.uuid) resolveLiveRequest(run.uuid);
      setCancelUi('idle');
      setPhase('error');
      setRetryable(true);
      setError(message);
      // it. 21 (§3.3): a 0xFE that nobody signed is still holding a nonce seat.
      // Say so immediately with the honest generic, then replace it with what
      // the server actually answered. Never blocking, never a signature.
      const memo = flareInstructionMemoOf(tx);
      if (!memo) return;
      setSeatNote(seatFreesItselfSentence(null, tRef.current) ?? '');
      void releaseHandoffSeatResult(memo)
        .then((res) => {
          if (!run.alive) return;
          const said = seatFreesItselfSentence(readSeatRelease(res), tRef.current);
          if (said) setSeatNote(said);
        })
        .catch(() => {
          /* the generic sentence above is already true; nothing to correct */
        });
    };

    run.close = () => {
      if (!run.alive || run.decided) return;
      run.decided = true;
      run.stopPolling();
      if (run.uuid) resolveLiveRequest(run.uuid);
      setCancelUi('idle');
      setError('');
      setRetryable(false);
      setPhase('cancelled');
      onCancelledRef.current?.();
    };

    // Overlapping reads (a slow poll and the next tick, or the immediate read
    // after ALREADY_RESOLVED) are allowed: the first verdict wins via `decided`.
    // The status read and its verdict live in lib/xaman/liveRequests, shared
    // with the registry that watches a request once this component is gone.
    run.check = async () => {
      const uuid = run.uuid;
      if (!uuid || !run.alive || run.decided) return;
      const st = await fetchXamanStatus(uuid);
      if (!run.alive || run.decided) return;
      const verdict = payloadWatchVerdict(st);
      if (verdict === 'signed') {
        run.decided = true;
        run.stopPolling();
        // Nothing signable is left in Xaman; what is open now is the LEDGER
        // outcome, followed below. While it is read the registry holds it as
        // 'confirming' (beforeunload guards it; leaving hands it off, it.11).
        run.signedOpen = { txid: st.txid };
        setCancelUi('idle');
        const first = decideAfterSigned({ txid: st.txid, dispatched: st.dispatched });
        if (first.kind === 'await-validation') {
          run.confirmingTxid = first.txid;
          confirmLiveRequest({ ...meta(uuid), txid: first.txid });
          // The hash, NOW — before the ledger's word (not a success: see onSigned).
          try {
            onSignedRef.current?.(first.txid, tx);
          } catch (err) {
            console.error('XamanSingleSign onSigned error:', err);
          }
        } else {
          resolveLiveRequest(uuid);
        }
        apply(first);
        if (first.kind !== 'await-validation') return;
        // Xaman's «signed» is not the ledger's word: only a VALIDATED
        // tesSUCCESS reaches onSettled (CloseDoorSign pattern).
        const v = await awaitValidation(first.txid, { timeoutMs: VALIDATION_TIMEOUT_MS });
        run.confirmingTxid = undefined;
        // Still mounted: this component shows the result, the entry is done. Gone:
        // it was handed off as 'validating' and the registry owns it (resolve
        // never erases that).
        if (run.alive) resolveLiveRequest(uuid);
        apply(
          decideAfterValidation({
            txid: first.txid,
            validated: v.validated,
            finalResult: v.finalResult,
            timedOut: v.timedOut,
          }),
        );
      } else if (verdict === 'cancelled') {
        // Our own DELETE landed before its answer did: the same confirmed kill.
        if (run.cancelRequested) run.close();
        else endWithoutSignature(t('The signature was cancelled.'));
      } else if (verdict === 'expired') {
        endWithoutSignature(t('The request expired before it was signed.'));
      } else if (verdict === 'declined') {
        // Answered on the phone without a signature: declined. Nothing moved.
        endWithoutSignature(t('The request was declined in Xaman. Nothing was signed.'));
      }
    };

    (async () => {
      try {
        // it. 21 (§3.9): the SERVER's `payloadExpiryMin` when anything has carried
        // one this session, the constant otherwise — one number, and the seat is
        // measured with the same one the payload actually lives by.
        //
        // it. 25 (§2): …and the one that belongs to THIS dispatch. The memo names
        // the row, so a council prepare read in another screen (24 h, §2.1) can no
        // longer decide the `expire` of an ordinary payload minted here.
        const instructionMemo = flareInstructionMemoOf(tx);
        const expireMin = payloadExpiryMin(undefined, instructionMemo);
        const res = await fetch('/api/xaman/create-payload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txjson: tx,
            // Xaman's `expire` is in MINUTES: 5 = five minutes (300 was five hours).
            // The same number the seat's window is re-stamped with below.
            options: { submit: true, expire: expireMin },
            custom_meta: { identifier: `single-${Date.now().toString(36)}` },
          }),
        });
        if (!res.ok) throw new Error(`Xaman payload failed (${res.status})`);
        const data = await res.json();
        const uuid: string | undefined = typeof data?.uuid === 'string' ? data.uuid : undefined;
        if (!run.alive) {
          // The parent left while the request was being created: nobody saw the
          // QR, but a push may already be on the phone. Not a blind DELETE
          // (productizer-it7): the registry watches it and asks Xaman to kill
          // it, obeying the answer — ALREADY_OPENED keeps it in the banner.
          if (uuid) {
            handOffLiveRequest(meta(uuid));
            void cancelLiveRequest(uuid);
          }
          return;
        }
        if (!uuid) throw new Error('Xaman payload failed (no uuid)');
        run.uuid = uuid;
        // Signable from this instant: the registry knows it before the QR shows.
        registerLiveRequest(meta(uuid));
        // it. 19 (R1 1.3) — THE SEAT'S CLOCK STARTS HERE, NOT AT COMPOSE TIME.
        //
        // Xaman's `expire` counts from the moment the PAYLOAD exists, which is
        // this line; the server was stamping `payloadExpiresAt` when it composed
        // the 0xFE, minutes earlier. A signature still perfectly valid at 4:30
        // was therefore treated as expired and its seat handed to a second
        // instruction — the twin, built by our own clock skew. The only process
        // that knows this instant is this one, so it tells the server.
        //
        // Best effort on purpose: a backend without the endpoint answers 404 and
        // the window keeps being measured exactly as it was. Never blocks the QR.
        if (instructionMemo) {
          notePayloadOpened(instructionMemo, new Date(Date.now() + expireMin * 60_000));
          // it. 25 (§3): …and then the instant XAMAN is really counting to. The
          // line above is our ARITHMETIC (now + the window we asked for); the desk
          // has been sealing the real `expires_at` since it. 23 and the simple
          // signature never did, so every ordinary 0xFE has been measuring its
          // seat by this browser's clock. Best effort, never blocking, never
          // beyond the window we asked for.
          void sealRealPayloadExpiry(uuid, instructionMemo, expireMin);
        }
        setQrPng(data.refs?.qr_png);
        setDeeplink(data.next?.always);
        setPhase('waiting');
        timer = setInterval(() => void run.check(), 2500);
      } catch (e) {
        if (!run.alive) return;
        setPhase('error');
        // The request never reached Xaman: nothing could have been signed.
        setRetryable(true);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      run.alive = false;
      run.stopPolling();
      if (runRef.current === run) runRef.current = null;
      const uuid = run.uuid;
      if (!uuid) return;
      // Leaving a LIVE request (an ancestor unmounted us, or navigated away):
      // NO blind DELETE (productizer-it7) — an ALREADY_OPENED answer was read by
      // nobody and the request stayed signable in silence. The registry keeps
      // reading its status and the global banner says it is still open.
      // A signature whose ledger result is still being read ('confirming') is
      // handed off too: the registry reads the result and the banner says it (it.11).
      if (leaveAction({ uuid, decided: run.decided, confirming: !!run.confirmingTxid }) === 'hand-off') {
        handOffLiveRequest(meta(uuid));
      } else if (run.signedOpen) {
        // Signed, ledger outcome unread: nobody follows it after this point.
        noteUnfollowedSignature({ ...meta(uuid), txid: run.signedOpen.txid });
      }
    };
    // Un payload por tx ACTIVA (o por reintento). Depende de `active.key`, jamás
    // del prop crudo: un `txjson` nuevo mientras la firma bloquea no desmonta la
    // validación en curso de la anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, active.key]);

  // «Cancel this request»: ask Xaman first, then obey its answer — never the
  // other way round (payloadBus.cancelPayloadAndDecide + retreatDecision).
  const cancelRequest = useCallback(async () => {
    const run = runRef.current;
    if (!run || !run.alive || run.decided || !run.uuid || run.cancelling) return;
    const uuid = run.uuid;
    run.cancelRequested = true;
    run.cancelling = true;
    setCancelUi('cancelling');
    const { action } = await cancelPayloadAndDecide(uuid, () =>
      runRef.current === run && run.alive ? run.uuid : null,
    );
    run.cancelling = false;
    // Gone, replaced, or a poll already decided it (signed → confirming;
    // cancelled → already closed): that path owns the screen.
    if (!run.alive || runRef.current !== run || run.decided) return;
    const d = retreatDecision(action);
    switch (d.kind) {
      case 'closed':
        run.close();
        return;
      case 'follow':
        // Answered on the phone before we asked — maybe signed. Read it now;
        // the poll keeps going until it decides. No new payload, ever.
        setCancelUi('resolved');
        void run.check();
        return;
      case 'stay':
        setCancelUi(d.warn);
        return;
      case 'ignore':
        setCancelUi('idle');
        return;
    }
  }, []);

  const stray = strayStateOf(cancelUi);

  return (
    <div className="space-y-2 text-center">
      <p className="text-[12px] font-medium text-ink/75">{title}</p>
      {phase === 'creating' ? (
        <p className="flex items-center justify-center gap-2 text-[11px] text-ink/45">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Preparing the Xaman request…')}
        </p>
      ) : null}
      {phase === 'waiting' ? (
        <div className="space-y-2">
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrPng} alt={t('Scan with Xaman')} className="mx-auto h-44 w-44 rounded-lg" />
          ) : null}
          {deeplink ? (
            <a href={deeplink} target="_blank" rel="noreferrer" className="text-xs text-volt underline">
              {t('Open in Xaman')}
            </a>
          ) : null}
          {stray ? (
            <p className="mx-auto max-w-[46ch] text-[11px] leading-relaxed text-tone-warning">
              {payloadStrayNotice(stray, t)}
            </p>
          ) : null}
          {/* Hidden once Xaman said it had already answered: we are following
              that answer, and a second DELETE could only say the same. */}
          {cancelUi !== 'resolved' ? (
            <div>
              <button
                type="button"
                onClick={() => void cancelRequest()}
                disabled={cancelUi === 'cancelling'}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/60 hover:text-ink disabled:opacity-50"
              >
                {cancelUi === 'cancelling' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t('Cancel this request')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {phase === 'confirming' ? (
        <p className="flex items-center justify-center gap-2 text-[11px] text-ink/55">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Waiting for the ledger to validate…')}
        </p>
      ) : null}
      {phase === 'settled' ? (
        <p className="flex items-center justify-center gap-2 text-[11px] text-tone-success">
          <Check className="h-3.5 w-3.5" /> {t('Validated on the ledger')}
        </p>
      ) : null}
      {phase === 'cancelled' ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-ink/55">{t('Request cancelled in Xaman. Nothing was signed.')}</p>
          {/* A parent that keeps its order (no onCancelled) still needs a way
              forward; Xaman confirmed nothing was signed, so a new request is safe. */}
          {!onCancelled ? (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">
              {t('Try again')}
            </button>
          ) : null}
        </div>
      ) : null}
      {phase === 'unconfirmed' ? (
        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-left text-[11px] leading-relaxed text-amber-200">
          <p className="flex items-start gap-2 text-[12px] font-medium text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('We could not confirm your signature')}
          </p>
          <p>
            {txid
              ? t('Xaman reports it signed and sent, but the ledger had not validated the transaction when we stopped waiting. Do NOT sign it again: check this hash on the explorer and your account history first.')
              : t('Xaman reports it signed, but it returned no transaction hash. Check the account history before doing anything again — do NOT sign it again.')}
          </p>
          {txid ? (
            <a
              href={`${XRPSCAN_TX}${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all font-mono text-sky-300 underline underline-offset-2 hover:text-sky-200"
            >
              {txid}
            </a>
          ) : null}
        </div>
      ) : null}
      {phase === 'stale' && error ? (
        // No «Try again» on purpose: it would recreate this same spent payload.
        // The parent's own prepare (now free — 'stale' does not block) is the way
        // — UNLESS this is a council order whose sibling already went out (it.13).
        <div className="space-y-1.5">
          <p className="text-[11px] text-tone-warning">
            {staleFate?.kind === 'checking' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
            {t(staleSentence(staleFate))} ({error})
          </p>
          {staleFate && (staleFate.kind === 'already-out' || staleFate.kind === 'out-failed') && staleFate.txHash ? (
            <p className="text-[10px] text-ink/45">
              {t('The request that went out')}:{' '}
              <a
                href={`${XRPSCAN_TX}${staleFate.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono underline underline-offset-2"
              >
                {staleFate.txHash}
              </a>
            </p>
          ) : null}
          {txid ? (
            <a
              href={`${XRPSCAN_TX}${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all font-mono text-[10px] text-ink/45 underline underline-offset-2"
            >
              {txid}
            </a>
          ) : null}
        </div>
      ) : null}
      {phase === 'error' && error ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-tone-warning">{error}</p>
          {/* it. 21 (§3.3): where the seat stands after a request nobody signed,
              so «Try again» is not a walk into NONCE_SEAT_TAKEN. */}
          {seatNote ? <p className="text-[11px] leading-relaxed text-ink/55">{seatNote}</p> : null}
          {txid && !retryable ? (
            <a
              href={`${XRPSCAN_TX}${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all font-mono text-[10px] text-ink/45 underline underline-offset-2"
            >
              {txid}
            </a>
          ) : null}
          {retryable ? (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-md border border-ink/15 px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">
              {t('Try again')}
            </button>
          ) : null}
        </div>
      ) : null}
      {holding ? (
        <p className="text-[11px] leading-relaxed text-tone-warning">
          {t('A different transaction is waiting — it will not be offered until this one is resolved.')}
        </p>
      ) : null}
    </div>
  );
}

export default XamanSingleSign;

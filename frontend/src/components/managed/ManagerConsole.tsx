'use client';

/**
 * ManagerConsole — los tres botones del gestor, con el límite calculado ANTES
 * de firmar.
 *
 * EL DÍA DE UN GESTOR SON TRES VERBOS. El contrato es tajante: bajo
 * `onlyDirectorOrCouncil` solo hay `directTo`, `recall` y `moveToVenue`. Todo lo
 * demás —proponer un sitio, retirar uno, cambiar el tope, nombrar director,
 * evacuar— es `onlyCouncil`. Esa asimetría ES el producto, así que esta consola
 * enseña exactamente tres acciones y ninguna más: una pantalla con diez botones
 * de los que siete revierten enseñaría un poder que el gestor no tiene.
 *
 * ── POR QUÉ SE CALCULA EL LÍMITE AQUÍ ───────────────────────────────────────
 * `EntryCapExceeded` y `BufferFloorCrossed` son las dos formas de que una firma
 * se pierda, y las dos se pueden calcular con lo que `/pote-state` ya devuelve.
 * Decirle al gestor CUÁNTO PUEDE vale más que explicarle por qué no pudo — y en
 * un raíl donde cada intento paga gas, un revert evitable es dinero tirado.
 *
 * La aritmética, sacada del propio `_allocate`:
 *
 *   suelo        = totalAssets · BUFFER_FLOOR_BPS / 10000
 *   desplegable  = max(0, freeBalance − suelo)      ← el director no lo cruza
 *   hueco(venue) = max(0, totalAssets · maxVenueBps / 10000 − venueValue)
 *   meter        ≤ min(desplegable, hueco(destino))
 *   sacar        ≤ venueValue
 *   mover        ≤ min(valor origen, hueco(destino))
 *
 * `freeBalance` ya descuenta lo reclamable y lo reservado, así que no hay que
 * restarlo dos veces.
 *
 * ⚠ EL HUECO ES UNA ESTIMACIÓN, y la pantalla lo dice. El cap se comprueba
 * DESPUÉS del movimiento y sobre valores reales: un venue puede no acreditar
 * exactamente lo que le mandas (redondeo, tipo de cambio, comisión de entrada).
 * Vender ese número como exacto sería prometer que no va a revertir.
 *
 * ── DOS REGLAS QUE SE APLICAN ANTES DEL CLIC ────────────────────────────────
 *  · `moveToVenue` revierte con `VenueKindMismatch` si el ORIGEN está en cola.
 *    El botón sale deshabilitado, con el motivo escrito.
 *  · `recall` sobre un venue en cola NO devuelve el capital: lo encola. Se dice
 *    en el propio botón — enterarse después es la diferencia entre esperar y
 *    creer que algo se rompió.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink, Loader2, RefreshCw, ShieldX } from 'lucide-react';

import { Card, GhostButton, MicroLabel, PrimaryButton } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { signFailureAction, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { composeKindOf } from '../../lib/xrpl/singleSignVerdict';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { fmtBase, parseAmountToBase } from '../../lib/institutional/policyCatalog';
import { DRY_RUN, activeDryRunActor, dryRunExecuteCalls } from '../../lib/dryRun';
import {
  getPoteState,
  mayConfirmAnotherOrder,
  prepareDirect,
  prepareRecall,
  prepareCageOrder,
  relayCouncilOrder,
  sameOrderMinutesAgo,
  storedManagerVc,
  type CageOrderPrepared,
  type PoteState,
  type PoteVenue,
  type Refusal,
} from '../../lib/institutional/api';
import { isRetryableReadFailure } from '../../lib/xaman/seatRefusal';
import {
  CouncilOrderInFlightConfirm,
  ReadFailureNotice,
  CouncilOrderServerWarnings,
  StaleOrderLockNote,
  XamanSignBlockedNote,
  XamanSingleSign,
  useStaleOrderLock,
} from '../xrpl/XamanSingleSign';
import { CapitalBridge } from './CapitalBridge';
import { venueHue, venueStory } from '../../lib/institutional/venueStory';
import { venueIdentity } from '../../lib/institutional/venueIdentity';
import { useVenueYields, venueYieldKey } from '../../lib/institutional/useVenueYields';
import { readableAsOf, readableSource } from '../../lib/earn/rateSource';
import { shortAddr } from '../../lib/institutional/format';

// BigInt(N) y no `Nn`: el target de tsc esta por debajo de ES2020 y los
// literales BigInt no compilan. Misma familia que los 24 errores
// preexistentes de institutional/.
const BPS = BigInt(10000);
const ZERO = BigInt(0);
const big = (s: string | undefined) => { try { return BigInt(s ?? '0'); } catch { return ZERO; } };
const clamp0 = (v: bigint) => (v > ZERO ? v : ZERO);

type Verb = 'direct' | 'recall';

interface Pending {
  verb: Verb;
  venue: PoteVenue;
  max: bigint;
}

export function ManagerConsole({ pote, council, onShare, onBlockedChange }: { pote: string; council?: string; /** Copiar el enlace de captación (la barra vacía lo ofrece). */ onShare?: () => void; /** The council order's Xaman signature can no longer be dropped: the host must not unmount this console (pane/room switch). `false` on unmount. */ onBlockedChange?: (blocked: boolean) => void }) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [state, setState] = useState<PoteState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<Refusal | null>(null);
  const [error, setError] = useState('');
  // La orden de consejo preparada, esperando la firma Xaman (carril XRPL: el
  // gestor gobierna por su cuenta XRPL, no por una wallet EVM director).
  const [councilOrder, setCouncilOrder] = useState<CageOrderPrepared | null>(null);
  const [orderSent, setOrderSent] = useState(false);
  // 409 COUNCIL_ORDER_IN_FLIGHT (it.13): another order of this account is in
  // flight; composing beside it is an explicit confirm, never a silent retry.
  const [inFlight, setInFlight] = useState<{ detail?: string; code?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);
  /**
   * it.14 (R2 2.3): the council order of this desk went stale and its fate says
   * a sibling already went out (or could not be checked). «Put in» / «Pull out»
   * stay shut until the manager says they checked — the sentence inside the
   * signing card never stopped this console from composing the move again.
   */
  const staleLock = useStaleOrderLock();
  // XamanSingleSign says when the council order's signature can no longer be
  // dropped (confirming, unconfirmed, or validated with a failure).
  const [councilBlocked, setCouncilBlocked] = useState(false);
  // Pass-through to the host (ManagerDesk): unmounting this console with a live
  // or confirming signature drops it blind (productizer-it6).
  useEffect(() => { onBlockedChange?.(councilBlocked); }, [councilBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange?.(false), [onBlockedChange]);
  // Una firma EVM que no se pudo seguir (RECEIPT_UNREAD, RPC caído…): el panel
  // ámbar, y los botones de mover capital bloqueados hasta recargar la página —
  // el movimiento puede estar ya en la cadena y firmarlo otra vez lo duplica.
  const [unconfirmed, setUnconfirmed] = useState<(UnconfirmedSignature & { chainId: number }) | null>(null);
  const [signLocked, setSignLocked] = useState(false);
  // El tipo de HOY de cada destino, del protocolo y con fuente (#9).
  const venueYields = useVenueYields();

  const reload = useCallback(async () => {
    try {
      setState(await getPoteState(pote));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [pote]);

  useEffect(() => { void reload(); }, [reload]);

  /** El suelo, lo desplegable y el hueco de cada venue — la aritmética de arriba. */
  const math = useMemo(() => {
    if (!state) return null;
    const total = big(state.totalAssets);
    const free = big(state.freeBalance);
    const floor = (total * BigInt(state.bufferFloorBps)) / BPS;
    const capPerVenue = (total * BigInt(state.maxVenueBps)) / BPS;
    return {
      total,
      free,
      floor,
      deployable: clamp0(free - floor),
      headroomOf: (v: PoteVenue) => clamp0(capPerVenue - big(v.value)),
    };
  }, [state]);

  if (loadFailed) {
    return (
      <Card className="p-6">
        <p className="max-w-[62ch] text-sm leading-relaxed text-tone-warning/80">
          {t('The vault state could not be read right now, so this console cannot tell you what you may move. Nothing is broken — try again in a moment.')}
        </p>
        <GhostButton onClick={() => void reload()} className="mt-3">{t('Retry')}</GhostButton>
      </Card>
    );
  }

  if (!state || !math) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 text-sm text-ink/45">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Reading the vault…')}
        </p>
      </Card>
    );
  }

  const dec = state.asset.decimals;
  const sym = state.asset.symbol;

  /**
   * QUIEN ERES PARA ESTA BOVEDA, decidido con la misma regla que el modifier:
   * `msg.sender == council || (msg.sender == director && now < directorUntil)`.
   *
   * Se calcula ANTES de firmar porque este es el fallo que mas caro sale y peor
   * se lee: `NotDirectorOrCouncil` es un revert mudo que no dice cual de las dos
   * cosas falta. Le paso al fundador en agosto —se firmaba la orden y no
   * ejecutaba— y el diagnostico fue que nunca se habia cedido a nadie. Un aviso
   * aqui habria ahorrado esa tarde.
   *
   * Y ojo al segundo caso: un director cuyo mandato CADUCO sigue siendo el
   * `director` guardado en el contrato. Todo parece en orden y cada llamada
   * revierte. La autoridad caduca sola y no se renueva (I5) — decirlo es la
   * diferencia entre «se me acabo el plazo» y «esto esta roto».
   */
  const me = (evm.address ?? '').toLowerCase();
  const isCouncil = me !== '' && me === state.governance.council.toLowerCase();
  const isDirector = me !== '' && me === state.governance.director.toLowerCase();
  const untilMs = state.governance.directorUntil * 1000;
  const mandateOver = isDirector && !isCouncil && untilMs <= Date.now();
  const daysLeft = Math.ceil((untilMs - Date.now()) / 86400000);
  const mandateEndingSoon = isDirector && !isCouncil && !mandateOver && daysLeft <= 7;
  // «No puedes» SOLO si no hay ningún carril: ni director/council EVM, ni una
  // cuenta XRPL de consejo con la que firmar la orden. Con `council` disponible,
  // el gestor mueve capital por orden de consejo aunque su EVM no sea director.
  const cannotAct = evm.isConnected && !isCouncil && (!isDirector || mandateOver) && !council;

  async function run(opts?: { confirmAnotherOrder?: boolean }) {
    // A council order already waiting for its signature is THIS move: preparing
    // another would put a second order beside it.
    // it.16 (R3 3.1): «Pull out» / «Queue exit» take capital OUT, and an exit is
    // warned, never stopped — not by a record, not by the database, not by a
    // region and not by a lock of ours. Only «Put in» is paused, and «Compose it
    // again anyway» composes (the confirmation IS the person's check).
    if (!pending || !math || signLocked || councilOrder) return;
    if (staleLock.blocks(composeKindOf(pending.verb === 'recall' ? 'recall' : 'direct-to'), { confirmed: opts?.confirmAnotherOrder })) return;
    setDenied(null);
    setError('');
    setInFlight(null);
    const units = parseAmountToBase(amount, dec);
    if (units === null || units <= BigInt(0)) { setError(t('Enter an amount.')); return; }
    if (units > pending.max) { setError(t('That is more than this move allows right now.')); return; }

    setBusy(true);
    let handedToPartner = false;
    let signChainId = 14;
    try {
      // En el ensayo (fork local) el actor activo de la banda sustituye a la
      // wallet: misma calldata, ejecutada impersonándolo. Nada de esto es real.
      const dryFrom = DRY_RUN && !evm.isConnected ? activeDryRunActor() : null;

      // ¿Puede firmar por EVM? SOLO si la wallet conectada ES el director activo
      // o el council (direcciones EVM). Un gestor que gobierna por XRPL casi
      // nunca lo es — por eso el carril por defecto es la ORDEN DE CONSEJO.
      const evmCanSign = evm.isConnected && (isCouncil || (isDirector && !mandateOver));

      if (!evmCanSign && !dryFrom) {
        // Carril de CONSEJO por Xaman (pago XRPL → FDC → bridge.execute): el
        // gestor firma la orden con su cuenta XRPL, sin wallet EVM director. En
        // un managed vault v2 el consejo gobierna una JAULA, así que la orden va
        // por /cage-order (cage.directTo(pote, …)), NO por /pote-council-order
        // (que llamaría a un selector que la jaula no tiene → COUNCIL_GOVERNS_A_CAGE).
        if (!council) {
          throw new Error(t('Connect your Flare wallet (this vault’s director) — or open this desk from the XRPL account that governs it to move capital by council order.'));
        }
        const r = await prepareCageOrder({
          council,
          action: pending.verb === 'direct' ? 'direct-to' : 'recall',
          params: { pote, venueId: pending.venue.id, amount: units.toString() },
          managerCredentialJwt: storedManagerVc(),
          ...(opts?.confirmAnotherOrder ? { confirmAnotherOrder: true } : {}),
        });
        if (!r.ok) {
          // it. 21 (§2.7): «could not check» arrives at the same door as «already
          // went out», and needs its own sentence plus a retry.
          if (mayConfirmAnotherOrder(r.refusal) && !opts?.confirmAnotherOrder) {
            setInFlight({ detail: r.refusal.detail, code: r.refusal.error, minutesAgo: sameOrderMinutesAgo(r.refusal), retryAfterSeconds: r.refusal.retryAfterSeconds ?? null });
            return;
          }
          setDenied(r.refusal);
          return;
        }
        setCouncilOrder(r.data); // la firma sigue en el modal Xaman de abajo
        return;
      }

      const input = { pote, venueId: pending.venue.id, amountBase: units.toString() };
      const res = pending.verb === 'direct' ? await prepareDirect(input) : await prepareRecall(input);
      // Si la jaula dice que no, se enseña LITERAL. Traducir un rechazo del
      // contrato a nuestras palabras es reescribir lo que dijo el contrato.
      if (!res.ok) { setDenied(res.refusal); return; }
      if (dryFrom) {
        const dr = await dryRunExecuteCalls(dryFrom, res.data.calls);
        if (!dr.ok) { setDenied({ status: 409, error: dr.error, detail: dr.detail }); return; }
        void reload();
      } else {
        signChainId = res.data.calls[0]?.chainId ?? 14;
        handedToPartner = true;
        const { handle } = await evm.sendIntentCalls(
          res.data.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
        );
        settlement.track(handle, { onSettled: () => void reload() });
      }
      setPending(null);
      setAmount('');
    } catch (e) {
      // run() prepares afresh on every click, so 'form' and 'review' both end
      // as the message under the pending card; only 'unconfirmed' differs.
      const action = signFailureAction(e, handedToPartner, t);
      if (action.view === 'unconfirmed') {
        setError('');
        setUnconfirmed({ txHash: action.txHash, trace: action.trace, chainId: signChainId });
        setSignLocked(true);
        setPending(null);
        setAmount('');
      } else {
        setError(action.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {(cannotAct || mandateEndingSoon) && (
        <Card className={`p-4 ${cannotAct ? 'border-tone-danger/30' : 'border-tone-warning/30'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`mt-0.5 h-4 w-4 shrink-0 ${cannotAct ? 'text-tone-danger' : 'text-tone-warning'}`}
              strokeWidth={1.8}
            />
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink/70">
              {mandateOver
                ? t('Your mandate over this vault has expired, so every action here would revert. Authority runs out on its own and never renews itself — the council has to grant it again.')
                : cannotAct
                  ? t('This wallet is neither the council nor the current director of this vault, so the contract will refuse every move. Nothing is broken: it was simply never granted to this address.')
                  : `${t('Your mandate over this vault ends in')} ${daysLeft} d — ${t('after that, every action reverts until the council grants it again.')}`}
            </p>
          </div>
        </Card>
      )}

      {/* EL PUENTE (11-sep): la bóveda entera como UNA barra — lo que trabaja
          en cada destino, lo desplegable hoy y el suelo — con las cifras como
          leyenda. Sustituye a las cuatro cifras sueltas. */}
      <CapitalBridge
        total={math.total}
        free={math.free}
        floor={math.floor}
        deployable={math.deployable}
        floorBps={state.bufferFloorBps}
        decimals={dec}
        symbol={sym}
        venues={state.venues.map((v) => ({ id: v.id, label: venueStory(v.target, v.kind === 'compoundv2' ? 0 : v.kind === 'erc4626queued' ? 2 : 1, t).label, value: big(v.value), hue: venueHue(v.target), retired: v.retired }))}
        onShare={onShare}
      />

      {/* Above the board, not inside the pending card: the card is gone as soon
          as the order is dropped, and the pause has to keep saying why the three
          verbs are shut (it.14, R2 2.3). */}
      <StaleOrderLockNote lock={staleLock.lock} onRelease={staleLock.release} pausing={staleLock.pausing} />

      {/* El tablero: un venue por fila, con lo que tiene, lo que le cabe y los
          tres verbos. Un venue que no admite una acción no la ofrece gris: la
          ofrece con el motivo escrito. */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>{t('Destinations — where the capital works')}</MicroLabel>
          <button
            onClick={() => void reload()}
            className="inline-flex items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-ink"
          >
            <RefreshCw className="h-3 w-3" /> {t('Refresh')}
          </button>
        </div>

        <ul className="mt-4 space-y-3">
          {state.venues.map((v) => {
            const value = big(v.value);
            const headroom = math.headroomOf(v);
            const pct = math.total > BigInt(0) ? Number((value * BigInt(10000)) / math.total) / 100 : 0;
            const notReady = v.readyAt * 1000 > Date.now();
            const queued = v.kind === 'erc4626queued';
            const canDirect = !v.retired && !notReady && headroom > BigInt(0) && math.deployable > BigInt(0);

            return (
              <li key={v.id} className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
                {(() => {
                  // El destino CON NOMBRE (mapa verificado), su mecanismo y su tipo
                  // de hoy — no una dirección pelada (11-sep).
                  const kindNum = v.kind === 'compoundv2' ? 0 : v.kind === 'erc4626queued' ? 2 : 1;
                  const st = venueStory(v.target, kindNum, t);
                  const site = venueIdentity(v.target).website;
                  const ykey = venueYieldKey(v.target);
                  const y = ykey && venueYields.yields ? venueYields.yields[ykey] : undefined;
                  const src = y && y.kind !== 'none' ? readableSource(y.source) : null;
                  const asOf = readableAsOf(venueYields.asOf);
                  return (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `hsl(${venueHue(v.target)} 62% 52%)` }} aria-hidden />
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold text-ink">
                              {st.known ? st.label : shortAddr(v.target)}
                              <a href={`https://flarescan.com/address/${v.target}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] font-normal text-ink/40 hover:text-ink/70">
                                {shortAddr(v.target)} <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </p>
                            <p className="mt-0.5 max-w-[60ch] text-[11px] leading-relaxed text-ink/50">{st.does}</p>
                            {ykey ? (
                              y && y.kind !== 'none' ? (
                                <p className="mt-1 text-[11px] text-ink/55">
                                  <span className="font-mono text-[12px] text-ink/85">{y.pct.toFixed(2)}% {y.kind.toUpperCase()}</span>
                                  <span className="text-ink/40"> · {t('today')}</span>
                                  {src ? <span className="text-ink/40" title={src.tech}> · {t(src.text)}</span> : null}
                                  {asOf ? <span className="text-ink/35"> · {asOf}</span> : null}
                                </p>
                              ) : venueYields.yields ? (
                                <p className="mt-1 text-[11px] text-ink/45">
                                  {y && y.kind === 'none' ? t(y.label) : t('Live rate unavailable — check the protocol')}
                                  {site ? <> · <a href={site} target="_blank" rel="noopener noreferrer" className="text-volt hover:underline">{t('check it there')}</a></> : null}
                                </p>
                              ) : null
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-right font-mono text-[13px] text-ink/85">
                          {fmtBase(value, dec)} <span className="text-ink/40">{sym}</span>
                          <span className="block text-[11px] text-ink/40">{pct.toFixed(1)}% {t('of the vault')}</span>
                        </span>
                      </div>
                    </>
                  );
                })()}

                <p className="mt-1 text-[11px] text-ink/40">
                  {v.retired
                    ? t('Retired — capital can only come out.')
                    : notReady
                      ? `${t('Opens for entry in')} ${Math.ceil((v.readyAt * 1000 - Date.now()) / 86400000)} d`
                      : `${t('Room left here')}: ≈ ${fmtBase(headroom, dec)} ${sym}`}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <GhostButton
                    onClick={() => { setPending({ verb: 'direct', venue: v, max: headroom < math.deployable ? headroom : math.deployable }); setAmount(''); setError(''); }}
                    disabled={!canDirect || signLocked || !!councilOrder || staleLock.blocks('other')}
                    className="text-xs"
                  >
                    <ArrowUpRight className="mr-1 inline h-3.5 w-3.5" /> {t('Put in')}
                  </GhostButton>
                  {/* it.16 (R3 3.1): an exit door is never closed by the stale lock. */}
                  <GhostButton
                    onClick={() => { setPending({ verb: 'recall', venue: v, max: value }); setAmount(''); setError(''); }}
                    disabled={value === BigInt(0) || signLocked || !!councilOrder}
                    className="text-xs"
                  >
                    <ArrowDownLeft className="mr-1 inline h-3.5 w-3.5" />{' '}
                    {queued ? t('Queue exit') : t('Pull out')}
                  </GhostButton>
                </div>

                {queued && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink/40">
                    {t('This venue exits through a queue: pulling out starts the wait, it does not return the capital now.')}
                  </p>
                )}
              </li>
            );
          })}
          {state.venues.length === 0 && (
            <li className="text-sm text-ink/45">{t('No venues allowed yet — the council proposes them, and each one waits 30 days.')}</li>
          )}
        </ul>
        {/* `moveToVenue` no tiene ruta todavía (existe en el contrato, no como
            /pote-move/prepare): se dice una vez al pie, no como botón muerto
            en cada fila. */}
        {state.venues.length > 1 ? (
          <p className="mt-3 text-[11px] text-ink/35">{t('Moving straight between destinations is not available yet — pull out, then put in.')}</p>
        ) : null}
      </Card>

      {/* While a council order waits for its Xaman signature, the pending card
          (and its «Review and sign») is gone: a second click replaced the order
          under the mounted QR of the first one. It comes back if the order is
          cancelled before anything reached the ledger. */}
      {pending && !councilOrder && (
        <Card className="p-6">
          <MicroLabel>
            {pending.verb === 'direct' ? t('Put in') : t('Pull out')} ·{' '}
            {venueStory(pending.venue.target, pending.venue.kind === 'compoundv2' ? 0 : pending.venue.kind === 'erc4626queued' ? 2 : 1, t).label}
          </MicroLabel>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.0"
              className="w-44 rounded-lg border border-ink/15 bg-transparent px-3 py-2 font-mono text-sm text-ink outline-none focus:border-volt/50"
            />
            <span className="font-mono text-xs text-ink/45">{sym}</span>
            <button
              onClick={() => setAmount(fmtBase(pending.max, dec, dec))}
              className="rounded-lg border border-ink/15 px-2.5 py-1.5 text-[11px] text-ink/55 transition-colors hover:text-ink"
            >
              {t('Max')} {fmtBase(pending.max, dec)}
            </button>
          </div>

          {pending.verb === 'direct' && (
            <p className="mt-2 max-w-[62ch] text-[11px] leading-relaxed text-ink/35">
              {t('The cap is checked after the move, on real values — a venue may not credit exactly what you send, so treat this maximum as an estimate.')}
            </p>
          )}

          {error && <p className="mt-3 text-sm text-tone-danger">{error}</p>}

          {inFlight ? (
            <CouncilOrderInFlightConfirm
              className="mt-3"
              detail={inFlight.detail}
              code={inFlight.code}
              minutesAgo={inFlight.minutesAgo}
              retryAfterSeconds={inFlight.retryAfterSeconds}
              busy={busy}
              onConfirm={() => void run({ confirmAnotherOrder: true })}
              onRetry={() => void run()}
              onDismiss={() => setInFlight(null)}
            />
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton onClick={() => void run()} disabled={busy || signLocked || !!inFlight || staleLock.blocks(composeKindOf(pending.verb === 'recall' ? 'recall' : 'direct-to'))}>
              {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
              {t('Review and sign')}
            </PrimaryButton>
            <GhostButton onClick={() => { setPending(null); setError(''); setInFlight(null); }}>{t('Cancel')}</GhostButton>
          </div>

          <p className="mt-3 text-[11px] text-ink/35">
            {t('Astryum builds the call; your wallet signs it. It never signs for you.')}
          </p>
        </Card>
      )}

      {/* La firma de la ORDEN DE CONSEJO en Xaman (carril XRPL): el gestor firma
          un pago que el FDC atesta y el bridge ejecuta. Astryum no firma. */}
      {councilOrder && (
        <Card className="p-6">
          <MicroLabel>{t('Sign the council order in Xaman')}</MicroLabel>
          <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-ink/55">{t(councilOrder.disclosure.title)}</p>
          <CouncilOrderServerWarnings
            className="mt-3"
            recoveryWarning={councilOrder.recoveryWarning}
            inFlightWarning={councilOrder.inFlightWarning}
            duplicateWarning={councilOrder.duplicateWarning}
          />
          <div className="mt-3">
            <XamanSingleSign
              txjson={councilOrder.xrplTx as Record<string, unknown>}
              title={t('Your council signature')}
              onSettled={(hash) => {
                // El relay contesta {ok:false} en un HTTP de error (revisión
                // 10-sep): si se niega, se dice — no un «orden enviada» sobre
                // una orden que Flare nunca verá.
                void relayCouncilOrder(hash, councilOrder.order.orderData).then(
                  (r) => {
                    if (!r.ok) { setOrderSent(false); setError(`${t('Signed, but the relay refused')} — HTTP ${r.status}${r.detail ? ` — ${r.detail}` : ''}`); }
                  },
                  (e: unknown) => { setOrderSent(false); setError(`${t('Signed, but the relay did not start')} — ${e instanceof Error ? e.message : String(e)}`); },
                );
                setCouncilOrder(null);
                setPending(null);
                setAmount('');
                setOrderSent(true);
                // El FDC tarda ~2-5 min; se refresca el estado un poco después.
                setTimeout(() => void reload(), 4000);
              }}
              onBlockedChange={setCouncilBlocked}
              onCancelled={() => setCouncilOrder(null)}
              // it.14: a stale whose sibling already went out pauses this desk.
              onStaleFate={staleLock.report}
            />
          </div>
          {/* Cancel drops the order, and a dropped order is prepared and signed
              again. From the moment the QR is live (13-sep: not only once
              signed) that is a second council order, so Cancel goes away and
              the way out is «Cancel this request», which asks Xaman first. */}
          {councilBlocked ? (
            <XamanSignBlockedNote className="mt-3" />
          ) : (
            <button type="button" onClick={() => setCouncilOrder(null)} className="mt-3 text-[11px] text-ink/50">
              {t('Cancel')}
            </button>
          )}
        </Card>
      )}

      {unconfirmed && (
        <UnconfirmedSignatureNotice
          rail="evm"
          chainId={unconfirmed.chainId}
          unconfirmed={unconfirmed}
          onClose={() => {
            setUnconfirmed(null);
            void reload();
          }}
        />
      )}

      {signLocked && !unconfirmed && (
        <Card className="border-tone-warning/30 p-4">
          <p className="max-w-[70ch] text-[12px] leading-relaxed text-ink/60">
            {t('A previous signature could not be confirmed, so moving capital is paused on this screen. Check the vault above and the explorer first — reload the page to move capital again.')}
          </p>
        </Card>
      )}

      {/* The relay's refusal after a settled council order used to be written
          into the pending card, which the settle had just removed: the success
          card vanished and nothing said why. */}
      {error && !(pending && !councilOrder) && (
        <Card className="border-tone-danger/30 p-4">
          <p className="max-w-[70ch] text-[12px] leading-relaxed text-tone-danger">{error}</p>
        </Card>
      )}

      {orderSent && !councilOrder && (
        <Card className="border-tone-success/25 p-4">
          <p className="text-[12px] leading-relaxed text-tone-success/90">
            {t('Order signed. It travels XRPL → FDC → the vault (~2–5 min). The move shows here once it settles.')}
          </p>
        </Card>
      )}

      {/* it. 21 (it. 20 §3.5) — ACCOUNT_BUSY Y PROOF_STORE_UNREADABLE NO SON UN
          RECHAZO DE LA JAULA. Son 503: una lectura NUESTRA que falló. Pintarlos
          bajo «The cage refused», con el código crudo en monoespaciada y el
          `detail` en castellano debajo, acusa al contrato de algo que no dijo y
          deja sin botón el reintento que el servidor sí promete. */}
      {denied && isRetryableReadFailure(denied) ? (
        <ReadFailureNotice refusal={denied} busy={busy} onRetry={() => void run()} />
      ) : null}

      {/* El rechazo de la jaula, literal. Es la prueba de que los límites son
          del contrato y no de esta pantalla. */}
      {denied && !isRetryableReadFailure(denied) && (
        <Card className="border-tone-danger/30 p-6">
          <div className="flex items-start gap-3">
            <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-tone-danger" strokeWidth={1.7} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-tone-danger">{t('The cage refused')}</p>
              <p className="mt-1 font-mono text-[12px] text-ink/70">{denied.error}</p>
              {denied.detail && <p className="mt-1 text-[12px] leading-relaxed text-ink/50">{denied.detail}</p>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default ManagerConsole;

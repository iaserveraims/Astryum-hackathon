'use client';

/**
 * BorrowFlowRunner — el flujo, ejecutándose.
 *
 * Una sola superficie que lleva al usuario desde donde está su capital hasta la
 * posición abierta, sin que tenga que saber qué modal abrir ni en qué orden.
 * Los pasos NO se eligen: se derivan del origen que el usuario marcó con sus
 * opciones (wallet + con qué paga), y este componente los recorre — prepara la
 * transacción de cada uno contra su endpoint, la pone a firmar en la wallet que
 * toca (Xaman o EVM), espera lo que haya que esperar, y pasa al siguiente.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Check, AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { PrimaryButton } from '../ui/primitives';
import { getApiBase } from '../../lib/env';
import { getUserRegion } from '../../lib/region';
import { getCarrierXrp } from '../../lib/flare/carrier';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { startPending } from '../../lib/settlement/settlement';
import { inFlightInfo } from '../../lib/wallet/inFlightError';
import { signOutcome } from '../../lib/wallet/signOutcome';
import { notifyHandoffSigned } from '../../lib/wallet/handoffRelease';
import { describeStaleSignature, seatRefusalSentence } from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { noteFlareInstructionDelivery } from '../../lib/xaman/liveRequests';
import { emCallsFromLegs, toBaseUnits, type EmLeg } from '../../lib/earn/ethMorphoPrepare';
import {
  buildEntryFlow, currentStep, isComplete, isBlocked, advance, setStatus, retry,
  type FlowState, type FlowStep,
} from '../../lib/earn/borrowFlow';
import { ETHEREUM_CHAIN_ID, type FxrpOrigin } from '../../lib/earn/fxrpOrigin';

const API_BASE = getApiBase();

/**
 * LO QUE ESTE PASO PUEDE ENSEÑAR DE UN RECHAZO.
 *
 * El paso pinta su `detail` en la fila que falló, y hasta aquí ese texto era
 * `body.detail || body.error`: el párrafo en castellano del servidor (con
 * hashes dentro) o, peor, su slug crudo. Las dos cosas son lo que el ciclo
 * prohíbe enseñar. El orden es: la frase del asiento → el titular del lector
 * compartido (que convierte un slug en frase y conoce los «no pude leer») → el
 * `detail` solo si está en el idioma de la pantalla. El paso falla igual: lo
 * que cambia es que se puede leer, y el botón «Try this step again» sigue
 * debajo.
 */
function refusalSentence(body: unknown, status: number, t: (s: string) => string): string {
  const seat = seatRefusalSentence(body, t);
  if (seat) return seat;
  const r = (body ?? {}) as { error?: string | null; code?: string | null; detail?: string | null };
  const head = refusalHeadline(r, t);
  const detail = serverDetailIfEnglish(r.detail);
  const said = [head, detail].filter((p): p is string => Boolean(p)).join(' — ');
  return said || `${t('The server refused this step. Nothing was prepared and nothing was signed.')} (HTTP ${status})`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface BorrowFlowRunnerProps {
  origin: FxrpOrigin;
  /** La wallet EVM que recibe el FXRP, aporta el colateral y cobra el RLUSD. */
  destination: string;
  /** FXRP a aportar, en unidades humanas. Para el origen mint es el techo teórico. */
  supplyAmount: string;
  /** Solo origen `xrpl-mint`: XRP BRUTO que paga Xaman (el neto llega como FXRP). */
  mintXrpAmount?: string;
  /** RLUSD a pedir, en unidades humanas. Vacío = solo aportar colateral. */
  borrowAmount: string;
  /** Decimales LEÍDOS del colateral y del préstamo — nunca asumidos (F4). */
  decimals: { collateral: number; loan: number };
  /**
   * El RLUSD prestado entra en la bóveda de Sentora dentro de la MISMA firma de
   * la entrada (approve + deposit tras el borrow). Lo marcó el usuario en el
   * formulario; aquí solo cambia la calldata del último paso y lo que se dice.
   */
  lendBorrowed?: boolean;
  /** El flujo terminó entero (última firma asentada). Aquí se arma la protección. */
  onComplete?: () => void;
  onDone?: () => void;
}

export function BorrowFlowRunner({
  origin, destination, supplyAmount, mintXrpAmount, borrowAmount, decimals, lendBorrowed,
  onComplete, onDone,
}: BorrowFlowRunnerProps) {
  const { t } = useT();
  const evm = useWalletPartner();
  const xrpl = useXrplWalletPartner();
  const settlement = useSettlement();

  const [flow, setFlow] = useState<FlowState>(() =>
    buildEntryFlow(origin, destination, { lendBorrowed: !!lendBorrowed }),
  );
  /**
   * «Firmar todas a la vez» hasta donde la física llega: UNA sola firma para
   * los tres tramos es imposible con estos raíles — cada firma gasta fondos
   * que no existen hasta que el tramo anterior ASIENTA (el FXRP del puente
   * nace con la atestación FDC; el de la entrada, con la entrega LayerZero),
   * y pre-firmar para que un servidor retransmita luego sería Astryum
   * ejecutando con discreción (invariante #8: jamás). Lo que SÍ se puede: el
   * usuario aprieta UNA vez, y cada firma siguiente SE LE PIDE sola en cuanto
   * su tramo está listo — cero clics entre medias, solo la wallet abriéndose.
   */
  const [autoRun, setAutoRun] = useState(false);
  /** Candado contra el doble disparo (efecto + clic, o StrictMode en dev). */
  const running = useRef(false);
  /**
   * El FXRP que REALMENTE viaja tras el mint: el pago de Xaman trae las
   * comisiones dentro, así que el neto lo dice el prepare del mint y los pasos
   * siguientes puentean y aportan ESA cifra — puentear el bruto revertiría por
   * saldo. En ref además de estado: los callbacks de settlement lo leen después.
   */
  const carriedFxrp = useRef<string | null>(null);
  const [carriedShown, setCarriedShown] = useState<string | null>(null);
  const step = currentStep(flow);

  const effectiveSupply = () => carriedFxrp.current ?? supplyAmount;

  /** Cierra el paso al asentarse; si era el último, dispara onComplete UNA vez. */
  const settleAndAdvance = useCallback(() => {
    setFlow((f) => {
      const next = advance(setStatus(f, 'done'));
      if (next.cursor >= next.steps.length) onComplete?.();
      return next;
    });
  }, [onComplete]);

  /** Pide al servidor la tx del paso actual. Nunca la construye aquí. */
  const prepareStep = useCallback(
    async (s: FlowStep): Promise<
      | { rail: 'evm'; legs: EmLeg[]; chainId: number }
      | { rail: 'xrpl'; xrplPayment: unknown; memoHex?: string }
    > => {
      const region = getUserRegion();
      if (s.kind === 'pa-withdraw') {
        // FXRP libre del Personal Account → la wallet EVM de destino, como
        // 0xFE userOp firmado en Xaman. El carrier se lee en vivo (no es un
        // knob del usuario) y también mintea un poco de FXRP en el PA — se
        // divulga, nada se pierde.
        const carrierXrp = await getCarrierXrp();
        const res = await fetch(`${API_BASE}/flare-demo/pa-transfer/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            xrplAddress: s.signer,
            evmWallet: destination,
            amountFxrpBase: toBaseUnits(supplyAmount, decimals.collateral),
            amountXrpForMint: carrierXrp,
            region,
          }),
        });
        const body = await res.json().catch(() => ({}));
        // EL ASIENTO DE NONCE, EN INGLÉS (R5 5.4): el paso enseña su
        // `detail`, y el del servidor viene en castellano y con hashes.
        if (!res.ok) throw new Error(refusalSentence(body, res.status, t));
        // The executor word the server sent with this 0xFE, so
        // the live banner stops falling back to the prudent sentence over a step
        // the server does carry. Read defensively — no field, no promise.
        noteFlareInstructionDelivery(body.xrplPayment, body.serverDelivery);
        return { rail: 'xrpl', xrplPayment: body.xrplPayment, memoHex: body.memoHex };
      }
      if (s.kind === 'mint-to-evm') {
        const res = await fetch(`${API_BASE}/wallet-transfer/bridge/xrpl-to-flare/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            xrplAddress: s.signer,
            evmDestination: destination,
            amountXrp: mintXrpAmount,
            region,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(refusalSentence(body, res.status, t));
        const net = body?.disclosure?.netFxrp;
        if (typeof net === 'number' && net > 0) {
          carriedFxrp.current = String(net);
          setCarriedShown(String(net));
        }
        noteFlareInstructionDelivery(body.xrplPayment, body.serverDelivery);
        return { rail: 'xrpl', xrplPayment: body.xrplPayment };
      }
      if (s.kind === 'bridge') {
        const res = await fetch(`${API_BASE}/eth-morpho/bridge/prepare`, {
          method: 'POST',
          headers: authHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            user: destination,
            amountBase: toBaseUnits(effectiveSupply(), decimals.collateral),
            direction: 'to-ethereum',
            region,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(refusalSentence(body, res.status, t));
        return { rail: 'evm', legs: body.legs, chainId: body.chainId };
      }
      // La entrada: colateral y préstamo en UNA preparación — tres transacciones
      // que el usuario firma de una vez si su wallet agrupa.
      const res = await fetch(`${API_BASE}/eth-morpho/prepare`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          action: 'open_carry',
          user: destination,
          amountBase: toBaseUnits(effectiveSupply(), decimals.collateral),
          borrowBase: toBaseUnits(borrowAmount || '0', decimals.loan),
          // Marcado en el formulario: el servidor añade approve+deposit en
          // Sentora a la misma preparación — cinco transacciones, una firma.
          lendBorrowed: !!lendBorrowed,
          region,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusalSentence(body, res.status, t));
      return { rail: 'evm', legs: body.legs, chainId: body.chainId ?? ETHEREUM_CHAIN_ID };
    },
    [destination, mintXrpAmount, supplyAmount, borrowAmount, decimals, lendBorrowed, t],
  );

  /** Prepara, firma y deja el paso asentándose. El avance lo decide el settlement. */
  const runStep = useCallback(async () => {
    const s = currentStep(flow);
    if (!s || s.status !== 'pending') return;
    if (running.current) return;
    running.current = true;
    setFlow((f) => setStatus(f, 'preparing'));
    // True from the moment the step goes to Xaman / the EVM wallet: after that,
    // an error that does not PROVE nothing left is 'unconfirmed', never a retry.
    let handedToPartner = false;
    try {
      // La wallet conectada tiene que SER el firmante del paso — descubrirlo
      // tras construir la tx sería fallar con la wallet abierta.
      if (s.rail === 'xrpl') {
        // No session in this browser is fine: the prepared payload pins the
        // signer and Xaman asks for it. A DIFFERENT live account is
        // still refused before anything is built.
        if (xrpl.isConnected && xrpl.address && xrpl.address.toLowerCase() !== s.signer.toLowerCase()) {
          throw new Error(t('Open Xaman with this exact account to sign this entry.'));
        }
      } else {
        if (!evm.isConnected || !evm.address) {
          throw new Error(t('Connect your EVM wallet (Flare) to continue'));
        }
        if (evm.address.toLowerCase() !== destination.toLowerCase()) {
          throw new Error(t('Your connected EVM account is different — reconnect with the selected wallet to sign.'));
        }
      }

      const prepared = await prepareStep(s);
      setFlow((f) => setStatus(f, 'signing'));

      if (prepared.rail === 'xrpl') {
        handedToPartner = true;
        const { txHash } = await xrpl.sendIntent({ tx: prepared.xrplPayment as never });
        // El backend aprende «firmado»: el asiento de
        // nonce queda intocable hasta ejecutar o aparcar — sin gemelos.
        notifyHandoffSigned(prepared.memoHex, txHash);
        setFlow((f) => setStatus(f, 'settling'));
        // Firmado ≠ minteado: la máquina de settlement sigue la ejecución 0xFE
        // en Flare y solo entonces el flujo avanza.
        settlement.track(startPending('xrpl-mint', txHash), { onSettled: settleAndAdvance });
      } else {
        handedToPartner = true;
        const { handle } = await evm.sendIntentCalls(emCallsFromLegs(prepared.legs, prepared.chainId));
        setFlow((f) => setStatus(f, 'settling'));
        settlement.track(handle, { onSettled: settleAndAdvance });
      }
    } catch (e) {
      // «Salió y no sé si entró» NO es un fallo: aquí reintentar es pagar el
      // peaje del puente (o el gas de la entrada) por segunda vez. Y un «Failed
      // to fetch» o un timeout DESPUÉS de entregar el paso a la wallet tampoco
      // (signOutcome): 'unconfirmed', que ni avanza ni ofrece reintentar.
      // FIRMADO TARDE (R5 5.2): tefMAX_LEDGER / tefPAST_SEQ es un
      // veredicto LEÍDO — ese payload no entra en ningún ledger — así que el
      // paso queda 'failed' con «prepáralo otra vez» y su botón de reintento,
      // no 'unconfirmed', que congela el flujo prohibiendo la única salida.
      const stale = describeStaleSignature(e, t);
      if (stale) {
        setFlow((f) => setStatus(f, 'failed', stale.text));
        return;
      }
      const outcome = signOutcome(e, handedToPartner);
      if (outcome.kind === 'unconfirmed') {
        const txHash = inFlightInfo(e)?.txHash ?? outcome.txHash;
        setFlow((f) => setStatus(f, 'unconfirmed', txHash));
      } else {
        setFlow((f) => setStatus(f, 'failed', (e as Error).message));
      }
    } finally {
      running.current = false;
    }
  }, [flow, prepareStep, evm, xrpl, destination, settlement, settleAndAdvance, t]);

  /**
   * El encadenado: con autoRun puesto, cada paso que queda en `pending` (el
   * primero al pulsar, y cada siguiente cuando el anterior asienta) se dispara
   * solo — prepara y ABRE la wallet sin más clics. Un fallo o un «sin
   * confirmar» lo frena (`runStep` solo corre sobre `pending`), así que el
   * modo automático jamás firma por encima de un problema.
   */
  useEffect(() => {
    if (!autoRun) return;
    const s = currentStep(flow);
    if (s && s.status === 'pending') void runStep();
  }, [autoRun, flow, runStep]);

  const LABEL: Record<FlowStep['kind'], string> = {
    'pa-withdraw': t('Move the FXRP out of your Personal Account'),
    'mint-to-evm': t('Pay XRP in Xaman — it arrives as FXRP in your EVM wallet on Flare'),
    bridge: t('Bridge the FXRP to Ethereum'),
    'enter-market': lendBorrowed
      ? t('Supply the collateral, borrow, and lend the RLUSD in the Sentora vault')
      : t('Supply the collateral and borrow'),
  };
  const WAIT: Record<string, string> = {
    'fdc-attestation': t('waiting for settlement on Flare…'),
    'layerzero-delivery': t('waiting for the bridge to deliver…'),
  };

  if (isComplete(flow)) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Check className="w-8 h-8 text-tone-success" strokeWidth={1.6} />
        {/* La pantalla final dice lo que PASÓ: dónde está el RLUSD ahora. */}
        <p className="text-sm text-ink/85">
          {lendBorrowed
            ? t('Position open. Your borrowed RLUSD is lent in the Sentora vault.')
            : t('Position open. Your RLUSD is in your wallet.')}
        </p>
        {onDone && (
          <button onClick={onDone} className="text-[11px] text-sky-300 hover:text-sky-200 underline underline-offset-2">
            {t('See it in Positions →')}
          </button>
        )}
      </div>
    );
  }

  const busy = step?.status === 'preparing' || step?.status === 'signing' || step?.status === 'settling';

  return (
    <div className="space-y-3">
      {carriedShown && (
        <p className="text-[11px] text-ink/55">
          {t('After mint fees, the FXRP that travels is')}{' '}
          <span className="font-mono font-medium">{carriedShown} FXRP</span>.
        </p>
      )}
      <ol className="space-y-2">
        {flow.steps.map((s, i) => {
          const isCurrent = i === flow.cursor;
          const isPast = i < flow.cursor;
          return (
            <li
              key={s.kind}
              className={`flex items-start gap-2.5 rounded-xl p-3 border ${
                isCurrent
                  ? 'border-volt/30 bg-volt/5'
                  : isPast
                    ? 'border-ink/5 bg-ink/[0.02]'
                    : 'border-ink/5 opacity-50'
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {isPast || s.status === 'done' ? (
                  <Check className="w-4 h-4 text-tone-success" strokeWidth={2} />
                ) : s.status === 'failed' || s.status === 'unconfirmed' ? (
                  <AlertTriangle className="w-4 h-4 text-tone-warning" strokeWidth={1.8} />
                ) : busy && isCurrent ? (
                  <Loader2 className="w-4 h-4 text-volt animate-spin motion-reduce:animate-none" />
                ) : (
                  <span className="block w-4 h-4 rounded-full border border-ink/20 text-[9px] leading-4 text-center text-ink/40 font-mono">
                    {i + 1}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs ${isCurrent ? 'text-ink/85 font-medium' : 'text-ink/55'}`}>
                  {LABEL[s.kind]}
                </p>
                <p className="text-[10px] text-ink/40 mt-0.5">
                  {s.rail === 'xrpl'
                    ? t('signed in Xaman')
                    : s.chainId === ETHEREUM_CHAIN_ID
                      ? t('signed on Ethereum')
                      : t('signed on Flare')}
                  {s.txCount > 1 && ` · ${s.txCount} ${t('transactions in one signature')}`}
                </p>
                {isCurrent && s.status === 'settling' && s.waitAfter && (
                  <p className="text-[10px] text-ink/45 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" aria-hidden /> {WAIT[s.waitAfter]}
                  </p>
                )}
                {isCurrent && s.status === 'unconfirmed' && (
                  <p className="text-[10px] text-tone-warning/80 mt-1 leading-relaxed">
                    {t('It was sent, but the receipt could not be read. Do NOT sign again — check the explorer before continuing.')}
                  </p>
                )}
                {isCurrent && s.status === 'failed' && s.detail && (
                  <p className="text-[10px] text-tone-warning/80 mt-1 leading-relaxed">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {isBlocked(flow) ? (
        step?.status === 'failed' ? (
          // El reintento re-entra en el modo automático: `retry` deja el paso
          // en pending y el encadenado lo dispara — y sigue solo desde ahí.
          <PrimaryButton onClick={() => setFlow((f) => retry(f))} className="w-full">
            {t('Try this step again')}
          </PrimaryButton>
        ) : null
      ) : (
        <PrimaryButton
          onClick={() => {
            setAutoRun(true);
            // Primera pulsación con autoRun aún apagado: el efecto todavía no
            // corrió, así que se dispara aquí; el candado evita el doble.
            void runStep();
          }}
          disabled={busy}
          className="w-full"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              <span className="text-xs font-normal opacity-80">
                {t('The remaining signatures will be requested on their own — you can leave this open.')}
              </span>
            </span>
          ) : autoRun ? (
            <>
              {step ? LABEL[step.kind] : ''}
              <ArrowRight className="w-4 h-4" />
            </>
          ) : (
            <>
              {t('Start — each signature is requested when its step is ready')}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </PrimaryButton>
      )}
    </div>
  );
}

export default BorrowFlowRunner;

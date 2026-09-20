'use client';

/**
 * VaultEntryModal — entrar, pedir la salida y COBRARLA.
 *
 * Misma coreografía que «Choose a Strategy» (fundador 2026-08-27): formulario →
 * REVISIÓN con la divulgación delante → firma de la wallet → seguimiento del
 * settlement. Astryum construye la llamada; nunca firma.
 *
 * ── TRES MODOS, Y EL TERCERO NO ES UN EXTRA ─────────────────────────────────
 * `deposit` · `exit` · `claim`.
 *
 * El tercero faltaba y era el peor hueco de toda la pantalla: en una bóveda con
 * plazo, `requestRedeem` NO devuelve el dinero — abre un ticket que madura. Sin
 * un sitio donde cobrarlo, el usuario pide salir, pasan las horas y su capital
 * simplemente NO ESTÁ EN NINGUNA PARTE de la interfaz. No es una función que
 * falte: es dinero que parece perdido.
 *
 * ── EL PASO DE REVISIÓN NO ES UN TRÁMITE ────────────────────────────────────
 * `disclosure.lines` llega del backend en ese paso y no antes: son los hechos
 * del contrato, y el invariante 6 dice que se ven ANTES de firmar. Saltárselo
 * para ahorrar un clic convertiría un requisito en una pantalla que nadie vio.
 *
 * ── Y EL FALLO QUE MÁS CARO SALE: «no pude leer» ≠ «falló» ──────────────────
 * La primera versión de este modal pintaba CUALQUIER error de firma en rojo. Eso
 * es un bug de dinero con nombre propio en este repo (17-ago): cuando la wallet
 * firma y el recibo no llega a tiempo, un rojo que dice «falló» empuja al
 * usuario a DEPOSITAR OTRA VEZ — y la primera transacción estaba en vuelo.
 *
 * Por eso la salida de la firma pasa por `applySignFailure`, que distingue el
 * rechazo real del recibo que no llegó, y el segundo se pinta en ámbar con
 * `UnconfirmedSignatureNotice`: «puede que ya esté hecho, comprueba antes de
 * repetir». Nunca las dos cosas a la vez — dos veredictos en una pantalla y el
 * rojo siempre gana.
 *
 * ── LA CADENA, ANTES QUE NADA ───────────────────────────────────────────────
 * Un depósito firmado en la cadena equivocada es otra forma de perder una tarde.
 * Si la wallet no está en Flare, el modal no ofrece firmar: ofrece cambiar.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Minus, PanelRight, PanelRightClose, ShieldCheck } from 'lucide-react';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useWalletLabeler } from '../../lib/wallet/useWalletLabeler';

import { GhostButton, PrimaryButton } from '../ui/primitives';
import { OperationSurface, CloseOperationButton } from '../ui/OperationSurface';
import { TokenLogo } from '../ui/TokenLogo';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { useUniversalConnect } from '../../lib/wallet/useUniversalConnect';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { useSwitchToFlare } from '../../lib/wallet/useSwitchToFlare';
import { FLARE_CHAIN_ID } from '../../lib/wallet/flareChain';
import { applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { notifyHandoffSigned, releaseHandoffSeat } from '../../lib/wallet/handoffRelease';
import { XamanSignBlockedNote, XamanSingleSign } from '../xrpl/XamanSingleSign';
import { accountHasQuorum } from '../../lib/xrpl/accountQuorum';
import { AmountSliderUsd } from '../positions/AmountSliderUsd';
import {
  AbandonedSeatNotice,
  SeatRefusalNotice,
  StaleSignatureNotice,
  describeStaleSignature,
  normalizeSeatRefusal,
} from '../wallet/SeatRefusalNotice';
import { refusalHeadline, serverDetailIfEnglish } from '../../lib/xaman/seatRefusal';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { translateError } from '../../lib/errors/translateError';
import { fmtBase, parseAmountToBase } from '../../lib/institutional/policyCatalog';
import { getApiBase } from '../../lib/env';
import { useCarrierXrp } from '../../lib/flare/carrier';
import { resolvePersonalAccountOf } from '../../lib/wallet/paOwnership';
import { exitCopyFor } from '../../lib/institutional/exitCopy';
import { claimIntroFor, exitHintFor, exitSentLineFor } from '../../lib/institutional/exitHint';
import { DRY_RUN, activeDryRunActor, dryRunExecuteCalls } from '../../lib/dryRun';
import {
  getPoteState,
  prepareClaimRedeem,
  prepareDeposit,
  preparePoteFundXrp,
  preparePoteFundFromPa,
  preparePoteExit,
  preparePoteClaimExit,
  prepareRedeem,
  readPaFreeFxrp,
  type PoteCatalogEntry,
  type PoteExitHandoff,
  type PreparedCalls,
  type PreparedClaim,
  type PreparedRedeem,
  type Refusal,
  type XrpFundHandoff,
} from '../../lib/institutional/api';
import { ManagedVaultNotice } from './ManagedVaultNotice';
import { SigningWalletPicker, useSigningWallets } from '../earn/SigningWalletPicker';
import { RedemptionFeeNotice } from '../../lib/fassets/RedemptionFeeNotice';
import { exitRedemption } from '../../lib/fassets/redemptionFeeRow';
import { fillFeeText } from '../../lib/wallet/paDispatchDisclosure';

type Phase = 'form' | 'review' | 'signing' | 'unconfirmed' | 'done';
export type EntryMode = 'deposit' | 'exit' | 'claim';

type AnyPrepared = PreparedCalls & Partial<PreparedRedeem> & Partial<PreparedClaim>;

export function VaultEntryModal({
  entry,
  mode,
  sharesBase,
  shareDecimals,
  ticketId,
  claimAccount,
  exitAccount,
  onClose,
  onChanged,
}: {
  entry: PoteCatalogEntry;
  mode: EntryMode;
  /** Participaciones del usuario, en base units. Solo hace falta al salir. */
  sharesBase?: string;
  shareDecimals?: number;
  /** El ticket que se cobra. Obligatorio en modo `claim`. */
  ticketId?: number;
  /** Si el ticket es de una Personal Account, la r-address XRPL que la controla:
   *  el cobro va por 0xFE (Xaman), no por una call EVM. */
  claimAccount?: string;
  /** Al SALIR de una posición concreta: la r-address XRPL dueña de las shares
   *  (si viven en su PA). Fija la salida por esa cuenta (Xaman), sin picker. */
  exitAccount?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();
  const flare = useSwitchToFlare();
  const xrpl = useXrplWalletPartner();

  const [phase, setPhase] = useState<Phase>(mode === 'claim' ? 'review' : 'form');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<AnyPrepared | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  /**
   * Una firma que llegó tarde (it. 17, R5 5.2): `tefMAX_LEDGER`/`tefPAST_SEQ`
   * significan que ESE payload no puede validar nunca — no se movió nada — así
   * que el modal ofrece prepararlo otra vez en lugar del ámbar «no pude
   * confirmarlo», que prohíbe justo el reintento correcto.
   */
  const [staleSign, setStaleSign] = useState<unknown>(null);
  /**
   * El memo del último 0xFE preparado aquí. Sobrevive al payload: un
   * NONCE_SEAT_TAKEN en el siguiente intento suele ser ESTE borrador todavía
   * sentado en el nonce, y entonces se puede liberar (it. 17, R1 1.5).
   */
  const abandonedMemo = useRef<string | null>(null);

  /**
   * EL CARRIL NO SE ELIGE CON UN INTERRUPTOR: SE ELIGE LA WALLET.
   *
   * Primero puse aqui dos botones («ya lo tengo en Flare» / «tengo XRP») — y
   * era reinventar peor lo que Earn ya hacia bien. El desplegable de firmantes
   * ES el puente: elegir una wallet XRPL significa pagar XRP y que el Smart
   * Account lo mintee 1:1 en FXRP; elegir una de Flare significa gastar tu FXRP
   * directamente. El usuario solo responde a la pregunta que ya se hace —
   * ¿desde cual de mis wallets?— en vez de tener que entender la mecanica antes.
   *
   * Por eso `rail` ya no es estado propio: se DERIVA del firmante elegido, y el
   * componente que lo elige es el mismo que usa «Choose a Strategy».
   */
  // El cobro de un ticket de cola es de la Personal Account → carril XRPL por
  // defecto (deposit/exit siguen en EVM). El picker deja cambiarlo si hiciera falta.
  // XRPL manda por defecto cuando hay una Xaman enlazada (fundador 2026-09-17:
  // «me pone la wallet de MetaMask por defecto»): el pote gestionado se opera
  // desde la cuenta XRPL; MetaMask sigue en el desplegable para quien tenga el
  // FXRP en Flare.
  const signingWallets = useSigningWallets({ defaultRail: mode === 'claim' ? 'xrpl' : 'evm', preferRail: 'xrpl' });
  const rail: 'flare' | 'xrp' = signingWallets.activeRail === 'xrpl' ? 'xrp' : 'flare';
  const [xrpHandoff, setXrpHandoff] = useState<XrpFundHandoff | null>(null);
  const [exitHandoff, setExitHandoff] = useState<PoteExitHandoff | null>(null);
  // SALIDA: por defecto el FXRP vuelve a tu cuenta (la PA); opcional desmintear
  // a XRP nativo en la misma firma (fundador 8-sep: «si no quiere, se queda en FXRP»).
  const [unmintOnExit, setUnmintOnExit] = useState(false);

  // La wallet XRPL ELEGIDA en el desplegable (no la que Xaman tenga conectada
  // por casualidad): es de cuya PA y saldo hablamos, y la que firma. Bug 8-sep:
  // los saldos se leían de `xrpl.address` (el partner conectado), así que con
  // otra cuenta seleccionada se mostraba la PA equivocada (los 0.20 del manager
  // en vez de los 17 de la personal). Ahora manda el desplegable.
  const selectedXrpl = rail === 'xrp' ? (signingWallets.selected?.record.address ?? null) : null;

  // Salida FIJADA a una cuenta concreta (una posición del estante): las shares
  // viven en la PA de `exitAccount`, así que se firma por esa r-address (Xaman)
  // sin picker ni depender del carril elegido.
  const forcedXrplExit = mode === 'exit' && !!exitAccount;

  // El COBRO de un ticket de cola es de la PA de su RECEIVER — la cuenta del
  // USER que redimió, NUNCA la del gestor ni la conectada por casualidad. Es
  // EXACTAMENTE la que el padre resuelve del ticket (ownerXrpl / receiver→dueño)
  // y la firma su dueño en Xaman (0xFE), jamás por EVM. Si no es una de tus
  // cuentas, no lo cobras tú — no hay fallback a otra wallet (bug 10-sep: un
  // fallback a la seleccionada mostraba la wallet del gestor en el claim del user).
  const claimXrplAccount = mode === 'claim' ? (claimAccount ?? undefined) : undefined;
  const forcedXrplClaim = mode === 'claim' && !!claimXrplAccount;

  // LA CUENTA QUE FIRMA EN XAMAN, Y SI TIENE SESIÓN AQUÍ (fundador 2026-09-15:
  // «no me permite poner FXRP» — XRPL_WALLET_PARTNER_NOT_CONNECTED). El
  // firmante es la cuenta ELEGIDA/FIJADA (enlazada a la cuenta), pero firmar
  // exige la sesión viva de Xaman de ESE navegador, que se pierde al cambiar de
  // dominio. Antes se preparaba el pago (ocupando el asiento de nonce 5 min) y
  // luego fallaba con la clave en crudo. Ahora: sin sesión, no se prepara nada
  // — se pide conectar Xaman con esa cuenta, y se sigue.
  const xrplSigner: string | null = forcedXrplClaim ? (claimXrplAccount ?? null) : forcedXrplExit ? (exitAccount ?? null) : selectedXrpl;
  const xrplLive = !!xrpl.address && !!xrplSigner && xrpl.address.toLowerCase() === xrplSigner.toLowerCase();
  const xrplPath = mode === 'deposit' ? rail === 'xrp' : forcedXrplExit || forcedXrplClaim || rail === 'xrp';
  // SIN QR DE CONEXIÓN (fundador 2026-09-17: «me hace escanear un QR para
  // conectar la wallet de Xaman cuando ya está en la cuenta»). Una cuenta de
  // firma ÚNICA firma por el QR del servidor (XamanSingleSign: el pago lleva su
  // Account y Xaman pide esa cuenta), sin sesión en este navegador — un solo
  // QR, el de la firma. Solo una cuenta con QUÓRUM (SignerList) necesita la
  // sesión, porque su orden va por la ceremonia del consejo.
  const [signerQuorum, setSignerQuorum] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    setSignerQuorum(null);
    if (!xrplSigner) return;
    accountHasQuorum(xrplSigner).then((q) => { if (alive) setSignerQuorum(q); }).catch(() => { if (alive) setSignerQuorum(false); });
    return () => { alive = false; };
  }, [xrplSigner]);
  const singleSign = xrplPath && !!xrplSigner && signerQuorum !== true;
  // The server QR is live in Xaman (or signed): Back must not unmount it.
  const [singleSignBlocked, setSingleSignBlocked] = useState(false);
  const connect = useUniversalConnect(async () => {});
  const [xamanNeeded, setXamanNeeded] = useState<string | null>(null);
  const [xamanMismatch, setXamanMismatch] = useState<string | null>(null);
  async function connectXamanFor(address: string) {
    setXamanMismatch(null);
    try {
      await connect.connectXrpl(async (got) => got.toLowerCase() === address.toLowerCase());
      setXamanNeeded(null);
      signingWallets.reload();
    } catch (e) {
      if ((e as { cancelled?: boolean })?.cancelled) {
        setXamanMismatch(`${t('Xaman connected a different account')} — ${t('switch to')} ${address.slice(0, 6)}…${address.slice(-4)} ${t('in Xaman and try again.')}`);
      }
    }
  }
  const xamanGate = xrplPath && !!xrplSigner && !xrplLive && signerQuorum === true;
  const xamanNote = xamanGate ? (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 text-[12px] leading-relaxed text-tone-warning">
      <p>
        {t('This account is linked to you, but Xaman is not connected in this browser. Connect it to sign — nothing is prepared until then, so no seat is taken.')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={() => void connectXamanFor(xrplSigner!)} disabled={connect.busy === 'xrpl'}>
          {t('Connect Xaman with')} <span className="font-mono">{xrplSigner!.slice(0, 6)}…{xrplSigner!.slice(-4)}</span>
        </PrimaryButton>
      </div>
      {xamanMismatch ? <p className="mt-2 text-[11px] text-tone-warning/90">{xamanMismatch}</p> : null}
    </div>
  ) : null;

  // Nickname + chain de una cuenta: la etiqueta que el usuario le puso, o el
  // nombre derivado. `nameOf` resuelve también PAs que no están en la lista.
  const { wallets: labelWallets } = useMyWallets();
  const { nameOf } = useWalletLabeler(labelWallets, t);

  const dec = mode === 'exit' ? (shareDecimals ?? 18) : (entry.asset?.decimals ?? 6);
  const sym = mode === 'exit' ? t('shares') : (entry.asset?.symbol ?? '');
  const max = mode === 'exit' && sharesBase ? sharesBase : null;

  // «Pay with» cuando la wallet es XRPL: XRP fresco (mint) o el FXRP que la
  // Personal Account YA tiene (sin mint). NO cambia de wallet — solo la fuente.
  // Es exactamente el paySource de «Choose a Strategy».
  const [paySource, setPaySource] = useState<'xrp' | 'pa-fxrp'>('xrp');
  const carrierXrp = useCarrierXrp(); // peaje del 0xFE, del backend (sin knob)
  const paSourceActive = rail === 'xrp' && paySource === 'pa-fxrp';

  // El CORTE DEL GESTOR (los payees), dicho al DEPOSITANTE antes de firmar
  // (invariante 6). El catálogo no lo trae; se lee del estado del pote. Suma de
  // bps de los payees = qué parte del yield REALIZADO se lleva el gestor (jamás
  // el principal, con techo fijado al nacer). null = aún no leído / no aplica.
  const [managerCutBps, setManagerCutBps] = useState<number | null>(null);
  useEffect(() => {
    setManagerCutBps(null);
    if (mode !== 'deposit') return;
    let cancelled = false;
    getPoteState(entry.pote)
      .then((st) => {
        if (cancelled) return;
        const sum = (st.governance?.payees ?? []).reduce((acc, p) => acc + (Number(p.bps) || 0), 0);
        setManagerCutBps(sum);
      })
      .catch(() => undefined); // best-effort: si no se lee, no se inventa un número
    return () => { cancelled = true; };
  }, [mode, entry.pote]);

  // El FXRP LIBRE de la PA de la wallet XRPL elegida — para el botón FXRP y su
  // saldo. resolvePersonalAccountOf(r) → PA → readPaFreeFxrp. Best-effort.
  const [paFxrpFree, setPaFxrpFree] = useState<number | null>(null);
  useEffect(() => {
    setPaySource('xrp');
    setPaFxrpFree(null);
    if (mode !== 'deposit' || rail !== 'xrp' || !selectedXrpl) return;
    let cancelled = false;
    (async () => {
      const pa = await resolvePersonalAccountOf(selectedXrpl).catch(() => null);
      if (!pa || cancelled) return;
      const free = await readPaFreeFxrp(pa);
      if (!cancelled && free != null) setPaFxrpFree(free);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rail, selectedXrpl]);

  // CUÁNTO TENGO del asset en la wallet elegida — el número que «make it earn»
  // enseña ANTES de teclear (el XRP ya excluye la reserva del ledger). Carril
  // XRP-mint → saldo XRP; carril Flare directo → FXRP en la wallet EVM.
  const [xrpAvail, setXrpAvail] = useState<number | null>(null);
  const [fxrpAvail, setFxrpAvail] = useState<number | null>(null);
  useEffect(() => {
    if (mode !== 'deposit' || !selectedXrpl) { setXrpAvail(null); return; }
    let cancelled = false;
    fetch(`${getApiBase()}/network/balance?kind=xrpl&address=${encodeURIComponent(selectedXrpl)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { ok?: boolean; balance?: string } | null) => {
        if (cancelled || !b?.ok || b.balance == null) return;
        const n = Number(b.balance); if (Number.isFinite(n)) setXrpAvail(n);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, selectedXrpl]);
  useEffect(() => {
    if (mode !== 'deposit' || !evm.address || entry.asset?.symbol !== 'FXRP') { setFxrpAvail(null); return; }
    let cancelled = false;
    fetch(`${getApiBase()}/network/balance?kind=fxrp&address=${encodeURIComponent(evm.address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { ok?: boolean; balance?: string } | null) => {
        if (cancelled || !b?.ok || b.balance == null) return;
        const n = Number(b.balance); if (Number.isFinite(n)) setFxrpAvail(n);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, evm.address, entry.asset?.symbol]);

  // El saldo del carril ACTIVO + su Max. XRP-mint deja ~2 XRP de reserva (la
  // wallet es el VOLANTE del Smart Account: mintear TODO lo deja sin pagar el
  // peaje de futuras órdenes, fundador 30-jul). PA-FXRP y Flare gastan todo.
  const XRPL_STEERING_RESERVE = 2;
  const available = paSourceActive ? paFxrpFree : rail === 'xrp' ? xrpAvail : fxrpAvail;
  const maxSpendable =
    available == null
      ? null
      : rail === 'xrp' && !paSourceActive
        ? Math.max(0, available - XRPL_STEERING_RESERVE)
        : available;

  // El toggle solo aparece con wallet XRPL y FXRP libre en la PA; sus botones
  // fijan la FUENTE, jamás cambian de wallet (el picker de arriba hace eso).
  const showPayWith = mode === 'deposit' && rail === 'xrp' && (paFxrpFree ?? 0) > 0;

  // La unidad del importe según fuente: XRP al mintear, FXRP en los demás.
  const amountAsset = mode === 'deposit' && rail === 'xrp' && !paSourceActive ? 'XRP' : sym;

  // Ventana o anclada al lateral — mismo chrome que «Choose a Strategy».
  const docked = useDockStore((s) => s.docked);
  const setDocked = useDockStore((s) => s.setDocked);

  const title =
    mode === 'deposit' ? t('Enter this vault')
    : mode === 'exit' ? t('Leave this vault')
    : t('Claim what is due');

  /** ¿Es un asiento de nonce tomado? Entonces lo cuenta el lector compartido, en inglés. */
  const seatRefusal = normalizeSeatRefusal(refusal);

  async function prepare() {
    setError('');
    setRefusal(null);
    setStaleSign(null);
    // Sin sesión de Xaman para la cuenta que firma, NO se prepara (no se ocupa
    // el asiento de nonce): se pide conectar y se vuelve a pulsar.
    if (xamanGate) { setXamanNeeded(xrplSigner); return; }
    setPreparing(true);
    try {
      // CARRIL XRP, PRIMERO — antes de cualquier guard EVM. No hay tx EVM que
      // firmar: es un PAGO XRPL que la Personal Account convierte en FXRP y
      // deposita. Exigir aquí una wallet EVM era el bug (8-sep): a quien entra
      // con XRP se le pedía «Connect your EVM wallet» aunque no la necesite.
      if (mode === 'deposit' && rail === 'xrp') {
        // La cuenta que firma y de cuya PA sale el FXRP es la ELEGIDA en el
        // desplegable, no la conectada por casualidad (mismo bug del saldo).
        const signer = selectedXrpl ?? xrpl.address;
        if (!signer) throw new Error(t('Connect your XRPL account (Xaman) to continue'));
        const amt = amount.trim();
        if (!/^\d+(\.\d+)?$/.test(amt) || Number(amt) <= 0) { setError(t('Enter an amount.')); return; }
        // Dos fuentes por la MISMA firma Xaman, sin cambiar de wallet: el FXRP
        // que la PA ya tiene (sin mint) o XRP fresco (mint 1:1). Receiver
        // opcional (no-custodial → las shares van a tu propia PA).
        const r = paSourceActive
          ? await preparePoteFundFromPa({
              account: signer,
              pote: entry.pote,
              amountFxrp: amt,
              carrierXrp: String(carrierXrp),
              receiver: evm.address ?? undefined,
            })
          : await preparePoteFundXrp({
              account: signer,
              pote: entry.pote,
              amountXrp: amt,
              receiver: evm.address ?? undefined,
            });
        if (!r.ok) { setRefusal(r.refusal); setPhase('form'); return; }
        if (r.data.memoHex) abandonedMemo.current = r.data.memoHex;
        setXrpHandoff(r.data);
        setPhase('review');
        return;
      }

      // SALIR por el carril XRPL: las shares viven en tu Personal Account, que
      // no firma sola. UNA firma Xaman (0xFE): redeem(shares, PA, PA) + unmint a
      // XRP nativo a tu r-address. Es la salida por donde se entró (Producto A).
      if (mode === 'exit' && (rail === 'xrp' || forcedXrplExit)) {
        // Si la salida está FIJADA a una posición concreta (exitAccount), su
        // dueña firma; si no, la elegida en el desplegable.
        const acct = exitAccount ?? selectedXrpl ?? xrpl.address;
        if (!acct) throw new Error(t('Connect your XRPL account (Xaman) to continue'));
        const units = parseAmountToBase(amount, dec);
        if (units === null || units <= BigInt(0)) { setError(t('Enter an amount.')); return; }
        if (max && units > BigInt(max)) { setError(t('That is more than you hold.')); return; }
        const r = await preparePoteExit({
          account: acct,
          pote: entry.pote,
          sharesBase: units.toString(),
          amountXrpForMint: String(carrierXrp),
          unmint: unmintOnExit,
        });
        if (!r.ok) { setRefusal(r.refusal); setPhase('form'); return; }
        if (r.data.memoHex) abandonedMemo.current = r.data.memoHex;
        setExitHandoff(r.data);
        setPhase('review');
        return;
      }

      // COBRAR por el carril XRPL: el ticket es de tu Personal Account, que no
      // firma sola. UNA firma Xaman (0xFE): claimRedeem + unmint a XRP nativo.
      if (mode === 'claim' && claimXrplAccount) {
        if (ticketId == null) throw new Error(t('This exit ticket is missing its number.'));
        const r = await preparePoteClaimExit({
          account: claimXrplAccount,
          pote: entry.pote,
          ticketId,
          amountXrpForMint: String(carrierXrp),
          unmint: unmintOnExit,
        });
        if (!r.ok) { setRefusal(r.refusal); setPhase('review'); return; }
        if (r.data.memoHex) abandonedMemo.current = r.data.memoHex;
        setExitHandoff(r.data);
        setPhase('review');
        return;
      }

      // Resto (carril Flare directo, salir por EVM, cobrar por EVM): SÍ requiere firmante EVM.
      // En el ensayo, el actor activo de la banda hace de firmante: mismo
      // prepare, misma calldata, ejecutada impersonándolo en el fork.
      const dryFrom = DRY_RUN && !evm.isConnected ? activeDryRunActor() : null;
      const signer = evm.address ?? dryFrom;
      if (!signer) {
        throw new Error(DRY_RUN ? t('Pick an actor in the DRY RUN band (or connect a wallet).') : t('Connect your Flare wallet — or pick your XRPL wallet above to enter with XRP'));
      }

      let res;
      if (mode === 'claim') {
        if (ticketId == null) throw new Error(t('This exit ticket is missing its number.'));
        res = await prepareClaimRedeem({ pote: entry.pote, ticketId });
      } else {
        const units = parseAmountToBase(amount, dec);
        if (units === null || units <= BigInt(0)) { setError(t('Enter an amount.')); return; }
        if (max && units > BigInt(max)) { setError(t('That is more than you hold.')); return; }
        res =
          mode === 'deposit'
            ? await prepareDeposit({ pote: entry.pote, amountBase: units.toString(), receiver: signer })
            : await prepareRedeem({
                pote: entry.pote,
                sharesBase: units.toString(),
                receiver: signer,
                owner: signer,
              });
      }

      if (!res.ok) {
        // Un rechazo del raíl se enseña LITERAL: es el contrato hablando.
        setRefusal(res.refusal);
        setPhase(mode === 'claim' ? 'review' : 'form');
        return;
      }
      setPrepared(res.data as AnyPrepared);
      setPhase('review');
    } catch (e) {
      setError(translateError(e, t).message);
      setPhase(mode === 'claim' ? 'review' : 'form');
    } finally {
      setPreparing(false);
    }
  }

  /** La firma del carril XRP: un pago en Xaman, y la PA hace el resto. */
  async function signXrp() {
    if (!xrpHandoff) return;
    if (xamanGate) { setXamanNeeded(xrplSigner); return; }
    setError('');
    setUnconfirmed(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      handedToPartner = true;
      await xrpl.sendIntent({ tx: xrpHandoff.xrplPayment as Record<string, unknown> } as never);
      setPhase('done');
      onChanged?.();
    } catch (e) {
      // Firmada TARDE (it. 17, R5 5.2): tefMAX_LEDGER/tefPAST_SEQ es un
      // veredicto LEÍDO — ese payload no entra en ningún ledger — así que se
      // dice «prepárala otra vez», nunca «no pude confirmarlo, recarga».
      if (describeStaleSignature(e, t)) {
        setStaleSign(e);
        setUnconfirmed(null);
        setError('');
        setXrpHandoff(null);
        setPhase('form');
        return;
      }
      // Mismo criterio que en EVM: un recibo que no llega NO es un fallo, y
      // pintarlo en rojo sobre un pago XRPL empuja a pagar dos veces.
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase: (v) => setPhase(v as Phase),
        clearPrepared: () => setXrpHandoff(null),
      });
    }
  }

  /** La firma de la SALIDA por XRPL: un pago Xaman (0xFE), y la PA redime del
   *  pote y desmintea a XRP en el mismo batch. Mismo criterio de recibo. */
  async function signExit() {
    if (!exitHandoff) return;
    if (xamanGate) { setXamanNeeded(xrplSigner); return; }
    setError('');
    setUnconfirmed(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      handedToPartner = true;
      await xrpl.sendIntent({ tx: exitHandoff.xrplTx as Record<string, unknown> } as never);
      setPhase('done');
      onChanged?.();
    } catch (e) {
      // Igual que la entrada: una salida firmada fuera de su ventana se
      // prepara otra vez; jamás se queda en «no pude confirmarlo».
      if (describeStaleSignature(e, t)) {
        setStaleSign(e);
        setUnconfirmed(null);
        setError('');
        setExitHandoff(null);
        setPhase(mode === 'claim' ? 'review' : 'form');
        return;
      }
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase: (v) => setPhase(v as Phase),
        clearPrepared: () => setExitHandoff(null),
      });
    }
  }

  async function sign() {
    if (!prepared) return;
    setError('');
    setUnconfirmed(null);
    setPhase('signing');
    let handedToPartner = false;
    try {
      // Ensayo: el actor activo ejecuta la MISMA calldata en el fork, sin firma.
      const dryFrom = DRY_RUN && !evm.isConnected ? activeDryRunActor() : null;
      if (dryFrom) {
        const dr = await dryRunExecuteCalls(dryFrom, prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value })));
        if (!dr.ok) {
          setError(`${dr.error}${dr.detail ? ` — ${dr.detail}` : ''}`);
          setPhase('review');
          return;
        }
        onChanged?.();
        setPhase('done');
        return;
      }
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        prepared.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId })),
      );
      settlement.track(handle, { onSettled: onChanged });
      setPhase('done');
    } catch (e) {
      // NUNCA un rojo genérico: distingue el rechazo real del recibo que no
      // llegó. Ver la cabecera — es el bug que empuja al doble depósito.
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed,
        setPhase: (v) => setPhase(v as Phase),
        clearPrepared: () => setPrepared(null),
      });
    }
  }

  // El modo claim no tiene formulario: el ticket ya dice cuánto. Se prepara al
  // pulsar, no al abrir, para no gastar una llamada si el usuario se arrepiente.
  const showForm = phase === 'form' && mode !== 'claim';

  // Invariant #6 (productizer it. 12, 4.2): an exit or claim that unmints pays
  // the FAssets redemption fee out of the XRP the agent sends. `xrpOutHuman` is
  // what is REDEEMED — the review shows the net when the fee was read and the
  // gross with its caveat when it was not, never the gross as a promise.
  //
  // ONE READER (it. 14, R3 3.2): `exit.xrpOutHuman` can already be net of the
  // fee, and taking it as the gross showed a second, smaller net beside the
  // backend's own line. `exitRedemption` decides which shape it is.
  const exitUnmints = exitHandoff ? exitCopyFor(exitHandoff.mode, exitHandoff.unminted).unminted : false;
  const exitFee = exitRedemption(exitHandoff, exitUnmints);
  const exitGrossFxrp = exitFee.grossFxrp;
  const exitFeeRows = exitFee.rows;
  const wrongChain = flare.wrongNetwork;

  return (
    <OperationSurface docked={docked} title={`${title} · ${sym}`} onClose={onClose}>
      {/* Cabecera — chips + título + controles de ventana, como «Choose a Strategy». */}
      <div className="flex shrink-0 items-start justify-between border-b border-ink/5 px-6 py-5">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            {entry.asset?.symbol ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-ink/15 bg-ink/5 py-0.5 pl-1 pr-2 font-mono text-[10px] text-ink/70">
                <TokenLogo symbol={entry.asset.symbol} size="xs" />
                {entry.asset.symbol}
              </span>
            ) : null}
            <span className="rounded-full border border-ink/15 bg-ink/5 px-2 py-0.5 text-[10px] text-ink/55">
              {mode === 'deposit' && rail === 'xrp' ? t('Xaman · Smart Account') : t('Flare')}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 truncate text-xs text-ink/40">{entry.name ?? entry.pote}</p>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <button
            onClick={() => useDockStore.getState().setMinimized(true)}
            className="p-0.5 text-ink/40 transition-colors hover:text-ink"
            title={t('Minimize — it waits at the bottom, exactly as you left it')}
          >
            <Minus className="h-5 w-5" />
          </button>
          <button
            onClick={() => setDocked(!docked)}
            className="hidden p-0.5 text-ink/40 transition-colors hover:text-ink lg:block"
            title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
          >
            {docked ? <PanelRightClose className="h-5 w-5" /> : <PanelRight className="h-5 w-5" />}
          </button>
          <CloseOperationButton onClose={onClose} />
        </div>
      </div>

      {/* Cuerpo */}
      <div className="flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-5">
        {/* Siempre a la vista, en los tres modos: hay una persona detrás. */}
        <ManagedVaultNotice />

        {/* El tope por cuenta (V2), dicho ANTES de teclear: el raíl lo repite
            como 409 con el hueco exacto si se pasa, pero la regla se lee aquí. */}
        {mode === 'deposit' && entry.maxDepositPerUser && entry.maxDepositPerUser !== '0' && entry.asset ? (
          <p className="text-[11px] leading-relaxed text-ink/50">
            {t('This vault caps what any one account may hold at')}{' '}
            <span className="font-mono">{fmtBase(entry.maxDepositPerUser, entry.asset.decimals)} {entry.asset.symbol}</span>
            {' — '}
            {t('entries only; exits are never blocked')}
          </p>
        ) : null}

        {/* El corte del gestor, dicho ANTES de firmar el depósito (invariante 6):
            los payees se leen del ledger, no son una promesa, y salen del YIELD,
            nunca del principal. */}
        {mode === 'deposit' && managerCutBps !== null ? (
          <p className="text-[11px] leading-relaxed text-ink/50">
            {managerCutBps === 0 ? (
              t('The manager takes no cut — all realized yield capitalizes back into the vault.')
            ) : (
              <>
                {t('The manager keeps')}{' '}
                <span className="font-mono">{(managerCutBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span>{' '}
                {t('of the realized yield — never your principal; capped at creation and read from the ledger, not a promise.')}
              </>
            )}
          </p>
        ) : null}

        {/* La cadena, antes que nada: firmar en la equivocada es perder la tarde.
            Solo aplica al carril Flare (EVM); la salida/entrada por XRPL firma en
            Xaman y no depende de la red de MetaMask. */}
        {wrongChain && rail === 'flare' && !forcedXrplExit && !forcedXrplClaim && (
          <div className="rounded-xl border border-tone-warning/30 bg-tone-warning/[0.07] p-4">
            <p className="text-[13px] leading-relaxed text-ink/70">
              {t('Your wallet is on another network. This vault lives on Flare.')}
            </p>
            <GhostButton onClick={() => void flare.switchToFlare()} className="mt-3" disabled={flare.switching}>
              {flare.switching ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
              {t('Switch to Flare')}
            </GhostButton>
          </div>
        )}

        {showForm && (
          <>
            {/* El mismo desplegable que Earn: elegir la wallet ES elegir el
                carril, también para SALIR (las shares en la PA salen por Xaman;
                las de una wallet Flare, por redeem directo). */}
            {/* Salida FIJADA a una posición: la cuenta dueña ya está decidida,
                así que no hay desplegable — se dice con quién se firma. */}
            {forcedXrplExit && exitAccount && (
              <div className="flex items-center gap-2 text-[11px] text-ink/45">
                <CheckCircle2 className="h-3.5 w-3.5 text-tone-success" />
                {t('Signing wallet')}:{' '}
                <span className="font-mono text-ink/70">{exitAccount.slice(0, 8)}…{exitAccount.slice(-6)}</span>
                {' — '}{t('the account that holds these shares.')}
              </div>
            )}

            {(mode === 'deposit' || (mode === 'exit' && !forcedXrplExit)) && (
              <SigningWalletPicker
                wallets={signingWallets}
                disabled={preparing}
                hint={
                  <p className={`mt-1.5 text-[10px] ${rail === 'flare' ? 'text-tone-success/80' : 'text-ink/35'}`}>
                    {/* La promesa sigue a la elección ACTUAL (unmintOnExit, por
                        defecto FXRP en la PA) — la misma exitCopyFor que la
                        revisión, así pista y revisión cuentan una historia. */}
                    {mode === 'exit'
                      ? t(exitHintFor({ rail, unmint: unmintOnExit, cooldownSeconds: entry.cooldownSeconds }))
                      : rail === 'flare'
                        ? t('This wallet spends its FXRP directly on Flare — no XRPL mint, no minting fee.')
                        : t('This wallet pays XRP — minted 1:1 into FXRP on Flare before entering.')}
                  </p>
                }
              />
            )}

            {/* Confirmación del firmante, como en «Choose a Strategy». */}
            {(mode === 'deposit' || (mode === 'exit' && !forcedXrplExit)) && signingWallets.selected && (
              <div className="flex items-center gap-2 text-[11px] text-ink/45">
                <CheckCircle2 className="h-3.5 w-3.5 text-tone-success" />
                {t('Signing wallet')}:{' '}
                <span className="font-mono text-ink/70">
                  {signingWallets.selected.record.address.slice(0, 8)}…{signingWallets.selected.record.address.slice(-6)}
                </span>
              </div>
            )}

            {/* Pay with — XRP fresco (mint 1:1) o el FXRP que tu Personal
                Account YA tiene (sin mint). Fija la FUENTE; NO cambia de wallet
                (eso lo hace el picker de arriba). Solo aparece con wallet XRPL
                y FXRP libre en la PA — igual que «Choose a Strategy». */}
            {showPayWith && (
              <div>
                <label className="mb-2 block text-xs text-ink/40">{t('Pay with')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaySource('xrp')}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      !paSourceActive
                        ? 'border-volt/40 bg-volt/10 font-medium text-volt'
                        : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5"><TokenLogo symbol="XRP" size="xs" /> XRP</span>
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">{t('Converts now (mint)')}</span>
                  </button>
                  <button
                    onClick={() => setPaySource('pa-fxrp')}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      paSourceActive
                        ? 'border-volt/40 bg-volt/10 font-medium text-volt'
                        : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <TokenLogo symbol={entry.asset?.symbol ?? 'FXRP'} size="xs" /> {entry.asset?.symbol ?? 'FXRP'}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                      {t('Already in your account')} · {(paFxrpFree ?? 0).toFixed(2)}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* En el ensayo el carril XRP no corre (mint XRPL+FDC no cabe en un fork). */}
            {DRY_RUN && mode === 'deposit' && rail === 'xrp' && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">
                {t('The XRP rail mints FXRP through XRPL + FDC — a real-rail step a local fork cannot run. In the dry run, enter through the Flare rail (FXRP directly); the XRP on-ramp is for the mainnet rehearsal.')}
              </p>
            )}

            {/* Importe · Available · MAX — en una línea, como el modal de Earn. */}
            <div>
              <label className="mb-2 flex items-center justify-between gap-3 text-xs text-ink/40">
                <span>{t('Amount')} · {mode === 'deposit' ? amountAsset : sym}</span>
                {mode === 'deposit' && available != null ? (
                  <span className="flex items-center gap-2">
                    <span className="text-ink/45">{t('Available')}: <span className="font-mono text-ink/70">{available}</span></span>
                    {maxSpendable != null && maxSpendable > 0 && (
                      <button onClick={() => setAmount(String(maxSpendable))} className="font-medium text-volt hover:underline">{t('MAX')}</button>
                    )}
                  </span>
                ) : mode === 'exit' && max ? (
                  <button onClick={() => setAmount(fmtBase(max, dec, dec))} className="font-medium text-volt hover:underline">
                    {t('Max')} {fmtBase(max, dec)}
                  </button>
                ) : null}
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-ink/5 px-4 py-3 focus-within:border-volt/50">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none"
                />
                <span className="font-mono text-xs text-ink/45">{mode === 'deposit' ? amountAsset : sym}</span>
              </div>
              {/* Deslizar en vez de teclear (fundador 2026-09-17: «en los demás
                  vaults aparece la barra»): el MISMO componente que Earn y el
                  cierre de posición; el tope es el mismo que el botón MAX. */}
              <AmountSliderUsd
                max={mode === 'deposit' ? (maxSpendable ?? 0) : max ? Number(fmtBase(max, dec, dec)) : 0}
                amount={amount}
                onAmount={(v, atMax) => setAmount(mode === 'exit' && atMax && max ? fmtBase(max, dec, dec) : v)}
                usdPrice={null}
              />
              {mode === 'deposit' && rail === 'xrp' && !paSourceActive && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink/40">
                  {t('MAX keeps ~2 XRP back — your Astryum account is steered from this wallet and every order needs a small XRP payment.')}
                </p>
              )}
              {mode === 'deposit' && paSourceActive && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink/40">
                  {t('Uses the FXRP already in your Personal Account — no mint, just the small 0xFE carrier.')}
                </p>
              )}
            </div>

            {/* SALIDA por la PA: ¿recibir el asset del vault (se queda en tu
                cuenta Flare) o desmintear a XRP nativo en la misma firma? Por
                defecto se queda en el asset; XRP es opcional. SOLO en salida
                INMEDIATA — en potes de cola la elección se hace al COBRAR. */}
            {mode === 'exit' && (rail === 'xrp' || forcedXrplExit) && (entry.cooldownSeconds ?? 0) === 0 && (
              <div>
                <label className="mb-2 block text-xs text-ink/40">{t('Receive as')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUnmintOnExit(false)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      !unmintOnExit ? 'border-volt/40 bg-volt/10 font-medium text-volt' : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <TokenLogo symbol={entry.asset?.symbol ?? 'FXRP'} size="xs" /> {entry.asset?.symbol ?? 'FXRP'}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">{t('Stays in your account')}</span>
                  </button>
                  <button
                    onClick={() => setUnmintOnExit(true)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                      unmintOnExit ? 'border-volt/40 bg-volt/10 font-medium text-volt' : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5"><TokenLogo symbol="XRP" size="xs" /> XRP</span>
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">{t('Unmint to native XRP')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* La verdad on-chain, antes de firmar (la persona detrás ya avisada arriba). */}
            <div className="flex items-start gap-2 rounded-xl border border-tone-success/25 bg-tone-success/[0.06] p-3 text-[12px] leading-relaxed text-tone-success">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('The live share price, cap and exit terms are read on-chain and shown before you sign.')}</span>
            </div>

            {seatRefusal && (
              <SeatRefusalNotice
                refusal={refusal}
                t={t}
                fallbackMemoHex={abandonedMemo.current}
                onPrepareAgain={() => void prepare()}
              />
            )}
            {staleSign && (
              <StaleSignatureNotice error={staleSign} t={t} onPrepareAgain={() => void prepare()} />
            )}
            {refusal && !seatRefusal && (
              /* it. 22 (Q3 3.7): el codigo crudo del servidor en monoespaciado
                 y su parrafo en castellano debajo. Un slug no es una frase, y
                 la pantalla habla ingles: `refusalHeadline` lo dice, y el
                 `detail` solo acompana si esta en ese idioma. */
              <div className="rounded-xl border border-tone-danger/30 bg-tone-danger/[0.06] p-4">
                <p className="text-[12px] text-tone-danger">{refusalHeadline(refusal, t)}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink/60">
                  {serverDetailIfEnglish(refusal.detail) ??
                    t('Nothing was prepared and nothing was signed: your money is exactly where it was.')}
                </p>
              </div>
            )}
            {error && <p className="text-sm text-tone-danger">{error}</p>}

            {xamanNeeded && xamanGate ? xamanNote : null}
            <PrimaryButton onClick={() => void prepare()} className="w-full" disabled={preparing || (rail === 'flare' && wrongChain && !forcedXrplExit && !forcedXrplClaim)}>
              {preparing ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
              {t('Review before signing')}
            </PrimaryButton>
          </>
        )}

        {/* La revision del carril XRP: su propio desglose, porque el usuario
            escribe XRP y lo que acaba dentro del pote es otra cosa. Ver la
            conversion ANTES de firmar es la diferencia entre entender el peaje
            y creer que se ha perdido dinero por el camino. */}
        {phase === 'review' && xrpHandoff && (
          <>
            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-[13px] font-medium text-ink/80">{t(xrpHandoff.disclosure.title)}</p>
              <ul className="mt-2 space-y-1">
                {xrpHandoff.disclosure.lines.map((line) => (
                  <li key={line} className="text-[12px] leading-relaxed text-ink/55">· {t(line)}</li>
                ))}
              </ul>
              <div className="mt-3 border-t border-ink/5 pt-3">
                <p className="font-mono text-[12px] text-ink/70">
                  {xrpHandoff.net.grossXrp} XRP → {xrpHandoff.net.fxrp} {entry.asset?.symbol ?? 'FXRP'}
                </p>
              </div>
            </div>

            {error && <p className="text-sm text-tone-danger">{error}</p>}

            {/* it. 21 (it. 20 §3.3): cancelar en Xaman no suelta el asiento del
                0xFE preparado. Se dice, y con CUÁNDO se suelta; el botón de
                soltarlo no aparece mientras el payload siga firmable aquí. */}
            {error && xrpHandoff.memoHex ? (
              <AbandonedSeatNotice
                memoHex={xrpHandoff.memoHex}
                t={t}
                stillSignable
                onPrepareAgain={() => void prepare()}
              />
            ) : null}

            {singleSign ? (
              <div className="space-y-2">
                <XamanSingleSign
                  txjson={xrpHandoff.xrplPayment}
                  title={t('Enter the vault — your signature')}
                  onSigned={(hash) => notifyHandoffSigned(xrpHandoff.memoHex, hash)}
                  onSettled={(hash) => {
                    notifyHandoffSigned(xrpHandoff.memoHex, hash);
                    setPhase('done');
                    onChanged?.();
                  }}
                  onBlockedChange={setSingleSignBlocked}
                />
                {singleSignBlocked ? <XamanSignBlockedNote /> : null}
              </div>
            ) : xamanNote}
            <div className="flex flex-wrap gap-2">
              {!singleSign ? (
                <PrimaryButton onClick={() => void signXrp()} className="flex-1" disabled={xamanGate}>
                  {t('Sign in Xaman')}
                </PrimaryButton>
              ) : null}
              {singleSignBlocked ? null : (
              <GhostButton
                onClick={() => {
                  // Un borrador que nadie firmó no debe seguir sentado en el
                  // nonce cuando esta persona se va de la revisión.
                  releaseHandoffSeat(xrpHandoff.memoHex);
                  setPhase('form');
                  setXrpHandoff(null);
                }}
              >
                {t('Back')}
              </GhostButton>
              )}
            </div>
            <p className="text-[11px] text-ink/35">
              {t('Astryum builds the call; your wallet signs it. It never signs for you.')}
            </p>
          </>
        )}

        {/* La revisión de la SALIDA por XRPL: qué shares salen y cuánto XRP
            vuelve (desglose del backend), ANTES de firmar en Xaman. */}
        {phase === 'review' && exitHandoff && (
          <>
            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-[13px] font-medium text-ink/80">{t(exitHandoff.disclosure.title)}</p>
              <ul className="mt-2 space-y-1">
                {exitHandoff.disclosure.lines.map((line) => (
                  <li key={line} className="text-[12px] leading-relaxed text-ink/55">· {t(line)}</li>
                ))}
              </ul>
              <div className="mt-3 border-t border-ink/5 pt-3">
                {exitHandoff.mode === 'request' ? (
                  <>
                    <p className="font-mono text-[12px] text-ink/70">
                      {exitHandoff.exit.sharesHuman} {t('shares')} → ≈{exitHandoff.exit.xrpOutHuman} {entry.asset?.symbol ?? 'FXRP'}
                    </p>
                    {exitHandoff.maturityISO && (
                      <p className="mt-1 text-[11px] leading-relaxed text-tone-warning/80">
                        {t('This vault has an exit window: your shares burn now and the amount is fixed. Claimable on')}{' '}
                        {new Date(exitHandoff.maturityISO).toLocaleString()} — {t('you collect it here when it matures (as FXRP in your account, or unmint to XRP then).')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="font-mono text-[12px] text-ink/70">
                    {/* La unidad sale de lo que el backend COMPUSO: sin desminteo
                        (el defecto) el FXRP se queda en la PA — pintarlo como XRP
                        promete algo que no llega (productizer, 13-sep). */}
                    {exitHandoff.exit.sharesHuman} {t('shares')} →{' '}
                    {exitFeeRows?.amount ? (
                      fillFeeText(t(exitFeeRows.amount.text), exitFeeRows.amount.params)
                    ) : (
                      <>
                        ≈{exitHandoff.exit.xrpOutHuman}{' '}
                        {exitCopyFor(exitHandoff.mode, exitHandoff.unminted).unit === 'XRP' ? 'XRP' : (entry.asset?.symbol ?? 'FXRP')}
                      </>
                    )}
                  </p>
                )}
                {exitHandoff.exit.partial && (
                  <p className="mt-1 text-[11px] text-ink/45">
                    {t('Part of your position stays in the vault — you can take the rest out later.')}
                  </p>
                )}
              </div>
            </div>

            {/* The FAssets redemption fee, figure or «could not be read — it is
                not zero», right before the Xaman signature. */}
            {exitUnmints && <RedemptionFeeNotice response={exitHandoff} grossFxrp={exitGrossFxrp} t={t} />}

            {error && <p className="text-sm text-tone-danger">{error}</p>}

            {/* Misma verdad en la SALIDA, que es donde más caro sale callarla. */}
            {error && exitHandoff.memoHex ? (
              <AbandonedSeatNotice
                memoHex={exitHandoff.memoHex}
                t={t}
                stillSignable
                onPrepareAgain={() => void prepare()}
              />
            ) : null}

            {singleSign ? (
              <div className="space-y-2">
                <XamanSingleSign
                  txjson={exitHandoff.xrplTx}
                  title={t('Leave the vault — your signature')}
                  onSigned={(hash) => notifyHandoffSigned(exitHandoff.memoHex, hash)}
                  onSettled={(hash) => {
                    notifyHandoffSigned(exitHandoff.memoHex, hash);
                    setPhase('done');
                    onChanged?.();
                  }}
                  onBlockedChange={setSingleSignBlocked}
                />
                {singleSignBlocked ? <XamanSignBlockedNote /> : null}
              </div>
            ) : xamanNote}
            <div className="flex flex-wrap gap-2">
              {!singleSign ? (
                <PrimaryButton onClick={() => void signExit()} className="flex-1" disabled={xamanGate}>
                  {t('Sign in Xaman')}
                </PrimaryButton>
              ) : null}
              {singleSignBlocked ? null : (
              <GhostButton
                onClick={() => {
                  releaseHandoffSeat(exitHandoff.memoHex);
                  setPhase('form');
                  setExitHandoff(null);
                }}
              >
                {t('Back')}
              </GhostButton>
              )}
            </div>
            <p className="text-[11px] text-ink/35">
              {t('Astryum builds the call; your wallet signs it. It never signs for you.')}
            </p>
          </>
        )}

        {phase === 'review' && !xrpHandoff && !exitHandoff && (
          <>
            {!prepared ? (
              <>
                {mode === 'claim' && (
                  <p className="text-[13px] leading-relaxed text-ink/60">
                    {t(claimIntroFor({ unmint: unmintOnExit, viaXrpl: !!claimXrplAccount }))}
                  </p>
                )}
                {/* La cuenta del cobro es INAMOVIBLE: la del ticket (la que
                    depositó e hizo el withdraw). No se elige — se enseña, con su
                    nombre, su dirección y su cadena (XRPL). Firma en Xaman. */}
                {mode === 'claim' && claimXrplAccount && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 text-[11px]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-tone-success" />
                    <span className="text-ink/45">{t('Claiming to')}:</span>
                    <span className="font-medium text-ink/80">{nameOf(claimXrplAccount)}</span>
                    <span className="font-mono text-ink/50">{claimXrplAccount.slice(0, 6)}…{claimXrplAccount.slice(-4)}</span>
                    <span className="rounded-full border border-ink/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink/50">XRPL</span>
                    <span className="ml-auto text-[10px] text-ink/35">{t('the account that deposited and withdrew')}</span>
                  </div>
                )}
                {mode === 'claim' && !claimXrplAccount && (
                  <p className="rounded-lg border border-tone-warning/30 bg-tone-warning/[0.07] p-2.5 text-[11px] leading-relaxed text-tone-warning">
                    {t('This ticket is claimed by the XRPL account that owns it — connect or link that wallet to sign in Xaman.')}
                  </p>
                )}
                {/* Cobro de cola por la PA: ¿el FXRP se queda en tu cuenta o se
                    desmintea a XRP nativo en la misma firma? Por defecto, FXRP. */}
                {mode === 'claim' && claimXrplAccount && (
                  <div>
                    <label className="mb-2 block text-xs text-ink/40">{t('Receive as')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setUnmintOnExit(false)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          !unmintOnExit ? 'border-volt/40 bg-volt/10 font-medium text-volt' : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1.5">
                          <TokenLogo symbol={entry.asset?.symbol ?? 'FXRP'} size="xs" /> {entry.asset?.symbol ?? 'FXRP'}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-normal opacity-70">{t('Stays in your account')}</span>
                      </button>
                      <button
                        onClick={() => setUnmintOnExit(true)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          unmintOnExit ? 'border-volt/40 bg-volt/10 font-medium text-volt' : 'border-ink/10 bg-ink/5 text-ink/50 hover:text-ink'
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1.5"><TokenLogo symbol="XRP" size="xs" /> XRP</span>
                        <span className="mt-0.5 block text-[10px] font-normal opacity-70">{t('Unmint to native XRP')}</span>
                      </button>
                    </div>
                  </div>
                )}
                {seatRefusal && (
                  <SeatRefusalNotice
                    refusal={refusal}
                    t={t}
                    fallbackMemoHex={abandonedMemo.current}
                    onPrepareAgain={() => void prepare()}
                  />
                )}
                {staleSign && (
                  <StaleSignatureNotice error={staleSign} t={t} onPrepareAgain={() => void prepare()} />
                )}
                {refusal && !seatRefusal && (
                  <div className="rounded-xl border border-tone-danger/30 bg-tone-danger/[0.06] p-4">
                    <p className="text-[12px] text-tone-danger">{refusalHeadline(refusal, t)}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink/60">
                      {serverDetailIfEnglish(refusal.detail) ??
                        t('Nothing was prepared and nothing was signed: your money is exactly where it was.')}
                    </p>
                  </div>
                )}
                {error && <p className="text-sm text-tone-danger">{error}</p>}
                {xamanNeeded && xamanGate ? xamanNote : null}
            <PrimaryButton onClick={() => void prepare()} className="w-full" disabled={preparing || (rail === 'flare' && wrongChain && !forcedXrplExit && !forcedXrplClaim)}>
                  {preparing ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                  {t('Review and sign')}
                </PrimaryButton>
              </>
            ) : (
              <>
                {/* La divulgación del backend, tal cual llega. */}
                <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
                  <p className="text-[13px] font-medium text-ink/80">{t(prepared.disclosure.title)}</p>
                  <ul className="mt-2 space-y-1">
                    {prepared.disclosure.lines.map((line) => (
                      <li key={line} className="text-[12px] leading-relaxed text-ink/55">· {t(line)}</li>
                    ))}
                  </ul>
                </div>

                {/* La fecha de maduración se ve ANTES de firmar, no después. */}
                {prepared.mode === 'request' && prepared.maturityISO && (
                  <p className="text-[12px] leading-relaxed text-tone-warning/80">
                    {t('This vault has an exit window: your capital becomes claimable on')}{' '}
                    {new Date(prepared.maturityISO).toLocaleString()}.
                  </p>
                )}

                {/* Lo que el cobro arrastra: si hay que sacar de un venue en
                    cola, la llamada lleva sus reclamaciones y conviene verlo. */}
                {prepared.notes?.length ? (
                  <ul className="space-y-1">
                    {prepared.notes.map((n) => (
                      <li key={n} className="text-[12px] leading-relaxed text-ink/50">· {t(n)}</li>
                    ))}
                  </ul>
                ) : null}

                {error && <p className="text-sm text-tone-danger">{error}</p>}

                <div className="flex flex-wrap gap-2">
                  <PrimaryButton onClick={() => void sign()} className="flex-1" disabled={wrongChain && !forcedXrplExit && !forcedXrplClaim}>
                    {t('Sign in your wallet')}
                  </PrimaryButton>
                  <GhostButton onClick={() => { setPhase(mode === 'claim' ? 'review' : 'form'); setPrepared(null); }}>
                    {t('Back')}
                  </GhostButton>
                </div>
                <p className="text-[11px] text-ink/35">
                  {t('Astryum builds the call; your wallet signs it. It never signs for you.')}
                </p>
              </>
            )}
          </>
        )}

        {phase === 'signing' && (
          <p className="flex items-center gap-2 text-sm text-ink/45">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('Waiting for your signature…')}
          </p>
        )}

        {/* Firmado, pero sin recibo. NO es un fallo, y por eso no es rojo. */}
        {phase === 'unconfirmed' && unconfirmed && (
          <UnconfirmedSignatureNotice
            rail="evm"
            chainId={FLARE_CHAIN_ID}
            unconfirmed={unconfirmed}
            onClose={onClose}
          />
        )}

        {phase === 'done' && (
          <>
            <p className="text-sm leading-relaxed text-ink/70">
              {mode === 'deposit'
                ? t('Signed. Your position will show up here once the network confirms it.')
                : t(exitSentLineFor({ mode, handoff: exitHandoff }))}
            </p>
            <PrimaryButton onClick={onClose} className="w-full">{t('Done')}</PrimaryButton>
          </>
        )}
      </div>
    </OperationSurface>
  );
}

export default VaultEntryModal;

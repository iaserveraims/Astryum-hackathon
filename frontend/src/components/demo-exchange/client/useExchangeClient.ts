'use client';

/**
 * useExchangeClient — la cuenta de UN cliente en SU exchange, como lógica sin
 * pintar (fundador 14-sep: «una versión productizada del modo exchange… el
 * cliente debe tener lo mismo que hay, pero productizado»).
 *
 * Es la lógica de ClientInner (ClientApp.tsx) sacada a un hook para que la app
 * del cliente la reparta en pantallas (Inicio · Depositar · Vault · Retirar ·
 * Perfil). Las REGLAS no cambian ni una coma:
 *   · «mi fila» es la que el servidor dice mía, o una sin dueño con MI passkey
 *     (reclamable con código). Una de otro nunca soy yo.
 *   · un depósito que llegó a Xaman y cuyo final no se pudo leer NO vuelve a
 *     ofrecer «Firmar» (sería un segundo pago): queda el aviso ámbar.
 *   · la salida se compone, se ENSEÑA (comisiones incluidas, invariante #6) y
 *     solo entonces Face ID firma exactamente eso. Una lectura fallida jamás
 *     cierra la salida: se relee al pulsar.
 *
 * ClientInner sigue vivo (la vista demo del operador lo usa); esta copia es la
 * del producto. Si se toca una regla de dinero, se toca en los dos sitios.
 */

import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n/LanguageProvider';
import { usePasskeyActions } from '../../../lib/institutional/usePasskeyActions';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { getPoteState, prepareRedeem, preparePoteExitXrp, type PoteState, type PreparedRedeem, type XrpExitPrepared } from '../../../lib/institutional/api';
import {
  buildClientExitReview,
  effectiveExitTo,
  exitDestinationOptions,
  pickExitTo,
  type ClientExitReview,
  type ClientExitTo,
  type RedeemFeeInfo,
} from '../../../lib/demo-exchange/clientExitPlan';
import { fmtBase, parseAmountToBase } from '../../../lib/institutional/policyCatalog';
import type { Call } from '../../../lib/institutional/passkey';
import {
  demoApi,
  describeRefusal,
  describeRequestRefusal,
  doorOpenedNotice,
  dropsToXrp,
  openRefusalDoor,
  ownershipUnreadableFor,
  refusalDoors,
  refusalIsRetryable,
  requestAcceptedNotice,
  shortHash,
  type DemoClient,
  type RefusalDoor,
  type RequestRefusal,
} from '../../../lib/demo-exchange/api';
import type { DemoRunApi } from '../../../lib/demo-exchange/useDemoRun';
import { applySignAction, applySignFailure, type UnconfirmedSignature } from '../../../lib/wallet/signOutcome';
import { passkeyRelayFailureAction } from '../../../lib/institutional/passkeyRelayOutcome';
import type { DepositInstructions } from '../DepositXamanQr';

export const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
export const XRP_RE = /^\d+(\.\d{1,6})?$/;
const EXIT_MARGIN_BPS = BigInt(25);

/** An exit composed and REVIEWED, waiting for Face ID (invariant #6: nothing signs unseen). */
export interface PendingExit {
  calls: Call[];
  step: 'U4_EXIT' | 'U4_EXIT_XRP';
  isRequest: boolean;
  /** Participaciones que había ANTES de firmar (el verificador comprueba que bajan). */
  sharesBefore: bigint;
  estNow: bigint;
  exitTo: ClientExitTo;
  review: ClientExitReview;
}

export function useExchangeClient(demo: DemoRunApi, account: string) {
  const { t } = useT();
  const run = demo.run!;
  const { signAndRelay, state: pk } = usePasskeyActions();
  const xrpl = useXrplWalletPartner();

  const me: DemoClient | undefined = useMemo(() => {
    const byAccount = run.clients.filter((c) => c.passkeyAccount?.toLowerCase() === account.toLowerCase());
    return byAccount.find((c) => c.mine) ?? byAccount.find((c) => !c.owned);
  }, [run, account]);
  const needsClaim = Boolean(me && !me.owned);
  // it. 33 (2) — «no pude leer si esta fila es tuya» NO es «no tienes cuenta».
  // El libro se recarga cada 20 s; con la marca del lector inutilizable el
  // servidor contesta todas las filas `mine:false` y esto quedaba `undefined` →
  // «Open an account» sobre la cuenta de una persona con XRP dentro. La pantalla
  // pinta esto (frase del servidor + reintento) en vez del alta.
  const ownershipUnreadable = useMemo(() => (me ? null : ownershipUnreadableFor(run, account)), [run, account, me]);
  const facts = useMemo(() => demo.chain?.clients.find((c) => c.clientId === me?.id), [demo.chain, me]);

  const [pote, setPote] = useState<PoteState | null>(null);
  const [poteReadFailed, setPoteReadFailed] = useState(false);
  const [poteNonce, setPoteNonce] = useState(0);
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [exitTo, setExitTo] = useState<ClientExitTo>('wallet');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [txUrl, setTxUrl] = useState('');
  const [depositUnconfirmed, setDepositUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [exitUnconfirmed, setExitUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [exitReview, setExitReview] = useState<PendingExit | null>(null);
  const [requestRefusal, setRequestRefusal] = useState<RequestRefusal | null>(null);

  useEffect(() => {
    if (!run.poteAddress) return;
    let cancelled = false;
    void getPoteState(run.poteAddress, account)
      .then((s) => { if (!cancelled) { setPote(s); setPoteReadFailed(false); } })
      .catch(() => { if (!cancelled) setPoteReadFailed(true); });
    return () => { cancelled = true; };
  }, [run.poteAddress, account, txUrl, demo.chain?.readAt, poteNonce]);

  // Lo que se ve «vivo» sin pulsar nada: el libro del exchange y la cadena, cada 20 s.
  const reload = demo.reload;
  useEffect(() => {
    const id = window.setInterval(() => { void reload(); }, 20_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const shares = BigInt(pote?.holder?.shares ?? '0');
  const dec = pote?.asset.decimals ?? 6;
  const estValue = useMemo(() => {
    if (!pote || BigInt(pote.totalSupply) === BigInt(0)) return BigInt(0);
    return (shares * BigInt(pote.totalAssets)) / BigInt(pote.totalSupply);
  }, [pote, shares]);

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }
  function clearMessages() {
    setError('');
    setNotice('');
  }

  /* ── Abrir la cuenta (el exchange asigna el tag) ─────────────────────── */
  async function openAccount(label: string) {
    setError('');
    setBusy('create');
    try {
      if (!label.trim()) throw new Error(t('Give your account a name'));
      const r = await demoApi.addClient(run.runId, { label: label.trim(), passkeyAccount: account });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setNotice(t('Your exchange account is ready. Your deposit tag is {tag}.').replace('{tag}', String(r.data.client.tag)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** The exchange opened an account with MY passkey but nobody owns it yet: claim it with the code. */
  async function claimMine(code: string) {
    if (!me) return;
    setError('');
    setBusy('claim');
    try {
      if (!code.trim()) throw new Error(t('Enter the claim code the exchange gave you'));
      const r = await demoApi.patchClient(run.runId, me.id, { claimCode: code.trim() });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setNotice(t('This exchange account is yours now.'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /* ── Depositar (XRP + tag) ───────────────────────────────────────────── */
  async function getInstructions(amountXrp: string) {
    if (!me) return;
    clearMessages();
    setBusy('deposit');
    try {
      if (!XRP_RE.test(amountXrp) || Number(amountXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      const r = await demoApi.depositInstructions(run.runId, me.id, amountXrp);
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      setInstructions({ ...r.data.instructions, xrplTx: r.data.xrplTx });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  async function signDepositWithConnectedXaman() {
    if (!instructions || depositUnconfirmed) return;
    setError('');
    setBusy('sign-deposit');
    let handedToPartner = false;
    try {
      if (!xrpl.isConnected) throw new Error(t('Connect your XRPL wallet (Xaman) to sign the deposit — or send it from any wallet with the tag above.'));
      handedToPartner = true;
      const { txHash } = await xrpl.sendIntent({ tx: instructions.xrplTx as never });
      setNotice(t('Deposit signed ({hash}). The exchange ledger credits it when the ledger validates it — a few seconds.').replace('{hash}', shortHash(txHash)));
      setInstructions(null);
      window.setTimeout(() => void demo.scanOmnibus(), 6000);
    } catch (e) {
      applySignFailure(e, handedToPartner, t, {
        setError,
        setUnconfirmed: setDepositUnconfirmed,
        setPhase: () => {},
        clearPrepared: () => setInstructions(null),
      });
    } finally {
      setBusy(null);
    }
  }
  function depositSettledByQr(hash: string) {
    setNotice(t('Deposit validated on the ledger ({hash}). The exchange credits it on its next read — a few seconds.').replace('{hash}', shortHash(hash)));
    setInstructions(null);
    void demo.scanOmnibus();
  }

  /* ── Meter en el vault: la petición la ejecuta el exchange desde su omnibus ── */
  /**
   * it. 31 — las dos peticiones pasan por aquí: el 201 dice quién sirve (el
   * autopiloto en segundos, o una persona), y un 409 deja el rechazo ENTERO en
   * `requestRefusal` para que la pantalla ofrezca la puerta que el servidor nombró
   * (retirar la petición muerta, soltar la reserva de mesa) o el reintento.
   */
  async function askRequest(kind: 'put-to-work' | 'withdraw', amountXrp: string, busyKey: 'ask' | 'withdraw') {
    if (!me) return false;
    clearMessages();
    setRequestRefusal(null);
    setBusy(busyKey);
    try {
      if (!XRP_RE.test(amountXrp) || Number(amountXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      const r = await demoApi.addRequest(run.runId, me.id, { kind, amountXrp });
      if (!r.ok) {
        setRequestRefusal({ kind, amountXrp, refusal: r.refusal, doors: refusalDoors(r.refusal), retryable: refusalIsRetryable(r.refusal) });
        throw new Error(describeRequestRefusal(r.refusal, t));
      }
      demo.setRun(r.data.run);
      setNotice(requestAcceptedNotice(kind, r.data.servedBy ?? (r.data.run.autopilot ? 'autopilot' : 'desk'), t));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  }
  const askToWork = (amountXrp: string) => askRequest('put-to-work', amountXrp, 'ask');

  /** it. 31 — the door the last refusal named, opened by its owner. Nothing moves; the queue lets go. */
  async function openDoor(door: RefusalDoor) {
    if (!me) return false;
    setError('');
    setBusy('door');
    try {
      const r = await openRefusalDoor(demoApi, run.runId, me.id, door);
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setRequestRefusal(null);
      // it. 33 (6): the sentence follows what the server said it did — a request
      // closed as `reconciled: 'failed-on-ledger'` HAD a signed payment (the
      // ledger refused it); «nothing had been signed» was false there.
      setNotice(doorOpenedNotice(door, r.data.reconciled, t));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** it. 31 — a refusal the server marked retryable («a read of ours failed»): the same ask, again. */
  async function retryRequest() {
    const last = requestRefusal;
    if (!last || !last.retryable) return false;
    return askRequest(last.kind, last.amountXrp, last.kind === 'withdraw' ? 'withdraw' : 'ask');
  }

  async function toggleAutoInvest() {
    if (!me) return;
    const r = await demoApi.patchClient(run.runId, me.id, { autoInvest: !me.autoInvest });
    if (r.ok) demo.setRun(r.data.run);
    else fail(new Error(describeRefusal(r.refusal, t)));
  }

  /* ── Sacar del vault: compuesto, REVISADO, y luego Face ID ─────────── */
  /**
   * `amountFxrp` vacío = todo. Con importe se redimen las participaciones que
   * valen eso al precio leído AHORA (nunca más de las que hay). El recibo guarda
   * las que había ANTES: el verificador comprueba que bajaron, no que llegaron a 0.
   */
  async function prepareExit(amountFxrp?: string) {
    if (!me || exitUnconfirmed) return;
    clearMessages();
    setTxUrl('');
    setExitReview(null);
    setBusy('exit-prepare');
    try {
      if (!run.poteAddress) throw new Error(t('The exchange has not opened its pote yet.'));
      let live = pote;
      try {
        live = await getPoteState(run.poteAddress, account);
        setPote(live);
        setPoteReadFailed(false);
      } catch {
        setPoteReadFailed(true);
        if (!live) throw new Error(t('Could not read your position in the pote right now — nothing was signed. Try again in a moment.'));
      }
      const sharesHeld = BigInt(live.holder?.shares ?? '0');
      if (sharesHeld <= BigInt(0)) throw new Error(t('You hold no shares of this vault'));
      const totalAssets = BigInt(live.totalAssets);
      const totalSupply = BigInt(live.totalSupply);
      let sharesNow = sharesHeld;
      if (amountFxrp && amountFxrp.trim()) {
        const base = parseAmountToBase(amountFxrp, live.asset.decimals);
        if (base === null || base <= BigInt(0)) throw new Error(t('Amount must be greater than 0'));
        const wanted = totalAssets === BigInt(0) ? BigInt(0) : (base * totalSupply) / totalAssets;
        if (wanted <= BigInt(0)) throw new Error(t('Amount must be greater than 0'));
        sharesNow = wanted >= sharesHeld ? sharesHeld : wanted;
      }
      const estNow = totalSupply === BigInt(0) ? BigInt(0) : (sharesNow * totalAssets) / totalSupply;
      const chosen = pickExitTo(exitTo, exitDestinationOptions({ cooldownSeconds: live.cooldownSeconds, hasOwnWallet: XRPL_RE.test(me.xrplAddress ?? '') }));
      const calls: Call[] = [];
      const red = await prepareRedeem({ pote: live.pote, sharesBase: sharesNow.toString(), receiver: account, owner: account });
      if (!red.ok) throw new Error(red.refusal.detail ?? red.refusal.error);
      for (const c of red.data.calls) calls.push({ target: c.to, value: c.value, data: c.data });
      const isRequest = red.data.mode === 'request';
      const effective = effectiveExitTo(red.data.mode, chosen);
      let step: 'U4_EXIT' | 'U4_EXIT_XRP' = 'U4_EXIT';
      let exitXrp: XrpExitPrepared | null = null;
      let unmintBase = BigInt(0);
      if (!isRequest && effective !== 'keep') {
        const est = estNow - (estNow * EXIT_MARGIN_BPS) / BigInt(10000);
        if (est <= BigInt(0)) throw new Error(t('Nothing to unmint'));
        const dest = effective === 'exchange' ? run.omnibusAddress : (me.xrplAddress ?? '');
        if (!XRPL_RE.test(dest)) throw new Error(t('Register your own XRPL wallet first (the exchange has it on file).'));
        // El tag de la vuelta es MI tag del exchange: sin él el XRP volvería al omnibus sin dueño.
        const ex = await preparePoteExitXrp(effective === 'exchange'
          ? { amountFxrpBase: est.toString(), xrplDestination: dest, destinationTag: me.tag, pote: live.pote, holder: account }
          : { amountFxrpBase: est.toString(), xrplDestination: dest });
        if (!ex.ok) throw new Error(ex.refusal.detail ?? ex.refusal.error);
        calls.push({ target: ex.data.call.to, value: ex.data.call.value, data: ex.data.call.data });
        exitXrp = ex.data;
        unmintBase = est;
        step = 'U4_EXIT_XRP';
      }
      const liveDec = live.asset.decimals;
      const fixedBase = isRequest && red.data.estAssetsBase ? red.data.estAssetsBase : estNow;
      const review = buildClientExitReview({
        mode: isRequest ? 'request' : 'sync',
        chosen,
        redeem: red.data as PreparedRedeem & { fee?: RedeemFeeInfo | null },
        exitXrp,
        amounts: {
          estimate: fmtBase(fixedBase, liveDec),
          unminted: fmtBase(unmintBase, liveDec),
          margin: fmtBase(estNow - unmintBase, liveDec),
          symbol: live.asset.symbol,
        },
      });
      setExitReview({ calls, step, isRequest, sharesBefore: sharesHeld, estNow, exitTo: effective, review });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** The reviewed batch, exactly as shown, signed with Face ID. */
  async function confirmExit() {
    const pending = exitReview;
    if (!me || !pending || exitUnconfirmed) return;
    setError('');
    setTxUrl('');
    setBusy('exit');
    let handedOff = false;
    let relayedHash: string | null = null;
    try {
      const { calls, step, isRequest, sharesBefore, estNow, exitTo: sentTo } = pending;
      const res = await signAndRelay(calls, { onHandOff: () => { handedOff = true; } });
      relayedHash = res.execTxHash;
      setExitReview(null);
      setTxUrl(`https://flarescan.com/tx/${res.execTxHash}`);
      await demo.addReceipt({ step, chain: 'flare', txHash: res.execTxHash, clientId: me.id, note: isRequest ? t('Cooldown pote: shares burned now, the amount is fixed in FXRP; claimable at maturity into my Face ID account.') : sentTo === 'exchange' ? t('One Face ID: redeem + redeemWithTag → XRP back to the exchange, tagged as mine.') : sentTo === 'wallet' ? t('One Face ID: redeem + unmint → XRP to my own wallet.') : t('One Face ID: redeem → FXRP stays in my account.'), expect: { sharesBefore: sharesBefore.toString(), exitTo: sentTo, estAssets: estNow.toString() } });
      setNotice(t('Done — verified on the blockchain.'));
      void demo.refreshChain();
      if (step === 'U4_EXIT_XRP') window.setTimeout(() => void demo.scanOmnibus(), 15000);
    } catch (e) {
      if (relayedHash) {
        fail(e);
      } else {
        applySignAction(passkeyRelayFailureAction(e, handedOff, t), {
          setError,
          setUnconfirmed: (u) => {
            setExitUnconfirmed(u);
            if (u) setExitReview(null);
          },
          setPhase: () => {},
          clearPrepared: () => setExitReview(null),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  /* ── Retirar XRP del exchange a mi wallet ─────────────────────────── */
  // it. 31: misma pieza que la entrada — y la frase del 201 ya no promete «en
  // unos segundos» cuando quien paga es una persona (`servedBy`).
  const askWithdraw = (amountXrp: string) => askRequest('withdraw', amountXrp, 'withdraw');

  const myRequests = useMemo(
    () => (run.requests ?? []).filter((r) => r.clientId === me?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [run.requests, me?.id],
  );
  const myReceipts = useMemo(
    () => run.receipts.filter((r) => r.clientId === me?.id).sort((a, b) => b.at.localeCompare(a.at)),
    [run.receipts, me?.id],
  );
  const exitOptions = exitDestinationOptions({ cooldownSeconds: pote ? pote.cooldownSeconds : null, hasOwnWallet: XRPL_RE.test(me?.xrplAddress ?? '') });
  const exitToShown = pickExitTo(exitTo, exitOptions);
  const exchangeXrp = dropsToXrp(me?.xrpOnExchangeDrops);

  return {
    run,
    account,
    me,
    needsClaim,
    // it. 33 (2): «could not read whether this row is yours» — the screen shows
    // this (server sentence + retry) instead of «Open an account».
    ownershipUnreadable,
    facts,
    pote,
    poteReadFailed,
    retryPote: () => setPoteNonce((n) => n + 1),
    shares,
    dec,
    estValue,
    exchangeXrp,
    busy,
    notice,
    error,
    setError,
    setNotice,
    txUrl,
    pkBusy: pk.busy,
    // cuenta
    openAccount,
    claimMine,
    // depósito
    instructions,
    setInstructions,
    getInstructions,
    signDepositWithConnectedXaman,
    depositSettledByQr,
    depositUnconfirmed,
    setDepositUnconfirmed,
    xrplConnected: xrpl.isConnected,
    // vault
    askToWork,
    toggleAutoInvest,
    // salida
    exitTo: exitToShown,
    setExitTo: (to: ClientExitTo) => { setExitTo(to); setExitReview(null); },
    exitOptions,
    exitReview,
    setExitReview,
    prepareExit,
    confirmExit,
    exitUnconfirmed,
    setExitUnconfirmed,
    askWithdraw,
    // it. 31: la puerta del dueño y el reintento, para la pantalla
    requestRefusal,
    openDoor,
    retryRequest,
    // historial
    myRequests,
    myReceipts,
    fmt: (base: bigint) => fmtBase(base, dec),
  };
}

export type ExchangeClientApi = ReturnType<typeof useExchangeClient>;

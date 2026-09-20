'use client';

/**
 * ClientApp — the client of the exchange, as they would see it at any exchange:
 * a balance, "put to work", a position, "take out". Face ID once creates their
 * Flare account (where the shares live); every exit is ONE signature, to their
 * slot at the exchange (redeem + redeemWithTag, the tag read on-chain) or to
 * their own XRPL wallet. They never see a wallet, gas or FLR.
 *
 * Reuses PasskeyGate + usePasskeyActions (the existing passkey rail) and the
 * institutional prepare routes; records receipts on the demo run.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, RefreshCw, ScanFace, ExternalLink } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { PasskeyGate } from '../institutional/user/PasskeyGate';
import { usePasskeyActions } from '../../lib/institutional/usePasskeyActions';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { getPoteState, prepareRedeem, preparePoteExitXrp, type PoteState, type PreparedRedeem, type XrpExitPrepared } from '../../lib/institutional/api';
import {
  buildClientExitReview,
  effectiveExitTo,
  exitDestinationOptions,
  fillParams,
  pickExitTo,
  redemptionFeeSentence,
  type ClientExitReview,
  type ClientExitTo,
  type RedeemFeeInfo,
} from '../../lib/demo-exchange/clientExitPlan';
import { fmtBase } from '../../lib/institutional/policyCatalog';
import type { Call } from '../../lib/institutional/passkey';
import { demoApi, describeRefusal, dropsToXrp, ownershipUnreadableFor, shortHash, type DemoClient } from '../../lib/demo-exchange/api';
import { PortalRefusal } from './client/PortalRefusal';
import { ManagerPublicProfile } from '../managed/ManagerPublicProfile';
import type { DemoRunApi } from '../../lib/demo-exchange/useDemoRun';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { applySignAction, applySignFailure, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { passkeyRelayFailureAction } from '../../lib/institutional/passkeyRelayOutcome';
import { DepositQrSign, DepositSummary, type DepositInstructions } from './DepositXamanQr';
import { ClientKycCard } from './ClientKycCard';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const XRP_RE = /^\d+(\.\d{1,6})?$/;
const EXIT_MARGIN_BPS = BigInt(25);

type ExitTo = ClientExitTo;

/** An exit composed and REVIEWED, waiting for Face ID (invariant #6: nothing signs unseen). */
interface PendingExit {
  calls: Call[];
  step: 'U4_EXIT' | 'U4_EXIT_XRP';
  isRequest: boolean;
  sharesNow: bigint;
  estNow: bigint;
  exitTo: ExitTo;
  review: ClientExitReview;
}

export function ClientApp({ demo }: { demo: DemoRunApi }) {
  const { t } = useT();
  const run = demo.run;
  if (!run) return <p className="text-xs text-ink/50">{t('Select or create a run first (Runs tab).')}</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink/60">
        {t('You are a client of the Demo Exchange here. Face ID once creates your on-chain account — that is where your shares live, in your name. You never touch a wallet, gas or FLR.')}
      </p>
      <PasskeyGate>{(account) => <ClientInner demo={demo} account={account} />}</PasskeyGate>
    </div>
  );
}

export function ClientInner({ demo, account }: { demo: DemoRunApi; account: string }) {
  const { t } = useT();
  const run = demo.run!;
  const { signAndRelay, state: pk } = usePasskeyActions();
  const xrpl = useXrplWalletPartner();

  // A passkey address is public: anyone can put it on a row. MY row is the one
  // the server says is mine (owned by this session), or an unowned one carrying
  // my passkey (the exchange opened it for me — claim it with the code). A row
  // owned by someone else is never "me".
  const me: DemoClient | undefined = useMemo(() => {
    const byAccount = run.clients.filter((c) => c.passkeyAccount?.toLowerCase() === account.toLowerCase());
    return byAccount.find((c) => c.mine) ?? byAccount.find((c) => !c.owned);
  }, [run, account]);
  const needsClaim = Boolean(me && !me.owned);
  const facts = useMemo(() => demo.chain?.clients.find((c) => c.clientId === me?.id), [demo.chain, me]);

  const [pote, setPote] = useState<PoteState | null>(null);
  // «Could not read» is said, never shown as «no pote» / «no shares» — and it
  // never closes the way out (R3): the exit reads again when pressed.
  const [poteReadFailed, setPoteReadFailed] = useState(false);
  const [poteNonce, setPoteNonce] = useState(0);
  const [label, setLabel] = useState('');
  const [xrplAddr, setXrplAddr] = useState('');
  const [linkId, setLinkId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [depositXrp, setDepositXrp] = useState('');
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [workXrp, setWorkXrp] = useState('');
  const [exitTo, setExitTo] = useState<ExitTo>('exchange');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [txUrl, setTxUrl] = useState('');
  // A signature that reached the wallet and whose ending we could not read:
  // the amber notice REPLACES the button that would sign it a second time.
  const [depositUnconfirmed, setDepositUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  // The deposit as a Xaman QR (fundador 14-sep): the same prepared tx, signed from
  // any Xaman by scanning — no connected wallet. While its QR is live it is a
  // signature: the other doors to the same deposit stay closed (no double pay).
  const [payByQr, setPayByQr] = useState(false);
  const [qrBlocked, setQrBlocked] = useState(false);
  const [exitUnconfirmed, setExitUnconfirmed] = useState<UnconfirmedSignature | null>(null);
  const [exitReview, setExitReview] = useState<PendingExit | null>(null);

  useEffect(() => {
    if (!run.poteAddress) return;
    let cancelled = false;
    void getPoteState(run.poteAddress, account)
      .then((s) => { if (!cancelled) { setPote(s); setPoteReadFailed(false); } })
      // Keep the last good read (labelled as such); never pretend there is nothing.
      .catch(() => { if (!cancelled) setPoteReadFailed(true); });
    return () => { cancelled = true; };
  }, [run.poteAddress, account, txUrl, demo.chain?.readAt, poteNonce]);

  const shares = BigInt(pote?.holder?.shares ?? '0');
  const dec = pote?.asset.decimals ?? 6;
  const estValue = useMemo(() => {
    if (!pote || BigInt(pote.totalSupply) === BigInt(0)) return BigInt(0);
    return (shares * BigInt(pote.totalAssets)) / BigInt(pote.totalSupply);
  }, [pote, shares]);

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  /* ── U0: become a client of the run ─────────────────────────────────── */
  /**
   * The optional payout wallet goes in its OWN call, after the account exists.
   * Sent together, an unproven wallet (every Xaman of someone who signed in by
   * email or passkey, until bound by signature) refused the WHOLE sign-up with
   * 403. Now the account always opens and only the wallet is refused, in words.
   */
  async function attachWallet(clientId: string, wallet: string, opened: string) {
    if (!wallet) return setNotice(opened);
    const w = await demoApi.patchClient(run.runId, clientId, { xrplAddress: wallet });
    if (w.ok) {
      demo.setRun(w.data.run);
      setNotice(`${opened} ${t('Your withdrawal wallet is on file.')}`);
    } else {
      setNotice(opened);
      setError(t('Your account is open, but the withdrawal wallet was not saved: {reason}').replace('{reason}', describeRefusal(w.refusal, t)));
    }
  }

  async function createMe() {
    setError('');
    setBusy('create');
    try {
      const wallet = xrplAddr.trim();
      if (!label.trim()) throw new Error(t('Give your account a name'));
      if (wallet && !XRPL_RE.test(wallet)) throw new Error(t('The XRPL address is not valid'));
      const r = await demoApi.addClient(run.runId, { label: label.trim(), passkeyAccount: account });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      await attachWallet(r.data.client.id, wallet, t('Your exchange account is ready. Your deposit tag is {tag}.').replace('{tag}', String(r.data.client.tag)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  async function linkMe() {
    setError('');
    setBusy('link');
    try {
      const wallet = xrplAddr.trim();
      if (!linkId) throw new Error(t('Pick your account'));
      // The exchange handed a one-time claim code to the person it opened this
      // account for; without it the account cannot be made yours.
      if (!claimCode.trim()) throw new Error(t('Enter the claim code the exchange gave you'));
      if (wallet && !XRPL_RE.test(wallet)) throw new Error(t('The XRPL address is not valid'));
      const r = await demoApi.patchClient(run.runId, linkId, { passkeyAccount: account, claimCode: claimCode.trim() });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      await attachWallet(linkId, wallet, t('This exchange account is yours now.'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** The exchange opened an account with MY passkey but nobody owns it yet: claim it with the code. */
  async function claimMine() {
    if (!me) return;
    setError('');
    setBusy('claim');
    try {
      if (!claimCode.trim()) throw new Error(t('Enter the claim code the exchange gave you'));
      const r = await demoApi.patchClient(run.runId, me.id, { claimCode: claimCode.trim() });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setClaimCode('');
      setNotice(t('This exchange account is yours now.'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /* ── U1: deposit at the exchange (XRP + tag) ────────────────────────── */
  async function getInstructions(asQr: boolean) {
    if (!me) return;
    setError('');
    setBusy('deposit');
    try {
      if (!XRP_RE.test(depositXrp) || Number(depositXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      const r = await demoApi.depositInstructions(run.runId, me.id, depositXrp);
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      setInstructions({ ...r.data.instructions, xrplTx: r.data.xrplTx });
      // «Pagar con Xaman (QR)» desde el importe: un paso, directo al QR.
      setPayByQr(asQr);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  async function signDeposit() {
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
      // After the payment reached Xaman, an ending we could not read is NOT a
      // failure: offering «Sign with my Xaman» again is a second deposit. Only a
      // provable «nothing left» (cancelled, expired, never connected) keeps the
      // instructions and the sign button.
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

  /* ── U2: ask the exchange to put it to work (one tap; the backend does the rest) ── */
  async function askToWork() {
    if (!me) return;
    setError('');
    setBusy('ask');
    try {
      if (!XRP_RE.test(workXrp) || Number(workXrp) <= 0) throw new Error(t('Amount must be greater than 0'));
      const r = await demoApi.addRequest(run.runId, me.id, { kind: 'put-to-work', amountXrp: workXrp });
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      demo.setRun(r.data.run);
      setNotice(run.autopilot
        ? t('Request sent. The exchange backend signs the mint on its next tick (~20 s); your shares appear here when the mint lands (~2–5 min).')
        : t('Request recorded. The exchange executes it in the Exchange tab (E5); your shares appear here when the mint lands.'));
      setWorkXrp('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoInvest() {
    if (!me) return;
    const r = await demoApi.patchClient(run.runId, me.id, { autoInvest: !me.autoInvest });
    if (r.ok) demo.setRun(r.data.run);
    else fail(new Error(describeRefusal(r.refusal, t)));
  }

  /* ── U4: exit with ONE signature — composed, REVIEWED, then Face ID ─── */
  /**
   * Step 1: compose the exit and show what the backend disclosed (the redeem
   * with Astryum's fee tranche, and the unmint when there is one) BEFORE Face
   * ID. Nothing leaves the browser here, so every failure is a plain error.
   */
  async function prepareExit() {
    if (!me || exitUnconfirmed) return;
    setError('');
    setTxUrl('');
    setExitReview(null);
    setBusy('exit-prepare');
    try {
      if (!run.poteAddress) throw new Error(t('The exchange has not opened its pote yet.'));
      // The way out never depends on an earlier read having worked: read the
      // position NOW. If that fails too, the last good read is used — the vault
      // only ever redeems the shares this account holds.
      let live = pote;
      try {
        live = await getPoteState(run.poteAddress, account);
        setPote(live);
        setPoteReadFailed(false);
      } catch {
        setPoteReadFailed(true);
        if (!live) throw new Error(t('Could not read your position in the pote right now — nothing was signed. Try again in a moment.'));
      }
      const sharesNow = BigInt(live.holder?.shares ?? '0');
      const estNow = BigInt(live.totalSupply) === BigInt(0) ? BigInt(0) : (sharesNow * BigInt(live.totalAssets)) / BigInt(live.totalSupply);
      if (sharesNow <= BigInt(0)) throw new Error(t('You hold no shares of this vault'));
      // A destination the policy will not use is never sent as the choice.
      const chosen = pickExitTo(exitTo, exitDestinationOptions({ cooldownSeconds: live.cooldownSeconds, hasOwnWallet: XRPL_RE.test(me.xrplAddress ?? '') }));
      const calls: Call[] = [];
      const red = await prepareRedeem({ pote: live.pote, sharesBase: sharesNow.toString(), receiver: account, owner: account });
      if (!red.ok) throw new Error(red.refusal.detail ?? red.refusal.error);
      for (const c of red.data.calls) calls.push({ target: c.to, value: c.value, data: c.data });
      const isRequest = red.data.mode === 'request';
      // What the composition really does: a request-mode pote pays a ticket into
      // THIS account, whatever was picked — the review says so.
      const effective = effectiveExitTo(red.data.mode, chosen);
      let step: 'U4_EXIT' | 'U4_EXIT_XRP' = 'U4_EXIT';
      let exitXrp: XrpExitPrepared | null = null;
      let unmintBase = BigInt(0);
      if (!isRequest && effective !== 'keep') {
        const est = estNow - (estNow * EXIT_MARGIN_BPS) / BigInt(10000);
        if (est <= BigInt(0)) throw new Error(t('Nothing to unmint'));
        const dest = effective === 'exchange' ? run.omnibusAddress : (me.xrplAddress ?? '');
        if (!XRPL_RE.test(dest)) throw new Error(t('Register your own XRPL wallet first (the exchange has it on file).'));
        // XRPL-only (12-sep): el tag de la vuelta es MI tag del exchange — el
        // que el watcher usa para acreditarme. Sin él, redeemAmount devolvería
        // el XRP al omnibus SIN etiqueta: dinero anónimo, ni crédito ni recibo.
        // (Si el pote llevara puerta on-chain, el backend lo pisa con tagOf —
        // el registro tiene la última palabra cuando existe.)
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
        // `fee` is on the wire (routes/institutional.ts) but not on PreparedRedeem's type.
        redeem: red.data as PreparedRedeem & { fee?: RedeemFeeInfo | null },
        exitXrp,
        amounts: {
          estimate: fmtBase(fixedBase, liveDec),
          unminted: fmtBase(unmintBase, liveDec),
          margin: fmtBase(estNow - unmintBase, liveDec),
          symbol: live.asset.symbol,
        },
      });
      setExitReview({ calls, step, isRequest, sharesNow, estNow, exitTo: effective, review });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** Step 2: the reviewed batch, exactly as shown, signed with Face ID. */
  async function confirmExit() {
    const pending = exitReview;
    if (!me || !pending || exitUnconfirmed) return;
    setError('');
    setTxUrl('');
    setBusy('exit');
    // Marked by signAndRelay right before the SIGNED batch leaves the browser.
    let handedOff = false;
    let relayedHash: string | null = null;
    try {
      const { calls, step, isRequest, sharesNow, estNow, exitTo: sentTo } = pending;
      const res = await signAndRelay(calls, { onHandOff: () => { handedOff = true; } });
      relayedHash = res.execTxHash;
      setExitReview(null);
      const url = `https://flarescan.com/tx/${res.execTxHash}`;
      setTxUrl(url);
      await demo.addReceipt({ step, chain: 'flare', txHash: res.execTxHash, clientId: me.id, note: isRequest ? t('Cooldown pote: shares burned now, the amount is fixed in FXRP; claimable at maturity into my Face ID account.') : sentTo === 'exchange' ? t('One Face ID: redeem + redeemWithTag → XRP back to the exchange, tagged as mine.') : sentTo === 'wallet' ? t('One Face ID: redeem + unmint → XRP to my own wallet.') : t('One Face ID: redeem → FXRP stays in my account.'), expect: { sharesBefore: sharesNow.toString(), exitTo: sentTo, estAssets: estNow.toString() } });
      setNotice(t('Done — verified on the blockchain.'));
      void demo.refreshChain();
      if (step === 'U4_EXIT_XRP') window.setTimeout(() => void demo.scanOmnibus(), 15000);
    } catch (e) {
      if (relayedHash) {
        // The relay already returned the exit's hash; what failed is our
        // bookkeeping after it — never a signature to offer again.
        fail(e);
      } else {
        // Face ID cancelled, or the relay refused BEFORE broadcasting → the
        // button stays. Anything else once the signed batch left → amber, and
        // «Take out everything» is not offered a second time.
        applySignAction(passkeyRelayFailureAction(e, handedOff, t), {
          setError,
          setUnconfirmed: (u) => {
            setExitUnconfirmed(u);
            // An ending we could not read: the reviewed batch is NOT offered again.
            if (u) setExitReview(null);
          },
          setPhase: () => {},
          // The chain refused it: the composed batch is spent — review again.
          clearPrepared: () => setExitReview(null),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  /* ── U5: ask for a withdrawal to my wallet ─────────────────────────── */
  async function askWithdraw() {
    if (!me) return;
    setError('');
    const r = await demoApi.addRequest(run.runId, me.id, { kind: 'withdraw', amountXrp: dropsToXrp(me.xrpOnExchangeDrops) });
    if (!r.ok) return fail(new Error(describeRefusal(r.refusal, t)));
    demo.setRun(r.data.run);
    setNotice(run.autopilot
      ? t('Withdrawal requested. The exchange backend pays it out to your wallet on its next tick.')
      : t('Withdrawal requested. The exchange pays it out in the Exchange tab (E8).'));
  }

  const myRequests = (run.requests ?? []).filter((r) => r.clientId === me?.id).slice(-5).reverse();
  // What the exit may offer, from the policy as last read (null = unread → all
  // offered; the review reconciles with the mode the backend composes).
  const exitOptions = exitDestinationOptions({ cooldownSeconds: pote ? pote.cooldownSeconds : null, hasOwnWallet: XRPL_RE.test(me?.xrplAddress ?? '') });
  const exitToShown = pickExitTo(exitTo, exitOptions);
  const exitReasons = Array.from(new Set(exitOptions.filter((o) => !o.enabled && o.reason).map((o) => o.reason as string)));

  // it. 33 (2): the same money rule as useExchangeClient — «could not read
  // whether this row is yours» is shown with the read again, never as the alta.
  const ownershipUnreadable = !me ? ownershipUnreadableFor(run, account) : null;
  if (!me && ownershipUnreadable) return <PortalRefusal refusal={ownershipUnreadable} onRetry={() => void demo.reload()} />;
  if (!me) {
    // Only rows the exchange opened and nobody owns yet — and not ones carrying another passkey.
    const unlinked = run.clients.filter((c) => c.claimable && (!c.passkeyAccount || c.passkeyAccount.toLowerCase() === account.toLowerCase()));
    return (
      <div data-station="U0" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3 max-w-md">
        <div className="text-xs text-ink/70">{t('Your on-chain account')}: <span className="font-mono break-all select-all">{account}</span></div>
        <p className="text-xs text-ink/60">{t('This account is not a client of the exchange yet. Open one (the exchange assigns your deposit tag), or link it to a client the exchange already created.')}</p>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('Account name')} className="w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
        <input value={xrplAddr} onChange={(e) => setXrplAddr(e.target.value)} placeholder={t('Your own XRPL wallet (optional, r… — for withdrawals)')} className="w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
        <p className="text-[11px] text-ink/50">
          {t('Optional — leave it empty and your account opens anyway; you can add the wallet later. It has to be proven yours: the wallet you signed in with, or one bound to your account by signature in Wallets. If it is not, the account still opens and only the wallet is refused.')}
        </p>
        <button onClick={createMe} disabled={busy !== null} className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50">{t('Open my exchange account')}</button>
        {unlinked.length ? (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className="flex-1 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink">
                <option value="">{t('…or link an existing client')}</option>
                {unlinked.map((c) => <option key={c.id} value={c.id}>{c.label} · tag {c.tag}</option>)}
              </select>
            </div>
            {linkId ? (
              <div className="flex gap-2 items-center">
                <input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} placeholder={t('Claim code from the exchange (XXXX-XXXX-…)')} autoComplete="off" className="flex-1 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
                <button onClick={linkMe} disabled={busy !== null || !linkId || !claimCode.trim()} className="rounded-lg border border-ink/10 px-3 py-2 text-xs text-ink/70 disabled:opacity-50">{t('Link')}</button>
              </div>
            ) : null}
            <p className="text-[11px] text-ink/50">{t('The exchange gives the claim code only to the person it opened the account for — in person or by phone.')}</p>
          </div>
        ) : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {notice ? <p className="rounded-xl border border-volt/30 bg-volt/5 p-3 text-xs text-ink/80">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{error}</p> : null}

      {needsClaim ? (
        <div className="rounded-2xl border border-tone-warning/30 bg-tone-warning/[0.05] p-4 space-y-2 text-xs">
          <p className="text-ink/80">{t('The exchange opened this account with your Face ID account, but it is not yours yet. Enter the claim code the exchange gave you to make it yours — until then nothing here can be changed.')}</p>
          <div className="flex gap-2 items-center">
            <input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} placeholder={t('Claim code from the exchange (XXXX-XXXX-…)')} autoComplete="off" className="flex-1 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink font-mono" />
            <button onClick={claimMine} disabled={busy !== null || !claimCode.trim()} className="rounded-lg bg-volt px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{t('Claim')}</button>
          </div>
        </div>
      ) : null}

      {/* balance card — like any exchange */}
      <div data-station="U3" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('XRP at the exchange')}</div>
          <div className="text-xl font-semibold text-ink font-mono">{dropsToXrp(me.xrpOnExchangeDrops)}</div>
          <div className="text-[11px] text-ink/50">{t('tag')} <span className="font-mono">{me.tag}</span> · {t('simulated ledger, mirrors the XRPL')}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Working in the pote')}</div>
          <div className="text-xl font-semibold text-ink font-mono">{pote ? fmtBase(estValue, dec) : '—'} <span className="text-xs">{pote?.asset.symbol ?? 'FXRP'}</span></div>
          <div className="text-[11px] text-ink/50">{!run.poteAddress ? t('no pote yet') : pote ? `${fmtBase(shares, dec)} ${t('shares — yours, in your account')}` : poteReadFailed ? '' : t('reading…')}</div>
          {poteReadFailed ? (
            <div className="mt-1 text-[11px] text-tone-warning">
              {pote ? t('Could not refresh your position — showing the last read.') : t('Could not read your position right now.')}{' '}
              <button onClick={() => setPoteNonce((n) => n + 1)} className="underline hover:text-ink">{t('Retry')}</button>
            </div>
          ) : null}
          {facts?.error ? <div className="mt-1 text-[11px] text-tone-warning">{t('Could not read your account on the chain right now.')}</div> : null}
          {/* What you already took out and have NOT sent anywhere. A panel that
              only counts shares tells whoever just exited that they hold nothing. */}
          {facts?.fxrpFreeHuman && Number(facts.fxrpFreeHuman) > 0 ? (
            <div className="mt-1 text-[11px] text-tone-success font-mono">
              + {facts.fxrpFreeHuman} {pote?.asset.symbol ?? 'FXRP'} <span className="text-ink/50">{t('free in your account (already taken out)')}</span>
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink/50">{t('Your on-chain account')}</div>
          <div className="text-xs font-mono break-all text-ink">{account}</div>
          {/* XRPL-only (12-sep): sin registro en Flare, «KYC not on-chain yet»
              sugería un paso pendiente que no existe. La identidad vive en XRPL
              (XLS-70); aquí solo se enseña el tag del exchange. */}
          <div className="text-[11px] text-ink/50">{facts?.registryApproved ? <span className="text-tone-success">{t('KYC on-chain · tag')} {facts.registryTag}</span> : <>{t('Your tag at the exchange')}: <span className="font-mono text-ink/70">{me?.tag ?? '—'}</span></>}</div>
        </div>
        <button onClick={() => { void demo.refreshChain(); void demo.scanOmnibus(); }} className="sm:col-span-3 text-[11px] text-ink/50 hover:text-ink inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> {t('Refresh from the chain')}</button>
      </div>

      {/* La zona de credencial del EXCHANGE, para que el cliente decida si
          confía (13-sep): la misma pieza del gestor, con rol exchange — la
          licencia CASP con su link del registro, y el disclaimer «compruébalo
          tú». Descubrimiento, nunca una puerta. */}
      <details className="rounded-2xl border border-ink/10 bg-surface-1 p-4">
        <summary className="cursor-pointer text-xs text-ink/60 hover:text-ink">{t('About your exchange — check it yourself')}</summary>
        <div className="mt-3">
          <ManagerPublicProfile role="exchange" account={run.councilAddress} />
        </div>
      </details>

      {/* El KYC del exchange: sin credencial no entra capital (la salida, intacta). */}
      <ClientKycCard runId={run.runId} client={me} />

      {/* U1 deposit */}
      <section data-station="U1" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><ArrowDownToLine className="w-4 h-4" style={{ color: 'var(--muscle, #1F6F70)' }} /> {t('Deposit XRP')}</h3>
        {depositUnconfirmed ? (
          <UnconfirmedSignatureNotice
            rail="xrpl"
            xrplKind="payment"
            unconfirmed={depositUnconfirmed}
            onClose={() => {
              setDepositUnconfirmed(null);
              setInstructions(null);
              void demo.scanOmnibus();
            }}
          />
        ) : instructions ? (
          <div className="space-y-2 text-xs">
            <DepositSummary instructions={instructions} />
            {payByQr ? (
              <div className="space-y-2">
                <DepositQrSign
                  instructions={instructions}
                  onSettled={(hash) => {
                    setNotice(t('Deposit validated on the ledger ({hash}). The exchange credits it on its next read — a few seconds.').replace('{hash}', shortHash(hash)));
                    setPayByQr(false);
                    setQrBlocked(false);
                    setInstructions(null);
                    void demo.scanOmnibus();
                  }}
                  onBlockedChange={setQrBlocked}
                  onCancelled={() => {
                    setPayByQr(false);
                    setQrBlocked(false);
                  }}
                />
                {!qrBlocked && (
                  <button onClick={() => setPayByQr(false)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
                )}
              </div>
            ) : (
              <>
                <p className="text-ink/60">{t('Send it from any XRPL wallet with that tag — or sign it here with your connected Xaman.')}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setPayByQr(true)} disabled={busy !== null} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{t('Pay with Xaman (QR)')}</button>
                  <button onClick={signDeposit} disabled={busy !== null} className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">{busy === 'sign-deposit' ? '…' : t('Sign with my Xaman')}</button>
                  <button onClick={() => setInstructions(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="text-xs text-ink/60">XRP<input value={depositXrp} onChange={(e) => setDepositXrp(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" /></label>
            <button onClick={() => void getInstructions(true)} disabled={busy !== null} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{t('Pay with Xaman (QR)')}</button>
            <button onClick={() => void getInstructions(false)} disabled={busy !== null} className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">{t('Get deposit instructions')}</button>
          </div>
        )}
      </section>

      {/* U2 put to work */}
      <section data-station="U2" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('Put it to work')}</h3>
        {pote ? (
          <div className="rounded-xl bg-surface-2 p-3 text-xs text-ink/70 space-y-1">
            <div className="font-semibold text-ink">{pote.name} · {t('policy')} {run.policy}</div>
            <div>{t('Allowlisted venues')}: {pote.venues.map((v) => shortHash(v.target, 6, 4)).join(' · ') || '—'}</div>
            <div>{t('Exit')}: {pote.cooldownSeconds ? `${Math.round(pote.cooldownSeconds / 3600)} h ${t('cooldown')}` : t('immediate')} · {t('buffer floor')} {(pote.bufferFloorBps / 100).toFixed(0)}% · {t('cap per venue')} {(pote.maxVenueBps / 100).toFixed(0)}%</div>
            <div className="text-ink/50">{t('The exchange can move your capital between these venues only. It cannot take it out; only your signature redeems your shares.')}</div>
          </div>
        ) : run.poteAddress ? (
          <p className="text-xs text-ink/50">{poteReadFailed ? t('Could not read the pote right now — you can still ask; the exchange and the pote check it.') : t('Reading the pote…')}</p>
        ) : <p className="text-xs text-ink/50">{t('The exchange has not opened its pote yet.')}</p>}
        <div className="flex items-end gap-2">
          <label className="text-xs text-ink/60">XRP<input value={workXrp} onChange={(e) => setWorkXrp(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" /></label>
          <button onClick={askToWork} disabled={busy !== null || !run.poteAddress} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{t('Put to work')}</button>
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-ink/60 cursor-pointer">
            <input type="checkbox" checked={Boolean(me.autoInvest)} onChange={toggleAutoInvest} /> {t('Auto: put every deposit to work')}
          </label>
        </div>
        <p className="text-[11px] text-ink/50">{t('Mode B: you sign nothing here — the exchange executes it from its omnibus and the shares are minted to YOUR account.')}</p>
        {myRequests.length ? (
          <ul className="text-[11px] text-ink/60 space-y-0.5">
            {myRequests.map((r) => (
              <li key={r.id} className="font-mono">
                {r.kind} · {dropsToXrp(r.drops)} XRP · <span className={r.status === 'refused' ? 'text-danger' : r.status === 'done' ? 'text-tone-success' : 'text-ink'}>{r.status}</span>
                {r.txHash ? ` · ${shortHash(r.txHash)}` : ''}{r.reason ? ` · ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* U4 exit */}
      <section data-station="U4" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><ArrowUpFromLine className="w-4 h-4" style={{ color: 'var(--muscle, #1F6F70)' }} /> {t('Take out — one Face ID')}</h3>
        <div className="flex flex-wrap gap-2">
          {exitOptions.map((o) => (
            <button
              key={o.key}
              onClick={() => { setExitTo(o.key); setExitReview(null); }}
              disabled={!o.enabled || busy !== null || pk.busy}
              title={o.reason ? t(o.reason) : undefined}
              aria-pressed={exitToShown === o.key}
              className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed ${exitToShown === o.key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
        {exitReasons.map((r) => <p key={r} className="text-[11px] text-ink/50">{t(r)}</p>)}
        {exitUnconfirmed ? (
          <UnconfirmedSignatureNotice
            rail="evm"
            chainId={14}
            unconfirmed={exitUnconfirmed}
            onClose={() => {
              setExitUnconfirmed(null);
              void demo.refreshChain();
            }}
          />
        ) : exitReview ? (
          <div data-testid="exit-review" className="rounded-xl border border-volt/30 bg-surface-2 p-3 space-y-2 text-xs">
            <div className="font-semibold text-ink">{t('Before Face ID — what this signature does')}</div>
            <p className="text-ink/80">{fillParams(t(exitReview.review.headline), exitReview.review.headlineParams)}</p>
            {exitReview.review.destinationIgnored ? (
              <p className="text-tone-warning">{t('The destination you picked is not used by this pote: with an exit window the exit is a ticket for your Face ID account, not a transfer to the XRP Ledger.')}</p>
            ) : null}
            <p className="text-ink/70">
              {exitReview.review.fee.kind === 'charged'
                ? fillParams(t('Astryum service fee: {pct}% of your shares ({shares} base shares), deducted in this same signature.'), { pct: String(exitReview.review.fee.bps / 100), shares: exitReview.review.fee.feeShares })
                : exitReview.review.fee.kind === 'none'
                  ? t('Astryum service fee: none composed in this exit.')
                  : t('Astryum service fee: the server did not return the figure — unavailable here, not zero.')}
            </p>
            {exitReview.review.mentionsRedemptionFee ? (() => {
              // The figure pote-exit-xrp/prepare returned (disclosure.redemptionFeeFxrp + bips); «could not be read — not zero» when it is null.
              const fee = exitReview.review.redemptionFee ?? { kind: 'unreadable' as const };
              const line = redemptionFeeSentence(fee);
              return (
                <p data-testid="exit-redemption-fee" className={fee.kind === 'unreadable' ? 'text-tone-warning' : 'text-ink/70'}>
                  {fillParams(t(line.text), line.params)}
                </p>
              );
            })() : null}
            {exitReview.review.disclosures.map((d, i) => (
              <div key={`${d.title}-${i}`} className="rounded-lg border border-ink/10 p-2">
                <div className="font-semibold text-ink/90">{d.title}</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-ink/70">
                  {d.lines.map((l, j) => <li key={j}>{l}</li>)}
                </ul>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={confirmExit} disabled={pk.busy || busy !== null} className="flex-1 rounded-lg bg-volt text-black font-semibold py-2.5 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy === 'exit' || pk.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanFace className="w-4 h-4" />}
                {t('Confirm with Face ID')}
              </button>
              <button onClick={() => setExitReview(null)} disabled={pk.busy || busy !== null} className="rounded-lg border border-ink/10 px-3 text-xs text-ink/60 hover:text-ink disabled:opacity-50">{t('Back')}</button>
            </div>
          </div>
        ) : (
          <button onClick={prepareExit} disabled={pk.busy || busy !== null || !run.poteAddress || (pote !== null && !poteReadFailed && shares <= BigInt(0))} className="w-full rounded-lg bg-volt text-black font-semibold py-2.5 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy === 'exit-prepare' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
            {t('Review the exit')} {pote ? `· ≈ ${fmtBase(estValue, dec)} ${pote.asset.symbol}` : ''}
          </button>
        )}
        {poteReadFailed ? (
          <p className="text-[11px] text-tone-warning">{t('Your position could not be read just now. The button stays: it reads again when you press it, and the vault only redeems the shares you hold.')}</p>
        ) : null}
        <p className="text-[11px] text-ink/50">
          {pote?.cooldownSeconds
            ? t('This pote has an exit window: your shares burn now and the amount is fixed in FXRP; you claim it into your Face ID account when the window ends. Nobody can stop that claim.')
            : t('Immediate: the vault unwinds the venues inside your transaction. To the exchange = redeem + redeemWithTag in ONE signature, tagged with your exchange tag so the return credits you.')}
        </p>
        {txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="text-xs text-volt underline inline-flex items-center gap-1">{t('See it on the explorer')} <ExternalLink className="w-3 h-3" /></a> : null}
      </section>

      {/* U5 withdraw */}
      <section data-station="U5" className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('Withdraw from the exchange to my wallet')}</h3>
        <p className="text-xs text-ink/60">{me.xrplAddress ? t('Your wallet on file') + `: ${me.xrplAddress}` : t('No wallet on file — add your XRPL address at the exchange (E3) to withdraw.')}</p>
        <button onClick={askWithdraw} disabled={!me.xrplAddress || BigInt(me.xrpOnExchangeDrops || '0') === BigInt(0)} className="rounded-full border border-ink/10 px-3 py-1.5 text-xs text-ink/70 hover:border-volt hover:text-volt disabled:opacity-50">{t('Request withdrawal')}</button>
      </section>
    </div>
  );
}

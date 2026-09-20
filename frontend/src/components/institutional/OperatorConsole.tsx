'use client';

/**
 * OperatorConsole — scenes 3 AND 4 in one surface. The director's desk:
 * venues, buffer, and the two moves the mandate allows (direct, recall).
 * Every refusal from the pre-flight is painted as a large DENIED verdict —
 * that panel IS the pitch: the operator has no door that pays capital
 * anywhere but the allowlist, and the surface proves it live.
 *
 * The console signs as the EVM DIRECTOR (via cede) — governance stays on the
 * XRPL council rail; day-to-day direction needs no ceremony.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, ShieldX } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useWalletPartner } from '../../lib/wallet/useWalletPartner';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { translateError } from '../../lib/errors/translateError';
import { signFailureAction, type UnconfirmedSignature } from '../../lib/wallet/signOutcome';
import { UnconfirmedSignatureNotice } from '../settlement/UnconfirmedSignatureNotice';
import { getPoteState, isTooManyPendingOrders, mayConfirmAnotherOrder, prepareDirect, prepareRecall, preparePoteCouncilOrder, preparePoteCreatorExit, relayCouncilOrder, sameOrderMinutesAgo, type PoteState, type Refusal, type CouncilOrderPrepared, type CreatorExitPrepared } from '../../lib/institutional/api';
import { CouncilOrderInFlightConfirm, CouncilOrderServerWarnings, ReadFailureNotice, StaleOrderLockNote, useStaleOrderLock } from '../xrpl/XamanSingleSign';
import {
  describeSeatRefusal,
  freeSeatOfRefusalResult,
  isRetryableReadFailure,
  seatReleaseSentence,
  serverDetailIfEnglish,
} from '../../lib/xaman/seatRefusal';
import { composeKindOf } from '../../lib/xrpl/singleSignVerdict';
import { fmtBase, parseAmountToBase, type PolicyCard } from '../../lib/institutional/policyCatalog';
import { ClientOnboardModal } from './ClientOnboardModal';
import { CredentialCeremonyModal } from './CredentialCeremonyModal';
import { CouncilSigningDoors } from '../legacy/CouncilMultisigFlow';

const KIND_LABEL: Record<string, string> = {
  erc4626: 'sync vault',
  compoundv2: 'money market',
  erc4626queued: 'queued (24h periods)',
};

export function OperatorConsole({ policy, showCreatorExit = false }: { policy: PolicyCard; showCreatorExit?: boolean }) {
  const { t } = useT();
  const evm = useWalletPartner();
  const settlement = useSettlement();

  const [state, setState] = useState<PoteState | null>(null);
  const [venueId, setVenueId] = useState(0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<Refusal | null>(null);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [issuingCred, setIssuingCred] = useState(false);
  // Camino consejo-XRPL: si se pone la r-address del consejo, dirigir/recuperar
  // se firma como ORDEN DE CONSEJO en Xaman (correcto sin director cedido).
  const [council, setCouncil] = useState('');
  const [pendingOrder, setPendingOrder] = useState<CouncilOrderPrepared | null>(null);
  // 409 SAME_ORDER_RECENTLY_LAUNCHED / COUNCIL_ORDER_IN_FLIGHT: composing the
  // same order again is an explicit confirm, never a silent retry.
  // it. 21 (§2.7): the same panel also carries DUPLICATE_CHECK_UNREADABLE — «we
  // could not check», which is our read failing, so it gets a retry as well as
  // the server's own «compose another order anyway».
  const [inFlight, setInFlight] = useState<{ action: 'direct' | 'recall'; detail?: string; code?: string; minutesAgo?: number | null; retryAfterSeconds?: number | null } | null>(null);
  /**
   * it.14 (R2 2.3): an order of this console reached 'stale' and its fate says a
   * sibling already went out (or could not be checked). Composing stays paused —
   * here, not only inside the signing card — until the person says they checked.
   */
  const staleLock = useStaleOrderLock();
  const [notice, setNotice] = useState('');
  // Sacar el capital génesis del creador (la PA del consejo redime sus shares).
  const [carrierXrp, setCarrierXrp] = useState('2');
  const [exitBusy, setExitBusy] = useState(false);
  const [creatorExit, setCreatorExit] = useState<CreatorExitPrepared | null>(null);
  // A director signature we could not follow: amber panel, and direct/recall
  // stay locked until a page reload — the move may already be on-chain.
  const [unconfirmed, setUnconfirmed] = useState<(UnconfirmedSignature & { chainId: number }) | null>(null);
  const [signLocked, setSignLocked] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await getPoteState(policy.poteAddress));
    } catch {
      setError(t('Could not read the pote.'));
    }
  }, [policy.poteAddress, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: 'direct' | 'recall', opts?: { confirmAnotherOrder?: boolean }) {
    // A stale order whose sibling already went out: composing again here is the
    // second movement of the same capital (it.14, R2 2.3) — BUT a recall takes
    // capital OUT, and an exit is warned, never stopped (it.16, R3 3.1). The
    // note stays on screen; the door does not close. And «Compose it again
    // anyway» composes: the confirmation IS the person's check.
    if (signLocked) return;
    if (staleLock.blocks(composeKindOf(action === 'recall' ? 'recall' : 'direct-to'), { confirmed: opts?.confirmAnotherOrder })) return;
    setDenied(null);
    setError('');
    setInFlight(null);
    setBusy(true);
    setLastAction(action);
    let handedToPartner = false;
    let signChainId = 14;
    try {
      const amountBase = parseAmountToBase(amount, state?.asset.decimals ?? 6);
      if (!amountBase) throw new Error(t('Amount must be greater than 0'));

      // Camino CONSEJO-XRPL: si hay r-address del consejo, se firma como ORDEN
      // de consejo en Xaman (correcto cuando el pote NO tiene director cedido).
      if (council.trim()) {
        if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(council.trim())) {
          throw new Error(t('The council XRPL address is not valid'));
        }
        const ord = await preparePoteCouncilOrder({
          council: council.trim(),
          action: action === 'direct' ? 'direct-to' : 'recall',
          venueId,
          amount: amountBase.toString(),
          ...(opts?.confirmAnotherOrder ? { confirmAnotherOrder: true } : {}),
        });
        if (!ord.ok) {
          if (mayConfirmAnotherOrder(ord.refusal) && !opts?.confirmAnotherOrder) {
            setInFlight({
              action,
              detail: ord.refusal.detail,
              code: ord.refusal.error,
              minutesAgo: sameOrderMinutesAgo(ord.refusal),
              retryAfterSeconds: ord.refusal.retryAfterSeconds ?? null,
            });
            return;
          }
          setDenied(ord.refusal);
          return;
        }
        setPendingOrder(ord.data);
        return;
      }

      // Camino DIRECTOR-EVM (cuando el consejo ha cedido a un director).
      if (!evm.isConnected) throw new Error(t('Connect your EVM wallet (Flare) to continue'));
      const input = { pote: policy.poteAddress, venueId, amountBase: amountBase.toString() };
      const res = action === 'direct' ? await prepareDirect(input) : await prepareRecall(input);
      if (!res.ok) {
        // THE moment of scene 4: the cage says no, on screen, verbatim.
        setDenied(res.refusal);
        return;
      }
      signChainId = res.data.calls[0]?.chainId ?? 14;
      handedToPartner = true;
      const { handle } = await evm.sendIntentCalls(
        res.data.calls.map((c) => ({ to: c.to, data: c.data, value: c.value, chainId: c.chainId }))
      );
      settlement.track(handle, { onSettled: () => void reload() });
    } catch (e) {
      // Every click prepares afresh, so 'form' and 'review' both end as the
      // message below the buttons; 'unconfirmed' locks them instead.
      const verdict = signFailureAction(e, handedToPartner, t);
      if (verdict.view === 'unconfirmed') {
        setError('');
        setUnconfirmed({ txHash: verdict.txHash, trace: verdict.trace, chainId: signChainId });
        setSignLocked(true);
      } else {
        setError(verdict.message);
      }
    } finally {
      setBusy(false);
    }
  }

  // Sacar el capital génesis del creador: solo el consejo (XRPL) puede — su PA
  // redime sus propias shares vía 0xFE. Firma el quórum del consejo en Xaman.
  async function pullGenesis(opts?: { supersede?: boolean }) {
    // it.16 (R3 3.1) — NO GUARD HERE. This is an EXIT (the council's PA redeems
    // its own shares), and an exit is never closed by a screen of ours: not by a
    // record, not by the database, not by a region and not by our own lock. The
    // stale note is rendered right above this block instead, as a warning.
    setDenied(null);
    setError('');
    setExitBusy(true);
    try {
      const councilR = council.trim();
      if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(councilR)) {
        throw new Error(t('The council XRPL address is not valid'));
      }
      const r = await preparePoteCreatorExit({
        account: councilR,
        pote: policy.poteAddress,
        amountXrpForMint: carrierXrp.trim() || '2',
        supersede: opts?.supersede === true,
      });
      if (!r.ok) {
        setDenied(r.refusal);
        return;
      }
      setCreatorExit(r.data);
    } catch (e) {
      setError(translateError(e, t).message);
    } finally {
      setExitBusy(false);
    }
  }

  if (!state) return <p className="text-xs text-ink/60">{t('Reading the pote…')}</p>;

  const dec = state.asset.decimals;
  // La firma EVM es DEL DIRECTOR: sin cesión vigente revierte con
  // NotDirectorOrCouncil (incidente 23-ago — gas quemado y horas de diagnóstico).
  // El backend ya se niega (409 NO_DIRECTOR_CEDED); aquí ni se ofrece el botón:
  // sin director, el único camino es la orden de consejo (el campo r-address).
  const directorSeated =
    state.governance.director !== '0x0000000000000000000000000000000000000000' &&
    state.governance.directorUntil > Math.floor(Date.now() / 1000);
  const evmPathDead = !council.trim() && !directorSeated;
  /**
   * it.14 (R5 1.6) — WHAT A TAKEN SEAT MEANS, CASE BY CASE.
   *
   * «Retry, freeing the seat» asks the server to DISPLACE the draft on the seat.
   * It was offered for every `NONCE_SEAT_TAKEN`, including the seats held by a
   * payment already SIGNED (a twin doomed to InvalidNonce, carrier lost) and by
   * drafts of another member or older than the deploy, where the server refuses
   * the displacement and the button simply loops. One reader decides now, and
   * it is shared with the exit screens (lib/xaman/seatRefusal).
   */
  const seat = describeSeatRefusal(denied, t);
  const queueFull = isTooManyPendingOrders(denied);

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setIssuingCred(true)}
          className="rounded-lg border border-authority/40 text-xs font-semibold px-3 py-1.5"
          style={{ color: 'var(--authority, #A76A15)' }}
        >
          {t('Issue credential (KYC)')}
        </button>
        <button
          onClick={() => setOnboarding(true)}
          className="rounded-lg border border-authority/40 text-xs font-semibold px-3 py-1.5"
          style={{ color: 'var(--authority, #A76A15)' }}
        >
          {t('Onboard a client (custodial)')}
        </button>
      </div>
      {issuingCred ? <CredentialCeremonyModal onClose={() => setIssuingCred(false)} /> : null}
      {onboarding ? (
        <ClientOnboardModal policy={policy} onClose={() => setOnboarding(false)} onChanged={() => void reload()} />
      ) : null}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-ink/10 bg-surface-2 p-2">
          <div className="text-ink/50">{t('Total assets')}</div>
          <div className="font-mono text-ink">{fmtBase(state.totalAssets, dec)} {state.asset.symbol}</div>
        </div>
        <div className="rounded-lg border border-ink/10 bg-surface-2 p-2">
          <div className="text-ink/50">{t('Free buffer')}</div>
          <div className="font-mono text-ink">{fmtBase(state.freeBalance, dec)}</div>
        </div>
        <div className="rounded-lg border border-ink/10 bg-surface-2 p-2">
          <div className="text-ink/50">{t('Buffer floor')}</div>
          <div className="font-mono text-ink">{state.bufferFloorBps / 100}%</div>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink/50 text-left">
            <th className="py-1">#</th>
            <th>{t('Venue')}</th>
            <th className="text-right">{t('Working')}</th>
            <th className="text-right">{t('Queued out')}</th>
          </tr>
        </thead>
        <tbody>
          {state.venues.map((v) => (
            <tr key={v.id} className="border-t border-ink/5 text-ink">
              <td className="py-1">{v.id}</td>
              <td>
                <span className="font-mono">{v.target.slice(0, 8)}…</span>{' '}
                <span className="text-ink/50">{t(KIND_LABEL[v.kind] ?? v.kind)}</span>
              </td>
              <td className="text-right font-mono">{fmtBase(v.value, dec)}</td>
              <td className="text-right font-mono">{fmtBase(v.queuedTotal, dec)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingOrder ? (
        <div className="rounded-2xl border border-ink/10 bg-surface-1 p-4 space-y-3">
          <p className="text-xs text-ink/70">{pendingOrder.order.summary}</p>
          {pendingOrder.disclosure.note && <p className="text-[11px] text-ink/50">{pendingOrder.disclosure.note}</p>}
          <CouncilOrderServerWarnings
            recoveryWarning={pendingOrder.recoveryWarning}
            inFlightWarning={pendingOrder.inFlightWarning}
            duplicateWarning={pendingOrder.duplicateWarning}
          />
          <CouncilSigningDoors
            xrplTx={pendingOrder.xrplTx as never}
            account={pendingOrder.account}
            // The recall's exit pass: without it this console's exits took the
            // general door and answered 451 whenever the server could not
            // classify the order (it.14, R3 3.1) — an exit closed by a record.
            exitToken={pendingOrder.exitToken}
            onStaleFate={staleLock.report}
            onSettled={(hash: string) => {
              // El paso que faltaba: tras firmar en XRPL, DISPARAR el relay que
              // paga la prueba FDC y ejecuta bridge.execute en Flare. Sin esto la
              // orden se firma pero nunca mueve capital (bug del direct a Kinetic).
              const orderData = pendingOrder.order.orderData;
              setError('');
              setNotice(t('Signed. Executing on Flare now — the FDC proof takes ~2-5 min; the capital appears in the venue shortly.'));
              void relayCouncilOrder(hash, orderData).then((r) => {
                if (!r.ok) {
                  setNotice('');
                  setError(
                    t('Signed, but the relay did not start') + (r.detail ? ` — ${r.detail}` : ''),
                  );
                }
              });
              setPendingOrder(null);
              void reload();
            }}
            defaultTitle={t('Sign the council order')}
          />
          <button onClick={() => setPendingOrder(null)} className="text-xs text-ink/50 hover:text-ink">
            {t('Back')}
          </button>
        </div>
      ) : null}

      <label className="block text-xs text-ink/60">
        {t('Council XRPL address — sign via council (leave empty to use the ceded EVM director)')}
        <input
          value={council}
          onChange={(e) => setCouncil(e.target.value)}
          placeholder="r… (opcional)"
          className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-1.5 text-sm text-ink font-mono"
        />
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink/60">
          {t('Venue')}
          <select
            value={venueId}
            onChange={(e) => setVenueId(Number(e.target.value))}
            className="mt-1 block rounded-lg bg-surface-2 border border-ink/10 px-2 py-1.5 text-sm text-ink"
          >
            {state.venues.map((v) => (
              <option key={v.id} value={v.id}>#{v.id}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink/60 flex-1 min-w-[8rem]">
          {t('Amount')} ({state.asset.symbol})
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          onClick={() => run('direct')}
          disabled={busy || evmPathDead || signLocked || staleLock.blocks('other')}
          className="rounded-lg bg-volt text-black text-xs font-semibold px-3 py-2 disabled:opacity-50"
        >
          {busy && lastAction === 'direct' ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Direct to venue')}
        </button>
        {/* it.16 (R3 3.1): a recall takes capital OUT — the stale lock warns
            below this row, it does not close this door. */}
        <button
          onClick={() => run('recall')}
          disabled={busy || evmPathDead || signLocked}
          className="rounded-lg bg-surface-2 border border-ink/10 text-xs font-semibold px-3 py-2 text-ink disabled:opacity-50"
        >
          {busy && lastAction === 'recall' ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Recall to buffer')}
        </button>
      </div>
      {evmPathDead ? (
        <p className="text-[11px] text-ink/50">
          {t('This pote has no ceded director, so an EVM signature would be refused by the contract. Fill in the council XRPL address above — directing capital is then a council order, signed in Xaman.')}
        </p>
      ) : null}

      {/* it. 21 (§3.5): ACCOUNT_BUSY / PROOF_STORE_UNREADABLE are a wait with a
          button, not a verdict — and `run` re-runs exactly what failed. */}
      <ReadFailureNotice
        refusal={denied}
        busy={busy}
        onRetry={() => void run(lastAction === 'recall' ? 'recall' : 'direct')}
      />

      {inFlight ? (
        <CouncilOrderInFlightConfirm
          detail={inFlight.detail}
          code={inFlight.code}
          minutesAgo={inFlight.minutesAgo}
          retryAfterSeconds={inFlight.retryAfterSeconds}
          busy={busy}
          onConfirm={() => void run(inFlight.action, { confirmAnotherOrder: true })}
          onRetry={() => void run(inFlight.action)}
          onDismiss={() => setInFlight(null)}
        />
      ) : null}

      <StaleOrderLockNote lock={staleLock.lock} onRelease={staleLock.release} pausing={staleLock.pausing} />

      {/* A seat refusal is NOT the cage saying no (it.14, R5 1.6): it is an
          earlier 0xFE of this account holding the nonce. It says which of the
          four cases it is, and only the displaceable one offers the retry. */}
      {seat ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3" role="alert">
          <p className="text-[12px] font-medium text-tone-warning">{seat.text}</p>
          {/* it.16 (R5 5.4): the server writes some of these `detail`s in
              Spanish, and this app is in English — a paragraph the reader cannot
              read is the same failure as a raw code. Only a plainly English
              detail is quoted. */}
          {serverDetailIfEnglish(denied?.detail) ? (
            <p className="mt-1 text-[11px] leading-relaxed text-ink/55">{serverDetailIfEnglish(denied?.detail)}</p>
          ) : null}
          {/* And when the server named the 0xFE holding the seat (it only does
              that for the session that prepared it or that proves the account),
              the person frees their OWN seat instead of waiting out its window. */}
          {seat.mayFreeSeat ? (
            <button
              type="button"
              onClick={() => {
                setError('');
                // it. 19 (R5 R4): the answer is READ, not reduced to a boolean.
                // A 200 `{released:false}` used to count as «freed» — so a
                // payment already signed was announced as released — and a 409
                // («it can still be signed») as a failure. Four answers, four
                // sentences; only «freed» clears the refusal from the screen.
                void freeSeatOfRefusalResult(denied).then((outcome) => {
                  const said = seatReleaseSentence(outcome, t);
                  if (outcome.kind === 'freed') {
                    setDenied(null);
                    setNotice(said ?? '');
                  } else if (said) {
                    setError(said);
                  }
                });
              }}
              className="mt-2 rounded-md border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-tone-warning"
            >
              {t('Free the seat')}
            </button>
          ) : null}
        </div>
      ) : null}
      {queueFull ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3" role="alert">
          <p className="text-[12px] font-medium text-tone-warning">
            {t('This council already has too many live orders, so the server did not compose another one. Settle or let the pending ones age out first — this is a queue of ours, not a refusal of the cage.')}
          </p>
          {serverDetailIfEnglish(denied?.detail) ? (
            <p className="mt-1 text-[11px] leading-relaxed text-ink/55">{serverDetailIfEnglish(denied?.detail)}</p>
          ) : null}
        </div>
      ) : null}

      {/* it. 21 (§3.5): a 503 of OURS is not «the cage refused this order». The
          block above says what happened and offers the retry; this verdict must
          not also fire, or the person reads an accusation of the contract for a
          database blip. */}
      {denied && !seat && !queueFull && !isRetryableReadFailure(denied) ? (
        <div className="rounded-xl border-2 border-danger bg-danger/10 p-4" role="alert">
          <div className="flex items-center gap-2 text-danger font-bold text-sm">
            <ShieldX className="w-5 h-5" />
            {/* it. 19: the bare slug used to be the headline (`DENIED — CAP_EXCEEDED`),
                and the Spanish `detail` sat under it on an English screen. A code
                is not a sentence: the cage's own refusal follows below, and only
                a detail written in this screen's language is quoted. */}
            {t('DENIED')} — {t('the cage refused this order')}
          </div>
          {serverDetailIfEnglish(denied.detail) ? (
            <p className="mt-1 text-xs text-ink/80">{serverDetailIfEnglish(denied.detail)}</p>
          ) : null}
          <p className="mt-2 text-xs text-ink/60">
            {t('The mandate only moves capital between listed venues, above the buffer floor, under the cap. There is no other door — that is the product.')}
          </p>
        </div>
      ) : null}
      {error && <p className="text-xs text-danger">{error}</p>}
      {notice && <p className="text-xs text-volt">{notice}</p>}
      {unconfirmed ? (
        <UnconfirmedSignatureNotice
          rail="evm"
          chainId={unconfirmed.chainId}
          unconfirmed={unconfirmed}
          onClose={() => {
            setUnconfirmed(null);
            void reload();
          }}
        />
      ) : null}
      {signLocked && !unconfirmed ? (
        <p className="text-[11px] text-ink/50">
          {t('A previous signature could not be confirmed, so direct and recall are paused on this screen. Check the pote and the explorer first — reload the page to use them again.')}
        </p>
      ) : null}

      {/* Sacar el capital GÉNESIS del creador — solo el consejo (multisig XRPL).
          Herramienta de operador: oculta por defecto (fuera de la demo del cliente);
          se enciende con showCreatorExit. El código queda intacto. */}
      {showCreatorExit ? (
      <div className="rounded-2xl border border-authority/30 bg-surface-1 p-4 space-y-3">
        <div className="text-xs font-semibold" style={{ color: 'var(--authority, #A76A15)' }}>
          {t('Withdraw the creator’s genesis capital')}
        </div>
        <p className="text-[11px] text-ink/60">
          {t('The genesis (the seed the council deposited at birth) lives in the council’s Personal Account and only the council can move it: its PA redeems its own shares via one 0xFE payment, signed by the council quorum in Xaman. Fill the council XRPL address above.')}
        </p>
        {creatorExit ? (
          <div className="space-y-3">
            <p className="text-xs text-ink/70">{creatorExit.order.summary}</p>
            {creatorExit.disclosure.note && <p className="text-[11px] text-ink/50">{creatorExit.disclosure.note}</p>}
            <CouncilSigningDoors
              xrplTx={creatorExit.xrplTx as never}
              account={creatorExit.account}
              // The creator exit is an EXIT too: its pass travels, so the quorum
              // is never told «not available for your region» about a withdrawal.
              exitToken={creatorExit.exitToken}
              onStaleFate={staleLock.report}
              onSettled={() => {
                setCreatorExit(null);
                void reload();
              }}
              defaultTitle={t('Sign the council order')}
            />
            <button onClick={() => setCreatorExit(null)} className="text-xs text-ink/50 hover:text-ink">
              {t('Back')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-ink/60">
              {t('Mint carrier (XRP)')}
              <input
                value={carrierXrp}
                onChange={(e) => setCarrierXrp(e.target.value)}
                inputMode="decimal"
                placeholder="2"
                className="mt-1 block w-24 rounded-lg bg-surface-2 border border-ink/10 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              onClick={() => void pullGenesis()}
              disabled={exitBusy}
              className="rounded-lg border border-authority/40 text-xs font-semibold px-3 py-2 disabled:opacity-50"
              style={{ color: 'var(--authority, #A76A15)' }}
            >
              {exitBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Withdraw genesis to the creator')}
            </button>
            {/* ONLY the displaceable case (it.14, R5 1.6). A signed or reported
                seat must be waited out, and an unreadable ledger is not a «no». */}
            {seat?.mayRetryFreeingSeat ? (
              <button
                onClick={() => void pullGenesis({ supersede: true })}
                disabled={exitBusy}
                className="rounded-lg border border-danger/40 text-xs font-semibold px-3 py-2 text-danger disabled:opacity-50"
                title={t('Only if the previous 0xFE payment on this seat was never signed')}
              >
                {t('Retry, freeing the seat')}
              </button>
            ) : null}
          </div>
        )}
      </div>
      ) : null}

      <p className="text-[11px] text-ink/40">
        {t('Director')}: <span className="font-mono">{state.governance.director.slice(0, 10)}…</span>{' '}
        · {t('mandate expires')} {new Date(state.governance.directorUntil * 1000).toLocaleDateString()}
        {' · '}{t('constitution')} <span className="font-mono">{state.governance.constitutionRef.slice(0, 10)}…</span>
      </p>
    </div>
  );
}

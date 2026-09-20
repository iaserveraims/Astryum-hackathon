'use client';

/**
 * DeskRequestQueue — lo que tus clientes PIDIERON, firmado por el omnibus con un
 * QR de Xaman.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { Card, Pill, PrimaryButton } from '../../ui/primitives';
import { useT } from '../../../i18n/LanguageProvider';
import type { DemoRunApi } from '../../../lib/demo-exchange/useDemoRun';
import {
  demoApi,
  describeDeskRefusal,
  describeRefusal,
  dropsToXrp,
  shortHash,
  type ClientRequest,
  type DemoClient,
  type DemoRun,
  type DeskPayment,
  type DeskPutToWorkHandoff,
} from '../../../lib/demo-exchange/api';
import { dropsToXrpAmount, pendingDeskWork, servability, type Servability } from '../../../lib/demo-exchange/deskQueue';
import { notifyHandoffSigned } from '../../../lib/wallet/handoffRelease';
import { OmnibusSignDoor } from '../OmnibusSignDoor';

export { pendingDeskWork };

type Serving =
  | { kind: 'withdraw'; client: DemoClient; drops: string; deskPaymentId: string; xrplTx: Record<string, unknown>; payloadExpiryMin?: number }
  | { kind: 'put-to-work'; client: DemoClient; drops: string; deskPaymentId: string; handoff: DeskPutToWorkHandoff };

function whyNot(s: Servability, t: (x: string) => string): string {
  if (s.ok) return '';
  switch (s.why) {
    case 'desk-payment-open': return t('A payment of this client is already in flight — it settles first.');
    case 'withdraw-first': return t('This client also asked for a withdrawal: serve that one first — a withdrawal always goes ahead.');
    case 'no-wallet': return t('This client has no withdrawal wallet on file yet.');
    case 'no-passkey': return t('This client has no Flare account yet (they create it with their passkey).');
    case 'no-pote': return t('Your pote is not open yet.');
    default: return t('This request belongs to a client that is no longer on file — reload.');
  }
}

export function DeskRequestQueue({ demo, run, onBlockedChange }: { demo: DemoRunApi; run: DemoRun; onBlockedChange?: (blocked: boolean) => void }) {
  const { t } = useT();
  const [serving, setServing] = useState<Serving | null>(null);
  const [signBlocked, setSignBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** A validated 0xFE whose record was refused (a lagging node): record it again with this hash. */
  const [recordRetry, setRecordRetry] = useState<{ deskPaymentId: string; clientId: string; drops: string; hash: string } | null>(null);

  // Con un QR en pantalla (o una firma en Xaman) la consola no cambia de pestaña.
  useEffect(() => { onBlockedChange?.(Boolean(serving) || signBlocked); }, [serving, signBlocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange?.(false), [onBlockedChange]);

  // Lo mismo que la mesa por estaciones (ExchangeDesk, heldRef): una reserva cuyo
  // QR NUNCA llegó a Xaman se suelta si esta pantalla se va (recargar, otra
  // ruta). Una que ya salió a Xaman se queda reservada: la decide el ledger.
  const heldRef = useRef<{ runId: string; deskPaymentId?: string; handedOff: boolean }>({ runId: run.runId, handedOff: false });
  heldRef.current = { runId: run.runId, deskPaymentId: serving?.deskPaymentId, handedOff: signBlocked };
  useEffect(() => () => {
    const h = heldRef.current;
    if (h.deskPaymentId && !h.handedOff) void demoApi.releaseDeskPayment(h.runId, h.deskPaymentId).catch(() => undefined);
  }, []);

  const queue = (run.requests ?? []).filter((q) => q.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const inFlight = (run.deskPayments ?? []).filter((p) => (p.status === 'prepared' || p.status === 'signed') && p.id !== serving?.deskPaymentId);
  const clientOf = (id: string) => run.clients.find((c) => c.id === id);

  async function release(deskPaymentId: string): Promise<string | null> {
    try {
      const r = await demoApi.releaseDeskPayment(run.runId, deskPaymentId);
      if (r.ok) { demo.setRun(r.data.run); return null; }
      void demo.reload();
      return describeDeskRefusal(r.refusal, t);
    } catch (e) {
      void demo.reload();
      return e instanceof Error ? e.message : String(e);
    }
  }

  async function serve(q: ClientRequest) {
    setError('');
    setNotice('');
    const client = clientOf(q.clientId);
    const s = servability(run, q);
    if (!client || !s.ok) return setError(whyNot(s, t));
    const amountXrp = dropsToXrpAmount(q.drops);
    const lost = (reason: string) =>
      t('The request was taken from the queue, but its payment could not be composed: {reason}. Nothing was signed and the client\'s XRP is free again — they can ask again.').replace('{reason}', reason);
    setBusy(q.id);
    try {
      // 1 · la mesa toma la petición (libera la reserva que impedía componer su pago).
      const taken = await demoApi.takeRequest(run.runId, client.id, q.id);
      if (!taken.ok) throw new Error(describeRefusal(taken.refusal, t));
      demo.setRun(taken.data.run);
      // 2 · el pago de la mesa, por el importe que pidió el cliente.
      if (q.kind === 'withdraw') {
        const res = await demoApi.withdrawPrepare(run.runId, client.id, amountXrp);
        if (!res.ok) throw new Error(lost(describeRefusal(res.refusal, t)));
        setServing({ kind: 'withdraw', client, drops: q.drops, deskPaymentId: res.data.deskPayment.id, xrplTx: res.data.xrplTx, payloadExpiryMin: res.data.payloadExpiryMin });
        void demo.reload();
      } else {
        const reserve = await demoApi.reserveDeskPayment(run.runId, { clientId: client.id, kind: 'put-to-work', amountXrp });
        if (!reserve.ok) throw new Error(lost(describeRefusal(reserve.refusal, t)));
        demo.setRun(reserve.data.run);
        const deskPaymentId = reserve.data.deskPayment.id;
        let res: Awaited<ReturnType<typeof demoApi.preparePutToWork>>;
        try {
          res = await demoApi.preparePutToWork(run.runId, deskPaymentId);
        } catch (e) {
          const refused = await release(deskPaymentId);
          throw new Error([lost(e instanceof Error ? e.message : String(e)), refused ? t('The reservation could not be released and stays in flight: {reason}').replace('{reason}', refused) : ''].filter(Boolean).join(' — '));
        }
        if (!res.ok) {
          const refused = await release(deskPaymentId);
          throw new Error([lost(describeRefusal(res.refusal, t)), refused ? t('The reservation could not be released and stays in flight: {reason}').replace('{reason}', refused) : ''].filter(Boolean).join(' — '));
        }
        demo.setRun(res.data.run);
        setServing({ kind: 'put-to-work', client, drops: q.drops, deskPaymentId, handoff: res.data.handoff });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSigned(hash: string) {
    const p = serving;
    setServing(null);
    if (!p) return;
    // . Lo que
    // se firmó y validó NO es un error de nadie: el servidor lo concilia solo
    // contra el ledger (el vigía liquida el payout; el barrido del backend
    // registra por prueba el 0xFE de una reserva pasada su ventana). Así que
    // aquí no hay rojo: se reintenta en silencio lo que es «el nodo aún no lo
    // ve» y, si no entra, se dice en tono neutro que se registra solo.
    if (p.kind === 'withdraw') {
      setNotice(t('Payout signed by the omnibus ({hash}). The client is debited when the payment validates — this panel reads the omnibus on its own.').replace('{hash}', shortHash(hash)));
      try {
        const r = await demoApi.reportDeskPaymentSigned(run.runId, p.deskPaymentId, hash);
        if (r.ok) demo.setRun(r.data.run);
      } catch {
        /* the omnibus mirror settles it from the ledger anyway */
      }
      window.setTimeout(() => void demo.scanOmnibus(), 6000);
      return;
    }
    notifyHandoffSigned(p.handoff.memoHex, hash);
    setNotice(t('Signed by the omnibus ({hash}). Recording it against the ledger…').replace('{hash}', shortHash(hash)));
    const note = t('The client asked; the exchange signed it from its omnibus with a QR. The shares are minted to the client account.');
    let recorded = false;
    // A lagging node answers «not visible yet» (retryable): a few quiet tries.
    for (let i = 0; i < 6 && !recorded; i++) {
      if (i > 0) await new Promise((ok) => window.setTimeout(ok, 5000));
      try {
        const r = await demoApi.recordPutToWork(run.runId, { clientId: p.client.id, drops: p.drops, txHash: hash, deskPaymentId: p.deskPaymentId, note });
        if (r.ok) {
          demo.setRun(r.data.run);
          recorded = true;
        } else if (!r.refusal.retryable) {
          break;
        }
      } catch {
        /* network blink: try again */
      }
    }
    if (recorded) {
      setNotice(t('Signed by the omnibus. The executor mints XRP → FXRP and deposits into the pote with the client as receiver (~2–5 min).'));
    } else {
      // Kept as a quiet link, never as an error. Where the backend loop runs it
      // also records it by proof once its window passes (sweepDeskPutToWorkPastLls);
      // the sentence does not promise that, because the loop is an env switch.
      setRecordRetry({ deskPaymentId: p.deskPaymentId, clientId: p.client.id, drops: p.drops, hash });
      setNotice(t('Signed and validated ({hash}); the mint lands in the pote in ~2–5 min. Its record is still catching up with the ledger — if it has not settled in a few minutes, use «Record again» below. The client is debited once.').replace('{hash}', shortHash(hash)));
    }
    window.setTimeout(() => void demo.refreshChain(), 8000);
  }

  async function recordAgain() {
    const rr = recordRetry;
    if (!rr) return;
    setError('');
    setBusy(`record:${rr.deskPaymentId}`);
    try {
      const r = await demoApi.recordPutToWork(run.runId, { clientId: rr.clientId, drops: rr.drops, txHash: rr.hash, deskPaymentId: rr.deskPaymentId, note: t('The client asked; the exchange signed it from its omnibus with a QR. The shares are minted to the client account.') });
      if (!r.ok) {
        // «The node does not see it yet» is weather, not an error: say so quietly.
        if (r.refusal.retryable) {
          setNotice(t('The ledger node the exchange reads does not show it validated yet — nothing is lost; try «Record again» in a moment.'));
          return;
        }
        setRecordRetry(null);
        throw new Error(describeDeskRefusal(r.refusal, t));
      }
      setRecordRetry(null);
      demo.setRun(r.data.run);
      setNotice(t('Recorded: the 0xFE {hash} is verified on the ledger and the client was debited once.').replace('{hash}', shortHash(rr.hash)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Back BEFORE the QR went to Xaman: nothing was signed, the reservation is released. */
  async function back() {
    const p = serving;
    setServing(null);
    if (!p) return;
    const refused = await release(p.deskPaymentId);
    if (refused) setError(t('The reservation could not be released and stays in flight: {reason}').replace('{reason}', refused));
    else setNotice(t('Nothing was signed. The request was already taken from the queue: the client\'s XRP is free again and they can ask again.'));
  }

  /** A reservation this screen no longer holds (a reload): the server frees it only once its payload can no longer be signed. */
  async function freeOrphan(p: DeskPayment) {
    setError('');
    setBusy(`free:${p.id}`);
    const refused = await release(p.id);
    setBusy(null);
    if (refused) setError(t('The reservation could not be released and stays in flight: {reason}').replace('{reason}', refused));
  }

  const pendingCount = pendingDeskWork(run);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Client requests')}</h2>
        {pendingCount ? <Pill tone="warning" size="sm">{pendingCount}</Pill> : null}
        <button type="button" onClick={() => void demo.scanOmnibus()} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink/45 hover:text-ink"><RefreshCw className="h-3 w-3" /> {t('Read the omnibus')}</button>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink/45">{t('What your clients ask, for the amount they asked. Each one is signed by your omnibus with a QR in Xaman — nothing moves until you sign it.')}</p>

      {notice ? <p className="mt-3 rounded-xl border border-volt/30 bg-volt/[0.05] p-3 text-[12.5px] text-ink/80">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-xl border border-tone-warning/30 bg-tone-warning/[0.06] p-3 text-[12.5px] text-tone-warning">{error}</p> : null}
      {recordRetry ? (
        <button type="button" onClick={() => void recordAgain()} disabled={busy !== null} className="mt-2 text-[11.5px] text-ink/45 underline hover:text-ink disabled:opacity-40">
          {busy === `record:${recordRetry.deskPaymentId}` ? '…' : t('Record again ({hash})').replace('{hash}', shortHash(recordRetry.hash))}
        </button>
      ) : null}

      {serving ? (
        <div className="mt-4 space-y-2 rounded-xl border border-volt/25 bg-volt/[0.03] p-4" data-testid="desk-serving">
          <p className="text-[13px] text-ink">
            {serving.kind === 'withdraw'
              ? t('Pay {xrp} XRP to {name}\'s own wallet').replace('{xrp}', dropsToXrp(serving.drops)).replace('{name}', serving.client.label)
              : t('Put {xrp} XRP of {name} to work in the pote').replace('{xrp}', dropsToXrp(serving.drops)).replace('{name}', serving.client.label)}
          </p>
          {serving.kind === 'put-to-work' && serving.handoff.disclosure?.lines?.length ? (
            <ul className="space-y-0.5 text-[11.5px] text-ink/55">
              {serving.handoff.disclosure.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          ) : null}
          <OmnibusSignDoor
            xrplTx={serving.kind === 'withdraw' ? serving.xrplTx : (serving.handoff.xrplPayment as unknown as Record<string, unknown>)}
            account={run.omnibusAddress}
            title={serving.kind === 'withdraw' ? t('Pay the client out') : t('Put the client capital to work')}
            onSettled={(h) => void onSigned(h)}
            onBlockedChange={setSignBlocked}
            alreadyHandedOff={signBlocked}
            payloadExpiryMin={serving.kind === 'withdraw' ? serving.payloadExpiryMin : serving.handoff.payloadExpiryMin}
          />
          {signBlocked ? null : <button type="button" onClick={() => void back()} className="text-[12px] text-ink/50 hover:text-ink">{t('Back — nothing is signed')}</button>}
        </div>
      ) : null}

      {queue.length === 0 && inFlight.length === 0 && !serving ? (
        <p className="mt-3 text-[13px] text-ink/45">{t('No requests waiting. When a client asks to put XRP to work or to withdraw, it appears here.')}</p>
      ) : null}

      {queue.length ? (
        <ul className="mt-3 divide-y divide-ink/[0.05]" data-testid="desk-queue">
          {queue.map((q) => {
            const c = clientOf(q.clientId);
            const s = servability(run, q);
            return (
              <li key={q.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[13px] text-ink">
                      {q.kind === 'withdraw' ? <ArrowUpFromLine className="h-3.5 w-3.5 text-ink/45" /> : <ArrowDownToLine className="h-3.5 w-3.5 text-ink/45" />}
                      {c?.label ?? q.clientId} · {q.kind === 'withdraw' ? t('withdrawal') : t('into the vault')}
                    </p>
                    <p className="text-[12px] text-ink/45"><span className="font-mono">{dropsToXrp(q.drops)} XRP</span> · {t('tag')} {c?.tag ?? '—'} · {new Date(q.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <PrimaryButton onClick={() => void serve(q)} disabled={busy !== null || Boolean(serving) || !s.ok} className="shrink-0 px-3 py-1.5 text-[12.5px]">
                    {busy === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />} {t('Sign with QR')}
                  </PrimaryButton>
                </div>
                {!s.ok ? <p className="mt-1 text-[11.5px] text-ink/45">{whyNot(s, t)}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {inFlight.length ? (
        <div className="mt-4 space-y-1.5 border-t border-ink/[0.06] pt-3 text-[12px]">
          <p className="text-ink/55">{t('In flight — signed or waiting for a signature:')}</p>
          <ul className="space-y-1">
            {inFlight.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-ink/70">
                <span className="font-mono">{clientOf(p.clientId)?.label ?? p.clientId} · {p.kind === 'withdraw' ? t('withdrawal') : t('into the vault')} · {dropsToXrp(p.drops)} XRP · {p.status}{p.txHash ? ` · ${shortHash(p.txHash)}` : ''}</span>
                {p.status === 'signed' ? (
                  <button type="button" onClick={() => void demo.scanOmnibus()} className="underline hover:text-ink">{t('validated — read the omnibus to settle it')}</button>
                ) : (
                  <button type="button" onClick={() => void freeOrphan(p)} disabled={busy !== null} className="underline hover:text-ink disabled:opacity-40">
                    {busy === `free:${p.id}` ? '…' : t('Free the seat (once its payload can no longer be signed)')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export default DeskRequestQueue;

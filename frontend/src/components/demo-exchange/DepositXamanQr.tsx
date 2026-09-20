'use client';

/**
 * DepositXamanQr — el depósito de un cliente del exchange como QR de Xaman
 * (fundador 14-sep: «un código QR con el memo y todo para escanear y fondear»).
 *
 * Es la MISMA tx que prepara el servidor en `/deposit-instructions`: Payment al
 * omnibus, DestinationTag = tag del cliente, Amount exacto y SourceTag; Account
 * solo si el cliente tiene wallet registrada (y entonces se dice). Se firma desde
 * cualquier Xaman escaneando, o con el enlace de XamanSingleSign en el propio
 * móvil. Sin memo: el vigía del omnibus abona por DestinationTag; el memo es de
 * los pagos de la mesa.
 *
 * Dos sitios: la zona del cliente (U1, «Depositar», en ClientInner) y la mesa
 * del operador (E3, sus clientes). Con el QR vivo es una firma: el padre oye
 * `onBlockedChange` y no ofrece otra puerta al mismo depósito.
 */

import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { XamanSingleSign } from '../xrpl/XamanSingleSign';
import { demoApi, describeRefusal, shortHash, type DemoClient } from '../../lib/demo-exchange/api';

const XRP_RE = /^\d+(\.\d{1,6})?$/;

export interface DepositInstructions {
  destination: string;
  destinationTag: number;
  amountXrp: string;
  xrplTx: Record<string, unknown>;
}

/** Lo que la persona compara con la pantalla de Xaman antes de deslizar. */
export function DepositSummary({ instructions }: { instructions: DepositInstructions }) {
  const { t } = useT();
  return (
    <div className="rounded-xl bg-surface-2 p-3 font-mono space-y-1 text-xs">
      <div>{t('Destination')}: <span className="select-all">{instructions.destination}</span></div>
      <div>{t('Destination tag')}: <span className="select-all font-semibold">{instructions.destinationTag}</span></div>
      <div>{t('Amount')}: {instructions.amountXrp} XRP</div>
    </div>
  );
}

/** El QR de Xaman de ESTA tx. `onSettled` solo con tesSUCCESS validado. */
export function DepositQrSign({
  instructions,
  onSettled,
  onBlockedChange,
  onCancelled,
}: {
  instructions: DepositInstructions;
  onSettled: (hash: string) => void;
  onBlockedChange: (blocked: boolean) => void;
  onCancelled: () => void;
}) {
  const { t } = useT();
  const account = instructions.xrplTx.Account;
  return (
    <div className="space-y-2 text-xs">
      {typeof account === 'string' && (
        <p className="text-ink/60">{t('Xaman will ask for the account {address}: this deposit is prepared for it.').replace('{address}', account)}</p>
      )}
      <XamanSingleSign
        txjson={instructions.xrplTx}
        title={t('Deposit {amount} XRP · tag {tag}').replace('{amount}', instructions.amountXrp).replace('{tag}', String(instructions.destinationTag))}
        onSettled={(hash) => onSettled(hash)}
        onBlockedChange={onBlockedChange}
        onCancelled={onCancelled}
      />
    </div>
  );
}

/** La mesa del operador (E3): elegir cliente e importe → el QR que el cliente escanea. */
export function DeskDepositQr({ runId, clients, onSettled }: { runId: string; clients: DemoClient[]; onSettled: (hash: string) => void }) {
  const { t } = useT();
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [instructions, setInstructions] = useState<DepositInstructions | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const client = clients.find((c) => c.id === clientId) ?? clients[0];
  if (!client) return null;

  async function prepare() {
    setError('');
    setNotice('');
    if (!XRP_RE.test(amount) || Number(amount) <= 0) {
      setError(t('Amount must be greater than 0'));
      return;
    }
    setBusy(true);
    try {
      const r = await demoApi.depositInstructions(runId, client.id, amount);
      if (!r.ok) throw new Error(describeRefusal(r.refusal, t));
      setInstructions({ ...r.data.instructions, xrplTx: r.data.xrplTx });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/10 p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <QrCode className="w-4 h-4 text-volt" /> {t('Deposit QR for a client')}
      </div>
      <p className="text-[11px] text-ink/50">
        {t('Show it to the client: they scan it with Xaman and the XRP arrives at the omnibus with their tag.')}
      </p>
      {instructions ? (
        <>
          <div className="text-ink/70">{client.label} · tag {client.tag}</div>
          <DepositSummary instructions={instructions} />
          <DepositQrSign
            instructions={instructions}
            onSettled={(hash) => {
              setNotice(t('Deposit validated on the ledger ({hash}). The exchange credits it on its next read — a few seconds.').replace('{hash}', shortHash(hash)));
              setInstructions(null);
              setBlocked(false);
              onSettled(hash);
            }}
            onBlockedChange={setBlocked}
            onCancelled={() => {
              setInstructions(null);
              setBlocked(false);
            }}
          />
          {!blocked && (
            <button onClick={() => setInstructions(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {clients.length > 1 ? (
            <label className="text-ink/60">
              {t('Client')}
              <select value={client.id} onChange={(e) => setClientId(e.target.value)} className="mt-1 block rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-xs text-ink">
                {clients.map((c) => <option key={c.id} value={c.id}>{c.label} · tag {c.tag}</option>)}
              </select>
            </label>
          ) : (
            <div className="pb-2 text-ink/70">{client.label} · tag {client.tag}</div>
          )}
          <label className="text-ink/60">
            XRP
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 block w-32 rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
          </label>
          <button onClick={() => void prepare()} disabled={busy} className="rounded-full bg-volt px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50 inline-flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5" /> {busy ? '…' : t('Show deposit QR')}
          </button>
        </div>
      )}
      {error ? <p className="text-danger">{error}</p> : null}
      {notice ? <p className="text-tone-success">{notice}</p> : null}
    </div>
  );
}

'use client';

/**
 * XrpFundCard — la entrada ATÓMICA (paso 6): el XRP del user va directo al pote
 * en UN pago XRPL. El executor 0xFE lo mintea a FXRP y lo deposita en el pote
 * con `receiver` = la cuenta Flare del user, todo en la misma transacción. Si
 * el pote tiene puerta KYC, el receiver debe estar aprobado (se avisa antes de
 * firmar). Reutiliza el flujo de firma XRPL del consejo (vale también single-sig).
 */

import { useState } from 'react';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { CouncilSigningDoors } from '../legacy/CouncilMultisigFlow';
import { preparePoteFundXrp, type XrpFundHandoff } from '../../lib/institutional/api';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function XrpFundCard({ poteAddress }: { poteAddress?: string }) {
  const { t } = useT();
  const [account, setAccount] = useState('');
  const [pote, setPote] = useState(poteAddress ?? '');
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<XrpFundHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function prepare() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      if (!XRPL_RE.test(account.trim())) throw new Error(t('The funding XRPL address is not valid'));
      if (!EVM_RE.test(pote.trim())) throw new Error(t('The pote address is not valid'));
      if (!EVM_RE.test(receiver.trim())) throw new Error(t('The user Flare account is not valid'));
      const res = await preparePoteFundXrp({ account: account.trim(), pote: pote.trim(), amountXrp: amount.trim(), receiver: receiver.trim() });
      if (!res.ok) {
        setError(`${res.refusal.error}${res.refusal.detail ? ` — ${res.refusal.detail}` : ''}`);
        return;
      }
      setPending(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-3">
        <div className="rounded-lg border border-ink/10 bg-surface-2 p-3 space-y-1">
          <div className="text-xs font-semibold text-ink">{pending.disclosure.title}</div>
          {pending.disclosure.lines.map((l) => (
            <p key={l} className="text-xs text-ink/70">{l}</p>
          ))}
        </div>
        <CouncilSigningDoors
          xrplTx={pending.xrplPayment as never}
          account={pending.account}
          onSettled={() => {
            setPending(null);
            setNote(t('Signed. The executor is minting your XRP and depositing it into the pote — usually 2–5 minutes.'));
            setAmount('');
          }}
          defaultTitle={t('Fund the pote with XRP')}
        />
        <button onClick={() => setPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-volt" />
        <h3 className="text-sm font-semibold text-ink">{t('Fund the pote with XRP (atomic)')}</h3>
      </div>
      <p className="text-xs text-ink/50">
        {t('One XRPL payment: the user\'s XRP is minted to FXRP and deposited into the pote in the same transaction. The shares go to the user\'s Flare account.')}
      </p>
      {note && <p className="text-xs text-volt">{note}</p>}
      <label className="block text-xs text-ink/60">
        {t('Funding XRPL address (signs)')}
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      <label className="block text-xs text-ink/60">
        {t('Pote address')}
        <input value={pote} onChange={(e) => setPote(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      <label className="block text-xs text-ink/60">
        {t('User Flare account (receives the shares)')}
        <input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="0x…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      <label className="block text-xs text-ink/60">
        {t('Amount (XRP)')}
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button onClick={prepare} disabled={busy || !account.trim() || !amount.trim()} className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
        {t('Compose the atomic funding')}
      </button>
    </div>
  );
}

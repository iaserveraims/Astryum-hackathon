'use client';

/**
 * PoteBirthCard — la escena 1: el consejo XRPL crea su pote (vault) en Flare
 * con UNA firma. Repetible: cada dirección de consejo distinta nace un pote
 * distinto (Z8) → sirve para grabar varias tomas. Reutiliza el flujo de firma
 * del consejo (CouncilSigningDoors, el mismo del nacimiento del cage Legacy).
 *
 * Astryum no firma; la wallet-consejo XRPL despliega y controla el contrato.
 */

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { CouncilSigningDoors } from '../legacy/CouncilMultisigFlow';
import { preparePoteCreate, type PoteBirthHandoff } from '../../lib/institutional/api';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function PoteBirthCard({ onBorn }: { onBorn?: (vault: string) => void }) {
  const { t } = useT();
  const [council, setCouncil] = useState('');
  const [amount, setAmount] = useState('');
  const [which, setWhich] = useState<'A' | 'B'>('A');
  const [pending, setPending] = useState<PoteBirthHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bornNote, setBornNote] = useState('');

  async function prepare() {
    setBusy(true);
    setError('');
    setBornNote('');
    try {
      if (!XRPL_RE.test(council.trim())) throw new Error(t('The council XRPL address is not valid'));
      const res = await preparePoteCreate({ account: council.trim(), amountXrp: amount.trim(), which });
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

  function onSettled() {
    const vault = pending?.predicted.vault ?? '';
    setPending(null);
    setBornNote(
      t('Signed. The executor is minting the XRP and running the birth — the vault is usually live on Flare in about 2–5 minutes.')
    );
    if (vault) onBorn?.(vault);
    // Deja el formulario listo para la siguiente toma (otra dirección).
    setCouncil('');
    setAmount('');
  }

  if (pending) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-3">
        <div className="rounded-lg border border-ink/10 bg-surface-2 p-3 space-y-1">
          <div className="text-xs font-semibold text-ink">{pending.disclosure.title}</div>
          {pending.disclosure.lines.map((l) => (
            <p key={l} className="text-xs text-ink/70">{l}</p>
          ))}
          <p className="text-[11px] text-ink/50 pt-1">
            {t('Will live at')}: <span className="font-mono">{pending.predicted.vault}</span>
          </p>
        </div>
        <CouncilSigningDoors
          xrplTx={pending.xrplPayment as never}
          account={pending.account}
          onSettled={onSettled}
          defaultTitle={t('Create this vault')}
        />
        <button onClick={() => setPending(null)} className="text-xs text-ink/50 hover:text-ink">
          {t('Back')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-volt" />
        <h3 className="text-sm font-semibold text-ink">{t('Create a vault')}</h3>
      </div>
      <p className="text-xs text-ink/50">
        {t('The council XRPL wallet deploys and controls the vault with one signature. A different council address births a different vault — create as many as you need.')}
      </p>

      {bornNote && <p className="text-xs text-volt">{bornNote}</p>}

      <label className="block text-xs text-ink/60">
        {t('Council XRPL address (deploys and controls the vault)')}
        <input value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>

      <div className="flex gap-2">
        {(['A', 'B'] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWhich(w)}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${which === w ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}
          >
            {w === 'A' ? t('Pote A — Conservative (immediate)') : t('Pote B — Yield (3-day exit)')}
          </button>
        ))}
      </div>

      <label className="block text-xs text-ink/60">
        {t('Genesis principal (XRP)')}
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={t('e.g. 5')} className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink" />
        <span className="mt-1 block text-[11px] text-ink/40">
          {t('One payment mints this XRP into FXRP and seeds the vault (the operator’s own genesis, inflation defense).')}
        </span>
      </label>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={prepare}
        disabled={busy || !council.trim() || !amount.trim()}
        className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {t('Compose the birth for the council')}
      </button>
    </div>
  );
}

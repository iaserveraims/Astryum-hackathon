'use client';

/**
 * CouncilAnchorCard — el paso 0 del exchange: anclar la CONSTITUCIÓN del consejo
 * en XRPL (DIDSet con el SHA-256 del documento). Requisito del nacimiento del
 * pote: sin ancla, se niega. El documento nunca viaja — solo su huella. Lo firma
 * el consejo en Xaman (CouncilSigningDoors); Astryum no firma.
 */

import { useState } from 'react';
import { Loader2, FileSignature } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { CouncilSigningDoors } from '../legacy/CouncilMultisigFlow';
import { prepareCouncilAnchor, type CouncilAnchorPrepared } from '../../lib/institutional/api';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;

export function CouncilAnchorCard() {
  const { t } = useT();
  const [account, setAccount] = useState('');
  const [hash, setHash] = useState('');
  const [uri, setUri] = useState('');
  const [pending, setPending] = useState<CouncilAnchorPrepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function prepare() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      if (!XRPL_RE.test(account.trim())) throw new Error(t('The council XRPL address is not valid'));
      if (!SHA256_RE.test(hash.trim())) throw new Error(t('The constitution hash must be 64 hex characters (a SHA-256)'));
      const res = await prepareCouncilAnchor({
        account: account.trim(),
        documentSha256Hex: hash.trim(),
        documentUri: uri.trim() || undefined,
      });
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
        {pending.disclosure.note && <p className="text-xs text-ink/70">{pending.disclosure.note}</p>}
        <CouncilSigningDoors
          xrplTx={pending.xrplTx as never}
          account={pending.account}
          onSettled={() => {
            setPending(null);
            setNote(t('Constitution anchored. The council can now birth its vault.'));
          }}
          defaultTitle={t('Anchor the constitution (DIDSet)')}
        />
        <button onClick={() => setPending(null)} className="text-xs text-ink/50 hover:text-ink">{t('Back')}</button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-surface-1 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileSignature className="w-4 h-4 text-volt" />
        <h3 className="text-sm font-semibold text-ink">{t('Anchor the council constitution')}</h3>
      </div>
      <p className="text-xs text-ink/50">
        {t('Step 0: anchor the SHA-256 of the governance document on XRPL (DIDSet). The pote cannot be born without it. The document never travels — only its fingerprint.')}
      </p>
      {note && <p className="text-xs text-volt">{note}</p>}
      <label className="block text-xs text-ink/60">
        {t('Council XRPL address')}
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="r…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      <label className="block text-xs text-ink/60">
        {t('Constitution SHA-256 (64 hex)')}
        <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="5f5e18…" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      <label className="block text-xs text-ink/60">
        {t('Document URI (optional — IPFS/HTTPS)')}
        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="ipfs://… (opcional)" className="mt-1 w-full rounded-lg bg-surface-2 border border-ink/10 px-3 py-2 text-sm text-ink font-mono" />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button onClick={prepare} disabled={busy || !account.trim() || !hash.trim()} className="w-full rounded-lg bg-volt text-black font-semibold py-2 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
        {t('Compose the anchor (DIDSet)')}
      </button>
    </div>
  );
}

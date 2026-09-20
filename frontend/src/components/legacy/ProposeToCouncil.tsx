'use client';

/**
 * ProposeToCouncil — the ASYNC verb of governed mode (prompt §2.4).
 *
 * Same composed tx, different tempo: instead of gathering every member's QR in
 * one sitting (CouncilMultisigFlow), this files the pinned tx as a PROPOSAL in
 * the inbox. Each member then signs from their own device whenever they can;
 * once the quorum weight is met, anyone combines and broadcasts from their
 * browser. The server pins and stores — it never signs.
 */
import { useCallback, useState } from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { describeServerRefusal, type ReadableRefusal } from '../../lib/errors/serverRefusal';
import { ServerRefusalBody } from '../ui/ServerRefusalBody';
import { councilProposalsApi, type MultisigPrepare } from '../../services/v1Api';

/**
 * prosa-y-lectores — THIS DOOR OVERRODE THE SERVER AND SENT PEOPLE THE WRONG WAY.
 *
 * The catch below used to match `err.message === 'LIVE_PROPOSAL_EXISTS'` (the
 * slug `jpost` puts in `Error.message`) and print a hardcoded "emit it,
 * withdraw it or let it expire first", THROWING AWAY `err.body.detail`. The
 * backend rewrote that exact 409 this round precisely because "let it expire"
 * is the wrong door — inside its deadline `withdraw` reads no ledger and
 * issues no verdict, and expiry lands on the unresolved-seat guard — so the
 * newest, longest and most specific sentence was the one being discarded, and
 * the family kept reading the retired one.
 */
/**
 * Y EL LECTOR COMPARTIDO TIRABA LAS SALIDAS.
 *
 * Delegar arregló la FRASE en la it. «prosa-y-lectores», pero `serverRefusalText`
 * devolvía una cadena: el `headline`, las `ways[]` y el `retryAfterSeconds` que el
 * servidor manda (`services/identity/provenAddresses.ts`, verbatim desde las rutas)
 * se quedaban en el camino. El rechazo entero viaja ahora, y la pantalla pinta lo
 * que el servidor nombró — incluida la puerta, para el perfil de email/Google que
 * leía «sign in with the wallet that controls this address» sin nada que pulsar.
 */
function proposalError(e: unknown, t: (s: string) => string): ReadableRefusal {
  return describeServerRefusal(e, t);
}

export default function ProposeToCouncil({
  xrplTx,
  account,
  defaultTitle,
  onProposed,
}: {
  xrplTx: Record<string, unknown>;
  account: string;
  /** Prefill for the short human summary shown in the inbox. */
  defaultTitle?: string;
  onProposed?: (proposalId: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [busy, setBusy] = useState(false);
  // Una frase nuestra, o un rechazo LEÍDO con sus salidas y su puerta.
  const [error, setError] = useState<string | ReadableRefusal | null>(null);
  const [done, setDone] = useState<{ id: string; preflight: MultisigPrepare['preflight'] } | null>(null);

  const propose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await councilProposalsApi.create({
        account,
        xrplTx,
        title: title.trim() || undefined,
      });
      setDone({ id: res.proposal.id, preflight: res.preflight });
      onProposed?.(res.proposal.id);
    } catch (e) {
      setError(proposalError(e, t));
    } finally {
      setBusy(false);
    }
  }, [account, xrplTx, title, onProposed, t]);

  if (done) {
    return (
      <div className="space-y-1 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
        <InlineNotice tone="success">
          {t('Filed in the proposal inbox — each member can now sign from their own device.')}
        </InlineNotice>
        {done.preflight.available && !done.preflight.willSucceed && (
          <InlineNotice tone="warning">
            {t('Ledger dry-run says it would FAIL:')} {done.preflight.engineResult} — {done.preflight.engineResultMessage}
          </InlineNotice>
        )}
      </div>
    );
  }

  // The ASYNC tempo. Twinned with CouncilMultisigFlow's idle block above it: the
  // pair has to contrast in WHERE each member signs, not only in how long it
  // takes.
  if (!open) {
    return (
      <div className="space-y-1">
        <GhostButton onClick={() => setOpen(true)}>
          <Inbox size={14} /> {t('Propose to the council (sign over days)')}
        </GhostButton>
        <p className="text-[11px] text-ink/40">
          {t(
            'Nobody has to be here: the proposal waits in each member’s own Astryum, where they sign their own seat with their own linked wallet. It is stored, and expires in 7 days.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
      <div className="flex items-center gap-2">
        <Inbox size={14} className="text-ink/50" />
        <span className="text-sm text-ink/80">{t('Propose to the council')}</span>
        <Pill tone="neutral">{t('async')}</Pill>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder={t('Short summary for the inbox (optional)')}
        className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink caret-ink placeholder:text-ink/30 outline-none focus:border-ink/25"
      />
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={() => void propose()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Inbox size={14} />}
          {t('File the proposal')}
        </PrimaryButton>
        <GhostButton onClick={() => setOpen(false)} disabled={busy}>
          {t('Back')}
        </GhostButton>
      </div>
      {error && (
        <InlineNotice tone="warning">
          {typeof error === 'string' ? error : <ServerRefusalBody refusal={error} t={t} />}
        </InlineNotice>
      )}
    </div>
  );
}

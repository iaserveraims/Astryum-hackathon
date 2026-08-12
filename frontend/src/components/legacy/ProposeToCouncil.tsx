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
import { councilProposalsApi, type MultisigPrepare } from '../../services/v1Api';

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
  const [error, setError] = useState<string | null>(null);
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
      const err = e as Error & { status?: number; body?: { detail?: string } };
      setError(
        err.message === 'LIVE_PROPOSAL_EXISTS'
          ? t('This account already has a live proposal — emit it, withdraw it or let it expire first (XRPL pins one Sequence at a time).')
          : (err.body?.detail ?? err.message),
      );
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
  // takes (2026-08-04).
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
        className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25"
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
      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </div>
  );
}

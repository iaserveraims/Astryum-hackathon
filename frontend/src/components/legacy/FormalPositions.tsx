'use client';

/**
 * FormalPositions — the deliberative record of a proposal (prompt §2.2).
 *
 * THE ACTA, NOT A CHAT: each councillor may fix ONE position — for / against /
 * abstain / request changes, plus an optional brief comment — signed with
 * their own wallet and immutable once set. Who thought what, and when.
 * Deliberation itself stays ephemeral and never touches the ledger; positions
 * are what IS eternal.
 *
 * Anchoring is BATCHED: each position's signature already makes forgery
 * impossible the moment it is filed; the SET is anchored on-chain in one
 * 1-drop personal Payment at emission (or on a terminal state). The batch
 * defers the public timestamp — never the integrity.
 */
import { useCallback, useMemo, useState } from 'react';
import { Anchor, Check, FileSignature, Loader2 } from 'lucide-react';
import { GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import {
  councilProposalsApi,
  type CouncilProposalRecord,
  type FormalStance,
} from '../../services/v1Api';
import { POSITION_MEMO_PREFIX, XRPSCAN_TX, sha256Hex, shortAddr } from '../../lib/xrpl/councilSigning';

const STANCES: Array<{ value: FormalStance; label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' }> = [
  { value: 'for', label: 'In favour', tone: 'success' },
  { value: 'against', label: 'Against', tone: 'danger' },
  { value: 'abstain', label: 'Abstain', tone: 'neutral' },
  { value: 'request-changes', label: 'Request changes', tone: 'warning' },
];

function stanceMeta(v: string) {
  return STANCES.find((s) => s.value === v) ?? STANCES[2];
}

export default function FormalPositions({
  proposal,
  myAddrs,
  onChanged,
}: {
  proposal: CouncilProposalRecord;
  myAddrs: Set<string>;
  onChanged: () => void;
}) {
  const { t } = useT();
  const xrpl = useXrplWalletPartner();
  const positions = proposal.positions ?? [];
  const live = proposal.status === 'collecting' || proposal.status === 'ready';

  // My member addresses that have not fixed a position yet.
  const fixed = useMemo(() => new Set(positions.map((p) => p.memberAccount)), [positions]);
  const myPending = useMemo(
    () => proposal.signerList.filter((s) => myAddrs.has(s.account) && !fixed.has(s.account)).map((s) => s.account),
    [proposal.signerList, myAddrs, fixed],
  );

  const [open, setOpen] = useState(false);
  const [stance, setStance] = useState<FormalStance>('for');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchoring, setAnchoring] = useState(false);

  const fixPosition = useCallback(
    async (member: string) => {
      setBusy(true);
      setError(null);
      try {
        const trimmed = comment.trim();
        const content = {
          kind: 'astryum-council-position/v1',
          proposalId: proposal.id,
          account: proposal.account,
          member,
          stance,
          ...(trimmed ? { comment: trimmed } : {}),
          at: new Date().toISOString(),
        };
        const contentJson = JSON.stringify(content);
        const contentHash = await sha256Hex(contentJson);
        // The member signs the hash commitment with their own wallet (an
        // AccountSet proof, submit:false — same rail as wallet binding).
        const { signedTxHex } = await xrpl.service.signOwnershipProof(
          member,
          `${POSITION_MEMO_PREFIX}${contentHash}`,
        );
        await councilProposalsApi.setPosition(proposal.id, {
          memberAccount: member,
          stance,
          ...(trimmed ? { comment: trimmed } : {}),
          contentJson,
          blobHex: signedTxHex,
        });
        setOpen(false);
        setComment('');
        onChanged();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [proposal, stance, comment, xrpl.service, onChanged],
  );

  const anchorActa = useCallback(async () => {
    if (!xrpl.address) {
      setError(t('Connect your Xaman to anchor the record.'));
      return;
    }
    setAnchoring(true);
    setError(null);
    try {
      const prep = await councilProposalsApi.anchorPositionsPrepare(proposal.id, xrpl.address);
      const { txHash } = await xrpl.sendIntent({ tx: prep.xrplTx as never });
      await councilProposalsApi.anchorPositionsDone(proposal.id, txHash);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnchoring(false);
    }
  }, [proposal.id, xrpl, onChanged, t]);

  // Anchor offer: emitted or terminal, with positions, not yet anchored.
  const anchorable =
    positions.length > 0 &&
    !proposal.positionsAnchor &&
    (proposal.status === 'submitted' || proposal.status === 'expired' || proposal.status === 'withdrawn');

  if (positions.length === 0 && (!live || myPending.length === 0)) return null;

  return (
    <div className="space-y-2 rounded-lg border border-ink/[0.07] bg-ink/[0.02] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature size={13} className="text-ink/45" />
        <span className="text-[12px] font-medium text-ink/70">{t('Formal positions')}</span>
        <span className="text-[11px] text-ink/35">{t('the record — not a chat')}</span>
        {proposal.positionsAnchor && (
          <a
            href={`${XRPSCAN_TX}${proposal.positionsAnchor}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-tone-success underline"
          >
            <Anchor size={10} /> {t('anchored on-chain')}
          </a>
        )}
      </div>

      {positions.length > 0 && (
        <ul className="space-y-1.5">
          {positions.map((p) => {
            const meta = stanceMeta(p.stance);
            return (
              <li key={p.memberAccount} className="flex flex-wrap items-start gap-2 text-[12px]">
                <span className="font-mono text-ink/70">{shortAddr(p.memberAccount)}</span>
                <Pill tone={meta.tone}>{t(meta.label)}</Pill>
                {p.comment && <span className="text-ink/55">“{p.comment}”</span>}
              </li>
            );
          })}
        </ul>
      )}

      {live &&
        myPending.map((member) =>
          open ? (
            <div key={member} className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {STANCES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStance(s.value)}
                    aria-pressed={stance === s.value}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      stance === s.value
                        ? 'border-volt/60 bg-volt/15 text-ink'
                        : 'border-ink/10 bg-ink/[0.03] text-ink/55 hover:text-ink/85'
                    }`}
                  >
                    {t(s.label)}
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder={t('Brief comment (optional) — it becomes part of the signed record')}
                className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm outline-none focus:border-ink/25"
              />
              <div className="flex flex-wrap items-center gap-2">
                <PrimaryButton onClick={() => void fixPosition(member)} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t('Sign my position')} · {shortAddr(member)}
                </PrimaryButton>
                <GhostButton onClick={() => setOpen(false)} disabled={busy}>
                  {t('Cancel')}
                </GhostButton>
              </div>
              <p className="text-[11px] text-ink/40">
                {t('Immutable once signed: who thought what, and when. Your wallet signs a proof — no funds are moved.')}
              </p>
            </div>
          ) : (
            <GhostButton key={member} onClick={() => setOpen(true)}>
              <FileSignature size={12} /> {t('Fix my position')}
            </GhostButton>
          ),
        )}

      {anchorable && (
        <GhostButton onClick={() => void anchorActa()} disabled={anchoring}>
          {anchoring ? <Loader2 size={12} className="animate-spin" /> : <Anchor size={12} />}
          {t('Anchor the record (1 drop)')}
        </GhostButton>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </div>
  );
}

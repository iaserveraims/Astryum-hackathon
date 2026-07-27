'use client';

/**
 * ProposalInbox — the governed mode's centrepiece (prompt §2.1).
 *
 * Single-key is synchronous (compose → sign → done); a quorum is ASYNC
 * (compose → propose → collect signatures over hours or days → combine →
 * emit). This inbox is the surface of that asymmetry: proposals waiting for
 * YOUR signature / waiting for others / ready to emit / emitted.
 *
 * The engine is the existing coordinator machinery, persisted: the backend
 * stores the pinned tx + verified blobs; each member signs their own Xaman
 * request whenever they can; combining (xrpl.multisign) and broadcasting stay
 * in THIS browser. Astryum never signs, never combines server-side.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { multisign } from 'xrpl';
import {
  Check,
  Clock,
  ExternalLink,
  Inbox,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react';
import { Card, EmptyState, GhostButton, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import FormalPositions from './FormalPositions';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useXrplWalletPartner } from '../../lib/wallet/useXrplWalletPartner';
import { councilProposalsApi, type CouncilProposalRecord } from '../../services/v1Api';
import { verifySignerBlob, BlobVerificationError } from '../../lib/xrpl/verifySignerBlob';
import {
  XRPSCAN_TX,
  broadcast,
  createMemberPayload,
  pollStatus,
  shortAddr,
} from '../../lib/xrpl/councilSigning';

const LIVE: ReadonlyArray<CouncilProposalRecord['status']> = ['collecting', 'ready'];

interface SignSession {
  proposalId: string;
  memberAccount: string;
  uuid?: string;
  qrPng?: string;
  deeplink?: string;
  status: 'creating' | 'waiting' | 'error';
  error?: string;
}

function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

export default function ProposalInbox({
  account,
  onSettled,
}: {
  account: string;
  /** Called with the tx hash after a successful browser broadcast. */
  onSettled?: (hash: string) => void;
}) {
  const { t } = useT();
  const { wallets } = useMyWallets();
  const { address: xrplConnected } = useXrplWalletPartner();

  // The r-addresses that are MINE (linked wallets + the connected Xaman):
  // membership in a proposal's signer list is computed against this set.
  const myAddrs = useMemo(() => {
    const set = new Set<string>();
    for (const w of wallets) if (w.address.startsWith('r')) set.add(w.address);
    if (xrplConnected) set.add(xrplConnected);
    return set;
  }, [wallets, xrplConnected]);

  const [proposals, setProposals] = useState<CouncilProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sign, setSign] = useState<SignSession | null>(null);
  const [emittingId, setEmittingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [emitResult, setEmitResult] = useState<{ id: string; engine: string; hash?: string; message?: string } | null>(null);
  const signRef = useRef<SignSession | null>(null);
  signRef.current = sign;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { proposals: list } = await councilProposalsApi.list([account]);
      setProposals(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── async member signing: one Xaman request for MY member address ──
  const startSign = useCallback(
    async (p: CouncilProposalRecord, memberAccount: string) => {
      setActionError(null);
      setSign({ proposalId: p.id, memberAccount, status: 'creating' });
      try {
        const pl = await createMemberPayload(p.txjson, memberAccount);
        setSign({ proposalId: p.id, memberAccount, uuid: pl.uuid, qrPng: pl.qrPng, deeplink: pl.deeplink, status: 'waiting' });
      } catch (e) {
        setSign({ proposalId: p.id, memberAccount, status: 'error', error: (e as Error).message });
      }
    },
    [],
  );

  useEffect(() => {
    if (sign?.status !== 'waiting' || !sign.uuid) return;
    const proposal = proposals.find((p) => p.id === sign.proposalId);
    if (!proposal) return;
    const id = setInterval(() => {
      void (async () => {
        const s = signRef.current;
        if (!s?.uuid) return;
        const st = await pollStatus(s.uuid);
        if (st.signed && st.hex) {
          try {
            // Same guard as the ceremony flow: identity + fidelity BEFORE the
            // blob leaves this browser. The server verifies again on arrival.
            verifySignerBlob(st.hex, s.memberAccount, proposal.txjson);
            await councilProposalsApi.sign(s.proposalId, s.memberAccount, st.hex);
            setSign(null);
            void reload();
          } catch (e) {
            const msg = e instanceof BlobVerificationError ? e.message : (e as Error).message;
            setSign({ ...s, status: 'error', error: msg });
          }
        } else if (st.cancelled || st.expired) {
          setSign({ ...s, status: 'error', error: t('rejected / expired') });
        }
      })();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sign?.uuid, sign?.status, proposals]);

  // ── emit: combine the stored blobs and broadcast from THIS browser ──
  const emit = useCallback(
    async (p: CouncilProposalRecord) => {
      setActionError(null);
      setEmitResult(null);
      setEmittingId(p.id);
      try {
        const { proposal } = await councilProposalsApi.detail(p.id);
        const blobs = proposal.signatures.map((s) => s.blobHex).filter((b): b is string => !!b);
        if (blobs.length === 0) throw new Error(t('No signatures stored for this proposal.'));
        const combined = multisign(blobs);
        const res = await broadcast(combined);
        setEmitResult({ id: p.id, ...res });
        if (res.engine === 'tesSUCCESS' && res.hash) {
          await councilProposalsApi.submitted(p.id, res.hash);
          onSettled?.(res.hash);
          void reload();
        }
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setEmittingId(null);
      }
    },
    [onSettled, reload, t],
  );

  const withdraw = useCallback(
    async (p: CouncilProposalRecord) => {
      setActionError(null);
      try {
        await councilProposalsApi.withdraw(p.id);
        void reload();
      } catch (e) {
        setActionError((e as Error).message);
      }
    },
    [reload],
  );

  // ── grouping (the four trays) ──
  const signedBy = (p: CouncilProposalRecord) => new Set(p.signatures.map((s) => s.signerAccount));
  const myPendingMembers = (p: CouncilProposalRecord) =>
    p.signerList.filter((s) => myAddrs.has(s.account) && !signedBy(p).has(s.account)).map((s) => s.account);

  const live = proposals.filter((p) => LIVE.includes(p.status));
  const toSign = live.filter((p) => p.status === 'collecting' && myPendingMembers(p).length > 0);
  const waitingOthers = live.filter((p) => p.status === 'collecting' && myPendingMembers(p).length === 0);
  const ready = live.filter((p) => p.status === 'ready');
  const emitted = proposals.filter((p) => p.status === 'submitted');
  const archived = proposals.filter((p) => p.status === 'expired' || p.status === 'withdrawn');

  const collectedWeight = (p: CouncilProposalRecord) => p.signatures.reduce((s, x) => s + x.weight, 0);

  const renderProposal = (p: CouncilProposalRecord, tray: 'toSign' | 'waiting' | 'ready' | 'emitted') => (
    <li key={p.id} className="rounded-lg border border-ink/10 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink/85">{p.title || p.txType}</span>
        <Pill tone="neutral">{p.txType}</Pill>
        <Pill tone={p.status === 'ready' ? 'success' : 'warning'}>
          {collectedWeight(p)}/{p.quorum} {t('quorum')}
        </Pill>
        {LIVE.includes(p.status) && (
          <span className="flex items-center gap-1 text-[11px] text-ink/40">
            <Clock size={11} /> {daysLeft(p.expiresAt)} {t('days left')}
          </span>
        )}
        {p.txHash && (
          <a href={`${XRPSCAN_TX}${p.txHash}`} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 underline hover:text-ink/85">
            {t('View on XRPScan')}
          </a>
        )}
      </div>

      {/* who has signed — the per-member state, always visible */}
      <div className="flex flex-wrap gap-1.5">
        {p.signerList.map((s) => {
          const done = signedBy(p).has(s.account);
          const mine = myAddrs.has(s.account);
          return (
            <span
              key={s.account}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                done ? 'border-emerald-400/30 bg-emerald-400/10 text-tone-success' : 'border-ink/10 bg-ink/[0.03] text-ink/50'
              }`}
            >
              {done ? <Check size={10} /> : <Clock size={10} />}
              {shortAddr(s.account)}
              {mine && <span className="text-ink/35">· {t('you')}</span>}
            </span>
          );
        })}
      </div>

      {tray === 'toSign' &&
        myPendingMembers(p).map((member) => (
          <div key={member} className="space-y-2">
            {sign?.proposalId === p.id && sign.memberAccount === member ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
                {sign.status === 'creating' && <Loader2 size={14} className="animate-spin text-ink/40" />}
                {sign.status === 'waiting' && (
                  <>
                    {sign.qrPng && <img src={sign.qrPng} alt={t('Xaman QR')} className="h-24 w-24 rounded bg-white p-1" />}
                    <div className="flex flex-col gap-1">
                      <Pill tone="warning">{t('waiting for signature')}</Pill>
                      {sign.deeplink && (
                        <a href={sign.deeplink} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 hover:text-ink/80">
                          <ExternalLink size={12} className="mr-1 inline" /> {t('open in Xaman')}
                        </a>
                      )}
                    </div>
                    {/* Xaman locks a payload to the first client that opens it
                        ("payload handled by another client") — the cure is a
                        fresh payload for the SAME proposal tx. */}
                    <GhostButton onClick={() => void startSign(p, member)}>
                      <RefreshCw size={12} /> {t('New QR')}
                    </GhostButton>
                    <GhostButton onClick={() => setSign(null)}>{t('Cancel')}</GhostButton>
                  </>
                )}
                {sign.status === 'error' && (
                  <>
                    <InlineNotice tone="warning">{sign.error}</InlineNotice>
                    <GhostButton onClick={() => void startSign(p, member)}>
                      <RefreshCw size={12} /> {t('New QR')}
                    </GhostButton>
                    <GhostButton onClick={() => setSign(null)}>{t('Cancel')}</GhostButton>
                  </>
                )}
              </div>
            ) : (
              <PrimaryButton onClick={() => void startSign(p, member)}>
                <PenLine size={14} /> {t('Sign as')} {shortAddr(member)}
              </PrimaryButton>
            )}
          </div>
        ))}

      {tray === 'ready' && (
        <PrimaryButton onClick={() => void emit(p)} disabled={emittingId === p.id}>
          {emittingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {t('Combine & broadcast')}
        </PrimaryButton>
      )}

      {/* The acta (§2.2): stance signed by each councillor, immutable, batch-
          anchored at emission. Not a chat. */}
      <FormalPositions proposal={p} myAddrs={myAddrs} onChanged={() => void reload()} />

      {emitResult?.id === p.id && emitResult.engine !== 'tesSUCCESS' && (
        <InlineNotice tone="warning">
          {emitResult.engine} — {emitResult.message}
        </InlineNotice>
      )}

      {LIVE.includes(p.status) && tray !== 'ready' && (
        <GhostButton onClick={() => void withdraw(p)}>
          <Undo2 size={12} /> {t('Withdraw (proposer only)')}
        </GhostButton>
      )}
    </li>
  );

  const tray = (title: string, items: CouncilProposalRecord[], kind: 'toSign' | 'waiting' | 'ready' | 'emitted') =>
    items.length > 0 && (
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-widest text-ink/35">{title}</p>
        <ul className="space-y-2">{items.map((p) => renderProposal(p, kind))}</ul>
      </div>
    );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Inbox size={16} className="text-ink/50" />
        <SectionTitle>{t('Proposal inbox')}</SectionTitle>
        {toSign.length > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {toSign.length}
          </span>
        )}
        <div className="ml-auto">
          <GhostButton onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('Refresh')}
          </GhostButton>
        </div>
      </div>

      <p className="text-[12px] text-ink/50">
        {t(
          'A quorum signs asynchronously: propose, each member signs when they can, combine and broadcast from the browser once the quorum is met. Proposals expire after 7 days.',
        )}
      </p>

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
      {actionError && <InlineNotice tone="warning">{actionError}</InlineNotice>}

      {proposals.length === 0 && !loading ? (
        <EmptyState
          bare
          icon={<Inbox size={20} />}
          title={t('No proposals yet')}
          hint={t('Actions on this account create proposals here for the council to sign.')}
        />
      ) : (
        <div className="space-y-4">
          {tray(t('Waiting for YOUR signature'), toSign, 'toSign')}
          {tray(t('Waiting for others'), waitingOthers, 'waiting')}
          {tray(t('Ready to emit'), ready, 'ready')}
          {tray(t('Emitted'), emitted, 'emitted')}
          {archived.length > 0 && (
            <p className="text-[11px] text-ink/35">
              {archived.length} {t('expired or withdrawn proposals not shown')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

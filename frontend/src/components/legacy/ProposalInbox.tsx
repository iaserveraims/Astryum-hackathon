'use client';

/**
 * ProposalInbox — the governed mode's centrepiece (prompt §2.1).
 *
 * Single-key is synchronous (compose → sign → done); a quorum is ASYNC
 * (compose → propose → collect signatures over hours or days → combine →
 * emit). This inbox is the surface of that asymmetry: proposals waiting for
 * YOUR signature / waiting for others / ready to emit / emitted.
 *
 * ONE SEAT PER ACCOUNT (2026-08-04). This is the async tempo, so the only QR
 * this screen ever mints is for an address linked to THIS account through
 * Xaman. Gathering the whole council in one sitting is the other tempo, and it
 * lives in CouncilMultisigFlow — the two are deliberately not mixed.
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
  Copy,
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
import { startPending } from '../../lib/settlement/settlement';
import { useSettlement } from '../../lib/settlement/useSettlement';
import { councilProposalsApi, xrplLegacy, type CouncilProposalRecord } from '../../services/v1Api';
import { xrplTxTypeLabel } from '../../lib/xrpl/txTypeLabels';
import { verifySignerBlob, BlobVerificationError } from '../../lib/xrpl/verifySignerBlob';
import {
  XRPSCAN_TX,
  type ConfirmedSubmit,
  createMemberPayload,
  pollStatus,
  shortAddr,
  submitAndConfirm,
} from '../../lib/xrpl/councilSigning';

const LIVE: ReadonlyArray<CouncilProposalRecord['status']> = ['collecting', 'ready'];

interface SignSession {
  proposalId: string;
  memberAccount: string;
  uuid?: string;
  qrPng?: string;
  deeplink?: string;
  /** Xaman rang this member's phone (it had their push token). */
  pushed?: boolean;
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
  const [emitResult, setEmitResult] = useState<({ id: string } & ConfirmedSubmit) | null>(null);
  // Council-order aftermath: the backend starts the FDC relay server-side on
  // /submitted (2026-07-29 hole closed); this state mirrors it in the tray and
  // the settlement machine owns the DONE verdict (rail 'council-order').
  const [orderRelay, setOrderRelay] = useState<{
    proposalId: string;
    hash: string;
    relay: 'started' | 'already-relaying' | 'relayer-disabled' | 'not-launched';
    stuck?: string;
  } | null>(null);
  const settlement = useSettlement();
  // Manual signature entry (the escape hatch for tx types Xaman's API refuses).
  const [paste, setPaste] = useState<{
    proposalId: string;
    memberAccount: string;
    blob: string;
    busy?: boolean;
    error?: string;
  } | null>(null);
  const [copiedTx, setCopiedTx] = useState<string | null>(null);
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

  /** Same guard chain as the QR path: verify HERE, then let the server verify
   *  again on arrival. A blob signed by the wrong member — or over drifted
   *  bytes — never counts toward the quorum, whatever tool produced it. */
  const submitPastedBlob = useCallback(
    async (p: CouncilProposalRecord, member: string) => {
      const hex = (paste?.blob ?? '').trim().replace(/\s+/g, '').toUpperCase();
      if (!hex) return;
      setPaste((cur) => (cur ? { ...cur, busy: true, error: undefined } : cur));
      try {
        verifySignerBlob(hex, member, p.txjson);
        await councilProposalsApi.sign(p.id, member, hex);
        setPaste(null);
        void reload();
      } catch (e) {
        const msg = e instanceof BlobVerificationError ? e.message : (e as Error).message;
        setPaste((cur) => (cur ? { ...cur, busy: false, error: msg } : cur));
      }
    },
    [paste?.blob, reload],
  );

  // ── async member signing: one Xaman request for MY member address ──
  const startSign = useCallback(
    async (p: CouncilProposalRecord, memberAccount: string) => {
      setActionError(null);
      setSign({ proposalId: p.id, memberAccount, status: 'creating' });
      try {
        const pl = await createMemberPayload(p.txjson, memberAccount);
        setSign({
          proposalId: p.id,
          memberAccount,
          uuid: pl.uuid,
          qrPng: pl.qrPng,
          deeplink: pl.deeplink,
          pushed: pl.pushed,
          status: 'waiting',
        });
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
        // Submit AND wait for the validated ledger — the preliminary tesSUCCESS
        // can still land as tec*. The DB report (relay launch) stays keyed off
        // the submit (the relay re-verifies on XRPL itself), but the green and
        // onSettled only follow the ledger's verdict.
        const res = await submitAndConfirm(combined);
        setEmitResult({ id: p.id, ...res });
        if (res.engine === 'tesSUCCESS' && res.hash) {
          const report = await councilProposalsApi.submitted(p.id, res.hash);
          if (report.councilOrder?.isOrder) {
            setOrderRelay({ proposalId: p.id, hash: res.hash, relay: report.councilOrder.relay });
            settlement.track(startPending('council-order', res.hash));
          }
          if (res.validated && res.finalResult === 'tesSUCCESS') onSettled?.(res.hash);
          void reload();
        }
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setEmittingId(null);
      }
    },
    [onSettled, reload, settlement, t],
  );

  // Enrichment poll while the order travels: relay stuck-state only — the
  // success verdict never comes from here (settlement machine reads the bridge).
  useEffect(() => {
    if (!orderRelay || orderRelay.relay === 'relayer-disabled' || orderRelay.relay === 'not-launched') return;
    if (settlement.state?.status === 'settled') return;
    const hash = orderRelay.hash;
    const id = setInterval(() => {
      void (async () => {
        try {
          const st = await xrplLegacy.councilOrderStatus(hash, account);
          setOrderRelay((cur) =>
            cur && cur.hash === hash
              ? { ...cur, ...(st.relay?.state === 'error' ? { stuck: st.relay.detail ?? '' } : { stuck: undefined }) }
              : cur,
          );
        } catch {
          /* transient — keep polling */
        }
      })();
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRelay?.hash, orderRelay?.relay, settlement.state?.status]);

  /** Re-deliver the proof after a stuck relay — same signed tx, no new signature. */
  const retryRelay = useCallback(() => {
    if (!orderRelay) return;
    setOrderRelay({ ...orderRelay, relay: 'started', stuck: undefined });
    void xrplLegacy
      .councilOrderRelay({ xrplTxHash: orderRelay.hash })
      .catch((e) => setOrderRelay((cur) => (cur ? { ...cur, stuck: (e as Error).message } : cur)));
  }, [orderRelay]);

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
  /**
   * MY missing signatures only — the addresses this account has linked through
   * Xaman, never anybody else's (2026-08-04).
   *
   * Between 2026-08-03 and today this returned EVERY pending member, so one
   * session could mint the QR of a councillor who was not there. That is the
   * SYNCHRONOUS tempo, and it has its own surface: CouncilMultisigFlow lays out
   * one QR per member in a single sitting. Nothing was lost — the two tempos
   * were untangled. Here, in the async inbox, the rule is one seat per account:
   * each councillor signs from their own Astryum, with their own linked wallet.
   *
   * (The QR was never an authority hole — payloads are scoped to the member in
   * Xaman and `verifySignerBlob` checks identity + fidelity twice. It was a
   * clarity hole: a screen that says "sign as rDEF…" to someone who is not
   * rDEF… teaches the wrong thing about who holds what.)
   */
  const pendingMembers = (p: CouncilProposalRecord) =>
    p.signerList.filter((s) => myAddrs.has(s.account) && !signedBy(p).has(s.account)).map((s) => s.account);

  const live = proposals.filter((p) => LIVE.includes(p.status));
  const toSign = live.filter((p) => p.status === 'collecting' && pendingMembers(p).length > 0);
  const waitingOthers = live.filter((p) => p.status === 'collecting' && pendingMembers(p).length === 0);
  const ready = live.filter((p) => p.status === 'ready');
  const emitted = proposals.filter((p) => p.status === 'submitted');
  const archived = proposals.filter((p) => p.status === 'expired' || p.status === 'withdrawn');

  const collectedWeight = (p: CouncilProposalRecord) => p.signatures.reduce((s, x) => s + x.weight, 0);

  const renderProposal = (p: CouncilProposalRecord, tray: 'toSign' | 'waiting' | 'ready' | 'emitted') => (
    <li key={p.id} className="rounded-lg border border-ink/10 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* The decision reads as a sentence; the ledger type stays as the
            small technical marker (a family signs "set XRP aside until a
            date", not "EscrowCreate"). */}
        <span className="text-sm text-ink/85">{p.title || xrplTxTypeLabel(p.txType, t)}</span>
        <Pill tone="neutral">{p.txType}</Pill>
        <Pill tone={p.status === 'ready' ? 'success' : 'warning'}>
          {t('signed')} {collectedWeight(p)}/{p.quorum}
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
        pendingMembers(p).map((member) => (
          <div key={member} className="space-y-2">
            {sign?.proposalId === p.id && sign.memberAccount === member ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
                {sign.status === 'creating' && <Loader2 size={14} className="animate-spin text-ink/40" />}
                {sign.status === 'waiting' && (
                  <>
                    {sign.qrPng && <img src={sign.qrPng} alt={t('Xaman QR')} className="h-24 w-24 rounded bg-white p-1" />}
                    <div className="flex flex-col gap-1">
                      <Pill tone="warning">{t('waiting for signature')}</Pill>
                      {/* Say WHICH way the request travelled: a member who was
                          pushed can just open their phone; one who was not is
                          waiting for a notification that never left. */}
                      <span className="text-[11px] text-ink/45">
                        {sign.pushed
                          ? t('Sent to their Xaman as a notification — the QR still works.')
                          : t('No notification yet for this member: they sign the QR once, and from then on Xaman can notify them.')}
                      </span>
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
              <div className="space-y-2">
                <PrimaryButton onClick={() => void startSign(p, member)}>
                  <PenLine size={14} /> {t('Sign as')} {shortAddr(member)}
                </PrimaryButton>

                {/* ESCAPE HATCH (2026-08-03): Xaman gates account-security
                    transaction types per app (error 1217 on SignerListSet), so
                    the QR rail can refuse a tx the council legitimately needs.
                    The pinned bytes are public material: a member can sign them
                    in ANY multisign tool and paste the blob here. It lands
                    through the same door as a QR signature — the server still
                    verifies identity + fidelity + signature before storing it,
                    so this widens the tools, never the trust. */}
                {paste?.proposalId === p.id && paste.memberAccount === member ? (
                  <div className="space-y-2 rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5">
                    <p className="text-[12px] text-ink/55">
                      {t(
                        'Sign these EXACT bytes in your own multisign tool (xrpl.services, the Xaman Multisign xApp…) and paste the resulting signed blob. Change nothing: a single altered field is rejected.',
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <GhostButton
                        onClick={() => {
                          void navigator.clipboard.writeText(JSON.stringify(p.txjson, null, 2));
                          setCopiedTx(p.id);
                          setTimeout(() => setCopiedTx(null), 2_000);
                        }}
                      >
                        {copiedTx === p.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedTx === p.id ? t('Copied') : t('Copy the transaction to sign')}
                      </GhostButton>
                    </div>
                    <textarea
                      value={paste.blob}
                      onChange={(e) => setPaste({ ...paste, blob: e.target.value, error: undefined })}
                      placeholder={t('Paste the signed blob (hex)')}
                      spellCheck={false}
                      rows={3}
                      className="w-full rounded-lg border border-ink/10 bg-surface-1 px-3 py-2 font-mono text-[11px] text-ink outline-none focus:border-volt/40"
                    />
                    {paste.error && <InlineNotice tone="warning">{paste.error}</InlineNotice>}
                    <div className="flex flex-wrap items-center gap-2">
                      <PrimaryButton onClick={() => void submitPastedBlob(p, member)} disabled={paste.busy}>
                        {paste.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {t('Add this signature')}
                      </PrimaryButton>
                      <GhostButton onClick={() => setPaste(null)}>{t('Cancel')}</GhostButton>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPaste({ proposalId: p.id, memberAccount: member, blob: '' })}
                    className="text-[12px] text-ink/40 hover:text-ink/70"
                  >
                    {t('Signed it elsewhere? Paste the signature')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

      {/* Waiting with no seat of your own: say WHY there is no button, so the
          missing wallet reads as a connection to make, not a dead end. Without
          this the strict filter would leave a councillor staring at 1/3 and no
          way in — the very hole the 2026-08-03 change was reaching for. */}
      {tray === 'waiting' && !p.signerList.some((s) => myAddrs.has(s.account)) && (
        <p className="text-[11px] text-ink/40">
          {t(
            'No signature of yours is pending here: none of this council’s seats belongs to a wallet linked to this account. Each councillor signs from their own Astryum — if one of these addresses is yours, connect it in Xaman. To sign together in one sitting, use the live ceremony instead.',
          )}
        </p>
      )}

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
      {emitResult?.id === p.id && emitResult.engine === 'tesSUCCESS' && emitResult.validated && emitResult.finalResult !== 'tesSUCCESS' && (
        <InlineNotice tone="warning">
          {t('The ledger validated it but it FAILED:')} {emitResult.finalResult}
        </InlineNotice>
      )}
      {emitResult?.id === p.id && emitResult.engine === 'tesSUCCESS' && !emitResult.validated && (
        <InlineNotice tone="warning">
          {t('Broadcast accepted — still waiting for ledger validation. Check XRPScan in a moment; do not assume it applied.')}
        </InlineNotice>
      )}

      {/* Council order in flight: the XRPL broadcast is only leg 1 — the order
          exists when the BRIDGE consumes it on Flare. Honest states, no
          premature green (the settlement machine decides). */}
      {orderRelay?.proposalId === p.id &&
        (settlement.state?.status === 'settled' ? (
          <InlineNotice tone="success">{t('Executed in the cage — the bridge consumed this order.')}</InlineNotice>
        ) : orderRelay.stuck ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineNotice tone="warning">
              {t('The relay is stuck:')} {orderRelay.stuck}
            </InlineNotice>
            <GhostButton onClick={retryRelay}>
              <RefreshCw size={12} /> {t('Retry the relay')}
            </GhostButton>
          </div>
        ) : orderRelay.relay === 'relayer-disabled' || orderRelay.relay === 'not-launched' ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineNotice tone="warning">
              {t('The order is signed and valid, but the relay is off — the proof can be delivered by anyone later; no signature is lost.')}
            </InlineNotice>
            <GhostButton onClick={retryRelay}>
              <RefreshCw size={12} /> {t('Retry the relay')}
            </GhostButton>
          </div>
        ) : (
          <InlineNotice tone="warning">
            {t('Council order — the relay is carrying the FDC proof to the cage (~2–5 min). Done means the bridge consumed it, not this screen.')}
          </InlineNotice>
        ))}

      {LIVE.includes(p.status) && tray !== 'ready' && (
        <GhostButton onClick={() => void withdraw(p)}>
          <Undo2 size={12} /> {t('Withdraw (proposer only)')}
        </GhostButton>
      )}
    </li>
  );

  const tray = (title: string, items: CouncilProposalRecord[], kind: 'toSign' | 'waiting' | 'ready' | 'emitted') =>
    items.length > 0 && (
      <section className="space-y-2" aria-label={`${title} · ${items.length}`}>
        <p className="text-[11px] font-medium uppercase tracking-widest text-ink/35">
          {title} <span className="ml-1 tracking-normal text-ink/30">· {items.length}</span>
        </p>
        <ul className="space-y-2">{items.map((p) => renderProposal(p, kind))}</ul>
      </section>
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
          'A quorum signs asynchronously: propose, and each member signs from THEIR OWN account with their own linked wallet, whenever they can. You only ever sign your own seat here. Once the quorum is met, anyone combines and broadcasts from the browser. Proposals expire after 7 days.',
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

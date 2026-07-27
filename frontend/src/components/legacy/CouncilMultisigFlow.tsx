'use client';

/**
 * CouncilMultisigFlow — the multisig coordinator, in the app (ADR-008).
 *
 * Replaces the "copy the txjson and go to an external tool" hand-off for council
 * accounts. Given an unsigned txjson (composed by a builder, SourceTag stamped):
 *   1. pin it for the council via /multisign/prepare (Sequence/Fee/SigningPubKey)
 *      + read the simulate preflight (will it succeed + exact balance deltas),
 *   2. open ONE Xaman sign request per member (options.multisign) — a QR each,
 *   3. poll each until it is signed, collecting the blob,
 *   4. once the quorum weight is met, combine with xrpl.multisign() (client-side),
 *   5. broadcast the combined blob from THIS browser to a public XRPL node.
 *
 * Astryum never signs, never combines on a server, never broadcasts server-side.
 * Combining is arithmetic over signatures; the broadcast is the user's browser
 * submitting, exactly as a public tool would (ADR-008 guardrail #3).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { multisign } from 'xrpl';
import { Check, ExternalLink, Loader2, RefreshCw, Send, Users } from 'lucide-react';
import { Card, GhostButton, Pill, PrimaryButton, SectionTitle } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { xrplLegacy, type MultisigPrepare } from '../../services/v1Api';
import { verifySignerBlob, BlobVerificationError } from '../../lib/xrpl/verifySignerBlob';
import {
  XRPSCAN_TX,
  broadcast,
  createMemberPayload,
  pollStatus,
  shortAddr,
} from '../../lib/xrpl/councilSigning';

type Phase = 'idle' | 'preparing' | 'signing' | 'submitting' | 'done' | 'error';

interface MemberSign {
  account: string;
  weight: number;
  uuid?: string;
  qrPng?: string;
  deeplink?: string;
  status: 'creating' | 'waiting' | 'signed' | 'rejected' | 'error';
  blob?: string;
  error?: string;
}

export default function CouncilMultisigFlow({
  xrplTx,
  account,
  onSettled,
}: {
  xrplTx: Record<string, unknown>;
  account: string;
  onSettled?: (hash: string) => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [prep, setPrep] = useState<MultisigPrepare | null>(null);
  const [members, setMembers] = useState<MemberSign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ engine: string; hash?: string; message?: string } | null>(null);
  const membersRef = useRef<MemberSign[]>([]);
  membersRef.current = members;
  const prepRef = useRef<MultisigPrepare | null>(null);
  prepRef.current = prep;

  const collectedWeight = members.filter((m) => m.status === 'signed').reduce((s, m) => s + m.weight, 0);
  const quorum = prep?.council.quorum ?? 0;
  const quorumMet = quorum > 0 && collectedWeight >= quorum;

  const start = useCallback(async () => {
    setPhase('preparing');
    setError(null);
    try {
      const p = await xrplLegacy.multisignPrepare(account, xrplTx);
      setPrep(p);
      // Open one sign request per member (in parallel).
      const initial: MemberSign[] = p.council.signers.map((s) => ({ account: s.account, weight: s.weight, status: 'creating' }));
      setMembers(initial);
      setPhase('signing');
      await Promise.all(
        p.council.signers.map(async (s, i) => {
          try {
            const pl = await createMemberPayload(p.multisigTx, s.account);
            setMembers((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], uuid: pl.uuid, qrPng: pl.qrPng, deeplink: pl.deeplink, status: 'waiting' };
              return next;
            });
          } catch (e) {
            setMembers((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], status: 'error', error: (e as Error).message };
              return next;
            });
          }
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, [account, xrplTx]);

  // Poll waiting members until each is signed / rejected / expired.
  useEffect(() => {
    if (phase !== 'signing') return;
    const id = setInterval(() => {
      const waiting = membersRef.current.filter((m) => m.status === 'waiting' && m.uuid);
      if (waiting.length === 0) return;
      waiting.forEach(async (m) => {
        const st = await pollStatus(m.uuid!);
        if (st.signed && st.hex) {
          // Guard the IDENTITY + FIDELITY hole BEFORE the blob can count or combine:
          // a blob signed by the wrong member (Xaman `signers` rejected → any member
          // can answer any QR) is refused here, not silently combined.
          const expectedTx = prepRef.current?.multisigTx;
          try {
            if (expectedTx) verifySignerBlob(st.hex, m.account, expectedTx);
            setMembers((prev) => prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'signed', blob: st.hex } : x)));
          } catch (e) {
            const msg = e instanceof BlobVerificationError ? e.message : (e as Error).message;
            setMembers((prev) => prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'error', error: msg } : x)));
          }
        } else if (st.cancelled || st.expired) {
          setMembers((prev) => prev.map((x) => (x.uuid === m.uuid ? { ...x, status: 'rejected' } : x)));
        }
      });
    }, 3000);
    return () => clearInterval(id);
  }, [phase]);

  // Re-open ONE member's sign request. Xaman locks a payload to the first
  // client that opens it ("payload handled by another client"); the cure is a
  // FRESH payload for the SAME pinned tx — same Sequence/Fee/signer, so any
  // signature already collected from other members keeps counting.
  const resetMember = useCallback(async (memberAccount: string) => {
    const tx = prepRef.current?.multisigTx;
    if (!tx) return;
    setMembers((prev) =>
      prev.map((x) =>
        x.account === memberAccount
          ? { ...x, status: 'creating', uuid: undefined, qrPng: undefined, deeplink: undefined, blob: undefined, error: undefined }
          : x,
      ),
    );
    try {
      const pl = await createMemberPayload(tx, memberAccount);
      setMembers((prev) =>
        prev.map((x) =>
          x.account === memberAccount ? { ...x, uuid: pl.uuid, qrPng: pl.qrPng, deeplink: pl.deeplink, status: 'waiting' } : x,
        ),
      );
    } catch (e) {
      setMembers((prev) =>
        prev.map((x) => (x.account === memberAccount ? { ...x, status: 'error', error: (e as Error).message } : x)),
      );
    }
  }, []);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setError(null);
    try {
      const blobs = membersRef.current.filter((m) => m.status === 'signed' && m.blob).map((m) => m.blob!);
      const combined = multisign(blobs);
      const res = await broadcast(combined);
      setResult(res);
      setPhase('done');
      if (res.engine === 'tesSUCCESS' && res.hash) onSettled?.(res.hash);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, [onSettled]);

  if (phase === 'idle') {
    return (
      <PrimaryButton onClick={() => void start()}>
        <Users size={14} /> {t('Gather the council’s signatures')}
      </PrimaryButton>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-ink/50" />
        <SectionTitle>{t('Council signatures')}</SectionTitle>
        {prep && (
          <Pill tone={quorumMet ? 'success' : 'warning'}>
            {collectedWeight}/{quorum} {t('quorum')}
          </Pill>
        )}
      </div>

      {phase === 'preparing' && (
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={14} className="animate-spin" /> {t('Reading the council and pinning the transaction…')}
        </p>
      )}

      {/* The simulate preflight (#11): ledger truth before anyone signs. */}
      {prep && (
        <div className="rounded-lg border border-ink/10 bg-ink/[0.03] p-2.5 text-[12px]">
          {prep.preflight.available ? (
            prep.preflight.willSucceed ? (
              <InlineNotice tone="success">
                {t('Ledger dry-run: this transaction would succeed')} ({prep.preflight.engineResult}).
              </InlineNotice>
            ) : (
              <InlineNotice tone="warning">
                {t('Ledger dry-run says it would FAIL:')} {prep.preflight.engineResult} — {prep.preflight.engineResultMessage}
              </InlineNotice>
            )
          ) : (
            <p className="text-ink/45">{t('Ledger dry-run unavailable on this node — proceed with care.')}</p>
          )}
          <p className="mt-1 text-ink/45">
            {t('Fee')}: {prep.fee.drops} drops ({t('base')} {prep.fee.baseFeeDrops} × (1 + {prep.fee.signerCount})).
          </p>
        </div>
      )}

      {/* One card per member: QR + status. Each signs on their own device. */}
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.account} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 p-2.5">
            <span className="font-mono text-sm text-ink/80">{shortAddr(m.account)}</span>
            <span className="text-[11px] text-ink/40">{t('weight')} {m.weight}</span>
            {m.status === 'creating' && <Loader2 size={14} className="animate-spin text-ink/40" />}
            {m.status === 'waiting' && (
              <>
                {m.qrPng && <img src={m.qrPng} alt={t('Xaman QR')} className="h-24 w-24 rounded bg-white p-1" />}
                <div className="flex flex-col gap-1">
                  <Pill tone="warning">{t('waiting for signature')}</Pill>
                  {m.deeplink && (
                    <a href={m.deeplink} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 hover:text-ink/80">
                      <ExternalLink size={12} className="mr-1 inline" /> {t('open in Xaman')}
                    </a>
                  )}
                </div>
              </>
            )}
            {m.status === 'signed' && (
              <Pill tone="success">
                <Check size={12} /> {t('signed')}
              </Pill>
            )}
            {m.status === 'rejected' && <Pill tone="danger">{t('rejected / expired')}</Pill>}
            {m.status === 'error' && <Pill tone="danger">{m.error ?? t('error')}</Pill>}
            {phase === 'signing' && m.status !== 'signed' && m.status !== 'creating' && (
              <GhostButton onClick={() => void resetMember(m.account)}>
                <RefreshCw size={12} /> {t('New QR')}
              </GhostButton>
            )}
          </li>
        ))}
      </ul>

      {phase === 'signing' && (
        <PrimaryButton onClick={() => void submit()} disabled={!quorumMet}>
          <Send size={14} /> {quorumMet ? t('Combine & broadcast') : t('Waiting for the quorum…')}
        </PrimaryButton>
      )}

      {phase === 'submitting' && (
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={14} className="animate-spin" /> {t('Combining the signatures and broadcasting from your browser…')}
        </p>
      )}

      {result && (
        <div className="space-y-1">
          {result.engine === 'tesSUCCESS' ? (
            <InlineNotice tone="success">{t('Broadcast — the ledger accepted it.')}</InlineNotice>
          ) : (
            <InlineNotice tone="warning">
              {result.engine} — {result.message}
            </InlineNotice>
          )}
          {result.hash && (
            <a href={`${XRPSCAN_TX}${result.hash}`} target="_blank" rel="noreferrer" className="text-sm text-ink/60 underline">
              {t('View on XRPScan')}
            </a>
          )}
        </div>
      )}

      {error && <InlineNotice tone="warning">{error}</InlineNotice>}
    </Card>
  );
}

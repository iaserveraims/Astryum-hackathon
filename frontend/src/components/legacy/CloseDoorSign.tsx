'use client';

/**
 * CloseDoorSign — the single-signature hand-off for disabling the master key.
 *
 * Closing the door is the ONE Legacy operation the council quorum CANNOT do:
 * XRPL requires the account's own master key to sign asfDisableMaster (a
 * multi-signature is rejected with tecNEED_MASTER_KEY). So this is a plain
 * single signature by the Legacy account itself.
 *
 * It deliberately does NOT depend on which wallet is "connected" in Astryum: it
 * composes the Xaman payload for the exact unsigned tx (Account preserved, never
 * overwritten) and shows the QR. Whoever holds the Legacy account's master key
 * scans it; Xaman submits (submit:true) and returns the tx hash. Astryum never
 * signs, never holds a key, never broadcasts server-side.
 *
 * It uses the same /api/xaman/create-payload path the multisig coordinator uses
 * (proven to render a QR), NOT the sign-in / connect flow — so it does not
 * inherit that flow's connection requirements.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { GhostButton, Pill, PrimaryButton } from '../ui/primitives';
import { InlineNotice } from './InlineNotice';
import { useT } from '../../i18n/LanguageProvider';
import { awaitValidation } from '../../lib/xrpl/councilSigning';

const XRPSCAN_TX = 'https://xrpscan.com/tx/';

type Phase = 'idle' | 'creating' | 'waiting' | 'done' | 'error';

async function pollStatus(uuid: string): Promise<{
  signed?: boolean;
  cancelled?: boolean;
  expired?: boolean;
  txid?: string;
  dispatched?: string;
}> {
  try {
    const res = await fetch(`/api/xaman/status/${uuid}`);
    if (!res.ok) return {};
    const data = await res.json();
    return {
      signed: data?.meta?.signed,
      cancelled: data?.meta?.cancelled,
      expired: data?.meta?.expired,
      txid: data?.response?.txid,
      dispatched: data?.response?.dispatched_result,
    };
  } catch {
    return {};
  }
}

export default function CloseDoorSign({
  xrplTx,
  onSettled,
  onCancel,
}: {
  xrplTx: Record<string, unknown>;
  onSettled?: (hash: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [qrPng, setQrPng] = useState<string | undefined>();
  const [deeplink, setDeeplink] = useState<string | undefined>();
  const [txid, setTxid] = useState<string | undefined>();
  const [dispatched, setDispatched] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const uuidRef = useRef<string | undefined>(undefined);

  const start = useCallback(async () => {
    setPhase('creating');
    setError(null);
    try {
      // Account is PRESERVED (unlike XamanWalletService.submitTransaction, which
      // overwrites it with the connected wallet) — this must sign AS the Legacy
      // account, not whatever wallet happens to be active.
      const res = await fetch('/api/xaman/create-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txjson: xrplTx,
          options: { submit: true, expire: 1440 },
          custom_meta: {
            identifier: `closedoor-${Date.now().toString(36)}`,
            blob: { purpose: 'LEGACY_DISABLE_MASTER' },
          },
        }),
      });
      if (!res.ok) throw new Error(`Xaman payload failed (${res.status})`);
      const data = await res.json();
      uuidRef.current = data.uuid;
      setQrPng(data.refs?.qr_png);
      setDeeplink(data.next?.always);
      setPhase('waiting');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }, [xrplTx]);

  // Poll until the master-key holder signs (or cancels / expires).
  useEffect(() => {
    if (phase !== 'waiting') return;
    const id = setInterval(async () => {
      if (!uuidRef.current) return;
      const st = await pollStatus(uuidRef.current);
      if (st.signed) {
        setTxid(st.txid);
        setDispatched(st.dispatched);
        setPhase('done');
        if (st.txid) {
          // Xaman's "signed" is not the ledger's word — this very tx type
          // failed VALIDATED with tecNEED_MASTER_KEY in the family's history.
          // Upgrade `dispatched` to the final result and only tell the parent
          // the door closed when the ledger says so.
          const v = await awaitValidation(st.txid);
          if (v.validated) setDispatched(v.finalResult);
          if (v.validated && v.finalResult === 'tesSUCCESS') onSettled?.(st.txid);
        }
      } else if (st.cancelled || st.expired) {
        setError(t('The signature was cancelled or expired in Xaman.'));
        setPhase('error');
      }
    }, 3000);
    return () => clearInterval(id);
  }, [phase, onSettled, t]);

  if (phase === 'idle') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={() => void start()}>
          <KeyRound size={14} /> {t('Sign with the master key in Xaman')}
        </PrimaryButton>
        {onCancel && <GhostButton onClick={onCancel}>{t('Back')}</GhostButton>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink/55">
        {t(
          'Scan this with the Xaman that holds this account’s master key. You do not need to connect any wallet here — the request is for this account only, and only its master key can sign it.',
        )}
      </p>

      {phase === 'creating' && (
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={14} className="animate-spin" /> {t('Preparing the Xaman request…')}
        </p>
      )}

      {phase === 'waiting' && (
        <div className="flex flex-wrap items-center gap-4">
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrPng} alt={t('Xaman QR')} className="h-40 w-40 rounded bg-white p-1.5" />
          ) : (
            <div className="grid h-40 w-40 place-items-center rounded bg-ink/5 px-4 text-center text-[12px] text-ink/50">
              {t('QR unavailable — use “Open in Xaman”.')}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Pill tone="warning">
              <Loader2 size={12} className="animate-spin" /> {t('waiting for the master key signature')}
            </Pill>
            {deeplink && (
              <a href={deeplink} target="_blank" rel="noreferrer" className="text-[12px] text-ink/55 hover:text-ink/80">
                <ExternalLink size={12} className="mr-1 inline" /> {t('Open in Xaman')}
              </a>
            )}
            {onCancel && <GhostButton onClick={onCancel}>{t('Cancel')}</GhostButton>}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-1">
          {/* No dispatch result is NOT success — "signed" only means Xaman got
              the signature. Green needs the ledger's word (unearned-success
              discipline; this very tx type failed validated with
              tecNEED_MASTER_KEY in the family's own history). */}
          {dispatched === 'tesSUCCESS' ? (
            <InlineNotice tone="success">{t('Signed and submitted — the door is closing.')}</InlineNotice>
          ) : !dispatched ? (
            <InlineNotice tone="warning">
              {t('Signed — but Xaman reported no submission result yet. Check the account on the explorer before assuming the door closed.')}
            </InlineNotice>
          ) : (
            <InlineNotice tone="warning">
              {t('Xaman submitted it but the ledger returned')} {dispatched}.
            </InlineNotice>
          )}
          {txid && (
            <a href={`${XRPSCAN_TX}${txid}`} target="_blank" rel="noreferrer" className="text-sm text-ink/60 underline">
              {t('View on XRPScan')}
            </a>
          )}
        </div>
      )}

      {phase === 'error' && error && (
        <div className="space-y-2">
          <InlineNotice tone="warning">{error}</InlineNotice>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => void start()}>
              <KeyRound size={14} /> {t('Try again')}
            </PrimaryButton>
            {onCancel && <GhostButton onClick={onCancel}>{t('Back')}</GhostButton>}
          </div>
        </div>
      )}
    </div>
  );
}

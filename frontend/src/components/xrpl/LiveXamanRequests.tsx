'use client';

/**
 * LiveXamanRequests — the Xaman requests whose screen went away.
 *
 * Mounted ONCE in the authenticated app layout. It renders what
 * `lib/xaman/liveRequests` holds and no mounted component is showing:
 *   · a request still open in Xaman (its surface unmounted without a verdict):
 *     «sign or cancel it in Xaman», and «Cancel it here» through the same
 *     `cancelPayloadAndDecide` round trip as every other surface — a refusal
 *     (ALREADY_OPENED) or no answer keeps it listed WITH the sentence;
 *   · one SIGNED whose ledger result is being read: it stays until the
 *     ledger answers, and then says what it said — validated, failed, refused /
 *     stale, or «could not confirm — check the hash». Never «done» on Xaman's word;
 *   · one whose outcome could not be read before the watch gave up.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, Smartphone, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { XRPSCAN_TX } from '../../lib/xrpl/councilSigning';
import { payloadStrayNotice, strayStateOf } from '../../lib/xaman/payloadBus';
import {
  bannerRequests,
  cancelLiveRequest,
  deliversToFlareAutomatically,
  dismissLiveNotice,
  dismissLiveRequest,
  flareInstructionDeliveryWord,
  isCouncilOrderTx,
  isFlareInstructionTx,
  isOpenLiveRequest,
  listLiveNotices,
  listLiveRequests,
  liveNoticeCountdown,
  subscribeLiveNotices,
  subscribeLiveRequests,
  type LiveNotice,
  type LiveXamanRequest,
} from '../../lib/xaman/liveRequests';
import { staleSentence } from '../../lib/xrpl/singleSignVerdict';
import { releaseHandoffSeatResult } from '../../lib/wallet/handoffRelease';

const EMPTY: LiveXamanRequest[] = [];
const NO_NOTICES: LiveNotice[] = [];

/**
 * THE COUNTDOWN THAT DID NOT COUNT.
 *
 * The banner printed the server's `secondsLeft` VERBATIM and the notice never
 * expired, so «it frees itself in about 287 seconds» was still on screen five
 * minutes after the seat had freed itself. A number that does not move is worse
 * than no number: it is a promise the person watches rot, and it sends them to
 * wait for something that already happened.
 */
function NoticeRow({ n }: { n: LiveNotice }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const ticking = n.freesAt !== undefined;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking, n.id]);
  const { secondsLeft, expired } = liveNoticeCountdown(n, now);
  // Server-measured (`freesInSeconds`) vs the client's fallback constant: the
  // second one is an estimate and says so, and neither is frozen any more.
  const measured = n.freesInSeconds !== undefined;
  /**
   * WHAT AN UNMEASURED REFUSAL MAY SAY.
   *
   * With a 503 nothing was read: not that the seat is held, not that it is free,
   * not how long anything has. So there is no countdown and, above all, no
   * «its window has passed» five minutes later — the sentence that contradicted
   * the card beside it, where «prepare it again» is refused for this very case.
   * What there IS, is a retry: the same release, asked again.
   */
  const retry = async () => {
    if (!n.memoHex || retrying) return;
    setRetrying(true);
    try {
      // The result pushes its own notice (this one is replaced by memo), so
      // there is nothing to read here — only the door to press again.
      await releaseHandoffSeatResult(n.memoHex);
      dismissLiveNotice(n.id);
    } catch {
      /* the notice stays; the person may press again */
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {n.unreadable
              ? t('We could not check the seat of the unsigned 0xFE')
              : t('Could not release the seat of the unsigned 0xFE')}
          </span>
        </p>
        <button type="button" onClick={() => dismissLiveNotice(n.id)} className="shrink-0 text-amber-200/60 hover:text-amber-100" aria-label={t('Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-amber-200/80">
        {n.detail}.{' '}
        {n.unreadable
          ? t('Nothing was changed. We will not tell you the seat is free and we will not tell you it is taken either — we could not look.')
          : expired
            ? t('Its signing window has passed, so the seat should be free now — preparing this one again is worth a try. The seat is not reserved for you: if it answers that the seat is taken, something else took it first.')
            : secondsLeft !== null
              ? measured
                ? `${t('It frees itself in')} ${secondsLeft} ${t('seconds — preparing it again before then may answer that the seat is taken.')}`
                : `${t('It frees itself in about')} ${secondsLeft} ${t('seconds — preparing it again before then may answer that the seat is taken.')}`
              : t('It frees itself when its seat expires — preparing it again before then may answer that the seat is taken.')}
      </p>
      {n.unreadable && n.memoHex && (
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/40 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-300/10 disabled:opacity-50"
        >
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Try again')}
        </button>
      )}
    </div>
  );
}

function HashLink({ txid }: { txid?: string }) {
  if (!txid) return null;
  return (
    <a href={`${XRPSCAN_TX}${txid}`} target="_blank" rel="noopener noreferrer" className="block break-all font-mono text-[10.5px] text-sky-300 underline underline-offset-2 hover:text-sky-200">
      {txid}
    </a>
  );
}

function Notice({
  r,
  icon,
  heading,
  children,
}: {
  r: LiveXamanRequest;
  icon: ReactNode;
  heading: string;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-100">
          {icon}
          <span>
            {heading}: <span className="font-normal">{r.title}</span>
          </span>
        </p>
        <button type="button" onClick={() => dismissLiveRequest(r.uuid)} className="shrink-0 text-amber-200/60 hover:text-amber-100" aria-label={t('Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
      <HashLink txid={r.txid} />
    </div>
  );
}

function RequestRow({ r }: { r: LiveXamanRequest }) {
  const { t } = useT();
  const stray = strayStateOf(r.cancelUi);
  // Only what the server TOOK ON — never the tx syntax alone.
  const order = deliversToFlareAutomatically(r.txKey);
  // A council order the server did not take on delivering: nobody relays it once
  // its screen is gone, so the banner says exactly that.
  const undeliveredOrder = !order && isCouncilOrderTx(r.txKey);
  // The same prudence for a 0xFE (R2 2.6): its handoff is persisted, but
  // only a RUNNING executor sweeps the Core Vault, and the banner used to promise
  // delivery from the transaction's syntax alone — exactly when nobody delivers.
  const undeliveredInstruction = !order && isFlareInstructionTx(r.txKey);
  // The prudent sentence is an ACCUSATION («nothing confirmed it
  // is running»), and it was printed over every institutional exit only because
  // no 0xFE route sends `executorEnabled` at all. It now speaks only when the
  // server actually said the executor is stopped; when nobody said, the wording
  // is neutral — «do NOT sign it again» never depended on that field.
  const instructionWord = flareInstructionDeliveryWord(r.txKey);
  const deliverySentence = t('Signed — Astryum delivers the order to Flare automatically once the ledger validates it.');
  const undeliveredSentence = t('Do NOT sign it again. The server did not take on delivering this order to Flare — keep this screen open until the order reaches Flare, or relay it by hash.');
  const stoppedExecutorSentence = t('Do NOT sign it again. The server said its executor is not running, so nothing is carrying this instruction to Flare right now — follow the operation on its own screen before doing anything again.');
  const unknownExecutorSentence = t('Do NOT sign it again. Follow this instruction on the screen that prepared it: that screen shows whether it reached Flare.');
  const notDelivered = undeliveredOrder
    ? undeliveredSentence
    : undeliveredInstruction
      ? (instructionWord === 'stopped' ? stoppedExecutorSentence : unknownExecutorSentence)
      : null;

  if (r.state === 'validating') {
    return (
      <div className="space-y-1.5">
        <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-100">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>
            {t('Signed in Xaman — waiting for the ledger')}: <span className="font-normal">{r.title}</span>
          </span>
        </p>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {order
            ? deliverySentence
            : (notDelivered ?? t('The screen that asked for it was closed; the ledger result is being read here. Do NOT sign it again.'))}
        </p>
        <HashLink txid={r.txid} />
      </div>
    );
  }

  if (r.state === 'validated') {
    return (
      <Notice r={r} icon={<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-success" />} heading={t('Validated on the ledger')}>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {order
            ? t('Astryum delivers the order to Flare automatically — nothing else to sign.')
            : (notDelivered ?? t('The ledger validated it with success. Nothing else to sign.'))}
        </p>
      </Notice>
    );
  }

  if (r.state === 'failed') {
    const sentence =
      r.failure === 'stale'
        ? // A council order says what became of the ORDER first: a
          // sibling request may already be on its way — never a blind «prepare again».
          t(staleSentence(r.fate))
        : r.failure === 'refused'
          ? t('The network refused this transaction before it entered a ledger. Nothing moved.')
          : t('The ledger validated this transaction with a failure result, so it did not take effect and its network fee was charged. Prepare the operation again before signing.');
    const fateHash = r.fate && (r.fate.kind === 'already-out' || r.fate.kind === 'out-failed') ? r.fate.txHash : undefined;
    return (
      <Notice r={r} icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} heading={t('It did not take effect')}>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {r.fate?.kind === 'checking' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
          {sentence}
          {r.code ? ` (${r.code})` : ''}
        </p>
        {fateHash && fateHash !== r.txid ? (
          <>
            <p className="text-[10.5px] text-amber-200/60">{t('The request that went out')}:</p>
            <HashLink txid={fateHash} />
          </>
        ) : null}
      </Notice>
    );
  }

  if (r.state === 'signed') {
    return (
      <Notice r={r} icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} heading={t('Signed in Xaman — check the result')}>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {order
            ? `${deliverySentence} ${t('We could not read the ledger result here — the hash below lets you follow it.')}`
            : notDelivered
              ? `${notDelivered} ${t('We could not read the ledger result here — the hash below lets you follow it.')}`
              : r.txid
              ? t('The screen that asked for it was closed before the ledger result was read. Check this hash on the explorer before doing anything again — do NOT sign it again.')
              : t('Xaman reports it signed, but it returned no transaction hash. Check the account history before doing anything again — do NOT sign it again.')}
        </p>
      </Notice>
    );
  }

  if (r.state === 'unread') {
    return (
      <Notice r={r} icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />} heading={t('We could not read the outcome of this Xaman request')}>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          {t('Open Xaman and your account history to see whether it was signed before doing anything again.')}
        </p>
      </Notice>
    );
  }

  // 'watched': still open in Xaman.
  return (
    <div className="space-y-1.5">
      <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-100">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {t('A Xaman request is still open')}: <span className="font-normal">{r.title}</span>
        </span>
      </p>
      <p className="text-[11px] leading-relaxed text-amber-200/80">
        {stray ? payloadStrayNotice(stray, t) : t('Its screen was closed, but the request can still be signed on your phone. Sign or cancel it in Xaman — or cancel it here.')}
      </p>
      {r.cancelUi !== 'resolved' ? (
        <button
          type="button"
          onClick={() => void cancelLiveRequest(r.uuid)}
          disabled={r.cancelUi === 'cancelling'}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/30 px-2.5 py-1 text-[11px] text-amber-100 hover:border-amber-300/60 disabled:opacity-50"
        >
          {r.cancelUi === 'cancelling' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Cancel it here')}
        </button>
      ) : null}
    </div>
  );
}

export function LiveXamanRequests() {
  const all = useSyncExternalStore(subscribeLiveRequests, listLiveRequests, () => EMPTY);
  const notices = useSyncExternalStore(subscribeLiveNotices, listLiveNotices, () => NO_NOTICES);
  const shown = bannerRequests(all);
  // Signable (owned / watched) OR signed with its ledger result still being read
  // (confirming / validating): a reload would lose the only reader of either.
  const open = all.some(isOpenLiveRequest);

  // A full unload is the one thing the registry cannot survive: ask first.
  useEffect(() => {
    if (!open) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open]);

  if (shown.length === 0 && notices.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div className="pointer-events-auto w-full max-w-md space-y-3 rounded-xl border border-amber-500/35 bg-surface-1/95 p-3 shadow-2xl backdrop-blur-sm">
        {shown.map((r) => (
          <div key={r.uuid} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-2.5">
            <RequestRow r={r} />
          </div>
        ))}
        {notices.map((n) => (
          <div key={n.id} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-2.5">
            <NoticeRow n={n} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default LiveXamanRequests;

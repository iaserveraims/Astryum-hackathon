'use client';

/**
 * RequestRefusalActions — the doors a refused client request leaves open, as
 * buttons, right under the button that was refused.
 *
 * productizer it. 31 (agente C, 3) — LA PUERTA DEL DUEÑO NO LLEGABA AL DUEÑO.
 * `DELETE …/requests/:rid` (it. 27) and `DELETE …/clients/:cid/desk-payments/:pid`
 * (it. 29) existed for `curl` only: the client console had no method and no
 * button for either, `POST …/requests` named neither, and `describeRefusal`
 * printed the server's English `detail` and stopped. A person whose entry died
 * in `NO_CLIENT_ACCOUNT` read «reserved by payments still in flight» and had
 * nothing to press.
 *
 * What this renders, and only this:
 *   · one button per door the SERVER named (`withdrawableRequestIds`,
 *     `releasableDeskPaymentIds`) — never a lever the server did not offer; the
 *     DELETE behind it re-checks the journal and cedes only if nothing was signed;
 *   · a «Try again» when the refusal is retryable (a read of ours failed);
 *   · nothing at all otherwise (a signed payment is the ledger's to decide).
 *
 * Its own file, so a test can render the consumer against a real 409 body and
 * see the buttons (react-dom/server; the app's import graph pulls the wallet stack).
 */

import { useT } from '../../../i18n/LanguageProvider';
import { GhostButton, PrimaryButton } from '../../ui/primitives';
import { dropsToXrp, type RefusalDoor, type RequestRefusal } from '../../../lib/demo-exchange/api';

/** Pure: the label of a door, with the amount when the 409 listed the row. */
export function doorLabel(door: RefusalDoor, refusal: RequestRefusal['refusal'], t: (s: string) => string): string {
  const row = (refusal.inFlight ?? []).find((p) => p.id === door.id);
  const amount = row ? ` (${dropsToXrp(row.drops)} XRP)` : '';
  if (door.kind === 'request') {
    const kind = row?.kind === 'withdraw' ? t('withdrawal') : t('vault entry');
    return `${t('Take the stuck {kind} out of the queue').replace('{kind}', kind)}${amount}`;
  }
  return `${t('Release the desk reservation')}${amount}`;
}

export function RequestRefusalActions({
  refusal,
  busy,
  onOpenDoor,
  onRetry,
}: {
  refusal: RequestRefusal | null;
  busy: boolean;
  onOpenDoor: (door: RefusalDoor) => void;
  onRetry: () => void;
}) {
  const { t } = useT();
  if (!refusal) return null;
  if (refusal.doors.length === 0 && !refusal.retryable) return null;
  return (
    <div className="mt-3 space-y-2" data-testid="request-refusal-actions">
      {refusal.doors.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-ink/55">
          {t('Nothing appears signed for what is holding your XRP. Taking it out of the way moves no money: the exchange checks its record of signatures first and lets go only if nothing was signed.')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {refusal.doors.map((door) => (
          <PrimaryButton key={`${door.kind}:${door.id}`} onClick={() => onOpenDoor(door)} disabled={busy} className="py-2 text-[13px]" aria-label={doorLabel(door, refusal.refusal, t)}>
            <span data-door-kind={door.kind} data-door-id={door.id}>{doorLabel(door, refusal.refusal, t)}</span>
          </PrimaryButton>
        ))}
        {refusal.retryable ? (
          <GhostButton onClick={onRetry} disabled={busy} className="py-2 text-[13px]">{t('Try again')}</GhostButton>
        ) : null}
      </div>
    </div>
  );
}

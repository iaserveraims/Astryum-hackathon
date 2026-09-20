'use client';

/**
 * PortalRefusal — what the client portal shows when `GET /runs/for-account`
 * refused, and the one action it offers.
 *
 * productizer it. 31 (agente D, 4.2) — ITS OWN FILE, SO THE CONSUMER CAN BE
 * TESTED. The it. 29 fix made the server answer 503 `OWNERSHIP_UNREADABLE` on a
 * withdrawal when the viewer's takeover mark is dated ahead of the server's
 * clock — but the person never reached a withdrawal: the portal's first call,
 * `for-account`, read that same mark as «the takeover was just now», answered
 * `heldElsewhere: { reclaimRequired: true }`, and this screen said «the exchange
 * has to confirm it is you again with a claim code» — a founder-only remedy,
 * with no button and no retry (only the `error` phase increments `attempt`).
 * The server now answers the 503; this is the phase that catches it, and it
 * lives here (not inside ExchangeClientApp, whose import graph pulls the whole
 * wallet stack) so a test can render it against a real refusal and see the
 * button.
 *
 * Two rules, both older than this file:
 *   · «no pude leer» is NOT «no existe» (it. 21, 3.2): a retryable refusal says
 *     the read failed, nothing changed, and offers the read again;
 *   · the sentence is the server's when only the server knows the cause
 *     (`describeRefusal`, it. 31): for `OWNERSHIP_UNREADABLE` the `detail` says
 *     whether the record is dated ahead of the clock, unreadable, or the database
 *     did not answer — three different ways forward.
 */

import { EmptyState, PrimaryButton } from '../../ui/primitives';
import { useT } from '../../../i18n/LanguageProvider';
import { describeRefusal, refusalIsRetryable, type Refusal } from '../../../lib/demo-exchange/api';

export function PortalRefusal({ refusal, onRetry }: { refusal: Refusal; onRetry: () => void }) {
  const { t } = useT();
  const retryable = refusalIsRetryable(refusal);
  return (
    <EmptyState
      variant="error"
      title={retryable ? t('Your exchange could not be read right now') : t('Your exchange could not be found right now')}
      hint={describeRefusal(refusal, t)}
      action={retryable ? <PrimaryButton onClick={onRetry}>{t('Try again')}</PrimaryButton> : undefined}
    />
  );
}

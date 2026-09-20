'use client';

/**
 * PortalRefusal — what the client portal shows when `GET /runs/for-account`
 * refused, and the one action it offers.
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

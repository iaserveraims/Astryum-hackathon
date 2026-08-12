'use client';

import { Pill } from '../ui/primitives';
import type { SourceRecord } from '../../services/v1Api';
import { useT } from '../../i18n/LanguageProvider';

const TRUST_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  onchain_verified: 'success',
  oracle_verified: 'info',
  protocol_native: 'info',
  indexer_verified: 'neutral',
  aggregator: 'neutral',
  community: 'warning',
  unverified: 'danger',
};

const TRUST_LABEL: Record<string, string> = {
  onchain_verified: 'on-chain',
  oracle_verified: 'oracle',
  protocol_native: 'protocol',
  indexer_verified: 'indexer',
  aggregator: 'engine',
  community: 'community',
  unverified: 'unverified',
};

export function SourceBadge({
  source,
  compact = false,
}: {
  source: SourceRecord | undefined;
  compact?: boolean;
}) {
  if (!source) return null;
  const tone = TRUST_TONE[source.trustLevel] ?? 'neutral';
  const { t } = useT();
  const label = TRUST_LABEL[source.trustLevel] ?? source.trustLevel;
  const stale = source.stale === true;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`provider=${source.providerId} · trust=${source.trustLevel} · fetched=${source.fetchedAt}${stale ? ' · STALE' : ''}`}
    >
      <Pill tone={tone}>{compact ? label : `via ${source.providerId} · ${label}`}</Pill>
      {stale && <Pill tone="warning">{t('stale')}</Pill>}
    </span>
  );
}

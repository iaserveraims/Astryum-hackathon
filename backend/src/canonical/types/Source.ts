export type ProviderType =
  | 'chain'
  | 'oracle'
  | 'explorer'
  | 'protocol'
  | 'fasset'
  | 'wallet'
  | 'data'
  | 'engine'
  | 'security';

export type TrustLevel =
  | 'onchain_verified'
  | 'oracle_verified'
  | 'protocol_native'
  | 'indexer_verified'
  | 'aggregator'
  | 'community'
  | 'unverified';

export const TRUST_WEIGHT: Readonly<Record<TrustLevel, number>> = Object.freeze({
  onchain_verified: 7,
  oracle_verified: 6,
  protocol_native: 5,
  indexer_verified: 4,
  aggregator: 3,
  community: 2,
  unverified: 1,
});

export interface SourceRecord {
  readonly providerId: string;
  readonly providerType: ProviderType;
  readonly trustLevel: TrustLevel;
  readonly fetchedAt: string;
  readonly traceId: string;
  readonly stale?: boolean;
}

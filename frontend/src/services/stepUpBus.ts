// Tiny pub/sub so the API layer can notify a global host that a request was
// gated by a step-up lock. The host then runs the signature handshake once and
// refetches — covering reads app-wide without wiring every page individually.

export interface StepUpEvent {
  feature: string;
  action: string;
}

type Listener = (e: StepUpEvent) => void;
const listeners = new Set<Listener>();

export const stepUpBus = {
  emit(feature: string, action: string): void {
    for (const l of listeners) {
      try { l({ feature, action }); } catch { /* ignore listener errors */ }
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Map an API endpoint to the step-up feature that protects it, so the API layer
// can auto-attach a cached grant and emit the right event. Order matters
// (longest/most-specific prefixes first).
const FEATURE_BY_PREFIX: Array<[string, string]> = [
  ['/wallets/bindings', 'wallet_security'],
  ['/security/step-up', 'wallet_security'],
  ['/moneyflows', 'moneyflows'],
  ['/strategies', 'strategies'],
  ['/goals', 'goals'],
  ['/trigger-rules', 'rules_alerts'],
  ['/rules', 'rules_alerts'],
  ['/alerts', 'rules_alerts'],
  ['/tax', 'data_export'],
  ['/kyc', 'kyc'],
];

export function featureForEndpoint(endpoint: string): string | null {
  for (const [prefix, feature] of FEATURE_BY_PREFIX) {
    if (endpoint.startsWith(prefix)) return feature;
  }
  return null;
}

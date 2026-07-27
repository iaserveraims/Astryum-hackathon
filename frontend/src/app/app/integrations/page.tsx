'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Database, RefreshCw } from 'lucide-react';
import {
  integrations as integrationsApi,
  type ProviderSummary,
  type ProviderHealth,
} from '../../../services/v1Api';
import { Card, EmptyState, GhostButton, PageHeader, Pill } from '../../../components/ui/primitives';
import { SourceBadge } from '../../../components/v11/SourceBadge';
import { AuthRequired, FriendlyError, hasAuthToken, isAuthError } from '../../../lib/authError';
import { useT } from '../../../i18n/LanguageProvider';

const HEALTH_TONE: Record<ProviderHealth['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  disabled: 'neutral',
};

const TYPE_LABEL: Record<string, string> = {
  chain: 'Chain RPC',
  oracle: 'Oracle',
  explorer: 'Explorer',
  protocol: 'Protocol',
  fasset: 'FAsset',
  wallet: 'Wallet',
  data: 'Data',
  engine: 'Engine',
};

// Demo scope: this surface only shows the FLARE stack (RPC, FTSO, FAssets,
// protocol adapters, explorer…) plus Xaman as the single wallet connection.
// Every other registered provider stays in the control plane — just not listed.
const DEMO_VISIBLE_RE = /flare|ftso|fasset|fxrp|kinetic|sparkdex|firelight|sceptre|enosys|flarescan|xaman/i;

function demoVisible(p: ProviderSummary): boolean {
  if (p.type === 'wallet') return /xaman/i.test(p.id);
  return DEMO_VISIBLE_RE.test(p.id);
}

export default function IntegrationsPage() {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);

  const load = async () => {
    if (!hasAuthToken()) {
      setError('no_session');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await integrationsApi.list();
      setProviders(r.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleProbe = async (id: string) => {
    setProbing(id);
    try {
      await integrationsApi.probe(id);
      await load();
    } finally {
      setProbing(null);
    }
  };

  if (error === 'no_session') return <AuthRequired />;

  const visibleProviders = providers.filter(demoVisible);
  const grouped: Record<string, ProviderSummary[]> = {};
  for (const p of visibleProviders) {
    grouped[p.type] ??= [];
    grouped[p.type].push(p);
  }
  const order = ['chain', 'oracle', 'explorer', 'protocol', 'fasset', 'engine', 'wallet', 'data'];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Control plane"
        title="Integrations"
        subtitle="Flare connections + Xaman · Flare Mainnet 14"
        actions={
          <GhostButton onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {t('Refresh')}
          </GhostButton>
        }
      />
      {error && error !== 'no_session' && <FriendlyError message={error} />}
      {!loading && visibleProviders.length === 0 && (
        <EmptyState
          icon={<Database className="w-8 h-8 text-ink/40" />}
          title="No providers registered"
          hint="Backend control plane returned an empty registry."
        />
      )}
      {order.map((typeKey) =>
        grouped[typeKey]?.length ? (
          <section key={typeKey} className="space-y-3">
            <h2 className="text-sm font-medium text-ink/50">
              {t(TYPE_LABEL[typeKey] ?? typeKey)}
              <span className="ml-2 text-ink/30">({grouped[typeKey].length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {grouped[typeKey].map((p) => (
                <Card key={p.id} hover className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-medium text-ink">{p.id}</div>
                      <div className="text-[11px] text-ink/40 mt-0.5">{t('prio')} {p.priority}</div>
                    </div>
                    <Pill tone={HEALTH_TONE[p.health.status]}>
                      {p.health.status === 'healthy' && <CheckCircle2 className="w-3 h-3" />}
                      {p.health.status === 'degraded' && <Activity className="w-3 h-3" />}
                      {(p.health.status === 'down' || p.health.status === 'disabled') && (
                        <AlertCircle className="w-3 h-3" />
                      )}
                      {t(p.health.status)}
                    </Pill>
                  </div>
                  <SourceBadge
                    source={{
                      providerId: p.id,
                      providerType: p.type,
                      trustLevel: p.trustLevel,
                      fetchedAt: p.health.lastCheckAt,
                      traceId: '',
                    }}
                  />
                  {p.health.reason && (
                    <div className="text-xs text-ink/50 italic">{p.health.reason}</div>
                  )}
                  {p.capabilities.length > 0 && (
                    <div className="text-xs text-ink/45">
                      {p.capabilities.slice(0, 4).join(' · ')}
                      {p.capabilities.length > 4 && ` · +${p.capabilities.length - 4}`}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-ink/5">
                    <span className="text-[11px] text-ink/40">
                      {p.health.latencyMs !== undefined ? `${p.health.latencyMs}ms` : '—'}
                      {' · '}
                      {p.health.lastCheckAt
                        ? new Date(p.health.lastCheckAt).toLocaleTimeString()
                        : '—'}
                    </span>
                    <GhostButton onClick={() => void handleProbe(p.id)} disabled={probing === p.id}>
                      {probing === p.id ? t('probing…') : t('probe')}
                    </GhostButton>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

'use client';

// Admin panel — hidden page (no nav entry, reached only via /app/admin) for
// the 2 founders. Read-only: DB counts + the waitlist, so nobody needs to
// open the database directly.
//
// Access, hardened 2026-07-23: the founder types the panel key ONCE into the
// login card (captcha-gated when Turnstile is configured); the backend
// verifies it (constant-time, per-IP failure limit) and answers with a 2h
// scope-limited session token — THAT is what sessionStorage keeps and what
// travels as x-admin-session on every call. The raw key never persists
// client-side and never rides requests anymore, which shrinks what a
// phishing page or an XSS could steal. A wrong key says so; every other
// failure (403/404/network) collapses into the same sober "not available" so
// the page never reveals what exists.
//
// v2 (founder 2026-07-23): reorganized into tabs — Overview / Waitlist /
// Users / Sistema — and the waitlist separates signal from bot noise
// (isNoiseEmail, backend/src/routes/waitlist.ts). The overview always fetches
// clean rows by default; the "Show noise" toggle in the Waitlist tab is the
// ONLY thing that asks for `?includeNoise=1`, and only for the table — the
// counts and the 14-day chart stay signal-only regardless.
//
// Users tab separates OAuth users (Google/Apple) from plain-email users:
// provider badges per row, a provider filter, and per-provider counts in
// Overview — all fed by `authProviders` / `usersByProvider` from the backend.
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, Lock, RefreshCw, Search, Wrench, X } from 'lucide-react';
import {
  adminExecutorApi,
  adminPanelApi,
  platformApi,
  type AdminExecutorHealth,
  type AdminOpsAlert,
  type AdminOpsAlerts,
  type AdminOverview,
  type AdminStuckList,
  type AdminStuckTx,
  type AdminUnstickResult,
  type AdminWaitlistRow,
  type PlatformStatus,
} from '../../../services/v1Api';
import TurnstileWidget, { turnstileEnabled } from '../../../components/security/TurnstileWidget';
import { useT } from '../../../i18n/LanguageProvider';
import { getApiBase } from '../../../lib/env';
import {
  Card,
  EmptyState,
  GhostButton,
  MicroLabel,
  PageHeader,
  Pill,
  SectionTitle,
  SegmentedControl,
  StatTile,
} from '../../../components/ui/primitives';
import { MiniArea } from '../../../components/ui/charts';

const SESSION_STORE = 'astryum:adminSession';
// Pre-hardening storage of the RAW key — purge it wherever we find it.
const LEGACY_KEY_STORE = 'astryum:adminKey';
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Astryum';

type Tab = 'overview' | 'waitlist' | 'users' | 'system' | 'alerts';

// Alert level → Pill tone + short label. The three levels opsAlert() emits.
const ALERT_TONE: Record<AdminOpsAlert['level'], 'info' | 'warning' | 'danger'> = {
  info: 'info',
  warn: 'warning',
  critical: 'danger',
};
type AlertFilter = 'all' | AdminOpsAlert['level'];

// Provider slugs → badge copy. Anything unknown renders as-is.
const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
  wallet: 'Wallet',
};

function readStoredSession(): string | null {
  try {
    sessionStorage.removeItem(LEGACY_KEY_STORE);
    const raw = sessionStorage.getItem(SESSION_STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: string };
    if (!parsed?.token) return null;
    // Treat a session within 30s of expiry as gone — better to re-login than
    // to blow up mid-refresh.
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now() + 30_000) {
      sessionStorage.removeItem(SESSION_STORE);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function dropStoredSession(): void {
  try {
    sessionStorage.removeItem(SESSION_STORE);
  } catch {
    /* ignore */
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d: Date | null): string {
  if (!d) return '—';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} · ${time}`;
}

// Buckets clean signups into the last 14 calendar days (UTC date match — a
// glance chart, not a billing report). Days with zero signups still render,
// so a quiet stretch reads as a flat line rather than a gap.
function last14DaysBuckets(rows: { createdAt: string }[]): { t: string; value: number }[] {
  const days: { key: string; t: string; value: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      t: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: 0,
    });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const row of rows) {
    const bucket = byKey.get(row.createdAt.slice(0, 10));
    if (bucket) bucket.value += 1;
  }
  return days.map(({ t, value }) => ({ t, value }));
}

// A label/value line for the Sistema tab's build-and-environment card —
// the ONE row shape, reused instead of four hand-rolled flex divs.
function InfoRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <MicroLabel tone="muted">{label}</MicroLabel>
      <span className={`text-sm text-ink/80 text-right truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export default function AdminPage() {
  const { t } = useT();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  // Session-door state: null = no live session (show the login card). The
  // empty string '' is the SIWE door (2026-07-25): the logged-in account is on
  // ADMIN_EMAILS, so calls travel with the app's own bearer token and no
  // x-admin-session header — check `session != null`, never truthiness.
  const [session, setSession] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [checking, setChecking] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  // Tabs + per-tab controls.
  const [tab, setTab] = useState<Tab>('overview');
  const [showNoise, setShowNoise] = useState(false);
  const [waitlistSearch, setWaitlistSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [usersSearch, setUsersSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  // Sistema tab: the overview call doubles as the healthcheck (no separate
  // endpoint) — its own round-trip latency + when it last succeeded.
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Executor 0xFE gauges (regla fundador 2026-07-25: las métricas viven aquí,
  // no en snippets de consola). Se cargan al entrar en Sistema y con su botón.
  const [executorHealth, setExecutorHealth] = useState<AdminExecutorHealth | null>(null);
  const [executorError, setExecutorError] = useState(false);
  const [executorLoading, setExecutorLoading] = useState(false);
  // Modal de desatasco (transacciones 0xFE entrantes/salientes atascadas).
  const [unstickOpen, setUnstickOpen] = useState(false);
  const loadExecutor = useCallback((sessionToken: string) => {
    setExecutorLoading(true);
    setExecutorError(false);
    adminPanelApi
      .executor(sessionToken)
      .then(setExecutorHealth)
      .catch(() => setExecutorError(true))
      .finally(() => setExecutorLoading(false));
  }, []);
  useEffect(() => {
    if (tab === 'system' && session != null) loadExecutor(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, session]);

  // Alertas/notificaciones de operación — la bandeja persistida del backend.
  const [opsAlerts, setOpsAlerts] = useState<AdminOpsAlerts | null>(null);
  const [alertsError, setAlertsError] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const loadAlerts = useCallback((sessionToken: string) => {
    setAlertsLoading(true);
    setAlertsError(false);
    adminPanelApi
      .alerts(sessionToken)
      .then(setOpsAlerts)
      .catch(() => setAlertsError(true))
      .finally(() => setAlertsLoading(false));
  }, []);
  useEffect(() => {
    if (tab === 'alerts' && session != null) loadAlerts(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, session]);

  const load = useCallback((sessionToken: string, opts: { includeNoise?: boolean; silent?: boolean } = {}) => {
    const { includeNoise = false, silent = false } = opts;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(false);
    }
    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    adminPanelApi
      .overview(sessionToken, includeNoise)
      .then((res) => {
        if (cancelled) return;
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
        setData(res);
        setFetchedAt(new Date());
        setLatencyMs(Math.round(elapsed));
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 401) {
          // Session expired (2h TTL) or revoked config: back to the login card.
          setSession(null);
          setKeyError('expired');
          dropStoredSession();
        } else if (!silent) {
          // Never surface WHY (403 vs 404 vs network) — same sober message.
          // A SILENT refetch (toggle/refresh button) just keeps the last good
          // snapshot on screen instead of blowing the page away.
          setError(true);
        }
      })
      .finally(() => {
        if (cancelled) return;
        if (!silent) setLoading(false);
        setChecking(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      setSession(stored);
      return load(stored);
    }
    // SIWE door (2026-07-25): before showing the key card, probe the overview
    // with the app's own session — a founder account (ADMIN_EMAILS) walks
    // straight in, no key. Any failure (not logged in / not on the list /
    // panel unconfigured) falls back to the key card in silence: the page
    // keeps revealing nothing about why.
    let cancelled = false;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    adminPanelApi
      .overview('')
      .then((res) => {
        if (cancelled) return;
        const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
        setSession('');
        setData(res);
        setFetchedAt(new Date());
        setLatencyMs(Math.round(elapsed));
      })
      .catch(() => {
        /* not a founder session — the key card is the answer */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key || checking) return;
    if (turnstileEnabled() && !captchaToken) {
      setKeyError('captcha');
      return;
    }
    setChecking(true);
    setKeyError('');
    try {
      const created = await adminPanelApi.createSession(key, captchaToken);
      try {
        sessionStorage.setItem(SESSION_STORE, JSON.stringify(created));
      } catch {
        /* private mode — the tab still works until reload */
      }
      setKeyInput('');
      setSession(created.token);
      load(created.token);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      setCaptchaReset((n) => n + 1); // token consumed — mint a fresh one
      setKeyError(status === 429 ? 'throttled' : status === 403 ? 'captcha' : status === 401 ? 'wrong' : 'unavailable');
      setChecking(false);
    }
  };

  const toggleNoise = () => {
    const next = !showNoise;
    setShowNoise(next);
    if (session != null) load(session, { includeNoise: next, silent: true });
  };

  const refetch = () => {
    if (session != null) load(session, { includeNoise: showNoise, silent: true });
  };

  const sources = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.waitlist.map((r) => r.source))).sort();
  }, [data]);

  const filteredWaitlist = useMemo(() => {
    if (!data) return [];
    const q = waitlistSearch.trim().toLowerCase();
    return data.waitlist.filter((r) => {
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (!q) return true;
      return r.email.toLowerCase().includes(q) || r.source.toLowerCase().includes(q);
    });
  }, [data, waitlistSearch, sourceFilter]);

  const userProviders = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.recentUsers.flatMap((u) => u.authProviders ?? []))).sort();
  }, [data]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    const q = usersSearch.trim().toLowerCase();
    return data.recentUsers.filter((u) => {
      if (providerFilter !== 'all' && !(u.authProviders ?? []).includes(providerFilter)) return false;
      if (!q) return true;
      return (u.email ?? '').toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q);
    });
  }, [data, usersSearch, providerFilter]);

  // Always signal-only, whatever the Waitlist tab's noise toggle is doing.
  const dailySignups = useMemo(() => {
    if (!data) return [];
    return last14DaysBuckets(data.waitlist.filter((r) => !r.noise));
  }, [data]);

  // ── The login card — key in, 2h session token out ──
  // Strict null check: '' is a LIVE session (the SIWE door), not a missing one.
  if (session === null && !loading) {
    const keyErrorCopy: Record<string, string> = {
      wrong: t('That key was not accepted.'),
      expired: t('Session expired — enter the key again.'),
      throttled: t('Too many attempts. Wait a few minutes.'),
      captcha: t('Complete the anti-bot check first.'),
      unavailable: t('The panel did not answer. Try again.'),
    };
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-volt/10 text-volt">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{t('Founders panel')}</p>
              <p className="text-[12px] text-ink/45">{t('Enter the panel key to open the overview.')}</p>
            </div>
          </div>
          {keyError && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {keyErrorCopy[keyError] ?? keyErrorCopy.unavailable}
            </p>
          )}
          <form onSubmit={submitKey} className="mt-4 space-y-3">
            <input
              type="password"
              autoFocus
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={t('Panel key')}
              className="w-full rounded-lg border border-ink/10 bg-ink/[0.04] px-3 py-2.5 text-sm text-ink/90 placeholder-ink/25 focus:outline-none focus:border-volt/50"
            />
            <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} theme="auto" />
            <button
              type="submit"
              disabled={!keyInput.trim() || checking || (turnstileEnabled() && !captchaToken)}
              className="w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-volt-ink transition-all hover:brightness-105 disabled:opacity-50"
            >
              {checking ? t('Checking…') : t('Open panel')}
            </button>
          </form>
        </Card>
      </div>
    );
  }

  const copyEmails = () => {
    const emails = filteredWaitlist.filter((r) => !r.noise).map((r) => r.email);
    if (emails.length === 0) return;
    navigator.clipboard
      .writeText(emails.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Founders only"
        title="Admin overview"
        subtitle="Read-only counts and the waitlist. Nothing here writes to the database."
      />

      {loading ? (
        <EmptyState
          variant="loading"
          icon={<Loader2 className="w-6 h-6 animate-spin" />}
          title="Loading…"
        />
      ) : error || !data ? (
        <EmptyState
          variant="error"
          icon={<Lock className="w-6 h-6" />}
          title="This panel is not available for this account."
        />
      ) : (
        <>
          <SegmentedControl<Tab>
            layoutId="admin-tabs"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'overview', label: 'Overview' },
              { key: 'waitlist', label: 'Waitlist' },
              { key: 'users', label: 'Users' },
              { key: 'system', label: 'Sistema' },
              { key: 'alerts', label: 'Alertas' },
            ]}
          />

          {tab === 'overview' && (
            <div className="space-y-6">
              <section className="space-y-3">
                <SectionTitle>Counts</SectionTitle>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <StatTile label="Users" value={data.counts.users} />
                  <StatTile label="Wallets" value={data.counts.wallets} />
                  <StatTile label="Governed accounts" value={data.counts.governedAccounts} />
                  <StatTile label="Council proposals" value={data.counts.councilProposals} />
                  <StatTile
                    label="Waitlist signups"
                    value={data.counts.waitlistSignups}
                    hint="Clean — noise filtered out"
                  />
                  <StatTile
                    label="Waitlist noise"
                    value={data.counts.waitlistNoise}
                    hint="Bots — reserved/disposable domains"
                  />
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle hint="Clean signups only, by day (UTC)">Signups — last 14 days</SectionTitle>
                <Card>
                  <MiniArea points={dailySignups} formatY={(v) => `${Math.round(v)}`} />
                </Card>
              </section>

              <section className="space-y-3">
                <SectionTitle>Waitlist by source</SectionTitle>
                <Card>
                  {Object.keys(data.counts.waitlistBySource).length === 0 ? (
                    <div className="text-sm text-ink/40">{t('No signups yet.')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.counts.waitlistBySource).map(([source, n]) => (
                        <Pill key={source} tone="info">
                          {source} · {n}
                        </Pill>
                      ))}
                    </div>
                  )}
                </Card>
              </section>

              <section className="space-y-3">
                <SectionTitle hint="OAuth accounts (Google/Apple) separated from plain email and wallet-created ones">
                  Users by provider
                </SectionTitle>
                <Card>
                  {Object.keys(data.counts.usersByProvider ?? {}).length === 0 ? (
                    <div className="text-sm text-ink/40">{t('No users yet.')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.counts.usersByProvider).map(([provider, n]) => (
                        <Pill key={provider} tone={provider === 'google' || provider === 'apple' ? 'info' : 'neutral'}>
                          {PROVIDER_LABEL[provider] ?? provider} · {n}
                        </Pill>
                      ))}
                    </div>
                  )}
                </Card>
              </section>
            </div>
          )}

          {tab === 'waitlist' && (
            <section className="space-y-3">
              <SectionTitle
                hint="Clean by default. 'Show noise' audits what the blocklist caught."
                actions={
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
                      <input
                        value={waitlistSearch}
                        onChange={(e) => setWaitlistSearch(e.target.value)}
                        placeholder={t('Search email or source…')}
                        className="pl-8 pr-3 py-1.5 rounded-lg border border-ink/10 bg-ink/[0.03] text-xs text-ink/80 placeholder-ink/30 focus:outline-none focus:border-volt/50 w-48"
                      />
                    </div>
                    <select
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      className="rounded-lg border border-ink/10 bg-ink/[0.03] px-2.5 py-1.5 text-xs text-ink/70 focus:outline-none focus:border-volt/50"
                    >
                      <option value="all">{t('All sources')}</option>
                      {sources.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={toggleNoise}
                      disabled={refreshing}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                        showNoise
                          ? 'bg-volt/15 text-volt border-volt/30'
                          : 'border-ink/10 bg-ink/[0.03] text-ink/60 hover:text-ink/80'
                      }`}
                    >
                      {showNoise ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {t('Show noise')}
                    </button>
                    <button
                      onClick={copyEmails}
                      disabled={filteredWaitlist.filter((r) => !r.noise).length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink/10 bg-ink/[0.03] text-ink/80 text-xs hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {copied ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copied ? t('Copied!') : t('Copy emails')}
                    </button>
                  </div>
                }
              >
                Waitlist
              </SectionTitle>
              <Card padded={false} className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-ink/25 bg-ink/[0.045]">
                      <tr>
                        <th className="text-left py-3 px-5 font-medium">{t('Email')}</th>
                        <th className="text-left py-3 px-4 font-medium">{t('Source')}</th>
                        <th className="text-left py-3 px-4 font-medium">{t('Language')}</th>
                        <th className="text-left py-3 px-4 font-medium">{t('Created')}</th>
                        <th className="text-left py-3 px-5 font-medium">{t('Flag')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/[0.04]">
                      {filteredWaitlist.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-ink/20 text-sm">
                            {t('No signups yet.')}
                          </td>
                        </tr>
                      ) : (
                        filteredWaitlist.map((row: AdminWaitlistRow) => (
                          <tr key={row.email} className="hover:bg-ink/[0.04] transition-colors">
                            <td className="py-3 px-5 text-ink/80 text-xs font-mono">{row.email}</td>
                            <td className="py-3 px-4">
                              <Pill tone="neutral">{row.source}</Pill>
                            </td>
                            <td className="py-3 px-4 text-ink/60 text-xs">{row.lang ?? '—'}</td>
                            <td className="py-3 px-4 text-ink/60 text-xs">{fmtDate(row.createdAt)}</td>
                            <td className="py-3 px-5">
                              {row.noise ? (
                                <Pill tone="neutral" size="sm" className="opacity-60">
                                  {t('noise')}
                                </Pill>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {tab === 'users' && (
            <section className="space-y-3">
              <SectionTitle
                hint="Provider = how the account signs in. OAuth (Google/Apple) apart from plain email."
                actions={
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
                      <input
                        value={usersSearch}
                        onChange={(e) => setUsersSearch(e.target.value)}
                        placeholder={t('Search email…')}
                        className="pl-8 pr-3 py-1.5 rounded-lg border border-ink/10 bg-ink/[0.03] text-xs text-ink/80 placeholder-ink/30 focus:outline-none focus:border-volt/50 w-48"
                      />
                    </div>
                    <select
                      value={providerFilter}
                      onChange={(e) => setProviderFilter(e.target.value)}
                      className="rounded-lg border border-ink/10 bg-ink/[0.03] px-2.5 py-1.5 text-xs text-ink/70 focus:outline-none focus:border-volt/50"
                    >
                      <option value="all">{t('All providers')}</option>
                      {userProviders.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABEL[p] ?? p}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              >
                Recent users
              </SectionTitle>
              <Card padded={false} className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-ink/25 bg-ink/[0.045]">
                      <tr>
                        <th className="text-left py-3 px-5 font-medium">{t('Email')}</th>
                        <th className="text-left py-3 px-4 font-medium">{t('Provider')}</th>
                        <th className="text-left py-3 px-4 font-medium">{t('Created')}</th>
                        <th className="text-left py-3 px-5 font-medium">{t('Last login')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink/[0.04]">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-ink/20 text-sm">
                            {t('No users yet.')}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u, i) => (
                          <tr key={`${u.email ?? 'unknown'}-${i}`} className="hover:bg-ink/[0.04] transition-colors">
                            <td className="py-3 px-5 text-ink/80 text-xs font-mono">{u.email ?? '—'}</td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1.5">
                                {(u.authProviders ?? ['email']).map((p) => (
                                  <Pill key={p} tone={p === 'google' || p === 'apple' ? 'info' : 'neutral'} size="sm">
                                    {PROVIDER_LABEL[p] ?? p}
                                  </Pill>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-ink/60 text-xs">{fmtDate(u.createdAt)}</td>
                            <td className="py-3 px-5 text-ink/60 text-xs">{fmtDate(u.lastLogin)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {tab === 'system' && (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="space-y-3">
                <SectionTitle>Build & environment</SectionTitle>
                <Card>
                  <InfoRow label="App" value={APP_NAME} />
                  <InfoRow label="API base" value={getApiBase()} mono />
                  <InfoRow label="Snapshot taken" value={fmtDateTime(fetchedAt)} />
                </Card>
              </section>

              <section className="space-y-3">
                <SectionTitle
                  actions={
                    <GhostButton onClick={refetch} disabled={refreshing} className="px-3 py-1.5 text-xs gap-1.5">
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                      {t('Refetch')}
                    </GhostButton>
                  }
                >
                  Backend
                </SectionTitle>
                <Card>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        error ? 'bg-red-400' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                      }`}
                      aria-hidden
                    />
                    <span className="text-sm text-ink">{error ? t('Unreachable') : t('Online')}</span>
                  </div>
                  <div className="mt-2 text-xs text-ink/45 font-mono">
                    {latencyMs != null ? `${latencyMs} ms` : '—'} · GET /admin-panel/overview
                  </div>
                  <p className="mt-3 text-xs text-ink/40 leading-relaxed">
                    {t('No dedicated healthcheck — this pings the same overview call the panel already needs.')}
                  </p>
                </Card>
              </section>

              {/* Astryum Orbit System — the light the Summary card shows every
                  user (founder 2026-07-25): flip it to Offline with a
                  hand-written reason while working on the ship. */}
              <section className="space-y-3 md:col-span-2">
                <SectionTitle>Astryum Orbit System</SectionTitle>
                <PlatformStatusControl session={session} />
              </section>
            </div>

            {/* ── Executor 0xFE — gauges de solvencia (Tramo 1; regla fundador
                2026-07-25: las métricas viven aquí, no en la consola). Todo es
                información on-chain pública o booleanos de config. ── */}
            <section className="mt-4 space-y-3">
              <SectionTitle
                actions={
                  <div className="flex items-center gap-2">
                    <GhostButton
                      onClick={() => setUnstickOpen(true)}
                      disabled={session == null}
                      className="px-3 py-1.5 text-xs gap-1.5"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      {t('Unstick transactions')}
                    </GhostButton>
                    <GhostButton
                      onClick={() => session != null && loadExecutor(session)}
                      disabled={executorLoading}
                      className="px-3 py-1.5 text-xs gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${executorLoading ? 'animate-spin' : ''}`} />
                      {t('Refetch')}
                    </GhostButton>
                  </div>
                }
              >
                Executor 0xFE
              </SectionTitle>
              {executorError ? (
                <Card>
                  <p className="text-sm text-ink/50">{t('Not available right now.')}</p>
                </Card>
              ) : !executorHealth ? (
                <Card>
                  <Loader2 className="w-4 h-4 animate-spin text-ink/40" />
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatTile
                      label="FLR"
                      value={Number(executorHealth.flrBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    />
                    <StatTile
                      label="FXRP"
                      value={Number(executorHealth.fxrpBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    />
                    <StatTile
                      label={t('Defenses covered today')}
                      value={executorHealth.defensesCoveredToday?.effective ?? '—'}
                    />
                    <StatTile
                      label={t('Fee margin (over cost)')}
                      value={
                        executorHealth.feeMargin?.marginPct != null
                          ? `${executorHealth.feeMargin.marginPct.toFixed(1)}%`
                          : '—'
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <InfoRow label={t('Address')} value={executorHealth.executor ?? '—'} mono />
                      <InfoRow
                        label={t('FDC budget (24h window)')}
                        value={`${Number(executorHealth.dailyFeeBudget?.spentFLR ?? 0).toFixed(1)} / ${executorHealth.dailyFeeBudget?.budgetFLR ?? '—'} FLR`}
                        mono
                      />
                      <InfoRow
                        label={t('Coverage by budget · by wallet')}
                        value={`${executorHealth.defensesCoveredToday?.byBudget ?? '—'} · ${executorHealth.defensesCoveredToday?.byWallet ?? '—'}`}
                        mono
                      />
                      <InfoRow label={t('Pending · parked')} value={`${executorHealth.pendingCount} · ${executorHealth.parked?.length ?? 0}`} mono />
                      <InfoRow label={t('Last tick')} value={fmtDateTime(executorHealth.lastTickAt ? new Date(executorHealth.lastTickAt) : null)} />
                    </Card>
                    <Card>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <Pill tone={executorHealth.enabled ? 'success' : 'neutral'}>{executorHealth.enabled ? 'executor ON' : 'executor OFF'}</Pill>
                        <Pill tone={executorHealth.refuelEnabled ? 'success' : 'neutral'}>{executorHealth.refuelEnabled ? 'refuel ON' : 'refuel OFF'}</Pill>
                        <Pill tone={executorHealth.sweepArmed ? 'success' : 'warning'}>{executorHealth.sweepArmed ? 'sweep armado' : 'sweep SIN armar'}</Pill>
                        <Pill tone={executorHealth.alertWebhookConfigured ? 'success' : 'warning'}>
                          {executorHealth.alertWebhookConfigured ? 'alertas ON' : 'alertas SIN webhook'}
                        </Pill>
                      </div>
                      <InfoRow
                        label={t('Last refuel')}
                        value={
                          executorHealth.lastRefuel ? (
                            executorHealth.lastRefuel.swapTxHash ? (
                              <a
                                href={`https://flarescan.com/tx/${executorHealth.lastRefuel.swapTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-volt hover:underline"
                              >
                                {executorHealth.lastRefuel.stage}
                              </a>
                            ) : (
                              executorHealth.lastRefuel.stage
                            )
                          ) : (
                            '—'
                          )
                        }
                      />
                      {executorHealth.lastRefuel?.detail && (
                        <p className="text-[11px] text-ink/40 leading-relaxed mb-1">{executorHealth.lastRefuel.detail}</p>
                      )}
                      <InfoRow
                        label={t('Last sweep')}
                        value={executorHealth.lastSweep ? `${executorHealth.lastSweep.amountFXRP} FXRP` : '—'}
                        mono
                      />
                      {executorHealth.feeMargin && (
                        <p className="mt-2 text-[11px] text-ink/40 leading-relaxed">
                          {t('Fee')} {executorHealth.feeMargin.execFeeXrp ?? '—'} XRP · {t('cost')} ~{executorHealth.feeMargin.costFlr} FLR ·{' '}
                          {t('warns below')} {executorHealth.feeMargin.warnBelowPct}%
                        </p>
                      )}
                    </Card>
                  </div>
                </>
              )}
            </section>

            {unstickOpen && session != null && (
              <UnstickModal
                session={session}
                onClose={() => setUnstickOpen(false)}
                onChanged={() => loadExecutor(session)}
              />
            )}
            </>
          )}

          {tab === 'alerts' && (
            <div className="space-y-6">
              <section className="space-y-3">
                <SectionTitle
                  hint={t('Executor, watchers and provider health — kept even without a webhook')}
                >
                  <div className="flex items-center gap-2">
                    <span>{t('Alerts & notifications')}</span>
                    <GhostButton
                      onClick={() => session != null && loadAlerts(session)}
                      disabled={alertsLoading || session == null}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${alertsLoading ? 'animate-spin' : ''}`} />
                    </GhostButton>
                  </div>
                </SectionTitle>

                {alertsError ? (
                  <Card>
                    <div className="text-sm text-ink/40">{t('Could not load alerts.')}</div>
                  </Card>
                ) : !opsAlerts ? (
                  <Card>
                    <div className="flex items-center gap-2 text-sm text-ink/40">
                      <Loader2 className="w-4 h-4 animate-spin" /> {t('Loading…')}
                    </div>
                  </Card>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <StatTile label={t('Critical')} value={opsAlerts.counts.critical} />
                      <StatTile label={t('Warnings')} value={opsAlerts.counts.warn} />
                      <StatTile label={t('Info')} value={opsAlerts.counts.info} />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['all', 'critical', 'warn', 'info'] as AlertFilter[]).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setAlertFilter(f)}
                          className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                            alertFilter === f
                              ? 'border-volt/40 bg-volt/[0.10] text-volt'
                              : 'border-ink/10 text-ink/50 hover:text-ink/70'
                          }`}
                        >
                          {f === 'all' ? t('All') : f === 'warn' ? t('Warnings') : f === 'critical' ? t('Critical') : t('Info')}
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const shown =
                        alertFilter === 'all'
                          ? opsAlerts.alerts
                          : opsAlerts.alerts.filter((a) => a.level === alertFilter);
                      if (shown.length === 0) {
                        return (
                          <Card>
                            <div className="text-sm text-ink/40">
                              {opsAlerts.alerts.length === 0
                                ? t('No alerts yet — the executor and watchers have been quiet.')
                                : t('Nothing at this severity.')}
                            </div>
                          </Card>
                        );
                      }
                      return (
                        <Card padded={false} className="overflow-hidden divide-y divide-ink/5">
                          {shown.map((a) => (
                            <div key={a.id} className="p-3 flex items-start gap-3">
                              <Pill tone={ALERT_TONE[a.level]} size="sm">
                                {a.level === 'warn' ? 'WARN' : a.level.toUpperCase()}
                              </Pill>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-ink/80 leading-snug break-words">{a.message}</p>
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-ink/40">
                                  <span className="font-mono">{a.source}</span>
                                  <span>·</span>
                                  <span>{fmtDateTime(new Date(a.at))}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </Card>
                      );
                    })()}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Astryum Orbit System control (Sistema tab) ──────────────────────────────
// The switch behind the Summary's status card: Online ⇄ Offline plus the
// hand-written reason users read while we work (founder 2026-07-25). Writes
// via PUT /api/platform/status under the SAME panel session as everything
// else; reads the public GET so what the founder sees here is exactly what
// users see on the card.
function PlatformStatusControl({ session }: { session: string | null }) {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let alive = true;
    platformApi
      .status()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setReason(s.reason ?? '');
      })
      .catch(() => {
        if (alive) setUnreachable(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const apply = (state: 'online' | 'offline') => {
    if (session == null || saving) return;
    setSaving(true);
    setSaveError(false);
    adminPanelApi
      .setPlatformStatus(session, state, state === 'offline' ? reason : undefined)
      .then((s) => {
        setStatus(s);
        setReason(s.reason ?? '');
      })
      .catch(() => setSaveError(true))
      .finally(() => setSaving(false));
  };

  const offline = status?.state === 'offline';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full ${
            unreachable
              ? 'bg-amber-400'
              : offline
                ? 'bg-red-400'
                : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
          }`}
          aria-hidden
        />
        <span className="text-sm text-ink">
          {unreachable ? 'Sin lectura' : offline ? 'Offline' : 'Online'}
        </span>
        {status?.updatedAt && (
          <span className="text-xs text-ink/35 font-mono">{fmtDate(status.updatedAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <GhostButton
            onClick={() => apply('online')}
            disabled={saving || session == null || (!offline && !unreachable)}
            className="px-3 py-1.5 text-xs"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Online'}
          </GhostButton>
          <GhostButton
            onClick={() => apply('offline')}
            disabled={saving || session == null || offline}
            className="px-3 py-1.5 text-xs"
          >
            Offline
          </GhostButton>
        </div>
      </div>
      <label className="mt-3 block">
        <span className="text-xs text-ink/45">
          Motivo (los usuarios lo leen en la card del Summary mientras estemos offline)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Mantenimiento de servidores — volvemos en breve."
          className="mt-1.5 w-full rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-sm text-ink placeholder:text-ink/25 focus:outline-none focus:ring-2 focus:ring-volt/50"
        />
      </label>
      {offline && (
        <p className="mt-2 text-xs text-ink/40">
          Para actualizar el motivo estando offline, edítalo y vuelve a pulsar Offline.
        </p>
      )}
      {saveError && <p className="mt-2 text-xs text-red-400">No se pudo guardar — ¿sesión caducada?</p>}
    </Card>
  );
}

// ── Desatasco del executor 0xFE — el modal de la pestaña Sistema ─────────────
// Lista los dispatches atascados (pendientes con contador de reintentos +
// aparcados con su motivo), etiquetados entrante/saliente por la acción del
// prepare que los construyó, y ofrece las DOS únicas palancas del operador:
// Reintentar (des-aparca + barrido inmediato si el watcher está libre) y
// Aparcar (cero reintentos, cero coste). Nada de esto firma nada — lo
// ejecutable sigue siendo exactamente el Payment que el usuario firmó.
const DIRECTION_LABEL: Record<AdminStuckTx['direction'], string> = {
  entrante: 'Entrante',
  saliente: 'Saliente',
  otra: 'Interna',
  desconocida: 'Sin etiqueta',
};
const DIRECTION_TONE: Record<AdminStuckTx['direction'], 'success' | 'warning' | 'info' | 'neutral'> = {
  entrante: 'success',
  saliente: 'warning',
  otra: 'info',
  desconocida: 'neutral',
};

function UnstickModal({
  session,
  onClose,
  onChanged,
}: {
  session: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [data, setData] = useState<AdminStuckList | null>(null);
  const [error, setError] = useState(false);
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AdminUnstickResult | null>(null);

  const load = useCallback(() => {
    setError(false);
    adminExecutorApi
      .stuck(session)
      .then(setData)
      .catch(() => setError(true));
  }, [session]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (hash: string, op: 'retry' | 'park') => {
    setBusyHash(hash);
    setLastResult(null);
    try {
      const r = await adminExecutorApi.unstick(session, { hash, op });
      setLastResult(r);
      load();
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusyHash(null);
    }
  };

  const row = (tx: AdminStuckTx, kind: 'pending' | 'parked') => (
    <div key={tx.hash} className="p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={DIRECTION_TONE[tx.direction]} size="sm">
          {t(DIRECTION_LABEL[tx.direction])}
        </Pill>
        {tx.action && <span className="text-[11px] font-mono text-ink/50">{tx.action}</span>}
        <a
          href={`https://livenet.xrpl.org/transactions/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-mono text-volt hover:underline"
        >
          {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
        </a>
        <span className="ml-auto">
          <GhostButton
            onClick={() => act(tx.hash, kind === 'parked' ? 'retry' : 'park')}
            disabled={busyHash != null}
            className="px-2.5 py-1 text-[11px]"
          >
            {busyHash === tx.hash ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : kind === 'parked' ? (
              t('Retry')
            ) : (
              t('Park')
            )}
          </GhostButton>
        </span>
      </div>
      <div className="text-[11px] text-ink/45 flex items-center gap-2 flex-wrap">
        {tx.xrp != null && <span className="font-mono">{tx.xrp} XRP</span>}
        {tx.account && (
          <span className="font-mono">
            {tx.account.slice(0, 8)}…{tx.account.slice(-4)}
          </span>
        )}
        {tx.dateISO && <span>{fmtDateTime(new Date(tx.dateISO))}</span>}
        {kind === 'pending' && (tx.failures ?? 0) > 0 && (
          <span>
            {t('failures')}: {tx.failures}
          </span>
        )}
        {kind === 'pending' && tx.nextAttemptISO && (
          <span>
            {t('next retry')}: {fmtDateTime(new Date(tx.nextAttemptISO))}
          </span>
        )}
      </div>
      {kind === 'parked' && tx.reason && (
        <p className="text-[11px] text-ink/50 leading-relaxed break-words">{tx.reason}</p>
      )}
      {kind === 'parked' && tx.source === 'permanent' && (
        <p className="text-[11px] text-amber-300/80 leading-relaxed">
          {t(
            'Unexecutable bytes: retrying re-parks it at zero cost — the real fix is a re-prepare + a fresh user signature (the XRP waits safely at the Core Vault).',
          )}
        </p>
      )}
      {kind === 'parked' && tx.source === 'skip-list' && (
        <p className="text-[11px] text-amber-300/80 leading-relaxed">
          {t('On FLARE_EXECUTOR_SKIP_TXS (Railway env) — remove it there too, or the next sweep parks it again.')}
        </p>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5 sticky top-0 bg-surface-1 z-10">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Unstick transactions')}</h2>
            <p className="mt-0.5 text-xs text-ink/45">
              {t('0xFE dispatches — incoming (deposits) and outgoing (withdrawals/claims). Retry never signs anything.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <GhostButton onClick={load} className="px-2.5 py-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
            </GhostButton>
            <button onClick={onClose} className="text-ink/40 hover:text-ink/70 transition-colors" aria-label={t('Close')}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error ? (
            <p className="text-sm text-ink/50">{t('Not available right now.')}</p>
          ) : !data ? (
            <div className="flex items-center gap-2 text-sm text-ink/40 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('Loading…')}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={data.watcher.enabled && data.watcher.hasKey ? 'success' : 'danger'}>
                  {data.watcher.enabled && data.watcher.hasKey ? 'watcher ON' : 'watcher OFF'}
                </Pill>
                {data.watcher.running && <Pill tone="info">{t('sweep in progress')}</Pill>}
                <span className="text-[11px] text-ink/40 self-center">
                  {t('Last tick')}: {fmtDateTime(data.watcher.lastTickAt ? new Date(data.watcher.lastTickAt) : null)}
                </span>
              </div>

              {lastResult && (
                <div className="rounded-xl border border-volt/25 bg-volt/5 px-3 py-2 text-xs text-ink/70 leading-relaxed">
                  <span className="font-mono">{lastResult.hash.slice(0, 10)}…</span> · {lastResult.detail}
                </div>
              )}

              <section className="space-y-2">
                <MicroLabel tone="muted">
                  {t('Parked')} ({data.parked.length}) — {t('no retries, no cost, until you hit Retry')}
                </MicroLabel>
                {data.parked.length === 0 ? (
                  <Card>
                    <p className="text-xs text-ink/40">{t('Nothing parked — no dispatch needed rescuing.')}</p>
                  </Card>
                ) : (
                  <Card padded={false} className="overflow-hidden divide-y divide-ink/5">
                    {data.parked.map((tx) => row(tx, 'parked'))}
                  </Card>
                )}
              </section>

              <section className="space-y-2">
                <MicroLabel tone="muted">
                  {t('Pending')} ({data.pending.length}) — {t('the watcher retries these on its own; Park stops one')}
                </MicroLabel>
                {data.pending.length === 0 ? (
                  <Card>
                    <p className="text-xs text-ink/40">{t('No pending dispatches waiting for the executor.')}</p>
                  </Card>
                ) : (
                  <Card padded={false} className="overflow-hidden divide-y divide-ink/5">
                    {data.pending.map((tx) => row(tx, 'pending'))}
                  </Card>
                )}
              </section>

              <p className="text-[11px] text-ink/35 leading-relaxed">
                {t(
                  "The pending list comes from the watcher's last Core Vault sweep — if the watcher is OFF it can be stale. A parked dispatch survives redeploys; the user's XRP always waits at the Core Vault until its exact signed bytes execute.",
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * V1 API client (Sprint S4.2) — single file with the 8 service modules the
 * spec calls for. Each module is exported separately so callers can import
 * just what they need:
 *
 *   import { portfolioV1, risk, positions, transactions, rules, alerts,
 *            aiV1, protocolsV1, points } from '@/services/v1Api';
 *
 * All requests carry `Authorization: Bearer <jwt>` from localStorage.auth_token.
 * All write endpoints respect the V1 chainGuard middleware (chainId=14 only).
 */

import { getApiBase } from '../lib/env';
import { isPreviewActive, previewGet, previewPost } from './previewData';

const API_BASE = getApiBase();

function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Clear local auth state and redirect to /login when a 401 is received.
 * Idempotent across concurrent 401s in the same tab: only the first call
 * performs the redirect; subsequent calls are no-ops so we don't trigger
 * navigation while React is still rendering with stale state.
 */
let unauthorizedHandled = false;
function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  if (unauthorizedHandled) return;
  unauthorizedHandled = true;
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('defibro-auth-storage');
  } catch {}
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
}

async function jget<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  if (isPreviewActive()) {
    const fixture = previewGet(path);
    if (fixture !== undefined) return new Promise((res) => setTimeout(() => res(fixture as T), 160));
  }
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const r = await fetch(`${API_BASE}${path}${qs}`, { headers: authHeader() });
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body?.error ?? `http_${r.status}`), {
      status: r.status,
      body,
    });
  }
  return r.json();
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  if (isPreviewActive()) {
    const fixture = previewPost(path, body);
    if (fixture !== undefined) return new Promise((res) => setTimeout(() => res(fixture as T), 200));
  }
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j?.error ?? `http_${r.status}`), { status: r.status, body: j });
  }
  return r.json();
}

async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    throw new Error(`http_${r.status}`);
  }
  return r.json();
}

async function jdel(path: string): Promise<void> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (!r.ok && r.status !== 204) {
    if (r.status === 401) handleUnauthorized();
    throw new Error(`http_${r.status}`);
  }
}

// ============================================================================
// 1. portfolioV1Service — /api/portfolio/*
// ============================================================================

export interface PortfolioBreakdown {
  byProtocol: Record<string, number>;
  byAsset: Record<string, number>;
  byKind: Record<string, number>;
}

/** Per-position risk metrics computed by the protocol adapters (backend
 *  PositionMetrics — SnapshotBuilder ships them with every position). */
export interface PositionMetrics {
  hf?: number;
  ltv?: number;
  /** Collateral price at which this position's account liquidates. */
  liquidationPrice?: number;
  inRange?: boolean;
  ilEstimated?: number;
  pendingRewards?: number;
  apy?: number;
  extras?: Record<string, unknown>;
}

/** One position leg of the portfolio snapshot (backend PortfolioPositionEntry).
 *  The index signature keeps room for provider-specific extras. */
export interface PortfolioPosition {
  protocolId: string;
  chainId?: number;
  kind: string;
  asset: string;
  amount?: string;
  amountUSD?: number;
  priceUSD?: number;
  metrics?: PositionMetrics;
  metadata?: Record<string, unknown>;
  takenAt?: string;
  /** Stamped by the frontend merge when aggregating several wallets. */
  wallet?: string;
  [extra: string]: unknown;
}

export interface PortfolioSnapshot {
  wallet: string;
  chainId: number;
  totalUSD: number;
  collateralUSD: number;
  debtUSD: number;
  netWorthUSD: number;
  positions: PortfolioPosition[];
  breakdown: PortfolioBreakdown;
  takenAt: string;
}

export const portfolioV1 = {
  get: (address: string, chainId = 14) =>
    jget<PortfolioSnapshot>('/portfolio', { address, chainId, includeExternal: 'true' }),
  latestSnapshot: (address: string, chainId = 14) =>
    jget<PortfolioSnapshot>('/portfolio/snapshot/latest', { address, chainId }),
  forceSnapshot: (address: string, chainId = 14) =>
    jpost<PortfolioSnapshot>('/portfolio/snapshot', { address, chainId, includeExternal: true }),
  breakdown: (address: string, chainId = 14) =>
    jget<{ wallet: string; totalUSD: number; breakdown: PortfolioBreakdown; takenAt: string }>(
      '/portfolio/breakdown',
      { address, chainId }
    ),
  history: (address: string, chainId = 14, from?: string, to?: string) =>
    jget<{ count: number; points: { takenAt: string; totalUSD: number }[] }>('/portfolio/history', {
      address,
      chainId,
      from,
      to,
    }),
};

// ============================================================================
// 1b. networkStatus — /api/network/status (public chain telemetry)
// ============================================================================

export interface NetworkStatus {
  flare: { ok: boolean; gasGwei?: number; blockNumber?: number };
  xrpl: { ok: boolean; baseFeeXrp?: number; openLedgerFeeXrp?: number; ledgerIndex?: number };
  takenAt: string;
}

export const networkApi = {
  status: () => jget<NetworkStatus>('/network/status'),
};

// ============================================================================
// 1c. platformStatus — /api/platform/status (Astryum Orbit System light)
// ============================================================================

export interface PlatformStatus {
  state: 'online' | 'offline';
  /** Hand-written by the founders while offline (maintenance, incident…). */
  reason: string | null;
  updatedAt: string | null;
}

export const platformApi = {
  status: () => jget<PlatformStatus>('/platform/status'),
};

// ============================================================================
// 2. riskService — /api/risk/*
// ============================================================================

export interface RiskSnapshot {
  scope: 'POSITION' | 'PORTFOLIO';
  scopeId: string;
  healthFactor?: number;
  ltv?: number;
  liquidationDistanceUSD?: number;
  liquidationDistancePct?: number;
  /** Exact collateral price at which the position liquidates ("if XRP touches $X"). */
  liquidationPriceUSD?: number;
  collateralBufferUSD?: number;
  riskLevel: 'SAFE' | 'WATCH' | 'WARNING' | 'DANGER' | 'CRITICAL';
  riskScore: number;
  warnings: string[];
  assumptions: string[];
  drivers: { name: string; contribution: number }[];
  computedAt: string;
}

export const risk = {
  portfolio: (address: string, chainId = 14) =>
    jget<RiskSnapshot>('/risk/portfolio', { address, chainId }),
  position: (positionId: string, address: string, chainId = 14) =>
    jget<RiskSnapshot>(`/risk/positions/${positionId}`, { address, chainId }),
  marketDrop: (address: string, dropPct: number, chainId = 14, asset?: string) =>
    jpost<{ before: RiskSnapshot; after: RiskSnapshot; newHFsByPosition: any[]; computedAt: string }>(
      '/risk/simulate-market-drop',
      { address, chainId, dropPct, asset }
    ),
};

// ============================================================================
// 3. positionsService — /api/positions/*
// ============================================================================

export const positions = {
  byWallet: (wallet: string) => jget<any>(`/positions/${wallet}`),
  byProtocol: (protocol: string, wallet: string) =>
    jget<any>(`/positions/${protocol}/${wallet}`),
};

// ============================================================================
// 4. transactionsService — /api/transactions
// ============================================================================

export interface TransactionRecord {
  id: string;
  intentId: string;
  walletAddress: string;
  chainId: number;
  txHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  blockNumber?: string | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  error?: string | null;
  createdAt: string;
  confirmedAt?: string | null;
}

export const transactions = {
  list: (address: string) =>
    jget<{ count: number; records: TransactionRecord[] }>('/transactions', { address }),
};

// ============================================================================
// 5. rulesService — /api/rules/*
// ============================================================================

export interface AutomationRule {
  id: string;
  walletId: string;
  name: string;
  trigger: any;
  action: any;
  /** CanonicalMoneyFlow id — set when the rule was compiled from a CMF (F1). */
  canonicalRef?: string | null;
  enabled: boolean;
  cooldownMinutes: number;
  maxValueUSD: number;
  totalTimesTriggered: number;
  lastTriggeredAt?: string | null;
  /** Enforced TTL (ISO) — mandatory (≤90d, server-clamped) for MoneyFlow and council rules. */
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const rules = {
  list: (address: string) =>
    jget<{ count: number; rules: AutomationRule[] }>('/rules', { address }),
  create: (input: {
    walletAddress: string;
    chainId?: number;
    name: string;
    trigger: any;
    action?: any;
    cooldownMinutes?: number;
    maxValueUSD?: number;
    enabled?: boolean;
    canonicalRef?: string;
    expiresAt?: string;
  }) => jpost<AutomationRule>('/rules', input),
  update: (id: string, body: Partial<AutomationRule>) => jpatch<AutomationRule>(`/rules/${id}`, body),
  enable: (id: string) => jpost<AutomationRule>(`/rules/${id}/enable`, {}),
  disable: (id: string) => jpost<AutomationRule>(`/rules/${id}/disable`, {}),
  delete: (id: string) => jdel(`/rules/${id}`),
  runs: (id: string) => jget<{ count: number; runs: any[] }>(`/rules/${id}/runs`),
};

// ============================================================================
// 5b. moneyflowsService — /api/moneyflows/* (F1 — CanonicalMoneyFlow)
//
// READ/TRANSLATE ONLY: `translate` is a deterministic dry-run (CMF in → the
// exact AutomationRule payloads out, or readable errors); creation still goes
// through rules.create above, one call per translated rule. Kept in sync with
// backend/src/canonical/moneyflow/CanonicalMoneyFlow.ts.
// ============================================================================

export interface CmfAsset {
  symbol: string;
  chain?: string;
  address?: string;
}

export type CmfTrigger =
  | { kind: 'health-factor'; comparator: 'below' | 'above'; threshold: number; positionRef?: string }
  | { kind: 'ltv'; comparator: 'above'; threshold: number }
  | { kind: 'price'; asset: CmfAsset; comparator: 'below' | 'above'; threshold: number }
  | { kind: 'reward'; minUsd: number }
  | { kind: 'idle-balance'; asset: CmfAsset; minUsd: number }
  | { kind: 'time'; cron: string };

export type CmfAmount =
  | { type: 'absolute'; value: string }
  | { type: 'percent-of-position'; pct: number }
  | { type: 'to-target'; target: 'hf'; value: number };

export interface CmfAction {
  verb: string;
  asset: CmfAsset;
  amount?: CmfAmount;
  venue?: { protocolId?: string; positionId?: string; params?: Record<string, unknown> };
}

export interface CmfStep {
  level: number;
  trigger: CmfTrigger;
  actions: CmfAction[];
}

export interface CanonicalMoneyFlow {
  version: 'cmf/0.1';
  id: string;
  name: string;
  description: string;
  direction: 'protect' | 'expand' | 'bidirectional';
  origin: { source: 'user' | 'ai_copilot'; conversationRef?: string };
  steps: CmfStep[];
  policy: {
    maxAmountPerTriggerUsd?: number;
    cooldownMinutes: number;
    expiry?: string;
    disclosedToUser: true;
  };
}

export interface CmfRulePayload {
  chainId: number;
  name: string;
  trigger: any;
  action: { kind: string; protocolId?: string; positionId?: string; params?: Record<string, unknown> };
  cooldownMinutes: number;
  maxValueUSD: number;
  canonicalRef: string;
  /** Enforced TTL (ISO): policy.expiry clamped server-side to ≤90 days. */
  expiresAt: string;
}

export interface CmfTranslation {
  ok: true;
  chain: string;
  mode: string;
  rules: CmfRulePayload[];
  notes: string[];
}

export const moneyflows = {
  /** Deterministic dry-run: CMF → AutomationRule payloads. 422 = readable errors. */
  translate: (cmf: CanonicalMoneyFlow, chainId = 14) =>
    jpost<CmfTranslation>('/moneyflows/translate', { cmf, chainId }),
  /** A wallet's rules grouped by canonicalRef (one entry per flow). */
  list: (address: string) =>
    jget<{ count: number; flows: Array<{ canonicalRef: string; name: string; enabled: boolean; rules: AutomationRule[] }> }>(
      '/moneyflows',
      { address },
    ),
  /** The honest per-chain capability matrix (what translates TODAY). */
  capability: () => jget<{ chains: any[] }>('/moneyflows/capability'),
  /** Curated markets an APY rule can watch, with their LIVE supply APY + source. */
  apyMarkets: () =>
    jget<{ markets: Array<{ address: string; label: string; supplyAprPct: number | null; source: string }> }>(
      '/moneyflows/apy-markets',
    ),
  /** Flow-level revocation (guardarraíl: instantánea, del dueño). */
  pauseFlow: (canonicalRef: string, address: string) =>
    jpost<{ ok: true; paused: number }>(`/moneyflows/${encodeURIComponent(canonicalRef)}/pause`, { address }),
  resumeFlow: (canonicalRef: string, address: string) =>
    jpost<{ ok: true; resumed: number; expiredSkipped: number }>(
      `/moneyflows/${encodeURIComponent(canonicalRef)}/resume`,
      { address },
    ),
  deleteFlow: (canonicalRef: string, address: string) =>
    jdel(`/moneyflows/${encodeURIComponent(canonicalRef)}?address=${encodeURIComponent(address)}`),
};

// ============================================================================
// 6. alertsService — /api/alerts/*
// ============================================================================

export interface Alert {
  id: string;
  userId: string;
  walletId?: string | null;
  type: string;
  priority: string;
  severity: string;
  triggerType?: string | null;
  title: string;
  message: string;
  data?: any;
  acknowledged: boolean;
  automationRunId?: string | null;
  timestamp: string;
}

export const alerts = {
  list: (address: string, unread?: boolean) =>
    jget<{ count: number; alerts: Alert[] }>('/alerts', { address, unread: unread ? 1 : undefined }),
  markRead: (id: string) => jpatch<Alert>(`/alerts/${id}/read`, {}),
};

// ============================================================================
// 7. aiV1Service — /api/ai/v1/*
// ============================================================================

export interface AIResponse {
  summary: string;
  riskAssessment?: {
    level: string;
    score: number;
    drivers: { name: string; contribution: number }[];
    explanation: string;
  };
  recommendations?: {
    kind: string;
    protocolId?: string;
    asset?: string;
    amountUSD?: number;
    reason: string;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    simulationResultId?: string;
  }[];
  confidence: number;
  dataTimestamp: string;
  warnings: string[];
}

export const aiV1 = {
  chat: (walletAddress: string, message: string, chainId = 14) =>
    jpost<AIResponse>('/ai/v1/chat', { walletAddress, message, chainId }),
  explainRisk: (walletAddress: string, chainId = 14) =>
    jpost<AIResponse>('/ai/v1/explain-risk', { walletAddress, chainId }),
  recommendActions: (walletAddress: string, chainId = 14) =>
    jpost<AIResponse>('/ai/v1/recommend-actions', { walletAddress, chainId }),
  explainIntent: (intentId: string) =>
    jpost<AIResponse>('/ai/v1/explain-intent', { intentId }),
};

// ============================================================================
// 8. protocolsV1Service — read-only protocol catalog
// ============================================================================

export const protocolsV1 = {
  /** Lists protocols + their isActive status. Backend resolves from Prisma + env. */
  list: () => jget<{ count: number; protocols: any[] }>('/protocols'),
};

// ============================================================================
// 9. pointsService — /api/points/* (Sprint S5, defined now for typing)
// ============================================================================

export interface PointsAccount {
  totalPoints: number;
  power: number;
  credits: number;
  level: number;
  nextLevelAt?: number;
}

export interface PointsLedgerEntry {
  id: string;
  eventType: string;
  pointsDelta: number;
  powerDelta: number;
  creditsDelta: number;
  reason: string;
  createdAt: string;
}

export const points = {
  me: () => jget<PointsAccount>('/points/me'),
  ledger: (limit = 50) =>
    jget<{ count: number; entries: PointsLedgerEntry[] }>('/points/ledger', { limit }),
  badges: () => jget<{ earned: any[]; locked: any[] }>('/points/badges'),
  levels: () => jget<{ levels: any[] }>('/points/levels'),
  claimOnboarding: () => jpost<PointsLedgerEntry>('/points/claim-onboarding', {}),
  convertPowerToCredits: (power: number) =>
    jpost<PointsAccount>('/points/convert-power-to-credits', { power }),
};

// ============================================================================
// 10. V1.1 Control Plane — integrations / activity / rewards / mandates / policy
// ============================================================================

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'down' | 'disabled';
  latencyMs?: number;
  lastCheckAt: string;
  reason?: string;
}

export interface ProviderSummary {
  id: string;
  type: 'chain' | 'oracle' | 'explorer' | 'protocol' | 'fasset' | 'wallet' | 'data' | 'engine';
  trustLevel:
    | 'onchain_verified'
    | 'oracle_verified'
    | 'protocol_native'
    | 'indexer_verified'
    | 'aggregator'
    | 'community'
    | 'unverified';
  priority: number;
  capabilities: ReadonlyArray<string>;
  health: ProviderHealth;
}

export interface SourceRecord {
  providerId: string;
  providerType: string;
  trustLevel: string;
  fetchedAt: string;
  traceId: string;
  stale?: boolean;
}

export interface CanonicalActivityEvent {
  id: string;
  wallet: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  type:
    | 'swap'
    | 'supply'
    | 'borrow'
    | 'repay'
    | 'withdraw'
    | 'stake'
    | 'unstake'
    | 'claim'
    | 'transfer'
    | 'approve'
    | 'addLiquidity'
    | 'removeLiquidity'
    | 'other';
  protocol?: string;
  source: SourceRecord;
}

export interface CanonicalRewardEvent {
  id: string;
  wallet: string;
  source: 'ftso' | 'flaredrop' | 'protocol' | 'staking' | 'lp_fees';
  providerId: string;
  asset: { symbol: string; address: string; decimals: number; priceUSD: number | null };
  amount: string;
  amountUSD: number;
  blockNumber: number;
  claimedAt: string | null;
  sourceRecord: SourceRecord;
}

export interface CanonicalPosition {
  id: string;
  wallet: string;
  chainId: number;
  protocol: string;
  kind: 'collateral' | 'debt' | 'lp' | 'staking' | 'reward' | 'free';
  assets: ReadonlyArray<{ asset: { symbol: string }; amount: string; amountUSD: number }>;
  metrics?: {
    healthFactor?: number;
    ltv?: number;
    liquidationPriceUSD?: number;
    inRange?: boolean;
    apy?: number;
    impermanentLossPct?: number;
  };
  source: SourceRecord;
}

export interface Mandate {
  id: string;
  userId: string;
  schemaVersion: '1.0';
  active: boolean;
  scope: {
    allowedProtocols: string[];
    allowedChains: number[];
    allowedAssets: string[];
    allowedActions: string[];
    forbiddenActions: string[];
  };
  limits: {
    maxTxValueUSD: number;
    maxDailyValueUSD: number;
    maxMonthlyValueUSD: number;
    maxSlippageBps: number;
    minHealthFactorAfter?: number;
    maxRiskScoreAfter?: number;
  };
  approvals: { requireManualApprovalAboveUSD: number };
  expiresAt?: string;
  createdAt: string;
}

export const integrations = {
  list: () => jget<{ providers: ProviderSummary[] }>('/integrations'),
  get: (id: string) => jget<ProviderSummary>(`/integrations/${id}`),
  byCapability: (capability: string) =>
    jget<{ capability: string; providers: ProviderSummary[] }>(
      `/integrations/by-capability/${encodeURIComponent(capability)}`,
    ),
  probe: (id: string) =>
    jpost<{ id: string; health: ProviderHealth }>(`/integrations/${id}/probe`, {}),
};

export const activity = {
  timeline: (params: {
    wallet: string;
    from?: string;
    to?: string;
    types?: string;
    limit?: number;
    offset?: number;
    refresh?: boolean;
  }) =>
    jget<{ wallet: string; count: number; events: CanonicalActivityEvent[] }>(
      '/activity',
      params as unknown as Record<string, string | number | undefined>,
    ),
  refresh: (wallet: string) =>
    jpost<{ wallet: string; written: number }>('/activity/refresh', { wallet }),
};

export const rewards = {
  list: (params: {
    wallet: string;
    source?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    refresh?: boolean;
  }) =>
    jget<{ wallet: string; count: number; events: CanonicalRewardEvent[] }>(
      '/rewards',
      params as unknown as Record<string, string | number | undefined>,
    ),
  refresh: (wallet: string) =>
    jpost<{ wallet: string; written: number }>('/rewards/refresh', { wallet }),
};

export const positionsCanonical = {
  byWallet: (wallet: string) =>
    jget<{
      wallet: string;
      chainId: number;
      positions: CanonicalPosition[];
      source: SourceRecord;
    }>('/positions/canonical', { wallet }),
};

export const mandates = {
  active: () => jget<{ mandate: Mandate; isDefault: boolean }>('/mandates/active'),
  save: (partial: Partial<Mandate>) => jpost<{ mandate: Mandate }>('/mandates', partial),
};

export interface PolicyCheckResult {
  passed: boolean;
  blocked: boolean;
  blockReason?: string;
  manualApprovalRequired: boolean;
  errors: ReadonlyArray<{ code: string; message: string }>;
  warnings: ReadonlyArray<string>;
  evaluatedAt: string;
  mandateId?: string;
}

export const policy = {
  check: (body: Record<string, unknown>) =>
    jpost<{ traceId: string; result: PolicyCheckResult }>('/policy/check', body),
};

// ============================================================================
// 11. watchlistService — /api/watchlist (S2)
// ============================================================================

export interface WatchlistEntry {
  id: string;
  address: string;
  chainId: number;
  label: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

export const watchlist = {
  list: () => jget<{ entries: WatchlistEntry[] }>('/watchlist'),
  add: (address: string, chainId: number, label?: string) =>
    jpost<{ entry: WatchlistEntry }>('/watchlist', { address, chainId, label }),
  remove: (id: string) => jdel(`/watchlist/${id}`),
  sync: (id: string) => jpost<{ result: { watchlistId: string; interactions: number; positions: number } }>(`/watchlist/${id}/sync`, {}),
};

// ============================================================================
// 12. capitalMapService — /api/capital/* (S3)
// ============================================================================

export interface CapitalAsset {
  symbol: string;
  totalValueUSD: number;
  chains: number[];
  protocols: string[];
}

export interface CapitalKindEntry {
  kind: string;
  positionCount: number;
  totalValueUSD: number;
}

export interface CapitalMap {
  userId: string;
  walletCount: number;
  totalPositions: number;
  totalInteractions: number;
  estimatedTotalValueUSD: number;
  byChain: { chainId: number; positionCount: number; estimatedValueUSD: number }[];
  byProtocol: {
    protocol: string;
    chainId: number;
    positionCount: number;
    totalValueUSD: number;
    confidenceLevel: string;
    contractTypes: string[];
  }[];
  byAsset: CapitalAsset[];
  byKind: CapitalKindEntry[];
  topPositions: {
    id: string;
    walletAddress: string;
    chainId: number;
    protocol: string;
    contractType: string;
    asset: string;
    valueUSD: number;
    confidenceLevel: string;
    sourceProvider: string;
  }[];
  riskScore: number | null;
  dataQualityNote: string;
  source: { providerId: string; trustLevel: string; fetchedAt: string; confidenceCaveat: string };
}

export interface CapitalSyncResult {
  synced: number;
  positionsFound: number;
  providers: string[];
  zerionAvailable: boolean;
  syncedAt: string;
}

export const capitalMap = {
  map: () => jget<CapitalMap>('/capital/map'),
  positions: () => jget<{ positions: any[]; source: object }>('/capital/positions'),
  interactions: (limit = 50) =>
    jget<{ interactions: any[]; source: object }>('/capital/interactions', { limit }),
  sync: () => jpost<CapitalSyncResult>('/capital/sync', {}),
};

// ============================================================================
// 13. swapService — /api/swap/* (S9 — 1inch + integrator fee)
// ============================================================================

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  estimatedGas: string;
  priceImpactPct: number | null;
  platformFee: { bps: number; recipientWallet: string; disclosed: true };
  tx: { to: string; data: string; value: string; gas: string };
  source: { providerId: string; trustLevel: string; fetchedAt: string };
  disclosure: string;
}

export interface PreparedSwap {
  quote: SwapQuote;
  walletIntent: {
    id: string;
    walletAddress: string;
    chainId: number;
    to: string;
    calldata: string;
    value: string;
    gasLimit: string;
    status: string;
    note: string | null;
    fee: string | null;
    expiresAt: string;
    defibro: { signed: false; custodied: false };
  };
  disclosure: string;
}

export const swap = {
  quote: (params: {
    chainId: number;
    fromToken: string;
    toToken: string;
    amount: string;
    fromAddress: string;
    slippageBps?: number;
  }) =>
    jget<SwapQuote>('/swap/quote', params as unknown as Record<string, string | number | undefined>),
  prepare: (body: {
    walletAddress: string;
    chainId: number;
    fromToken: string;
    toToken: string;
    amount: string;
    slippageBps?: number;
  }) => jpost<PreparedSwap>('/swap/prepare', body),
};

// ============================================================================
// 14. addressBookService — /api/address-book (P6)
// ============================================================================

export interface AddressBookEntry {
  id: string;
  label: string;
  address: string;
  chainId?: number | null;
  ens?: string | null;
  createdAt: string;
}

export const addressBookService = {
  list: (chainId?: number) =>
    jget<{ entries: AddressBookEntry[] }>('/address-book', chainId != null ? { chainId } : {}),
  add: (data: { label: string; address: string; chainId?: number; ens?: string }) =>
    jpost<{ entry: AddressBookEntry }>('/address-book', data),
  update: (id: string, data: { label?: string; ens?: string }) =>
    jpatch<{ entry: AddressBookEntry }>(`/address-book/${id}`, data),
  remove: (id: string) => jdel(`/address-book/${id}`),
};

// ============================================================================
// 14. taxService — /api/tax/* (S6)
// ============================================================================

export interface TaxEventRow {
  id: string;
  eventType: string;
  assetIn: string;
  amountIn: string;
  assetOut: string;
  amountOut: string;
  fiatValueEstimate: string;
  fiatCurrency: string;
  fee: string | null;
  feeAsset: string | null;
  partnerOrderId: string | null;
  transactionHash: string | null;
  source: string;
  userVerified: boolean;
  timestamp: string;
}

// Automated fiscal classification (Blockpit primary / Koinly deep-link fallback).
export interface TaxJurisdictionForm {
  code: string;
  name: string;
  description: string;
  authority: string;
}
export interface TaxJurisdiction {
  code: string;
  country: string;
  taxAuthority: string;
  currency: string;
  forms: TaxJurisdictionForm[];
  categories: { code: string; label: string; formCode: string; examples: string }[];
}
export interface TaxProviderStatus {
  id: string;
  displayName: string;
  mode: 'api' | 'deeplink';
  configured: boolean;
  jurisdictions: string[];
  disclosureText: string;
  deepLinkBase?: string;
}
export interface ClassifiedTaxEvent {
  id: string;
  timestamp: string;
  category: string;
  categoryLabel: string;
  formCode: string;
  eventType: string;
  assetIn: string;
  amountIn: string;
  assetOut: string;
  amountOut: string;
  fiatValue: string;
  fiatCurrency: string;
  gainLoss: string | null;
  chain: string;
  txHash: string | null;
  walletAddress: string;
}
export interface TaxFormSummary {
  formCode: string;
  formName: string;
  eventCount: number;
  totalGainLoss: string;
  totalIncome: string;
  fiatCurrency: string;
}
export interface TaxSyncResult {
  configured: boolean;
  mode: 'api' | 'deeplink' | 'none';
  addresses: { address: string; chain: string }[];
  provider?: TaxProviderStatus;
  deepLink?: string | null;
  jurisdiction?: TaxJurisdiction;
  events?: ClassifiedTaxEvent[];
  summary?: TaxFormSummary[];
  disclaimer?: string;
  message?: string;
  source?: { providerId: string; providerName: string; classifiedByProvider: boolean; fetchedAt: string };
}

export const taxService = {
  events: (params?: { from?: string; to?: string; eventType?: string; limit?: number }) =>
    jget<{ events: TaxEventRow[]; total: number; disclaimer: string }>(
      '/tax/events',
      params as unknown as Record<string, string | number | undefined>,
    ),
  exportUrl: (format: 'csv' | 'json' | 'xlsx') =>
    `${API_BASE}/tax/export/${format}`,
  provider: (jurisdiction = 'ES') =>
    jget<{ provider: TaxProviderStatus; jurisdiction: TaxJurisdiction; available: TaxProviderStatus[] }>(
      '/tax/provider',
      { jurisdiction },
    ),
  sync: (body?: { jurisdiction?: string; taxYear?: number }) =>
    jpost<TaxSyncResult>('/tax/sync', body ?? {}),
};

// ============================================================================
// 15. triggerRulesService — /api/trigger-rules (S5)
// ============================================================================

export interface TriggerRule {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  conditionType: string;
  conditionParams: Record<string, unknown>;
  cooldownMinutes: number;
  lastFiredAt: string | null;
  timesTriggered: number;
  createdAt: string;
}

export const triggerRulesApi = {
  list: () => jget<{ rules: TriggerRule[]; note: string }>('/trigger-rules'),
  create: (body: {
    name: string;
    conditionType: string;
    conditionParams: Record<string, unknown>;
    description?: string;
    cooldownMinutes?: number;
    notificationTemplate?: string;
  }) => jpost<TriggerRule>('/trigger-rules', body),
  toggle: (id: string, enabled: boolean) =>
    jpatch<TriggerRule>(`/trigger-rules/${id}/toggle`, { enabled }),
  delete: (id: string) => jdel(`/trigger-rules/${id}`),
};

// ============================================================================
// 16. aiChatService — /api/ai/chat (S7)
// ============================================================================

export interface AIChatResponse {
  response: string;
  contextBuiltAt: string;
  source: { providerId: string; trustLevel: string; fetchedAt: string };
  disclaimer: string;
}

export const aiChat = {
  send: (message: string) => jpost<AIChatResponse>('/ai/chat/chat', { message }),
  context: () => jget<{ context: object; note: string }>('/ai/chat/context'),
};

// ============================================================================
// 17. partnersService — /api/partners/* (S4)
// ============================================================================

export interface PartnerCapabilities {
  partners: { id: string; name: string; type: string; available: boolean; description: string }[];
}

export interface PartnerSession {
  partnerIntentId: string;
  partnerSessionId: string;
  partnerSessionUrl: string;
  expiresAt: string;
  status: string;
  compliance: { partnerExecutes: true; defibroExecutes: false; defibroCustody: false; destinationIsUserWallet: true };
}

export const partnersApi = {
  capabilities: () => jget<PartnerCapabilities>('/partners/capabilities'),
  createSession: (body: {
    asset: string;
    destinationAddress: string;
    fiatAmount?: number;
    fiatCurrency?: string;
    destinationChainId?: number;
  }) => jpost<PartnerSession>('/partners/session', body),
  getSession: (partnerIntentId: string) =>
    jget<{ intent: object; session: object | null }>(`/partners/session/${partnerIntentId}`),
};

// ============================================================================
// 17b. MoonPay Trade — B2B DeFi execution engine (/api/partners/moonpay/trade)
// Returns UNSIGNED calldata / intents. Astryum never signs, custodies or relays.
// APY is protocol data (with source), never a Astryum promise. Requires a B2B
// agreement — endpoints answer 503 PARTNER_NOT_CONFIGURED until enabled.
// ============================================================================

export type MoonPayTradeProtocol =
  | 'aave_v3' | 'morpho_blue' | 'morpho_optimizer' | 'uniswap_v3' | 'curve' | 'balancer';
export type MoonPayTradeAction =
  | 'supply' | 'borrow' | 'repay' | 'withdraw' | 'stake' | 'unstake' | 'add_liquidity' | 'remove_liquidity';

export interface MoonPayTradeQuote {
  quoteId: string;
  protocol: MoonPayTradeProtocol;
  action: MoonPayTradeAction;
  chainId: number;
  fromToken: string;
  fromAmount: string;
  toToken: string | null;
  toAmount: string | null;
  estimatedApy?: number;        // decimal, e.g. 0.045 = 4.5% (protocol data)
  gasCostUSD: string;
  priceImpactBps: number | null;
  validUntil: string;
  fee: { bps: number; recipientWallet: string; disclosed: true };
  tx: { to: string; data: string; value: string; gasLimit: string; chainId: number };
  source: { providerId: string; fetchedAt: string };
}

export interface MoonPayTradeIntent {
  intentId: string;
  status: string;
  tx: { to: string; data: string; value: string; gasLimit: string; chainId: number };
  metadata: { action: string; protocol: string; description: string; preparedAt: string };
  referralAttribution: { attributionBps: number; disclosedToUser: true; disclosureText: string };
  authorization: { userMustAuthorize: true; defibroRelays: false };
  expiry?: { expiresAt: string; ttlSeconds: number };
}

export interface MoonPayTradeReq {
  protocol: MoonPayTradeProtocol;
  action: MoonPayTradeAction;
  chainId: number;
  fromToken: string;
  fromAmount: string;
  walletAddress: string;
  toToken?: string;
  slippageBps?: number;
  marketId?: string;
  quoteId?: string;
}

export const moonpayTrade = {
  quote: (body: MoonPayTradeReq) =>
    jpost<MoonPayTradeQuote>('/partners/moonpay/trade/quote', body),
  prepare: (body: MoonPayTradeReq) =>
    jpost<MoonPayTradeIntent>('/partners/moonpay/trade/prepare', body),
};

// ============================================================================
// 18. goalsApi — /api/goals/* (P-GOALS-LAYER)
// ============================================================================

export interface ParsedGoal {
  targetMonthlyUSD: number;
  riskTolerance: 'low' | 'medium' | 'high';
  timeHorizon: string;
  summary: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  requiredAPY: number;
  realisticMonthlyUSD: number;
  bestAvailableAPY: number;
  totalCapitalUSD: number;
  note: string;
}

export interface GoalRequest {
  id: string;
  userId: string;
  rawText: string;
  targetMonthlyUSD: number;
  riskTolerance: string;
  timeHorizon: string | null;
  capitalSnapshot: object;
  mode: string;
  targetManagerIds: string[];
  status: string;
  feasible: boolean | null;
  requiredAPY: number | null;
  realisticMonthlyUSD: number | null;
  feasibilityNote: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  _count?: { proposals: number };
}

export interface ManagerProposalV1 {
  id: string;
  goalRequestId: string;
  managerId: string;
  strategy: string;
  feeModel: string | null;
  aiExplanation: string | null;
  status: string;
  createdAt: string;
}

export const goalsApi = {
  checkFeasibility: (text: string) =>
    jpost<{ parsed: ParsedGoal; feasibility: FeasibilityResult }>('/goals/feasibility', { text }),
  create: (body: { text: string; mode?: 'open' | 'targeted'; targetManagerIds?: string[] }) =>
    jpost<{ goalRequest: GoalRequest; parsed: ParsedGoal; feasibility: FeasibilityResult }>('/goals', body),
  list: (status?: string) =>
    jget<{ goals: GoalRequest[] }>(`/goals${status ? `?status=${status}` : ''}`),
  get: (id: string) =>
    jget<{ goalRequest: GoalRequest }>(`/goals/${id}`),
  proposals: (id: string) =>
    jget<{ proposals: ManagerProposalV1[] }>(`/goals/${id}/proposals`),
  fullProposals: (id: string) =>
    jget<{ proposals: ManagerProposal[] }>(`/goals/${id}/full-proposals`),
  close: async (id: string): Promise<{ goalRequest: GoalRequest }> => {
    const r = await fetch(`${API_BASE}/goals/${id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return r.json() as Promise<{ goalRequest: GoalRequest }>;
  },
};

// ============================================================================
// 19. delegationApi — /api/delegation/* + /api/manager/* (P-DELEGATION)
// ============================================================================

export interface ManagerProfile {
  id: string;
  userId: string;
  displayName: string;
  bio?: string;
  licenseType: 'individual' | 'registered_advisor' | 'institutional';
  kycAt?: string;
  isActive: boolean;
  // P-GROWTH fields
  status: 'pending_kyc' | 'pending_approval' | 'active' | 'rejected' | 'suspended';
  applicationNote?: string;
  approvedAt?: string;
  isFoundingManager: boolean;
  createdAt: string;
  trackRecords?: TrackRecord[];
  clientCount?: number;
  _count?: { managedMandates: number };
}

// P-GROWTH: referral stats returned by GET /api/manager/referrals
export interface ManagerReferralStats {
  code: string;
  referralUrl: string;
  clickCount: number;
  conversions: {
    total: number;
    registered: number;
    goalCreated: number;
    delegationAccepted: number;
    firstYield: number;
  };
  pendingPayoutUSD: number;
  totalPaidUSD: number;
  payoutPct: number;
  payoutMonths: number;
}

// P-GROWTH: analytics returned by GET /api/manager/analytics
export interface ManagerAnalytics {
  funnel: {
    goalRequestsReceived: number;
    proposalsSent: number;
    accepted: number;
    active: number;
    conversionRate: string;
  };
  totalAUM: number;
  trackRecords: TrackRecord[];
  isFoundingManager: boolean;
  status: string;
}

export interface TrackRecord {
  id: string;
  managerId: string;
  period: string;
  apy: number;
  backupActivations: number;
  capitalPreservedRate: number;
  zeroLiquidations: boolean;
  clientRetention: number;
  clientCount: number;
  computedAt: string;
}

export interface ManagerProposal {
  id: string;
  goalRequestId: string;
  managerId: string;
  strategy: string;
  primaryIntents: object[];
  feeModel?: string;
  aiExplanation?: string;
  proposedMandate: {
    allowedProtocols: string[];
    maxCapitalUSD: number;
    durationDays?: number;
  };
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: string;
}

export interface DelegationMandate {
  id: string;
  userId: string;
  managerId: string;
  proposalId: string;
  allowedProtocols: string[];
  maxCapitalUSD: number;
  status: 'active' | 'paused' | 'revoked';
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export const delegationApi = {
  // Marketplace
  marketplace: (opts?: { limit?: number; offset?: number }) =>
    jget<{ profiles: ManagerProfile[]; total: number }>(
      `/delegation/marketplace?limit=${opts?.limit ?? 20}&offset=${opts?.offset ?? 0}`,
    ),
  managerProfile: (userId: string) =>
    jget<ManagerProfile>(`/delegation/managers/${userId}`),

  // User mandate management
  mandates: () => jget<DelegationMandate[]>('/delegation/mandate'),
  mandate: (id: string) => jget<DelegationMandate>(`/delegation/mandate/${id}`),
  revoke: (id: string, reason?: string) =>
    jdelete<{ success: boolean }>(`/delegation/mandate/${id}`, { reason }),
  pauseMandate: (id: string, status: 'active' | 'paused') =>
    jpost<DelegationMandate>(`/delegation/mandate/${id}/status`, { status }),

  // Accept / reject proposals
  accept: (proposalId: string, opts?: { enablePreAuth?: boolean }) =>
    jpost<{ mandate: DelegationMandate; conditionalAuthId?: string; message: string }>(
      `/delegation/accept/${proposalId}`,
      opts ?? {},
    ),
  reject: (proposalId: string) =>
    jpost<{ success: boolean }>(`/delegation/reject/${proposalId}`, {}),

  // Manager-side
  myProfile: () => jget<ManagerProfile>('/manager/profile'),
  createProfile: (body: { displayName: string; bio?: string; licenseType?: string }) =>
    jpost<ManagerProfile>('/manager/profile', body),
  updateProfile: async (body: Partial<ManagerProfile>): Promise<ManagerProfile> => {
    const r = await fetch(`${API_BASE}/manager/profile`, {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return r.json() as Promise<ManagerProfile>;
  },
  myProposals: (opts?: { limit?: number; offset?: number }) =>
    jget<ManagerProposal[]>(`/manager/proposals?limit=${opts?.limit ?? 20}&offset=${opts?.offset ?? 0}`),
  createProposal: (body: Omit<ManagerProposal, 'id' | 'managerId' | 'createdAt'>) =>
    jpost<ManagerProposal>('/manager/proposals', body),
  withdrawProposal: (id: string) =>
    jdelete<{ success: boolean }>(`/manager/proposals/${id}`),
  myClients: () => jget<DelegationMandate[]>('/manager/clients'),

  // Batch proposals
  myBatches: () => jget<object[]>('/manager/batch'),
  createBatch: (body: object) => jpost<object>('/manager/batch', body),
  sendBatch: (id: string, targetGoalIds: string[]) =>
    jpost<{ sent: number; skipped: number; errors: string[] }>(
      `/manager/batch/${id}/send`,
      { targetGoalIds },
    ),

  // P-GROWTH: application + referrals + analytics
  apply: (body: { displayName: string; bio?: string; licenseType?: string }) =>
    jpost<ManagerProfile>('/manager/apply', body),
  myReferrals: () => jget<ManagerReferralStats>('/manager/referrals'),
  myAnalytics: () => jget<ManagerAnalytics>('/manager/analytics'),
};

// Minimal helper for DELETE with body
async function jdelete<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    throw new Error(`http_${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ============================================================================
// 20. intentsApi — /api/intents/* (F3 — the signing surface)
//
// Lists TransactionIntents the AutomationEngine (or any prepare-only flow)
// already left in `proposed` / `pending_user_review`, waiting for the user's
// OWN wallet signature. This API only reads the unsigned payload, lets the
// user dismiss it, or records the txHash AFTER the user signed elsewhere
// (POST .../submitted) — Astryum never signs, custodies or broadcasts here.
// Kept in sync with backend/src/routes/intents.ts and
// backend/src/types/domain/Intent.ts (TransactionIntent). Json fields we
// don't render (simulation/impact/riskDelta) are typed loosely on purpose.
// ============================================================================

export type IntentStatus =
  | 'building'
  | 'proposed'
  | 'pending_user_review'
  | 'expired'
  | 'signed'
  | 'broadcast'
  | 'mempool'
  | 'confirmed'
  | 'failed';

/** A call that MUST precede `txData` in the same signing batch (e.g. the
 *  ERC-20 approve before a repay/supply pull) — batched as ONE user review. */
export interface IntentPrerequisiteCall {
  to: string;
  data: string;
  /** Wei, decimal string (JSON-safe). */
  value: string;
  chainId: number;
  label: string;
}

export interface IntentPreState {
  hf?: number;
  ltv?: number;
  collateralUSD?: number;
  debtUSD?: number;
  positionValueUSD?: number;
  prerequisiteCalls?: IntentPrerequisiteCall[];
  [extra: string]: unknown;
}

/** Unsigned calldata built by CalldataBuilder — never signed/broadcast by Astryum. */
export interface IntentTxData {
  to: string;
  data: string;
  /** Wei, decimal string. */
  value: string;
  /** Decimal string. */
  gasLimit: string;
  chainId: number;
}

export interface PreparedIntent {
  id: string;
  owner: string;
  chainId: number;
  sessionId: string;
  action: string;
  protocolId: string;
  positionId?: string | null;
  inputs: Record<string, unknown>;
  preState: IntentPreState;
  simulation: Record<string, unknown>;
  impact: Record<string, unknown>;
  riskDelta: Record<string, unknown>;
  explanation: string;
  warnings: string[];
  txData: IntentTxData | null;
  status: IntentStatus;
  txHash?: string | null;
  expiresAt: string;
  createdAt: string;
}

export const intentsApi = {
  /** One wallet's intents, every lifecycle state, newest first — the UI
   *  splits "waiting for your signature" from history by status. */
  list: (address: string) =>
    jget<{ count: number; intents: PreparedIntent[] }>('/intents', { address }),
  /** Dismiss a prepared intent that hasn't been signed yet. */
  cancel: (id: string, reason?: string) =>
    jpost<PreparedIntent>(`/intents/${id}/cancel`, reason ? { reason } : {}),
  /** Report the hash AFTER the user signed in their own wallet — advances the FSM. */
  submitted: (id: string, txHash: string) =>
    jpost<PreparedIntent>(`/intents/${id}/submitted`, { txHash }),
};

/* ── XRPL Savings (B.1 — ahorro-escrow) ──────────────────────────────────── */

export interface XrplEscrowRow {
  currency: string;
  amount: string;
  owner?: string;
  destination?: string;
  isOutgoing?: boolean;
  finishAfter?: number;
  cancelAfter?: number;
  hasCondition?: boolean;
  previousTxnID?: string;
  finishAfterISO?: string;
  cancelAfterISO?: string;
  releasableNow?: boolean;
}

export interface XrplTxHandoff {
  xrplTx: Record<string, unknown> & { TransactionType: string };
  disclosure: {
    disclosedToUser: true;
    defibroSigns: false;
    note: string;
    facts: Record<string, string | number | boolean>;
  };
}

export interface XrplSpendable {
  balanceXrp: number;
  spendableXrp: number;
  reserveXrp: number;
  ownerCount: number;
  nextObjectReserveXrp: number;
}

export const xrplSavings = {
  /** Every escrow visible on the account (validated ledger) + spendable
   *  balance after reserves (best-effort, null when that read failed). */
  escrows: (account: string) =>
    jget<{ count: number; escrows: XrplEscrowRow[]; account: XrplSpendable | null }>(
      '/xrpl-defi/escrows',
      { account },
    ),
  /** UNSIGNED EscrowCreate + disclosure — the user signs in Xaman.
   *  `destination` defaults to the creator (self-savings); the Legacy
   *  programmed transfer passes the beneficiary. */
  prepareCreate: (body: {
    account: string;
    amountDrops: string;
    finishAfterISO: string;
    cancelAfterISO?: string;
    destination?: string;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/escrow-create/prepare', body),
  /** UNSIGNED EscrowFinish (release) — permissionless after FinishAfter. */
  prepareFinish: (body: {
    account: string;
    owner: string;
    previousTxnID?: string;
    offerSequence?: number;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/escrow-finish/prepare', body),
  /** UNSIGNED EscrowCancel (recovery) — permissionless after CancelAfter;
   *  the XRP always returns to the escrow's creator. */
  prepareCancel: (body: {
    account: string;
    owner: string;
    previousTxnID?: string;
    offerSequence?: number;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/escrow-cancel/prepare', body),
};

/* ── XRPL native DEX (CLOB) — buy/sell orders, prepare-only ───────────────── */

/** An XRPL Amount: drops string (XRP) or an IOU {currency,issuer,value}. The
 *  currency for non-standard codes (e.g. RLUSD) must be the 40-char hex form. */
export type XrplAmount = string | { currency: string; issuer: string; value: string };

export const xrplDex = {
  /** UNSIGNED OfferCreate + disclosure — the user signs in Xaman. TakerGets is
   *  what YOU sell, TakerPays is what YOU buy. `immediateOrCancel` makes it a
   *  market-style swap; otherwise it rests on the book as a limit order. */
  prepareOfferCreate: (body: {
    account: string;
    takerGets: XrplAmount;
    takerPays: XrplAmount;
    flags?: { immediateOrCancel?: boolean; fillOrKill?: boolean; passive?: boolean; sell?: boolean };
    expirationISO?: string;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/offer-create/prepare', body),
  /** UNSIGNED OfferCancel + disclosure — removes a resting order by sequence. */
  prepareOfferCancel: (body: { account: string; offerSequence: number; region?: string }) =>
    jpost<XrplTxHandoff>('/xrpl-defi/offer-cancel/prepare', body),
};

/* ── Activity export (the period's movements, for the user's tax advisor) ── */

/** Download the movements file (CSV/JSON) for ONE wallet. Astryum reports
 *  data; the filing is the advisor's job — no valuation, no advice. */
export async function fetchActivityExport(params: {
  wallet: string;
  format: 'csv' | 'json';
  from?: string;
  to?: string;
}): Promise<Blob> {
  const qs = new URLSearchParams({ wallet: params.wallet, format: params.format });
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const r = await fetch(`${API_BASE}/activity/export?${qs.toString()}`, { headers: { ...authHeader() } });
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    throw new Error(`http_${r.status}`);
  }
  return r.blob();
}

/* ── Governed-account registry (authority switcher) ──────────────────────── */

/** A pointer the user placed: "I govern/observe this council-governed account".
 *  Server-side twin of the old localStorage observed list — portable across
 *  devices. State (council, health) is always read fresh from the ledger. */
export interface GovernedAccountRecord {
  id: string;
  ecosystem: 'xrpl';
  address: string;
  label: string | null;
  createdAt: string;
}

export const governedAccountsApi = {
  list: () => jget<{ accounts: GovernedAccountRecord[] }>('/governed-accounts'),
  add: (address: string, label?: string) =>
    jpost<{ account: GovernedAccountRecord }>('/governed-accounts', { address, ecosystem: 'xrpl', label }),
  rename: (id: string, label: string | null) =>
    jpatch<{ ok: boolean }>(`/governed-accounts/${id}`, { label }),
  remove: (id: string) => jdel(`/governed-accounts/${id}`),
};

/* ── Admin panel (founders only, read-only) ──────────────────────────────── */

export interface AdminWaitlistRow {
  email: string;
  source: string;
  lang: string | null;
  createdAt: string;
  /** True when the row matched the noise blocklist (reserved/disposable domains). */
  noise: boolean;
}

export interface AdminRecentUser {
  email: string | null;
  username: string | null;
  createdAt: string;
  lastLogin: string | null;
  /**
   * Provenance badges: creation origin ('email' | 'google' | 'apple' |
   * 'wallet') plus any OAuth identity linked later. Never the raw OAuth sub.
   */
  authProviders: string[];
}

export interface AdminOverview {
  counts: {
    users: number;
    wallets: number;
    governedAccounts: number;
    councilProposals: number;
    /** Clean (non-noise) waitlist signups only. */
    waitlistSignups: number;
    /** Rows that matched the noise blocklist — bots, not real interest. */
    waitlistNoise: number;
    /** Clean-only breakdown, so bot floods don't skew the source mix. */
    waitlistBySource: Record<string, number>;
    /** OAuth users separated from plain-email users (founder 2026-07-23). */
    usersByProvider: Record<string, number>;
  };
  waitlist: AdminWaitlistRow[];
  recentUsers: AdminRecentUser[];
}

export interface AdminSession {
  token: string;
  expiresAt: string;
}

export const adminPanelApi = {
  /**
   * Trade the static panel key for a 2h scope-limited session token
   * (2026-07-23 hardening). Captcha-gated + per-IP failure limit server-side.
   * The raw key is typed once and never stored client-side; only THIS token
   * is kept (sessionStorage) and travels on overview calls.
   */
  createSession: async (key: string, captchaToken?: string | null): Promise<AdminSession> => {
    const r = await fetch(`${API_BASE}/admin-panel/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, captchaToken: captchaToken ?? undefined }),
    });
    const body = (await r.json().catch(() => null)) as (AdminSession & { error?: string }) | null;
    if (!r.ok) {
      throw Object.assign(new Error(body?.error ?? `http_${r.status}`), { status: r.status });
    }
    return body as AdminSession;
  },

  /**
   * Overview, opened with the session token from createSession (header
   * `x-admin-session`). Throws with `.status` so the page can tell an expired
   * session (401) apart from "panel not available" (404/403).
   *
   * `includeNoise` (2026-07-23): swaps the waitlist table for the top 200
   * rows by recency regardless of noise, each tagged `noise` — an audit view,
   * off by default so the panel opens clean.
   */
  overview: async (sessionToken: string, includeNoise?: boolean): Promise<AdminOverview> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const qs = includeNoise ? '?includeNoise=1' : '';
    const r = await fetch(`${API_BASE}/admin-panel/overview${qs}`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminOverview;
  },

  /** Flip the Astryum Orbit System light (routes/platformStatus.ts) — the
   *  Summary card's status. Same panel session as every other admin call;
   *  `reason` is the founders' hand-written note users see while offline. */
  setPlatformStatus: async (
    sessionToken: string,
    state: 'online' | 'offline',
    reason?: string,
  ): Promise<PlatformStatus> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/platform/status`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: JSON.stringify({ state, reason }),
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as PlatformStatus;
  },

  /** Gauges vivos del executor 0xFE (Sistema tab) — mismo snapshot que
   *  /flare-demo/executor-health, bajo la sesión del panel. */
  executor: async (sessionToken: string): Promise<AdminExecutorHealth> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-panel/executor`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminExecutorHealth;
  },

  /** Bandeja de alertas/notificaciones de operación (Alertas tab) — persistidas
   *  siempre, no dependen del webhook. Mismo x-admin-session que el resto. */
  alerts: async (sessionToken: string): Promise<AdminOpsAlerts> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-panel/alerts`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminOpsAlerts;
  },
};

/** Una alerta de operación del backend (executor, vigías, provider-health…). */
export interface AdminOpsAlert {
  id: string;
  source: string;
  level: 'info' | 'warn' | 'critical';
  message: string;
  at: string;
}

/** Respuesta de /admin-panel/alerts: la lista + resumen por severidad + fuentes. */
export interface AdminOpsAlerts {
  alerts: AdminOpsAlert[];
  counts: { info: number; warn: number; critical: number };
  sources: string[];
  checkedAt: string;
}

/** Snapshot del executor 0xFE para el panel (espejo laxo de ExecutorHealth). */
export interface AdminExecutorHealth {
  enabled: boolean;
  hasKey: boolean;
  refuelEnabled: boolean;
  sweepArmed: boolean;
  alertWebhookConfigured: boolean;
  executor: string | null;
  flrBalance: string | null;
  fxrpBalance: string | null;
  lastTickAt: string | null;
  lastTickError: string | null;
  pendingCount: number;
  failingTxCount: number;
  lastRefuel: { stage: string; detail: string; swapTxHash?: string } | null;
  lastSweep: { amountFXRP: string; txHash: string; to: string } | null;
  parked: Array<{ hash: string; reason: string }>;
  dailyFeeBudget: { spentFLR: string; budgetFLR: number; windowStartedAt: string | null };
  defensesCoveredToday: { byBudget: number; byWallet: number | null; effective: number };
  feeMargin: {
    marginPct: number | null;
    execFeeXrp: number | null;
    xrpUsd: number | null;
    flrUsd: number | null;
    costFlr: number;
    warnBelowPct: number;
  } | null;
  checkedAt: string;
}

/* ── Desatasco del executor 0xFE (modal de Sistema) ──────────────────────── */

/** Un dispatch 0xFE atascado — pendiente (reintentando) o aparcado. */
export interface AdminStuckTx {
  hash: string;
  account: string | null;
  xrp: number | null;
  dateISO: string | null;
  /** Ruta del prepare que lo construyó ('e1', 'pa-repay', 'vault-withdraw:…') — null en filas pre-2026-07-26. */
  action: string | null;
  direction: 'entrante' | 'saliente' | 'otra' | 'desconocida';
  failures?: number;
  nextAttemptISO?: string | null;
  reason?: string;
  source?: string | null;
  parkedAt?: string | null;
}

export interface AdminStuckList {
  pending: AdminStuckTx[];
  parked: AdminStuckTx[];
  watcher: { enabled: boolean; hasKey: boolean; running: boolean; lastTickAt: string | null };
  checkedAt: string;
}

export interface AdminUnstickResult {
  ok: boolean;
  op: string;
  hash: string;
  detail: string;
  kicked: boolean;
  envSkipListed: boolean;
}

/** Modal de desatasco (routes/adminExecutor.ts) — mismas puertas que el panel;
 *  el POST solo mueve estado de reintento del watcher, jamás firma nada. */
export const adminExecutorApi = {
  stuck: async (sessionToken: string): Promise<AdminStuckList> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-executor/stuck`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminStuckList;
  },

  unstick: async (
    sessionToken: string,
    input: { hash: string; op: 'retry' | 'park'; reason?: string },
  ): Promise<AdminUnstickResult> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-executor/unstick`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminUnstickResult;
  },
};

/* ── Demo cap (fase abierta) — la barra de uso diario del Summary ────────── */

export interface DemoCapStatus {
  maxXrpPerTx: number;
  maxXrpPerDay: number;
  spentTodayXrp: number;
  remainingTodayXrp: number;
  /** v2 reserva→confirmación: gasto EJECUTADO (permanente). */
  confirmedTodayXrp?: number;
  /** v2: reservas frescas de prepares aún sin ejecutar — expiran solas (~30 min). */
  reservedTodayXrp?: number;
  exempt: boolean;
  /** UTC day the counter resets on (YYYY-MM-DD). */
  day: string;
  /** Whether the open demo (FLARE_DEFI_ENABLED) is live at all. */
  active: boolean;
}

export const demoCapApi = {
  /** Read-only: the caps in force + what `address` has spent today. Reading
   *  never consumes budget — the gauge must not move on read. */
  status: async (address?: string | null): Promise<DemoCapStatus> => {
    const qs = address ? `?address=${encodeURIComponent(address)}` : '';
    const r = await fetch(`${API_BASE}/flare-demo/cap-status${qs}`, {
      headers: { ...authHeader() },
      credentials: 'include',
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as DemoCapStatus;
  },
};

/* ── Council proposals (the governed-mode inbox) ─────────────────────────── */

export type CouncilProposalStatus = 'collecting' | 'ready' | 'submitted' | 'expired' | 'withdrawn';
export type FormalStance = 'for' | 'against' | 'abstain' | 'request-changes';

export interface CouncilSignatureRow {
  signerAccount: string;
  weight: number;
  signedAt: string;
  /** Present only on GET /:id — the combining browser needs it. */
  blobHex?: string;
}

export interface CouncilPositionRow {
  memberAccount: string;
  stance: FormalStance;
  comment?: string | null;
  contentHash?: string;
  signature?: string;
  signingPubKey?: string;
  createdAt?: string;
}

/** A persisted council proposal: the PINNED unsigned tx plus the verified
 *  member signatures collected so far. Combine + broadcast happen in the
 *  browser; the server never signs. */
export interface CouncilProposalRecord {
  id: string;
  account: string;
  createdByUserId?: string | null;
  title: string | null;
  txType: string;
  txjson: Record<string, unknown>;
  quorum: number;
  signerList: Array<{ account: string; weight: number }>;
  status: CouncilProposalStatus;
  txHash: string | null;
  positionsAnchor?: string | null;
  createdAt: string;
  expiresAt: string;
  signatures: CouncilSignatureRow[];
  positions?: CouncilPositionRow[];
}

export const councilProposalsApi = {
  create: (body: { account: string; xrplTx: Record<string, unknown>; title?: string; region?: string }) =>
    jpost<{ proposal: CouncilProposalRecord; preflight: MultisigPrepare['preflight']; fee: MultisigPrepare['fee'] }>(
      '/council/proposals',
      body,
    ),
  list: (accounts: string[], onlyLive = false) =>
    jget<{ proposals: CouncilProposalRecord[] }>('/council/proposals', {
      accounts: accounts.join(','),
      ...(onlyLive ? { status: 'live' } : {}),
    }),
  detail: (id: string) => jget<{ proposal: CouncilProposalRecord }>(`/council/proposals/${id}`),
  sign: (id: string, signerAccount: string, blobHex: string) =>
    jpost<{ ok: boolean; status: CouncilProposalStatus; collectedWeight: number; quorum: number; signedBy: string[] }>(
      `/council/proposals/${id}/signatures`,
      { signerAccount, blobHex },
    ),
  submitted: (id: string, txHash: string) =>
    jpost<{ ok: boolean; proposal: CouncilProposalRecord }>(`/council/proposals/${id}/submitted`, { txHash }),
  withdraw: (id: string) =>
    jpost<{ ok: boolean; proposal: CouncilProposalRecord }>(`/council/proposals/${id}/withdraw`, {}),
  /** Fix a formal position (the acta): the EXACT contentJson the wallet signed
   *  over, plus the proof blob. Immutable once set. */
  setPosition: (
    id: string,
    body: { memberAccount: string; stance: FormalStance; comment?: string; contentJson: string; blobHex: string },
  ) => jpost<{ position: CouncilPositionRow }>(`/council/proposals/${id}/positions`, body),
  /** Compose the UNSIGNED 1-drop batch anchor of the positions (the emitter's
   *  personal Payment — no council Sequence touched). */
  anchorPositionsPrepare: (id: string, emitterAccount: string) =>
    jpost<{ xrplTx: Record<string, unknown>; batchHash: string; positionsCount: number }>(
      `/council/proposals/${id}/positions/anchor/prepare`,
      { emitterAccount },
    ),
  anchorPositionsDone: (id: string, txHash: string) =>
    jpost<{ ok: boolean; proposal: CouncilProposalRecord }>(`/council/proposals/${id}/positions/anchored`, { txHash }),
};

/* ── XRPL Legacy (vías (a)+(b) — consejo + constitución) ─────────────────── */

export interface XrplCouncil {
  quorum: number;
  masterKeyDisabled: boolean;
  signers: Array<{ account: string; weight: number }>;
}

export interface ConstitutionAnchor {
  dataHex?: string;
  uri?: string;
  uriHex?: string;
}

export interface ConstitutionAmendment {
  txHash: string;
  dateISO?: string;
  dataHex?: string;
  uri?: string;
  signedByQuorum: boolean;
}

/** The health verdict that governs which actions the panel offers (ADR-008 §2).
 *  Computed in the backend (tested), rendered here — never re-derived in JSX. */
export interface LegacyHealth {
  level: 'red' | 'amber' | 'green' | 'unknown';
  headline: 'inspect' | 'replace-fallen-signer' | 'run-rehearsal' | 'close-the-door' | 'healthy';
  dangerousActionsBlocked: boolean;
  canCloseDoor: boolean;
  canCommitCapital: boolean;
  mustReplaceSigner: boolean;
  reasons: string[];
}

export interface RehearsalStatus {
  hasCouncil: boolean;
  masterKeyDisabled: boolean;
  members: Array<{ account: string; weight: number; signedOnChain: boolean }>;
  signedCount: number;
  memberCount: number;
  rehearsalEscrowSeen: boolean;
  escrowResolved: boolean;
  rehearsalComplete: boolean;
  quorumMargin: number;
}

export interface VaultCouncilInfo {
  vault: string;
  council: string;
  constitutionRef: string | null;
  kind: 'eoa' | 'contract' | 'safe';
  ownerCount?: number;
  threshold?: number;
}

/** The multisig coordinator's prepare result (ADR-008): an unsigned txjson
 *  pinned for the council (Sequence/Fee/SigningPubKey), plus the ledger dry-run. */
export interface MultisigPrepare {
  multisigTx: Record<string, unknown>;
  council: { quorum: number; masterKeyDisabled: boolean; signers: Array<{ account: string; weight: number }> };
  fee: { drops: string; baseFeeDrops: number; signerCount: number };
  preflight: {
    available: boolean;
    willSucceed: boolean;
    engineResult?: string;
    engineResultMessage?: string;
    balanceChanges: Array<{ account: string; value: string; currency: string; issuer?: string }>;
  };
}

export const xrplLegacy = {
  /** The account's signer list — the council (null = single-key account). */
  council: (account: string) =>
    jget<{ account: string; council: XrplCouncil | null }>('/xrpl-defi/council', { account }),
  /** Per-member on-chain signature evidence — the master-key gate. */
  rehearsalStatus: (account: string) =>
    jget<{ account: string; status: RehearsalStatus; health: LegacyHealth }>('/xrpl-defi/rehearsal-status', { account }),
  /** Pin an unsigned txjson for council multisig (Sequence/Fee/SigningPubKey) +
   *  the simulate preflight. The frontend then fans it out to the members. */
  multisignPrepare: (account: string, xrplTx: Record<string, unknown>) =>
    jpost<MultisigPrepare>('/xrpl-defi/multisign/prepare', { account, xrplTx }),
  /** Dry-run a txjson (read-only): would it succeed + exact balance deltas. */
  simulate: (txjson: Record<string, unknown>) =>
    jpost<MultisigPrepare['preflight']>('/xrpl-defi/simulate', { txjson }),
  /** UNSIGNED SignerListSet — constitute (or amend) the council from zero. Signed
   *  by the account's master key when there is no council yet (direct path). */
  signerListSetPrepare: (body: {
    account: string;
    quorum: number;
    signers: Array<{ account: string; weight: number }>;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/signer-list-set/prepare', body),
  /** UNSIGNED AccountSet(asfDisableMaster) — "close the door". On a council
   *  account this is signed by the QUORUM via the multisig coordinator. */
  disableMasterPrepare: (body: { account: string; region?: string }) =>
    jpost<XrplTxHandoff>('/xrpl-defi/disable-master/prepare', body),
  /** The EVM side of the mirror: the vault's council (+ Safe owners when readable). */
  vaultCouncil: (address: string) =>
    jget<VaultCouncilInfo>('/xrpl-defi/vault-council', { address }),
  /** Current constitution anchor (DID) + quorum-signed amendment history. */
  constitution: (account: string) =>
    jget<{ account: string; anchor: ConstitutionAnchor | null; history: ConstitutionAmendment[] }>(
      '/xrpl-defi/constitution',
      { account },
    ),
  /** UNSIGNED DIDSet anchoring the governance document's SHA-256 (+ URI). */
  prepareAnchor: (body: {
    account: string;
    documentSha256Hex: string;
    documentUri?: string;
    region?: string;
  }) => jpost<XrplTxHandoff>('/xrpl-defi/did-set/prepare', body),
  /** Council order (FDC enforcement rail): UNSIGNED 1-drop Payment whose memo
   *  commits the exact vault order; the quorum signs it via the coordinator. */
  councilOrderPrepare: (body: {
    account: string;
    action: string;
    params: Record<string, unknown>;
    region?: string;
  }) => jpost<CouncilOrderHandoff>('/xrpl-defi/council-order/prepare', body),
  /** Ask the courtesy relayer to carry the validated XRPL tx across the FDC.
   *  Permissionless by design — anyone could deliver the same proof. */
  councilOrderRelay: (body: { xrplTxHash: string; orderData?: string }) =>
    jpost<{ started: boolean; state: string }>('/xrpl-defi/council-order/relay', body),
  /** Settlement truth, read from the bridge on-chain (+ local relay state). */
  councilOrderStatus: (txId: string) =>
    jget<{
      executed: boolean;
      nextNonce: number;
      relay: { state: 'relaying' | 'executed' | 'error'; detail?: string; flareTxHash?: string } | null;
    }>('/xrpl-defi/council-order/status', { txId }),
};

/** The council-order prepare result: a normal XRPL handoff plus the committed
 *  order (bytes + hash + nonce) the UI shows and the relayer needs as backup. */
export interface CouncilOrderHandoff extends XrplTxHandoff {
  order: {
    action: string;
    summary: string;
    vaultCalldata: string;
    orderData: string;
    orderHash: string;
    memoHex: string;
    nonce: number;
    bridge: string;
    vault: string;
    chain: 'coston2' | 'flare';
    constitutionRef: string;
  };
}

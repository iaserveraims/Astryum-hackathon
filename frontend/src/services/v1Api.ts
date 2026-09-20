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
import { noteCouncilOrderDelivery, noteFlareInstructionDelivery } from '../lib/xaman/liveRequests';
import { notePayloadExpiryMin } from '../lib/wallet/handoffRelease';
import { isPreviewActive, previewGet, previewPost } from './previewData';

const API_BASE = getApiBase();

function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A 401 THAT IS NOT «YOUR SESSION ENDED» (productizer it. 17, R5 5.6).
 *
 * `withLiveSession` refuses an authority write whose session predates an account
 * takeover, and it answers 401 `session_revoked`. That is a verdict about THIS
 * WRITE, not about the session the person is using: the address book, the rules
 * form and the cage acknowledgement all answer it, and the global handler read
 * the status alone — token wiped, straight to /login, the half-filled form gone.
 * A security fix that throws the user out is a security fix nobody survives.
 *
 * So this code is SURFACED, never global: the caller gets the refusal (the throw
 * carries `body`) and shows it in place, in its own words.
 */
export function isSurfacedUnauthorized(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const e = (body as { error?: unknown }).error;
  return e === 'session_revoked';
}

/**
 * Clear local auth state and redirect to /login when a 401 is received.
 * Idempotent across concurrent 401s in the same tab: only the first call
 * performs the redirect; subsequent calls are no-ops so we don't trigger
 * navigation while React is still rendering with stale state.
 *
 * `body` is the server's answer when the caller already read it: a
 * `session_revoked` never clears anything and never navigates.
 */
let unauthorizedHandled = false;
function handleUnauthorized(body?: unknown): void {
  if (typeof window === 'undefined') return;
  if (isSurfacedUnauthorized(body)) return;
  if (unauthorizedHandled) return;
  unauthorizedHandled = true;
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('astryum-auth-storage');
  } catch {}
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
}

/**
 * A PREPARED 0xFE REACHES THE LIVE-REQUESTS REGISTRY (productizer it. 17, R2 2.6).
 *
 * The banner over every in-flight Xaman request can only promise «Flare will act
 * on this» when somebody actually said the executor runs. `lib/institutional/api`
 * already tells the registry on every prepare; the three Legacy hand-offs that
 * ride the same 0xFE rail — funding a cage, the birth of a cage, the heir's
 * yield claim — did not, so their instructions sat in the registry as «nobody
 * said», and the banner stayed neutral over a payment that DOES get delivered.
 *
 * Read defensively, in this order: `serverDelivery.executorEnabled`, then a
 * top-level `executorEnabled`. A route that sends neither leaves the state
 * UNKNOWN on purpose — the registry remembers «nobody told us» separately from
 * «the executor is stopped», because only the second is an accusation.
 *
 * Pass-through: it returns the same response, so a caller sees no difference.
 */
function noteInstructionDelivery<T>(r: T): T {
  const body = r as { xrplPayment?: unknown; xrplTx?: unknown; serverDelivery?: unknown; executorEnabled?: unknown } | null;
  if (!body || typeof body !== 'object') return r;
  const declared = body.serverDelivery;
  const delivery =
    declared && typeof declared === 'object'
      ? (declared as { executorEnabled?: unknown; recorded?: unknown })
      : typeof body.executorEnabled === 'boolean'
        ? { executorEnabled: body.executorEnabled }
        : undefined;
  const tx = body.xrplPayment ?? body.xrplTx;
  // A body that is not a 0xFE instruction is ignored inside the registry.
  noteFlareInstructionDelivery(tx, delivery);
  // it. 19 (R3 N4 / R5 R7) — AND THE OTHER HALF OF THE SAME TRUTH. A COUNCIL
  // ORDER is a 1-drop Payment with a 32-byte memo, not a `FE…` one, so the call
  // above ignores it: `/council-order/prepare` answers `serverDelivery` and
  // nothing in this module was ingesting it, leaving the banner to promise a
  // delivery from the transaction's SYNTAX alone (R5 1.3). Each note ignores the
  // other's transaction shape, so one pass-through can safely tell both.
  noteCouncilOrderDelivery(tx, delivery);
  return r;
}

/**
 * it. 21 (it. 20 §3.9) — THE EXPIRY THE SERVER ANSWERS, AND THE FRONTEND IGNORED.
 *
 * Every route that composes a 0xFE answers `payloadExpiryMin` (the minutes its
 * seat is measured with). Nothing here read it, so the Xaman `expire` came from
 * a constant hand-copied on this side: two numbers for one fact, drifting the
 * day either is changed — and the direction that hurts is silent (a seat
 * outliving its payload, or freed while the payload is still signable).
 * Pass-through: the caller sees the same body.
 */
function learnPayloadExpiry<T>(body: T): T {
  const b = body as { payloadExpiryMin?: unknown; memoHex?: unknown; signerListRead?: unknown } | null;
  const v = b?.payloadExpiryMin;
  // it. 27 (§3): the memo travels with it. A ceremony's window (24 h) is above
  // the ordinary clamp, so learning it WITHOUT a memo discarded it entirely —
  // the server's one read never reached a single payload, and the sitting ran on
  // a number hand-written in `lib/xrpl/councilSigning.ts`.
  // it. 31 (§5): and whether that window was READ (`signerListRead`) or merely
  // defaulted — without it a short window was taken for a «signs alone» verdict
  // and the browser stopped checking the SignerList on its own.
  if (v !== undefined) notePayloadExpiryMin(v, b?.memoHex, b?.signerListRead);
  return body;
}

/**
 * it. 21 (it. 20 §3.5) — `Retry-After` IS PART OF THE REFUSAL.
 *
 * `ACCOUNT_BUSY` answers 503 with the header and nothing on this side read it,
 * so the one refusal that KNOWS when to come back said only «try again» — or,
 * more often, nothing at all, because no screen had a reader. The header is
 * folded into the thrown body, where `describeRetryableRefusal` finds it.
 */
function withRetryAfter(res: Response, body: unknown): unknown {
  const secs = Number(res.headers?.get?.('Retry-After'));
  if (!Number.isFinite(secs) || secs <= 0) return body;
  if (!body || typeof body !== 'object') return { retryAfterSeconds: Math.round(secs) };
  const b = body as Record<string, unknown>;
  return b.retryAfterSeconds === undefined ? { ...b, retryAfterSeconds: Math.round(secs) } : b;
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
    // The body is read BEFORE deciding, so a `session_revoked` can be shown in
    // place instead of logging the person out (it. 17, R5 5.6).
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) handleUnauthorized(body);
    throw Object.assign(new Error(body?.error ?? `http_${r.status}`), {
      status: r.status,
      body: withRetryAfter(r, body),
    });
  }
  return learnPayloadExpiry(await r.json());
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
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) handleUnauthorized(j);
    throw Object.assign(new Error(j?.error ?? `http_${r.status}`), {
      status: r.status,
      body: withRetryAfter(r, j),
    });
  }
  return learnPayloadExpiry(await r.json());
}

async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) handleUnauthorized(j);
    throw Object.assign(new Error((j as { error?: string })?.error ?? `http_${r.status}`), {
      status: r.status,
      body: j,
    });
  }
  return r.json();
}

async function jdel(path: string): Promise<void> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (!r.ok && r.status !== 204) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) handleUnauthorized(j);
    throw Object.assign(new Error((j as { error?: string })?.error ?? `http_${r.status}`), {
      status: r.status,
      body: j,
    });
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
  /** BASE units (el entero del ledger) — NUNCA se enseña tal cual. */
  amount?: string;
  /** La cantidad en unidades humanas, exacta. `null` cuando el activo no
   *  declaró decimales. Es el campo que lee una pantalla: usa `snapshotQty`
   *  (lib/positionQty), que además cae a valor/precio cuando falta. */
  qty?: string | null;
  amountUSD?: number;
  priceUSD?: number;
  metrics?: PositionMetrics;
  metadata?: Record<string, unknown>;
  takenAt?: string;
  /** Stamped by the frontend merge when aggregating several wallets. */
  wallet?: string;
  [extra: string]: unknown;
}

/**
 * One protocol the backend sweep could NOT read for a wallet (backend
 * `PortfolioUnreadableProtocol`). A snapshot carrying these is a LOWER BOUND:
 * «could not look», never «nothing there». `partial` = the adapter answered
 * for some markets and `reads` names the ones it could not.
 */
export interface PortfolioUnreadable {
  protocolId: string;
  reason: string;
  partial?: boolean;
  reads?: Array<{ what: string; reason: string; market?: string }>;
  /** Stamped by the frontend merge when aggregating several wallets. */
  wallet?: string;
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
  /** Absent/empty when every adapter answered. See PortfolioUnreadable. */
  unreadable?: PortfolioUnreadable[];
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
  /** M1 — the signing door of a personal scheduledPayment rule: the backend
   *  composes the Payment FRESH from the rule (unsigned, Account pinned to the
   *  owning wallet) and the owner signs it in Xaman. */
  scheduledPaymentPrepare: (id: string) =>
    jpost<{
      xrplTx: Record<string, unknown>;
      summary: string;
      disclosure: { disclosedToUser: true; astryumSigns: false; note: string; facts: Record<string, string> };
    }>(`/rules/${id}/scheduled-payment/prepare`, {}),
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

/** Flare/EVM — the default translator rail (CanonicalEvmTranslator). */
export const FLARE_EVM_CHAIN_ID = 14;

/**
 * The backend's pseudo chain-id for XRPL rules (routes/rules.ts +
 * CanonicalXrplTranslator convention). POST /moneyflows/translate switches
 * translator on EXACTLY this number — anything else takes the EVM path.
 */
export const XRPL_PSEUDO_CHAIN_ID = 1440002;

/** XRPL classic address (rail detection, not address validation). */
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function isXrplCaip2(chain: string | undefined): boolean {
  return typeof chain === 'string' && chain.toLowerCase().startsWith('xrpl:');
}

/**
 * Which translator rail a CMF must compile through — G7 (auditoría de los
 * SILENCIOSOS, 2026-08-17).
 *
 * WHAT FAILED IN SILENCE: `translate()` used to hardcode chainId 14, and its
 * only caller took that default, so POST /api/moneyflows/translate NEVER
 * reached its `chainId === 1440002` branch. The CanonicalXrplTranslator — the
 * ONLY producer of PRICE_DROP_PCT (M3), scheduledPayment (M1) and escrow (B.1)
 * rules — therefore had no caller at all: evaluator, zod, FTSO prefetch and
 * tests all existed and shipped, and no person could ever create one of those
 * rules. Nothing errored; an XRPL-shaped flow simply came back with the EVM
 * translator's `verb_not_supported`, which reads like the PRODUCT refusing the
 * flow instead of the CLIENT asking the wrong rail.
 *
 * Detection is deliberately CONSERVATIVE: only shapes Flare/EVM can NEVER
 * compile route to XRPL, so an ordinary Flare flow keeps its rail and the
 * error it already had.
 *   - an explicit CAIP-2 `xrpl:*` chain on any asset (the strongest signal);
 *   - verb 'transfer' — not an AutomationRule action on EVM at all
 *     (FLARE_EVM_CAPABILITY.verbs excludes it);
 *   - venue.params.destination that is an XRPL classic r-address;
 *   - venue.params.lockDays — the XRPL savings-escrow (B.1) shape.
 * Anything else stays on 14. Guessing a rail for money is worse than an honest
 * "this does not translate here": a mixed flow lands on the first rail matched
 * and its foreign steps fail readably (both translators are all-or-nothing).
 */
export function cmfRailChainId(cmf: CanonicalMoneyFlow): number {
  for (const step of cmf.steps) {
    if ('asset' in step.trigger && isXrplCaip2(step.trigger.asset?.chain)) return XRPL_PSEUDO_CHAIN_ID;
    for (const action of step.actions) {
      if (isXrplCaip2(action.asset?.chain)) return XRPL_PSEUDO_CHAIN_ID;
      if (action.verb === 'transfer') return XRPL_PSEUDO_CHAIN_ID;
      const params = action.venue?.params ?? {};
      if (params.lockDays !== undefined) return XRPL_PSEUDO_CHAIN_ID;
      if (typeof params.destination === 'string' && XRPL_CLASSIC_RE.test(params.destination)) {
        return XRPL_PSEUDO_CHAIN_ID;
      }
    }
  }
  return FLARE_EVM_CHAIN_ID;
}

export const moneyflows = {
  /**
   * Deterministic dry-run: CMF → AutomationRule payloads. 422 = readable errors.
   *
   * G7: the rail is a PARAMETER, not a constant. `chainId` picks the translator
   * (14 = Flare/EVM · 1440002 = XRPL); `governed` is XRPL-only and compiles a
   * 'transfer' to the COUNCIL rail (the trigger composes a proposal, the quorum
   * signs) instead of the personal one. Both mirror translateBodySchema in
   * backend/src/routes/moneyflows.ts.
   */
  translate: (cmf: CanonicalMoneyFlow, opts: { chainId?: number; governed?: boolean } = {}) =>
    jpost<CmfTranslation>('/moneyflows/translate', {
      cmf,
      chainId: opts.chainId ?? FLARE_EVM_CHAIN_ID,
      ...(opts.governed !== undefined ? { governed: opts.governed } : {}),
    }),
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

/**
 * ¿Pudimos VER la cadena en esta lectura? Una lista vacía porque el indexador de
 * Flare no contesta no es lo mismo que una cartera sin movimientos, y la
 * pantalla no puede pintarlas igual.
 */
export interface ExplorerReadStatus {
  ok: boolean;
  reason?: string;
  /** Evento más reciente que sí tenemos en caché: el "visto hasta". */
  cachedThrough?: string;
}

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
    jget<{
      wallet: string;
      count: number;
      events: CanonicalActivityEvent[];
      explorer?: ExplorerReadStatus;
    }>('/activity', params as unknown as Record<string, string | number | undefined>),
  refresh: (wallet: string) =>
    jpost<{ wallet: string; written: number; explorer?: ExplorerReadStatus }>(
      '/activity/refresh',
      { wallet },
    ),
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
    astryum: { signed: false; custodied: false };
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
  compliance: { partnerExecutes: true; astryumExecutes: false; astryumCustody: false; destinationIsUserWallet: true };
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
  authorization: { userMustAuthorize: true; astryumRelays: false };
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
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) handleUnauthorized(j);
    throw Object.assign(new Error((j as { error?: string })?.error ?? `http_${r.status}`), {
      status: r.status,
      body: j,
    });
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
    astryumSigns: false;
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
    // El backend se niega a entregar un fichero fiscal incompleto y explica por
    // qué (explorer_unavailable). Un `http_502` a secas escondería ese motivo.
    // El cuerpo se lee ANTES de decidir: un `session_revoked` se enseña, no
    // expulsa (it. 17, R5 5.6).
    const parsed = await r
      .json()
      .then((b: { message?: string; error?: string }) => b)
      .catch(() => undefined);
    if (r.status === 401) handleUnauthorized(parsed);
    throw new Error(parsed?.message ?? parsed?.error ?? `http_${r.status}`);
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
  /** Beta gate: when set, this email can create an account (null = waiting). */
  approvedAt: string | null;
  /** When the boarding-pass email last went out (null = never sent). */
  invitedAt: string | null;
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
    /** Clean signups with a beta-gate approval (they can create an account). */
    waitlistApproved: number;
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

/** Result of approving a waitlist email (routes/adminBetaGate.ts). */
export interface AdminBetaApproveResult {
  ok: boolean;
  email: string;
  approvedAt: string;
  /** Whether the boarding-pass email actually went out (false ⇒ resend later). */
  inviteSent: boolean;
  /** True when the email already had a seat — the call was a no-op/resend. */
  alreadyApproved: boolean;
}

/* Beta gate writes (founders only) — approve/revoke waitlist emails. Same
 * x-admin-session as every panel call; writes live in their own router
 * (/api/admin-beta) so /api/admin-panel stays read-only by construction. */
export const adminBetaApi = {
  approve: async (
    sessionToken: string,
    email: string,
    opts?: { sendInvite?: boolean; lang?: 'es' | 'en' },
  ): Promise<AdminBetaApproveResult> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-beta/approve`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ email, ...opts }),
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminBetaApproveResult;
  },

  revoke: async (sessionToken: string, email: string): Promise<{ ok: boolean; email: string }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-beta/revoke`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as { ok: boolean; email: string };
  },
};

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

  /** Estado de la cuenta ANCHOR en XRPL (Sistema tab). Ahí caen las fees de las
   *  órdenes del consejo y de ahí tira el hop B3 para reponer FLR al executor.
   *  El gauge vive aquí, no en la consola (regla del fundador). */
  anchor: async (sessionToken: string): Promise<AdminAnchorStatus> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-executor/anchor`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminAnchorStatus;
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

  /** Vigilancia (Sentinel): qué se está comprobando, qué está roto ahora mismo
   *  y por dónde saldría el aviso. Es el estado, no el histórico de la bandeja. */
  sentinel: async (sessionToken: string): Promise<AdminSentinel> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/sentinel`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminSentinel;
  },

  /** Keeper de escrows XRPL (G11): lo que el operador PIDIO frente a lo que
   *  de verdad corre. `divergent` es la respuesta; el resto es el porque. */
  keeper: async (sessionToken: string): Promise<AdminKeeper> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/keeper`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminKeeper;
  },

  /** Fuerza una pasada de vigilancia ahora (el botón «Comprobar ahora»). */
  sentinelRun: async (sessionToken: string): Promise<AdminSentinel> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/sentinel/run`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminSentinel;
  },

  /** Manda una alerta de prueba por el camino REAL, para que el primer crítico
   *  de verdad no sea también el primer intento de entrega. */
  sentinelTest: async (
    sessionToken: string,
    level: 'info' | 'warn' | 'critical' = 'warn',
  ): Promise<{ ok: boolean; level: string; channels: AdminAlertChannel[]; sentAt: string }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/sentinel/test`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ level }),
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as { ok: boolean; level: string; channels: AdminAlertChannel[]; sentAt: string };
  },

  /** La flota de jaulas (Sistema → «Jaulas · factory»): config del factory
   *  probada contra la cadena, censo de jaulas nacidas, nacimientos en vuelo
   *  y rechazos del prepare. Solo lecturas. */
  cages: async (sessionToken: string): Promise<AdminCageFleet> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/cages`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminCageFleet;
  },

  /** Métricas del SourceTag de Make Waves (entregable §8 T&C): Active Users /
   *  txs / volumen atribuidos al tag, leídos del ledger. Solo agregados. */
  sourceTag: async (sessionToken: string): Promise<AdminSourceTagMetrics> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/sourcetag`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminSourceTagMetrics;
  },

  /** Fuerza una pasada del agregador del tag ahora (el botón «Contar ahora»). */
  sourceTagRun: async (sessionToken: string): Promise<AdminSourceTagMetrics> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/sourcetag/run`, {
      method: 'POST',
      headers,
      credentials: 'include',
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminSourceTagMetrics;
  },

  /** ¿Nos da XRP Identity la wallet que el usuario conectó con Xaman en su
   *  perfil? Lee lo que /userinfo devolvió en los últimos logins reales —
   *  nombres y formas de las claims, jamás valores. */
  identityProbe: async (sessionToken: string): Promise<AdminIdentityProbe> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/identity-probe`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminIdentityProbe;
  },

  /** ¿Puede crear cuenta alguien que llegue ahora mismo? Con la puerta única de
   *  XRP Identity, el alta ocurre en el primer login: si está cerrada, el
   *  visitante rebota con 403 en vez de entrar. */
  signupGate: async (sessionToken: string): Promise<AdminSignupGate> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/signup-gate`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminSignupGate;
  },

  /** ¿De quién es esta dirección? Wallet enlazada, cuenta que la enlazó y las
   *  puertas que le dieron permiso (lista de espera, exención de tope, Legacy). */
  whois: async (sessionToken: string, address: string): Promise<AdminWhois> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-ops/whois?address=${encodeURIComponent(address)}`, {
      headers,
      credentials: 'include',
    });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminWhois;
  },
};

/** Respuesta de /admin-ops/sourcetag — las métricas del tag de Make Waves. */
export interface AdminSourceTagMetrics {
  tag: number | null;
  activeUsers: number;
  txCount: number;
  volumeXrp: number;
  accountsScanned: number;
  /** true = tope de páginas alcanzado en alguna cuenta — los totales son un
   *  SUELO del histórico alcanzado, no un techo. */
  truncated: boolean;
  oldestSeenISO: string | null;
  passes: number;
  lastPassAt: string | null;
  lastPassMs: number | null;
  error: string | null;
}

/** Una claim de XRP Identity descrita SIN repetir lo que decía. */
export interface AdminIdentityClaimShape {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  xrplAddress?: boolean;
  empty?: boolean;
}

/** Respuesta de /admin-ops/identity-probe — ¿nos da XRP Identity la wallet? */
export interface AdminIdentityProbe {
  /** XRPL_IDENTITY_PROFILE_SCOPE está encendido en Railway. */
  enabled: boolean;
  scopesRequested: string;
  probes: Array<{
    at: string;
    scopesRequested: string;
    idTokenClaims: string[];
    userinfo: { ok: true; claims: AdminIdentityClaimShape[] } | { ok: false; error: string };
    accountApi?:
      | { ok: true; walletPresent: boolean; looksLikeXrplAddress: boolean }
      | { ok: false; error: string };
  }>;
  /** null = aún no ha entrado nadie desde que se encendió (vive en memoria). */
  walletClaimSeen: boolean | null;
  /** Lo mismo, pero por la Account API — la vía que el operador sí ofrece. */
  walletViaAccountApi: boolean | null;
  checkedAt: string;
}

/** Respuesta de /admin-ops/signup-gate — ¿puede darse de alta alguien nuevo? */
export interface AdminSignupGate {
  open: boolean;
  variableSet: boolean;
  rawValue: string | null;
  approvedOnWaitlist: number | null;
  note: string;
  checkedAt: string;
}

/** Respuesta de /admin-ops/whois — a quién pertenece una dirección. */
export interface AdminWhois {
  address: string;
  found: boolean;
  wallets: Array<{
    address: string;
    nickname: string | null;
    walletType: string;
    network: string;
    ecosystem: string;
    purpose: string | null;
    isConnected: boolean;
    lastActivity: string;
    createdAt: string;
    user: { email: string | null; username: string | null; createdAt: string; lastLogin: string | null; authProvider: string } | null;
  }>;
  loginAccounts: Array<{
    email: string | null;
    username: string | null;
    createdAt: string;
    lastLogin: string | null;
    authProvider: string;
  }>;
  governedPointers: Array<{ label: string | null; createdAt: string; removedAt: string | null; user: { email: string | null } | null }>;
  accounts: Array<{
    email: string;
    waitlist: { email: string; approvedAt: string | null; invitedAt: string | null; source: string } | null;
    isAdmin: boolean;
    capExempt: boolean;
    legacyAccess: boolean;
  }>;
  capExemptByAddress: boolean;
  checkedAt: string;
}

/** Un canal externo de alertas y desde qué severidad entrega (nunca la URL). */
export interface AdminAlertChannel {
  name: string;
  armed: boolean;
  minLevel: 'info' | 'warn' | 'critical';
}

/** Un chequeo del Sentinel y cómo salió la última vez. */
export interface AdminKeeper {
  /** Lo que el operador PIDIO (el flag XRPL_KEEPER_ENABLED). */
  enabled: boolean;
  /** Lo que de verdad corre. */
  running: boolean;
  /** enabled && !running — la divergencia que G11 dejaba invisible. */
  divergent: boolean;
  /** El motivo cuando el flag esta encendido y no corre; null si no aplica. */
  notStartedReason: string | null;
  lastRunAt: string | null;
  resolvedCount: number;
  submitted: Array<{ action: string; owner: string; txHash: string; at: string }>;
}

export interface AdminSentinelProbe {
  id: string;
  title: string;
  level: 'ok' | 'info' | 'warn' | 'critical';
  /** true = no se comprobó (carril apagado en este entorno) ≠ está sano. */
  skipped: boolean;
  skipReason?: string;
  message: string | null;
  findings: number;
  checkedAt: string | null;
  durationMs: number | null;
}

/** Una incidencia abierta: qué pasa, sobre qué objeto y cómo se arregla. */
export interface AdminSentinelIssue {
  id: string;
  probeId: string;
  probeTitle: string;
  level: 'info' | 'warn' | 'critical';
  message: string;
  runbook: string | null;
  facts: Record<string, string | number | boolean | null> | null;
  since: string;
  ageMin: number;
  alerts: number;
}

/** Respuesta de /admin-ops/sentinel — el estado de la vigilancia. */
export interface AdminSentinel {
  enabled: boolean;
  running: boolean;
  intervalMin: number;
  lastPassAt: string | null;
  lastPassMs: number | null;
  passes: number;
  channels: AdminAlertChannel[];
  heartbeatConfigured: boolean;
  lastHeartbeatAt: string | null;
  probes: AdminSentinelProbe[];
  issues: AdminSentinelIssue[];
  counts: { critical: number; warn: number; info: number };
  checkedAt: string;
}

/** La flota de jaulas: el factory probado contra la cadena + censo + vuelos. */
export interface AdminCageFleet {
  factory: {
    configured: boolean;
    address: string | null;
    addressValid: boolean;
    hasCode: boolean | null;
    sourceId: string | null;
    expectedSourceId: string;
    sourceMatches: boolean | null;
    vaultCount: number | null;
    treasuryConfigured: boolean;
    treasuryValid: boolean;
    birthVenues: string[];
    capXrp: number | null;
  };
  census: Array<{
    vault: string;
    bridge: string;
    council: string | null;
    councilHash: string;
    totalPrincipalUBA: string | null;
    totalValueUBA: string | null;
    ordersExecuted: number | null;
    migrated: boolean | null;
  }>;
  births: Array<{
    userOpHash: string;
    personalAccount: string;
    council: string;
    grossXrpDrops: string;
    executorFeeXrp: number | null;
    status: string;
    createdAt: string;
    ageMinutes: number;
    flareTxHash: string | null;
    gasFLR: number | null;
    gasUsed: number | null;
  }>;
  economics: {
    chargedXrpNow: number | null;
    gasPriceGwei: number | null;
    estBirthGas: number;
    estBirthGasFLR: number | null;
    fdcFeeFLR: number;
    estTotalCostFLR: number | null;
  };
  refusals: {
    since: string;
    total: number;
    byCode: Record<string, number>;
    last: { code: string; at: string } | null;
  };
  checkedAt: string;
}

/** La cuenta anchor en XRPL: caja de las fees de las órdenes + combustible B3. */
export interface AdminAnchorStatus {
  anchor: string;
  balanceXrp: number;
  ledgerReserveXrp: number;
  ownerCount: number;
  /** Reserva que el hop B3 deja SIEMPRE (config, distinta de la del ledger). */
  feedReserveXrp: number;
  minFeedXrp: number;
  freeXrp: number;
  shouldFeed: boolean;
  feedXrp: number;
  missingXrp: number;
  /** Órdenes del consejo que faltan para que el hop dispare (null si fee off). */
  ordersToTrigger: number | null;
  orderFee: { enabled: boolean; xrp: number };
  seedConfigured: boolean;
  /**
   * Diagnóstico de la clave del anchor — nunca la clave: en qué formato está, qué
   * cuenta abre y si es la del anchor. "Configurada" no basta: una clave puede
   * estar puesta y abrir otra cuenta (default ed25519 de xrpl.js) o no abrir
   * ninguna (secret numbers). Opcional: el backend puede ir por detrás del deploy.
   */
  seed?: {
    configured: boolean;
    format?: 'family-seed' | 'secret-numbers' | 'unknown';
    address?: string;
    matchesExpected?: boolean;
    error?: string;
  };
  checkedAt: string;
}

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
    input: { hash: string; op: 'retry' | 'park' | 'dismiss'; reason?: string },
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

/* ── Puerta del ancla v2 (DepositAuth + preauth por credencial) ──────────── */

export interface AdminGateCredential {
  issuer: string;
  credentialTypeHex: string;
}
/** Un objeto DepositPreauth{AuthorizeCredentials}: el firmante lo sostiene ENTERO o no cruza. */
export type AdminGateSet = AdminGateCredential[];

export interface AdminAnchorGateState {
  anchor: string;
  /** `lsfDepositAuth` (0x01000000) en el AccountRoot — lo que un juez comprueba con account_info. */
  depositAuth: boolean;
  credentialSets: AdminGateSet[];
  accounts: string[];
  balanceXrp: number;
  ledgerReserveXrp: number;
  ownerCount: number;
  baseReserveXrp: number;
  ownerReserveXrp: number;
  readAtISO: string;
}

export interface AdminAnchorGatePlan {
  toAuthorize: AdminGateSet[];
  setFlag: boolean;
  reserveAfterXrp: number;
  shortfallXrp: number;
  alreadyArmed: boolean;
}

export interface AdminAnchorGateStatus {
  state: AdminAnchorGateState;
  configSets: AdminGateSet[];
  drift: { missing: AdminGateSet[]; extra: AdminGateSet[] };
  plan: AdminAnchorGatePlan;
  seed: { configured: boolean; format?: string; address?: string; matchesExpected?: boolean; error?: string };
  configError: string | null;
  verify: { accountInfo: string; accountObjects: string };
  checkedAt: string;
}

export interface AdminAnchorGateReport {
  anchor: string;
  dryRun: boolean;
  before: AdminAnchorGateState;
  plan: AdminAnchorGatePlan;
  submitted: Array<{ kind: 'DepositPreauth' | 'AccountSet'; label: string; hash: string | null; result: string }>;
  after: AdminAnchorGateState | null;
  stoppedBecause: string | null;
}

/** La puerta del ancla v2 desde el panel: leerla, armarla (seca por defecto), apagarla. Firma la
 *  clave OPERATIVA del ancla en el servidor — infra propia, jamás usuario. */
export const adminAnchorGateApi = {
  status: async (sessionToken: string): Promise<AdminAnchorGateStatus> => {
    const headers: Record<string, string> = { ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-anchor-gate`, { headers, credentials: 'include' });
    if (!r.ok) throw Object.assign(new Error(`http_${r.status}`), { status: r.status });
    return (await r.json()) as AdminAnchorGateStatus;
  },
  arm: async (sessionToken: string, input: { dryRun: boolean; objectsOnly?: boolean }): Promise<AdminAnchorGateReport> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-anchor-gate/arm`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(input) });
    const body = (await r.json().catch(() => ({}))) as AdminAnchorGateReport & { error?: string; detail?: string };
    if (!r.ok) throw Object.assign(new Error(body.detail ?? body.error ?? `http_${r.status}`), { status: r.status });
    return body;
  },
  disarm: async (sessionToken: string, input: { dryRun: boolean }): Promise<AdminAnchorGateReport> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeader() };
    if (sessionToken) headers['x-admin-session'] = sessionToken;
    const r = await fetch(`${API_BASE}/admin-anchor-gate/disarm`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(input) });
    const body = (await r.json().catch(() => ({}))) as AdminAnchorGateReport & { error?: string; detail?: string };
    if (!r.ok) throw Object.assign(new Error(body.detail ?? body.error ?? `http_${r.status}`), { status: r.status });
    return body;
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

/**
 * G1-cadena — the LEDGER's verdict on a past-deadline proposal's pinned
 * Sequence (backend `withEffectiveStatus`). XRPL consumes a Sequence exactly
 * once, so one `account_info` read separates three honest cases:
 *   · `consumed`   — the seat was USED. That signed tx can never be broadcast
 *                    again, but we do not know whether OURS was the tx that
 *                    used it: it MAY already have executed.
 *   · `unused`     — it never entered a ledger. Genuinely expired (and the row
 *                    is archived as `expired`, so this state rarely travels).
 *   · `unverified` — WE could not read XRPL. A failure of ours, never a state
 *                    of the world: nothing is archived and nothing is claimed.
 *
 * It travels as a FIELD, never as a status: the inbox buckets by status
 * equality, so a sixth status value would make the row vanish from every tray
 * — trading a lie for a disappearance.
 *
 * Only present when the deadline has passed AND the row kept a live status.
 */
export type CouncilLedgerCheck =
  | {
      state: 'consumed';
      deadlinePassed: true;
      pinnedSequence: number;
      accountSequence: number;
      checkedAt: string;
      detail: string;
    }
  | {
      state: 'unused';
      deadlinePassed: true;
      pinnedSequence: number;
      accountSequence: number;
      checkedAt: string;
      detail: string;
    }
  | {
      state: 'unverified';
      deadlinePassed: true;
      pinnedSequence: number | null;
      reason: string;
      checkedAt: string;
      detail: string;
    };

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
  /** G1-cadena — the ledger's verdict on the pinned seat, once the deadline
   *  passed. Absent while the proposal is still inside its 7 days. */
  ledgerCheck?: CouncilLedgerCheck;
  /**
   * it. 23 (it. 22 §2.3) — HOW MUCH OF THIS ROW YOU ARE BEING SERVED.
   *
   * it. 21 §3.7 gave a REGISTERED-only cosignatory the signing material in full
   * (txjson, signerList, quorum, blobs) and none of the family's deliberation:
   * `title` arrives null and `positions` empty, with `access: 'registered'` and
   * `redacted: ['title','positions']` saying so. The frontend read neither
   * field (grep: zero), so the redaction was rendered as FACT — «nobody has
   * fixed a position» — and «Fix my position» was offered over a door the
   * server refuses. A withheld thing must be named as withheld.
   *
   * `proven` (or the proposer's own row) is the full read. The route never
   * serves 'none' or 'unreadable' as a row: those are a 403 / 503.
   */
  access?: 'proven' | 'registered' | 'none' | 'unreadable';
  /** The fields that were withheld from THIS reader, named by the server. */
  redacted?: string[];
}

/**
 * productizer it. 25 (1) — LA FILA QUE EL SERVIDOR NO PUDO DECIDIR, DECLARADA.
 *
 * it. 23 dejó de tirarla: `GET /council/proposals` responde 200 con las filas
 * legibles en `proposals` y las indecidibles NOMBRADAS en `unreadable`, con el mismo
 * cuerpo (`error`/`retryable`/`detail`) que llevaría la respuesta entera si no
 * hubiese nada legible — para que la pantalla use UN solo lector en los dos sitios.
 * Este tipo no existía, así que los consumidores desestructuraban `proposals` y la
 * fila volvía a desaparecer: el mismo fallo, un piso más arriba.
 *
 * `PROPOSAL_STATUS_UNREADABLE` (it. 25) se suma a los códigos del piso de lectura:
 * la fila ES tuya, pero su estado no se pudo poner al día contra el ledger.
 */
export interface CouncilUnreadableRow {
  id: string;
  account: string;
  /** El código del servidor. Jamás se pinta crudo — va entre paréntesis. */
  error: string;
  /** ¿Se arregla solo reintentando? Un 409 determinista dice que no. */
  retryable?: boolean;
  /** La prosa del servidor, cuando la mandó. */
  detail?: string;
}

export const councilProposalsApi = {
  create: (body: { account: string; xrplTx: Record<string, unknown>; title?: string; region?: string }) =>
    jpost<{ proposal: CouncilProposalRecord; preflight: MultisigPrepare['preflight']; fee: MultisigPrepare['fee'] }>(
      '/council/proposals',
      body,
    ),
  list: (accounts: string[], onlyLive = false) =>
    jget<{ proposals: CouncilProposalRecord[]; unreadable?: CouncilUnreadableRow[] }>('/council/proposals', {
      accounts: accounts.join(','),
      ...(onlyLive ? { status: 'live' } : {}),
    }),
  detail: (id: string) => jget<{ proposal: CouncilProposalRecord }>(`/council/proposals/${id}`),
  sign: (id: string, signerAccount: string, blobHex: string) =>
    jpost<{ ok: boolean; status: CouncilProposalStatus; collectedWeight: number; quorum: number; signedBy: string[] }>(
      `/council/proposals/${id}/signatures`,
      { signerAccount, blobHex },
    ),
  /** Report the browser broadcast. For a council order the backend ALSO starts
   *  the courtesy relay server-side and says so in `councilOrder` — the FDC leg
   *  no longer depends on this browser staying open. */
  submitted: (id: string, txHash: string) =>
    jpost<{
      ok: boolean;
      proposal: CouncilProposalRecord;
      councilOrder?: { isOrder: true; relay: 'started' | 'already-relaying' | 'relayer-disabled' | 'not-launched' };
    }>(`/council/proposals/${id}/submitted`, { txHash }),
  /** G1-cadena — past the deadline the server refuses to file a proposal whose
   *  pinned seat the ledger says was USED (or could not read): "withdrawn"
   *  means "this never happened". `acknowledgeLedgerCheck` is the proposer
   *  stating they checked the explorer — a human statement, never our
   *  inference. */
  withdraw: (id: string, opts?: { acknowledgeLedgerCheck?: boolean }) =>
    jpost<{ ok: boolean; proposal: CouncilProposalRecord }>(`/council/proposals/${id}/withdraw`, {
      ...(opts?.acknowledgeLedgerCheck ? { acknowledgeLedgerCheck: true } : {}),
    }),
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

/** One venue registered in the cage — where the vault's principal may work. */
export interface LegacyVenueRow {
  id: number;
  target: string;
  /** ERC-20 symbol of the venue (e.g. `isoFXRP`) — a name, not a number. */
  targetSymbol: string | null;
  /** Shares the vault holds AT THE PROTOCOL — read from the venue itself, not
   *  from the vault's bookkeeping. Non-zero is the proof capital really moved. */
  shares: string | null;
  kind: 'erc4626' | 'compoundv2';
  /** Unix seconds: entry allowed only from here (the vault's waiting period). */
  readyAt: number;
  /** Closed to NEW entries; exits always work. */
  retired: boolean;
  /** Base units — decimal STRINGS, never numbers (18 decimals overflow a double). */
  basis: string;
  value: string;
}

/** The cage read out loud: what the vault holds, and where it can put it. */
export interface LegacyVaultState {
  vault: string;
  chain: string;
  asset: { address: string; symbol: string; decimals: number };
  totalPrincipal: string;
  allocatedPrincipal: string;
  idlePrincipal: string;
  totalValue: string;
  /** D2: the share of the vault any single venue may hold, in basis points. */
  maxVenueBps: number;
  migrated: boolean;
  venues: LegacyVenueRow[];
  /** Yield already credited to payees, awaiting claim(). */
  totalClaimable: string;
  /** Asset sitting in the vault that is NEITHER principal NOR owed yield —
   *  tokens sent straight to the address instead of through deposit(). They
   *  never became principal, so they fund nothing and nobody can claim them. */
  strayAssets: string;
  /** Who the vault OBEYS — the XrplCouncilBridge on this deployment. */
  council: string;
}

/** A composed cage disclosure — the facts before any signature (#6). */
export interface CageDisclosure {
  disclosedToUser: true;
  astryumSigns: false;
  note: string;
  facts: Record<string, string | number | boolean>;
}

/** What the council can actually afford to put into the cage. */
export interface LegacyVaultFundQuote {
  account: string;
  asset: { address: string; symbol: string; decimals: number };
  balanceXrp: string;
  reserveXrp: string;
  /** Balance minus the ledger reserve — what may leave the account at all. */
  spendableXrp: string;
  /** Base fee x (1 + signers): a multisig costs more than a single signature. */
  txFeeXrp: string;
  signerCount: number;
  /** Spendable minus the tx fee — what MAX should fill in. */
  maxGrossXrp: string;
  /** Below this the mint fees eat the whole payment and nothing lands. */
  minGrossXrp: string;
  /** Beta cap on caged capital: total the cage may hold via Astryum, what it
   *  holds now, and what still fits (null cap = disabled). Informational —
   *  the prepare enforces it, with the demo-cap exemption lists. */
  cage: { capXrp: number | null; currentPrincipalXrp: number; remainingXrp: number | null };
  /** Present when an amount was passed: the honest breakdown. */
  quote: { grossXrp: string; mintingFeeXrp: string; executorFeeXrp: string; principalAdded: string } | null;
}

/** The governed funding hand-off: one XRPL payment for the quorum. */
export interface LegacyVaultFundHandoff {
  account: string;
  vault: string;
  personalAccount: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  net: { grossXrp: string; supplyUBA: string; principalAddedXrp: string };
  disclosure: CageDisclosure;
}

/** The cage-birth prepare: one quorum signature creates the vault AND funds it. */
export interface LegacyCageCreateHandoff {
  account: string;
  predicted: { bridge: string; vault: string };
  factory: string;
  personalAccount: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  net: { grossXrp: string; supplyUBA: string; firstPrincipalXrp: string };
  disclosure: CageDisclosure;
}

/** The disclosure a person reads before capital can enter a cage. The TEXT is
 *  authored server-side and hashed there: this client renders and translates it,
 *  it never writes it (so the audit record can say what was on screen). */
export interface CageDisclosureDoc {
  version: number;
  /** SHA-256 of the canonical text — pinned into the ack record. */
  hash: string;
  title: string;
  lede: string;
  sections: Array<{ id: string; title: string; lines: string[] }>;
  acknowledgements: Array<{ id: string; text: string }>;
}

export interface CageDisclosureState {
  document: CageDisclosureDoc;
  /** ISO instant this user accepted THIS version, or null. */
  acceptedAt: string | null;
  /** Beta cap on caged principal — rendered beside the text, never inside it. */
  betaCapXrp: number | null;
}

export interface LegacyVaultYieldState {
  vault: string;
  asset: { address: string; symbol: string; decimals: number };
  totalClaimable: string;
  payees: Array<{ account: string; bps: number; claimable: string }>;
  harvestable: Array<{ venueId: number; amount: string }>;
  /** True when no payee is configured: ALL yield capitalizes into principal. */
  capitalizesToPrincipal: boolean;
}

export interface LegacyHarvestHandoff {
  venueId: number;
  harvestable: string;
  harvestableHuman: string;
  asset: { address: string; symbol: string; decimals: number };
  call: { to: string; data: string; value: string; summary: string };
  disclosure: CageDisclosure;
}

export interface LegacyYieldClaimHandoff {
  personalAccount: string;
  claimable: string;
  claimableHuman: string;
  redeemUBA: string;
  destination: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  disclosure: CageDisclosure;
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
  /**
   * productizer it. 17/19 (R3 N3, it.18 §2.1) — THE CONTESTED SEAT.
   *
   * An EXIT is never refused for somebody else's payload, so `/multisign/prepare`
   * composes it and says that ANOTHER proposal of this account is holding the same
   * Sequence. XRPL burns a Sequence exactly once: signing and broadcasting this
   * exit means the other payload can never apply.
   *
   * The warning existed and had NO READER on any screen (`grep seatContestWarning
   * frontend/src` → 0), so a council collected a quorum over two payloads of the
   * same seat without being told. It is read by `CouncilMultisigFlow` now.
   *
   * `seatContestWarning` is the server's prose and MAY name another council's
   * ceremony — so the screen renders its own sentence from the IDS in
   * `seatContest` instead (it. 19, cross-agent contract with the ceremony guard).
   */
  seatContestWarning?: string;
  seatContest?: {
    /** The rival proposal's id — the one to settle in the inbox. */
    proposalId?: string;
    /** Its transaction type (`Payment`, `AccountSet`…). Never its title. */
    txType?: string;
    /** The Sequence both payloads are pinned to. */
    pinnedSequence?: number;
  };
  /**
   * productizer it. 21 (it. 20 §2.5) — THREE DIFFERENT WARNINGS, ONE SENTENCE.
   *
   * `seatContestWarning` was a single free-text field into which the route
   * concatenated up to three UNRELATED things: a real rival payload holding the
   * Sequence, a transaction we could not CLASSIFY as an exit, and an inbox we
   * could not READ. The screen printed «another payload of this account is
   * holding the same Sequence» for all three — so a council whose only problem
   * was a database blip was sent to the inbox to settle a proposal that does
   * not exist, and the two warnings that are true had no reader at all.
   *
   * The server now sends them TYPED and the screen renders each with its own
   * sentence (`seatContestNotices`, CouncilMultisigFlow). The old field stays
   * for older clients; a client that understands this one ignores it.
   */
  seatNotices?: Array<{
    kind: 'rival-seat' | 'unclassified-exit' | 'inbox-unreadable';
    /** The rival proposal's id (`rival-seat` only). */
    proposalId?: string;
    /** Its transaction type — never its title (`rival-seat` only). */
    txType?: string;
    /** The Sequence both payloads are pinned to (`rival-seat` only). */
    pinnedSequence?: number;
    /** The server's own prose. MAY name another council: never rendered as-is. */
    detail?: string;
  }>;
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
  multisignPrepare: (account: string, xrplTx: Record<string, unknown>, opts?: { exitToken?: string | null }) =>
    jpost<MultisigPrepare>(
      '/xrpl-defi/multisign/prepare',
      // `exitToken` (from council-order/prepare on recall/evacuate) lets the
      // server skip the geofence for that exact tx — only sent when there is one.
      opts?.exitToken ? { account, xrplTx, exitToken: opts.exitToken } : { account, xrplTx },
    ),
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
  /** The cage of THIS Legacy: asset + decimals, idle vs working principal, and
   *  the REGISTERED venues. A cage belongs to exactly one council, so the
   *  account is what resolves it — a Legacy without one gets NO_CAGE_FOR_LEGACY
   *  instead of another council's balance (2026-08-05). `address` inspects any
   *  vault directly (public on-chain state). Read-only. */
  vaultState: (account: string, address?: string) =>
    jget<LegacyVaultState>('/xrpl-defi/vault-state', address ? { address } : { account }),
  /** What the funding form needs BEFORE anyone types: the council's real XRP,
   *  what it can spend, the floor below which fees eat everything, and — with
   *  an amount — how much principal actually lands. Read-only. */
  vaultFundQuote: (account: string, amountXrp?: string) =>
    jget<LegacyVaultFundQuote>('/xrpl-defi/vault-fund/quote', amountXrp ? { account, amountXrp } : { account }),
  /** FUND the cage, governed: ONE XRPL payment the quorum signs. It mints FXRP
   *  into this Legacy's own account on Flare and deposits it as principal.
   *  Directing that principal into a venue is a SECOND, separate order. */
  vaultFundPrepare: (body: { account: string; amountXrp: string; region?: string }) =>
    jpost<LegacyVaultFundHandoff>('/xrpl-defi/vault-fund/prepare', body).then(noteInstructionDelivery),
  /** BIRTH of this Legacy's own cage: ONE quorum signature creates the vault
   *  (factory.create runs from the council's own Flare account — nobody else
   *  can) and deposits the first principal into it (CREATE2 names the address
   *  before it exists). Directing capital is still a second order. */
  cageCreatePrepare: (body: { account: string; amountXrp: string; linajeFeeBps?: number; region?: string }) =>
    jpost<LegacyCageCreateHandoff>('/xrpl-defi/cage-create/prepare', body).then(noteInstructionDelivery),
  /** The one-way disclosure + whether this user has accepted its CURRENT
   *  version. Read-only, so it also serves the "How a cage works" link that
   *  must keep working after acceptance. */
  cageDisclosure: () => jget<CageDisclosureState>('/xrpl-defi/cage-disclosure'),
  /** Accept it. Every acknowledgement id, or the server refuses the lot. The
   *  version/hash recorded are the server's own — this only says "all four". */
  cageDisclosureAck: (body: { account?: string; version: number; acknowledgements: string[] }) =>
    jpost<{ version: number; hash: string; acceptedAt: string }>('/xrpl-defi/cage-disclosure/ack', body),
  /** Who is owed yield in THIS Legacy's cage, and what is ripe to realize. */
  vaultYield: (account: string) => jget<LegacyVaultYieldState>('/xrpl-defi/vault-yield', { account }),
  /** `harvest(venueId)` as a bare unsigned call — permissionless, pays the
   *  sender nothing; it only turns gain-above-basis into "the payees are owed". */
  vaultHarvestPrepare: (body: { account: string; venueId: number }) =>
    jpost<LegacyHarvestHandoff>('/xrpl-defi/vault-yield/harvest/prepare', body).then(noteInstructionDelivery),
  /** The heir's one signature: claim the yield owed and redeem it to native XRP
   *  through the existing unmint rail. YIELD only — principal never moves.
   *  `council` is the Legacy that owes; `xrplAddress` is the heir who signs. */
  vaultYieldClaimPrepare: (body: {
    council: string;
    xrplAddress: string;
    amountXrpForMint: string;
    xrplDest?: string;
    region?: string;
  }) =>
    jpost<LegacyYieldClaimHandoff>('/xrpl-defi/vault-yield/claim/prepare', body).then(noteInstructionDelivery),
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
    /** Only after an explicit confirm on 409 COUNCIL_ORDER_IN_FLIGHT (it.13). */
    confirmAnotherOrder?: boolean;
  }) =>
    // it. 19 (R3 N4): this route ALWAYS answers `serverDelivery`, and until now
    // nothing on this rail read it — the banner promised «Flare will act on
    // this» from the memo's shape. `lib/institutional/api` had the same wiring
    // for its own council orders; this is the Legacy one.
    jpost<CouncilOrderHandoff>('/xrpl-defi/council-order/prepare', body).then(noteInstructionDelivery),
  /** Ask the courtesy relayer to carry the validated XRPL tx across the FDC.
   *  Permissionless by design — anyone could deliver the same proof. */
  councilOrderRelay: (body: { xrplTxHash: string; orderData?: string }) =>
    jpost<{ started: boolean; state: string }>('/xrpl-defi/council-order/relay', body),
  /** Settlement truth, read from the bridge on-chain (+ local relay state).
   *  `account` names the Legacy whose bridge holds that truth — without it the
   *  backend falls back to the founding stack (only right for that council). */
  councilOrderStatus: (txId: string, account?: string) =>
    jget<{
      executed: boolean;
      nextNonce: number;
      relay: { state: 'relaying' | 'executed' | 'error'; detail?: string; flareTxHash?: string } | null;
    }>('/xrpl-defi/council-order/status', account ? { txId, account } : { txId }),
};

/** The council-order prepare result: a normal XRPL handoff plus the committed
 *  order (bytes + hash + nonce) the UI shows and the relayer needs as backup. */
export interface CouncilOrderHandoff extends XrplTxHandoff {
  /** Exits only (recall / evacuate): forwarded to /multisign/prepare so the
   *  server skips the geofence for exactly this tx. Absent otherwise. */
  exitToken?: string | null;
  /** When that token stops verifying (15 min). */
  exitTokenExpiresAt?: string;
  /** it.13: what the server took on (recorded + executor running = delivered without this screen). */
  serverDelivery?: { recorded: boolean; executorEnabled: boolean };
  /** it.13, exits only: the server could not remember the order — keep the screen open or relay by hash. */
  recoveryWarning?: string;
  /** it.13, exits only: another order of this account is already in flight. */
  inFlightWarning?: string;
  /** it.14, exits only: the SAME order (action + parameters) was launched for this council a moment ago. */
  duplicateWarning?: string;
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

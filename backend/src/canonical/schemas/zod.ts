import { z } from 'zod';

export const ProviderTypeSchema = z.enum([
  'chain', 'oracle', 'explorer', 'protocol',
  'fasset', 'wallet', 'data', 'engine',
]);

export const TrustLevelSchema = z.enum([
  'onchain_verified',
  'oracle_verified',
  'protocol_native',
  'indexer_verified',
  'aggregator',
  'community',
  'unverified',
]);

export const SourceRecordSchema = z.object({
  providerId: z.string().min(1),
  providerType: ProviderTypeSchema,
  trustLevel: TrustLevelSchema,
  fetchedAt: z.string().datetime(),
  traceId: z.string().min(1),
  stale: z.boolean().optional(),
});

export const CanonicalAssetSchema = z.object({
  symbol: z.string().min(1),
  address: z.string().min(1),
  chainId: z.number().int().positive(),
  decimals: z.number().int().nonnegative(),
  priceUSD: z.number().nullable(),
  source: SourceRecordSchema,
});

export const CanonicalAssetExposureSchema = z.object({
  asset: CanonicalAssetSchema,
  amount: z.string(),
  amountUSD: z.number(),
});

export const PositionKindSchema = z.enum([
  'free', 'collateral', 'debt', 'lp', 'staking', 'reward',
]);

export const CanonicalPositionMetricsSchema = z.object({
  healthFactor: z.number().optional(),
  ltv: z.number().optional(),
  liquidationPriceUSD: z.number().optional(),
  inRange: z.boolean().optional(),
  apr: z.number().optional(),
  apy: z.number().optional(),
  impermanentLossPct: z.number().optional(),
});

export const CanonicalPositionSchema = z.object({
  id: z.string().min(1),
  wallet: z.string().min(1),
  chainId: z.number().int().positive(),
  protocol: z.string().min(1),
  kind: PositionKindSchema,
  assets: z.array(CanonicalAssetExposureSchema),
  metrics: CanonicalPositionMetricsSchema.optional(),
  source: SourceRecordSchema,
});

export const RiskLevelSchema = z.enum(['safe', 'moderate', 'elevated', 'critical']);

export const RiskDriverSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.number().min(0).max(100),
});

export const CanonicalRiskSchema = z.object({
  wallet: z.string().min(1),
  score: z.number().min(0).max(100),
  level: RiskLevelSchema,
  drivers: z.array(RiskDriverSchema),
  warnings: z.array(z.string()),
  source: SourceRecordSchema,
});

export const ActionTypeSchema = z.enum([
  'repay', 'addCollateral', 'withdraw', 'supply', 'borrow',
  'harvest', 'exitLP', 'addLiquidity', 'swap',
  'stake', 'unstake', 'crossChainSwap',
  'wrap', 'unwrap', 'delegate', 'undelegate', 'claimRewards',
]);

export const CanonicalActionSchema = z.object({
  type: ActionTypeSchema,
  targetProtocol: z.string().min(1),
  targetChain: z.number().int().positive(),
  params: z.record(z.unknown()),
});

export const SimulationResultSchema = z.object({
  success: z.boolean(),
  newHF: z.number().optional(),
  newLTV: z.number().optional(),
  gasEstimate: z.string(),
  gasEstimateUSD: z.number(),
  netUSDImpact: z.number(),
  riskDelta: z.number(),
  warnings: z.array(z.string()),
  simulatedAt: z.string().datetime(),
  priceTimestamp: z.string().datetime(),
  isStale: z.boolean(),
});

export const IntentRiskDeltaSchema = z.object({
  hfBefore: z.number().optional(),
  hfAfter: z.number().optional(),
  hfChange: z.number().optional(),
  scoreBefore: z.number(),
  scoreAfter: z.number(),
  warnings: z.array(z.string()),
  isDefensive: z.boolean(),
});

export const IntentTxDataSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.string(),
  gasLimit: z.string(),
  chainId: z.number().int().positive(),
});

export const IntentStatusSchema = z.enum([
  'building', 'proposed', 'pending_user_review', 'expired', 'signed',
  'broadcast', 'mempool', 'confirmed', 'failed',
]);

export const CanonicalIntentSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  owner: z.string().min(1),
  sessionId: z.string().min(1),
  action: CanonicalActionSchema,
  protocol: z.string().min(1),
  positionId: z.string().optional(),
  simulation: SimulationResultSchema,
  simulatedAt: z.string().datetime(),
  pricesFreshAt: z.string().datetime(),
  riskDelta: IntentRiskDeltaSchema,
  explanation: z.string(),
  warnings: z.array(z.string()),
  txData: IntentTxDataSchema.optional(),
  status: IntentStatusSchema,
  txHash: z.string().optional(),
  confirmedAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
  source: SourceRecordSchema,
});

export const ActivityTypeSchema = z.enum([
  'swap', 'supply', 'borrow', 'repay', 'withdraw',
  'stake', 'unstake', 'claim', 'transfer', 'approve',
  'addLiquidity', 'removeLiquidity', 'other',
]);

export const CanonicalActivityEventSchema = z.object({
  id: z.string().min(1),
  wallet: z.string().min(1),
  txHash: z.string().min(1),
  blockNumber: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: ActivityTypeSchema,
  protocol: z.string().optional(),
  assetIn: CanonicalAssetExposureSchema.optional(),
  assetOut: CanonicalAssetExposureSchema.optional(),
  source: SourceRecordSchema,
});

export const RewardSourceSchema = z.enum(['ftso', 'flaredrop', 'protocol', 'staking', 'lp_fees']);

export const CanonicalRewardEventSchema = z.object({
  id: z.string().min(1),
  wallet: z.string().min(1),
  source: RewardSourceSchema,
  providerId: z.string().min(1),
  asset: CanonicalAssetSchema,
  amount: z.string(),
  amountUSD: z.number(),
  blockNumber: z.number().int().nonnegative(),
  claimedAt: z.string().datetime().nullable(),
  sourceRecord: SourceRecordSchema,
});

export const PolicyIdSchema = z.enum([
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'P7', 'P8', 'P9', 'P10', 'P11', 'P12',
  'P13', 'P14', 'P15', 'P16', 'P17', 'P18',
]);

export const AuditDecisionSchema = z.enum(['pass', 'fail', 'warn']);

export const PolicyCheckResultSchema = z.object({
  policyId: PolicyIdSchema,
  result: AuditDecisionSchema,
  reason: z.string().optional(),
});

export const CanonicalAuditEventSchema = z.object({
  traceId: z.string().min(1),
  providerId: z.string().min(1),
  capability: z.string().min(1),
  decision: AuditDecisionSchema,
  policyChecks: z.array(PolicyCheckResultSchema),
  latencyMs: z.number().nonnegative(),
  cached: z.boolean(),
  fellBack: z.boolean(),
  timestamp: z.string().datetime(),
});

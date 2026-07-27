/**
 * CalldataBuilder
 *
 * Builds unsigned transaction calldata for any DeFi action on any supported protocol+chain.
 * Fee attribution is embedded at construction time.
 *
 * REGULATORY INVARIANTS (never remove):
 *   authorization.defibroRelays = false  — always
 *   referralAttribution.disclosedToUser = true — always
 *   Astryum never calls sendTransaction or broadcastTransaction
 */

import { ethers, Interface } from 'ethers';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import type { IntentPayload } from '../types/IntentPayload';
import {
  PROTOCOL_CONTRACTS,
  canHandle as registryCanHandle,
  getProtocolConfig,
  type ProtocolContractConfig,
} from '../config/protocolContracts';
import { prisma } from '../database/prismaClient';
import type { DetectedAction } from '../services/ProtocolIntegrationService';
import { contractRegistry, type PoolRecord } from '../services/ContractRegistry';
import type { ContractKind } from '../services/contractKinds';
import { ensoProvider } from '../integrations/providers/defi/EnsoProvider';
import { v1RouterFor, v1AdapterFor } from '../config/v1Pools.config';
import { addDynamicContractAddress } from '../config/allowlist.config';

const INTENT_TTL_SECONDS = 300;
const FLARE_CHAIN_ID = 14;
/** Invariant #8: the Flare DeFi execution module is geofenceable behind this flag. */
function isFlareDefiEnabled(): boolean {
  return process.env.FLARE_DEFI_ENABLED === 'true';
}
const DEFIBRO_FEE_WALLET = process.env.DEFIBRO_FEE_WALLET ?? '';
const DEFIBRO_REFERRAL_CODE = Number(process.env.DEFIBRO_REFERRAL_CODE ?? '0');
const DEFIBRO_ATTRIBUTION_BPS = parseInt(process.env.DEFIBRO_ATTRIBUTION_BPS ?? '15', 10);
const ABIS_DIR = path.join(__dirname, '../config/abis');

// ABI cache — loaded once per process
const abiCache = new Map<string, ethers.InterfaceAbi>();

function loadAbi(abiName: string): ethers.InterfaceAbi {
  const cached = abiCache.get(abiName);
  if (cached) return cached;
  const filePath = path.join(ABIS_DIR, `${abiName}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const abi = JSON.parse(raw) as ethers.InterfaceAbi;
  abiCache.set(abiName, abi);
  return abi;
}

/**
 * Build the referral attribution block.
 *
 * 2026-06-01 regulatory audit (Cat 5.1): the referral fee is now conditional on
 * the resolved partner. When the partner does not permit referral fees (e.g.
 * CoW Protocol uses surplus sharing, UniswapX is gasless), or when no partner
 * has been resolved (which the route layer should never permit), Astryum does
 * NOT embed any fee. This avoids the "fee on direct flows without licensed
 * intermediary" CASP-risk pattern.
 */
function buildReferralAttribution(allowsReferralFee: boolean) {
  if (!allowsReferralFee) {
    return {
      referralCode: null,
      referralWallet: null,
      attributionBps: 0,
      disclosedToUser: true as const,
      disclosureText:
        'No Astryum referral fee on this intent — partner does not permit referral attribution.',
    };
  }
  return {
    referralCode: String(DEFIBRO_REFERRAL_CODE),
    referralWallet: DEFIBRO_FEE_WALLET,
    attributionBps: DEFIBRO_ATTRIBUTION_BPS,
    disclosedToUser: true as const,
    disclosureText: `Astryum referral: ${DEFIBRO_ATTRIBUTION_BPS / 100}% → ${DEFIBRO_FEE_WALLET.slice(0, 8)}…`,
  };
}

function buildAuthorization() {
  return {
    mode: 'user_authorized_partner_relay' as const,
    userMustAuthorize: true as const,
    defibroRelays: false as const,
    singleUseSession: true as const,
  };
}

function buildExpiry() {
  return {
    expiresAt: new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString(),
    ttlSeconds: INTENT_TTL_SECONDS,
  };
}

export interface PrepareParams {
  /** DefiLlama protocol slug, e.g. 'aave-v3' */
  protocolSlug: string;
  actionType: 'supply' | 'borrow' | 'repay' | 'withdraw' | 'stake' | 'unstake' |
              'vault_deposit' | 'vault_withdraw';
  /** Amount in wei as decimal string */
  amount: string;
  /** ERC-20 asset address (not needed for native stake actions like Lido/Rocket Pool) */
  asset?: string;
  /** Asset SYMBOL (e.g. 'USDC.E', 'SFLR', 'FXRP') — connector adapters use it to pick the per-asset market. */
  assetSymbol?: string;
  /** Collateral token address — required for the Enso `borrow` long-tail path
   *  (the asset the user already supplied as collateral). */
  collateralAsset?: string;
  userWallet: string;
  chainId: number;
  /** Pool address override — used for dynamic vaults (Yearn) */
  poolAddressOverride?: string;
  /** For Morpho Blue markets — pass the marketParams object */
  morphoMarketParams?: {
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: string;
  };
  /** DefiLlama pool ID — used by CanonicalBridgeService to check for anomaly blocks */
  poolId?: string;
  traceId?: string;
  sessionId?: string;
  intentSource?: 'user' | 'automation' | 'ai_copilot';
  /**
   * REQUIRED — id of the regulated partner this intent routes through.
   * Resolved upstream by PartnerRegistry.resolveForOperation(). The route
   * layer refuses to call CalldataBuilder without one (2026-06-01 audit Cat 2.1).
   */
  partnerId: string;
  /**
   * Whether the resolved partner permits Astryum to embed a referral / integrator
   * fee in the intent. When false, no DEFIBRO_FEE_WALLET / referralCode is
   * embedded — required to avoid the "fee on direct flows" CASP risk (Cat 5).
   */
  partnerAllowsReferralFee: boolean;
  /**
   * Whether the resolved partner is a REGULATED_CASP that requires KYC (fiat
   * on/off-ramp). PolicyGuard P38 is enforced ONLY when this is true. Tier 1
   * WALLET_PARTNER self-custody DeFi (Aave/Compound/Morpho/Lido… — the Safe
   * Markets case) sets this false: the user signs with their own wallet and no
   * KYC is required. Defaults to false when omitted so a missing flag can never
   * silently block a normal DeFi intent.
   */
  partnerRequiresKyc?: boolean;
  /**
   * User KYC verification flag (from User.kycVerified in DB). Consulted by
   * PolicyGuard P38 only when `partnerRequiresKyc` is true. Routes look this up
   * via the authenticated user and pass it through — CalldataBuilder never
   * reads the DB itself.
   */
  userKycVerified: boolean;
}

export class CalldataBuilder {

  /**
   * Check if this builder can handle the given protocol+chain+action.
   * Checks the static registry first, then falls back to DB records.
   */
  async canHandle(protocolSlug: string, chainId: number, actionType: string): Promise<boolean> {
    // Connector-routed protocols (Flare PATH C): executable when the adapter is
    // registered, active, and can encode actions. Per-asset market availability
    // is enforced precisely at prepare() time (encodeAction throws if not set).
    const adapterId = v1AdapterFor(protocolSlug, chainId);
    if (adapterId) {
      // Invariant #8: Flare DeFi execution stays behind FLARE_DEFI_ENABLED.
      if (chainId === FLARE_CHAIN_ID && !isFlareDefiEnabled()) return false;
      try {
        const adapter = await this._getConnectorAdapter(adapterId, chainId);
        if (adapter?.isActive && typeof adapter.encodeAction === 'function') return true;
      } catch {
        /* fall through to other paths */
      }
    }

    // Block F (2026-06-01) — ContractRegistry is the primary source of truth.
    // A pool is executable when it's active, has a resolved interaction
    // contract + ABI, AND supports the requested action.
    try {
      const pool = await contractRegistry.getExecutablePoolForAction({
        protocolSlug,
        chainId,
        actionType,
      });
      if (pool) return true;
    } catch {
      // registry is unavailable — fall through to legacy paths
    }

    // EMERGENCY_FALLBACK: static legacy registry (protocolContracts.ts).
    // To be removed once ContractRegistry has stable production data 30+ days.
    if (registryCanHandle(protocolSlug, chainId, actionType)) return true;

    // Last resort: DB record (P10.5 dynamic integration — pre-Block-F path).
    try {
      const record = await prisma.protocolContractRecord.findUnique({
        where: { slug_chainId: { slug: protocolSlug, chainId } },
        select: { actions: true },
      });
      if (!record) return false;
      const actions = record.actions as unknown as Record<string, DetectedAction> | null;
      return !!(actions && actionType in actions);
    } catch {
      return false;
    }
  }

  /**
   * Main dispatcher — builds an IntentPayload with real unsigned calldata.
   * Tries the static registry first, then falls back to DB records.
   */
  async prepare(params: PrepareParams): Promise<IntentPayload> {
    if (!DEFIBRO_FEE_WALLET) {
      throw new Error('P33: DEFIBRO_FEE_WALLET not configured — required for fee attribution.');
    }

    // Canonical bridge safety gate — block pools flagged by AnomalyDetector or PoolHealthScorer
    if (params.poolId) {
      const { canonicalBridgeService } = await import('../services/CanonicalBridgeService');
      if (canonicalBridgeService.isPoolBlocked(params.poolId)) {
        throw new Error('POOL_RISK_BLOCKED');
      }
    }

    // ── CONNECTOR (PATH C): bespoke protocol adapters (Flare Kinetic/SparkDEX) ──
    // Single neck: the adapter ONLY encodes {to,calldata,value}; this method wraps
    // it in the SAME regulatory envelope as every other path. Checked before the
    // registry because connector protocols are not DefiLlama-registry-resolvable.
    if (v1RouterFor(params.protocolSlug, params.chainId) === 'connector') {
      return await this._prepareFromConnector(params);
    }

    // ── PRIMARY: ContractRegistry (Block F, 2026-06-01) ─────────────────────
    // The registry holds DefiLlama-sourced pools with resolved interaction
    // contract + ABI + capability flags. CalldataBuilder reads the address
    // and ABI from here — no hardcoded protocol-specific contract.
    try {
      const pool = await contractRegistry.getExecutablePoolForAction({
        poolId: params.poolId,
        protocolSlug: params.protocolSlug,
        chainId: params.chainId,
        actionType: params.actionType,
      });
      if (pool) {
        // `await` is required: the helper is async, and the surrounding try/catch
        // must catch its rejections to preserve fall-through to the legacy paths.
        return await this._prepareFromRegistryOrEnso(pool, params);
      }
    } catch (err) {
      // Registry lookup failure (DB issue) — log and fall through to legacy
      console.warn('[CalldataBuilder] ContractRegistry lookup failed:', (err as Error).message);
    }

    // ── EMERGENCY_FALLBACK: legacy static config (protocolContracts.ts) ─────
    // To be removed once the registry has stable production coverage.
    const config = getProtocolConfig(params.protocolSlug);
    if (config) {
      return this._prepareFromStaticConfig(config, params);
    }

    // ── LAST RESORT: P10.5 dynamic DB record path ──────────────────────────
    const dbRecord = await prisma.protocolContractRecord.findUnique({
      where: { slug_chainId: { slug: params.protocolSlug, chainId: params.chainId } },
    });
    if (dbRecord) {
      return this._prepareFromDBRecord(dbRecord, params);
    }

    throw new Error(`CalldataBuilder: unknown protocol "${params.protocolSlug}" — not in ContractRegistry, static fallback, or DB`);
  }

  /**
   * Block F primary path. Uses the ContractRegistry's resolved interaction
   * contract + ABI + capability flags. The contract kind dispatches to a
   * small action-shape map (function name + arg list per action+kind).
   *
   * This eliminates the per-protocol hardcoded `chainConfig.actions` from
   * the legacy path — adding a new protocol now only requires:
   *   1. Adding a slug → kind entry in PROTOCOL_KIND_MAP (contractKinds.ts)
   *   2. (If new kind) Adding a resolver to contractResolvers/
   *   3. (If new kind) Adding action shapes to ACTION_SHAPE_BY_KIND below
   */
  /**
   * CONNECTOR path (PATH C). Delegates calldata encoding to a registered
   * IProtocolAdapter (Flare Kinetic/SparkDEX) and wraps it in the SAME envelope
   * (policy / authorization / referral / expiry) as the registry path. The
   * adapter contributes ONLY {to, calldata, value} — no discretion, no relay.
   *
   * This is the shared neck for both consumers: the manual button calls prepare()
   * via /api/intents; moneyflows call prepare() and hand tx.{to,data,value} to
   * ConditionalIntentService as the DeterministicAction.
   */
  /**
   * Resolve a registered IProtocolAdapter, ensuring Flare adapters are registered
   * regardless of boot order. registerFlareAdapters is idempotent (Map.set), so a
   * defensive call is safe when an intent prepare precedes engine bootstrap.
   */
  private async _getConnectorAdapter(adapterId: string, chainId: number) {
    const { protocolRegistry } = await import('../connectors/protocols/ProtocolRegistry');
    let adapter = protocolRegistry.getAdapter(adapterId, chainId);
    if (!adapter) {
      const { registerFlareAdapters } = await import('../connectors/protocols/adapters');
      registerFlareAdapters(protocolRegistry);
      adapter = protocolRegistry.getAdapter(adapterId, chainId);
    }
    return adapter;
  }

  private async _prepareFromConnector(params: PrepareParams): Promise<IntentPayload> {
    const adapterId = v1AdapterFor(params.protocolSlug, params.chainId);
    if (!adapterId) {
      throw new Error(`CONNECTOR_NOT_RESOLVED: no adapter for "${params.protocolSlug}" on chainId=${params.chainId}`);
    }
    // Invariant #8: Flare DeFi execution stays behind FLARE_DEFI_ENABLED. Enforced
    // here at the neck so BOTH consumers (manual button + moneyflow conditional)
    // respect the geofence flag — never just at the route.
    if (params.chainId === FLARE_CHAIN_ID && !isFlareDefiEnabled()) {
      throw new Error('FLARE_DEFI_DISABLED: set FLARE_DEFI_ENABLED=true to execute Flare DeFi');
    }
    const adapter = await this._getConnectorAdapter(adapterId, params.chainId);
    if (!adapter) {
      throw new Error(`CONNECTOR_NOT_REGISTERED: adapter "${adapterId}" not registered for chainId=${params.chainId}`);
    }
    if (!adapter.isActive) {
      throw new Error(`CONNECTOR_INACTIVE: adapter "${adapterId}" is missing its env addresses`);
    }
    if (typeof adapter.encodeAction !== 'function') {
      throw new Error(`CONNECTOR_ENCODE_UNAVAILABLE: adapter "${adapterId}" cannot encode actions yet`);
    }

    const encoded = await adapter.encodeAction({
      actionType: params.actionType,
      amount: params.amount,
      userWallet: params.userWallet,
      assetSymbol: params.assetSymbol,
      assetAddress: params.asset,
    });

    // P35: a connector-resolved interaction contract becomes executable, mirroring
    // ContractRegistry.upsertResolution. The route still re-checks isContractAllowed.
    addDynamicContractAddress(encoded.to);

    const policyResult = this._evaluatePolicy({
      userKycVerified: params.userKycVerified,
      partnerRequiresKyc: params.partnerRequiresKyc ?? false,
    });
    if (!policyResult.passed) {
      throw Object.assign(new Error(`POLICY_BLOCKED: ${policyResult.blockReason}`), {
        code: 'POLICY_BLOCKED',
        blockReason: policyResult.blockReason,
        warnings: policyResult.warnings,
      });
    }

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();
    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: encoded.to,
        data: encoded.calldata,
        value: encoded.value,
        gasLimit: this._estimateGasLimit(params.actionType),
        chainId: params.chainId,
      },
      metadata: {
        action: params.actionType,
        protocol: params.protocolSlug,
        description: `${params.actionType} via ${adapterId} connector (PATH C) on chainId=${params.chainId}.`,
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        partnerId: params.partnerId,
      },
      referralAttribution: buildReferralAttribution(params.partnerAllowsReferralFee),
      authorization: buildAuthorization(),
      policy: {
        evaluatedAt: policyResult.evaluatedAt,
        passed: policyResult.passed,
        warnings: [...policyResult.warnings],
      },
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  private _prepareFromContractRegistry(pool: PoolRecord, params: PrepareParams): IntentPayload {
    if (!pool.interactionContractAddress) {
      throw new Error('CONTRACT_NOT_RESOLVED');
    }
    if (!pool.contractKind) {
      throw new Error('CONTRACT_KIND_MISSING');
    }
    const kind = pool.contractKind;

    const actionShape = ACTION_SHAPE_BY_KIND[kind]?.[params.actionType];
    if (!actionShape) {
      throw new Error(
        `ACTION_SHAPE_NOT_FOUND: action "${params.actionType}" has no encoding for kind "${kind}"`,
      );
    }

    const poolAddress = pool.interactionContractAddress;

    // Encode via the resolved ABI from the registry.
    const iface = new Interface(pool.abi as ethers.InterfaceAbi);
    const args = this._resolveArgsForRegistry(actionShape.args, params, pool);
    const calldata = iface.encodeFunctionData(actionShape.fn, args);
    const value = actionShape.isPayable ? params.amount : '0';

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();

    const policyResult = this._evaluatePolicy({
      userKycVerified: params.userKycVerified,
      partnerRequiresKyc: params.partnerRequiresKyc ?? false,
    });
    if (!policyResult.passed) {
      throw Object.assign(new Error(`POLICY_BLOCKED: ${policyResult.blockReason}`), {
        code: 'POLICY_BLOCKED',
        blockReason: policyResult.blockReason,
        warnings: policyResult.warnings,
      });
    }

    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: poolAddress,
        data: calldata,
        value,
        gasLimit: this._estimateGasLimit(params.actionType),
        chainId: params.chainId,
      },
      metadata: {
        action: params.actionType,
        protocol: params.protocolSlug,
        description:
          `${params.actionType} via ${pool.protocolName} (${kind}) on chainId=${params.chainId}. ` +
          `Source: ContractRegistry [${pool.abiSource ?? 'unknown'}]. ` +
          (pool.cooldownSeconds && pool.cooldownSeconds > 0
            ? ` ⚠️ Cooldown: ~${Math.round(pool.cooldownSeconds / 86400)} day(s).`
            : ''),
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        partnerId: params.partnerId,
        ...(pool.cooldownSeconds && pool.cooldownSeconds > 0
          ? { cooldownDays: Math.round(pool.cooldownSeconds / 86400) }
          : {}),
      },
      referralAttribution: buildReferralAttribution(params.partnerAllowsReferralFee),
      authorization: buildAuthorization(),
      policy: {
        evaluatedAt: policyResult.evaluatedAt,
        passed: policyResult.passed,
        warnings: [...policyResult.warnings],
      },
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  /**
   * Resolve abstract arg names to concrete values for the ContractRegistry path.
   * Same vocabulary as the legacy _resolveArgs but driven by ACTION_SHAPE_BY_KIND
   * rather than per-slug chainConfig.actions.
   */
  private _resolveArgsForRegistry(
    argNames: ReadonlyArray<string>,
    params: PrepareParams,
    pool: PoolRecord,
  ): unknown[] {
    return argNames.map((name) => {
      switch (name) {
        case 'asset':
          if (!params.asset) throw new Error('CalldataBuilder: "asset" address required');
          return params.asset;
        case 'amount':
        case 'assets':
        case 'shares':
          return BigInt(params.amount);
        case 'onBehalfOf':
        case 'onBehalf':
        case 'receiver':
        case 'owner':
        case 'to':
          return params.userWallet;
        case 'referralCode':
          return params.partnerAllowsReferralFee ? DEFIBRO_REFERRAL_CODE : 0;
        case '_referral':
          return params.partnerAllowsReferralFee
            ? (DEFIBRO_FEE_WALLET as string)
            : '0x0000000000000000000000000000000000000000';
        case 'interestRateMode':
          return 2n; // Aave variable rate by default
        case '_amounts':
          return [BigInt(params.amount)]; // Lido requestWithdrawals
        case '_owner':
          return params.userWallet;
        case 'data':
          return '0x';
        case 'marketParams': {
          // Morpho MarketParams come from the registry (resolved server-side),
          // NOT from the request body — the frontend never knows them. Fall
          // back to an explicit body value only if a caller still provides one.
          const mp = pool.morphoMarketParams ?? params.morphoMarketParams;
          if (!mp) {
            throw Object.assign(
              new Error('MORPHO_MARKET_PARAMS_UNAVAILABLE: market not resolved for this pool'),
              { code: 'MORPHO_MARKET_PARAMS_UNAVAILABLE' },
            );
          }
          return mp;
        }
        default:
          throw new Error(`CalldataBuilder: unknown arg name "${name}" — add mapping`);
      }
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Wraps the ContractRegistry path with the Enso long-tail fallback (§1.1).
   * If the resolved pool's contractKind has no native ACTION_SHAPE encoding
   * (ACTION_SHAPE_NOT_FOUND) or no kind at all (CONTRACT_KIND_MISSING), route to
   * Enso. Any other error (POLICY_BLOCKED, MORPHO_MARKET_PARAMS_UNAVAILABLE, …)
   * is re-thrown unchanged.
   */
  private async _prepareFromRegistryOrEnso(
    pool: PoolRecord,
    params: PrepareParams,
  ): Promise<IntentPayload> {
    try {
      return this._prepareFromContractRegistry(pool, params);
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      if (msg.startsWith('ACTION_SHAPE_NOT_FOUND') || msg.startsWith('CONTRACT_KIND_MISSING')) {
        const ensoIntent = await this._prepareFromEnso(params, pool);
        if (ensoIntent) return ensoIntent;
      }
      throw err;
    }
  }

  /**
   * Long-tail execution fallback via Enso (the universal connector, §1.1).
   *
   * Reached only when ContractRegistry resolved a pool but its contractKind has
   * no native ACTION_SHAPE encoding. Enso abstracts hundreds of EVM protocols
   * and returns unsigned calldata; the user's wallet signs (defibroRelays:false).
   *
   * Returns null (caller re-throws the original error) when Enso can't serve the
   * case: no input asset, unsupported action in this first cut (deposit/withdraw),
   * no position token resolvable, or Enso doesn't list the protocol on this chain.
   *
   * Regulatory: same `_evaluatePolicy` gate (P38 KYC only for CASP) and the same
   * buildAuthorization/buildReferralAttribution/buildExpiry helpers as every
   * other path. Enso (chains 1/137/42161/10/8453/56/43114/250 — NOT Flare) is a
   * fee-permitting partner; the embedded integrator fee is disclosed via
   * referralAttribution and gated by partnerAllowsReferralFee.
   *
   * First cut: supply/deposit + withdraw. borrow/repay/stake/unstake need
   * per-action Enso mapping (follow-up) — they return null here.
   */
  private async _prepareFromEnso(
    params: PrepareParams,
    pool: PoolRecord,
  ): Promise<IntentPayload | null> {
    if (!params.asset) return null; // Enso routes from an input token
    const ensoAction = ENSO_ACTION_BY_ACTIONTYPE[params.actionType];
    if (!ensoAction) return null;

    const asset = params.asset; // narrowed to string by the guard above
    // primaryAddress = the protocol's interaction contract (lending pool / vault).
    const primaryAddress = pool.interactionContractAddress;

    // Only proceed if Enso actually lists this protocol on this chain.
    const canHandle = await ensoProvider.canHandle(
      params.protocolSlug,
      params.chainId,
      ensoAction,
    );
    if (!canHandle) return null;

    // Same policy gate as the native paths (KYC P38 only for CASP partners).
    const policyResult = this._evaluatePolicy({
      userKycVerified: params.userKycVerified,
      partnerRequiresKyc: params.partnerRequiresKyc ?? false,
    });
    if (!policyResult.passed) {
      throw Object.assign(new Error(`POLICY_BLOCKED: ${policyResult.blockReason}`), {
        code: 'POLICY_BLOCKED',
        blockReason: policyResult.blockReason,
        warnings: policyResult.warnings,
      });
    }

    // Build the Enso bundle per action family.
    let bundleParams: ReturnType<typeof ensoProvider.resolveIntent>;
    if (ensoAction === 'borrow' || ensoAction === 'repay') {
      // Lending actions use Enso's `args` shape; primaryAddress = the pool.
      if (!primaryAddress) return null;
      // borrow needs the collateral token — a plain borrow intent doesn't carry it.
      if (ensoAction === 'borrow' && !params.collateralAsset) return null;
      bundleParams = ensoProvider.resolveLendingAction(
        ensoAction,
        {
          protocol: params.protocolSlug,
          chainId: params.chainId,
          asset,
          amount: params.amount,
          primaryAddress,
          collateral: params.collateralAsset,
        },
        params.userWallet,
      );
    } else {
      // deposit/redeem — direction by action:
      //   deposit (supply/vault_deposit): in = underlying, out = position token
      //   withdraw (withdraw/vault_withdraw): in = position token, out = underlying
      const positionToken = pool.receiptTokenAddress ?? pool.interactionContractAddress;
      if (!positionToken) return null;
      const isWithdraw = ensoAction === 'withdraw';
      bundleParams = ensoProvider.resolveIntent(
        {
          protocol: params.protocolSlug,
          chainId: params.chainId,
          tokenIn: isWithdraw ? positionToken : asset,
          tokenOut: isWithdraw ? asset : positionToken,
          action: ensoAction,
        },
        params.userWallet,
        params.amount,
      );
    }

    const bundle = await ensoProvider.getBundleCalldata(bundleParams);
    if (!bundle.tx?.to || !bundle.tx?.data || bundle.tx.data === '0x') {
      throw new Error('ENSO_EMPTY_CALLDATA');
    }

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();

    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: bundle.tx.to,
        data: bundle.tx.data,
        value: bundle.tx.value,
        gasLimit: bundle.tx.gas,
        chainId: params.chainId,
      },
      metadata: {
        action: params.actionType,
        protocol: params.protocolSlug,
        description:
          `${params.actionType} via ${pool.protocolName} on chainId=${params.chainId}. ` +
          `Source: Enso (long-tail router, kind="${pool.contractKind ?? 'unknown'}").`,
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        partnerId: params.partnerId,
      },
      referralAttribution: buildReferralAttribution(params.partnerAllowsReferralFee),
      authorization: buildAuthorization(),
      policy: {
        evaluatedAt: policyResult.evaluatedAt,
        passed: policyResult.passed,
        warnings: [...policyResult.warnings],
      },
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  private _prepareFromStaticConfig(config: ProtocolContractConfig, params: PrepareParams): IntentPayload {
    const chainConfig = config.chains[params.chainId];
    if (!chainConfig) {
      throw new Error(
        `CalldataBuilder: protocol "${params.protocolSlug}" not deployed on chainId=${params.chainId}`,
      );
    }

    const actionConfig = chainConfig.actions[params.actionType];
    if (!actionConfig) {
      throw new Error(
        `CalldataBuilder: action "${params.actionType}" not supported for "${params.protocolSlug}" on chainId=${params.chainId}`,
      );
    }

    const poolAddress = params.poolAddressOverride ?? chainConfig.poolAddress;
    if (!poolAddress || poolAddress === 'dynamic') {
      throw new Error(
        `CalldataBuilder: poolAddress is dynamic for "${params.protocolSlug}" — pass poolAddressOverride`,
      );
    }

    const calldata = this._encodeCalldata(config, params, poolAddress);
    const value = actionConfig.isPayable ? params.amount : '0';

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();

    // 2026-06-01 audit Cat 3.1/3.2: REAL PolicyGuard evaluation, no hardcoded
    // passed:true. KYC tier passes through `userKycTier` if the caller
    // resolves it from the authenticated user (handled in the route layer).
    const policyResult = this._evaluatePolicy({
      userKycVerified: params.userKycVerified,
      partnerRequiresKyc: params.partnerRequiresKyc ?? false,
    });
    if (!policyResult.passed) {
      throw Object.assign(new Error(`POLICY_BLOCKED: ${policyResult.blockReason}`), {
        code: 'POLICY_BLOCKED',
        blockReason: policyResult.blockReason,
        warnings: policyResult.warnings,
      });
    }

    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: poolAddress,
        data: calldata,
        value,
        gasLimit: this._estimateGasLimit(params.actionType),
        chainId: params.chainId,
      },
      metadata: {
        action: params.actionType,
        protocol: params.protocolSlug,
        description: this._buildDescriptionFromConfig(config, params),
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        partnerId: params.partnerId,
        ...(config.cooldownDays !== undefined ? { cooldownDays: config.cooldownDays } : {}),
      },
      referralAttribution: buildReferralAttribution(params.partnerAllowsReferralFee),
      authorization: buildAuthorization(),
      policy: {
        evaluatedAt: policyResult.evaluatedAt,
        passed: policyResult.passed,
        warnings: [...policyResult.warnings],
      },
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  private _prepareFromDBRecord(
    record: { slug: string; chainId: number; address: string; abi: unknown; actions: unknown; feeType: string; cooldownDays: number | null },
    params: PrepareParams,
  ): IntentPayload {
    const actions = record.actions as Record<string, DetectedAction>;
    const actionConfig = actions[params.actionType];
    if (!actionConfig) {
      throw new Error(
        `CalldataBuilder: action "${params.actionType}" not supported for "${params.protocolSlug}" on chainId=${params.chainId} (DB record)`,
      );
    }

    const poolAddress = params.poolAddressOverride ?? record.address;
    const abi = record.abi as ethers.InterfaceAbi;
    const iface = new Interface(abi);
    const resolvedArgs = this._resolveArgs(actionConfig.args, {} as ProtocolContractConfig, params);
    const calldata = iface.encodeFunctionData(actionConfig.fn, resolvedArgs);
    const value = actionConfig.isPayable ? params.amount : '0';

    const intentId = randomUUID();
    const traceId = params.traceId ?? randomUUID();
    const cooldownDays = record.cooldownDays ?? undefined;

    // 2026-06-01 audit Cat 3.1: real PolicyGuard, not hardcoded passed:true.
    const policyResult = this._evaluatePolicy({
      userKycVerified: params.userKycVerified,
      partnerRequiresKyc: params.partnerRequiresKyc ?? false,
    });
    if (!policyResult.passed) {
      throw Object.assign(new Error(`POLICY_BLOCKED: ${policyResult.blockReason}`), {
        code: 'POLICY_BLOCKED',
        blockReason: policyResult.blockReason,
        warnings: policyResult.warnings,
      });
    }

    return {
      intentId,
      status: 'pending_user_review',
      tx: {
        to: poolAddress,
        data: calldata,
        value,
        gasLimit: this._estimateGasLimit(params.actionType),
        chainId: params.chainId,
      },
      metadata: {
        action: params.actionType,
        protocol: params.protocolSlug,
        description: `${params.actionType} via ${params.protocolSlug} on chainId=${params.chainId} (dynamic registry).`,
        preparedBy: 'defibro',
        preparedAt: new Date().toISOString(),
        partnerId: params.partnerId,
        ...(cooldownDays !== undefined ? { cooldownDays } : {}),
      },
      referralAttribution: buildReferralAttribution(params.partnerAllowsReferralFee),
      authorization: buildAuthorization(),
      policy: {
        evaluatedAt: policyResult.evaluatedAt,
        passed: policyResult.passed,
        warnings: [...policyResult.warnings],
      },
      audit: {
        traceId,
        sessionId: params.sessionId ?? '',
        intentSource: params.intentSource ?? 'user',
      },
      expiry: buildExpiry(),
    };
  }

  /**
   * V2 policy evaluation for the multichain CalldataBuilder path.
   *
   * The legacy `PolicyGuard.evaluate()` is V1.1 Flare-only (P5 hard-blocks any
   * chain != 14, requires a Flare mandate, and gates on a Flare-scoped
   * allowlist + selector registry). It is structurally incompatible with the
   * V2 "universal DefiLlama connector" goal of all actions on all chains, so
   * the V2 path evaluates only the invariants that actually apply here:
   *
   *   - Non-custodial / non-broadcast: holds by construction. CalldataBuilder
   *     only ever produces UNSIGNED calldata; the user's wallet signs and
   *     broadcasts. Astryum never relays (see buildAuthorization()).
   *   - P38 KYC: enforced ONLY for REGULATED_CASP partners (fiat on/off-ramp).
   *     Tier-1 WALLET_PARTNER self-custody DeFi requires no KYC.
   *   - Anomaly block: handled earlier in prepare() via
   *     CanonicalBridgeService.isPoolBlocked(poolId) — the only hard-stop.
   *
   * The route layer additionally enforces the dynamic P35 contract allowlist
   * (isContractAllowed, fed by ContractRegistry) and the partner gate. Pool
   * risk is surfaced to the user (Risk Engine) and accepted under T&C — not
   * gated here. This is the "all pools accessible, user decides" model.
   */
  private _evaluatePolicy(opts: {
    userKycVerified: boolean;
    partnerRequiresKyc: boolean;
  }): { passed: boolean; blockReason?: string; warnings: string[]; evaluatedAt: string } {
    const evaluatedAt = new Date().toISOString();
    const warnings: string[] = [];

    if (opts.partnerRequiresKyc && !opts.userKycVerified) {
      return {
        passed: false,
        blockReason: 'kyc_verification_required',
        warnings,
        evaluatedAt,
      };
    }

    return { passed: true, warnings, evaluatedAt };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _encodeCalldata(
    config: ProtocolContractConfig,
    params: PrepareParams,
    poolAddress: string,
  ): string {
    const chainConfig = config.chains[params.chainId]!;
    const actionConfig = chainConfig.actions[params.actionType]!;
    const abi = loadAbi(chainConfig.abi);
    const iface = new Interface(abi);

    // Build args array by mapping param names → values
    const args = this._resolveArgs(actionConfig.args, config, params);

    return iface.encodeFunctionData(actionConfig.fn, args);
  }

  private _resolveArgs(
    argNames: string[],
    config: ProtocolContractConfig,
    params: PrepareParams,
  ): unknown[] {
    return argNames.map((name) => {
      switch (name) {
        case 'asset':
          if (!params.asset) throw new Error('CalldataBuilder: "asset" address required');
          return params.asset;
        case 'amount':
        case 'assets':
          return BigInt(params.amount);
        case 'shares':
          // For unstake (redeem), amount = shares
          return BigInt(params.amount);
        case 'onBehalfOf':
        case 'onBehalf':
        case 'receiver':
        case 'owner':
          return params.userWallet;
        case 'to':
          return params.userWallet;
        case 'referralCode':
          return config.referralCode ?? DEFIBRO_REFERRAL_CODE;
        case '_referral':
          return config.referrerWallet ?? DEFIBRO_FEE_WALLET;
        case '_amounts':
          // Lido requestWithdrawals: wrap amount in array
          return [BigInt(params.amount)];
        case '_owner':
          return params.userWallet;
        case 'interestRateMode':
          return 2n; // variable rate (Aave standard)
        case 'data':
          return '0x';
        case 'marketParams':
          if (!params.morphoMarketParams) {
            throw new Error('CalldataBuilder: morphoMarketParams required for Morpho Blue');
          }
          return params.morphoMarketParams;
        default:
          throw new Error(`CalldataBuilder: unknown arg name "${name}" — add mapping`);
      }
    });
  }

  private _estimateGasLimit(actionType: string): string {
    const limits: Record<string, string> = {
      supply:         '200000',
      borrow:         '300000',
      repay:          '200000',
      withdraw:       '200000',
      stake:          '150000',
      unstake:        '250000',
      vault_deposit:  '200000',
      vault_withdraw: '200000',
    };
    return limits[actionType] ?? '250000';
  }

  private _buildDescriptionFromConfig(config: ProtocolContractConfig, params: PrepareParams): string {
    const cooldownNote =
      config.cooldownDays && config.cooldownDays > 0
        ? ` ⚠️ Cooldown: ~${config.cooldownDays} day(s) for unstake.`
        : '';
    const feeNote =
      config.feeType !== 'none'
        ? ` Fee attribution: ${config.feeType} (${DEFIBRO_ATTRIBUTION_BPS / 100}% referral).`
        : '';
    return `${params.actionType} via ${params.protocolSlug} on chainId=${params.chainId}.${cooldownNote}${feeNote}`;
  }
}

// ─── ACTION SHAPE MAP (per ContractKind) ─────────────────────────────────────
//
// Block F (2026-06-01) — Replaces per-slug chainConfig.actions from the legacy
// path. Each contract kind has a small map of action → { fn, args, isPayable }.
// Adding a new pool from DefiLlama no longer requires touching this file: as
// long as the kind exists here, all pools of that kind are executable.
//
// New kinds need ONE entry per supported action. Kinds that don't appear here
// have no executable actions — pools are display-only (read-only Safe Markets).

interface ActionShape {
  readonly fn: string;
  readonly args: ReadonlyArray<string>;
  readonly isPayable?: boolean;
}

const ACTION_SHAPE_BY_KIND: Readonly<
  Partial<Record<ContractKind, Partial<Record<PrepareParams['actionType'], ActionShape>>>>
> = Object.freeze({
  aave_v3_pool: {
    supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
    borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
    repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
    withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
  },
  spark_pool: {
    supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
    borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
    repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
    withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
  },
  aave_v2_pool: {
    supply:   { fn: 'deposit',  args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
    borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
    repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
    withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
  },
  comet_v3: {
    supply:   { fn: 'supply',   args: ['asset', 'amount'] },
    withdraw: { fn: 'withdraw', args: ['asset', 'amount'] },
    borrow:   { fn: 'withdraw', args: ['asset', 'amount'] }, // Comet borrows by withdrawing base
  },
  morpho_blue: {
    supply:   { fn: 'supply',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
    withdraw: { fn: 'withdraw', args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
    borrow:   { fn: 'borrow',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
    repay:    { fn: 'repay',    args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
  },
  lido_steth: {
    stake:   { fn: 'submit',             args: ['_referral'], isPayable: true },
    unstake: { fn: 'requestWithdrawals', args: ['_amounts', '_owner'] },
  },
  rocket_pool_deposit: {
    stake: { fn: 'deposit', args: [], isPayable: true },
  },
  sceptre_vault: {
    stake:   { fn: 'deposit', args: ['assets', 'receiver'] },
    unstake: { fn: 'redeem',  args: ['shares', 'receiver', 'owner'] },
  },
  erc4626_vault: {
    vault_deposit:  { fn: 'deposit',  args: ['assets', 'receiver'] },
    vault_withdraw: { fn: 'withdraw', args: ['assets', 'receiver', 'owner'] },
  },
});

/**
 * Maps Astryum actionType → Enso action vocabulary for the long-tail fallback
 * (_prepareFromEnso). First cut: deposit/withdraw. borrow/repay/stake/unstake
 * need per-action Enso mapping (follow-up) and are intentionally absent here.
 */
const ENSO_ACTION_BY_ACTIONTYPE: Partial<Record<PrepareParams['actionType'], string>> =
  Object.freeze({
    supply: 'deposit',
    vault_deposit: 'deposit',
    withdraw: 'withdraw',
    vault_withdraw: 'withdraw',
    borrow: 'borrow',
    repay: 'repay',
  });

export const calldataBuilder = new CalldataBuilder();

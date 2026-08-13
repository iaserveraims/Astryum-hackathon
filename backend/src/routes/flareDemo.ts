/**
 * Flare mainnet DEMO routes — the two live "entradas" shown in the Earn surface
 * (docs/context/Astryum_Demos_Mainnet_Flare_Plan_2026-06-22.md):
 *
 *   E1 — FXRP entry  (rail: Xaman → Flare Smart Account)
 *        XRP → direct-mint FXRP → supply collateral + borrow USDT0 on Kinetic ISO.
 *        Output = the UNSIGNED XRPL Payment the user signs in Xaman.
 *
 *   E2 — FLR entry   (rail: EVM direct, MetaMask et al.)
 *        wrap FLR → WFLR → delegate WFLR vote power to an FTSO data provider.
 *        Output = the UNSIGNED [wrap, delegate] EVM calls the user signs.
 *
 * Astryum stays PREPARE-ONLY (invariant #1): every endpoint returns unsigned
 * payloads + a fee/price disclosure (#6). Both demos sit behind FLARE_DEFI_ENABLED
 * (#8) + the per-jurisdiction geofence (#5); E1 additionally runs the KWYH scanner
 * (#10) and discloses the USDT0 borrow demo-exception (#4, see plan §9).
 *
 * This mirrors the proven CLI scripts (src/scripts/e1-prepare.ts) over HTTP so the
 * Earn UI can drive the same hand-off. It never signs, never broadcasts.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { safeErrorDetail } from '../utils/safeError';
import { jurisdictionService } from '../services/JurisdictionService';
import { getProtocolAddresses } from '../config/protocolAddresses';
import { buildE1Handoff, buildE3Handoff, buildDirectMintHandoff, buildVaultEntryHandoff, buildVaultRotateHandoff, readMinimumRedeemAmountUBA, mintFeeDisclosure, readDirectMintParams, computeNetMint, buildRedeemToXrplCall, readFxrpBalance, resolveRedemptionExecutor, NonceSeatTakenError } from '../connectors/protocols/flare/FlareDirectMintService';
import { UpshiftVaultAdapter } from '../connectors/protocols/adapters/UpshiftVaultAdapter';
import { FirelightAdapter } from '../connectors/protocols/adapters/FirelightAdapter';
import { resolvePersonalAccount, resolveMasterAccountController, buildErc20TransferCall } from '../connectors/protocols/flare/FlareSmartAccountService';
import { computeBorrowUsdt0, computeDeriskShortfall, computeRepayToRestoreHF, computeTriggerPrice } from '../connectors/protocols/flare/KineticIsoMath';
import { KineticAdapter } from '../connectors/protocols/adapters/KineticAdapter';
import type { EncodedAction } from '../connectors/protocols/IProtocolAdapter';
import { createFTSOPriceProvider } from '../engines/normalisation/NormalisationEngine';
import { goPlusProvider } from '../integrations/providers/security/GoPlusProvider';
import { demoCapFromBody, getDemoCapStatus, isXrplMintBody } from '../config/demoCap';
import { hasFeeBudgetForOneMint } from '../services/flare/ExecutorFuelService';
import {
  buildFillSwapCalls,
  quoteFillOptions,
  swapFillEnabled,
  fillSlippagePct,
  type FillCall,
  type FillOption,
} from '../services/flare/SwapFillService';
import {
  mergePreflights,
  preflightEvmCalls,
  preflightXrplPayment,
  type EvmPreflightCall,
} from '../services/flare/preparePreflight';

/** El bloque `fill` de la respuesta (JSON-safe) — compartido por los dos rails
 *  del swap-fill (a1 EVM y pa-repay 0xFE). Puro serializado, cero decisiones. */
function serializeFill(p: {
  enabled: boolean;
  gapBase: bigint;
  options: FillOption[];
  applied: FillOption | null;
  required: boolean;
}): Record<string, unknown> {
  const fmt = (o: FillOption) => ({
    asset: o.asset,
    tokenIn: o.tokenIn,
    feeTier: o.feeTier,
    amountInQuoted: Number(ethers.formatUnits(o.amountInQuoted, o.tokenInDecimals)),
    amountInMax: Number(ethers.formatUnits(o.amountInMax, o.tokenInDecimals)),
    balance: o.balance == null ? null : Number(ethers.formatUnits(o.balance, o.tokenInDecimals)),
    sufficient: o.sufficient,
  });
  return {
    enabled: p.enabled,
    needed: p.gapBase > 0n,
    required: p.required,
    gapUsdt0: Number(p.gapBase) / 1_000_000,
    slippagePct: fillSlippagePct(),
    applied: p.applied ? fmt(p.applied) : null,
    options: p.options.map(fmt),
  };
}

const router = Router();

// Demo cap — radius limiter for the open MVP (judge / public phase). Rejects POST
// prepares whose mint amount exceeds the per-tx / per-address-daily cap, AND refuses
// before signing when the executor's fee budget can't attest one more mint (§3).
// Fail-closed; the exempt list is explicit (config/demoCap.ts), NEVER the execution
// allowlist. The mint routes are ENUMERATED in config/demoCapRoutes.ts, guarded by
// flareDemo.capRoutes.test.ts which goes red if any POST route is unclassified — the
// body-sniff below is the enforcement, the enumeration is the tripwire for new routes.
// NOT a stranding guard (that is pre-sign simulation, invariant #12 / R8) — it BOUNDS
// the blast radius of a batch that reverts.
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') return next();
  // Only the LIVE demo mints; when the feature is off the handlers return 503, so the
  // cap is moot — let the request through to the flag/geofence gate (keeps 503 precedence
  // and doesn't weaken fail-closed: the cap only matters once the demo is on).
  if (process.env.FLARE_DEFI_ENABLED !== 'true') return next();
  try {
    // 1. Cap: per-tx radius + per-address/day budget fairness. The authenticated
    //    account travels too (router mounts behind requireSiweAuth): an account on
    //    DEMO_CAP_EXEMPT_EMAILS is exempt whichever wallet it pays from.
    const capErr = await demoCapFromBody(req.body, req.siwe?.userId);
    if (capErr) return res.status(capErr.status).json(capErr.body);
    // 2. §3 — global fee-budget pre-check. Only the XRPL-mint rail spends executor FLR;
    //    refuse BEFORE signing if it can't attest one more mint (else the XRP leaves and
    //    parks with no reclaim). EVM-direct settles with the user's own signature.
    if (isXrplMintBody(req.body) && !hasFeeBudgetForOneMint()) {
      // The PROTECTION route deserves the harder truth (founder 2026-07-25):
      // this refusal avoids PARKING the XRP, but it does NOT stop a
      // liquidation — "come back tomorrow" can be too late when HF is
      // falling. Name the fallback that does not depend on the executor.
      if (req.path === '/pa-repay/prepare') {
        return res.status(429).json({
          error: 'EXECUTOR_FUEL_EXHAUSTED',
          detail:
            'El executor no tiene combustible para ejecutar esta defensa ahora mismo. Tu XRP no se ha ' +
            'movido y no quedará aparcado — pero OJO: esto NO detiene una liquidación. Si tu Health Factor ' +
            'sigue cayendo, usa el repay directo desde una wallet EVM de Flare (no depende del executor) ' +
            'o espera a que se reponga el combustible.',
        });
      }
      return res.status(429).json({
        error: 'DEMO_DAILY_OPS_EXHAUSTED',
        detail:
          'La demo ha alcanzado su límite diario de operaciones en Flare. Vuelve mañana — ' +
          'tu XRP no se ha movido.',
      });
    }
  } catch (e) {
    // The sync per-tx cap already ran; a store/DB hiccup on the daily layer must not
    // hard-block the demo. Log and fall through to the handler (still flag/geofence-gated).
    console.error('[demoCap] middleware error:', (e as Error).message);
  }
  return next();
});

// GET /cap-status — read-only feed for the Summary's usage bar: the caps in
// force, what `address` has spent today, and whether the caller is exempt (by
// account or by address). A GET on purpose: the cap middleware above only
// watches POSTs, and reading the gauge must never move it. `active` tells the
// card whether the open demo is even on.
router.get('/cap-status', async (req: Request, res: Response) => {
  try {
    const address = typeof req.query.address === 'string' ? req.query.address : null;
    const status = await getDemoCapStatus(address, req.siwe?.userId);
    return res.json({ ...status, active: process.env.FLARE_DEFI_ENABLED === 'true' });
  } catch (e) {
    return res.status(500).json({ error: 'CAP_STATUS_FAILED', detail: safeErrorDetail(e) });
  }
});

const FLARE_CHAIN_ID = 14;
const MANTISSA = 1e18;
const DROPS = 1_000_000; // 1 XRP = 1e6 drops; FXRP/USDT0 UBA = 6 dec

// WNAT (Wrapped Native FLR) — fixed Flare Mainnet contract (same as WFLRAdapter /
// FTSOAdapter). deposit() wraps, delegate(provider, bips) delegates vote power.
const WNAT_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const WNAT_DEPOSIT_SELECTOR = '0xd0e30db0'; // deposit() payable
const WNAT_ABI = [
  'function delegate(address to, uint256 bips)',
  // E2 exit rail (2026-07-31): unwrap + undelegate + the reads that size them.
  'function withdraw(uint256 amount)',
  'function undelegateAll()',
  'function balanceOf(address owner) view returns (uint256)',
  'function delegatesOf(address owner) view returns (address[] delegateAddresses, uint256[] bips, uint256 count, uint256 delegationMode)',
];
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
// XRPL classic address (base58, no 0/O/I/l). Rejects EVM/garbage before any RPC call.
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const MAX_BIPS = 10_000;

/** Positive, finite, non-NaN number — rejects "Infinity"/"1e400"/negatives/0. */
function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** true si el cliente pide invalidar el handoff pendiente que ocupa el mismo
 *  PA+nonce (guard NonceSeatTakenError → 409; incidente 2026-07-14/16). */
function wantsSupersede(req: Request): boolean {
  return ((req.body ?? {}) as { supersede?: unknown }).supersede === true;
}

/**
 * XRP ≤ fees del direct-mint (mint 0.1 + executor 0.2 XRP en vivo) responde
 * como lo que es — importe insuficiente, no un fallo del servidor. El ensayo
 * mainnet 2026-07-26 lo observó saliendo como 500 genérico en las rutas 0xFE;
 * walletTransfer ya usaba este mismo mapeo (AMOUNT_BELOW_MINT_FEES).
 * Returns true when the response was sent (the catch must stop there).
 */
function repliedAmountBelowMintFees(res: Response, e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  if (!msg.startsWith('DIRECT_MINT_INSUFFICIENT')) return false;
  res.status(400).json({
    error: 'AMOUNT_BELOW_MINT_FEES',
    detail: `The XRP paid must exceed the minting + executor fees, or the whole payment is forfeited. ${msg}`,
  });
  return true;
}

/**
 * The road BACK to native XRP, said at ENTRY time (2026-07-24; PA-unmint built
 * 2026-07-26): the PA rail CAN redeem FXRP back to native XRP (Unmint on your
 * position / /pa-unmint), with the protocol's on-chain minimum per redemption
 * (minimumRedeemAmountUBA, 5 XRP on mainnet — read live, invariant #9). The
 * user still learns the minimum BEFORE signing the entry.
 */
function fxrpExitWarning(minRedeemUBA: bigint | null): string {
  return minRedeemUBA != null
    ? ` The road back: FXRP can be redeemed to native XRP from this Smart Account (Unmint on your position) — the protocol enforces a minimum of ${Number(minRedeemUBA) / DROPS} XRP per redemption, and the FAssets agent pays the XRP after the burn (minus the protocol redemption fee).`
    : ' The road back: FXRP can be redeemed to native XRP from this Smart Account (Unmint on your position) — the protocol enforces an on-chain minimum per redemption, and the FAssets agent pays the XRP after the burn (minus the protocol redemption fee).';
}

/** EIP-55-normalised address or null (never throws — bad checksum → null → 400). */
function safeGetAddress(addr: unknown): string | null {
  if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) return null;
  try {
    return ethers.getAddress(addr);
  } catch {
    return null;
  }
}

function flareProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: FLARE_CHAIN_ID },
    { staticNetwork: true },
  );
}

/**
 * Hard invariant frontier shared by both demos: flag (#8) + geofence (#5).
 * Returns an error envelope to send, or null when the demo is allowed.
 */
function gateFlareDemo(region: string | null): { status: number; error: string } | null {
  if (process.env.FLARE_DEFI_ENABLED !== 'true') {
    return { status: 503, error: 'FLARE_DEFI_DISABLED' };
  }
  const geo = jurisdictionService.isDefiExecutionAllowed(region);
  if (!geo.allowed) {
    return { status: 451, error: `GEOFENCE_BLOCKED: ${geo.reason ?? 'region not allowed'}` };
  }
  return null;
}

/* ----------------------------------------------------------------------- */
/* GET /api/flare-demo/yields — the live yield of each demo strategy, for   */
/* the "Choose a strategy" cards. Read-only public protocol data. Invariant */
/* #9: a NUMBER only when it comes from the protocol with a source; every   */
/* other case is an honest label, never a made-up figure or an Astryum      */
/* promise. One call powers all six cards.                                  */
/*                                                                          */
/*   e1 / e3     → Kinetic FXRP ISO supply APR (supplyRatePerTimestamp)     */
/*   v-earnxrp   → Upshift earnXRP 30d historical APY (August Digital API)  */
/*   v-monarq    → Upshift Monarq  30d historical APY (August Digital API)  */
/*   v-firelight → none: rewards start in Phase 2 (per Firelight)           */
/*   e2          → none: FTSO rewards accrue per ~3.5-day epoch             */
/* ----------------------------------------------------------------------- */
type YieldEntry =
  | {
      kind: 'apr' | 'apy';
      pct: number;
      source: string;
      note?: string;
      borrow?: { asset: string; aprPct: number };
      /** Split honesto cuando el headline compone interés + recompensas. */
      baseAprPct?: number;
      rewardApyPct?: number;
    }
  | { kind: 'none'; pct: null; source: null; label: string };

router.get('/yields', async (_req: Request, res: Response) => {
  const { readSupplyAprs, readBorrowAprs } = await import('../services/flare/MarketRatesService');
  const addrs = getProtocolAddresses();
  const up = new UpshiftVaultAdapter();

  // Kinetic FXRP supply APR — ONE read, shared by the lend-only (e3) and the
  // carry (e1) cards. The carry adds a USDT0 borrow leg; e1 labels its number
  // as the collateral supply APR and the card's calculator models the borrow.
  const kFxrp = addrs.kinetic.isoKFxrp;
  const kRates = kFxrp
    ? await readSupplyAprs([kFxrp]).catch(() => ({} as Record<string, number>))
    : {};
  const kFxrpApr = kFxrp ? kRates[kFxrp.toLowerCase()] ?? null : null;

  // La capa de RECOMPENSAS (incentivos WFLR vía el distribuidor) es lo que la
  // app de Kinetic titula: el interés base solo es ~0,07% mientras su UI
  // enseña ~1% (incidente 2026-07-25 — nuestra card "estaba mal" porque solo
  // mostraba la pierna base). El base sigue siendo la lectura on-chain viva;
  // las recompensas salen del split de DeFiLlama para el MISMO pool
  // (verificado: apyBase de Llama == nuestra lectura on-chain al centésimo).
  // Si Llama no responde: degradar a base-solo CON nota — jamás inventar (#9).
  let fxrpRewardApy: number | null = null;
  try {
    const pools = await loadLlamaFlarePools();
    const pool = pools.get(KINETIC_FXRP_LLAMA_POOL);
    if (typeof pool?.apyReward === 'number' && Number.isFinite(pool.apyReward) && pool.apyReward >= 0) {
      fxrpRewardApy = pool.apyReward;
    }
  } catch {
    /* base-only — la nota lo dice */
  }

  // The carry (e1) BORROWS USDT0 — read the live APR it PAYS on-chain from the
  // exact Kinetic ISO market, so the card can show it beside the supply rate.
  const kUsdt0 = addrs.kinetic.isoKUsdt0;
  const bRates = kUsdt0
    ? await readBorrowAprs([kUsdt0]).catch(() => ({} as Record<string, number>))
    : {};
  const usdt0BorrowApr = kUsdt0 ? bRates[kUsdt0.toLowerCase()] ?? null : null;

  // Upshift 30d historical APY — public feed, best-effort, null on any failure.
  const earnDesc = up.getVaultDescriptor('earnxrp');
  const monarqDesc = up.getVaultDescriptor('monarq');
  const [earnApy, monarqApy] = await Promise.all([
    earnDesc ? fetchUpshiftApy30d(earnDesc.vault) : Promise.resolve(null),
    monarqDesc ? fetchUpshiftApy30d(monarqDesc.vault) : Promise.resolve(null),
  ]);

  const UPSHIFT_SRC = 'Upshift (August Digital) API historical_apy.30';

  const numeric = (
    pct: number | null,
    kind: 'apr' | 'apy',
    source: string,
    note?: string,
  ): YieldEntry =>
    pct != null && Number.isFinite(pct)
      ? { kind, pct, source, ...(note ? { note } : {}) }
      : { kind: 'none', pct: null, source: null, label: 'Live rate unavailable — check the protocol' };

  // Headline FXRP = base (on-chain) + recompensas (DeFiLlama), como titula la
  // propia app de Kinetic. Con Llama caído: base-solo con la nota honesta.
  const kineticFxrpEntry = (extraNote?: string): YieldEntry => {
    if (kFxrpApr == null || !Number.isFinite(kFxrpApr)) {
      return { kind: 'none', pct: null, source: null, label: 'Live rate unavailable — check the protocol' };
    }
    if (fxrpRewardApy != null) {
      return {
        kind: 'apy',
        pct: kFxrpApr + fxrpRewardApy,
        baseAprPct: kFxrpApr,
        rewardApyPct: fxrpRewardApy,
        source:
          'kFXRP_ISO.supplyRatePerTimestamp (base, on-chain) + DeFiLlama apyReward (WFLR incentives, same pool)',
        note:
          `Base ${kFxrpApr.toFixed(2)}% + rewards ${fxrpRewardApy.toFixed(2)}% (WFLR incentives).` +
          (extraNote ? ` ${extraNote}` : ''),
      };
    }
    return {
      kind: 'apr',
      pct: kFxrpApr,
      baseAprPct: kFxrpApr,
      source: 'kFXRP_ISO.supplyRatePerTimestamp (live, simple APR, per-second rate)',
      note:
        'Base interest only — the WFLR rewards layer is unavailable right now (Kinetic’s app shows base + rewards).' +
        (extraNote ? ` ${extraNote}` : ''),
    };
  };

  const e1Entry = kineticFxrpEntry(
    'Collateral supply yield — the carry adds a USDT0 borrow leg; model it in the calculator',
  );
  if (e1Entry.kind !== 'none' && usdt0BorrowApr != null) {
    e1Entry.borrow = { asset: 'USDT0', aprPct: usdt0BorrowApr };
  }

  const yields: Record<string, YieldEntry> = {
    e1: e1Entry,
    e3: kineticFxrpEntry(),
    'v-earnxrp': numeric(earnApy, 'apy', UPSHIFT_SRC, '30-day historical'),
    // Monarq reporta NAV por ÉPOCAS (gestor off-chain): las ventanas 1d/7d de
    // la API van a 0 entre reportes y el 30d recoge la marca realizada — que
    // puede ser ligeramente negativa. Verificado 2026-07-25 contra la API
    // per-vault: apy_override/campaign_apy/reported_apy vacíos y DeFiLlama no
    // indexa MXRPY ⇒ NO existe un número mejor con fuente. Se muestra el real
    // con su naturaleza explicada — jamás se maquilla (#9).
    'v-monarq': numeric(
      monarqApy,
      'apy',
      UPSHIFT_SRC,
      '30-day REALIZED — Monarq reports NAV in epochs (1d/7d windows flat between reports); off-chain manager, can read slightly negative. Not a rate promise.',
    ),
    'v-firelight': {
      kind: 'none',
      pct: null,
      source: null,
      label: 'Rewards start in Phase 2 (per Firelight) — not live yet',
    },
    e2: {
      kind: 'none',
      pct: null,
      source: null,
      label: 'FTSO rewards accrue per ~3.5-day epoch (protocol data)',
    },
  };

  return res.json({ asOf: new Date().toISOString(), yields });
});

/* ----------------------------------------------------------------------- */
/* GET /api/flare-demo/product-info — the FULL data sheet behind each        */
/* strategy's "More info", so the user sees exactly where their money goes:  */
/*   · DeFiLlama market data where the product is indexed (Kinetic FXRP):    */
/*     TVL, APY base/reward split, 30d mean, 1d/7d/30d drift, IL, outlook.   */
/*   · Upshift (August Digital) API for the vaults DeFiLlama does NOT index  */
/*     (earnXRP, Monarq): TVL + 1/7/30d APY windows + risk profile.          */
/* Both sources are labelled (invariant #9); a source that fails is omitted. */
/* Cached ~10 min — this is heavier than /yields and fetched lazily on open. */
/* ----------------------------------------------------------------------- */
const KINETIC_FXRP_LLAMA_POOL = '28c0f086-2e1a-40f0-a5f5-763d706c0806';
const PRODUCT_INFO_TTL_MS = 10 * 60 * 1000;

interface RawLlamaPool {
  pool: string; project: string; symbol: string; tvlUsd: number;
  apy: number; apyBase?: number | null; apyReward?: number | null; apyMean30d?: number | null;
  apyPct1D?: number | null; apyPct7D?: number | null; apyPct30D?: number | null;
  ilRisk?: string; exposure?: string; stablecoin?: boolean; count?: number;
  rewardTokens?: string[]; underlyingTokens?: string[];
  predictions?: { predictedClass?: string; predictedProbability?: number };
}
interface RawUpshiftVault {
  address?: string; vault_name?: string; receipt_token_symbol?: string;
  risk?: string; tvl?: number; historical_apy?: Record<string, number>;
}

let llamaCache: { at: number; byId: Map<string, RawLlamaPool> } = { at: 0, byId: new Map() };
let upshiftCache: { at: number; byAddr: Map<string, RawUpshiftVault> } = { at: 0, byAddr: new Map() };

async function loadLlamaFlarePools(): Promise<Map<string, RawLlamaPool>> {
  if (Date.now() - llamaCache.at < PRODUCT_INFO_TTL_MS && llamaCache.byId.size) return llamaCache.byId;
  try {
    const r = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return llamaCache.byId;
    const body = (await r.json()) as { data?: RawLlamaPool[] };
    const byId = new Map<string, RawLlamaPool>();
    for (const p of body.data ?? []) if (p.pool) byId.set(p.pool, p);
    llamaCache = { at: Date.now(), byId };
    return byId;
  } catch {
    return llamaCache.byId;
  }
}

async function loadUpshiftVaults(): Promise<Map<string, RawUpshiftVault>> {
  if (Date.now() - upshiftCache.at < PRODUCT_INFO_TTL_MS && upshiftCache.byAddr.size) return upshiftCache.byAddr;
  try {
    const r = await fetch(
      'https://api.augustdigital.io/api/v1/tokenized_vault?status=active&load_subaccounts=false&load_snapshots=false',
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!r.ok) return upshiftCache.byAddr;
    const vaults = (await r.json()) as RawUpshiftVault[];
    const byAddr = new Map<string, RawUpshiftVault>();
    for (const v of vaults ?? []) if (v.address) byAddr.set(v.address.toLowerCase(), v);
    upshiftCache = { at: Date.now(), byAddr };
    return byAddr;
  } catch {
    return upshiftCache.byAddr;
  }
}

function shapeLlama(p: RawLlamaPool | undefined) {
  if (!p) return null;
  return {
    poolId: p.pool,
    project: p.project,
    symbol: p.symbol,
    tvlUsd: p.tvlUsd ?? null,
    apy: p.apy ?? null,
    apyBase: p.apyBase ?? null,
    apyReward: p.apyReward ?? null,
    apyMean30d: p.apyMean30d ?? null,
    apyPct1D: p.apyPct1D ?? null,
    apyPct7D: p.apyPct7D ?? null,
    apyPct30D: p.apyPct30D ?? null,
    ilRisk: p.ilRisk ?? null,
    exposure: p.exposure ?? null,
    stablecoin: p.stablecoin ?? null,
    dataPoints: p.count ?? null,
    rewardTokens: p.rewardTokens ?? [],
    underlyingTokens: p.underlyingTokens ?? [],
    outlook: p.predictions?.predictedClass
      ? { class: p.predictions.predictedClass, probability: p.predictions.predictedProbability ?? null }
      : null,
    url: `https://defillama.com/yields/pool/${p.pool}`,
    source: 'DeFiLlama /pools (live)',
  };
}

function shapeUpshift(v: RawUpshiftVault | undefined) {
  if (!v) return null;
  const h = v.historical_apy ?? {};
  const pct = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n * 100 : null);
  return {
    vaultName: v.vault_name ?? null,
    receiptToken: v.receipt_token_symbol ?? null,
    tvlUsd: typeof v.tvl === 'number' ? v.tvl : null,
    apy1d: pct(h['1']),
    apy7d: pct(h['7']),
    apy30d: pct(h['30']),
    risk: v.risk ?? null,
    source: 'Upshift (August Digital) API',
  };
}

router.get('/product-info', async (_req: Request, res: Response) => {
  const { readBorrowAprs } = await import('../services/flare/MarketRatesService');
  const [llama, upshift] = await Promise.all([loadLlamaFlarePools(), loadUpshiftVaults()]);
  const up = new UpshiftVaultAdapter();
  const earnAddr = up.getVaultDescriptor('earnxrp')?.vault?.toLowerCase();
  const monarqAddr = up.getVaultDescriptor('monarq')?.vault?.toLowerCase();

  const kinetic = shapeLlama(llama.get(KINETIC_FXRP_LLAMA_POOL));

  // The carry (e1) BORROWS USDT0 in the Kinetic ISO market — surface the live
  // APR the user PAYS, read on-chain from that exact market (borrowRatePerTimestamp).
  const isoUsdt0 = getProtocolAddresses().kinetic.isoKUsdt0;
  const borrowRates = isoUsdt0
    ? await readBorrowAprs([isoUsdt0]).catch(() => ({} as Record<string, number>))
    : {};
  const usdt0BorrowApr = isoUsdt0 ? borrowRates[isoUsdt0.toLowerCase()] ?? null : null;
  const borrowUsdt0 = {
    asset: 'USDT0',
    aprPct: usdt0BorrowApr,
    source:
      usdt0BorrowApr != null
        ? 'kUSDT0_ISO.borrowRatePerTimestamp (live, per-second borrow rate)'
        : null,
  };

  const products: Record<string, { defillama?: unknown; upshift?: unknown; borrow?: unknown }> = {
    e1: { defillama: kinetic, borrow: borrowUsdt0 },
    e3: { defillama: kinetic },
    'v-earnxrp': { upshift: shapeUpshift(earnAddr ? upshift.get(earnAddr) : undefined) },
    'v-monarq': { upshift: shapeUpshift(monarqAddr ? upshift.get(monarqAddr) : undefined) },
    'v-firelight': {},
    e2: {},
  };

  return res.json({ asOf: new Date().toISOString(), products });
});

/* ----------------------------------------------------------------------- */
/* EVM-direct entry rail (shared by e1 / e3 / vault prepares)                */
/*                                                                           */
/* When the signing wallet is a Flare EVM wallet that ALREADY holds FXRP,    */
/* there is nothing to mint from XRPL: the SAME inner batch the Personal     */
/* Account runs inside a 0xFE userOp is handed to the wallet as plain        */
/* unsigned EVM calls (the E2 rail). No minting fee, no executor fee — the   */
/* FXRP is used where it lives (invariant #7: act on the asset in place).    */
/* ----------------------------------------------------------------------- */

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/** Best-effort ERC-20 balance — null when the read fails (an RPC hiccup must
 *  not block a prepare; a real shortfall still reverts at wallet simulation). */
async function erc20BalanceOf(
  provider: ethers.JsonRpcProvider,
  token: string,
  owner: string,
): Promise<bigint | null> {
  try {
    return await new ethers.Contract(token, ERC20_BALANCE_ABI, provider).balanceOf(owner);
  } catch {
    return null;
  }
}

/** Current ERC-20 allowance — decides whether a mint AFTER an approve of the
 *  same batch is dry-runnable against today's state (preflight annotation). */
async function erc20Allowance(
  provider: ethers.JsonRpcProvider,
  token: string,
  owner: string,
  spender: string,
): Promise<bigint | null> {
  try {
    return await new ethers.Contract(
      token,
      ['function allowance(address owner, address spender) view returns (uint256)'],
      provider,
    ).allowance(owner, spender);
  } catch {
    return null;
  }
}

/** Map adapter EncodedAction[] to the unsigned EVM calls the wallet signs. */
function toEvmCalls(actions: EncodedAction[], labels: string[]) {
  return actions.map((a, i) => ({
    to: a.to,
    data: a.calldata,
    value: a.value || '0',
    chainId: FLARE_CHAIN_ID,
    label: labels[i] ?? '',
  }));
}

/* ----------------------------------------------------------------------- */
/* Personal Account resolution (so the UI can scan the Smart Account where   */
/* the FXRP/Kinetic ISO position lives — it is NOT on the user's EVM wallet). */
/* ----------------------------------------------------------------------- */

/**
 * GET /api/flare-demo/personal-account?xrpl=r...
 * Resolves the deterministic Flare Personal Account (Smart Account) for an XRPL
 * address. Read-only. The Positions board scans this address to surface the
 * FXRP supply + USDT0 borrow position opened via E1.
 */
router.get('/personal-account', async (req: Request, res: Response) => {
  try {
    const xrpl = String(req.query.xrpl ?? '').trim();
    if (!xrpl) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
    const personalAccount = await resolvePersonalAccount(flareProvider(), xrpl);

    // Register the PA as a watch wallet of THIS user (best-effort). Rules and
    // intents resolve wallets from the `wallet` table (rules.ts / IntentEngine),
    // and the PA — the address that actually HOLDS the E1 position — was never
    // inserted anywhere, so creating PROTECT against it 404'd. The PA cannot
    // sign EVM txs itself (it executes 0xFE userOps signed from XRPL) →
    // purpose 'watch'.
    const userId = req.siwe?.userId;
    let walletRegistered = false;
    if (userId) {
      try {
        const { prisma } = await import('../database/prismaClient');
        const existing = await prisma.wallet.findFirst({
          where: { userId, address: personalAccount, network: 'flare' },
          select: { id: true },
        });
        if (existing) {
          walletRegistered = true;
        } else {
          const base = {
            userId,
            walletType: 'smart-account',
            address: personalAccount,
            network: 'flare',
            caip2: `eip155:${FLARE_CHAIN_ID}`,
            nickname: 'Flare Smart Account',
            isConnected: true,
            permissions: {},
            ecosystem: 'evm',
            purpose: 'watch',
          };
          try {
            await prisma.wallet.create({ data: { ...base, chainId: FLARE_CHAIN_ID } });
          } catch {
            // chainId is an FK to Chain — a registry without row 14 must not
            // block the registration the whole rules/intents chain depends on.
            // A null chainId row is still found by the case-insensitive
            // fallbacks in rules.ts and IntentEngine.
            await prisma.wallet.create({ data: { ...base, chainId: null } });
          }
          walletRegistered = true;
        }
      } catch (e) {
        // Registration is an enhancement — PA resolution must still answer —
        // but NEVER silently: everything downstream (PROTECT rules, automation
        // intents) 404s without this row, so the failure has to leave a trace.
        console.warn(
          `[flare-demo] PA wallet registration failed for ${personalAccount}: ${(e as Error).message}`,
        );
      }
    }

    return res.json({ xrplAddress: xrpl, personalAccount, walletRegistered });
  } catch (e) {
    return res.status(500).json({ error: 'PA_RESOLVE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* E1 — FXRP entry (Xaman → Smart Account)                                  */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/e1/prepare
 * Body: { xrplAddress?, amountXrp?, evmAddress?, amountFxrp?, borrowRatio?, targetHF?, region?, walletId? }
 * Two entry rails share this route:
 *   - XRPL mint (xrplAddress + amountXrp, gross XRP) → UNSIGNED XRPL Payment for Xaman.
 *   - EVM direct (evmAddress + amountFxrp — the wallet already holds FXRP on
 *     Flare, nothing to mint) → UNSIGNED EVM calls for the user's own wallet.
 * Both return a full disclosure. Astryum signs nothing.
 */
router.post('/e1/prepare', async (req: Request, res: Response) => {
  try {
    const {
      xrplAddress,
      amountXrp,
      evmAddress,
      amountFxrp,
      borrowRatio = 0.3,
      targetHF = 1.1,
      region = null,
      walletId = 0,
    } = (req.body ?? {}) as {
      xrplAddress?: string;
      amountXrp?: number | string;
      evmAddress?: string;
      amountFxrp?: number | string;
      borrowRatio?: number;
      targetHF?: number;
      region?: string | null;
      walletId?: number;
    };

    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }
    const amount = Number(evmAddr ? (amountFxrp ?? amountXrp) : amountXrp);
    if (!isPositiveFinite(amount)) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    if (!(Number.isFinite(borrowRatio) && borrowRatio > 0 && borrowRatio <= 1)) {
      return res.status(400).json({ error: 'INVALID_BORROW_RATIO' });
    }
    if (!isPositiveFinite(Number(targetHF))) return res.status(400).json({ error: 'INVALID_TARGET_HF' });

    // 1. GATING (flag + geofence)
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // ISO market env must be configured (FXRP_TOKEN + the ISO comptroller/kTokens).
    const k = getProtocolAddresses().kinetic;
    const fxrpToken = getProtocolAddresses().fxrp.token;
    if (!fxrpToken || !k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0) {
      return res.status(503).json({
        error: 'ISO_MARKET_NOT_CONFIGURED',
        detail: 'Set FXRP_TOKEN, KINETIC_ISO_COMPTROLLER, KINETIC_KFXRP_ISO, KINETIC_KUSDT0_ISO',
      });
    }

    // 2. KWYH scanner (#10) — best-effort; HARD-block only on DANGER.
    const scanner: Record<string, { verdict: string; flags: string[] } | { error: string }> = {};
    for (const [label, addr] of [
      ['FXRP', fxrpToken],
      ['kFXRP_ISO', k.isoKFxrp],
      ['kUSDT0_ISO', k.isoKUsdt0],
    ] as const) {
      try {
        const { data } = await goPlusProvider.call<
          { chainId: number; address: string },
          { verdict: string; flags: string[] }
        >('security.tokenSafety', { chainId: FLARE_CHAIN_ID, address: addr! }, {
          traceId: 'flare-demo-e1',
          wallet: evmAddr ?? xrplAddr,
        });
        scanner[label] = data;
        if (data.verdict === 'danger') {
          return res.status(409).json({ error: `KWYH_DANGER_${label}`, flags: data.flags });
        }
      } catch (e) {
        scanner[label] = { error: safeErrorDetail(e) };
      }
    }

    // 3. LIVE READS — FTSO XRP/USD + live collateral factor of kFXRP ISO.
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });

    const comptroller = new ethers.Contract(
      k.isoComptroller!,
      ['function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)'],
      provider,
    );
    const market = await comptroller.markets(k.isoKFxrp!);
    if (!market[0]) return res.status(502).json({ error: 'KFXRP_ISO_NOT_LISTED' });
    const collateralFactor = Number(market[1]) / MANTISSA;

    // 4-EVM. DIRECT ENTRY (no XRPL mint): the wallet already holds FXRP on
    // Flare — hand it the SAME ISO batch the PA runs, as plain unsigned EVM
    // calls (the E2 rail). No minting fee, no executor fee.
    if (evmAddr) {
      const supplyUBA = BigInt(Math.round(amount * DROPS));
      const balance = await erc20BalanceOf(provider, fxrpToken!, evmAddr);
      if (balance != null && balance < supplyUBA) {
        return res.status(409).json({
          error: 'INSUFFICIENT_FXRP',
          balanceFxrp: Number(balance) / DROPS,
          requestedFxrp: amount,
        });
      }
      const borrow = computeBorrowUsdt0({ supplyUBA, fxrpPriceUSD, collateralFactor, borrowRatio });
      const inner = await new KineticAdapter().buildIsoSupplyBorrowBatch({
        supplyUBA,
        borrowUsdt0: borrow.borrowUsdt0Base,
      });
      const trigger = computeTriggerPrice({
        supplyUBA,
        borrowUsdt0Base: borrow.borrowUsdt0Base,
        collateralFactor,
        targetHF: Number(targetHF),
      });
      const supplyFxrpDirect = Number(supplyUBA) / DROPS;
      const borrowUsdt0Direct = Number(borrow.borrowUsdt0Base) / DROPS;

      // Invariant #11 — dry-run before signature. Batch: [approve, mint,
      // enterMarkets, borrow]. mint is verifiable TODAY only if the standing
      // allowance already covers the supply; borrow always needs the fresh
      // collateral+membership of this same batch → honest 'unverified'.
      const allowance = await erc20Allowance(provider, fxrpToken!, evmAddr, k.isoKFxrp!);
      const e1Labels = ['approve FXRP', 'supply FXRP', 'enterMarkets', 'borrow USDT0'];
      const preflight = await preflightEvmCalls(
        provider,
        evmAddr,
        inner.map((a, i): EvmPreflightCall => ({
          to: a.to,
          data: a.calldata,
          value: a.value,
          label: e1Labels[i] ?? `step ${i + 1}`,
          compoundErrorCode: i > 0, // kToken/comptroller return uint codes; approve is plain ERC-20
          dependsOnPrior:
            (i === 1 && (allowance == null || allowance < supplyUBA)) || i === 3,
        })),
      );

      return res.json({
        rail: 'evm',
        entry: 'evm-direct',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr, // the account that will HOLD the ISO position
        calls: toEvmCalls(inner, [
          `Approve ${supplyFxrpDirect} FXRP → Kinetic ISO`,
          `Supply ${supplyFxrpDirect} FXRP as collateral`,
          'Enable FXRP as collateral (enterMarkets)',
          `Borrow ${borrowUsdt0Direct.toFixed(2)} USDT0`,
        ]),
        a1: {
          triggerPriceUSD: trigger.triggerPriceUSD,
          targetHF: Number(targetHF),
          borrowRatio,
          collateralFactor,
          fxrpPriceUSD,
          supplyUBA: supplyUBA.toString(),
          borrowUsdt0Base: borrow.borrowUsdt0Base.toString(),
        },
        scanner,
        preflight,
        disclosure: {
          entry: 'evm-direct',
          fxrpSupplied: supplyFxrpDirect,
          usdt0Borrowed: borrowUsdt0Direct,
          borrowRatio,
          collateralFactor,
          fxrpPriceUSD,
          entryHF: (supplyFxrpDirect * fxrpPriceUSD * collateralFactor) / borrowUsdt0Direct,
          targetHF: Number(targetHF),
          triggerPriceUSD: trigger.triggerPriceUSD,
          disclosedToUser: true,
          astryumSigns: false,
          note:
            'Astryum builds these unsigned EVM calls; you sign them in your own Flare wallet. Your FXRP enters Kinetic directly — no XRPL mint, no minting fee. USDT0 borrow is a gated demo exception (non-EU-facing).',
        },
      });
    }

    // 4. BUILD (unsigned)
    const grossXrpDrops = BigInt(Math.round(amount * DROPS));
    const e1 = await buildE1Handoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      borrowRatio,
      targetHF,
      fxrpPriceUSD,
      collateralFactor,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
    });

    const net = e1.handoff.net;
    const supplyFxrp = Number(net.supplyUBA) / DROPS;
    const borrowUsdt0 = Number(e1.borrow.borrowUsdt0Base) / DROPS;
    const entryHF = (supplyFxrp * fxrpPriceUSD * collateralFactor) / (borrowUsdt0 * 1);
    const minRedeemUBA = await readMinimumRedeemAmountUBA(provider);

    // Invariant #11 — dry-run the SIGNABLE piece: the XRPL Payment (funds,
    // reserve, destination). The inner EVM batch all rides on the FXRP this
    // very mint creates — nothing of it is dry-runnable before the mint, so
    // the honest preflight here is the Payment simulate alone.
    const preflight = await preflightXrplPayment(
      e1.handoff.xrplPayment as unknown as Record<string, unknown>,
      xrplAddr,
    );

    // 5. RESPONSE — unsigned XRPL Payment + disclosure (#6). Astryum signs nothing.
    return res.json({
      rail: 'xrpl',
      personalAccount: e1.handoff.personalAccount,
      xrplPayment: e1.handoff.xrplPayment,
      memoHex: e1.handoff.memoHex,
      userOpData: e1.handoff.userOpData,
      a1: e1.a1, // precomputed stop-loss inputs (F4 reuses these EXACT values)
      scanner,
      preflight,
      disclosure: {
        grossXrp: amount,
        ...mintFeeDisclosure(net),
        fxrpMinted: Number(net.netToPersonalAccountUBA) / DROPS,
        fxrpSupplied: supplyFxrp,
        usdt0Borrowed: borrowUsdt0,
        borrowRatio,
        collateralFactor,
        fxrpPriceUSD,
        entryHF,
        targetHF,
        triggerPriceUSD: e1.a1.triggerPriceUSD,
        redeemMinimumXrp: minRedeemUBA != null ? Number(minRedeemUBA) / DROPS : null,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Astryum builds this unsigned XRPL Payment; you sign it in Xaman. USDT0 borrow is a gated demo exception (non-EU-facing). Exiting (repay + withdraw) returns FXRP.' +
          fxrpExitWarning(minRedeemUBA) +
          ' Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'E1_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* E3 — FXRP lend-only entry (Xaman → Smart Account): supply, NO borrow      */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/e3/prepare
 * Body: { xrplAddress?, amountXrp?, evmAddress?, amountFxrp?, region?, walletId? }
 * The SAFEST entry: FXRP supplied as a plain deposit. Zero debt, zero
 * liquidation, no stop-loss to configure. XRPL rail (xrplAddress + amountXrp)
 * mints first and returns the UNSIGNED XRPL Payment for Xaman; EVM-direct rail
 * (evmAddress + amountFxrp, wallet already holds FXRP) returns UNSIGNED EVM
 * calls. Astryum signs nothing.
 */
router.post('/e3/prepare', async (req: Request, res: Response) => {
  try {
    const {
      xrplAddress,
      amountXrp,
      evmAddress,
      amountFxrp,
      region = null,
      walletId = 0,
    } = (req.body ?? {}) as {
      xrplAddress?: string;
      amountXrp?: number | string;
      evmAddress?: string;
      amountFxrp?: number | string;
      region?: string | null;
      walletId?: number;
    };

    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }
    const amount = Number(evmAddr ? (amountFxrp ?? amountXrp) : amountXrp);
    if (!isPositiveFinite(amount)) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    // 1. GATING (flag + geofence) — same frontier as E1/E2.
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // Lend-only needs only FXRP_TOKEN + the ISO kFXRP market (no USDT0 borrow leg).
    const k = getProtocolAddresses().kinetic;
    const fxrpToken = getProtocolAddresses().fxrp.token;
    if (!fxrpToken || !k.isoKFxrp) {
      return res.status(503).json({
        error: 'ISO_MARKET_NOT_CONFIGURED',
        detail: 'Set FXRP_TOKEN and KINETIC_KFXRP_ISO',
      });
    }

    // 2. KWYH scanner (#10) — FXRP + kFXRP_ISO only (no borrow market). HARD-block on DANGER.
    const scanner: Record<string, { verdict: string; flags: string[] } | { error: string }> = {};
    for (const [label, addr] of [
      ['FXRP', fxrpToken],
      ['kFXRP_ISO', k.isoKFxrp],
    ] as const) {
      try {
        const { data } = await goPlusProvider.call<
          { chainId: number; address: string },
          { verdict: string; flags: string[] }
        >('security.tokenSafety', { chainId: FLARE_CHAIN_ID, address: addr! }, {
          traceId: 'flare-demo-e3',
          wallet: evmAddr ?? xrplAddr,
        });
        scanner[label] = data;
        if (data.verdict === 'danger') {
          return res.status(409).json({ error: `KWYH_DANGER_${label}`, flags: data.flags });
        }
      } catch (e) {
        scanner[label] = { error: safeErrorDetail(e) };
      }
    }

    // 3. LIVE READS — FTSO XRP/USD (to disclose FXRP value) + live supply APY.
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });

    // Live supply APY — protocol data, never hardcoded (invariant #9). Best-effort:
    // Kinetic is a Benqi-style fork: kTokens expose *RatePerTimestamp (per-second
    // rate); supplyRatePerBlock() does NOT exist and reverts (verified on-chain
    // 2026-07-14, block 65063888). Annualise over seconds (simple APR — labelled
    // as such, not compounded). If the read reverts, supplyApyPct stays null and
    // the frontend links to Kinetic instead of showing a made-up number.
    let supplyApyPct: number | null = null;
    try {
      const kFxrp = new ethers.Contract(
        k.isoKFxrp!,
        ['function supplyRatePerTimestamp() view returns (uint256)'],
        provider,
      );
      const ratePerSecond: bigint = await kFxrp.supplyRatePerTimestamp();
      const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
      const apy = (Number(ratePerSecond) / 1e18) * SECONDS_PER_YEAR * 100;
      supplyApyPct = Number.isFinite(apy) && apy >= 0 ? apy : null;
    } catch {
      supplyApyPct = null;
    }

    // 4-EVM. DIRECT ENTRY (no XRPL mint): supply the wallet's own FXRP as a
    // plain deposit — the same [approve, mint] batch the PA runs, handed to
    // the user's Flare wallet as unsigned EVM calls. No fees, no executor.
    if (evmAddr) {
      const supplyUBA = BigInt(Math.round(amount * DROPS));
      const balance = await erc20BalanceOf(provider, fxrpToken!, evmAddr);
      if (balance != null && balance < supplyUBA) {
        return res.status(409).json({
          error: 'INSUFFICIENT_FXRP',
          balanceFxrp: Number(balance) / DROPS,
          requestedFxrp: amount,
        });
      }
      const inner = await new KineticAdapter().buildIsoSupplyFxrpBatch({ supplyUBA });
      const supplyFxrpDirect = Number(supplyUBA) / DROPS;
      return res.json({
        rail: 'evm',
        entry: 'evm-direct',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        calls: toEvmCalls(inner, [
          `Approve ${supplyFxrpDirect} FXRP → Kinetic ISO`,
          `Supply ${supplyFxrpDirect} FXRP as a plain deposit (no borrow)`,
        ]),
        scanner,
        disclosure: {
          entry: 'evm-direct',
          fxrpSupplied: supplyFxrpDirect,
          fxrpPriceUSD,
          suppliedValueUSD: supplyFxrpDirect * fxrpPriceUSD,
          supplyApyPct,
          supplyApySource:
            supplyApyPct != null
              ? 'kFXRP_ISO.supplyRatePerTimestamp (live, simple APR, per-second rate)'
              : null,
          noDebt: true,
          noLiquidationRisk: true,
          disclosedToUser: true,
          astryumSigns: false,
          note:
            'Astryum builds these unsigned EVM calls; you sign them in your own Flare wallet. Your FXRP is supplied directly as a plain deposit — no XRPL mint, no borrow, no liquidation. Withdraw returns FXRP.',
        },
      });
    }

    // 4. BUILD (unsigned) — mint FXRP → supply, NO borrow.
    const grossXrpDrops = BigInt(Math.round(amount * DROPS));
    const e3 = await buildE3Handoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
    });

    const net = e3.handoff.net;
    const supplyFxrp = Number(net.supplyUBA) / DROPS;
    const minRedeemUBA = await readMinimumRedeemAmountUBA(provider);

    // 5. RESPONSE — unsigned XRPL Payment + disclosure (#6). Astryum signs nothing.
    return res.json({
      rail: 'xrpl',
      personalAccount: e3.handoff.personalAccount,
      xrplPayment: e3.handoff.xrplPayment,
      memoHex: e3.handoff.memoHex,
      userOpData: e3.handoff.userOpData,
      scanner,
      disclosure: {
        grossXrp: amount,
        ...mintFeeDisclosure(net),
        fxrpMinted: Number(net.netToPersonalAccountUBA) / DROPS,
        fxrpSupplied: supplyFxrp,
        fxrpPriceUSD,
        suppliedValueUSD: supplyFxrp * fxrpPriceUSD,
        supplyApyPct, // protocol data, live; null → frontend links to Kinetic
        supplyApySource:
          supplyApyPct != null
            ? 'kFXRP_ISO.supplyRatePerTimestamp (live, simple APR, per-second rate)'
            : null,
        noDebt: true,
        noLiquidationRisk: true,
        redeemMinimumXrp: minRedeemUBA != null ? Number(minRedeemUBA) / DROPS : null,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Astryum builds this unsigned XRPL Payment; you sign it in Xaman. Your XRP is minted to FXRP and supplied as a plain deposit — no borrow, no liquidation. Withdraw returns FXRP.' +
          fxrpExitWarning(minRedeemUBA) +
          ' Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'E3_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* VAULT — partner-vault entries (Firelight stXRP · earnXRP · Monarq MXRPY)  */
/*                                                                           */
/* The vaults Flare's wallet partners already distribute (Xaman xApp →       */
/* Firelight rails; D'CENT → earnXRP/Monarq on Upshift). Same `0xFE` rail as  */
/* E3: XRP → direct-mint FXRP → deposit into the vault, zero debt. All        */
/* addresses verified on-chain 2026-07-10 (see .env.example). Astryum        */
/* prepares unsigned payloads only; the user signs in Xaman.                  */
/* ----------------------------------------------------------------------- */

const FIRELIGHT_READ_ABI = [
  'function paused() view returns (bool)',
  'function depositLimit() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  // Withdrawal-period queue (VERIFIED 2026-07-14): redeem burns now and queues;
  // the FXRP is released by claimWithdraw(period) after the period ends.
  'function currentPeriod() view returns (uint256)',
  'function currentPeriodEnd() view returns (uint48)',
];
const UPSHIFT_READ_ABI = [
  'function depositsPaused() view returns (bool)',
  'function depositCap() view returns (uint256)',
  'function getTotalAssets() view returns (uint256)',
  'function getSharePrice() view returns (uint256)',
  'function instantRedemptionFee() view returns (uint256)',
  'function lagDuration() view returns (uint256)',
];

/** Best-effort 30d APY from the Upshift (August Digital) public API — the same
 *  feed DeFiLlama's upshift adapter consumes. Returns null on any failure so
 *  the frontend links to the protocol instead of showing a made-up number
 *  (invariant #9: APY is always protocol data with a source, or absent). */
async function fetchUpshiftApy30d(vaultAddress: string): Promise<number | null> {
  try {
    const resp = await fetch(
      'https://api.augustdigital.io/api/v1/tokenized_vault?status=active&load_subaccounts=false&load_snapshots=false',
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!resp.ok) return null;
    const vaults = (await resp.json()) as Array<{ address?: string; historical_apy?: Record<string, number> }>;
    const v = vaults.find((x) => x.address?.toLowerCase() === vaultAddress.toLowerCase());
    const apy = v?.historical_apy?.['30'];
    return typeof apy === 'number' && Number.isFinite(apy) ? apy * 100 : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/flare-demo/vault/prepare
 * Body: { xrplAddress?, amountXrp?, evmAddress?, amountFxrp?, vault: 'firelight'|'earnxrp'|'monarq', region?, walletId? }
 * Partner-vault entry. XRPL rail (xrplAddress + amountXrp): mint FXRP →
 * deposit into the chosen vault. EVM-direct rail (evmAddress + amountFxrp —
 * the wallet already holds FXRP on Flare): deposit directly, shares land in
 * the signing wallet, no XRPL mint. NO borrow, NO liquidation risk. Monarq
 * additionally requires UPSHIFT_MONARQ_ENABLED (CeDeFi risk profile:
 * off-chain strategies — its own switch, invariant #10).
 */
router.post('/vault/prepare', async (req: Request, res: Response) => {
  try {
    const {
      xrplAddress,
      amountXrp,
      evmAddress,
      amountFxrp,
      vault,
      region = null,
      walletId = 0,
    } = (req.body ?? {}) as {
      xrplAddress?: string;
      amountXrp?: number | string;
      evmAddress?: string;
      amountFxrp?: number | string;
      vault?: string;
      region?: string | null;
      walletId?: number;
    };

    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }
    const amount = Number(evmAddr ? (amountFxrp ?? amountXrp) : amountXrp);
    if (!isPositiveFinite(amount)) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    if (vault !== 'firelight' && vault !== 'earnxrp' && vault !== 'monarq') {
      return res.status(400).json({ error: 'INVALID_VAULT', detail: "vault must be 'firelight' | 'earnxrp' | 'monarq'" });
    }

    // 1. GATING (flag + geofence) — same frontier as E1/E2/E3. Monarq carries
    //    an off-chain (CeDeFi) risk profile → its own switch on top (#10).
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });
    if (vault === 'monarq' && process.env.UPSHIFT_MONARQ_ENABLED !== 'true') {
      return res.status(503).json({ error: 'MONARQ_DISABLED', detail: 'Set UPSHIFT_MONARQ_ENABLED=true (CeDeFi risk profile — separate switch)' });
    }

    // Resolve the vault + receipt token from config (never guessed).
    const fxrpToken = getProtocolAddresses().fxrp.token;
    if (!fxrpToken) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FXRP_TOKEN' });

    let vaultAddress: string | undefined;
    let receiptToken: string | undefined;
    let vaultName: string;
    let riskProfile: 'onchain' | 'cedefi';
    if (vault === 'firelight') {
      vaultAddress = getProtocolAddresses().firelight.stXRP;
      receiptToken = vaultAddress; // stXRP IS the 4626 vault token
      vaultName = 'Firelight stXRP';
      riskProfile = 'onchain';
      if (!vaultAddress) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FIRELIGHT_STXRP' });
    } else {
      const d = new UpshiftVaultAdapter().getVaultDescriptor(vault);
      if (!d) {
        return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: `Set UPSHIFT_${vault.toUpperCase()}_VAULT / _TOKEN` });
      }
      vaultAddress = d.vault;
      receiptToken = d.lpToken;
      vaultName = d.name;
      riskProfile = d.riskProfile;
    }

    // 2. KWYH scanner (#10) — FXRP + vault + receipt token. HARD-block on DANGER.
    const scanner: Record<string, { verdict: string; flags: string[] } | { error: string }> = {};
    const scanTargets: Array<readonly [string, string]> = [
      ['FXRP', fxrpToken],
      ['vault', vaultAddress],
    ];
    if (receiptToken && receiptToken !== vaultAddress) scanTargets.push(['receiptToken', receiptToken]);
    for (const [label, addr] of scanTargets) {
      try {
        const { data } = await goPlusProvider.call<
          { chainId: number; address: string },
          { verdict: string; flags: string[] }
        >('security.tokenSafety', { chainId: FLARE_CHAIN_ID, address: addr }, {
          traceId: 'flare-demo-vault',
          wallet: evmAddr ?? xrplAddr,
        });
        scanner[label] = data;
        if (data.verdict === 'danger') {
          return res.status(409).json({ error: `KWYH_DANGER_${label.toUpperCase()}`, flags: data.flags });
        }
      } catch (e) {
        scanner[label] = { error: safeErrorDetail(e) };
      }
    }

    // 3. LIVE READS — FTSO XRP/USD + vault state (pause / cap / share price /
    //    exit terms). All protocol data, read now, disclosed before signing.
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });

    let depositsPaused = false;
    let depositCapUBA: bigint | null = null;
    let totalAssetsUBA: bigint | null = null;
    let sharePriceE6: bigint | null = null;
    let instantRedemptionFeeBps: number | null = null;
    let epochLagSeconds: number | null = null;
    if (vault === 'firelight') {
      const c = new ethers.Contract(vaultAddress, FIRELIGHT_READ_ABI, provider);
      const [paused, limit, assets, sp] = await Promise.all([
        c.paused().catch(() => false),
        c.depositLimit().catch(() => null),
        c.totalAssets().catch(() => null),
        c.convertToAssets(1_000_000n).catch(() => null),
      ]);
      depositsPaused = Boolean(paused);
      depositCapUBA = limit as bigint | null;
      totalAssetsUBA = assets as bigint | null;
      sharePriceE6 = sp as bigint | null;
    } else {
      const c = new ethers.Contract(vaultAddress, UPSHIFT_READ_ABI, provider);
      const [paused, cap, assets, sp, fee, lag] = await Promise.all([
        c.depositsPaused().catch(() => false),
        c.depositCap().catch(() => null),
        c.getTotalAssets().catch(() => null),
        c.getSharePrice().catch(() => null),
        c.instantRedemptionFee().catch(() => null),
        c.lagDuration().catch(() => null),
      ]);
      depositsPaused = Boolean(paused);
      depositCapUBA = cap as bigint | null;
      totalAssetsUBA = assets as bigint | null;
      sharePriceE6 = sp as bigint | null;
      instantRedemptionFeeBps = fee != null ? Number(fee) : null;
      epochLagSeconds = lag != null ? Number(lag) : null;
    }

    if (depositsPaused) {
      return res.status(409).json({ error: 'VAULT_DEPOSITS_PAUSED', vault });
    }

    // APY — protocol data with source, or absent (invariant #9). Firelight
    // Phase 1 has no staking rewards yet → null + honest note.
    const apyPct30d = vault === 'firelight' ? null : await fetchUpshiftApy30d(vaultAddress);
    const apySource =
      vault === 'firelight'
        ? null
        : apyPct30d != null
          ? 'Upshift (August Digital) API historical_apy.30'
          : null;

    const capRemainingUBA =
      depositCapUBA != null && totalAssetsUBA != null
        ? depositCapUBA > totalAssetsUBA
          ? depositCapUBA - totalAssetsUBA
          : 0n
        : null;

    // Vault facts shared by BOTH rails — all protocol data read above (#6/#9).
    const vaultFacts = {
      vault,
      vaultName,
      vaultAddress,
      receiptToken,
      riskProfile,
      fxrpPriceUSD,
      sharePrice: sharePriceE6 != null ? Number(sharePriceE6) / DROPS : null,
      sharePriceSource:
        vault === 'firelight'
          ? 'stXRP.convertToAssets(1e6) (live on-chain)'
          : 'vault.getSharePrice() (live on-chain)',
      apyPct30d,
      apySource,
      capacity:
        depositCapUBA != null && totalAssetsUBA != null
          ? {
              depositCapFxrp: Number(depositCapUBA) / DROPS,
              usedFxrp: Number(totalAssetsUBA) / DROPS,
              remainingFxrp: capRemainingUBA != null ? Number(capRemainingUBA) / DROPS : null,
            }
          : null,
      withdrawal:
        vault === 'firelight'
          ? { kind: 'erc4626-claim', instantRedemptionFeeBps: null, epochLagSeconds: null, note: 'redeem stXRP → FXRP via the vault claim flow' }
          : {
              kind: 'instant-or-epoch',
              instantRedemptionFeeBps,
              epochLagSeconds,
              note: 'instantRedeem pays the bps fee; requestRedeem waits the epoch lag with no fee',
            },
      noDebt: true,
      noLiquidationRisk: true,
      disclosedToUser: true,
      astryumSigns: false,
    };

    // 4-EVM. DIRECT ENTRY (no XRPL mint): deposit the wallet's own FXRP into
    // the vault — the SAME [approve, deposit] batch the PA runs, handed to the
    // user's Flare wallet as unsigned EVM calls. Shares land in that wallet.
    if (evmAddr) {
      const supplyUBA = BigInt(Math.round(amount * DROPS));
      const balance = await erc20BalanceOf(provider, fxrpToken, evmAddr);
      if (balance != null && balance < supplyUBA) {
        return res.status(409).json({
          error: 'INSUFFICIENT_FXRP',
          balanceFxrp: Number(balance) / DROPS,
          requestedFxrp: amount,
        });
      }
      if (capRemainingUBA != null && supplyUBA > capRemainingUBA) {
        return res.status(409).json({
          error: 'VAULT_CAP_EXCEEDED',
          vault,
          capRemainingFxrp: Number(capRemainingUBA) / DROPS,
          requestedFxrp: Number(supplyUBA) / DROPS,
        });
      }
      const inner =
        vault === 'firelight'
          ? await new FirelightAdapter().buildStakeBatch({ supplyUBA, receiver: evmAddr })
          : await new UpshiftVaultAdapter().buildDepositBatch({ vaultKey: vault, supplyUBA, receiver: evmAddr });
      const depositFxrpDirect = Number(supplyUBA) / DROPS;
      return res.json({
        rail: 'evm',
        entry: 'evm-direct',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        calls: toEvmCalls(inner, [
          `Approve ${depositFxrpDirect} FXRP → ${vaultName}`,
          `Deposit ${depositFxrpDirect} FXRP — shares land in your wallet`,
        ]),
        scanner,
        disclosure: {
          ...vaultFacts,
          entry: 'evm-direct',
          fxrpDeposited: depositFxrpDirect,
          depositedValueUSD: depositFxrpDirect * fxrpPriceUSD,
          note:
            vault === 'monarq'
              ? 'Astryum builds these unsigned EVM calls; you sign them in your own Flare wallet. Your FXRP is deposited directly into the Monarq vault — no XRPL mint. IMPORTANT: this vault runs OFF-CHAIN strategies (options, basis) managed by Monarq Asset Management — returns are not verifiable on-chain and withdrawals wait a 7-day epoch unless you pay the instant fee.'
              : 'Astryum builds these unsigned EVM calls; you sign them in your own Flare wallet. Your FXRP is deposited directly into the vault — no XRPL mint, no borrow, no liquidation. Withdraw returns FXRP.',
        },
      });
    }

    // 4. BUILD (unsigned) — mint FXRP → deposit into the vault. Enforce the
    //    live cap BEFORE returning so the user never signs a doomed Payment.
    const grossXrpDrops = BigInt(Math.round(amount * DROPS));
    const built = await buildVaultEntryHandoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      vault,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
    });
    const net = built.handoff.net;

    if (capRemainingUBA != null && net.supplyUBA > capRemainingUBA) {
      return res.status(409).json({
        error: 'VAULT_CAP_EXCEEDED',
        vault,
        capRemainingFxrp: Number(capRemainingUBA) / DROPS,
        requestedFxrp: Number(net.supplyUBA) / DROPS,
      });
    }

    const depositFxrp = Number(net.supplyUBA) / DROPS;
    const minRedeemUBA = await readMinimumRedeemAmountUBA(provider);

    // 5. RESPONSE — unsigned XRPL Payment + disclosure (#6). Astryum signs nothing.
    return res.json({
      rail: 'xrpl',
      personalAccount: built.handoff.personalAccount,
      xrplPayment: built.handoff.xrplPayment,
      memoHex: built.handoff.memoHex,
      userOpData: built.handoff.userOpData,
      scanner,
      disclosure: {
        ...vaultFacts,
        grossXrp: amount,
        ...mintFeeDisclosure(net),
        fxrpMinted: Number(net.netToPersonalAccountUBA) / DROPS,
        fxrpDeposited: depositFxrp,
        depositedValueUSD: depositFxrp * fxrpPriceUSD,
        redeemMinimumXrp: minRedeemUBA != null ? Number(minRedeemUBA) / DROPS : null,
        note:
          (vault === 'monarq'
            ? 'Astryum builds this unsigned XRPL Payment; you sign it in Xaman. Your XRP is minted to FXRP and deposited into the Monarq vault. IMPORTANT: this vault runs OFF-CHAIN strategies (options, basis) managed by Monarq Asset Management — returns are not verifiable on-chain and withdrawals wait a 7-day epoch unless you pay the instant fee. Withdraw returns FXRP.'
            : 'Astryum builds this unsigned XRPL Payment; you sign it in Xaman. Your XRP is minted to FXRP and deposited into the vault as a plain deposit — no borrow, no liquidation. Withdraw returns FXRP.') +
          fxrpExitWarning(minRedeemUBA) +
          ' Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'VAULT_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* E2 — FLR entry (EVM direct): wrap + delegate to FTSO                      */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/e2/prepare
 * Body: { amountFlr, provider (FTSO data provider address), bips?, region? }
 * Returns the UNSIGNED [wrap, delegate] EVM calls + a disclosure.
 */
router.post('/e2/prepare', async (req: Request, res: Response) => {
  try {
    const {
      amountFlr,
      provider: ftsoProvider,
      bips = MAX_BIPS,
      region = null,
    } = (req.body ?? {}) as {
      amountFlr?: number | string;
      provider?: string;
      bips?: number;
      region?: string | null;
    };

    const amount = Number(amountFlr);
    if (!isPositiveFinite(amount)) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    // Checksum-normalise here so a bad EIP-55 mix-case is a clean 400, not a 500
    // from ethers.getAddress inside the build step.
    const ftsoProviderAddr = safeGetAddress(ftsoProvider);
    if (!ftsoProviderAddr) {
      return res.status(400).json({ error: 'INVALID_FTSO_PROVIDER' });
    }
    const bipsInt = Number(bips);
    if (!Number.isInteger(bipsInt) || bipsInt <= 0 || bipsInt > MAX_BIPS) {
      return res.status(400).json({ error: 'INVALID_BIPS', detail: `bips must be integer in (0, ${MAX_BIPS}]` });
    }

    // 1. GATING (flag + geofence) — the Flare DeFi module sits behind both.
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // 2. BUILD (unsigned) — wrap FLR via deposit() payable, then delegate vote power.
    const amountWei = ethers.parseUnits(String(amount), 18).toString();
    const iface = new ethers.Interface(WNAT_ABI);
    const calls = [
      {
        to: WNAT_ADDRESS,
        data: WNAT_DEPOSIT_SELECTOR,
        value: amountWei,
        chainId: FLARE_CHAIN_ID,
        label: `Wrap ${amount} FLR → WFLR`,
      },
      {
        to: WNAT_ADDRESS,
        data: iface.encodeFunctionData('delegate', [ftsoProviderAddr, bipsInt]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Delegate ${(bipsInt / 100).toFixed(0)}% of WFLR vote power to ${ftsoProviderAddr.slice(0, 8)}…`,
      },
    ];

    // 3. DISCLOSURE (#9: FTSO rewards are a protocol datum, never a promise).
    let flrPriceUSD = 0;
    try {
      const priceProvider = await createFTSOPriceProvider();
      flrPriceUSD = await priceProvider.getPriceUSD('FLR');
    } catch {
      /* price is informational for E2; don't block the wrap+delegate prepare */
    }

    return res.json({
      rail: 'evm',
      chainId: FLARE_CHAIN_ID,
      calls,
      disclosure: {
        amountFlr: amount,
        provider: ftsoProviderAddr,
        bips: bipsInt,
        flrPriceUSD,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'FTSO delegation rewards accrue per reward epoch (~3.5 days) and are a protocol datum — not a Astryum yield offer. You sign wrap + delegate in your EVM wallet.',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'E2_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/** Read WNat delegations → [{ provider, bips }] with only the active (>0) rows. */
async function readDelegations(
  wnat: ethers.Contract,
  account: string,
): Promise<Array<{ provider: string; bips: number }>> {
  const result = await wnat.delegatesOf(account);
  const addresses: string[] = result.delegateAddresses ?? result[0] ?? [];
  const bips: bigint[] = result.bips ?? result[1] ?? [];
  const out: Array<{ provider: string; bips: number }> = [];
  for (let i = 0; i < addresses.length; i++) {
    const b = Number(bips[i] ?? 0n);
    if (b > 0) out.push({ provider: addresses[i], bips: b });
  }
  return out;
}

/**
 * GET /api/flare-demo/e2/position?account=0x…
 * Read layer of the E2 exit: live WFLR balance + delegations of the wallet.
 * Observe-wide read — nothing here is signable, so no execution gate.
 */
router.get('/e2/position', async (req: Request, res: Response) => {
  try {
    const account = safeGetAddress(req.query.account);
    if (!account) return res.status(400).json({ error: 'INVALID_ACCOUNT' });

    const provider = flareProvider();
    const wnat = new ethers.Contract(WNAT_ADDRESS, WNAT_ABI, provider);
    const [balanceWei, delegations] = await Promise.all([
      wnat.balanceOf(account) as Promise<bigint>,
      readDelegations(wnat, account),
    ]);

    let flrPriceUSD = 0;
    try {
      const priceProvider = await createFTSOPriceProvider();
      flrPriceUSD = await priceProvider.getPriceUSD('FLR');
    } catch {
      /* price is informational — the balance read must not fail with it */
    }

    return res.json({
      account,
      balanceWflrWei: balanceWei.toString(),
      balanceWflr: Number(ethers.formatUnits(balanceWei, 18)),
      delegations,
      flrPriceUSD,
    });
  } catch (e) {
    return res.status(500).json({ error: 'E2_POSITION_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/e2/exit/prepare
 * Body: { account, amountFlr? | max: true, region? }
 * The reverse of /e2/prepare: unwrap WFLR → FLR in the SAME wallet
 * (WNat.withdraw), preceded by undelegateAll ONLY on a full exit. A partial
 * unwrap keeps the delegation percentages on the remaining WFLR (WNat
 * delegation is %-of-balance). Returns UNSIGNED EVM calls + disclosure —
 * the user signs in their own wallet; Astryum never signs.
 */
router.post('/e2/exit/prepare', async (req: Request, res: Response) => {
  try {
    const {
      account,
      amountFlr,
      max = false,
      region = null,
    } = (req.body ?? {}) as {
      account?: string;
      amountFlr?: number | string;
      max?: boolean;
      region?: string | null;
    };

    // 0. VALIDATION — before the gate, before any RPC (hermetic-test contract).
    const accountAddr = safeGetAddress(account);
    if (!accountAddr) return res.status(400).json({ error: 'INVALID_ACCOUNT' });
    const wantsMax = max === true;
    const amount = Number(amountFlr);
    if (!wantsMax && !isPositiveFinite(amount)) {
      return res.status(400).json({ error: 'INVALID_AMOUNT' });
    }

    // 1. GATING (flag + geofence) — the Flare DeFi module sits behind both.
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // 2. READ — the exact WFLR balance sizes MAX and catches over-asks with
    //    honest numbers instead of a wallet-side revert.
    const provider = flareProvider();
    const wnat = new ethers.Contract(WNAT_ADDRESS, WNAT_ABI, provider);
    const [balanceWei, delegations] = await Promise.all([
      wnat.balanceOf(accountAddr) as Promise<bigint>,
      readDelegations(wnat, accountAddr),
    ]);
    if (balanceWei <= 0n) {
      return res.status(400).json({ error: 'NO_WFLR', detail: 'This wallet holds no WFLR to unwrap.' });
    }

    const amountWei = wantsMax ? balanceWei : ethers.parseUnits(String(amount), 18);
    if (amountWei > balanceWei) {
      return res.status(400).json({
        error: 'INSUFFICIENT_WFLR',
        holder: accountAddr,
        balanceWflr: Number(ethers.formatUnits(balanceWei, 18)),
        requestedFlr: Number(ethers.formatUnits(amountWei, 18)),
      });
    }
    const fullExit = amountWei === balanceWei;
    const undelegates = fullExit && delegations.length > 0;
    const amountHuman = Number(ethers.formatUnits(amountWei, 18));

    // 3. BUILD (unsigned) — undelegate first on a full exit, then unwrap.
    const iface = new ethers.Interface(WNAT_ABI);
    const calls = [
      ...(undelegates
        ? [{
            to: WNAT_ADDRESS,
            data: iface.encodeFunctionData('undelegateAll', []),
            value: '0',
            chainId: FLARE_CHAIN_ID,
            label: 'Undelegate all WFLR vote power',
          }]
        : []),
      {
        to: WNAT_ADDRESS,
        data: iface.encodeFunctionData('withdraw', [amountWei]),
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: `Unwrap ${amountHuman} WFLR → FLR`,
      },
    ];

    // 4. DISCLOSURE (#6) — price is informational, never blocking.
    let flrPriceUSD = 0;
    try {
      const priceProvider = await createFTSOPriceProvider();
      flrPriceUSD = await priceProvider.getPriceUSD('FLR');
    } catch {
      /* informational */
    }

    return res.json({
      rail: 'evm',
      chainId: FLARE_CHAIN_ID,
      account: accountAddr,
      calls,
      disclosure: {
        amountFlr: amountHuman,
        balanceWflr: Number(ethers.formatUnits(balanceWei, 18)),
        fullExit,
        undelegates,
        delegations,
        flrPriceUSD,
        disclosedToUser: true,
        astryumSigns: false,
        note: undelegates
          ? 'Full exit: the delegation is removed and every WFLR unwraps back to FLR in the same wallet. FTSO rewards already accrued stay claimable afterwards.'
          : 'Partial unwrap: the delegation percentages stay on the remaining WFLR. FTSO rewards already accrued stay claimable afterwards.',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'E2_EXIT_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* A1 — protection (EVM direct): repay USDT0 on the ISO market to lift HF     */
/* ----------------------------------------------------------------------- */

const CTOKEN_UNDERLYING_ABI = ['function underlying() view returns (address)'];
let cachedIsoUsdt0Underlying: string | null = null;

/**
 * Resolve the ISO market's USDT0 underlying token on-chain from kUSDT0_ISO.
 * underlying() (invariant #3: the receipt kToken is NOT the underlying — never
 * conflate them, never hardcode a guessed token). Cached: the ISO market is fixed.
 */
async function resolveIsoUsdt0Underlying(
  provider: ethers.JsonRpcProvider,
  kUsdt0Iso: string,
): Promise<string> {
  if (cachedIsoUsdt0Underlying) return cachedIsoUsdt0Underlying;
  const kToken = new ethers.Contract(kUsdt0Iso, CTOKEN_UNDERLYING_ABI, provider);
  const underlying: string = await kToken.underlying();
  if (!ADDRESS_RE.test(underlying)) throw new Error('ISO_USDT0_UNDERLYING_UNRESOLVED');
  cachedIsoUsdt0Underlying = ethers.getAddress(underlying);
  return cachedIsoUsdt0Underlying;
}

/**
 * POST /api/flare-demo/a1/prepare
 * Body: { personalAccount, supplyUBA, debtUsdt0Base, collateralFactor,
 *         targetHF?, fxrpPriceUSD?, mode?, withdrawableUsdt0Base?, region? }
 *
 * The protection TWIN of E1 (stop-loss). Given the e1.a1 precomputed inputs and a
 * scenario/live FXRP price, it builds the UNSIGNED [approve, repayBorrowBehalf] EVM
 * calls that repay the Personal Account's USDT0 debt on the ISO market and lift its
 * health factor. `mode` = 'restore' (repay just enough to reach targetHF, default)
 * or 'full' (repay the whole debt). Signer = the user's EVM wallet (MetaMask).
 * Astryum builds; the user signs. It never signs, never broadcasts.
 *
 * `withdrawableUsdt0Base` (optional): what the ISO supply withdrawal yields
 * (DERISK step 1, /pa-withdraw-transfer). When given, the disclosure also
 * computes the carry-spread shortfall — the USDT0 the EVM wallet must top up
 * beyond the withdrawal so the repay pull doesn't revert (audit M7).
 */
router.post('/a1/prepare', async (req: Request, res: Response) => {
  try {
    const {
      personalAccount,
      supplyUBA,
      debtUsdt0Base,
      collateralFactor,
      targetHF = 1.1,
      fxrpPriceUSD: scenarioPrice,
      mode = 'restore',
      withdrawableUsdt0Base,
      signerAddress,
      fill,
      region = null,
    } = (req.body ?? {}) as {
      personalAccount?: string;
      supplyUBA?: string | number;
      debtUsdt0Base?: string | number;
      collateralFactor?: number;
      targetHF?: number;
      fxrpPriceUSD?: number;
      mode?: 'restore' | 'full';
      withdrawableUsdt0Base?: string | number;
      /** La wallet EVM que FIRMARÁ (opcional): con ella el prepare capa el
       *  repay a su saldo USDT0 real — jamás un payload condenado a revertir
       *  (incidente 2026-07-26: repay full con shortfall de 0,0003 → revert
       *  on-chain con gas quemado). */
      signerAddress?: string;
      /** SWAP-FILL (doc 2026-07-26, variante A): si al firmante le falta USDT0,
       *  compra EXACTAMENTE el hueco con un swap del PROPIO usuario (activo a
       *  su elección) compilado delante del repay. Sin `fill`, el prepare
       *  responde con las opciones cotizadas y el usuario elige. */
      fill?: { asset?: string };
      region?: string | null;
    };

    // VALIDATE
    if (!personalAccount || !ADDRESS_RE.test(String(personalAccount))) {
      return res.status(400).json({ error: 'INVALID_PERSONAL_ACCOUNT' });
    }
    let supply: bigint;
    let debt: bigint;
    try {
      supply = BigInt(supplyUBA as string | number);
      debt = BigInt(debtUsdt0Base as string | number);
    } catch {
      return res.status(400).json({ error: 'INVALID_AMOUNTS', detail: 'supplyUBA/debtUsdt0Base must be integers (base units)' });
    }
    if (supply <= 0n) return res.status(400).json({ error: 'INVALID_SUPPLY' });
    if (debt <= 0n) return res.status(400).json({ error: 'INVALID_DEBT' });
    // A PROVIDED collateral factor must be valid; an ABSENT one is read live
    // from the ISO comptroller below (same source e1/prepare uses) so the UI
    // never has to guess it.
    if (collateralFactor !== undefined && collateralFactor !== null) {
      const cfIn = Number(collateralFactor);
      if (!(Number.isFinite(cfIn) && cfIn > 0 && cfIn <= 1)) {
        return res.status(400).json({ error: 'INVALID_COLLATERAL_FACTOR' });
      }
    }
    if (!isPositiveFinite(Number(targetHF))) return res.status(400).json({ error: 'INVALID_TARGET_HF' });
    if (mode !== 'restore' && mode !== 'full') return res.status(400).json({ error: 'INVALID_MODE' });
    const fillAssetReq = fill?.asset == null ? null : String(fill.asset).toUpperCase();
    if (fillAssetReq !== null && fillAssetReq !== 'FLR' && fillAssetReq !== 'FXRP') {
      return res.status(400).json({ error: 'INVALID_FILL_ASSET', detail: "fill.asset must be 'FLR' | 'FXRP'" });
    }
    if (fillAssetReq && !safeGetAddress(signerAddress)) {
      return res.status(400).json({ error: 'FILL_NEEDS_SIGNER', detail: 'fill requires signerAddress (the wallet whose balances fund the swap)' });
    }
    // A provided scenario price must be a positive finite number; only an ABSENT
    // price falls through to the live FTSO read.
    if (scenarioPrice !== undefined && scenarioPrice !== null && !isPositiveFinite(Number(scenarioPrice))) {
      return res.status(400).json({ error: 'INVALID_PRICE', detail: 'fxrpPriceUSD must be a positive finite number' });
    }
    // Optional DERISK step-1 yield — must be integer base units ≥ 0 when present.
    let withdrawable: bigint | null = null;
    if (withdrawableUsdt0Base !== undefined && withdrawableUsdt0Base !== null) {
      try {
        withdrawable = BigInt(withdrawableUsdt0Base as string | number);
      } catch {
        return res.status(400).json({ error: 'INVALID_WITHDRAWABLE', detail: 'withdrawableUsdt0Base must be integer base units' });
      }
      if (withdrawable < 0n) {
        return res.status(400).json({ error: 'INVALID_WITHDRAWABLE', detail: 'withdrawableUsdt0Base must be >= 0' });
      }
    }

    // 1. GATING (flag + geofence)
    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // ISO market env must be configured (the borrow lives in kUSDT0 ISO).
    const k = getProtocolAddresses().kinetic;
    if (!k.isoKUsdt0) {
      return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED', detail: 'Set KINETIC_KUSDT0_ISO' });
    }

    const provider = flareProvider();

    // 2. PRICE — a caller-supplied scenario (drop) price, else live FTSO XRP/USD.
    let fxrpPriceUSD = Number(scenarioPrice);
    if (!(fxrpPriceUSD > 0)) {
      const priceProvider = await createFTSOPriceProvider();
      fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
      if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });
    }

    // 2b. COLLATERAL FACTOR — caller-supplied (e1.a1 reuse) or live markets()
    // read of kFXRP ISO, the exact source e1/prepare disclosed at entry.
    let cf = Number(collateralFactor);
    if (!(Number.isFinite(cf) && cf > 0 && cf <= 1)) {
      if (!k.isoComptroller || !k.isoKFxrp) {
        return res.status(503).json({
          error: 'ISO_MARKET_NOT_CONFIGURED',
          detail: 'Set KINETIC_ISO_COMPTROLLER, KINETIC_KFXRP_ISO (needed to read the live collateral factor)',
        });
      }
      const comptroller = new ethers.Contract(
        k.isoComptroller,
        ['function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)'],
        provider,
      );
      const market = await comptroller.markets(k.isoKFxrp);
      if (!market[0]) return res.status(502).json({ error: 'KFXRP_ISO_NOT_LISTED' });
      cf = Number(market[1]) / MANTISSA;
    }

    // 3. RESOLVE underlying on-chain + COMPUTE repay to restore targetHF.
    const usdt0Token = await resolveIsoUsdt0Underlying(provider, k.isoKUsdt0!);
    const restore = computeRepayToRestoreHF({
      supplyUBA: supply,
      debtUsdt0Base: debt,
      fxrpPriceUSD,
      collateralFactor: cf,
      targetHF: Number(targetHF),
    });

    // Position already safe and not a full unwind → nothing to sign.
    if (mode === 'restore' && !restore.needed) {
      return res.json({
        rail: 'evm',
        chainId: FLARE_CHAIN_ID,
        calls: [],
        disclosure: {
          mode,
          needed: false,
          currentHF: restore.currentHF,
          targetHF: Number(targetHF),
          fxrpPriceUSD,
          disclosedToUser: true,
          astryumSigns: false,
          note: `Health factor ${restore.currentHF.toFixed(3)} is already at/above the target ${Number(targetHF)}; no repay needed.`,
        },
      });
    }

    let repayBase = mode === 'full' ? debt : restore.repayUsdt0Base;

    // Techo del FIRMANTE (incidente 2026-07-26): el repay full con la deuda
    // devengando interés supera el saldo de la wallet por un polvo creciente
    // (~0,0003 aquel día) y el transferFrom REVIENTA on-chain — gas quemado
    // por un payload que nació muerto. Con signerAddress, el prepare capa al
    // saldo USDT0 real y lo DISCLOSA; sin saldo, rechaza honesto.
    //
    // SWAP-FILL (variante A del doc 2026-07-26): antes de capar, se cotiza
    // comprar EXACTAMENTE el hueco con un swap del PROPIO usuario (FXRP o FLR
    // → USDT0 en SparkDEX) compilado delante del repay — el principal viaja
    // usuario→pool→usuario, Astryum solo compila. Con el fill aplicado en mode
    // 'full', el repay va con uint(-1): el contrato pulla la deuda VIVA exacta
    // del bloque de la firma (CErc20 verificado) — el blanco móvil muere aquí.
    let walletUsdt0: bigint | null = null;
    let cappedToWallet = false;
    const signerAddr = safeGetAddress(signerAddress);

    // Colchón de devengo para el repay-todo: el fill compra hueco+colchón y el
    // pull con uint(-1) toma la deuda exacta; el sobrante (≤ colchón) se queda
    // en la wallet. 0,05% de la deuda, mín 0,0001 USDT0 — cubre >24h al APR real.
    const accrualBuffer = debt / 2000n > 100n ? debt / 2000n : 100n;

    let gapBase = 0n;
    let fillOptions: FillOption[] = [];
    let fillApplied: FillOption | null = null;
    let fillCalls: FillCall[] = [];

    if (signerAddr) {
      walletUsdt0 = await erc20BalanceOf(provider, usdt0Token, signerAddr);
      if (walletUsdt0 != null) {
        // Lo que la wallet necesita DE VERDAD: para 'full', deuda + colchón
        // (el pull vivo puede superar la deuda de ahora); para 'restore', el
        // importe exacto calculado.
        const neededInWallet = mode === 'full' ? debt + accrualBuffer : repayBase;
        gapBase = neededInWallet > walletUsdt0 ? neededInWallet - walletUsdt0 : 0n;

        if (gapBase > 0n && swapFillEnabled()) {
          fillOptions = await quoteFillOptions(provider, {
            holder: signerAddr,
            gapUsdt0Base: gapBase,
            usdt0Token,
            assets: ['FXRP', 'FLR'],
          });
          if (fillAssetReq) {
            const opt = fillOptions.find((o) => o.asset === fillAssetReq) ?? null;
            if (!opt) {
              return res.status(409).json({
                error: 'FILL_NO_ROUTE',
                detail: `Ningún pool de SparkDEX cotiza ${fillAssetReq}→USDT0 para este importe.`,
              });
            }
            if (!opt.sufficient) {
              return res.status(409).json({
                error: 'FILL_INSUFFICIENT_BALANCE',
                detail: `La wallet firmante no llega al tope del fill en ${fillAssetReq} (máx ${ethers.formatUnits(opt.amountInMax, opt.tokenInDecimals)}${fillAssetReq === 'FLR' ? ' + margen de gas' : ''}).`,
              });
            }
            fillApplied = opt;
            fillCalls = buildFillSwapCalls({
              quote: opt,
              usdt0Token,
              amountOutBase: gapBase,
              recipient: signerAddr,
            });
          }
        }

        if (fillApplied == null) {
          // Sin fill elegido: el comportamiento capado/honesto de siempre —
          // pero SIEMPRE con las opciones cotizadas al lado para que el
          // usuario pueda ELEGIR el activo y cerrar al 100% (§4b del doc).
          if (walletUsdt0 <= 0n) {
            if (fillOptions.length > 0) {
              return res.json({
                rail: 'evm',
                chainId: FLARE_CHAIN_ID,
                personalAccount,
                usdt0Token,
                calls: [],
                fill: serializeFill({ enabled: true, gapBase, options: fillOptions, applied: null, required: true }),
                disclosure: {
                  mode,
                  needed: true,
                  fillRequired: true,
                  currentHF: restore.currentHF,
                  fxrpPriceUSD,
                  debtUsdt0: Number(debt) / DROPS,
                  walletUsdt0: 0,
                  disclosedToUser: true,
                  astryumSigns: false,
                  note: 'La wallet firmante no tiene USDT0, pero el hueco se puede comprar con TU propio FXRP o FLR (swap en SparkDEX dentro del mismo batch que firmas). Elige el activo del fill y vuelve a preparar.',
                },
              });
            }
            return res.status(409).json({
              error: 'NO_USDT0_IN_WALLET',
              detail:
                'La wallet firmante no tiene USDT0 — el repay saldría condenado a revertir. Retira USDT0 del PA o consíguelo antes de preparar.',
            });
          }
          if (repayBase > walletUsdt0) {
            repayBase = walletUsdt0;
            cappedToWallet = true;
          }
        }
      }
    }

    // DERISK shortfall of the carry spread (audit M7): when the caller reports
    // what the supply withdrawal yielded, disclose the top-up the EVM wallet
    // must fund so the repay pull below doesn't revert.
    const shortfall =
      withdrawable === null ? null : computeDeriskShortfall({ repayUsdt0Base: repayBase, withdrawableUsdt0Base: withdrawable });

    // 4. BUILD (unsigned) — [fill?] + approve + repayBorrowBehalf on kUSDT0 ISO.
    // Con fill y mode 'full': repay = uint(-1) (la deuda VIVA del bloque de la
    // firma, resuelta por el contrato) con approve FINITO deuda+colchón —
    // jamás un approve infinito.
    const useMaxRepay = fillApplied != null && mode === 'full';
    const batch = await new KineticAdapter().buildIsoRepayBehalfBatch({
      borrower: String(personalAccount),
      repayUsdt0: useMaxRepay ? ethers.MaxUint256 : repayBase,
      usdt0Token,
      ...(useMaxRepay ? { approveUsdt0: debt + accrualBuffer } : {}),
    });

    const repayHuman = Number(repayBase) / DROPS; // con uint(-1): la mejor estimación (deuda de ahora)
    const gapHuman = Number(gapBase) / DROPS;
    const fmtIn = (v: bigint) =>
      fillApplied ? Number(ethers.formatUnits(v, fillApplied.tokenInDecimals)).toFixed(fillApplied.asset === 'FLR' ? 4 : 6) : '';
    const fillCallLabels = fillApplied
      ? fillApplied.asset === 'FLR'
        ? [
            `Wrap ≤${fmtIn(fillApplied.amountInMax)} FLR → WFLR (fill)`,
            'Approve WFLR → SparkDEX',
            `Swap ≤${fmtIn(fillApplied.amountInMax)} WFLR → ${gapHuman} USDT0 exactos (fill)`,
          ]
        : [
            'Approve FXRP → SparkDEX',
            `Swap ≤${fmtIn(fillApplied.amountInMax)} FXRP → ${gapHuman} USDT0 exactos (fill)`,
          ]
      : [];
    const calls = [
      ...fillCalls.map((c, i) => ({
        to: c.to,
        data: c.calldata,
        value: c.value,
        chainId: FLARE_CHAIN_ID,
        label: fillCallLabels[i] ?? `fill step ${i + 1}`,
      })),
      {
        to: batch[0].to,
        data: batch[0].calldata,
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: useMaxRepay
          ? `Approve ${Number(debt + accrualBuffer) / DROPS} USDT0 → kUSDT0 ISO (tope finito)`
          : `Approve ${repayHuman} USDT0 → kUSDT0 ISO`,
      },
      {
        to: batch[1].to,
        data: batch[1].calldata,
        value: '0',
        chainId: FLARE_CHAIN_ID,
        label: useMaxRepay
          ? `Repay TODA la deuda viva (≈${repayHuman} USDT0) on behalf of ${String(personalAccount).slice(0, 8)}…`
          : `Repay ${repayHuman} USDT0 on behalf of ${String(personalAccount).slice(0, 8)}…`,
      },
    ];

    // Invariant #11 — dry-run before signature, from the SIGNING wallet when
    // the caller names it (without signerAddress there is no honest `from` to
    // simulate with — the preflight is omitted, the response unchanged). The
    // repay is verifiable TODAY only if a standing allowance already covers it;
    // otherwise it rides the approve of this same batch → honest 'unverified'.
    // Con fill: las calls del swap entran en el dry-run — el swap depende del
    // approve de este mismo batch, y el repay del USDT0 que el swap compra.
    let preflight;
    if (signerAddr) {
      const allowance = await erc20Allowance(provider, usdt0Token, signerAddr, k.isoKUsdt0!);
      const fillPre: EvmPreflightCall[] = fillCalls.map((c, i) => ({
        to: c.to,
        data: c.calldata,
        value: c.value,
        label: fillCallLabels[i] ?? `fill step ${i + 1}`,
        dependsOnPrior: i === fillCalls.length - 1, // el swap necesita su approve
      }));
      preflight = await preflightEvmCalls(provider, signerAddr, [
        ...fillPre,
        { to: batch[0].to, data: batch[0].calldata, value: batch[0].value, label: 'approve USDT0' },
        {
          to: batch[1].to,
          data: batch[1].calldata,
          value: batch[1].value,
          label: 'repay USDT0 debt',
          compoundErrorCode: true,
          dependsOnPrior: fillApplied != null || allowance == null || allowance < repayBase,
        },
      ]);
    }

    // ANTES → DESPUÉS (§4b del doc) — números reales del prepare, peor caso en
    // el gasto del fill (el swap gasta ≤ tope; lo no gastado se queda en la wallet).
    const repaidPlanned = useMaxRepay ? debt : repayBase;
    const debtAfter = debt - repaidPlanned;
    const collateralUsd = (Number(supply) / DROPS) * fxrpPriceUSD * cf;
    const hfAfter = debtAfter <= 0n ? null : collateralUsd / (Number(debtAfter) / DROPS);
    const boughtBase = fillApplied ? gapBase : 0n;
    const walletAfterRaw = walletUsdt0 == null ? null : walletUsdt0 + boughtBase - repaidPlanned;
    const beforeAfter = {
      debtUsdt0: { before: Number(debt) / DROPS, after: Number(debtAfter) / DROPS },
      healthFactor: { before: restore.currentHF, after: hfAfter }, // after null = ∞ (sin deuda)
      ...(walletUsdt0 != null
        ? {
            walletUsdt0: {
              before: Number(walletUsdt0) / DROPS,
              after: Number(walletAfterRaw! < 0n ? 0n : walletAfterRaw!) / DROPS,
            },
          }
        : {}),
      ...(fillApplied
        ? {
            fillAsset: {
              asset: fillApplied.asset,
              before: fillApplied.balance == null ? null : Number(ethers.formatUnits(fillApplied.balance, fillApplied.tokenInDecimals)),
              spendMax: Number(ethers.formatUnits(fillApplied.amountInMax, fillApplied.tokenInDecimals)),
              after:
                fillApplied.balance == null
                  ? null
                  : Number(ethers.formatUnits(fillApplied.balance - fillApplied.amountInMax, fillApplied.tokenInDecimals)),
              note:
                'peor caso: el swap gasta como MÁXIMO el tope disclosed; lo no gastado se queda en tu wallet' +
                (fillApplied.asset === 'FLR' ? ' (como WFLR)' : ''),
            },
          }
        : {}),
      note: 'Con los precios/tasas de AHORA — el interés devenga hasta el bloque de la firma.',
    };

    // 5. RESPONSE — unsigned EVM calls + disclosure (#6). Astryum signs nothing.
    return res.json({
      rail: 'evm',
      chainId: FLARE_CHAIN_ID,
      personalAccount,
      usdt0Token,
      calls,
      ...(preflight ? { preflight } : {}),
      ...(gapBase > 0n || fillApplied
        ? { fill: serializeFill({ enabled: swapFillEnabled(), gapBase, options: fillOptions, applied: fillApplied, required: false }) }
        : {}),
      disclosure: {
        mode,
        needed: true,
        currentHF: restore.currentHF,
        targetHF: Number(targetHF),
        fxrpPriceUSD,
        collateralFactor: cf,
        supplyFxrp: Number(supply) / DROPS,
        debtUsdt0: Number(debt) / DROPS,
        repayUsdt0: repayHuman,
        remainingDebtUsdt0: Number(debt - repaidPlanned) / DROPS,
        ...(walletUsdt0 != null ? { walletUsdt0: Number(walletUsdt0) / DROPS } : {}),
        cappedToWallet,
        beforeAfter,
        ...(shortfall
          ? {
              withdrawableUsdt0: Number(withdrawable) / DROPS,
              shortfallUsdt0: shortfall.shortfallUsdt0Human,
              coveredByWithdraw: shortfall.coveredByWithdraw,
            }
          : {}),
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Astryum builds these unsigned EVM calls (approve + repayBorrowBehalf); you sign them in your EVM wallet. This repays the Personal Account’s USDT0 debt and lifts its health factor. The USDT0 must already sit in the signing wallet (moved PA→EVM beforehand).' +
          (fillApplied
            ? ` Fill: te faltan ${gapHuman} USDT0 — se compran con TU ${fillApplied.asset} (swap exactOutput en SparkDEX, tope ${fmtIn(fillApplied.amountInMax)} ${fillApplied.asset}, slippage máx ${fillSlippagePct()}% disclosed) dentro del mismo batch que firmas. El principal viaja de tu wallet al pool y vuelve a tu wallet — Astryum solo compila.` +
              (useMaxRepay
                ? ' El repay usa uint(-1): el contrato cobra la deuda VIVA exacta del bloque de la firma — cierre al 100%, sin polvo.'
                : '')
            : '') +
          (cappedToWallet
            ? ` Capped to your wallet balance: the accruing borrow interest put the full debt ${(Number(debt - repayBase) / DROPS).toFixed(6)} USDT0 above what you hold — this repays everything you have and that dust remains as debt (top it up later, or leave it; without the cap the repay would revert on-chain).` +
              (fillOptions.length > 0
                ? ' Alternativa: elige un activo de fill (FXRP/FLR) y el mismo batch cierra el 100% comprando el hueco con tu propio swap.'
                : '')
            : '') +
          (shortfall && !shortfall.coveredByWithdraw
            ? ` Carry-spread shortfall: the withdrawn USDT0 covers only part of this repay — top up ${shortfall.shortfallUsdt0Human} USDT0 from your EVM wallet before signing, or the repay pull will revert.`
            : ''),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'A1_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* PA userOp actions (0xFE) — carry re-supply + PA→EVM withdraw/transfer     */
/*                                                                           */
/* These run as arbitrary Call[] inside a 0xFE userOp on the Personal        */
/* Account (confirmed against dev.flare.network/smart-accounts/custom-       */
/* instruction: executeUserOp runs an arbitrary Call[]). The 0xFE dispatch   */
/* is MINT-COUPLED — the executor calls executeDirectMintingWithData, so the */
/* XRP paid also mints a small FXRP into the PA. Send the minimum XRP        */
/* (amountXrpForMint) and the fee/mint is disclosed. Astryum signs nothing;  */
/* the user signs the XRPL Payment in Xaman.                                 */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/supply-usdt0/prepare
 * Body: { xrplAddress, amountUsdt0Base, amountXrpForMint, region?, walletId? }
 * Opening step 2 — re-supply the borrowed USDT0 into the ISO market (the carry).
 * Kept a SEPARATE PA action from E1 (does not touch the tested open batch).
 */
router.post('/supply-usdt0/prepare', async (req: Request, res: Response) => {
  try {
    const { xrplAddress, evmAddress, amountUsdt0Base, amountXrpForMint, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        xrplAddress?: string;
        evmAddress?: string;
        amountUsdt0Base?: string | number;
        amountXrpForMint?: number | string;
        region?: string | null;
        walletId?: number;
      };

    // Two rails, like E1: the PA (0xFE via Xaman) or the wallet itself
    // (EVM-direct entries hold their ISO position in the wallet).
    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    if (!evmAddr) {
      if (!xrplAddress || typeof xrplAddress !== 'string') {
        return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
      }
      if (!XRPL_CLASSIC_RE.test(xrplAddress.trim())) {
        return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
      }
    }
    let amountUsdt0: bigint;
    try {
      amountUsdt0 = BigInt(amountUsdt0Base as string | number);
    } catch {
      return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'amountUsdt0Base must be integer base units' });
    }
    if (amountUsdt0 <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    const mintXrp = Number(amountXrpForMint);
    if (!evmAddr && !isPositiveFinite(mintXrp)) {
      return res.status(400).json({ error: 'INVALID_MINT_AMOUNT', detail: 'amountXrpForMint required (the 0xFE dispatch is mint-coupled)' });
    }

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const k = getProtocolAddresses().kinetic;
    if (!k.isoKUsdt0) return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED', detail: 'Set KINETIC_KUSDT0_ISO' });

    const provider = flareProvider();
    const usdt0Token = await resolveIsoUsdt0Underlying(provider, k.isoKUsdt0!);
    const inner = await new KineticAdapter().buildIsoSupplyUsdt0Batch({ amountUsdt0, usdt0Token });

    // EVM-direct rail: the wallet signs [approve, mint] itself — no mint, no PA.
    if (evmAddr) {
      const human = Number(amountUsdt0) / DROPS;
      // Invariant #11 — dry-run before signature. The supply is verifiable
      // TODAY only if a standing allowance already covers it; otherwise it
      // rides the approve of this same batch → honest 'unverified'.
      const allowance = await erc20Allowance(provider, usdt0Token, evmAddr, k.isoKUsdt0!);
      const preflight = await preflightEvmCalls(
        provider,
        evmAddr,
        inner.map((a, i): EvmPreflightCall => ({
          to: a.to,
          data: a.calldata,
          value: a.value,
          label: i === 0 ? 'approve USDT0' : 'supply USDT0',
          compoundErrorCode: i === 1,
          dependsOnPrior: i === 1 && (allowance == null || allowance < amountUsdt0),
        })),
      );
      return res.json({
        rail: 'evm',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        calls: toEvmCalls(inner, [
          `Approve ${human} USDT0 → Kinetic ISO`,
          `Supply ${human} USDT0 — the carry leg (~supply APY)`,
        ]),
        preflight,
        disclosure: {
          action: 'supply-usdt0',
          usdt0Supplied: human,
          usdt0Token,
          holder: evmAddr,
          disclosedToUser: true,
          astryumSigns: false,
          note:
            'Re-supplies borrowed USDT0 into the Kinetic ISO market (the carry). This position is held by your own Flare wallet — you sign the approve + supply calls directly.',
        },
      });
    }
    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));
    const handoff = await buildDirectMintHandoff(provider, {
      xrplAddress,
      grossXrpDrops,
      innerCalls: inner,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
      action: 'supply-usdt0',
    });

    // Invariant #11 — dry-run BOTH rails of the hand-off (mirror of pa-repay):
    // the XRPL Payment the user signs AND the inner 0xFE batch the PA will run.
    // The supply rides the approve of this same batch → honest 'unverified'.
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddress.trim()),
      await preflightEvmCalls(
        provider,
        handoff.personalAccount,
        inner.map((a, i): EvmPreflightCall => ({
          to: a.to,
          data: a.calldata,
          value: a.value,
          label: i === 0 ? 'approve USDT0' : 'supply USDT0',
          compoundErrorCode: i === 1,
          dependsOnPrior: i === 1,
        })),
      ),
    );

    return res.json({
      rail: 'xrpl',
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      disclosure: {
        action: 'supply-usdt0',
        usdt0Supplied: Number(amountUsdt0) / DROPS,
        usdt0Token,
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(handoff.net),
        fxrpMintedSideEffect: Number(handoff.net.netToPersonalAccountUBA) / DROPS,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Re-supplies borrowed USDT0 into the Kinetic ISO market (the carry ~14% APY). Runs as a 0xFE userOp on your Personal Account — you sign the XRPL Payment in Xaman. Mint-coupled: also mints a small FXRP into your PA from the XRP paid. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    if (repliedAmountBelowMintFees(res, e)) return;
    return res.status(500).json({ error: 'SUPPLY_USDT0_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/pa-withdraw-transfer/prepare
 * Body: { xrplAddress, evmWallet, asset: 'usdt0'|'fxrp', amountBase, amountXrpForMint, region?, walletId? }
 * Withdraws an ISO asset and moves it PA→EVM in ONE atomic 0xFE userOp. Covers:
 *  - protection step 3+4 (asset='usdt0' → repay via /a1/prepare next),
 *  - DERISK step 1 (asset='usdt0') and DERISK step 3 (asset='fxrp', after full repay).
 */
router.post('/pa-withdraw-transfer/prepare', async (req: Request, res: Response) => {
  try {
    const { xrplAddress, evmWallet, asset, amountBase, amountXrpForMint, unmintToXrpl, keepInPa, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        xrplAddress?: string;
        evmWallet?: string;
        asset?: 'usdt0' | 'fxrp';
        amountBase?: string | number;
        amountXrpForMint?: number | string;
        /** true = la última pierna redime a XRP NATIVO hacia la wallet XRPL
         *  dueña del PA, en vez de transferir el FXRP a una wallet EVM. */
        unmintToXrpl?: boolean;
        /** true = sin pierna de transfer: el activo sale del mercado ISO y se
         *  QUEDA en el propio Personal Account como saldo libre («sacar el
         *  capital del vault a la misma wallet», founder 2026-07-30). Flag
         *  explícito a propósito: un evmWallet ausente por bug sigue siendo
         *  400, nunca un keep silencioso. */
        keepInPa?: boolean;
        region?: string | null;
        walletId?: number;
      };

    if (!xrplAddress || typeof xrplAddress !== 'string') {
      return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
    }
    if (!XRPL_CLASSIC_RE.test(xrplAddress.trim())) {
      return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }
    const wantsUnmint = unmintToXrpl === true;
    if (wantsUnmint && asset !== 'fxrp') {
      return res.status(400).json({ error: 'UNMINT_REQUIRES_FXRP', detail: 'Only FXRP can be redeemed to native XRP.' });
    }
    const wantsKeep = keepInPa === true && !wantsUnmint;
    const evmWalletAddr = wantsUnmint || wantsKeep ? null : safeGetAddress(evmWallet);
    if (!wantsUnmint && !wantsKeep && !evmWalletAddr) {
      return res.status(400).json({ error: 'INVALID_EVM_WALLET' });
    }
    if (asset !== 'usdt0' && asset !== 'fxrp') {
      return res.status(400).json({ error: 'INVALID_ASSET', detail: "asset must be 'usdt0' | 'fxrp'" });
    }
    let amount: bigint;
    try {
      amount = BigInt(amountBase as string | number);
    } catch {
      return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'amountBase must be integer base units' });
    }
    if (amount <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) return res.status(400).json({ error: 'INVALID_MINT_AMOUNT' });

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const k = getProtocolAddresses().kinetic;
    const provider = flareProvider();
    const adapter = new KineticAdapter();

    let token: string;
    let withdrawBatch;
    if (asset === 'usdt0') {
      if (!k.isoKUsdt0) return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED', detail: 'Set KINETIC_KUSDT0_ISO' });
      token = await resolveIsoUsdt0Underlying(provider, k.isoKUsdt0!);
      withdrawBatch = await adapter.buildIsoWithdrawUsdt0({ amountUsdt0: amount });
    } else {
      const fxrpToken = getProtocolAddresses().fxrp.token;
      if (!k.isoKFxrp || !fxrpToken) {
        return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED', detail: 'Set KINETIC_KFXRP_ISO, FXRP_TOKEN' });
      }
      token = fxrpToken;
      withdrawBatch = await adapter.buildIsoWithdrawFxrp({ amountFxrp: amount });
    }

    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));

    // Última pierna del batch: transfer al EVM del usuario (camino clásico) o
    // redención a XRP NATIVO hacia la wallet XRPL DUEÑA (unmint atómico — el
    // importe es determinista: lo que el redeem del ISO libera + el FXRP del
    // propio dispatch, barrido sin polvo). El pre-read de params ocurre SOLO
    // en la variante unmint (el camino clásico no lo necesita).
    let redeemTotalUBA = 0n;
    let minRedeemUBA: bigint | null = null;
    let unmintParams: Awaited<ReturnType<typeof readDirectMintParams>> | undefined;
    if (wantsUnmint) {
      unmintParams = await readDirectMintParams(provider);
      redeemTotalUBA = amount + computeNetMint(grossXrpDrops, unmintParams).netToPersonalAccountUBA;
      minRedeemUBA = await readMinimumRedeemAmountUBA(provider);
      if (minRedeemUBA != null && redeemTotalUBA < minRedeemUBA) {
        return res.status(400).json({
          error: 'AMOUNT_BELOW_MINIMUM_REDEEM',
          detail: `Minimum redemption is ${Number(minRedeemUBA) / DROPS} XRP (withdrawn + this dispatch's mint = ${Number(redeemTotalUBA) / DROPS}).`,
          minimumXrp: Number(minRedeemUBA) / DROPS,
        });
      }
    }
    const lastLeg = wantsUnmint
      ? await buildRedeemToXrplCall(provider, { amountUBA: redeemTotalUBA, xrplDestination: xrplAddress.trim() })
      : wantsKeep
        ? null // keep-in-PA: the ISO redeem alone — the asset stays as free PA balance
        : await buildErc20TransferCall({ token, to: evmWalletAddr!, amount });
    const inner = lastLeg ? [...withdrawBatch, lastLeg] : [...withdrawBatch]; // [redeemUnderlying, (transfer|redeemAmount)?] — atomic
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress,
        grossXrpDrops,
        innerCalls: inner,
        walletId: Number(walletId) || 0,
        supersedePendingNonce: wantsSupersede(req),
        action: wantsUnmint ? 'pa-withdraw-transfer:fxrp->xrpl' : wantsKeep ? `pa-withdraw-keep:${asset}` : `pa-withdraw-transfer:${asset}`,
      },
      unmintParams ? { params: unmintParams } : undefined,
    );

    // Invariant #11 — dry-run BOTH rails (mirror of pa-repay). The redeem acts
    // on the PA's CURRENT supply, so it is verifiable today — including the
    // protocol's own guard (an FXRP collateral redeem with debt outstanding
    // returns a Compound error BEFORE anyone signs, the exact DERISK-order
    // mistake). The transfer moves what the redeem just released → 'unverified'.
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddress.trim()),
      await preflightEvmCalls(provider, handoff.personalAccount, [
        {
          to: withdrawBatch[0].to,
          data: withdrawBatch[0].calldata,
          value: withdrawBatch[0].value,
          label: `withdraw ${asset.toUpperCase()} from ISO`,
          compoundErrorCode: true,
        },
        ...(lastLeg
          ? [
              {
                to: lastLeg.to,
                data: lastLeg.calldata,
                value: lastLeg.value,
                label: wantsUnmint ? 'redeem FXRP → native XRP' : `transfer ${asset.toUpperCase()} → EVM wallet`,
                dependsOnPrior: true,
              },
            ]
          : []),
      ]),
    );

    return res.json({
      rail: 'xrpl',
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      disclosure: {
        action: wantsUnmint ? 'withdraw-fxrp-unmint' : wantsKeep ? `withdraw-${asset}-keep` : `withdraw-${asset}-transfer`,
        asset,
        token,
        amount: Number(amount) / DROPS,
        ...(wantsUnmint
          ? {
              xrplDestination: xrplAddress.trim(),
              destinationIsOwner: true,
              fxrpRedeemed: Number(redeemTotalUBA) / DROPS,
              redeemMinimumXrp: minRedeemUBA != null ? Number(minRedeemUBA) / DROPS : null,
            }
          : wantsKeep
            ? { keepsInPersonalAccount: true }
            : { evmWallet: evmWalletAddr }),
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(handoff.net),
        fxrpMintedSideEffect: Number(handoff.net.netToPersonalAccountUBA) / DROPS,
        disclosedToUser: true,
        astryumSigns: false,
        note: wantsUnmint
          ? `Withdraws ${Number(amount) / DROPS} FXRP from the Kinetic ISO market and redeems it — plus the ${Number(handoff.net.netToPersonalAccountUBA) / DROPS} FXRP this very dispatch mints — to NATIVE XRP, all in one atomic 0xFE userOp you sign in Xaman. The FAssets agent pays the XRP (minus the protocol redemption fee) to the XRPL wallet that OWNS this Smart Account; the burn is immediate at execution, the XRP arrives after (minutes to hours). DERISK order still applies: withdraw USDT0 → repay in full → only then withdraw FXRP. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.`
          : wantsKeep
            ? `Withdraws ${asset.toUpperCase()} from the Kinetic ISO market and KEEPS it in your Personal Account (Smart Account) as free balance — no transfer out, one atomic 0xFE userOp you sign in Xaman. Mint-coupled: also mints a small FXRP into your PA. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.`
            : `Withdraws ${asset.toUpperCase()} from the Kinetic ISO market and transfers it from your Personal Account to your EVM wallet, in one atomic 0xFE userOp you sign in Xaman. Mint-coupled: also mints a small FXRP into your PA. Protection: follow with the EVM-direct repay (/a1/prepare). DERISK order: withdraw USDT0 → repay in full → withdraw FXRP. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.`,
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    if (repliedAmountBelowMintFees(res, e)) return;
    return res.status(500).json({ error: 'PA_WITHDRAW_TRANSFER_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/pa-repay/prepare
 * Body: { xrplAddress, mode?: 'restore'|'full'|'fixed', targetHF?, amountUsdt0Base?,
 *         amountXrpForMint, region?, walletId? }
 *
 * PA-NATIVE protection repay (pieza 1, 2026-07-25) — the walletless leg: repays
 * the Personal Account's USDT0 debt entirely INSIDE the PA as one atomic 0xFE
 * userOp signed in Xaman (executor-paid gas, no EVM wallet involved):
 *   [ redeemUnderlying(shortfall)?, approve, repayBorrowBehalf(PA, X) ]
 * Funding order: the PA's free USDT0 first, then the ISO carry supply — the
 * redeem-then-repay order is the DERISK-validated sequence (supplied USDT0
 * withdraws freely with debt outstanding; only FXRP collateral is blocked).
 * If both fall short (carry spread), it repays what the PA holds and DISCLOSES
 * the remainder — never a Payment doomed to revert. Modes mirror A1: 'restore'
 * (live minimum to targetHF), 'full', 'fixed'. Mint-coupled like every 0xFE
 * dispatch; fees + side-mint disclosed. Astryum builds unsigned and STOPS —
 * the user signs in Xaman (invariants #1/#6/#8).
 */
router.post('/pa-repay/prepare', async (req: Request, res: Response) => {
  try {
    const { xrplAddress, mode = 'restore', targetHF = 1.1, amountUsdt0Base, pctOfDebt, amountXrpForMint, fill, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        xrplAddress?: string;
        mode?: 'restore' | 'full' | 'fixed' | 'pct';
        targetHF?: number;
        amountUsdt0Base?: string | number;
        /** mode 'pct' (escalonado): % de la deuda VIVA a repagar (0 < pct ≤ 100). */
        pctOfDebt?: number;
        amountXrpForMint?: number | string;
        /** SWAP-FILL (doc 2026-07-26, variante A) — rail walletless: si al PA le
         *  falta USDT0, la Call de swap FXRP→USDT0 (exactOutput, SparkDEX) va
         *  DENTRO del mismo userOp 0xFE que el usuario firma en Xaman. El pool
         *  hace de tercero trustless; el executor sigue solo con gatillo+gas. */
        fill?: { asset?: string };
        region?: string | null;
        walletId?: number;
      };

    if (!xrplAddress || typeof xrplAddress !== 'string') {
      return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS' });
    }
    const xrplAddr = xrplAddress.trim();
    if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    if (mode !== 'restore' && mode !== 'full' && mode !== 'fixed' && mode !== 'pct') {
      return res.status(400).json({ error: 'INVALID_MODE', detail: "mode must be 'restore' | 'full' | 'fixed' | 'pct'" });
    }
    if (mode === 'pct' && !(Number(pctOfDebt) > 0 && Number(pctOfDebt) <= 100)) {
      return res.status(400).json({ error: 'INVALID_PCT', detail: 'pctOfDebt must be 0 < pct ≤ 100' });
    }
    const fillAssetReq = fill?.asset == null ? null : String(fill.asset).toUpperCase();
    if (fillAssetReq !== null && fillAssetReq !== 'FXRP') {
      return res.status(400).json({
        error: 'INVALID_FILL_ASSET',
        detail: "En el rail PA el fill solo puede ser 'FXRP' (el PA no tiene FLR nativo; su gas lo pone el executor).",
      });
    }
    if (!isPositiveFinite(Number(targetHF))) return res.status(400).json({ error: 'INVALID_TARGET_HF' });
    let fixedAmount: bigint | null = null;
    if (mode === 'fixed') {
      try {
        fixedAmount = BigInt(amountUsdt0Base as string | number);
      } catch {
        return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'amountUsdt0Base must be integer base units' });
      }
      if (fixedAmount <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    }
    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) return res.status(400).json({ error: 'INVALID_MINT_AMOUNT' });

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const k = getProtocolAddresses().kinetic;
    if (!k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0) {
      return res.status(503).json({
        error: 'ISO_MARKET_NOT_CONFIGURED',
        detail: 'Set KINETIC_ISO_COMPTROLLER, KINETIC_KFXRP_ISO, KINETIC_KUSDT0_ISO',
      });
    }

    const provider = flareProvider();
    const personalAccount = await resolvePersonalAccount(provider, xrplAddr);

    // LIVE STATE — fresh at prepare time (the honest input for a protection
    // action; a trigger-time snapshot could be minutes stale by signature).
    const kTokenAbi = [
      'function balanceOfUnderlying(address) returns (uint256)',
      'function borrowBalanceCurrent(address) returns (uint256)',
    ];
    const kFxrp = new ethers.Contract(k.isoKFxrp, kTokenAbi, provider);
    const kUsdt0 = new ethers.Contract(k.isoKUsdt0, kTokenAbi, provider);
    const comptroller = new ethers.Contract(
      k.isoComptroller,
      ['function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)'],
      provider,
    );
    const usdt0Token = await resolveIsoUsdt0Underlying(provider, k.isoKUsdt0!);
    const [supplyRaw, debtRaw, suppliedUsdt0Raw, market, freeRaw] = await Promise.all([
      kFxrp.balanceOfUnderlying.staticCall(personalAccount),
      kUsdt0.borrowBalanceCurrent.staticCall(personalAccount),
      kUsdt0.balanceOfUnderlying.staticCall(personalAccount),
      comptroller.markets(k.isoKFxrp),
      erc20BalanceOf(provider, usdt0Token, personalAccount),
    ]);
    const supply = BigInt(supplyRaw);
    const debt = BigInt(debtRaw);
    const suppliedUsdt0 = BigInt(suppliedUsdt0Raw);
    const free = freeRaw ?? 0n;

    if (debt <= 0n) {
      return res.json({
        rail: 'xrpl',
        needed: false,
        personalAccount,
        disclosure: {
          action: 'pa-repay',
          mode,
          needed: false,
          disclosedToUser: true,
          astryumSigns: false,
          note: 'No outstanding USDT0 debt on the Personal Account — nothing to repay.',
        },
      });
    }
    if (!market[0]) return res.status(502).json({ error: 'KFXRP_ISO_NOT_LISTED' });
    const collateralFactor = Number(market[1]) / MANTISSA;

    // Clean rejection for a position whose shape is NOT the assumed carry
    // (USDT0 debt without an FXRP collateral leg): the restore math NEEDS the
    // collateral to compute HF and would throw ISO_MATH_BAD_SUPPLY → an
    // unexplained 500. Name the shape and the way out instead.
    if (mode === 'restore' && supply <= 0n) {
      return res.status(409).json({
        error: 'UNSUPPORTED_POSITION_SHAPE',
        detail:
          'Este Personal Account tiene deuda USDT0 pero ninguna pierna de colateral FXRP en el mercado ISO — ' +
          "el modo 'restore' necesita el colateral para calcular el Health Factor. Usa mode 'full' o 'fixed'.",
      });
    }

    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });

    // REPAY AMOUNT — A1's math over the user's parameter (invariant #8).
    let repayBase: bigint;
    let currentHF: number | null = null;
    if (mode === 'fixed') {
      repayBase = fixedAmount! > debt ? debt : fixedAmount!;
    } else if (mode === 'pct') {
      // Escalonado: % de la deuda VIVA ahora — nunca un importe congelado.
      repayBase = (debt * BigInt(Math.round(Number(pctOfDebt) * 100))) / 10_000n;
      if (repayBase <= 0n) {
        return res.json({
          rail: 'xrpl',
          needed: false,
          personalAccount,
          disclosure: {
            action: 'pa-repay',
            mode,
            needed: false,
            disclosedToUser: true,
            astryumSigns: false,
            note: `${pctOfDebt}% of the live debt rounds to 0 USDT0 — nothing to repay.`,
          },
        });
      }
    } else {
      const restore = computeRepayToRestoreHF({
        supplyUBA: supply,
        debtUsdt0Base: debt,
        fxrpPriceUSD,
        collateralFactor,
        targetHF: Number(targetHF),
      });
      currentHF = restore.currentHF;
      if (mode === 'restore' && !restore.needed) {
        return res.json({
          rail: 'xrpl',
          needed: false,
          personalAccount,
          disclosure: {
            action: 'pa-repay',
            mode,
            needed: false,
            currentHF: restore.currentHF,
            targetHF: Number(targetHF),
            fxrpPriceUSD,
            disclosedToUser: true,
            astryumSigns: false,
            note: `Health factor ${restore.currentHF.toFixed(3)} is already at/above the target ${Number(targetHF)}; no repay needed.`,
          },
        });
      }
      repayBase = mode === 'full' ? debt : restore.repayUsdt0Base;
    }

    // FUNDING — free USDT0 first, then the carry supply; cap at what exists.
    // SWAP-FILL (variante A, doc 2026-07-26): si libre+supply no llegan, el
    // hueco se compra con el FXRP LIBRE del propio PA — la Call de swap
    // exactOutput va DENTRO del mismo userOp 0xFE que el usuario firma en
    // Xaman. Principal PA→pool→PA; el executor sigue solo con gatillo+gas.
    const accrualBuffer = debt / 2000n > 100n ? debt / 2000n : 100n;
    const available = free + suppliedUsdt0;
    const neededInPa = mode === 'full' ? debt + accrualBuffer : repayBase;
    const gapBase = neededInPa > available ? neededInPa - available : 0n;
    let fillOptions: FillOption[] = [];
    let fillApplied: FillOption | null = null;
    let fillCalls: FillCall[] = [];

    if (gapBase > 0n && swapFillEnabled()) {
      fillOptions = await quoteFillOptions(provider, {
        holder: personalAccount,
        gapUsdt0Base: gapBase,
        usdt0Token,
        assets: ['FXRP'],
      });
      if (fillAssetReq === 'FXRP') {
        const opt = fillOptions.find((o) => o.asset === 'FXRP') ?? null;
        if (!opt) {
          return res.status(409).json({
            error: 'FILL_NO_ROUTE',
            detail: 'Ningún pool de SparkDEX cotiza FXRP→USDT0 para este importe.',
          });
        }
        if (!opt.sufficient) {
          return res.status(409).json({
            error: 'FILL_INSUFFICIENT_BALANCE',
            detail: `El PA no tiene FXRP libre suficiente para el fill (máx ${ethers.formatUnits(opt.amountInMax, opt.tokenInDecimals)} FXRP).`,
          });
        }
        fillApplied = opt;
        fillCalls = buildFillSwapCalls({
          quote: opt,
          usdt0Token,
          amountOutBase: gapBase,
          recipient: personalAccount,
        });
      }
    }

    if (fillApplied == null && available <= 0n) {
      if (fillOptions.length > 0) {
        // Hay hueco y hay ruta: responde las opciones para que el usuario ELIJA
        // (§4b) — el re-prepare con fill.asset construye el userOp completo.
        return res.json({
          rail: 'xrpl',
          needed: true,
          personalAccount,
          fill: serializeFill({ enabled: true, gapBase, options: fillOptions, applied: null, required: true }),
          disclosure: {
            action: 'pa-repay',
            mode,
            needed: true,
            fillRequired: true,
            debtUsdt0: Number(debt) / DROPS,
            disclosedToUser: true,
            astryumSigns: false,
            note: 'El PA no tiene USDT0 (libre ni suppliado), pero el hueco se puede comprar con el FXRP libre del propio PA — un swap dentro del mismo userOp que firmas en Xaman. Elige el fill y vuelve a preparar.',
          },
        });
      }
      return res.status(409).json({
        error: 'NO_USDT0_IN_PA',
        detail:
          'The Personal Account holds no USDT0 (free or supplied) to repay with. Top it up or use the EVM-direct repay (/a1/prepare).',
      });
    }
    const partial = fillApplied == null && available < repayBase;
    if (partial) repayBase = available;
    // Con fill aplicado, del PA sale TODO lo disponible (libre + supply entero)
    // y el swap aporta exactamente el hueco restante.
    const withdrawNeeded = fillApplied ? suppliedUsdt0 : repayBase > free ? repayBase - free : 0n;

    // Con fill y mode 'full': uint(-1) — el contrato pulla la deuda VIVA del
    // bloque en que el executor ejecuta (verificado en CErc20Delegate); approve
    // FINITO deuda+colchón. El blanco móvil no puede dejar polvo.
    const useMaxRepay = fillApplied != null && mode === 'full';
    const adapter = new KineticAdapter();
    const repayCalls = await adapter.buildIsoRepayBehalfBatch({
      borrower: personalAccount,
      repayUsdt0: useMaxRepay ? ethers.MaxUint256 : repayBase,
      usdt0Token,
      ...(useMaxRepay ? { approveUsdt0: debt + accrualBuffer } : {}),
    });
    const withdrawCalls = withdrawNeeded > 0n ? await adapter.buildIsoWithdrawUsdt0({ amountUsdt0: withdrawNeeded }) : [];
    const batch = [...withdrawCalls, ...fillCalls.map((c) => ({ to: c.to, calldata: c.calldata, value: c.value })), ...repayCalls];

    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));
    const handoff = await buildDirectMintHandoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      innerCalls: batch,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
      action: 'pa-repay',
    });

    // Invariant #11 — dry-run BOTH rails of this hand-off: the XRPL Payment
    // the user signs (funds/reserve) AND the inner 0xFE batch the PA will run.
    // The inner calls act on the PA's CURRENT supply/balance, so they are
    // verifiable today — except the repay when it is funded by the withdraw of
    // this same batch. Batch: [redeemUnderlying?]  + [approve, repayBorrowBehalf].
    const hasWithdraw = withdrawNeeded > 0n;
    const innerLabels: string[] = [
      ...(hasWithdraw ? ['withdraw USDT0 from supply'] : []),
      ...(fillApplied ? ['approve FXRP → SparkDEX (fill)', 'swap FXRP → USDT0 exactos (fill)'] : []),
      'approve USDT0',
      'repay USDT0 debt',
    ];
    const swapIdx = fillApplied ? (hasWithdraw ? 2 : 1) : -1;
    const innerAnnotated: EvmPreflightCall[] = batch.map((a, i) => {
      const isRepay = i === batch.length - 1;
      return {
        to: a.to,
        data: a.calldata,
        value: a.value,
        label: innerLabels[i] ?? `step ${i + 1}`,
        compoundErrorCode: isRepay || (hasWithdraw && i === 0),
        // repay: financiado por withdraw/swap previos · swap: necesita el approve
        // FXRP de este mismo batch — un staticCall suelto revertiría en falso.
        dependsOnPrior: isRepay || i === swapIdx,
      };
    });
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddr),
      await preflightEvmCalls(provider, handoff.personalAccount, innerAnnotated),
    );

    const repaidPlanned = useMaxRepay ? debt : repayBase;
    const repayHuman = Number(repaidPlanned) / DROPS;
    const gapHuman = Number(gapBase) / DROPS;

    // ANTES → DESPUÉS (§4b) — números del prepare, peor caso en el gasto del fill.
    const debtAfter = debt - repaidPlanned;
    const collateralUsdPa = (Number(supply) / DROPS) * fxrpPriceUSD * collateralFactor;
    const hfBefore = currentHF ?? (debt > 0n && supply > 0n ? collateralUsdPa / (Number(debt) / DROPS) : null);
    const paUsdt0AfterRaw = available + (fillApplied ? gapBase : 0n) - repaidPlanned;
    const paUsdt0After = paUsdt0AfterRaw < 0n ? 0n : paUsdt0AfterRaw;
    const beforeAfter = {
      debtUsdt0: { before: Number(debt) / DROPS, after: Number(debtAfter) / DROPS },
      healthFactor: { before: hfBefore, after: debtAfter <= 0n ? null : collateralUsdPa / (Number(debtAfter) / DROPS) }, // null = ∞
      paUsdt0FreePlusSupplied: { before: Number(available) / DROPS, after: Number(paUsdt0After) / DROPS },
      ...(fillApplied
        ? {
            fillAsset: {
              asset: 'FXRP',
              before: fillApplied.balance == null ? null : Number(ethers.formatUnits(fillApplied.balance, 6)),
              spendMax: Number(ethers.formatUnits(fillApplied.amountInMax, 6)),
              after: fillApplied.balance == null ? null : Number(ethers.formatUnits(fillApplied.balance - fillApplied.amountInMax, 6)),
              note: 'peor caso: el swap gasta como MÁXIMO el tope disclosed; lo no gastado se queda en el PA',
            },
          }
        : {}),
      note: 'Con los precios/tasas de AHORA — el interés devenga hasta que el executor ejecuta.',
    };

    return res.json({
      rail: 'xrpl',
      needed: true,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      ...(gapBase > 0n || fillApplied
        ? { fill: serializeFill({ enabled: swapFillEnabled(), gapBase, options: fillOptions, applied: fillApplied, required: false }) }
        : {}),
      disclosure: {
        action: 'pa-repay',
        mode,
        ...(currentHF !== null ? { currentHF } : {}),
        ...(mode === 'restore' ? { targetHF: Number(targetHF) } : {}),
        fxrpPriceUSD,
        collateralFactor,
        debtUsdt0: Number(debt) / DROPS,
        repayUsdt0: repayHuman,
        fromFreeBalanceUsdt0: Number(fillApplied ? free : repayBase - withdrawNeeded) / DROPS,
        withdrawnFromSupplyUsdt0: Number(withdrawNeeded) / DROPS,
        ...(fillApplied ? { fillBoughtUsdt0: gapHuman } : {}),
        remainingDebtUsdt0: Number(debt - repaidPlanned) / DROPS,
        partial,
        beforeAfter,
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(handoff.net),
        fxrpMintedSideEffect: Number(handoff.net.netToPersonalAccountUBA) / DROPS,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          `Repays ${repayHuman} USDT0 of the Personal Account's debt entirely inside the PA — one atomic 0xFE userOp you sign in Xaman; the executor pays the Flare gas. Funding: the PA's free USDT0 first, then a withdrawal from your ISO carry supply.` +
          (fillApplied
            ? ` Fill: faltaban ${gapHuman} USDT0 — se compran con el FXRP LIBRE del propio PA (swap exactOutput en SparkDEX, tope ${Number(ethers.formatUnits(fillApplied.amountInMax, 6)).toFixed(6)} FXRP, slippage máx ${fillSlippagePct()}% disclosed) dentro del MISMO userOp. El principal viaja PA→pool→PA; el executor solo dispara.` +
              (useMaxRepay
                ? ' El repay usa uint(-1): el contrato cobra la deuda VIVA exacta del bloque de ejecución — cierre al 100%, sin polvo.'
                : '')
            : '') +
          (mode === 'restore'
            ? ` Restore amount computed AT THE CURRENT FTSO price ($${fxrpPriceUSD.toFixed(4)}) — not a promised HF: if the price keeps falling, the resulting HF will be lower and the rule can fire again.`
            : '') +
          (partial
            ? ` Carry-spread shortfall: the PA holds less USDT0 than the requested repay — this repays everything available and ${(Number(debt - repayBase) / DROPS).toFixed(6)} USDT0 of debt remains (top up later or use /a1/prepare from an EVM wallet).` +
              (fillOptions.length > 0
                ? ' Alternativa: pide el fill FXRP y el mismo userOp cierra el importe completo comprando el hueco.'
                : '')
            : '') +
          ' Mint-coupled: the XRP paid also mints a small FXRP into your PA. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault. Safety net: the EVM-direct repay (A1) does not depend on the executor.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    if (repliedAmountBelowMintFees(res, e)) return;
    return res.status(500).json({ error: 'PA_REPAY_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* PA-UNMINT — la vuelta a XRP nativo del usuario insignia (walletless)      */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/handoff/release
 * Body: { memoHex }
 * Libera el asiento de nonce de un handoff 0xFE preparado y NO firmado (el
 * usuario canceló o cerró sin firmar) → lo marca 'superseded' al instante para
 * que pueda preparar otro sin esperar al TTL. Solo toca filas 'queued'; jamás
 * vuelve inejecutable una firmada (el executor la resuelve por hash). No
 * mintea, no mueve nada, idempotente. Cubre TODAS las acciones del PA porque
 * todas comparten el mismo handoff 0xFE.
 */
router.post('/handoff/release', async (req: Request, res: Response) => {
  const memoHex =
    typeof (req.body as { memoHex?: unknown })?.memoHex === 'string'
      ? (req.body as { memoHex: string }).memoHex.trim()
      : '';
  if (!memoHex) return res.status(400).json({ error: 'MISSING_MEMO' });
  try {
    const { releaseQueuedHandoffByMemo } = await import('../services/flare/DirectMintHandoffStore');
    return res.json({ released: await releaseQueuedHandoffByMemo(memoHex) });
  } catch (e) {
    return res.status(500).json({ error: 'HANDOFF_RELEASE_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * GET /api/flare-demo/pa-fxrp/:owner
 * FXRP LIBRE de una cuenta Flare (el PA normalmente) — lo que el unmint puede
 * redimir sin tocar posiciones. Read-only, dato público on-chain, sin auth.
 */
router.get('/pa-fxrp/:owner', async (req: Request, res: Response) => {
  const owner = safeGetAddress(req.params.owner);
  if (!owner) return res.status(400).json({ error: 'INVALID_ADDRESS' });
  try {
    const provider = flareProvider();
    const free = await readFxrpBalance(provider, owner);
    const minUBA = await readMinimumRedeemAmountUBA(provider);
    return res.json({
      owner,
      freeFxrpBase: free.toString(),
      freeFxrp: Number(free) / DROPS,
      redeemMinimumXrp: minUBA != null ? Number(minUBA) / DROPS : null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'PA_FXRP_READ_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/pa-unmint/prepare
 * Body: { xrplAddress, amountFxrpBase?, useMax?, xrplDest?, amountXrpForMint,
 *         region?, walletId? }
 *
 * El camino de VUELTA del usuario insignia (asimetría §3d, cerrada 2026-07-26):
 * quema FXRP del Personal Account vía AssetManagerFXRP.redeemAmount dentro de
 * un userOp 0xFE firmado en Xaman, y el agente FAssets paga el XRP nativo a la
 * wallet XRPL DUEÑA del PA (destino por defecto = anti-phishing por
 * construcción; override explícito vía xrplDest). Mint-coupled como todo
 * dispatch: el FXRP del propio Payment SE SUMA a lo redimible. El burn es
 * inmediato al ejecutar; el XRP llega después, menos la fee de redención del
 * protocolo. Si el agente no paga en plazo, la redención se compensa en
 * colateral al PA — y el executor de Astryum queda registrado como executor de
 * la redención (fee 0) para poder reclamar ese default sin otra firma.
 * Astryum construye unsigned y PARA (invariantes #1/#6/#8).
 */
router.post('/pa-unmint/prepare', async (req: Request, res: Response) => {
  try {
    const { xrplAddress, amountFxrpBase, useMax, xrplDest, amountXrpForMint, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        xrplAddress?: string;
        amountFxrpBase?: string | number;
        useMax?: boolean;
        xrplDest?: string;
        amountXrpForMint?: number | string;
        region?: string | null;
        walletId?: number;
      };

    if (!xrplAddress || typeof xrplAddress !== 'string' || !XRPL_CLASSIC_RE.test(xrplAddress.trim())) {
      return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }
    const xrplAddr = xrplAddress.trim();
    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) return res.status(400).json({ error: 'INVALID_MINT_AMOUNT' });
    const dest = typeof xrplDest === 'string' && xrplDest.trim() ? xrplDest.trim() : xrplAddr;
    if (!XRPL_CLASSIC_RE.test(dest)) return res.status(400).json({ error: 'INVALID_XRPL_DESTINATION' });

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const provider = flareProvider();
    const params = await readDirectMintParams(provider);
    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));
    const net = computeNetMint(grossXrpDrops, params);
    const personalAccount = await resolvePersonalAccount(provider, xrplAddr);
    const freeUBA = await readFxrpBalance(provider, personalAccount);
    const availableUBA = freeUBA + net.netToPersonalAccountUBA;

    let amountUBA: bigint;
    if (useMax === true) {
      amountUBA = availableUBA;
    } else {
      try {
        amountUBA = BigInt(amountFxrpBase as string | number);
      } catch {
        return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'amountFxrpBase must be integer base units (or useMax: true)' });
      }
    }
    if (amountUBA <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    if (amountUBA > availableUBA) {
      return res.status(400).json({
        error: 'INSUFFICIENT_FXRP',
        detail: `The Personal Account holds ${Number(freeUBA) / DROPS} free FXRP (+${Number(net.netToPersonalAccountUBA) / DROPS} minted by this dispatch).`,
        availableFxrp: Number(availableUBA) / DROPS,
      });
    }
    const minUBA = await readMinimumRedeemAmountUBA(provider);
    if (minUBA != null && amountUBA < minUBA) {
      return res.status(400).json({
        error: 'AMOUNT_BELOW_MINIMUM_REDEEM',
        detail: `Minimum redemption is ${Number(minUBA) / DROPS} XRP (enforced on-chain by the FAssets protocol).`,
        minimumXrp: Number(minUBA) / DROPS,
        availableFxrp: Number(availableUBA) / DROPS,
      });
    }

    const redeemCall = await buildRedeemToXrplCall(provider, { amountUBA, xrplDestination: dest });
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: xrplAddr,
        grossXrpDrops,
        innerCalls: [redeemCall],
        walletId: Number(walletId) || 0,
        supersedePendingNonce: wantsSupersede(req),
        action: 'pa-unmint',
      },
      { params },
    );

    // Invariant #11 — dry-run BOTH rails. Cuando el redeem necesita el FXRP
    // que ESTE mismo Payment acuña, no es verificable hoy → 'unverified'
    // honesto (mismo criterio que el e1); si el FXRP libre ya alcanza, se
    // verifica de verdad contra el estado actual.
    const ridesOwnMint = amountUBA > freeUBA;
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddr),
      await preflightEvmCalls(provider, handoff.personalAccount, [
        {
          to: redeemCall.to,
          data: redeemCall.calldata,
          value: redeemCall.value,
          label: `redeem ${Number(amountUBA) / DROPS} FXRP → native XRP`,
          dependsOnPrior: ridesOwnMint,
        },
      ]),
    );

    const redemptionExecutor = await resolveRedemptionExecutor();
    return res.json({
      rail: 'xrpl',
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      disclosure: {
        action: 'pa-unmint',
        fxrpRedeemed: Number(amountUBA) / DROPS,
        xrplDestination: dest,
        destinationIsOwner: dest === xrplAddr,
        redeemMinimumXrp: minUBA != null ? Number(minUBA) / DROPS : null,
        redemptionExecutor:
          redemptionExecutor !== '0x0000000000000000000000000000000000000000' ? redemptionExecutor : null,
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(net),
        fxrpMintedSideEffect: Number(net.netToPersonalAccountUBA) / DROPS,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          `Burns ${Number(amountUBA) / DROPS} FXRP from your Personal Account via AssetManagerFXRP.redeemAmount, as one 0xFE userOp you sign in Xaman. The FAssets agent then pays the XRP (minus the protocol redemption fee) to ${dest === xrplAddr ? 'the XRPL wallet that OWNS this Smart Account' : `the XRPL address you chose (${dest})`} — the burn is immediate at execution, the XRP arrives after (minutes to hours; large requests can be split or partially fulfilled). If an agent misses its payment window, the redemption default process reimburses the Personal Account from the agent's collateral${redemptionExecutor !== '0x0000000000000000000000000000000000000000' ? ", and Astryum's executor is registered as redemption executor (zero fee) so it can claim that default without another signature from you" : ''}. Mint-coupled like every dispatch: the XRP you pay here mints FXRP into the PA first and counts toward what you redeem. Astryum builds this unsigned and STOPS — you sign in Xaman; Astryum never signs, never custodies, never broadcasts.`,
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    if (repliedAmountBelowMintFees(res, e)) return;
    return res.status(500).json({ error: 'PA_UNMINT_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* ISO actions for WALLET-HELD positions (EVM-direct rail)                   */
/*                                                                           */
/* The E1 EVM-direct entry leaves the ISO position on the user's OWN EVM     */
/* wallet — not on a Personal Account. The 0xFE routes above can never       */
/* reach it (they resolve a PA from Xaman); these two hand the SAME adapter  */
/* batches to the holding wallet as plain unsigned EVM calls.                */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/iso-withdraw/prepare
 * Body: { evmAddress, asset: 'usdt0'|'fxrp', amountBase, region? }
 * Withdraw an ISO asset when the position is HELD BY THE WALLET itself
 * (EVM-direct entries). One unsigned redeemUnderlying call; the funds land
 * in the caller. FXRP collateral redeems revert while debt would go
 * under-collateralised — same protocol rule as the PA rail.
 */
/**
 * GET /api/flare-demo/iso-legs/:owner
 * The LIVE Kinetic ISO legs of one account (FXRP supplied, USDT0 supplied,
 * USDT0 debt), read from the chain NOW. The withdraw modal calls this on open
 * so the balance it shows is never a stale snapshot — a cached snapshot
 * without the iso flag made real supplies look unwithdrawable (2026-07-14).
 * Read-only; no auth; no side effects (monitoring is always available).
 */
router.get('/iso-legs/:owner', async (req: Request, res: Response) => {
  try {
    const owner = safeGetAddress(req.params.owner);
    if (!owner) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const k = getProtocolAddresses().kinetic;
    if (!k.isoKFxrp || !k.isoKUsdt0) {
      return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED' });
    }
    const legs = await new KineticAdapter().readIsoLegs(owner, flareProvider());

    // Net APY de la posición (founder 2026-07-25 — la métrica que faltaba):
    // rendimiento del supply (FXRP base on-chain + recompensas WFLR de
    // DeFiLlama, mismas fuentes que /yields; + el USDT0 re-suppliado a su
    // propia tasa) MENOS el coste del borrow, sobre el equity. Best-effort:
    // sin tasas o sin precio, `economics` va null y la card no pinta el
    // bloque — jamás un número inventado (#9). "Con las tasas actuales",
    // nunca una promesa.
    let economics: Record<string, unknown> | null = null;
    try {
      const { readSupplyAprs, readBorrowAprs } = await import('../services/flare/MarketRatesService');
      const [sup, bor, pools, priceProvider] = await Promise.all([
        readSupplyAprs([k.isoKFxrp!, k.isoKUsdt0!]),
        readBorrowAprs([k.isoKUsdt0!]),
        loadLlamaFlarePools().catch(() => new Map<string, RawLlamaPool>()),
        createFTSOPriceProvider(),
      ]);
      const baseAprPct = sup[k.isoKFxrp!.toLowerCase()];
      const usdt0SupplyAprPct = sup[k.isoKUsdt0!.toLowerCase()] ?? null;
      const borrowAprPct = bor[k.isoKUsdt0!.toLowerCase()];
      const pool = pools.get(KINETIC_FXRP_LLAMA_POOL);
      const rewardApyPct =
        typeof pool?.apyReward === 'number' && Number.isFinite(pool.apyReward) && pool.apyReward >= 0
          ? pool.apyReward
          : null;
      const xrpUsd = await priceProvider.getPriceUSD('XRP');

      const supplyFxrp = Number(legs.supplyFxrpBase ?? 0) / DROPS;
      const suppliedUsdt0 = Number(legs.suppliedUsdt0Base ?? 0) / DROPS;
      const debtUsdt0 = Number(legs.debtUsdt0Base ?? 0) / DROPS;

      if (baseAprPct != null && borrowAprPct != null && xrpUsd > 0) {
        const supplyApyPct = baseAprPct + (rewardApyPct ?? 0);
        const fxrpUsd = supplyFxrp * xrpUsd;
        const supplyUsd = fxrpUsd + suppliedUsdt0; // USDT0 ≈ $1 (el propio asset de la deuda)
        const debtUsd = debtUsdt0;
        const equityUsd = supplyUsd - debtUsd;
        const yieldUsdYear =
          fxrpUsd * (supplyApyPct / 100) + suppliedUsdt0 * ((usdt0SupplyAprPct ?? 0) / 100);
        const costUsdYear = debtUsd * (borrowAprPct / 100);
        const netApyPct = equityUsd > 0 ? ((yieldUsdYear - costUsdYear) / equityUsd) * 100 : null;
        economics = {
          xrpUsd,
          supplyApyPct,
          baseAprPct,
          rewardApyPct,
          usdt0SupplyAprPct,
          borrowAprPct,
          supplyUsd,
          debtUsd,
          equityUsd,
          yieldUsdYear,
          costUsdYear,
          netApyPct,
          sources:
            'supplyRatePerTimestamp/borrowRatePerTimestamp (on-chain) + DeFiLlama apyReward (WFLR) + FTSO XRP/USD',
          note: 'Con las tasas actuales — no es una promesa ni una oferta de Astryum.',
        };
      }
    } catch {
      /* economics = null — la card no pinta el bloque */
    }

    return res.json({
      owner,
      ...legs,
      economics,
      source: 'live on-chain (balanceOfUnderlying / borrowBalanceCurrent)',
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'ISO_LEGS_FAILED', detail: safeErrorDetail(e) });
  }
});

router.post('/iso-withdraw/prepare', async (req: Request, res: Response) => {
  try {
    const { evmAddress, asset, amountBase, all = false, region = null } = (req.body ?? {}) as {
      evmAddress?: string;
      asset?: 'usdt0' | 'fxrp';
      amountBase?: string | number;
      /** true = EXACT full exit: redeem by kToken shares (interest included). */
      all?: boolean;
      region?: string | null;
    };

    const evmAddr = safeGetAddress(evmAddress);
    if (!evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    if (asset !== 'usdt0' && asset !== 'fxrp') {
      return res.status(400).json({ error: 'INVALID_ASSET', detail: "asset must be 'usdt0' | 'fxrp'" });
    }
    let amount = 0n;
    if (!all) {
      try {
        amount = BigInt(amountBase as string | number);
      } catch {
        return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'amountBase must be integer base units' });
      }
      if (amount <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    }

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const k = getProtocolAddresses().kinetic;
    if (asset === 'usdt0' ? !k.isoKUsdt0 : !k.isoKFxrp) {
      return res.status(503).json({ error: 'ISO_MARKET_NOT_CONFIGURED' });
    }
    const adapter = new KineticAdapter();

    // LIVE supply of the holder (shares + current underlying, interest
    // accrued on read) — the number the modal shows, and the ceiling the
    // request is validated against so nobody signs a doomed redeem.
    const snapshot = await adapter.readIsoSupplySnapshot(asset, evmAddr, flareProvider());
    const availableHuman = Number(snapshot.underlyingBase) / DROPS;
    if (snapshot.underlyingBase <= 0n) {
      return res.status(409).json({
        error: 'NO_SUPPLY_TO_WITHDRAW',
        holder: evmAddr,
        asset,
        availableBase: '0',
        available: 0,
      });
    }
    if (!all && amount > snapshot.underlyingBase) {
      return res.status(409).json({
        error: 'INSUFFICIENT_SUPPLY',
        holder: evmAddr,
        asset,
        availableBase: snapshot.underlyingBase.toString(),
        available: availableHuman,
        requested: Number(amount) / DROPS,
      });
    }

    // MAX (all) redeems by SHARES — balanceOfUnderlying keeps accruing, so an
    // amount-based MAX always strands dust; the share balance is static and
    // redeem(shares) empties the position to zero, interest included.
    const inner = all
      ? await adapter.buildIsoRedeemSharesBatch({ asset, sharesBase: snapshot.sharesBase })
      : asset === 'usdt0'
        ? await adapter.buildIsoWithdrawUsdt0({ amountUsdt0: amount })
        : await adapter.buildIsoWithdrawFxrp({ amountFxrp: amount });

    const human = all ? availableHuman : Number(amount) / DROPS;
    return res.json({
      rail: 'evm',
      chainId: FLARE_CHAIN_ID,
      account: evmAddr,
      calls: toEvmCalls(inner, [
        all
          ? `Withdraw ALL your ${asset.toUpperCase()} (≈${availableHuman}, interest included) from Kinetic ISO to your wallet`
          : `Withdraw ${human} ${asset.toUpperCase()} from Kinetic ISO to your wallet`,
      ]),
      disclosure: {
        action: `iso-withdraw-${asset}`,
        asset,
        amount: human,
        all,
        availableBase: snapshot.underlyingBase.toString(),
        available: availableHuman,
        sharesRedeemed: all ? Number(snapshot.sharesBase) / DROPS : null,
        holder: evmAddr,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          (all
            ? `Withdraws your ENTIRE ${asset.toUpperCase()} supply from the Kinetic ISO market by redeeming all ${Number(snapshot.sharesBase) / DROPS} kToken shares — the exact position, interest included; the amount shown is the live estimate and only grows until execution. `
            : `Withdraws ${asset.toUpperCase()} from the Kinetic ISO market. `) +
          `This position is held by your own Flare wallet (EVM-direct entry) — you sign one call and the funds land in that wallet. Withdrawing FXRP collateral while USDT0 debt is open reverts if it would leave the account under-collateralised: repay first (DERISK order).`,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'ISO_WITHDRAW_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/e1-borrow/prepare
 * Body: { evmAddress, borrowRatio?, targetHF?, region? }
 * Completes a HALF-OPEN carry (supply landed, borrow didn't — the sequential
 * signing gap): reads the LIVE FXRP collateral + existing USDT0 debt of the
 * wallet, computes the borrow for the requested ratio against that live
 * collateral, and returns the unsigned [enterMarkets?, borrow] calls.
 */
router.post('/e1-borrow/prepare', async (req: Request, res: Response) => {
  try {
    const { evmAddress, borrowRatio = 0.3, targetHF = 1.1, region = null } = (req.body ?? {}) as {
      evmAddress?: string;
      borrowRatio?: number;
      targetHF?: number;
      region?: string | null;
    };

    const evmAddr = safeGetAddress(evmAddress);
    if (!evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    if (!(Number.isFinite(borrowRatio) && borrowRatio > 0 && borrowRatio <= 1)) {
      return res.status(400).json({ error: 'INVALID_BORROW_RATIO' });
    }
    if (!isPositiveFinite(Number(targetHF))) return res.status(400).json({ error: 'INVALID_TARGET_HF' });

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    const k = getProtocolAddresses().kinetic;
    if (!k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0) {
      return res.status(503).json({
        error: 'ISO_MARKET_NOT_CONFIGURED',
        detail: 'Set KINETIC_ISO_COMPTROLLER, KINETIC_KFXRP_ISO, KINETIC_KUSDT0_ISO',
      });
    }

    // LIVE READS — collateral, debt, membership, price, collateral factor.
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return res.status(502).json({ error: 'FTSO_PRICE_UNAVAILABLE' });

    const comptroller = new ethers.Contract(
      k.isoComptroller,
      [
        'function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)',
        'function checkMembership(address account, address cToken) view returns (bool)',
      ],
      provider,
    );
    const kFxrp = new ethers.Contract(
      k.isoKFxrp,
      ['function balanceOfUnderlying(address owner) returns (uint256)'],
      provider,
    );
    const kUsdt0 = new ethers.Contract(
      k.isoKUsdt0,
      ['function borrowBalanceCurrent(address account) returns (uint256)'],
      provider,
    );
    const [market, supplyUBA, debtNow, isMember] = await Promise.all([
      comptroller.markets(k.isoKFxrp),
      kFxrp.balanceOfUnderlying.staticCall(evmAddr).catch(() => 0n) as Promise<bigint>,
      kUsdt0.borrowBalanceCurrent.staticCall(evmAddr).catch(() => 0n) as Promise<bigint>,
      comptroller.checkMembership(evmAddr, k.isoKFxrp).catch(() => false) as Promise<boolean>,
    ]);
    if (!market[0]) return res.status(502).json({ error: 'KFXRP_ISO_NOT_LISTED' });
    const collateralFactor = Number(market[1]) / MANTISSA;

    if (supplyUBA <= 0n) {
      return res.status(409).json({ error: 'NO_COLLATERAL', detail: 'This wallet has no FXRP supplied in the ISO market' });
    }

    // Borrow up to the ratio against the LIVE collateral, net of existing debt.
    const target = computeBorrowUsdt0({ supplyUBA, fxrpPriceUSD, collateralFactor, borrowRatio });
    const borrowUsdt0 = target.borrowUsdt0Base > debtNow ? target.borrowUsdt0Base - debtNow : 0n;
    if (borrowUsdt0 <= 0n) {
      return res.status(409).json({
        error: 'ALREADY_AT_RATIO',
        detail: 'Existing debt already meets or exceeds the requested borrow ratio',
        debtUsdt0: Number(debtNow) / DROPS,
      });
    }

    const inner = await new KineticAdapter().buildIsoBorrowBatch({
      borrowUsdt0,
      enterMarket: !isMember,
    });

    // Invariant #11 — dry-run before signature. Already a member ⇒ the single
    // borrow call is fully verifiable against TODAY's state (catches an empty
    // market, a paused borrow, a comptroller rejection — for free). With an
    // enterMarkets first, the borrow depends on it and is honestly 'unverified'.
    const preflight = await preflightEvmCalls(
      provider,
      evmAddr,
      inner.map((a, i): EvmPreflightCall => ({
        to: a.to,
        data: a.calldata,
        value: a.value,
        label: inner.length === 2 && i === 0 ? 'enterMarkets' : 'borrow USDT0',
        compoundErrorCode: true,
        dependsOnPrior: inner.length === 2 && i === 1,
      })),
    );

    const totalDebtAfter = debtNow + borrowUsdt0;
    const trigger = computeTriggerPrice({
      supplyUBA,
      borrowUsdt0Base: totalDebtAfter,
      collateralFactor,
      targetHF: Number(targetHF),
    });
    const supplyHuman = Number(supplyUBA) / DROPS;
    const borrowHuman = Number(borrowUsdt0) / DROPS;

    return res.json({
      rail: 'evm',
      chainId: FLARE_CHAIN_ID,
      account: evmAddr,
      calls: toEvmCalls(
        inner,
        inner.length === 2
          ? ['Enable FXRP as collateral (enterMarkets)', `Borrow ${borrowHuman.toFixed(2)} USDT0`]
          : [`Borrow ${borrowHuman.toFixed(2)} USDT0`],
      ),
      preflight,
      a1: {
        triggerPriceUSD: trigger.triggerPriceUSD,
        targetHF: Number(targetHF),
        borrowRatio,
        collateralFactor,
        fxrpPriceUSD,
        supplyUBA: supplyUBA.toString(),
        borrowUsdt0Base: totalDebtAfter.toString(),
      },
      disclosure: {
        action: 'e1-borrow',
        fxrpCollateral: supplyHuman,
        existingDebtUsdt0: Number(debtNow) / DROPS,
        usdt0Borrowed: borrowHuman,
        borrowRatio,
        collateralFactor,
        fxrpPriceUSD,
        entryHF: (supplyHuman * fxrpPriceUSD * collateralFactor) / (Number(totalDebtAfter) / DROPS),
        targetHF: Number(targetHF),
        triggerPriceUSD: trigger.triggerPriceUSD,
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Completes the carry: borrows USDT0 against the FXRP collateral your wallet ALREADY supplied in the Kinetic ISO market. Astryum builds the unsigned calls; you sign in your own Flare wallet. USDT0 borrow is a gated demo exception (non-EU-facing).',
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'E1_BORROW_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* Vault EXIT — instant redemption of the partner-vault shares               */
/* (Firelight stXRP · Upshift earnXRP · Monarq). Mirror of /vault/prepare:   */
/* same two rails, opposite direction.                                       */
/* ----------------------------------------------------------------------- */

/**
 * POST /api/flare-demo/vault-withdraw/prepare
 * Body: { vault: 'firelight'|'earnxrp'|'monarq', sharesBase,
 *         evmAddress? — shares held by the user's EVM wallet (EVM-direct rail),
 *         xrplAddress? + amountXrpForMint + evmDest? — shares held by the
 *         Personal Account (0xFE userOp rail, signed in Xaman),
 *         region?, walletId? }
 *
 * Upshift: vault.instantRedeem(shares, receiver) — burns the LP shares from
 * the caller, FXRP minus the live instantRedemptionFee (bips, disclosed) to
 * the receiver. The fee-free requestRedeem+epoch path is roadmap. Firelight:
 * standard ERC-4626 redeem. Signatures verified against the implementations'
 * verified source on Flarescan (2026-07-13).
 *
 * NOTE deliberately NOT gated by UPSHIFT_MONARQ_ENABLED: that switch guards
 * ENTRIES into the CeDeFi vault; the exit must always be available to a user
 * who already holds shares.
 */
router.post('/vault-withdraw/prepare', async (req: Request, res: Response) => {
  try {
    const { vault, sharesBase, evmAddress, xrplAddress, evmDest, amountXrpForMint, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        vault?: string;
        sharesBase?: string | number;
        evmAddress?: string;
        xrplAddress?: string;
        evmDest?: string;
        amountXrpForMint?: number | string;
        region?: string | null;
        walletId?: number;
      };

    if (vault !== 'firelight' && vault !== 'earnxrp' && vault !== 'monarq') {
      return res.status(400).json({ error: 'INVALID_VAULT', detail: "vault must be 'firelight' | 'earnxrp' | 'monarq'" });
    }
    let shares: bigint;
    try {
      shares = BigInt(sharesBase as string | number);
    } catch {
      return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'sharesBase must be integer base units (6 dec)' });
    }
    if (shares <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS', detail: 'Provide evmAddress (wallet-held shares) or xrplAddress (PA-held shares)' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });

    // Resolve vault + receipt token (never guessed).
    let vaultAddress: string;
    let receiptToken: string;
    let vaultName: string;
    if (vault === 'firelight') {
      const stXrp = getProtocolAddresses().firelight.stXRP;
      if (!stXrp) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FIRELIGHT_STXRP' });
      vaultAddress = stXrp;
      receiptToken = stXrp; // stXRP IS the 4626 vault token
      vaultName = 'Firelight stXRP';
    } else {
      const d = new UpshiftVaultAdapter().getVaultDescriptor(vault);
      if (!d) {
        return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: `Set UPSHIFT_${vault.toUpperCase()}_VAULT / _TOKEN` });
      }
      vaultAddress = d.vault;
      receiptToken = d.lpToken;
      vaultName = d.name;
    }

    // LIVE READS — share price + exit terms + FTSO XRP/USD, all protocol data
    // disclosed before the signature (invariants #6/#9).
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');

    let sharePriceE6: bigint | null = null;
    let instantRedemptionFeeBps: number | null = null;
    let claimPeriod: number | null = null;
    let claimableAt: string | null = null;
    if (vault === 'firelight') {
      const c = new ethers.Contract(vaultAddress, FIRELIGHT_READ_ABI, provider);
      const [sp, cur, end] = await Promise.all([
        c.convertToAssets(1_000_000n).catch(() => null),
        c.currentPeriod().catch(() => null),
        c.currentPeriodEnd().catch(() => null),
      ]);
      sharePriceE6 = sp as bigint | null;
      claimPeriod = cur != null ? Number(cur) : null;
      claimableAt = end != null ? new Date(Number(end) * 1000).toISOString() : null;
    } else {
      const c = new ethers.Contract(vaultAddress, UPSHIFT_READ_ABI, provider);
      const [sp, fee] = await Promise.all([
        c.getSharePrice().catch(() => null),
        c.instantRedemptionFee().catch(() => null),
      ]);
      sharePriceE6 = sp as bigint | null;
      instantRedemptionFeeBps = fee != null ? Number(fee) : null;
    }

    // The account whose shares burn: the EVM wallet (direct rail) or the PA.
    const holder = evmAddr ?? (await resolvePersonalAccount(provider, xrplAddr));
    const balance = await erc20BalanceOf(provider, receiptToken, holder);
    if (balance != null && balance < shares) {
      return res.status(409).json({
        error: 'INSUFFICIENT_SHARES',
        holder,
        balanceShares: Number(balance) / DROPS,
        requestedShares: Number(shares) / DROPS,
      });
    }

    const sharesHuman = Number(shares) / DROPS;
    const grossFxrp = sharePriceE6 != null ? (sharesHuman * Number(sharePriceE6)) / DROPS : null;
    const feeFxrp =
      grossFxrp != null && instantRedemptionFeeBps != null ? (grossFxrp * instantRedemptionFeeBps) / 10_000 : 0;
    const netFxrp = grossFxrp != null ? grossFxrp - feeFxrp : null;

    const disclosureBase = {
      action: 'vault-withdraw',
      vault,
      vaultName,
      vaultAddress,
      receiptToken,
      sharesRedeemed: sharesHuman,
      sharePrice: sharePriceE6 != null ? Number(sharePriceE6) / DROPS : null,
      sharePriceSource:
        vault === 'firelight' ? 'stXRP.convertToAssets(1e6) (live on-chain)' : 'vault.getSharePrice() (live on-chain)',
      instantRedemptionFeeBps,
      instantFeeFxrp: feeFxrp || null,
      estimatedFxrpOut: netFxrp,
      estimatedValueUSD: netFxrp != null && fxrpPriceUSD > 0 ? netFxrp * fxrpPriceUSD : null,
      fxrpPriceUSD: fxrpPriceUSD > 0 ? fxrpPriceUSD : null,
      // Firelight does NOT pay out in the redeem tx (VERIFIED on-chain
      // 2026-07-14): the FXRP queues into the current withdrawal period and is
      // released by claimWithdraw once it ends. Upshift instantRedeem IS
      // immediate. Disclosed before the signature, not discovered after.
      queuedExit:
        vault === 'firelight'
          ? {
              period: claimPeriod,
              claimableAt,
              note: 'redeem burns the stXRP now and queues the FXRP — nothing arrives in this transaction; a Claim on your position releases it once the period ends',
            }
          : null,
      disclosedToUser: true,
      astryumSigns: false,
    };

    // EVM-direct rail — the wallet holds the shares; one unsigned call.
    if (evmAddr) {
      const inner =
        vault === 'firelight'
          ? await new FirelightAdapter().buildRedeemBatch({ sharesUBA: shares, receiver: evmAddr, owner: evmAddr })
          : await new UpshiftVaultAdapter().buildInstantRedeemBatch({ vaultKey: vault, sharesUBA: shares, receiver: evmAddr });
      // Invariant #11 — dry-run before signature (this route lacked it while
      // its sibling prepares all carry one).
      const preflight = await preflightEvmCalls(
        provider,
        evmAddr,
        inner.map((a): EvmPreflightCall => ({ to: a.to, data: a.calldata, value: a.value, label: 'redeem shares' })),
      );
      return res.json({
        rail: 'evm',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        preflight,
        calls: toEvmCalls(inner, [
          vault === 'firelight'
            ? `Redeem ${sharesHuman} stXRP — queues the FXRP; claim it after ${claimableAt ?? 'the period ends'}`
            : `Instant-redeem ${sharesHuman} shares → FXRP to your wallet (fee ${instantRedemptionFeeBps ?? '?'} bps)`,
        ]),
        disclosure: {
          ...disclosureBase,
          note:
            vault === 'firelight'
              ? `Astryum builds this unsigned EVM call; you sign it in your own Flare wallet. IMPORTANT — Firelight pays in TWO steps: this redeem burns your stXRP now and queues the FXRP; NOTHING arrives in this transaction. The FXRP becomes claimable when the current period ends (${claimableAt ?? 'shown on your position'}) and your position keeps showing it with a Claim button until you release it to this wallet.`
              : 'Astryum builds this unsigned EVM call; you sign it in your own Flare wallet. Your vault shares are redeemed and the FXRP lands in that wallet. Instant redemption pays the disclosed bps fee; the fee-free requestRedeem + epoch claim path is roadmap.',
        },
      });
    }

    // XRPL rail — the Personal Account holds the shares; the redeem runs as a
    // 0xFE userOp (mint-coupled, like every PA action) signed in Xaman.
    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) {
      return res.status(400).json({ error: 'INVALID_MINT_AMOUNT', detail: 'amountXrpForMint required (the 0xFE dispatch is mint-coupled)' });
    }
    // FXRP destination: the user's EVM wallet when given, else it stays in the PA.
    const dest = evmDest != null ? safeGetAddress(evmDest) : null;
    if (evmDest != null && !dest) return res.status(400).json({ error: 'INVALID_EVM_DEST' });
    const receiver = dest ?? holder;

    const inner =
      vault === 'firelight'
        ? await new FirelightAdapter().buildRedeemBatch({ sharesUBA: shares, receiver, owner: holder })
        : await new UpshiftVaultAdapter().buildInstantRedeemBatch({ vaultKey: vault, sharesUBA: shares, receiver });
    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));
    const handoff = await buildDirectMintHandoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      innerCalls: inner,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
      action: `vault-withdraw:${vault}`,
    });

    // Invariant #11 — dry-run BOTH rails of the hand-off (mirror of pa-repay).
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddr),
      await preflightEvmCalls(
        provider,
        handoff.personalAccount,
        inner.map((a): EvmPreflightCall => ({ to: a.to, data: a.calldata, value: a.value, label: 'redeem shares' })),
      ),
    );

    return res.json({
      rail: 'xrpl',
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      disclosure: {
        ...disclosureBase,
        fxrpDestination: receiver,
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(handoff.net),
        fxrpMintedSideEffect: Number(handoff.net.netToPersonalAccountUBA) / DROPS,
        note:
          `Redeems your ${vaultName} shares held by your Personal Account, as a 0xFE userOp you sign in Xaman. Mint-coupled: the XRP paid also mints a small FXRP into your PA. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.` +
          (vault === 'firelight'
            ? ` IMPORTANT — Firelight pays in TWO steps: the redeem burns the stXRP now and QUEUES the FXRP; it becomes claimable in your Personal Account when the current period ends (${claimableAt ?? 'shown on your position'}) via the Claim on your position.`
            : ` The FXRP goes to ${dest ? 'your EVM wallet' : 'your Personal Account'}. Instant redemption pays the disclosed bps fee; the fee-free requestRedeem + epoch claim path is roadmap.`),
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'VAULT_WITHDRAW_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* Firelight queued exits — the redeem burns NOW, the FXRP is claimed later  */
/* ----------------------------------------------------------------------- */

/**
 * GET /api/flare-demo/vault-claims/:owner
 * The unclaimed Firelight withdrawal-queue entries of one account. After a
 * redeem the stXRP balance is 0 but the FXRP has NOT arrived — it waits in
 * the vault's period queue. This is the money-in-flight the UI must keep
 * showing (with its Claim) until claimWithdraw releases it. Read-only.
 */
router.get('/vault-claims/:owner', async (req: Request, res: Response) => {
  try {
    const owner = safeGetAddress(req.params.owner);
    if (!owner) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    if (!getProtocolAddresses().firelight.stXRP) {
      return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FIRELIGHT_STXRP' });
    }
    const state = await new FirelightAdapter().readPendingWithdrawals(owner, flareProvider(), 60);
    return res.json({ owner, vault: 'firelight', ...state, checkedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'VAULT_CLAIMS_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * POST /api/flare-demo/vault-claim/prepare
 * Body: { period, evmAddress?, xrplAddress?, amountXrpForMint?, region?, walletId? }
 * Releases a FINISHED Firelight withdrawal period: one unsigned
 * claimWithdraw(period) call — EVM rail when the wallet queued the exit, 0xFE
 * userOp when the Personal Account did. Refuses (409 CLAIM_NOT_READY, with
 * claimableAt) while the period still runs, so nobody signs a doomed call.
 */
router.post('/vault-claim/prepare', async (req: Request, res: Response) => {
  try {
    const { period, evmAddress, xrplAddress, amountXrpForMint, unmintToXrpl, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        period?: number | string;
        evmAddress?: string;
        xrplAddress?: string;
        amountXrpForMint?: number | string;
        /** true (rail PA): el claim se encadena con redeemAmount y el FXRP
         *  liberado sale como XRP NATIVO hacia la wallet XRPL dueña. */
        unmintToXrpl?: boolean;
        region?: string | null;
        walletId?: number;
      };

    const periodNum = Number(period);
    if (!Number.isInteger(periodNum) || periodNum < 0) {
      return res.status(400).json({ error: 'INVALID_PERIOD', detail: 'period must be a non-negative integer' });
    }
    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS', detail: 'Provide evmAddress (wallet-queued exit) or xrplAddress (PA-queued exit)' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });
    if (!getProtocolAddresses().firelight.stXRP) {
      return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FIRELIGHT_STXRP' });
    }

    const provider = flareProvider();
    const holder = evmAddr ?? (await resolvePersonalAccount(provider, xrplAddr));
    const adapter = new FirelightAdapter();
    const { pending } = await adapter.readPendingWithdrawals(holder, provider, 60);
    const entry = pending.find((p) => p.period === periodNum);
    if (!entry) {
      return res.status(409).json({
        error: 'NO_PENDING_CLAIM',
        holder,
        period: periodNum,
        detail: 'nothing queued for this account in that period (or already claimed)',
        pendingPeriods: pending.map((p) => p.period),
      });
    }
    if (!entry.claimable) {
      return res.status(409).json({
        error: 'CLAIM_NOT_READY',
        holder,
        period: periodNum,
        claimableAt: entry.claimableAt,
        detail: 'the withdrawal period is still running — claiming now would revert',
      });
    }

    const inner = await adapter.buildClaimWithdrawBatch({ period: periodNum });
    const estFxrp = entry.estFxrpBase != null ? Number(entry.estFxrpBase) / DROPS : null;
    const disclosureBase = {
      action: 'vault-claim',
      vault: 'firelight',
      period: periodNum,
      // withdrawalsOf returns FXRP, not shares (the shares burned at redeem) —
      // the old `sharesQueued` label described the wrong thing.
      fxrpQueued: Number(entry.queuedFxrpBase) / DROPS,
      estimatedFxrpOut: estFxrp,
      disclosedToUser: true,
      astryumSigns: false,
    };

    if (evmAddr) {
      // Invariant #11 — dry-run before signature.
      const preflight = await preflightEvmCalls(
        provider,
        evmAddr,
        inner.map((a): EvmPreflightCall => ({ to: a.to, data: a.calldata, value: a.value, label: 'claim withdrawal' })),
      );
      return res.json({
        rail: 'evm',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        preflight,
        calls: toEvmCalls(inner, [
          `Claim ≈${estFxrp ?? '?'} FXRP from Firelight (withdrawal period ${periodNum})`,
        ]),
        disclosure: {
          ...disclosureBase,
          fee: null, // EVM rail only: claiming pays gas alone — the exit already happened at redeem
          note: 'Astryum builds this unsigned EVM call; you sign it in your own Flare wallet. It releases the FXRP your earlier redeem queued — the vault pays it straight to this wallet.',
        },
      });
    }

    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) {
      return res.status(400).json({ error: 'INVALID_MINT_AMOUNT', detail: 'amountXrpForMint required (the 0xFE dispatch is mint-coupled)' });
    }
    const wantsUnmint = unmintToXrpl === true;
    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));

    // Claim → XRP NATIVO en el mismo dispatch: el periodo ya cerró, así que el
    // FXRP de la cola es determinista (pro-rata de totales congelados) — se
    // redime entero + el FXRP del propio dispatch, barrido sin polvo. El
    // pre-read de params ocurre SOLO en la variante unmint.
    let claimInner = inner;
    let redeemTotalUBA = 0n;
    let minRedeemUBA: bigint | null = null;
    let unmintParams: Awaited<ReturnType<typeof readDirectMintParams>> | undefined;
    if (wantsUnmint) {
      if (entry.estFxrpBase == null) {
        return res.status(409).json({
          error: 'CLAIM_ESTIMATE_UNAVAILABLE',
          detail: 'cannot size the redemption — claim the FXRP first, then Unmint from your position',
        });
      }
      unmintParams = await readDirectMintParams(provider);
      redeemTotalUBA = BigInt(entry.estFxrpBase) + computeNetMint(grossXrpDrops, unmintParams).netToPersonalAccountUBA;
      minRedeemUBA = await readMinimumRedeemAmountUBA(provider);
      if (minRedeemUBA != null && redeemTotalUBA < minRedeemUBA) {
        return res.status(400).json({
          error: 'AMOUNT_BELOW_MINIMUM_REDEEM',
          detail: `Minimum redemption is ${Number(minRedeemUBA) / DROPS} XRP (claim + this dispatch's mint = ${Number(redeemTotalUBA) / DROPS}).`,
          minimumXrp: Number(minRedeemUBA) / DROPS,
        });
      }
      claimInner = [...inner, await buildRedeemToXrplCall(provider, { amountUBA: redeemTotalUBA, xrplDestination: xrplAddr })];
    }
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: xrplAddr,
        grossXrpDrops,
        innerCalls: claimInner,
        walletId: Number(walletId) || 0,
        supersedePendingNonce: wantsSupersede(req),
        action: wantsUnmint ? 'vault-claim->xrpl' : 'vault-claim',
      },
      unmintParams ? { params: unmintParams } : undefined,
    );
    // Invariant #11 — dry-run BOTH rails of the hand-off.
    const preflight = mergePreflights(
      await preflightXrplPayment(handoff.xrplPayment as unknown as Record<string, unknown>, xrplAddr),
      await preflightEvmCalls(
        provider,
        handoff.personalAccount,
        claimInner.map((a): EvmPreflightCall => ({ to: a.to, data: a.calldata, value: a.value, label: 'claim withdrawal' })),
      ),
    );
    return res.json({
      rail: 'xrpl',
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      preflight,
      disclosure: {
        ...disclosureBase,
        ...(wantsUnmint
          ? {
              fxrpRedeemed: Number(redeemTotalUBA) / DROPS,
              xrplDestination: xrplAddr,
              destinationIsOwner: true,
              redeemMinimumXrp: minRedeemUBA != null ? Number(minRedeemUBA) / DROPS : null,
            }
          : {}),
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(handoff.net),
        fxrpMintedSideEffect: Number(handoff.net.netToPersonalAccountUBA) / DROPS,
        note: wantsUnmint
          ? 'Releases the FXRP your earlier redeem queued AND redeems it — plus the small FXRP this dispatch mints — to NATIVE XRP, in one atomic 0xFE userOp you sign in Xaman. The FAssets agent pays the XRP (minus the protocol redemption fee) to the XRPL wallet that owns this Smart Account; the burn is immediate at execution, the XRP arrives after (minutes to hours). Execution on Flare is completed by an executor after your signature.'
          : 'Releases the FXRP your earlier redeem queued, as a 0xFE userOp you sign in Xaman — the vault pays it to your Personal Account. Mint-coupled: the XRP paid also mints a small FXRP into your PA. Execution on Flare is completed by an executor after your signature.',
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'VAULT_CLAIM_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* Vault ROTATION — exit vault A and enter vault B in ONE dispatch           */
/* ----------------------------------------------------------------------- */

type PartnerVaultKey = 'firelight' | 'earnxrp' | 'monarq';
const PARTNER_VAULT_KEYS: PartnerVaultKey[] = ['firelight', 'earnxrp', 'monarq'];

/** Haircut (bips) shaved off the estimated redeem output before it becomes the
 *  deposit amount of the second leg. The batch's calldata is fixed at prepare
 *  time but the share price keeps accruing until execution: depositing MORE
 *  FXRP than the redeem actually returns would revert the whole userOp. The
 *  shaved dust stays in the holder (wallet or PA) as plain FXRP. */
const ROTATE_DEPOSIT_BUFFER_BIPS = 10n; // 0.10%

/** Vault + receipt token + display metadata from config (never guessed). */
function resolvePartnerVault(
  vault: PartnerVaultKey,
):
  | { vaultAddress: string; receiptToken: string; vaultName: string; riskProfile: 'onchain' | 'cedefi' }
  | { missing: string } {
  if (vault === 'firelight') {
    const stXrp = getProtocolAddresses().firelight.stXRP;
    if (!stXrp) return { missing: 'Set FIRELIGHT_STXRP' };
    // stXRP IS the 4626 vault token
    return { vaultAddress: stXrp, receiptToken: stXrp, vaultName: 'Firelight stXRP', riskProfile: 'onchain' };
  }
  const d = new UpshiftVaultAdapter().getVaultDescriptor(vault);
  if (!d) return { missing: `Set UPSHIFT_${vault.toUpperCase()}_VAULT / _TOKEN` };
  return { vaultAddress: d.vault, receiptToken: d.lpToken, vaultName: d.name, riskProfile: d.riskProfile };
}

/** Live vault state (pause / cap / share price / exit terms) — all protocol
 *  data, read now and disclosed before the signature (invariants #6/#9). */
async function readPartnerVaultState(
  provider: ethers.JsonRpcProvider,
  vault: PartnerVaultKey,
  vaultAddress: string,
): Promise<{
  depositsPaused: boolean;
  depositCapUBA: bigint | null;
  totalAssetsUBA: bigint | null;
  sharePriceE6: bigint | null;
  instantRedemptionFeeBps: number | null;
  epochLagSeconds: number | null;
  sharePriceSource: string;
}> {
  if (vault === 'firelight') {
    const c = new ethers.Contract(vaultAddress, FIRELIGHT_READ_ABI, provider);
    const [paused, limit, assets, sp] = await Promise.all([
      c.paused().catch(() => false),
      c.depositLimit().catch(() => null),
      c.totalAssets().catch(() => null),
      c.convertToAssets(1_000_000n).catch(() => null),
    ]);
    return {
      depositsPaused: Boolean(paused),
      depositCapUBA: limit as bigint | null,
      totalAssetsUBA: assets as bigint | null,
      sharePriceE6: sp as bigint | null,
      instantRedemptionFeeBps: null,
      epochLagSeconds: null,
      sharePriceSource: 'stXRP.convertToAssets(1e6) (live on-chain)',
    };
  }
  const c = new ethers.Contract(vaultAddress, UPSHIFT_READ_ABI, provider);
  const [paused, cap, assets, sp, fee, lag] = await Promise.all([
    c.depositsPaused().catch(() => false),
    c.depositCap().catch(() => null),
    c.getTotalAssets().catch(() => null),
    c.getSharePrice().catch(() => null),
    c.instantRedemptionFee().catch(() => null),
    c.lagDuration().catch(() => null),
  ]);
  return {
    depositsPaused: Boolean(paused),
    depositCapUBA: cap as bigint | null,
    totalAssetsUBA: assets as bigint | null,
    sharePriceE6: sp as bigint | null,
    instantRedemptionFeeBps: fee != null ? Number(fee) : null,
    epochLagSeconds: lag != null ? Number(lag) : null,
    sharePriceSource: 'vault.getSharePrice() (live on-chain)',
  };
}

/**
 * POST /api/flare-demo/vault-rotate/prepare
 * Body: { fromVault, toVault, sharesBase, evmAddress?, xrplAddress?,
 *         amountXrpForMint?, region?, walletId? }
 *
 * Rotate a partner-vault position (Firelight stXRP · earnXRP · Monarq) into
 * another vault WITHOUT the FXRP ever sitting loose. The XRPL (PA) rail is
 * mint-coupled — each 0xFE dispatch rides a Payment that mints a small FXRP —
 * so a withdraw-then-deposit rotation pays that toll twice. Here both legs
 * fuse into ONE dispatch: [redeem A → approve B → deposit B], one signature,
 * one toll, and the mint-coupled FXRP joins the new position. EVM-direct rail
 * (wallet-held shares): the same fused batch as plain unsigned calls, no mint.
 * Exits are never gated; ENTERING Monarq keeps its CeDeFi switch (#10).
 */
router.post('/vault-rotate/prepare', async (req: Request, res: Response) => {
  try {
    const { fromVault, toVault, sharesBase, evmAddress, xrplAddress, amountXrpForMint, region = null, walletId = 0 } =
      (req.body ?? {}) as {
        fromVault?: string;
        toVault?: string;
        sharesBase?: string | number;
        evmAddress?: string;
        xrplAddress?: string;
        amountXrpForMint?: number | string;
        region?: string | null;
        walletId?: number;
      };

    if (!PARTNER_VAULT_KEYS.includes(fromVault as PartnerVaultKey) || !PARTNER_VAULT_KEYS.includes(toVault as PartnerVaultKey)) {
      return res.status(400).json({ error: 'INVALID_VAULT', detail: "fromVault/toVault must be 'firelight' | 'earnxrp' | 'monarq'" });
    }
    const from = fromVault as PartnerVaultKey;
    const to = toVault as PartnerVaultKey;
    if (from === to) {
      return res.status(400).json({ error: 'SAME_VAULT', detail: 'fromVault and toVault must differ' });
    }
    let shares: bigint;
    try {
      shares = BigInt(sharesBase as string | number);
    } catch {
      return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'sharesBase must be integer base units (6 dec)' });
    }
    if (shares <= 0n) return res.status(400).json({ error: 'INVALID_AMOUNT' });

    const evmAddr = evmAddress != null ? safeGetAddress(evmAddress) : null;
    if (evmAddress != null && !evmAddr) return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
    const xrplAddr = typeof xrplAddress === 'string' ? xrplAddress.trim() : '';
    if (!evmAddr) {
      if (!xrplAddr) return res.status(400).json({ error: 'MISSING_XRPL_ADDRESS', detail: 'Provide evmAddress (wallet-held shares) or xrplAddress (PA-held shares)' });
      if (!XRPL_CLASSIC_RE.test(xrplAddr)) return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
    }

    const gate = gateFlareDemo(region);
    if (gate) return res.status(gate.status).json({ error: gate.error });
    // Exiting Monarq is never gated (it's a withdrawal); ENTERING it keeps the
    // CeDeFi switch — same frontier as /vault/prepare (invariant #10).
    if (to === 'monarq' && process.env.UPSHIFT_MONARQ_ENABLED !== 'true') {
      return res.status(503).json({ error: 'MONARQ_DISABLED', detail: 'Set UPSHIFT_MONARQ_ENABLED=true (CeDeFi risk profile — separate switch)' });
    }

    const fxrpToken = getProtocolAddresses().fxrp.token;
    if (!fxrpToken) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: 'Set FXRP_TOKEN' });
    const fromMeta = resolvePartnerVault(from);
    if ('missing' in fromMeta) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: fromMeta.missing });
    const toMeta = resolvePartnerVault(to);
    if ('missing' in toMeta) return res.status(503).json({ error: 'VAULT_NOT_CONFIGURED', detail: toMeta.missing });

    // KWYH scanner (#10) on the ENTRY side (FXRP + destination vault + its
    // receipt token) — the exit side needs no scan, same as /vault-withdraw.
    const scanner: Record<string, { verdict: string; flags: string[] } | { error: string }> = {};
    const scanTargets: Array<readonly [string, string]> = [
      ['FXRP', fxrpToken],
      ['toVault', toMeta.vaultAddress],
    ];
    if (toMeta.receiptToken !== toMeta.vaultAddress) scanTargets.push(['toReceiptToken', toMeta.receiptToken]);
    for (const [label, addr] of scanTargets) {
      try {
        const { data } = await goPlusProvider.call<
          { chainId: number; address: string },
          { verdict: string; flags: string[] }
        >('security.tokenSafety', { chainId: FLARE_CHAIN_ID, address: addr }, {
          traceId: 'flare-demo-vault-rotate',
          wallet: evmAddr ?? xrplAddr,
        });
        scanner[label] = data;
        if (data.verdict === 'danger') {
          return res.status(409).json({ error: `KWYH_DANGER_${label.toUpperCase()}`, flags: data.flags });
        }
      } catch (e) {
        scanner[label] = { error: safeErrorDetail(e) };
      }
    }

    // LIVE READS — both vaults' state + FTSO XRP/USD, disclosed before signing.
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    const [fromState, toState] = await Promise.all([
      readPartnerVaultState(provider, from, fromMeta.vaultAddress),
      readPartnerVaultState(provider, to, toMeta.vaultAddress),
    ]);
    if (toState.depositsPaused) {
      return res.status(409).json({ error: 'VAULT_DEPOSITS_PAUSED', vault: to });
    }
    // The second leg's calldata needs a concrete deposit amount, derived from
    // the exit vault's live share price. Without it there is no deterministic
    // batch to commit — never guessed (invariant #3/#9).
    if (fromState.sharePriceE6 == null || fromState.sharePriceE6 <= 0n) {
      return res.status(502).json({ error: 'VAULT_STATE_UNAVAILABLE', detail: `could not read ${from} share price` });
    }

    // The account whose shares burn AND where the new shares land: the EVM
    // wallet (direct rail) or the Personal Account (XRPL rail).
    const holder = evmAddr ?? (await resolvePersonalAccount(provider, xrplAddr));
    const balance = await erc20BalanceOf(provider, fromMeta.receiptToken, holder);
    if (balance != null && balance < shares) {
      return res.status(409).json({
        error: 'INSUFFICIENT_SHARES',
        holder,
        balanceShares: Number(balance) / DROPS,
        requestedShares: Number(shares) / DROPS,
      });
    }

    // Exit arithmetic (all bigint): estimated FXRP out of the redeem, minus
    // the exit vault's instant fee, minus the rotation buffer. This becomes
    // the deposit amount of the second leg (the XRPL rail adds its net mint).
    const grossOutUBA = (shares * fromState.sharePriceE6) / 1_000_000n;
    const instantFeeUBA =
      fromState.instantRedemptionFeeBps != null ? (grossOutUBA * BigInt(fromState.instantRedemptionFeeBps)) / 10_000n : 0n;
    const netOutUBA = grossOutUBA - instantFeeUBA;
    const rotateBufferUBA = (netOutUBA * ROTATE_DEPOSIT_BUFFER_BIPS) / 10_000n;
    const redeemDepositUBA = netOutUBA - rotateBufferUBA;
    if (redeemDepositUBA <= 0n) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', detail: 'nothing left to deposit after exit fee + rotation buffer' });
    }

    const apyPct30d = to === 'firelight' ? null : await fetchUpshiftApy30d(toMeta.vaultAddress);
    const capRemainingUBA =
      toState.depositCapUBA != null && toState.totalAssetsUBA != null
        ? toState.depositCapUBA > toState.totalAssetsUBA
          ? toState.depositCapUBA - toState.totalAssetsUBA
          : 0n
        : null;

    const sharesHuman = Number(shares) / DROPS;
    const disclosureBase = {
      action: 'vault-rotate',
      from: {
        vault: from,
        vaultName: fromMeta.vaultName,
        vaultAddress: fromMeta.vaultAddress,
        receiptToken: fromMeta.receiptToken,
        sharePrice: Number(fromState.sharePriceE6) / DROPS,
        sharePriceSource: fromState.sharePriceSource,
        instantRedemptionFeeBps: fromState.instantRedemptionFeeBps,
      },
      to: {
        vault: to,
        vaultName: toMeta.vaultName,
        vaultAddress: toMeta.vaultAddress,
        receiptToken: toMeta.receiptToken,
        riskProfile: toMeta.riskProfile,
        sharePrice: toState.sharePriceE6 != null ? Number(toState.sharePriceE6) / DROPS : null,
        sharePriceSource: toState.sharePriceE6 != null ? toState.sharePriceSource : null,
        apyPct30d,
        apySource: apyPct30d != null ? 'Upshift (August Digital) API historical_apy.30' : null,
        capacity:
          toState.depositCapUBA != null && toState.totalAssetsUBA != null
            ? {
                depositCapFxrp: Number(toState.depositCapUBA) / DROPS,
                usedFxrp: Number(toState.totalAssetsUBA) / DROPS,
                remainingFxrp: capRemainingUBA != null ? Number(capRemainingUBA) / DROPS : null,
              }
            : null,
        withdrawal:
          to === 'firelight'
            ? { kind: 'erc4626-claim', instantRedemptionFeeBps: null, epochLagSeconds: null, note: 'redeem stXRP → FXRP via the vault claim flow' }
            : {
                kind: 'instant-or-epoch',
                instantRedemptionFeeBps: toState.instantRedemptionFeeBps,
                epochLagSeconds: toState.epochLagSeconds,
                note: 'instantRedeem pays the bps fee; requestRedeem waits the epoch lag with no fee',
              },
      },
      sharesRedeemed: sharesHuman,
      estimatedFxrpOut: Number(netOutUBA) / DROPS,
      instantFeeFxrp: instantFeeUBA > 0n ? Number(instantFeeUBA) / DROPS : null,
      rotateBufferBips: Number(ROTATE_DEPOSIT_BUFFER_BIPS),
      rotateBufferFxrp: Number(rotateBufferUBA) / DROPS,
      fxrpPriceUSD: fxrpPriceUSD > 0 ? fxrpPriceUSD : null,
      fassetsRedemptionFee: null, // rotations never leave Flare — no FAssets redemption
      noDebt: true,
      noLiquidationRisk: true,
      disclosedToUser: true,
      astryumSigns: false,
    };
    const monarqWarning =
      to === 'monarq'
        ? ' IMPORTANT: the destination vault runs OFF-CHAIN strategies (options, basis) managed by Monarq Asset Management — returns are not verifiable on-chain and withdrawals wait a 7-day epoch unless you pay the instant fee.'
        : '';

    // EVM-direct rail — the wallet holds the shares; the fused batch goes to
    // the wallet as three unsigned calls. No XRPL mint, no toll at all.
    if (evmAddr) {
      if (capRemainingUBA != null && redeemDepositUBA > capRemainingUBA) {
        return res.status(409).json({
          error: 'VAULT_CAP_EXCEEDED',
          vault: to,
          capRemainingFxrp: Number(capRemainingUBA) / DROPS,
          requestedFxrp: Number(redeemDepositUBA) / DROPS,
        });
      }
      const redeemCalls =
        from === 'firelight'
          ? await new FirelightAdapter().buildRedeemBatch({ sharesUBA: shares, receiver: evmAddr, owner: evmAddr })
          : await new UpshiftVaultAdapter().buildInstantRedeemBatch({ vaultKey: from, sharesUBA: shares, receiver: evmAddr });
      const depositCalls =
        to === 'firelight'
          ? await new FirelightAdapter().buildStakeBatch({ supplyUBA: redeemDepositUBA, receiver: evmAddr })
          : await new UpshiftVaultAdapter().buildDepositBatch({ vaultKey: to, supplyUBA: redeemDepositUBA, receiver: evmAddr });
      const depositFxrp = Number(redeemDepositUBA) / DROPS;
      return res.json({
        rail: 'evm',
        chainId: FLARE_CHAIN_ID,
        account: evmAddr,
        calls: toEvmCalls([...redeemCalls, ...depositCalls], [
          `Redeem ${sharesHuman} ${fromMeta.vaultName} shares → FXRP`,
          `Approve ${depositFxrp} FXRP → ${toMeta.vaultName}`,
          `Deposit ${depositFxrp} FXRP — shares land in your wallet`,
        ]),
        scanner,
        disclosure: {
          ...disclosureBase,
          fxrpDeposited: depositFxrp,
          depositedValueUSD: fxrpPriceUSD > 0 ? depositFxrp * fxrpPriceUSD : null,
          note:
            'Astryum builds these unsigned EVM calls; you sign them in your own Flare wallet. Your shares are redeemed and the FXRP is deposited into the destination vault in the same batch — it never sits loose. The rotation buffer dust stays in your wallet as FXRP.' +
            monarqWarning,
        },
      });
    }

    // XRPL rail — the PA holds the shares; both legs fuse into ONE 0xFE
    // dispatch (one mint-coupled toll instead of two), signed once in Xaman.
    const mintXrp = Number(amountXrpForMint);
    if (!isPositiveFinite(mintXrp)) {
      return res.status(400).json({ error: 'INVALID_MINT_AMOUNT', detail: 'amountXrpForMint required (the 0xFE dispatch is mint-coupled)' });
    }
    const grossXrpDrops = BigInt(Math.round(mintXrp * DROPS));
    const built = await buildVaultRotateHandoff(provider, {
      xrplAddress: xrplAddr,
      grossXrpDrops,
      fromVault: from,
      toVault: to,
      sharesUBA: shares,
      redeemDepositUBA,
      walletId: Number(walletId) || 0,
      supersedePendingNonce: wantsSupersede(req),
    });
    if (capRemainingUBA != null && built.depositUBA > capRemainingUBA) {
      return res.status(409).json({
        error: 'VAULT_CAP_EXCEEDED',
        vault: to,
        capRemainingFxrp: Number(capRemainingUBA) / DROPS,
        requestedFxrp: Number(built.depositUBA) / DROPS,
      });
    }
    const net = built.handoff.net;
    const depositFxrp = Number(built.depositUBA) / DROPS;

    return res.json({
      rail: 'xrpl',
      personalAccount: built.handoff.personalAccount,
      xrplPayment: built.handoff.xrplPayment,
      memoHex: built.handoff.memoHex,
      userOpData: built.handoff.userOpData,
      scanner,
      disclosure: {
        ...disclosureBase,
        mintCoupledXrp: mintXrp,
        ...mintFeeDisclosure(net),
        fxrpMintedJoinsDeposit: Number(net.supplyUBA) / DROPS,
        fxrpDeposited: depositFxrp,
        depositedValueUSD: fxrpPriceUSD > 0 ? depositFxrp * fxrpPriceUSD : null,
        singleDispatch: true,
        note:
          `Rotates your ${fromMeta.vaultName} position into ${toMeta.vaultName} as ONE 0xFE userOp you sign once in Xaman — redeem and deposit run atomically, so the FXRP never sits loose and you pay one mint-coupled dispatch instead of two. The small FXRP minted by this Payment joins the deposit. The rotation buffer dust stays in your Personal Account as FXRP. Execution on Flare is completed by an executor after your signature; until it runs, your XRP waits safely at the Core Vault.` +
          monarqWarning,
      },
    });
  } catch (e) {
    if (e instanceof NonceSeatTakenError) return res.status(409).json({ error: 'NONCE_SEAT_TAKEN', detail: e.message });
    return res.status(500).json({ error: 'VAULT_ROTATE_PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/* ----------------------------------------------------------------------- */
/* GET /api/flare-demo/mint-status/:txHash
 * Has the signed 0xFE Payment actually EXECUTED on Flare? The XRPL memo only
 * commits the userOp hash; until an executor delivers the bytes and calls
 * executeDirectMintingWithData, nothing exists on-chain and the user's XRP
 * sits at the Core Vault (lesson of tx 7BFCF65F…, 2026-07-12). The frontend
 * polls this after the Xaman signature to show the REAL state instead of
 * assuming success. Read-only; no auth; no side effects.                    */
const XRPL_TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const MAC_STATUS_ABI = [
  'function isTransactionIdUsed(bytes32 _transactionId) view returns (bool)',
];

router.get('/mint-status/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    if (!XRPL_TX_HASH_RE.test(txHash)) {
      return res
        .status(400)
        .json({ error: 'INVALID_TX_HASH', detail: 'expected a 64-hex XRPL transaction hash' });
    }
    const provider = flareProvider();
    const mac = new ethers.Contract(
      await resolveMasterAccountController(provider),
      MAC_STATUS_ABI,
      provider,
    );
    const executed: boolean = await mac.isTransactionIdUsed('0x' + txHash.toLowerCase());
    return res.json({
      txHash: txHash.toUpperCase(),
      executed,
      note: executed
        ? 'Executed on Flare — the signed userOp ran and the mint is settled.'
        : 'Pending — the Payment sits at the Core Vault awaiting an executor. The XRP is not lost; execution runbook: backend/src/scripts/execute-direct-mint.ts.',
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: 'MINT_STATUS_FAILED', detail: safeErrorDetail(e) });
  }
});

/* GET /api/flare-demo/executor-health
 * Estado vivo del executor 0xFE: flags armados, gauges de combustible
 * (FLR/FXRP), último tick, pendientes y últimos refuel/sweep. Todo es
 * información on-chain pública o booleanos de config — nunca valores de env
 * ni claves. Read-only; el operador (y un juez) ven que el agente respira.  */
router.get('/executor-health', async (_req: Request, res: Response) => {
  try {
    const { directMintExecutorWatcher } = await import('../services/flare/DirectMintExecutorService');
    return res.json({ ...directMintExecutorWatcher.health(), checkedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'EXECUTOR_HEALTH_FAILED', detail: safeErrorDetail(e) });
  }
});

export default router;

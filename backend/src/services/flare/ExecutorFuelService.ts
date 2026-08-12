/**
 * ExecutorFuelService — la economía de combustible del executor 0xFE.
 *
 * El executor es un agente económicamente autónomo DENTRO de la economía B
 * (doctrina: Astryum_Economia_Agentica_Mapa_Procesos_2026-07-13 §0/§3.4):
 * cobra su fee en FXRP (comprometida en el memo firmado, disclosed), paga la
 * atestación FDC y el gas en FLR, y cuando el depósito baja del umbral hace
 * él solo el swap FXRP→WFLR→FLR para seguir vivo. TODO con fondos PROPIOS de
 * Astryum — jamás capital de usuario (misma línea que TurnkeyTreasuryService:
 * revenue propia, no custodia). Invariantes #1/#8 intactos por construcción.
 *
 * Tres modos de fallo que este módulo cierra:
 *  1. Espiral de muerte de gas — el swap se dispara ANTES de estar en rojo
 *     (umbral de refuel ≫ fee FDC de ~20 FLR/mint) y existe una reserva dura
 *     de rescate: si el saldo no cubre ni el gas del propio swap, se alerta
 *     CRITICAL en vez de quemar lo que queda.
 *  2. Piñata de FXRP — la fee acumulada se barre a la treasury/Safe
 *     (FLARE_EXECUTOR_SWEEP_TO) por encima de un umbral, dejando solo el
 *     buffer de trabajo para futuros refuels.
 *  3. Operador a oscuras — executorAlert() empuja info/warn/critical a un
 *     webhook (EXECUTOR_ALERT_WEBHOOK_URL, Discord/Slack-compatible) además
 *     del log; el watcher publica sus gauges en /flare-demo/executor-health.
 *
 * Cero discreción también aquí: umbrales, venue (SparkDEX V3, allowlist) y
 * slippage máximo son config determinista; el agente aplica la fórmula, no
 * decide. Flag propio (FLARE_EXECUTOR_REFUEL_ENABLED, invariante #10) y
 * simulación SIEMPRE antes de firmar (#11) — approve, swap y unwrap incluidos.
 */

import { ethers } from 'ethers';
import { ALLOWLIST } from '../../config/allowlist.config';
import { resolveFxrpToken } from '../../connectors/protocols/flare/FlareDirectMintService';
import { opsAlert, type AlertLevel } from '../OpsAlertService';
import { kvGet, kvUpsert } from '../persistence/backgroundJobKv';

export type Log = (msg: string) => void;
const noop: Log = (m) => console.log(m);

/** FXRP es UBA = drops: 6 decimales (el mismo DROPS=1e6 de todo el carril 0xFE). */
const FXRP_DECIMALS = 6;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// WNat (WFLR) — WETH9-style, deposit/withdraw 1:1.
const WNAT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256 amount)',
];

// SparkDEX V3 (fork UniV3, direcciones públicas verificadas en allowlist.config).
// El quoter puede ser V1 o V2 según el deploy — se prueban ambas formas por
// staticCall (inofensivo) y gana la que responda.
const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];
const QUOTER_V1_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];
const ROUTER_WITH_DEADLINE_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
];
const ROUTER_02_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
];

const FEE_TIERS = [3000, 500, 10000, 100];

/* ────────────────────────────────────────────────────────────────────────── */
/* Alertas — el operador nunca a oscuras                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export type { AlertLevel } from '../OpsAlertService';

/**
 * Alerta del executor — canal común de operaciones (OpsAlertService).
 *
 * `opts.runbook` es lo que convierte el aviso en acción: quien lo lea en el
 * móvil debe poder arreglarlo sin abrir el repo. Ponlo SIEMPRE que exista un
 * arreglo conocido (mismo contrato que los probes del Sentinel).
 */
export async function executorAlert(
  level: AlertLevel,
  message: string,
  opts?: { runbook?: string; key?: string; facts?: Record<string, string | number | boolean | null | undefined> },
): Promise<void> {
  return opsAlert('0xFE-executor', level, message, opts);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Presupuesto diario de fees FDC — el freno de mano GLOBAL del gasto         */
/* ────────────────────────────────────────────────────────────────────────── */
//
// Lección del incidente 2026-07-18 (~4.880 FLR quemados en attestations
// repetidas): aunque todos los guards fallen a la vez, el gasto en fees FDC de
// la clave del executor queda ACOTADO por diseño. Ventana rodante de 24h,
// compartida por TODOS los pagadores de attestation (executor 0xFE + relayer
// del consejo — misma clave, mismo presupuesto). En memoria: un restart abre
// ventana nueva; el tope sigue acotando cada ventana.

/** Superado el presupuesto: reintentable cuando la ventana ruede — jamás permanent. */
export class FeeBudgetExceeded extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;
const feeLedger = { windowStart: 0, spentWei: 0n, alerted: false, warnedNearCap: false };

/** % del tope al que se avisa de que queda poco (env-tunable). Ver `recordFeeSpend`. */
function warnPct(): number {
  const n = Number(process.env.FLARE_EXECUTOR_FEE_WARN_PCT || 80);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 80;
}

function budgetFlr(): number {
  const n = Number(process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR || 120);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

function rollWindow(now: number): void {
  if (now - feeLedger.windowStart >= DAY_MS) {
    feeLedger.windowStart = now;
    feeLedger.spentWei = 0n;
    feeLedger.alerted = false;
    feeLedger.warnedNearCap = false;
  }
}

// ── Persistencia (§1) — el tope que nació del incidente de los 244 re-pagos ──
// En RAM el tope era "120 FLR por VIDA DEL PROCESO", no por día: cada redeploy (a diario)
// lo reseteaba y la protección financiera se evaporaba en silencio. Persistido vía el
// bg-kv compartido (jobType propio 'fee-ledger', fila única 'global') con write-through
// al gastar + una carga en boot, de modo que el gasto acumulado SOBREVIVE al reinicio.
// Write-through single-instance (Railway); multi-instancia exigiría un contador atómico
// en DB (fuera de alcance, anotado). La reserva Legacy no cambia: se calcula igual sobre
// feeLedger.spentWei (ahora el gasto REAL del día, no el de este proceso).
const FEE_LEDGER_JOB_TYPE = 'fee-ledger';
let feeLedgerLoaded = false;

function persistFeeLedger(): void {
  // fire-and-forget: recordFeeSpend queda sync; bg-kv es best-effort (sin DB ⇒ no-op).
  void kvUpsert(FEE_LEDGER_JOB_TYPE, 'id', 'global', {
    id: 'global',
    windowStart: feeLedger.windowStart,
    spentWei: feeLedger.spentWei.toString(),
  });
}

/**
 * Restaura el gasto de fees acumulado desde la DB al arrancar (llamar UNA vez, antes de
 * que el executor pague ninguna attestation). Si la ventana persistida ya está caduca
 * (>24h) rollWindow la resetea. Idempotente. Sin DB ⇒ no-op (arranca limpio como antes).
 */
export async function loadFeeLedger(now: number = Date.now()): Promise<void> {
  if (feeLedgerLoaded) return;
  feeLedgerLoaded = true;
  const p = await kvGet(FEE_LEDGER_JOB_TYPE, 'id', 'global');
  if (p && typeof p.windowStart === 'number' && typeof p.spentWei === 'string') {
    feeLedger.windowStart = p.windowStart;
    try {
      feeLedger.spentWei = BigInt(p.spentWei);
    } catch {
      feeLedger.spentWei = 0n;
    }
    feeLedger.alerted = false;
    feeLedger.warnedNearCap = false; // que el aviso del 80% pueda sonar en la ventana restaurada
    rollWindow(now); // ventana persistida ya vieja ⇒ empieza una fresca
  }
}

/**
 * El suelo de fees FDC reservado al carril Legacy (env, default 40 FLR ≈ 2
 * órdenes). El pagador 0xFE lo CEDE (ve un tope efectivo = tope − reserva), de
 * modo que una fuga o descontrol en 0xFE NUNCA puede consumir el combustible
 * que el consejo necesita para relayar sus órdenes — inanición silenciosa
 * cerrada por diseño, sin esperar a la contabilidad por producto (B4).
 */
export function legacyFeeReserveWei(): bigint {
  const n = Number(process.env.LEGACY_DAILY_FEE_RESERVE_FLR || 40);
  return ethers.parseEther(String(Number.isFinite(n) && n >= 0 ? n : 40));
}

/**
 * Llamar ANTES de firmar una requestAttestation. Lanza FeeBudgetExceeded si la
 * fee no cabe en el presupuesto de la ventana — sin firmar nada. Alerta
 * critical UNA vez por ventana.
 *
 * `reserveForOthersWei`: presupuesto que ESTE pagador cede a otro carril. El
 * 0xFE pasa `legacyFeeReserveWei()` → su tope efectivo = tope − reserva, y el
 * suelo de Legacy queda intocable. El carril protegido (Legacy) pasa 0 → usa el
 * tope completo, incluida su reserva. Así una fuga en un carril no deja al otro
 * a secas.
 */
export function assertDailyFeeBudget(
  nextFeeWei: bigint,
  now: number = Date.now(),
  reserveForOthersWei: bigint = 0n,
): void {
  rollWindow(now);
  const budgetWei = ethers.parseEther(String(budgetFlr()));
  const effectiveWei = budgetWei > reserveForOthersWei ? budgetWei - reserveForOthersWei : 0n;
  if (feeLedger.spentWei + nextFeeWei <= effectiveWei) return;
  if (!feeLedger.alerted) {
    feeLedger.alerted = true;
    const reserveNote =
      reserveForOthersWei > 0n
        ? ` (tope efectivo ${ethers.formatEther(effectiveWei)} FLR; se reservan ${ethers.formatEther(reserveForOthersWei)} FLR para el carril Legacy)`
        : '';
    void executorAlert(
      'critical',
      `PRESUPUESTO DIARIO DE FEES FDC AGOTADO: ${ethers.formatEther(feeLedger.spentWei)} FLR gastados en la ventana, ` +
        `tope ${budgetFlr()} FLR (FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR)${reserveNote}. No se pagan más attestations hasta que ruede la ventana`,
      {
        key: 'fee-budget:exhausted',
        runbook:
          'Si el gasto es legítimo (día de ceremonia), sube FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR en Railway. Si no lo es, ' +
          'algo está reintentando con dinero real: /app/admin → Sistema → Desatascar y aparca al culpable.',
      },
    );
  }
  throw new FeeBudgetExceeded(
    `presupuesto diario de fees FDC agotado (${ethers.formatEther(feeLedger.spentWei)}/${ethers.formatEther(effectiveWei)} FLR efectivos) — no se paga; se reintenta cuando ruede la ventana`,
  );
}

/** Llamar DESPUÉS de que la requestAttestation quede minada (fee ya pagada). */
export function recordFeeSpend(feeWei: bigint, now: number = Date.now()): void {
  rollWindow(now);
  feeLedger.spentWei += feeWei;
  persistFeeLedger(); // write-through — el gasto sobrevive al redeploy (§1)

  // Aviso al ACERCARSE al tope (default 80%), una vez por ventana. Sin esto,
  // agotar el presupuesto se descubre con una orden atascada o un 429 EN
  // DIRECTO; con esto se ve venir con margen para subir el tope o pausar un
  // carril. Es lo que hace operable el pote compartido (0xFE + Legacy + demo).
  if (feeLedger.warnedNearCap) return;
  const budgetWei = ethers.parseEther(String(budgetFlr()));
  const pct = warnPct();
  if (feeLedger.spentWei < (budgetWei * BigInt(Math.round(pct))) / 100n) return;
  feeLedger.warnedNearCap = true;
  const remainingWei = budgetWei > feeLedger.spentWei ? budgetWei - feeLedger.spentWei : 0n;
  const remainingFlr = Number(ethers.formatEther(remainingWei));
  void executorAlert(
    'warn',
    `presupuesto diario de fees FDC al ${pct}%: ${ethers.formatEther(feeLedger.spentWei)}/${budgetFlr()} FLR ` +
      `gastados; quedan ${remainingWei === 0n ? '0' : ethers.formatEther(remainingWei)} FLR (~${Math.floor(remainingFlr / 20)} attestations)`,
    {
      key: 'fee-budget:near-cap',
      runbook:
        'Si hoy hay ceremonia o ventana de jueces, sube FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR en Railway (o pausa un carril) ' +
        'ANTES de agotarlo: agotado, ningún 0xFE nuevo se ejecuta hasta que ruede la ventana de 24 h.',
    },
  );
}

/** Snapshot para /executor-health. */
export function feeBudgetStatus(now: number = Date.now()): { spentFLR: string; budgetFLR: number; windowStartedAt: string | null } {
  rollWindow(now);
  return {
    spentFLR: ethers.formatEther(feeLedger.spentWei),
    budgetFLR: budgetFlr(),
    windowStartedAt: feeLedger.windowStart ? new Date(feeLedger.windowStart).toISOString() : null,
  };
}

/** Coste FDC estimado por mint 0xFE (~20 FLR — el ancla del umbral de refuel). Override
 *  con DEMO_ESTIMATED_MINT_FEE_FLR si el fee real cambia. */
export function estimatedMintFeeWei(): bigint {
  const n = Number(process.env.DEMO_ESTIMATED_MINT_FEE_FLR || 20);
  return ethers.parseEther(String(Number.isFinite(n) && n > 0 ? n : 20));
}

/** FLR que le queda al carril 0xFE en la ventana rodante (tras la reserva que cede a
 *  Legacy). No lanza — para el pre-chequeo de /prepare (§3). */
export function remainingFeeBudgetWei(now: number = Date.now()): bigint {
  rollWindow(now);
  const budgetWei = ethers.parseEther(String(budgetFlr()));
  const effectiveWei = budgetWei > legacyFeeReserveWei() ? budgetWei - legacyFeeReserveWei() : 0n;
  const remaining = effectiveWei - feeLedger.spentWei;
  return remaining > 0n ? remaining : 0n;
}

/**
 * §3 — ¿queda presupuesto para atestiguar UN mint más? Pre-chequeo NO-lanzante para el
 * /prepare: si no cabe, se rechaza ANTES de firmar (el XRP no sale, no se aparca) en vez
 * de detectar el aparcamiento después (misma filosofía que el preflight de reserva y R8).
 */
export function hasFeeBudgetForOneMint(now: number = Date.now()): boolean {
  return remainingFeeBudgetWei(now) >= estimatedMintFeeWei();
}

/** Solo tests: ventana limpia. */
export function _resetFeeLedgerForTests(): void {
  feeLedger.windowStart = 0;
  feeLedger.spentWei = 0n;
  feeLedger.alerted = false;
  feeLedgerLoaded = false;
  marginState.warnedAt = 0;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Guardián FTSO del margen — Tramo 1 de la secuencia de solvencia (doc       */
/* Astryum_Keeper_Fee_Capitalizacion_Tabla_Precios_2026-07-25)                */
/* ────────────────────────────────────────────────────────────────────────── */
//
// El ingreso del executor está en XRP (fee del protocolo, ~0,2) y el coste en
// FLR (~20 attestation + ~0,4 gas): la fee fija lleva el riesgo FLR/XRP
// DENTRO. Breakeven medido 2026-07-25: ratio XRP/FLR ≈ 102 (aquel día ~170).
// Este guardián convierte "fee fija con fe" en "fee fija con termómetro":
// cada tick calcula el margen sobre coste con precios FTSO vivos y avisa
// (una vez por ventana de 24h) cuando cae del umbral.

/** Margen % SOBRE COSTE de la fee por dispatch. null si falta algún dato. */
export function computeFeeMarginPct(i: {
  /** Fee del executor por dispatch, en XRP (leída on-chain del AssetManager). */
  execFeeXrp: number;
  xrpUsd: number;
  flrUsd: number;
  /** Coste por dispatch en FLR (attestation FDC + gas del deliver). */
  costFlr: number;
}): number | null {
  if (!(i.execFeeXrp > 0) || !(i.xrpUsd > 0) || !(i.flrUsd > 0) || !(i.costFlr > 0)) return null;
  const incomeUsd = i.execFeeXrp * i.xrpUsd;
  const costUsd = i.costFlr * i.flrUsd;
  return ((incomeUsd - costUsd) / costUsd) * 100;
}

export interface FeeMarginGauge {
  /** Margen % sobre coste (>0 = la fee cubre el coste con excedente). */
  marginPct: number | null;
  execFeeXrp: number | null;
  xrpUsd: number | null;
  flrUsd: number | null;
  costFlr: number;
  warnBelowPct: number;
}

const marginState = { warnedAt: 0 };

function marginWarnPct(): number {
  const n = Number(process.env.FLARE_EXECUTOR_FEE_MARGIN_WARN_PCT || 20);
  return Number.isFinite(n) ? n : 20;
}

/** Gas estimado del deliver tx en FLR (medido 0,39 FLR a 650 gwei, 2026-07-25). */
function deliverGasFlr(): number {
  const n = Number(process.env.FLARE_EXECUTOR_DELIVER_GAS_FLR || 0.4);
  return Number.isFinite(n) && n >= 0 ? n : 0.4;
}

/**
 * Lee fee (on-chain) + precios (FTSO) y evalúa el margen. Best-effort: un fallo
 * de lectura devuelve null y no toca el tick. Avisa una vez por 24h cuando el
 * margen cae del umbral — el patrón del aviso del 80% del presupuesto.
 */
export async function checkFeeMargin(
  provider: ethers.JsonRpcProvider,
  now: number = Date.now(),
): Promise<FeeMarginGauge | null> {
  const costFlr = Number(ethers.formatEther(estimatedMintFeeWei())) + deliverGasFlr();
  const warnBelowPct = marginWarnPct();
  try {
    const { readDirectMintParams } = await import(
      '../../connectors/protocols/flare/FlareDirectMintService'
    );
    const { createFTSOPriceProvider } = await import(
      '../../engines/normalisation/NormalisationEngine'
    );
    const [params, priceProvider] = await Promise.all([
      readDirectMintParams(provider),
      createFTSOPriceProvider(),
    ]);
    const execFeeXrp = Number(params.executorFeeUBA) / 1e6;
    const [xrpUsd, flrUsd] = await Promise.all([
      priceProvider.getPriceUSD('XRP'),
      priceProvider.getPriceUSD('FLR'),
    ]);
    const marginPct = computeFeeMarginPct({ execFeeXrp, xrpUsd, flrUsd, costFlr });

    if (marginPct !== null && marginPct < warnBelowPct && now - marginState.warnedAt >= DAY_MS) {
      marginState.warnedAt = now;
      await executorAlert(
        marginPct < 0 ? 'critical' : 'warn',
        `margen de la fee del keeper al ${marginPct.toFixed(1)}% sobre coste (umbral ${warnBelowPct}%): ` +
          `fee ${execFeeXrp} XRP ($${(execFeeXrp * xrpUsd).toFixed(3)}) vs coste ~${costFlr.toFixed(1)} FLR ` +
          `($${(costFlr * flrUsd).toFixed(3)}). ${marginPct < 0 ? 'CADA DISPATCH PIERDE DINERO. ' : ''}` +
          `El ratio XRP/FLR se acerca al breakeven (~${Math.round(costFlr / (Number(params.executorFeeUBA) / 1e6))}) — ` +
          'revisar la fee o el modelo antes de que la capitalización se invierta en silencio.',
      );
    }
    return { marginPct, execFeeXrp, xrpUsd, flrUsd, costFlr, warnBelowPct };
  } catch {
    return { marginPct: null, execFeeXrp: null, xrpUsd: null, flrUsd: null, costFlr, warnBelowPct };
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Planners puros — la aritmética del combustible, sin red (unit-testeable)   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Dimensiona el amountIn (FXRP, UBA) para reponer `needOutWei` de FLR dado el
 * tipo de la cotización de sondeo (probeIn → probeOut). +2% de colchón sobre
 * el tipo cotizado (el minOut de slippage acota el resultado real); techo por
 * swap y por saldo propio. 0n = no hay con qué repostar.
 */
export function sizeRefuelAmountIn(input: {
  needOutWei: bigint;
  probeInUBA: bigint;
  probeOutWei: bigint;
  fxrpBalanceUBA: bigint;
  maxPerSwapUBA: bigint;
}): bigint {
  const { needOutWei, probeInUBA, probeOutWei, fxrpBalanceUBA, maxPerSwapUBA } = input;
  if (needOutWei <= 0n || probeInUBA <= 0n || probeOutWei <= 0n || fxrpBalanceUBA <= 0n) return 0n;
  const raw = (needOutWei * probeInUBA) / probeOutWei;
  const withBuffer = (raw * 102n) / 100n;
  const capped = withBuffer < maxPerSwapUBA ? withBuffer : maxPerSwapUBA;
  const sized = capped < fxrpBalanceUBA ? capped : fxrpBalanceUBA;
  return sized > 0n ? sized : 0n;
}

/** minOut = cotización − slippage máximo permitido (BPS). */
export function minOutForQuote(quotedOutWei: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.floor(slippageBps))));
  return (quotedOutWei * (10_000n - bps)) / 10_000n;
}

/**
 * Cuánto FXRP barrer a la treasury: todo lo que exceda el buffer de trabajo,
 * pero solo cuando el saldo supera el umbral de barrido (evita transfers de
 * polvo). 0n = no barrer.
 */
export function planFxrpSweep(input: {
  fxrpBalanceUBA: bigint;
  sweepMinUBA: bigint;
  keepUBA: bigint;
}): bigint {
  const { fxrpBalanceUBA, sweepMinUBA, keepUBA } = input;
  if (fxrpBalanceUBA < sweepMinUBA) return 0n;
  const excess = fxrpBalanceUBA - keepUBA;
  return excess > 0n ? excess : 0n;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Cotización y swap on-chain                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

interface BestQuote {
  feeTier: number;
  amountOutWei: bigint;
}

/** Mejor cotización FXRP→WFLR entre los fee tiers, probando QuoterV2 y V1. */
async function quoteBestTier(
  provider: ethers.Provider,
  quoterAddr: string,
  tokenIn: string,
  tokenOut: string,
  amountInUBA: bigint,
): Promise<BestQuote | null> {
  const v2 = new ethers.Contract(quoterAddr, QUOTER_V2_ABI, provider);
  const v1 = new ethers.Contract(quoterAddr, QUOTER_V1_ABI, provider);
  let best: BestQuote | null = null;
  for (const feeTier of FEE_TIERS) {
    let out: bigint | null = null;
    try {
      const r = await v2.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn: amountInUBA,
        fee: feeTier,
        sqrtPriceLimitX96: 0n,
      });
      out = BigInt(r[0] ?? r.amountOut ?? r);
    } catch {
      try {
        out = BigInt(await v1.quoteExactInputSingle.staticCall(tokenIn, tokenOut, feeTier, amountInUBA, 0n));
      } catch {
        /* tier sin pool o ABI que no casa — siguiente */
      }
    }
    if (out != null && out > 0n && (best == null || out > best.amountOutWei)) {
      best = { feeTier, amountOutWei: out };
    }
  }
  return best;
}

/** Ejecuta exactInputSingle probando la forma con deadline y la SwapRouter02.
 *  Simula (staticCall) SIEMPRE antes de firmar — invariante #11. */
async function swapExactInputSingle(
  wallet: ethers.Wallet,
  routerAddr: string,
  p: { tokenIn: string; tokenOut: string; feeTier: number; amountInUBA: bigint; minOutWei: bigint },
): Promise<ethers.TransactionReceipt> {
  const withDeadline = new ethers.Contract(routerAddr, ROUTER_WITH_DEADLINE_ABI, wallet);
  const router02 = new ethers.Contract(routerAddr, ROUTER_02_ABI, wallet);
  const common = {
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    fee: p.feeTier,
    recipient: wallet.address,
    amountIn: p.amountInUBA,
    amountOutMinimum: p.minOutWei,
    sqrtPriceLimitX96: 0n,
  };
  const candidates: Array<{ c: ethers.Contract; args: unknown }> = [
    { c: withDeadline, args: { ...common, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) } },
    { c: router02, args: common },
  ];
  let lastErr: unknown = new Error('router sin forma exactInputSingle conocida');
  for (const { c, args } of candidates) {
    try {
      await c.exactInputSingle.staticCall(args);
    } catch (e) {
      lastErr = e;
      continue; // esta forma no simula — probar la siguiente, no firmar
    }
    const tx = await c.exactInputSingle(args);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`el swap revirtió on-chain (tx ${tx.hash})`);
    return receipt;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* El chequeo de combustible — una pasada por tick del watcher                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Última vez que se avisó de la reserva de rescate (anti-repetición horaria). */
const rescueState = { alertedAt: 0 };

export interface RefuelOutcome {
  stage: 'refueled' | 'skipped' | 'starved' | 'failed';
  detail: string;
  swapTxHash?: string;
  fxrpInUBA?: bigint;
  flrOutWei?: bigint;
}

export interface SweepOutcome {
  amountUBA: bigint;
  txHash: string;
  to: string;
}

export interface FuelGauges {
  executor: string;
  flrWei: bigint;
  fxrpUBA: bigint;
  refuel: RefuelOutcome | null;
  sweep: SweepOutcome | null;
  /** Guardián FTSO del margen (Tramo 1) — null si la lectura falló este tick. */
  feeMargin: FeeMarginGauge | null;
  checkedAt: string;
}

function envFlr(name: string, defaultFlr: string): bigint {
  return ethers.parseEther(process.env[name] || defaultFlr);
}
function envFxrp(name: string, defaultFxrp: string): bigint {
  return ethers.parseUnits(process.env[name] || defaultFxrp, FXRP_DECIMALS);
}

/**
 * Una pasada de mantenimiento del depósito, pensada para el arranque de cada
 * tick del watcher (proactiva: corre aunque no haya mints pendientes, porque
 * "swapea antes de necesitarlo" es exactamente el punto).
 *
 *  1. Lee gauges (FLR + FXRP propios).
 *  2. Reserva de rescate: si no queda ni para el gas del swap salvavidas,
 *     CRITICAL y fuera — recarga manual, no quemar el resto.
 *  3. Refuel (tras FLARE_EXECUTOR_REFUEL_ENABLED): saldo < REFUEL_MIN →
 *     cotiza en SparkDEX V3, dimensiona hasta REFUEL_TARGET, approve exacto,
 *     swap con minOut de slippage acotado, unwrap WFLR→FLR.
 *  4. Sweep (tras FLARE_EXECUTOR_SWEEP_TO): FXRP > SWEEP_MIN → transfiere el
 *     exceso sobre KEEP_FXRP a la treasury. La piñata no crece.
 */
export async function checkExecutorFuel(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  log: Log = noop,
): Promise<FuelGauges> {
  const fxrpAddr = await resolveFxrpToken(provider);
  const fxrp = new ethers.Contract(fxrpAddr, ERC20_ABI, provider);
  const [flrWei, fxrpUBA] = await Promise.all([
    provider.getBalance(wallet.address),
    fxrp.balanceOf(wallet.address) as Promise<bigint>,
  ]);

  const gauges: FuelGauges = {
    executor: wallet.address,
    flrWei,
    fxrpUBA,
    refuel: null,
    sweep: null,
    feeMargin: null,
    checkedAt: new Date().toISOString(),
  };

  // Guardián del margen (Tramo 1) — best-effort, nunca aborta el tick.
  gauges.feeMargin = await checkFeeMargin(provider);

  // 2. Reserva dura de rescate: 3 txs (approve+swap+unwrap) caben de sobra
  // en 0.5 FLR a gas de Flare; por debajo ni el swap salvavidas es seguro.
  const rescueReserveWei = envFlr('FLARE_EXECUTOR_RESCUE_RESERVE_FLR', '0.5');
  if (flrWei < rescueReserveWei) {
    // Una vez por hora, no en cada tick: el tick corre cada minuto y un canal
    // que repite el mismo crítico 60 veces por hora se silencia — y entonces
    // no sirve el día que grita de verdad. El estado vigente sigue visible en
    // /app/admin (gauges + Sentinel) aunque el aviso no se repita.
    if (Date.now() - rescueState.alertedAt >= 3_600_000) {
      rescueState.alertedAt = Date.now();
      await executorAlert(
        'critical',
        `executor ${wallet.address} con ${ethers.formatEther(flrWei)} FLR — por debajo de la reserva de rescate ` +
          `(${ethers.formatEther(rescueReserveWei)} FLR): ni el swap de refuel es seguro.`,
        {
          key: 'fuel:rescue',
          facts: { executor: wallet.address, flr: ethers.formatEther(flrWei) },
          runbook:
            `RECARGA MANUAL YA: manda FLR a ${wallet.address}. Sin gas no se ejecuta ni un mint y los 0xFE firmados ` +
            'se quedan esperando (el XRP del usuario sigue a salvo en el Core Vault).',
        },
      );
    }
    return gauges;
  }
  rescueState.alertedAt = 0;

  gauges.refuel = await maybeRefuel(provider, wallet, fxrpAddr, flrWei, fxrpUBA, log);

  // Releer FXRP tras un refuel para no barrer lo recién presupuestado.
  const fxrpAfter: bigint =
    gauges.refuel?.stage === 'refueled' ? await fxrp.balanceOf(wallet.address) : fxrpUBA;
  gauges.sweep = await maybeSweepFxrp(wallet, fxrpAddr, fxrpAfter, log);
  gauges.fxrpUBA = fxrpAfter - (gauges.sweep?.amountUBA ?? 0n);
  return gauges;
}

async function maybeRefuel(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  fxrpAddr: string,
  flrWei: bigint,
  fxrpUBA: bigint,
  log: Log,
): Promise<RefuelOutcome | null> {
  if (process.env.FLARE_EXECUTOR_REFUEL_ENABLED !== 'true') return null;

  // Umbral ≫ fee FDC (~20 FLR/mint): repostar con 3 mints de margen, no en rojo.
  const minWei = envFlr('FLARE_EXECUTOR_REFUEL_MIN_FLR', '60');
  const targetWei = envFlr('FLARE_EXECUTOR_REFUEL_TARGET_FLR', '150');
  if (flrWei >= minWei) return { stage: 'skipped', detail: `saldo ${ethers.formatEther(flrWei)} FLR ≥ umbral` };

  if (fxrpUBA <= 0n) {
    await executorAlert(
      'critical',
      `refuel imposible: el executor no tiene FXRP que swapear (saldo ${ethers.formatEther(flrWei)} FLR ` +
        `< umbral ${ethers.formatEther(minWei)})`,
      {
        key: 'fuel:starved',
        runbook:
          `Manda FLR (o FXRP) a ${wallet.address}. Si el sweep se está llevando demasiado FXRP, sube ` +
          'FLARE_EXECUTOR_KEEP_FXRP en Railway para que quede buffer de trabajo.',
      },
    );
    return { stage: 'starved', detail: 'sin FXRP propio para repostar' };
  }

  const sparkdex = ALLOWLIST.contracts.sparkdex ?? {};
  const routerAddr = sparkdex.router;
  const quoterAddr = sparkdex.quoter;
  const wnatAddr = ALLOWLIST.contracts.flareSystem?.wNat;
  if (!routerAddr || !quoterAddr || !wnatAddr) {
    await executorAlert('critical', 'refuel sin venue: router/quoter/WNat ausentes del allowlist');
    return { stage: 'failed', detail: 'venue no configurado' };
  }

  try {
    const needWei = targetWei - flrWei;
    // Sondeo con una cantidad modesta para leer el tipo sin distorsión.
    const probeIn = fxrpUBA < ethers.parseUnits('10', FXRP_DECIMALS) ? fxrpUBA : ethers.parseUnits('10', FXRP_DECIMALS);
    const probe = await quoteBestTier(provider, quoterAddr, fxrpAddr, wnatAddr, probeIn);
    if (!probe) throw new Error('ningún pool FXRP/WFLR cotiza en SparkDEX V3');

    const amountIn = sizeRefuelAmountIn({
      needOutWei: needWei,
      probeInUBA: probeIn,
      probeOutWei: probe.amountOutWei,
      fxrpBalanceUBA: fxrpUBA,
      maxPerSwapUBA: envFxrp('FLARE_EXECUTOR_REFUEL_MAX_FXRP', '200'),
    });
    if (amountIn <= 0n) throw new Error('el sizing del refuel dio 0 — revisar saldos/umbral');

    // Cotización real del amountIn definitivo → minOut con slippage acotado.
    const quote = await quoteBestTier(provider, quoterAddr, fxrpAddr, wnatAddr, amountIn);
    if (!quote) throw new Error('la cotización del amountIn definitivo falló');
    const slippageBps = Number(process.env.FLARE_EXECUTOR_REFUEL_SLIPPAGE_BPS || 100);
    const minOut = minOutForQuote(quote.amountOutWei, slippageBps);

    log(
      `[fuel] refuel: ${ethers.formatUnits(amountIn, FXRP_DECIMALS)} FXRP → ≥${ethers.formatEther(minOut)} WFLR ` +
        `(tier ${quote.feeTier}, slippage máx ${slippageBps} bps)`,
    );

    // Approve exacto (simulado antes de firmar, como todo).
    const fxrpSigner = new ethers.Contract(fxrpAddr, ERC20_ABI, wallet);
    const allowance: bigint = await fxrpSigner.allowance(wallet.address, routerAddr);
    if (allowance < amountIn) {
      await fxrpSigner.approve.staticCall(routerAddr, amountIn);
      const approveTx = await fxrpSigner.approve(routerAddr, amountIn);
      await approveTx.wait();
    }

    const receipt = await swapExactInputSingle(wallet, routerAddr, {
      tokenIn: fxrpAddr,
      tokenOut: wnatAddr,
      feeTier: quote.feeTier,
      amountInUBA: amountIn,
      minOutWei: minOut,
    });

    // Unwrap TODO el WFLR del executor (si algo quedó de antes, también sirve de gas).
    const wnat = new ethers.Contract(wnatAddr, WNAT_ABI, wallet);
    const wflrBal: bigint = await wnat.balanceOf(wallet.address);
    if (wflrBal > 0n) {
      await wnat.withdraw.staticCall(wflrBal);
      const unwrapTx = await wnat.withdraw(wflrBal);
      await unwrapTx.wait();
    }

    const flrAfter = await provider.getBalance(wallet.address);
    await executorAlert(
      'info',
      `refuel OK: ${ethers.formatUnits(amountIn, FXRP_DECIMALS)} FXRP → FLR (swap ${receipt.hash}); ` +
        `saldo ${ethers.formatEther(flrAfter)} FLR`,
    );
    return {
      stage: 'refueled',
      detail: `saldo ${ethers.formatEther(flrAfter)} FLR tras el swap`,
      swapTxHash: receipt.hash,
      fxrpInUBA: amountIn,
      flrOutWei: flrAfter - flrWei,
    };
  } catch (e) {
    const detail = (e as Error).message;
    await executorAlert(
      'critical',
      `refuel FALLÓ (saldo ${ethers.formatEther(flrWei)} FLR, umbral ${ethers.formatEther(minWei)}): ${detail}`,
      {
        key: 'fuel:refuel-failed',
        runbook:
          `Recarga FLR a mano en ${wallet.address} para no depender del swap. Si el fallo habla de cotización o pool, ` +
          'SparkDEX no tiene liquidez FXRP/WFLR ahora mismo: reintentará solo en el próximo tick.',
      },
    );
    return { stage: 'failed', detail };
  }
}

async function maybeSweepFxrp(
  wallet: ethers.Wallet,
  fxrpAddr: string,
  fxrpUBA: bigint,
  log: Log,
): Promise<SweepOutcome | null> {
  const to = process.env.FLARE_EXECUTOR_SWEEP_TO;
  if (!to || !ethers.isAddress(to)) return null;
  if (to.toLowerCase() === wallet.address.toLowerCase()) return null;

  const amount = planFxrpSweep({
    fxrpBalanceUBA: fxrpUBA,
    sweepMinUBA: envFxrp('FLARE_EXECUTOR_SWEEP_MIN_FXRP', '100'),
    keepUBA: envFxrp('FLARE_EXECUTOR_KEEP_FXRP', '50'),
  });
  if (amount <= 0n) return null;

  try {
    const fxrp = new ethers.Contract(fxrpAddr, ERC20_ABI, wallet);
    await fxrp.transfer.staticCall(to, amount);
    const tx = await fxrp.transfer(to, amount);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`transfer revirtió (tx ${tx.hash})`);
    log(`[fuel] sweep: ${ethers.formatUnits(amount, FXRP_DECIMALS)} FXRP → treasury ${to} (tx ${receipt.hash})`);
    await executorAlert('info', `sweep OK: ${ethers.formatUnits(amount, FXRP_DECIMALS)} FXRP → ${to} (tx ${receipt.hash})`);
    return { amountUBA: amount, txHash: receipt.hash, to };
  } catch (e) {
    await executorAlert('warn', `sweep de FXRP a la treasury falló: ${(e as Error).message}`);
    return null;
  }
}

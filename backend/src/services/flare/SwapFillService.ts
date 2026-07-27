/**
 * SwapFillService — el auto-completado de cantidades exactas (swap-fill).
 *
 * Diseño: docs/context/Astryum_AutoCompletado_SwapFill_2026-07-26.md (variante A).
 * Cuando un flujo necesita una CANTIDAD EXACTA de un activo que el usuario no
 * tiene entera (el repay full con la deuda devengando interés es el caso
 * canónico — incidente 2026-07-26, shortfall 0,000291 → revert), Astryum
 * compila UNA CALL MÁS en el batch que el usuario ya firma: un swap
 * `exactOutput` DEL PROPIO USUARIO en SparkDEX que compra exactamente el hueco.
 * El principal viaja usuario→pool→usuario; Astryum solo compila (invariantes
 * #1/#6/#8). Jamás fondos por wallets de Astryum.
 *
 * Hechos verificados on-chain 2026-07-26 (no supuestos):
 *  - El router SparkDEX (0x8a1E…2781) es la forma V3 CLÁSICA con deadline:
 *    selector `exactOutputSingle` 0xdb3e2198 presente en el bytecode; la forma
 *    router02 (0x5023b4df) NO está. El calldata unsigned nace con esa forma.
 *  - Pools vivos hacia USDT0: FXRP (tiers 500/3000/10000) y WFLR (100/500/
 *    3000/10000) — se cotiza el importe real y gana el tier más barato.
 *
 * Kill-switch: SWAP_FILL_ENABLED=false lo apaga sin deploy. Vive DENTRO del
 * módulo flare-demo, ya gated por su propio flag/geofence (invariante #10 —
 * apagable en runtime; el gate de módulo es el de siempre).
 */

import { ethers } from 'ethers';
import { ALLOWLIST } from '../../config/allowlist.config';
import { resolveFxrpToken } from '../../connectors/protocols/flare/FlareDirectMintService';

/** Misma forma que EncodedAction de los adapters — to/calldata/value unsigned. */
export interface FillCall {
  to: string;
  calldata: string;
  value: string;
}

export type FillAsset = 'FLR' | 'FXRP';

export interface FillQuote {
  asset: FillAsset;
  /** El token que ENTRA al pool (WNat para FLR — el wrap va delante). */
  tokenIn: string;
  tokenInDecimals: number;
  feeTier: number;
  /** Cotización exacta del quoter (base units de tokenIn). */
  amountInQuoted: bigint;
  /** Tope disclosed que el swap puede gastar: cotización + slippage. */
  amountInMax: bigint;
}

export interface FillOption extends FillQuote {
  /** Saldo del usuario en ese activo (FLR nativo para 'FLR'). null = ilegible. */
  balance: bigint | null;
  /** ¿El saldo cubre amountInMax (+ margen de gas si es FLR nativo)? */
  sufficient: boolean;
}

/* ── Config ── */

/** Apagable en runtime sin deploy (SWAP_FILL_ENABLED=false). */
export function swapFillEnabled(): boolean {
  return process.env.SWAP_FILL_ENABLED !== 'false';
}

/** Slippage máximo del fill en % (tope de amountInMaximum, disclosed). */
export function fillSlippagePct(): number {
  const n = Number(process.env.SWAP_FILL_SLIPPAGE_PCT || 1);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 1;
}

/** Vida del calldata del swap (deadline del router) — el usuario firma con calma. */
export function fillDeadlineMinutes(): number {
  const n = Number(process.env.SWAP_FILL_DEADLINE_MIN || 45);
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : 45;
}

/** Margen de FLR nativo que se exige APARTE del wrap (el gas lo paga la misma wallet). */
const NATIVE_GAS_MARGIN_WEI = ethers.parseEther('1');

const FEE_TIERS = [100, 500, 3000, 10000];

const QUOTER_V2_OUT_ABI = [
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];
const QUOTER_V1_OUT_ABI = [
  'function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) returns (uint256 amountIn)',
];
// Forma V3 clásica CON deadline — la única presente en el bytecode del router
// SparkDEX (0xdb3e2198 verificado 2026-07-26). No adivinar formas.
const ROUTER_EXACT_OUT_ABI = [
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)',
];
const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];
const WNAT_DEPOSIT_ABI = ['function deposit() payable'];

function sparkdex(): { router: string; quoter: string } {
  return {
    router: ALLOWLIST.contracts.sparkdex.router,
    quoter: ALLOWLIST.contracts.sparkdex.quoter,
  };
}

function wNat(): string {
  return ALLOWLIST.contracts.flareSystem.wNat;
}

/** Tope de gasto del swap: cotización + slippage, con techo SIEMPRE > cotización
 *  (los huecos de polvo cotizan unidades sueltas y el redondeo entero se comería
 *  el margen). Puro — testeable sin chain. */
export function computeMaxIn(amountInQuoted: bigint, slippagePct: number): bigint {
  if (amountInQuoted <= 0n) throw new Error('SWAP_FILL_BAD_QUOTE: amountInQuoted must be > 0');
  const bps = BigInt(Math.round(slippagePct * 100));
  const withSlippage = (amountInQuoted * (10_000n + bps) + 9_999n) / 10_000n; // ceil
  return withSlippage > amountInQuoted ? withSlippage : amountInQuoted + 1n;
}

/** Mejor cotización exactOutput (MÍNIMO amountIn) entre los fee tiers, probando
 *  QuoterV2 y V1 por staticCall (inofensivo). null = ningún pool cotiza. */
export async function quoteFillExactOutput(
  provider: ethers.Provider,
  params: { tokenIn: string; tokenOut: string; amountOutBase: bigint },
): Promise<{ feeTier: number; amountInQuoted: bigint } | null> {
  const { quoter } = sparkdex();
  const v2 = new ethers.Contract(quoter, QUOTER_V2_OUT_ABI, provider);
  const v1 = new ethers.Contract(quoter, QUOTER_V1_OUT_ABI, provider);
  let best: { feeTier: number; amountInQuoted: bigint } | null = null;
  for (const feeTier of FEE_TIERS) {
    let amountIn: bigint | null = null;
    try {
      const r = await v2.quoteExactOutputSingle.staticCall({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amount: params.amountOutBase,
        fee: feeTier,
        sqrtPriceLimitX96: 0n,
      });
      amountIn = BigInt(r[0] ?? r.amountIn ?? r);
    } catch {
      try {
        amountIn = BigInt(
          await v1.quoteExactOutputSingle.staticCall(
            params.tokenIn,
            params.tokenOut,
            feeTier,
            params.amountOutBase,
            0n,
          ),
        );
      } catch {
        /* tier sin pool o sin liquidez para este importe — siguiente */
      }
    }
    if (amountIn != null && amountIn > 0n && (best == null || amountIn < best.amountInQuoted)) {
      best = { feeTier, amountInQuoted: amountIn };
    }
  }
  return best;
}

/**
 * Las opciones de fill de un holder para cubrir `gapUsdt0Base`: una por activo
 * con ruta viva, cotizada al importe REAL y con el saldo del holder al lado —
 * el picker del usuario (§4b del doc: él elige el activo). Best-effort por
 * activo: un quoter caído no tumba las demás opciones.
 */
export async function quoteFillOptions(
  provider: ethers.Provider,
  params: {
    holder: string;
    gapUsdt0Base: bigint;
    usdt0Token: string;
    /** Qué activos ofrecer (el rail PA solo tiene FXRP; el EVM ambos). */
    assets: FillAsset[];
  },
): Promise<FillOption[]> {
  if (params.gapUsdt0Base <= 0n) return [];
  const slippage = fillSlippagePct();
  const options: FillOption[] = [];

  for (const asset of params.assets) {
    try {
      const isNative = asset === 'FLR';
      const tokenIn = isNative ? wNat() : await resolveFxrpToken(provider);
      const quote = await quoteFillExactOutput(provider, {
        tokenIn,
        tokenOut: params.usdt0Token,
        amountOutBase: params.gapUsdt0Base,
      });
      if (!quote) continue; // sin pool para este activo — no se ofrece (jamás una ruta inventada)

      const amountInMax = computeMaxIn(quote.amountInQuoted, slippage);
      let balance: bigint | null = null;
      try {
        balance = isNative
          ? await provider.getBalance(params.holder)
          : BigInt(await new ethers.Contract(tokenIn, ERC20_BALANCE_ABI, provider).balanceOf(params.holder));
      } catch {
        balance = null;
      }
      const needed = isNative ? amountInMax + NATIVE_GAS_MARGIN_WEI : amountInMax;
      options.push({
        asset,
        tokenIn,
        tokenInDecimals: isNative ? 18 : 6,
        feeTier: quote.feeTier,
        amountInQuoted: quote.amountInQuoted,
        amountInMax,
        balance,
        sufficient: balance != null && balance >= needed,
      });
    } catch {
      /* activo ilegible (p.ej. FXRP no resoluble) — las demás opciones siguen */
    }
  }
  return options;
}

/**
 * Las calls UNSIGNED del fill — se anteponen al [approve, repay] del batch:
 *   FLR  → [ WNat.deposit{value: max}, approve(WNat→router, max), exactOutputSingle ]
 *   FXRP → [ approve(FXRP→router, max), exactOutputSingle ]
 * recipient = la wallet/PA del usuario: el USDT0 comprado aterriza en SUS manos
 * y el repay lo pulla de ahí. El sobrante del tope (≤ slippage) se queda en su
 * wallet (como WFLR en el camino nativo — disclosed). Astryum no firma nada.
 */
export function buildFillSwapCalls(params: {
  quote: FillQuote;
  usdt0Token: string;
  /** El USDT0 EXACTO que el swap debe entregar (el hueco — mismo valor cotizado). */
  amountOutBase: bigint;
  /** Quien recibe el USDT0 del swap = quien firma/ejecuta el batch (wallet EVM o PA). */
  recipient: string;
  /** Epoch seconds del deadline del router (por defecto ahora + fillDeadlineMinutes). */
  deadline?: number;
}): FillCall[] {
  if (params.amountOutBase <= 0n) throw new Error('SWAP_FILL_BAD_AMOUNT_OUT: amountOutBase must be > 0');
  const { router } = sparkdex();
  const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
  const routerIface = new ethers.Interface(ROUTER_EXACT_OUT_ABI);
  const wnatIface = new ethers.Interface(WNAT_DEPOSIT_ABI);
  const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + fillDeadlineMinutes() * 60;
  const q = params.quote;

  const swap: FillCall = {
    to: router,
    calldata: routerIface.encodeFunctionData('exactOutputSingle', [
      {
        tokenIn: q.tokenIn,
        tokenOut: params.usdt0Token,
        fee: q.feeTier,
        recipient: ethers.getAddress(params.recipient),
        deadline,
        amountOut: params.amountOutBase,
        amountInMaximum: q.amountInMax,
        sqrtPriceLimitX96: 0n,
      },
    ]),
    value: '0',
  };
  const approve: FillCall = {
    to: q.tokenIn,
    calldata: erc20.encodeFunctionData('approve', [router, q.amountInMax]),
    value: '0',
  };
  if (q.asset === 'FLR') {
    const wrap: FillCall = {
      to: wNat(),
      calldata: wnatIface.encodeFunctionData('deposit', []),
      value: q.amountInMax.toString(),
    };
    return [wrap, approve, swap];
  }
  return [approve, swap];
}

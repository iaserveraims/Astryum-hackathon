// SwapFillService — el auto-completado de cantidades exactas (variante A del
// doc 2026-07-26). Encode-only: composición del swap leg y la matemática del
// tope; las cotizaciones on-chain no se tocan aquí.
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  resolveFxrpToken: jest.fn(async () => '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE'),
}));

import { ethers } from 'ethers';
import { ALLOWLIST } from '../../../config/allowlist.config';
import { buildFillSwapCalls, computeMaxIn, swapFillEnabled, type FillQuote } from '../SwapFillService';

const ROUTER = ALLOWLIST.contracts.sparkdex.router;
const WNAT = ALLOWLIST.contracts.flareSystem.wNat;
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const USDT0 = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D';
const RECIPIENT = '0x1234567890AbcdEF1234567890aBcdef12345678';

const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
const ROUTER_IFACE = new ethers.Interface([
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)',
]);
const WNAT_IFACE = new ethers.Interface(['function deposit() payable']);

function fxrpQuote(overrides: Partial<FillQuote> = {}): FillQuote {
  return {
    asset: 'FXRP',
    tokenIn: FXRP,
    tokenInDecimals: 6,
    feeTier: 3000,
    amountInQuoted: 273n,
    amountInMax: computeMaxIn(273n, 1),
    ...overrides,
  };
}

describe('computeMaxIn — el tope del fill (cotización + slippage, ceil)', () => {
  test('1% sobre 10000 = 10100', () => {
    expect(computeMaxIn(10_000n, 1)).toBe(10_100n);
  });

  test('redondeo hacia arriba (ceil), nunca a la baja', () => {
    // 101 * 1.01 = 102.01 → 103
    expect(computeMaxIn(101n, 1)).toBe(103n);
  });

  test('cotizaciones de polvo: el tope SIEMPRE supera la cotización', () => {
    // 1 * 1.01 = 1.01 → ceil 2 — sin esto, el margen entero se comería el redondeo
    expect(computeMaxIn(1n, 1)).toBeGreaterThan(1n);
  });

  test('rechaza cotización no positiva', () => {
    expect(() => computeMaxIn(0n, 1)).toThrow(/SWAP_FILL_BAD_QUOTE/);
  });
});

describe('buildFillSwapCalls — la composición del swap leg (unsigned)', () => {
  test('FXRP: [approve(router), exactOutputSingle] con el hueco exacto y el tope', () => {
    const quote = fxrpQuote();
    const calls = buildFillSwapCalls({
      quote,
      usdt0Token: USDT0,
      amountOutBase: 400n,
      recipient: RECIPIENT,
      deadline: 1_900_000_000,
    });
    expect(calls).toHaveLength(2);

    // [0] approve FXRP → router, por el TOPE (jamás infinito)
    expect(calls[0].to.toLowerCase()).toBe(FXRP.toLowerCase());
    const approve = ERC20.parseTransaction({ data: calls[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0].toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(approve?.args[1]).toBe(quote.amountInMax);
    expect(calls[0].value).toBe('0');

    // [1] exactOutputSingle — forma V3 clásica con deadline (0xdb3e2198,
    // la única en el bytecode del router SparkDEX, verificado 2026-07-26)
    expect(calls[1].to.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(calls[1].calldata.slice(0, 10)).toBe('0xdb3e2198');
    const swap = ROUTER_IFACE.parseTransaction({ data: calls[1].calldata });
    const p = swap?.args[0];
    expect(String(p.tokenIn).toLowerCase()).toBe(FXRP.toLowerCase());
    expect(String(p.tokenOut).toLowerCase()).toBe(USDT0.toLowerCase());
    expect(Number(p.fee)).toBe(3000);
    expect(String(p.recipient).toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(p.amountOut).toBe(400n); // el hueco EXACTO — exactOutput, no exactInput
    expect(p.amountInMaximum).toBe(quote.amountInMax);
    expect(Number(p.deadline)).toBe(1_900_000_000);
    expect(calls[1].value).toBe('0');
  });

  test('FLR: [wrap(value=tope), approve(WNat), exactOutputSingle] — el wrap paga el value', () => {
    const maxIn = computeMaxIn(ethers.parseEther('0.047'), 1);
    const quote: FillQuote = {
      asset: 'FLR',
      tokenIn: WNAT,
      tokenInDecimals: 18,
      feeTier: 500,
      amountInQuoted: ethers.parseEther('0.047'),
      amountInMax: maxIn,
    };
    const calls = buildFillSwapCalls({
      quote,
      usdt0Token: USDT0,
      amountOutBase: 300n,
      recipient: RECIPIENT,
      deadline: 1_900_000_000,
    });
    expect(calls).toHaveLength(3);

    // [0] WNat.deposit con value = tope (lo no gastado queda como WFLR del usuario)
    expect(calls[0].to.toLowerCase()).toBe(WNAT.toLowerCase());
    const dep = WNAT_IFACE.parseTransaction({ data: calls[0].calldata });
    expect(dep?.name).toBe('deposit');
    expect(calls[0].value).toBe(maxIn.toString());

    // [1] approve WNat → router
    expect(calls[1].to.toLowerCase()).toBe(WNAT.toLowerCase());
    const approve = ERC20.parseTransaction({ data: calls[1].calldata });
    expect(approve?.args[0].toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(approve?.args[1]).toBe(maxIn);

    // [2] swap desde WNat
    const swap = ROUTER_IFACE.parseTransaction({ data: calls[2].calldata });
    expect(String(swap?.args[0].tokenIn).toLowerCase()).toBe(WNAT.toLowerCase());
    expect(swap?.args[0].amountOut).toBe(300n);
  });

  test('rechaza un hueco no positivo', () => {
    expect(() =>
      buildFillSwapCalls({ quote: fxrpQuote(), usdt0Token: USDT0, amountOutBase: 0n, recipient: RECIPIENT }),
    ).toThrow(/SWAP_FILL_BAD_AMOUNT_OUT/);
  });

  test('sin deadline explícito usa ahora + ventana (el usuario firma con calma)', () => {
    const calls = buildFillSwapCalls({
      quote: fxrpQuote(),
      usdt0Token: USDT0,
      amountOutBase: 400n,
      recipient: RECIPIENT,
    });
    const swap = ROUTER_IFACE.parseTransaction({ data: calls[1].calldata });
    expect(Number(swap?.args[0].deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000) + 5 * 60);
  });
});

describe('swapFillEnabled — kill-switch en runtime', () => {
  const prev = process.env.SWAP_FILL_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.SWAP_FILL_ENABLED;
    else process.env.SWAP_FILL_ENABLED = prev;
  });

  test('encendido por defecto (el módulo flare-demo ya está tras su flag)', () => {
    delete process.env.SWAP_FILL_ENABLED;
    expect(swapFillEnabled()).toBe(true);
  });

  test('SWAP_FILL_ENABLED=false lo apaga sin deploy', () => {
    process.env.SWAP_FILL_ENABLED = 'false';
    expect(swapFillEnabled()).toBe(false);
  });
});

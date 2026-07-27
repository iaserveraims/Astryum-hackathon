// Settable runner so getMetrics tests can intercept eth_call and record the
// target contract. Default {} keeps the encode-only tests provider-free.
let mockHttpProvider: unknown = {};
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => mockHttpProvider }) },
}));

import { ethers } from 'ethers';
import { KineticAdapter } from '../KineticAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';
import type { NormalizedPosition } from '../../../../types/domain/Position';

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const PRIMARY_COMPTROLLER = '0x8041680Fb73E1Fe5F851e76233DCDfA0f2D2D7c8';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const KUSDT0_PRIMARY = '0x76809aBd690B77488Ffb5277e0a8300a7e77B779';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';

const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
const KTOKEN = new ethers.Interface([
  'function mint(uint256) returns (uint256)',
  'function borrow(uint256) returns (uint256)',
  'function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)',
  'function redeemUnderlying(uint256) returns (uint256)',
]);
const COMPTROLLER = new ethers.Interface(['function enterMarkets(address[]) returns (uint256[])']);

// Test fixture only — the REAL USDT0 underlying is resolved on-chain via
// kUSDT0_ISO.underlying() by the route (invariant #3), not hardcoded here.
const USDT0_TOKEN = '0x00000000000000000000000000000000dEAd0001';
const BORROWER_PA = '0x1234567890AbcdEF1234567890aBcdef12345678';

const SUPPLY = 19_680_300n;
const BORROW = 11_737_330n;

function setIsoEnv() {
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  process.env.KINETIC_KUSDT0 = KUSDT0_PRIMARY; // primary — must NOT be targeted
  process.env.FXRP_TOKEN = FXRP;
  resetAddressCache();
}

describe('KineticAdapter.buildIsoSupplyBorrowBatch (E1 batch)', () => {
  beforeEach(() => setIsoEnv());

  test('produces [approve, mint, enterMarkets, borrow] against ISO contracts', async () => {
    const batch = await new KineticAdapter().buildIsoSupplyBorrowBatch({ supplyUBA: SUPPLY, borrowUsdt0: BORROW });
    expect(batch).toHaveLength(4);

    // [0] approve FXRP → kFXRP_ISO
    expect(batch[0].to.toLowerCase()).toBe(FXRP.toLowerCase());
    const approve = ERC20.parseTransaction({ data: batch[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0].toLowerCase()).toBe(KFXRP_ISO.toLowerCase());
    expect(approve?.args[1]).toBe(SUPPLY);

    // [1] mint(supplyUBA) on kFXRP_ISO
    expect(batch[1].to.toLowerCase()).toBe(KFXRP_ISO.toLowerCase());
    const mint = KTOKEN.parseTransaction({ data: batch[1].calldata });
    expect(mint?.name).toBe('mint');
    expect(mint?.args[0]).toBe(SUPPLY);

    // [2] enterMarkets([kFXRP_ISO]) on ISO comptroller
    expect(batch[2].to.toLowerCase()).toBe(ISO_COMPTROLLER.toLowerCase());
    const enter = COMPTROLLER.parseTransaction({ data: batch[2].calldata });
    expect(enter?.name).toBe('enterMarkets');
    expect(enter?.args[0][0].toLowerCase()).toBe(KFXRP_ISO.toLowerCase());

    // [3] borrow(usdt0) on kUSDT0 ISO — NOT primary
    expect(batch[3].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(batch[3].to.toLowerCase()).not.toBe(KUSDT0_PRIMARY.toLowerCase());
    const borrow = KTOKEN.parseTransaction({ data: batch[3].calldata });
    expect(borrow?.name).toBe('borrow');
    expect(borrow?.args[0]).toBe(BORROW);

    // every call non-payable
    expect(batch.every((c) => c.value === '0')).toBe(true);
  });

  test('throws when an ISO address is unconfigured', async () => {
    delete process.env.KINETIC_KUSDT0_ISO;
    resetAddressCache();
    await expect(
      new KineticAdapter().buildIsoSupplyBorrowBatch({ supplyUBA: SUPPLY, borrowUsdt0: BORROW }),
    ).rejects.toThrow(/KINETIC_ISO_NOT_CONFIGURED.*KINETIC_KUSDT0_ISO/);
  });

  test('rejects non-positive amounts', async () => {
    await expect(
      new KineticAdapter().buildIsoSupplyBorrowBatch({ supplyUBA: 0n, borrowUsdt0: BORROW }),
    ).rejects.toThrow(/BAD_SUPPLY/);
    await expect(
      new KineticAdapter().buildIsoSupplyBorrowBatch({ supplyUBA: SUPPLY, borrowUsdt0: 0n }),
    ).rejects.toThrow(/BAD_BORROW/);
  });
});

describe('KineticAdapter.buildIsoRepayBehalfBatch (A1 repay, Cable 2)', () => {
  beforeEach(() => setIsoEnv());

  const REPAY = 11_737_330n;

  test('produces [approve, repayBorrowBehalf] against ISO USDT0 contracts', async () => {
    const batch = await new KineticAdapter().buildIsoRepayBehalfBatch({
      borrower: BORROWER_PA,
      repayUsdt0: REPAY,
      usdt0Token: USDT0_TOKEN,
    });
    expect(batch).toHaveLength(2);

    // [0] approve USDT0 → kUSDT0_ISO
    expect(batch[0].to.toLowerCase()).toBe(USDT0_TOKEN.toLowerCase());
    const approve = ERC20.parseTransaction({ data: batch[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0].toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(approve?.args[1]).toBe(REPAY);

    // [1] repayBorrowBehalf(borrower, repay) on kUSDT0 ISO — NOT primary
    expect(batch[1].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(batch[1].to.toLowerCase()).not.toBe(KUSDT0_PRIMARY.toLowerCase());
    const repay = KTOKEN.parseTransaction({ data: batch[1].calldata });
    expect(repay?.name).toBe('repayBorrowBehalf');
    expect(repay?.args[0].toLowerCase()).toBe(BORROWER_PA.toLowerCase());
    expect(repay?.args[1]).toBe(REPAY);
    // selector 0x2608f818 (verified in kUSDT0_ISO bytecode)
    expect(batch[1].calldata.slice(0, 10)).toBe('0x2608f818');

    // both calls non-payable
    expect(batch.every((c) => c.value === '0')).toBe(true);
  });

  test('throws when kUSDT0_ISO is unconfigured', async () => {
    delete process.env.KINETIC_KUSDT0_ISO;
    resetAddressCache();
    await expect(
      new KineticAdapter().buildIsoRepayBehalfBatch({ borrower: BORROWER_PA, repayUsdt0: REPAY, usdt0Token: USDT0_TOKEN }),
    ).rejects.toThrow(/KINETIC_ISO_NOT_CONFIGURED.*KINETIC_KUSDT0_ISO/);
  });

  test('rejects bad borrower / token / amount (never guesses)', async () => {
    await expect(
      new KineticAdapter().buildIsoRepayBehalfBatch({ borrower: 'not-an-address', repayUsdt0: REPAY, usdt0Token: USDT0_TOKEN }),
    ).rejects.toThrow(/BAD_BORROWER/);
    await expect(
      new KineticAdapter().buildIsoRepayBehalfBatch({ borrower: BORROWER_PA, repayUsdt0: REPAY, usdt0Token: '0xnope' }),
    ).rejects.toThrow(/BAD_USDT0_TOKEN/);
    await expect(
      new KineticAdapter().buildIsoRepayBehalfBatch({ borrower: BORROWER_PA, repayUsdt0: 0n, usdt0Token: USDT0_TOKEN }),
    ).rejects.toThrow(/BAD_REPAY/);
  });

  // uint(-1) = "toda la deuda VIVA al ejecutar" — el contrato la resuelve él
  // mismo (CErc20Delegate verificado 2026-07-26). Es el cierre-sin-polvo del
  // swap-fill: el fill compra hueco+colchón y el pull toma la deuda del bloque
  // de la firma. El approve acompaña FINITO — jamás un approve infinito.
  test('MaxUint256 repay: approve FINITO (deuda+colchón), repay uint(-1)', async () => {
    const APPROVE_CAP = 1_098_600n; // deuda de ahora + colchón de devengo
    const batch = await new KineticAdapter().buildIsoRepayBehalfBatch({
      borrower: BORROWER_PA,
      repayUsdt0: ethers.MaxUint256,
      usdt0Token: USDT0_TOKEN,
      approveUsdt0: APPROVE_CAP,
    });
    const approve = ERC20.parseTransaction({ data: batch[0].calldata });
    expect(approve?.args[1]).toBe(APPROVE_CAP); // finito
    const repay = KTOKEN.parseTransaction({ data: batch[1].calldata });
    expect(repay?.args[1]).toBe(ethers.MaxUint256); // la deuda viva, resuelta on-chain
  });

  test('MaxUint256 repay SIN approve finito → rechazado (sería approve infinito)', async () => {
    await expect(
      new KineticAdapter().buildIsoRepayBehalfBatch({
        borrower: BORROWER_PA,
        repayUsdt0: ethers.MaxUint256,
        usdt0Token: USDT0_TOKEN,
      }),
    ).rejects.toThrow(/MAX_REPAY_NEEDS_FINITE_APPROVE/);
  });
});

describe('KineticAdapter ISO supply/withdraw builders (carry + protection/DERISK)', () => {
  beforeEach(() => setIsoEnv());
  const AMOUNT = 11_737_330n;

  test('buildIsoSupplyUsdt0Batch → [approve, mint] against kUSDT0 ISO', async () => {
    const batch = await new KineticAdapter().buildIsoSupplyUsdt0Batch({ amountUsdt0: AMOUNT, usdt0Token: USDT0_TOKEN });
    expect(batch).toHaveLength(2);
    expect(batch[0].to.toLowerCase()).toBe(USDT0_TOKEN.toLowerCase());
    const approve = ERC20.parseTransaction({ data: batch[0].calldata });
    expect(approve?.args[0].toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(approve?.args[1]).toBe(AMOUNT);
    expect(batch[1].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    const mint = KTOKEN.parseTransaction({ data: batch[1].calldata });
    expect(mint?.name).toBe('mint');
    expect(mint?.args[0]).toBe(AMOUNT);
  });

  test('buildIsoWithdrawUsdt0 → [redeemUnderlying] on kUSDT0 ISO (not primary)', async () => {
    const batch = await new KineticAdapter().buildIsoWithdrawUsdt0({ amountUsdt0: AMOUNT });
    expect(batch).toHaveLength(1);
    expect(batch[0].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(batch[0].to.toLowerCase()).not.toBe(KUSDT0_PRIMARY.toLowerCase());
    const redeem = KTOKEN.parseTransaction({ data: batch[0].calldata });
    expect(redeem?.name).toBe('redeemUnderlying');
    expect(redeem?.args[0]).toBe(AMOUNT);
  });

  test('buildIsoWithdrawFxrp → [redeemUnderlying] on kFXRP ISO', async () => {
    const batch = await new KineticAdapter().buildIsoWithdrawFxrp({ amountFxrp: AMOUNT });
    expect(batch).toHaveLength(1);
    expect(batch[0].to.toLowerCase()).toBe(KFXRP_ISO.toLowerCase());
    const redeem = KTOKEN.parseTransaction({ data: batch[0].calldata });
    expect(redeem?.name).toBe('redeemUnderlying');
    expect(redeem?.args[0]).toBe(AMOUNT);
  });

  test('buildIsoSupplyFxrpBatch → [approve, mint] on kFXRP ISO, no borrow/enterMarkets', async () => {
    const batch = await new KineticAdapter().buildIsoSupplyFxrpBatch({ supplyUBA: SUPPLY });
    expect(batch).toHaveLength(2);

    // [0] approve FXRP → kFXRP_ISO
    expect(batch[0].to.toLowerCase()).toBe(FXRP.toLowerCase());
    const approve = ERC20.parseTransaction({ data: batch[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0].toLowerCase()).toBe(KFXRP_ISO.toLowerCase());
    expect(approve?.args[1]).toBe(SUPPLY);

    // [1] mint(supplyUBA) on kFXRP_ISO — plain supply, no debt
    expect(batch[1].to.toLowerCase()).toBe(KFXRP_ISO.toLowerCase());
    const mint = KTOKEN.parseTransaction({ data: batch[1].calldata });
    expect(mint?.name).toBe('mint');
    expect(mint?.args[0]).toBe(SUPPLY);

    // NO borrow (kUSDT0 ISO) and NO enterMarkets (comptroller) — lend-only
    const targets = batch.map((c) => c.to.toLowerCase());
    expect(targets).not.toContain(KUSDT0_ISO.toLowerCase());
    expect(targets).not.toContain(ISO_COMPTROLLER.toLowerCase());
    expect(batch.every((c) => c.value === '0')).toBe(true);
  });

  test('buildIsoSupplyFxrpBatch rejects non-positive / unconfigured (never guesses)', async () => {
    await expect(new KineticAdapter().buildIsoSupplyFxrpBatch({ supplyUBA: 0n })).rejects.toThrow(/BAD_SUPPLY/);
    delete process.env.KINETIC_KFXRP_ISO;
    resetAddressCache();
    await expect(
      new KineticAdapter().buildIsoSupplyFxrpBatch({ supplyUBA: SUPPLY }),
    ).rejects.toThrow(/KINETIC_ISO_NOT_CONFIGURED.*KINETIC_KFXRP_ISO/);
  });

  test('reject when unconfigured / non-positive', async () => {
    await expect(new KineticAdapter().buildIsoWithdrawUsdt0({ amountUsdt0: 0n })).rejects.toThrow(/BAD_WITHDRAW/);
    await expect(new KineticAdapter().buildIsoWithdrawFxrp({ amountFxrp: 0n })).rejects.toThrow(/BAD_WITHDRAW/);
    await expect(new KineticAdapter().buildIsoSupplyUsdt0Batch({ amountUsdt0: 0n, usdt0Token: USDT0_TOKEN })).rejects.toThrow(/BAD_SUPPLY/);
    delete process.env.KINETIC_KFXRP_ISO;
    resetAddressCache();
    await expect(new KineticAdapter().buildIsoWithdrawFxrp({ amountFxrp: AMOUNT })).rejects.toThrow(/KINETIC_ISO_NOT_CONFIGURED.*KINETIC_KFXRP_ISO/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMetrics — HF reads must target the comptroller the position lives on.
// ISO positions (kFXRP_ISO / kUSDT0_ISO) live on the ISO comptroller; querying
// the primary one yields a wrong Health Factor (BUG-2 regression tests).
// ─────────────────────────────────────────────────────────────────────────────

const WALLET = '0x000000000000000000000000000000000000abcd';
const USDT0 = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D';

const COMPTROLLER_READS = new ethers.Interface([
  'function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)',
  'function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa)',
]);
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

interface RecordedCall { to: string; fn: string }

/** Minimal ethers-v6 ContractRunner: records every eth_call target + fn. */
function makeComptrollerRunner(record: RecordedCall[]) {
  return {
    async call(tx: { to?: string | null; data?: string | null }): Promise<string> {
      const to = (tx.to ?? '').toLowerCase();
      const selector = (tx.data ?? '0x').slice(0, 10);
      const fn = COMPTROLLER_READS.getFunction(selector)?.name ?? selector;
      record.push({ to, fn });
      if (fn === 'getAccountLiquidity') {
        // (error, liquidity, shortfall) — 250 USD of spare liquidity
        return abiCoder.encode(['uint256', 'uint256', 'uint256'], [0n, 250n * 10n ** 18n, 0n]);
      }
      if (fn === 'markets') {
        // (isListed, collateralFactorMantissa 0.7e18)
        return abiCoder.encode(['bool', 'uint256'], [true, 7n * 10n ** 17n]);
      }
      throw new Error(`unexpected eth_call fn ${fn}`);
    },
  };
}

function borrowPosition(overrides: {
  cToken: string;
  comptroller?: string;
  iso: boolean;
}): NormalizedPosition {
  const metadata: Record<string, unknown> = {
    cToken: overrides.cToken,
    symbol: 'kUSDT0',
    kind: 'borrow',
    iso: overrides.iso,
  };
  if (overrides.comptroller) metadata.comptroller = overrides.comptroller;
  return {
    protocolId: 'kinetic',
    chainId: 14,
    wallet: WALLET,
    kind: 'BORROW',
    asset: USDT0,
    amount: 11_737_330n,
    amountUSD: 11.73,
    priceUSD: 1,
    metadata,
    takenAt: new Date(),
  };
}

describe('KineticAdapter.getMetrics — comptroller routing (primary vs ISO)', () => {
  const recorded: RecordedCall[] = [];

  beforeEach(() => {
    setIsoEnv();
    process.env.KINETIC_COMPTROLLER = PRIMARY_COMPTROLLER;
    resetAddressCache();
    recorded.length = 0;
    mockHttpProvider = makeComptrollerRunner(recorded);
  });

  afterEach(() => {
    mockHttpProvider = {};
  });

  test('ISO position queries the ISO comptroller, never the primary', async () => {
    const metrics = await new KineticAdapter().getMetrics(
      borrowPosition({ cToken: KUSDT0_ISO, comptroller: ISO_COMPTROLLER, iso: true }),
    );

    const targets = recorded.map((c) => c.to);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain(ISO_COMPTROLLER.toLowerCase());
    expect(targets).not.toContain(PRIMARY_COMPTROLLER.toLowerCase());
    expect(recorded.map((c) => c.fn)).toContain('getAccountLiquidity');
    expect(metrics.extras?.error).toBeUndefined();
    expect(metrics.hf).toBeDefined(); // HF computed from the ISO comptroller reads
  });

  test('primary position still queries the primary comptroller', async () => {
    await new KineticAdapter().getMetrics(
      borrowPosition({ cToken: KUSDT0_PRIMARY, comptroller: PRIMARY_COMPTROLLER, iso: false }),
    );

    const targets = recorded.map((c) => c.to);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain(PRIMARY_COMPTROLLER.toLowerCase());
    expect(targets).not.toContain(ISO_COMPTROLLER.toLowerCase());
  });

  test('falls back to the primary comptroller when metadata carries none (legacy positions)', async () => {
    await new KineticAdapter().getMetrics(
      borrowPosition({ cToken: KUSDT0_PRIMARY, iso: false }),
    );

    const targets = recorded.map((c) => c.to);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t === PRIMARY_COMPTROLLER.toLowerCase())).toBe(true);
  });
});

describe('KineticAdapter.buildIsoPaRepayBatch (PA-native repay, pieza 1)', () => {
  beforeEach(() => setIsoEnv());

  const REPAY = 5_000_000n;
  const WITHDRAW = 3_000_000n;

  test('with withdraw → [redeemUnderlying, approve, repayBorrowBehalf] against ISO contracts', async () => {
    const batch = await new KineticAdapter().buildIsoPaRepayBatch({
      borrower: BORROWER_PA,
      repayUsdt0: REPAY,
      withdrawUsdt0: WITHDRAW,
      usdt0Token: USDT0_TOKEN,
    });
    expect(batch).toHaveLength(3);

    // [0] redeemUnderlying(withdraw) on kUSDT0 ISO — NOT primary
    expect(batch[0].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    const redeem = KTOKEN.parseTransaction({ data: batch[0].calldata });
    expect(redeem?.name).toBe('redeemUnderlying');
    expect(redeem?.args[0]).toBe(WITHDRAW);

    // [1] approve(USDT0 -> kUSDT0 ISO, repay)
    expect(batch[1].to.toLowerCase()).toBe(USDT0_TOKEN.toLowerCase());
    const approve = ERC20.parseTransaction({ data: batch[1].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0].toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    expect(approve?.args[1]).toBe(REPAY);

    // [2] repayBorrowBehalf(PA, repay) on kUSDT0 ISO
    expect(batch[2].to.toLowerCase()).toBe(KUSDT0_ISO.toLowerCase());
    const repay = KTOKEN.parseTransaction({ data: batch[2].calldata });
    expect(repay?.name).toBe('repayBorrowBehalf');
    expect(repay?.args[0].toLowerCase()).toBe(BORROWER_PA.toLowerCase());
    expect(repay?.args[1]).toBe(REPAY);

    expect(batch.every((c) => c.value === '0')).toBe(true);
  });

  test('without withdraw → [approve, repayBorrowBehalf] only (free balance covers it)', async () => {
    const batch = await new KineticAdapter().buildIsoPaRepayBatch({
      borrower: BORROWER_PA,
      repayUsdt0: REPAY,
      withdrawUsdt0: 0n,
      usdt0Token: USDT0_TOKEN,
    });
    expect(batch).toHaveLength(2);
    expect(ERC20.parseTransaction({ data: batch[0].calldata })?.name).toBe('approve');
    expect(KTOKEN.parseTransaction({ data: batch[1].calldata })?.name).toBe('repayBorrowBehalf');
  });

  test('rejects negative withdraw and non-positive repay', async () => {
    await expect(
      new KineticAdapter().buildIsoPaRepayBatch({ borrower: BORROWER_PA, repayUsdt0: REPAY, withdrawUsdt0: -1n, usdt0Token: USDT0_TOKEN }),
    ).rejects.toThrow(/BAD_WITHDRAW/);
    await expect(
      new KineticAdapter().buildIsoPaRepayBatch({ borrower: BORROWER_PA, repayUsdt0: 0n, withdrawUsdt0: 0n, usdt0Token: USDT0_TOKEN }),
    ).rejects.toThrow(/BAD_REPAY/);
  });
});

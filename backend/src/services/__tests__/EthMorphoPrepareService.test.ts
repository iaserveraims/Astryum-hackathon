/**
 * EthMorphoPrepareService — B5 compose tests (plan §13).
 *
 * Same fixture family as the market-service tests: FXRP 6 dec / RLUSD 18 dec,
 * price 1.0 at oracle scale, ~90% utilisation. The stub simulate function lets
 * us pin the honest simulation semantics (ok / depends_on_prior / unavailable).
 */
import {
  prepareEthMorpho,
  projectHealthFactor,
  repayFullApproveCap,
} from '../EthMorphoPrepareService';
import type { MorphoChainReader, MorphoMarketState } from '../EthMorphoMarketService';
import { FXRP_RLUSD_MARKET_PARAMS } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';

const E18 = 10n ** 18n;
const USER = '0x1111111111111111111111111111111111111111';
const PRICE_ONE = 10n ** 48n;

const MARKET_STATE: MorphoMarketState = {
  totalSupplyAssets: 5_630_000n * E18,
  totalSupplyShares: 5_630_000n * E18 * 1_000_000n,
  totalBorrowAssets: 5_080_000n * E18,
  totalBorrowShares: 5_080_000n * E18 * 1_000_000n,
  lastUpdate: 1_755_264_299n,
  fee: 0n,
};

function stubReader(position: { supplyShares: bigint; borrowShares: bigint; collateral: bigint }): MorphoChainReader {
  return {
    async idToMarketParams() { return FXRP_RLUSD_MARKET_PARAMS; },
    async market() { return MARKET_STATE; },
    async position() { return position; },
    async oraclePrice() { return PRICE_ONE; },
    async borrowRatePerSecond() { return 1_000_000_000n; },
    async erc20Decimals(token: string) {
      return token.toLowerCase() === FXRP_RLUSD_MARKET_PARAMS.loanToken.toLowerCase() ? 18 : 6;
    },
  };
}

const NO_POSITION = { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
const WITH_DEBT = {
  supplyShares: 0n,
  borrowShares: 2n * E18 * 1_000_000n, // ≈2 RLUSD debt
  collateral: 5_000_000n,              // 5 FXRP
};

const simulateOk = jest.fn(async () => ({ success: true, gasUsed: 120_000 }));

beforeEach(() => simulateOk.mockClear());

describe('supply_collateral', () => {
  it('returns approve+supply legs, read decimals, and an improving HF projection', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'supply_collateral', user: USER, amountBase: '5000000',
    }, simulateOk);
    expect(r.legs).toHaveLength(2);
    expect(r.decimals).toEqual({ collateral: 6, loan: 18 });
    expect(r.position.healthFactor).toBeCloseTo(3.85 / 2, 3);
    expect(r.positionAfter.healthFactor).toBeCloseTo(7.7 / 2, 3); // 10 FXRP now
    expect(r.preflight.ok).toBe(true);
    expect(JSON.stringify(r)).toBeTruthy(); // JSON-safe end to end
  });

  it('simulates leg 0 and marks leg 1 depends_on_prior — never a fake green', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'supply_collateral', user: USER, amountBase: '1000000',
    }, simulateOk);
    expect(r.simulation.attempted).toBe(true);
    expect(r.simulation.legs[0].status).toBe('ok');
    expect(r.simulation.legs[1].status).toBe('depends_on_prior');
    expect(simulateOk).toHaveBeenCalledTimes(1);
  });

  it('says so honestly when no simulator is wired', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'supply_collateral', user: USER, amountBase: '1000000',
    });
    expect(r.simulation.attempted).toBe(false);
    expect(r.simulation.note).toContain('not configured');
    expect(r.simulation.legs.every((l) => l.status === 'unavailable')).toBe(true);
  });
});

describe('borrow', () => {
  it('passes pre-flights inside liquidity+health and projects the HF drop', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'borrow', user: USER, amountBase: (1n * E18).toString(),
    }, simulateOk);
    expect(r.preflight.ok).toBe(true);
    expect(r.positionAfter.healthFactor).toBeCloseTo(3.85 / 3, 3);
  });

  it('blocks a borrow above pool liquidity BEFORE any signature (adjustment #4)', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'borrow', user: USER, amountBase: (600_000n * E18).toString(),
    }, simulateOk);
    expect(r.preflight.ok).toBe(false);
    expect(r.preflight.checks.find((c) => c.name === 'liquidity'))
      .toMatchObject({ ok: false, code: 'BORROW_EXCEEDS_LIQUIDITY' });
    // Simulation is skipped when a pre-flight already blocks — and says so.
    expect(r.simulation.attempted).toBe(false);
    expect(simulateOk).not.toHaveBeenCalled();
  });

  it('blocks past the liquidation ceiling', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'borrow', user: USER, amountBase: (2n * E18).toString(), // debt 2→4 > max 3.85
    }, simulateOk);
    expect(r.preflight.checks.find((c) => c.name === 'health'))
      .toMatchObject({ ok: false, code: 'BORROW_WOULD_LIQUIDATE' });
  });
});

describe('repay', () => {
  it('full mode closes live shares with a FINITE approve cap and HF → no-debt (null)', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'repay', user: USER, repayMode: 'full',
    }, simulateOk);
    expect(r.legs).toHaveLength(2);
    expect(r.positionAfter.healthFactor).toBeNull(); // Infinity encoded as null
  });

  it('partial above live debt is a typed error pointing at full mode', async () => {
    await expect(prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'repay', user: USER, amountBase: (3n * E18).toString(),
    }, simulateOk)).rejects.toMatchObject({ code: 'REPAY_EXCEEDS_DEBT' });
  });

  it('full with no debt is a typed error', async () => {
    await expect(prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'repay', user: USER, repayMode: 'full',
    }, simulateOk)).rejects.toMatchObject({ code: 'NO_DEBT' });
  });

  it('PARCIAL sin deuda dice NO_DEBT, no manda a un segundo error', async () => {
    // Visto en el ensayo en seco: el parcial contestaba
    // REPAY_EXCEEDS_DEBT «use repayMode full to close», y el full contestaba
    // NO_DEBT. Dos pantallas para enterarse de una cosa, y en mitad de una
    // urgencia de health factor.
    await expect(prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'repay', user: USER, amountBase: (1n * E18).toString(),
    }, simulateOk)).rejects.toMatchObject({ code: 'NO_DEBT' });
  });
});

describe('withdraw_collateral', () => {
  it('blocks a withdrawal that would strand the debt past its ceiling', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'withdraw_collateral', user: USER, amountBase: '3000000',
    }, simulateOk);
    expect(r.preflight.checks.find((c) => c.name === 'collateral'))
      .toMatchObject({ ok: false, code: 'WITHDRAW_WOULD_LIQUIDATE' });
  });
});

describe('open_carry — the carry card entry (supply + borrow, ONE signing session)', () => {
  it('composes [approve, supplyCollateral, borrow] and projects HF with BOTH deltas', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000',                    // 5 FXRP collateral
      borrowBase: (2n * E18).toString(),        // 2 RLUSD borrowed
    }, simulateOk);
    expect(r.legs.map((l) => l.description)).toEqual([
      'Approve FXRP to Morpho (exact amount)',
      'Deposit FXRP as collateral',
      'Borrow RLUSD',
    ]);
    expect(r.preflight.ok).toBe(true);
    expect(r.positionAfter.healthFactor).toBeCloseTo(3.85 / 2, 3);
    // Only leg 0 single-simulates; the rest share the session's state.
    expect(r.simulation.legs.map((l) => l.status)).toEqual(['ok', 'depends_on_prior', 'depends_on_prior']);
  });

  it('health projects the NEW collateral — a healthy fresh entry is NOT blocked', async () => {
    // Fresh account: borrowing 3 against 5 FXRP (max 3.85) must pass; two
    // separate /prepare calls would have flagged this (no collateral yet).
    const ok = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (3n * E18).toString(),
    }, simulateOk);
    expect(ok.preflight.ok).toBe(true);

    const blocked = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (4n * E18).toString(), // > 3.85 max
    }, simulateOk);
    expect(blocked.preflight.checks.find((c) => c.name === 'health'))
      .toMatchObject({ ok: false, code: 'BORROW_WOULD_LIQUIDATE' });
  });

  it('pool liquidity still gates the borrow leg', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (600_000n * E18).toString(),
    }, simulateOk);
    expect(r.preflight.checks.find((c) => c.name === 'liquidity'))
      .toMatchObject({ ok: false, code: 'BORROW_EXCEEDS_LIQUIDITY' });
  });
});

describe('disclosure (invariants #6/#9)', () => {
  it('carries lltv/utilization/liquidity, APR with named source, finite approvals and the signer note', async () => {
    const r = await prepareEthMorpho(stubReader(WITH_DEBT), {
      action: 'borrow', user: USER, amountBase: (1n * E18).toString(),
    }, simulateOk);
    expect(r.disclosure.disclosedToUser).toBe(true);
    expect(r.disclosure.lltvPct).toBe(77);
    expect(r.disclosure.utilizationPct).toBeCloseTo(90.23, 1);
    expect(r.disclosure.borrowAprPct).toBeCloseTo(3.15, 1);
    expect(r.disclosure.borrowAprSource).toContain('on-chain');
    expect(r.disclosure.approvals).toBe('finite');
    expect(r.disclosure.signerNote).toContain('never signs');
  });
});

describe('helpers', () => {
  it('repayFullApproveCap = debt + 0.1% (min 1 unit), always finite', () => {
    expect(repayFullApproveCap(1_000_000n)).toBe(1_001_000n);
    expect(repayFullApproveCap(10n)).toBe(11n);
  });

  it('projectHealthFactor clamps negative projections to zero instead of nonsense', () => {
    const pos = {
      collateral: 1_000_000n, borrowShares: 0n, borrowAssets: 1n * E18,
      maxBorrow: 0n, collateralValue: 0n, healthFactor: 1,
    };
    const snap = { oraclePrice: PRICE_ONE, params: FXRP_RLUSD_MARKET_PARAMS };
    const hf = projectHealthFactor(pos, snap, { collateral: -2_000_000n });
    expect(hf).toBe(0); // collateral clamped to 0 → maxBorrow 0 → HF 0
  });
});

/* ──The Sentora legs INSIDE the market flows ─────────────────── */

import type { SentoraVaultReader } from '../EthMorphoPrepareService';
import { RLUSD_ETH } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';
import { SENTORA_RLUSD_VAULT } from '../../connectors/protocols/adapters/SentoraRlusdVaultAdapter';

/** The market reader, plus what the wallet HOLDS (so the ammo checks can read it). */
function stubReaderWithBalances(
  position: { supplyShares: bigint; borrowShares: bigint; collateral: bigint },
  balances: Record<string, bigint>,
): MorphoChainReader {
  return {
    ...stubReader(position),
    async erc20BalanceOf(token: string) { return balances[token.toLowerCase()] ?? 0n; },
  };
}

function stubVault(o: Partial<{
  asset: string; shares: bigint; claim: bigint; idle: bigint; maxDeposit: bigint;
}> = {}): SentoraVaultReader {
  return {
    async asset() { return o.asset ?? RLUSD_ETH; },
    async totalAssets() { return 318_000_000n * E18; },
    async maxWithdraw() { return 0n; },        // Vault V2 stub — never a cap
    async assetDecimals() { return 18; },
    async sharesOf() { return o.shares ?? 0n; },
    async previewRedeem(shares: bigint) { return shares > 0n ? (o.claim ?? shares) : 0n; },
    async idleAssets() { return o.idle ?? 17_000_000n * E18; },
    async maxDeposit() { return o.maxDeposit ?? 0n; },
  };
}

const RLUSD_KEY = RLUSD_ETH.toLowerCase();

describe('open_carry + lendBorrowed — the borrowed RLUSD goes to Sentora in the SAME signature', () => {
  it('appends approve+deposit to the vault, and says so in `lend`', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (2n * E18).toString(), lendBorrowed: true,
    }, simulateOk, stubVault());
    expect(r.legs.map((l) => l.description)).toEqual([
      'Approve FXRP to Morpho (exact amount)',
      'Deposit FXRP as collateral',
      'Borrow RLUSD',
      'Approve RLUSD to the Sentora vault (exact amount)',
      'Lend RLUSD into the Sentora vault',
    ]);
    expect(r.lend).toMatchObject({ vault: SENTORA_RLUSD_VAULT, assetsBase: (2n * E18).toString() });
    expect(r.lend?.curatorNote).toContain('aggregate');
    // The vault legs change nothing about the risk of the position.
    expect(r.positionAfter.healthFactor).toBeCloseTo(3.85 / 2, 3);
    expect(r.preflight.ok).toBe(true);
    // Vault V2's maxDeposit stub (0) must NOT surface as a cap check.
    expect(r.preflight.checks.find((c) => c.name === 'cap')).toBeUndefined();
  });

  it('without the flag nothing changes: three legs, lend null', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER, amountBase: '5000000', borrowBase: (2n * E18).toString(),
    }, simulateOk, stubVault());
    expect(r.legs).toHaveLength(3);
    expect(r.lend).toBeNull();
    expect(r.fromVault).toBeNull();
  });

  it('a usable deposit cap DOES gate the vault leg', async () => {
    const r = await prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (2n * E18).toString(), lendBorrowed: true,
    }, simulateOk, stubVault({ maxDeposit: 1n * E18 }));
    expect(r.preflight.checks.find((c) => c.name === 'cap'))
      .toMatchObject({ ok: false, code: 'DEPOSIT_EXCEEDS_CAP' });
  });

  it('refuses when the vault does not hold RLUSD (invariant #3, on-chain)', async () => {
    await expect(prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (2n * E18).toString(), lendBorrowed: true,
    }, simulateOk, stubVault({ asset: '0x2222222222222222222222222222222222222222' })))
      .rejects.toMatchObject({ code: 'VAULT_ASSET_MISMATCH' });
  });

  it('refuses loudly without a vault reader — never silently drops the leg', async () => {
    await expect(prepareEthMorpho(stubReader(NO_POSITION), {
      action: 'open_carry', user: USER,
      amountBase: '5000000', borrowBase: (2n * E18).toString(), lendBorrowed: true,
    }, simulateOk)).rejects.toMatchObject({ code: 'VAULT_READER_MISSING' });
  });
});

describe('repay + fromVault — the ammo can be LENT in Sentora', () => {
  const ONE = 1n * E18;

  it('wallet empty, vault covers: withdraw(shortfall) is the FIRST leg of the same signature', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18 }));
    expect(r.legs.map((l) => l.description)).toEqual([
      'Withdraw RLUSD from the Sentora vault',
      'Approve RLUSD to Morpho (finite)',
      'Repay RLUSD debt',
    ]);
    expect(r.fromVault).toMatchObject({
      withdrawnBase: ONE.toString(), walletBalanceBase: '0', vaultClaimBase: (10n * E18).toString(),
    });
    expect(r.preflight.ok).toBe(true);
    expect(r.preflight.checks.map((c) => c.name).sort()).toEqual(['balance', 'vault-liquidity']);
  });

  it('withdraws ONLY the shortfall when the wallet covers part of it', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: ONE / 4n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18 }));
    expect(r.fromVault?.withdrawnBase).toBe(((ONE * 3n) / 4n).toString());
  });

  it('wallet covers: the vault is NOT touched', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 5n * E18 });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18 }));
    expect(r.legs).toHaveLength(2);
    expect(r.fromVault).toBeNull();
    expect(r.preflight.checks).toEqual([{ name: 'balance', ok: true }]);
  });

  it('nothing lent either: the plain INSUFFICIENT_BALANCE, with the vault figure attached', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: 0n }));
    expect(r.legs).toHaveLength(2);
    expect(r.preflight.checks[0]).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
    expect(r.preflight.checks[0].data).toMatchObject({ vaultClaim: '0' });
  });

  it('wallet + vault still short: INSUFFICIENT_BALANCE_WITH_VAULT, no withdraw leg', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: ONE / 2n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: ONE / 5n, claim: ONE / 5n }));
    expect(r.legs).toHaveLength(2);
    expect(r.preflight.checks[0]).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE_WITH_VAULT' });
  });

  it('the vault idle balance is a HARD ceiling on the shortfall (Vault V2, no liquidity adapter)', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(), fromVault: true,
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18, idle: ONE / 10n }));
    expect(r.legs).toHaveLength(2);
    expect(r.preflight.checks[0]).toMatchObject({ ok: false, code: 'WITHDRAW_EXCEEDS_VAULT_LIQUIDITY' });
  });

  it('repay-full pulls the approve cap (debt + 0.1%) so the allowance never exceeds the balance', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'full', fromVault: true,
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18 }));
    expect(r.legs[0].description).toBe('Withdraw RLUSD from the Sentora vault');
    expect(BigInt(r.fromVault!.withdrawnBase)).toBe(repayFullApproveCap(BigInt(r.position.borrowAssets)));
  });

  it('without the flag the door behaves exactly as before (regression)', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareEthMorpho(reader, {
      action: 'repay', user: USER, repayMode: 'partial', amountBase: ONE.toString(),
    }, simulateOk, stubVault({ shares: 10n * E18, claim: 10n * E18 }));
    expect(r.legs).toHaveLength(2);
    expect(r.fromVault).toBeNull();
    expect(r.preflight.checks[0]).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
  });
});

/* ── close_carry: cancelar la posición entera sin traer nada de fuera ─────── */

import { prepareCloseCarry, ethereumSwapVenue, type FillQuoteFn } from '../EthMorphoPrepareService';
import { ethers } from 'ethers';
import { UNISWAP_V3_ROUTER_ETH } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';

/** El hueco cuesta 1 FXRP. Cotizador de mentira, determinista. */
const quoterOk: FillQuoteFn = async () => ({ feeTier: 3000, amountInQuoted: 1_000_000n });
const quoterNoRoute: FillQuoteFn = async () => null;

const FXRP_KEY = FXRP_RLUSD_MARKET_PARAMS.collateralToken.toLowerCase();

describe('close_carry — el hueco del interés', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('sin hueco (la wallet cubre): repaga y devuelve TODO el colateral, sin swap', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 5n * E18 });
    const r = await prepareCloseCarry(reader, stubVault(), { user: USER }, quoterOk);
    expect(r.close.gapBase).toBe('0');
    expect(r.close.swap).toBeNull();
    expect(r.preflight.ok).toBe(true);
    expect(r.legs.map((l) => l.description)).toEqual([
      'Approve RLUSD to Morpho (finite)',
      'Repay full RLUSD debt (live shares)',
      'Withdraw FXRP collateral',
    ]);
    // Todo el colateral vuelve: no se vendió nada.
    expect(r.close.collateralReturnedBase).toBe(WITH_DEBT.collateral.toString());
  });

  it('la bóveda aporta antes que el colateral, y su LIQUIDEZ VIVA es el techo', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    // 10 RLUSD prestados pero la bóveda solo tiene 1 líquido: manda el idle.
    const r = await prepareCloseCarry(
      reader,
      stubVault({ shares: 10n * E18, claim: 10n * E18, idle: 1n * E18 }),
      { user: USER },
      quoterOk,
    );
    expect(r.close.fromVaultBase).toBe((1n * E18).toString());
    expect(BigInt(r.close.gapBase)).toBeGreaterThan(0n);
  });

  it('CON hueco y SIN elección del usuario NO decide por él (doctrina)', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(reader, stubVault({ shares: 0n }), { user: USER }, quoterOk);
    expect(r.preflight.ok).toBe(false);
    expect(r.preflight.checks.find((c) => c.name === 'gap'))
      .toMatchObject({ ok: false, code: 'CLOSE_GAP_CHOICE_REQUIRED' });
    expect(r.close.coverGap).toBeNull();
    expect(r.close.swap).toBeNull();
  });

  it('eligiendo "wallet" dice lo que falta y no compone swap', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(
      reader, stubVault({ shares: 0n }), { user: USER, coverGap: 'wallet' }, quoterOk,
    );
    expect(r.preflight.checks.find((c) => c.name === 'gap'))
      .toMatchObject({ ok: false, code: 'CLOSE_GAP_NOT_FUNDED' });
    expect(r.close.swap).toBeNull();
  });

  it('eligiendo "swap-collateral" compra el hueco EXACTO con el colateral sobrante', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(
      reader,
      stubVault({ shares: 1n * E18, claim: 1n * E18 }),
      { user: USER, coverGap: 'swap-collateral' },
      quoterOk,
    );
    expect(r.preflight.ok).toBe(true);
    expect(r.legs.map((l) => l.description)).toEqual([
      'Withdraw RLUSD from the Sentora vault',
      'Withdraw the exact collateral the swap will spend',
      'Approve the collateral to the swap router (capped)',
      'Buy exactly the missing RLUSD with your own collateral',
      'Approve RLUSD to Morpho (finite)',
      'Repay full RLUSD debt (live shares)',
      'Withdraw FXRP collateral',
    ]);
    // El swap va al router VERIFICADO (forma con deadline), no al router02.
    const swapLeg = r.legs.find((l) => l.description.startsWith('Buy exactly'))!;
    expect(swapLeg.to).toBe(UNISWAP_V3_ROUTER_ETH);
    // El tope es la cotización + slippage, y SIEMPRE mayor que la cotización.
    expect(BigInt(r.close.swap!.collateralInMaxBase))
      .toBeGreaterThan(BigInt(r.close.swap!.collateralInQuotedBase));
    // Y lo que vuelve al usuario es el colateral MENOS lo que el swap puede gastar.
    expect(BigInt(r.close.collateralReturnedBase))
      .toBe(WITH_DEBT.collateral - BigInt(r.close.swap!.collateralInMaxBase));
  });

  it('el swap pide EXACTAMENTE el hueco como amountOut — ni un wei más', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(
      reader, stubVault({ shares: 1n * E18, claim: 1n * E18 }),
      { user: USER, coverGap: 'swap-collateral' }, quoterOk,
    );
    const swapLeg = r.legs.find((l) => l.description.startsWith('Buy exactly'))!;
    const decoded = new ethers.Interface([
      'function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96))',
    ]).decodeFunctionData('exactOutputSingle', swapLeg.data)[0];
    expect(decoded.amountOut).toBe(BigInt(r.close.gapBase));
    expect(decoded.recipient).toBe(USER);
    expect(decoded.tokenIn.toLowerCase()).toBe(FXRP_KEY);
  });

  it('sin ruta de swap lo dice, en vez de inventarse una', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(
      reader, stubVault({ shares: 0n }), { user: USER, coverGap: 'swap-collateral' }, quoterNoRoute,
    );
    expect(r.preflight.checks.find((c) => c.name === 'gap'))
      .toMatchObject({ ok: false, code: 'SWAP_FILL_NO_ROUTE' });
  });

  it('el kill-switch del swap-fill manda también aquí', async () => {
    process.env.SWAP_FILL_ENABLED = 'false';
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 0n });
    const r = await prepareCloseCarry(
      reader, stubVault({ shares: 0n }), { user: USER, coverGap: 'swap-collateral' }, quoterOk,
    );
    expect(r.preflight.checks.find((c) => c.name === 'gap'))
      .toMatchObject({ ok: false, code: 'SWAP_FILL_DISABLED' });
  });

  it('sin posición, se niega en vez de componer un lote vacío', async () => {
    await expect(prepareCloseCarry(stubReader(NO_POSITION), stubVault(), { user: USER }, quoterOk))
      .rejects.toMatchObject({ code: 'NO_POSITION' });
  });

  it('el venue de Ethereum apunta al router con deadline, NO al router02', () => {
    expect(ethereumSwapVenue().router).toBe(UNISWAP_V3_ROUTER_ETH);
    expect(ethereumSwapVenue().router).not.toBe('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
  });

  it('dice en voz alta por qué cerrar cuesta más de lo que se pidió', async () => {
    const reader = stubReaderWithBalances(WITH_DEBT, { [RLUSD_KEY]: 5n * E18 });
    const r = await prepareCloseCarry(reader, stubVault(), { user: USER }, quoterOk);
    expect(r.close.note).toContain('accrues interest');
    expect(r.disclosure.carryNote).toContain('cost more than the vault paid');
    expect(r.disclosure.disclosedToUser).toBe(true);
  });
});

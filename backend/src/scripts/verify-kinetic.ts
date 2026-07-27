#!/usr/bin/env ts-node
/**
 * Verify-Kinetic — on-chain verification + cToken enumeration for Kinetic Market on Flare.
 *
 * Usage:
 *   KINETIC_COMPTROLLER=0x... npm run verify:kinetic
 *
 * What it does:
 *   1. Reads Comptroller via FlareProvider HTTP RPC.
 *   2. Calls getAllMarkets() → enumerates cTokens.
 *   3. For each cToken: symbol, underlying, exchangeRate, totalSupply, totalBorrows, getCash.
 *   4. Reads collateralFactorMantissa per market.
 *   5. Reads liquidationIncentiveMantissa.
 *   6. Prints a human-readable table.
 *   7. Generates `kinetic.runtime.json` consumed by allowlist at boot.
 *   8. Prints suggested ENV vars + seed updates.
 *
 * Exit codes:
 *   0 = success, ≥1 cToken found
 *   1 = KINETIC_COMPTROLLER not set
 *   2 = address has no contract (not a Comptroller)
 *   3 = ABI mismatch (Comptroller call failed)
 *   4 = no markets enumerated (empty Comptroller)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const COMPTROLLER_ABI = [
  'function getAllMarkets() view returns (address[])',
  'function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa)',
  'function liquidationIncentiveMantissa() view returns (uint256)',
];

const CTOKEN_ABI = [
  'function symbol() view returns (string)',
  'function underlying() view returns (address)',
  'function exchangeRateStored() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function getCash() view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const FLARE_RPC =
  process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const COMPTROLLER = process.env.KINETIC_COMPTROLLER;

const MANTISSA = 10n ** 18n;

interface CTokenRow {
  cToken: string;
  cSymbol: string;
  underlying: string;
  underlyingSymbol: string;
  collateralFactor: number;
  totalSupplyUnderlying: string;
  totalBorrows: string;
  cash: string;
  exchangeRate: string;
}

async function main(): Promise<void> {
  if (!COMPTROLLER) {
    console.error('❌ KINETIC_COMPTROLLER env var not set.');
    console.error('   Usage: KINETIC_COMPTROLLER=0x... npm run verify:kinetic');
    process.exit(1);
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(COMPTROLLER)) {
    console.error(`❌ KINETIC_COMPTROLLER is not a valid 0x-prefixed address: ${COMPTROLLER}`);
    process.exit(1);
  }

  console.log(`🔌 Connecting to Flare RPC: ${FLARE_RPC}`);
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);

  const code = await provider.getCode(COMPTROLLER);
  if (!code || code === '0x') {
    console.error(`❌ No contract deployed at ${COMPTROLLER}`);
    process.exit(2);
  }
  console.log(`✅ Contract found at ${COMPTROLLER} (bytecode length ${code.length})`);

  const comptroller = new ethers.Contract(COMPTROLLER, COMPTROLLER_ABI, provider);

  let markets: string[];
  try {
    markets = await comptroller.getAllMarkets();
  } catch (err) {
    console.error(`❌ Comptroller.getAllMarkets() failed — ABI mismatch?`);
    console.error(`   ${(err as Error).message}`);
    process.exit(3);
  }

  if (!markets.length) {
    console.error('❌ Comptroller returned 0 markets');
    process.exit(4);
  }

  console.log(`📋 Enumerated ${markets.length} cToken market(s)\n`);

  let liquidationIncentive: number | null = null;
  try {
    const li = await comptroller.liquidationIncentiveMantissa();
    liquidationIncentive = Number(li) / Number(MANTISSA);
  } catch {
    console.warn('⚠️  liquidationIncentiveMantissa() unavailable');
  }

  const rows: CTokenRow[] = [];

  for (const cTokenAddr of markets) {
    const cToken = new ethers.Contract(cTokenAddr, CTOKEN_ABI, provider);
    let cSymbol = '?';
    let underlying = ethers.ZeroAddress;
    let underlyingSymbol = 'NATIVE';
    let exchangeRate = '0';
    let totalSupply = '0';
    let totalBorrows = '0';
    let cash = '0';

    try {
      cSymbol = await cToken.symbol();
    } catch {
      cSymbol = 'cUNKNOWN';
    }
    try {
      underlying = await cToken.underlying();
      const erc = new ethers.Contract(underlying, ERC20_ABI, provider);
      try {
        underlyingSymbol = await erc.symbol();
      } catch {
        underlyingSymbol = 'UNKNOWN';
      }
    } catch {
      // cFLR-style native token has no underlying() method
      underlyingSymbol = 'FLR (native)';
    }
    try {
      [exchangeRate, totalSupply, totalBorrows, cash] = await Promise.all([
        cToken.exchangeRateStored().then((v: bigint) => v.toString()),
        cToken.totalSupply().then((v: bigint) => v.toString()),
        cToken.totalBorrows().then((v: bigint) => v.toString()),
        cToken.getCash().then((v: bigint) => v.toString()),
      ]);
    } catch (err) {
      console.warn(`⚠️  ${cSymbol}: market read failed: ${(err as Error).message}`);
    }

    let collateralFactor = 0;
    try {
      const m = await comptroller.markets(cTokenAddr);
      collateralFactor = Number(m[1]) / Number(MANTISSA);
    } catch {
      /* ignore */
    }

    rows.push({
      cToken: cTokenAddr,
      cSymbol,
      underlying,
      underlyingSymbol,
      collateralFactor,
      totalSupplyUnderlying: totalSupply,
      totalBorrows,
      cash,
      exchangeRate,
    });
  }

  // Print table
  console.log('┌──────────────┬──────────────────┬───────┬──────────────────────────────────────────────┐');
  console.log('│ cSymbol      │ underlyingSymbol │ CF%   │ cToken                                       │');
  console.log('├──────────────┼──────────────────┼───────┼──────────────────────────────────────────────┤');
  for (const r of rows) {
    console.log(
      `│ ${r.cSymbol.padEnd(12)} │ ${r.underlyingSymbol.padEnd(16)} │ ${(r.collateralFactor * 100).toFixed(0).padStart(5)} │ ${r.cToken} │`
    );
  }
  console.log('└──────────────┴──────────────────┴───────┴──────────────────────────────────────────────┘');

  if (liquidationIncentive !== null) {
    console.log(`\n💧 Liquidation incentive: ${(liquidationIncentive * 100).toFixed(2)}%`);
  }

  // Generate runtime JSON for allowlist
  const runtimeJson = {
    generatedAt: new Date().toISOString(),
    chainId: 14,
    comptroller: COMPTROLLER,
    cTokens: rows.map((r) => ({
      address: r.cToken,
      symbol: r.cSymbol,
      underlying: r.underlying,
      underlyingSymbol: r.underlyingSymbol,
      collateralFactor: r.collateralFactor,
    })),
  };

  const outPath = join(__dirname, '..', 'config', 'kinetic.runtime.json');
  writeFileSync(outPath, JSON.stringify(runtimeJson, null, 2));
  console.log(`\n📝 Runtime JSON written: ${outPath}`);

  // Suggested env vars
  console.log('\n🔐 Suggested .env entries:');
  console.log(`   KINETIC_COMPTROLLER=${COMPTROLLER}`);
  for (const r of rows) {
    const envName = `KINETIC_${r.cSymbol.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '_');
    console.log(`   ${envName}=${r.cToken}`);
  }

  console.log('\n✅ Verification complete. Next steps:');
  console.log('   1. Add the above ENV vars to backend/.env (or Railway)');
  console.log('   2. Verify cToken symbols match the assets you expect (FLR, USDT0, FXRP, etc.)');
  console.log('   3. Run: KINETIC_COMPTROLLER=... npm run probe:kinetic -- 0xYOURWALLET');
  console.log('   4. Restart backend: npm run dev');
  console.log('   5. curl http://localhost:3001/api/positions/kinetic/0xYOURWALLET');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ verify-kinetic failed:', err);
  process.exit(99);
});

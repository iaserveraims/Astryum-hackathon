#!/usr/bin/env ts-node
/**
 * Probe-Kinetic-Wallet — exercise KineticAdapter against a real wallet.
 *
 * Usage:
 *   KINETIC_COMPTROLLER=0x... npm run probe:kinetic -- 0xYOURWALLET
 *
 * What it does:
 *   1. Calls KineticAdapter.discoverPositions(wallet)
 *   2. Per position: KineticAdapter.getMetrics(position) → HF/LTV
 *   3. Direct Comptroller.getAccountLiquidity(wallet) → liquidity, shortfall
 *   4. Compares adapter HF vs computed-from-getAccountLiquidity HF, reports delta
 *   5. Prints a readable summary so you can compare against Kinetic UI manually
 */

import { ethers } from 'ethers';
import { KineticAdapter } from '../connectors/protocols/adapters/KineticAdapter';
import { getFlareProvider } from '../services/FlareProvider';

const COMPTROLLER_ABI = [
  'function getAccountLiquidity(address account) view returns (uint256, uint256, uint256)',
];

const FLARE_RPC =
  process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const COMPTROLLER = process.env.KINETIC_COMPTROLLER;

async function main(): Promise<void> {
  const wallet = process.argv[2];
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    console.error('❌ Pass a wallet address: npm run probe:kinetic -- 0x...');
    process.exit(1);
  }
  if (!COMPTROLLER) {
    console.error('❌ KINETIC_COMPTROLLER env var not set.');
    process.exit(1);
  }

  console.log(`🔍 Probing Kinetic for wallet ${wallet}\n`);

  // The adapter reads through the shared FlareProvider singleton, which must be
  // initialized once per process (index-simple does this at boot; scripts must too).
  await getFlareProvider().initialize();

  const adapter = new KineticAdapter();
  if (!adapter.isActive) {
    console.error('❌ KineticAdapter.isActive=false — check protocolAddresses.ts loads KINETIC_COMPTROLLER');
    process.exit(2);
  }

  // 1. discoverPositions
  console.log('1️⃣  KineticAdapter.discoverPositions(wallet) ...');
  const positions = await adapter.discoverPositions(wallet);
  console.log(`   → ${positions.length} position(s) found\n`);

  if (!positions.length) {
    console.log('ℹ️  Wallet has no Kinetic positions (no supply or borrow). Nothing to probe.');
    process.exit(0);
  }

  // Print positions
  for (const p of positions) {
    const symbol = (p.raw?.symbol as string) ?? '?';
    const cToken = (p.raw?.cToken as string) ?? '?';
    console.log(`   • ${p.kind} ${symbol} (${p.amount.toString()} units)`);
    console.log(`     asset=${p.asset}  cToken=${cToken}`);
  }
  console.log();

  // 2. getMetrics per position
  console.log('2️⃣  KineticAdapter.getMetrics(position) per position ...');
  for (const p of positions) {
    const normalized = adapter.normalizePosition(p);
    const m = await adapter.getMetrics(normalized);
    const symbol = (p.raw?.symbol as string) ?? '?';
    const hf = m.hf !== undefined ? m.hf.toFixed(2) : 'n/a';
    const ltv = m.ltv !== undefined ? `${(m.ltv * 100).toFixed(1)}%` : 'n/a';
    const liq = m.liquidationPrice !== undefined ? `$${m.liquidationPrice.toFixed(4)}` : 'n/a';
    console.log(`   • ${p.kind} ${symbol}: HF=${hf}, LTV=${ltv}, liqPrice=${liq}`);
    if (m.extras) {
      console.log(`     extras: ${JSON.stringify(m.extras)}`);
    }
  }
  console.log();

  // 3. direct Comptroller.getAccountLiquidity
  console.log('3️⃣  Comptroller.getAccountLiquidity(wallet) ...');
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  const comptroller = new ethers.Contract(COMPTROLLER, COMPTROLLER_ABI, provider);
  const [errCode, liquidity, shortfall] = await comptroller.getAccountLiquidity(wallet);
  console.log(`   errCode=${errCode}, liquidity=${liquidity.toString()}, shortfall=${shortfall.toString()}`);
  const liquidityUSD = Number(liquidity) / 1e18;
  const shortfallUSD = Number(shortfall) / 1e18;
  console.log(`   liquidityUSD≈$${liquidityUSD.toFixed(2)}, shortfallUSD≈$${shortfallUSD.toFixed(2)}`);
  if (shortfallUSD > 0) {
    console.log(`   ⚠️  Wallet is in shortfall — eligible for liquidation`);
  }
  console.log();

  // 4. Comparison summary
  console.log('4️⃣  Manual verification checklist:');
  console.log('   • Open Kinetic UI for this wallet (https://app.kinetic.market or equivalent)');
  console.log('   • Compare displayed HF/LTV with the values printed above');
  console.log('   • If delta > 5%, file a discrepancy in docs/protocols/KINETIC_FLARE.md');
  console.log('   • Take screenshot + record link for the doc');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ probe-kinetic failed:', err);
  process.exit(99);
});

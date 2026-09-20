#!/usr/bin/env ts-node
/**
 * Verify-Firelight — on-chain verification of the stXRP withdrawal-queue
 * mechanics on Flare mainnet. B0-bis of the Institutional build: the pote B
 * cooldown is DERIVED from what this script reads, never assumed.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

// The withdrawal-period queue of FirelightVault. Same ABI the adapter carries
// (`FirelightAdapter.ts` STXRP_CLAIM_ABI, verified against the impl source):
// withdrawalsOf returns ASSETS, not shares.
const STXRP_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function currentPeriod() view returns (uint256)',
  'function currentPeriodEnd() view returns (uint48)',
  'function nextPeriodEnd() view returns (uint48)',
  'function withdrawalsOf(uint256 period, address owner) view returns (uint256)',
  'function withdrawAssets(uint256 period) view returns (uint256)',
  'function isWithdrawClaimed(uint256 period, address owner) view returns (bool)',
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const FLARE_RPC = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
const STXRP = process.env.FIRELIGHT_STXRP;
const FXRP_TOKEN = process.env.FXRP_TOKEN; // optional cross-check

function die(code: number, msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

async function main(): Promise<void> {
  if (!STXRP) {
    die(1, 'FIRELIGHT_STXRP env var not set.\n   Usage: FIRELIGHT_STXRP=0x... npm run verify:firelight');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(STXRP)) {
    die(1, `FIRELIGHT_STXRP is not a valid 0x-prefixed address: ${STXRP}`);
  }

  console.log(`🔌 Connecting to Flare RPC: ${FLARE_RPC}`);
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);

  const code = await provider.getCode(STXRP);
  if (!code || code === '0x') die(2, `No contract deployed at ${STXRP}`);
  console.log(`✅ Contract found at ${STXRP} (bytecode length ${code.length})`);

  const stxrp = new ethers.Contract(STXRP, STXRP_ABI, provider);

  // ── 1. Identity: this must be stXRP over FXRP ──────────────────────────────
  let symbol: string, decimals: number, asset: string;
  try {
    [symbol, decimals, asset] = await Promise.all([
      stxrp.symbol(),
      stxrp.decimals().then((v: bigint) => Number(v)),
      stxrp.asset(),
    ]);
  } catch (err) {
    return die(3, `Identity reads failed — ABI mismatch? ${(err as Error).message}`);
  }

  const assetErc = new ethers.Contract(asset, ERC20_ABI, provider);
  let assetSymbol = '?';
  let assetDecimals = -1;
  try {
    [assetSymbol, assetDecimals] = await Promise.all([
      assetErc.symbol(),
      assetErc.decimals().then((v: bigint) => Number(v)),
    ]);
  } catch (err) {
    return die(3, `asset() ERC-20 reads failed at ${asset}: ${(err as Error).message}`);
  }

  console.log(`📛 ${symbol} (${decimals} dec) over ${assetSymbol} (${assetDecimals} dec) at ${asset}`);
  if (assetSymbol !== 'FXRP' || assetDecimals !== 6) {
    die(4, `Underlying is not FXRP/6dec — got ${assetSymbol}/${assetDecimals}. Wrong vault?`);
  }
  if (FXRP_TOKEN && FXRP_TOKEN.toLowerCase() !== asset.toLowerCase()) {
    die(4, `asset() ${asset} != FXRP_TOKEN env ${FXRP_TOKEN} — one of the two is stale`);
  }

  // ── 2. Queue mechanics: the number the pote B cooldown hangs from ─────────
  let currentPeriod: bigint, currentPeriodEnd: bigint, nextPeriodEnd: bigint;
  try {
    [currentPeriod, currentPeriodEnd, nextPeriodEnd] = await Promise.all([
      stxrp.currentPeriod(),
      stxrp.currentPeriodEnd(),
      stxrp.nextPeriodEnd(),
    ]);
  } catch (err) {
    return die(3, `Queue reads failed — ABI mismatch? ${(err as Error).message}`);
  }

  const periodSeconds = Number(nextPeriodEnd - currentPeriodEnd);
  const now = Math.floor(Date.now() / 1000);
  console.log(`⏱  currentPeriod=${currentPeriod}  ends=${new Date(Number(currentPeriodEnd) * 1000).toISOString()}`);
  console.log(`⏱  nextPeriodEnd=${new Date(Number(nextPeriodEnd) * 1000).toISOString()}`);
  console.log(`⏱  period duration: ${periodSeconds} s (${(periodSeconds / 3600).toFixed(2)} h)`);

  if (periodSeconds <= 0) die(4, 'nextPeriodEnd ≤ currentPeriodEnd — queue mechanics unreadable');
  if (Number(currentPeriodEnd) <= now) {
    console.warn('⚠️  currentPeriodEnd is in the past — node lag or a period boundary; re-run to confirm.');
  }
  if (periodSeconds !== 86_400) {
    console.warn(`⚠️  Period is NOT 24 h (measured 2026-08-20: 86400 s). Cooldown derivation below adapts, but re-check the pote B story.`);
  }

  // ── 3. Probe the claim surface the ERC4626Queued venue kind will use ──────
  try {
    const probePeriod = currentPeriod + 1n;
    const [queued, claimed, poolAssets] = await Promise.all([
      stxrp.withdrawalsOf(probePeriod, STXRP),
      stxrp.isWithdrawClaimed(probePeriod, STXRP),
      stxrp.withdrawAssets(probePeriod),
    ]);
    console.log(`🔍 withdrawalsOf(p+1, self)=${queued} (ASSETS) · isWithdrawClaimed=${claimed} · withdrawAssets(p+1)=${poolAssets}`);
  } catch (err) {
    return die(3, `Claim-surface probe failed — ABI mismatch? ${(err as Error).message}`);
  }

  // ── 4. Derived numbers the build consumes ─────────────────────────────────
  // A redeem signed now queues into currentPeriod+1 and claims once that
  // period ends: worst case 2 periods. Pote B cooldown = 3 periods (one full
  // period of slack) so the forced unwind ALWAYS lands before the holder.
  const worstCaseExitSeconds = 2 * periodSeconds;
  const recommendedCooldownSeconds = 3 * periodSeconds;
  console.log(`\n📐 Worst-case venue exit: ${worstCaseExitSeconds / 3600} h · recommended pote B cooldown: ${recommendedCooldownSeconds / 3600} h`);

  const runtimeJson = {
    generatedAt: new Date().toISOString(),
    chainId: 14,
    stXRP: STXRP,
    asset,
    assetSymbol,
    assetDecimals,
    periodSeconds,
    worstCaseExitSeconds,
    recommendedCooldownSeconds,
    currentPeriod: Number(currentPeriod),
    note: 'withdrawalsOf returns ASSETS not shares; redeem burns now and queues into currentPeriod+1; claimWithdraw(period) reverts unless period < currentPeriod().',
  };
  const outPath = join(__dirname, '..', 'config', 'firelight.runtime.json');
  writeFileSync(outPath, JSON.stringify(runtimeJson, null, 2));
  console.log(`📝 Runtime JSON written: ${outPath}`);

  console.log('\n🔐 Suggested .env entries:');
  console.log(`   FIRELIGHT_STXRP=${STXRP}`);
  console.log(`   FXRP_TOKEN=${asset}`);

  console.log('\n✅ Verification complete. Next steps:');
  console.log(`   1. Pote B constructor: COOLDOWN=${recommendedCooldownSeconds} (${recommendedCooldownSeconds / 3600} h)`);
  console.log('   2. Build VenueKind.ERC4626Queued against firelight.runtime.json, not against beliefs');
  console.log('   3. Re-run before the pote B mainnet deploy — the period is protocol data, not ours');

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ verify-firelight failed:', err);
  process.exit(99);
});

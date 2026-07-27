#!/usr/bin/env ts-node
/**
 * Carry FXRP dry-run — steps 2–4 of the end-to-end rehearsal, READ-ONLY.
 *
 * e1-prepare.ts covers step 1 (open E1: mint FXRP → supply → borrow USDT0,
 * unsigned). This script rehearses the rest of the lifecycle against LIVE
 * mainnet market data, without a live position and without signing anything:
 *
 *   STEP 2 — supply the borrowed USDT0 into the Kinetic ISO (approve + mint):
 *            unsigned calldata, printed.
 *   STEP 3 — price-drop protection: KineticIsoMath (the SAME module E1/A1 use)
 *            computes the A1 trigger price, shows HF falling through it under a
 *            simulated FXRP/USD drop, encodes the protective repayBorrow, and
 *            proves HF rises after the repay.
 *   STEP 4 — DERISK: withdraw USDT0 → repay debt → withdraw FXRP collateral,
 *            unsigned calldata, printed. Debt after = 0 → no liquidation risk.
 *
 * Everything on-chain is eth_call (FTSO price, CF, borrow liquidity, guardian
 * pauses). No signer exists in this process; nothing can be broadcast.
 * Invariant #1: Astryum prepares — only the user's wallet ever signs.
 *
 * Usage:
 *   FLARE_DEFI_ENABLED=true npx ts-node src/scripts/carry-dryrun.ts \
 *     --amount 5 --ratio 0.3 --target-hf 1.1 --drop 0.25
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { getProtocolAddresses } from '../config/protocolAddresses';
import { createFTSOPriceProvider } from '../engines/normalisation/NormalisationEngine';
import {
  computeNetMint,
  readDirectMintParams,
} from '../connectors/protocols/flare/FlareDirectMintService';
import { computeBorrowUsdt0, computeTriggerPrice } from '../connectors/protocols/flare/KineticIsoMath';

const RPC = process.env.FLARE_RPC_URL ?? 'https://flare-api.flare.network/ext/C/rpc';
const MANTISSA = 1e18;
const UNITS6 = 1_000_000; // FXRP UBA == XRP drops == USDT0 base (6 dec, verified mainnet)

const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const KTOKEN_ABI = [
  'function mint(uint256 mintAmount) returns (uint256)',
  'function borrow(uint256 borrowAmount) returns (uint256)',
  'function repayBorrow(uint256 repayAmount) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
  'function getCash() view returns (uint256)',
];
const COMPTROLLER_ABI = [
  'function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)',
  'function borrowGuardianPaused(address) view returns (bool)',
  'function mintGuardianPaused(address) view returns (bool)',
];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function step(msg: string): void {
  console.log(`\n[dry-run] ${msg}`);
}
function abort(msg: string): never {
  console.error(`\n[dry-run] ABORT — ${msg}\n`);
  process.exit(1);
}
function printCalls(label: string, calls: { to: string; calldata: string; value: string }[]): void {
  console.log(`  unsigned ${label} batch (Call[] for the user's Personal Account):`);
  calls.forEach((c, i) => {
    console.log(`    [${i}] to=${c.to}`);
    console.log(`        data=${c.calldata}`);
  });
}
const human6 = (v: bigint) => Number(v) / UNITS6;

async function main() {
  const amountXrp = Number(arg('amount', '5'));
  const borrowRatio = Number(arg('ratio', '0.3'));
  const targetHF = Number(arg('target-hf', '1.1'));
  const dropPct = Number(arg('drop', '0.25'));
  if (!(amountXrp > 0)) abort('--amount must be > 0');
  if (!(borrowRatio > 0 && borrowRatio <= 1)) abort('--ratio must be in (0,1]');
  if (!(targetHF > 0)) abort('--target-hf must be > 0');
  if (!(dropPct > 0 && dropPct < 1)) abort('--drop must be in (0,1)');
  if (process.env.FLARE_DEFI_ENABLED !== 'true') abort('FLARE_DEFI_ENABLED is not "true" (#8)');

  const k = getProtocolAddresses().kinetic;
  const fxrpToken = getProtocolAddresses().fxrp.token;
  const usdt0 = process.env.USDT0_TOKEN ?? '0xe7cd86e13AC4309349F30B3435a9d337750fC82D'; // verified via kUSDT0_ISO.underlying()
  if (!k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0 || !fxrpToken) {
    abort('missing KINETIC_ISO_COMPTROLLER / KINETIC_KFXRP_ISO / KINETIC_KUSDT0_ISO / FXRP_TOKEN env');
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const erc20 = new ethers.Interface(ERC20_ABI);
  const kToken = new ethers.Interface(KTOKEN_ABI);

  // ── Live market reads (eth_call only) ──────────────────────────────────────
  step('live reads: FTSO XRP/USD, CF, ISO liquidity, guardians');
  const priceProvider = await createFTSOPriceProvider();
  const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
  if (!(fxrpPriceUSD > 0)) abort('FTSO XRP/USD read returned 0');

  const comptroller = new ethers.Contract(k.isoComptroller, COMPTROLLER_ABI, provider);
  const [isListed, cfMantissa] = await comptroller.markets(k.isoKFxrp);
  if (!isListed) abort('kFXRP_ISO is not listed on the ISO comptroller');
  const collateralFactor = Number(cfMantissa) / MANTISSA;
  const kUsdt0 = new ethers.Contract(k.isoKUsdt0, KTOKEN_ABI, provider);
  const cash: bigint = await kUsdt0.getCash();
  const borrowPaused: boolean = await comptroller.borrowGuardianPaused(k.isoKUsdt0);
  const mintPaused: boolean = await comptroller.mintGuardianPaused(k.isoKFxrp);
  console.log(`  FTSO XRP/USD:      ${fxrpPriceUSD}`);
  console.log(`  kFXRP_ISO CF:      ${collateralFactor}`);
  console.log(`  USDT0 borrowable:  ${human6(cash)} USDT0`);
  console.log(`  guardians:         borrowPaused=${borrowPaused} mintPaused=${mintPaused}`);
  if (borrowPaused || mintPaused) abort('ISO market paused — no point rehearsing');

  // ── Position sizing — the same math E1 uses (one source of truth) ─────────
  step(`position sizing for ${amountXrp} XRP, ratio ${borrowRatio}, live params`);
  const mintParams = await readDirectMintParams(provider);
  const net = computeNetMint(BigInt(Math.round(amountXrp * UNITS6)), mintParams);
  const borrow = computeBorrowUsdt0({
    supplyUBA: net.supplyUBA,
    fxrpPriceUSD,
    collateralFactor,
    borrowRatio,
  });
  const trig = computeTriggerPrice({
    supplyUBA: net.supplyUBA,
    borrowUsdt0Base: borrow.borrowUsdt0Base,
    collateralFactor,
    targetHF,
  });
  console.log(`  FXRP supplied:     ${human6(net.supplyUBA)} FXRP (net of mint/executor fees + buffer)`);
  console.log(`  USDT0 borrowed:    ${borrow.borrowUsdt0Human} USDT0`);
  console.log(`  HF at entry:       ${trig.hfAt(fxrpPriceUSD).toFixed(4)}`);
  console.log(`  A1 trigger price:  ${trig.triggerPriceUSD.toFixed(6)} USD (HF hits ${targetHF})`);

  // ── STEP 2 — supply the borrowed USDT0 into the ISO (unsigned) ────────────
  step('STEP 2 — supply borrowed USDT0 into kUSDT0_ISO (unsigned encode)');
  const supplyUsdt0Batch = [
    { to: usdt0, calldata: erc20.encodeFunctionData('approve', [k.isoKUsdt0, borrow.borrowUsdt0Base]), value: '0' },
    { to: k.isoKUsdt0, calldata: kToken.encodeFunctionData('mint', [borrow.borrowUsdt0Base]), value: '0' },
  ];
  printCalls('USDT0-supply', supplyUsdt0Batch);

  // ── STEP 3 — price drop → protection fires → HF rises ─────────────────────
  step(`STEP 3 — simulate FXRP/USD −${(dropPct * 100).toFixed(0)}% → protective repay → HF recovers`);
  const hfNow = trig.hfAt(fxrpPriceUSD);
  // Walk the price down to the trigger first (protection fires there), then to the full drop.
  const droppedPrice = fxrpPriceUSD * (1 - dropPct);
  const hfDropped = trig.hfAt(droppedPrice);
  const fires = droppedPrice < trig.triggerPriceUSD || hfDropped < targetHF;
  console.log(`  HF @ ${fxrpPriceUSD.toFixed(6)} (now):        ${hfNow.toFixed(4)}`);
  console.log(`  HF @ ${droppedPrice.toFixed(6)} (−${(dropPct * 100).toFixed(0)}%):       ${hfDropped.toFixed(4)}  ${fires ? '→ BELOW target — A1 protection fires' : '→ still above target (deeper drop needed to fire)'}`);

  // Protective repay: halve the debt (A1's defensive default is a partial repay
  // that restores headroom without closing the position).
  const repayBase = borrow.borrowUsdt0Base / 2n;
  const debtAfterRepay = borrow.borrowUsdt0Base - repayBase;
  const trigAfter = computeTriggerPrice({
    supplyUBA: net.supplyUBA,
    borrowUsdt0Base: debtAfterRepay,
    collateralFactor,
    targetHF,
  });
  const hfAfterRepay = trigAfter.hfAt(droppedPrice);
  const repayBatch = [
    { to: usdt0, calldata: erc20.encodeFunctionData('approve', [k.isoKUsdt0, repayBase]), value: '0' },
    { to: k.isoKUsdt0, calldata: kToken.encodeFunctionData('repayBorrow', [repayBase]), value: '0' },
  ];
  printCalls('protective-repay', repayBatch);
  console.log(`  HF after repaying ${human6(repayBase)} USDT0 @ dropped price: ${hfAfterRepay.toFixed(4)}`);
  if (!(hfAfterRepay > hfDropped)) abort('protection did NOT raise HF — math regression');
  console.log(`  ✓ protection raises HF: ${hfDropped.toFixed(4)} → ${hfAfterRepay.toFixed(4)}`);

  // ── STEP 4 — DERISK: unwind everything (unsigned) ──────────────────────────
  step('STEP 4 — DERISK: withdraw USDT0 → repay all → withdraw FXRP (unsigned encode)');
  const deriskBatch = [
    // withdraw the USDT0 supplied in STEP 2 (skip if STEP 2 was never signed)
    { to: k.isoKUsdt0, calldata: kToken.encodeFunctionData('redeemUnderlying', [borrow.borrowUsdt0Base]), value: '0' },
    // repay the full remaining debt
    { to: usdt0, calldata: erc20.encodeFunctionData('approve', [k.isoKUsdt0, borrow.borrowUsdt0Base]), value: '0' },
    { to: k.isoKUsdt0, calldata: kToken.encodeFunctionData('repayBorrow', [borrow.borrowUsdt0Base]), value: '0' },
    // free the FXRP collateral
    { to: k.isoKFxrp, calldata: kToken.encodeFunctionData('redeemUnderlying', [net.supplyUBA]), value: '0' },
  ];
  printCalls('derisk', deriskBatch);
  console.log('  after DERISK: debt = 0 USDT0 → no liquidation price exists; FXRP back in the Personal Account.');

  // ── Invariant statement ─────────────────────────────────────────────────────
  console.log('\n===========================================================');
  console.log('  DRY-RUN COMPLETE — every on-chain interaction was eth_call.');
  console.log('  No signer exists in this process. Nothing was signed or');
  console.log('  broadcast. The batches above execute ONLY if the user signs');
  console.log('  them from their own wallet (invariant #1).');
  console.log('===========================================================\n');
}

main().catch((e) => abort(e instanceof Error ? e.message : String(e)));

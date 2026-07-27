#!/usr/bin/env ts-node
/**
 * E1 prepare — produce the UNSIGNED XRPL Payment for the FXRP direct-mint entry
 * (mint FXRP from XRP → supply collateral → borrow USDT0 on Kinetic ISO), for a
 * MANUAL mainnet test in Xaman. Astryum signs nothing; this only prints calldata.
 *
 * Order is deliberate (invariant frontier first):
 *   1. GATING  — FLARE_DEFI_ENABLED (#8) → geofence (#5) → KWYH scanner (#10).
 *                Any failure aborts BEFORE any live read or build.
 *   2. READS   — live FTSO XRP/USD + live CF of kFXRP ISO (not cached).
 *   3. BUILD   — buildE1Handoff (post-fee net, borrow = net·CF·ratio, 0xFE memo).
 *   4. DISCLOSE— fees + net FXRP + USDT0 + HF + trigger price (#6) BEFORE output.
 *   5. OUTPUT  — unsigned XRPL Payment (paste into Xaman) + off-chain userOp bytes.
 *
 * Usage:
 *   npx ts-node src/scripts/e1-prepare.ts \
 *     --xrpl rYourXrplAddr --amount 5 --ratio 0.3 --target-hf 1.1 --region US
 *
 * ⚠️ Use a MINIMAL amount (a few XRP) on the first live run. Review the disclosure
 *    in this output AND in Xaman before signing. If the numbers surprise you, STOP.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { jurisdictionService } from '../services/JurisdictionService';
import { goPlusProvider } from '../integrations/providers/security/GoPlusProvider';
import { createFTSOPriceProvider } from '../engines/normalisation/NormalisationEngine';
import { getProtocolAddresses } from '../config/protocolAddresses';
import { buildE1Handoff } from '../connectors/protocols/flare/FlareDirectMintService';

const FLARE_CHAIN_ID = 14;
const MANTISSA = 1e18;
const DROPS = 1_000_000; // 1 XRP = 1e6 drops; USDT0/FXRP UBA = 6 dec

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function step(msg: string, data?: unknown): void {
  console.log(`[E1] ${msg}${data !== undefined ? ' ' + JSON.stringify(data, bigintReplacer) : ''}`);
}
function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}
function abort(msg: string): never {
  console.error(`\n[E1] ABORT — ${msg}\n`);
  process.exit(1);
}

async function main() {
  const xrplAddress = arg('xrpl');
  const amountXrp = Number(arg('amount', '0'));
  const borrowRatio = Number(arg('ratio', '0'));
  const targetHF = Number(arg('target-hf', '0'));
  const region = arg('region');
  const walletId = Number(arg('wallet-id', '0'));

  if (!xrplAddress) abort('missing --xrpl <address>');
  if (!(amountXrp > 0)) abort('missing/invalid --amount <XRP>');
  if (!(borrowRatio > 0 && borrowRatio <= 1)) abort('--ratio must be in (0,1]');
  if (!(targetHF > 0)) abort('missing/invalid --target-hf');
  if (amountXrp > 50) {
    console.warn(`[E1] ⚠️ amount ${amountXrp} XRP is large for a first live test — consider a few XRP first.`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. GATING (hard frontier — runs before any read or build)
  // ──────────────────────────────────────────────────────────────────────────
  step('gating: checking FLARE_DEFI_ENABLED (#8)');
  if (process.env.FLARE_DEFI_ENABLED !== 'true') abort('FLARE_DEFI_ENABLED is not "true" (#8)');

  step('gating: geofence (#5)', { region: region ?? null });
  const geo = jurisdictionService.isDefiExecutionAllowed(region ?? null);
  if (!geo.allowed) abort(`geofence blocked DeFi execution (#5): ${geo.reason}`);
  step('gating: geofence OK', geo);

  const fxrpToken = getProtocolAddresses().fxrp.token;
  const k = getProtocolAddresses().kinetic;
  if (!fxrpToken || !k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0) {
    abort('ISO market / FXRP env not configured (FXRP_TOKEN, KINETIC_ISO_COMPTROLLER, KINETIC_KFXRP_ISO, KINETIC_KUSDT0_ISO)');
  }
  step('gating: KWYH scanner (#10) on FXRP + ISO kTokens');
  for (const [label, addr] of [
    ['FXRP', fxrpToken],
    ['kFXRP_ISO', k.isoKFxrp],
    ['kUSDT0_ISO', k.isoKUsdt0],
  ] as const) {
    try {
      const { data } = await goPlusProvider.call<{ chainId: number; address: string }, { verdict: string; flags: string[] }>(
        'security.tokenSafety',
        { chainId: FLARE_CHAIN_ID, address: addr! },
        { traceId: 'e1-prepare', wallet: xrplAddress },
      );
      step(`scanner ${label}`, data);
      if (data.verdict === 'danger') abort(`KWYH scanner flagged ${label} as DANGER (#10): ${data.flags.join(',')}`);
    } catch (e) {
      console.warn(`[E1] ⚠️ scanner could not run for ${label} (${(e as Error).message}) — manual KWYH review required before signing.`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. LIVE READS (price + collateral factor — not cached)
  // ──────────────────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: FLARE_CHAIN_ID },
    { staticNetwork: true },
  );

  step('reading live FTSO XRP/USD');
  const priceProvider = await createFTSOPriceProvider();
  const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
  if (!(fxrpPriceUSD > 0)) abort('FTSO XRP/USD read returned 0 — refusing to size the position');
  step('FTSO XRP/USD', { fxrpPriceUSD });

  step('reading live collateral factor markets(kFXRP_ISO)');
  const comptroller = new ethers.Contract(
    k.isoComptroller!,
    ['function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)'],
    provider,
  );
  const market = await comptroller.markets(k.isoKFxrp!);
  if (!market[0]) abort('kFXRP ISO market not listed');
  const collateralFactor = Number(market[1]) / MANTISSA;
  step('collateral factor', { collateralFactor });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. BUILD (unsigned)
  // ──────────────────────────────────────────────────────────────────────────
  const grossXrpDrops = BigInt(Math.round(amountXrp * DROPS));
  step('building E1 hand-off', { grossXrpDrops, borrowRatio, targetHF, walletId });
  const e1 = await buildE1Handoff(provider, {
    xrplAddress,
    grossXrpDrops,
    borrowRatio,
    targetHF,
    fxrpPriceUSD,
    collateralFactor,
    walletId,
  });
  step('personal account', { personalAccount: e1.handoff.personalAccount });
  step('userOp hash (committed in memo)', { userOpHash: e1.handoff.userOpHash });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. DISCLOSURE (#6) — show the real cost BEFORE you sign
  // ──────────────────────────────────────────────────────────────────────────
  const net = e1.handoff.net;
  const supplyFxrp = Number(net.supplyUBA) / DROPS;
  const borrowUsdt0 = Number(e1.borrow.borrowUsdt0Base) / DROPS;
  const entryHF = (supplyFxrp * fxrpPriceUSD * collateralFactor) / (borrowUsdt0 * 1);
  console.log('\n=========== DISCLOSURE (review before signing, invariant #6) ===========');
  console.log(`  You pay (gross):        ${amountXrp} XRP`);
  console.log(`  Minting fee:            ${Number(net.mintingFeeUBA) / DROPS} XRP`);
  console.log(`  Executor fee:           ${Number(net.executorFeeUBA) / DROPS} XRP`);
  console.log(`  FXRP minted to your PA: ${Number(net.netToPersonalAccountUBA) / DROPS} FXRP`);
  console.log(`  FXRP supplied (buffer): ${supplyFxrp} FXRP  (10bip safety buffer)`);
  console.log(`  USDT0 borrowed:         ${borrowUsdt0} USDT0  (ratio ${borrowRatio} of max, CF ${collateralFactor})`);
  console.log(`  FXRP/USD now:           ${fxrpPriceUSD}`);
  console.log(`  Health Factor at entry: ${entryHF.toFixed(3)}`);
  console.log(`  A1 stop-loss triggers when FXRP/USD < ${e1.a1.triggerPriceUSD.toFixed(5)}  (target HF ${targetHF})`);
  console.log('  ⚠️ USDT0 borrow is a DEMO exception to invariant #4 — gated, non-EU-facing, counsel-flagged.');
  console.log('=======================================================================\n');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. OUTPUT — unsigned XRPL Payment for Xaman + off-chain userOp bytes
  // ──────────────────────────────────────────────────────────────────────────
  console.log('=========== UNSIGNED XRPL Payment — paste into Xaman ===========');
  console.log(JSON.stringify(e1.handoff.xrplPayment, null, 2));
  console.log('\nDestination =', e1.handoff.xrplPayment.Destination, '(FAssets Core Vault — NO DestinationTag)');
  console.log('\noff-chain userOp bytes (deliver to the Flare executor):');
  console.log(e1.handoff.userOpData);
  console.log('\nA1 reuse block (for F4 — do NOT recompute):', JSON.stringify(e1.a1, bigintReplacer));
  console.log('\n[E1] Astryum signed nothing. Sign the Payment in YOUR Xaman. Minimal amount first.');
}

main().catch((e) => {
  console.error('[E1] FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

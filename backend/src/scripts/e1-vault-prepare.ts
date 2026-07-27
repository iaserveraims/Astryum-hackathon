#!/usr/bin/env ts-node
/**
 * E1-VAULT prepare — produce the UNSIGNED, ATOMIC XRPL Payment that, from a SINGLE
 * Xaman signature, (a) direct-mints FXRP from XRP and (b) deposits that FXRP into a
 * SELECTED Flare-EVM vault — in one shot. Astryum signs nothing; this only prints
 * the unsigned hand-off (calldata + memo + XRPL Payment) for a manual mainnet test.
 *
 * This is the pure "mint + enter vault" case (NO borrow). It reuses the SAME proven
 * `0xFE` direct-minting machinery as e1-prepare.ts (`buildDirectMintHandoff`); the
 * ONLY difference is the inner batch — here it is just `[approve, deposit]`.
 *
 * Atomicity: the user signs ONE XRPL Payment. On Flare, the executor calls
 * AssetManager.executeDirectMinting → FXRP is minted into the user's Personal
 * Account → MasterAccountController dispatches the committed userOp →
 * PersonalAccount.executeUserOp([approve(vault), deposit]) runs in the SAME tx.
 * Mint and vault-deposit are atomic; if the deposit reverts the FXRP stays safe in
 * the PA. The executor/operator pays Flare gas (the XRPL user needs no FLR).
 *
 * Deposit method (per vault type):
 *   --method ktoken   → Compound-style kToken: `mint(assets)` (shares to msg.sender=PA).
 *                       This is the DEFAULT and targets the live kFXRP ISO market.
 *   --method erc4626  → ERC-4626 vault (Firelight/Upshift): `deposit(assets, PA)`.
 *
 * Usage:
 *   npx ts-node src/scripts/e1-vault-prepare.ts \
 *     --xrpl rYourXrplAddr --amount 5 [--vault 0x... --method ktoken|erc4626]
 *
 * Default vault = KINETIC_KFXRP_ISO (a real, configured mainnet FXRP vault), so this
 * runs end-to-end against mainnet TODAY. Pass --vault for any other ERC-4626 vault.
 *
 * ⚠️ Use a MINIMAL amount on the first live run. Review the disclosure here AND in
 *    Xaman before signing. If the numbers surprise you, STOP.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { jurisdictionService } from '../services/JurisdictionService';
import { getProtocolAddresses } from '../config/protocolAddresses';
import {
  readDirectMintParams,
  computeNetMint,
  buildDirectMintHandoff,
} from '../connectors/protocols/flare/FlareDirectMintService';
import { resolvePersonalAccount } from '../connectors/protocols/flare/FlareSmartAccountService';
import type { EncodedAction } from '../connectors/protocols/IProtocolAdapter';

const FLARE_CHAIN_ID = 14;
const DROPS = 1_000_000; // 1 XRP = 1e6 drops; FXRP UBA = 6 dec

// Minimal ABIs for the inner batch (self-contained; no hardcoded addresses).
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const KTOKEN_ABI = ['function mint(uint256 mintAmount) returns (uint256)'];
const ERC4626_ABI = ['function deposit(uint256 assets, address receiver) returns (uint256)'];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function step(msg: string, data?: unknown): void {
  console.log(`[E1V] ${msg}${data !== undefined ? ' ' + JSON.stringify(data, bigintReplacer) : ''}`);
}
function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}
function abort(msg: string): never {
  console.error(`\n[E1V] ABORT — ${msg}\n`);
  process.exit(1);
}

/** Build the pure "enter vault" batch: approve the vault to pull FXRP, then deposit. */
function buildVaultDepositBatch(input: {
  fxrpToken: string;
  vault: string;
  supplyUBA: bigint;
  method: 'ktoken' | 'erc4626';
  personalAccount: string;
}): EncodedAction[] {
  const erc20 = new ethers.Interface(ERC20_ABI);
  const approve: EncodedAction = {
    to: input.fxrpToken,
    calldata: erc20.encodeFunctionData('approve', [input.vault, input.supplyUBA]),
    value: '0',
  };
  let deposit: EncodedAction;
  if (input.method === 'ktoken') {
    // Compound-style: mint(assets) → kToken shares minted to msg.sender (the PA).
    const kToken = new ethers.Interface(KTOKEN_ABI);
    deposit = {
      to: input.vault,
      calldata: kToken.encodeFunctionData('mint', [input.supplyUBA]),
      value: '0',
    };
  } else {
    // ERC-4626: deposit(assets, receiver) → shares to the PA.
    const vault = new ethers.Interface(ERC4626_ABI);
    deposit = {
      to: input.vault,
      calldata: vault.encodeFunctionData('deposit', [input.supplyUBA, input.personalAccount]),
      value: '0',
    };
  }
  return [approve, deposit];
}

async function main() {
  const xrplAddress = arg('xrpl');
  const amountXrp = Number(arg('amount', '0'));
  const method = (arg('method', 'ktoken') as 'ktoken' | 'erc4626');
  const walletId = Number(arg('wallet-id', '0'));
  const region = arg('region');

  if (!xrplAddress) abort('missing --xrpl <address>');
  if (!(amountXrp > 0)) abort('missing/invalid --amount <XRP>');
  if (method !== 'ktoken' && method !== 'erc4626') abort('--method must be ktoken|erc4626');

  // ── 1. GATING (invariant frontier — before any read/build) ──────────────────
  step('gating: FLARE_DEFI_ENABLED (#8)');
  if (process.env.FLARE_DEFI_ENABLED !== 'true') abort('FLARE_DEFI_ENABLED is not "true" (#8)');
  step('gating: geofence (#5)', { region: region ?? null });
  const geo = jurisdictionService.isDefiExecutionAllowed(region ?? null);
  if (!geo.allowed) abort(`geofence blocked DeFi execution (#5): ${geo.reason}`);

  // Default vault = live kFXRP ISO market; override with --vault for any ERC-4626 vault.
  const defaultVault = getProtocolAddresses().kinetic.isoKFxrp;
  const vault = arg('vault', defaultVault);
  if (!vault || !/^0x[a-fA-F0-9]{40}$/.test(vault)) {
    abort('no vault: pass --vault 0x... (or set KINETIC_KFXRP_ISO for the default)');
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: FLARE_CHAIN_ID },
    { staticNetwork: true },
  );

  // ── 2. LIVE READS (direct-mint params + PA) ─────────────────────────────────
  step('reading live direct-mint params from AssetManagerFXRP');
  const params = await readDirectMintParams(provider);
  step('direct-mint params', {
    fxrpToken: params.fxrpToken,
    coreVaultXrpl: params.paymentAddress,
    minFeeUBA: params.minFeeUBA,
    feeBIPS: params.feeBIPS,
    executorFeeUBA: params.executorFeeUBA,
  });

  const grossXrpDrops = BigInt(Math.round(amountXrp * DROPS));
  const net = computeNetMint(grossXrpDrops, params);
  const personalAccount = await resolvePersonalAccount(provider, xrplAddress);
  step('personal account (smart account on Flare)', { personalAccount });

  // ── 3. BUILD (unsigned) — inner batch is just [approve, deposit] ────────────
  const innerCalls = buildVaultDepositBatch({
    fxrpToken: params.fxrpToken,
    vault,
    supplyUBA: net.supplyUBA,
    method,
    personalAccount,
  });
  step('inner batch built', { calls: innerCalls.length, method, vault });

  const handoff = await buildDirectMintHandoff(
    provider,
    { xrplAddress, grossXrpDrops, innerCalls, walletId },
    { params }, // reuse the already-read params → consistent net, one RPC read
  );
  step('userOp hash (committed in the 0xFE memo)', { userOpHash: handoff.userOpHash });

  // Also measure the 0xFF inline option (full userOp in the memo — no off-chain
  // executor delivery needed). Shows whether the self-contained path fits.
  const { MemoFieldUserOpCustomInstruction } = await import('@flarenetwork/smart-accounts-encoder');
  const memo0xFF = new MemoFieldUserOpCustomInstruction({
    walletId,
    executorFeeUBA: params.executorFeeUBA,
    packedUserOperation: handoff.userOpData as `0x${string}`,
  }).encode();
  const memo0xFFBytes = (memo0xFF.replace(/^0x/i, '').length) / 2;

  // ── 4. DISCLOSURE (#6) — real cost before signing ───────────────────────────
  console.log('\n=========== DISCLOSURE (review before signing, invariant #6) ===========');
  console.log(`  You pay (gross):          ${amountXrp} XRP`);
  console.log(`  Minting fee:              ${Number(net.mintingFeeUBA) / DROPS} XRP`);
  console.log(`  Executor fee:             ${Number(net.executorFeeUBA) / DROPS} XRP`);
  console.log(`  FXRP minted to your PA:   ${Number(net.netToPersonalAccountUBA) / DROPS} FXRP`);
  console.log(`  FXRP deposited to vault:  ${Number(net.supplyUBA) / DROPS} FXRP  (10bip safety buffer)`);
  console.log(`  Vault (deposit target):   ${vault}  [${method}]`);
  console.log(`  Shares receiver:          ${personalAccount} (your Personal Account)`);
  console.log('=======================================================================\n');

  // ── 5. OUTPUT — unsigned XRPL Payment for Xaman + the two memo options ───────
  console.log('=========== UNSIGNED XRPL Payment — paste into Xaman (0xFE path) ===========');
  console.log(JSON.stringify(handoff.xrplPayment, null, 2));
  console.log('\nDestination =', handoff.xrplPayment.Destination, '(FAssets Core Vault — NO DestinationTag)');
  console.log('\nInner batch (runs atomically on your Personal Account AFTER the mint):');
  innerCalls.forEach((c, i) => console.log(`  [${i}] to=${c.to} value=${c.value} data=${c.calldata.slice(0, 18)}…`));

  console.log('\n--- 0xFE memo (small; userOp bytes delivered off-chain to executor) ---');
  console.log(`  memo (MemoData): ${handoff.memoHex}  (${handoff.memoHex.length / 2} bytes)`);
  console.log('  off-chain userOp bytes (give to the Flare executor):');
  console.log(`  ${handoff.userOpData}`);

  console.log('\n--- 0xFF memo (full userOp INLINE; no off-chain executor channel) ---');
  console.log(`  inline memo size: ${memo0xFFBytes} bytes — ${memo0xFFBytes <= 1024 ? (memo0xFFBytes <= 900 ? 'FITS (comfortable)' : 'FITS (tight, >900)') : 'TOO BIG → must use 0xFE'}`);
  if (memo0xFFBytes <= 1024) {
    console.log(`  inline MemoData: ${memo0xFF.replace(/^0x/i, '').toUpperCase()}`);
  }

  console.log('\n[E1V] Astryum signed nothing. Sign the Payment in YOUR Xaman. Minimal amount first.');
}

main().catch((e) => {
  console.error('[E1V] FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

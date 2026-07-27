/**
 * legacy-order-relay — CLI wrapper over LegacyOrderRelayService.
 *
 * Carry ONE quorum-signed council order across the FDC to the bridge:
 *   npx ts-node src/scripts/legacy-order-relay.ts <xrplTxHash> [orderDataHex]
 *
 * Permissionless by design: anyone with any funded Flare key can run this —
 * the bridge only accepts the bytes the quorum committed. This wrapper uses
 * FLARE_EXECUTOR_PK (Astryum's courtesy relayer); the survival folder documents
 * how a family member runs the same steps with their own key if Astryum is gone.
 *
 * Env: LEGACY_CHAIN, LEGACY_BRIDGE_ADDRESS, LEGACY_VAULT_ADDRESS,
 *      FLARE_EXECUTOR_ENABLED=true, FLARE_EXECUTOR_PK, (FDC_* overrides).
 */

import { relayCouncilOrder, RelayAbort } from '../services/flare/LegacyOrderRelayService';

async function main(): Promise<void> {
  const [txHash, orderData] = process.argv.slice(2);
  if (!txHash) {
    console.error('usage: legacy-order-relay.ts <xrplTxHash> [orderDataHex]');
    process.exit(1);
  }
  try {
    const out = await relayCouncilOrder({
      xrplTxHash: txHash,
      ...(orderData ? { orderDataOverride: orderData } : {}),
      log: (m) => console.log(m),
    });
    console.log(`\n${out.stage === 'executed' ? '✓ ORDER EXECUTED' : '✓ already executed'}`);
    if (out.flareTxHash) console.log(`  Flare tx: ${out.flareTxHash}`);
    if (out.requestFeeFLR) console.log(`  FDC fee paid: ${out.requestFeeFLR} FLR`);
  } catch (e) {
    console.error(`\n✗ ${e instanceof RelayAbort ? 'ABORTED' : 'FAILED'}: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();

#!/usr/bin/env ts-node
/**
 * XRPL ecosystem watch — run at the start of every XRPL session.
 *
 * Reports, from public read-only APIs, whether the gated XRPL phases have
 * unlocked: SmartEscrow/LendingProtocol/SingleAssetVault amendments, the
 * RLUSD issuer escrow flag, and whether the XRPL EVM Sidechain has grown a
 * real money-market/yield venue.
 *
 * Usage: npx ts-node src/scripts/xrpl-watch.ts
 * Exit code 0 always (informational); network failures are printed, not hidden.
 */
import { runXrplEcosystemWatch, formatWatchReport } from '../connectors/protocols/xrpl/XrplEcosystemWatch';

async function main(): Promise<void> {
  const result = await runXrplEcosystemWatch();
  // eslint-disable-next-line no-console
  console.log(formatWatchReport(result));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('xrpl-watch failed:', err);
  process.exit(1);
});

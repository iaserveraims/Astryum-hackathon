/**
 * verify-demo-run — reads every receipt of a Demo Exchange run from the chain
 * and writes the proof document (BuildSpec Demo Exchange v2 §3).
 *
 *   npx ts-node src/scripts/verify-demo-run.ts <runId> [outDir]
 *
 * Read-only: `eth_call` / receipts on Flare, `tx` / `account_objects` on XRPL.
 * Needs DATABASE_URL (the run lives in background_jobs) and FLARE_RPC_URL.
 * Writes `<outDir>/proof-run-<date>-<seq>.md` (default: docs/context).
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadRun, saveRun } from '../services/demoExchange/DemoExchangeStore';
import { verifyRun } from '../services/demoExchange/DemoRunVerifier';
import { renderProofMarkdown } from '../services/demoExchange/proofMarkdown';

async function main(): Promise<void> {
  const runId = process.argv[2];
  const outDir = process.argv[3] ?? path.resolve(__dirname, '../../../docs/context');
  if (!runId) {
    console.error('usage: verify-demo-run <runId> [outDir]');
    process.exit(2);
  }
  const run = await loadRun(runId);
  if (!run) {
    console.error(`run ${runId} not found`);
    process.exit(1);
  }
  console.log(`verifying run #${run.seq} "${run.label}" — ${run.receipts.length} receipts`);
  await verifyRun(run);
  await saveRun(run);
  const md = renderProofMarkdown(run);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(outDir, `proof-run-${date}-${run.seq}.md`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, md, 'utf8');
  const ok = run.receipts.filter((r) => r.checks.length && r.checks.every((k) => k.ok)).length;
  const bad = run.receipts.filter((r) => r.checks.some((k) => k.ok === false)).length;
  console.log(`verified ${ok}/${run.receipts.length} · failed ${bad} · wrote ${file}`);
  for (const r of run.receipts) {
    for (const k of r.checks) if (k.ok === false) console.log(`  ❌ ${r.step} ${r.txHash ?? ''} — ${k.label}: ${k.reason ?? ''}`);
  }
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

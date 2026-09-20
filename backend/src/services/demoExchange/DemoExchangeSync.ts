/**
 * DemoExchangeSync — one place that turns the omnibus scan into ledger
 * movements and receipts, shared by the HTTP route (a human pressing "scan")
 * and the autopilot (the loop). Read-only on the chain.
 */

import { applyMovements, newId, runTagRange, type DemoRun, type LedgerMovement, type Receipt, type ReceiptChain, type ReceiptStep } from './DemoExchangeStore';
import { classifyOmnibusTxs, movementsFrom, scanOmnibus, type ClassifiedTx, type OmnibusTx } from './OmnibusWatcher';
import { explorerUrl } from './DemoRunVerifier';

export function makeReceipt(run: DemoRun, input: {
  step: ReceiptStep;
  chain: ReceiptChain;
  txHash?: string;
  clientId?: string;
  note?: string;
  expect?: Record<string, string | number | boolean>;
}): Receipt {
  const txHash = input.txHash ? (input.chain === 'xrpl' ? input.txHash.toUpperCase() : input.txHash) : undefined;
  return {
    id: newId('rc'),
    runId: run.runId,
    clientId: input.clientId,
    step: input.step,
    chain: input.chain,
    txHash,
    explorerUrl: explorerUrl(input.chain, txHash),
    at: new Date().toISOString(),
    note: input.note,
    expect: input.expect,
    checks: [],
  };
}

/**
 * Pure (mutates `classified`): an outgoing payment whose hash a withdraw RECORD
 * carries (a request the omnibus key signed, a desk payout reported signed) is
 * that record's client's — not whoever holds the destination wallet today. The
 * wallet lookup alone let an admin re-point hand A's debit to B (it. 8).
 */
export function attributeKnownPayouts(run: DemoRun, classified: ClassifiedTx[]): void {
  const owner = new Map<string, string>();
  for (const r of run.requests ?? []) if (r.kind === 'withdraw' && r.txHash) owner.set(r.txHash.toUpperCase(), r.clientId);
  for (const d of run.deskPayments ?? []) if (d.kind === 'withdraw' && d.txHash) owner.set(d.txHash.toUpperCase(), d.clientId);
  if (!owner.size) return;
  const since = run.sinceLedgerIndex;
  for (const t of classified) {
    const clientId = owner.get(t.hash.toUpperCase());
    if (!clientId || t.direction !== 'out' || !t.validated || t.result !== 'tesSUCCESS') continue;
    if (since !== undefined && !(t.ledgerIndex !== undefined && t.ledgerIndex >= since)) continue;
    if (!run.clients.some((c) => c.id === clientId)) continue;
    t.kind = 'withdraw';
    t.clientId = clientId;
  }
}

export interface SyncResult {
  txs: ClassifiedTx[];
  credited: LedgerMovement[];
}

/** Scan the omnibus, apply what is new to the ledger, add one receipt per new movement. */
export async function syncOmnibus(run: DemoRun, opts?: { maxPages?: number }): Promise<SyncResult> {
  // The two CONECTA boundaries travel together: the server-side window (scan)
  // and the classification frontier + tag range (classify). On a fresh demo
  // omnibus both are no-ops; on a live one they are what keeps legacy traffic
  // from being credited to demo clients.
  const txs = await scanOmnibus(run.omnibusAddress, { maxPages: opts?.maxPages ?? 2, sinceLedgerIndex: run.sinceLedgerIndex });
  return applyOmnibusScan(run, txs);
}

/**
 * Pure (mutates `run`): the ledger half of syncOmnibus, over rows ALREADY read.
 * Lets a route read the chain OUTSIDE the run lock and apply the rows to a fresh
 * copy inside it (productizer it. 12, 2.6b). Idempotent by tx hash.
 */
export function applyOmnibusScan(run: DemoRun, txs: OmnibusTx[]): SyncResult {
  const classified = classifyOmnibusTxs(txs, run.clients, { tagRange: runTagRange(run), sinceLedgerIndex: run.sinceLedgerIndex });
  attributeKnownPayouts(run, classified);
  const fresh = applyMovements(run, movementsFrom(classified));
  for (const m of fresh) {
    const tx = classified.find((t) => t.hash === m.txHash);
    // The payout proof (payoutProof.ts): the account the LEDGER shows paying a
    // credited deposit in. Recorded here and nowhere else — the watcher only
    // credits a deposit whose sender is the client's registered wallet.
    if (m.kind === 'deposit' && tx?.account) {
      if (!run.provenDepositSenders) run.provenDepositSenders = {};
      const senders = run.provenDepositSenders[m.clientId] ?? [];
      if (!senders.includes(tx.account)) senders.push(tx.account);
      run.provenDepositSenders[m.clientId] = senders;
    }
    const step: ReceiptStep = m.kind === 'deposit' ? 'U1_DEPOSIT' : m.kind === 'return' ? 'U4_EXIT_XRP' : 'E8_WITHDRAW';
    run.receipts.push(makeReceipt(run, {
      step,
      chain: 'xrpl',
      txHash: m.txHash,
      clientId: m.clientId,
      note: m.kind === 'return' ? 'XRP arrived at the omnibus with the client tag (FAssets redemption paid back)' : undefined,
      expect: { drops: m.drops, tag: tx?.destinationTag ?? '', from: tx?.account ?? '', to: tx?.destination ?? '' },
    }));
  }
  return { txs: classified, credited: fresh };
}

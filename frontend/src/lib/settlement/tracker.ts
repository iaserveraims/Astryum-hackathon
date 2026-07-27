/**
 * tracker — the polling half of the settlement machine, framework-free.
 *
 * useSettlement (React) is a thin shell over this: every transition, ceiling and
 * retry decision lives here so vitest can drive it with fake timers and fake
 * chain reads (the suite runs in node, no jsdom). §3 — stalled NEVER stops the
 * poll: a late confirmation still promotes to settled.
 */

import {
  type CallsStatusLike,
  type SettlementRail,
  type SettlementState,
  clearPending,
  evaluate5792,
  explorerUrlFor,
  isPastCeiling,
  isReceiptSuccess,
  savePending,
  toFailed,
  toSettled,
  toStalled,
} from './settlement';

export interface TrackerDeps {
  /** wallet_getCallsStatus for a 5792 bundle id — throws when the wallet does not expose it (§1.2). */
  getCallsStatus(id: string): Promise<CallsStatusLike>;
  /** EVM receipt by tx hash — null while not yet mined / node unreachable. */
  getTxReceipt(hash: string): Promise<{ status: unknown } | null>;
  /** GET /flare-demo/mint-status — executed flag, or null when the read failed (red caída ≠ pendiente). */
  getMintStatus(xrplHash: string): Promise<boolean | null>;
  /** Plain XRPL Payment: validated-in-ledger flag, or null when the read failed. */
  getXrplTxValidated(xrplHash: string): Promise<boolean | null>;
  /** Council order: LegacyBridge.consumedTxId via the status endpoint, or null on a failed read. */
  getCouncilOrderExecuted(xrplHash: string): Promise<boolean | null>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
}

export const POLL_MS: Record<SettlementRail, number> = {
  evm: 4_000,
  'evm-5792': 4_000,
  'xrpl-mint': 10_000, // an FDC round is minutes — no point hammering
  'xrpl-tx': 5_000, // ledger validation lands in seconds
  'council-order': 10_000, // same FDC cadence as the mint
};

/** §1.2 — consecutive getCallsStatus failures before we say, honestly, that the
 *  wallet won't let us auto-confirm. Polling continues past it regardless. */
export const UNSUPPORTED_5792_PROBES = 3;

/**
 * Track ONE pending settlement until it resolves. Emits the initial state
 * synchronously, then every CHANGE (deduped). Returns a cancel function.
 * A handle that arrives already final (single/sequential EVM rails await the
 * real receipt inside sendIntentCalls) is emitted as-is and never polled.
 */
export function trackSettlement(
  initial: SettlementState,
  deps: TrackerDeps,
  opts: { onUpdate(s: SettlementState): void; startedAt?: number },
): () => void {
  let current = initial;
  let cancelled = false;
  let timer: unknown = null;
  let failedProbes = 0;
  const startedAt = opts.startedAt ?? deps.now();

  if (initial.status === 'settled' || initial.status === 'failed') {
    clearPending(initial.ref);
    opts.onUpdate(initial);
    return () => {};
  }

  savePending({ rail: initial.rail, ref: initial.ref, explorerUrl: initial.explorerUrl, startedAt });
  opts.onUpdate(initial);

  const emit = (next: SettlementState) => {
    if (cancelled) return;
    if (next.status === current.status && next.reason === current.reason && next.ref === current.ref) return;
    current = next;
    opts.onUpdate(next);
  };

  let final = false;
  const finish = (next: SettlementState) => {
    final = true;
    clearPending(initial.ref); // keyed by the ORIGINAL ref, even after a 5792 ref upgrade
    emit(next);
  };

  const schedule = () => {
    timer = deps.setTimer(() => void step(), POLL_MS[initial.rail]);
  };

  const step = async () => {
    if (cancelled) return;
    try {
      if (initial.rail === 'evm-5792') {
        let result: CallsStatusLike | null = null;
        try {
          result = await deps.getCallsStatus(initial.ref);
          failedProbes = 0;
        } catch {
          failedProbes += 1;
        }
        if (result) {
          const v = evaluate5792(result);
          if (v.done && v.failed) return finish(toFailed(current, v.reason ?? 'el batch falló on-chain'));
          if (v.done) {
            const receipts = result.receipts ?? [];
            const raw = receipts[receipts.length - 1]?.transactionHash;
            const tx = typeof raw === 'string' && raw.startsWith('0x') ? raw : undefined;
            return finish(toSettled(current, tx ? { ref: tx, explorerUrl: explorerUrlFor('evm', tx) } : undefined));
          }
        } else if (failedProbes >= UNSUPPORTED_5792_PROBES) {
          emit(toStalled(current, 'la wallet no permite confirmar el batch automáticamente — comprueba el estado con la referencia'));
        }
      } else if (initial.rail === 'evm') {
        const receipt = await deps.getTxReceipt(initial.ref).catch(() => null);
        if (receipt) {
          if (isReceiptSuccess(receipt.status)) return finish(toSettled(current));
          return finish(toFailed(current, 'la transacción revirtió on-chain'));
        }
      } else if (initial.rail === 'xrpl-tx') {
        const validated = await deps.getXrplTxValidated(initial.ref).catch(() => null);
        if (validated === true) return finish(toSettled(current));
      } else if (initial.rail === 'council-order') {
        const executed = await deps.getCouncilOrderExecuted(initial.ref).catch(() => null);
        if (executed === true) return finish(toSettled(current));
      } else {
        const executed = await deps.getMintStatus(initial.ref).catch(() => null);
        if (executed === true) return finish(toSettled(current));
      }
      if (current.status === 'pending' && isPastCeiling(initial.rail, startedAt, deps.now())) {
        emit(toStalled(current, 'está tardando más de lo normal — seguimos vigilando la cadena'));
      }
    } finally {
      if (!cancelled && !final) schedule();
    }
  };

  void step();

  return () => {
    cancelled = true;
    if (timer != null) deps.clearTimer(timer);
  };
}

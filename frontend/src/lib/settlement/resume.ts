/**
 * resume — rehydration of pending settlements after a reload/tab close.
 *
 * tracker.ts persists every pending op keyed per ref (savePending) precisely
 * so a signed operation SURVIVES the page: this is the missing consumer of
 * loadAllPending. On app mount, re-read the fresh pendings and resume their
 * polling with the ORIGINAL startedAt — the per-rail ceiling measures from
 * the signature, never from the remount (a 5-minute-old XRPL mint must show
 * "taking longer" honestly, not restart its clock).
 *
 * Framework-free on purpose (same posture as tracker.ts): the React hook is a
 * thin shell, so vitest drives this with a seeded localStorage and fake deps.
 * Resuming only READS (receipt / getCallsStatus / mint-status) — reanudar en
 * dos pestañas es idempotente y jamás inventa un verde.
 */

import { loadAllPending, startPending, type SettlementState } from './settlement';
import { trackSettlement, type TrackerDeps } from './tracker';

/**
 * Resume every fresh pending from storage (loadAllPending prunes expired and
 * malformed entries as it reads). Emits (ref, state) per update; the tracker
 * itself clears the pending record on settled/failed. Returns a cancel for
 * ALL resumed polls (unmount).
 */
export function resumeAllPending(
  deps: TrackerDeps,
  onUpdate: (ref: string, state: SettlementState) => void,
  nowMs: number = Date.now(),
): () => void {
  const cancels = loadAllPending(nowMs).map((p) =>
    trackSettlement(startPending(p.rail, p.ref, p.explorerUrl), deps, {
      onUpdate: (s) => onUpdate(p.ref, s),
      startedAt: p.startedAt,
    }),
  );
  return () => {
    for (const cancel of cancels) cancel();
  };
}

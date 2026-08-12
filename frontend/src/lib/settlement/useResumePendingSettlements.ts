'use client';

/**
 * useResumePendingSettlements — the shell-wide feed of in-flight operations.
 * On mount it re-reads the fresh pendings from localStorage and resumes their
 * polling (a signed op survives a reload exactly where the user's anxiety
 * peaks) — and it KEEPS listening: savePending fires PENDING_CHANGED_EVENT,
 * so an op signed in this very session surfaces in the sidebar the moment its
 * modal starts tracking it. Watching the same ref as a live modal is safe by
 * construction: resuming only READS (receipt / getCallsStatus / mint-status),
 * is idempotent, and can never invent a green (resume.ts posture).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PENDING_CHANGED_EVENT, loadAllPending, type SettlementState } from './settlement';
import { resumePending } from './resume';
import { useTrackerDeps } from './useSettlement';

export interface ResumedSettlement {
  ref: string;
  state: SettlementState;
}

export function useResumePendingSettlements(): {
  resumed: ResumedSettlement[];
  /** Hide one card (visual only — a still-pending op resumes again next reload). */
  dismiss: (ref: string) => void;
} {
  const deps = useTrackerDeps();
  const [states, setStates] = useState<Record<string, SettlementState>>({});
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // One cancel per ref — the dedupe that lets us re-scan storage on every
    // PENDING_CHANGED_EVENT without double-polling what we already watch.
    const cancels = new Map<string, () => void>();
    const trackFresh = () => {
      for (const p of loadAllPending()) {
        if (cancels.has(p.ref)) continue;
        cancels.set(
          p.ref,
          resumePending(p, deps, (ref, state) => {
            setStates((prev) => ({ ...prev, [ref]: state }));
          }),
        );
      }
    };
    trackFresh();
    window.addEventListener(PENDING_CHANGED_EVENT, trackFresh);
    return () => {
      window.removeEventListener(PENDING_CHANGED_EVENT, trackFresh);
      for (const cancel of cancels.values()) cancel();
    };
  }, [deps]);

  const [, forceRender] = useState(0);
  const dismiss = useCallback((ref: string) => {
    dismissedRef.current.add(ref);
    forceRender((n) => n + 1);
  }, []);

  const resumed = Object.entries(states)
    .filter(([ref]) => !dismissedRef.current.has(ref))
    .map(([ref, state]) => ({ ref, state }));

  return { resumed, dismiss };
}

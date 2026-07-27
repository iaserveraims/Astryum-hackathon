'use client';

/**
 * useResumePendingSettlements — the shell-wide half of R1's persistence: on
 * mount (once per page session) re-read the fresh pendings from localStorage
 * and resume their polling, so a signed operation survives a reload exactly
 * where the user's anxiety peaks. Ops signed AFTER mount belong to their
 * modal's useSettlement — this hook reads storage ONCE, so it never doubles
 * a live modal's tracking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettlementState } from './settlement';
import { resumeAllPending } from './resume';
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

  useEffect(
    () =>
      resumeAllPending(deps, (ref, state) => {
        setStates((prev) => ({ ...prev, [ref]: state }));
      }),
    [deps],
  );

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

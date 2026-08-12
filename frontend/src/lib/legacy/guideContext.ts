'use client';

/**
 * guideContext — the bridge between the Legacy panel and the global co-pilot.
 *
 * The embedded Guía chat (LegacyDiscovery) was UNMOUNTED from the Legacy panel
 * (founder 2026-08-04: its left column ate a third of the ceremony's width).
 * Its brain moved into ProductAssistant, which in Legacy product mode IS the
 * Guía. What the panel still owns is the CONTEXT: the abstract journey state
 * of the Legacy under inspection — public ledger flags and small counters
 * only. NO addresses, NO names, NO amounts ever cross this bus (the same
 * privacy contract the embedded chat kept).
 *
 * Module-level store + useSyncExternalStore, same idiom as ModalPortal's
 * open-count: the publisher (LegacyPanel) and the subscriber (ProductAssistant)
 * live in unrelated trees.
 */

import { useSyncExternalStore } from 'react';
import type { LegacyJourney } from '../../components/legacy/LegacyDiscovery';

let current: LegacyJourney | null = null;
const listeners = new Set<() => void>();

/** Publish the journey of the Legacy on screen (null when leaving the panel). */
export function setLegacyJourney(journey: LegacyJourney | null): void {
  current = journey;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The journey the co-pilot grounds its Legacy answers in (null = none open). */
export function useLegacyJourney(): LegacyJourney | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

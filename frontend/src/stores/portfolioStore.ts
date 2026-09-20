'use client';

import { create } from 'zustand';
import {
  loadAggregatedPortfolio,
  setPortfolioInvalidateHandler,
  EVM_ADDRESS_RE,
  type AggregatedPortfolio,
} from '@/lib/portfolioMerge';

/**
 * The ONE reactive holder of the aggregated portfolio, shared across every
 * dashboard surface (Summary, Portfolio, Strategies, Capital Map…).
 *
 * Why a store and not per-page state: React state dies on navigation, so each
 * page used to re-fetch and flash "Loading…". A Zustand store is a module
 * singleton — its data survives client-side navigation, so a page mounting
 * paints the last result INSTANTLY, and a background refresh re-renders every
 * mounted surface at once (reactive). Read it through useAggregatedPortfolio().
 */

// How long a load is considered fresh before a mount triggers a revalidation.
const FRESH_MS = 60_000;

function keyOf(addresses: string[]): string {
  return [...addresses]
    .map((a) => (EVM_ADDRESS_RE.test(a) ? a.toLowerCase() : a))
    .sort()
    .join(',');
}

// Dedup concurrent loads of the same wallet set (several surfaces mount at once).
// Belongs to THIS holder only: a run here writes the authority slot and nothing
// else. The network itself is shared one level down (loadAggregatedPortfolio).
const inflight = new Map<string, Promise<void>>();

interface PortfolioState {
  key: string | null;
  data: AggregatedPortfolio | null;
  loading: boolean; // true only while we have nothing to show for the current key
  refreshing: boolean; // background revalidation with stale data on screen
  error: string | null;
  fetchedAt: number;
  /** Ensure data for `addresses` is loaded. `force` bypasses the freshness gate. */
  load: (addresses: string[], opts?: { force?: boolean }) => Promise<void>;
  clear: () => void;
}

export const usePortfolioStore = create<PortfolioState>()((set, get) => ({
  key: null,
  data: null,
  loading: false,
  refreshing: false,
  error: null,
  fetchedAt: 0,

  load: async (addresses, opts = {}) => {
    if (addresses.length === 0) return;
    const key = keyOf(addresses);
    const st = get();
    const sameSet = st.key === key;
    const fresh = sameSet && st.data != null && Date.now() - st.fetchedAt < FRESH_MS;
    if (fresh && !opts.force) return;

    const existing = inflight.get(key);
    if (existing && !opts.force) return existing;

    // Cold = nothing to show for this wallet set yet → block-load and paint
    // progressively. Warm = we already have complete data → revalidate silently
    // and only swap in the FINAL result (progressive partials mid-refresh would
    // flicker the screen down to a single wallet).
    const cold = !(sameSet && st.data != null);
    set(
      cold
        ? { key, loading: true, refreshing: false, error: null, ...(sameSet ? {} : { data: null }) }
        : { refreshing: true, error: null },
    );

    const run = (async () => {
      try {
        const result = await loadAggregatedPortfolio(
          addresses,
          cold
            ? (partial: AggregatedPortfolio) => {
                // Progressive paint on cold load only, and only if the user
                // hasn't switched wallet sets meanwhile.
                if (get().key === key) set({ data: partial });
              }
            : undefined,
        );
        if (get().key === key) {
          set({ data: result, fetchedAt: Date.now(), loading: false, refreshing: false, error: null });
        }
      } catch (e) {
        if (get().key === key) {
          set({ loading: false, refreshing: false, error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, run);
    return run;
  },

  clear: () => set({ key: null, data: null, loading: false, refreshing: false, error: null, fetchedAt: 0 }),
}));

/* ------------------------------------------------------------------------ */
/* Per-set entries — aggregates for ARBITRARY wallet sets (fleet scopes).    */
/*                                                                          */
/* The slot above holds the ACTIVE AUTHORITY's aggregate and is refreshed   */
/* by the shell's 90s poller — pointing it at a different set would get     */
/* clobbered on the next tick (the bug the Summary's fleet-scope selector   */
/* would have shipped with). These entries live BESIDE the slot: keyed by   */
/* wallet set, same loader, their OWN inflight dedupe, never touched by the */
/* poller. Read through useAggregatedFor().                                 */
/* ------------------------------------------------------------------------ */

// Su PROPIO mapa, no el del hueco de la autoridad (fundador 19-sep: «entro en
// Home, tarda mucho y no carga; voy a Portfolio, vuelvo y aparece todo»). En
// vista general los dos holders piden la MISMA flota, así que la misma clave;
// con un mapa compartido, el que llegaba segundo devolvía la promesa del
// primero sin escribir nada en su propio estado. En Home llega primero el
// PortfolioSyncBadge (hijo: sus efectos corren antes que los del padre), así
// que la entrada de la flota se quedaba vacía para siempre — el efecto de
// useAggregatedFor no se re-dispara con la clave y needsLoad iguales. La red
// no se duplica por separarlos: loadAggregatedPortfolio ya comparte el vuelo.
const entryInflight = new Map<string, Promise<void>>();

export interface PortfolioEntry {
  data: AggregatedPortfolio | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
}

interface PortfolioEntriesState {
  entries: Record<string, PortfolioEntry>;
  loadFor: (addresses: string[], opts?: { force?: boolean }) => Promise<void>;
  dropEntries: () => void;
}

export const usePortfolioEntries = create<PortfolioEntriesState>()((set, get) => ({
  entries: {},

  loadFor: async (addresses, opts = {}) => {
    if (addresses.length === 0) return;
    const key = keyOf(addresses);
    const st = get().entries[key];
    const fresh = st?.data != null && Date.now() - st.fetchedAt < FRESH_MS;
    if (fresh && !opts.force) return;
    const existing = entryInflight.get(key);
    if (existing && !opts.force) return existing;

    const patch = (p: Partial<PortfolioEntry>) =>
      set((s) => {
        const base: PortfolioEntry = s.entries[key] ?? { data: null, loading: false, error: null, fetchedAt: 0 };
        return { entries: { ...s.entries, [key]: { ...base, ...p } } };
      });

    const cold = st?.data == null;
    patch(cold ? { loading: true, error: null } : { error: null });

    const run = (async () => {
      try {
        const result = await loadAggregatedPortfolio(
          addresses,
          cold ? (partial: AggregatedPortfolio) => patch({ data: partial }) : undefined,
        );
        patch({ data: result, fetchedAt: Date.now(), loading: false, error: null });
      } catch (e) {
        patch({ loading: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        entryInflight.delete(key);
      }
    })();

    entryInflight.set(key, run);
    return run;
  },

  dropEntries: () => set({ entries: {} }),
}));

/** The store key for a wallet set — exported so hooks subscribe per-set. */
export function portfolioKeyOf(addresses: string[]): string {
  return keyOf(addresses);
}

// After a position-changing action (open/close/withdraw), force a fresh scan of
// the current wallet set so the dashboard reflects the new state immediately.
// Scoped entries are dropped (not re-fetched) — the next mounted reader
// reloads its own set, so we never fan out N loads for sets nobody is viewing.
setPortfolioInvalidateHandler(() => {
  const { key, load } = usePortfolioStore.getState();
  if (key) void load(key.split(','), { force: true });
  usePortfolioEntries.getState().dropEntries();
});

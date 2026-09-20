/**
 * shipLog — how the Orbit card's "Bitácora de a bordo" folds the CHANGELOG
 * into a readable history (pure; the card only renders what this returns).
 *
 * Founder 2026-08-26: «aglomera todos los behaviour juntos entre cada
 * improvement defi» — DeFi milestones keep their full line; everything
 * generic between two milestones collapses into ONE row of counters.
 *
 * Founder 2026-09-15: «el log de updates… se abre, pero no funciona el
 * scroll». Since 0.9.176 not one release carried a DeFi item, so the rule
 * above folded THIRTY-EIGHT versions into a single row: nothing to scroll,
 * nothing to read. A clump now also closes when the DAY changes — the log
 * reads as a diary (one row per day of work, milestones in full) instead of
 * a single line that swallows a month. And the whole log is folded, not a
 * window of 40: with day rows the row count is bounded by days, not
 * releases, so the scroller finally has something to scroll.
 */

import { KIND_LABEL, type ChangeKind, type ChangelogEntry } from './changelog';

export type GenericKind = Exclude<ChangeKind, 'defi'>;

export interface Clump {
  counts: Partial<Record<GenericKind, number>>;
  /** First entry fed (the log is newest-first). */
  newest: ChangelogEntry;
  /** Last entry fed. */
  oldest: ChangelogEntry;
  /** How many releases the row summarises. */
  releases: number;
}

export type ShipLogBlock =
  | { kind: 'milestone'; entry: ChangelogEntry }
  | { kind: 'clump'; clump: Clump };

/** Order the counters print in — the most common first. */
export const GENERIC_ORDER: GenericKind[] = ['behavior', 'visual', 'performance', 'security'];

export const isMilestone = (entry: ChangelogEntry): boolean =>
  entry.items.some((i) => i.kind === 'defi');

/**
 * Fold newest-first entries into blocks. A milestone (any 'defi' item) is its
 * own block; its generic items open the clump that follows it. A clump closes
 * on the next milestone and when the date changes.
 */
export function buildShipLog(entries: readonly ChangelogEntry[]): ShipLogBlock[] {
  const blocks: ShipLogBlock[] = [];
  let clump: Clump | null = null;

  const flush = () => {
    if (clump) blocks.push({ kind: 'clump', clump });
    clump = null;
  };
  const feed = (entry: ChangelogEntry) => {
    const generic = entry.items.filter((i) => i.kind !== 'defi');
    if (generic.length === 0) return;
    if (clump && clump.oldest.date !== entry.date) flush();
    if (!clump) clump = { counts: {}, newest: entry, oldest: entry, releases: 0 };
    for (const it of generic) {
      const k = it.kind as GenericKind;
      clump.counts[k] = (clump.counts[k] ?? 0) + 1;
    }
    clump.oldest = entry;
    clump.releases += 1;
  };

  for (const entry of entries) {
    if (isMilestone(entry)) {
      flush();
      blocks.push({ kind: 'milestone', entry });
    }
    feed(entry);
  }
  flush();
  return blocks;
}

/**
 * "3 mejoras de comportamiento · refuerzos de seguridad" — the count only
 * when there is more than one: with a row per day, "1 mejoras" would be the
 * commonest line in the log, and it reads wrong.
 */
export function clumpLine(c: Clump, lang: 'es' | 'en'): string {
  return GENERIC_ORDER.filter((k) => c.counts[k])
    .map((k) => {
      const label = KIND_LABEL[k][lang];
      const lower = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
      const n = c.counts[k] ?? 0;
      return n > 1 ? `${n} ${lower}` : lower;
    })
    .join(' · ');
}

/** "v0.9.213 · 2026-09-14" or "v0.9.205–v0.9.213 · 2026-09-14" */
export function clumpSpan(c: Clump): string {
  const versions =
    c.newest.version === c.oldest.version
      ? `v${c.newest.version}`
      : `v${c.oldest.version}–v${c.newest.version}`;
  return `${versions} · ${c.newest.date}`;
}

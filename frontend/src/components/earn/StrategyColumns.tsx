'use client';

/**
 * StrategyColumns — the catalogue as VERTICAL stacks, grouped by what the
 * route does for you (founder 2026-08-24: «ponlas apiladas en vertical, ahora
 * están en horizontal … make it earn a la izquierda, en el medio get cash»).
 *
 * WHAT WAS WRONG WITH THE HAND. StrategyFan lays the eight routes across the
 * width, each card partly covering the next. It is a lovely object and it
 * costs the thing the screen exists for: at eight cards every title is cut
 * mid-word ("FXRP → Kinetic (carry", "Supply FXRP + borrow USD…"), so the one
 * gesture the page asks for — compare the routes, then pick one — has to
 * happen through cards you cannot read. A stack has no such ceiling: adding a
 * ninth route makes the column longer, never the words narrower.
 *
 * THE CARD IS NOT REDRAWN. It imports `GridCard` from StrategyFan, the same
 * face the v2 catalogue uses. Three surfaces, one card: two cards that merely
 * look alike and are maintained apart always drift, and here the card face is
 * product identity.
 *
 * ORDER INSIDE A COLUMN IS THE CALLER'S. `cards` arrives already sorted by the
 * catalogue's sort chips, and this component only partitions — it never
 * re-ranks. Which matters beyond tidiness: an ordering the user did not ask
 * for reads as a recommendation, and Astryum does not recommend (invariant #9).
 *
 * The fan is NOT deleted — StrategyFan stays exported and imported, so
 * restoring the hand is swapping this element back.
 */

import { GridCard, type FanCard } from './StrategyFan';
import { CATALOGUE_COLUMNS, columnOf } from '@/lib/earn/strategyTaxonomy';
import type { VaultKind } from './FlareDemoEarn';

export function StrategyColumns({
  cards,
  selected,
  onSelect,
  chip,
  t,
}: {
  cards: FanCard[];
  selected: VaultKind | null;
  onSelect: (kind: VaultKind) => void;
  /** The route's live protocol rate chip (LiveYieldChip — invariant #9). */
  chip: (kind: VaultKind) => React.ReactNode;
  t: (s: string) => string;
}) {
  // Partition, preserving the incoming order inside each bucket.
  const buckets = CATALOGUE_COLUMNS.map((col) => ({
    col,
    items: cards.filter((c) => columnOf(c.kind) === col.id),
  }));

  // A route whose outcome the taxonomy does not know would vanish silently —
  // the catalogue would just show fewer cards and nobody would notice. It gets
  // appended to the first column instead: visible and pickable, which is the
  // failure that can be seen and fixed.
  const placed = new Set(buckets.flatMap((b) => b.items.map((i) => i.kind)));
  const orphans = cards.filter((c) => !placed.has(c.kind));
  if (orphans.length > 0 && buckets.length > 0) buckets[0].items.push(...orphans);

  const shown = buckets.filter((b) => b.items.length > 0);

  return (
    // Columns are WIDTH-CAPPED and centred rather than sharing the full width:
    // two halves of a wide screen would stretch a 224px-tall card to ~600px
    // across, which is not the card in the design — it is a banner. The cap
    // keeps the proportions the card was drawn at.
    <div className="flex flex-wrap justify-center items-start gap-6 lg:gap-8">
      {shown.map(({ col, items }) => (
        <section key={col.id} className="w-full sm:w-[300px] shrink-0">
          <header className="mb-3">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{t(col.title)}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-ink/45">{t(col.sub)}</p>
            <span className="mt-2 inline-flex items-center rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5 font-mono text-[10px] text-ink/40">
              {items.length}
            </span>
          </header>

          <div className="flex flex-col gap-4">
            {items.map((c) => (
              <GridCard
                key={c.kind}
                card={c}
                selected={selected === c.kind}
                dimmed={selected != null && selected !== c.kind}
                onSelect={() => onSelect(c.kind)}
                chip={chip(c.kind)}
                t={t}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default StrategyColumns;

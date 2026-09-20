import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../changelog';
import { buildShipLog, clumpLine, clumpSpan } from '../shipLog';

const generic = (version: string, date: string, kinds: Array<'behavior' | 'visual' | 'performance' | 'security'> = ['behavior']): ChangelogEntry => ({
  version,
  date,
  items: kinds.map((kind) => ({ kind })),
});
const milestone = (version: string, date: string, extra: ChangelogEntry['items'] = []): ChangelogEntry => ({
  version,
  date,
  items: [{ kind: 'defi', es: `hito ${version}`, en: `milestone ${version}` }, ...extra],
});

describe('buildShipLog', () => {
  it('a month without a DeFi milestone does NOT fold into a single row: one row per day', () => {
    // The bug: 38 generic releases → 1 clump → nothing to scroll.
    const entries: ChangelogEntry[] = [];
    for (let i = 0; i < 38; i++) {
      const day = 14 - Math.floor(i / 8); // 8 releases a day, newest first
      entries.push(generic(`0.9.${213 - i}`, `2026-09-${String(day).padStart(2, '0')}`));
    }
    const blocks = buildShipLog(entries);
    expect(blocks.every((b) => b.kind === 'clump')).toBe(true);
    expect(blocks).toHaveLength(5); // 14, 13, 12, 11, 10 sep
    const first = blocks[0];
    if (first.kind !== 'clump') throw new Error('expected clump');
    expect(first.clump.releases).toBe(8);
    expect(first.clump.newest.version).toBe('0.9.213');
    expect(first.clump.oldest.version).toBe('0.9.206');
    expect(first.clump.newest.date).toBe('2026-09-14');
  });

  it('a milestone keeps its own block and closes the clump above it', () => {
    const blocks = buildShipLog([
      generic('0.9.5', '2026-09-14'),
      generic('0.9.4', '2026-09-14'),
      milestone('0.9.3', '2026-09-14'),
      generic('0.9.2', '2026-09-14'),
      generic('0.9.1', '2026-09-14'),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['clump', 'milestone', 'clump']);
    const [above, , below] = blocks;
    if (above.kind !== 'clump' || below.kind !== 'clump') throw new Error('expected clumps');
    expect(above.clump.releases).toBe(2);
    expect(below.clump.releases).toBe(2);
  });

  it("the milestone's own generic items open the clump that follows it (below, where it belongs)", () => {
    const blocks = buildShipLog([
      milestone('0.9.3', '2026-09-14', [{ kind: 'visual' }, { kind: 'behavior' }]),
      generic('0.9.2', '2026-09-14', ['behavior']),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['milestone', 'clump']);
    const below = blocks[1];
    if (below.kind !== 'clump') throw new Error('expected clump');
    expect(below.clump.counts).toEqual({ visual: 1, behavior: 2 });
    expect(below.clump.newest.version).toBe('0.9.3');
    expect(below.clump.oldest.version).toBe('0.9.2');
    expect(below.clump.releases).toBe(2);
  });

  it('a new day opens a new row, even with no milestone in between', () => {
    const blocks = buildShipLog([
      generic('0.9.3', '2026-09-15'),
      generic('0.9.2', '2026-09-14'),
      generic('0.9.1', '2026-09-14'),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.kind === 'clump' ? b.clump.newest.date : 'milestone'))).toEqual([
      '2026-09-15',
      '2026-09-14',
    ]);
  });

  it('a milestone with only DeFi items does not open an empty clump', () => {
    const blocks = buildShipLog([milestone('0.9.2', '2026-09-14'), milestone('0.9.1', '2026-09-13')]);
    expect(blocks.map((b) => b.kind)).toEqual(['milestone', 'milestone']);
  });

  it('an empty log folds into nothing', () => {
    expect(buildShipLog([])).toEqual([]);
  });
});

describe('clump labels', () => {
  it('prints the counters in fixed order, label lower-cased, the number only above one', () => {
    const [block] = buildShipLog([
      generic('0.9.2', '2026-09-14', ['security', 'visual']),
      generic('0.9.1', '2026-09-14', ['behavior', 'behavior']),
    ]);
    if (block.kind !== 'clump') throw new Error('expected clump');
    expect(clumpLine(block.clump, 'en')).toBe('2 behaviour improvements · visual polish · security hardening');
    expect(clumpLine(block.clump, 'es')).toBe('2 mejoras de comportamiento · mejoras estéticas · refuerzos de seguridad');
  });

  it('prints the version range and the single day the row covers', () => {
    const [range] = buildShipLog([generic('0.9.2', '2026-09-14'), generic('0.9.1', '2026-09-14')]);
    const [single] = buildShipLog([generic('0.9.1', '2026-09-14')]);
    if (range.kind !== 'clump' || single.kind !== 'clump') throw new Error('expected clumps');
    expect(clumpSpan(range.clump)).toBe('v0.9.1–v0.9.2 · 2026-09-14');
    expect(clumpSpan(single.clump)).toBe('v0.9.1 · 2026-09-14');
  });
});

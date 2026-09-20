/**
 * THE HOME DOES NOT SAY «nothing is working yet» OVER A
 * SWEEP IT COULD NOT READ, and `snapshot.unreadable` survives the client.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { mergeSnaps, normaliseSnap } from '../portfolioMerge';
import { homePositionsVerdict, unreadableLine, unreadableOf, unreadableWallets } from '../portfolioUnreadable';
import type { PortfolioSnapshot } from '@/services/v1Api';

const A = '0xeabcd745598916b0131ece397c8d6a332088462c';
const B = 'rDcohqb2qWkiVdqmKXqBY6kE7qsmaXHbB1';

function snap(wallet: string, positions: PortfolioSnapshot['positions'], unreadable?: PortfolioSnapshot['unreadable']): PortfolioSnapshot {
  const total = positions.reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  return {
    wallet,
    chainId: 14,
    totalUSD: total,
    collateralUSD: 0,
    debtUSD: 0,
    netWorthUSD: total,
    positions,
    breakdown: { byProtocol: {}, byAsset: {}, byKind: {} },
    takenAt: '2026-09-15T10:00:00.000Z',
    ...(unreadable ? { unreadable } : {}),
  };
}
const fxrpRow = { protocolId: 'kinetic', chainId: 14, kind: 'supply', asset: 'FXRP', amountUSD: 12 };
const KINETIC_DOWN = { protocolId: 'kinetic', reason: 'KINETIC_POSITION_UNREADABLE: getAssetsIn/getAllMarkets did not answer (429)' };
const KINETIC_PARTIAL = {
  protocolId: 'kinetic',
  reason: 'balanceOf on market 0x…aa (429)',
  partial: true,
  reads: [{ what: 'balanceOf on market 0x00000000000000000000000000000000000000aa', reason: '429', market: '0x00000000000000000000000000000000000000aa' }],
};

describe('(d) homePositionsVerdict — the «nothing is working yet» nudge only when every adapter answered', () => {
  it('no rows + an unread adapter → unreadable, NOT empty', () => {
    expect(homePositionsVerdict(snap(A, [], [KINETIC_DOWN]))).toBe('unreadable');
  });
  it('no rows + every adapter answered → empty (the honest nudge)', () => {
    expect(homePositionsVerdict(snap(A, []))).toBe('empty');
    expect(homePositionsVerdict(snap(A, [], []))).toBe('empty');
  });
  it('rows present → positions, whether or not something else was unread', () => {
    expect(homePositionsVerdict(snap(A, [fxrpRow]))).toBe('positions');
    expect(homePositionsVerdict(snap(A, [fxrpRow], [KINETIC_PARTIAL]))).toBe('positions');
  });
  it('no snapshot → loading; garbage in `unreadable` is not an unread adapter', () => {
    expect(homePositionsVerdict(null)).toBe('loading');
    expect(homePositionsVerdict(undefined)).toBe('loading');
    expect(homePositionsVerdict({ positions: [], unreadable: 'x' as never })).toBe('empty');
    expect(homePositionsVerdict({ positions: [], unreadable: [null as never, { reason: 'no id' } as never] })).toBe('empty');
  });
});

describe('mergeSnaps / normaliseSnap keep what could not be read, tagged with its wallet', () => {
  it('two wallets, one unread → the merged snapshot carries the entry with wallet stamped', () => {
    const merged = mergeSnaps([snap(A, [fxrpRow]), snap(B, [], [KINETIC_DOWN])])!;
    expect(merged.positions).toHaveLength(1);
    expect(merged.unreadable).toEqual([{ ...KINETIC_DOWN, wallet: B }]);
  });
  it('an entry already stamped keeps its own wallet; entries from several wallets all travel', () => {
    const merged = mergeSnaps([snap(A, [], [{ ...KINETIC_PARTIAL, wallet: A }]), snap(B, [], [KINETIC_DOWN])])!;
    expect(merged.unreadable?.map((u) => u.wallet)).toEqual([A, B]);
  });
  it('CONTROL — nothing unread anywhere → no `unreadable` key on the merge', () => {
    expect(mergeSnaps([snap(A, [fxrpRow]), snap(B, [])])).not.toHaveProperty('unreadable');
  });
  it('normaliseSnap keeps it on both paths (nothing filtered / something filtered)', () => {
    const same = normaliseSnap(snap(A, [fxrpRow], [KINETIC_DOWN]));
    expect(same.unreadable).toEqual([KINETIC_DOWN]);
    const otherChain = { ...fxrpRow, chainId: 56 }; // BNB dust: filtered out by the demo rails
    const filtered = normaliseSnap(snap(A, [fxrpRow, otherChain], [KINETIC_DOWN]));
    expect(filtered.positions).toHaveLength(1);
    expect(filtered.unreadable).toEqual([KINETIC_DOWN]);
  });
  it('the Home decides on the MERGED, normalised fleet snapshot: unread wallet + rows elsewhere → positions; unread only → unreadable', () => {
    expect(homePositionsVerdict(normaliseSnap(mergeSnaps([snap(A, [fxrpRow]), snap(B, [], [KINETIC_DOWN])])!))).toBe('positions');
    expect(homePositionsVerdict(normaliseSnap(mergeSnaps([snap(A, []), snap(B, [], [KINETIC_DOWN])])!))).toBe('unreadable');
  });
});

describe('the notice helpers', () => {
  it('unreadableWallets names the wallets, never "all", with the snapshot wallet as fallback', () => {
    expect(unreadableWallets([{ ...KINETIC_DOWN, wallet: B }, { ...KINETIC_PARTIAL, wallet: 'all' }], A)).toEqual([B, A]);
    expect(unreadableWallets([KINETIC_DOWN], null)).toEqual([]);
  });
  it('unreadableLine says the protocol first and names the reads of a partial entry', () => {
    expect(unreadableLine(KINETIC_DOWN)).toBe(`kinetic: ${KINETIC_DOWN.reason}`);
    expect(unreadableLine(KINETIC_PARTIAL)).toMatch(/^kinetic: one read did not answer \(balanceOf on market/);
  });
  it('unreadableOf never returns undefined', () => {
    expect(unreadableOf(null)).toEqual([]);
    expect(unreadableOf({})).toEqual([]);
  });
});

/* ── The Home's own normaliseSnap, compiled out of page.tsx and run ─────────── */

const PAGE = join(__dirname, '..', '..', 'app', 'app', 'page.tsx');
const pageSrc = readFileSync(PAGE, 'utf8');

function balanced(from: number): string {
  const start = pageSrc.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < pageSrc.length; i += 1) {
    if (pageSrc[i] === '{') depth += 1;
    else if (pageSrc[i] === '}') {
      depth -= 1;
      if (depth === 0) return pageSrc.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced');
}

describe('the Home\'s normaliseSnap (page.tsx) does not drop `unreadable`', () => {
  it('a raw snapshot with `unreadable` comes out with it', () => {
    const DECL = 'function normaliseSnap(raw: PortfolioSnapshot | null | undefined): PortfolioSnapshot | null {';
    const at = pageSrc.indexOf(DECL);
    expect(at, 'normaliseSnap must exist in page.tsx').toBeGreaterThan(-1);
    const body = balanced(at + DECL.length - 1);
    const js = ts.transpileModule(`function normaliseSnap(raw) ${body}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${js}; return normaliseSnap;`)() as (raw: unknown) => PortfolioSnapshot | null;
    const out = fn(snap(A, [], [KINETIC_DOWN]))!;
    expect(out.unreadable).toEqual([KINETIC_DOWN]);
    expect(homePositionsVerdict(out)).toBe('unreadable');
  });
});

describe('cable (supplement) · the Home decides NoPositionsCTA through the verdict', () => {
  it('noPositionsYet is the `empty` verdict, and the notice is mounted', () => {
    expect(pageSrc).toMatch(/const positionsVerdict = homePositionsVerdict\(snap\)/);
    expect(pageSrc).toMatch(/const noPositionsYet = positionsVerdict === 'empty'/);
    expect(pageSrc).toMatch(/<PortfolioUnreadableNotice snap=\{snap\} \/>/);
  });
});

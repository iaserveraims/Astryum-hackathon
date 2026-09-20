/**
 * THE BOARD PAINTS `results[].error` AND `results[].unreadable`.
 *
 * THE FAILURE (two reviewers). `/api/positions/:wallet` answers HTTP 200 with
 * one block per adapter; a fallen adapter ships `{ protocolId, error,
 * positions: [] }`. The board's `flattenPositions` only read `positions`, and
 * its «could not read» card only counted HTTP failures. One 429 on a Kinetic
 * probe → an empty Kinetic block with an `error` nobody painted → the carry
 * holder's supply, debt and «Repay» door were not on the board, and the board
 * said «No open DeFi positions yet».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { boardShowsEmpty } from '../earn/exitReadState';
import { chainIdOf, positionsBlocksOf, reduceFlareScan, unreadBlocksOf } from '../positionsReadState';

const BOARD = join(__dirname, '..', '..', 'components', 'positions', 'DefiPositionsBoard.tsx');
const src = readFileSync(BOARD, 'utf8');

/** The balanced `{…}` / `[…]` / `(…)` literal starting at or after `from`. */
function balancedSlice(from: number, open: '{' | '[' | '('): string {
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  const start = src.indexOf(open, from);
  expect(start, 'the literal must start somewhere').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open} in DefiPositionsBoard.tsx`);
}

/**
 * A top-level `const NAME … = <literal>;` or `function NAME(…) {…}` of the
 * shipping source, COMPILED with the project's own TypeScript (never
 * pattern-stripped: a new annotation must not silently skip a case) and
 * evaluated with its free variables injected. The assertions run on the code
 * that ships, not on a copy.
 */
function shipping<T>(decl: string, name: string, deps: Record<string, unknown> = {}): T {
  const at = src.indexOf(decl);
  expect(at, `${decl} must exist in the shipping source`).toBeGreaterThan(-1);
  let tsSource: string;
  if (decl.startsWith('function ')) {
    const paramsAt = src.indexOf('(', at);
    const params = balancedSlice(paramsAt, '(');
    // The body is the first balanced `{…}` AFTER the parameter list (the
    // declared return type in between carries no braces for these three).
    const body = balancedSlice(paramsAt + params.length, '{');
    tsSource = `function ${name}${params} ${body}`;
  } else {
    const eq = src.indexOf('=', at);
    const m = /[{[(]/.exec(src.slice(eq))!;
    const openAt = eq + m.index;
    const literal = balancedSlice(openAt, m[0] as '{' | '[' | '(');
    tsSource = `const ${name} = ${src.slice(eq + 1, openAt + literal.length)};`;
  }
  const js = ts.transpileModule(tsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  const depNames = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...depNames, `${js}; return ${name};`)(...depNames.map((k) => deps[k])) as T;
}

const DEFI_KINDS = shipping<Set<string>>('const DEFI_KINDS = new Set(', 'DEFI_KINDS');
const KIND_LABEL = shipping<Record<string, string>>('const KIND_LABEL: Record<string, string> = {', 'KIND_LABEL');
const claimLabelFor = shipping<(p: unknown) => string>('function claimLabelFor(', 'claimLabelFor');
const templatesFor = shipping<(protocolId: string, kindUpper: string, chainId?: number) => string[]>(
  'function templatesFor(',
  'templatesFor',
);
type Row = { protocolId: string; kind: string; kindUpper: string; owner: string; positionId: string };
const flattenPositions = shipping<(data: unknown, owner: string) => Row[]>('function flattenPositions(', 'flattenPositions', {
  DEFI_KINDS,
  KIND_LABEL,
  claimLabelFor,
  templatesFor,
  positionsBlocksOf,
  chainIdOf,
});

const A = '0xeabcd745598916b0131ece397c8d6a332088462c';
const B = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const KSFLR = '0x00000000000000000000000000000000000000aa';

const fulfilled = (value: unknown): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value });
const rejected = (status: number | null): PromiseSettledResult<unknown> => ({
  status: 'rejected',
  reason: status == null ? new TypeError('Failed to fetch') : Object.assign(new Error(`HTTP ${status}`), { status }),
});

/** The shape: Kinetic fell entirely — HTTP 200, `error`, no rows. */
const kineticFell = {
  results: [
    { protocolId: 'kinetic', error: 'KINETIC_POSITION_UNREADABLE: balanceOf on market 0x…aa did not answer (429)', positions: [] },
  ],
};
const kineticPartial = {
  results: [
    {
      protocolId: 'kinetic',
      positions: [
        { kind: 'SUPPLY', asset: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', amount: '9600014', raw: { symbol: 'FXRP', iso: true } },
        { kind: 'BORROW', asset: '0x0000000000000000000000000000000000000009', amount: '5000000', raw: { symbol: 'USDT0', iso: true } },
      ],
      unreadable: [{ what: `balanceOf on market ${KSFLR}`, reason: '429 Too Many Requests', market: KSFLR }],
    },
  ],
};
const allGood = {
  results: [
    { protocolId: 'kinetic', positions: [{ kind: 'SUPPLY', asset: '0xAd55', amount: '1', raw: {} }] },
    { protocolId: 'firelight', positions: [] },
  ],
};

describe('ola 0 · a fallen adapter inside an HTTP 200 is painted, not blanked', () => {
  it('(b) `{ error, positions: [] }` → zero rows from the shipping flattenPositions, ONE unread block, and the board is NOT empty', () => {
    const scan = reduceFlareScan([fulfilled(kineticFell)], [A], flattenPositions);
    expect(scan.rows).toEqual([]);
    expect(scan.failed).toEqual([]);
    expect(scan.unread).toEqual([
      expect.objectContaining({ addr: A, protocolId: 'kinetic', whole: true, reason: expect.stringMatching(/KINETIC_POSITION_UNREADABLE/) }),
    ]);
    // The count the board composes: HTTP failures + unread blocks.
    const empty = boardShowsEmpty({
      loading: false,
      error: null,
      positionsCount: scan.rows.length,
      unreadableCount: scan.failed.length + scan.unread.length,
      vaultLegUnread: false,
    });
    expect(empty).toBe(false);
  });

  it('a PARTIAL block → the carry rows are served (with their kinds) AND the market is named', () => {
    const scan = reduceFlareScan([fulfilled(kineticPartial)], [A], flattenPositions);
    expect(scan.rows.map((r) => `${r.protocolId}:${r.kindUpper}`).sort()).toEqual(['kinetic:BORROW', 'kinetic:SUPPLY']);
    expect(scan.rows.every((r) => r.owner === A)).toBe(true);
    expect(scan.unread).toEqual([
      expect.objectContaining({
        addr: A,
        protocolId: 'kinetic',
        whole: false,
        reads: [expect.objectContaining({ what: `balanceOf on market ${KSFLR}`, market: KSFLR })],
      }),
    ]);
  });

  it('three wallets at once: rows, an HTTP 502 and an unread block each land in their own bucket', () => {
    const scan = reduceFlareScan([fulfilled(allGood), rejected(502), fulfilled(kineticFell)], [A, B, A], flattenPositions);
    expect(scan.rows).toHaveLength(1);
    expect(scan.failed).toEqual([{ addr: B, status: 502 }]);
    expect(scan.unread.map((u) => u.protocolId)).toEqual(['kinetic']);
  });

  it('CONTROL — every block answered → no unread, and with rows the board is not empty; with none, it honestly is', () => {
    expect(unreadBlocksOf(allGood, A)).toEqual([]);
    const scan = reduceFlareScan([fulfilled({ results: [{ protocolId: 'kinetic', positions: [] }] })], [A], flattenPositions);
    expect(boardShowsEmpty({ loading: false, error: null, positionsCount: 0, unreadableCount: scan.failed.length + scan.unread.length, vaultLegUnread: false })).toBe(true);
  });

  it('garbage tolerance: no results / non-object blocks / empty unreadable → nothing invented', () => {
    expect(unreadBlocksOf(null, A)).toEqual([]);
    expect(unreadBlocksOf({ results: 'nope' }, A)).toEqual([]);
    expect(unreadBlocksOf({ results: [null, 3, { positions: [] }, { protocolId: 'x', unreadable: [] }, { protocolId: 'y', unreadable: 'bad' }] }, A)).toEqual([]);
  });
});

describe('cable (supplement) · the board reduces the scan through reduceFlareScan and counts the unread blocks', () => {
  it('calls reduceFlareScan with the shipping flattenPositions', () => {
    expect(src).toMatch(/reduceFlareScan\(results,\s*addrs,\s*flattenPositions\)/);
  });
  it("the empty state's unreadableCount includes flareProtocolUnread", () => {
    const call = src.slice(src.indexOf('boardShowsEmpty({'));
    const block = call.slice(0, call.indexOf('})'));
    expect(block).toMatch(/unreadableCount:[^\n]*flareProtocolUnread\.length/);
  });
});

/**
 * «This payment is NOT on the ledger» is only concluded from an EXHAUSTIVE read
 * (productizer cycle, it. 8): a 2-page scan (400 rows, newest first) missed a
 * validated payout on a busy omnibus and its reservation was released → the
 * client was paid again. scanOmnibusWindow paginates until the marker is gone,
 * inside [min, max], and throws instead of answering partially.
 */
const mockRpc = jest.fn();
jest.mock('../../flare/DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockRpc(...a),
}));

import { scanOmnibusWindow, scanOmnibusWindowUntil } from '../OmnibusWatcher';

describe('scanOmnibusWindowUntil — forward, bounded, stops at the first answer (it. 10)', () => {
  const OMNI = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
  const pages = (total: number, targetAt: number, target: string) => {
    const rows = Array.from({ length: total }, (_, i) => ({
      hash: i === targetAt ? target : i.toString(16).toUpperCase().padStart(64, '0'),
      ledger_index: 1050,
      validated: true,
      meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '1' },
      tx_json: { TransactionType: 'Payment', Account: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm', Destination: OMNI, Amount: '1', date: 0 },
    }));
    return async (_m: string, params: Record<string, unknown>) => {
      const start = params.marker === undefined ? 0 : Number(params.marker);
      const next = start + 200 < rows.length ? start + 200 : undefined;
      return { ledger_index_min: params.ledger_index_min, ledger_index_max: params.ledger_index_max, transactions: rows.slice(start, start + 200), ...(next !== undefined ? { marker: next } : {}) };
    };
  };
  const target = 'F'.repeat(64);

  it('asks forward inside the window and stops at the first match without reading further pages', async () => {
    mockRpc.mockImplementation(pages(1000, 250, target));
    const out = await scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1000, ledgerIndexMax: 1100, stop: (t) => t.hash === target });
    expect(out.match?.hash).toBe(target);
    expect(out.rows).toHaveLength(251);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ forward: true, ledger_index_min: 1000, ledger_index_max: 1100 });
  });

  it('no match → the whole window, no `match`; page cap without an answer → throws, never a partial «absent»', async () => {
    mockRpc.mockImplementation(pages(650, -1, target));
    const out = await scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1000, ledgerIndexMax: 1100, stop: () => false });
    expect(out.match).toBeUndefined();
    expect(out.rows).toHaveLength(650);
    await expect(scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1000, ledgerIndexMax: 1100, maxPages: 2 })).rejects.toThrow(/NOT_EXHAUSTED/);
  });

  it('a node that searched a narrower range, or an invalid window → throws', async () => {
    mockRpc.mockResolvedValue({ ledger_index_min: 1050, ledger_index_max: 1100, transactions: [] });
    await expect(scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/HISTORY_MISSING/);
    await expect(scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1200, ledgerIndexMax: 1100 })).rejects.toThrow(/INVALID/);
  });

  it('it. 12 (2.6d): a node that does not STATE its served range (missing / null / NaN) → unreadable, never «absent»', async () => {
    for (const served of [{}, { ledger_index_min: null, ledger_index_max: null }, { ledger_index_min: 'abc', ledger_index_max: 1100 }, { ledger_index_min: 1000 }, { ledger_index_min: 1000, ledger_index_max: Number.NaN }]) {
      mockRpc.mockReset();
      mockRpc.mockResolvedValue({ ...served, transactions: [] });
      await expect(scanOmnibusWindowUntil(OMNI, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/RANGE_UNREADABLE/);
    }
  });
});

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const TARGET = 'F'.repeat(64);

function entry(i: number, over: Record<string, unknown> = {}) {
  return {
    hash: over.hash ?? i.toString(16).toUpperCase().padStart(64, '0'),
    ledger_index: 1050,
    validated: true,
    meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '1' },
    tx_json: { TransactionType: 'Payment', Account: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm', Destination: OMNIBUS, DestinationTag: 7, Amount: '1', date: 0, ...(over.tx as object) },
  };
}

/** 650 rows, 200 per page: the payout is row 450 (page 3) — beyond any 2-page scan. */
function pagedHistory(targetAt = 450, total = 650) {
  const rows = Array.from({ length: total }, (_, i) =>
    i === targetAt
      ? { ...entry(i, { hash: TARGET }), meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '2000000' }, tx_json: { TransactionType: 'Payment', Account: OMNIBUS, Destination: WALLET, Amount: '2000000', LastLedgerSequence: 1100, date: 0 } }
      : entry(i),
  );
  return (params: Record<string, unknown>) => {
    const start = params.marker === undefined ? 0 : Number(params.marker);
    const page = rows.slice(start, start + 200);
    const next = start + 200 < rows.length ? start + 200 : undefined;
    return { ledger_index_min: params.ledger_index_min, ledger_index_max: params.ledger_index_max, transactions: page, ...(next !== undefined ? { marker: next } : {}) };
  };
}

beforeEach(() => mockRpc.mockReset());

describe('scanOmnibusWindow — exhaustive, bounded, never partial', () => {
  it('pages through >400 rows until the marker is empty and finds the payout on page 3', async () => {
    const serve = pagedHistory();
    mockRpc.mockImplementation(async (_m: string, params: Record<string, unknown>) => serve(params));
    const rows = await scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 });
    expect(mockRpc).toHaveBeenCalledTimes(4);
    expect(rows).toHaveLength(650);
    const payout = rows.find((r) => r.hash === TARGET)!;
    expect(payout).toMatchObject({ direction: 'out', destination: WALLET, drops: '2000000', lastLedgerSequence: 1100 });
    // bounded by the window on every page, and each page continues the previous marker
    for (const [method, params, , opts] of mockRpc.mock.calls) {
      expect(method).toBe('account_tx');
      expect(params).toMatchObject({ account: OMNIBUS, ledger_index_min: 1000, ledger_index_max: 1100, limit: 200 });
      expect(opts).toEqual({ requireFresh: true });
    }
    expect(mockRpc.mock.calls.map((c) => c[1].marker)).toEqual([undefined, 200, 400, 600]);
  });

  it('a page that fails mid-way throws — never the rows read so far', async () => {
    const serve = pagedHistory();
    mockRpc.mockImplementationOnce(async (_m: string, p: Record<string, unknown>) => serve(p)).mockRejectedValueOnce(new Error('rippled frozen'));
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow('rippled frozen');
  });

  it('hitting the page cap with a marker still set throws OMNIBUS_WINDOW_NOT_EXHAUSTED', async () => {
    const serve = pagedHistory(450, 650);
    mockRpc.mockImplementation(async (_m: string, params: Record<string, unknown>) => serve(params));
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100, maxPages: 3 })).rejects.toThrow(/OMNIBUS_WINDOW_NOT_EXHAUSTED/);
  });

  it('a node that served a narrower range (missing history) throws', async () => {
    mockRpc.mockResolvedValueOnce({ ledger_index_min: 1040, ledger_index_max: 1100, transactions: [] });
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/HISTORY_MISSING/);
    mockRpc.mockResolvedValueOnce({ ledger_index_min: 1000, ledger_index_max: 1090, transactions: [] });
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/HISTORY_MISSING/);
  });

  it('it. 12 (2.6d): an unstated served range reads as unreadable (the old NaN checks let a partial history through)', async () => {
    mockRpc.mockResolvedValueOnce({ transactions: [] });
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/RANGE_UNREADABLE/);
    mockRpc.mockResolvedValueOnce({ ledger_index_min: 1000, ledger_index_max: '1100x', transactions: [] });
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).rejects.toThrow(/RANGE_UNREADABLE/);
    // decimal strings are a stated range
    mockRpc.mockResolvedValueOnce({ ledger_index_min: '1000', ledger_index_max: '1100', transactions: [] });
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 })).resolves.toEqual([]);
  });

  it('an invalid window is refused before any read', async () => {
    await expect(scanOmnibusWindow(OMNIBUS, { ledgerIndexMin: 1200, ledgerIndexMax: 1100 })).rejects.toThrow(/OMNIBUS_WINDOW_INVALID/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

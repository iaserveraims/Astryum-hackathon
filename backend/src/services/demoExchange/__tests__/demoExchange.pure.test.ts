/**
 * Pure logic of the Demo Exchange module: tag space, idempotent ledger math,
 * omnibus classification and the proof renderer. No RPC, no DB.
 */

import {
  applyMovements,
  nextClientTag,
  runTagRange,
  type DemoRun,
  type DemoClient,
} from '../DemoExchangeStore';
import { classifyOmnibusTxs, movementsFrom, parseOmnibusEntry } from '../OmnibusWatcher';
import { renderProofMarkdown } from '../proofMarkdown';

const OMNIBUS = 'rExchangeOmnibus111111111111111111';
const CLIENT_R = 'rClientWallet1111111111111111111111';

function run(overrides: Partial<DemoRun> = {}): DemoRun {
  return {
    runId: 'run_1',
    seq: 3,
    label: 'take 3',
    councilAddress: 'rCouncil1111111111111111111111111111',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: '2026-08-26T10:00:00.000Z',
    status: 'open',
    clients: [],
    receipts: [],
    appliedTxHashes: [],
    ...overrides,
  };
}

function client(overrides: Partial<DemoClient> = {}): DemoClient {
  return {
    id: 'c1',
    runId: 'run_1',
    label: 'Ana',
    tag: 301,
    passkeyAccount: '0x4011015268644de37061D6C9b734b1738A8933C8',
    xrplAddress: CLIENT_R,
    kyc: 'registry',
    xrpOnExchangeDrops: '0',
    createdAt: '2026-08-26T10:01:00.000Z',
    ...overrides,
  };
}

describe('tag space', () => {
  test('run.seq × 100 + ordinal, never colliding across runs on one omnibus', () => {
    expect(nextClientTag({ seq: 3, clients: [] })).toBe(301);
    expect(nextClientTag({ seq: 3, clients: [client()] })).toBe(302);
    expect(nextClientTag({ seq: 12, clients: [] })).toBe(1201);
  });
  test('refuses the 100th client', () => {
    const many = Array.from({ length: 99 }, (_, i) => client({ id: `c${i}`, tag: 300 + i + 1 }));
    expect(() => nextClientTag({ seq: 3, clients: many })).toThrow(/DEMO_RUN_FULL/);
  });
});

describe('tag space — rango RESERVADO (CONECTA, omnibus vivo)', () => {
  test('tagBase declarado: secuencial desde la base, capacidad = el ancho del rango', () => {
    expect(nextClientTag({ seq: 3, clients: [], tagBase: 5000, tagCount: 3 })).toBe(5000);
    expect(nextClientTag({ seq: 3, clients: [client()], tagBase: 5000, tagCount: 3 })).toBe(5001);
    const three = Array.from({ length: 3 }, (_, i) => client({ id: `c${i}` }));
    expect(() => nextClientTag({ seq: 3, clients: three, tagBase: 5000, tagCount: 3 })).toThrow(/DEMO_RUN_FULL/);
  });
  test('un exchange real no está capado a 99: la capacidad la fija el rango', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => client({ id: `c${i}` }));
    expect(nextClientTag({ seq: 3, clients: hundred, tagBase: 10_000, tagCount: 5000 })).toBe(10_100);
  });
  test('runTagRange: el rango declarado, o el clásico derivado de seq — SIEMPRE hay frontera', () => {
    expect(runTagRange({ seq: 3 })).toEqual({ base: 301, count: 99 });
    expect(runTagRange({ seq: 3, tagBase: 5000 })).toEqual({ base: 5000, count: 100 });
    expect(runTagRange({ seq: 3, tagBase: 5000, tagCount: 250 })).toEqual({ base: 5000, count: 250 });
  });
});

describe('ledger math', () => {
  test('credits deposits, debits put-to-work, is idempotent by tx hash, never negative', () => {
    const r = run({ clients: [client()] });
    const fresh1 = applyMovements(r, [
      { kind: 'deposit', clientId: 'c1', drops: '10000000', txHash: 'AAA' },
      { kind: 'put-to-work', clientId: 'c1', drops: '4000000', txHash: 'BBB' },
    ]);
    expect(fresh1).toHaveLength(2);
    expect(r.clients[0].xrpOnExchangeDrops).toBe('6000000');
    const fresh2 = applyMovements(r, [
      { kind: 'deposit', clientId: 'c1', drops: '10000000', txHash: 'aaa' }, // same hash, different case
      { kind: 'withdraw', clientId: 'c1', drops: '9000000', txHash: 'CCC' }, // more than held → clamps at 0
    ]);
    expect(fresh2).toHaveLength(1);
    expect(r.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(r.appliedTxHashes).toEqual(['in:AAA', 'out:BBB', 'out:CCC']);
  });
  test('A payment first read as return and later as deposit is credited ONCE (review bug)', () => {
    const r = run({ clients: [client({ xrplAddress: undefined })] });
    applyMovements(r, [{ kind: 'return', clientId: 'c1', drops: '3000000', txHash: 'DDD' }]);
    // the client registers their wallet → the same tx now classifies as a deposit
    const again = applyMovements(r, [{ kind: 'deposit', clientId: 'c1', drops: '3000000', txHash: 'ddd' }]);
    expect(again).toEqual([]);
    expect(r.clients[0].xrpOnExchangeDrops).toBe('3000000');
  });
  test('ignores movements for unknown clients', () => {
    const r = run({ clients: [client()] });
    expect(applyMovements(r, [{ kind: 'deposit', clientId: 'ghost', drops: '1', txHash: 'X' }])).toEqual([]);
  });
});

describe('omnibus watcher — parse + classify', () => {
  const entryV2 = (over: Record<string, unknown>, meta: Record<string, unknown> = { TransactionResult: 'tesSUCCESS', delivered_amount: '5000000' }) => ({
    hash: 'H1',
    validated: true,
    meta,
    tx_json: { TransactionType: 'Payment', Account: CLIENT_R, Destination: OMNIBUS, DestinationTag: 301, Amount: '5000000', date: 800000000, ...over },
  });

  test('parses api_version 2 entries and prefers delivered_amount', () => {
    const t = parseOmnibusEntry(entryV2({}), OMNIBUS)!;
    expect(t.direction).toBe('in');
    expect(t.destinationTag).toBe(301);
    expect(t.drops).toBe('5000000');
    expect(t.validated).toBe(true);
  });
  test('parses api_version 1 entries (tx + hash inside tx)', () => {
    const t = parseOmnibusEntry({ validated: true, meta: { TransactionResult: 'tesSUCCESS' }, tx: { hash: 'H2', TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '1000', date: 1 } }, OMNIBUS)!;
    expect(t.hash).toBe('H2');
    expect(t.direction).toBe('out');
  });
  test('drops issued-currency payments and non-Payments', () => {
    expect(parseOmnibusEntry(entryV2({ Amount: { currency: 'USD', value: '1', issuer: 'r1' } }, { TransactionResult: 'tesSUCCESS' }), OMNIBUS)).toBeNull();
    expect(parseOmnibusEntry(entryV2({ TransactionType: 'TrustSet' }), OMNIBUS)).toBeNull();
  });
  test('classifies deposit (from the client wallet), return (tag from elsewhere), withdraw (out to client), other', () => {
    const c = client();
    const txs = [
      parseOmnibusEntry(entryV2({}), OMNIBUS)!,
      parseOmnibusEntry(entryV2({ Account: 'rFAssetsAgent111111111111111111111', hash: 'H3' }), OMNIBUS)!,
      parseOmnibusEntry({ hash: 'H4', validated: true, meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '700' }, tx_json: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '700', date: 1 } }, OMNIBUS)!,
      parseOmnibusEntry(entryV2({ DestinationTag: 999 }), OMNIBUS)!,
      parseOmnibusEntry(entryV2({}, { TransactionResult: 'tecUNFUNDED_PAYMENT' }), OMNIBUS)!,
    ];
    const kinds = classifyOmnibusTxs(txs, [c]).map((t) => t.kind);
    expect(kinds).toEqual(['deposit', 'return', 'withdraw', 'other', 'other']);
    const moves = movementsFrom(classifyOmnibusTxs(txs, [c]));
    expect(moves.map((m) => m.kind)).toEqual(['deposit', 'return', 'withdraw']);
  });
});

describe('omnibus watcher — las fronteras de CONECTA (frontier de ledger + rango de tags)', () => {
  const c = client();
  const mk = (over: Record<string, unknown> = {}, ledgerIndex?: number) =>
    parseOmnibusEntry(
      {
        hash: String(over.hash ?? 'HX'),
        validated: true,
        ledger_index: ledgerIndex,
        meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '5000000' },
        tx_json: { TransactionType: 'Payment', Account: CLIENT_R, Destination: OMNIBUS, DestinationTag: 301, Amount: '5000000', date: 1, ...over },
      },
      OMNIBUS,
    )!;

  test('parsea ledger_index (v2 a nivel de entry y v1 dentro de tx)', () => {
    expect(mk({}, 97_000_000).ledgerIndex).toBe(97_000_000);
    const v1 = parseOmnibusEntry(
      { validated: true, meta: { TransactionResult: 'tesSUCCESS' }, tx: { hash: 'H9', TransactionType: 'Payment', Account: CLIENT_R, Destination: OMNIBUS, Amount: '1', date: 1, ledger_index: 123 } },
      OMNIBUS,
    )!;
    expect(v1.ledgerIndex).toBe(123);
  });

  test('la frontera: un pago validado ANTES del alta jamás es del run — ni con el tag correcto', () => {
    const old = mk({ hash: 'OLD' }, 100);
    const fresh = mk({ hash: 'NEW' }, 200);
    expect(classifyOmnibusTxs([old, fresh], [c], { sinceLedgerIndex: 150 }).map((t) => t.kind)).toEqual(['other', 'deposit']);
  });

  test('con frontera puesta, un tx SIN fecha de ledger no acredita — «no pude datar» no es dinero del run', () => {
    const undated = mk({ hash: 'UND' });
    expect(classifyOmnibusTxs([undated], [c], { sinceLedgerIndex: 150 })[0].kind).toBe('other');
    // Sin frontera (omnibus nuevo de demo), el comportamiento clásico no cambia.
    expect(classifyOmnibusTxs([undated], [c])[0].kind).toBe('deposit');
  });

  test('el rango: un tag fuera del reservado es other AUNQUE un cliente lo lleve', () => {
    const t = mk({ hash: 'A' }, 200);
    expect(classifyOmnibusTxs([t], [c], { tagRange: { base: 5000, count: 100 }, sinceLedgerIndex: 100 })[0].kind).toBe('other');
    expect(classifyOmnibusTxs([t], [c], { tagRange: { base: 301, count: 99 }, sinceLedgerIndex: 100 })[0].kind).toBe('deposit');
  });

  test('la frontera también aplica a los salientes: un payout viejo no debita', () => {
    const oldOut = parseOmnibusEntry(
      { hash: 'OUT', validated: true, ledger_index: 100, meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '700' }, tx_json: { TransactionType: 'Payment', Account: OMNIBUS, Destination: CLIENT_R, Amount: '700', date: 1 } },
      OMNIBUS,
    )!;
    expect(classifyOmnibusTxs([oldOut], [c], { sinceLedgerIndex: 150 })[0].kind).toBe('other');
  });
});

describe('proof markdown', () => {
  test('renders actors, clients and every receipt with its checks', () => {
    const r = run({
      poteAddress: '0x21d4ccf29EEB61E573c2037F2B29B727168c3da9',
      clients: [client({ xrpOnExchangeDrops: '2500000' })],
      receipts: [
        { id: 'r1', runId: 'run_1', clientId: 'c1', step: 'U1_DEPOSIT', chain: 'xrpl', txHash: 'ABC', explorerUrl: 'https://livenet.xrpl.org/transactions/ABC', at: '2026-08-26T10:05:00.000Z', expect: { drops: '5000000' }, checks: [{ label: 'validated', ok: true, observed: 'tesSUCCESS' }], verifiedAt: '2026-08-26T10:06:00.000Z' },
        { id: 'r2', runId: 'run_1', step: 'E7_DENIED', chain: 'none', at: '2026-08-26T10:07:00.000Z', expect: { code: 'TARGET_NOT_ALLOWED' }, checks: [{ label: 'refused', ok: false, observed: 'x', reason: 'why' }] },
      ],
    });
    const md = renderProofMarkdown(r, { generatedAt: '2026-08-26T11:00:00.000Z' });
    expect(md).toContain('# Demo Exchange — proof of run take 3');
    expect(md).toContain('| Ana | 301 |');
    expect(md).toContain('2.500000');
    expect(md).toContain('U1 · The client deposits XRP');
    expect(md).toContain('✅ validated — observed: tesSUCCESS');
    expect(md).toContain('❌ refused — observed: x — why');
    expect(md).toContain('2 receipts · 1 fully verified on-chain · 1 with a failed check');
    expect(md).toContain('SIMULATED exchange system');
  });
});

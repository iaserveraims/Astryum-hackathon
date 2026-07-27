const mockWalletFindFirst = jest.fn();
const mockProtocolFindFirst = jest.fn();
const mockChainFindUnique = jest.fn();
const mockPositionFindFirst = jest.fn();
const mockPositionCreate = jest.fn();
const mockPositionUpdate = jest.fn();
const mockSnapshotCreate = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: { findFirst: (...a: unknown[]) => mockWalletFindFirst(...a) },
    protocol: { findFirst: (...a: unknown[]) => mockProtocolFindFirst(...a) },
    chain: { findUnique: (...a: unknown[]) => mockChainFindUnique(...a) },
    position: {
      findFirst: (...a: unknown[]) => mockPositionFindFirst(...a),
      create: (...a: unknown[]) => mockPositionCreate(...a),
      update: (...a: unknown[]) => mockPositionUpdate(...a),
    },
    positionSnapshot: { create: (...a: unknown[]) => mockSnapshotCreate(...a) },
  },
}));

import { positionPersistenceService, AGGREGATE_ASSET } from '../PositionPersistenceService';
import type { ScannedLendingPosition } from '../PositionScanService';

const SCAN: ScannedLendingPosition = {
  protocolSlug: 'kinetic',
  protocolName: 'Kinetic',
  chainId: 14,
  wallet: '0xEABCD7450000000000000000000000000000AbCd',
  totalCollateralUSD: 250,
  totalDebtUSD: 60,
  availableBorrowUSD: 100,
  liquidationThreshold: 0.75,
  ltv: 0.24,
  healthFactor: 2.4,
  readAt: new Date('2026-07-09T00:00:00Z').toISOString(),
} as unknown as ScannedLendingPosition;

beforeEach(() => {
  for (const m of [
    mockWalletFindFirst, mockProtocolFindFirst, mockChainFindUnique,
    mockPositionFindFirst, mockPositionCreate, mockPositionUpdate, mockSnapshotCreate,
  ]) m.mockReset();
  mockWalletFindFirst.mockResolvedValue({ id: 'w1' });
  mockProtocolFindFirst.mockResolvedValue({ id: 'p1' });
  mockChainFindUnique.mockResolvedValue({ chainId: 14 });
  mockPositionFindFirst.mockResolvedValue(null);
  mockPositionCreate.mockImplementation(async ({ data }: any) => ({ id: `pos-${data.kind}`, ...data }));
  mockPositionUpdate.mockImplementation(async ({ where }: any) => ({ id: where.id }));
  mockSnapshotCreate.mockResolvedValue({ id: 'snap1' });
});

describe('PositionPersistenceService — pipeline 2.6 (Opción A, defensive writes)', () => {
  test('no userId → skips everything, writes nothing', async () => {
    const out = await positionPersistenceService.persistScan(undefined, [SCAN]);
    expect(out.persisted).toBe(0);
    expect(out.skipped).toEqual([{ protocolSlug: '*', reason: 'no_user' }]);
    expect(mockPositionCreate).not.toHaveBeenCalled();
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  test('wallet not registered for this user → row skipped (watch-only stays read-only)', async () => {
    mockWalletFindFirst.mockResolvedValue(null);
    const out = await positionPersistenceService.persistScan('u1', [SCAN]);
    expect(out.persisted).toBe(0);
    expect(out.skipped).toEqual([{ protocolSlug: 'kinetic', reason: 'wallet_not_registered' }]);
  });

  test('protocol not seeded → skipped with reason (aave-v3 has no Protocol row today)', async () => {
    mockProtocolFindFirst.mockResolvedValue(null);
    const out = await positionPersistenceService.persistScan('u1', [{ ...SCAN, protocolSlug: 'aave-v3' }]);
    expect(out.skipped).toEqual([{ protocolSlug: 'aave-v3', reason: 'protocol_not_seeded' }]);
  });

  test('chain not seeded → skipped (only Flare 14 exists in Chain today)', async () => {
    mockChainFindUnique.mockResolvedValue(null);
    const out = await positionPersistenceService.persistScan('u1', [{ ...SCAN, chainId: 1 }]);
    expect(out.skipped).toEqual([{ protocolSlug: 'kinetic', reason: 'chain_not_seeded' }]);
  });

  test('collateral + debt → SUPPLY and BORROW aggregate rows, one snapshot each', async () => {
    const out = await positionPersistenceService.persistScan('u1', [SCAN]);
    expect(out.persisted).toBe(2);
    expect(out.skipped).toEqual([]);

    expect(mockPositionCreate).toHaveBeenCalledTimes(2);
    const kinds = mockPositionCreate.mock.calls.map((c) => c[0].data.kind).sort();
    expect(kinds).toEqual(['BORROW', 'SUPPLY']);
    const supply = mockPositionCreate.mock.calls.find((c) => c[0].data.kind === 'SUPPLY')![0].data;
    expect(supply.asset).toBe(AGGREGATE_ASSET);
    expect(supply.amountUSD).toBe('250');
    expect(supply.metadata.aggregate).toBe(true);
    const borrow = mockPositionCreate.mock.calls.find((c) => c[0].data.kind === 'BORROW')![0].data;
    expect(borrow.amountUSD).toBe('60'); // amountUSD IS the debt — PositionPerformanceService keys on BORROW

    expect(mockSnapshotCreate).toHaveBeenCalledTimes(2);
    const snap = mockSnapshotCreate.mock.calls[0][0].data;
    expect(snap.hf).toBe(2.4);
    expect(snap.metricsJson.source).toBe('position-scan');
  });

  test('no debt → only the SUPPLY row; Infinity HF normalised to null', async () => {
    const out = await positionPersistenceService.persistScan('u1', [
      { ...SCAN, totalDebtUSD: 0, healthFactor: Infinity },
    ]);
    expect(out.persisted).toBe(1);
    expect(mockPositionCreate).toHaveBeenCalledTimes(1);
    expect(mockPositionCreate.mock.calls[0][0].data.kind).toBe('SUPPLY');
    expect(mockSnapshotCreate.mock.calls[0][0].data.hf).toBeNull();
    expect(mockSnapshotCreate.mock.calls[0][0].data.metricsJson.healthFactor).toBeNull();
  });

  test('existing aggregate row → update (no duplicate Position), snapshot appended', async () => {
    mockPositionFindFirst.mockResolvedValue({ id: 'existing-pos' });
    const out = await positionPersistenceService.persistScan('u1', [{ ...SCAN, totalDebtUSD: 0 }]);
    expect(out.persisted).toBe(1);
    expect(mockPositionCreate).not.toHaveBeenCalled();
    expect(mockPositionUpdate).toHaveBeenCalledTimes(1);
    expect(mockPositionUpdate.mock.calls[0][0].where).toEqual({ id: 'existing-pos' });
    expect(mockSnapshotCreate).toHaveBeenCalledTimes(1);
    expect(mockSnapshotCreate.mock.calls[0][0].data.positionId).toBe('existing-pos');
  });

  test('one row failing does not sink the rest (defensive per-protocol)', async () => {
    mockSnapshotCreate
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ id: 'snap-ok' });
    const out = await positionPersistenceService.persistScan('u1', [
      { ...SCAN, totalDebtUSD: 0 },
      { ...SCAN, protocolSlug: 'kinetic', totalDebtUSD: 0, totalCollateralUSD: 99 },
    ]);
    expect(out.persisted).toBe(1);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toMatch(/write_failed: db down/);
  });

  test('empty position (no collateral, no debt) → skipped as empty_position', async () => {
    const out = await positionPersistenceService.persistScan('u1', [
      { ...SCAN, totalCollateralUSD: 0, totalDebtUSD: 0 },
    ]);
    expect(out.persisted).toBe(0);
    expect(out.skipped).toEqual([{ protocolSlug: 'kinetic', reason: 'empty_position' }]);
  });
});

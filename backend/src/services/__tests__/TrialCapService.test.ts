const mockWalletFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
  },
}));

const mockGetPortfolio = jest.fn();

jest.mock('../../engines/portfolio/PortfolioEngine', () => ({
  PortfolioEngine: {
    getInstance: () => ({ getPortfolio: (...a: unknown[]) => mockGetPortfolio(...a) }),
  },
}));

import { checkTrialCap, trialCapUsd } from '../TrialCapService';

const USER = 'user-1';
const ORIGINAL_CAP = process.env.TRIAL_WALLET_CAP_USD;

beforeEach(() => {
  mockWalletFindMany.mockReset();
  mockGetPortfolio.mockReset();
  delete process.env.TRIAL_WALLET_CAP_USD;
});

afterAll(() => {
  if (ORIGINAL_CAP === undefined) delete process.env.TRIAL_WALLET_CAP_USD;
  else process.env.TRIAL_WALLET_CAP_USD = ORIGINAL_CAP;
});

describe('trialCapUsd', () => {
  test('unset / blank / non-numeric / zero / negative → disabled (null)', () => {
    expect(trialCapUsd()).toBeNull();
    process.env.TRIAL_WALLET_CAP_USD = '  ';
    expect(trialCapUsd()).toBeNull();
    process.env.TRIAL_WALLET_CAP_USD = 'abc';
    expect(trialCapUsd()).toBeNull();
    process.env.TRIAL_WALLET_CAP_USD = '0';
    expect(trialCapUsd()).toBeNull();
    process.env.TRIAL_WALLET_CAP_USD = '-5';
    expect(trialCapUsd()).toBeNull();
  });

  test('a positive number → that cap', () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    expect(trialCapUsd()).toBe(100);
  });
});

describe('checkTrialCap', () => {
  test('cap disabled → ok without touching prisma or the engine', async () => {
    const verdict = await checkTrialCap(USER, '0xabc');
    expect(verdict).toEqual({ ok: true });
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(mockGetPortfolio).not.toHaveBeenCalled();
  });

  test('under the cap → ok (existing + candidate summed)', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([{ address: '0xAAA' }]);
    mockGetPortfolio.mockImplementation(async (address: string) =>
      address === '0xAAA' ? { totalUSD: 30 } : { totalUSD: 50 },
    );
    const verdict = await checkTrialCap(USER, '0xBBB');
    expect(verdict).toEqual({ ok: true });
    expect(mockGetPortfolio).toHaveBeenCalledTimes(2);
  });

  test('over the cap → TRIAL_CAP_EXCEEDED with the total and the cap', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([{ address: '0xAAA' }]);
    mockGetPortfolio.mockImplementation(async (address: string) =>
      address === '0xAAA' ? { totalUSD: 80 } : { totalUSD: 45 },
    );
    const verdict = await checkTrialCap(USER, '0xBBB');
    expect(verdict).toEqual({ ok: false, code: 'TRIAL_CAP_EXCEEDED', totalUsd: 125, capUsd: 100 });
  });

  test('re-connecting an already-connected address is not double-counted', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([{ address: '0xAAA' }]);
    mockGetPortfolio.mockResolvedValue({ totalUSD: 60 });
    // Same wallet, different casing — one valuation, not two.
    const verdict = await checkTrialCap(USER, '0xaaa');
    expect(verdict).toEqual({ ok: true });
    expect(mockGetPortfolio).toHaveBeenCalledTimes(1);
  });

  test('gross assets count — debt does not shrink the exposure', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([]);
    // netWorth would be 40, but total assets are 140 → over.
    mockGetPortfolio.mockResolvedValue({ totalUSD: 140, debtUSD: 100, netWorthUSD: 40 });
    const verdict = await checkTrialCap(USER, 'rXRPLADDRESS');
    expect(verdict).toEqual({ ok: false, code: 'TRIAL_CAP_EXCEEDED', totalUsd: 140, capUsd: 100 });
  });

  test('valuation failure → FAIL-CLOSED (TRIAL_VALUATION_UNAVAILABLE)', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([]);
    mockGetPortfolio.mockRejectedValue(new Error('rpc down'));
    const verdict = await checkTrialCap(USER, '0xBBB');
    expect(verdict).toEqual({ ok: false, code: 'TRIAL_VALUATION_UNAVAILABLE', capUsd: 100 });
  });

  test('non-EVM addresses are valued with their ORIGINAL casing', async () => {
    process.env.TRIAL_WALLET_CAP_USD = '100';
    mockWalletFindMany.mockResolvedValue([]);
    mockGetPortfolio.mockResolvedValue({ totalUSD: 10 });
    await checkTrialCap(USER, 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH');
    expect(mockGetPortfolio).toHaveBeenCalledWith('rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH');
  });
});

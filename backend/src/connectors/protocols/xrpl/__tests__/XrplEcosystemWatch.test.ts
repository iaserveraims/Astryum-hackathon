import {
  DEFAULT_XRPL_WATCH_CONFIG,
  fetchAmendmentsStatus,
  fetchIssuerEscrowStatuses,
  fetchSidechainVenueStatus,
  runXrplEcosystemWatch,
  formatWatchReport,
  type XrplWatchConfig,
} from '../XrplEcosystemWatch';

const CFG: XrplWatchConfig = { ...DEFAULT_XRPL_WATCH_CONFIG, fetchTimeoutMs: 1000 };

/** fetch mock routed by URL substring. */
function mockFetchRoutes(routes: Record<string, unknown>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    for (const [frag, body] of Object.entries(routes)) {
      if (url.includes(frag)) {
        return { ok: true, status: 200, json: async () => body } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

afterEach(() => jest.restoreAllMocks());

describe('XrplEcosystemWatch — amendments', () => {
  test('missing amendment → exists:false (SmartEscrow not on mainnet)', async () => {
    mockFetchRoutes({
      '/amendments': [
        { name: 'LendingProtocol', enabled: false, count: 9, validations: 35, threshold: 28 },
      ],
    });
    const res = await fetchAmendmentsStatus(CFG);
    const smart = res.find((a) => a.name === 'SmartEscrow')!;
    expect(smart.exists).toBe(false);
    expect(smart.enabled).toBe(false);
  });

  test('voting amendment → supportPct computed from count/validations', async () => {
    mockFetchRoutes({
      '/amendments': [
        { name: 'LendingProtocol', enabled: false, count: 9, validations: 35, threshold: 28 },
        { name: 'SingleAssetVault', enabled: false, count: 10, validations: 35, threshold: 28 },
      ],
    });
    const res = await fetchAmendmentsStatus(CFG);
    expect(res.find((a) => a.name === 'LendingProtocol')!.supportPct).toBe(25.7);
    expect(res.find((a) => a.name === 'SingleAssetVault')!.supportPct).toBe(28.6);
  });

  test('enabled amendment → enabled:true (the unlock signal)', async () => {
    mockFetchRoutes({ '/amendments': [{ name: 'SmartEscrow', enabled: true }] });
    const res = await fetchAmendmentsStatus(CFG);
    expect(res.find((a) => a.name === 'SmartEscrow')!.enabled).toBe(true);
  });
});

describe('XrplEcosystemWatch — gated issuer escrow flags (RLUSD + EURØP)', () => {
  test('flag OFF (live mainnet state 2026-07-13, both issuers) → not escrowable', async () => {
    mockFetchRoutes({ '/account/': { Flags: 0x819a0000 } });
    const res = await fetchIssuerEscrowStatuses(CFG);
    expect(res.map((r) => r.label)).toEqual(['RLUSD', 'EURØP']);
    for (const r of res) {
      expect(r.trustLineLockingEnabled).toBe(false);
      expect(r.rawFlags).toBe(0x819a0000);
    }
  });

  test('flag ON per issuer → escrowable (the unlock signal)', async () => {
    mockFetchRoutes({
      [`/account/${CFG.escrowGatedIssuers[0].address}`]: { Flags: 0x819a0000 | 0x40000000 },
      '/account/': { Flags: 0x80900000 },
    });
    const res = await fetchIssuerEscrowStatuses(CFG);
    expect(res.find((r) => r.label === 'RLUSD')!.trustLineLockingEnabled).toBe(true);
    expect(res.find((r) => r.label === 'EURØP')!.trustLineLockingEnabled).toBe(false);
  });
});

describe('XrplEcosystemWatch — sidechain venue', () => {
  test('no venue-category protocol on the sidechain → venue-gated', async () => {
    mockFetchRoutes({
      '/v2/chains': [{ name: 'XRPL EVM', tvl: 25600 }],
      '/protocols': [{ name: 'SomeDex', category: 'Dexes', chains: ['XRPL EVM'], tvl: 20000 }],
    });
    const res = await fetchSidechainVenueStatus(CFG);
    expect(res.chain?.name).toBe('XRPL EVM');
    expect(res.hasRealVenue).toBe(false);
  });

  test('lending protocol appears on the sidechain → venue detected', async () => {
    mockFetchRoutes({
      '/v2/chains': [{ name: 'XRPL EVM', tvl: 5_000_000 }],
      '/protocols': [
        { name: 'NewMoneyMarket', category: 'Lending', chains: ['XRPL EVM'], tvl: 3_000_000 },
        { name: 'EthThing', category: 'Lending', chains: ['Ethereum'], tvl: 9e9 },
      ],
    });
    const res = await fetchSidechainVenueStatus(CFG);
    expect(res.hasRealVenue).toBe(true);
    expect(res.venues).toEqual([{ name: 'NewMoneyMarket', category: 'Lending', tvlUSD: 3_000_000 }]);
  });
});

describe('XrplEcosystemWatch — full run + report', () => {
  test('network failure surfaces in errors, never silently green', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await runXrplEcosystemWatch(CFG);
    expect(res.errors.length).toBeGreaterThan(0);
    const report = formatWatchReport(res);
    expect(report).toContain('FAILED');
  });

  test('report reads the parked/unlocked states correctly', async () => {
    mockFetchRoutes({
      '/amendments': [
        { name: 'LendingProtocol', enabled: false, count: 9, validations: 35, threshold: 28 },
        { name: 'SingleAssetVault', enabled: true },
      ],
      '/account/': { Flags: 0x819a0000 },
      '/v2/chains': [{ name: 'XRPL EVM', tvl: 25600 }],
      '/protocols': [],
    });
    const res = await runXrplEcosystemWatch(CFG);
    const report = formatWatchReport(res);
    expect(report).toContain('SmartEscrow: NOT on mainnet');
    expect(report).toContain('LendingProtocol: voting at 25.7%');
    expect(report).toContain('SingleAssetVault: ✅ ENABLED');
    expect(report).toContain('RLUSD escrow: issuer lsfAllowTrustLineLocking OFF');
    expect(report).toContain('venue-gated');
    expect(res.errors).toEqual([]);
  });
});

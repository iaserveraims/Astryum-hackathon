/**
 * LegacyCagePositionsService — the cage as normal portfolio positions.
 *
 * Pins the 2026-08-01 contract: working principal per venue reads as
 * 'collateral' (→ SUPPLY, counts as earning), idle as 'free', owed yield as
 * 'reward'; everything valued at the XRP price with the same $1 dust rule as
 * the XRPL wallet reader; and a zero/absent price emits NOTHING rather than
 * $0 rows that would drag totals into lies.
 */

import { buildCagePositions } from '../LegacyCagePositionsService';
import type { LegacyVaultState } from '../LegacyVaultStateService';

const COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrf';

function state(over: Partial<LegacyVaultState> = {}): LegacyVaultState {
  return {
    vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
    chain: 'flare',
    council: '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F',
    asset: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', symbol: 'FXRP', decimals: 6 },
    totalPrincipal: '4695300',
    allocatedPrincipal: '4695300',
    idlePrincipal: '0',
    totalValue: '4695333',
    maxVenueBps: 10000,
    migrated: false,
    venues: [
      {
        id: 0,
        target: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3',
        targetSymbol: 'isoFXRP',
        shares: '4695333',
        kind: 1,
        readyAt: 0,
        retired: false,
        basis: '4695300',
        value: '4695333',
      },
    ],
    totalClaimable: '0',
    strayAssets: '0',
    ...over,
  } as LegacyVaultState;
}

describe('buildCagePositions', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.KINETIC_KFXRP_ISO; // deterministic: no protocol mapping unless a test sets it
  });
  afterEach(() => {
    process.env = env;
  });

  it('a working venue reads as collateral (earning), priced at XRP', () => {
    const out = buildCagePositions(state(), COUNCIL, 1.05, 'trace-1');
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.kind).toBe('collateral');
    expect(p.protocol).toBe('isoFXRP');
    expect(p.wallet).toBe(COUNCIL);
    expect(p.chainId).toBe(14);
    expect(p.assets[0].asset.symbol).toBe('FXRP');
    expect(p.assets[0].amountUSD).toBeCloseTo(4.695333 * 1.05, 6);
  });

  it('a venue whose target is a configured protocol reads as THAT protocol — the person sees "kinetic", never a receipt token', () => {
    process.env.KINETIC_KFXRP_ISO = state().venues[0].target;
    const out = buildCagePositions(state(), COUNCIL, 1.0, 'trace-1b');
    expect(out[0].protocol).toBe('kinetic');
  });

  it('idle principal reads as free, owed yield as reward', () => {
    const out = buildCagePositions(
      state({ idlePrincipal: '2000000', totalClaimable: '3000000' }),
      COUNCIL,
      1.0,
      'trace-2',
    );
    const kinds = out.map((p) => `${p.kind}:${p.protocol}`).sort();
    expect(kinds).toEqual(['collateral:isoFXRP', 'free:legacy-cage', 'reward:legacy-cage'].sort());
  });

  it('applies the $1 dust rule per row', () => {
    const out = buildCagePositions(
      state({ venues: [], idlePrincipal: '500000' }), // 0.5 FXRP × $1 = $0.50
      COUNCIL,
      1.0,
      'trace-3',
    );
    expect(out).toEqual([]);
  });

  it('no price → no rows, never $0 positions', () => {
    expect(buildCagePositions(state(), COUNCIL, 0, 'trace-4')).toEqual([]);
    expect(buildCagePositions(state(), COUNCIL, NaN, 'trace-5')).toEqual([]);
  });

  it('a venue without a symbol falls back to a readable slug', () => {
    const out = buildCagePositions(
      state({ venues: [{ ...state().venues[0], targetSymbol: null }] }),
      COUNCIL,
      1.0,
      'trace-6',
    );
    expect(out[0].protocol).toBe('legacy-venue-0');
  });
});

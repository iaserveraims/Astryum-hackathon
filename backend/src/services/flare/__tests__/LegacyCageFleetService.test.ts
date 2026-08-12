/**
 * LegacyCageFleetService — the pure halves, pinned.
 *
 * What matters: the factory status must tell the TRUTH about config without
 * touching the chain when the address cannot be valid (that path feeds a
 * CRITICAL sentinel finding — a checksum typo reads as "no Legacy has a cage"
 * with the factory perfectly healthy); and the refusal counter is the friction
 * gauge the panel shows, so its arithmetic and reset semantics stay fixed.
 */

import {
  __resetCageRefusalsForTests,
  cageCreateRefusalStats,
  expectedSourceId,
  readCageFactoryStatus,
  recordCageCreateRefusal,
} from '../LegacyCageFleetService';

const SAVED = { ...process.env };

beforeEach(() => {
  __resetCageRefusalsForTests();
  delete process.env.LEGACY_FACTORY_ADDRESS;
  delete process.env.LEGACY_PROTOCOL_TREASURY;
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe('expectedSourceId', () => {
  it('follows the network: flare → XRP, anything else → testXRP', () => {
    process.env.LEGACY_CHAIN = 'flare';
    expect(expectedSourceId()).toBe('XRP');
    process.env.LEGACY_CHAIN = 'coston2';
    expect(expectedSourceId()).toBe('testXRP');
    delete process.env.LEGACY_CHAIN;
    expect(expectedSourceId()).toBe('testXRP');
  });
});

describe('readCageFactoryStatus — config truths without a chain', () => {
  it('unset factory: configured=false, nothing chain-read', async () => {
    const st = await readCageFactoryStatus();
    expect(st.configured).toBe(false);
    expect(st.addressValid).toBe(false);
    expect(st.hasCode).toBeNull();
    expect(st.vaultCount).toBeNull();
  });

  it('a bad EIP-55 checksum is INVALID — the silent killer, made visible', async () => {
    // The real factory address with ONE letter's case flipped: mixed case that
    // fails the EIP-55 check. (All-lowercase and all-UPPERCASE both count as
    // "no checksum" and pass — the trap is specifically a mangled mixed case,
    // which is what a hand edit produces.) Before the sentinel probe existed
    // the only trace was a console.warn in Railway.
    process.env.LEGACY_FACTORY_ADDRESS = '0xf93A8A0bd93e95514fF02285349b0b1c1a5a3e0a';
    const st = await readCageFactoryStatus();
    expect(st.configured).toBe(true);
    expect(st.addressValid).toBe(false);
    expect(st.hasCode).toBeNull(); // never touched the chain
  });

  it('treasury validity is reported independently of the factory', async () => {
    process.env.LEGACY_PROTOCOL_TREASURY = 'not-an-address';
    let st = await readCageFactoryStatus();
    expect(st.treasuryConfigured).toBe(true);
    expect(st.treasuryValid).toBe(false);
    process.env.LEGACY_PROTOCOL_TREASURY = '0x7D0441b6063Cbce8315c3408327b5bdD51d8Ba8F';
    st = await readCageFactoryStatus();
    expect(st.treasuryValid).toBe(true);
  });
});

describe('the refusal counter (friction gauge)', () => {
  it('counts by code and remembers the last one', () => {
    recordCageCreateRefusal('CONSTITUTION_NOT_ANCHORED');
    recordCageCreateRefusal('CONSTITUTION_NOT_ANCHORED');
    recordCageCreateRefusal('CAGE_ALREADY_EXISTS');
    const stats = cageCreateRefusalStats();
    expect(stats.total).toBe(3);
    expect(stats.byCode).toEqual({ CONSTITUTION_NOT_ANCHORED: 2, CAGE_ALREADY_EXISTS: 1 });
    expect(stats.last?.code).toBe('CAGE_ALREADY_EXISTS');
  });

  it('starts empty and says since when it has been counting', () => {
    const stats = cageCreateRefusalStats();
    expect(stats.total).toBe(0);
    expect(stats.byCode).toEqual({});
    expect(stats.last).toBeNull();
    expect(new Date(stats.since).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

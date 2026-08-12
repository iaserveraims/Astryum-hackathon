/**
 * LegacyCageCreationService — the birth batch, pinned byte by byte.
 *
 * What matters here: the batch a quorum commits to is [create → approve →
 * deposit] in THAT order against the PREDICTED vault; the eternal params are
 * validated before anything composes (a bad constitutionRef or an empty venue
 * set must refuse at prepare time, never after the XRP is spent); and the
 * treasury/linaje guards refuse to default silently — both are for-ever
 * constructor params of the vault.
 */

import { ethers } from 'ethers';
import {
  FACTORY_ABI,
  LINAJE_DEFAULT_BPS,
  VENUE_KIND,
  buildCageCreationBatch,
  configuredBirthVenues,
  normalizeLinajeFeeBps,
  requiredProtocolTreasury,
  type CageParams,
} from '../LegacyCageCreationService';

const COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrf';
const FACTORY = '0x00000000000000000000000000000000000fac70';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const TREASURY = '0x1111111111111111111111111111111111111111';
const KINETIC = '0x2222222222222222222222222222222222222222';
const FIRELIGHT = '0x3333333333333333333333333333333333333333';
const PREDICTED_VAULT = '0x4444444444444444444444444444444444444444';
const REF = ('0x' + 'ab'.repeat(32)) as string;

function params(over: Partial<CageParams> = {}): CageParams {
  return {
    asset: FXRP,
    constitutionRef: REF,
    protocolTreasury: TREASURY,
    linajeFeeBps: LINAJE_DEFAULT_BPS,
    initialVenues: [
      { target: KINETIC, kind: VENUE_KIND.COMPOUND_V2, label: 'Kinetic' },
      { target: FIRELIGHT, kind: VENUE_KIND.ERC4626, label: 'Firelight' },
    ],
    ...over,
  };
}

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

describe('buildCageCreationBatch', () => {
  it('composes [create → approve → deposit] against the PREDICTED vault', () => {
    const batch = buildCageCreationBatch({
      factoryAddress: FACTORY,
      councilR: COUNCIL,
      params: params(),
      predictedVault: PREDICTED_VAULT,
      supplyUBA: 4_500_000n,
    });
    expect(batch).toHaveLength(3);

    // 1. create — decodable with the factory ABI, carrying the exact params.
    const iface = new ethers.Interface(FACTORY_ABI);
    expect(batch[0].to.toLowerCase()).toBe(FACTORY.toLowerCase());
    const decoded = iface.decodeFunctionData('create', batch[0].calldata);
    expect(decoded[0]).toBe(COUNCIL);
    expect(String(decoded[1][0]).toLowerCase()).toBe(FXRP.toLowerCase());
    expect(String(decoded[1][1]).toLowerCase()).toBe(REF.toLowerCase());
    expect(Number(decoded[1][3])).toBe(LINAJE_DEFAULT_BPS);
    expect(decoded[1][4]).toHaveLength(2);
    expect(Number(decoded[1][4][0][1])).toBe(VENUE_KIND.COMPOUND_V2);

    // 2. approve(predictedVault, supplyUBA) on the FXRP the mint delivers.
    expect(batch[1].to.toLowerCase()).toBe(FXRP.toLowerCase());
    const erc20 = new ethers.Interface(['function approve(address,uint256) returns (bool)']);
    const app = erc20.decodeFunctionData('approve', batch[1].calldata);
    expect(String(app[0]).toLowerCase()).toBe(PREDICTED_VAULT.toLowerCase());
    expect(app[1]).toBe(4_500_000n);

    // 3. deposit(supplyUBA) INTO the predicted vault — LegacyVault's own shape.
    expect(batch[2].to.toLowerCase()).toBe(PREDICTED_VAULT.toLowerCase());
    const vault = new ethers.Interface(['function deposit(uint256)']);
    const dep = vault.decodeFunctionData('deposit', batch[2].calldata);
    expect(dep[0]).toBe(4_500_000n);
  });

  it('refuses a zero amount, a malformed ref and an empty venue set', () => {
    const base = { factoryAddress: FACTORY, councilR: COUNCIL, predictedVault: PREDICTED_VAULT };
    expect(() => buildCageCreationBatch({ ...base, params: params(), supplyUBA: 0n })).toThrow(
      /CAGE_CREATE_BAD_AMOUNT/,
    );
    expect(() =>
      buildCageCreationBatch({
        ...base,
        params: params({ constitutionRef: '0x1234' }),
        supplyUBA: 1n,
      }),
    ).toThrow(/CAGE_CREATE_BAD_REF/);
    expect(() =>
      buildCageCreationBatch({ ...base, params: params({ initialVenues: [] }), supplyUBA: 1n }),
    ).toThrow(/CAGE_CREATE_NO_VENUES/);
  });
});

describe('the eternal params refuse to default silently', () => {
  it('treasury: unset or malformed throws (address(0) would be for ever)', () => {
    delete process.env.LEGACY_PROTOCOL_TREASURY;
    expect(() => requiredProtocolTreasury()).toThrow(/LEGACY_PROTOCOL_TREASURY/);
    process.env.LEGACY_PROTOCOL_TREASURY = 'not-an-address';
    expect(() => requiredProtocolTreasury()).toThrow(/LEGACY_PROTOCOL_TREASURY/);
    process.env.LEGACY_PROTOCOL_TREASURY = TREASURY;
    expect(requiredProtocolTreasury()).toBe(TREASURY);
  });

  it('linaje: default 3000, band [1000, 4000] enforced before composing', () => {
    expect(normalizeLinajeFeeBps(undefined)).toBe(3000);
    expect(normalizeLinajeFeeBps('')).toBe(3000);
    expect(normalizeLinajeFeeBps(1000)).toBe(1000);
    expect(normalizeLinajeFeeBps(4000)).toBe(4000);
    expect(() => normalizeLinajeFeeBps(999)).toThrow(/linajeFeeBps/);
    expect(() => normalizeLinajeFeeBps(4001)).toThrow(/linajeFeeBps/);
    expect(() => normalizeLinajeFeeBps(25.5)).toThrow(/linajeFeeBps/);
  });
});

describe('the beta cap on caged capital (founder 2026-08-06)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { cageCapUBA, cageCapXrp, checkCageCap } = require('../LegacyCageCreationService') as
    typeof import('../LegacyCageCreationService');

  it('defaults to 5 XRP, follows the env, and can be switched off', () => {
    delete process.env.LEGACY_CAGE_MAX_TOTAL_XRP;
    expect(cageCapXrp()).toBe(5);
    process.env.LEGACY_CAGE_MAX_TOTAL_XRP = '2.5';
    expect(cageCapUBA()).toBe(2_500_000n);
    process.env.LEGACY_CAGE_MAX_TOTAL_XRP = '0';
    expect(cageCapUBA()).toBeNull();
    process.env.LEGACY_CAGE_MAX_TOTAL_XRP = 'off';
    expect(cageCapUBA()).toBeNull();
    process.env.LEGACY_CAGE_MAX_TOTAL_XRP = 'garbage';
    expect(cageCapXrp()).toBe(5); // malformed → the safe default, never uncapped
  });

  it('caps the TOTAL, not the transaction — a second funding cannot sneak past', () => {
    delete process.env.LEGACY_CAGE_MAX_TOTAL_XRP; // 5 XRP
    // Empty cage, 4.97 in → fits.
    expect(checkCageCap({ currentUBA: 0n, addUBA: 4_970_000n }).ok).toBe(true);
    // Cage already at 4.69 (the founding shape), adding 1 → over.
    const over = checkCageCap({ currentUBA: 4_690_000n, addUBA: 1_000_000n });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.capXrp).toBe(5);
      expect(over.detail).toMatch(/NEVER comes back out/);
      expect(over.detail).toMatch(/no capital has moved/);
    }
    // Exactly at the cap → allowed (the limit is a ceiling, not a strictness).
    expect(checkCageCap({ currentUBA: 4_000_000n, addUBA: 1_000_000n }).ok).toBe(true);
  });

  it('disabled cap allows everything', () => {
    process.env.LEGACY_CAGE_MAX_TOTAL_XRP = 'off';
    expect(checkCageCap({ currentUBA: 1_000_000_000n, addUBA: 1_000_000_000n }).ok).toBe(true);
  });
});

describe('configuredBirthVenues', () => {
  it('reads the venues the product already orders against, with their kinds', () => {
    jest.resetModules(); // protocolAddresses caches — a fresh read per case
    process.env.KINETIC_KFXRP_ISO = KINETIC;
    process.env.FIRELIGHT_STXRP = FIRELIGHT;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('../LegacyCageCreationService') as typeof import('../LegacyCageCreationService');
    const venues = svc.configuredBirthVenues();
    expect(venues).toEqual([
      { target: KINETIC, kind: VENUE_KIND.COMPOUND_V2, label: 'Kinetic' },
      { target: FIRELIGHT, kind: VENUE_KIND.ERC4626, label: 'Firelight' },
    ]);
  });

  it('returns [] when nothing is configured (the route refuses with its own copy)', () => {
    jest.resetModules();
    delete process.env.KINETIC_KFXRP_ISO;
    delete process.env.FIRELIGHT_STXRP;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('../LegacyCageCreationService') as typeof import('../LegacyCageCreationService');
    expect(svc.configuredBirthVenues()).toEqual([]);
  });
});

describe('the ABI speaks the factory contract', () => {
  it('create and predictAddresses share the CageParams tuple (one drift = both fail)', () => {
    const iface = new ethers.Interface(FACTORY_ABI);
    // Encoding predictAddresses with the same tuple must not throw — this is
    // what guarantees the prediction and the creation describe the same vault.
    const tuple = [
      FXRP,
      REF,
      TREASURY,
      3000,
      [
        [KINETIC, VENUE_KIND.COMPOUND_V2],
        [FIRELIGHT, VENUE_KIND.ERC4626],
      ],
    ];
    expect(() => iface.encodeFunctionData('predictAddresses', [COUNCIL, tuple])).not.toThrow();
    expect(() => iface.encodeFunctionData('create', [COUNCIL, tuple])).not.toThrow();
  });
});

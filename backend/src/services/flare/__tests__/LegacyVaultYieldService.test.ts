/**
 * The yield rail — the only value that ever leaves the cage.
 *
 * The line these tests defend: yield is payable, principal is not. Every call
 * built here must touch `harvest`/`claim` and nothing else, and the redeem must
 * leave for the asset manager, never loop back into the vault.
 */

import {
  buildHarvestCall,
  buildYieldClaimBatch,
  computeHarvestable,
} from '../LegacyVaultYieldService';

const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';
const ASSET_MANAGER = '0x1111111111111111111111111111111111111111';

// Selectors pinned independently (keccak of the signature) so a wrong ABI in
// the service cannot make the test agree with it.
const HARVEST = '0xddc63262'; // harvest(uint256)
const CLAIM = '0x4e71d92d'; // claim()

const redeemCall = { to: ASSET_MANAGER, calldata: '0xdeadbeef', value: '0' };

describe('what harvest would realize', () => {
  it('is the gain ABOVE basis — never the basis itself', () => {
    expect(computeHarvestable(150n, 100n)).toBe(50n);
  });

  it('is zero for a venue that is flat or under water', () => {
    // The contract emits Harvested(0) and returns; the basis is never touched.
    expect(computeHarvestable(100n, 100n)).toBe(0n);
    expect(computeHarvestable(60n, 100n)).toBe(0n);
  });
});

describe('harvest is a bare permissionless call', () => {
  it('encodes harvest(venueId) against the vault and pays the sender nothing', () => {
    const call = buildHarvestCall(VAULT, 0);
    expect(call.to.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(call.data.startsWith(HARVEST)).toBe(true);
    expect(call.value).toBe('0');
    expect(call.summary).toMatch(/pays the sender nothing/i);
  });

  it('rejects a bad vault or venue id', () => {
    expect(() => buildHarvestCall('nope', 0)).toThrow(/BAD_VAULT/);
    expect(() => buildHarvestCall(VAULT, -1)).toThrow(/BAD_VENUE/);
    expect(() => buildHarvestCall(VAULT, 1.5)).toThrow(/BAD_VENUE/);
  });
});

describe("the heir's claim batch", () => {
  it('claims first, then redeems through the existing rail', () => {
    const calls = buildYieldClaimBatch({ vault: VAULT, redeemCall });
    expect(calls).toHaveLength(2);
    expect(calls[0].to.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(calls[0].calldata).toBe(CLAIM);
    // The redeem is passed through untouched — that rail owns the executor,
    // the destination and the FAssets minimum.
    expect(calls[1]).toBe(redeemCall);
  });

  it('touches ONLY claim on the vault — no principal function anywhere', () => {
    const calls = buildYieldClaimBatch({ vault: VAULT, redeemCall });
    const toVault = calls.filter((c) => c.to.toLowerCase() === VAULT.toLowerCase());
    expect(toVault).toHaveLength(1);
    expect(toVault[0].calldata).toBe(CLAIM);
    // claim() takes no arguments — there is nothing to aim at principal.
    expect(toVault[0].calldata).toHaveLength(10);
  });

  it('refuses a redeem that points back at the vault', () => {
    // A redeem aimed at the vault would be either a no-op or a way to make the
    // batch look like a withdrawal it is not.
    expect(() => buildYieldClaimBatch({ vault: VAULT, redeemCall: { ...redeemCall, to: VAULT } }))
      .toThrow(/never back to the vault/);
  });

  it('requires a real redeem call', () => {
    expect(() => buildYieldClaimBatch({ vault: VAULT, redeemCall: undefined as never })).toThrow(/BAD_REDEEM/);
    expect(() => buildYieldClaimBatch({ vault: 'nope', redeemCall })).toThrow(/BAD_VAULT/);
  });
});

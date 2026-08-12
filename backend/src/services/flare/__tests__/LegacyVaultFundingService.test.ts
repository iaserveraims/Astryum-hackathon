/**
 * The batch that funds the cage. Pure encoding — no RPC.
 *
 * What matters: the SHAPE of the deposit call. LegacyVault exposes
 * `deposit(uint256)`; FAssets/ERC-4626 vaults expose `deposit(uint256,address)`.
 * Every existing batch builder in the repo emits the second one, which is why
 * nothing could fund the cage. Encoding the wrong shape here would revert
 * inside a userOp whose bytes were already committed in a signed memo.
 */

import { computeNetMint } from '../../../connectors/protocols/flare/FlareDirectMintService';
import {
  assertFundingAssetMatches,
  buildVaultFundingBatch,
  minimumViableGrossUBA,
} from '../LegacyVaultFundingService';

const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';

// Selectors, computed by hand so a wrong ABI cannot make the test agree with
// the code: deposit(uint256) = 0xb6b55f25, deposit(uint256,address) = 0x6e553f65.
const APPROVE = '0x095ea7b3';
const DEPOSIT_UINT256 = '0xb6b55f25';
const DEPOSIT_UINT256_ADDRESS = '0x6e553f65';

describe('the batch that funds the cage', () => {
  it('approves first, then deposits — that order', () => {
    const calls = buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: 10_000_000n });
    expect(calls).toHaveLength(2);
    expect(calls[0].to.toLowerCase()).toBe(FXRP.toLowerCase());
    expect(calls[0].calldata.startsWith(APPROVE)).toBe(true);
    expect(calls[1].to.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(calls[1].calldata.startsWith(DEPOSIT_UINT256)).toBe(true);
    expect(calls.every((c) => c.value === '0')).toBe(true);
  });

  it("uses LegacyVault's deposit(uint256), NOT the 4626 deposit(uint256,address)", () => {
    // The whole reason this service exists.
    const calls = buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: 10_000_000n });
    expect(calls[1].calldata.startsWith(DEPOSIT_UINT256_ADDRESS)).toBe(false);
    // deposit(uint256) has exactly one 32-byte word of args.
    expect(calls[1].calldata).toHaveLength(2 + 8 + 64);
  });

  it('approves EXACTLY what it deposits', () => {
    // A mismatch either reverts on transferFrom or leaves a dangling allowance
    // on a contract holding family capital.
    const supply = 12_345_678n;
    const calls = buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: supply });
    const hex = supply.toString(16).padStart(64, '0');
    expect(calls[0].calldata.toLowerCase().endsWith(hex)).toBe(true);
    expect(calls[1].calldata.toLowerCase().endsWith(hex)).toBe(true);
  });

  it('points the approval at the vault, not at anyone else', () => {
    const calls = buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: 1n });
    expect(calls[0].calldata.toLowerCase()).toContain(VAULT.slice(2).toLowerCase());
  });

  it('handles 6-decimal FXRP amounts (10 FXRP = 10000000 UBA)', () => {
    // FXRP on Flare mainnet has SIX decimals, verified on-chain 2026-07-28.
    const calls = buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: 10_000_000n });
    expect(calls[1].calldata.toLowerCase().endsWith((10_000_000n).toString(16).padStart(64, '0'))).toBe(true);
  });

  it('refuses amounts and addresses that cannot be right', () => {
    expect(() => buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: 0n })).toThrow(/BAD_AMOUNT/);
    expect(() => buildVaultFundingBatch({ fxrpToken: FXRP, vault: VAULT, supplyUBA: -1n })).toThrow(/BAD_AMOUNT/);
    expect(() => buildVaultFundingBatch({ fxrpToken: 'nope', vault: VAULT, supplyUBA: 1n })).toThrow(/BAD_TOKEN/);
    expect(() => buildVaultFundingBatch({ fxrpToken: FXRP, vault: 'nope', supplyUBA: 1n })).toThrow(/BAD_VAULT/);
    // Approving a token to spend itself is always a mistake, never an intent.
    expect(() => buildVaultFundingBatch({ fxrpToken: FXRP, vault: FXRP, supplyUBA: 1n })).toThrow(/BAD_VAULT/);
  });
});

describe('the smallest funding that actually lands', () => {
  // The live mainnet figures, read 2026-07-29.
  const LIVE = {
    minFeeUBA: 100_000n, // 0.1 XRP
    feeBIPS: 10n,
    executorFeeUBA: 200_000n, // 0.2 XRP
    granularityUBA: 1n,
  };

  it('is just above the fees the mint takes off the top', () => {
    const min = minimumViableGrossUBA(LIVE);
    expect(min).toBeGreaterThan(LIVE.minFeeUBA + LIVE.executorFeeUBA);
    // Still small — 0.3 XRP of fees, not a big floor.
    expect(min).toBeLessThan(310_000n);
  });

  it('ACTUALLY produces principal — checked against the real computeNetMint', () => {
    // The whole point: the number the form shows must work when composed.
    const min = minimumViableGrossUBA(LIVE);
    const net = computeNetMint(min, LIVE);
    expect(net.supplyUBA).toBeGreaterThan(0n);
  });

  it('one step BELOW it produces nothing (so the floor is not padded)', () => {
    const min = minimumViableGrossUBA(LIVE);
    let supply: bigint;
    try {
      supply = computeNetMint(min - LIVE.granularityUBA, LIVE).supplyUBA;
    } catch {
      supply = 0n; // DIRECT_MINT_INSUFFICIENT — also "nothing lands"
    }
    expect(supply).toBe(0n);
  });

  it('scales with a coarser granularity', () => {
    const coarse = minimumViableGrossUBA({ ...LIVE, granularityUBA: 1_000_000n });
    expect(coarse % 1_000_000n).toBe(0n);
    expect(computeNetMint(coarse, { ...LIVE, granularityUBA: 1_000_000n }).supplyUBA).toBeGreaterThan(0n);
  });
});

describe('asset guard', () => {
  it('accepts the live pairing (vault asset == minted FXRP)', () => {
    expect(() => assertFundingAssetMatches(FXRP, FXRP)).not.toThrow();
    expect(() => assertFundingAssetMatches(FXRP.toLowerCase(), FXRP.toUpperCase())).not.toThrow();
  });

  it('refuses before signing when the vault holds a different asset', () => {
    // Otherwise the XRP is spent, the FXRP is minted, and the deposit reverts —
    // leaving the capital stranded in the PA needing a separate rescue.
    expect(() => assertFundingAssetMatches('0x000000000000000000000000000000000000dEaD', FXRP))
      .toThrow(/ASSET_MISMATCH/);
  });
});

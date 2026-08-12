/**
 * LegacyVaultYieldService — the ONLY value that ever leaves the cage.
 *
 * The principal is locked one-way by design: no function returns it to an
 * address. What CAN be paid out is the yield, and the contract already does the
 * whole job — `harvest(venueId)` realizes the gain above a venue's basis and
 * splits it into `claimable[payee]`, and `claim()` pays the caller. Both are
 * permissionless. Nothing here loosens that; this module only builds the calls
 * and reads the numbers, because until now no surface did either.
 *
 * Two shapes, because two very different people call them:
 *
 *  - `harvest` is a plain unsigned EVM call. Anyone may send it — an heir, a
 *    keeper, a passer-by — and it moves nothing to the sender. It only converts
 *    "the venue is worth more than we put in" into "the payees are owed".
 *
 *  - `claim` pays `msg.sender`, so an heir whose payee address is their Flare
 *    Personal Account claims through the 0xFE rail: one XRPL Payment, and the
 *    batch runs `claim()` and then the EXISTING redeem call — so what lands is
 *    native XRP at their own r-address, not FXRP they would have to learn about.
 *
 * The principal is never referenced by any call built here.
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';
import type { UnsignedEvmCall } from './LegacyVaultStateService';

const VAULT_YIELD_ABI = [
  'function harvest(uint256 venueId)',
  'function claim()',
  'function claimable(address) view returns (uint256)',
  'function payeeCount() view returns (uint256)',
  'function payees(uint256) view returns (address account, uint16 bps)',
];

export const VAULT_YIELD_READ_ABI = VAULT_YIELD_ABI;

export interface VaultPayee {
  account: string;
  bps: number;
  /** Already realized and owed to this payee, base units. */
  claimable: string;
}

export interface VaultYieldState {
  vault: string;
  asset: { address: string; symbol: string; decimals: number };
  /** Sum of every payee's claimable — already realized, awaiting claim(). */
  totalClaimable: string;
  payees: VaultPayee[];
  /**
   * Per venue, what `harvest` would realize right now: value − basis, floored
   * at zero. A venue under water yields nothing and its basis is never touched.
   */
  harvestable: Array<{ venueId: number; amount: string }>;
  /** True when no payee is configured — ALL yield capitalizes into principal. */
  capitalizesToPrincipal: boolean;
}

/** What `harvest(venueId)` would realize: only the gain ABOVE basis, never basis. */
export function computeHarvestable(venueValue: bigint, venueBasis: bigint): bigint {
  const gain = venueValue - venueBasis;
  return gain > 0n ? gain : 0n;
}

/**
 * `harvest(venueId)` as a bare unsigned call. Permissionless: it pays the
 * caller nothing, so anyone may send it and nobody can steal by doing so.
 */
export function buildHarvestCall(vault: string, venueId: number): UnsignedEvmCall {
  if (!ethers.isAddress(vault)) throw new Error('VAULT_YIELD_BAD_VAULT: vault is not an address');
  if (!Number.isInteger(venueId) || venueId < 0) throw new Error('VAULT_YIELD_BAD_VENUE: venueId must be a non-negative integer');
  const iface = new ethers.Interface(VAULT_YIELD_ABI);
  return {
    to: ethers.getAddress(vault),
    data: iface.encodeFunctionData('harvest', [venueId]),
    value: '0',
    summary: `Realize the yield venue #${venueId} has earned above what was put in (pays the sender nothing)`,
  };
}

/**
 * The heir's batch: claim the yield into their Personal Account, then send it
 * home as native XRP through the redeem call the unmint rail already builds.
 *
 * `redeemCall` comes from `buildRedeemToXrplCall` — deliberately passed in
 * rather than rebuilt, so the executor, the destination and the FAssets minimum
 * stay owned by that one rail.
 *
 * NOTE on the amount: `claim()` pays whatever is owed AT EXECUTION, which can
 * exceed the figure the redeem was sized with if a harvest lands in between.
 * Any surplus simply stays as FXRP in the heir's own Personal Account — it is
 * never lost and can be redeemed later. Sizing the redeem to a stale, larger
 * number would be the dangerous direction, and that cannot happen here.
 */
export function buildYieldClaimBatch(input: { vault: string; redeemCall: EncodedAction }): EncodedAction[] {
  const { vault, redeemCall } = input;
  if (!ethers.isAddress(vault)) throw new Error('VAULT_YIELD_BAD_VAULT: vault is not an address');
  if (!redeemCall?.to || !redeemCall?.calldata) throw new Error('VAULT_YIELD_BAD_REDEEM: redeemCall is required');
  if (redeemCall.to.toLowerCase() === vault.toLowerCase()) {
    throw new Error('VAULT_YIELD_BAD_REDEEM: the redeem must go to the asset manager, never back to the vault');
  }
  const iface = new ethers.Interface(VAULT_YIELD_ABI);
  return [
    { to: ethers.getAddress(vault), calldata: iface.encodeFunctionData('claim', []), value: '0' },
    redeemCall,
  ];
}

/** Read the yield picture: who is owed what, and what is ripe to realize. */
export async function readYieldState(
  provider: ethers.Provider,
  vaultAddress: string,
  asset: { address: string; symbol: string; decimals: number },
  venues: Array<{ id: number; value: string; basis: string }>,
): Promise<VaultYieldState> {
  const vault = new ethers.Contract(vaultAddress, VAULT_YIELD_ABI, provider);
  const count = Number(await vault.payeeCount());

  const payees: VaultPayee[] = await Promise.all(
    Array.from({ length: count }, async (_, i): Promise<VaultPayee> => {
      const row = (await vault.payees(i)) as [string, bigint];
      const owed = (await vault.claimable(row[0])) as bigint;
      return { account: row[0], bps: Number(row[1]), claimable: owed.toString() };
    }),
  );

  return {
    vault: vaultAddress,
    asset,
    totalClaimable: payees.reduce((s, p) => s + BigInt(p.claimable), 0n).toString(),
    payees,
    harvestable: venues.map((v) => ({
      venueId: v.id,
      amount: computeHarvestable(BigInt(v.value), BigInt(v.basis)).toString(),
    })),
    capitalizesToPrincipal: count === 0,
  };
}

import type { Provider } from 'ethers';
import { FLARE_CONTRACT_REGISTRY } from '../../../flare/ftso/constants';

/**
 * FTSO reward claiming against the CURRENT Flare Systems Protocol RewardManager.
 *
 * Why this exists (Demos Mainnet plan §3/§4 A2): the repo's FTSOAdapter used the
 * deprecated `FtsoRewardManager` (`0xc5738334…`) whose `claim(owner, recipient,
 * rewardEpoch, wrap)` signature no longer matches how the FSP distributes
 * rewards. The live system claims through `RewardManager` (resolved by name from
 * the FlareContractRegistry) using `claim(rewardOwner, recipient,
 * lastClaimableEpoch, wrap, RewardClaimWithProof[])`.
 *
 * Invariant #1 — Astryum NEVER signs. The plan names `@flarenetwork/flare-tx-sdk`
 * as tooling, but its `claimFtsoReward(wallet, …)` SIGNS and BROADCASTS, which we
 * cannot do. We therefore read the claimable state and build the UNSIGNED claim
 * calldata directly against the registry-resolved RewardManager; the user's
 * wallet signs the returned `{to, calldata, value}`. The plan's intent
 * ("current RewardManager + proofs/init/epoch, not the dead contract") is fully
 * preserved — see IRewardManager solidity reference.
 *
 * Delegator self-claim path (the demo): `rewardOwner == recipient == the user`.
 * With the caller being the reward owner, no executor authorization and no
 * recipient allowlist are required (those only apply when a 3rd party claims).
 * Already-initialised weight-based rewards claim with an EMPTY proofs array.
 */

const REGISTRY_ABI = [
  'function getContractAddressByName(string _name) view returns (address)',
];

// Subset of IRewardManager (RewardsV2Interface) used here. Struct order matches
// the on-chain definition exactly so the function selector + ABI encoding are
// correct:
//   RewardClaim          { uint24 rewardEpochId; bytes20 beneficiary; uint120 amount; uint8 claimType; }
//   RewardClaimWithProof { bytes32[] merkleProof; RewardClaim body; }
//   RewardState          { uint24 rewardEpochId; bytes20 beneficiary; uint120 amount; uint8 claimType; bool initialised; }
const REWARD_MANAGER_ABI = [
  'function getNextClaimableRewardEpochId(address _rewardOwner) view returns (uint256)',
  'function getRewardEpochIdsWithClaimableRewards() view returns (uint24 _startEpochId, uint24 _endEpochId)',
  'function getStateOfRewards(address _rewardOwner) view returns (tuple(uint24 rewardEpochId, bytes20 beneficiary, uint120 amount, uint8 claimType, bool initialised)[][] _rewardStates)',
  'function claim(address _rewardOwner, address _recipient, uint24 _rewardEpochId, bool _wrap, tuple(bytes32[] merkleProof, tuple(uint24 rewardEpochId, bytes20 beneficiary, uint120 amount, uint8 claimType) body)[] _proofs) returns (uint256 _rewardAmountWei)',
];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

/** Process-lifetime cache of the resolved RewardManager address. */
let cachedRewardManager: string | null = null;

export class FtsoNoClaimableRewardError extends Error {
  readonly code = 'ftso_no_claimable_reward';
  constructor(rewardOwner: string) {
    super(`No claimable FTSO reward for ${rewardOwner}`);
    this.name = 'FtsoNoClaimableRewardError';
  }
}

/** Resolve the live RewardManager address from the FlareContractRegistry. */
export async function resolveRewardManager(provider: Provider): Promise<string> {
  if (cachedRewardManager) return cachedRewardManager;
  const { ethers } = await import('ethers');
  const registry = new ethers.Contract(
    FLARE_CONTRACT_REGISTRY,
    REGISTRY_ABI,
    provider,
  );
  const addr: string = await registry.getContractAddressByName('RewardManager');
  if (!addr || addr === ZERO || !ADDRESS_RE.test(addr)) {
    throw new Error(
      'FTSO_REWARD_MANAGER_UNRESOLVED: registry returned no RewardManager address',
    );
  }
  cachedRewardManager = ethers.getAddress(addr);
  return cachedRewardManager;
}

/** Test seam — reset the cached RewardManager address. */
export function _resetRewardManagerCache(): void {
  cachedRewardManager = null;
}

/**
 * Total pending FTSO reward (wei) across all unclaimed, claimable epochs for the
 * owner. Read straight from `getStateOfRewards` (invariant #9 — a protocol datum
 * with its source, never a Astryum promise). Returns 0n on any read failure so a
 * transient RPC error never spuriously fires a reward trigger.
 */
export async function getClaimableRewardWei(
  provider: Provider,
  rewardOwner: string,
): Promise<bigint> {
  try {
    const { ethers } = await import('ethers');
    const rm = new ethers.Contract(
      await resolveRewardManager(provider),
      REWARD_MANAGER_ABI,
      provider,
    );
    const states: Array<Array<{ amount: bigint }>> =
      await rm.getStateOfRewards(rewardOwner);
    let total = 0n;
    for (const perEpoch of states) {
      for (const s of perEpoch) {
        total += BigInt(s.amount ?? 0n);
      }
    }
    return total;
  } catch {
    return 0n;
  }
}

export interface ClaimCalldata {
  /** RewardManager contract (registry-resolved). */
  to: string;
  /** Unsigned `claim(...)` calldata. */
  calldata: string;
  /** Native value — always '0' (claim is non-payable). */
  value: string;
  /** Epoch up to which rewards are claimed. */
  lastEpochId: number;
  /** Total claimable reward (wei) at build time, for fee disclosure / UI. */
  claimableWei: string;
}

export interface BuildClaimParams {
  rewardOwner: string;
  /** Defaults to rewardOwner (self-claim — no recipient allowlist needed). */
  recipient?: string;
  /** Defaults to true so rewards land as already-delegated WFLR (compound). */
  wrap?: boolean;
}

/**
 * Build the UNSIGNED `RewardManager.claim(...)` calldata for a delegator
 * self-claim. Empty proofs claim all already-initialised weight-based rewards up
 * to the latest claimable epoch; un-initialised epochs are simply skipped (no
 * revert), so this is safe to prepare without fetching the per-epoch Merkle
 * distribution. Throws `FtsoNoClaimableRewardError` when nothing is claimable.
 */
export async function buildClaimCalldata(
  provider: Provider,
  params: BuildClaimParams,
): Promise<ClaimCalldata> {
  const { ethers } = await import('ethers');
  const rewardOwner = ethers.getAddress(params.rewardOwner);
  const recipient = ethers.getAddress(params.recipient ?? params.rewardOwner);
  const wrap = params.wrap ?? true;

  const to = await resolveRewardManager(provider);
  const rm = new ethers.Contract(to, REWARD_MANAGER_ABI, provider);

  const [, end]: [bigint, bigint] = await rm.getRewardEpochIdsWithClaimableRewards();
  const nextClaimable: bigint = await rm.getNextClaimableRewardEpochId(rewardOwner);
  if (end < nextClaimable) {
    throw new FtsoNoClaimableRewardError(rewardOwner);
  }

  const claimableWei = await getClaimableRewardWei(provider, rewardOwner);
  if (claimableWei <= 0n) {
    throw new FtsoNoClaimableRewardError(rewardOwner);
  }

  const iface = new ethers.Interface(REWARD_MANAGER_ABI);
  const calldata = iface.encodeFunctionData('claim', [
    rewardOwner,
    recipient,
    end, // uint24 last claimable epoch
    wrap,
    [], // empty proofs — claim already-initialised delegator rewards
  ]);

  return {
    to,
    calldata,
    value: '0',
    lastEpochId: Number(end),
    claimableWei: claimableWei.toString(),
  };
}

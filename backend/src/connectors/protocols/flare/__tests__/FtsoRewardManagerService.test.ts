// Mutable canned on-chain responses, set per test.
const mock = {
  rewardManager: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  epochRange: [100n, 321n] as [bigint, bigint],
  nextClaimable: 100n,
  states: [[{ amount: 1000000000000000000n }]] as Array<Array<{ amount: bigint }>>,
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockContract {
    constructor(public address: string) {}
    async getContractAddressByName(_name: string): Promise<string> {
      return mock.rewardManager;
    }
    async getRewardEpochIdsWithClaimableRewards(): Promise<[bigint, bigint]> {
      return mock.epochRange;
    }
    async getNextClaimableRewardEpochId(_o: string): Promise<bigint> {
      return mock.nextClaimable;
    }
    async getStateOfRewards(_o: string) {
      return mock.states;
    }
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: MockContract },
  };
});

import { ethers } from 'ethers';
import {
  buildClaimCalldata,
  getClaimableRewardWei,
  resolveRewardManager,
  _resetRewardManagerCache,
  FtsoNoClaimableRewardError,
} from '../FtsoRewardManagerService';

const OWNER = '0x000000000000000000000000000000000000abcd';
const fakeProvider = {} as any;

const CLAIM_IFACE = new ethers.Interface([
  'function claim(address _rewardOwner, address _recipient, uint24 _rewardEpochId, bool _wrap, tuple(bytes32[] merkleProof, tuple(uint24 rewardEpochId, bytes20 beneficiary, uint120 amount, uint8 claimType) body)[] _proofs) returns (uint256)',
]);

beforeEach(() => {
  _resetRewardManagerCache();
  mock.rewardManager = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  mock.epochRange = [100n, 321n];
  mock.nextClaimable = 100n;
  mock.states = [[{ amount: 1000000000000000000n }]];
});

describe('FtsoRewardManagerService', () => {
  test('resolveRewardManager returns the checksummed registry address', async () => {
    const addr = await resolveRewardManager(fakeProvider);
    expect(addr).toBe(ethers.getAddress(mock.rewardManager));
  });

  test('getClaimableRewardWei sums getStateOfRewards amounts', async () => {
    mock.states = [
      [{ amount: 1000000000000000000n }, { amount: 500000000000000000n }],
      [{ amount: 250000000000000000n }],
    ];
    const wei = await getClaimableRewardWei(fakeProvider, OWNER);
    expect(wei).toBe(1750000000000000000n);
  });

  test('getClaimableRewardWei returns 0n on read failure (no spurious trigger)', async () => {
    mock.states = undefined as any; // force a throw inside the sum loop
    const wei = await getClaimableRewardWei(fakeProvider, OWNER);
    expect(wei).toBe(0n);
  });

  test('buildClaimCalldata encodes unsigned claim(owner, recipient, end, wrap, []) ', async () => {
    const res = await buildClaimCalldata(fakeProvider, {
      rewardOwner: OWNER,
      wrap: true,
    });
    expect(res.to).toBe(ethers.getAddress(mock.rewardManager));
    expect(res.value).toBe('0');
    expect(res.lastEpochId).toBe(321);
    expect(res.claimableWei).toBe('1000000000000000000');

    const decoded = CLAIM_IFACE.parseTransaction({ data: res.calldata });
    expect(decoded?.name).toBe('claim');
    expect(decoded?.args[0].toLowerCase()).toBe(OWNER.toLowerCase()); // rewardOwner
    expect(decoded?.args[1].toLowerCase()).toBe(OWNER.toLowerCase()); // recipient defaults to owner
    expect(Number(decoded?.args[2])).toBe(321); // last claimable epoch (range end)
    expect(decoded?.args[3]).toBe(true); // wrap
    expect(decoded?.args[4]).toEqual([]); // empty proofs (already-initialised delegator)
  });

  test('buildClaimCalldata honours an explicit recipient + wrap=false', async () => {
    const recipient = '0x1111111111111111111111111111111111111111';
    const res = await buildClaimCalldata(fakeProvider, {
      rewardOwner: OWNER,
      recipient,
      wrap: false,
    });
    const decoded = CLAIM_IFACE.parseTransaction({ data: res.calldata });
    expect(decoded?.args[1].toLowerCase()).toBe(recipient.toLowerCase());
    expect(decoded?.args[3]).toBe(false);
  });

  test('throws FtsoNoClaimableRewardError when range is empty', async () => {
    mock.epochRange = [200n, 100n]; // end < start
    mock.nextClaimable = 200n;
    await expect(
      buildClaimCalldata(fakeProvider, { rewardOwner: OWNER }),
    ).rejects.toThrow(FtsoNoClaimableRewardError);
  });

  test('throws FtsoNoClaimableRewardError when claimable amount is 0', async () => {
    mock.states = [[{ amount: 0n }]];
    await expect(
      buildClaimCalldata(fakeProvider, { rewardOwner: OWNER }),
    ).rejects.toThrow(FtsoNoClaimableRewardError);
  });
});

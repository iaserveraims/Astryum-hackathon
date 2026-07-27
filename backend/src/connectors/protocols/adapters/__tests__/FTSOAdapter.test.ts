jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

// The claim path resolves epoch range + RewardManager on-chain via this service.
// Mock it so the adapter test stays a pure unit (no RPC). The service has its own
// integration test (FtsoRewardManagerService.test.ts).
const REWARD_MGR = '0xAAaAaAAAAAaAAaaaAAaaaaAaAaaaAAaaAAaAAAaa';
const CLAIM_CALLDATA = '0xdeadbeef';
jest.mock('../../flare/FtsoRewardManagerService', () => ({
  buildClaimCalldata: jest.fn(async (_provider: unknown, params: { rewardOwner: string; recipient?: string; wrap?: boolean }) => ({
    to: '0xAAaAaAAAAAaAAaaaAAaaaaAaAaaaAAaaAAaAAAaa',
    calldata: '0xdeadbeef',
    value: '0',
    lastEpochId: 321,
    claimableWei: '1000000000000000000',
    _echo: params,
  })),
  getClaimableRewardWei: jest.fn(async () => 0n),
}));

import { ethers } from 'ethers';
import { FTSOAdapter } from '../FTSOAdapter';
import { buildClaimCalldata } from '../../flare/FtsoRewardManagerService';

const WNAT_IFACE = new ethers.Interface([
  'function delegate(address to, uint256 bips)',
  'function undelegateAll()',
]);

const WALLET = '0x000000000000000000000000000000000000abcd';
const WNAT = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const FTSO_PROVIDER = '0x000000000000000000000000000000000000beef';
const PRICE_SNAPSHOT = { takenAt: new Date(), prices: {} };
const CTX = { owner: WALLET, sessionId: 'sess-1', priceSnapshot: PRICE_SNAPSHOT };

describe('FTSOAdapter', () => {
  test('isActive=true (mainnet contracts fixed)', () => {
    expect(new FTSOAdapter().isActive).toBe(true);
  });

  test('simulateAction delegate validates bips range', async () => {
    const a = new FTSOAdapter();
    const ok = await a.simulateAction({
      kind: 'delegate',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: { provider: FTSO_PROVIDER, bips: 5000 },
    });
    expect(ok.success).toBe(true);
    expect(ok.gasEstimate).toBe(120_000n);

    const bad = await a.simulateAction({
      kind: 'delegate',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: { provider: FTSO_PROVIDER, bips: 12000 },
    });
    expect(bad.success).toBe(false);
    expect(bad.warnings.some((w) => /bips/.test(w))).toBe(true);
  });

  test('simulateAction delegate rejects invalid provider address', async () => {
    const a = new FTSOAdapter();
    const r = await a.simulateAction({
      kind: 'delegate',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: { provider: 'not-an-address', bips: 5000 },
    });
    expect(r.success).toBe(false);
    expect(r.warnings.some((w) => /provider address/i.test(w))).toBe(true);
  });

  test('simulateAction undelegate succeeds with empty inputs', async () => {
    const a = new FTSOAdapter();
    const r = await a.simulateAction({
      kind: 'undelegate',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: {},
    });
    expect(r.success).toBe(true);
    expect(r.gasEstimate).toBe(100_000n);
  });

  test('simulateAction claimRewards: epoch resolved on-chain, only recipient validated', async () => {
    const a = new FTSOAdapter();
    const ok = await a.simulateAction({
      kind: 'claimRewards',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: { recipient: WALLET },
    });
    expect(ok.success).toBe(true);
    expect(ok.gasEstimate).toBe(300_000n);

    const bad = await a.simulateAction({
      kind: 'claimRewards',
      protocolId: 'ftso',
      chainId: 14,
      wallet: WALLET,
      inputs: { recipient: 'not-an-address' },
    });
    expect(bad.success).toBe(false);
    expect(bad.warnings.some((w) => /recipient/i.test(w))).toBe(true);
  });

  test('buildTransactionIntent delegate → WNAT.delegate(provider, bips)', async () => {
    const a = new FTSOAdapter();
    const intent = await a.buildTransactionIntent(
      {
        kind: 'delegate',
        protocolId: 'ftso',
        chainId: 14,
        wallet: WALLET,
        inputs: { provider: FTSO_PROVIDER, bips: 5000 },
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());
    expect(intent.txData?.value).toBe(0n);
    const decoded = WNAT_IFACE.parseTransaction({ data: intent.txData!.data });
    expect(decoded?.name).toBe('delegate');
    expect(decoded?.args[0].toLowerCase()).toBe(FTSO_PROVIDER.toLowerCase());
    expect(Number(decoded?.args[1])).toBe(5000);
    expect(intent.action).toBe('delegate');
  });

  test('buildTransactionIntent undelegate → WNAT.undelegateAll()', async () => {
    const a = new FTSOAdapter();
    const intent = await a.buildTransactionIntent(
      {
        kind: 'undelegate',
        protocolId: 'ftso',
        chainId: 14,
        wallet: WALLET,
        inputs: {},
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());
    const decoded = WNAT_IFACE.parseTransaction({ data: intent.txData!.data });
    expect(decoded?.name).toBe('undelegateAll');
    expect(intent.action).toBe('undelegate');
  });

  test('buildTransactionIntent claimRewards → registry RewardManager unsigned calldata, wrap defaults to true', async () => {
    const a = new FTSOAdapter();
    const intent = await a.buildTransactionIntent(
      {
        kind: 'claimRewards',
        protocolId: 'ftso',
        chainId: 14,
        wallet: WALLET,
        inputs: {}, // no wrap → defaults to true (compound); recipient → owner
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(REWARD_MGR.toLowerCase());
    expect(intent.txData?.data).toBe(CLAIM_CALLDATA);
    expect(intent.txData?.value).toBe(0n);
    expect(intent.action).toBe('claimRewards');
    // wrap defaulted to true; recipient defaulted to the owner (self-claim)
    expect(buildClaimCalldata).toHaveBeenCalledWith(expect.anything(), {
      rewardOwner: WALLET,
      recipient: WALLET,
      wrap: true,
    });
  });

  test('buildTransactionIntent rejects unsupported action', async () => {
    const a = new FTSOAdapter();
    await expect(
      a.buildTransactionIntent(
        {
          kind: 'swap',
          protocolId: 'ftso',
          chainId: 14,
          wallet: WALLET,
          inputs: {},
        },
        CTX
      )
    ).rejects.toThrow();
  });
});

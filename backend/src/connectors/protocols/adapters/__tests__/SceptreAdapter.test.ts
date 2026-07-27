jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

import { ethers } from 'ethers';
import { SceptreAdapter } from '../SceptreAdapter';

const SFLR = '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';
const WALLET = '0x000000000000000000000000000000000000abcd';
const PRICE_SNAPSHOT = { takenAt: new Date(), prices: {} };
const CTX = { owner: WALLET, sessionId: 'sess-1', priceSnapshot: PRICE_SNAPSHOT };

const SFLR_IFACE = new ethers.Interface([
  'function submit() payable returns (uint256)',
  'function redeem()',
  'function redeem(uint256 unlockIndex)',
]);

describe('SceptreAdapter', () => {
  test('isActive=true (mainnet sFLR proxy fixed)', () => {
    expect(new SceptreAdapter().isActive).toBe(true);
  });

  test('simulateAction stake computes netUSDImpact + gas', async () => {
    const a = new SceptreAdapter();
    const r = await a.simulateAction({
      kind: 'stake',
      protocolId: 'sceptre',
      chainId: 14,
      wallet: WALLET,
      inputs: { amount: 100n * 10n ** 18n, flrPriceUSD: 0.02 },
    });
    expect(r.success).toBe(true);
    expect(r.gasEstimate).toBe(220_000n);
    expect(r.netUSDImpact).toBeCloseTo(-2, 5); // 100 * 0.02
    expect(r.riskDelta).toBe(-2);
  });

  test('simulateAction unstake adds cooldown warning but is success', async () => {
    const a = new SceptreAdapter();
    const r = await a.simulateAction({
      kind: 'unstake',
      protocolId: 'sceptre',
      chainId: 14,
      wallet: WALLET,
      inputs: {},
    });
    expect(r.success).toBe(true);
    expect(r.warnings.some((w) => /cooldown/i.test(w))).toBe(true);
    expect(r.gasEstimate).toBe(200_000n);
  });

  test('simulateAction withdraw rejects missing unlockIndex', async () => {
    const a = new SceptreAdapter();
    const r = await a.simulateAction({
      kind: 'withdraw',
      protocolId: 'sceptre',
      chainId: 14,
      wallet: WALLET,
      inputs: {},
    });
    expect(r.success).toBe(false);
    expect(r.warnings.some((w) => /unlockIndex/.test(w))).toBe(true);
  });

  test('buildTransactionIntent stake → sFLR.submit() with value=amount', async () => {
    const a = new SceptreAdapter();
    const amount = 50n * 10n ** 18n;
    const intent = await a.buildTransactionIntent(
      {
        kind: 'stake',
        protocolId: 'sceptre',
        chainId: 14,
        wallet: WALLET,
        inputs: { amount, flrPriceUSD: 0.02 },
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(SFLR.toLowerCase());
    expect(intent.txData?.value).toBe(amount);
    const decoded = SFLR_IFACE.parseTransaction({ data: intent.txData!.data });
    expect(decoded?.name).toBe('submit');
    expect(intent.action).toBe('stake');
    expect(intent.protocolId).toBe('sceptre');
  });

  test('buildTransactionIntent unstake → sFLR.redeem() no-arg', async () => {
    const a = new SceptreAdapter();
    const intent = await a.buildTransactionIntent(
      {
        kind: 'unstake',
        protocolId: 'sceptre',
        chainId: 14,
        wallet: WALLET,
        inputs: {},
      },
      CTX
    );
    expect(intent.txData?.value).toBe(0n);
    // redeem() no-arg selector — assert by decode
    const decoded = SFLR_IFACE.parseTransaction({ data: intent.txData!.data });
    expect(decoded?.name).toBe('redeem');
    expect(decoded?.fragment.inputs.length).toBe(0);
  });

  test('buildTransactionIntent withdraw → sFLR.redeem(uint256) with unlockIndex', async () => {
    const a = new SceptreAdapter();
    const intent = await a.buildTransactionIntent(
      {
        kind: 'withdraw',
        protocolId: 'sceptre',
        chainId: 14,
        wallet: WALLET,
        inputs: { unlockIndex: 3 },
      },
      CTX
    );
    expect(intent.txData?.value).toBe(0n);
    const decoded = SFLR_IFACE.parseTransaction({ data: intent.txData!.data });
    expect(decoded?.name).toBe('redeem');
    expect(decoded?.fragment.inputs.length).toBe(1);
    expect(Number(decoded?.args[0])).toBe(3);
  });

  test('buildTransactionIntent rejects unsupported action', async () => {
    const a = new SceptreAdapter();
    await expect(
      a.buildTransactionIntent(
        {
          kind: 'swap',
          protocolId: 'sceptre',
          chainId: 14,
          wallet: WALLET,
          inputs: {},
        },
        CTX
      )
    ).rejects.toThrow();
  });
});

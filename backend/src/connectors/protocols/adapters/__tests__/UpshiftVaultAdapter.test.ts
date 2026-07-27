jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

import { ethers } from 'ethers';
import { UpshiftVaultAdapter } from '../UpshiftVaultAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

// Mainnet constants verified on-chain 2026-07-10 (see .env.example).
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';
const MONARQ_VAULT = '0x2439D4bb753A0f3777d4C9011AFacc475ba6B951';
const MONARQ_TOKEN = '0x36f236af59CB279bab884e464Ef1Bc23c7B1a115';
const RECEIVER = '0x000000000000000000000000000000000000abcd';

const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const VAULT_IFACE = new ethers.Interface([
  'function deposit(address token, uint256 amount, address receiver)',
]);

beforeAll(() => {
  process.env.FXRP_TOKEN = FXRP;
  process.env.UPSHIFT_EARNXRP_VAULT = EARNXRP_VAULT;
  process.env.UPSHIFT_EARNXRP_TOKEN = EARNXRP_TOKEN;
  process.env.UPSHIFT_MONARQ_VAULT = MONARQ_VAULT;
  process.env.UPSHIFT_MONARQ_TOKEN = MONARQ_TOKEN;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.UPSHIFT_EARNXRP_VAULT;
  delete process.env.UPSHIFT_EARNXRP_TOKEN;
  delete process.env.UPSHIFT_MONARQ_VAULT;
  delete process.env.UPSHIFT_MONARQ_TOKEN;
  resetAddressCache();
});

describe('UpshiftVaultAdapter', () => {
  test('isActive when at least one vault pair is configured', () => {
    expect(new UpshiftVaultAdapter().isActive).toBe(true);
  });

  test('descriptors carry the verified risk profiles (earnxrp on-chain, monarq CeDeFi)', () => {
    const a = new UpshiftVaultAdapter();
    const ds = a.getVaultDescriptors();
    expect(ds).toHaveLength(2);
    expect(a.getVaultDescriptor('earnxrp')?.riskProfile).toBe('onchain');
    expect(a.getVaultDescriptor('earnxrp')?.lpToken).toBe(EARNXRP_TOKEN);
    expect(a.getVaultDescriptor('monarq')?.riskProfile).toBe('cedefi');
    expect(a.getVaultDescriptor('monarq')?.vault).toBe(MONARQ_VAULT);
  });

  test('buildDepositBatch → unsigned [approve(FXRP→vault), deposit(FXRP, amount, receiver)]', async () => {
    const a = new UpshiftVaultAdapter();
    const amount = 25_000_000n; // 25 FXRP (6 dec)
    const batch = await a.buildDepositBatch({
      vaultKey: 'earnxrp',
      supplyUBA: amount,
      receiver: RECEIVER,
    });

    expect(batch).toHaveLength(2);

    // Call 1 — approve on the FXRP token, spender = the vault (never the LP token).
    expect(batch[0].to).toBe(FXRP);
    expect(batch[0].value).toBe('0');
    const approve = ERC20_IFACE.parseTransaction({ data: batch[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0]).toBe(EARNXRP_VAULT);
    expect(approve?.args[1]).toBe(amount);

    // Call 2 — multi-asset deposit on the vault: token=FXRP, shares → receiver.
    expect(batch[1].to).toBe(EARNXRP_VAULT);
    expect(batch[1].value).toBe('0');
    const deposit = VAULT_IFACE.parseTransaction({ data: batch[1].calldata });
    expect(deposit?.name).toBe('deposit');
    expect(deposit?.args[0]).toBe(FXRP);
    expect(deposit?.args[1]).toBe(amount);
    expect(deposit?.args[2].toLowerCase()).toBe(RECEIVER.toLowerCase());
  });

  test('buildDepositBatch rejects zero amount and bad receiver', async () => {
    const a = new UpshiftVaultAdapter();
    await expect(
      a.buildDepositBatch({ vaultKey: 'earnxrp', supplyUBA: 0n, receiver: RECEIVER }),
    ).rejects.toThrow(/UPSHIFT_BAD_DEPOSIT/);
    await expect(
      a.buildDepositBatch({ vaultKey: 'earnxrp', supplyUBA: 1n, receiver: 'rXRPLnotEvm' }),
    ).rejects.toThrow(/UPSHIFT_BAD_RECEIVER/);
  });

  test('buildDepositBatch throws (never guesses) when the vault is unconfigured', async () => {
    delete process.env.UPSHIFT_MONARQ_VAULT;
    resetAddressCache();
    const a = new UpshiftVaultAdapter();
    await expect(
      a.buildDepositBatch({ vaultKey: 'monarq', supplyUBA: 1n, receiver: RECEIVER }),
    ).rejects.toThrow(/UPSHIFT_NOT_CONFIGURED/);
    process.env.UPSHIFT_MONARQ_VAULT = MONARQ_VAULT;
    resetAddressCache();
  });

  test('simulateAction supply computes netUSDImpact; withdraw discloses the instant fee', async () => {
    const a = new UpshiftVaultAdapter();
    const supply = await a.simulateAction({
      kind: 'supply',
      protocolId: 'upshift',
      chainId: 14,
      wallet: RECEIVER,
      inputs: { amount: 100_000_000n, priceUSD: 2 }, // 100 FXRP @ $2
    });
    expect(supply.success).toBe(true);
    expect(supply.netUSDImpact).toBeCloseTo(-200, 5);

    const withdraw = await a.simulateAction({
      kind: 'withdraw',
      protocolId: 'upshift',
      chainId: 14,
      wallet: RECEIVER,
      inputs: { amount: 100_000_000n, priceUSD: 2, instantRedemptionFeeBps: 30 },
    });
    expect(withdraw.netUSDImpact).toBeCloseTo(200 - 0.6, 5);
    expect(withdraw.warnings.some((w) => /30 bps/.test(w))).toBe(true);
    expect(withdraw.warnings.some((w) => /requestRedeem/.test(w))).toBe(true);
  });
});

jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

import { ethers } from 'ethers';
import { FirelightAdapter } from '../FirelightAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

// Mainnet constants verified on-chain 2026-07-10: stXRP IS the ERC-4626 vault
// (name "Firelight stXRP", asset()==FXRP, 6 decimals). See .env.example.
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const RECEIVER = '0x000000000000000000000000000000000000abcd';

const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const VAULT_IFACE = new ethers.Interface([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
]);

beforeAll(() => {
  process.env.FXRP_TOKEN = FXRP;
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.FIRELIGHT_STXRP;
  delete process.env.FIRELIGHT_STAKING;
  resetAddressCache();
});

describe('FirelightAdapter', () => {
  test('isActive with the verified mainnet addresses', () => {
    expect(new FirelightAdapter().isActive).toBe(true);
  });

  test('buildStakeBatch → unsigned [approve(FXRP→stXRP), stXRP.deposit(assets, receiver)]', async () => {
    const a = new FirelightAdapter();
    const amount = 10_000_000n; // 10 FXRP (6 dec)
    const batch = await a.buildStakeBatch({ supplyUBA: amount, receiver: RECEIVER });

    expect(batch).toHaveLength(2);

    expect(batch[0].to).toBe(FXRP);
    expect(batch[0].value).toBe('0');
    const approve = ERC20_IFACE.parseTransaction({ data: batch[0].calldata });
    expect(approve?.name).toBe('approve');
    expect(approve?.args[0]).toBe(STXRP);
    expect(approve?.args[1]).toBe(amount);

    expect(batch[1].to).toBe(STXRP);
    expect(batch[1].value).toBe('0');
    const deposit = VAULT_IFACE.parseTransaction({ data: batch[1].calldata });
    expect(deposit?.name).toBe('deposit');
    expect(deposit?.args[0]).toBe(amount);
    expect(deposit?.args[1].toLowerCase()).toBe(RECEIVER.toLowerCase());
  });

  test('buildStakeBatch rejects zero amount and bad receiver', async () => {
    const a = new FirelightAdapter();
    await expect(a.buildStakeBatch({ supplyUBA: 0n, receiver: RECEIVER })).rejects.toThrow(
      /FIRELIGHT_BAD_STAKE/,
    );
    await expect(a.buildStakeBatch({ supplyUBA: 1n, receiver: 'nope' })).rejects.toThrow(
      /FIRELIGHT_BAD_RECEIVER/,
    );
  });

  test('buildStakeBatch throws (never guesses) when unconfigured', async () => {
    delete process.env.FIRELIGHT_STXRP;
    resetAddressCache();
    await expect(
      new FirelightAdapter().buildStakeBatch({ supplyUBA: 1n, receiver: RECEIVER }),
    ).rejects.toThrow(/FIRELIGHT_NOT_CONFIGURED/);
    process.env.FIRELIGHT_STXRP = STXRP;
    resetAddressCache();
  });
});

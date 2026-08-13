/**
 * CalldataBuilder — connector (PATH C) neck + Flare geofence (#8).
 *
 * Proves: the single neck delegates Flare-protocol calldata to the IProtocolAdapter
 * and applies the SAME envelope; and that Flare DeFi execution is gated behind
 * FLARE_DEFI_ENABLED (invariant #8). No RPC: the connector path only encodes from env.
 */
import { ethers } from 'ethers';

const KUSDCE = '0xDEeBaBe05BDA7e8C1740873abF715f16164C29B8';
const COMPTROLLER = '0x8041680Fb73E1Fe5F851e76233DCDfA0f2D2D7c8';
const WALLET = '0x1111111111111111111111111111111111111111';

function baseParams() {
  return {
    protocolSlug: 'kinetic',
    actionType: 'supply',
    amount: '1000000',
    assetSymbol: 'USDC.E',
    userWallet: WALLET,
    chainId: 14,
    partnerId: 'wallet-evm-defi',
    partnerAllowsReferralFee: false,
    partnerRequiresKyc: false,
    userKycVerified: false,
  };
}

describe('CalldataBuilder — Flare connector neck + FLARE_DEFI_ENABLED gate (#8)', () => {
  beforeAll(() => {
    process.env.ASTRYUM_FEE_WALLET =
      process.env.ASTRYUM_FEE_WALLET || '0x000000000000000000000000000000000000dEaD';
    process.env.KINETIC_COMPTROLLER = COMPTROLLER;
    process.env.KINETIC_KUSDCE = KUSDCE;
    require('../../config/protocolAddresses').resetAddressCache();
  });

  test('refuses Flare DeFi when FLARE_DEFI_ENABLED is not "true"', async () => {
    process.env.FLARE_DEFI_ENABLED = '';
    const { calldataBuilder } = require('../CalldataBuilder');
    expect(await calldataBuilder.canHandle('kinetic', 14, 'supply')).toBe(false);
    await expect(calldataBuilder.prepare(baseParams())).rejects.toThrow(/FLARE_DEFI_DISABLED/);
  });

  test('builds Kinetic supply calldata through the neck when the flag is on', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    const { calldataBuilder } = require('../CalldataBuilder');
    expect(await calldataBuilder.canHandle('kinetic', 14, 'supply')).toBe(true);

    const intent = await calldataBuilder.prepare(baseParams());
    expect(intent.tx.to.toLowerCase()).toBe(KUSDCE.toLowerCase());
    expect(intent.tx.chainId).toBe(14);
    const parsed = new ethers.Interface(['function mint(uint256) returns (uint256)'])
      .parseTransaction({ data: intent.tx.data });
    expect(parsed.name).toBe('mint');
    // Same regulatory envelope as every other path.
    expect(intent.authorization.astryumRelays).toBe(false);
    expect(intent.referralAttribution.disclosedToUser).toBe(true);
  });
});

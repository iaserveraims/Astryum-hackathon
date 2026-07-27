/**
 * GATE test — the production path that Safe Markets exercises end-to-end:
 *   supply Aave V3 USDC on Ethereum via the ContractRegistry path.
 *
 * Asserts the two fixes that previously blocked ALL Safe Markets execution:
 *   - the intent builds calldata to the Aave V3 Pool (tx.to) with a valid
 *     supply() selector — i.e. the ContractRegistry → ACTION_SHAPE_BY_KIND
 *     pipeline encodes correctly;
 *   - P38 KYC does NOT block a WALLET_PARTNER intent (partnerRequiresKyc=false),
 *     so policy.passed is true for a non-KYC user.
 *
 * The ContractRegistry lookup is mocked to return a resolved Aave V3 pool (the
 * shape PoolIngestionService persists in prod) so the test needs no DB.
 */

import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SUPPLY_SELECTOR = '0x617ba037'; // supply(address,uint256,address,uint16)

const AAVE_ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../config/abis/AAVE_V3_POOL.json'), 'utf8'),
);

// Mock the registry to return a resolved Aave V3 pool (Tier-A resolution result).
jest.mock('../../services/ContractRegistry', () => ({
  contractRegistry: {
    getExecutablePoolForAction: jest.fn(async () => ({
      poolId: 'uuid-aave-usdc',
      chain: 'eip155:1',
      chainId: 1,
      protocol: 'aave-v3',
      protocolName: 'Aave V3',
      symbol: 'USDC',
      underlyingTokens: [USDC_ETH],
      interactionContractAddress: AAVE_V3_POOL.toLowerCase(),
      receiptTokenAddress: null,
      contractKind: 'aave_v3_pool',
      morphoMarketParams: null,
      abi: AAVE_ABI,
      abiSource: 'sdk_official',
      cooldownSeconds: null,
      isActive: true,
      supportsSupply: true,
    })),
  },
}));

describe('GATE — Aave V3 USDC supply on Ethereum (ContractRegistry path)', () => {
  beforeAll(() => {
    // P33 requires a fee wallet to be configured; partnerAllowsReferralFee=false
    // means no fee is actually embedded.
    process.env.DEFIBRO_FEE_WALLET =
      process.env.DEFIBRO_FEE_WALLET || '0x000000000000000000000000000000000000dEaD';
  });

  test('builds supply calldata to the Aave V3 Pool and passes policy (no KYC)', async () => {
    // Lazy require AFTER env is set (module reads DEFIBRO_FEE_WALLET at load).
    const { calldataBuilder } = require('../CalldataBuilder');

    const intent = await calldataBuilder.prepare({
      protocolSlug: 'aave-v3',
      actionType: 'supply',
      amount: '1000000', // 1 USDC (6 decimals)
      asset: USDC_ETH,
      userWallet: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      partnerId: 'wallet-evm-defi',
      partnerAllowsReferralFee: false,
      partnerRequiresKyc: false, // WALLET_PARTNER → no KYC
      userKycVerified: false,
    });

    expect(intent.tx.to.toLowerCase()).toBe(AAVE_V3_POOL.toLowerCase());
    expect(intent.tx.data.startsWith(SUPPLY_SELECTOR)).toBe(true);
    expect(intent.tx.chainId).toBe(1);
    expect(intent.metadata.action).toBe('supply');
    expect(intent.policy.passed).toBe(true);

    // Decode the calldata: supply(asset, amount, onBehalfOf, referralCode)
    const iface = new ethers.Interface(AAVE_ABI);
    const decoded = iface.decodeFunctionData('supply', intent.tx.data);
    expect((decoded[0] as string).toLowerCase()).toBe(USDC_ETH.toLowerCase());
    expect(decoded[1]).toBe(1000000n);
    expect((decoded[2] as string).toLowerCase()).toBe('0x1111111111111111111111111111111111111111');
  });
});

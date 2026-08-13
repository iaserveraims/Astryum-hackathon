/**
 * ⚠️ EMERGENCY FALLBACK — will be deleted when ContractRegistry is stable.
 *
 * Block F (2026-06-01) — This file is NO LONGER the source of truth.
 * The canonical source is `services/ContractRegistry.ts`, populated by
 * `services/PoolIngestionService.ts` from DefiLlama on a 6h cron.
 *
 * CalldataBuilder consults this map LAST, after:
 *   1. ContractRegistry.getExecutablePoolForAction() (primary, DB-backed)
 *   2. protocolContracts.ts entries (this file — emergency fallback)
 *   3. P10.5 protocolContractRecord DB records (legacy dynamic integration)
 *
 * Why we keep it for now:
 *   - Bootstrap window: until PoolIngestionService completes its first full
 *     resolution pass (typically <1 min), production pools resolve via this map.
 *   - RPC outage safety net: if the ContractRegistry can't return data
 *     transiently, CalldataBuilder still produces correct calldata for the
 *     core protocols.
 *
 * Removal plan:
 *   Once ContractRegistry has been in production with stable resolution rates
 *   for 30+ days (operational dashboard tracks abiSource distribution and
 *   abiResolutionAttempts), this file is DELETED in a follow-up sprint.
 *
 * Until then: DO NOT add new protocols here. Add them via PROTOCOL_KIND_MAP
 * in `services/contractKinds.ts` and the ContractRegistry pipeline.
 */

export type FeeType = 'referral_code' | 'referrer_address' | 'revenue_share' | 'none';

export interface ActionConfig {
  fn: string;
  args: string[];
  isPayable?: boolean;
}

export interface ChainConfig {
  poolAddress: string;
  abi: string;
  actions: Record<string, ActionConfig>;
}

export interface ProtocolContractConfig {
  defiLlamaSlug: string;
  feeType: FeeType;
  referralCode?: number;
  referrerWallet?: string;
  cooldownDays?: number;
  chains: Record<number, ChainConfig>;
}

export const PROTOCOL_CONTRACTS: Record<string, ProtocolContractConfig> = {

  'aave-v3': {
    defiLlamaSlug: 'aave-v3',
    feeType: 'referral_code',
    referralCode: Number(process.env.ASTRYUM_REFERRAL_CODE) || 0,
    chains: {
      1: {
        poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
        abi: 'AAVE_V3_POOL',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
          borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
          repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
        },
      },
      42161: {
        poolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        abi: 'AAVE_V3_POOL',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
          borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
          repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
        },
      },
      8453: {
        poolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
        abi: 'AAVE_V3_POOL',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
          borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
          repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
        },
      },
      137: {
        poolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        abi: 'AAVE_V3_POOL',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
          borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
          repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
        },
      },
      10: {
        poolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        abi: 'AAVE_V3_POOL',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount', 'onBehalfOf', 'referralCode'] },
          borrow:   { fn: 'borrow',   args: ['asset', 'amount', 'interestRateMode', 'referralCode', 'onBehalfOf'] },
          repay:    { fn: 'repay',    args: ['asset', 'amount', 'interestRateMode', 'onBehalfOf'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount', 'to'] },
        },
      },
    },
  },

  'compound-v3': {
    defiLlamaSlug: 'compound-v3',
    feeType: 'none',
    chains: {
      1: {
        poolAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        abi: 'COMPOUND_V3_COMET',
        actions: {
          supply:   { fn: 'supply',   args: ['asset', 'amount'] },
          withdraw: { fn: 'withdraw', args: ['asset', 'amount'] },
          borrow:   { fn: 'withdraw', args: ['asset', 'amount'] },
        },
      },
    },
  },

  'morpho-blue': {
    defiLlamaSlug: 'morpho-blue',
    feeType: 'none',
    chains: {
      1: {
        poolAddress: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
        abi: 'MORPHO_BLUE',
        actions: {
          supply:   { fn: 'supply',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
          withdraw: { fn: 'withdraw', args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
          borrow:   { fn: 'borrow',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
          repay:    { fn: 'repay',    args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
        },
      },
      // Base — same canonical singleton address as mainnet (code verified on
      // Base RPC 2026-07-10). Registered so the position scanner reads the
      // cbXRP/USDC markets (Coinbase XRP-backed loans; ids in
      // MORPHO_BLUE_MARKET_IDS). Watch-only today: tracking, not execution.
      8453: {
        poolAddress: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
        abi: 'MORPHO_BLUE',
        actions: {
          supply:   { fn: 'supply',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
          withdraw: { fn: 'withdraw', args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
          borrow:   { fn: 'borrow',   args: ['marketParams', 'assets', 'shares', 'onBehalf', 'receiver'] },
          repay:    { fn: 'repay',    args: ['marketParams', 'assets', 'shares', 'onBehalf', 'data'] },
        },
      },
    },
  },

  'lido': {
    defiLlamaSlug: 'lido',
    feeType: 'referrer_address',
    referrerWallet: process.env.ASTRYUM_FEE_WALLET,
    cooldownDays: 7,
    chains: {
      1: {
        poolAddress: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        abi: 'LIDO',
        actions: {
          stake:   { fn: 'submit',              args: ['_referral'], isPayable: true },
          unstake: { fn: 'requestWithdrawals',  args: ['_amounts', '_owner'] },
        },
      },
    },
  },

  'rocket-pool': {
    defiLlamaSlug: 'rocket-pool',
    feeType: 'none',
    cooldownDays: 1,
    chains: {
      1: {
        poolAddress: '0xDD3f50F8A6CafbE9b31a427582963f465E745AF8',
        abi: 'ROCKET_POOL_DEPOSIT',
        actions: {
          stake: { fn: 'deposit', args: [], isPayable: true },
        },
      },
    },
  },

  'sceptre-staked-flr': {
    defiLlamaSlug: 'sceptre-staked-flr',
    feeType: 'none',
    cooldownDays: 0,
    chains: {
      14: {
        poolAddress: process.env.SCEPTRE_SFLR_ADDRESS ?? '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
        abi: 'SCEPTRE',
        actions: {
          stake:   { fn: 'deposit', args: ['assets', 'receiver'] },
          unstake: { fn: 'redeem',  args: ['shares', 'receiver', 'owner'] },
        },
      },
    },
  },

  'yearn-v3': {
    defiLlamaSlug: 'yearn-finance',
    feeType: 'revenue_share',
    chains: {
      1: {
        poolAddress: 'dynamic',
        abi: 'ERC4626',
        actions: {
          vault_deposit:  { fn: 'deposit',  args: ['assets', 'receiver'] },
          vault_withdraw: { fn: 'withdraw', args: ['assets', 'receiver', 'owner'] },
        },
      },
    },
  },

  'ether.fi': {
    defiLlamaSlug: 'ether.fi',
    feeType: 'revenue_share',
    cooldownDays: 4,
    chains: {
      1: {
        poolAddress: '0x308861A430be4cce5502d0A12724771Fc6DaF216',
        abi: 'ETHERFI_LIQUIDITY_POOL',
        actions: {
          stake:   { fn: 'deposit',         args: [],         isPayable: true },
          unstake: { fn: 'requestWithdraw', args: ['amount'] },
        },
      },
    },
  },

};

/**
 * All static pool addresses from this registry — used to bulk-update allowlist.
 * Dynamic addresses (poolAddress === 'dynamic') are excluded.
 */
export function getAllStaticPoolAddresses(): string[] {
  const addresses: string[] = [];
  for (const config of Object.values(PROTOCOL_CONTRACTS)) {
    for (const chain of Object.values(config.chains)) {
      if (chain.poolAddress !== 'dynamic' && chain.poolAddress) {
        addresses.push(chain.poolAddress.toLowerCase());
      }
    }
  }
  return addresses;
}

/**
 * Lookup a protocol config by its DefiLlama slug (primary key used by CalldataBuilder).
 */
export function getProtocolConfig(slug: string): ProtocolContractConfig | undefined {
  return PROTOCOL_CONTRACTS[slug];
}

/**
 * Check if CalldataBuilder can handle this protocol + chain + action combo.
 */
export function canHandle(protocolSlug: string, chainId: number, actionType: string): boolean {
  const config = PROTOCOL_CONTRACTS[protocolSlug];
  if (!config) return false;
  const chain = config.chains[chainId];
  if (!chain) return false;
  return actionType in chain.actions;
}

/**
 * Flare LP venue registry — every DEX on Flare with LP positions worth
 * tracking, sourced from the DeFiLlama Flare ecosystem review
 * and verified on-chain the same day (Flare RPC + Routescan + official docs):
 */

export interface FlareLpV3Venue {
  /** protocolId the positions surface under (board groups by this). */
  id: string;
  name: string;
  /** NonfungiblePositionManager (ERC-721 enumerable). */
  npm: string;
  /** positions(tokenId) tuple layout — Algebra puts `deployer` where UniV3 puts `fee`. */
  tupleStyle: 'univ3' | 'algebra';
}

export interface FlareLpV2Venue {
  id: string;
  name: string;
  /** UniV2-style factory (allPairsLength/allPairs). */
  factory: string;
}

export const FLARE_LP_V3_VENUES: FlareLpV3Venue[] = [
  {
    id: 'sparkdex-v4',
    name: 'SparkDEX V4',
    npm: '0x49BE8AA6c684b15e0C5450e8Fa0b16Bec1435596',
    tupleStyle: 'algebra',
  },
  {
    id: 'enosys-v3',
    name: 'Enosys DEX V3',
    npm: '0xD9770b1C7A6ccd33C75b5bcB1c0078f46bE46657',
    tupleStyle: 'univ3',
  },
];

export const FLARE_LP_V2_VENUES: FlareLpV2Venue[] = [
  {
    id: 'blazeswap',
    name: 'BlazeSwap',
    factory: '0x440602f459D7Dd500a74528003e6A20A46d6e2A6',
  },
  {
    id: 'sparkdex-v2',
    name: 'SparkDEX V2',
    factory: '0x16b619B04c961E8f4F06C10B42FDAbb328980A89',
  },
  {
    id: 'enosys-v2',
    name: 'Enosys DEX V2',
    factory: '0x28b70f6Ed97429E40FE9a9CD3EB8E86BCBA11dd4',
  },
  {
    id: 'pangolin',
    name: 'Pangolin',
    factory: '0xbfe13753156b9c6b2818FB45ff3D2392ea43d79A',
  },
];

/** Canonical Multicall3 (same address on ~all EVM chains; code verified on
 *  Flare). Lets the V2 sweep read thousands of pairs in a handful
 *  of RPC round-trips instead of one call per pair. READ-ONLY. */
export const FLARE_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

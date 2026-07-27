/**
 * Flare LP venue registry — every DEX on Flare with LP positions worth
 * tracking, sourced from the DeFiLlama Flare ecosystem review (2026-07-11)
 * and verified on-chain the same day (Flare RPC + Routescan + official docs):
 *
 *   V3-style (NFT positions via a NonfungiblePositionManager):
 *   - SparkDEX V4  $15.3M — Algebra Integral fork. NPM name() =
 *     "Algebra Positions NFT-V2"; factory() == docs.sparkdex.ai V4 page
 *     (AlgebraFactory 0x805488Da…). Tuple carries `deployer` (address) where
 *     UniV3 has `fee` (uint24) → tupleStyle 'algebra'.
 *   - Enosys DEX V3 $6.6M — UniV3 fork. NPM name() =
 *     "EnosysDEX V3 Positions NFT-V1"; positions(1821) decodes with the
 *     UniV3 tuple (fee=500) → tupleStyle 'univ3'.
 *   - SparkDEX V3.1 $8.7M is NOT here: the existing SparkDEXAdapter already
 *     tracks it via SPARKDEX_NFPM (protocolId 'sparkdex').
 *
 *   V2-style (UniV2 pair ERC-20 LP tokens, enumerable via factory.allPairs):
 *   - BlazeSwap    $0.86M — factory read from BlazeSwapPair(0x3ad13e1b…).factory(),
 *     1,910 pairs (permissionless creation — mostly dust; the balance sweep
 *     covers ALL of them via Multicall3, no silent cap).
 *   - SparkDEX V2  — factory from docs.sparkdex.ai (96 pairs).
 *   - Enosys DEX V2 — factory from DeFiLlama flarex adapter (20 pairs).
 *   - Pangolin     — factory from DeFiLlama pangolin adapter (119 pairs).
 *
 * Steer Protocol ($4.6M) and ICHI ($0.29M) are ALM vaults (ERC-20 shares over
 * these same DEXs), not raw LPs — they need their vault-list APIs and are a
 * follow-up, logged in docs/V1_1_INTEGRATION_LOG.md.
 *
 * All addresses are PUBLIC mainnet contracts (safe to commit — same precedent
 * as SPARKDEX_V3_NPM in PositionScanService).
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
 *  Flare 2026-07-11). Lets the V2 sweep read thousands of pairs in a handful
 *  of RPC round-trips instead of one call per pair. READ-ONLY. */
export const FLARE_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

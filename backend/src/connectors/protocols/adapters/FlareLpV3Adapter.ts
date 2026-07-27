import { BaseAdapter } from './BaseAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';
import type { FlareLpV3Venue } from '../../../config/flareLpVenues';

/**
 * Generic tracker for V3-style concentrated-liquidity positions on Flare —
 * one registered instance per venue in FLARE_LP_V3_VENUES (SparkDEX V4,
 * Enosys DEX V3). READ-ONLY: discovery + normalisation only; add/exit
 * liquidity is not prepared here.
 *
 * The two venues share the ERC-721-enumerable NPM surface but differ in the
 * positions(tokenId) tuple: Algebra Integral (SparkDEX V4) carries `deployer`
 * (address) in the slot where UniV3 (Enosys V3) carries `fee` (uint24) —
 * decoding with the wrong layout reverts on custom-deployer pools, hence the
 * per-venue `tupleStyle` (verified on-chain 2026-07-11, see flareLpVenues.ts).
 */

const NPM_COMMON_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
];
const POSITIONS_UNIV3 =
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)';
const POSITIONS_ALGEBRA =
  'function positions(uint256 tokenId) view returns (uint88 nonce, address operator, address token0, address token1, address deployer, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)';
const ERC20_SYMBOL_ABI = ['function symbol() view returns (string)'];

/** The `ethers` namespace as produced by `(await import('ethers')).ethers`. */
type EthersNS = (typeof import('ethers'))['ethers'];

/** Token symbol cache shared across venue instances (addresses are chain-wide). */
const symbolCache = new Map<string, string>();

async function tokenSymbol(
  provider: unknown,
  ethers: EthersNS,
  token: string,
): Promise<string> {
  const key = token.toLowerCase();
  const hit = symbolCache.get(key);
  if (hit) return hit;
  try {
    const c = new ethers.Contract(token, ERC20_SYMBOL_ABI, provider as never);
    const sym: string = await c.symbol();
    symbolCache.set(key, sym);
    return sym;
  } catch {
    const short = `${token.slice(0, 6)}…${token.slice(-4)}`;
    symbolCache.set(key, short);
    return short;
  }
}

export class FlareLpV3Adapter extends BaseAdapter {
  readonly protocolId: string;
  readonly chainId = 14;
  private readonly venue: FlareLpV3Venue;

  constructor(venue: FlareLpV3Venue) {
    super();
    this.venue = venue;
    this.protocolId = venue.id;
  }

  override get isActive(): boolean {
    return true; // fixed, verified mainnet constants (flareLpVenues.ts)
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const abi = [
      ...NPM_COMMON_ABI,
      this.venue.tupleStyle === 'algebra' ? POSITIONS_ALGEBRA : POSITIONS_UNIV3,
    ];
    const npm = new ethers.Contract(this.venue.npm, abi, provider);

    const balance: bigint = await npm.balanceOf(wallet).catch(() => 0n);
    if (balance === 0n) return [];

    const positions: RawPosition[] = [];
    const now = new Date();

    for (let i = 0n; i < balance; i++) {
      let tokenId: bigint;
      try {
        tokenId = await npm.tokenOfOwnerByIndex(wallet, i);
      } catch {
        break; // NPM without enumeration or transient RPC failure — stop cleanly
      }
      let pos;
      try {
        pos = await npm.positions(tokenId);
      } catch {
        continue; // burnt/odd position — skip, never block the sweep
      }
      if (pos.liquidity === 0n) continue;

      const [sym0, sym1] = await Promise.all([
        tokenSymbol(provider, ethers, pos.token0),
        tokenSymbol(provider, ethers, pos.token1),
      ]);

      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'LP',
        asset: `${sym0}/${sym1}`,
        amount: BigInt(pos.liquidity),
        raw: {
          venue: this.venue.name,
          token: `${sym0}/${sym1}`,
          tokenId: tokenId.toString(),
          token0: pos.token0,
          token1: pos.token1,
          // fee only exists on the UniV3 layout; Algebra pools price fees dynamically.
          feeTierBps: this.venue.tupleStyle === 'univ3' ? Number(pos.fee) : null,
          tickLower: Number(pos.tickLower),
          tickUpper: Number(pos.tickUpper),
          tokensOwed0: pos.tokensOwed0?.toString?.() ?? '0',
          tokensOwed1: pos.tokensOwed1?.toString?.() ?? '0',
          source: `${this.venue.name} NPM ${this.venue.npm} (live on-chain)`,
        },
        discoveredAt: now,
      });
    }

    return positions;
  }

  normalizePosition(raw: RawPosition): NormalizedPosition {
    return {
      protocolId: raw.protocolId,
      chainId: raw.chainId,
      wallet: raw.wallet,
      kind: raw.kind,
      asset: raw.asset,
      amount: raw.amount,
      amountUSD: 0,
      priceUSD: 0,
      metadata: raw.raw,
      takenAt: raw.discoveredAt,
    };
  }

  async getMetrics(_position: NormalizedPosition): Promise<PositionMetrics> {
    return {};
  }

  /** Tracking-only adapter: LP actions are not prepared here (V1). */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    return {
      success: false,
      gasEstimate: 0n,
      gasEstimateUSD: 0,
      netUSDImpact: 0,
      riskDelta: 0,
      warnings: [
        `${this.venue.name} is tracking-only in V1 — ${action.kind} is not prepared here. Use the venue directly ("Ir al protocolo").`,
      ],
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }
}

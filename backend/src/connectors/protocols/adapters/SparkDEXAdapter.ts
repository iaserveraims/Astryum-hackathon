import { BaseAdapter } from './BaseAdapter';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';

const NFPM_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
];

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
];

export class SparkDEXAdapter extends BaseAdapter {
  readonly protocolId = 'sparkdex';
  readonly chainId = 14;

  private get addresses() {
    return getProtocolAddresses().sparkdex;
  }

  override get isActive(): boolean {
    return !!this.addresses.nfpm;
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    if (!this.isActive) return [];
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const nfpm = new ethers.Contract(this.addresses.nfpm!, NFPM_ABI, provider);
    const balance: bigint = await nfpm.balanceOf(wallet);
    const positions: RawPosition[] = [];
    const now = new Date();

    for (let i = 0n; i < balance; i++) {
      const tokenId: bigint = await nfpm.tokenOfOwnerByIndex(wallet, i);
      const pos = await nfpm.positions(tokenId);
      if (pos.liquidity === 0n) continue;
      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'LP',
        asset: `${pos.token0}/${pos.token1}`,
        amount: BigInt(pos.liquidity),
        raw: {
          tokenId: tokenId.toString(),
          token0: pos.token0,
          token1: pos.token1,
          fee: Number(pos.fee),
          tickLower: Number(pos.tickLower),
          tickUpper: Number(pos.tickUpper),
          tokensOwed0: pos.tokensOwed0?.toString?.() ?? '0',
          tokensOwed1: pos.tokensOwed1?.toString?.() ?? '0',
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

  /**
   * V3 LP metrics: inRange via Factory.getPool → Pool.slot0 → currentTick
   * compared against position's tickLower/tickUpper.
   */
  async getMetrics(position: NormalizedPosition): Promise<PositionMetrics> {
    if (!this.isActive) return {};
    const factory = this.addresses.factory;
    if (!factory) {
      return {
        inRange: undefined,
        extras: { warning: 'SPARKDEX_FACTORY env not set; cannot compute inRange' },
      };
    }
    const meta = position.metadata as Record<string, unknown>;
    const token0 = meta.token0 as string | undefined;
    const token1 = meta.token1 as string | undefined;
    const fee = Number(meta.fee ?? 0);
    const tickLower = Number(meta.tickLower ?? 0);
    const tickUpper = Number(meta.tickUpper ?? 0);
    const tokensOwed0 = BigInt((meta.tokensOwed0 as string | undefined) ?? '0');
    const tokensOwed1 = BigInt((meta.tokensOwed1 as string | undefined) ?? '0');

    if (!token0 || !token1 || !fee) {
      return { extras: { warning: 'incomplete LP metadata' } };
    }

    try {
      const { ethers } = await import('ethers');
      const provider = this.provider.getHttpProvider();
      const factoryContract = new ethers.Contract(factory, FACTORY_ABI, provider);
      const poolAddr: string = await factoryContract.getPool(token0, token1, fee);
      if (!poolAddr || poolAddr === ethers.ZeroAddress) {
        return { extras: { warning: 'pool not found' } };
      }
      const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
      const slot0 = await pool.slot0();
      const currentTick = Number(slot0.tick);
      const inRange = currentTick >= tickLower && currentTick <= tickUpper;

      return {
        inRange,
        pendingRewards:
          Number(tokensOwed0) / 1e18 + Number(tokensOwed1) / 1e18,
        extras: {
          poolAddress: poolAddr,
          currentTick,
          tickLower,
          tickUpper,
          tokensOwed0: tokensOwed0.toString(),
          tokensOwed1: tokensOwed1.toString(),
        },
      };
    } catch (err) {
      return {
        extras: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * V1 simulation for SparkDEX V3 LPs. Deterministic before/after for:
   *  - exitLP / removeLiquidity → returns position notional + pending fees
   *  - harvest → only the pending fees, position remains
   *  - addLiquidity / swap → not in V1 (returns warning)
   *
   * Assumptions are explicitly listed in `warnings`. No on-chain quoter call.
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    this.assertActive();
    const now = new Date();
    const warnings: string[] = [
      'SparkDEX V1 simulation: notional approximation, no quoter call',
    ];

    const positionUSD = Number(action.inputs?.positionValueUSD ?? 0);
    const pendingFeesUSD = Number(action.inputs?.pendingFeesUSD ?? 0);
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);

    let netUSDImpact = 0;
    let riskDelta = 0;

    switch (action.kind) {
      case 'exitLP':
        // Note: V1 collapses removeLiquidity into exitLP; partial removes
        // can be modeled via inputs.fraction (0..1) post-V1.
        netUSDImpact = positionUSD + pendingFeesUSD;
        riskDelta = -10; // closing LP reduces concentration → risk down
        if (action.inputs?.inRange === false) {
          warnings.push('Position is out-of-range; exiting realises any IL');
        }
        break;
      case 'harvest':
        netUSDImpact = pendingFeesUSD;
        riskDelta = 0;
        if (pendingFeesUSD <= 0) {
          warnings.push('No pending fees to harvest');
        }
        break;
      case 'addLiquidity':
        warnings.push('addLiquidity simulation not modeled in V1');
        netUSDImpact = -Number(action.inputs?.amountUSD ?? 0);
        break;
      case 'swap':
        warnings.push('swap simulation not modeled in V1 (use Quoter post-V1)');
        break;
      default:
        warnings.push(`Action ${action.kind} not natively modeled by SparkDEX adapter`);
    }

    // V3 LP gas estimate buffer
    const gasEstimate =
      action.kind === 'harvest' ? 200_000n : 350_000n;
    const gasPriceGwei = 25;
    const gasEstimateUSD =
      Number(gasEstimate) * gasPriceGwei * 1e-9 * flrPriceUSD;

    return {
      success: true,
      gasEstimate,
      gasEstimateUSD,
      netUSDImpact,
      riskDelta,
      warnings,
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }
}

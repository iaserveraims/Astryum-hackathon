import { BaseAdapter } from './BaseAdapter';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';

/**
 * Enosys (Flare DeFi suite) — V1 FINAL adapter (skeleton activable).
 *
 * Activates when ENOSYS_ROUTER OR ENOSYS_FARMING are set. Without addresses,
 * isActive=false and discoverPositions returns []. Routes return 503
 * protocol_inactive.
 *
 * V1 modules supported:
 *  - DEX V2 (Uniswap V2 fork pattern): pair discovery via Factory.allPairs
 *  - Farms / LP staking: stake/unstake/claim via Farming contract
 *  - Rewards monitoring: pending rewards via Farming.pendingReward(user, pid)
 *  - Lending (optional): supply/borrow/repay if ENOSYS_LENDING_POOL is set
 *
 * Research checklist before activating in production:
 *   1. Verify Factory + Router addresses on Flarescan
 *   2. Confirm Farming contract ABI matches MasterChef-style (pendingReward, deposit, withdraw)
 *   3. Confirm pool count via Farming.poolLength()
 *   4. Document discovered pools in docs/protocols/ENOSYS_FLARE.md
 */

const FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
];

const PAIR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

const FARMING_ABI = [
  'function poolLength() view returns (uint256)',
  'function userInfo(uint256 pid, address user) view returns (uint256 amount, uint256 rewardDebt)',
  'function pendingReward(uint256 pid, address user) view returns (uint256)',
  'function poolInfo(uint256 pid) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accRewardPerShare)',
];

export class EnosysAdapter extends BaseAdapter {
  readonly protocolId = 'enosys';
  readonly chainId = 14;

  private get addresses() {
    return getProtocolAddresses().enosys;
  }

  override get isActive(): boolean {
    return !!(this.addresses.router || this.addresses.farming);
  }

  /**
   * V1 discovery: enumerate user's LP balances across factory pairs (if factory
   * is set) + farming positions (if farming is set). Lending opt-in if
   * lendingPool is set.
   *
   * For V1 we cap pair enumeration to avoid hitting RPC limits — research
   * should narrow down to user's actual pairs via subgraph or events.
   */
  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    if (!this.isActive) return [];
    const positions: RawPosition[] = [];
    const now = new Date();

    // 1) Farming positions (most useful — direct user→pid mapping)
    if (this.addresses.farming) {
      try {
        const { ethers } = await import('ethers');
        const provider = this.provider.getHttpProvider();
        const farming = new ethers.Contract(
          this.addresses.farming,
          FARMING_ABI,
          provider
        );
        const poolCount: bigint = await farming.poolLength();
        // Cap iteration for V1 safety — production should use events or subgraph
        const max = poolCount < 50n ? Number(poolCount) : 50;
        for (let pid = 0; pid < max; pid++) {
          const info = await farming.userInfo(pid, wallet);
          if (info.amount === 0n) continue;
          const pool = await farming.poolInfo(pid).catch(() => null);
          const pending = await farming
            .pendingReward(pid, wallet)
            .catch(() => 0n);
          positions.push({
            protocolId: this.protocolId,
            chainId: this.chainId,
            wallet,
            kind: 'STAKE',
            asset: pool?.lpToken ?? '0x',
            amount: BigInt(info.amount),
            raw: {
              source: 'farming',
              pid,
              lpToken: pool?.lpToken,
              pendingReward: pending.toString(),
            },
            discoveredAt: now,
          });
          if (pending > 0n) {
            positions.push({
              protocolId: this.protocolId,
              chainId: this.chainId,
              wallet,
              kind: 'REWARD',
              asset: pool?.lpToken ?? '0x',
              amount: BigInt(pending),
              raw: { source: 'farming-pending', pid },
              discoveredAt: now,
            });
          }
        }
      } catch (err) {
        // Farming read failed — continue with other modules
        console.warn(
          '[enosys] farming discovery failed:',
          (err as Error).message
        );
      }
    }

    // 2) DEX LP positions via Factory enumeration (capped)
    // V1 minimal: skip global enumeration to avoid RPC blow-up.
    // Production: use The Graph subgraph or Mint events filtered by user.
    // For now we leave this as a no-op when factory is set without subgraph wiring.

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

  async getMetrics(position: NormalizedPosition): Promise<PositionMetrics> {
    if (!this.isActive) return {};
    const meta = position.metadata as Record<string, unknown>;
    const source = meta.source as string | undefined;

    if (source === 'farming-pending') {
      const pending = Number(BigInt((meta as any).amount ?? 0)) / 1e18;
      return { pendingRewards: pending };
    }
    if (source === 'farming') {
      const pendingStr = (meta.pendingReward as string | undefined) ?? '0';
      const pending = Number(BigInt(pendingStr)) / 1e18;
      return { pendingRewards: pending };
    }
    return {};
  }

  /**
   * V1 simulation. Deterministic before/after for:
   *  - harvest      → claim pending farming reward
   *  - unstake      → exit LP staking position (returns LP token)
   *  - exitLP       → remove liquidity from DEX pair (notional approx)
   *  - addLiquidity → not modeled in V1
   *  - swap         → not modeled in V1 (post-V1 with quoter)
   *  - supply / borrow / repay / withdraw → only if lendingPool set
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    this.assertActive();
    const now = new Date();
    const warnings: string[] = ['Enosys V1 simulation is approximation, no quoter'];

    const positionUSD = Number(action.inputs?.positionValueUSD ?? 0);
    const pendingFeesUSD = Number(action.inputs?.pendingFeesUSD ?? 0);
    const pendingRewardsUSD = Number(action.inputs?.pendingRewardsUSD ?? 0);
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);

    let netUSDImpact = 0;
    let riskDelta = 0;

    switch (action.kind) {
      case 'harvest':
        netUSDImpact = pendingRewardsUSD;
        if (pendingRewardsUSD <= 0) warnings.push('No pending Enosys rewards');
        break;
      case 'unstake':
        netUSDImpact = positionUSD + pendingRewardsUSD;
        riskDelta = -5;
        break;
      case 'exitLP':
        netUSDImpact = positionUSD + pendingFeesUSD;
        riskDelta = -10;
        break;
      case 'addLiquidity':
        warnings.push('addLiquidity not modeled in V1');
        netUSDImpact = -Number(action.inputs?.amountUSD ?? 0);
        break;
      case 'swap':
        warnings.push('swap not modeled in V1 (use Enosys quoter post-V1)');
        break;
      case 'supply':
      case 'withdraw':
      case 'borrow':
      case 'repay':
        if (!this.addresses.lendingPool) {
          warnings.push(`Enosys lending not active (ENOSYS_LENDING_POOL unset)`);
          break;
        }
        warnings.push(`Enosys lending ${action.kind} simulation not modeled in V1`);
        break;
      default:
        warnings.push(`Action ${action.kind} not natively modeled by Enosys adapter`);
    }

    const gasEstimate =
      action.kind === 'harvest' || action.kind === 'unstake' ? 200_000n : 350_000n;
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

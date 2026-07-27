import { BaseAdapter } from './BaseAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type {
  SimulationResult,
  TransactionIntent,
  IntentBuildContext,
} from '../../../types/domain/Intent';

/**
 * Sceptre / sFLR liquid staking adapter (V1 pattern; wrapped as Provider in V1.1 alignment).
 *
 * Contracts (Flare Mainnet, verified via Rome-Blockchain-Labs/flare-smart-contracts-public,
 * file `deployed-production.json`):
 *   sFLR proxy:    0x12e605bc104e93B45e1aD99F9e555f659051c2BB
 *   underlying:    WNAT 0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d (same as WFLR)
 *
 * Flow:
 *   stake     → submit() payable           : msg.value = amount (FLR), receive sFLR
 *   unstake   → redeem()                   : initiates cooldown for full sFLR balance
 *   withdraw  → redeem(uint unlockIndex)   : claims an already-unlocked tranche
 *
 * Trust tier: experimental until golden path produces a confirmed tx on Flarescan.
 */
const SFLR_ADDRESS = '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';

const SFLR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function getPooledFlrByShares(uint256) view returns (uint256)',
  'function submit() payable returns (uint256)',
  'function redeem()',
  'function redeem(uint256 unlockIndex)',
];

export class SceptreAdapter extends BaseAdapter {
  readonly protocolId = 'sceptre';
  readonly chainId = 14;

  override get isActive(): boolean {
    return true;
  }

  /**
   * Discovers sFLR balance as STAKE position. The amount is reported in sFLR
   * (share) units; conversion to FLR uses `getPooledFlrByShares` and is left
   * to PortfolioEngine to compute USD value via FTSO.
   */
  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const sflr = new ethers.Contract(SFLR_ADDRESS, SFLR_ABI, provider);
    const balance: bigint = await sflr.balanceOf(wallet).catch(() => 0n);
    if (balance <= 0n) return [];
    const pooledFlr: bigint = await sflr
      .getPooledFlrByShares(balance)
      .catch(() => balance);
    return [
      {
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'STAKE',
        asset: SFLR_ADDRESS,
        amount: balance,
        raw: {
          token: 'sFLR',
          decimals: 18,
          pooledFlr: pooledFlr.toString(),
          // FTSO has no sFLR feed — without the protocol's own share→FLR
          // conversion the position priced to $0.
          underlying: { symbol: 'FLR', amount: pooledFlr.toString(), decimals: 18 },
        },
        discoveredAt: new Date(),
      },
    ];
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

  /**
   * Inputs:
   *   stake     → { amount: bigint } (FLR base units, sent as msg.value)
   *   unstake   → {}                  (no args; queues full balance for cooldown)
   *   withdraw  → { unlockIndex: number }
   *   flrPriceUSD?: number
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    const warnings: string[] = [];
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);
    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    let gasEstimate = 0n;
    let netUSDImpact = 0;
    let riskDelta = 0;

    switch (action.kind) {
      case 'stake': {
        if (amount <= 0n) warnings.push('stake amount must be > 0');
        const human = Number(amount) / 1e18;
        netUSDImpact = -(human * flrPriceUSD);
        riskDelta = -2;
        gasEstimate = 220_000n;
        break;
      }
      case 'unstake':
        warnings.push('Sceptre unstake initiates cooldown (~10 days). Withdraw available after unlock.');
        gasEstimate = 200_000n;
        riskDelta = 1;
        break;
      case 'withdraw': {
        const unlockIndex = Number(action.inputs?.unlockIndex ?? -1);
        if (!Number.isInteger(unlockIndex) || unlockIndex < 0)
          warnings.push('withdraw requires a non-negative unlockIndex');
        gasEstimate = 180_000n;
        break;
      }
      default:
        warnings.push(`Action ${action.kind} not supported by Sceptre adapter`);
    }

    const gasPriceGwei = 25;
    const gasEstimateUSD =
      Number(gasEstimate) * gasPriceGwei * 1e-9 * flrPriceUSD;

    return {
      success: warnings.filter((w) => !w.startsWith('Sceptre unstake')).length === 0,
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

  override async buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext
  ): Promise<TransactionIntent> {
    const baseIntent = await super.buildTransactionIntent(action, ctx);
    const { ethers } = await import('ethers');
    const iface = new ethers.Interface(SFLR_ABI);
    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;

    let txData: TransactionIntent['txData'];
    switch (action.kind) {
      case 'stake':
        txData = {
          to: SFLR_ADDRESS,
          data: iface.encodeFunctionData('submit', []),
          value: amount,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      case 'unstake':
        txData = {
          to: SFLR_ADDRESS,
          data: iface.encodeFunctionData('redeem()', []),
          value: 0n,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      case 'withdraw': {
        const unlockIndex = BigInt(Number(action.inputs?.unlockIndex ?? 0));
        txData = {
          to: SFLR_ADDRESS,
          data: iface.encodeFunctionData('redeem(uint256)', [unlockIndex]),
          value: 0n,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      }
      default:
        throw new Error(`Unsupported Sceptre action: ${action.kind}`);
    }

    return { ...baseIntent, txData };
  }
}

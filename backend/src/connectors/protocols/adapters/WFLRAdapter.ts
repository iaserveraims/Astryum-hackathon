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
 * WFLR (Wrapped Native FLR) adapter.
 *
 * WNAT is a fixed Flare Mainnet contract — always active.
 *  - wrap   → user sends FLR via deposit() payable. msg.value = amount, calldata = '0xd0e30db0'.
 *  - unwrap → user calls withdraw(uint256). value = 0.
 *
 * Wrapping is the prerequisite for FTSO delegation and most LP/farming flows
 * on Flare. V1.1 capability: `wrap_native`.
 */
const WNAT_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';

const WNAT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
];

const SELECTOR_DEPOSIT = '0xd0e30db0';

export class WFLRAdapter extends BaseAdapter {
  readonly protocolId = 'wflr';
  readonly chainId = 14;

  override get isActive(): boolean {
    return true;
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const wnat = new ethers.Contract(WNAT_ADDRESS, WNAT_ABI, provider);
    const balance: bigint = await wnat.balanceOf(wallet).catch(() => 0n);
    if (balance <= 0n) return [];
    return [
      {
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'STAKE',
        asset: WNAT_ADDRESS,
        amount: BigInt(balance),
        raw: { token: 'WFLR' },
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
   * Inputs (action.inputs):
   *   amount: bigint  base units (18 decimals)
   *   flrPriceUSD?: number gas conversion
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    const warnings: string[] = [];
    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);

    if (amount <= 0n) warnings.push('Amount must be > 0');

    let gasEstimate = 0n;
    switch (action.kind) {
      case 'wrap':
        gasEstimate = 60_000n;
        break;
      case 'unwrap':
        gasEstimate = 80_000n;
        break;
      default:
        warnings.push(`Action ${action.kind} not supported by WFLR adapter`);
    }

    const gasPriceGwei = 25;
    const gasEstimateUSD =
      Number(gasEstimate) * gasPriceGwei * 1e-9 * flrPriceUSD;

    return {
      success: warnings.length === 0,
      gasEstimate,
      gasEstimateUSD,
      netUSDImpact: 0,
      riskDelta: 0,
      warnings,
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }

  /**
   * Build txData for wrap/unwrap. wrap → deposit() payable with msg.value=amount.
   * unwrap → withdraw(uint256) with value=0.
   */
  override async buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext
  ): Promise<TransactionIntent> {
    const baseIntent = await super.buildTransactionIntent(action, ctx);
    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    const { ethers } = await import('ethers');
    const iface = new ethers.Interface(WNAT_ABI);

    let txData: TransactionIntent['txData'];
    if (action.kind === 'wrap') {
      txData = {
        to: WNAT_ADDRESS,
        data: SELECTOR_DEPOSIT,
        value: amount,
        gasLimit: baseIntent.simulation.gasEstimate,
        chainId: this.chainId,
      };
    } else if (action.kind === 'unwrap') {
      txData = {
        to: WNAT_ADDRESS,
        data: iface.encodeFunctionData('withdraw', [amount]),
        value: 0n,
        gasLimit: baseIntent.simulation.gasEstimate,
        chainId: this.chainId,
      };
    } else {
      throw new Error(`Unsupported WFLR action: ${action.kind}`);
    }

    return { ...baseIntent, txData };
  }
}

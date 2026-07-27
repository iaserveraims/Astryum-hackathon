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

// Standard convention address for the native token of a chain (EIP-like).
// Used by Zerion, Alchemy, Uniswap, and others to represent FLR/ETH/etc.
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Reads the wallet's raw native FLR balance via eth_getBalance.
 * Always active — no env vars required.
 * This is the primary reason a Flare wallet showed $0 in portfolio:
 * the WFLRAdapter only covers wrapped FLR (WFLR ERC20), not the native coin.
 */
export class NativeBalanceAdapter extends BaseAdapter {
  readonly protocolId = 'wallet';
  readonly chainId = 14;

  override get isActive(): boolean {
    return true;
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const provider = this.provider.getHttpProvider();
    let balance = 0n;
    try {
      balance = await provider.getBalance(wallet);
    } catch (err) {
      console.warn(
        '[NativeBalanceAdapter] getBalance failed:',
        (err as Error).message,
      );
      return [];
    }
    if (balance <= 0n) return [];
    return [
      {
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'FREE',
        asset: NATIVE_TOKEN_ADDRESS,
        amount: balance,
        raw: { symbol: 'FLR', token: 'FLR', decimals: 18, native: true },
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
      asset: 'FLR',
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

  async simulateAction(_action: ProtocolAction): Promise<SimulationResult> {
    return {
      success: false,
      gasEstimate: 0n,
      gasEstimateUSD: 0,
      netUSDImpact: 0,
      riskDelta: 0,
      warnings: ['NativeBalanceAdapter does not support actions'],
      simulatedAt: new Date(),
      priceTimestamp: new Date(),
      isStale: false,
    };
  }

  override async buildTransactionIntent(
    _action: ProtocolAction,
    _ctx: IntentBuildContext,
  ): Promise<TransactionIntent> {
    throw new Error('NativeBalanceAdapter does not support transaction intents');
  }
}

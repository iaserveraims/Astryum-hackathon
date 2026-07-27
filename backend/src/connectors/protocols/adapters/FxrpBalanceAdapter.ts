import { BaseAdapter } from './BaseAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import { resolveFxrpToken } from '../flare/FlareDirectMintService';

/**
 * FXRP (FAssets XRP on Flare) free-balance adapter.
 *
 * Every DeFi adapter reads FXRP *deployed* into a protocol (Kinetic kTokens,
 * LP positions…), but nothing read the plain ERC-20 sitting in the wallet —
 * so freshly minted or received FXRP was invisible in the portfolio. This
 * adapter is the FXRP twin of NativeBalanceAdapter (raw FLR).
 *
 * Token address: FXRP_TOKEN env when configured, else resolved live from the
 * FlareContractsRegistry via AssetManagerFXRP.fAsset() (invariant #9 — a
 * protocol datum, never hardcoded). Read-only: balanceOf, no actions.
 *
 * The RawPosition is emitted under protocolId 'wallet' (same bucket as native
 * FLR) — it IS a wallet holding, and the engine's external-provider dedupe
 * keys on that bucket, so a CoinStats/DeBank read of the same token can never
 * double-count it.
 */
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

// FXRP UBA == XRP drops.
const FXRP_DECIMALS = 6;

export class FxrpBalanceAdapter extends BaseAdapter {
  readonly protocolId = 'fxrp';
  readonly chainId = 14;

  override get isActive(): boolean {
    return true; // live resolution needs no env
  }

  private async tokenAddress(): Promise<string | null> {
    const configured = getProtocolAddresses().fxrp.token;
    if (configured) return configured;
    try {
      return await resolveFxrpToken(this.provider.getHttpProvider());
    } catch (err) {
      console.warn('[FxrpBalanceAdapter] FXRP token unresolved:', (err as Error).message);
      return null;
    }
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const token = await this.tokenAddress();
    if (!token) return [];
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const fxrp = new ethers.Contract(token, ERC20_ABI, provider);
    const balance: bigint = await fxrp.balanceOf(wallet).catch(() => 0n);
    if (balance <= 0n) return [];
    return [
      {
        // 'wallet' on purpose — see the header note on the dedupe bucket.
        protocolId: 'wallet',
        chainId: this.chainId,
        wallet,
        kind: 'FREE',
        asset: token,
        amount: BigInt(balance),
        raw: { symbol: 'FXRP', token: 'FXRP', decimals: FXRP_DECIMALS },
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
      asset: 'FXRP',
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

  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    return {
      success: false,
      gasEstimate: 0n,
      gasEstimateUSD: 0,
      netUSDImpact: 0,
      riskDelta: 0,
      warnings: [`Action ${action.kind} not supported — FXRP balance adapter is read-only`],
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }
}

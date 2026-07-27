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
import {
  buildClaimCalldata,
  getClaimableRewardWei,
} from '../flare/FtsoRewardManagerService';

/**
 * FTSO adapter — V1.1 capabilities `ftso_delegate` and `ftso_claim_rewards`.
 *
 *  - delegate     → WNAT.delegate(address provider, uint256 bips)         bips in 0..10000
 *  - undelegate   → WNAT.undelegateAll()
 *  - claimRewards → RewardManager.claim(rewardOwner, recipient, lastEpoch, wrap, proofs)
 *                   resolved via FlareContractRegistry (NOT the dead FtsoRewardManager
 *                   `0xc573…`). Builds UNSIGNED calldata — the user signs. See
 *                   flare/FtsoRewardManagerService.ts.
 *
 * WNAT is a fixed mainnet address → adapter is always active. Delegations require
 * existing WFLR balance (see WFLRAdapter for wrap).
 */
const WNAT_ADDRESS = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';

const WNAT_ABI = [
  'function delegate(address to, uint256 bips)',
  'function undelegateAll()',
  'function delegatesOf(address owner) view returns (address[] addresses, uint256[] bips, uint256 count, uint256 mode)',
];

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_BIPS = 10_000;

export class FTSOAdapter extends BaseAdapter {
  readonly protocolId = 'ftso';
  readonly chainId = 14;

  override get isActive(): boolean {
    return true;
  }

  /**
   * Reads current delegations on WNAT and emits one STAKE position per active
   * delegate target. `bips` is recorded in metadata.
   */
  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const wnat = new ethers.Contract(WNAT_ADDRESS, WNAT_ABI, provider);
    const result = await wnat.delegatesOf(wallet).catch(() => null);
    if (!result) return [];
    const [addresses, bips]: [string[], bigint[]] = [
      result.addresses ?? result[0] ?? [],
      result.bips ?? result[1] ?? [],
    ];
    const now = new Date();
    const positions: RawPosition[] = [];
    for (let i = 0; i < addresses.length; i++) {
      const target = addresses[i];
      const b = bips[i] ?? 0n;
      if (b <= 0n) continue;
      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'STAKE',
        asset: WNAT_ADDRESS,
        amount: 0n, // amount in WFLR is computed elsewhere; bips lives in raw
        raw: { kind: 'ftso_delegation', delegateTo: target, bips: Number(b) },
        discoveredAt: now,
      });
    }

    // Claimable FTSO delegation rewards → REWARD position. Priced as FLR (asset
    // is WNAT) by NormalisationEngine, so the REWARD_THRESHOLD automation (A2,
    // compound) sees pending rewards in USD. Reward = WFLR once claimed wrapped.
    // Read straight from the live RewardManager (invariant #9 — protocol datum).
    try {
      const claimableWei = await getClaimableRewardWei(provider, wallet);
      if (claimableWei > 0n) {
        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'REWARD',
          asset: WNAT_ADDRESS,
          amount: claimableWei,
          raw: {
            kind: 'ftso_reward',
            token: 'WFLR',
            source: 'RewardManager',
            claimable: true,
          },
          discoveredAt: now,
        });
      }
    } catch {
      /* reward read is best-effort; never block delegation discovery */
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

  /**
   * Inputs:
   *   delegate     → { provider: address, bips: number 0..10000 }
   *   undelegate   → {}
   *   claimRewards → { recipient?: address, wrap?: boolean }  (epoch/proofs resolved on-chain)
   *   flrPriceUSD? → for gas USD conversion
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    const warnings: string[] = [];
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);
    let gasEstimate = 0n;

    switch (action.kind) {
      case 'delegate': {
        const target = String(action.inputs?.provider ?? '');
        const bips = Number(action.inputs?.bips ?? 0);
        if (!ADDRESS_RE.test(target)) warnings.push('Invalid provider address');
        if (!Number.isInteger(bips) || bips <= 0 || bips > MAX_BIPS)
          warnings.push(`bips must be integer in (0, ${MAX_BIPS}]`);
        gasEstimate = 120_000n;
        break;
      }
      case 'undelegate':
        gasEstimate = 100_000n;
        break;
      case 'claimRewards': {
        // Epoch range + Merkle/init are resolved on-chain by
        // FtsoRewardManagerService at build time; only the recipient (when
        // overridden) needs validating here.
        const recipient = String(action.inputs?.recipient ?? action.wallet);
        if (!ADDRESS_RE.test(recipient))
          warnings.push('Invalid recipient address');
        gasEstimate = 300_000n; // claim(...) with proofs can be heavier than a transfer
        break;
      }
      default:
        warnings.push(`Action ${action.kind} not supported by FTSO adapter`);
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

  override async buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext
  ): Promise<TransactionIntent> {
    const baseIntent = await super.buildTransactionIntent(action, ctx);
    const { ethers } = await import('ethers');
    const wnatIface = new ethers.Interface(WNAT_ABI);

    let txData: TransactionIntent['txData'];
    switch (action.kind) {
      case 'delegate': {
        const target = String(action.inputs?.provider ?? '');
        const bips = Number(action.inputs?.bips ?? 0);
        txData = {
          to: WNAT_ADDRESS,
          data: wnatIface.encodeFunctionData('delegate', [target, bips]),
          value: 0n,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      }
      case 'undelegate':
        txData = {
          to: WNAT_ADDRESS,
          data: wnatIface.encodeFunctionData('undelegateAll', []),
          value: 0n,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      case 'claimRewards': {
        // A2 compound: claim(wrap=true) → rewards return as already-delegated
        // WFLR (delegation is % of balance), auto-compounding in one tx. Default
        // wrap=true; recipient defaults to the owner (self-claim, no allowlist).
        const recipient = action.inputs?.recipient
          ? String(action.inputs.recipient)
          : ctx.owner;
        const wrap =
          action.inputs?.wrap === undefined ? true : Boolean(action.inputs.wrap);
        const provider = this.provider.getHttpProvider();
        const claim = await buildClaimCalldata(provider, {
          rewardOwner: ctx.owner,
          recipient,
          wrap,
        });
        txData = {
          to: claim.to, // registry-resolved RewardManager
          data: claim.calldata, // UNSIGNED claim(...) — the user signs
          value: 0n,
          gasLimit: baseIntent.simulation.gasEstimate,
          chainId: this.chainId,
        };
        break;
      }
      default:
        throw new Error(`Unsupported FTSO action: ${action.kind}`);
    }

    return { ...baseIntent, txData };
  }
}

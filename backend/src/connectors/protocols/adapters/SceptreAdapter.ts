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

/**
 * The unlock queue — read surface added 2026-08-01, ABI + semantics verified
 * against the verified implementation source (proxy 0x12e605bc… → impl
 * 0xca0fEE77…, Flarescan/Routescan) and probed live on Flare mainnet.
 *
 * `requestUnlock(shares)` moves the shares into the contract's custody, so
 * `balanceOf(user)` drops to zero — and WITHOUT this queue read the whole
 * position vanished from every surface for the entire 14.5-day cooldown. Live
 * parameters at the time of writing: cooldownPeriod 1,252,800s (14.5 d),
 * redeemPeriod 172,800s (2 d).
 */
const SFLR_UNLOCK_ABI = [
  'function getPooledFlrByShares(uint256) view returns (uint256)',
  'function getUnlockRequestCount(address user) view returns (uint256)',
  'function getPaginatedUnlockRequests(address user, uint256 from, uint256 to) view returns (tuple(uint256 startedAt, uint256 shareAmount)[], uint256[])',
  'function userSharesInCustody(address) view returns (uint256)',
  'function cooldownPeriod() view returns (uint256)',
  'function redeemPeriod() view returns (uint256)',
  'function requestUnlock(uint256 shareAmount)',
  'function redeemOverdueShares()',
];

export interface SceptrePendingUnlock {
  /** Index in the user's unlock-request array — the arg `redeem(uint)` takes. */
  index: number;
  /** sFLR shares held in custody for this request (18 dec). */
  sharesBase: string;
  /** Underlying FLR the request is worth right now (protocol conversion). */
  pooledFlrBase: string;
  /** ISO time the request was made. */
  startedAt: string;
  /** ISO time the cooldown ends and `redeem(index)` starts working. */
  availableAt: string;
  /** ISO time the redemption window shuts — after this the request goes
   *  overdue and `redeemOverdueShares()` puts the sFLR back to work. */
  expiresAt: string;
  /** true while `redeem(index)` would succeed (cooldown done, not expired). */
  claimable: boolean;
  /** true once the window closed: the shares are stuck until re-claimed. */
  expired: boolean;
}

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
    const now = new Date();
    const positions: RawPosition[] = [];

    if (balance > 0n) {
      const pooledFlr: bigint = await sflr
        .getPooledFlrByShares(balance)
        .catch(() => balance);
      positions.push({
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
        discoveredAt: now,
      });
    }

    // Shares in the unlock queue: NOT in balanceOf, still the user's money.
    // Without this the whole stake disappeared from the dashboard the moment
    // the user requested the unlock, and stayed invisible for 14.5 days.
    try {
      for (const q of await this.readPendingUnlocks(wallet, provider)) {
        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'CLAIM',
          asset: SFLR_ADDRESS,
          amount: BigInt(q.sharesBase),
          raw: {
            kind: 'claim',
            token: 'sFLR',
            decimals: 18,
            vaultName: q.expired
              ? 'sFLR con la ventana de retirada vencida'
              : 'sFLR en periodo de enfriamiento',
            underlying: { symbol: 'FLR', amount: q.pooledFlrBase, decimals: 18 },
            // Same four facts Firelight's queued exit ships — one shape, so
            // the dashboard classifies money in flight without special cases.
            exiting: true,
            claimable: q.claimable,
            availableAt: q.availableAt,
            expiresAt: q.expiresAt,
            // OPPOSITE of Firelight, and it is protocol truth either way:
            // `_redeem` prices the request with the exchange rate at
            // `startedAt + cooldownPeriod` (verified impl source 2026-08-01),
            // so the stake KEEPS compounding all through the cooldown and
            // stops the moment it becomes claimable.
            stillEarning: !q.claimable && !q.expired,
            sceptreUnlock: {
              index: q.index,
              startedAt: q.startedAt,
              availableAt: q.availableAt,
              expiresAt: q.expiresAt,
              claimable: q.claimable,
              expired: q.expired,
            },
            sharePriceSource: 'sFLR.getPooledFlrByShares() (live on-chain)',
          },
          discoveredAt: now,
        });
      }
    } catch {
      /* queue unreadable — never break the stake reading for it */
    }

    return positions;
  }

  /**
   * The wallet's open unlock requests, newest last. Pure read; no signing.
   * Returns [] when the wallet has none (the common case) at the cost of a
   * single `getUnlockRequestCount` call.
   */
  async readPendingUnlocks(
    wallet: string,
    provider?: import('ethers').Provider,
  ): Promise<SceptrePendingUnlock[]> {
    const { ethers } = await import('ethers');
    const sflr = new ethers.Contract(
      SFLR_ADDRESS,
      SFLR_UNLOCK_ABI,
      provider ?? this.provider.getHttpProvider(),
    );
    const count = Number(await sflr.getUnlockRequestCount(wallet).catch(() => 0n));
    if (!Number.isFinite(count) || count <= 0) return [];

    const [requests, cooldown, redeemWindow] = await Promise.all([
      // getPaginatedUnlockRequests reverts when `from >= length`, so the count
      // above is what makes this call safe — never probe blind.
      sflr.getPaginatedUnlockRequests(wallet, 0, count) as Promise<
        [Array<{ startedAt: bigint; shareAmount: bigint }>, bigint[]]
      >,
      sflr.cooldownPeriod() as Promise<bigint>,
      sflr.redeemPeriod() as Promise<bigint>,
    ]);

    const [rows, indices] = requests;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const iso = (sec: bigint) => new Date(Number(sec) * 1000).toISOString();
    const out: SceptrePendingUnlock[] = [];

    for (let i = 0; i < rows.length; i++) {
      const startedAt = BigInt(rows[i].startedAt);
      const shares = BigInt(rows[i].shareAmount);
      if (shares <= 0n) continue;
      const availableAt = startedAt + BigInt(cooldown);
      const expiresAt = availableAt + BigInt(redeemWindow);
      const pooled: bigint = await sflr
        .getPooledFlrByShares(shares)
        .catch(() => shares);
      out.push({
        index: Number(indices[i] ?? i),
        sharesBase: shares.toString(),
        pooledFlrBase: pooled.toString(),
        startedAt: iso(startedAt),
        availableAt: iso(availableAt),
        expiresAt: iso(expiresAt),
        // Mirrors `_isWithinRedemptionPeriod`: cooldown done AND not expired.
        claimable: nowSec >= availableAt && nowSec <= expiresAt,
        expired: nowSec > expiresAt,
      });
    }
    return out;
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

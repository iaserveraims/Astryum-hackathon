import { BaseAdapter } from './BaseAdapter';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';
import type { EncodedAction } from '../IProtocolAdapter';

// stXRP IS the ERC-4626 vault (verified on-chain 2026-07-10: asset()==FXRP,
// deposit(uint256,address), 6 decimals). convertToAssets gives the live
// FXRP-per-share — protocol data, never computed by us (invariant #9).
const STXRP_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
];
const STAKING_ABI = ['function pendingRewards(address) view returns (uint256)'];
const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const STXRP_DEPOSIT_ABI = ['function deposit(uint256 assets, address receiver) returns (uint256)'];
// 4626-shaped exit (selector 0xba087652), but NOT synchronous — VERIFIED
// on-chain 2026-07-14 (FirelightVault impl 0x70CCf1bE…, tx 0x1bd8fea…):
// redeem burns the shares NOW and queues the FXRP into the CURRENT withdrawal
// period; NO assets move in the redeem tx. The FXRP is released by
// claimWithdraw(period) once that period ends (~24h periods). owner == caller
// ⇒ no approve.
const STXRP_REDEEM_ABI = [
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
];
// The withdrawal-period queue of FirelightVault (ABI from the verified impl).
// `nextPeriodEnd` added 2026-08-01: a redeem queues into currentPeriod()+1, so
// the ETA of a just-signed exit is the END of that next period, not this one.
const STXRP_CLAIM_ABI = [
  'function currentPeriod() view returns (uint256)',
  'function currentPeriodEnd() view returns (uint48)',
  'function nextPeriodEnd() view returns (uint48)',
  'function withdrawalsOf(uint256 period, address owner) view returns (uint256)',
  'function withdrawAssets(uint256 period) view returns (uint256)',
  'function withdrawShares(uint256 period) view returns (uint256)',
  'function isWithdrawClaimed(uint256 period, address owner) view returns (bool)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function claimWithdraw(uint256 period) returns (uint256)',
];

export interface FirelightPendingWithdrawal {
  period: number;
  /**
   * FXRP queued in this period for the owner, in base units (6 dec).
   *
   * This is what `withdrawalsOf` actually returns — ASSETS, not shares: its
   * body is `_convertToAssetsTotals(withdrawSharesOf[period][account], …)`
   * (verified against the verified impl source 2026-08-01). It used to be read
   * as `sharesBase` and then converted to assets a SECOND time; the vault sits
   * near 1.00 FXRP/share so the error hid inside the rounding, but the number
   * was wrong by the share ratio and the label was wrong outright.
   */
  queuedFxrpBase: string;
  /** Estimated FXRP the claim will release (protocol data; null if unreadable). */
  estFxrpBase: string | null;
  /** true once the period has ended — claimWithdraw succeeds then. */
  claimable: boolean;
  /** ISO time this exit becomes claimable (null when the vault can't say yet). */
  claimableAt: string | null;
}

export class FirelightAdapter extends BaseAdapter {
  readonly protocolId = 'firelight';
  readonly chainId = 14;

  private get addresses() {
    return getProtocolAddresses().firelight;
  }

  override get isActive(): boolean {
    return !!this.addresses.staking && !!this.addresses.stXRP;
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    if (!this.isActive) return [];
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const stXRP = new ethers.Contract(this.addresses.stXRP!, STXRP_ABI, provider);
    const staking = new ethers.Contract(this.addresses.staking!, STAKING_ABI, provider);
    const [stakedBalance, pending] = await Promise.all([
      stXRP.balanceOf(wallet),
      staking.pendingRewards(wallet).catch(() => 0n),
    ]);
    const positions: RawPosition[] = [];
    const now = new Date();

    if (stakedBalance > 0n) {
      // Underlying FXRP via the vault's own conversion (ERC-4626) — live data.
      const underlyingFxrpUBA: bigint = await stXRP
        .convertToAssets(stakedBalance)
        .catch(() => 0n);
      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'STAKE',
        asset: this.addresses.stXRP!,
        amount: BigInt(stakedBalance),
        raw: {
          token: 'stXRP',
          // stXRP mirrors FXRP's 6 decimals (verified on-chain 2026-07-10);
          // without this the engine assumes 18 and the position reads $0.00.
          decimals: 6,
          underlyingFxrpUBA: underlyingFxrpUBA > 0n ? underlyingFxrpUBA.toString() : null,
          ...(underlyingFxrpUBA > 0n
            ? { underlying: { symbol: 'XRP', amount: underlyingFxrpUBA.toString(), decimals: 6 } }
            : {}),
          sharePriceSource: 'stXRP.convertToAssets() (live on-chain)',
        },
        discoveredAt: now,
      });
    }
    if (pending > 0n) {
      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'REWARD',
        asset: this.addresses.stXRP!,
        amount: BigInt(pending),
        raw: { kind: 'pending', token: 'stXRP', decimals: 6 },
        discoveredAt: now,
      });
    }

    // Queued exits — redeem burned the shares, so balanceOf is 0 and WITHOUT
    // this the money-in-flight vanishes from every surface (the founder's
    // "stxrp me sigue apareciendo / no llega" of 2026-07-14). Each unclaimed
    // period shows as a CLAIM position until claimWithdraw releases the FXRP.
    try {
      const { pending: queued } = await this.readPendingWithdrawals(wallet, provider, 8);
      for (const q of queued) {
        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'CLAIM',
          asset: this.addresses.stXRP!,
          amount: BigInt(q.queuedFxrpBase),
          raw: {
            kind: 'claim',
            token: 'stXRP',
            vaultName: `FXRP en cola de salida (periodo ${q.period})`,
            decimals: 6,
            ...(q.estFxrpBase
              ? { underlying: { symbol: 'XRP', amount: q.estFxrpBase, decimals: 6 } }
              : {}),
            // The four facts every surface needs about money in flight. Shared
            // shape across venues (Sceptre/Upshift emit the same keys) so the
            // dashboard classifies exits without knowing the protocol.
            exiting: true,
            claimable: q.claimable,
            availableAt: q.claimableAt,
            expiresAt: null, // Firelight never expires a claim
            // Firelight FIXES the assets at request time — `_requestWithdraw`
            // does `withdrawAssets[period] += previewRedeem(shares)` (verified
            // impl source, 2026-08-01). From the signature on, this money no
            // longer compounds: it is an amount waiting for its release date,
            // NOT capital at work. Sceptre's queue answers the opposite.
            stillEarning: false,
            firelightClaim: {
              period: q.period,
              claimable: q.claimable,
              claimableAt: q.claimableAt,
              estFxrpBase: q.estFxrpBase,
            },
            sharePriceSource: 'FirelightVault withdrawalsOf() (live on-chain)',
          },
          discoveredAt: now,
        });
      }
    } catch {
      /* claim queue unreadable — never break the whole scan for it */
    }

    return positions;
  }

  /**
   * Unclaimed withdrawal-queue entries of `wallet`, newest period first.
   * `lookback` bounds the probe (periods are ~1 day; queued exits are claimed
   * in days, not months). `provider` lets route callers reuse their own
   * JsonRpcProvider (the FlareProvider singleton needs initialize()).
   */
  async readPendingWithdrawals(
    wallet: string,
    provider?: import('ethers').Provider,
    lookback = 30,
  ): Promise<{ currentPeriod: number; currentPeriodEnd: string | null; pending: FirelightPendingWithdrawal[] }> {
    const stXrp = this.addresses.stXRP;
    if (!stXrp) throw new Error('FIRELIGHT_NOT_CONFIGURED: missing FIRELIGHT_STXRP');
    const { ethers } = await import('ethers');
    const v = new ethers.Contract(stXrp, STXRP_CLAIM_ABI, provider ?? this.provider.getHttpProvider());

    // Optional reads must never take the queue down with them: a vault
    // deployment (or a test double) that lacks one of these getters would
    // otherwise throw synchronously, before any .catch() could run.
    const readOpt = async (fn: string): Promise<bigint | null> => {
      try {
        return (await (v[fn] as () => Promise<bigint>)()) ?? null;
      } catch {
        return null;
      }
    };
    const [curRaw, endRaw, nextEndRaw] = await Promise.all([
      v.currentPeriod() as Promise<bigint>,
      readOpt('currentPeriodEnd'),
      readOpt('nextPeriodEnd'),
    ]);
    const currentPeriod = Number(curRaw);
    const iso = (t: bigint | null) => (t != null ? new Date(Number(t) * 1000).toISOString() : null);
    const currentPeriodEnd = iso(endRaw);
    const nextPeriodEnd = iso(nextEndRaw);

    // START AT currentPeriod + 1 — `_requestWithdraw` queues into
    // `currentPeriod() + 1` (verified impl source, 2026-08-01), so scanning
    // from currentPeriod downwards MISSED every exit signed inside the running
    // period: the founder's money vanished from the dashboard between signing
    // the withdrawal and the period rolling over (up to a full period).
    const from = Math.max(0, currentPeriod - lookback);
    const range: number[] = [];
    for (let p = currentPeriod + 1; p >= from; p--) range.push(p);
    // Cheap first pass (1 read per period), details only for the hits.
    const queuedAssets = await Promise.all(
      range.map((p) => v.withdrawalsOf(p, wallet).catch(() => 0n) as Promise<bigint>),
    );
    const pending: FirelightPendingWithdrawal[] = [];
    for (let i = 0; i < range.length; i++) {
      const period = range[i];
      // withdrawalsOf returns ASSETS (FXRP) already — see the interface note.
      const assets = BigInt(queuedAssets[i]);
      if (assets <= 0n) continue;
      const claimed = (await v
        .isWithdrawClaimed(period, wallet)
        .catch(() => false)) as boolean;
      if (claimed) continue;
      pending.push({
        period,
        queuedFxrpBase: assets.toString(),
        estFxrpBase: assets.toString(),
        // claimWithdraw reverts unless `period < currentPeriod()` — the same
        // condition the contract enforces, not an approximation of it.
        claimable: period < currentPeriod,
        // A period becomes claimable when the NEXT one starts: the exit queued
        // for `currentPeriod` lands at currentPeriodEnd, and one queued for
        // currentPeriod+1 lands at nextPeriodEnd. Further out we don't guess.
        claimableAt:
          period === currentPeriod
            ? currentPeriodEnd
            : period === currentPeriod + 1
              ? nextPeriodEnd
              : null,
      });
    }
    return { currentPeriod, currentPeriodEnd, pending };
  }

  /**
   * Release a finished withdrawal period: ONE call, claimWithdraw(period) —
   * the FXRP goes to the caller (the account whose shares were queued).
   * Returns unsigned EncodedAction[]; Astryum signs nothing.
   */
  async buildClaimWithdrawBatch(params: { period: number }): Promise<EncodedAction[]> {
    const stXrp = this.addresses.stXRP;
    if (!stXrp) throw new Error('FIRELIGHT_NOT_CONFIGURED: missing FIRELIGHT_STXRP');
    if (!Number.isInteger(params.period) || params.period < 0) {
      throw new Error('FIRELIGHT_BAD_PERIOD: must be a non-negative integer');
    }
    const { ethers } = await import('ethers');
    const iface = new ethers.Interface(STXRP_CLAIM_ABI);
    return [
      {
        to: stXrp,
        calldata: iface.encodeFunctionData('claimWithdraw', [params.period]),
        value: '0',
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
   * V1 simulation for XRP staking via Firelight.
   *  - stake     → user provides FXRP, receives stXRP. netUSD = -amountUSD (locked).
   *  - unstake   → user burns stXRP, receives FXRP. netUSD = +amountUSD - withdrawal fee.
   *  - claim     → returns pending rewards.
   *
   * Inputs (action.inputs):
   *   amount: bigint (in 18-dec base units of FXRP/stXRP)
   *   priceUSD: number (XRP/USD via FTSO)
   *   pendingRewardsUSD?: number
   *   withdrawalFeeBps?: number (default 0)
   *   flrPriceUSD?: number (gas)
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    this.assertActive();
    const now = new Date();
    const warnings: string[] = [
      'Firelight V1 simulation: assumes 1:1 FXRP↔stXRP unless inputs specify ratio',
    ];

    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    const decimals = Number(action.inputs?.decimals ?? 18);
    const priceUSD = Number(action.inputs?.priceUSD ?? 0);
    const human = Number(amount) / 10 ** decimals;
    const amountUSD = priceUSD * human;
    const pendingRewardsUSD = Number(action.inputs?.pendingRewardsUSD ?? 0);
    const withdrawalFeeBps = Number(action.inputs?.withdrawalFeeBps ?? 0);
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);

    let netUSDImpact = 0;
    let riskDelta = 0;

    switch (action.kind) {
      case 'stake':
        netUSDImpact = -amountUSD;
        riskDelta = -2; // staking slightly reduces wallet liquidity risk
        if (amountUSD <= 0) warnings.push('Stake amount must be > 0');
        break;
      case 'unstake': {
        const fee = (amountUSD * withdrawalFeeBps) / 10_000;
        netUSDImpact = amountUSD - fee;
        riskDelta = 2; // unstaking unlocks liquidity
        if (fee > 0) warnings.push(`Withdrawal fee: $${fee.toFixed(2)}`);
        break;
      }
      case 'harvest':
        netUSDImpact = pendingRewardsUSD;
        if (pendingRewardsUSD <= 0) warnings.push('No pending Firelight rewards');
        break;
      default:
        warnings.push(
          `Action ${action.kind} not natively modeled by Firelight adapter`
        );
    }

    const gasEstimate = action.kind === 'harvest' ? 150_000n : 250_000n;
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

  /**
   * Stake batch for the `0xFE` Personal Account userOp (the E3-style rail):
   *   [ approve(FXRP → stXRP vault, supplyUBA),
   *     stXRP.deposit(supplyUBA, receiver) ]
   *
   * stXRP is a standard ERC-4626 vault over FXRP (verified on-chain
   * 2026-07-10); `receiver` MUST be the Personal Account so the stXRP shares
   * land on the user's smart account. Returns unsigned EncodedAction[];
   * Astryum signs nothing. Throws (never guesses) when unconfigured.
   */
  async buildStakeBatch(params: {
    supplyUBA: bigint;
    receiver: string;
  }): Promise<EncodedAction[]> {
    const stXrp = this.addresses.stXRP;
    const fxrpToken = getProtocolAddresses().fxrp.token;
    const missing: string[] = [];
    if (!stXrp) missing.push('FIRELIGHT_STXRP');
    if (!fxrpToken) missing.push('FXRP_TOKEN');
    if (missing.length) {
      throw new Error(`FIRELIGHT_NOT_CONFIGURED: missing ${missing.join(', ')}`);
    }
    if (params.supplyUBA <= 0n) throw new Error('FIRELIGHT_BAD_STAKE: must be > 0');
    if (!/^0x[a-fA-F0-9]{40}$/.test(params.receiver)) {
      throw new Error('FIRELIGHT_BAD_RECEIVER: not an EVM address');
    }

    const { ethers } = await import('ethers');
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const vault = new ethers.Interface(STXRP_DEPOSIT_ABI);
    return [
      {
        to: fxrpToken!, // approve the stXRP vault to pull the staked FXRP
        calldata: erc20.encodeFunctionData('approve', [stXrp!, params.supplyUBA]),
        value: '0',
      },
      {
        to: stXrp!, // ERC-4626 deposit — shares → receiver (the PA)
        calldata: vault.encodeFunctionData('deposit', [params.supplyUBA, params.receiver]),
        value: '0',
      },
    ];
  }

  /**
   * ERC-4626 exit: burns `sharesUBA` stXRP from `owner` (the caller — wallet
   * or Personal Account) and sends the underlying FXRP to `receiver`. Single
   * call, no approve when owner == caller. Returns unsigned EncodedAction[];
   * Astryum signs nothing.
   */
  async buildRedeemBatch(params: {
    sharesUBA: bigint;
    receiver: string;
    owner: string;
  }): Promise<EncodedAction[]> {
    const stXrp = this.addresses.stXRP;
    if (!stXrp) throw new Error('FIRELIGHT_NOT_CONFIGURED: missing FIRELIGHT_STXRP');
    if (params.sharesUBA <= 0n) throw new Error('FIRELIGHT_BAD_REDEEM: shares must be > 0');
    for (const [label, addr] of [['receiver', params.receiver], ['owner', params.owner]] as const) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        throw new Error(`FIRELIGHT_BAD_${label.toUpperCase()}: not an EVM address`);
      }
    }

    const { ethers } = await import('ethers');
    const vault = new ethers.Interface(STXRP_REDEEM_ABI);
    return [
      {
        to: stXrp,
        calldata: vault.encodeFunctionData('redeem', [params.sharesUBA, params.receiver, params.owner]),
        value: '0',
      },
    ];
  }
}

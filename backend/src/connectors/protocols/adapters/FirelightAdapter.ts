import { BaseAdapter } from './BaseAdapter';
import { getProtocolAddresses } from '../../../config/protocolAddresses';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';
import type { EncodedAction, PositionDiscovery, UnreadableRead } from '../IProtocolAdapter';

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

/**
 * «No pude leer la cola de salida» — it. 29. Lo lanza `readPendingWithdrawals`
 * cuando UNA lectura `withdrawalsOf(period, wallet)` del barrido no contesta.
 * Antes ese periodo se leia como `0n` y la salida en cola — participaciones YA
 * QUEMADAS, FXRP esperando — desaparecia del panel con su boton Claim (el
 * incidente del fundador del 9-sep, que UpshiftVaultAdapter.discoverPositions
 * ya arreglo dejando subir el error). Las rutas lo traducen a un 502
 * retryable que dice «no pude mirar», nunca a una lista vacia.
 */
export class VaultQueueUnreadableError extends Error {
  /** The period whose `withdrawalsOf` did not answer — `null` when the anchor
   *  read (`currentPeriod()`) itself failed and no period could be framed. */
  readonly period: number | null;
  /** The read that did not answer, named — `withdrawalsOf(17)` / `currentPeriod()`. */
  readonly what: string;
  constructor(period: number | null, cause?: unknown) {
    const why = cause instanceof Error ? ` (${cause.message})` : '';
    const what = period == null ? 'currentPeriod()' : `withdrawalsOf(${period})`;
    super(`VAULT_QUEUE_UNREADABLE: ${what} did not answer${why}`);
    this.name = 'VaultQueueUnreadableError';
    this.period = period;
    this.what = what;
  }
}

/**
 * it. 31 — what `readPendingWithdrawals` answers. `unreadablePeriods` are the
 * periods of the sweep whose `withdrawalsOf` did NOT answer: they are neither
 * empty nor pending, they are unread. `scannedPeriods` is the whole frame, so a
 * caller can tell «one of 62 failed» from «every one failed».
 */
export interface FirelightPendingWithdrawals {
  currentPeriod: number;
  currentPeriodEnd: string | null;
  pending: FirelightPendingWithdrawal[];
  unreadablePeriods: number[];
  scannedPeriods: number[];
}

/**
 * How far `readPendingWithdrawals` looks: a lookback (periods below the current
 * one) for the sweep, or ONE period — the claim's own read (it. 31).
 */
export type FirelightQueueScope = number | { period: number };

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

  /**
   * All-or-nothing entry (legacy callers). An unread queue period still takes
   * this answer down as a throw — it. 31's semantics, unchanged: a list with a
   * silent hole is never returned. The board and the portfolio engine read
   * `discoverPositionsPartial` and get the rows that WERE read plus the name of
   * the period that was not.
   */
  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { positions, unreadable } = await this.discoverPositionsPartial(wallet);
    if (unreadable.length > 0) {
      // Same sentence as it. 29/31 so the engine log and the routes keep reading it.
      throw new Error(
        `FIRELIGHT_QUEUE_UNREADABLE: withdrawal queue did not answer (${unreadable.map((u) => `${u.what} did not answer`).join('; ')})`,
      );
    }
    return positions;
  }

  /**
   * Ola 0 (15-sep) — the STAKE row and every CLAIM period that answered are
   * served; a period whose `withdrawalsOf` did not answer is NAMED in
   * `unreadable` instead of taking the adapter (and the carry's other rows)
   * off the board. it. 31 had made the SIDEBAR survive one unread period; the
   * board still lost the whole protocol on it.
   */
  async discoverPositionsPartial(wallet: string): Promise<PositionDiscovery> {
    const unreadable: UnreadableRead[] = [];
    if (!this.isActive) return { positions: [], unreadable };
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const stXRP = new ethers.Contract(this.addresses.stXRP!, STXRP_ABI, provider);
    const staking = new ethers.Contract(this.addresses.staking!, STAKING_ABI, provider);
    // `balanceOf` is the anchor of the STAKE row: without it nothing here can
    // be framed, so it still rises as a whole-adapter failure.
    const [stakedBalance, pending] = await Promise.all([
      stXRP.balanceOf(wallet),
      staking.pendingRewards(wallet).catch(() => 0n),
    ]);
    const positions: RawPosition[] = [];
    const now = new Date();

    if (stakedBalance > 0n) {
      // Underlying FXRP via the vault's own conversion (ERC-4626) — live data.
      //
      // it. 31 — this read only PRICES the row (the shares are the money and
      // were read above), so a failure keeps the position and marks the
      // amount unread (`underlyingUnreadable`) instead of a silent `0n` that
      // rendered as «underlying: —» indistinguishable from a vault at zero.
      const underlyingRead = await (stXRP.convertToAssets(stakedBalance) as Promise<bigint>).then(
        (v) => ({ ok: true as const, value: BigInt(v) }),
        () => ({ ok: false as const }),
      );
      const underlyingFxrpUBA: bigint = underlyingRead.ok ? underlyingRead.value : 0n;
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
          underlyingUnreadable: !underlyingRead.ok,
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
      const { pending: queued, unreadablePeriods } = await this.readPendingWithdrawals(wallet, provider, 8);
      // it. 31 — the sweep no longer throws on one unread period (it marks
      // it); a POSITION cannot be emitted for a period nobody read. Ola 0 —
      // that period is NAMED here and the rest of this adapter is served;
      // `discoverPositions` (all-or-nothing) still turns it into the throw.
      for (const period of unreadablePeriods) {
        const e = new VaultQueueUnreadableError(period);
        unreadable.push({ what: e.what, reason: 'did not answer', market: this.addresses.stXRP! });
      }
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
    } catch (e) {
      // it. 29 — this catch used to swallow the queue: with balanceOf at 0
      // after the redeem and the queue unread, the snapshot simply had no
      // Firelight position at all, and the engine cached that absence. Same
      // rule as UpshiftVaultAdapter: the error rises, the engine drops this
      // adapter from THIS sweep (PortfolioEngine `dropped`, never fossilised).
      // Money in flight never disappears in silence. (Only the ANCHOR —
      // `currentPeriod()` — lands here now: no period can be framed without it.)
      throw new Error(`FIRELIGHT_QUEUE_UNREADABLE: withdrawal queue did not answer (${(e as Error).message})`);
    }

    return { positions, unreadable };
  }

  /**
   * Unclaimed withdrawal-queue entries of `wallet`, newest period first.
   * `scope` is a lookback that bounds the probe (periods are ~1 day; queued
   * exits are claimed in days, not months) or `{ period }` for ONE period — a
   * claim reads only its own slot. `provider` lets route callers reuse their
   * own JsonRpcProvider (the FlareProvider singleton needs initialize()).
   *
   * Throws `VaultQueueUnreadableError` ONLY when `currentPeriod()` (the anchor)
   * does not answer. A period whose `withdrawalsOf` fails is reported in
   * `unreadablePeriods`, never as `0n` and never as the whole sweep failing.
   */
  async readPendingWithdrawals(
    wallet: string,
    provider?: import('ethers').Provider,
    scope: FirelightQueueScope = 30,
  ): Promise<FirelightPendingWithdrawals> {
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
    // The anchor: without `currentPeriod()` no period can be framed and no
    // claimability decided — the ONE read that still takes the queue down,
    // typed, so the routes say «we could not look» and never «nothing here».
    const [curRaw, endRaw, nextEndRaw] = await Promise.all([
      (v.currentPeriod() as Promise<bigint>).catch((e: unknown) => {
        throw new VaultQueueUnreadableError(null, e);
      }),
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
    // it. 31 — ONE period when the caller is a claim: `claimWithdraw(N)` needs
    // `withdrawalsOf(N)` and nothing else; the 62-period sweep is disclosure,
    // never a requirement for releasing money already burned out of shares.
    const range: number[] = [];
    if (typeof scope === 'number') {
      const from = Math.max(0, currentPeriod - scope);
      for (let p = currentPeriod + 1; p >= from; p--) range.push(p);
    } else {
      range.push(scope.period);
    }
    // Cheap first pass (1 read per period), details only for the hits.
    //
    // it. 29 — A PERIOD WE COULD NOT READ IS NOT AN EMPTY PERIOD. One 429 in
    // the right slot of these 62 reads used to turn a queued exit — shares
    // already burned, FXRP waiting — into `0n`, and the row and its Claim
    // button vanished from the panel.
    //
    // it. 31 — AND ONE UNREAD PERIOD IS NOT 62 UNREAD PERIODS. The it. 29 fix
    // threw on the first failure inside this Promise.all, so a single 429 —
    // the routine answer of the public gateway to 62 parallel eth_calls from
    // one egress IP — took the whole sweep down, and with it every period that
    // HAD answered. The unread slot is now MARKED (`unreadablePeriods`) and the
    // rest is served; the callers decide what an unread slot means for them.
    const reads = await Promise.all(
      range.map((p) =>
        (v.withdrawalsOf(p, wallet) as Promise<bigint>).then(
          (a) => ({ ok: true as const, assets: BigInt(a) }),
          () => ({ ok: false as const }),
        ),
      ),
    );
    const unreadablePeriods: number[] = [];
    const pending: FirelightPendingWithdrawal[] = [];
    for (let i = 0; i < range.length; i++) {
      const period = range[i];
      const read = reads[i];
      if (!read.ok) {
        unreadablePeriods.push(period);
        continue;
      }
      // withdrawalsOf returns ASSETS (FXRP) already — see the interface note.
      const assets = read.assets;
      if (assets <= 0n) continue;
      // `isWithdrawClaimed` keeps its fallback ON PURPOSE (it. 29): a read
      // that fails here errs toward SHOWING the money (a Claim that may
      // revert), never toward hiding it — the opposite direction from the
      // `withdrawalsOf` fallback above, which is why that one had to go.
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
    return { currentPeriod, currentPeriodEnd, pending, unreadablePeriods, scannedPeriods: range };
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

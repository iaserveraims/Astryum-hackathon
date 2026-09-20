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

/**
 * Upshift (August Digital) multiAssetVault v2 vaults on Flare — the XRP yield
 * vaults distributed by Flare's wallet partners (Xaman, D'CENT):
 *
 *   earnXRP — "Flare XRP Yield Vault", curated by Clearstar. Fully on-chain.
 *   monarq  — "Monarq XRP Yield Vault" (MXRPY). Off-chain strategies (options,
 *             basis) run by Monarq Asset Management → CeDeFi risk profile.
 *
 * Shape (verified on-chain 2026-07-10 via the vault proxy's implementation ABI):
 *   - the vault proxy is NOT the ERC-20: shares live on a separate LP token
 *     (`lpTokenAddress()`), 6 decimals, same as FXRP;
 *   - `getSharePrice()` returns the FXRP-per-share NAV scaled 1e6;
 *   - `deposit(address token, uint256 amount, address receiver)` — multi-asset
 *     deposit; token MUST be the vault's `asset()` (FXRP) in our flow;
 *   - `sendersWhitelistAddress() == 0x0` on both vaults → deposits are
 *     permissionless (checked 2026-07-10; the route re-checks pause state live);
 *   - withdrawals: `instantRedeem` (fee in bips) or `requestRedeem` + epoch
 *     claim after `lagDuration` seconds.
 *
 * APY is NEVER computed here: the route surfaces the live share price and the
 * Upshift API's historical figure, each labelled with its source (invariant #9).
 */

const LP_TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];
const VAULT_READ_ABI = [
  'function getSharePrice() view returns (uint256)',
  'function getTotalAssets() view returns (uint256)',
  'function depositCap() view returns (uint256)',
  'function depositsPaused() view returns (bool)',
  'function instantRedemptionFee() view returns (uint256)',
  'function lagDuration() view returns (uint256)',
];
const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const VAULT_DEPOSIT_ABI = [
  'function deposit(address token, uint256 amount, address receiver)',
];
// Verified against the vault implementations' VERIFIED SOURCE on Flarescan
// (2026-07-13, impls 0xc689CC…/0x8AA89f…): instantRedeem(shares, receiverAddr)
// burns the LP shares from msg.sender (no approve needed — the vault has burn
// rights on its own LP token) and transfers the reference asset (FXRP) minus
// instantRedemptionFee to the receiver.
const VAULT_REDEEM_ABI = [
  'function instantRedeem(uint256 shares, address receiverAddr)',
];
// The epoch queue, READ-ONLY (added 2026-08-01, ABI verified against the impl
// and probed live): the fee-free `requestRedeem` path parks shares on a future
// calendar day, and until they're claimed the LP balance no longer shows them.
const VAULT_EPOCH_ABI = [
  'function getWithdrawalEpoch() view returns (uint256 year,uint256 month,uint256 day,uint256 claimableEpoch)',
  'function getBurnableAmountByReceiver(uint256 year,uint256 month,uint256 day,address receiverAddr) view returns (uint256)',
];

export interface UpshiftPendingRedemption {
  /** The request's epoch day, ISO (YYYY-MM-DD) — the key `claim` takes. */
  epochLabel: string;
  /** LP shares waiting on that epoch (6 dec). */
  sharesBase: string;
  /** FXRP those shares are worth at the live NAV; null if unreadable. */
  estFxrpBase: string | null;
  /** it. 29 — true = `getSharePrice()` did not answer: the amount is UNREAD, not zero. */
  estFxrpUnreadable: boolean;
  /** true once the vault is serving that epoch (or an earlier one). */
  claimable: boolean;
  /** ISO midnight UTC of the epoch day. */
  availableAt: string;
}

/** 1e6 — FXRP/LP tokens and getSharePrice() all use 6 decimals. */
const SHARE_PRICE_SCALE = 1_000_000n;

export type UpshiftVaultKey = 'earnxrp' | 'monarq';

export interface UpshiftVaultDescriptor {
  key: UpshiftVaultKey;
  vault: string;
  lpToken: string;
  name: string;
  /** LP-token ticker shown in portfolio surfaces (earnXRP, MXRPY). */
  symbol: string;
  /** 'onchain' = strategies verifiable on-chain; 'cedefi' = off-chain manager. */
  riskProfile: 'onchain' | 'cedefi';
}

export class UpshiftVaultAdapter extends BaseAdapter {
  readonly protocolId = 'upshift';
  readonly chainId = 14;

  private get addresses() {
    return getProtocolAddresses().upshift;
  }

  /** Vaults whose vault+lpToken envs are both configured. */
  getVaultDescriptors(): UpshiftVaultDescriptor[] {
    const a = this.addresses;
    const out: UpshiftVaultDescriptor[] = [];
    if (a.earnXrpVault && a.earnXrpToken) {
      out.push({
        key: 'earnxrp',
        vault: a.earnXrpVault,
        lpToken: a.earnXrpToken,
        name: 'Flare XRP Yield Vault (earnXRP, curated by Clearstar)',
        symbol: 'earnXRP',
        riskProfile: 'onchain',
      });
    }
    if (a.monarqVault && a.monarqToken) {
      out.push({
        key: 'monarq',
        vault: a.monarqVault,
        lpToken: a.monarqToken,
        name: 'Monarq XRP Yield Vault (MXRPY)',
        symbol: 'MXRPY',
        riskProfile: 'cedefi',
      });
    }
    return out;
  }

  getVaultDescriptor(key: UpshiftVaultKey): UpshiftVaultDescriptor | undefined {
    return this.getVaultDescriptors().find((d) => d.key === key);
  }

  override get isActive(): boolean {
    return this.getVaultDescriptors().length > 0;
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    if (!this.isActive) return [];
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();
    const now = new Date();
    const positions: RawPosition[] = [];

    for (const d of this.getVaultDescriptors()) {
      const lp = new ethers.Contract(d.lpToken, LP_TOKEN_ABI, provider);
      // UN ERROR DE LECTURA NO ES SALDO CERO (fundador 2026-09-09: «he hecho
      // la operación y no se muestra»). Esto tragaba cualquier fallo del RPC
      // —los 429 del nodo público son el pan de estos días— como `0n`, y la
      // posición desaparecía del snapshot SIN señal de degradación… y ese
      // snapshot se cacheaba cinco minutos. Ahora el error sube: el engine
      // deja el adapter fuera de ESE barrido (lo dice en el log) y no
      // fosiliza la ausencia en caché. El precio sí puede faltar: una
      // posición sin NAV se declara con underlying null, no se esconde.
      const balance: bigint = await lp.balanceOf(wallet);
      if (balance <= 0n) continue;

      // NAV per share, live from the vault (protocol data — invariant #9).
      // it. 31 — a failed price read keeps the row (the shares ARE the money)
      // and says the amount is unread, instead of a silent `0n` → null.
      const vault = new ethers.Contract(d.vault, VAULT_READ_ABI, provider);
      const sharePriceRead = await (vault.getSharePrice() as Promise<bigint>).then(
        (v) => ({ ok: true as const, value: BigInt(v) }),
        () => ({ ok: false as const }),
      );
      const sharePriceE6: bigint = sharePriceRead.ok ? sharePriceRead.value : 0n;
      const underlyingFxrpUBA =
        sharePriceE6 > 0n ? (balance * sharePriceE6) / SHARE_PRICE_SCALE : null;

      positions.push({
        protocolId: this.protocolId,
        chainId: this.chainId,
        wallet,
        kind: 'SUPPLY',
        asset: d.lpToken,
        amount: balance,
        raw: {
          vaultKey: d.key,
          vault: d.vault,
          vaultName: d.name,
          riskProfile: d.riskProfile,
          token: d.symbol,
          decimals: 6, // LP shares mirror FXRP's 6 decimals (see header)
          sharePriceE6: sharePriceE6.toString(),
          underlyingFxrpUBA: underlyingFxrpUBA?.toString() ?? null,
          ...(underlyingFxrpUBA && underlyingFxrpUBA > 0n
            ? { underlying: { symbol: 'XRP', amount: underlyingFxrpUBA.toString(), decimals: 6 } }
            : {}),
          underlyingUnreadable: !sharePriceRead.ok,
          sharePriceSource: 'vault.getSharePrice() (live on-chain)',
        },
        discoveredAt: now,
      });
    }

    // Epoch withdrawals: `requestRedeem` takes the shares NOW and the vault
    // releases the FXRP on a later daily epoch, so `lpToken.balanceOf` alone
    // loses the money in between (the same hole Firelight and Sceptre had).
    // A user who queued the exit from Upshift's own app — Astryum only builds
    // instantRedeem today — saw the position simply disappear.
    for (const d of this.getVaultDescriptors()) {
      try {
        for (const q of await this.readPendingRedemptions(wallet, d, provider)) {
          positions.push({
            protocolId: this.protocolId,
            chainId: this.chainId,
            wallet,
            kind: 'CLAIM',
            asset: d.lpToken,
            amount: BigInt(q.sharesBase),
            raw: {
              kind: 'claim',
              vaultKey: d.key,
              vault: d.vault,
              vaultName: `${d.name} — salida en cola (epoch ${q.epochLabel})`,
              token: d.symbol,
              decimals: 6,
              ...(q.estFxrpBase
                ? { underlying: { symbol: 'XRP', amount: q.estFxrpBase, decimals: 6 } }
                : {}),
              // it. 29 — the amount is UNREAD, not absent: the row stays, and
              // carries the admission for whoever renders it.
              estFxrpUnreadable: q.estFxrpUnreadable,
              exiting: true,
              claimable: q.claimable,
              availableAt: q.availableAt,
              expiresAt: null, // Upshift claims don't expire
              // The vault burns the shares at `claim`, not at `requestRedeem`,
              // and the NAV keeps moving until then — but Upshift publishes no
              // per-request rate lock we can read, so we claim nothing about
              // yield: the honest reading is "leaving, lands on this date".
              stillEarning: false,
              upshiftClaim: {
                vaultKey: d.key,
                epoch: q.epochLabel,
                claimable: q.claimable,
                availableAt: q.availableAt,
              },
              sharePriceSource: 'vault.getBurnableAmountByReceiver()+getSharePrice() (live on-chain)',
            },
            discoveredAt: now,
          });
        }
      } catch (e) {
        // it. 29 — this catch used to swallow the queue: a 429 on the epoch or
        // lag read left the LP balance in the snapshot and the queued exit
        // OUT of it, and the engine cached that absence for five minutes.
        // Same rule as the balance read above: the error rises, the engine
        // drops this adapter from THIS sweep (and says so), nothing is
        // fossilised. Money in flight never disappears in silence.
        throw new Error(
          `UPSHIFT_QUEUE_UNREADABLE: ${d.name} pending redemptions did not answer (${(e as Error).message})`,
        );
      }
    }

    return positions;
  }

  /**
   * Open epoch-withdrawal requests for `wallet` in one vault.
   *
   * Shape verified against the vault implementation ABI (proxy
   * 0x373D7d20… → impl 0xc689cC64…) and probed live on Flare mainnet
   * 2026-08-01: requests are indexed by CALENDAR DAY (year, month, day) and
   * `getBurnableAmountByReceiver(y, m, d, receiver)` returns the shares waiting
   * on that day. `getWithdrawalEpoch()` gives the day currently being served,
   * `lagDuration()` how far ahead a fresh request is scheduled (earnXRP 1 day,
   * Monarq 7). We probe that window plus a short tail for anything not yet
   * claimed — no event indexing, no third party.
   */
  async readPendingRedemptions(
    wallet: string,
    d: UpshiftVaultDescriptor,
    provider?: import('ethers').Provider,
  ): Promise<UpshiftPendingRedemption[]> {
    const { ethers } = await import('ethers');
    const vault = new ethers.Contract(
      d.vault,
      [...VAULT_READ_ABI, ...VAULT_EPOCH_ABI],
      provider ?? this.provider.getHttpProvider(),
    );
    // it. 29 — `lagDuration().catch(() => 0n)` made `lagDays = 0` and shrank
    // the scan window to -3..+1 days. Monarq's lagDuration is 7 DAYS (probed
    // on-chain), so one failed read hid its queued exit for up to a week. An
    // unread lag now RISES: the caller (discoverPositions) lets it take the
    // adapter out of THAT sweep, as the balance read already does, instead of
    // fossilising an empty queue in the 5-minute cache.
    // `getSharePrice()` only prices the row; a failed read keeps the row and
    // marks the amount unread (`estFxrpUnreadable`) rather than dropping it.
    const [epoch, lagSeconds, sharePriceRead] = await Promise.all([
      vault.getWithdrawalEpoch() as Promise<[bigint, bigint, bigint, bigint]>,
      vault.lagDuration() as Promise<bigint>,
      (vault.getSharePrice() as Promise<bigint>).then(
        (v) => ({ ok: true as const, value: BigInt(v) }),
        () => ({ ok: false as const }),
      ),
    ]);
    const sharePriceE6 = sharePriceRead.ok ? sharePriceRead.value : 0n;

    const servedUTC = Date.UTC(Number(epoch[0]), Number(epoch[1]) - 1, Number(epoch[2]));
    if (!Number.isFinite(servedUTC)) return [];
    const lagDays = Math.ceil(Number(lagSeconds) / 86_400);
    // From a few days BEHIND the served epoch (unclaimed leftovers) through the
    // furthest day a request made today can be scheduled for.
    const TRAILING_DAYS = 3;
    const days: Date[] = [];
    for (let offset = -TRAILING_DAYS; offset <= lagDays + 1; offset++) {
      days.push(new Date(servedUTC + offset * 86_400_000));
    }

    // it. 31 — the same `.catch(() => 0n)` that it. 29 removed from
    // `lagDuration` in this very function was still here, on the read that
    // holds the MONEY: a 429 on one day's `getBurnableAmountByReceiver` read
    // as «nothing queued that day», and the queued exit vanished from the
    // snapshot in silence. An unread day now RISES like the lag does; the
    // caller (discoverPositions) turns it into UPSHIFT_QUEUE_UNREADABLE, the
    // engine drops this adapter from THIS sweep and names it to the person.
    const shares = await Promise.all(
      days.map(
        (day) =>
          vault.getBurnableAmountByReceiver(
            day.getUTCFullYear(),
            day.getUTCMonth() + 1,
            day.getUTCDate(),
            wallet,
          ) as Promise<bigint>,
      ),
    );

    const out: UpshiftPendingRedemption[] = [];
    for (let i = 0; i < days.length; i++) {
      const amount = BigInt(shares[i]);
      if (amount <= 0n) continue;
      const day = days[i];
      const dayUTC = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      out.push({
        epochLabel: day.toISOString().slice(0, 10),
        sharesBase: amount.toString(),
        estFxrpBase:
          sharePriceE6 > 0n ? ((amount * sharePriceE6) / SHARE_PRICE_SCALE).toString() : null,
        estFxrpUnreadable: !sharePriceRead.ok,
        // The vault serves `servedUTC`; anything up to and including it is
        // claimable now, later days are still waiting their turn.
        claimable: dayUTC <= servedUTC,
        availableAt: new Date(dayUTC).toISOString(),
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
   * V1 simulation for FXRP vault deposits/withdrawals.
   *  - supply   → user provides FXRP, receives LP shares. netUSD = -amountUSD.
   *  - withdraw → instantRedeem path; fee (bips) disclosed as a warning.
   *
   * Inputs (action.inputs):
   *   amount: bigint (6-dec FXRP/share base units)
   *   priceUSD: number (XRP/USD via FTSO)
   *   instantRedemptionFeeBps?: number (live read, passed by the caller)
   *   flrPriceUSD?: number (gas)
   *
   * it. 27 — AN ABSENT FEE IS NOT A FEE OF ZERO. `?? 0` read «the caller did
   * not pass it» as «this vault charges nothing», and then `if (fee > 0)`
   * DELETED the warning that exists to show it: the one input that could not
   * be read was also the one the simulation stopped mentioning. Both states
   * are now said out loud (invariant #6).
   */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    this.assertActive();
    const now = new Date();
    const warnings: string[] = [];

    const amount = (action.inputs?.amount as bigint | undefined) ?? 0n;
    const decimals = Number(action.inputs?.decimals ?? 6);
    const priceUSD = Number(action.inputs?.priceUSD ?? 0);
    const human = Number(amount) / 10 ** decimals;
    const amountUSD = priceUSD * human;
    // null = the caller did not pass a fee, i.e. NOBODY READ IT. Never folded
    // into 0 (it. 27).
    const feeBpsRaw = action.inputs?.instantRedemptionFeeBps;
    const feeBps =
      feeBpsRaw != null && Number.isFinite(Number(feeBpsRaw)) ? Number(feeBpsRaw) : null;
    const flrPriceUSD = Number(action.inputs?.flrPriceUSD ?? 0.02);

    let netUSDImpact = 0;
    let riskDelta = 0;

    switch (action.kind) {
      case 'supply':
        netUSDImpact = -amountUSD;
        riskDelta = -1;
        if (amountUSD <= 0) warnings.push('Deposit amount must be > 0');
        break;
      case 'withdraw': {
        riskDelta = 1;
        if (feeBps == null) {
          // The figure below is the GROSS, and it is labelled as such instead
          // of being quietly netted with a fee of zero.
          netUSDImpact = amountUSD;
          warnings.push(
            'Instant redemption fee UNKNOWN — this vault charges one in bips and it was not read, so this figure is the GROSS and not what you would receive. Do not sign against it.',
          );
        } else {
          const fee = (amountUSD * feeBps) / 10_000;
          netUSDImpact = amountUSD - fee;
          // Said even at zero: a silent fee row reads as «free», and here that
          // silence used to cover the unread case too.
          warnings.push(
            fee > 0
              ? `Instant redemption fee: $${fee.toFixed(2)} (${feeBps} bps)`
              : `Instant redemption fee: none (${feeBps} bps)`,
          );
        }
        warnings.push('Fee-free withdrawal uses requestRedeem + epoch claim (lagDuration applies)');
        break;
      }
      default:
        warnings.push(`Action ${action.kind} not natively modeled by Upshift adapter`);
    }

    const gasEstimate = 350_000n;
    const gasPriceGwei = 25;
    const gasEstimateUSD = Number(gasEstimate) * gasPriceGwei * 1e-9 * flrPriceUSD;

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
   * Deposit batch for the `0xFE` Personal Account userOp (the E3-style rail):
   *   [ approve(FXRP → vault, supplyUBA),
   *     vault.deposit(FXRP, supplyUBA, receiver) ]
   *
   * `receiver` MUST be the Personal Account (the userOp sender) so the LP
   * shares land where the user's smart account holds them. The deposit token is
   * the vault's on-chain `asset()` (FXRP) — never guessed (invariant #3).
   * Returns unsigned EncodedAction[]; Astryum signs nothing. Throws (never
   * guesses) when a vault / token is unconfigured.
   */
  async buildDepositBatch(params: {
    vaultKey: UpshiftVaultKey;
    supplyUBA: bigint;
    receiver: string;
  }): Promise<EncodedAction[]> {
    const d = this.getVaultDescriptor(params.vaultKey);
    const fxrpToken = getProtocolAddresses().fxrp.token;
    const missing: string[] = [];
    if (!d) missing.push(`UPSHIFT_${params.vaultKey.toUpperCase()}_VAULT/_TOKEN`);
    if (!fxrpToken) missing.push('FXRP_TOKEN');
    if (missing.length) {
      throw new Error(`UPSHIFT_NOT_CONFIGURED: missing ${missing.join(', ')}`);
    }
    if (params.supplyUBA <= 0n) throw new Error('UPSHIFT_BAD_DEPOSIT: must be > 0');
    if (!/^0x[a-fA-F0-9]{40}$/.test(params.receiver)) {
      throw new Error('UPSHIFT_BAD_RECEIVER: not an EVM address');
    }

    const { ethers } = await import('ethers');
    const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
    const vault = new ethers.Interface(VAULT_DEPOSIT_ABI);
    return [
      {
        to: fxrpToken!, // approve the vault to pull the deposited FXRP
        calldata: erc20.encodeFunctionData('approve', [d!.vault, params.supplyUBA]),
        value: '0',
      },
      {
        to: d!.vault, // multi-asset deposit — token = FXRP, shares → receiver (the PA)
        calldata: vault.encodeFunctionData('deposit', [fxrpToken!, params.supplyUBA, params.receiver]),
        value: '0',
      },
    ];
  }

  /**
   * Instant-redemption call: burns `sharesUBA` LP shares from the CALLER
   * (the wallet or Personal Account that signs/executes the call) and sends
   * the FXRP minus the instant fee (bips, read live and disclosed by the
   * route) to `receiver`. Single call, no approve (see VAULT_REDEEM_ABI note).
   * The fee-free requestRedeem+epoch-claim path is roadmap. Returns unsigned
   * EncodedAction[]; Astryum signs nothing.
   */
  async buildInstantRedeemBatch(params: {
    vaultKey: UpshiftVaultKey;
    sharesUBA: bigint;
    receiver: string;
  }): Promise<EncodedAction[]> {
    const d = this.getVaultDescriptor(params.vaultKey);
    if (!d) {
      throw new Error(`UPSHIFT_NOT_CONFIGURED: missing UPSHIFT_${params.vaultKey.toUpperCase()}_VAULT/_TOKEN`);
    }
    if (params.sharesUBA <= 0n) throw new Error('UPSHIFT_BAD_REDEEM: shares must be > 0');
    if (!/^0x[a-fA-F0-9]{40}$/.test(params.receiver)) {
      throw new Error('UPSHIFT_BAD_RECEIVER: not an EVM address');
    }

    const { ethers } = await import('ethers');
    const vault = new ethers.Interface(VAULT_REDEEM_ABI);
    return [
      {
        to: d.vault,
        calldata: vault.encodeFunctionData('instantRedeem', [params.sharesUBA, params.receiver]),
        value: '0',
      },
    ];
  }
}

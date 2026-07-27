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
      const balance: bigint = await lp.balanceOf(wallet).catch(() => 0n);
      if (balance <= 0n) continue;

      // NAV per share, live from the vault (protocol data — invariant #9).
      const vault = new ethers.Contract(d.vault, VAULT_READ_ABI, provider);
      const sharePriceE6: bigint = await vault.getSharePrice().catch(() => 0n);
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
          sharePriceSource: 'vault.getSharePrice() (live on-chain)',
        },
        discoveredAt: now,
      });
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
   * V1 simulation for FXRP vault deposits/withdrawals.
   *  - supply   → user provides FXRP, receives LP shares. netUSD = -amountUSD.
   *  - withdraw → instantRedeem path; fee (bips) disclosed as a warning.
   *
   * Inputs (action.inputs):
   *   amount: bigint (6-dec FXRP/share base units)
   *   priceUSD: number (XRP/USD via FTSO)
   *   instantRedemptionFeeBps?: number (live read, passed by the caller)
   *   flrPriceUSD?: number (gas)
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
    const feeBps = Number(action.inputs?.instantRedemptionFeeBps ?? 0);
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
        const fee = (amountUSD * feeBps) / 10_000;
        netUSDImpact = amountUSD - fee;
        riskDelta = 1;
        if (fee > 0) warnings.push(`Instant redemption fee: $${fee.toFixed(2)} (${feeBps} bps)`);
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

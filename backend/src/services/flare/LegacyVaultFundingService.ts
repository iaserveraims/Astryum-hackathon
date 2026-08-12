/**
 * LegacyVaultFundingService — the governed way capital ENTERS the cage.
 *
 * Until now nothing could put principal in under council control. `directTo`
 * only directs what is already inside, and the one deposit path composed bare
 * EOA calls (`LegacyVaultStateService.buildVaultDepositCalls`) that a multisig
 * XRPL account can never sign — a council has no EVM key.
 *
 * This closes it with the SAME machinery as the mint and as B3's feeding hop:
 * one XRPL Payment carries a memo committing a userOp; the executor mints the
 * FXRP into the council's Personal Account and then runs the committed batch.
 * The batch here is `approve(vault, amount)` + `LegacyVault.deposit(amount)` —
 * the `deposit(uint256)` shape that NO existing batch builds (the CLI emits
 * FAssets/ERC-4626's `deposit(uint256,address)`, a different function).
 *
 * The result: XRP leaves the council on ONE quorum signature, and lands as
 * `totalPrincipal` inside the cage. From there `directTo` finally has something
 * to direct — which is a SECOND quorum order, deliberately (see the UI copy).
 *
 * Custody line unchanged: Astryum composes, the quorum signs, the executor
 * relays bytes it cannot alter (invariant #1/#8). The executor never holds the
 * council's capital — the mint delivers straight to the council's own PA.
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';

/** The two calls, in order. `deposit` pulls via transferFrom, so approve first. */
const FXRP_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
/** LegacyVault's own deposit — NOT ERC-4626's `deposit(uint256,address)`. */
const LEGACY_VAULT_DEPOSIT_ABI = ['function deposit(uint256 amount)'];

export interface VaultFundingBatchInput {
  /** The FXRP ERC-20 the mint delivers (must be the vault's asset). */
  fxrpToken: string;
  /** LegacyVault address. */
  vault: string;
  /** Exactly `net.supplyUBA` from the mint — what actually arrives in the PA. */
  supplyUBA: bigint;
}

/**
 * The inner batch the PA runs after the mint lands.
 *
 * `supplyUBA` must be the mint's post-fee, post-buffer figure. Approving or
 * depositing MORE than actually arrives makes the whole userOp revert on the
 * transferFrom, after the XRP is already spent — the batch is committed in the
 * memo before anyone signs, so it cannot be corrected afterwards.
 */
export function buildVaultFundingBatch(input: VaultFundingBatchInput): EncodedAction[] {
  const { fxrpToken, vault, supplyUBA } = input;
  if (supplyUBA <= 0n) throw new Error('VAULT_FUNDING_BAD_AMOUNT: supplyUBA must be > 0');
  if (!ethers.isAddress(fxrpToken)) throw new Error('VAULT_FUNDING_BAD_TOKEN: fxrpToken is not an address');
  if (!ethers.isAddress(vault)) throw new Error('VAULT_FUNDING_BAD_VAULT: vault is not an address');
  if (fxrpToken.toLowerCase() === vault.toLowerCase()) {
    throw new Error('VAULT_FUNDING_BAD_VAULT: the vault cannot be the asset itself');
  }

  const erc20 = new ethers.Interface(FXRP_APPROVE_ABI);
  const legacyVault = new ethers.Interface(LEGACY_VAULT_DEPOSIT_ABI);

  return [
    {
      to: ethers.getAddress(fxrpToken),
      calldata: erc20.encodeFunctionData('approve', [ethers.getAddress(vault), supplyUBA]),
      value: '0',
    },
    {
      to: ethers.getAddress(vault),
      calldata: legacyVault.encodeFunctionData('deposit', [supplyUBA]),
      value: '0',
    },
  ];
}

/**
 * The smallest funding that actually puts principal in the cage.
 *
 * The mint takes its fees off the TOP: gross − mintingFee − executorFee, then a
 * safety buffer, then a floor to granularity. Below roughly (minFee + execFee)
 * nothing survives, and `computeNetMint` throws DIRECT_MINT_INSUFFICIENT — after
 * the person has already typed an amount and reached for their key.
 *
 * Returning the real floor lets the form say "at least X" up front instead of
 * failing at compose time. Pure: takes the params already read from the chain.
 */
export function minimumViableGrossUBA(
  params: { minFeeUBA: bigint; feeBIPS: bigint; executorFeeUBA: bigint; granularityUBA: bigint },
  bufferBips: bigint = 10n,
): bigint {
  const fees = params.minFeeUBA + params.executorFeeUBA;
  const step = params.granularityUBA > 0n ? params.granularityUBA : 1n;
  // One granularity step of principal must SURVIVE the buffer. The buffer is
  // integer arithmetic, so on small amounts it rounds to zero and a bare step
  // is already enough — padding "just in case" would push the floor above the
  // true one and reject amounts that work.
  const bufferOnStep = (step * bufferBips) / (10_000n - bufferBips);
  const needed = fees + step + bufferOnStep;
  const rem = needed % step;
  return rem === 0n ? needed : needed + (step - rem);
}

/**
 * Guard: the mint delivers FXRP, and the vault pulls ITS OWN asset. If those
 * ever differ the deposit reverts after the XRP is spent and the FXRP is
 * already minted — stranded in the PA, needing a separate rescue.
 */
export function assertFundingAssetMatches(vaultAsset: string, mintedToken: string): void {
  if (vaultAsset.toLowerCase() !== mintedToken.toLowerCase()) {
    throw new Error(
      `VAULT_FUNDING_ASSET_MISMATCH: the vault holds ${vaultAsset} but the mint delivers ${mintedToken} — ` +
        'the deposit would revert with the XRP already spent',
    );
  }
}

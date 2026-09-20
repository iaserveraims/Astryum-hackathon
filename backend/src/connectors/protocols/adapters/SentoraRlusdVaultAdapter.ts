/**
 * SentoraRlusdVaultAdapter — pure calldata builder for the lend-only leg of W3
 * (plan §13: la card «lend-only» de Earn): RLUSD into the Sentora RLUSD Main
 * vault (`senRLUSDv2`, Morpho Vault V2) on Ethereum mainnet.
 */
import { Interface } from 'ethers';
import { RLUSD_ETH, EvmLeg } from './MorphoBlueEthAdapter';

export const SENTORA_RLUSD_VAULT = '0x6dC58a0FdfC8D694e571DC59B9A52EEEa780E6bf';

const VAULT_ABI = [
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
];
const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

const vaultIface = new Interface(VAULT_ABI);
const erc20Iface = new Interface(ERC20_ABI);

function requirePositive(amount: bigint, label: string): void {
  if (amount <= 0n) throw new Error(`SentoraRlusdVaultAdapter: ${label} must be > 0`);
}

function requireAddress(addr: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`SentoraRlusdVaultAdapter: ${label} is not an address`);
  }
}

/**
 * Lend RLUSD: finite approve (exact amount) + ERC-4626 deposit.
 * `assets` in RLUSD base units (18 decimals — read on-chain by the caller).
 */
export function buildVaultDepositLegs(user: string, assets: bigint): EvmLeg[] {
  requireAddress(user, 'user');
  requirePositive(assets, 'assets');
  return [
    {
      to: RLUSD_ETH,
      data: erc20Iface.encodeFunctionData('approve', [SENTORA_RLUSD_VAULT, assets]),
      value: '0x0',
      description: 'Approve RLUSD to the Sentora vault (exact amount)',
    },
    {
      to: SENTORA_RLUSD_VAULT,
      data: vaultIface.encodeFunctionData('deposit', [assets, user]),
      value: '0x0',
      description: 'Lend RLUSD into the Sentora vault',
    },
  ];
}

/**
 * Withdraw lent RLUSD back to the user, by ASSET amount (the user thinks in
 * RLUSD, not shares — shares live in technical details). Own shares: no approve.
 */
export function buildVaultWithdrawLegs(user: string, assets: bigint): EvmLeg[] {
  requireAddress(user, 'user');
  requirePositive(assets, 'assets');
  return [
    {
      to: SENTORA_RLUSD_VAULT,
      data: vaultIface.encodeFunctionData('withdraw', [assets, user, user]),
      value: '0x0',
      description: 'Withdraw RLUSD from the Sentora vault',
    },
  ];
}

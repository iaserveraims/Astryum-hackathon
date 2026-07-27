import { ethers } from 'ethers';
import { getRpcForChain } from './rpcForChain';

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/**
 * Returns the balance of a wallet for a given asset.
 * - tokenAddress = undefined | null | 'native' → native token balance (FLR, ETH, etc.)
 * - tokenAddress = '0x...' ERC-20 address → balanceOf() call
 *
 * Returns balance as bigint (wei units).
 */
export async function getTokenBalance(
  walletAddress: string,
  tokenAddress: string | undefined | null,
  chainId: number,
): Promise<bigint> {
  const rpc = getRpcForChain(chainId);
  if (!tokenAddress || tokenAddress.toLowerCase() === 'native') {
    return await rpc.getBalance(walletAddress);
  }
  const contract = new ethers.Contract(tokenAddress, ERC20_BALANCE_ABI, rpc);
  return (await contract.balanceOf(walletAddress)) as bigint;
}

/**
 * Resolve an amount from action params.
 * Supports fixed `amount` (wei string) or `amountPct` (0-100 integer percentage of balance).
 */
export async function resolveAmount(
  params: Record<string, unknown>,
  walletAddress: string,
  chainId: number,
): Promise<string> {
  if (params.amount != null) return String(params.amount);

  if (params.amountPct != null) {
    const pct = Math.floor(Number(params.amountPct)); // integer to avoid BigInt float error
    if (pct <= 0 || pct > 100) throw new Error('INVALID_AMOUNT_PCT: must be 1–100');
    const balance = await getTokenBalance(
      walletAddress,
      params.fromToken as string | undefined,
      chainId,
    );
    return ((balance * BigInt(pct)) / 100n).toString();
  }

  throw new Error('AMOUNT_OR_AMOUNT_PCT_REQUIRED');
}

import type { PolicyEvaluable } from './types';

const ERC20_APPROVE_SELECTOR = '0x095ea7b3';
const ERC20_INCREASE_ALLOWANCE_SELECTOR = '0x39509351';
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Decoded ERC-20 approve calldata: `approve(address spender, uint256 amount)`.
 * Returns `null` when the calldata is not an approve call.
 */
export interface DecodedApprove {
  readonly selector: string;
  readonly spender: string;
  readonly amount: bigint;
  readonly isUnbounded: boolean;
}

export function decodeApprove(calldata: string): DecodedApprove | null {
  if (typeof calldata !== 'string' || calldata.length < 138) return null;
  const sel = calldata.slice(0, 10).toLowerCase();
  if (sel !== ERC20_APPROVE_SELECTOR && sel !== ERC20_INCREASE_ALLOWANCE_SELECTOR) {
    return null;
  }
  // The function arg encoding for both signatures is identical: address+uint256.
  const spender = '0x' + calldata.slice(10, 10 + 64).slice(-40);
  const amountHex = calldata.slice(10 + 64, 10 + 128);
  const amount = BigInt('0x' + amountHex);
  const isUnbounded = amount === MAX_UINT256 || amount > MAX_UINT256 / 2n;
  return { selector: sel, spender, amount, isUnbounded };
}

export interface ApproveValidationResult {
  readonly applies: boolean;
  readonly bounded: boolean;
  readonly reason?: string;
  readonly decoded?: DecodedApprove;
}

/**
 * V1.1 P11 — Approve must be bounded unless the user explicitly opts in.
 *
 * Scope today is limited to the txData on the intent itself (no `intent.steps[]`
 * model yet). When the txData IS the approve call, we validate amount.
 * When the txData is the consuming action (supply/borrow/etc) we return
 * `applies=false` and the rule is skipped — bounded enforcement on a
 * preceding approve will land when steps[] exists.
 *
 * Spec: docs/POLICY_GUARD.md §7.
 */
export class ApproveValidator {
  validate(
    intent: PolicyEvaluable,
    opts: { readonly optInUnboundedApproval?: boolean } = {},
  ): ApproveValidationResult {
    if (!intent.txData) return { applies: false, bounded: true };
    const decoded = decodeApprove(intent.txData.data);
    if (!decoded) return { applies: false, bounded: true };
    if (decoded.isUnbounded && !opts.optInUnboundedApproval) {
      return {
        applies: true,
        bounded: false,
        decoded,
        reason: 'unbounded approve requires explicit optInUnboundedApproval',
      };
    }
    return { applies: true, bounded: true, decoded };
  }
}

export const approveValidator = new ApproveValidator();

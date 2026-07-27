import type { Provider } from 'ethers';
import { FLARE_CONTRACT_REGISTRY } from '../../../flare/ftso/constants';
import type { EncodedAction } from '../IProtocolAdapter';

/**
 * Flare Smart Accounts wiring — the bridge that lets an XRPL/Xaman user drive
 * Flare DeFi WITHOUT owning FLR (Demos Mainnet plan §2). Astryum stays
 * prepare-only: it RESOLVES the user's Personal Account, BUILDS the atomic
 * `CustomInstruction[]` batch and the XRPL memo, and exposes the UNSIGNED
 * `registerCustomInstruction(...)` calldata. It never signs, never custodies.
 *
 * Execution model (plan §2.3 path 3 — the FXRP path; registrant = Flare operator,
 * user decision 2026-06-24):
 *   1. Astryum builds the atomic `CustomInstruction[]` batch + the `99 + hash`
 *      memo and the unsigned XRPL Payment (this file). Astryum NEVER signs.
 *   2. The user signs the XRPL Payment to the operator in Xaman — this IS the
 *      authorization (plan §2.5). The full calls travel off-chain to the operator.
 *   3. The Flare OPERATOR registers the instruction (registerCustomInstruction —
 *      gas paid by the operator, not Astryum), gets an FDC proof, and executes
 *      the batch through the user's Personal Account.
 *
 * NOTE (operator dependency): register-on-relay with operator-provided calls is
 * not a published API yet — must be coordinated with Flare. Astryum's side (the
 * unsigned hand-off below) is correct regardless of that coordination.
 *
 * Addresses are resolved by NAME from the FlareContractRegistry (invariant #13 —
 * no hardcoding); the known mainnet address is only a documented fallback.
 */

const REGISTRY_ABI = [
  'function getContractAddressByName(string _name) view returns (address)',
];

// MasterAccountController surface used here. registerCustomInstruction returns the
// call hash; we never send it — we only encode the calldata for the chosen signer.
const MAC_ABI = [
  'function getPersonalAccount(string _xrplAddress) view returns (address)',
  'function getXrplProviderWallets() view returns (string[])',
  'function getNonce(address _personalAccount) view returns (uint256)',
  'function registerCustomInstruction(tuple(address targetContract, uint256 value, bytes data)[] _instructions) returns (bytes32)',
];

/** Registry name for the MasterAccountController. */
const MAC_REGISTRY_NAME = 'MasterAccountController';
/** Documented mainnet fallback (plan §2.1) — used only if the registry lookup is empty. */
const MAC_MAINNET_FALLBACK = '0x434936d47503353f06750Db1A444DBDC5F0AD37c';
/** Custom-instruction memo identifier byte (plan §2.3-3 / FXRP automint guide). */
const CUSTOM_INSTRUCTION_MEMO_ID = '99';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

let cachedMac: string | null = null;

/** One Flare contract call inside an atomic Smart Account batch. */
export interface CustomInstruction {
  targetContract: string;
  value: bigint;
  data: string;
}

export function _resetMacCache(): void {
  cachedMac = null;
}

/** Resolve MasterAccountController by name from the registry (fallback to mainnet const). */
export async function resolveMasterAccountController(
  provider: Provider,
): Promise<string> {
  if (cachedMac) return cachedMac;
  const { ethers } = await import('ethers');
  let addr = '';
  try {
    const registry = new ethers.Contract(
      FLARE_CONTRACT_REGISTRY,
      REGISTRY_ABI,
      provider,
    );
    addr = await registry.getContractAddressByName(MAC_REGISTRY_NAME);
  } catch {
    addr = '';
  }
  if (!addr || addr === ZERO || !ADDRESS_RE.test(addr)) {
    addr = MAC_MAINNET_FALLBACK; // documented fallback; registry is the source of truth
  }
  cachedMac = ethers.getAddress(addr);
  return cachedMac;
}

/**
 * Build an unsigned ERC-20 `transfer(to, amount)` call executed BY the Personal
 * Account (msg.sender = PA). The PA→EVM move that gets borrowed/withdrawn USDT0
 * out of the Personal Account and into the user's EVM wallet so the EVM-direct
 * `repayBorrowBehalf` (Cable 2) has funds to spend. Goes inside a `0xFE` userOp
 * Call[] (arbitrary calls on the PA — confirmed against the smart-accounts docs).
 * Unsigned; Astryum signs nothing.
 */
export async function buildErc20TransferCall(input: {
  token: string;
  to: string;
  amount: bigint;
}): Promise<EncodedAction> {
  if (!ADDRESS_RE.test(input.token)) {
    throw new Error(`ERC20_TRANSFER_BAD_TOKEN: "${input.token}" is not an address`);
  }
  if (!ADDRESS_RE.test(input.to)) {
    throw new Error(`ERC20_TRANSFER_BAD_TO: "${input.to}" is not an address`);
  }
  if (input.amount <= 0n) throw new Error('ERC20_TRANSFER_BAD_AMOUNT: must be > 0');
  const { ethers } = await import('ethers');
  const iface = new ethers.Interface([
    'function transfer(address to, uint256 amount) returns (bool)',
  ]);
  return {
    to: input.token,
    calldata: iface.encodeFunctionData('transfer', [ethers.getAddress(input.to), input.amount]),
    value: '0',
  };
}

/** Map adapter-produced unsigned calls to Smart Account CustomInstruction[]. 1:1. */
export function buildCustomInstructions(
  actions: EncodedAction[],
): CustomInstruction[] {
  if (!actions.length) {
    throw new Error('SMART_ACCOUNT_EMPTY_BATCH: at least one call required');
  }
  return actions.map((a) => {
    if (!ADDRESS_RE.test(a.to)) {
      throw new Error(`SMART_ACCOUNT_BAD_TARGET: "${a.to}" is not an address`);
    }
    if (!/^0x[0-9a-fA-F]*$/.test(a.calldata)) {
      throw new Error('SMART_ACCOUNT_BAD_CALLDATA: must be 0x-hex');
    }
    return {
      targetContract: a.to,
      value: BigInt(a.value || '0'),
      data: a.calldata,
    };
  });
}

/**
 * ⚠️ RESERVED for the `0x99` registered-instruction path (register-then-reference).
 * This is NOT used for E1 (FXRP entry): E1 mints fresh FXRP from XRP and uses the
 * `0xFE` userOp + FAssets direct-minting path, where the operator/executor pays gas
 * and Astryum stays fully prepare-only (user decision 2026-06-24, after confirming
 * the operator cannot register on relay). The `0x99` path requires a pre-registration
 * tx with FLR gas, which has no clean non-custodial signer — so it is parked here,
 * kept (not deleted) because it is the likely fit for ACTIONS ON AN EXISTING POSITION
 * that don't go through direct-minting (e.g. A1 repay, re-supply). See plan §2.3.
 *
 * Compute the 32-byte XRPL payment memo for a registered custom instruction:
 *   memo = 0x99 ++ (keccak256(abi.encode(CustomInstruction[])) >> 8)
 * i.e. the `99` identifier byte followed by the top 31 bytes of the call hash.
 * Matches MasterAccountController's lookup (FXRP automint guide:
 * `uint256(keccak256(abi.encode(_customInstruction))) >> 8`).
 */
export async function computeCustomInstructionMemo(
  instructions: CustomInstruction[],
): Promise<{ callHash: string; memoHex: string }> {
  const { ethers } = await import('ethers');
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(address targetContract, uint256 value, bytes data)[]'],
    [instructions],
  );
  const callHash = ethers.keccak256(encoded); // 0x + 64 hex (32 bytes)
  // Top 31 bytes = drop the final byte (>> 8). First 62 hex chars after 0x.
  const top31 = callHash.slice(2, 2 + 62);
  const memoHex = CUSTOM_INSTRUCTION_MEMO_ID + top31; // 64 hex chars = 32 bytes
  return { callHash, memoHex };
}

export interface RegisterCalldata {
  /** MasterAccountController (registry-resolved). */
  to: string;
  /** UNSIGNED registerCustomInstruction(...) calldata. */
  calldata: string;
  value: string;
  instructions: CustomInstruction[];
  /** XRPL memo the user must put in the Payment (`99` + hash), uppercase per XRPL. */
  memoHex: string;
  callHash: string;
}

/**
 * ⚠️ RESERVED — `0x99` registered-instruction path (see computeCustomInstructionMemo
 * note). NOT used for E1. Kept for A1/existing-position actions that don't mint.
 *
 * Build the UNSIGNED `registerCustomInstruction([calls])` calldata + the XRPL
 * memo. Astryum never signs it; whoever ends up registering (NOT the operator —
 * the operator cannot register on relay) gets this unsigned tx.
 */
export async function buildRegisterCustomInstruction(
  provider: Provider,
  actions: EncodedAction[],
): Promise<RegisterCalldata> {
  const { ethers } = await import('ethers');
  const instructions = buildCustomInstructions(actions);
  const to = await resolveMasterAccountController(provider);
  const iface = new ethers.Interface(MAC_ABI);
  const calldata = iface.encodeFunctionData('registerCustomInstruction', [
    instructions,
  ]);
  const { callHash, memoHex } = await computeCustomInstructionMemo(instructions);
  return {
    to,
    calldata,
    value: '0',
    instructions,
    memoHex: memoHex.toUpperCase(), // XRPL MemoData is hex, conventionally uppercase
    callHash,
  };
}

/** Resolve the user's deterministic Personal Account on Flare (read-only). */
export async function resolvePersonalAccount(
  provider: Provider,
  xrplAddress: string,
): Promise<string> {
  const { ethers } = await import('ethers');
  const mac = new ethers.Contract(
    await resolveMasterAccountController(provider),
    MAC_ABI,
    provider,
  );
  const account: string = await mac.getPersonalAccount(xrplAddress);
  return ethers.getAddress(account);
}

/** Operator XRPL address(es) the user pays the Payment to (read-only). */
export async function getOperatorXrplWallets(
  provider: Provider,
): Promise<string[]> {
  const { ethers } = await import('ethers');
  const mac = new ethers.Contract(
    await resolveMasterAccountController(provider),
    MAC_ABI,
    provider,
  );
  return mac.getXrplProviderWallets();
}

/**
 * Current memo-instruction nonce for a Personal Account (read-only). A
 * PackedUserOperation's `nonce` must equal this or the controller reverts with
 * InvalidNonce. Auto-increments on every successful execution.
 *
 * First-entry case: a Personal Account is deployed only once its first
 * instruction is sent (IMasterAccountController.getPersonalAccount). For a
 * never-used XRPL address `getNonce` reverts (PA not deployed yet) — but the
 * first memo-instruction nonce is 0 by definition, so we fall back to 0n. This
 * is the normal E1 path: the very first FXRP entry from a fresh XRPL wallet.
 */
export async function getNonce(
  provider: Provider,
  personalAccount: string,
): Promise<bigint> {
  const { ethers } = await import('ethers');
  const mac = new ethers.Contract(
    await resolveMasterAccountController(provider),
    MAC_ABI,
    provider,
  );
  try {
    return await mac.getNonce(personalAccount);
  } catch (err) {
    // Undeployed PA → first op uses nonce 0. Surface it so a real ABI/RPC fault
    // isn't silently masked.
    console.warn(
      `[smartAccount] getNonce(${personalAccount}) reverted — assuming undeployed Personal Account, nonce=0 (first entry). (${(err as Error).message})`,
    );
    return 0n;
  }
}

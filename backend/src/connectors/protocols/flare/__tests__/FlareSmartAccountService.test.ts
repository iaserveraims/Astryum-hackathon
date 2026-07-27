const mock = {
  mac: '0x434936d47503353f06750db1a444dbdc5f0ad37c',
  personalAccount: '0x1111111111111111111111111111111111111111',
  operatorWallets: ['rOperatorXrplAddressAAAAAAAAAAAAAAA'],
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockContract {
    constructor(public address: string) {}
    async getContractAddressByName(_name: string): Promise<string> {
      return mock.mac;
    }
    async getPersonalAccount(_xrpl: string): Promise<string> {
      return mock.personalAccount;
    }
    async getXrplProviderWallets(): Promise<string[]> {
      return mock.operatorWallets;
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

import { ethers } from 'ethers';
import {
  buildCustomInstructions,
  computeCustomInstructionMemo,
  buildRegisterCustomInstruction,
  resolveMasterAccountController,
  resolvePersonalAccount,
  getOperatorXrplWallets,
  buildErc20TransferCall,
  _resetMacCache,
} from '../FlareSmartAccountService';

const fakeProvider = {} as any;

const KTOKEN = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3'; // kFXRP ISO
const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const MAC_IFACE = new ethers.Interface([
  'function registerCustomInstruction(tuple(address targetContract, uint256 value, bytes data)[] _instructions) returns (bytes32)',
]);

const APPROVE = '0x095ea7b3'; // approve selector (stub)
const MINT = '0xa0712d68'; // mint selector (stub)

beforeEach(() => {
  _resetMacCache();
  mock.mac = '0x434936d47503353f06750db1a444dbdc5f0ad37c';
});

describe('FlareSmartAccountService', () => {
  test('buildCustomInstructions maps EncodedAction[] 1:1', () => {
    const ci = buildCustomInstructions([
      { to: FXRP, calldata: APPROVE, value: '0' },
      { to: KTOKEN, calldata: MINT, value: '0' },
    ]);
    expect(ci).toHaveLength(2);
    expect(ci[0]).toEqual({ targetContract: FXRP, value: 0n, data: APPROVE });
    expect(ci[1]).toEqual({ targetContract: KTOKEN, value: 0n, data: MINT });
  });

  test('buildCustomInstructions rejects empty batch / bad target / bad calldata', () => {
    expect(() => buildCustomInstructions([])).toThrow(/EMPTY_BATCH/);
    expect(() =>
      buildCustomInstructions([{ to: 'nope', calldata: '0x', value: '0' }]),
    ).toThrow(/BAD_TARGET/);
    expect(() =>
      buildCustomInstructions([{ to: FXRP, calldata: 'zzz', value: '0' }]),
    ).toThrow(/BAD_CALLDATA/);
  });

  test('computeCustomInstructionMemo = 99 + top-31-bytes of keccak(abi.encode)', async () => {
    const instructions = buildCustomInstructions([
      { to: FXRP, calldata: APPROVE, value: '0' },
    ]);
    const { callHash, memoHex } = await computeCustomInstructionMemo(instructions);

    // Independent recompute with real ethers.
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address targetContract, uint256 value, bytes data)[]'],
      [instructions],
    );
    const expectedHash = ethers.keccak256(encoded);
    expect(callHash).toBe(expectedHash);

    expect(memoHex.slice(0, 2)).toBe('99');
    expect(memoHex).toHaveLength(64); // 32 bytes
    expect(memoHex.slice(2)).toBe(expectedHash.slice(2, 2 + 62)); // top 31 bytes (>> 8)
  });

  test('buildRegisterCustomInstruction → unsigned registerCustomInstruction calldata + memo', async () => {
    const res = await buildRegisterCustomInstruction(fakeProvider, [
      { to: FXRP, calldata: APPROVE, value: '0' },
      { to: KTOKEN, calldata: MINT, value: '0' },
    ]);
    expect(res.to).toBe(ethers.getAddress(mock.mac));
    expect(res.value).toBe('0');
    expect(res.memoHex).toBe(res.memoHex.toUpperCase());
    expect(res.memoHex.slice(0, 2)).toBe('99');

    const decoded = MAC_IFACE.parseTransaction({ data: res.calldata });
    expect(decoded?.name).toBe('registerCustomInstruction');
    const calls = decoded?.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0][0].toLowerCase()).toBe(FXRP); // targetContract
    expect(calls[1][0].toLowerCase()).toBe(KTOKEN);
  });

  test('resolveMasterAccountController returns checksummed registry address', async () => {
    const addr = await resolveMasterAccountController(fakeProvider);
    expect(addr).toBe(ethers.getAddress(mock.mac));
  });

  test('resolveMasterAccountController falls back to mainnet const on empty registry', async () => {
    mock.mac = '0x0000000000000000000000000000000000000000';
    const addr = await resolveMasterAccountController(fakeProvider);
    expect(addr).toBe(
      ethers.getAddress('0x434936d47503353f06750Db1A444DBDC5F0AD37c'),
    );
  });

  test('resolvePersonalAccount + getOperatorXrplWallets read MAC', async () => {
    const pa = await resolvePersonalAccount(fakeProvider, 'rUserXrplAddr');
    expect(pa).toBe(ethers.getAddress(mock.personalAccount));
    const ops = await getOperatorXrplWallets(fakeProvider);
    expect(ops).toEqual(mock.operatorWallets);
  });

  test('buildErc20TransferCall → unsigned ERC-20 transfer(to, amount) on the token', async () => {
    const EVM_WALLET = '0x2222222222222222222222222222222222222222';
    const USDT0 = '0xe7cd86e13ac4309349f30b3435a9d337750fc82d';
    const call = await buildErc20TransferCall({ token: USDT0, to: EVM_WALLET, amount: 11_737_330n });
    expect(call.to.toLowerCase()).toBe(USDT0);
    expect(call.value).toBe('0');
    const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
    const decoded = iface.parseTransaction({ data: call.calldata });
    expect(decoded?.name).toBe('transfer');
    expect(decoded?.args[0].toLowerCase()).toBe(EVM_WALLET.toLowerCase());
    expect(decoded?.args[1]).toBe(11_737_330n);
  });

  test('buildErc20TransferCall rejects bad token / to / amount (never guesses)', async () => {
    const OK = { token: '0xe7cd86e13ac4309349f30b3435a9d337750fc82d', to: '0x2222222222222222222222222222222222222222', amount: 1n };
    await expect(buildErc20TransferCall({ ...OK, token: 'nope' })).rejects.toThrow(/BAD_TOKEN/);
    await expect(buildErc20TransferCall({ ...OK, to: '0xzz' })).rejects.toThrow(/BAD_TO/);
    await expect(buildErc20TransferCall({ ...OK, amount: 0n })).rejects.toThrow(/BAD_AMOUNT/);
  });
});

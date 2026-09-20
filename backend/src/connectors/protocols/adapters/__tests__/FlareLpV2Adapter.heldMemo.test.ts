/**
 * FlareLpV2Adapter — la memoria de «qué pares tiene esta wallet» (18-sep):
 * el segundo barrido dentro del TTL solo relee los pares con saldo (o ninguno),
 * invalidateWallet vuelve al barrido entero, y la memoria se escribe solo desde
 * un barrido entero.
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));
jest.mock('../../../../database/redisClient', () => ({ getRedis: () => null }));

const FACTORY = '0x440602f459D7Dd500a74528003e6A20A46d6e2A6';
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const PAIRS = ['0x1000000000000000000000000000000000000001', '0x1000000000000000000000000000000000000002', '0x1000000000000000000000000000000000000003'];
const WALLET = '0xd545B1238FD05F32E6bBc0129F9a068609A25A2b';
/** pair → balance of WALLET; the test mutates it between sweeps. */
const balances: Record<string, bigint> = { [PAIRS[1].toLowerCase()]: 5n };
/** Every aggregate3 call: the targets it asked for. */
const sweeps: string[][] = [];

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const { Interface } = actual.ethers;
  const factoryIface = new Interface(['function allPairsLength() view returns (uint256)', 'function allPairs(uint256) view returns (address)']);
  const pairIface = new Interface(['function balanceOf(address) view returns (uint256)', 'function token0() view returns (address)', 'function token1() view returns (address)', 'function totalSupply() view returns (uint256)', 'function getReserves() view returns (uint112, uint112, uint32)']);
  class MockContract {
    constructor(readonly address: string) {}
    // factory
    allPairsLength = async () => BigInt(PAIRS.length);
    // pair
    token0 = async () => '0x2000000000000000000000000000000000000001';
    token1 = async () => '0x2000000000000000000000000000000000000002';
    totalSupply = async () => 100n;
    getReserves = async () => [1000n, 2000n, 0];
    symbol = async () => (this.address.endsWith('1') ? 'AAA' : 'BBB');
    aggregate3 = {
      staticCall: async (calls: Array<{ target: string; callData: string }>) => {
        sweeps.push(calls.map((c) => c.target.toLowerCase()));
        return calls.map((c) => {
          if (c.target.toLowerCase() === FACTORY.toLowerCase()) {
            const [i] = factoryIface.decodeFunctionData('allPairs', c.callData);
            return { success: true, returnData: factoryIface.encodeFunctionResult('allPairs', [PAIRS[Number(i)]]) };
          }
          const bal = balances[c.target.toLowerCase()] ?? 0n;
          return { success: true, returnData: pairIface.encodeFunctionResult('balanceOf', [bal]) };
        });
      },
    };
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

import { FlareLpV2Adapter, _resetFlareLpV2Caches } from '../FlareLpV2Adapter';

const venue = { id: 'blazeswap', name: 'BlazeSwap', factory: FACTORY, kind: 'v2' } as never;
const balanceSweeps = () => sweeps.filter((s) => !s.includes(FACTORY.toLowerCase()));

beforeEach(() => {
  _resetFlareLpV2Caches();
  sweeps.length = 0;
  for (const k of Object.keys(balances)) delete balances[k];
  balances[PAIRS[1].toLowerCase()] = 5n;
  void MC;
});

describe('FlareLpV2Adapter held-pairs memo', () => {
  it('first sweep reads every pair; the second, within the TTL, only the pair the wallet holds', async () => {
    const a = new FlareLpV2Adapter(venue);
    const first = await a.discoverPositions(WALLET);
    expect(first.map((p) => p.raw.pair)).toEqual([PAIRS[1]]);
    expect(balanceSweeps()).toHaveLength(1);
    expect(balanceSweeps()[0]).toHaveLength(PAIRS.length);

    const second = await a.discoverPositions(WALLET);
    expect(second.map((p) => p.raw.pair)).toEqual([PAIRS[1]]);
    expect(balanceSweeps()).toHaveLength(2);
    expect(balanceSweeps()[1]).toEqual([PAIRS[1].toLowerCase()]);
  });

  it('a wallet that holds nothing costs ZERO calls on the next sweep', async () => {
    delete balances[PAIRS[1].toLowerCase()];
    const a = new FlareLpV2Adapter(venue);
    expect(await a.discoverPositions(WALLET)).toEqual([]);
    const n = sweeps.length;
    expect(await a.discoverPositions(WALLET)).toEqual([]);
    expect(sweeps.length).toBe(n);
  });

  it('invalidateWallet forces a full sweep, which finds a pair opened meanwhile', async () => {
    const a = new FlareLpV2Adapter(venue);
    await a.discoverPositions(WALLET);
    balances[PAIRS[2].toLowerCase()] = 7n; // opened after the memo was written
    expect((await a.discoverPositions(WALLET)).map((p) => p.raw.pair)).toEqual([PAIRS[1]]); // memo: not seen yet
    a.invalidateWallet(WALLET);
    expect((await a.discoverPositions(WALLET)).map((p) => p.raw.pair)).toEqual([PAIRS[1], PAIRS[2]]);
  });

  it('the memo is per wallet: another wallet gets its own full sweep', async () => {
    const a = new FlareLpV2Adapter(venue);
    await a.discoverPositions(WALLET);
    const other = '0x0000000000000000000000000000000000000abc';
    await a.discoverPositions(other);
    const last = balanceSweeps()[balanceSweeps().length - 1];
    expect(last).toHaveLength(PAIRS.length);
  });
});

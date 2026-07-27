import { EvmExplorerProvider } from '../EvmExplorerProvider';

function mockFetchOk(body: unknown) {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('EvmExplorerProvider', () => {
  const ORIG_KEY = process.env.ETHERSCAN_API_KEY;

  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.ETHERSCAN_API_KEY;
    else process.env.ETHERSCAN_API_KEY = ORIG_KEY;
    global.fetch = undefined as unknown as typeof fetch;
  });

  test('metadata: indexer-verified EVM explorer', () => {
    const p = new EvmExplorerProvider();
    expect(p.id).toBe('evm-explorer');
    expect(p.type).toBe('explorer');
    expect(p.trustLevel).toBe('indexer_verified');
  });

  test('health() = disabled (no mock fallback) when ETHERSCAN_API_KEY absent', async () => {
    delete process.env.ETHERSCAN_API_KEY;
    const p = new EvmExplorerProvider();
    const h = await p.health();
    expect(h.status).toBe('disabled');
    expect(h.reason).toMatch(/ETHERSCAN_API_KEY/);
  });

  test('health() = healthy when key present and endpoint responds', async () => {
    process.env.ETHERSCAN_API_KEY = 'test-key';
    global.fetch = mockFetchOk({ result: '0x10' });
    const p = new EvmExplorerProvider();
    const h = await p.health();
    expect(h.status).toBe('healthy');
  });

  test('getTransactions normalizes Etherscan rows (lowercased, chainId stamped)', async () => {
    process.env.ETHERSCAN_API_KEY = 'test-key';
    global.fetch = mockFetchOk({
      status: '1',
      message: 'OK',
      result: [
        {
          hash: '0xABC',
          from: '0xFROM',
          to: '0xTO',
          blockNumber: '42',
          timeStamp: '1700000000',
          methodId: '0xA9059CBB',
          input: '0x',
          value: '0',
          isError: '0',
        },
      ],
    });
    const p = new EvmExplorerProvider();
    const txs = await p.getTransactions('0xWallet', 1);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      hash: '0xabc',
      from: '0xfrom',
      to: '0xto',
      blockNumber: 42,
      timeStamp: 1700000000,
      methodId: '0xa9059cbb',
      isError: false,
      chainId: 1,
    });
  });

  test('call() rejects unsupported chain and missing address', async () => {
    process.env.ETHERSCAN_API_KEY = 'test-key';
    const p = new EvmExplorerProvider();
    await expect(
      p.call('explorer.getTransactions', { address: '0xw', chainId: 999999 }, { traceId: 't' }),
    ).rejects.toThrow(/unsupported_chain/);
    await expect(
      p.call('explorer.getTransactions', { chainId: 1 }, { traceId: 't' }),
    ).rejects.toThrow(/address required/);
  });

  test('call(explorer.getTransactions) stamps SourceRecord', async () => {
    process.env.ETHERSCAN_API_KEY = 'test-key';
    global.fetch = mockFetchOk({ status: '1', result: [] });
    const p = new EvmExplorerProvider();
    const r = await p.call('explorer.getTransactions', { address: '0xw', chainId: 8453 }, { traceId: 't-9' });
    expect(r.source.providerId).toBe('evm-explorer');
    expect(r.source.traceId).toBe('t-9');
    expect(r.cached).toBe(false);
  });
});

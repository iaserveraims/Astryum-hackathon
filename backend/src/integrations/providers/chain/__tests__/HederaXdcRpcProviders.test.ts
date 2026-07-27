import { HederaRpcProvider } from '../HederaRpcProvider';
import { XdcRpcProvider } from '../XdcRpcProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

function mockRpcOk(result: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
  } as unknown as Response);
}

function mockRpcError(message: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { message } }),
  } as unknown as Response);
}

function mockHttpError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response);
}

// ── HederaRpcProvider ──────────────────────────────────────────────────────

describe('HederaRpcProvider', () => {
  describe('supportsChain()', () => {
    it('supports chainId 296 only', () => {
      const p = new HederaRpcProvider();
      expect(p.supportsChain(296)).toBe(true);
      expect(p.supportsChain(1)).toBe(false);
      expect(p.supportsChain(14)).toBe(false);
    });
  });

  describe('health()', () => {
    it('returns healthy on successful eth_blockNumber', async () => {
      mockRpcOk('0x1234');
      const p = new HederaRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded when result is falsy', async () => {
      mockRpcOk(null);
      const p = new HederaRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('degraded');
    });

    it('returns down on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const p = new HederaRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });

    it('returns down on HTTP error', async () => {
      mockHttpError(503);
      const p = new HederaRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
    });
  });

  describe('call() — chain.getBlockNumber', () => {
    it('returns block number from HashIO', async () => {
      mockRpcOk('0x5f3abc');
      const p = new HederaRpcProvider();
      const result = await p.call('chain.getBlockNumber', {}, { traceId: 'trace-1' });
      expect(result.data).toBe('0x5f3abc');
      expect(result.source.providerId).toBe('hedera-rpc');
      expect(result.cached).toBe(false);
    });
  });

  describe('call() — chain.getBalance', () => {
    it('returns HBAR balance hex', async () => {
      mockRpcOk('0xde0b6b3a7640000');
      const p = new HederaRpcProvider();
      const result = await p.call('chain.getBalance', { address: '0xTestAddr', chainId: 296 }, { traceId: 't' });
      expect(result.data).toBe('0xde0b6b3a7640000');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('eth_getBalance');
      expect(body.params[0]).toBe('0xTestAddr');
    });

    it('throws when called with wrong chainId', async () => {
      const p = new HederaRpcProvider();
      await expect(
        p.call('chain.getBalance', { address: '0xAddr', chainId: 1 }, { traceId: 'x' }),
      ).rejects.toThrow(/only handles chainId 296/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('call() — BROADCAST_FORBIDDEN', () => {
    it('throws on sendTransaction', async () => {
      const p = new HederaRpcProvider();
      await expect(p.call('chain.sendTransaction', {}, { traceId: 'x' })).rejects.toThrow(/BROADCAST_FORBIDDEN/);
    });

    it('throws on broadcastTransaction', async () => {
      const p = new HederaRpcProvider();
      await expect(p.call('chain.broadcastTransaction', {}, { traceId: 'x' })).rejects.toThrow(/BROADCAST_FORBIDDEN/);
    });
  });

  describe('call() — RPC-level errors', () => {
    it('propagates RPC errors', async () => {
      mockRpcError('insufficient funds');
      const p = new HederaRpcProvider();
      await expect(p.call('chain.getBalance', { address: '0x1' }, { traceId: 'x' })).rejects.toThrow(/insufficient funds/);
    });

    it('throws on unknown capability', async () => {
      const p = new HederaRpcProvider();
      await expect(p.call('chain.unknown', {}, { traceId: 'x' })).rejects.toThrow(/unknown capability/);
    });
  });

  describe('metadata', () => {
    it('has correct id, type, trustLevel, priority', () => {
      const p = new HederaRpcProvider();
      expect(p.id).toBe('hedera-rpc');
      expect(p.type).toBe('chain');
      expect(p.trustLevel).toBe('onchain_verified');
      expect(p.priority).toBe(70);
    });

    it('sends request to HashIO endpoint', async () => {
      mockRpcOk('0x1');
      const p = new HederaRpcProvider();
      await p.call('chain.getBlockNumber', {}, { traceId: 'x' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://mainnet.hashio.io/api');
    });
  });
});

// ── XdcRpcProvider ─────────────────────────────────────────────────────────

describe('XdcRpcProvider', () => {
  describe('supportsChain()', () => {
    it('supports chainId 50 only', () => {
      const p = new XdcRpcProvider();
      expect(p.supportsChain(50)).toBe(true);
      expect(p.supportsChain(1)).toBe(false);
      expect(p.supportsChain(296)).toBe(false);
    });
  });

  describe('health()', () => {
    it('returns healthy on successful eth_blockNumber', async () => {
      mockRpcOk('0xabcdef');
      const p = new XdcRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('healthy');
    });

    it('returns down on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const p = new XdcRpcProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
    });
  });

  describe('call() — chain.getBalance', () => {
    it('returns XDC balance', async () => {
      mockRpcOk('0x56bc75e2d63100000');
      const p = new XdcRpcProvider();
      const result = await p.call('chain.getBalance', { address: '0xXdcAddr', chainId: 50 }, { traceId: 'xdc-1' });
      expect(result.data).toBe('0x56bc75e2d63100000');
      expect(result.source.providerId).toBe('xdc-rpc');
    });

    it('throws when called with wrong chainId', async () => {
      const p = new XdcRpcProvider();
      await expect(
        p.call('chain.getBalance', { address: '0xAddr', chainId: 137 }, { traceId: 'x' }),
      ).rejects.toThrow(/only handles chainId 50/);
    });
  });

  describe('call() — chain.getLogs', () => {
    it('returns logs array', async () => {
      mockRpcOk([{ topics: ['0xabc'], data: '0x' }]);
      const p = new XdcRpcProvider();
      const result = await p.call(
        'chain.getLogs',
        { filter: { address: '0xContract', fromBlock: 'latest' } },
        { traceId: 'logs-1' },
      );
      expect(Array.isArray(result.data)).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('eth_getLogs');
    });
  });

  describe('call() — BROADCAST_FORBIDDEN', () => {
    it('throws on sendRawTransaction', async () => {
      const p = new XdcRpcProvider();
      await expect(p.call('chain.sendRawTransaction', {}, { traceId: 'x' })).rejects.toThrow(/BROADCAST_FORBIDDEN/);
    });
  });

  describe('metadata', () => {
    it('has correct id, type, trustLevel, priority', () => {
      const p = new XdcRpcProvider();
      expect(p.id).toBe('xdc-rpc');
      expect(p.type).toBe('chain');
      expect(p.trustLevel).toBe('onchain_verified');
      expect(p.priority).toBe(70);
    });

    it('sends request to XDC RPC endpoint', async () => {
      mockRpcOk('0x1');
      const p = new XdcRpcProvider();
      await p.call('chain.getBlockNumber', {}, { traceId: 'x' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://erpc.xinfin.network');
    });
  });
});

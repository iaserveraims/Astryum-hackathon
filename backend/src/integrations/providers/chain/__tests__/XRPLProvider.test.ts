import { XRPLProvider, XRPL_CHAIN_ID } from '../XRPLProvider';

// ── Mock xrpl.js ──────────────────────────────────────────────────────────────

const mockRequest = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockIsConnected = jest.fn().mockReturnValue(true);

jest.mock('xrpl', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: jest.fn().mockResolvedValue(undefined),
      isConnected: mockIsConnected,
      request: mockRequest,
    })),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockResponse(result: unknown) {
  mockRequest.mockResolvedValueOnce({ result });
}

/**
 * Command-keyed responder for CONCURRENT reads (getDeFiPositions fires
 * account_lines + account_objects in one Promise.all). Order-queued
 * mockResolvedValueOnce broke here: _getClient's isConnected() fast-path lets
 * the SECOND caller reach client.request first while the first still awaits
 * connect(), so the queued responses cross over. Key by command — like the
 * real node — and the race stops mattering.
 */
function mockByCommand(map: Record<string, unknown>) {
  mockRequest.mockImplementation(async (req: { command: string }) => {
    if (!(req.command in map)) throw new Error(`unexpected command ${req.command}`);
    return { result: map[req.command] };
  });
}

function mockError(message: string) {
  mockRequest.mockRejectedValueOnce(new Error(message));
}

const CTX = { traceId: 'test-trace' };

// ── Test suite ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRequest.mockReset();
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockIsConnected.mockReturnValue(true);
});

describe('XRPLProvider — supportsChain()', () => {
  it('supports XRPL pseudo chainId 1440002 only', () => {
    const p = new XRPLProvider();
    expect(p.supportsChain(XRPL_CHAIN_ID)).toBe(true);
    expect(p.supportsChain(1)).toBe(false);
    expect(p.supportsChain(14)).toBe(false);
    expect(p.supportsChain(900)).toBe(false);
  });
});

describe('XRPLProvider — metadata', () => {
  it('has correct id, type, trustLevel, priority', () => {
    const p = new XRPLProvider();
    expect(p.id).toBe('xrpl-rpc');
    expect(p.type).toBe('chain');
    expect(p.trustLevel).toBe('onchain_verified');
    expect(p.priority).toBe(65);
  });

  it('declares the expected capabilities', () => {
    const p = new XRPLProvider();
    expect(p.capabilities).toContain('chain.getBalance');
    expect(p.capabilities).toContain('chain.getTokenBalances');
    expect(p.capabilities).toContain('chain.getDeFiPositions');
    expect(p.capabilities).toContain('xrpl.getAccountLines');
    expect(p.capabilities).toContain('xrpl.getAccountObjects');
  });
});

describe('XRPLProvider — health()', () => {
  it('returns healthy when server_info succeeds', async () => {
    mockResponse({ info: { build_version: '1.12.0', server_state: 'full' } });
    const p = new XRPLProvider();
    const h = await p.health();
    expect(h.status).toBe('healthy');
    expect(typeof h.latencyMs).toBe('number');
    expect(h.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns degraded when result.info is falsy', async () => {
    mockResponse({});
    const p = new XRPLProvider();
    const h = await p.health();
    expect(h.status).toBe('degraded');
  });

  it('returns down only when BOTH transports fail (ws error alone falls back to HTTPS)', async () => {
    // A websocket failure is no longer 'down': _request deliberately walks the
    // HTTPS JSON-RPC fallback (PaaS egress / sick ws node). 'down' now means
    // the socket AND every HTTPS endpoint refused — stub fetch so the fallback
    // fails deterministically instead of reaching a real public node.
    mockError('ECONNREFUSED');
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      const p = new XRPLProvider();
      const h = await p.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('XRPLProvider — BROADCAST_FORBIDDEN', () => {
  it.each([
    'chain.sendTransaction',
    'chain.broadcastTransaction',
    'chain.sendRawTransaction',
    'xrpl.submit',
    'xrpl.submitAndWait',
  ])('throws BROADCAST_FORBIDDEN for capability %s', async (cap) => {
    const p = new XRPLProvider();
    await expect(p.call(cap, {}, CTX)).rejects.toThrow(/BROADCAST_FORBIDDEN/);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('XRPLProvider — chain.getBalance', () => {
  it('returns XRP balance in drops and human format', async () => {
    mockResponse({
      account_data: { Balance: '5000000000' }, // 5000 XRP
    });
    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, { drops: string; xrp: string }>(
      'chain.getBalance',
      { address: 'rTestAddr' },
      CTX,
    );
    expect(res.data.drops).toBe('5000000000');
    expect(res.data.xrp).toBe('5000.000000');
    expect(res.source.providerId).toBe('xrpl-rpc');
    expect(res.cached).toBe(false);
  });

  it('passes the correct xrpl command', async () => {
    mockResponse({ account_data: { Balance: '1000000' } });
    const p = new XRPLProvider();
    await p.call('chain.getBalance', { address: 'rSomeAddr' }, CTX);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'account_info', account: 'rSomeAddr' }),
    );
  });

  it('throws when called with wrong chainId', async () => {
    const p = new XRPLProvider();
    await expect(
      p.call('chain.getBalance', { address: 'rAddr', chainId: 1 }, CTX),
    ).rejects.toThrow(/only handles chainId 1440002/);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('XRPLProvider — xrpl.getAccountLines (trust lines)', () => {
  it('returns mapped trust lines', async () => {
    mockResponse({
      lines: [
        { account: 'rIssuer1', currency: 'RLUSD', balance: '500.5', limit: '1000000', limit_peer: '0' },
        { account: 'rIssuer2', currency: 'USD', balance: '100', limit: '500000', limit_peer: '0' },
      ],
    });
    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>(
      'xrpl.getAccountLines',
      { address: 'rWallet' },
      CTX,
    );
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({
      issuer: 'rIssuer1',
      currency: 'RLUSD',
      balance: '500.5',
    });
    expect(res.data[1].currency).toBe('USD');
  });

  it('returns same result for chain.getTokenBalances alias', async () => {
    mockResponse({ lines: [{ account: 'rIss', currency: 'FOO', balance: '10', limit: '1000', limit_peer: '0' }] });
    const p = new XRPLProvider();
    const res = await p.call('chain.getTokenBalances', { address: 'rAddr' }, CTX);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('returns empty array when no trust lines', async () => {
    mockResponse({ lines: [] });
    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>('xrpl.getAccountLines', { address: 'rEmpty' }, CTX);
    expect(res.data).toEqual([]);
  });
});

describe('XRPLProvider — chain.getDeFiPositions', () => {
  it('aggregates trust lines and offers into positions', async () => {
    mockByCommand({
      account_lines: {
        lines: [
          { account: 'rRLUSDIssuer', currency: 'RLUSD', balance: '200', limit: '1000000', limit_peer: '0' },
          { account: 'rIss2', currency: 'USD', balance: '0', limit: '500', limit_peer: '0' }, // zero balance — excluded
        ],
      },
      account_objects: {
        account_objects: [
          {
            LedgerEntryType: 'Offer',
            TakerGets: { currency: 'XRP', value: '100' },
            TakerPays: { currency: 'RLUSD', issuer: 'rRLUSDIssuer', value: '50' },
          },
        ],
      },
    });

    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>('chain.getDeFiPositions', { address: 'rUser' }, CTX);
    const positions = res.data;

    // trust_line (non-zero only) + offer
    expect(positions).toHaveLength(2);
    expect(positions[0].type).toBe('trust_line');
    expect(positions[0].currency).toBe('RLUSD');
    expect(positions[1].type).toBe('offer');
    expect(positions[1].currency).toBe('XRP');
  });

  it('includes AMM LP positions (XLS-30d)', async () => {
    mockByCommand({
      account_lines: { lines: [] },
      account_objects: {
        account_objects: [
          {
            LedgerEntryType: 'AMM',
            LPTokenBalance: { currency: 'LP03C9B8', issuer: 'rAMMIssuer', value: '12.5' },
            Asset: { currency: 'XRP' },
            Asset2: { currency: 'RLUSD', issuer: 'rRLUSDIssuer' },
            TradingFee: 500,
          },
        ],
      },
    });

    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>('chain.getDeFiPositions', { address: 'rUser2' }, CTX);
    const amm = res.data.find((pos: any) => pos.type === 'amm_lp');
    expect(amm).toBeDefined();
    expect(amm.balance).toBe('12.5');
    expect(amm.details.asset.currency).toBe('XRP');
    expect(amm.details.asset2.currency).toBe('RLUSD');
  });

  it('returns empty array when no positions exist', async () => {
    mockByCommand({ account_lines: { lines: [] }, account_objects: { account_objects: [] } });
    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>('chain.getDeFiPositions', { address: 'rEmpty' }, CTX);
    expect(res.data).toEqual([]);
  });

  it('includes escrow positions (the savings-escrow scanner, Fase 2.4)', async () => {
    mockByCommand({
      account_lines: { lines: [] },
      account_objects: {
        account_objects: [
          {
            LedgerEntryType: 'Escrow',
            Account: 'rUser3', // owner = the scanned address → outgoing
            Destination: 'rUser3', // self-escrow
            Amount: '5000000', // XRP escrow → drops string
            FinishAfter: 800000000,
            PreviousTxnID: 'ABC123',
          },
          {
            LedgerEntryType: 'Escrow',
            Account: 'rSomeoneElse', // incoming escrow towards the scanned address
            Destination: 'rUser3',
            Amount: { currency: 'RLUSD', issuer: 'rRLUSDIssuer', value: '25' }, // XLS-85 token escrow
            FinishAfter: 900000000,
            CancelAfter: 950000000,
            Condition: 'A0258020...',
          },
        ],
      },
    });

    const p = new XRPLProvider();
    const res = await p.call<{ address: string }, any[]>('chain.getDeFiPositions', { address: 'rUser3' }, CTX);
    const escrows = res.data.filter((pos: any) => pos.type === 'escrow');
    expect(escrows).toHaveLength(2);

    const xrpEscrow = escrows[0];
    expect(xrpEscrow.currency).toBe('XRP');
    expect(xrpEscrow.balance).toBe('5.000000');
    expect(xrpEscrow.details.isOutgoing).toBe(true);
    expect(xrpEscrow.details.finishAfter).toBe(800000000);
    expect(xrpEscrow.details.hasCondition).toBe(false);

    const iouEscrow = escrows[1];
    expect(iouEscrow.currency).toBe('RLUSD');
    expect(iouEscrow.balance).toBe('25');
    expect(iouEscrow.details.isOutgoing).toBe(false);
    expect(iouEscrow.details.cancelAfter).toBe(950000000);
    expect(iouEscrow.details.hasCondition).toBe(true);
  });
});

describe('XRPLProvider — getAmmInfo (read-only pool snapshot)', () => {
  it('returns typed pool info from amm_info', async () => {
    mockResponse({
      amm: {
        account: 'rAmmAccount',
        amount: '1000000000',
        amount2: { currency: 'RLUSD', issuer: 'rRLUSDIssuer', value: '2000' },
        lp_token: { currency: 'LPAB', issuer: 'rAmmAccount', value: '44721' },
        trading_fee: 500,
      },
    });
    const p = new XRPLProvider();
    const pool = await p.getAmmInfo({ currency: 'XRP' }, { currency: 'RLUSD', issuer: 'rRLUSDIssuer' });
    expect(pool).not.toBeNull();
    expect(pool!.ammAccount).toBe('rAmmAccount');
    expect(pool!.tradingFee).toBe(500);
    expect(pool!.lpToken.value).toBe('44721');
    expect(pool!.assetFrozen).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ command: 'amm_info' }));
  });

  it('returns null when the pool does not exist', async () => {
    const err = new Error('Account not found.') as Error & { data?: unknown };
    err.data = { error: 'actNotFound' };
    mockRequest.mockRejectedValueOnce(err);
    const p = new XRPLProvider();
    const pool = await p.getAmmInfo({ currency: 'XRP' }, { currency: 'ZZZ', issuer: 'rNoPool' });
    expect(pool).toBeNull();
  });

  it('is exposed as the xrpl.getAmmInfo capability', async () => {
    mockResponse({
      amm: {
        account: 'rAmm2',
        amount: '1',
        amount2: '2',
        lp_token: { currency: 'LP', issuer: 'rAmm2', value: '1' },
        trading_fee: 100,
      },
    });
    const p = new XRPLProvider();
    expect(p.capabilities).toContain('xrpl.getAmmInfo');
    const res = await p.call(
      'xrpl.getAmmInfo',
      { asset: { currency: 'XRP' }, asset2: { currency: 'RLUSD', issuer: 'rRLUSDIssuer' } },
      CTX,
    );
    expect((res.data as any).ammAccount).toBe('rAmm2');
  });
});

describe('XRPLProvider — xrpl.getAccountObjects', () => {
  it('returns raw account_objects result', async () => {
    const rawResult = {
      account_objects: [{ LedgerEntryType: 'Escrow', Amount: '1000000' }],
    };
    mockResponse(rawResult);
    const p = new XRPLProvider();
    const res = await p.call('xrpl.getAccountObjects', { address: 'rAddr' }, CTX);
    expect((res.data as any).account_objects).toHaveLength(1);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'account_objects', account: 'rAddr' }),
    );
  });
});

describe('XRPLProvider — getSoilVaultPosition()', () => {
  it('returns null when SOIL_VAULT_ISSUER is not configured', async () => {
    const origEnv = process.env.SOIL_VAULT_ISSUER;
    delete process.env.SOIL_VAULT_ISSUER;
    const p = new XRPLProvider();
    const pos = await p.getSoilVaultPosition('rAddr');
    expect(pos).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
    process.env.SOIL_VAULT_ISSUER = origEnv;
  });
});

describe('XRPLProvider — getRLUSDBalance()', () => {
  it('returns null when no RLUSD trust line exists', async () => {
    mockResponse({ lines: [{ account: 'rOtherIss', currency: 'USD', balance: '100', limit: '1000', limit_peer: '0' }] });
    const p = new XRPLProvider();
    const bal = await p.getRLUSDBalance('rAddr');
    expect(bal).toBeNull();
  });
});

describe('XRPLProvider — getMultisigSignerActivity() result-code guard', () => {
  // Bug family "lectura ciega al código de resultado": a `tec`-class multisig tx
  // is validated and burns a fee but the operation never happened. It must NOT
  // count toward the rehearsal (which gates disabling the master key).
  it('counts ONLY tesSUCCESS txs — tec-class multisig txs never inflate the rehearsal', async () => {
    mockResponse({
      transactions: [
        { validated: true, meta: { TransactionResult: 'tesSUCCESS' }, tx: { TransactionType: 'EscrowCreate', Account: 'rCouncil', Signers: [{ Signer: { Account: 'rA' } }, { Signer: { Account: 'rB' } }] } },
        // tecINSUFFICIENT_RESERVE — the exact failure that hit the test council 6× in one ceremony.
        { validated: true, meta: { TransactionResult: 'tecINSUFFICIENT_RESERVE' }, tx: { TransactionType: 'EscrowCreate', Account: 'rCouncil', Signers: [{ Signer: { Account: 'rC' } }] } },
        // tecNEED_MASTER_KEY — a multisig AccountSet that can never succeed.
        { validated: true, meta: { TransactionResult: 'tecNEED_MASTER_KEY' }, tx: { TransactionType: 'AccountSet', Account: 'rCouncil', Signers: [{ Signer: { Account: 'rD' } }] } },
        { validated: true, meta: { TransactionResult: 'tesSUCCESS' }, tx: { TransactionType: 'EscrowFinish', Owner: 'rCouncil' } },
      ],
    });
    const p = new XRPLProvider();
    const act = await p.getMultisigSignerActivity('rCouncil');
    expect(act.multisigEscrowCreates).toBe(1); // the tec EscrowCreate is NOT counted
    expect(act.escrowResolved).toBe(true); // from the tesSUCCESS EscrowFinish only
    expect(act.signersSeen.sort()).toEqual(['rA', 'rB']); // rC/rD (tec) excluded
  });

  it('escrowResolved stays false when the only finish/cancel is tec-class', async () => {
    mockResponse({
      transactions: [
        { validated: true, meta: { TransactionResult: 'tecNO_PERMISSION' }, tx: { TransactionType: 'EscrowFinish', Owner: 'rCouncil' } },
      ],
    });
    const p = new XRPLProvider();
    const act = await p.getMultisigSignerActivity('rCouncil');
    expect(act.escrowResolved).toBe(false);
    expect(act.multisigEscrowCreates).toBe(0);
  });

  // The end-to-end proof against the REAL 31-tx rsmv ceremony (fixture JSON +
  // counterfactual) lives in XRPLProvider.rehearsal-realfixture.test.ts — written
  // independently. These two synthetic cases cover the guard's edges around it.
});

describe('XRPLProvider — getDidSetHistory() result-code guard', () => {
  it('lists ONLY tesSUCCESS DIDSets — a tec DIDSet is not a ratified amendment', async () => {
    mockResponse({
      transactions: [
        { validated: true, hash: 'HASH_OK', meta: { TransactionResult: 'tesSUCCESS' }, tx: { TransactionType: 'DIDSet', Account: 'rCouncil', Data: 'AABB', Signers: [{ Signer: { Account: 'rA' } }] } },
        { validated: true, hash: 'HASH_FAIL', meta: { TransactionResult: 'tecINSUFFICIENT_RESERVE' }, tx: { TransactionType: 'DIDSet', Account: 'rCouncil', Data: 'DEAD' } },
      ],
    });
    const p = new XRPLProvider();
    const hist = await p.getDidSetHistory('rCouncil');
    expect(hist).toHaveLength(1);
    expect(hist[0].txHash).toBe('HASH_OK');
    expect(hist[0].dataHex).toBe('AABB');
    expect(hist[0].signedByQuorum).toBe(true);
  });
});

describe('XRPLProvider — unknown capability', () => {
  it('throws on unknown capability string', async () => {
    const p = new XRPLProvider();
    await expect(p.call('xrpl.unknownOp', {}, CTX)).rejects.toThrow(/unknown capability/);
  });
});

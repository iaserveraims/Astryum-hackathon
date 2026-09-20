/**
 * G12-move (ronda 2) — la puerta HTTP corre el MISMO pre-flight que el carril
 * de reglas.
 *
 * `POST /api/xrpl-defi/council-order/prepare` carried its own COPY of the
 * pre-flight, and the copy judged `direct-to`, `recall` and `set-payees` only.
 * So a `move` into a venue that does not exist (or out of one with no basis)
 * composed here, the quorum signed it, the FDC round was paid for (~20 FLR) —
 * and the vault reverted inside `_allocate` / `InsufficientVenueBasis`.
 *
 * These tests fail on the code as it shipped in d99063e: the route returned
 * 200 with a handoff for every one of them. They also pin the doctrine that
 * matters more than the guard: a vault we could not READ is never reported as
 * an order that would revert.
 */
import express from 'express';
import request from 'supertest';

const CAGE = {
  chain: 'flare' as const,
  rpcUrl: 'http://rpc.invalid',
  sourceId: 'XRP' as const,
  explorerTx: 'https://flare-explorer.flare.network/tx/',
  bridge: '0x02aE0000000000000000000000000000000000aa',
  vault: '0xc8370000000000000000000000000000000000bb',
  orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
};

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => CAGE),
  noCageResponse: () => null,
}));

const mockReadVaultState = jest.fn();
jest.mock('../../services/flare/LegacyVaultStateService', () => ({
  ...jest.requireActual('../../services/flare/LegacyVaultStateService'),
  readVaultState: (...a: unknown[]) => mockReadVaultState(...a),
}));

const mockSaveOrder = jest.fn(async () => undefined);
jest.mock('../../services/flare/LegacyOrderStore', () => ({
  saveCouncilOrderRecord: (...a: unknown[]) => mockSaveOrder(...a),
}));

const mockBuildHandoff = jest.fn(async () => ({
  xrplTx: { TransactionType: 'Payment' },
  order: {
    action: 'move',
    orderHash: `0x${'11'.repeat(32)}`,
    orderData: '0xdead',
    summary: 'composed',
    nonce: 7,
    chain: 'flare',
    bridge: CAGE.bridge,
    vault: CAGE.vault,
  },
  disclosure: { disclosedToUser: true, astryumSigns: false, note: '', facts: {} },
}));
jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplCouncilOrderService'),
  buildCouncilOrderHandoff: (...a: unknown[]) => mockBuildHandoff(...(a as [])),
}));

jest.mock('../../database/prismaClient', () => ({
  prisma: { councilProposal: { findFirst: jest.fn(), create: jest.fn() } },
}));

import xrplDefiRouter from '../xrplDefi';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const URL = '/api/xrpl-defi/council-order/prepare';

/** 6-decimal FXRP; venue #0 holds 1 FXRP of principal, venue #1 is live+empty. */
const twoVenues = () => ({
  vault: CAGE.vault,
  chain: 'flare',
  council: CAGE.bridge,
  asset: { address: '0xFXRP', symbol: 'FXRP', decimals: 6 },
  totalPrincipal: '1000000',
  allocatedPrincipal: '1000000',
  idlePrincipal: '0',
  totalValue: '1000000',
  maxVenueBps: 10_000,
  migrated: false,
  venues: [
    {
      id: 0,
      target: '0x1111111111111111111111111111111111111111',
      targetSymbol: 'isoFXRP',
      shares: '0',
      kind: 'compoundv2',
      readyAt: 0,
      retired: false,
      basis: '1000000',
      value: '1000000',
    },
    {
      id: 1,
      target: '0x2222222222222222222222222222222222222222',
      targetSymbol: 'stXRP',
      shares: '0',
      kind: 'erc4626',
      readyAt: 0,
      retired: false,
      basis: '0',
      value: '0',
    },
  ],
  totalClaimable: '0',
  strayAssets: '0',
});

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  mockReadVaultState.mockResolvedValue(twoVenues());
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('council-order/prepare — el pre-flight compartido llega a la puerta HTTP (G12-move)', () => {
  it('400 ORDER_WOULD_REVERT on a move into a venue this vault does not have', async () => {
    const res = await request(app)
      .post(URL)
      .send({ account: COUNCIL, action: 'move', params: { fromId: 0, toId: 9, amount: '1000' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORDER_WOULD_REVERT');
    expect(res.body.code).toBe('VENUE_UNKNOWN');
    expect(res.body.detail).toMatch(/Venue #9 does not exist/);
    // Nothing was composed and nothing was persisted: no bytes for a quorum to
    // sign, so no FDC round to pay for.
    expect(mockBuildHandoff).not.toHaveBeenCalled();
    expect(mockSaveOrder).not.toHaveBeenCalled();
  });

  it('400 on a move OUT of a venue with no basis, naming which half fails', async () => {
    const res = await request(app)
      .post(URL)
      .send({ account: COUNCIL, action: 'move', params: { fromId: 1, toId: 0, amount: '1' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_VENUE_BASIS');
    expect(res.body.detail).toMatch(/A move first recalls the principal/);
  });

  it('400 on retire-venue / evacuate against an id the vault does not have', async () => {
    for (const action of ['retire-venue', 'evacuate']) {
      const res = await request(app).post(URL).send({ account: COUNCIL, action, params: { venueId: 7 } });
      expect({ action, status: res.status, code: res.body.code }).toEqual({
        action,
        status: 400,
        code: 'VENUE_UNKNOWN',
      });
    }
  });

  it('400 on a bps setter outside the vault bounds — and it holds with Flare unreadable', async () => {
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));
    const res = await request(app)
      .post(URL)
      .send({ account: COUNCIL, action: 'set-max-venue-bps', params: { bps: 500 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BPS_OUT_OF_BOUNDS');
    expect(res.body.detail).toMatch(/between 1000 and 10000/);
  });

  it('a LEGAL move composes — the guard refuses, it does not gate', async () => {
    const res = await request(app)
      .post(URL)
      .send({ account: COUNCIL, action: 'move', params: { fromId: 0, toId: 1, amount: '250000' } });

    expect(res.status).toBe(200);
    expect(mockBuildHandoff).toHaveBeenCalledTimes(1);
    // The shared read still feeds the summary its decimals and venue names.
    expect(mockBuildHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ summaryCtx: expect.objectContaining({ decimals: 6, symbol: 'FXRP' }) }),
    );
  });

  it('«no pude leer el vault» NUNCA se anuncia como «la orden revertirá»', async () => {
    // Doctrine, not cosmetics: a dead RPC must never block a legitimate order,
    // and the pass must never be dressed up as a verified one either.
    mockReadVaultState.mockRejectedValue(new Error('flare rpc unreachable'));
    const res = await request(app)
      .post(URL)
      .send({ account: COUNCIL, action: 'move', params: { fromId: 0, toId: 9, amount: '1000' } });

    expect(res.status).toBe(200);
    expect(mockBuildHandoff).toHaveBeenCalledTimes(1);
    // No summaryCtx either: the summary falls back to base units rather than
    // inventing decimals nobody read.
    expect(mockBuildHandoff).toHaveBeenCalledWith(expect.not.objectContaining({ summaryCtx: expect.anything() }));
  });
});

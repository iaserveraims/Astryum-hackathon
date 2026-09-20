/**
 * EL COBRO INSTITUCIONAL NO COMPONE SOBRE UNA BARRIDA PARCIAL SIN DECIRLO.
 *
 * `/pote-claim-redeem/prepare` (EVM) y `/pote-claim-exit/prepare` (0xFE) componen
 * `claimRedeem(ticket, venueClaims[])`. Dos lecturas deciden ese array:
 */
import express from 'express';
import request from 'supertest';

const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const CLIENT = '0xeeee000000000000000000000000000000000001';
const XRPL_ACCOUNT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const PA = '0x7a7a000000000000000000000000000000000001';

/** A read that does NOT answer (the public RPC's 429 of these days). */
const DOWN = '__rpc_down__';

/** The fake node: the pote's asset balance and the Firelight queue, per period. */
const NODE: {
  cushion: bigint | typeof DOWN;
  currentPeriod: bigint | typeof DOWN;
  slots: Record<number, bigint | typeof DOWN>;
  balanceOfCalls: number;
} = { cushion: 0n, currentPeriod: 224n, slots: {}, balanceOfCalls: 0 };

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      if (address.toLowerCase() === STXRP.toLowerCase()) {
        this.currentPeriod = async () => {
          if (NODE.currentPeriod === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return NODE.currentPeriod;
        };
        this.currentPeriodEnd = async () => 1_784_122_969n;
        this.nextPeriodEnd = async () => 1_784_209_369n;
        this.withdrawalsOf = async (period: bigint) => {
          const v = NODE.slots[Number(period)];
          if (v === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return v ?? 0n;
        };
        this.isWithdrawClaimed = async () => false;
        return;
      }
      if (address.toLowerCase() === ASSET.toLowerCase()) {
        this.balanceOf = async () => {
          NODE.balanceOfCalls += 1;
          if (NODE.cushion === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return NODE.cushion;
        };
      }
    }
  }
  class FakeRpcProvider {
    async call(): Promise<string> {
      return '0x';
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
});

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => PA),
}));

/** The 0xFE route composes the claim call right after the two reads: we capture
 *  what it composed and stop there (the handoff after it needs a live node). */
const composedClaim: Array<{ ticketId: bigint; venueClaims: Array<{ venueId: bigint; period: bigint }> }> = [];
jest.mock('../../services/flare/AstryumPoteExitService', () => {
  const actual = jest.requireActual('../../services/flare/AstryumPoteExitService');
  return {
    ...actual,
    buildPoteClaimRedeemCall: (input: { pote: string; ticketId: bigint; venueClaims: Array<{ venueId: bigint; period: bigint }> }) => {
      composedClaim.push({ ticketId: input.ticketId, venueClaims: input.venueClaims });
      throw new actual.PoteExitError('TEST_STOP_AFTER_COMPOSE', 'the test stops here: the claim was composed');
    },
  };
});

import institutionalRouter, { venueClaimCoverage } from '../institutional';
import { readPoteState, type AstryumPoteState } from '../../services/flare/AstryumPoteStateService';
import { _resetSwrForTests } from '../../services/flare/swrCache';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const TICKET_UBA = 10_000_000n; // 10 FXRP fixed at request

function fixtureState(receiver: string): AstryumPoteState {
  return {
    pote: POTE,
    name: 'Astryum Pote A',
    symbol: 'apA-FXRP',
    shareDecimals: 9,
    asset: { address: ASSET, symbol: 'FXRP', decimals: 6 },
    totalAssets: '100000000000',
    totalSupply: '100000000000000',
    sharePrice: '1000000',
    cooldownSeconds: 0,
    bufferFloorBps: 1000,
    maxDepositPerUser: '0',
    freeBalance: '0',
    earmarkedAssets: TICKET_UBA.toString(),
    totalClaimable: '0',
    maxVenueBps: 10_000,
    venues: [
      {
        id: 2,
        target: STXRP,
        kind: 'erc4626queued',
        readyAt: 0,
        retired: false,
        basis: '90000000000',
        value: '90000000000',
        queuedTotal: TICKET_UBA.toString(),
      },
    ],
    tickets: [{ id: 0, receiver, assets: TICKET_UBA.toString(), maturity: 0, claimed: false }],
    governance: {
      council: '0xcccc000000000000000000000000000000000001',
      constitutionRef: '0x' + '11'.repeat(32),
      director: '0xdddd000000000000000000000000000000000001',
      directorUntil: Math.floor(Date.now() / 1000) + 30 * 86_400,
      payees: [],
      cage: null,
    },
  };
}

const ENV = { ...process.env };

beforeEach(() => {
  _resetSwrForTests();
  composedClaim.length = 0;
  NODE.cushion = 0n;
  NODE.currentPeriod = 224n;
  NODE.slots = {};
  NODE.balanceOfCalls = 0;
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';
  delete process.env.DATABASE_URL;
  resetAddressCache();
});

afterAll(() => {
  process.env = ENV;
  resetAddressCache();
});

const claimEvm = () => request(app).post('/api/institutional/pote-claim-redeem/prepare').send({ pote: POTE, ticketId: 0 });
const claimPa = () =>
  request(app).post('/api/institutional/pote-claim-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE, ticketId: 0 });

// ── la ruta EVM: /pote-claim-redeem/prepare ──────────────────────────────────

describe('/pote-claim-redeem/prepare — la barrida parcial de Firelight', () => {
  beforeEach(() => {
    (readPoteState as jest.Mock).mockResolvedValue(fixtureState(CLIENT));
  });

  it('periodos ilegibles y (colchón + colas legibles) que NO cubren el ticket → 502 reintentable, nada compuesto', async () => {
    NODE.cushion = 1_000_000n; // 1 FXRP in the buffer
    NODE.slots = { 223: 4_000_000n, 222: DOWN, 221: DOWN }; // 4 readable, the rest did not answer
    const res = await claimEvm();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.unread).toBe('periods');
    expect(res.body.unreadablePeriods).toEqual(expect.arrayContaining([222, 221]));
    expect(res.body.shortfallBase).toBe('5000000'); // 10 − (1 + 4)
    expect(res.body.detail).toMatch(/did not answer/);
    expect(res.body.detail).toMatch(/5 FXRP short/);
    expect(res.body.detail).toMatch(/UnwindShortfall/);
    expect(res.body.detail).toMatch(/Nothing was prepared and nothing was signed/);
    expect(res.body.calls).toBeUndefined();
  });

  it('periodos ilegibles pero (colchón + colas legibles) que SÍ cubren → compone, y la nota dice qué periodos no se leyeron', async () => {
    NODE.cushion = 3_000_000n;
    NODE.slots = { 223: 7_000_000n, 222: DOWN }; // 3 + 7 = 10 → covered
    const res = await claimEvm();
    expect(res.status).toBe(200);
    expect(res.body.venueClaims).toEqual([{ venueId: 2, period: 223 }]);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.notes.join(' ')).toMatch(/period\(s\) 222 of Firelight did not answer/);
    expect(res.body.notes.join(' ')).toMatch(/cover this ticket/);
  });

  it('la barrida ENTERA caída (currentPeriod no contesta) con colchón corto → 502, no un claim condenado con una nota', async () => {
    NODE.cushion = 1_000_000n;
    NODE.currentPeriod = DOWN;
    const res = await claimEvm();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.detail).toMatch(/did not answer at all/);
    expect(res.body.calls).toBeUndefined();
  });

  it('CONTROL — todos los periodos leídos y colchón corto: compone con los reclamables, sin nota de periodos', async () => {
    NODE.cushion = 1_000_000n;
    NODE.slots = { 223: 9_000_000n };
    const res = await claimEvm();
    expect(res.status).toBe(200);
    expect(res.body.venueClaims).toEqual([{ venueId: 2, period: 223 }]);
    expect(res.body.notes.join(' ')).not.toMatch(/did not answer/);
  });

  it('CONTROL — el colchón cubre el ticket: no se escanea ninguna cola y venueClaims queda vacío (guarda)', async () => {
    NODE.cushion = TICKET_UBA;
    NODE.slots = { 223: DOWN }; // would be unread — but it must never be asked
    const res = await claimEvm();
    expect(res.status).toBe(200);
    expect(res.body.venueClaims).toEqual([]);
    expect(res.body.notes).toEqual([]);
  });

  it('el colchón ILEGIBLE ya no vale cero: 502 reintentable, sin escanear colas, nada compuesto', async () => {
    NODE.cushion = DOWN;
    NODE.slots = { 223: 9_000_000n }; // a scan here would have added this period
    const res = await claimEvm();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.unread).toBe('cushion');
    expect(res.body.detail).toMatch(/could not read the pote's own FXRP balance/);
    expect(res.body.detail).toMatch(/period already collected/);
    expect(res.body.calls).toBeUndefined();
    expect(NODE.balanceOfCalls).toBe(1);
  });
});

// ── la ruta 0xFE: /pote-claim-exit/prepare ───────────────────────────────────

describe('/pote-claim-exit/prepare — las mismas dos lecturas, la misma regla', () => {
  beforeEach(() => {
    (readPoteState as jest.Mock).mockResolvedValue(fixtureState(PA));
  });

  it('periodos ilegibles y cobertura corta → 502 antes de componer nada (ni 0xFE, ni carrier)', async () => {
    NODE.cushion = 1_000_000n;
    NODE.slots = { 223: 4_000_000n, 222: DOWN };
    const res = await claimPa();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.unread).toBe('periods');
    expect(res.body.unreadablePeriods).toEqual([222]);
    expect(composedClaim).toHaveLength(0);
  });

  it('el colchón ILEGIBLE → 502 antes de componer nada', async () => {
    NODE.cushion = DOWN;
    const res = await claimPa();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('VAULT_CLAIMS_UNREADABLE');
    expect(res.body.unread).toBe('cushion');
    expect(composedClaim).toHaveLength(0);
  });

  it('periodos ilegibles pero cobertura suficiente → compone el claim con los periodos leídos (bigint, como pide el batch)', async () => {
    NODE.cushion = 3_000_000n;
    NODE.slots = { 223: 7_000_000n, 222: DOWN };
    const res = await claimPa();
    // The route got PAST both reads and composed: our stub stops it there.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TEST_STOP_AFTER_COMPOSE');
    expect(composedClaim).toEqual([{ ticketId: 0n, venueClaims: [{ venueId: 2n, period: 223n }] }]);
  });
});

// ── la regla, sola ───────────────────────────────────────────────────────────

describe('venueClaimCoverage — la aritmética de la decisión', () => {
  const base = { ticketUBA: 10n, unreadablePeriods: [] as number[], sweepFailed: false };
  it('cubre cuando colchón + reclamables legibles ≥ ticket', () => {
    expect(venueClaimCoverage({ ...base, cushionUBA: 3n, claimableUBA: 7n })).toEqual({ covered: true, unread: false, shortfallUBA: 0n });
    expect(venueClaimCoverage({ ...base, cushionUBA: 3n, claimableUBA: 6n })).toEqual({ covered: false, unread: false, shortfallUBA: 1n });
  });
  it('«unread» = un periodo sin leer O la barrida caída', () => {
    expect(venueClaimCoverage({ ...base, cushionUBA: 10n, claimableUBA: 0n, unreadablePeriods: [5] }).unread).toBe(true);
    expect(venueClaimCoverage({ ...base, cushionUBA: 10n, claimableUBA: 0n, sweepFailed: true }).unread).toBe(true);
  });
});

/**
 * Hardening post-ensayo mainnet (2026-07-26):
 *
 * §A — un dispatch 0xFE con XRP ≤ fees del mint responde 400 AMOUNT_BELOW_MINT_FEES
 *      con mensaje accionable en las TRES rutas (supply-usdt0, pa-withdraw-transfer,
 *      pa-repay) — el ensayo lo observó saliendo como 500 genérico; walletTransfer
 *      ya tenía el mapeo y aquí se replica.
 *
 * §B — el cap-al-saldo-del-firmante de a1 (1a7d2ac) es lógica de dinero del camino
 *      crítico: full capado al saldo con disclosure coherente, 409 sin saldo, y el
 *      FAIL-OPEN deliberado cuando el saldo no se puede leer (ver el test).
 *
 * Hermetic: FakeContract keyed por address (un value Error ⇒ el read revienta),
 * FTSO/preflight/handoff/PA-resolution stubbeados.
 */
import express from 'express';
import request from 'supertest';

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const USDT0_TOKEN = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D';
const WALLET = '0xeabcd745598916b0131ece397c8d6a332088462c';
const PA = '0x1111111111111111111111111111111111111111';
const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

const CHAIN: Record<string, Record<string, unknown>> = {
  [ISO_COMPTROLLER.toLowerCase()]: { markets: [true, 750000000000000000n] },
  [KFXRP_ISO.toLowerCase()]: { balanceOfUnderlying: 9_600_014n },
  [KUSDT0_ISO.toLowerCase()]: {
    borrowBalanceCurrent: 4_320_000n, // deuda viva del PA (pa-repay la necesita > 0)
    balanceOfUnderlying: 3_000_000n,
    underlying: USDT0_TOKEN,
  },
  [USDT0_TOKEN.toLowerCase()]: { balanceOf: 10_000_000n, allowance: 10n ** 30n },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = CHAIN[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        const impl = async () => {
          if (value instanceof Error) throw value; // read revienta → helpers → null
          return value;
        };
        (impl as unknown as { staticCall: () => Promise<unknown> }).staticCall = impl;
        this[fn] = impl;
      }
    }
  }
  class FakeRpcProvider {}
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return { ...actual, createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }) };
});

// El preflight tiene su propia suite; aquí se stubbea para aislar el cap/fees.
jest.mock('../../services/flare/preparePreflight', () => {
  const actual = jest.requireActual('../../services/flare/preparePreflight');
  return {
    ...actual,
    preflightEvmCalls: jest.fn(async () => ({ available: true, willSucceed: true, steps: [] })),
    preflightXrplPayment: jest.fn(async () => ({ available: true, willSucceed: true })),
  };
});

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService');
  return {
    ...actual,
    resolvePersonalAccount: jest.fn(async () => '0x1111111111111111111111111111111111111111'),
  };
});

// §A — el handoff revienta EXACTAMENTE como en el ensayo mainnet (0.3 XRP).
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return {
    ...actual,
    buildDirectMintHandoff: jest.fn(async () => {
      throw new Error('DIRECT_MINT_INSUFFICIENT: gross 300000 ≤ fees (mint 100000 + exec 200000)');
    }),
  };
});

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  process.env.FXRP_TOKEN = FXRP;
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});
afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
});
beforeEach(() => {
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  CHAIN[USDT0_TOKEN.toLowerCase()].balanceOf = 10_000_000n;
});

describe('§A — XRP ≤ fees del mint responde 400 nombrado, no 500 (las TRES rutas 0xFE)', () => {
  const EXPECT_400 = (res: request.Response) => {
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('AMOUNT_BELOW_MINT_FEES');
    expect(res.body.detail).toMatch(/minting \+ executor fees/);
    expect(res.body.detail).toMatch(/DIRECT_MINT_INSUFFICIENT/);
  };

  it('supply-usdt0/prepare', async () => {
    const res = await request(app)
      .post('/api/flare-demo/supply-usdt0/prepare')
      .send({ xrplAddress: XRPL, amountUsdt0Base: '100000', amountXrpForMint: 0.3 });
    EXPECT_400(res);
  });

  it('pa-withdraw-transfer/prepare', async () => {
    const res = await request(app)
      .post('/api/flare-demo/pa-withdraw-transfer/prepare')
      .send({ xrplAddress: XRPL, evmWallet: WALLET, asset: 'usdt0', amountBase: '1000', amountXrpForMint: 0.3 });
    EXPECT_400(res);
  });

  it('pa-repay/prepare', async () => {
    const res = await request(app)
      .post('/api/flare-demo/pa-repay/prepare')
      .send({ xrplAddress: XRPL, mode: 'fixed', amountUsdt0Base: '1000', amountXrpForMint: 0.3 });
    EXPECT_400(res);
  });
});

describe('§B — a1: el cap-al-saldo-del-firmante (lógica de dinero, 1a7d2ac)', () => {
  const body = {
    personalAccount: PA,
    supplyUBA: '9600014',
    debtUsdt0Base: '4320000', // 4.32 USDT0 de deuda
    collateralFactor: 0.75,
    fxrpPriceUSD: 2.0,
    mode: 'full',
    signerAddress: WALLET,
  };
  const post = () => request(app).post('/api/flare-demo/a1/prepare').send(body);

  it('full con saldo menor que la deuda ⇒ capado al saldo, disclosure coherente', async () => {
    CHAIN[USDT0_TOKEN.toLowerCase()].balanceOf = 1_000_000n; // la wallet solo tiene 1 USDT0
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.disclosure.cappedToWallet).toBe(true);
    expect(res.body.disclosure.repayUsdt0).toBeCloseTo(1, 6);
    expect(res.body.disclosure.walletUsdt0).toBeCloseTo(1, 6);
    expect(res.body.disclosure.remainingDebtUsdt0).toBeCloseTo(3.32, 6); // 4.32 − 1
    expect(res.body.calls).toHaveLength(2); // approve + repayBorrowBehalf, nunca un payload condenado
    expect(res.body.disclosure.note).toMatch(/Capped to your wallet balance/);
  });

  it('full con saldo suficiente ⇒ sin cap, repay = deuda completa', async () => {
    const res = await post(); // balanceOf 10 USDT0 ≥ 4.32
    expect(res.status).toBe(200);
    expect(res.body.disclosure.cappedToWallet).toBe(false);
    expect(res.body.disclosure.repayUsdt0).toBeCloseTo(4.32, 6);
    expect(res.body.disclosure.remainingDebtUsdt0).toBeCloseTo(0, 6);
  });

  it('sin USDT0 en la wallet ⇒ 409 NO_USDT0_IN_WALLET (rechazo honesto, no payload muerto)', async () => {
    CHAIN[USDT0_TOKEN.toLowerCase()].balanceOf = 0n;
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_USDT0_IN_WALLET');
  });

  it('saldo ILEGIBLE (RPC hiccup) ⇒ FAIL-OPEN deliberado: prepara sin cap y lo dice', async () => {
    // DECISIÓN (documentada aquí, escaneo #7): si erc20BalanceOf devuelve null,
    // a1 NO bloquea la acción de PROTECCIÓN por un read fallido — prepara el
    // repay completo sin cap (cappedToWallet=false, sin walletUsdt0 en el
    // disclosure = el cap no se aplicó). Redes que quedan: el preflight simula
    // el repay desde el firmante y la wallet re-estima el gas antes de firmar.
    // Un fail-CLOSED aquí dejaría al usuario sin defensa con el HF cayendo por
    // culpa de un nodo tosiendo — peor que el riesgo de un revert visible.
    CHAIN[USDT0_TOKEN.toLowerCase()].balanceOf = new Error('RPC hiccup');
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.disclosure.cappedToWallet).toBe(false);
    expect(res.body.disclosure.walletUsdt0).toBeUndefined(); // el cap no corrió — no se inventa un saldo
    expect(res.body.disclosure.repayUsdt0).toBeCloseTo(4.32, 6);
    expect(res.body.calls).toHaveLength(2);
  });
});

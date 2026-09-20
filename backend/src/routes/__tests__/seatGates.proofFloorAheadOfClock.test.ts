/**
 * LAS TRES PUERTAS DEL ASIENTO 0xFE
 * PROPAGAN EL REFUSAL REAL DE LA TIENDA DE PRUEBAS, HASTA LA RESPUESTA HTTP.
 */
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

const mockUserFindUnique = jest.fn();
const mockBindingFindMany = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    walletBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
  },
}));

const mockBuild = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  // Las tres puertas preguntan al SignerList antes de componer: `{}` = cuenta
  // normal de una firma, sin ledger.
  signingCeremonyFor: jest.fn(async () => ({})),
  readRedemptionFeeBips: jest.fn(async () => 18),
  readDirectMintParams: jest.fn(async () => ({
    fxrpToken: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
    paymentAddress: 'rCoreVaultXXXXXXXXXXXXXXXXXXXXXXXX',
    minFeeUBA: 100_000n,
    feeBIPS: 10n,
    executorFeeUBA: 200_000n,
    granularityUBA: 1n,
  })),
  computeNetMint: jest.fn(() => ({ netToPersonalAccountUBA: 700_000n, supplyUBA: 700_000n })),
  mintFeeDisclosure: jest.fn(() => ({})),
  readFxrpBalance: jest.fn(async () => 20_000_000n),
  readMinimumRedeemAmountUBA: jest.fn(async () => 0n),
  buildRedeemToXrplCall: jest.fn(async () => ({ to: '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8', calldata: '0xab', value: '0' })),
  buildDirectMintHandoff: (...a: unknown[]) => mockBuild(...a),
  resolveRedemptionExecutor: jest.fn(async () => '0x0000000000000000000000000000000000000000'),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => '0xeeee000000000000000000000000000000000001'),
}));
jest.mock('../../services/flare/preparePreflight', () => ({
  ...jest.requireActual('../../services/flare/preparePreflight'),
  preflightXrplPayment: jest.fn(async () => ({ ok: true })),
  preflightEvmCalls: jest.fn(async () => ({ ok: true })),
  mergePreflights: jest.fn(() => ({ ok: true })),
}));
// institutional — el pote y sus lecturas de estado.
const POTE = '0xb0b0000000000000000000000000000000000001';
jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(async () => ({
    pote: POTE,
    name: 'Astryum Pote A',
    symbol: 'apA-FXRP',
    shareDecimals: 9,
    asset: { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', symbol: 'FXRP', decimals: 6 },
    totalAssets: '100000000000',
    totalSupply: '100000000000000',
    sharePrice: '1000000',
    cooldownSeconds: 0,
    bufferFloorBps: 1000,
    freeBalance: '10000000000',
    earmarkedAssets: '0',
    totalClaimable: '0',
    maxVenueBps: 10_000,
    venues: [],
    tickets: [],
    governance: {
      council: '0xcccc000000000000000000000000000000000001',
      constitutionRef: '0x' + '11'.repeat(32),
      director: '0xdddd000000000000000000000000000000000001',
      directorUntil: 0,
      payees: [],
    },
  })),
  readHolderShares: jest.fn(async () => 0n),
}));
// xrplDefi — el cobro de rendimiento de una jaula Legacy.
const VAULT = '0xc8379c79779cCE3B738424892709fe0D4339E3b1';
jest.mock('../../services/flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => ({
    rpcUrl: 'http://rpc.invalid',
    vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
    bridge: '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F',
    chainId: 14,
  })),
  noCageResponse: () => null,
}));
jest.mock('../../services/flare/LegacyVaultStateService', () => ({
  ...jest.requireActual('../../services/flare/LegacyVaultStateService'),
  readVaultState: jest.fn(async () => ({
    vault: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
    chain: 'flare',
    asset: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', symbol: 'FXRP', decimals: 6 },
    totalPrincipal: '0',
    allocatedPrincipal: '0',
    idlePrincipal: '0',
    totalValue: '0',
    maxVenueBps: 10_000,
    migrated: false,
    venues: [],
    totalClaimable: '0',
    strayAssets: '0',
  })),
}));

import flareDemoRouter from '../flareDemo';
import institutionalRouter from '../institutional';
import xrplDefiRouter from '../xrplDefi';
import { PROOF_REFUSALS } from '../../services/identity/provenAddresses';
import { resetAddressCache } from '../../config/protocolAddresses';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
// El usuario de EMAIL: sesión con userId y SIN wallet de login — su única prueba
// sobre la r-address es el binding firmado.
app.use((req, _res, next) => {
  const user = req.header('x-test-user');
  if (user) (req as express.Request & { siwe: unknown }).siwe = { userId: user, sessionId: `s-${user}`, walletAddress: '' };
  next();
});
app.use('/api/flare-demo', flareDemoRouter);
app.use('/api/institutional', institutionalRouter);
app.use('/api/xrpl-defi', xrplDefiRouter);

const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const COUNCIL = 'rsmvJMhhh8Bhr2cTLDbXKrGoCCLptKDmrf';
const USER = 'u-email';
const FUTURE = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
const ENV = { ...process.env };

const handoff = () => ({
  personalAccount: '0xeeee000000000000000000000000000000000001',
  xrplPayment: { TransactionType: 'Payment', Account: XRPL },
  memoHex: 'FE' + 'AB'.repeat(20),
  userOpData: '0x',
  net: { netToPersonalAccountUBA: 700_000n, mintingFeeUBA: 100_000n, executorFeeUBA: 200_000n, supplyUBA: 700_000n },
});

/** La fila REAL de un usuario de email: una marca de toma de posesión y un binding firmado (siempre anterior a una marca futura). */
function userRow(takeoverAt: string) {
  mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt } }, email: null, emailVerified: false });
  mockBindingFindMany.mockResolvedValue([{ address: XRPL, signatureProof: 'sig', linkedAt: new Date() }]);
}

let consoleError: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env = { ...ENV };
  process.env.DATABASE_URL = 'postgres://seat-gates-test';
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';
  process.env.FXRP_TOKEN = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
  delete process.env.ALLOW_NO_AUTH;
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  resetAddressCache();
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  mockBuild.mockImplementation(async () => handoff());
  // Las lecturas de contrato que las rutas hacen ANTES de la puerta del asiento.
  jest.spyOn(ethers, 'Contract').mockImplementation(
    () =>
      ({
        maxRedeem: async () => 1_000_000_000n,
        balanceOf: async () => 1_000_000_000n,
        previewRedeem: async () => 1_000_000n,
        claimable: async () => 5_000_000n,
      }) as unknown as ethers.Contract,
  );
  userRow(FUTURE);
});
afterEach(() => {
  consoleError.mockRestore();
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env = ENV;
});

const unmint = () =>
  request(app)
    .post('/api/flare-demo/pa-unmint/prepare')
    .set('x-test-user', USER)
    .send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1 });
const poteExit = () =>
  request(app).post('/api/institutional/pote-exit/prepare').set('x-test-user', USER).send({ account: XRPL, pote: POTE });
const yieldClaim = () =>
  request(app)
    .post('/api/xrpl-defi/vault-yield/claim/prepare')
    .set('x-test-user', USER)
    .send({ council: COUNCIL, xrplAddress: XRPL, amountXrpForMint: '1' });

const GATES: Array<[string, () => request.Test]> = [
  ['flareDemo  POST /pa-unmint/prepare (una de las catorce composiciones de seatClaimOf)', unmint],
  ['institutional  POST /pote-exit/prepare (seatProofFieldsFor)', poteExit],
  ['xrplDefi  POST /vault-yield/claim/prepare (seatProofFieldsFor)', yieldClaim],
];

describe('Una marca ADELANTADA a nuestro reloj llega a la respuesta como lo que es', () => {
  it.each(GATES)('%s → 503 PROOF_FLOOR_AHEAD_OF_CLOCK con headline y ways, sin «in a moment», y nada compuesto', async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(503);
    const expected = PROOF_REFUSALS.PROOF_FLOOR_AHEAD_OF_CLOCK;
    expect(res.body).toEqual({
      error: 'PROOF_FLOOR_AHEAD_OF_CLOCK',
      retryable: true,
      headline: expected.headline,
      ways: expected.ways,
      detail: expected.detail,
    });
    // Las dos verdades sobreviven hasta la respuesta…
    const said = [res.body.detail, ...res.body.ways].join(' ');
    expect(said).toMatch(/re-linking (one|the wallet) will not help/i);
    expect(said).toMatch(/administrator can check that date/i);
    expect(said).toMatch(/dated (later than our own clock|in the future)/i);
    // …y ninguna de las dos falsedades de la frase vieja.
    expect(said).not.toMatch(/could not read/i);
    expect(said).not.toMatch(/in a moment/i);
    // Ni el código crudo delante, ni la r-address dentro (el detail viejo llevaba las dos).
    expect(res.body.detail).not.toMatch(/^PROOF_/);
    expect(res.body.detail).not.toContain(XRPL);
    // Sin cuenta atrás: no sabemos si son tres segundos de deriva o 2099.
    expect(res.body.retryAfterSeconds).toBeUndefined();
    // Y no es la frase vieja disfrazada.
    expect(res.body.error).not.toBe('PROOF_STORE_UNREADABLE');
    expect(mockBuild).not.toHaveBeenCalled();
  });

  /** (b) Un PROOF_STORE_UNREADABLE GENUINO — la consulta falló — sigue saliendo como tal, con SU headline y SUS ways. */
  it.each(GATES)('%s → con la base sin contestar, 503 PROOF_STORE_UNREADABLE genuino, entero', async (_name, call) => {
    mockUserFindUnique.mockRejectedValue(new Error('pooler down'));
    const res = await call();
    expect(res.status).toBe(503);
    const expected = PROOF_REFUSALS.PROOF_STORE_UNREADABLE;
    expect(res.body).toEqual({
      error: 'PROOF_STORE_UNREADABLE',
      retryable: true,
      headline: expected.headline,
      ways: expected.ways,
      retryAfterSeconds: 3,
      detail: expected.detail,
    });
    // Aquí «in a moment» SÍ es verdad, y se dice.
    expect(res.body.detail).toMatch(/in a moment/i);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  /** LA CADENA SANA SOLA: la misma fila, el mismo binding, nada escrito — el reloj pasó la marca. */
  it.each(GATES)('%s → con la marca en el PASADO el mismo binding prueba y la salida se compone', async (_name, call) => {
    userRow(PAST);
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ xrplAddress: XRPL, preparedByProven: true, preparedByProofUnreadable: false });
  });

  /**
   * LA ASIMETRÍA QUE DELATÓ EL FALLO — Y QUE SIGUE AHÍ. Con la marca ILEGIBLE
   * (409 determinista, esperar no la cura) la MISMA salida SE COMPONE, marcada
   * «no pude preguntar»; con la marca ADELANTADA se RECHAZA (503). En dinero,
   * la adelantada SÍ queda peor: la persona con la fila corrupta puede sacar
   * su capital y la persona con la fecha en 2099 no — hasta que un
   * administrador corrija la fecha o entre con la wallet. Lo que esta
   * iteración arregló es la FRASE de ese rechazo (código, headline, ways, sin
   * «in a moment»), no la asimetría; este test la fija para que nadie la lea
   * como resuelta.
   */
  it('la asimetría, fijada: la marca ILEGIBLE sigue componiendo la salida marcada preparedByProofUnreadable (flareDemo) mientras la adelantada la rechaza', async () => {
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: 'not a date' } }, email: null, emailVerified: false });
    const res = await unmint();
    expect(res.status).toBe(200);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ preparedByProven: false, preparedByProofUnreadable: true });
  });

  it('control: un asiento OCUPADO de verdad (NonceSeatTakenError del builder) no cambia ni una coma', async () => {
    userRow(PAST);
    const { NonceSeatTakenError } = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
    mockBuild.mockRejectedValue(new NonceSeatTakenError('NONCE_SEAT_TAKEN: a draft is live', { secondsLeft: 120 }));
    const res = await unmint();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'NONCE_SEAT_TAKEN', retryable: false, secondsLeft: 120 });
    expect(res.body.headline).toBeUndefined();
    expect(res.body.ways).toBeUndefined();
  });
});

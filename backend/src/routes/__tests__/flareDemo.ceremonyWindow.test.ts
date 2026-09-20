/**
 * LAS COMPOSICIONES DE 0xFE DE `flareDemo` PREGUNTAN LO
 * MISMO QUE LAS OTRAS DIEZ.
 */
import express from 'express';
import request from 'supertest';

const mockBuild = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: jest.fn(async () => ({ minFeeUBA: 100_000n, feeBIPS: 10n, executorFeeUBA: 200_000n })),
  computeNetMint: jest.fn(() => ({ netToPersonalAccountUBA: 500_000n, supplyUBA: 500_000n })),
  mintFeeDisclosure: jest.fn(() => ({})),
  readFxrpBalance: jest.fn(async () => 20_000_000n),
  readMinimumRedeemAmountUBA: jest.fn(async () => 5_000_000n),
  readRedemptionFeeBips: jest.fn(async () => 20),
  buildRedeemToXrplCall: jest.fn(async () => ({ to: '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8', calldata: '0xab', value: '0' })),
  buildDirectMintHandoff: (...a: unknown[]) => mockBuild(...a),
  resolveRedemptionExecutor: jest.fn(async () => '0x0000000000000000000000000000000000000000'),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => '0xeeee000000000000000000000000000000000001'),
}));
jest.mock('../../connectors/protocols/adapters/KineticAdapter', () => {
  const actual = jest.requireActual('../../connectors/protocols/adapters/KineticAdapter');
  class KineticAdapter extends actual.KineticAdapter {
    async buildIsoWithdrawFxrp() {
      return [{ to: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3', calldata: '0x852a12e3', value: '0' }];
    }
  }
  return { ...actual, KineticAdapter };
});
jest.mock('../../services/flare/preparePreflight', () => ({
  ...jest.requireActual('../../services/flare/preparePreflight'),
  preflightXrplPayment: jest.fn(async () => ({ ok: true })),
  preflightEvmCalls: jest.fn(async () => ({ ok: true })),
  mergePreflights: jest.fn(() => ({ ok: true })),
}));

/** El ÚNICO seam fingido de la decisión: lo que el ledger dice del SignerList. */
const mockQuorum = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  readXrplSignerQuorum: (...a: unknown[]) => mockQuorum(...a),
}));

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';
import {
  defaultSeatWindowLedgers,
  handoffCeremonyExpiryMin,
  handoffPayloadExpiryMin,
} from '../../services/flare/handoffAuthority';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as express.Request & { siwe: unknown }).siwe = { userId: 'u-1', sessionId: 's-1', walletAddress: '' };
  next();
});
app.use('/api/flare-demo', flareDemoRouter);

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const MEMO = 'FE' + 'AB'.repeat(20);
const ENV = { ...process.env };

const handoff = () => ({
  personalAccount: '0xeeee000000000000000000000000000000000001',
  xrplPayment: { TransactionType: 'Payment', Memos: [{ Memo: { MemoData: MEMO } }] },
  memoHex: MEMO,
  userOpData: '0x',
  net: { netToPersonalAccountUBA: 500_000n, mintingFeeUBA: 100_000n, executorFeeUBA: 200_000n, supplyUBA: 500_000n },
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.KINETIC_KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
  process.env.KINETIC_ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
  process.env.FXRP_TOKEN = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
  delete process.env.DATABASE_URL;
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  // La lista de cuentas OPERATIVAS se lee del entorno: vacía = ninguna es nuestra.
  delete process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS;
  delete process.env.ASTRYUM_ORDER_ANCHOR;
  delete process.env.LEGACY_ORDER_ANCHOR;
  delete process.env.MANAGER_CREDENTIAL_ISSUERS;
  delete process.env.DEMO_EXCHANGE_OMNIBUS_SEED;
  resetAddressCache();
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  mockBuild.mockImplementation(async () => handoff());
  mockQuorum.mockResolvedValue('single');
});
afterAll(() => {
  process.env = ENV;
});

/** Un prepare de 0xFE cualquiera de este router — el camino de salida del PA. */
const unmint = (account: string) =>
  request(app)
    .post('/api/flare-demo/pa-unmint/prepare')
    .send({ xrplAddress: account, amountFxrpBase: '10000000', amountXrpForMint: 1 });

/** Lo que el builder recibió: la declaración de ceremonia, tal cual. */
function declaredCeremony(): boolean {
  return mockBuild.mock.calls[0][1].signingCeremony === true;
}

/** Los minutos que ese 0xFE vivirá, según lo que la ruta declaró. */
function declaredPayloadMin(): number {
  return declaredCeremony() ? handoffCeremonyExpiryMin() : handoffPayloadExpiryMin();
}

/** Lo que la ruta dijo al builder sobre si LEYÓ el SignerList. */
function declaredRead(): unknown {
  return mockBuild.mock.calls[0][1].signerListRead;
}

describe('un 0xFE compuesto para una cuenta con quórum nace con la ventana del quórum', () => {
  it('la ruta LEE el SignerList y declara la ceremonia al builder', async () => {
    mockQuorum.mockResolvedValue('quorum');
    const res = await unmint(COUNCIL);

    expect(res.status).toBe(200);
    expect(mockQuorum).toHaveBeenCalledWith(COUNCIL);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ xrplAddress: COUNCIL, signingCeremony: true });
    // …y le dice que lo LEYÓ. `seatClaimOf` no declara este campo en
    // su tipo (otro frente lo posee), así que la cadena se prueba en tiempo de
    // ejecución: el spread lo lleva hasta el builder.
    expect(declaredRead()).toBe('quorum');
  });

  /**
   * La respuesta del prepare devuelve lo que el builder estampó, para
   * que el navegador distinga una ventana LEÍDA de una por defecto.
   */
  it('la respuesta del prepare contesta `signerListRead` tal y como lo estampó el builder', async () => {
    mockBuild.mockImplementation(async () => ({ ...handoff(), payloadExpiryMin: 5, signerListRead: 'single' }));
    const res = await unmint(COUNCIL);
    expect(res.status).toBe(200);
    expect(res.body.payloadExpiryMin).toBe(5);
    expect(res.body.signerListRead).toBe('single');

    // Un builder que no lo estampa (una fila antigua) no inventa uno.
    mockBuild.mockImplementation(async () => handoff());
    const silent = await unmint(COUNCIL);
    expect(silent.status).toBe(200);
    expect(silent.body.signerListRead).toBeUndefined();
  });

  /**
   * LA CADENA, Y LO QUE DE VERDAD SE ROMPÍA. El navegador acuña las peticiones de
   * los miembros con la vida que el servidor declaró para ESTA fila
   * (`ceremonyPayloadExpiryMin`, front). Si la ventana de ledger que sale
   * de esa misma declaración no cubre esos minutos, el quórum firma bytes que ya
   * no pueden entrar: `tefMAX_LEDGER`, y la salida no aterriza jamás.
   */
  it('…y la ventana de ledger que sale de esa declaración CUBRE la vida del payload', async () => {
    mockQuorum.mockResolvedValue('quorum');
    await unmint(COUNCIL);

    const payloadMin = declaredPayloadMin();
    expect(payloadMin).toBe(handoffCeremonyExpiryMin()); // 24 h, no 5 minutos

    // Un ledger de XRPL cierra cada ~4 s; la ventana se mide en ledgers.
    const windowLedgers = defaultSeatWindowLedgers(payloadMin);
    const windowSeconds = windowLedgers * 4;
    expect(windowSeconds).toBeGreaterThanOrEqual(payloadMin * 60);

    // Y la comparación que importa: con la ventana de una firma simple NO cubría.
    const ordinaryWindowSeconds = defaultSeatWindowLedgers(handoffPayloadExpiryMin()) * 4;
    expect(ordinaryWindowSeconds).toBeLessThan(payloadMin * 60);
  });
});

describe('las dos reglas que esta puerta no puede romper', () => {
  it('una cuenta de firma simple NO se estira: su asiento sigue siendo el de siempre', async () => {
    mockQuorum.mockResolvedValue('single');
    await unmint(COUNCIL);

    expect(declaredCeremony()).toBe(false);
    expect(declaredPayloadMin()).toBe(handoffPayloadExpiryMin());
    // La ventana corta viene de una LECTURA — y se dice.
    expect(declaredRead()).toBe('single');
  });

  /**
   * «NO PUDE LEER» NO ESTIRA NADA. Un nodo caído no puede tapiar el nonce de una
   * cuenta corriente durante 24 h con código nuestro: se compone exactamente como
   * antes de esta iteración.
   */
  it('un SignerList ilegible compone como siempre — jamás una ventana más larga', async () => {
    mockQuorum.mockResolvedValue('unknown');
    await unmint(COUNCIL);
    expect(declaredCeremony()).toBe(false);
    // La MISMA ventana corta, pero declarada como NO leída — jamás
    // como «firma sola». Es la distinción que le faltaba al navegador.
    expect(declaredRead()).toBe('unknown');

    mockQuorum.mockRejectedValue(new Error('xrpl node down'));
    mockBuild.mockClear();
    const res = await unmint(COUNCIL);
    expect(res.status).toBe(200); // y no se cae la composición por ello
    expect(declaredCeremony()).toBe(false);
    expect(declaredRead()).toBe('unknown');
  });

  /**
   * UNA CUENTA QUE ASTRYUM OPERA TAMPOCO. Su 0xFE lo firma nuestra semilla en el
   * acto y su asiento de nonce sirve a TODOS los clientes de la run: estirarlo a
   * 24 h porque el omnibus lleva una designación sería tapiar la mesa entera.
   */
  it('una cuenta operativa no se estira aunque tenga SignerList', async () => {
    process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = COUNCIL;
    mockQuorum.mockResolvedValue('quorum');
    await unmint(COUNCIL);

    expect(declaredCeremony()).toBe(false);
    // No se estira Y no se lee — nadie miró, y no se dice «firma sola».
    expect(declaredRead()).toBe('unknown');
  });
});

describe('ninguna composición de este router puede volver a quedarse fuera', () => {
  /**
   * El fallo fue exactamente este: el arreglo existía y NADIE lo
   * llamaba. La pregunta vive dentro de `seatClaimOf`, que es el único objeto que
   * las catorce composiciones de este fichero extienden — así que se comprueba
   * que siguen siendo catorce y que todas lo extienden.
   */
  it('cada `build*Handoff` de flareDemo extiende `seatClaimOf`, que es quien pregunta', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'flareDemo.ts'), 'utf8') as string;
    const composes = src.match(/build(?:DirectMint|E1|E3|VaultEntry|VaultRotate)Handoff\(/g) ?? [];
    const claims = src.match(/\.\.\.\(await seatClaimOf\(req, \w+\)\),/g) ?? [];
    expect(composes.length).toBeGreaterThan(0);
    expect(claims.length).toBe(composes.length);
    expect(src).toContain('...(await ceremonyWindowFor(xrplAddress)),');
  });
});

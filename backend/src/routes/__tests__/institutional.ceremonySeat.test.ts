/**
 * productizer-it25 §2.1 — LA SALIDA DE UN POTE CON CONSEJO SE FIRMA DE VERDAD.
 *
 * EL FALLO QUE ESTO CIERRA, Y POR QUÉ NO SE VEÍA. La it. 23 construyó entera la
 * ventana de una ceremonia (`signingCeremony` → payload de 24 h + la
 * `LastLedgerSequence` que la cubre) y NADIE la llamaba: `grep signingCeremony`
 * daba cero fuera del servicio y de su propio test. Así que una salida
 * institucional de un pote con consejo seguía naciendo con el asiento de una
 * firma simple (~6 min) mientras cada miembro del quórum firmaba un payload de
 * 24 h (`lib/xrpl/councilSigning.ts`: `expire: 1440`). A los seis minutos la LLS
 * quedaba atrás y el consejo acababa firmando bytes que el ledger ya no admite:
 * **la salida multifirma no podía completarse.** El test que «probaba» el
 * arreglo llamaba al constructor directamente — probaba la pieza, no la cadena.
 *
 * POR ESO ESTE TEST ES DE CADENA: entra por la RUTA (`/pote-exit/prepare`), pasa
 * por la decisión de la ruta (`ceremonyWindowFor` → `signingCeremonyFor`, que LEE
 * el SignerList) y por el constructor REAL, y mira lo que sale por la respuesta —
 * los mismos bytes que el consejo va a firmar. Si cualquier eslabón se desconecta
 * otra vez, esto se pone rojo.
 *
 * Y las dos reglas que NO se tocan, probadas aquí mismo:
 *   · una cuenta de firma simple conserva su ventana de siempre (estirar su
 *     asiento de nonce a 24 h sería tapiarle el nonce un día entero);
 *   · «no pude leer» NO estira nada.
 */
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => '0xeeee000000000000000000000000000000000001'),
  getNonce: jest.fn(async () => 7n),
}));

const mockSignerQuorum = jest.fn();
const mockSave = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  readXrplSignerQuorum: (...a: unknown[]) => mockSignerQuorum(...a),
  findQueuedHandoffsByPersonalAccount: async () => [],
  listParked0xFe: async () => [],
  saveHandoffRecord: (...a: unknown[]) => mockSave(...a),
  readValidatedLedgerIndex: async () => VALIDATED,
  readHandoffMemoWindow: async () => ({ state: 'absent', rowsRead: 0 }),
}));

/**
 * El constructor del 0xFE va REAL a propósito: es el eslabón que esta iteración
 * acusa de estar suelto. Solo se fingen las lecturas de cadena que la RUTA hace
 * antes de llamarlo.
 */
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: jest.fn(),
  readMinimumRedeemAmountUBA: jest.fn(),
  readRedemptionFeeBips: jest.fn(),
  buildRedeemToXrplCall: jest.fn(),
}));

import institutionalRouter from '../institutional';
import { readPoteState, type AstryumPoteState } from '../../services/flare/AstryumPoteStateService';
import {
  readDirectMintParams,
  readMinimumRedeemAmountUBA,
  readRedemptionFeeBips,
  buildRedeemToXrplCall,
} from '../../connectors/protocols/flare/FlareDirectMintService';
import { SEAT_SECONDS_PER_LEDGER } from '../../services/flare/handoffAuthority';
import { _resetDemoCapState } from '../../config/demoCap';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const ASSET_MANAGER = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const COUNCIL_XRPL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const VALIDATED = 90_000_000;
/** Lo que vive el payload de una ceremonia en Xaman (`expire: 1440`). */
const CEREMONY_MIN = 1440;

function fixtureState(over: Partial<AstryumPoteState> = {}): AstryumPoteState {
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
    ...over,
  } as AstryumPoteState;
}

const ENV = { ...process.env };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  _resetDemoCapState();
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';
  delete process.env.HANDOFF_PAYLOAD_EXPIRY_MIN;
  delete process.env.HANDOFF_CEREMONY_EXPIRY_MIN;
  delete process.env.HANDOFF_LLS_WINDOW;
  delete process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS;

  (readPoteState as jest.Mock).mockResolvedValue(fixtureState());
  (readMinimumRedeemAmountUBA as jest.Mock).mockResolvedValue(0n);
  (readRedemptionFeeBips as jest.Mock).mockResolvedValue(18);
  (readDirectMintParams as jest.Mock).mockResolvedValue({
    fxrpToken: ASSET,
    paymentAddress: 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj',
    minFeeUBA: 100000n,
    feeBIPS: 10n,
    executorFeeUBA: 200000n,
    granularityUBA: 1n,
  });
  (buildRedeemToXrplCall as jest.Mock).mockImplementation(async () => ({
    to: ASSET_MANAGER,
    value: '0',
    calldata: '0x' + 'ab'.repeat(4),
  }));
  mockSave.mockResolvedValue(true);
  jest.spyOn(ethers, 'Contract').mockImplementation(
    () =>
      ({
        maxRedeem: async () => 1_000_000_000n,
        balanceOf: async () => 1_000_000_000n,
        previewRedeem: async () => 1_000_000n,
      }) as unknown as ethers.Contract,
  );
});

afterAll(() => {
  process.env = ENV;
});

const exitPrepare = () =>
  request(app).post('/api/institutional/pote-exit/prepare').send({ account: COUNCIL_XRPL, pote: POTE });

describe('la salida de un pote con CONSEJO nace con una ventana que cubre su ceremonia', () => {
  it('el 0xFE que va a firmar el quórum sigue pudiendo entrar durante las 24 h que vive su payload', async () => {
    mockSignerQuorum.mockResolvedValue('quorum');

    const res = await exitPrepare();
    expect(res.status).toBe(200);

    // 1) La ruta preguntó por ESTA cuenta, no por otra ni por ninguna.
    expect(mockSignerQuorum).toHaveBeenCalledWith(COUNCIL_XRPL);

    // 2) La respuesta dice la vida REAL del payload que el consejo va a firmar.
    expect(res.body.payloadExpiryMin).toBe(CEREMONY_MIN);
    // it. 31 (§5): …y que esa ventana es una LECTURA, no una conjetura.
    expect(res.body.signerListRead).toBe('quorum');

    // 3) Y —lo que mata la salida si falla— la ventana de ledger LA CUBRE: pasada
    //    la LLS, ni firmado entra el Payment. Es la comprobación que no se podía
    //    hacer con el constructor suelto, porque la ventana la decide la cadena
    //    entera: ruta → lectura del SignerList → constructor → bytes.
    const lls = res.body.xrplTx?.LastLedgerSequence;
    expect(typeof lls).toBe('number');
    const windowSeconds = (lls - VALIDATED) * SEAT_SECONDS_PER_LEDGER;
    expect(windowSeconds).toBeGreaterThanOrEqual(CEREMONY_MIN * 60);

    // 4) Y el registro guarda esa misma ventana: el asiento se mide con lo que
    //    se firmó, no con el reloj de una firma simple.
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ payloadExpiryMin: CEREMONY_MIN, lastLedgerSequence: lls }),
    );
  });

  /**
   * La otra mitad de la regla: estirar a 24 h el asiento de nonce de una cuenta
   * normal sería tapiarle el nonce un día entero. El carril PERSONAL (manager ==
   * usuario) usa ESTA MISMA ruta, así que la forma de la ruta no puede decidirlo.
   */
  it('una cuenta de firma simple conserva su ventana de siempre', async () => {
    mockSignerQuorum.mockResolvedValue('single');

    const res = await exitPrepare();
    expect(res.status).toBe(200);
    expect(res.body.payloadExpiryMin).toBe(5);
    // it. 31 (§5): la ventana corta viene de una lectura que dijo «firma sola»
    // — SOLO con esto puede el navegador ahorrarse su propia lectura del SignerList.
    expect(res.body.signerListRead).toBe('single');
    const windowSeconds = (res.body.xrplTx.LastLedgerSequence - VALIDATED) * SEAT_SECONDS_PER_LEDGER;
    expect(windowSeconds).toBeLessThan(CEREMONY_MIN * 60);
    expect(windowSeconds).toBeGreaterThanOrEqual(5 * 60);
  });

  it('«no pude leer» NO estira ninguna ventana — ni la lectura ilegible ni la que revienta', async () => {
    mockSignerQuorum.mockResolvedValue('unknown');
    const unreadable = await exitPrepare();
    expect(unreadable.status).toBe(200);
    expect(unreadable.body.payloadExpiryMin).toBe(5);
    // it. 31 (§5) — LA MITAD QUE it. 29 DIO POR HECHA. La misma ventana de 5 min
    // sale de un «firma sola» leído y de un «no pude leer»; antes de este campo el
    // navegador tomaba las dos por la primera y dejaba de mirar el SignerList — una
    // cuenta con quórum cuyo nodo no contestó acababa en firma simple con la
    // Sequence autorrellenada. El servidor dice ahora que NO leyó, y el navegador
    // vuelve a preguntar (`useXrplWalletPartner.quorumRouting.test.ts`).
    expect(unreadable.body.signerListRead).toBe('unknown');

    mockSignerQuorum.mockRejectedValue(new Error('every XRPL node refused'));
    const threw = await exitPrepare();
    // Y tampoco tira la salida al suelo: se compone igual, con la ventana de siempre.
    expect(threw.status).toBe(200);
    expect(threw.body.payloadExpiryMin).toBe(5);
    expect(threw.body.signerListRead).toBe('unknown');
  });

  /**
   * it. 31 (§5): una cuenta que Astryum OPERA no se lee (su 0xFE lo firma nuestra
   * semilla). Eso NO es «firma sola»: nadie miró, y se dice. Esta puerta contesta
   * 403 a una cuenta operativa antes de componer, así que la declaración se
   * comprueba sobre la función que todas las rutas envuelven, con sus lectores
   * inyectados — la cadena ruta→lectura→respuesta ya está probada arriba.
   */
  it('una cuenta operativa no se estira y tampoco se declara «firma sola»: nadie la leyó', async () => {
    const { signingCeremonyFor } = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
    const readSignerQuorum = jest.fn(async () => 'single' as const);

    const out = await signingCeremonyFor(COUNCIL_XRPL, {
      readOperationalAccount: async () => 'yes' as const,
      readSignerQuorum,
    });

    expect(out).toEqual({ signerListRead: 'unknown' });
    expect(readSignerQuorum).not.toHaveBeenCalled();
    // …y cuando ni siquiera se sabe si es nuestra, tampoco se afirma nada.
    expect(
      await signingCeremonyFor(COUNCIL_XRPL, {
        readOperationalAccount: async () => {
          throw new Error('registry down');
        },
        readSignerQuorum,
      }),
    ).toEqual({ signerListRead: 'unknown' });
    expect(readSignerQuorum).not.toHaveBeenCalled();
  });
});

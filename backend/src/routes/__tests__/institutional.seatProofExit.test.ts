/**
 * Hallazgo 1.1 — **EL FALLO QUE ENCONTRARON CUATRO REVISORES POR
 * SEPARADO, Y ESTÁ EN EL CARRIL QUE MUEVE EL DINERO DEL CLIENTE.**
 */
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

jest.mock('../../services/flare/handoffAuthority', () => ({
  ...jest.requireActual('../../services/flare/handoffAuthority'),
  sessionAuthorityOnXrplAccount: jest.fn(),
  sessionMayActOnXrplAccount: jest.fn(),
}));

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(),
}));

jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: jest.fn(),
  computeNetMint: jest.fn(),
  buildDirectMintHandoff: jest.fn(),
  buildRedeemToXrplCall: jest.fn(),
  readMinimumRedeemAmountUBA: jest.fn(),
  readRedemptionFeeBips: jest.fn(),
  mintFeeDisclosure: jest.fn(),
  // La ruta pregunta al ledger si esa cuenta firma por QUÓRUM antes
  // de componer. Aquí se finge para que la suite siga siendo HERMÉTICA (sin RPC,
  // sin ledger): lo que decide esa ventana se prueba de punta a punta en
  // `institutional.ceremonySeat.test.ts`.
  signingCeremonyFor: jest.fn(async () => ({})),
}));

import institutionalRouter from '../institutional';
import { readPoteState, type AstryumPoteState } from '../../services/flare/AstryumPoteStateService';
import { resolvePersonalAccount } from '../../connectors/protocols/flare/FlareSmartAccountService';
import { sessionAuthorityOnXrplAccount } from '../../services/flare/handoffAuthority';
import {
  buildDirectMintHandoff,
  buildRedeemToXrplCall,
  computeNetMint,
  mintFeeDisclosure,
  readDirectMintParams,
  readMinimumRedeemAmountUBA,
  readRedemptionFeeBips,
} from '../../connectors/protocols/flare/FlareDirectMintService';
import { _resetDemoCapState } from '../../config/demoCap';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const ASSET_MANAGER = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const PA = '0xeeee000000000000000000000000000000000001';
const XRPL_ACCOUNT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';

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

function mockVault(opts: { maxRedeem: bigint; balance: bigint; preview: bigint }) {
  jest.spyOn(ethers, 'Contract').mockImplementation(
    () =>
      ({
        maxRedeem: async () => opts.maxRedeem,
        balanceOf: async () => opts.balance,
        previewRedeem: async () => opts.preview,
      }) as unknown as ethers.Contract,
  );
}

/** El veredicto «probada»: la sesión controla la cuenta. */
const PROVEN = { mayAct: true, refusal: null, failure: null, outcome: 'proven' as const };
/** «No pude leer», y es METEOROLOGÍA (la consulta falló): en una salida, 503 reintentable. */
const COULD_NOT_READ = {
  mayAct: false,
  refusal: { status: 503 as const, error: 'PROOF_STORE_UNREADABLE' as const, detail: 'db down', retryable: true },
  failure: 'read-failed' as const,
  outcome: 'could-not-read' as const,
};
/** «No pude leer», pero DETERMINISTA: la fila de usuario no existe. Esperar no lo cura. */
const DETERMINISTIC = {
  mayAct: false,
  refusal: {
    status: 409 as const,
    error: 'ACCOUNT_RECORD_MISSING' as const,
    detail: 'no user row',
    retryable: false,
  },
  failure: 'no-user-row' as const,
  outcome: 'could-not-read' as const,
};
/** Un «no» de verdad: la tienda se leyó y esta sesión no tiene esa cuenta. */
const NOT_PROVEN = {
  mayAct: false,
  refusal: { status: 403 as const, error: 'ADDRESS_NOT_PROVEN' as const, detail: 'not yours', retryable: false },
  failure: null,
  outcome: 'not-proven' as const,
};

const ENV = { ...process.env };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  _resetDemoCapState();
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';

  (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(PROVEN);
  (readPoteState as jest.Mock).mockResolvedValue(fixtureState());
  (resolvePersonalAccount as jest.Mock).mockResolvedValue(PA);
  (readMinimumRedeemAmountUBA as jest.Mock).mockResolvedValue(0n);
  (readRedemptionFeeBips as jest.Mock).mockResolvedValue(18);
  (readDirectMintParams as jest.Mock).mockResolvedValue({ executorFeeUBA: 200000n });
  (computeNetMint as jest.Mock).mockReturnValue({ supplyUBA: 700000n, netToPersonalAccountUBA: 700000n });
  (mintFeeDisclosure as jest.Mock).mockReturnValue({ mintFee: '0.3' });
  (buildRedeemToXrplCall as jest.Mock).mockResolvedValue({
    to: ASSET_MANAGER,
    value: '0',
    calldata: '0x' + 'ab'.repeat(4),
  });
  (buildDirectMintHandoff as jest.Mock).mockImplementation(async (_p, input) => ({
    xrplPayment: { TransactionType: 'Payment', Account: input.xrplAddress },
    memoHex: '0xfe00',
    userOpData: '0xuserop',
    personalAccount: PA,
  }));
  mockVault({ maxRedeem: 1_000_000_000n, balance: 1_000_000_000n, preview: 1_000_000n });
});

afterAll(() => {
  process.env = ENV;
});

const exitBody = { account: XRPL_ACCOUNT, pote: POTE };
const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(`/api/institutional/${path}`).send(body);

describe('La prueba del asiento en una SALIDA', () => {
  it('la salida pregunta con propósito «exit», no con el «entry» por defecto', async () => {
    const res = await post('pote-exit/prepare', exitBody);

    expect(res.status).toBe(200);
    expect(sessionAuthorityOnXrplAccount).toHaveBeenCalledWith(expect.anything(), XRPL_ACCOUNT, 'exit');
  });

  it('una sesión probada compone con el PAR completo: probada y «pude preguntar»', async () => {
    await post('pote-exit/prepare', exitBody);

    expect((buildDirectMintHandoff as jest.Mock).mock.calls[0][1]).toMatchObject({
      preparedByProven: true,
      preparedByProofUnreadable: false,
    });
  });

  /**
   * EL GEMELO, EN UNA SOLA PRUEBA. Con la tienda caída la ruta no puede saber si esta
   * sesión puede reclamar el asiento: no compone nada (así no nace una fila que el
   * siguiente prepare aparte) y contesta 503 REINTENTABLE — «no pude leer» no es ni
   * permiso ni castigo, y desde luego no es un hecho.
   */
  it('un parpadeo de la tienda de pruebas → 503 reintentable y NADA compuesto', async () => {
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(COULD_NOT_READ);

    const res = await post('pote-exit/prepare', exitBody);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROOF_STORE_UNREADABLE', retryable: true });
    // Ni 409 (eso sería «el asiento está ocupado», que es otra cosa) ni un 200 mudo.
    expect(buildDirectMintHandoff).not.toHaveBeenCalled();
  });

  it('la rama de COLA (requestRedeem) cuenta la misma avería igual — no es otra puerta', async () => {
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(COULD_NOT_READ);
    (readPoteState as jest.Mock).mockResolvedValue(
      fixtureState({ cooldownSeconds: 86_400, tickets: [] as AstryumPoteState['tickets'] }),
    );

    const queued = await post('pote-exit/prepare', exitBody);
    expect(queued.status).toBe(503);
    expect(queued.body.retryable).toBe(true);
    expect(buildDirectMintHandoff).not.toHaveBeenCalled();
  });

  /**
   * Y LA OTRA MITAD DEL INVARIANTE: una causa DETERMINISTA (la fila de usuario no
   * existe) no se convierte en una espera perpetua ni cierra la salida. Se compone
   * igual, con el par diciendo la verdad — «no probada» **y** «no pude preguntar» —
   * para que ninguna regla de asiento aparte esa fila creyendo que su dueño no prueba.
   */
  it('una causa DETERMINISTA no para la salida: compone, y la fila lleva «no pude preguntar»', async () => {
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(DETERMINISTIC);

    const res = await post('pote-exit/prepare', exitBody);

    expect(res.status).toBe(200);
    expect((buildDirectMintHandoff as jest.Mock).mock.calls[0][1]).toMatchObject({
      preparedByProven: false,
      preparedByProofUnreadable: true,
    });
  });

  it('un «no» de verdad tampoco cierra la salida, y NO se marca como ilegible', async () => {
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(NOT_PROVEN);

    const res = await post('pote-exit/prepare', exitBody);

    expect(res.status).toBe(200);
    expect((buildDirectMintHandoff as jest.Mock).mock.calls[0][1]).toMatchObject({
      preparedByProven: false,
      preparedByProofUnreadable: false,
    });
  });

  /** `supersede` es autoridad sobre el borrador firmable de otro: jamás sobre una lectura fallida. */
  it('con la tienda ilegible, «supersede» no se concede — se responde 503 antes', async () => {
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue(COULD_NOT_READ);

    const res = await post('pote-exit/prepare', { ...exitBody, supersede: true });

    expect(res.status).toBe(503);
    expect(buildDirectMintHandoff).not.toHaveBeenCalled();
  });

  it('probada + supersede: el desplazamiento se autoriza desde el MISMO veredicto', async () => {
    await post('pote-exit/prepare', { ...exitBody, supersede: true });

    expect((buildDirectMintHandoff as jest.Mock).mock.calls[0][1]).toMatchObject({
      supersedePendingNonce: true,
      supersedeAuthorized: true,
      preparedByProven: true,
    });
  });
});

describe('La ENTRADA sigue fallando cerrada, pero marca la fila', () => {
  it('pregunta con «entry» y, con la tienda caída, compone con «no pude preguntar»', async () => {
    // Fiel al módulo real: la MISMA avería produce un refusal distinto según el
    // propósito — 503 reintentable en una salida, 403 que falla cerrado en una
    // entrada (`refusalForUnreadableStore`). Por eso una entrada nunca lanza aquí.
    (sessionAuthorityOnXrplAccount as jest.Mock).mockResolvedValue({
      ...COULD_NOT_READ,
      refusal: { status: 403, error: 'ADDRESS_NOT_PROVEN', detail: 'fail-closed', retryable: false },
    });

    const res = await post('pote-fund-xrp/prepare', { account: XRPL_ACCOUNT, pote: POTE, amountXrp: '10' });

    expect(res.status).toBe(200);
    expect(sessionAuthorityOnXrplAccount).toHaveBeenCalledWith(expect.anything(), XRPL_ACCOUNT, 'entry');
    // Falla cerrada (no está probada) — pero la fila NO queda en la clase desplazable.
    expect((buildDirectMintHandoff as jest.Mock).mock.calls[0][1]).toMatchObject({
      preparedByProven: false,
      preparedByProofUnreadable: true,
    });
  });
});

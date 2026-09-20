/**
 * `/pote-exit/prepare` — salir por donde se entró.
 *
 * Quien entra con su cuenta XRPL tiene las participaciones en su Personal
 * Account, que no firma sola. Hasta esta ruta, las dos mitades del camino de
 * vuelta existían sueltas y nadie las encadenaba: se podía entrar y no salir.
 *
 * Lo que se prueba aquí no es «devuelve 200», es lo que hace al usuario:
 *  · el destino del XRP es SU r-address, la misma que firma — no un campo del body
 *  · el dueño de las participaciones se DERIVA on-chain, no se teclea
 *  · el unmint es OPT-IN (c42050c1): por defecto el FXRP se queda en la PA —
 *    una sola pierna; con `unmint: true` se encadena el desminteo a XRP
 *  · se pide desmintear menos de lo previsto (pedir de más revierte el batch)
 *  · lo que sale no se capa ni se geofencea; el carrier del 0xFE sí se capa
 *  · sin liquidez, el error dice qué hacer en vez de invitar a firmar algo condenado
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
  // it. 25 (§2.1): la ruta pregunta al ledger si esa cuenta firma por QUÓRUM antes
  // de componer. Aquí se finge para que la suite siga siendo HERMÉTICA (sin RPC,
  // sin ledger): lo que decide esa ventana se prueba de punta a punta en
  // `institutional.ceremonySeat.test.ts`.
  signingCeremonyFor: jest.fn(async () => ({})),
}));

import institutionalRouter from '../institutional';
import { readPoteState, type AstryumPoteState } from '../../services/flare/AstryumPoteStateService';
import { resolvePersonalAccount } from '../../connectors/protocols/flare/FlareSmartAccountService';
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

const REDEEM_IFACE = new ethers.Interface([
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
]);

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

/** El vault on-chain que la ruta consulta: maxRedeem / balanceOf / previewRedeem. */
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

const ENV = { ...process.env };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  _resetDemoCapState();
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';

  (readPoteState as jest.Mock).mockResolvedValue(fixtureState());
  (resolvePersonalAccount as jest.Mock).mockResolvedValue(PA);
  (readMinimumRedeemAmountUBA as jest.Mock).mockResolvedValue(0n);
  (readRedemptionFeeBips as jest.Mock).mockResolvedValue(18);
  (readDirectMintParams as jest.Mock).mockResolvedValue({ executorFeeUBA: 200000n });
  (computeNetMint as jest.Mock).mockReturnValue({
    supplyUBA: 700000n,
    netToPersonalAccountUBA: 700000n,
  });
  (mintFeeDisclosure as jest.Mock).mockReturnValue({ mintFee: '0.3' });
  (buildRedeemToXrplCall as jest.Mock).mockImplementation(async (_p, input) => ({
    to: ASSET_MANAGER,
    value: '0',
    calldata: '0x' + 'ab'.repeat(4),
    __amountUBA: input.amountUBA,
    __dest: input.xrplDestination,
  }));
  (buildDirectMintHandoff as jest.Mock).mockImplementation(async (_p, input) => ({
    xrplPayment: { TransactionType: 'Payment', Account: input.xrplAddress },
    memoHex: '0xfe00',
    userOpData: '0xuserop',
    personalAccount: PA,
    __innerCalls: input.innerCalls,
    __action: input.action,
  }));
  mockVault({ maxRedeem: 1_000_000_000n, balance: 1_000_000_000n, preview: 1_000_000n });
});

afterAll(() => {
  process.env = ENV;
});

describe('el camino de vuelta', () => {
  /**
   * it. 19 (hallazgo 3.4, encargo del agente D) — LA SALIDA DICE SI EL SERVIDOR
   * ENTREGA. Sin `serverDelivery` la pantalla no puede distinguir «va en camino» de
   * «no llega nada salvo que lo relances tú», y se quedaba neutra justo en la salida.
   * El campo dice lo que el servidor SABE: si el vigía que entrega el 0xFE corre.
   */
  it('la respuesta lleva serverDelivery — el 0xFE de una salida también lo entrega el vigía', async () => {
    delete process.env.FLARE_EXECUTOR_ENABLED;
    const off = await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE });
    expect(off.status).toBe(200);
    expect(off.body.serverDelivery).toEqual({ executorEnabled: false });

    process.env.FLARE_EXECUTOR_ENABLED = 'true';
    const on = await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE });
    expect(on.body.serverDelivery).toEqual({ executorEnabled: true });
    delete process.env.FLARE_EXECUTOR_ENABLED;
  });

  it('el XRP vuelve a la MISMA cuenta que firma — el destino no es un campo del body', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      // Un destino inyectado en el body no debe llegar a ninguna parte.
      .send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true, xrplDestination: 'rATTACKERxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(res.status).toBe(200);
    const call = (buildRedeemToXrplCall as jest.Mock).mock.results[0].value;
    await expect(call).resolves.toMatchObject({ __dest: XRPL_ACCOUNT });
    expect(res.body.disclosure.facts.xrplDestination).toBe(XRPL_ACCOUNT);
  });

  it('el dueño de las participaciones se DERIVA de la cuenta XRPL, no se teclea', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(resolvePersonalAccount).toHaveBeenCalledWith(expect.anything(), XRPL_ACCOUNT);
    expect(res.body.personalAccount).toBe(PA);

    // Y el redeem sale a nombre de esa PA, como owner Y como receiver.
    const handoff = await (buildDirectMintHandoff as jest.Mock).mock.results[0].value;
    const [, receiver, owner] = REDEEM_IFACE.decodeFunctionData('redeem', handoff.__innerCalls[0].calldata);
    expect(String(receiver).toLowerCase()).toBe(PA.toLowerCase());
    expect(String(owner).toLowerCase()).toBe(PA.toLowerCase());
  });

  it('con unmint: encadena las dos piernas en orden — sale del pote, luego desmintea', async () => {
    await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });

    const handoff = await (buildDirectMintHandoff as jest.Mock).mock.results[0].value;
    expect(handoff.__innerCalls).toHaveLength(2);
    expect(handoff.__innerCalls[0].to.toLowerCase()).toBe(POTE.toLowerCase());
    expect(handoff.__innerCalls[1].to.toLowerCase()).toBe(ASSET_MANAGER.toLowerCase());
    expect(handoff.__action).toBe('astryum-pote-exit');
  });

  it('pide desmintear MENOS de lo previsto — pedir de más revertiría el batch entero', async () => {
    mockVault({ maxRedeem: 1_000_000_000n, balance: 1_000_000_000n, preview: 1_000_000n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });

    expect(BigInt(res.body.exit.unmintUBA)).toBeLessThan(BigInt(res.body.exit.previewedUBA));
    // Y el margen no desaparece: sigue siendo del usuario.
    expect(BigInt(res.body.exit.unmintUBA) + BigInt(res.body.exit.marginUBA)).toBe(
      BigInt(res.body.exit.previewedUBA),
    );
  });

  it('lo dice en el disclosure: el margen no se pierde', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });

    const lines: string[] = res.body.disclosure.lines;
    expect(lines.join(' ')).toMatch(/NO se pierde/i);
    expect(res.body.disclosure.astryumSigns).toBe(false);
  });
});

describe('la comisión de redención de FAssets (productizer it. 13, hallazgo 4.2)', () => {
  it('con unmint: cifra viva sobre lo que DE VERDAD se desmintea, BRUTO y NETO en campos distintos (it. 15, 3.2)', async () => {
    const res = await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });
    expect(res.status).toBe(200);
    const unmintUBA = BigInt(res.body.exit.unmintUBA);
    expect(readRedemptionFeeBips).toHaveBeenCalled();
    expect(res.body.disclosure.redemptionFeeBips).toBe(18);
    expect(res.body.disclosure.redemptionFeeFxrp).toBe(Number((unmintUBA * 18n) / 10_000n) / 1_000_000);
    // `xrpOutHuman` es el BRUTO (lo que se desmintea): la pantalla resta la comisión
    // UNA vez, y el neto del servidor viaja aparte para poder compararlos.
    expect(res.body.exit.xrpOutHuman).toBe(ethers.formatUnits(unmintUBA, 6));
    const netUBA = unmintUBA - (unmintUBA * 18n) / 10_000n;
    expect(res.body.exit.xrpOutNetHuman).toBe(ethers.formatUnits(netUBA, 6));
    expect(res.body.exit.xrpOutNetOfRedemptionFee).toBe(false);
    expect(res.body.disclosure.facts.estXrpOut).toBe(res.body.exit.xrpOutNetHuman);
    expect(res.body.disclosure.facts.unmintedFxrp).toBe(res.body.exit.xrpOutHuman);
    const lines = res.body.disclosure.lines.join(' ');
    expect(lines).toContain('0.18%');
    expect(lines).toMatch(/cuando el agente de FAssets pague/);
    // las dos cifras se dicen juntas y coinciden con los campos
    expect(lines).toContain(`≈ ${res.body.exit.xrpOutNetHuman} XRP netos`);
    expect(lines).toContain(`se desmintean ${res.body.exit.xrpOutHuman}`);
  });

  it('ilegible: el neto es null y una línea que dice que NO es cero — jamás 0, y el bruto sigue siendo el bruto', async () => {
    (readRedemptionFeeBips as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });
    expect(res.status).toBe(200);
    expect(res.body.disclosure.redemptionFeeBips).toBeNull();
    expect(res.body.disclosure.redemptionFeeFxrp).toBeNull();
    expect(res.body.exit.xrpOutNetHuman).toBeNull();
    expect(res.body.exit.xrpOutHuman).toBe(ethers.formatUnits(BigInt(res.body.exit.unmintUBA), 6));
    expect(res.body.exit.xrpOutNetOfRedemptionFee).toBe(false);
    expect(res.body.disclosure.facts.estXrpOut).toBeNull();
    expect(res.body.disclosure.lines.join(' ')).toMatch(/NO es cero/);
  });

  it('sin unmint no hay redención: ni se lee ni se divulga', async () => {
    const res = await request(app).post('/api/institutional/pote-exit/prepare').send({ account: XRPL_ACCOUNT, pote: POTE });
    expect(res.status).toBe(200);
    expect(res.body.disclosure).not.toHaveProperty('redemptionFeeBips');
    expect(readRedemptionFeeBips).not.toHaveBeenCalled();
  });
});

describe('el default: el FXRP se queda en la PA (unmint opt-in, c42050c1)', () => {
  it('sin `unmint` hay UNA pierna (redeem al pote) y el desminteo NI SE COMPONE', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sync-fxrp');
    expect(res.body.unminted).toBe(false);
    expect(buildRedeemToXrplCall).not.toHaveBeenCalled();

    const handoff = await (buildDirectMintHandoff as jest.Mock).mock.results[0].value;
    expect(handoff.__innerCalls).toHaveLength(1);
    expect(handoff.__innerCalls[0].to.toLowerCase()).toBe(POTE.toLowerCase());
    expect(handoff.__action).toBe('astryum-pote-exit-fxrp');
  });

  it('y el disclosure lo dice: el FXRP queda en TU cuenta Flare, sin destino XRPL', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.body.exit.unmintUBA).toBe('0');
    expect(res.body.disclosure.facts.xrplDestination).toBeNull();
    expect(res.body.disclosure.lines.join(' ')).toMatch(/cuenta Flare/);
  });
});

describe('lo que NO se puede firmar', () => {
  it('sin participaciones: 409 en vez de un batch vacío', async () => {
    mockVault({ maxRedeem: 0n, balance: 0n, preview: 0n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_SHARES');
  });

  it('con saldo pero sin liquidez, el error dice QUÉ hacer', async () => {
    mockVault({ maxRedeem: 0n, balance: 1_000_000_000n, preview: 0n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_REDEEMABLE_NOW');
    expect(res.body.detail).toMatch(/recall|colchón/i);
  });

  it('pedir más de lo que se tiene: 409, no un revert en cadena', async () => {
    mockVault({ maxRedeem: 1_000_000_000n, balance: 500n, preview: 1000n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, sharesBase: '1000' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_ENOUGH_SHARES');
  });

  it('por encima de maxRedeem: 409 con la cifra real que sí se puede', async () => {
    mockVault({ maxRedeem: 400n, balance: 1000n, preview: 1000n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, sharesBase: '900' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ABOVE_MAX_REDEEM');
    expect(res.body.facts.maxRedeem).toBe('400');
  });

  it('si tras el margen no llega al mínimo de FAssets, se dice antes de firmar', async () => {
    (readMinimumRedeemAmountUBA as jest.Mock).mockResolvedValue(999_000n);
    mockVault({ maxRedeem: 1_000_000_000n, balance: 1_000_000_000n, preview: 1_000_000n });

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, unmint: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BELOW_FASSETS_MINIMUM');
  });

  it('una r-address inválida no llega a tocar cadena', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: '0xnotanxrpladdress', pote: POTE });

    expect(res.status).toBe(400);
    expect(resolvePersonalAccount).not.toHaveBeenCalled();
  });
});

describe('cap y geofence — se capa la gasolina, nunca la salida', () => {
  it('la salida NO se bloquea por región', async () => {
    process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, region: 'US' });

    expect(res.status).toBe(200);
  });

  it('el CARRIER sí se capa: mintea de verdad y gasta presupuesto del executor', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '5';

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrpForMint: '50' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('un carrier normal pasa el cap', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '5';

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrpForMint: '2' });

    expect(res.status).toBe(200);
  });

  it('sin carrier explícito, el default CABE bajo el tope por tx (1 XRP) — la salida ya no se rechaza sola', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '1';

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.status).toBe(200);
    expect(res.body.disclosure.lines.join(' ')).toContain('Carrier del 0xFE: 1 XRP');
  });

  it('con un tope por tx holgado, el default sigue siendo el de siempre (2 XRP)', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.status).toBe(200);
    expect(res.body.disclosure.lines.join(' ')).toContain('Carrier del 0xFE: 2 XRP');
  });
});

// ── La entrada: el receiver tampoco se teclea ────────────────────────────────

describe('entrada no-custodial — el receiver se deriva, no se escribe', () => {
  it('sin receiver en el body, las participaciones van a SU Personal Account', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-fund-xrp/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrp: '10' });

    expect(res.status).toBe(200);
    // La ruta devuelve la dirección con checksum EIP-55 (getAddress la normaliza).
    expect(res.body.receiver.toLowerCase()).toBe(PA.toLowerCase());
    expect(res.body.disclosure.facts.sharesToOwnAccount).toBe(true);
    expect(res.body.disclosure.lines.join(' ')).toMatch(/TU cuenta de Flare/);
  });

  it('con receiver explícito (modo custodial) sigue funcionando, y el copy lo advierte', async () => {
    const OTHER = '0xabcd000000000000000000000000000000000009';

    const res = await request(app)
      .post('/api/institutional/pote-fund-xrp/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrp: '10', receiver: OTHER });

    expect(res.status).toBe(200);
    expect(res.body.receiver.toLowerCase()).toBe(OTHER.toLowerCase());
    expect(res.body.disclosure.facts.sharesToOwnAccount).toBe(false);
    // Que las participaciones vayan a otra cuenta no se puede decir de pasada.
    expect(res.body.disclosure.lines.join(' ')).toMatch(/distinta de la tuya/);
  });

  it('un receiver presente pero inválido es un 400, nunca un silencioso «pues a la PA»', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-fund-xrp/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrp: '10', receiver: 'no-es-una-direccion' });

    expect(res.status).toBe(400);
  });
});

/**
 * El invariante de aprobaciones (Orden de Trabajo 22-ago §2):
 *
 *   «Ningún flujo de producto puede pedir al cliente que apruebe al operador
 *    sobre sus participaciones.»
 *
 * AstryumVault hereda ERC-20 sin tocar approve/transferFrom: un
 * `approve(operador, MAX)` sobre las SHARES dejaría al operador llevárselas
 * (y en el pote síncrono, redimirlas él eligiendo receiver). Hoy ningún flujo
 * lo pide — este test existe para que SIGA siendo verdad: si mañana una ruta
 * compone un approve cuyo spender sea el director o el consejo, esto se pone
 * rojo antes de que llegue a producción.
 *
 * Dos capas, como el tripwire de flareDemo.capRoutes:
 *  1) RUNTIME — se llama a la ruta real (lector mockeado) y se DECODIFICAN
 *     los calls devueltos: todo approve tiene spender == el propio pote.
 *  2) FUENTE — barrido del código de institutional.ts: cada
 *     encodeFunctionData('approve' nombra a state.pote como spender.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

import institutionalRouter from '../institutional';
import {
  readPoteState,
  type AstryumPoteState,
} from '../../services/flare/AstryumPoteStateService';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

// En minúsculas: ethers acepta lowercase como «sin checksum». Una dirección
// con mayúsculas y checksum EIP-55 inválido revienta el encode — exactamente
// el caso que cazó la primera ejecución de este test (y que ahora la ruta
// convierte en 400 vía parseEvmAddress en lugar de colgarse).
const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const DIRECTOR = '0xdddd000000000000000000000000000000000001';
const COUNCIL = '0xcccc000000000000000000000000000000000001';
const CLIENT = '0xeeee000000000000000000000000000000000001';

const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);
const APPROVE_SELECTOR = ERC20_IFACE.getFunction('approve')!.selector;

function fixtureState(): AstryumPoteState {
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
    venues: [
      {
        id: 0,
        target: '0xAAaa000000000000000000000000000000000001',
        kind: 'compoundv2',
        readyAt: 0,
        retired: false,
        basis: '90000000000',
        value: '90000000000',
        queuedTotal: '0',
      },
    ],
    tickets: [],
    governance: {
      council: COUNCIL,
      constitutionRef: '0x' + '11'.repeat(32),
      director: DIRECTOR,
      directorUntil: Math.floor(Date.now() / 1000) + 30 * 86_400,
      payees: [{ account: DIRECTOR, bps: 1000 }],
    },
  };
}

beforeEach(() => {
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  delete process.env.POTE_CREDENTIAL_GATED;
  delete process.env.INSTITUTIONAL_FEE_COLLECTOR;
  delete process.env.INSTITUTIONAL_REDEEM_FEE_BPS;
  (readPoteState as jest.Mock).mockResolvedValue(fixtureState());
});

afterEach(() => {
  delete process.env.INSTITUTIONAL_POTES_ENABLED;
});

interface PreparedCall {
  to: string;
  data: string;
}

/** Cada approve de una respuesta, decodificado: {token, spender}. */
function decodeApproves(calls: PreparedCall[]): Array<{ token: string; spender: string }> {
  return calls
    .filter((c) => c.data.toLowerCase().startsWith(APPROVE_SELECTOR.toLowerCase()))
    .map((c) => {
      const [spender] = ERC20_IFACE.decodeFunctionData('approve', c.data);
      return { token: c.to, spender: String(spender) };
    });
}

describe('institutional — ningún approve nombra jamás al operador (invariante §2)', () => {
  it('el depósito aprueba SOLO el activo, y SOLO hacia el propio pote', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: CLIENT });
    expect(res.status).toBe(200);

    const approves = decodeApproves(res.body.calls);
    expect(approves.length).toBeGreaterThan(0); // el approve del FXRP existe…
    for (const a of approves) {
      // …apunta al pote, y jamás al director ni al consejo.
      expect(a.spender.toLowerCase()).toBe(POTE.toLowerCase());
      expect(a.token.toLowerCase()).toBe(ASSET.toLowerCase()); // activo, no shares
      expect(a.spender.toLowerCase()).not.toBe(DIRECTOR.toLowerCase());
      expect(a.spender.toLowerCase()).not.toBe(COUNCIL.toLowerCase());
    }
    // Y ningún approve toca el token de participaciones (el pote mismo).
    expect(approves.some((a) => a.token.toLowerCase() === POTE.toLowerCase())).toBe(false);
  });

  it('salida, dirección y retirada no componen NINGÚN approve', async () => {
    const bodies: Array<[string, Record<string, unknown>]> = [
      ['/pote-redeem/prepare', { pote: POTE, sharesBase: '1000', receiver: CLIENT, owner: CLIENT }],
      ['/pote-direct/prepare', { pote: POTE, venueId: 0, amountBase: '1000000' }],
      ['/pote-recall/prepare', { pote: POTE, venueId: 0, amountBase: '1000000' }],
    ];
    for (const [path, body] of bodies) {
      const res = await request(app).post(`/api/institutional${path}`).send(body);
      // 200 con calls, o un 409 honesto del pre-flight — pero JAMÁS un approve.
      const calls: PreparedCall[] = res.body?.calls ?? [];
      expect({ path, approves: decodeApproves(calls) }).toEqual({ path, approves: [] });
    }
  });
});

describe('institutional — un checksum EIP-55 inválido es un 400, jamás un cuelgue', () => {
  it('receiver con mayúsculas y checksum malo → 400 INVALID_REQUEST', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: '0xEEee000000000000000000000000000000000001' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUEST');
  });
});

describe('institutional — fee-leg de Astryum en el redeem (en participaciones)', () => {
  const COLLECTOR = '0xfeee000000000000000000000000000000000001';
  const TRANSFER_IFACE = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const TRANSFER_SELECTOR = TRANSFER_IFACE.getFunction('transfer')!.selector;
  const REDEEM_IFACE = new ethers.Interface(['function redeem(uint256 shares, address receiver, address owner) returns (uint256)']);

  it('sin config → NO hay fee-leg (retrocompatible): un solo call, fee null', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-redeem/prepare')
      .send({ pote: POTE, sharesBase: '1000000', receiver: CLIENT, owner: CLIENT });
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.fee).toBeNull();
  });

  /**
   * INVERTIDO el 24-ago-2026. Este caso comprobaba que con las envs puestas se
   * compusiera el fee-leg. Ya no: el fundador fijó que el ingreso de Astryum
   * viene SIEMPRE del lado del operador (corte de la fee del manager, fee de
   * integrador del venue, pago por creación de pote), nunca del cliente — que es
   * lo que el canon exigía desde el 18-ago:
   *
   *   «Astryum cobra licencia al operador, jamás un corte del rendimiento del
   *    cliente. Cobrar de ahí nos convertiría de proveedor de software en
   *    prestador de servicio financiero.»
   *
   * `redeemServiceFee()` quedó inerte (devuelve null; el cuerpo se conserva
   * comentado). El test no se borra: se invierte, para que si alguien la
   * reactiva se ponga rojo aquí y no en producción.
   */
  it('con las envs de fee puestas → SIGUE sin haber fee-leg (§15.1)', async () => {
    process.env.INSTITUTIONAL_FEE_COLLECTOR = COLLECTOR;
    process.env.INSTITUTIONAL_REDEEM_FEE_BPS = '50'; // 0.5% — ignorado a propósito
    const shares = 1_000_000n;
    const res = await request(app)
      .post('/api/institutional/pote-redeem/prepare')
      .send({ pote: POTE, sharesBase: shares.toString(), receiver: CLIENT, owner: CLIENT });
    expect(res.status).toBe(200);

    // Un solo call: el redeem del user, por sus shares ÍNTEGRAS.
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.fee).toBeNull();

    const [redeemShares] = REDEEM_IFACE.decodeFunctionData('redeem', res.body.calls[0].data);
    expect(BigInt(redeemShares)).toBe(shares);

    // Y ninguna call transfiere participaciones a nadie — ni al colector, ni
    // (jamás) al operador.
    const transfers = (res.body.calls as Array<{ data: string }>).filter((c) =>
      c.data.toLowerCase().startsWith(TRANSFER_SELECTOR.toLowerCase()),
    );
    expect(transfers).toHaveLength(0);
  });

  it('tope duro fail-closed: bps > 500 (5%) se ignora, sin fee-leg', async () => {
    process.env.INSTITUTIONAL_FEE_COLLECTOR = COLLECTOR;
    process.env.INSTITUTIONAL_REDEEM_FEE_BPS = '600';
    const res = await request(app)
      .post('/api/institutional/pote-redeem/prepare')
      .send({ pote: POTE, sharesBase: '1000000', receiver: CLIENT, owner: CLIENT });
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.fee).toBeNull();
  });
});

describe('institutional.ts — tripwire de fuente (rutas futuras)', () => {
  it('cada encodeFunctionData(approve) del fichero nombra a state.pote como spender', () => {
    const source = readFileSync(join(__dirname, '..', 'institutional.ts'), 'utf8');
    const approveLines = source
      .split('\n')
      .filter((l) => l.includes("encodeFunctionData('approve'"));
    expect(approveLines.length).toBeGreaterThan(0);
    const offenders = approveLines.filter((l) => !l.includes('state.pote'));
    // Si esto se pone rojo: una ruta nueva compone un approve con otro spender.
    // Leer el §2 de la Orden de Trabajo 22-ago ANTES de tocar la lista.
    expect(offenders).toEqual([]);
  });
});

/**
 * El escáner KWYH también en las dos salidas que no lo corrían.
 *
 * `/vault/prepare` (vault_withdraw) y `/bridge/prepare` (to-flare) son SALIDAS: solo
 * flag, sin geovalla. Sus modales (EmExitModal, EmBridgeModal) pintan
 * `ExitRiskWarnings`, pero el backend no escaneaba nada: la caja nunca podía
 * aparecer. Ahora el token que cada salida mueve (RLUSD al redimir de la bóveda,
 * FXRP al volver a Flare) se escanea y un DANGER viaja como `riskWarnings` en un
 * 200 — misma forma que close/repay. Nunca bloquea: la salida jamás se gatea.
 */
const mockGeo = jest.fn(() => ({ allowed: false, reason: 'region not allowed' }) as { allowed: boolean; reason?: string });
jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: (...a: unknown[]) => mockGeo(...(a as [])) },
}));
jest.mock('../../utils/rpcForChain', () => ({ getRpcForChain: jest.fn(() => ({})) }));
jest.mock('../../services/ethMorphoReaders', () => ({
  ...jest.requireActual('../../services/ethMorphoReaders'),
  makeEthFillQuoter: jest.fn(() => async () => undefined),
}));

const mockGoPlus = jest.fn(async () => ({ data: { verdict: 'safe', flags: [] as string[] } }));
jest.mock('../../integrations/providers/security/GoPlusProvider', () => ({
  goPlusProvider: { call: (...a: unknown[]) => mockGoPlus(...(a as [])) },
}));

const OK = { chainId: 1, legs: [], preflight: { ok: true, checks: [] } };
const mockVault = jest.fn(async () => OK);
const mockBridge = jest.fn(async () => OK);
const mockBridgeBack = jest.fn(async () => OK);
jest.mock('../../services/EthMorphoPrepareService', () => ({
  prepareEthMorpho: jest.fn(),
  prepareSentoraVault: (...a: unknown[]) => mockVault(...(a as [])),
  prepareFxrpBridge: (...a: unknown[]) => mockBridge(...(a as [])),
  prepareFxrpBridgeBack: (...a: unknown[]) => mockBridgeBack(...(a as [])),
  prepareCloseCarry: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import router from '../ethMorpho';
import { FXRP_ETH, RLUSD_ETH } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';

const app = express();
app.use(express.json());
app.use('/api/eth-morpho', router);

const WALLET = '0x1111111111111111111111111111111111111111';

const EXITS: Array<[string, string, Record<string, unknown>, string, string, jest.Mock]> = [
  ['/vault/prepare', 'vault_withdraw', { action: 'vault_withdraw', user: WALLET, amountBase: '1000' }, 'RLUSD', RLUSD_ETH, mockVault],
  ['/bridge/prepare', 'to-flare', { user: WALLET, amountBase: '1000000', direction: 'to-flare' }, 'FXRP', FXRP_ETH, mockBridgeBack],
];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ETH_RLUSD_FXRP_ENABLED = 'true';
  mockGeo.mockReturnValue({ allowed: false, reason: 'region not allowed' });
  mockGoPlus.mockResolvedValue({ data: { verdict: 'safe', flags: [] } });
});

describe.each(EXITS)('%s (%s) — salida: el escáner avisa, no bloquea', (path, _label, body, token, address, service) => {
  it(`DANGER en ${token} → 200 con riskWarnings, compuesto igual y en región bloqueada`, async () => {
    mockGoPlus.mockResolvedValue({ data: { verdict: 'danger', flags: ['honeypot'] } });
    const res = await request(app).post(`/api/eth-morpho${path}`).send({ ...body, region: 'US' });
    expect(res.status).toBe(200);
    expect(service).toHaveBeenCalled();
    expect(res.body.chainId).toBe(1);
    expect(res.body.riskWarnings).toEqual([
      expect.objectContaining({ code: `KWYH_DANGER_${token}`, token, address, flags: ['honeypot'] }),
    ]);
    // El token que esta salida MUEVE, en Ethereum, y solo ése.
    expect(mockGoPlus).toHaveBeenCalledTimes(1);
    expect(mockGoPlus).toHaveBeenCalledWith('security.tokenSafety', { chainId: 1, address }, expect.anything());
    expect(mockGeo).not.toHaveBeenCalled();
  });

  it('sin DANGER la respuesta no cambia de forma (sin riskWarnings)', async () => {
    const res = await request(app).post(`/api/eth-morpho${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.riskWarnings).toBeUndefined();
  });

  it('un escáner CAÍDO no bloquea la salida', async () => {
    mockGoPlus.mockRejectedValue(new Error('goplus down'));
    const res = await request(app).post(`/api/eth-morpho${path}`).send(body);
    expect(res.status).toBe(200);
    expect(service).toHaveBeenCalled();
  });
});

describe('las ENTRADAS gemelas no ganan riskWarnings por este cambio', () => {
  it.each([
    ['/vault/prepare', { action: 'vault_deposit', user: WALLET, amountBase: '1000' }],
    ['/bridge/prepare', { user: WALLET, amountBase: '1000000', direction: 'to-ethereum' }],
  ])('%s en región bloqueada sigue en 451 y no escanea como aviso', async (path, body) => {
    mockGoPlus.mockResolvedValue({ data: { verdict: 'danger', flags: ['honeypot'] } });
    const res = await request(app).post(`/api/eth-morpho${path}`).send({ ...body, region: 'US' });
    expect(res.status).toBe(451);
    expect(mockGoPlus).not.toHaveBeenCalled();
  });
});

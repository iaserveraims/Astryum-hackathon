/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA») —
 * POST /api/wallet-transfer/bridge/flare-to-xrpl/prepare.
 *
 * FXRP → XRP is the way home (DERISK in PaActionsModal, WalletTransferModals): flag-only,
 * NO geofence. The mint direction (xrpl-to-flare) is an entry and keeps its 451.
 *
 * Hermetic: resolveAssetManagerFxrp is stubbed to reject, so a request that gets PAST
 * the gate answers 500 BRIDGE_REDEEM_PREPARE_FAILED without touching the network —
 * exactly what "got past the gate" looks like.
 */
import express from 'express';
import request from 'supertest';
import walletTransferRouter from '../walletTransfer';
import * as flareMint from '../../connectors/protocols/flare/FlareDirectMintService';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/wallet-transfer', walletTransferRouter);

const GOOD_XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const GOOD_XRPL_2 = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const GOOD_EVM = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const GOOD_EVM_2 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;
let amSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
  amSpy = jest.spyOn(flareMint, 'resolveAssetManagerFxrp').mockRejectedValue(new Error('NO_RPC_IN_TEST'));
});

afterEach(() => {
  geoSpy.mockRestore();
  amSpy.mockRestore();
});

afterAll(() => {
  process.env = ENV;
});

describe('bridge/flare-to-xrpl — the way home is never geofenced', () => {
  const valid = { evmWallet: GOOD_EVM_2, xrplDestination: GOOD_XRPL_2, amountXrp: '10', region: 'US' };

  it('a blocked region gets past the gate (not 451): the handler reaches the chain read', async () => {
    const res = await request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send(valid);
    expect(res.status).not.toBe(451);
    expect(String(res.body?.error ?? '')).not.toMatch(/GEOFENCE/);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('BRIDGE_REDEEM_PREPARE_FAILED');
    expect(amSpy).toHaveBeenCalled();
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('the flag still applies: FLARE_DEFI_ENABLED off answers 503', async () => {
    delete process.env.FLARE_DEFI_ENABLED;
    const res = await request(app).post('/api/wallet-transfer/bridge/flare-to-xrpl/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('bridge/xrpl-to-flare — the mint is an ENTRY and keeps the geofence', () => {
  it('a blocked region answers 451', async () => {
    const res = await request(app)
      .post('/api/wallet-transfer/bridge/xrpl-to-flare/prepare')
      .send({ xrplAddress: GOOD_XRPL, evmDestination: GOOD_EVM, amountXrp: 25, region: 'US' });
    expect(res.status).toBe(451);
    expect(res.body.error).toMatch(/^GEOFENCE_BLOCKED/);
    expect(geoSpy).toHaveBeenCalled();
  });
});
